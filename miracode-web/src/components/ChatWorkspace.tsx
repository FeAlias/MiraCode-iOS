import React, { useState, useRef, useEffect } from 'react';
import { ArrowUp, Loader2, Plus, BookOpen, Square } from 'lucide-react';
import { LocalAIModel } from '../types/ai';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface ChatWorkspaceProps {
  programName: string;
  activeModel: LocalAIModel;
  activeModelDisplayName?: string;
  messages: ChatMessage[];
  activeDocsCount: number;
  onSendMessage: (prompt: string) => Promise<void>;
  onStopGeneration: () => void;
  onNewProgram: () => void;
  onOpenDocs: () => void;
  isGenerating: boolean;
  streamingStatus: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

export const ChatWorkspace: React.FC<ChatWorkspaceProps> = ({
  programName,
  activeModel,
  activeModelDisplayName,
  messages,
  activeDocsCount,
  onSendMessage,
  onStopGeneration,
  onNewProgram,
  onOpenDocs,
  isGenerating,
  streamingStatus,
  inputRef,
}) => {
  const [input, setInput] = useState('');
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const modelLabel = activeModelDisplayName || activeModel.name;

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isGenerating, streamingStatus]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isGenerating) return;
    setInput('');
    await onSendMessage(trimmed);
  };

  return (
    <section className="flex flex-col h-full min-h-0 bg-zinc-950 border-b border-zinc-800/90 overflow-x-hidden">
      {/* Subtle Subheader: Active Program & Model + Docs Knowledge Base & New Actions */}
      <div className="shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-zinc-900 text-xs text-zinc-400 gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-zinc-200 font-medium truncate">{programName}</span>
          <span aria-hidden="true" className="text-zinc-600">·</span>
          <span className="text-zinc-500 truncate">{modelLabel}</span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!isGenerating && (
            <button
              type="button"
              onClick={onOpenDocs}
              className="min-h-[28px] px-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 flex items-center gap-1 transition active:scale-95 whitespace-nowrap"
              title="Upload coding documentation to offline AI knowledge base"
            >
              <BookOpen className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span>{activeDocsCount > 0 ? `Docs (${activeDocsCount})` : 'Docs'}</span>
            </button>
          )}
          {!isGenerating && (
            <button
              type="button"
              onClick={onNewProgram}
              className="min-h-[28px] px-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 flex items-center gap-1 transition active:scale-95 whitespace-nowrap"
              title="Start new blank program and clear old code"
            >
              <Plus className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span>New</span>
            </button>
          )}
        </div>
      </div>

      {/* Vertical Scrollable Chat Thread with Word Wrapping */}
      <div
        ref={scrollContainerRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3.5 py-3 flex flex-col gap-3"
      >
        {messages.length === 0 && !isGenerating ? (
          <div className="my-auto flex flex-col items-center justify-center text-center px-4">
            <p className="text-sm font-medium text-zinc-300">
              Chat with {modelLabel}
            </p>
            <p className="text-xs text-zinc-500 mt-1 max-w-xs leading-relaxed">
              Ask to write or update JavaScript, HTML, or React code offline. Upload coding docs via Docs above so the AI uses your exact reference notes.
            </p>
          </div>
        ) : (
          messages.map(msg => (
            <div
              key={msg.id}
              className={`flex w-full min-w-0 ${
                msg.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              <div
                className={`max-w-[92%] min-w-0 rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${
                  msg.role === 'user'
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'bg-zinc-900/90 border border-zinc-800/80 text-zinc-200'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))
        )}

        {isGenerating && (
          <div className="flex justify-start w-full min-w-0">
            <div className="w-full max-w-[94%] min-w-0 rounded-2xl px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2 text-cyan-400 font-medium">
                <div className="flex items-center gap-2 min-w-0">
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span className="truncate">Writing with {modelLabel}...</span>
                </div>
                <button
                  type="button"
                  onClick={onStopGeneration}
                  className="px-2 py-0.5 rounded-md bg-rose-500/20 border border-rose-500/40 text-rose-200 text-[11px] flex items-center gap-1 shrink-0"
                >
                  <Square className="w-2.5 h-2.5 fill-current" />
                  <span>Stop</span>
                </button>
              </div>
              {streamingStatus && (
                <div className="w-full min-w-0 font-mono text-[11px] leading-relaxed text-zinc-300 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                  {streamingStatus}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Compact Chat Input Bar */}
      <form
        onSubmit={handleSubmit}
        className="shrink-0 px-3 py-2 bg-zinc-950 border-t border-zinc-900 flex items-center gap-2"
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={isGenerating}
          placeholder={`Message ${modelLabel}...`}
          className="flex-1 min-w-0 min-h-[42px] px-3.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500/80 transition"
        />
        {isGenerating ? (
          <button
            type="button"
            onClick={onStopGeneration}
            aria-label="Stop generation"
            className="min-h-[42px] min-w-[42px] rounded-xl bg-rose-500 hover:bg-rose-400 text-zinc-950 flex items-center justify-center transition active:scale-95 shrink-0"
          >
            <Square className="w-4 h-4 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            aria-label="Send prompt"
            className="min-h-[42px] min-w-[42px] rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-35 disabled:pointer-events-none text-zinc-950 flex items-center justify-center transition active:scale-95 shrink-0"
          >
            <ArrowUp className="w-4 h-4 stroke-[2.5]" />
          </button>
        )}
      </form>
    </section>
  );
};
