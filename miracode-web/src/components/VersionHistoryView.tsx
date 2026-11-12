import React, { useState } from 'react';
import { History, GitCommit, ArrowLeftRight, RotateCcw, Plus, Sparkles, Check, ChevronRight, Eye } from 'lucide-react';
import { VersionSnapshot, DiffLine } from '../types/project';
import { computeLineDiff } from '../services/diffService';

interface VersionHistoryViewProps {
  versions: VersionSnapshot[];
  activeCode: string;
  onRestoreVersion: (version: VersionSnapshot) => void;
  onCreateCheckpoint: () => void;
  onPreviewCode: (code: string) => void;
}

export const VersionHistoryView: React.FC<VersionHistoryViewProps> = ({
  versions,
  activeCode,
  onRestoreVersion,
  onCreateCheckpoint,
  onPreviewCode,
}) => {
  const [selectedVersionId, setSelectedVersionId] = useState<string>(
    versions[0]?.id || ''
  );
  const [showDiff, setShowDiff] = useState(false);

  const selectedVersion = versions.find(v => v.id === selectedVersionId) || versions[0];

  // Calculate line diff between selected version and current active code
  const diffLines: DiffLine[] = React.useMemo(() => {
    if (!selectedVersion) return [];
    return computeLineDiff(selectedVersion.code, activeCode);
  }, [selectedVersion, activeCode]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-4 space-y-4 pb-24">
      {/* Top Banner & Checkpoint Trigger */}
      <div className="flex items-center justify-between p-4 rounded-2xl bg-zinc-900/80 border border-zinc-800 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <History className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Version History & Snapshots</h2>
            <p className="text-xs text-zinc-400">{versions.length} checkpoints recorded</p>
          </div>
        </div>

        <button
          onClick={onCreateCheckpoint}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition active:scale-95 border border-zinc-700/80"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Save Checkpoint</span>
        </button>
      </div>

      {/* Snapshot List & Detail View */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Version List Timeline */}
        <div className="md:col-span-1 space-y-2 max-h-[600px] overflow-y-auto pr-1">
          {versions.map((ver, idx) => {
            const isSelected = ver.id === selectedVersion?.id;
            return (
              <div
                key={ver.id}
                onClick={() => setSelectedVersionId(ver.id)}
                className={`p-3 rounded-xl border text-left cursor-pointer transition active:scale-[0.99] ${
                  isSelected
                    ? 'bg-zinc-900 border-cyan-500/80 shadow-md shadow-cyan-950/30'
                    : 'bg-zinc-900/50 border-zinc-800/80 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-xs font-bold text-cyan-400">
                    {ver.versionTag || `v${versions.length - idx}.0`}
                  </span>
                  <span className="text-[10px] text-zinc-500 font-mono">
                    {new Date(ver.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                <h3 className="text-xs font-semibold text-zinc-200 line-clamp-1">{ver.title}</h3>
                
                <div className="flex items-center gap-2 mt-2 text-[10px] font-mono text-zinc-400">
                  <span className="text-emerald-400">+{ver.linesAdded || 0}</span>
                  <span className="text-rose-400">-{ver.linesRemoved || 0}</span>
                  <span className="text-zinc-600">·</span>
                  <span className="truncate">{ver.trigger}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Selected Version Detail & Diff */}
        <div className="md:col-span-2 p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-4">
          {selectedVersion ? (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-zinc-800">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-cyan-400 px-2 py-0.5 rounded bg-cyan-950/80 border border-cyan-800/40">
                      {selectedVersion.versionTag}
                    </span>
                    <h3 className="text-sm font-semibold text-zinc-100">{selectedVersion.title}</h3>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">{selectedVersion.summary}</p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowDiff(!showDiff)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-300 transition"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                    <span>{showDiff ? 'Code' : 'Diff'}</span>
                  </button>

                  <button
                    onClick={() => onRestoreVersion(selectedVersion)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-semibold text-xs transition active:scale-95 shadow-md shadow-cyan-500/20"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Restore</span>
                  </button>
                </div>
              </div>

              {/* Diff Viewer or Code View */}
              <div className="rounded-xl overflow-hidden border border-zinc-800 bg-zinc-950 max-h-[440px] overflow-y-auto font-mono text-xs">
                {showDiff ? (
                  <div className="p-2 space-y-0.5">
                    <div className="text-[10px] text-zinc-500 pb-2 border-b border-zinc-800/60 font-mono">
                      Comparing {selectedVersion.versionTag} with Current Active Code
                    </div>
                    {diffLines.slice(0, 150).map((line, i) => (
                      <div
                        key={i}
                        className={`flex gap-2 px-2 py-0.5 rounded ${
                          line.type === 'added'
                            ? 'bg-emerald-950/40 text-emerald-300 border-l-2 border-emerald-500'
                            : line.type === 'removed'
                            ? 'bg-rose-950/40 text-rose-300 border-l-2 border-rose-500'
                            : 'text-zinc-400'
                        }`}
                      >
                        <span className="w-4 select-none shrink-0 text-zinc-600">
                          {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                        </span>
                        <span className="whitespace-pre-wrap break-all">{line.content || ' '}</span>
                      </div>
                    ))}
                    {diffLines.length > 150 && (
                      <div className="text-center py-2 text-zinc-500 text-[11px]">
                        +{diffLines.length - 150} more lines
                      </div>
                    )}
                  </div>
                ) : (
                  <pre className="p-3 text-zinc-300 whitespace-pre overflow-x-auto leading-relaxed">
                    {selectedVersion.code}
                  </pre>
                )}
              </div>
            </>
          ) : (
            <p className="text-zinc-500 text-xs py-10 text-center">No version selected</p>
          )}
        </div>
      </div>
    </div>
  );
};
