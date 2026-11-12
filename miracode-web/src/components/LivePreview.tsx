import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Maximize2,
  Minimize2,
  Play,
  Eye,
  FileCode2,
  Copy,
  Check,
  Save,
  Undo2,
  Redo2,
  AlertCircle,
  Wrench,
} from 'lucide-react';
import { compilePreviewBundle } from '../services/previewCompiler';

// Expose offline React runtime for same-origin preview sandbox (Lucide icons loaded lazily on demand to save ~45 MB iOS RAM)
if (typeof window !== 'undefined') {
  const existing = (window as any).__AETHER_SANDBOX_RUNTIME__ || {};
  (window as any).__AETHER_SANDBOX_RUNTIME__ = {
    ...existing,
    React,
    createRoot,
  };
}

export type BottomAreaTab = 'preview' | 'code';

interface LivePreviewProps {
  previewCode: string;
  activeCode: string;
  onChangeActiveCode: (code: string) => void;
  onOpenSaveModal: () => void;
  runCount: number;
  activeTab: BottomAreaTab;
  onSelectTab: (tab: BottomAreaTab) => void;
  isFullScreen: boolean;
  onToggleFullScreen: () => void;
  onPressRun: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  hasPendingChanges: boolean;
  lastRunError: string | null;
  onReportRunError: (err: string | null) => void;
  onAskAIToFixError: () => void;
  isGenerating: boolean;
  suspendForGpuMount?: boolean;
}

