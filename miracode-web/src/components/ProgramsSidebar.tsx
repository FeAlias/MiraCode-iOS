import React, { useRef } from 'react';
import { X, Plus, FileCode2, Share, Trash2, FolderOpen } from 'lucide-react';
import { CodeProject } from '../types/project';
import { saveProgramToPhoneFiles } from '../services/phoneFileService';

interface ProgramsSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  projects: CodeProject[];
  currentProjectId: string;
  onSelectProject: (project: CodeProject) => void;
  onNewProgram: () => void;
  onDeleteProject: (projectId: string) => void;
  onImportFromPhoneFile: (name: string, code: string) => void;
}

export const ProgramsSidebar: React.FC<ProgramsSidebarProps> = ({
  isOpen,
  onClose,
  projects,
  currentProjectId,
  onSelectProject,
  onNewProgram,
  onDeleteProject,
  onImportFromPhoneFile,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const sortedProjects = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const baseName = file.name.replace(/\.(tsx|ts|jsx|js|txt)$/i, '') || 'Imported Program';
      onImportFromPhoneFile(baseName, text);
      onClose();
    } catch (err) {
      console.warn('File import failed:', err);
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-xs"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Left Slide-Over Sidebar */}
      <aside className="relative z-10 w-[84vw] max-w-xs h-full bg-zinc-900 border-r border-zinc-800 flex flex-col pt-safe pb-safe shadow-2xl">
        {/* Sidebar Header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-zinc-100">My Programs</h2>
            <p className="text-[11px] text-zinc-400">
              {sortedProjects.length} {sortedProjects.length === 1 ? 'program' : 'programs'} saved
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                onNewProgram();
                onClose();
              }}
              className="min-h-[36px] px-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-zinc-950 text-xs font-semibold flex items-center gap-1 transition active:scale-95"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>New</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close sidebar"
              className="min-h-[36px] min-w-[36px] rounded-xl hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 flex items-center justify-center transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Programs List */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
          {sortedProjects.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4 py-10">
              <FileCode2 className="w-8 h-8 text-zinc-600 mb-2" />
              <p className="text-xs font-medium text-zinc-300">No programs saved yet</p>
              <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
                Ask the local AI to write a program or tap Save to store programs here.
              </p>
            </div>
          ) : (
            sortedProjects.map(proj => {
              const isActive = proj.id === currentProjectId;
              const lineCount = proj.activeCode ? proj.activeCode.split('\n').length : 0;

              return (
                <div
                  key={proj.id}
                  onClick={() => {
                    onSelectProject(proj);
                    onClose();
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      onSelectProject(proj);
                      onClose();
                    }
                  }}
                  className={`w-full p-3 rounded-2xl border text-left transition flex items-center justify-between gap-2 cursor-pointer ${
                    isActive
                      ? 'bg-zinc-800/90 border-cyan-500/70'
                      : 'bg-zinc-950/60 border-zinc-800/80 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    <div className="w-8 h-8 rounded-xl bg-zinc-800 flex items-center justify-center text-cyan-400 shrink-0 mt-0.5">
                      <FileCode2 className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-xs font-semibold text-zinc-100 truncate">
                        {proj.name}
                      </h3>
                      <div className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-500 mt-0.5">
                        <span>{lineCount} lines</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {new Date(proj.updatedAt).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Quick Export to Phone Files & Delete */}
                  <div
                    className="flex items-center gap-1 shrink-0"
                    onClick={e => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (proj.activeCode.trim()) {
                          saveProgramToPhoneFiles(proj.name, proj.activeCode);
                        }
                      }}
                      title="Save to Phone Files"
                      aria-label={`Save ${proj.name} to Phone Files`}
                      className="min-h-[34px] min-w-[34px] rounded-lg hover:bg-zinc-700/70 text-zinc-400 hover:text-cyan-300 flex items-center justify-center transition"
                    >
                      <Share className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteProject(proj.id)}
                      title="Delete program"
                      aria-label={`Delete ${proj.name}`}
                      className="min-h-[34px] min-w-[34px] rounded-lg hover:bg-rose-950/70 text-zinc-500 hover:text-rose-300 flex items-center justify-center transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Sidebar Footer: Import .tsx / .ts / .js from iPhone Files */}
        <div className="shrink-0 p-3 border-t border-zinc-800">
          <input
            ref={fileInputRef}
            type="file"
            accept=".tsx,.ts,.jsx,.js,.txt"
            onChange={handleFileImport}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full min-h-[42px] px-3 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-200 flex items-center justify-center gap-2 transition active:scale-[0.98]"
          >
            <FolderOpen className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>Open File from Phone</span>
          </button>
        </div>
      </aside>
    </div>
  );
};
