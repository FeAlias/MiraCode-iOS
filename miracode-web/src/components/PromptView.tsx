import React, { useState } from 'react';
import { Send, Sparkles, Cpu, Clock, Check, ArrowRight, Eye, Code, Zap } from 'lucide-react';
import { LocalAIModel, GenerationResult } from '../types/ai';

interface PromptViewProps {
  activeModel: LocalAIModel;
  onGenerate: (prompt: string) => Promise<GenerationResult | null>;
  isGenerating: boolean;
  streamingToken: string;
  lastResult: GenerationResult | null;
  onNavigateToPreview: () => void;
  onNavigateToHistory: () => void;
}

export const PromptView: React.FC<PromptViewProps> = ({
  activeModel,
  onGenerate,
  isGenerating,
  streamingToken,
  lastResult,
  onNavigateToPreview,
  onNavigateToHistory,
}) => {
  const [prompt, setPrompt] = useState('');

  const quickPrompts = [
    { label: '📊 Telemetry Chart', text: 'Add interactive performance charts with time range selectors and peak throughput meters' },
    { label: '⏱️ Split Chronometer', text: 'Convert this into a high-precision stopwatch timer with split lap records and start/pause controls' },
    { label: '✅ Task Manager', text: 'Create an offline project sprint checklist with priority tags, add/delete, and completion counters' },
    { label: '🪙 Crypto Portfolio', text: 'Build a cryptocurrency portfolio dashboard with live price ticker, 24h gainers, and asset breakdown' },
    { label: '☀️ Weather Forecast', text: 'Add a clean Cupertino local weather forecast card with humidity, wind speed, and high/low temps' },
    { label: '🎨 Emerald Accent', text: 'Change primary theme accents to vibrant emerald green with soft glow effects' },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isGenerating) return;
    const currentPrompt = prompt;
    setPrompt('');
    await onGenerate(currentPrompt);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-4 pb-24">
      {/* Model Spec Banner */}
      <div className="p-4 rounded-2xl bg-zinc-900/80 border border-zinc-800 backdrop-blur-xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Cpu className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-zinc-100">{activeModel.name}</h2>
              <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/80 px-1.5 py-0.5 rounded border border-cyan-800/40">
                Local
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">{activeModel.parameters} · {activeModel.sizeOnDisk}</p>
          </div>
        </div>
      </div>

      {/* Main Input Form */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="relative rounded-2xl bg-zinc-900 border border-zinc-800 focus-within:border-cyan-500/80 focus-within:ring-1 focus-within:ring-cyan-500/50 transition p-3">
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            disabled={isGenerating}
            placeholder="Describe what you want the local AI to build or update (e.g., 'Add a split stopwatch timer' or 'Create a crypto tracker')..."
            rows={4}
            className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none resize-none leading-relaxed"
          />

          <div className="flex items-center justify-between pt-2 border-t border-zinc-800/80 mt-2">
            <span className="text-[11px] text-zinc-500 flex items-center gap-1">
              <Zap className="w-3 h-3 text-cyan-400" />
              <span>React 19 + TypeScript + Tailwind</span>
            </span>

            <button
              type="submit"
              disabled={!prompt.trim() || isGenerating}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-40 disabled:pointer-events-none text-white font-medium text-xs shadow-md shadow-cyan-500/20 active:scale-95 transition"
            >
              {isGenerating ? (
                <>
                  <Sparkles className="w-3.5 h-3.5 animate-spin" />
                  <span>Synthesizing...</span>
                </>
              ) : (
                <>
                  <span>Generate</span>
                  <Send className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Live Generation Token Stream Overlay */}
      {isGenerating && (
        <div className="p-4 rounded-2xl bg-zinc-900/90 border border-cyan-800/50 shadow-lg shadow-cyan-950/40 space-y-2 animate-pulse">
          <div className="flex items-center justify-between text-xs text-cyan-400">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 animate-spin text-cyan-400" />
              <span className="font-semibold">Local Neural Inference in Progress...</span>
            </div>
            <span className="font-mono text-[10px] text-zinc-400">A19 Pro Neural Cores</span>
          </div>
          <div className="p-2.5 rounded-xl bg-zinc-950/80 font-mono text-xs text-zinc-300 max-h-24 overflow-hidden">
            {streamingToken || 'Synthesizing React component state and Tailwind utilities...'}
          </div>
        </div>
      )}

      {/* Last Result Card */}
      {lastResult && !isGenerating && (
        <div className="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
              <Check className="w-4 h-4" />
              <span>Snapshot Created: {lastResult.versionTitle}</span>
            </div>
            <span className="text-[11px] font-mono text-zinc-500">
              {lastResult.durationMs}ms
            </span>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            {lastResult.explanation}
          </p>
          <div className="flex gap-2 pt-1">
            <button
              onClick={onNavigateToPreview}
              className="flex-1 py-2 px-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-semibold text-xs flex items-center justify-center gap-1.5 transition active:scale-95 shadow-md shadow-cyan-500/20"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>View in Live Preview</span>
            </button>
            <button
              onClick={onNavigateToHistory}
              className="py-2 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex items-center justify-center gap-1.5 transition active:scale-95"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>View Diff</span>
            </button>
          </div>
        </div>
      )}

      {/* Suggested Quick Prompt Recipes */}
      <div className="space-y-2 pt-2">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider px-1">
          Quick Inspirations
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {quickPrompts.map((qp, i) => (
            <button
              key={i}
              onClick={() => setPrompt(qp.text)}
              className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/80 hover:border-zinc-700 text-left transition group active:scale-[0.99]"
            >
              <div className="text-xs font-medium text-zinc-200 group-hover:text-cyan-400 transition-colors">
                {qp.label}
              </div>
              <div className="text-[11px] text-zinc-500 line-clamp-1 mt-0.5">
                {qp.text}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
