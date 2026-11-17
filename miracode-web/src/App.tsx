import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { TopBar } from './components/TopBar';
import { ChatWorkspace, ChatMessage } from './components/ChatWorkspace';
import { LivePreview, BottomAreaTab } from './components/LivePreview';
import { ProgramsSidebar } from './components/ProgramsSidebar';
import { SaveProgramModal } from './components/SaveProgramModal';
import { ModelSelectorModal, SettingsModalSection } from './components/ModelSelectorModal';
import { GitHubSyncModal } from './components/GitHubSyncModal';

import {
  LocalAIModel,
  KnowledgeDoc,
  AgentInteractionMode,
  AgentCodingPlan,
} from './types/ai';
import { CodeProject, VersionSnapshot } from './types/project';
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL_ID,
  DEFAULT_CONTEXT_WINDOW,
  aiEngine,
  detectAutoAgentIntent,
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
  const currentProjectIdRef = useRef<string>(currentProjectId);
  const [projectName, setProjectName] = useState<string>('Untitled Program');
  const projectNameRef = useRef<string>('Untitled Program');
  const [projectCreatedAt, setProjectCreatedAt] = useState<number>(() => Date.now());
  const projectCreatedAtRef = useRef<number>(projectCreatedAt);

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

  // Agentic Chat, Mode, Plan & Version History state
  const [interactionMode, setInteractionMode] = useState<AgentInteractionMode>('auto');
  const [activePlan, setActivePlan] = useState<AgentCodingPlan | null>(null);
  const latestPlanRef = useRef<AgentCodingPlan | null>(null);
  const stopPlanSequenceRef = useRef<boolean>(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const latestMessagesRef = useRef<ChatMessage[]>([]);
  const [versions, setVersions] = useState<VersionSnapshot[]>([]);
  const latestVersionsRef = useRef<VersionSnapshot[]>([]);
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

  const updateProjectIdentity = (id: string, name: string, createdAt: number) => {
    currentProjectIdRef.current = id;
    projectNameRef.current = name;
    projectCreatedAtRef.current = createdAt;
    setCurrentProjectId(id);
    setProjectName(name);
    setProjectCreatedAt(createdAt);
  };

  const updateActiveCodeState = (nextCode: string) => {
    latestActiveCodeRef.current = nextCode;
    setActiveCode(nextCode);
  };

  const updateMessagesState = (nextMsgs: ChatMessage[]) => {
    latestMessagesRef.current = nextMsgs;
    setMessages(nextMsgs);
  };

  const updateVersionsState = (nextVers: VersionSnapshot[]) => {
    latestVersionsRef.current = nextVers;
    setVersions(nextVers);
  };

  const updatePlanState = (nextPlan: AgentCodingPlan | null) => {
    latestPlanRef.current = nextPlan;
    setActivePlan(nextPlan);
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
        if ((proj.activeCode && proj.activeCode.trim().length > 0) || proj.activePlan) {
          // Reset any stale 'in_progress' step left from a closed session back to 'pending'
          if (proj.activePlan) {
            proj.activePlan = {
              ...proj.activePlan,
              steps: proj.activePlan.steps.map(s =>
                s.status === 'in_progress' ? { ...s, status: 'pending' } : s
              ),
            };
          }
          validProjects.push(proj);
        }
      }

      validProjects.sort((a, b) => b.updatedAt - a.updatedAt);
      setProjects(validProjects);

      const lastActiveId = await offlineStorage.getSetting<string>('last_active_project_id', '');
      if (lastActiveId === '__blank_new__') {
        const freshId = createFreshProjectId();
        updateProjectIdentity(freshId, 'Untitled Program', Date.now());
        updateActiveCodeState('');
        setPreviewCode('');
        resetUndoHistory('');
        updateMessagesState([]);
        updateVersionsState([]);
        updatePlanState(null);
      } else {
        const target =
          validProjects.find(p => p.id === lastActiveId) || validProjects[0] || null;

        if (target) {
          updateProjectIdentity(
            target.id,
            target.name || 'Untitled Program',
            target.createdAt || Date.now()
          );
          updateActiveCodeState(target.activeCode);
          setPreviewCode(target.activeCode);
          resetUndoHistory(target.activeCode);
          updateVersionsState(target.versions || []);
          updateMessagesState(target.messages || []);
          updatePlanState(target.activePlan || null);
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

  const persistWorkspaceSnapshot = async (overrides?: {
    name?: string;
    code?: string;
    msgs?: ChatMessage[];
    vers?: VersionSnapshot[];
    plan?: AgentCodingPlan | null;
  }) => {
    const codeToSave = overrides?.code ?? latestActiveCodeRef.current;
    const planToSave =
      overrides?.plan !== undefined ? overrides.plan : latestPlanRef.current;
    const msgsToSave = overrides?.msgs ?? latestMessagesRef.current;
    const versToSave = overrides?.vers ?? latestVersionsRef.current;
    const resolvedName = overrides?.name ?? projectNameRef.current;

    if (!codeToSave.trim() && !planToSave && msgsToSave.length === 0) return;

    const record: CodeProject = {
      id: currentProjectIdRef.current,
      name: resolvedName,
      description: 'Local AI Program',
      createdAt: projectCreatedAtRef.current,
      updatedAt: Date.now(),
      activeCode: codeToSave,
      versions: versToSave,
      messages: msgsToSave.slice(-40),
      activePlan: planToSave,
      files: { 'src/App.tsx': codeToSave },
    };
    await upsertProjectRecord(record);
  };

  const handleNewProgram = async () => {
    const freshId = createFreshProjectId();
    const now = Date.now();
    updateProjectIdentity(freshId, 'Untitled Program', now);
    updateActiveCodeState('');
    setPreviewCode('');
    resetUndoHistory('');
    setLastRunError(null);
    updateMessagesState([]);
    updateVersionsState([]);
    updatePlanState(null);
    updateRunCount(0);
    setIsPreviewFullScreen(false);
    await offlineStorage.setSetting('last_active_project_id', '__blank_new__');
  };

  const handleSelectProject = async (proj: CodeProject) => {
    updateProjectIdentity(
      proj.id,
      proj.name || 'Untitled Program',
      proj.createdAt || Date.now()
    );
    updateActiveCodeState(proj.activeCode);
    setPreviewCode(proj.activeCode);
    resetUndoHistory(proj.activeCode);
    setLastRunError(null);
    updateVersionsState(proj.versions || []);
    updateMessagesState(proj.messages || []);
    updatePlanState(proj.activePlan || null);
    setBottomTab('preview');
    updateRunCount(proj.activeCode.trim() ? 1 : 0);
    await offlineStorage.setSetting('last_active_project_id', proj.id);
  };

  const handleDeleteProject = async (projectId: string) => {
    await offlineStorage.deleteProject(projectId);
    const remaining = projects.filter(p => p.id !== projectId);
    setProjects(remaining);

    if (projectId === currentProjectIdRef.current) {
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

    updateProjectIdentity(newId, importedName, now);
    updateActiveCodeState(code);
    setPreviewCode(code);
    resetUndoHistory(code);
    setLastRunError(null);
    updateVersionsState([snapshot]);
    updateMessagesState([]);
    updatePlanState(null);
    setBottomTab('code');
    updateRunCount(0);

    await persistWorkspaceSnapshot({
      name: importedName,
      code,
      vers: [snapshot],
      msgs: [],
      plan: null,
    });
  };

  const handleSaveToLibrary = async (chosenName: string) => {
    const cleanName = chosenName.trim() || 'Untitled Program';
    projectNameRef.current = cleanName;
    setProjectName(cleanName);
    await persistWorkspaceSnapshot({ name: cleanName });
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
    await persistWorkspaceSnapshot({ code: previousCode });
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
    await persistWorkspaceSnapshot({ code: nextCode });
  };

  const handleReportRunError = useCallback((err: string | null) => {
    setLastRunError(err);
  }, []);

  const liveSyntaxError = useMemo(() => {
    if (!activeCode.trim()) return null;
    const err = validateCodeSyntax(activeCode);
    return err ? `Syntax Error: ${err}` : null;
  }, [activeCode]);

  const effectiveError = liveSyntaxError || lastRunError;

  const isStarterOrEmptyCode = (code: string) =>
    !code.trim() || code.trim() === DEFAULT_STARTER_CODE.trim();

  /**
   * Executes either the next pending step (`mode: 'single'`) or all remaining steps (`mode: 'all'`)
   * from `activePlan`, compiling & runtime-verifying after EVERY step and saving per-step Undo snapshots!
   */
  const executePlanSteps = async (mode: 'single' | 'all') => {
    const initialPlan = latestPlanRef.current;
    if (!initialPlan || isGenerating) return;

    const firstTarget = initialPlan.steps.find(s => s.status !== 'completed');
    if (!firstTarget) return;

    stopPlanSequenceRef.current = false;
    setIsGenerating(true);
    setStreamingStatus('');

    try {
      while (!stopPlanSequenceRef.current) {
        const currentPlan = latestPlanRef.current;
        if (!currentPlan) break;

        const targetStep = currentPlan.steps.find(s => s.status !== 'completed');
        if (!targetStep) break;

        // Mark step as in_progress
        const workingPlan: AgentCodingPlan = {
          ...currentPlan,
          updatedAt: Date.now(),
          steps: currentPlan.steps.map(s =>
            s.id === targetStep.id
              ? { ...s, status: 'in_progress', errorNote: undefined }
              : s
          ),
        };
        updatePlanState(workingPlan);

        const codeBeforeStep = latestActiveCodeRef.current;
        const completedTitles = workingPlan.steps
          .filter(s => s.status === 'completed')
          .map(s => s.title);

        const forceFreshStart = Boolean(
          workingPlan.isNewAppFromScratch &&
            targetStep.stepNumber === 1 &&
            isStarterOrEmptyCode(codeBeforeStep)
        );

        const docContext = retrieveRelevantDocContext(
          `${workingPlan.goal} ${targetStep.title} ${targetStep.details}`,
          knowledgeDocs,
          1400
        );

        setStreamingStatus(
          `Step ${targetStep.stepNumber}/${workingPlan.steps.length}: ${targetStep.title}...`
        );

        try {
          const result = await aiEngine.generateCode(
            {
              prompt: `Step ${targetStep.stepNumber}: ${targetStep.title} — ${targetStep.details}`,
              currentCode: forceFreshStart ? '' : codeBeforeStep,
              modelId: activeModelId,
              history: latestMessagesRef.current.map(m => ({
                role: m.role,
                content: m.content,
              })),
              lastRuntimeError: forceFreshStart ? null : effectiveError,
              docContext,
              planStepContext: {
                goal: workingPlan.goal,
                stepNumber: targetStep.stepNumber,
                totalSteps: workingPlan.steps.length,
                stepTitle: targetStep.title,
                stepDetails: targetStep.details,
                completedStepTitles: completedTitles,
                forceFreshStart,
              },
            },
            chunk => {
              setStreamingStatus(chunk);
            }
          );

          const now = Date.now();
          const stats = calculateChangeStats(
            forceFreshStart ? '' : codeBeforeStep,
            result.code
          );
          const curVers = latestVersionsRef.current;
          const newSnapshot: VersionSnapshot = {
            id: `v_${now}`,
            versionNumber: curVers.length + 1,
            versionTag: `v1.${curVers.length}`,
            timestamp: now,
            title: result.versionTitle,
            summary: result.explanation,
            code: result.code,
            prompt: `${targetStep.title}: ${targetStep.details}`,
            modelUsed: result.modelUsed,
            linesAdded: stats.added,
            linesRemoved: stats.removed,
            trigger: 'prompt',
          };

          const nextVers = [newSnapshot, ...curVers];
          const nextName =
            projectNameRef.current === 'Untitled Program'
              ? workingPlan.goal.slice(0, 38)
              : projectNameRef.current;

          pushImmediateUndoSnapshot(codeBeforeStep, result.code);
          projectNameRef.current = nextName;
          setProjectName(nextName);
          updateVersionsState(nextVers);
          updateActiveCodeState(result.code);
          setLastRunError(null);

          // Automatically compile & show live preview after each verified step!
          setPreviewCode(result.code);
          updateRunCount(c => c + 1);

          const completedPlan: AgentCodingPlan = {
            ...workingPlan,
            updatedAt: now,
            steps: workingPlan.steps.map(s =>
              s.id === targetStep.id
                ? { ...s, status: 'completed', errorNote: undefined }
                : s
            ),
          };
          updatePlanState(completedPlan);

          const stepMsg: ChatMessage = {
            id: `m_${now}_step_${targetStep.stepNumber}`,
            role: 'assistant',
            kind: 'build',
            content: `✓ Step ${targetStep.stepNumber}/${completedPlan.steps.length}: ${targetStep.title} (+${stats.added} / -${stats.removed} lines) · ${
              result.selfFixedRuntime
                ? 'Compile + runtime verified (self-fixed 1 runtime issue).'
                : 'Compile + runtime verified.'
            }`,
            timestamp: now,
          };
          const nextMsgs = [...latestMessagesRef.current, stepMsg];
          updateMessagesState(nextMsgs);

          await persistWorkspaceSnapshot({
            name: nextName,
            code: result.code,
            vers: nextVers,
            msgs: nextMsgs,
            plan: completedPlan,
          });
          await offlineStorage.addSnapshot(newSnapshot);
        } catch (stepErr: any) {
          const errText = stepErr?.message || 'Step interrupted.';
          const failedPlan: AgentCodingPlan = {
            ...workingPlan,
            updatedAt: Date.now(),
            steps: workingPlan.steps.map(s =>
              s.id === targetStep.id
                ? { ...s, status: 'failed', errorNote: errText }
                : s
            ),
          };
          updatePlanState(failedPlan);
          await persistWorkspaceSnapshot({ plan: failedPlan });

          if (!/Generation stopped/i.test(errText)) {
            const failMsg: ChatMessage = {
              id: `m_${Date.now()}_steperr`,
              role: 'assistant',
              kind: 'error',
              content: `Paused on Step ${targetStep.stepNumber} (${targetStep.title}): ${errText}`,
              timestamp: Date.now(),
            };
            const nextMsgs = [...latestMessagesRef.current, failMsg];
            updateMessagesState(nextMsgs);
            await persistWorkspaceSnapshot({ msgs: nextMsgs, plan: failedPlan });
          }
          break;
        }

        if (mode === 'single') {
          break;
        }
      }
    } finally {
      setIsGenerating(false);
      setStreamingStatus('');
    }
  };

  const handleSendMessage = async (
    prompt: string,
    explicitMode?: AgentInteractionMode
  ) => {
    const chosenMode = explicitMode ?? interactionMode;
    const resolvedIntent =
      chosenMode === 'auto'
        ? detectAutoAgentIntent(prompt, latestPlanRef.current)
        : chosenMode;

    const userMsg: ChatMessage = {
      id: `m_${Date.now()}_u`,
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    };

    const nextMessages = [...latestMessagesRef.current, userMsg];
    updateMessagesState(nextMessages);

    if (resolvedIntent === 'run_next_step') {
      await persistWorkspaceSnapshot({ msgs: nextMessages });
      await executePlanSteps('single');
      return;
    }

    if (resolvedIntent === 'run_all_steps') {
      await persistWorkspaceSnapshot({ msgs: nextMessages });
      await executePlanSteps('all');
      return;
    }

    setIsGenerating(true);
    setStreamingStatus('');
    const currentCodeSnapshot = latestActiveCodeRef.current;

    try {
      const docContext = retrieveRelevantDocContext(prompt, knowledgeDocs, 1400);

      // Mode 1: Conversational Chat / Code Review (Never touches activeCode!)
      if (resolvedIntent === 'chat') {
        const chatRes = await aiEngine.chatWithCode(
          {
            prompt,
            currentCode: currentCodeSnapshot,
            modelId: activeModelId,
            history: nextMessages.map(m => ({ role: m.role, content: m.content })),
            lastRuntimeError: effectiveError,
            docContext,
          },
          chunk => {
            setStreamingStatus(chunk);
          }
        );

        const assistantMsg: ChatMessage = {
          id: `m_${Date.now()}_chat`,
          role: 'assistant',
          kind: 'chat',
          content: chatRes.reply,
          timestamp: Date.now(),
        };
        const finalMessages = [...nextMessages, assistantMsg];
        updateMessagesState(finalMessages);
        await persistWorkspaceSnapshot({ msgs: finalMessages });
        return;
      }

      // Mode 2: Step-by-Step Architectural Plan Generation
      if (resolvedIntent === 'plan') {
        const starterOrBlank = isStarterOrEmptyCode(currentCodeSnapshot);
        setStreamingStatus('Designing step-by-step implementation plan...');
        const planRes = await aiEngine.generateCodingPlan(
          {
            prompt,
            currentCode: currentCodeSnapshot,
            isStarterOrBlankCode: starterOrBlank,
            modelId: activeModelId,
            history: nextMessages.map(m => ({ role: m.role, content: m.content })),
            lastRuntimeError: effectiveError,
            docContext,
          },
          chunk => {
            setStreamingStatus(chunk);
          }
        );

        updatePlanState(planRes.plan);
        if (interactionMode === 'plan') {
          setInteractionMode('auto');
        }

        const planIntroMsg: ChatMessage = {
          id: `m_${Date.now()}_plan`,
          role: 'assistant',
          kind: 'plan',
          content: `Created a ${planRes.plan.steps.length}-step plan below. Tap "Run Step 1" to review each step as it builds, or "Run All Steps" to execute and verify every step automatically.`,
          timestamp: Date.now(),
        };
        const finalMessages = [...nextMessages, planIntroMsg];
        updateMessagesState(finalMessages);
        await persistWorkspaceSnapshot({
          msgs: finalMessages,
          plan: planRes.plan,
        });
        return;
      }

      // Mode 3: Direct Build / Surgical Edit + Compile & Runtime Self-Check
      const starterOnStandaloneApp =
        currentCodeSnapshot.trim() === DEFAULT_STARTER_CODE.trim() &&
        /\b(write|create|build|make|generate|implement)\s+(?:me\s+)?(?:a|an)\b/i.test(prompt);

      const effectiveBaseCode = starterOnStandaloneApp ? '' : currentCodeSnapshot;

      const result = await aiEngine.generateCode(
        {
          prompt,
          currentCode: effectiveBaseCode,
          modelId: activeModelId,
          history: nextMessages.map(m => ({ role: m.role, content: m.content })),
          lastRuntimeError: starterOnStandaloneApp ? null : effectiveError,
          docContext,
        },
        statusChunk => {
          setStreamingStatus(statusChunk);
        }
      );

      const now = Date.now();
      const wasUpdatingExisting = effectiveBaseCode.trim().length > 0;
      const stats = calculateChangeStats(effectiveBaseCode, result.code);
      const curVers = latestVersionsRef.current;
      const newSnapshot: VersionSnapshot = {
        id: `v_${now}`,
        versionNumber: curVers.length + 1,
        versionTag: `v1.${curVers.length}`,
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

      const updatedVersions = [newSnapshot, ...curVers];
      const nextName =
        projectNameRef.current === 'Untitled Program'
          ? result.versionTitle
          : projectNameRef.current;

      pushImmediateUndoSnapshot(currentCodeSnapshot, result.code);
      projectNameRef.current = nextName;
      setProjectName(nextName);
      updateVersionsState(updatedVersions);
      updateActiveCodeState(result.code);
      setLastRunError(null);

      setPreviewCode(result.code);
      updateRunCount(c => c + 1);

      const summaryContent = wasUpdatingExisting
        ? `${newSnapshot.versionTag} (+${stats.added} / -${stats.removed} lines) · ${
            result.selfFixedRuntime
              ? 'Live preview updated (compile + runtime verified, auto-fixed 1 runtime issue).'
              : 'Live preview updated (compile + runtime verified).'
          }`
        : result.explanation;

      const assistantMsg: ChatMessage = {
        id: `m_${now}_a`,
        role: 'assistant',
        kind: 'build',
        content: summaryContent,
        timestamp: now,
      };

      const finalMessages = [...nextMessages, assistantMsg];
      updateMessagesState(finalMessages);

      await persistWorkspaceSnapshot({
        name: nextName,
        code: result.code,
        vers: updatedVersions,
        msgs: finalMessages,
      });
      await offlineStorage.addSnapshot(newSnapshot);
    } catch (e: any) {
      const errMsg: ChatMessage = {
        id: `m_${Date.now()}_err`,
        role: 'assistant',
        kind: 'error',
        content: `Error: ${e?.message || 'Could not run local model.'}`,
        timestamp: Date.now(),
      };
      const finalMessages = [...nextMessages, errMsg];
      updateMessagesState(finalMessages);
      await persistWorkspaceSnapshot({ msgs: finalMessages });
    } finally {
      setIsGenerating(false);
      setStreamingStatus('');
    }
  };

  const handleStopGeneration = () => {
    stopPlanSequenceRef.current = true;
    aiEngine.abortActiveGeneration();
  };

  const handleTurnLastChatIntoPlan = async (reviewContent: string) => {
    if (isGenerating) return;
    await handleSendMessage(
      `Make a step-by-step plan to implement the key improvements and fixes we just discussed:\n${reviewContent.slice(0, 750)}`,
      'plan'
    );
  };

  const handleClearPlan = async () => {
    updatePlanState(null);
    await persistWorkspaceSnapshot({ plan: null });
  };

  const handleAskAIToFixError = () => {
    if (!effectiveError || isGenerating) return;
    handleSendMessage(
      `Please fix this error when running the code: ${effectiveError}`,
      'build'
    );
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

    await persistWorkspaceSnapshot({ code: newCode });
  };

  const handleRestoreVersion = async (version: VersionSnapshot) => {
    const now = Date.now();
    const prevCode = latestActiveCodeRef.current;
    const stats = calculateChangeStats(prevCode, version.code);
    const curVers = latestVersionsRef.current;
    const restoreSnapshot: VersionSnapshot = {
      id: `v_restore_${now}`,
      versionNumber: curVers.length + 1,
      versionTag: `v1.${curVers.length}`,
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
    const updatedVersions = [restoreSnapshot, ...curVers];
    updateVersionsState(updatedVersions);
    updateActiveCodeState(version.code);
    setPreviewCode(version.code);
    setLastRunError(null);
    setBottomTab('preview');
    updateRunCount(c => c + 1);

    await persistWorkspaceSnapshot({
      code: version.code,
      vers: updatedVersions,
    });
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
  const hasMeaningfulUserCode =
    activeCode.trim().length > 0 && activeCode.trim() !== DEFAULT_STARTER_CODE.trim();

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

      {/* Split-Screen Body: Top Half = Agentic AI Chat & Plan | Bottom Half = Preview, Undo/Run/Redo & Code Tabs */}
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className={isPreviewFullScreen ? 'hidden' : 'h-1/2 min-h-0 flex flex-col'}>
          <ChatWorkspace
            programName={projectName}
            activeModel={activeModel}
            activeModelDisplayName={activeModelDisplayName}
            messages={messages}
            activeDocsCount={activeDocsCount}
            hasActiveCode={hasMeaningfulUserCode || Boolean(activeCode.trim())}
            interactionMode={interactionMode}
            onChangeInteractionMode={setInteractionMode}
            activePlan={activePlan}
            onRunNextPlanStep={() => executePlanSteps('single')}
            onRunAllPlanSteps={() => executePlanSteps('all')}
            onClearPlan={handleClearPlan}
            onTurnLastChatIntoPlan={handleTurnLastChatIntoPlan}
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
