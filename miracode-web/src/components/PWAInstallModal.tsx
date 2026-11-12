import React from 'react';
import { X, Share2, PlusSquare, Smartphone, CheckCircle, ShieldCheck } from 'lucide-react';

interface PWAInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
  isInstallable: boolean;
  isIOS: boolean;
  onInstall: () => Promise<boolean>;
}

export const PWAInstallModal: React.FC<PWAInstallModalProps> = ({
  isOpen,
  onClose,
  isInstallable,
  isIOS,
  onInstall,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-md p-0 sm:p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-t-[32px] sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden pb-safe">
        {/* Grab Handle */}
        <div className="w-12 h-1.5 bg-zinc-700 rounded-full mx-auto my-3 sm:hidden" />

        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 via-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs shadow-md">
              &lt;/&gt;
            </div>
            <div>
              <h2 className="text-base font-semibold text-zinc-100">Install AetherCode iOS</h2>
              <p className="text-xs text-zinc-400">Offline PWA on iPhone 17 Pro Max</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 space-y-4">
          {/* Quick Info Box */}
          <div className="p-3.5 rounded-2xl bg-zinc-950/70 border border-zinc-800 text-xs text-zinc-300 space-y-2">
            <div className="flex items-center gap-2 text-cyan-400 font-semibold">
              <ShieldCheck className="w-4 h-4" />
              <span>Full Standalone & Offline Support</span>
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Installing AetherCode as a PWA grants fullscreen viewport presence, zero browser address bars, hardware Neural Engine access, and offline code compilation.
            </p>
          </div>

          {/* iOS Safari Step-by-Step Guide */}
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-xl bg-zinc-950/40 border border-zinc-800/80">
              <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-cyan-400 shrink-0">
                <Share2 className="w-4 h-4" />
              </div>
              <div className="text-xs">
                <h4 className="font-semibold text-zinc-200">1. Tap the Share Button</h4>
                <p className="text-zinc-400 mt-0.5">In Safari's bottom toolbar, tap the square icon with an upward arrow.</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-xl bg-zinc-950/40 border border-zinc-800/80">
              <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-cyan-400 shrink-0">
                <PlusSquare className="w-4 h-4" />
              </div>
              <div className="text-xs">
                <h4 className="font-semibold text-zinc-200">2. Select "Add to Home Screen"</h4>
                <p className="text-zinc-400 mt-0.5">Scroll down the share sheet menu and select Add to Home Screen.</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-xl bg-zinc-950/40 border border-zinc-800/80">
              <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-emerald-400 shrink-0">
                <CheckCircle className="w-4 h-4" />
              </div>
              <div className="text-xs">
                <h4 className="font-semibold text-zinc-200">3. Tap "Add" to Launch</h4>
                <p className="text-zinc-400 mt-0.5">Confirm by tapping Add in the top right. AetherCode will appear on your iPhone screen.</p>
              </div>
            </div>
          </div>

          {/* Desktop/Chromium Direct Install Trigger if supported */}
          {isInstallable && (
            <button
              onClick={async () => {
                await onInstall();
                onClose();
              }}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold text-xs shadow-md shadow-cyan-500/20 active:scale-95 transition"
            >
              Direct Install to Device
            </button>
          )}

          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium text-xs transition"
          >
            Got It
          </button>
        </div>
      </div>
    </div>
  );
};
