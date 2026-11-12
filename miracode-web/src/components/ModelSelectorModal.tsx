import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Check,
  Cpu,
  Download,
  RefreshCw,
  Trash2,
  AlertTriangle,
  PowerOff,
  RotateCcw,
  FolderGit2,
  FileUp,
  Plus,
  BookOpen,
  HardDrive,
} from 'lucide-react';
import {
  LocalAIModel,
  WebGPUStatus,
  KnowledgeDoc,
} from '../types/ai';
import { VersionSnapshot } from '../types/project';
import { aiEngine, CONTEXT_WINDOW_OPTIONS } from '../services/aiEngine';
import { NativeStatusPayload, nativeBridge } from '../services/nativeBridge';

export type SettingsModalSection = 'models' | 'docs' | 'versions';

interface ModelSelectorModalProps {
  isOpen: boolean;
  initialSection?: SettingsModalSection;
  onClose: () => void;
  models: LocalAIModel[];
  activeModelId: string;
  loadedVramModelId: string | null;
  nativeStatus: NativeStatusPayload | null;
  isNativeApp: boolean;
  onSelectModel: (modelId: string) => void;
  onSelectNativeModel: (nativeModelId: string) => Promise<void>;
  onOpenModelsScreen: () => void;
  onUnloadVram: () => Promise<void>;
  contextWindow: number;
  onChangeContextWindow: (tokens: number) => void;
  ollamaUrl: string;
  onChangeOllamaUrl: (url: string) => void;
  versions: VersionSnapshot[];
  onRestoreVersion: (version: VersionSnapshot) => void;
  knowledgeDocs: KnowledgeDoc[];
  onUploadDocFiles: (files: FileList) => Promise<void>;
  onAddManualDoc: (title: string, content: string) => Promise<void>;
  onToggleDoc: (docId: string) => Promise<void>;
  onDeleteDoc: (docId: string) => Promise<void>;
  onOpenGitHub: () => void;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return 'Local GGUF';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export const ModelSelectorModal: React.FC<ModelSelectorModalProps> = ({
  isOpen,
  initialSection = 'models',
  onClose,
  models,
  activeModelId,
  nativeStatus,
  isNativeApp,
  onSelectModel,
  onSelectNativeModel,
  onOpenModelsScreen,
  onUnloadVram,
  contextWindow,
  onChangeContextWindow,
  ollamaUrl,
  onChangeOllamaUrl,
  versions,
  onRestoreVersion,
  knowledgeDocs,
  onUploadDocFiles,
  onAddManualDoc,
  onToggleDoc,
  onDeleteDoc,
  onOpenGitHub,
}) => {
  const [section, setSection] = useState<SettingsModalSection>(initialSection);
  const [mountingId, setMountingId] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [gpuStatus, setGpuStatus] = useState<WebGPUStatus | null>(null);

  const [isAddingPasteDoc, setIsAddingPasteDoc] = useState(false);
  const [docTitle, setDocTitle] = useState('');
  const [docContent, setDocContent] = useState('');
  const docFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSection(initialSection);
      aiEngine.detectWebGPU().then(setGpuStatus);
    }
  }, [isOpen, initialSection]);

  if (!isOpen) return null;

  const handleMountNativeModel = async (nativeModelId: string, modelName: string) => {
    setErrorMsg(null);
    setInfoMsg(null);
    setMountingId(nativeModelId);
    try {
      await onSelectNativeModel(nativeModelId);
      onSelectModel('native_metal_active');
      setInfoMsg(`${modelName} mounted in Apple Metal GPU and ready offline.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to mount GGUF model in Apple Metal.');
    } finally {
      setMountingId(null);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    try {
      await onUploadDocFiles(files);
      setInfoMsg(
        `Indexed ${files.length} documentation file${files.length > 1 ? 's' : ''} offline.`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not read documentation file.');
    } finally {
      e.target.value = '';
    }
  };

  const handleSaveManualDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docContent.trim()) return;
    await onAddManualDoc(docTitle.trim() || 'Custom Coding Notes', docContent);
    setDocTitle('');
    setDocContent('');
    setIsAddingPasteDoc(false);
  };

  const enabledDocsCount = knowledgeDocs.filter(d => d.enabled).length;
  const downloadedModels = nativeStatus?.downloadedModels || [];
  const activeNativeModel = nativeStatus?.activeModel;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-md p-0 sm:p-4">
      <div className="w-full max-w-lg max-h-[86dvh] bg-zinc-900 border border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden pb-safe">
        <div className="w-10 h-1.5 bg-zinc-700 rounded-full mx-auto my-2.5 sm:hidden" />

        {/* Header Tabs: Models | Docs | History */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 gap-2">
          <div className="flex items-center gap-1 p-1 bg-zinc-950 rounded-lg border border-zinc-800/80 overflow-x-auto">
            <button
              type="button"
              onClick={() => setSection('models')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition whitespace-nowrap ${
                section === 'models' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Models
            </button>
            <button
              type="button"
              onClick={() => setSection('docs')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition whitespace-nowrap ${
                section === 'docs' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Docs ({enabledDocsCount})
            </button>
            <button
              type="button"
              onClick={() => setSection('versions')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition whitespace-nowrap ${
                section === 'versions'
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              History ({versions.length})
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {section === 'models' ? (
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3.5">
            {gpuStatus && (
              <div className="flex items-center justify-between gap-2 text-xs text-zinc-400">
                <span className="truncate">{gpuStatus.details}</span>
                {activeNativeModel?.isLoaded && (
                  <button
                    type="button"
                    onClick={onUnloadVram}
                    className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-medium flex items-center gap-1 shrink-0"
                  >
                    <PowerOff className="w-3 h-3 text-rose-400" />
                    <span>Free RAM</span>
                  </button>
                )}
              </div>
            )}

            {infoMsg && (
              <div className="p-3 rounded-xl bg-cyan-950/40 border border-cyan-800/60 text-xs text-cyan-200 flex items-start justify-between gap-2">
                <span>{infoMsg}</span>
                <button
                  type="button"
                  onClick={() => setInfoMsg(null)}
                  className="text-cyan-400 hover:text-white shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-950/50 border border-rose-800/60 text-xs text-rose-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="break-words min-w-0 leading-relaxed">{errorMsg}</span>
              </div>
            )}

            {/* Native Apple Metal GGUF Engine Card */}
            <div className="p-4 rounded-2xl bg-zinc-950/80 border border-cyan-500/40 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center shrink-0 text-cyan-400">
                    <Cpu className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-zinc-100">
                      Native Apple Metal GGUF (3B / 7B+)
                    </h3>
                    <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                      Runs Qwen 2.5 Coder 3B, 7B, or any local .gguf model with Extended RAM directly on your iPhone GPU — 100% offline.
                    </p>
                  </div>
                </div>
              </div>

              {isNativeApp && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenModelsScreen();
                  }}
                  className="w-full min-h-[42px] px-3.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-zinc-950 text-xs font-semibold flex items-center justify-center gap-2 transition active:scale-[0.98]"
                >
                  <Download className="w-4 h-4" />
                  <span>Download 3B / 7B Models or Import .GGUF</span>
                </button>
              )}

              {/* Downloaded GGUF Models Quick Switcher */}
              {downloadedModels.length > 0 ? (
                <div className="space-y-1.5 pt-1">
                  <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                    Downloaded Models ({downloadedModels.length})
                  </p>
                  {downloadedModels.map(dm => {
                    const isMounting = mountingId === dm.id;
                    const isLoaded = dm.isLoaded || activeNativeModel?.id === dm.id;
                    return (
                      <div
                        key={dm.id}
                        className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 ${
                          isLoaded
                            ? 'bg-zinc-800/80 border-emerald-500/50'
                            : 'bg-zinc-900/70 border-zinc-800'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <HardDrive className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-zinc-100 truncate">
                              {dm.name}
                            </div>
                            <div className="text-[11px] font-mono text-zinc-500">
                              {formatBytes(dm.sizeBytes)}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={mountingId !== null || isLoaded}
                          onClick={() => handleMountNativeModel(dm.id, dm.name)}
                          className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold flex items-center gap-1 shrink-0 transition ${
                            isLoaded
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-zinc-800 hover:bg-zinc-700 text-cyan-300'
                          }`}
                        >
                          {isMounting ? (
                            <>
                              <RefreshCw className="w-3 h-3 animate-spin" />
                              <span>Loading</span>
                            </>
                          ) : isLoaded ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>Loaded</span>
                            </>
                          ) : (
                            <span>Load Metal</span>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[11px] text-amber-300/90 leading-relaxed">
                  No .gguf models downloaded yet. Tap the button above to download Qwen 2.5 Coder 3B (~2.1 GB) or 7B (~4.7 GB) once, or drop a .gguf file into Files → On My iPhone → MiraCode.
                </p>
              )}
            </div>

            {/* Engine Mode Selector (Native Metal vs Optional Local Ollama) */}
            {models.map(model => {
              const isSelected = model.id === activeModelId;
              return (
                <div
                  key={model.id}
                  className={`p-3.5 rounded-2xl border transition flex items-center justify-between gap-3 ${
                    isSelected
                      ? 'bg-zinc-800/70 border-cyan-500/70'
                      : 'bg-zinc-950/50 border-zinc-800/80'
                  }`}
                >
                  <div className="min-w-0">
                    <h4 className="text-xs font-semibold text-zinc-100 truncate">{model.name}</h4>
                    <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                      {model.description}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectModel(model.id);
                      if (model.id === 'native_metal_active' && nativeBridge.isRunningInNativeApp()) {
                        setInfoMsg('Using Native Apple Metal GGUF engine.');
                      }
                    }}
                    className={`min-h-[34px] px-3 rounded-xl text-xs font-semibold shrink-0 transition ${
                      isSelected
                        ? 'bg-cyan-500 text-zinc-950'
                        : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                    }`}
                  >
                    {isSelected ? 'Active' : 'Use'}
                  </button>
                </div>
              );
            })}

            {/* Context Window Preference */}
            <div className="pt-1 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-zinc-300">
                  Prompt Context Window
                </label>
                <span className="text-[11px] font-mono text-cyan-400 tabular-nums">
                  {contextWindow.toLocaleString()} tokens
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {CONTEXT_WINDOW_OPTIONS.map(opt => {
                  const isActive = contextWindow === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => onChangeContextWindow(opt)}
                      className={`min-h-[34px] px-2 rounded-xl text-xs font-medium border transition ${
                        isActive
                          ? 'bg-cyan-500/20 border-cyan-500/70 text-cyan-200 font-semibold'
                          : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {opt / 1024}K
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                Native Metal KV cache size can also be tuned in PocketPal&apos;s Model Settings (recommended: 4K–8K with Q8_0 KV cache on 7B models).
              </p>
            </div>

            {/* Optional Local Ollama URL */}
            {activeModelId === 'ollama_local' && (
              <div className="pt-1 space-y-1.5">
                <label className="text-xs font-medium text-zinc-400 block">
                  Local Ollama / MLX Endpoint
                </label>
                <input
                  type="text"
                  value={ollamaUrl}
                  onChange={e => onChangeOllamaUrl(e.target.value)}
                  placeholder="http://192.168.1.50:11434"
                  className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs font-mono text-zinc-200 focus:outline-none focus:border-cyan-500"
                />
              </div>
            )}

            {/* GitHub / ZIP Export */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenGitHub();
                }}
                className="w-full min-h-[42px] px-3 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-200 flex items-center justify-center gap-2 transition"
              >
                <FolderGit2 className="w-4 h-4 text-cyan-400" />
                <span>GitHub Sync &amp; ZIP Export</span>
              </button>
            </div>
          </div>
        ) : section === 'docs' ? (
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3.5">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-zinc-100">
                Offline Coding Knowledge Base
              </h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Upload reference docs, cheat sheets, or example files (.md, .txt, .tsx, .js, .json). Matching snippets are automatically injected into your local AI prompts offline.
              </p>
            </div>

            <input
              ref={docFileInputRef}
              type="file"
              multiple
              accept=".md,.txt,.json,.ts,.tsx,.js,.jsx,.html,.css,.yaml,.yml,.csv"
              onChange={handleFileChange}
              className="hidden"
            />

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => docFileInputRef.current?.click()}
                className="min-h-[42px] px-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-zinc-950 text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-95 whitespace-nowrap"
              >
                <FileUp className="w-4 h-4 shrink-0" />
                <span>Upload from Files</span>
              </button>

              <button
                type="button"
                onClick={() => setIsAddingPasteDoc(prev => !prev)}
                className="min-h-[42px] px-3 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-medium flex items-center justify-center gap-1.5 transition active:scale-95 whitespace-nowrap"
              >
                <Plus className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>Paste Notes</span>
              </button>
            </div>

            {isAddingPasteDoc && (
              <form
                onSubmit={handleSaveManualDoc}
                className="p-3.5 rounded-2xl bg-zinc-950/90 border border-zinc-800 space-y-2.5"
              >
                <input
                  type="text"
                  value={docTitle}
                  onChange={e => setDocTitle(e.target.value)}
                  placeholder="Title (e.g. React Hooks Cheat Sheet)"
                  className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
                />
                <textarea
                  value={docContent}
                  onChange={e => setDocContent(e.target.value)}
                  rows={5}
                  placeholder="Paste API docs, library syntax, or coding rules here..."
                  className="w-full p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500 resize-y"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsAddingPasteDoc(false)}
                    className="min-h-[36px] px-3 rounded-xl bg-zinc-800 text-xs text-zinc-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!docContent.trim()}
                    className="min-h-[36px] px-3.5 rounded-xl bg-cyan-500 disabled:opacity-40 text-zinc-950 text-xs font-semibold"
                  >
                    Save Doc Offline
                  </button>
                </div>
              </form>
            )}

            {knowledgeDocs.length === 0 ? (
              <div className="py-8 text-center space-y-2 border border-dashed border-zinc-800 rounded-2xl px-4">
                <BookOpen className="w-6 h-6 text-zinc-600 mx-auto" />
                <p className="text-xs text-zinc-400">
                  No documentation uploaded yet. Upload .md, .txt, or code reference files from your iPhone Files app.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {knowledgeDocs.map(doc => (
                  <div
                    key={doc.id}
                    className="p-3.5 rounded-2xl bg-zinc-950/60 border border-zinc-800 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-zinc-100 truncate">
                        {doc.title}
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-500 mt-1 tabular-nums">
                        <span>{doc.chunks.length} chunks</span>
                        <span aria-hidden="true">·</span>
                        <span>{Math.max(1, Math.round(doc.sizeBytes / 1024))} KB</span>
                        <span aria-hidden="true">·</span>
                        <span className={doc.enabled ? 'text-emerald-400' : 'text-zinc-500'}>
                          {doc.enabled ? 'Active' : 'Muted'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => onToggleDoc(doc.id)}
                        className={`min-h-[34px] px-2.5 rounded-xl text-xs font-medium transition ${
                          doc.enabled
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                            : 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {doc.enabled ? 'Enabled' : 'Enable'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteDoc(doc.id)}
                        className="min-h-[34px] min-w-[34px] rounded-xl bg-zinc-800/80 hover:bg-rose-950/60 text-zinc-400 hover:text-rose-300 flex items-center justify-center transition"
                        title="Remove document"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-2.5">
            {versions.length === 0 ? (
              <p className="text-xs text-zinc-500 text-center py-8">
                No saved version snapshots in this program yet.
              </p>
            ) : (
              versions.map(ver => (
                <div
                  key={ver.id}
                  className="p-3.5 rounded-2xl bg-zinc-950/60 border border-zinc-800 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono font-semibold text-cyan-400">
                        {ver.versionTag}
                      </span>
                      <span aria-hidden="true" className="text-zinc-600">·</span>
                      <span className="font-medium text-zinc-200 truncate">{ver.title}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-500 mt-1 tabular-nums">
                      <span className="text-emerald-400">+{ver.linesAdded || 0}</span>
                      <span className="text-rose-400">-{ver.linesRemoved || 0}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {new Date(ver.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onRestoreVersion(ver);
                      onClose();
                    }}
                    className="min-h-[36px] px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 flex items-center gap-1.5 shrink-0 transition"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Restore</span>
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
