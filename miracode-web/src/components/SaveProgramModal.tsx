import React, { useState, useEffect } from 'react';
import { X, Share, Download, BookmarkCheck } from 'lucide-react';
import {
  saveProgramToPhoneFiles,
  downloadProgramDirectly,
  toSafeFileName,
} from '../services/phoneFileService';

interface SaveProgramModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialName: string;
  code: string;
  onSaveToLibrary: (name: string) => Promise<void>;
}

export const SaveProgramModal: React.FC<SaveProgramModalProps> = ({
  isOpen,
  onClose,
  initialName,
  code,
  onSaveToLibrary,
}) => {
  const [name, setName] = useState(initialName || 'My Program');
  const [statusNote, setStatusNote] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName(initialName || 'My Program');
      setStatusNote(null);
    }
  }, [isOpen, initialName]);

  if (!isOpen) return null;

  const finalName = name.trim() || 'My Program';
  const previewFileName = toSafeFileName(finalName, 'tsx');

  const handleSaveToPhone = async () => {
    await onSaveToLibrary(finalName);
    const result = await saveProgramToPhoneFiles(finalName, code);
    if (result !== 'cancelled') {
      onClose();
    } else {
      setStatusNote('Saved to My Programs sidebar.');
    }
  };

  const handleDirectDownload = async () => {
    await onSaveToLibrary(finalName);
    downloadProgramDirectly(finalName, code);
    onClose();
  };

  const handleSaveSidebarOnly = async () => {
    await onSaveToLibrary(finalName);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-md p-0 sm:p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden pb-safe">
        <div className="w-10 h-1.5 bg-zinc-700 rounded-full mx-auto my-2.5 sm:hidden" />

        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-100">Save Program</h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[36px] min-w-[36px] rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 flex items-center justify-center transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300 block">
              Program Name
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Hello World"
              className="w-full min-h-[42px] px-3.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
            />
            <p className="text-[11px] font-mono text-zinc-500">
              File: {previewFileName}
            </p>
          </div>

          {statusNote && (
            <p className="text-xs text-emerald-400 font-medium">{statusNote}</p>
          )}

          <div className="space-y-2 pt-1">
            {/* Primary iOS Action: Native Share Sheet -> Save to Files */}
            <button
              type="button"
              onClick={handleSaveToPhone}
              disabled={!code.trim()}
              className="w-full min-h-[44px] px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-zinc-950 text-xs font-semibold flex items-center justify-center gap-2 transition active:scale-[0.98]"
            >
              <Share className="w-4 h-4" />
              <span>Save to Phone Files ({previewFileName})</span>
            </button>

            {/* Secondary: Direct Browser Download -> Downloads Folder */}
            <button
              type="button"
              onClick={handleDirectDownload}
              disabled={!code.trim()}
              className="w-full min-h-[42px] px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-100 text-xs font-medium flex items-center justify-center gap-2 transition active:scale-[0.98]"
            >
              <Download className="w-4 h-4 text-cyan-400" />
              <span>Download to Downloads Folder</span>
            </button>

            {/* Save in Sidebar Only */}
            <button
              type="button"
              onClick={handleSaveSidebarOnly}
              className="w-full min-h-[42px] px-4 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-xs font-medium flex items-center justify-center gap-2 transition active:scale-[0.98]"
            >
              <BookmarkCheck className="w-4 h-4 text-emerald-400" />
              <span>Save in Sidebar Only</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
