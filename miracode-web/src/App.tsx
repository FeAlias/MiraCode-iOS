import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { TopBar } from './components/TopBar';
import { ChatWorkspace, ChatMessage } from './components/ChatWorkspace';
import { LivePreview, BottomAreaTab } from './components/LivePreview';
import { ProgramsSidebar } from './components/ProgramsSidebar';
import { SaveProgramModal } from './components/SaveProgramModal';
import { ModelSelectorModal, SettingsModalSection } from './components/ModelSelectorModal';
import { GitHubSyncModal } from './components/GitHubSyncModal';

import { LocalAIModel, KnowledgeDoc } from './types/ai';
import { CodeProject, VersionSnapshot } from './types/project';
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL_ID,
  DEFAULT_CONTEXT_WINDOW,
  aiEngine,
} from './services/aiEngine';
import { nativeBridge, NativeStatusPayload } from './services/nativeBridge';
import { offlineStorage, DEFAULT_STARTER_CODE } from './services/storage';
import { calculateChangeStats } from './services/diffService';
import { validateCodeSyntax } from './services/previewCompiler';
import {
  getStoredKnowledgeDocs,
  saveStoredKnowledgeDocs,
  createKnowledgeDoc,
  retrieveRelevantDocContext,
} from './services/docRagService';

