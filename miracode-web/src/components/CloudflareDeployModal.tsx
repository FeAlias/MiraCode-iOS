import React, { useEffect, useState } from 'react';
import { X, Cloud, CheckCircle2, WifiOff } from 'lucide-react';

interface CloudflareDeployModalProps {
  isOpen: boolean;
  onClose: () => void;
  downloadedModelsCount: number;
}

export const CloudflareDeployModal: React.FC<CloudflareDeployModalProps> = ({
  isOpen,
  onClose,
  downloadedModelsCount,
}) => {
  const [swReady, setSwReady] = useState(false);
  const [storagePersisted, setStoragePersisted] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      setSwReady(Boolean(navigator.serviceWorker.controller));
      navigator.serviceWorker.ready.then(() => setSwReady(true)).catch(() => {});
    }
    if (typeof navigator !== 'undefined' && navigator.storage?.persisted) {
      navigator.storage
        .persisted()
        .then(p => setStoragePersisted(p))
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-md p-0 sm:p-4">
      <div className="w-full max-w-lg max-h-[88dvh] bg-zinc-900 border border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden pb-safe">
        <div className="w-10 h-1.5 bg-zinc-700 rounded-full mx-auto my-2.5 sm:hidden" />

        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <Cloud className="w-5 h-5 text-cyan-400 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-zinc-100 truncate">
                Host on Cloudflare (Offline PWA)
              </h2>
              <p className="text-[11px] text-zinc-400 truncate">
                Permanent URL · Runs 100% offline on iPhone
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[36px] min-w-[36px] rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 flex items-center justify-center transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {/* Device Offline Readiness */}
          <div className="p-3.5 rounded-2xl bg-zinc-950/70 border border-zinc-800 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-zinc-100">
              <WifiOff className="w-4 h-4 text-cyan-400" />
              <span>Current Device Offline Status</span>
            </div>
            <div className="space-y-1 text-zinc-400">
              <div className="flex items-center justify-between">
                <span>Offline App Shell &amp; Compiler</span>
                <span className="font-mono text-emerald-400">
                  {swReady ? 'Cached' : 'Caching...'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Storage Eviction Protection</span>
                <span className="font-mono text-zinc-200">
                  {storagePersisted ? 'Persistent' : 'Standard PWA'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Downloaded Local AI Models</span>
                <span className="font-mono text-cyan-400">
                  {downloadedModelsCount} cached
                </span>
              </div>
            </div>
          </div>

          {/* Step 1: Sync to GitHub & Deploy on Cloudflare */}
          <div className="p-4 rounded-2xl bg-zinc-950/70 border border-zinc-800 space-y-2.5">
            <h3 className="font-semibold text-zinc-100">
              1. Deploy via GitHub → Cloudflare Workers &amp; Pages
            </h3>
            <p className="text-zinc-400 leading-relaxed">
              This project includes <span className="font-mono text-zinc-200">wrangler.jsonc</span> preconfigured with SPA routing (<span className="font-mono text-zinc-200">not_found_handling: &quot;single-page-application&quot;</span>) and PWA cache headers. Push or sync to your GitHub repo and Cloudflare will deploy automatically:
            </p>
            <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 font-mono text-[11px] text-zinc-300 space-y-1">
              <div>Build command: bun run build (or npm run build)</div>
              <div>Deploy command: npx wrangler deploy</div>
              <div>Output directory: dist</div>
              <div>Worker name: miracodev1 (in wrangler.jsonc)</div>
            </div>
          </div>

          {/* Step 2: Install on iPhone */}
          <div className="p-4 rounded-2xl bg-zinc-950/70 border border-zinc-800 space-y-2">
            <h3 className="font-semibold text-zinc-100">
              2. Install as an Offline App on iPhone
            </h3>
            <ol className="space-y-1.5 text-zinc-400 list-decimal list-inside leading-relaxed">
              <li>
                Open your live <span className="font-mono text-cyan-400">.workers.dev</span> or{' '}
                <span className="font-mono text-cyan-400">.pages.dev</span> URL in{' '}
                <strong className="text-zinc-200">iPhone Safari</strong>.
              </li>
              <li>
                Tap <strong className="text-zinc-200">Share</strong> →{' '}
                <strong className="text-zinc-200">Add to Home Screen</strong>.
              </li>
              <li>
                Launch the new Home Screen icon once on Wi-Fi and download{' '}
                <strong className="text-zinc-200">Qwen 2.5 Coder 3B</strong> in{' '}
                <strong className="text-zinc-200">Settings</strong>.
              </li>
            </ol>
          </div>

          {/* Critical iPhone Offline Tip */}
          <div className="p-3.5 rounded-2xl bg-zinc-950/70 border border-zinc-800 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <p className="text-zinc-300 leading-relaxed">
              <strong className="text-zinc-100">iPhone Offline Tip:</strong> iOS isolates storage between Safari tabs and Home Screen apps. Once the model finishes downloading inside the Home Screen app, AetherCode runs 100% offline—even in Airplane Mode.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
