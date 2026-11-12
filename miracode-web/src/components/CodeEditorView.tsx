import React, { useState, useEffect } from 'react';
import { Copy, Check, Play, RotateCcw, FileCode, CheckCircle2 } from 'lucide-react';

interface CodeEditorViewProps {
  code: string;
  onSaveCode: (newCode: string, title?: string) => void;
  onResetToDefault: () => void;
}

export const CodeEditorView: React.FC<CodeEditorViewProps> = ({
  code,
  onSaveCode,
  onResetToDefault,
}) => {
  const [editorText, setEditorText] = useState(code);
  const [copied, setCopied] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    setEditorText(code);
    setIsDirty(false);
  }, [code]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(editorText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditorText(e.target.value);
    setIsDirty(e.target.value !== code);
  };

  const handleApply = () => {
    onSaveCode(editorText, 'Manual Code Edit');
    setIsDirty(false);
  };

  const lineCount = editorText.split('\n').length;

  return (
    <div className="flex flex-col h-[calc(100dvh-125px)] bg-zinc-950 pb-2">
      {/* Top Controls */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/60 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <FileCode className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-mono font-medium text-zinc-300">src/App.tsx</span>
          <span className="text-[11px] font-mono text-zinc-500">({lineCount} lines)</span>
        </div>

        <div className="flex items-center gap-2">
          {isDirty && (
            <button
              onClick={handleApply}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs transition active:scale-95 shadow-md shadow-emerald-500/20"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>Apply & Run</span>
            </button>
          )}

          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-xs font-medium text-zinc-300 transition active:scale-95"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <button
            onClick={onResetToDefault}
            className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition"
            title="Reset to Starter Template"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Code Editor Body */}
      <div className="flex-1 flex overflow-hidden font-mono text-xs bg-zinc-950">
        {/* Line Numbers */}
        <div className="w-12 py-3 bg-zinc-950/80 border-r border-zinc-900 text-zinc-600 select-none text-right pr-3 shrink-0 overflow-hidden leading-5">
          {Array.from({ length: lineCount }).map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>

        {/* Textarea */}
        <textarea
          value={editorText}
          onChange={handleTextChange}
          spellCheck={false}
          className="flex-1 p-3 bg-transparent text-zinc-200 resize-none focus:outline-none overflow-auto font-mono leading-5 selection:bg-cyan-500/30 whitespace-pre"
        />
      </div>
    </div>
  );
};
