import React from 'react';
import { Menu, Settings, Code2, Cpu, FolderCode, Loader2 } from 'lucide-react';
import { NativeStatusPayload } from '../services/nativeBridge';

interface TopBarProps {
  onOpenSidebar: () => void;
  onOpenNativeDrawer: () => void;
  onOpenSettings: () => void;
  onPressCode: () => void;
  isChatFocused: boolean;
  nativeStatus: NativeStatusPayload | null;
  isNativeApp: boolean;
}

export const TopBar: React.FC<TopBarProps> = ({
  onOpenSidebar,
  onOpenNativeDrawer,
  onOpenSettings,
  onPressCode,
  isChatFocused,
  nativeStatus,
  isNativeApp,
}) => {
  const activeModel = nativeStatus?.activeModel;
  const isLoading = Boolean(nativeStatus?.isContextLoading);
  const isLoaded = Boolean(activeModel?.isLoaded);

  const modelPillLabel = isLoading
    ? nativeStatus?.loadingModelName || 'Loading...'
    : isLoaded
      ? activeModel?.name || 'Metal Ready'
      : 'Load 3B/7B';

  return (
    <header className="shrink-0 z-30 w-full bg-zinc-950/95 backdrop-blur-md border-b border-zinc-800/80 px-2 py-1.5">
      <div className="max-w-5xl mx-auto flex items-center gap-1.5">
        {/* Native App Drawer (Models, Chat, Benchmark, Settings) */}
        {isNativeApp && (
          <button
            type="button"
            onClick={onOpenNativeDrawer}
            aria-label="Open PocketPal app navigation drawer"
            title="App Menu & Models"
            className="min-h-[42px] min-w-[42px] rounded-xl bg-zinc-900 hover:bg-zinc-800/90 border border-zinc-800 text-zinc-200 flex items-center justify-center shrink-0 transition active:scale-[0.98]"
          >
            <Menu className="w-4 h-4" />
          </button>
        )}

        {/* Left Programs Library Button -> Opens Saved Programs Sidebar */}
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Open saved programs sidebar"
          title="My Programs"
          className="min-h-[42px] min-w-[42px] rounded-xl bg-zinc-900 hover:bg-zinc-800/90 border border-zinc-800 text-cyan-400 flex items-center justify-center shrink-0 transition active:scale-[0.98]"
        >
          <FolderCode className="w-4 h-4" />
        </button>

        {/* Native Metal Model Pill */}
        <button
          type="button"
          onClick={onOpenSettings}
          title="Select or download 3B / 7B GGUF models"
          className={`flex-1 min-w-0 min-h-[42px] px-2.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition active:scale-[0.98] ${
            isLoaded
              ? 'bg-zinc-900 border-emerald-500/40 text-zinc-100'
              : isLoading
                ? 'bg-zinc-900 border-amber-500/40 text-amber-200'
                : 'bg-cyan-500/10 border-cyan-500/40 text-cyan-200'
          }`}
        >
          {isLoading ? (
            <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
          ) : (
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                isLoaded ? 'bg-emerald-400' : 'bg-cyan-400'
              }`}
            />
          )}
          <Cpu className="w-3.5 h-3.5 text-zinc-400 shrink-0 hidden sm:block" />
          <span className="truncate">{modelPillLabel}</span>
        </button>

        {/* Settings & Code Actions */}
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Settings, Docs, and Version History"
          className="min-h-[42px] px-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800/90 border border-zinc-800 text-zinc-200 text-xs font-medium flex items-center justify-center gap-1 shrink-0 transition active:scale-[0.98]"
        >
          <Settings className="w-4 h-4 text-zinc-400 shrink-0" />
          <span className="hidden xs:inline">Settings</span>
        </button>

        <button
          type="button"
          onClick={onPressCode}
          className={`min-h-[42px] px-2.5 rounded-xl border text-xs font-medium flex items-center justify-center gap-1 shrink-0 transition active:scale-[0.98] ${
            isChatFocused
              ? 'bg-zinc-800 border-zinc-700 text-white'
              : 'bg-zinc-900 hover:bg-zinc-800/90 border-zinc-800 text-zinc-300'
          }`}
        >
          <Code2 className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>Code</span>
        </button>
      </div>
    </header>
  );
};