export const LivePreview: React.FC<LivePreviewProps> = ({
  previewCode,
  activeCode,
  onChangeActiveCode,
  onOpenSaveModal,
  runCount,
  activeTab,
  onSelectTab,
  isFullScreen,
  onToggleFullScreen,
  onPressRun,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  hasPendingChanges,
  lastRunError,
  onReportRunError,
  onAskAIToFixError,
  isGenerating,
  suspendForGpuMount = false,
}) => {
  const [compiledFrame, setCompiledFrame] = useState<{ runId: number; html: string } | null>(
    null
  );
  const [isCompiling, setIsCompiling] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [lineHeights, setLineHeights] = useState<number[]>([]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);

  const codeLines = activeCode.length > 0 ? activeCode.split('\n') : [''];

  // Listen for runtime/render errors posted from the sandboxed preview iframe so the AI can see & fix them
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'AETHER_PREVIEW_ERROR' && typeof data.error === 'string') {
        onReportRunError(data.error);
      } else if (data.type === 'AETHER_PREVIEW_SUCCESS') {
        onReportRunError(null);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onReportRunError]);

  // Compile preview HTML offline every time Run is pressed (atomic { runId, html } prevents iOS WebKit srcDoc race)
  useEffect(() => {
    if (runCount === 0 || !previewCode.trim()) {
      setCompiledFrame(null);
      setIsCompiling(false);
      return;
    }

    let cancelled = false;
    setIsCompiling(true);

    (async () => {
      try {
        const res = await compilePreviewBundle(previewCode);

        // Lazy-load full lucide-react icon library ONLY if the user's code imports from lucide-react
        if (res.usesLucide && typeof window !== 'undefined') {
          const runtime = (window as any).__AETHER_SANDBOX_RUNTIME__;
          if (runtime && !runtime.LucideIcons) {
            const lucideMod = await import('lucide-react');
            runtime.LucideIcons = lucideMod;
          }
        }

        if (!cancelled) {
          setCompiledFrame({ runId: runCount, html: res.html });
          if (res.compileError) {
            onReportRunError(res.compileError);
          }
          setIsCompiling(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          const errMsg = err?.message || String(err);
          onReportRunError(`Compile Error: ${errMsg}`);
          setCompiledFrame({
            runId: runCount,
            html: `<html><body style="background:#09090b;color:#fca5a5;padding:16px;font-family:sans-serif;"><h3>Compile Error</h3><pre style="white-space:pre-wrap;word-break:break-word;">${errMsg}</pre></body></html>`,
          });
          setIsCompiling(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [previewCode, runCount, onReportRunError]);

  // Measure wrapped visual line heights so line numbers align 1:1 with wrapped lines on iPhone
  const measureLineHeights = () => {
    const mirror = mirrorRef.current;
    if (!mirror || activeTab !== 'code') return;
    const children = mirror.children;
    const heights: number[] = [];
    for (let i = 0; i < children.length; i++) {
      const h = (children[i] as HTMLElement).getBoundingClientRect().height;
      heights.push(h > 0 ? h : 20);
    }
    setLineHeights(heights);
  };

  useLayoutEffect(() => {
    measureLineHeights();
  }, [activeCode, activeTab, isFullScreen]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      measureLineHeights();
    });
    observer.observe(ta);
    return () => observer.disconnect();
  }, [activeTab]);

  const handleEditorScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current) {
      gutterRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        if (canRedo) onRedo();
      } else if (canUndo) {
        onUndo();
      }
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const updated = activeCode.substring(0, start) + '  ' + activeCode.substring(end);
      onChangeActiveCode(updated);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2;
        }
      });
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(activeCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  return (
    <section
      className={
        isFullScreen
          ? 'fixed inset-0 z-50 bg-zinc-950 flex flex-col pt-safe pb-safe'
          : 'relative flex-1 min-h-0 bg-zinc-950 flex flex-col overflow-hidden'
      }
    >
      {/* Middle Control Bar: [Preview | Code] — [Undo | Run | Redo] — [Save | FullScreen] */}
      <div className="shrink-0 flex items-center justify-between px-2 py-1.5 bg-zinc-950 border-b border-zinc-800/80 gap-1.5">
        {/* Left: Preview & Code Tabs */}
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-zinc-900 border border-zinc-800/90 shrink-0">
          <button
            type="button"
            onClick={() => onSelectTab('preview')}
            className={`min-h-[36px] px-2.5 rounded-md text-xs font-medium flex items-center gap-1 transition whitespace-nowrap ${
              activeTab === 'preview'
                ? 'bg-zinc-800 text-zinc-100 shadow-xs'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Eye className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span>Preview</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectTab('code')}
            className={`min-h-[36px] px-2.5 rounded-md text-xs font-medium flex items-center gap-1 transition whitespace-nowrap ${
              activeTab === 'code'
                ? 'bg-zinc-800 text-zinc-100 shadow-xs'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FileCode2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span>Code</span>
          </button>
        </div>

        {/* Center (Between Code Tab and Save Button): Undo | Run | Redo */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="Undo code change"
            title="Undo"
            className="min-h-[36px] min-w-[34px] px-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 disabled:opacity-35 disabled:pointer-events-none border border-zinc-800 text-zinc-200 flex items-center justify-center transition active:scale-95"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onPressRun}
            disabled={!activeCode.trim()}
            aria-label="Run code"
            title="Compile and run current code"
            className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-95 whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none ${
              hasPendingChanges
                ? 'bg-cyan-400 hover:bg-cyan-300 text-zinc-950 ring-2 ring-cyan-400/40'
                : 'bg-cyan-500 hover:bg-cyan-400 text-zinc-950'
            }`}
          >
            <Play className="w-3.5 h-3.5 fill-current shrink-0" />
            <span>Run</span>
          </button>

          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label="Redo code change"
            title="Redo"
            className="min-h-[36px] min-w-[34px] px-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 disabled:opacity-35 disabled:pointer-events-none border border-zinc-800 text-zinc-200 flex items-center justify-center transition active:scale-95"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right: Save & Full-Screen Toggle */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onOpenSaveModal}
            disabled={!activeCode.trim()}
            className="min-h-[36px] px-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 disabled:pointer-events-none border border-zinc-800 text-xs text-zinc-200 flex items-center gap-1 transition active:scale-95 whitespace-nowrap"
            title="Save program to Phone Files"
          >
            <Save className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span>Save</span>
          </button>

          <button
            type="button"
            onClick={onToggleFullScreen}
            aria-label={isFullScreen ? 'Exit full screen preview' : 'Full screen preview'}
            title={isFullScreen ? 'Back to half screen' : 'Full screen'}
            className="min-h-[36px] min-w-[34px] p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 flex items-center justify-center transition active:scale-95"
          >
            {isFullScreen ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Live Error Feedback Strip (Shared with Local AI so it can fix errors automatically) */}
      {lastRunError && (
        <div className="shrink-0 px-3 py-1.5 bg-rose-950/60 border-b border-rose-800/60 flex items-center justify-between gap-2 text-xs text-rose-200">
          <div className="flex items-center gap-1.5 min-w-0">
            <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span className="truncate">{lastRunError}</span>
          </div>
          {!isGenerating && (
            <button
              type="button"
              onClick={onAskAIToFixError}
              className="shrink-0 min-h-[28px] px-2.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-100 font-medium flex items-center gap-1 transition active:scale-95 whitespace-nowrap"
            >
              <Wrench className="w-3 h-3 text-rose-300" />
              <span>Fix with AI</span>
            </button>
          )}
        </div>
      )}

      {/* Tab 1: Live Rendered Preview */}
      <div
        className={
          activeTab === 'preview'
            ? 'flex-1 min-h-0 flex flex-col overflow-hidden'
            : 'hidden'
        }
      >
        {suspendForGpuMount ? (
          <div className="flex-1 flex items-center justify-center text-xs text-cyan-300 font-mono px-6 text-center">
            Freeing preview memory while mounting model into Apple GPU...
          </div>
        ) : runCount === 0 || !previewCode.trim() ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6 pb-safe">
            {activeCode.trim() ? (
              <button
                type="button"
                onClick={onPressRun}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-300 flex items-center gap-2 transition active:scale-95"
              >
                <Play className="w-3.5 h-3.5 text-cyan-400 fill-current" />
                <span>Tap Run to preview</span>
              </button>
            ) : (
              <p className="text-xs text-zinc-500">
                Write JavaScript, HTML, or React code, then tap Run in the middle bar.
              </p>
            )}
          </div>
        ) : isCompiling && (!compiledFrame || compiledFrame.runId !== runCount) ? (
          <div className="flex-1 flex items-center justify-center text-xs text-zinc-400 font-mono">
            Compiling offline bundle...
          </div>
        ) : compiledFrame ? (
          <iframe
            key={compiledFrame.runId}
            title="Live Code Preview"
            srcDoc={compiledFrame.html}
            sandbox="allow-scripts allow-modals allow-same-origin"
            className="w-full h-full flex-1 border-0 bg-zinc-950"
          />
        ) : null}
      </div>

      {/* Tab 2: Editable Code Area with Synchronized Line Numbers */}
      <div
        className={
          activeTab === 'code'
            ? 'relative flex-1 min-h-0 flex bg-zinc-950 overflow-hidden'
            : 'hidden'
        }
      >
        {/* Floating Copy Button in Code Editor Top-Right */}
        {activeCode.length > 0 && (
          <button
            type="button"
            onClick={handleCopyCode}
            className="absolute top-2 right-3 z-10 min-h-[28px] px-2.5 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-zinc-300 flex items-center gap-1 backdrop-blur-xs transition active:scale-95"
            title="Copy code"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3 text-zinc-400" />
                <span>Copy</span>
              </>
            )}
          </button>
        )}

        {/* Synchronized Line Numbers Gutter */}
        <div
          ref={gutterRef}
          aria-hidden="true"
          className="shrink-0 min-w-[40px] py-3 px-2 bg-zinc-950 border-r border-zinc-800/80 text-right font-mono text-xs leading-5 text-zinc-500 select-none overflow-hidden tabular-nums"
        >
          {codeLines.map((_, idx) => (
            <div
              key={idx}
              style={
                lineHeights[idx]
                  ? { height: `${lineHeights[idx]}px` }
                  : undefined
              }
              className="leading-5"
            >
              {idx + 1}
            </div>
          ))}
        </div>

        {/* Editable Native Textarea + Hidden Line-Wrap Height Mirror */}
        <div className="relative flex-1 min-w-0 h-full overflow-hidden">
          {/* Hidden Mirror for Exact Wrapped Line Height Calculation */}
          <div
            ref={mirrorRef}
            aria-hidden="true"
            className="absolute inset-x-0 top-0 invisible pointer-events-none py-3 px-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
          >
            {codeLines.map((line, idx) => (
              <div key={idx} className="min-h-[20px]">
                {line || '\u00A0'}
              </div>
            ))}
          </div>

          <textarea
            ref={textareaRef}
            value={activeCode}
            onChange={e => onChangeActiveCode(e.target.value)}
            onScroll={handleEditorScroll}
            onKeyDown={handleEditorKeyDown}
            wrap="soft"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            placeholder="// Type JS, HTML, or React TSX here or ask the local AI above..."
            aria-label="Editable source code"
            className="w-full h-full py-3 px-3 bg-transparent text-zinc-100 placeholder-zinc-600 font-mono text-xs leading-5 resize-none focus:outline-none whitespace-pre-wrap break-words [overflow-wrap:anywhere] overflow-y-auto overflow-x-hidden"
          />
        </div>
      </div>
    </section>
  );
};
