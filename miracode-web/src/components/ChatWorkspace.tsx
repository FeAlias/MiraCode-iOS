import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowUp,
  Loader2,
  Plus,
  BookOpen,
  Square,
  Sparkles,
  MessageSquare,
  ListChecks,
  Hammer,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Play,
  FastForward,
  X,
} from 'lucide-react';
import {
  LocalAIModel,
  AgentInteractionMode,
  AgentCodingPlan,
} from '../types/ai';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  kind?: 'chat' | 'plan' | 'build' | 'error';
}

interface ChatWorkspaceProps {
  programName: string;
  activeModel: LocalAIModel;
  activeModelDisplayName?: string;
  messages: ChatMessage[];
  activeDocsCount: number;
  hasActiveCode: boolean;
  interactionMode: AgentInteractionMode;
  onChangeInteractionMode: (mode: AgentInteractionMode) => void;
  activePlan: AgentCodingPlan | null;
  onRunNextPlanStep: () => Promise<void>;
  onRunAllPlanSteps: () => Promise<void>;
  onClearPlan: () => void;
  onTurnLastChatIntoPlan: (reviewContent: string) => Promise<void>;
  onSendMessage: (prompt: string, explicitMode?: AgentInteractionMode) => Promise<void>;
  onStopGeneration: () => void;
  onNewProgram: () => void;
  onOpenDocs: () => void;
  isGenerating: boolean;
  streamingStatus: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

const MODE_OPTIONS: Array<{
  id: AgentInteractionMode;
  label: string;
  Icon: React.FC<{ className?: string }>;
  hint: string;
}> = [
  {
    id: 'auto',
    label: 'Auto',
    Icon: Sparkles,
    hint: 'Ask, review code, plan, or build...',
  },
  {
    id: 'chat',
    label: 'Chat',
    Icon: MessageSquare,
    hint: 'Ask questions or review code (no edits)...',
  },
  {
    id: 'plan',
    label: 'Plan',
    Icon: ListChecks,
    hint: 'Describe what to break into steps...',
  },
  {
    id: 'build',
    label: 'Build',
    Icon: Hammer,
    hint: 'Describe code changes to apply...',
  },
];

export const ChatWorkspace: React.FC<ChatWorkspaceProps> = ({
  programName,
  activeModel,
  activeModelDisplayName,
  messages,
  activeDocsCount,
  hasActiveCode,
  interactionMode,
  onChangeInteractionMode,
  activePlan,
  onRunNextPlanStep,
  onRunAllPlanSteps,
  onClearPlan,
  onTurnLastChatIntoPlan,
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
  const activeModeMeta =
    MODE_OPTIONS.find(m => m.id === interactionMode) || MODE_OPTIONS[0];

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, activePlan, isGenerating, streamingStatus]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isGenerating) return;
    setInput('');
    await onSendMessage(trimmed, interactionMode);
  };

  const nextPendingStep = activePlan?.steps.find(s => s.status !== 'completed');
  const completedStepsCount =
    activePlan?.steps.filter(s => s.status === 'completed').length ?? 0;

  return (
    <section className="flex flex-col h-full min-h-0 bg-zinc-950 border-b border-zinc-800/90 overflow-x-hidden">
      {/* Subheader: Active Program & Model + Docs & New */}
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

      {/* Scrollable Chat Thread + Interactive Step Plan Card */}
      <div
        ref={scrollContainerRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3.5 py-2.5 flex flex-col gap-2.5"
      >
        {messages.length === 0 && !activePlan && !isGenerating ? (
          <div className="my-auto flex flex-col items-center justify-center text-center px-3 gap-2.5">
            <div>
              <p className="text-sm font-medium text-zinc-200">
                Pair-Program with {modelLabel}
              </p>
              <p className="text-xs text-zinc-500 mt-0.5 max-w-xs leading-relaxed">
                Chat &amp; review code, generate a step-by-step plan, and execute verified milestones one step at a time.
              </p>
            </div>

            {hasActiveCode && (
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    onSendMessage(
                      'Look over my current code — what do you think, and are there any bugs or improvements you recommend?',
                      'chat'
                    )
                  }
                  className="px-2.5 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] font-medium text-zinc-200 flex items-center gap-1.5 transition active:scale-95"
                >
                  <MessageSquare className="w-3 h-3 text-cyan-400" />
                  <span>Review Current Code</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChangeInteractionMode('plan');
                    inputRef.current?.focus();
                  }}
                  className="px-2.5 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] font-medium text-zinc-200 flex items-center gap-1.5 transition active:scale-95"
                >
                  <ListChecks className="w-3 h-3 text-cyan-400" />
                  <span>Make a Step Plan</span>
                </button>
              </div>
            )}
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
                    : msg.kind === 'error'
                      ? 'bg-rose-950/40 border border-rose-800/60 text-rose-200'
                      : 'bg-zinc-900/90 border border-zinc-800/80 text-zinc-200'
                }`}
              >
                <div>{msg.content}</div>

                {msg.role === 'assistant' && msg.kind === 'chat' && !isGenerating && (
                  <div className="mt-2 pt-2 border-t border-zinc-800/80 flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => onTurnLastChatIntoPlan(msg.content)}
                      className="px-2.5 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/35 text-[11px] font-medium text-cyan-300 flex items-center gap-1 transition active:scale-95"
                    >
                      <ListChecks className="w-3 h-3" />
                      <span>Make Step Plan from This</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {/* Structured Interactive Step-by-Step Plan Card */}
        {activePlan && (
          <div className="w-full rounded-2xl bg-zinc-900/95 border border-cyan-500/35 p-3 flex flex-col gap-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-cyan-300">
                  <ListChecks className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Implementation Plan ({completedStepsCount}/{activePlan.steps.length})
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 mt-0.5 leading-snug">
                  {activePlan.summary}
                </p>
              </div>
              {!isGenerating && (
                <button
                  type="button"
                  onClick={onClearPlan}
                  aria-label="Clear plan"
                  className="p-1 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              {activePlan.steps.map(step => {
                const isDone = step.status === 'completed';
                const isRunning = step.status === 'in_progress';
                const isFailed = step.status === 'failed';
                return (
                  <div
                    key={step.id}
                    className={`rounded-xl px-2.5 py-2 border text-xs flex items-start gap-2 ${
                      isRunning
                        ? 'bg-cyan-950/35 border-cyan-500/50 text-zinc-100'
                        : isDone
                          ? 'bg-emerald-950/20 border-emerald-800/40 text-zinc-300'
                          : isFailed
                            ? 'bg-amber-950/25 border-amber-700/50 text-amber-100'
                            : 'bg-zinc-950/60 border-zinc-800/80 text-zinc-300'
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {isRunning ? (
                        <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
                      ) : isDone ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      ) : isFailed ? (
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      ) : (
                        <Circle className="w-3.5 h-3.5 text-zinc-600" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium leading-snug">
                        Step {step.stepNumber}: {step.title}
                      </div>
                      {step.details && step.details !== step.title && (
                        <div className="text-[11px] text-zinc-400 mt-0.5 leading-snug">
                          {step.details}
                        </div>
                      )}
                      {isFailed && step.errorNote && (
                        <div className="text-[11px] text-amber-300 mt-1">
                          {step.errorNote}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {nextPendingStep ? (
              !isGenerating && (
                <div className="flex items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={onRunNextPlanStep}
                    className="flex-1 min-h-[34px] px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-semibold text-zinc-100 flex items-center justify-center gap-1.5 transition active:scale-95"
                  >
                    <Play className="w-3 h-3 text-cyan-400 fill-current shrink-0" />
                    <span>Run Step {nextPendingStep.stepNumber}</span>
                  </button>
                  <button
                    type="button"
                    onClick={onRunAllPlanSteps}
                    className="flex-1 min-h-[34px] px-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-xs font-semibold text-zinc-950 flex items-center justify-center gap-1.5 transition active:scale-95"
                  >
                    <FastForward className="w-3.5 h-3.5 fill-current shrink-0" />
                    <span>Run All Steps</span>
                  </button>
                </div>
              )
            ) : (
              <div className="text-[11px] font-medium text-emerald-400 flex items-center gap-1.5 pt-0.5">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>All planned steps implemented and verified!</span>
              </div>
            )}
          </div>
        )}

        {isGenerating && (
          <div className="flex justify-start w-full min-w-0">
            <div className="w-full max-w-[94%] min-w-0 rounded-2xl px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2 text-cyan-400 font-medium">
                <div className="flex items-center gap-2 min-w-0">
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span className="truncate">Working with {modelLabel}...</span>
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
                <div className="w-full min-w-0 font-mono text-[11px] leading-relaxed text-zinc-300 whitespace-pre-wrap break-words [overflow-wrap:anywhere] max-h-28 overflow-y-auto">
                  {streamingStatus}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Mode Selector Strip + Compact Chat Input Bar */}
      <div className="shrink-0 bg-zinc-950 border-t border-zinc-900 px-3 pt-1.5 pb-2 flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            {MODE_OPTIONS.map(({ id, label, Icon }) => {
              const active = interactionMode === id;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={isGenerating}
                  onClick={() => onChangeInteractionMode(id)}
                  className={`min-h-[26px] px-2.5 rounded-lg text-[11px] font-medium flex items-center gap-1 transition whitespace-nowrap ${
                    active
                      ? 'bg-cyan-500/20 border border-cyan-500/50 text-cyan-300'
                      : 'bg-zinc-900/80 border border-zinc-800/80 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Icon className="w-3 h-3 shrink-0" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>

          {hasActiveCode && !isGenerating && (
            <button
              type="button"
              onClick={() =>
                onSendMessage(
                  'Review my current code: what looks good, any bugs/edge cases, and what would you improve?',
                  'chat'
                )
              }
              className="min-h-[26px] px-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-zinc-300 whitespace-nowrap shrink-0 transition active:scale-95"
            >
              Review Code
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={isGenerating}
            placeholder={activeModeMeta.hint}
            className="flex-1 min-w-0 min-h-[40px] px-3.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500/80 transition"
          />
          {isGenerating ? (
            <button
              type="button"
              onClick={onStopGeneration}
              aria-label="Stop generation"
              className="min-h-[40px] min-w-[40px] rounded-xl bg-rose-500 hover:bg-rose-400 text-zinc-950 flex items-center justify-center transition active:scale-95 shrink-0"
            >
              <Square className="w-4 h-4 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              aria-label="Send prompt"
              className="min-h-[40px] min-w-[40px] rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-35 disabled:pointer-events-none text-zinc-950 flex items-center justify-center transition active:scale-95 shrink-0"
            >
              <ArrowUp className="w-4 h-4 stroke-[2.5]" />
            </button>
          )}
        </form>
      </div>
    </section>
  );
};