function createFreshProjectId(): string {
  return `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

const MAX_UNDO_STEPS = 40;

export default function App() {
  // Multi-program workspace state
  const [projects, setProjects] = useState<CodeProject[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string>(() => createFreshProjectId());
  const [projectName, setProjectName] = useState<string>('Untitled Program');
  const [projectCreatedAt, setProjectCreatedAt] = useState<number>(() => Date.now());

  // Editor, Undo/Redo & Preview state
  const [activeCode, setActiveCode] = useState<string>(DEFAULT_STARTER_CODE);
  const latestActiveCodeRef = useRef<string>(DEFAULT_STARTER_CODE);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const typingCheckpointRef = useRef<{ baseCode: string; timer: ReturnType<typeof setTimeout> | null }>({
    baseCode: DEFAULT_STARTER_CODE,
    timer: null,
  });

  const [previewCode, setPreviewCode] = useState<string>(DEFAULT_STARTER_CODE);
  const [runCount, setRunCount] = useState<number>(0);
  const runCountRef = useRef<number>(0);
  const [lastRunError, setLastRunError] = useState<string | null>(null);
  const [bottomTab, setBottomTab] = useState<BottomAreaTab>('preview');
  const [isPreviewFullScreen, setIsPreviewFullScreen] = useState<boolean>(false);

  // Chat conversation & version history state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [versions, setVersions] = useState<VersionSnapshot[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingStatus, setStreamingStatus] = useState('');
  const chatInputRef = useRef<HTMLInputElement>(null);

  // Local AI Model & Native Metal Bridge State
  const [models] = useState<LocalAIModel[]>(AVAILABLE_MODELS);
  const [activeModelId, setActiveModelId] = useState<string>(DEFAULT_MODEL_ID);
  const [nativeStatus, setNativeStatus] = useState<NativeStatusPayload | null>(() =>
    nativeBridge.getLatestStatus()
  );
  const [isNativeApp] = useState<boolean>(() => nativeBridge.isRunningInNativeApp());
  const [contextWindow, setContextWindow] = useState<number>(DEFAULT_CONTEXT_WINDOW);
  const [ollamaUrl, setOllamaUrl] = useState<string>('http://localhost:11434');
  const [knowledgeDocs, setKnowledgeDocs] = useState<KnowledgeDoc[]>([]);

  // Drawers & Modals
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] =
    useState<SettingsModalSection>('models');
  const [isGitHubOpen, setIsGitHubOpen] = useState(false);
  const [githubToken, setGithubToken] = useState('');

  const updateActiveCodeState = (nextCode: string) => {
    latestActiveCodeRef.current = nextCode;
    setActiveCode(nextCode);
  };

  const updateRunCount = (nextVal: number | ((prev: number) => number)) => {
    setRunCount(prev => {
      const resolved = typeof nextVal === 'function' ? nextVal(prev) : nextVal;
      runCountRef.current = resolved;
      return resolved;
    });
  };

  const resetUndoHistory = (initialCode: string) => {
    if (typingCheckpointRef.current.timer) {
      clearTimeout(typingCheckpointRef.current.timer);
      typingCheckpointRef.current.timer = null;
    }
    typingCheckpointRef.current.baseCode = initialCode;
    setUndoStack([]);
    setRedoStack([]);
  };

  const pushImmediateUndoSnapshot = (previousCode: string, nextCode: string) => {
    if (previousCode === nextCode) return;
    if (typingCheckpointRef.current.timer) {
      clearTimeout(typingCheckpointRef.current.timer);
      typingCheckpointRef.current.timer = null;
    }
    typingCheckpointRef.current.baseCode = nextCode;
    setUndoStack(prev => [...prev.slice(-(MAX_UNDO_STEPS - 1)), previousCode]);
    setRedoStack([]);
  };

  // Subscribe to PocketPal native Metal model status
  useEffect(() => {
    const unsub = nativeBridge.subscribeStatus(status => {
      setNativeStatus(status);
    });
    nativeBridge.notifyWebReady();
    return unsub;
  }, []);

  // Load persistent offline programs, uploaded docs & settings on mount
  useEffect(() => {
    async function loadState() {
      const [rawProjects, storedDocs] = await Promise.all([
        offlineStorage.getAllProjects(),
        getStoredKnowledgeDocs(),
      ]);
      setKnowledgeDocs(storedDocs);

      const validProjects: CodeProject[] = [];

      for (const proj of rawProjects) {
        const isLegacyPolluted =
          proj.activeCode?.includes('Prompt Enhancement:') ||
          proj.activeCode?.includes('neuralInference: 14.2') ||
          proj.activeCode?.includes('Ask the local AI above to write code');

        if (isLegacyPolluted) {
          await offlineStorage.deleteProject(proj.id);
          continue;
        }
        if (proj.activeCode && proj.activeCode.trim().length > 0) {
          validProjects.push(proj);
        }
      }

      validProjects.sort((a, b) => b.updatedAt - a.updatedAt);
      setProjects(validProjects);

      const lastActiveId = await offlineStorage.getSetting<string>('last_active_project_id', '');
      if (lastActiveId === '__blank_new__') {
        setCurrentProjectId(createFreshProjectId());
        setProjectName('Untitled Program');
        updateActiveCodeState('');
        setPreviewCode('');
        resetUndoHistory('');
        setMessages([]);
        setVersions([]);
      } else {
        const target =
          validProjects.find(p => p.id === lastActiveId) || validProjects[0] || null;

        if (target) {
          setCurrentProjectId(target.id);
          setProjectName(target.name || 'Untitled Program');
          setProjectCreatedAt(target.createdAt || Date.now());
          updateActiveCodeState(target.activeCode);
          setPreviewCode(target.activeCode);
          resetUndoHistory(target.activeCode);
          setVersions(target.versions || []);
          setMessages(target.messages || []);
        }
      }

      const savedModelId = await offlineStorage.getSetting('selected_model_v3', DEFAULT_MODEL_ID);
      const exists = AVAILABLE_MODELS.some(m => m.id === savedModelId);
      setActiveModelId(exists ? savedModelId : DEFAULT_MODEL_ID);

      const savedToken = await offlineStorage.getSetting('github_token', '');
      setGithubToken(savedToken);

      const savedCtxWindow = await offlineStorage.getSetting<number>(
        'local_context_window',
        DEFAULT_CONTEXT_WINDOW
      );
      setContextWindow(savedCtxWindow);
      aiEngine.setPreferredContextWindow(savedCtxWindow);

      const savedOllama = await offlineStorage.getSetting('ollama_url', 'http://localhost:11434');
      setOllamaUrl(savedOllama);
      aiEngine.setOllamaUrl(savedOllama);
    }

    loadState();
  }, []);

  const activeModel = models.find(m => m.id === activeModelId) || models[0];
  const activeModelDisplayName =
    activeModelId === 'ollama_local'
      ? activeModel.name
      : nativeStatus?.activeModel?.isLoaded
        ? nativeStatus.activeModel.name
        : 'Apple Metal (No Model Loaded)';

  const upsertProjectRecord = async (record: CodeProject) => {
    await offlineStorage.saveProject(record);
    await offlineStorage.setSetting('last_active_project_id', record.id);
    setProjects(prev => {
      const others = prev.filter(p => p.id !== record.id);
      return [record, ...others].sort((a, b) => b.updatedAt - a.updatedAt);
    });
  };

  const persistCodeChange = async (codeToSave: string) => {
    if (codeToSave.trim().length === 0) return;
    const now = Date.now();
    const record: CodeProject = {
      id: currentProjectId,
      name: projectName,
      description: 'Local AI Program',
      createdAt: projectCreatedAt,
      updatedAt: now,
      activeCode: codeToSave,
      versions,
      messages: messages.slice(-40),
      files: { 'src/App.tsx': codeToSave },
    };
    await upsertProjectRecord(record);
  };

  const handleNewProgram = async () => {
    const freshId = createFreshProjectId();
    const now = Date.now();
    setCurrentProjectId(freshId);
    setProjectName('Untitled Program');
    setProjectCreatedAt(now);
    updateActiveCodeState('');
    setPreviewCode('');
    resetUndoHistory('');
    setLastRunError(null);
    setMessages([]);
    setVersions([]);
    updateRunCount(0);
    setIsPreviewFullScreen(false);
    await offlineStorage.setSetting('last_active_project_id', '__blank_new__');
  };

  const handleSelectProject = async (proj: CodeProject) => {
    setCurrentProjectId(proj.id);
    setProjectName(proj.name || 'Untitled Program');
    setProjectCreatedAt(proj.createdAt || Date.now());
    updateActiveCodeState(proj.activeCode);
    setPreviewCode(proj.activeCode);
    resetUndoHistory(proj.activeCode);
    setLastRunError(null);
    setVersions(proj.versions || []);
    setMessages(proj.messages || []);
    setBottomTab('preview');
    updateRunCount(proj.activeCode.trim() ? 1 : 0);
    await offlineStorage.setSetting('last_active_project_id', proj.id);
  };

  const handleDeleteProject = async (projectId: string) => {
    await offlineStorage.deleteProject(projectId);
    const remaining = projects.filter(p => p.id !== projectId);
    setProjects(remaining);

    if (projectId === currentProjectId) {
      if (remaining.length > 0) {
        await handleSelectProject(remaining[0]);
      } else {
        await handleNewProgram();
      }
    }
  };

  const handleImportFromPhoneFile = async (importedName: string, code: string) => {
    const now = Date.now();
    const newId = createFreshProjectId();
    const snapshot: VersionSnapshot = {
      id: `v_import_${now}`,
      versionNumber: 1,
      versionTag: 'v1.0',
      timestamp: now,
      title: `Imported ${importedName}`,
      summary: 'Loaded from device Files.',
      code,
      linesAdded: code.split('\n').length,
      linesRemoved: 0,
      trigger: 'manual',
      modelUsed: 'Phone Files',
    };

    const record: CodeProject = {
      id: newId,
      name: importedName,
      description: 'Imported from Phone Files',
      createdAt: now,
      updatedAt: now,
      activeCode: code,
      versions: [snapshot],
      messages: [],
      files: { 'src/App.tsx': code },
    };

    setCurrentProjectId(newId);
    setProjectName(importedName);
    setProjectCreatedAt(now);
    updateActiveCodeState(code);
    setPreviewCode(code);
    resetUndoHistory(code);
    setLastRunError(null);
    setVersions([snapshot]);
    setMessages([]);
    setBottomTab('code');
    updateRunCount(0);

    await upsertProjectRecord(record);
  };

  const handleSaveToLibrary = async (chosenName: string) => {
    const cleanName = chosenName.trim() || 'Untitled Program';
    const now = Date.now();
    setProjectName(cleanName);
    const currentCode = latestActiveCodeRef.current;

    const record: CodeProject = {
      id: currentProjectId,
      name: cleanName,
      description: 'Local AI Program',
      createdAt: projectCreatedAt,
      updatedAt: now,
      activeCode: currentCode,
      versions,
      messages: messages.slice(-40),
      files: { 'src/App.tsx': currentCode },
    };

    await upsertProjectRecord(record);
  };

  const handlePressCodeButton = () => {
    setIsPreviewFullScreen(false);
    setTimeout(() => {
      chatInputRef.current?.focus();
    }, 60);
  };

  const handlePressRunButton = () => {
    const codeToRun = latestActiveCodeRef.current;
    if (!codeToRun.trim()) return;
    setLastRunError(null);
    setPreviewCode(codeToRun);
    setBottomTab('preview');
    updateRunCount(c => c + 1);
  };

  const handleUndo = async () => {
    if (undoStack.length === 0) return;
    if (typingCheckpointRef.current.timer) {
      clearTimeout(typingCheckpointRef.current.timer);
      typingCheckpointRef.current.timer = null;
    }
    const previousCode = undoStack[undoStack.length - 1];
    const currentCode = latestActiveCodeRef.current;

    setUndoStack(prev => prev.slice(0, -1));
    setRedoStack(prev => [...prev, currentCode]);
    typingCheckpointRef.current.baseCode = previousCode;
    updateActiveCodeState(previousCode);
    await persistCodeChange(previousCode);
  };

  const handleRedo = async () => {
    if (redoStack.length === 0) return;
    if (typingCheckpointRef.current.timer) {
      clearTimeout(typingCheckpointRef.current.timer);
      typingCheckpointRef.current.timer = null;
    }
    const nextCode = redoStack[redoStack.length - 1];
    const currentCode = latestActiveCodeRef.current;

    setRedoStack(prev => prev.slice(0, -1));
    setUndoStack(prev => [...prev.slice(-(MAX_UNDO_STEPS - 1)), currentCode]);
    typingCheckpointRef.current.baseCode = nextCode;
    updateActiveCodeState(nextCode);
    await persistCodeChange(nextCode);
  };

  const handleReportRunError = useCallback((err: string | null) => {
    setLastRunError(err);
  }, []);

  const handleSendMessage = async (prompt: string) => {
    const userMsg: ChatMessage = {
      id: `m_${Date.now()}_u`,
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setIsGenerating(true);
    setStreamingStatus('');

    const currentCodeSnapshot = latestActiveCodeRef.current;

    try {
      const docContext = retrieveRelevantDocContext(prompt, knowledgeDocs, 1400);
      const currentSyntaxErr = currentCodeSnapshot.trim()
        ? validateCodeSyntax(currentCodeSnapshot)
        : null;
      const activeErrorContext =
        lastRunError || (currentSyntaxErr ? `Syntax Error: ${currentSyntaxErr}` : null);

      const result = await aiEngine.generateCode(
        {
          prompt,
          currentCode: currentCodeSnapshot,
          modelId: activeModelId,
          history: nextMessages.map(m => ({ role: m.role, content: m.content })),
          lastRuntimeError: activeErrorContext,
          docContext,
        },
        statusChunk => {
          setStreamingStatus(statusChunk);
        }
      );

      const now = Date.now();
      const wasUpdatingExisting = currentCodeSnapshot.trim().length > 0;
      const stats = calculateChangeStats(currentCodeSnapshot, result.code);
      const newSnapshot: VersionSnapshot = {
        id: `v_${now}`,
        versionNumber: versions.length + 1,
        versionTag: `v1.${versions.length}`,
        timestamp: now,
        title: result.versionTitle,
        summary: result.explanation,
        code: result.code,
        prompt,
        modelUsed: result.modelUsed,
        linesAdded: stats.added,
        linesRemoved: stats.removed,
        trigger: 'prompt',
      };

      const updatedVersions = [newSnapshot, ...versions];
      const nextName =
        projectName === 'Untitled Program' ? result.versionTitle : projectName;

      pushImmediateUndoSnapshot(currentCodeSnapshot, result.code);
      setProjectName(nextName);
      setVersions(updatedVersions);
      updateActiveCodeState(result.code);
      setLastRunError(null);

      const autoRefreshedPreview = runCountRef.current > 0;
      if (autoRefreshedPreview) {
        setPreviewCode(result.code);
        updateRunCount(c => c + 1);
      }

      const summaryContent = wasUpdatingExisting
        ? `${newSnapshot.versionTag} (+${stats.added} / -${stats.removed} lines) · ${
            autoRefreshedPreview
              ? 'Live preview updated automatically (or tap Run anytime to restart).'
              : result.explanation
          }`
        : result.explanation;

      const assistantMsg: ChatMessage = {
        id: `m_${now}_a`,
        role: 'assistant',
        content: summaryContent,
        timestamp: now,
      };

      const finalMessages = [...nextMessages, assistantMsg];
      setMessages(finalMessages);

      const record: CodeProject = {
        id: currentProjectId,
        name: nextName,
        description: 'Local AI Program',
        createdAt: projectCreatedAt,
        updatedAt: now,
        activeCode: result.code,
        versions: updatedVersions,
        messages: finalMessages.slice(-40),
        files: { 'src/App.tsx': result.code },
      };

      await upsertProjectRecord(record);
      await offlineStorage.addSnapshot(newSnapshot);
    } catch (e: any) {
      const errMsg: ChatMessage = {
        id: `m_${Date.now()}_err`,
        role: 'assistant',
        content: `Error: ${e?.message || 'Could not run local model.'}`,
        timestamp: Date.now(),
      };
      setMessages([...nextMessages, errMsg]);
    } finally {
      setIsGenerating(false);
      setStreamingStatus('');
    }
  };

  const handleStopGeneration = () => {
    aiEngine.abortActiveGeneration();
  };

  const liveSyntaxError = useMemo(() => {
    if (!activeCode.trim()) return null;
    const err = validateCodeSyntax(activeCode);
    return err ? `Syntax Error: ${err}` : null;
  }, [activeCode]);

  const effectiveError = liveSyntaxError || lastRunError;

  const handleAskAIToFixError = () => {
    if (!effectiveError || isGenerating) return;
    handleSendMessage(`Please fix this error when running the code: ${effectiveError}`);
  };

  const handleSaveManualCode = async (newCode: string) => {
    updateActiveCodeState(newCode);

    if (typingCheckpointRef.current.timer) {
      clearTimeout(typingCheckpointRef.current.timer);
    }
    typingCheckpointRef.current.timer = setTimeout(() => {
      const base = typingCheckpointRef.current.baseCode;
      if (base !== newCode) {
        setUndoStack(prev => [...prev.slice(-(MAX_UNDO_STEPS - 1)), base]);
        setRedoStack([]);
        typingCheckpointRef.current.baseCode = newCode;
      }
      typingCheckpointRef.current.timer = null;
    }, 650);

    await persistCodeChange(newCode);
  };

  const handleRestoreVersion = async (version: VersionSnapshot) => {
    const now = Date.now();
    const prevCode = latestActiveCodeRef.current;
    const stats = calculateChangeStats(prevCode, version.code);
    const restoreSnapshot: VersionSnapshot = {
      id: `v_restore_${now}`,
      versionNumber: versions.length + 1,
      versionTag: `v1.${versions.length}`,
      timestamp: now,
      title: `Restored ${version.versionTag}`,
      summary: `Reverted to ${version.title}.`,
      code: version.code,
      linesAdded: stats.added,
      linesRemoved: stats.removed,
      trigger: 'restore',
      modelUsed: 'Version History',
    };

    pushImmediateUndoSnapshot(prevCode, version.code);
    const updatedVersions = [restoreSnapshot, ...versions];
    setVersions(updatedVersions);
    updateActiveCodeState(version.code);
    setPreviewCode(version.code);
    setLastRunError(null);
    setBottomTab('preview');
    updateRunCount(c => c + 1);

    const record: CodeProject = {
      id: currentProjectId,
      name: projectName,
      description: 'Local AI Program',
      createdAt: projectCreatedAt,
      updatedAt: now,
      activeCode: version.code,
      versions: updatedVersions,
      messages: messages.slice(-40),
      files: { 'src/App.tsx': version.code },
    };
    await upsertProjectRecord(record);
  };

  // Offline Documentation Knowledge Base Handlers
  const handleUploadDocFiles = async (files: FileList) => {
    const added: KnowledgeDoc[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const text = await file.text();
      if (text.trim()) {
        added.push(createKnowledgeDoc(file.name, text));
      }
    }
    if (added.length > 0) {
      const next = [...added, ...knowledgeDocs];
      setKnowledgeDocs(next);
      await saveStoredKnowledgeDocs(next);
    }
  };

  const handleAddManualDoc = async (title: string, content: string) => {
    const doc = createKnowledgeDoc(title, content);
    const next = [doc, ...knowledgeDocs];
    setKnowledgeDocs(next);
    await saveStoredKnowledgeDocs(next);
  };

  const handleToggleDoc = async (docId: string) => {
    const next = knowledgeDocs.map(d =>
      d.id === docId ? { ...d, enabled: !d.enabled } : d
    );
    setKnowledgeDocs(next);
    await saveStoredKnowledgeDocs(next);
  };

  const handleDeleteDoc = async (docId: string) => {
    const next = knowledgeDocs.filter(d => d.id !== docId);
    setKnowledgeDocs(next);
    await saveStoredKnowledgeDocs(next);
  };

  const handleSelectModel = async (modelId: string) => {
    setActiveModelId(modelId);
    await offlineStorage.setSetting('selected_model_v3', modelId);
  };

  const handleSelectNativeModel = async (nativeModelId: string) => {
    await nativeBridge.selectNativeModel(nativeModelId);
  };

  const handleUnloadVram = async () => {
    await aiEngine.unloadEngine();
  };

  const handleChangeContextWindow = async (tokens: number) => {
    setContextWindow(tokens);
    aiEngine.setPreferredContextWindow(tokens);
    await offlineStorage.setSetting('local_context_window', tokens);
  };

  const handleChangeOllamaUrl = async (url: string) => {
    setOllamaUrl(url);
    aiEngine.setOllamaUrl(url);
    await offlineStorage.setSetting('ollama_url', url);
  };

  const handleSaveToken = async (token: string) => {
    setGithubToken(token);
    await offlineStorage.setSetting('github_token', token);
  };

  const hasPendingChanges =
    activeCode.trim().length > 0 && (runCount === 0 || activeCode !== previewCode);

  const activeDocsCount = knowledgeDocs.filter(d => d.enabled).length;

  return (
    <div className="safe-h-screen w-full bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      <TopBar
        onOpenSidebar={() => setIsSidebarOpen(true)}
        onOpenNativeDrawer={() => nativeBridge.openNativeDrawer()}
        onOpenSettings={() => {
          setSettingsInitialSection('models');
          setIsSettingsOpen(true);
        }}
        onPressCode={handlePressCodeButton}
        isChatFocused={!isPreviewFullScreen}
        nativeStatus={nativeStatus}
        isNativeApp={isNativeApp}
      />

      {/* Split-Screen Body: Top Half = Local AI Chat | Bottom Half = Preview, Undo/Run/Redo & Code Tabs */}
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className={isPreviewFullScreen ? 'hidden' : 'h-1/2 min-h-0 flex flex-col'}>
          <ChatWorkspace
            programName={projectName}
            activeModel={activeModel}
            activeModelDisplayName={activeModelDisplayName}
            messages={messages}
            activeDocsCount={activeDocsCount}
            onSendMessage={handleSendMessage}
            onStopGeneration={handleStopGeneration}
            onNewProgram={handleNewProgram}
            onOpenDocs={() => {
              setSettingsInitialSection('docs');
              setIsSettingsOpen(true);
            }}
            isGenerating={isGenerating}
            streamingStatus={streamingStatus}
            inputRef={chatInputRef}
          />
        </div>

        <div className={isPreviewFullScreen ? 'flex-1 min-h-0 flex flex-col' : 'h-1/2 min-h-0 flex flex-col'}>
          <LivePreview
            previewCode={previewCode}
            activeCode={activeCode}
            onChangeActiveCode={handleSaveManualCode}
            onOpenSaveModal={() => setIsSaveModalOpen(true)}
            runCount={runCount}
            activeTab={bottomTab}
            onSelectTab={setBottomTab}
            isFullScreen={isPreviewFullScreen}
            onToggleFullScreen={() => setIsPreviewFullScreen(prev => !prev)}
            onPressRun={handlePressRunButton}
            canUndo={undoStack.length > 0}
            canRedo={redoStack.length > 0}
            onUndo={handleUndo}
            onRedo={handleRedo}
            hasPendingChanges={hasPendingChanges}
            lastRunError={effectiveError}
            onReportRunError={handleReportRunError}
            onAskAIToFixError={handleAskAIToFixError}
            isGenerating={isGenerating}
            suspendForGpuMount={Boolean(nativeStatus?.isContextLoading)}
          />
        </div>
      </main>

      {/* Left Programs Sidebar: All Saved Programs */}
      <ProgramsSidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        projects={projects}
        currentProjectId={currentProjectId}
        onSelectProject={handleSelectProject}
        onNewProgram={handleNewProgram}
        onDeleteProject={handleDeleteProject}
        onImportFromPhoneFile={handleImportFromPhoneFile}
      />

      {/* Save Program & Export to Phone Files Modal */}
      <SaveProgramModal
        isOpen={isSaveModalOpen}
        onClose={() => setIsSaveModalOpen(false)}
        initialName={projectName === 'Untitled Program' ? '' : projectName}
        code={activeCode}
        onSaveToLibrary={handleSaveToLibrary}
      />

      {/* Settings Sheet (Native Metal Models, Offline Docs Knowledge Base, Version History & GitHub Sync) */}
      <ModelSelectorModal
        isOpen={isSettingsOpen}
        initialSection={settingsInitialSection}
        onClose={() => setIsSettingsOpen(false)}
        models={models}
        activeModelId={activeModelId}
        loadedVramModelId={nativeStatus?.activeModel?.isLoaded ? 'native_metal_active' : null}
        nativeStatus={nativeStatus}
        isNativeApp={isNativeApp}
        onSelectModel={handleSelectModel}
        onSelectNativeModel={handleSelectNativeModel}
        onOpenModelsScreen={() => nativeBridge.openModelsScreen()}
        onUnloadVram={handleUnloadVram}
        contextWindow={contextWindow}
        onChangeContextWindow={handleChangeContextWindow}
        ollamaUrl={ollamaUrl}
        onChangeOllamaUrl={handleChangeOllamaUrl}
        versions={versions}
        onRestoreVersion={handleRestoreVersion}
        knowledgeDocs={knowledgeDocs}
        onUploadDocFiles={handleUploadDocFiles}
        onAddManualDoc={handleAddManualDoc}
        onToggleDoc={handleToggleDoc}
        onDeleteDoc={handleDeleteDoc}
        onOpenGitHub={() => setIsGitHubOpen(true)}
      />

      <GitHubSyncModal
        isOpen={isGitHubOpen}
        onClose={() => setIsGitHubOpen(false)}
        activeCode={activeCode}
        projectName={projectName}
        savedToken={githubToken}
        onSaveToken={handleSaveToken}
      />
    </div>
  );
}
