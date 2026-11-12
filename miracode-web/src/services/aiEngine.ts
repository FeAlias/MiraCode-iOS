import {
  LocalAIModel,
  PromptGenerationRequest,
  GenerationResult,
  CrashRecoveryInfo,
  WebGPUStatus,
  ShardDownloadStatus,
} from '../types/ai';
import {
  validateCodeSyntax,
  tryRepairTruncatedDelimiters,
} from './previewCompiler';
import { nativeBridge } from './nativeBridge';

export const DEFAULT_MODEL_ID = 'native_metal_active';
export const DEFAULT_CONTEXT_WINDOW = 8192;
export const CONTEXT_WINDOW_OPTIONS = [4096, 6144, 8192, 12288] as const;

const MINIMALIST_SYSTEM_PROMPT = [
  'You are Qwen Coder, an expert React (TypeScript/JSX), JavaScript, HTML, and Tailwind CSS programmer.',
  'Follow these rules strictly:',
  '1. ALWAYS output ONE complete, runnable code block starting IMMEDIATELY with ```tsx (or ```html / ```js if requested) and ending with ```. Never reply with prose outlines instead of code, and NEVER abbreviate with `// ... existing code` placeholders.',
  '2. When Current Code is provided, modify it to apply the Latest User Update while keeping ALL existing working features and previous updates intact unless asked to change or remove them.',
  '3. Always pair explicit contrasting background and text colors (e.g. `bg-zinc-950 text-zinc-100` or `bg-white text-zinc-900`) so text is never invisible.',
  '4. Mobile layout: fit a phone screen cleanly (`min-h-full p-3 flex flex-col items-center`, never clip with `overflow-hidden`). Keep game boards/canvases compact (~220px–260px) so the board, score, and buttons all fit onscreen.',
  '5. Game loops & phone controls: ALWAYS include large on-screen touch buttons (Up, Down, Left, Right, Restart) for games. Inside `setInterval` or `requestAnimationFrame`, read live direction/game state from `useRef` (e.g. `dirRef.current`) instead of stale `useState` closures so touch buttons steer immediately.',
].join('\n');

export const AVAILABLE_MODELS: LocalAIModel[] = [
  {
    id: 'native_metal_active',
    name: 'Apple Metal GGUF (3B / 7B+)',
    provider: 'metal',
    type: 'native_metal',
    description:
      'Runs Qwen 2.5 Coder 3B, 7B, or any .gguf model natively on Apple Metal GPU with Extended RAM — 100% offline.',
    parameters: '3B / 7B+ GGUF (Q4_K_M)',
    sizeOnDisk: 'Managed in Models',
    iosMemoryTier: 'safe',
    isAvailableOffline: true,
    isDownloaded: true,
    recommendedDevice: 'iPhone 17 Pro Max (12 GB)',
    contextWindow: 8192,
  },
  {
    id: 'ollama_local',
    name: 'Local Ollama / MLX Node',
    provider: 'ollama',
    type: 'ollama_local',
    description:
      'Optional Wi-Fi connection to an Ollama or Apple MLX server on your Mac/PC.',
    parameters: 'Custom (7B / 14B / 32B)',
    sizeOnDisk: 'Network Endpoint',
    vramMB: 0,
    iosMemoryTier: 'safe',
    isAvailableOffline: true,
    isDownloaded: true,
    recommendedDevice: 'Local Network / Mac / PC',
    contextWindow: 32768,
  },
];

export class AIEngine {
  private customOllamaUrl = 'http://localhost:11434';
  private preferredContextWindow: number = DEFAULT_CONTEXT_WINDOW;
  private activeAbortFn: (() => void) | null = null;
  private isAbortRequested = false;

  setOllamaUrl(url: string) {
    this.customOllamaUrl = url;
  }

  getOllamaUrl(): string {
    return this.customOllamaUrl;
  }

  setPreferredContextWindow(tokens: number) {
    const clamped = Math.max(2048, Math.min(16384, Math.round(tokens)));
    this.preferredContextWindow = clamped;
  }

  getPreferredContextWindow(): number {
    return this.preferredContextWindow;
  }

  getMountedContextWindow(): number | null {
    return nativeBridge.getLatestStatus()?.contextWindow ?? this.preferredContextWindow;
  }

  getLoadedModelId(): string | null {
    const status = nativeBridge.getLatestStatus();
    return status?.activeModel?.isLoaded ? 'native_metal_active' : null;
  }

  abortActiveGeneration() {
    this.isAbortRequested = true;
    try {
      this.activeAbortFn?.();
    } catch {}
    nativeBridge.abortAllGenerations();
  }

  cancelActiveDownload() {
    // Managed natively in PocketPal Models screen
  }

  isIOSDevice(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent.toLowerCase();
    return (
      /iphone|ipad|ipod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
  }

  checkAndClearCrashSentinel(): CrashRecoveryInfo | null {
    return null;
  }

  async detectWebGPU(): Promise<WebGPUStatus> {
    const status = nativeBridge.getLatestStatus();
    if (nativeBridge.isRunningInNativeApp()) {
      const ramLabel = status?.totalRamGB ? `${status.totalRamGB.toFixed(1)} GB RAM` : 'Apple Silicon';
      const activeName = status?.activeModel?.isLoaded
        ? `Metal Active: ${status.activeModel.name}`
        : 'Apple Metal Engine Ready (Tap Models to load a 3B or 7B GGUF)';
      return {
        supported: true,
        isIOS: true,
        maxBufferMB: status?.totalRamGB ? Math.round(status.totalRamGB * 680) : 7168,
        details: `${activeName} · ${ramLabel}`,
      };
    }

    return {
      supported: false,
      isIOS: this.isIOSDevice(),
      maxBufferMB: 0,
      details: 'Native Apple Metal bridge active inside iOS app shell',
    };
  }

  async getModelShardProgress(_modelId: string): Promise<ShardDownloadStatus | null> {
    return null;
  }

  async getAllModelsShardProgress(): Promise<Record<string, ShardDownloadStatus>> {
    return {};
  }

  async downloadModelShards(
    _modelId: string,
    _opts: { mode: 'next_part' | 'all'; onProgress?: (pct: number, statusText: string) => void }
  ): Promise<ShardDownloadStatus> {
    if (nativeBridge.isRunningInNativeApp()) {
      nativeBridge.openModelsScreen();
    }
    return {
      cachedShards: 1,
      totalShards: 1,
      completedParts: 1,
      totalParts: 1,
      isComplete: true,
    };
  }

  async unloadEngine(): Promise<void> {
    if (nativeBridge.isRunningInNativeApp()) {
      nativeBridge.unloadNativeModel();
    }
  }

  async deleteCachedModel(_modelId: string): Promise<void> {
    if (nativeBridge.isRunningInNativeApp()) {
      nativeBridge.openModelsScreen();
    }
  }

  async downloadAndLoadModel(
    modelId: string,
    onProgress?: (progressPct: number, statusText: string) => void
  ): Promise<void> {
    if (!nativeBridge.isRunningInNativeApp()) return;
    if (modelId === 'native_metal_active') {
      const status = nativeBridge.getLatestStatus();
      if (status?.activeModel?.isLoaded) return;
      const firstDownloaded = status?.downloadedModels?.[0];
      if (firstDownloaded) {
        onProgress?.(40, `Mounting ${firstDownloaded.name} into Apple Metal...`);
        await nativeBridge.selectNativeModel(firstDownloaded.id);
        onProgress?.(100, `${firstDownloaded.name} loaded.`);
      } else {
        nativeBridge.openModelsScreen();
      }
      return;
    }
    onProgress?.(30, 'Mounting GGUF model into Apple Metal...');
    await nativeBridge.selectNativeModel(modelId);
    onProgress?.(100, 'Model mounted.');
  }

  private shouldIncludeCurrentCode(
    prompt: string,
    currentCode: string,
    lastRuntimeError?: string | null
  ): boolean {
    if (!currentCode || currentCode.trim().length === 0) {
      return false;
    }

    if (lastRuntimeError && lastRuntimeError.trim().length > 0) {
      return true;
    }

    const p = prompt.trim();
    const hasFollowUpCue =
      /\b(add|put|include|insert|give|change|modify|update|edit|fix|bug|error|broken|crash|refactor|remove|delete|replace|keep|adjust|rename|move|show|hide|turn|increase|decrease|faster|slower|speed|score|sound|button|header|footer|title|border|background|color|font|shadow|rounded|padding|margin|bigger|smaller|wider|taller|center|align|dark|light|also|now|next|instead|another|more|less|around\s+the|to\s+it|in\s+it|to\s+the|in\s+the\s+code|make\s+it|make\s+the)\b/i.test(
        p
      );

    if (hasFollowUpCue) {
      return true;
    }

    const isUnrelatedStandaloneApp =
      /^(?:please\s+)?(?:can\s+you\s+)?(?:write|create|build|make|generate|code|implement)\s+(?:me\s+)?(?:the\s+)?(?:some\s+)?(?:code\s+for\s+)?(?:a|an)\s+(?:new\s+)?(?:[\w-]+\s+){0,3}(?:game|app|program|calculator|website|webpage|dashboard|stopwatch|quiz)\b/i.test(
        p
      );

    if (isUnrelatedStandaloneApp) {
      return false;
    }

    return true;
  }

  private clipCodePreservingHeadAndTail(code: string, maxChars: number): string {
    if (code.length <= maxChars) return code;
    const headBudget = Math.floor(maxChars * 0.72);
    const tailBudget = Math.max(400, maxChars - headBudget - 60);
    return `${code.slice(0, headBudget)}\n/* ... middle section preserved ... */\n${code.slice(-tailBudget)}`;
  }

  private extractRecentUserUpdates(
    request: PromptGenerationRequest,
    maxItems = 5
  ): string[] {
    if (!request.history || request.history.length === 0) return [];
    const userMsgs = request.history
      .filter(m => m.role === 'user' && m.content.trim().length > 0)
      .map(m => m.content.trim());

    const prior =
      userMsgs.length > 0 &&
      userMsgs[userMsgs.length - 1] === request.prompt.trim()
        ? userMsgs.slice(0, -1)
        : userMsgs;

    return prior
      .slice(-maxItems)
      .map(item => (item.length > 140 ? `${item.slice(0, 137)}...` : item));
  }

  private buildContextualPrompt(
    request: PromptGenerationRequest,
    includeCode: boolean,
    maxCodeChars = 16000,
    maxDocChars = 2400
  ): string {
    const sections: string[] = [];

    if (request.docContext && request.docContext.trim().length > 0) {
      sections.push(
        `Reference Documentation (follow this API/syntax):\n${request.docContext
          .trim()
          .slice(0, maxDocChars)}`
      );
    }

    if (includeCode && request.currentCode.trim().length > 0) {
      const priorUpdates = this.extractRecentUserUpdates(request, 5);
      if (priorUpdates.length > 0) {
        sections.push(
          `Previous requests already built into Current Code (keep these intact unless asked to change them):\n${priorUpdates
            .map((u, idx) => `${idx + 1}. ${u}`)
            .join('\n')}`
        );
      }

      const clippedCode = this.clipCodePreservingHeadAndTail(
        request.currentCode,
        maxCodeChars
      );
      sections.push(`Current Code:\n\`\`\`tsx\n${clippedCode}\n\`\`\``);
    }

    if (includeCode && request.lastRuntimeError && request.lastRuntimeError.trim().length > 0) {
      sections.push(
        `Error when running current code (fix this in the updated code):\n${request.lastRuntimeError
          .trim()
          .slice(0, 480)}`
      );
    }

    if (sections.length === 0) {
      return `Write the complete runnable code in a \`\`\`tsx code block for this request (do not write instructions or prose, write the actual code):\n${request.prompt}`;
    }

    sections.push(
      [
        `Latest User Update: ${request.prompt}`,
        'IMPORTANT: Modify the Current Code above to implement this update while preserving all existing working functionality. Output the ENTIRE updated runnable file inside ONE ```tsx code block (never use `// ... existing code` placeholders and never return the exact same unchanged code).',
      ].join('\n')
    );
    return sections.join('\n\n');
  }

  private computeMaxTokens(
    prompt: string,
    includeCurrentCode: boolean,
    contextLimit = DEFAULT_CONTEXT_WINDOW,
    promptCharLength = 400,
    currentCodeLength = 0
  ): number {
    const estimatedPromptTokens = Math.ceil(
      (MINIMALIST_SYSTEM_PROMPT.length + promptCharLength) / 2.5
    );
    const availableTokens = Math.max(512, contextLimit - estimatedPromptTokens - 128);

    if (includeCurrentCode && currentCodeLength > 0) {
      const neededForUpdatedFile = Math.ceil(currentCodeLength / 2.3) + 700;
      const desiredUpdateTokens = Math.max(2048, neededForUpdatedFile);
      return Math.min(availableTokens, Math.min(3584, desiredUpdateTokens));
    }

    const p = prompt.trim();
    const wordCount = p.split(/\s+/).filter(Boolean).length;
    const isComplexFeature =
      /\b(dashboard|calculator|game|tic\s*tac|chess|snake|pong|tetris|flappy|breakout|memory|calendar|kanban|chart|graph|todo|task|timer|stopwatch|form|table|converter|quiz|weather|editor|chat|clock|player)\b/i.test(
        p
      );

    const maxDesired = Math.min(3584, contextLimit >= 6144 ? 3072 : 2048);
    const desired = wordCount <= 10 && !isComplexFeature ? 1024 : maxDesired;

    return Math.min(availableTokens, desired);
  }

  private normalizeCodeForComparison(code: string): string {
    return code.replace(/\s+/g, ' ').trim();
  }

  private hasLazyCodeElision(candidate: string, originalCode: string): boolean {
    const hasPlaceholderComment =
      /\/\/\s*\.\.\.\s*(?:rest|existing|previous|other|unchanged|same|keep|remaining)|\{\/\*\s*\.\.\.\s*(?:rest|existing|previous|other|unchanged|same)/i.test(
        candidate
      );
    if (!hasPlaceholderComment) return false;
    return originalCode.length > 300 && candidate.length < originalCode.length * 0.75;
  }

  private looksLikeRunnableCode(text: string): boolean {
    const t = text.trim();
    if (!t) return false;
    const hasCodeSyntax =
      /\b(import\s+React|export\s+default|function\s+[A-Za-z_$]|const\s+[A-Za-z_$[\]{}]|let\s+[A-Za-z_$]|var\s+[A-Za-z_$]|document\.|window\.|console\.log|return\s*\(?[\s\n]*<)/m.test(
        t
      ) ||
      /^\s*(?:<!doctype\s+html|<html\b|<div\b|<main\b|<section\b|<canvas\b|<button\b|<h[1-6]\b|<p\b|<svg\b)/im.test(
        t
      );

    return hasCodeSyntax;
  }

  private hasCompletedFirstCodeBlock(text: string): boolean {
    const openMatch = text.match(
      /```(?:tsx|typescript|jsx|javascript|ts|js|html|xml|react)?[ \t]*\r?\n/i
    );
    if (!openMatch || openMatch.index === undefined) return false;

    const bodyStart = openMatch.index + openMatch[0].length;
    const afterOpen = text.slice(bodyStart);

    const closeMatch = afterOpen.match(/\n```(?:\s*$|\r?\n)/);
    if (!closeMatch || closeMatch.index === undefined) return false;

    const codeBody = afterOpen.slice(0, closeMatch.index).trim();
    return codeBody.length >= 12 && this.looksLikeRunnableCode(codeBody);
  }

  private detectRepetitionLoop(text: string): boolean {
    const rawLines = text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);

    if (rawLines.length < 12) return false;

    let consecutive = 1;
    for (let i = 1; i < rawLines.length; i++) {
      if (rawLines[i].length >= 20 && rawLines[i] === rawLines[i - 1]) {
        consecutive++;
        if (consecutive >= 4) return true;
      } else {
        consecutive = 1;
      }
    }

    const substantive = rawLines.filter(
      l => l.length >= 16 && !/^(\/\/|\/\*|\*|<\/div>|<\/button>|};|\);|\})$/.test(l)
    );
    if (substantive.length < 14) return false;

    const quadCounts = new Map<string, number>();
    for (let i = 0; i <= substantive.length - 4; i++) {
      const quad = `${substantive[i]}\n${substantive[i + 1]}\n${substantive[i + 2]}\n${substantive[i + 3]}`;
      const next = (quadCounts.get(quad) || 0) + 1;
      if (next >= 3) {
        return true;
      }
      quadCounts.set(quad, next);
    }

    return false;
  }

  private deduplicateRepeatedLines(code: string): string {
    const rawLines = code.split('\n');
    const result: string[] = [];
    let repeatRun = 0;
    let prevTrimmed = '';

    for (const line of rawLines) {
      const trimmed = line.trim();
      if (trimmed.length >= 24 && trimmed === prevTrimmed) {
        repeatRun++;
        if (repeatRun >= 2) {
          continue;
        }
      } else {
        repeatRun = 0;
        prevTrimmed = trimmed;
      }
      result.push(line);
    }

    return result.join('\n');
  }

  async generateCode(
    request: PromptGenerationRequest,
    onProgress?: (token: string) => void
  ): Promise<GenerationResult> {
    const startTime = Date.now();
    this.isAbortRequested = false;

    if (request.modelId === 'ollama_local') {
      return this.generateWithOllama(request, onProgress, startTime);
    }

    return this.generateWithNativeMetal(request, onProgress, startTime);
  }

  private async generateWithNativeMetal(
    request: PromptGenerationRequest,
    onProgress?: (token: string) => void,
    startTime = Date.now()
  ): Promise<GenerationResult> {
    if (!nativeBridge.isRunningInNativeApp()) {
      throw new Error(
        'Native Metal engine is unavailable in a plain browser. Open MiraCode inside the iOS app or select Local Ollama in Settings.'
      );
    }

    let status = nativeBridge.getLatestStatus();
    if (!status?.activeModel?.isLoaded) {
      const downloaded = status?.downloadedModels || [];
      if (downloaded.length > 0) {
        const preferred =
          downloaded.find(m => /coder/i.test(m.name)) || downloaded[0];
        onProgress?.(`Mounting ${preferred.name} into Apple Metal GPU...`);
        await nativeBridge.selectNativeModel(preferred.id);
        status = nativeBridge.getLatestStatus();
      } else {
        throw new Error(
          'No GGUF model loaded yet. Tap the Models button above (or Settings) to download Qwen 2.5 Coder 3B or 7B, or drop a .gguf file via USB-C / Files.'
        );
      }
    }

    const effectiveContextWindow =
      status?.contextWindow || this.preferredContextWindow || DEFAULT_CONTEXT_WINDOW;
    const activeModelName = status?.activeModel?.name || 'Apple Metal GGUF';

    const includeCode = this.shouldIncludeCurrentCode(
      request.prompt,
      request.currentCode,
      request.lastRuntimeError
    );

    const maxCodeChars = Math.max(12000, Math.floor(effectiveContextWindow * 2.2));
    const maxDocChars = Math.min(3200, Math.floor(effectiveContextWindow * 0.28));

    const userMessageContent = this.buildContextualPrompt(
      request,
      includeCode,
      maxCodeChars,
      maxDocChars
    );

    const maxTokens = this.computeMaxTokens(
      request.prompt,
      includeCode,
      effectiveContextWindow,
      userMessageContent.length,
      includeCode ? request.currentCode.length : 0
    );

    const runNativePass = async (
      sysPrompt: string,
      usrPrompt: string,
      temperature: number,
      passMaxTokens = maxTokens
    ): Promise<{ text: string; tokensPredicted?: number; aborted?: boolean }> => {
      let stoppedEarly = false;
      const handle = nativeBridge.generateCode({
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: usrPrompt },
        ],
        maxTokens: passMaxTokens,
        temperature,
        onProgress: accumulated => {
          onProgress?.(accumulated);
          if (
            !stoppedEarly &&
            (this.hasCompletedFirstCodeBlock(accumulated) ||
              this.detectRepetitionLoop(accumulated))
          ) {
            stoppedEarly = true;
            handle.abort();
          }
        },
      });
      this.activeAbortFn = handle.abort;
      try {
        const res = await handle.promise;
        return res;
      } finally {
        if (this.activeAbortFn === handle.abort) {
          this.activeAbortFn = null;
        }
      }
    };

    const firstPass = await runNativePass(
      MINIMALIST_SYSTEM_PROMPT,
      userMessageContent,
      request.temperature ?? 0.22
    );
    let fullResponse = firstPass.text;
    let totalTokens = firstPass.tokensPredicted;

    let rawExtracted = this.extractCode(fullResponse);
    let cleanedCode = this.deduplicateRepeatedLines(rawExtracted);

    // If the user explicitly pressed Stop, return whatever valid code was streamed (or throw cancel notice)
    if (this.isAbortRequested) {
      const healed = tryRepairTruncatedDelimiters(cleanedCode);
      if (healed && this.looksLikeRunnableCode(healed)) {
        return {
          code: healed,
          explanation: 'Generation stopped early. Partial code recovered.',
          versionTitle: this.createVersionTitle(request.prompt),
          modelUsed: activeModelName,
          tokensUsed: totalTokens,
          durationMs: Date.now() - startTime,
        };
      }
      throw new Error('Generation stopped.');
    }

    // Safety net 1: force runnable code if model responded with prose
    if (!this.looksLikeRunnableCode(cleanedCode)) {
      onProgress?.('Generating runnable code block...');
      const strictCodePrompt = [
        `Task: ${request.prompt}`,
        includeCode && request.currentCode.trim()
          ? `Existing code to update:\n\`\`\`tsx\n${this.clipCodePreservingHeadAndTail(
              request.currentCode,
              maxCodeChars
            )}\n\`\`\``
          : '',
        'IMPORTANT: Do NOT explain or describe what to write. Output ONLY valid, complete React TSX code starting on line 1 with:',
        '```tsx',
        "import React, { useState, useEffect, useRef } from 'react';",
      ]
        .filter(Boolean)
        .join('\n\n');

      const pass2 = await runNativePass(MINIMALIST_SYSTEM_PROMPT, strictCodePrompt, 0.18);
      fullResponse = pass2.text;
      totalTokens = pass2.tokensPredicted ?? totalTokens;
      rawExtracted = this.extractCode(fullResponse);
      cleanedCode = this.deduplicateRepeatedLines(rawExtracted);
    }

    // Safety net 2: prevent lazy elision or unchanged echo on multi-turn edits
    if (
      !this.isAbortRequested &&
      includeCode &&
      request.currentCode.trim().length > 0 &&
      this.looksLikeRunnableCode(cleanedCode)
    ) {
      const isUnchangedEcho =
        this.normalizeCodeForComparison(cleanedCode) ===
        this.normalizeCodeForComparison(request.currentCode);
      const isLazyElision = this.hasLazyCodeElision(cleanedCode, request.currentCode);

      if (isUnchangedEcho || isLazyElision) {
        onProgress?.('Applying requested code changes...');
        const forceEditPrompt = [
          `Current Code:\n\`\`\`tsx\n${this.clipCodePreservingHeadAndTail(
            request.currentCode,
            maxCodeChars
          )}\n\`\`\``,
          `Required Change: ${request.prompt}`,
          isLazyElision
            ? 'Your last output omitted existing code with `// ...` comments. Write out the ENTIRE updated file completely with zero omissions inside ONE ```tsx code block.'
            : 'Your last output returned the exact same code without making the requested change. Modify the code now to implement the Required Change while keeping existing features intact, and return the ENTIRE updated file inside ONE ```tsx code block.',
        ].join('\n\n');

        const retryBudget = this.computeMaxTokens(
          request.prompt,
          true,
          effectiveContextWindow,
          forceEditPrompt.length,
          request.currentCode.length
        );

        const retryRes = await runNativePass(
          MINIMALIST_SYSTEM_PROMPT,
          forceEditPrompt,
          0.32,
          retryBudget
        );
        const retryCandidate = this.deduplicateRepeatedLines(
          this.extractCode(retryRes.text)
        );
        if (
          retryCandidate &&
          this.looksLikeRunnableCode(retryCandidate) &&
          !this.hasLazyCodeElision(retryCandidate, request.currentCode)
        ) {
          cleanedCode = retryCandidate;
          fullResponse = retryRes.text;
          totalTokens = retryRes.tokensPredicted ?? totalTokens;
        }
      }
    }

    // Safety net 3: offline syntax validation + delimiter repair
    if (!this.isAbortRequested && cleanedCode && this.looksLikeRunnableCode(cleanedCode)) {
      const initialSyntaxErr = validateCodeSyntax(cleanedCode);
      if (initialSyntaxErr) {
        const quickHealed = tryRepairTruncatedDelimiters(cleanedCode);
        if (validateCodeSyntax(quickHealed) === null) {
          cleanedCode = quickHealed;
        } else {
          onProgress?.(`Auto-fixing syntax issue (${initialSyntaxErr.slice(0, 60)})...`);
          const repairPrompt = [
            'Fix the syntax error in this code and return the COMPLETE corrected runnable file inside ONE ```tsx code block.',
            `Compiler Error: ${initialSyntaxErr}`,
            `Original Request: ${request.prompt}`,
            `Code to Fix:\n\`\`\`tsx\n${this.clipCodePreservingHeadAndTail(
              cleanedCode,
              maxCodeChars
            )}\n\`\`\``,
          ].join('\n\n');

          const repairBudget = this.computeMaxTokens(
            request.prompt,
            true,
            effectiveContextWindow,
            repairPrompt.length,
            cleanedCode.length
          );

          const repairedRes = await runNativePass(
            MINIMALIST_SYSTEM_PROMPT,
            repairPrompt,
            0.15,
            repairBudget
          );
          const repairedCandidate = tryRepairTruncatedDelimiters(
            this.deduplicateRepeatedLines(this.extractCode(repairedRes.text))
          );
          if (
            repairedCandidate &&
            this.looksLikeRunnableCode(repairedCandidate) &&
            validateCodeSyntax(repairedCandidate) === null
          ) {
            cleanedCode = repairedCandidate;
            fullResponse = repairedRes.text;
            totalTokens = repairedRes.tokensPredicted ?? totalTokens;
          }
        }
      }
    }

    const introNote = this.extractIntroNote(fullResponse);

    if (!cleanedCode || !this.looksLikeRunnableCode(cleanedCode)) {
      throw new Error(
        'The model returned text instead of runnable code. Please try sending your prompt again.'
      );
    }

    return {
      code: cleanedCode,
      explanation:
        introNote ||
        `Code generated with ${activeModelName}. Tap Run in the middle bar to preview, or view it in the Code tab.`,
      versionTitle: this.createVersionTitle(request.prompt),
      modelUsed: activeModelName,
      tokensUsed: totalTokens ?? Math.floor(fullResponse.length / 4),
      durationMs: Date.now() - startTime,
    };
  }

  private async generateWithOllama(
    request: PromptGenerationRequest,
    onProgress?: (token: string) => void,
    startTime = Date.now()
  ): Promise<GenerationResult> {
    const includeCode = this.shouldIncludeCurrentCode(
      request.prompt,
      request.currentCode,
      request.lastRuntimeError
    );
    const promptBody = `${MINIMALIST_SYSTEM_PROMPT}\n\n${this.buildContextualPrompt(
      request,
      includeCode,
      12000,
      2000
    )}`;

    onProgress?.(`Connecting to Ollama at ${this.customOllamaUrl}...`);

    const response = await fetch(`${this.customOllamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5-coder:latest',
        prompt: promptBody,
        options: {
          temperature: 0.25,
          repeat_penalty: 1.15,
          num_predict: this.computeMaxTokens(request.prompt, includeCode),
        },
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status} at ${this.customOllamaUrl}`);
    }

    const data = await response.json();
    const rawText = String(data.response || '');
    const code = this.deduplicateRepeatedLines(this.extractCode(rawText));

    return {
      code: code || request.currentCode,
      explanation:
        this.extractIntroNote(rawText) ||
        `Generated via local Ollama node (${this.customOllamaUrl}).`,
      versionTitle: this.createVersionTitle(request.prompt),
      modelUsed: 'Ollama Local Node',
      durationMs: Date.now() - startTime,
    };
  }

  private extractCode(raw: string): string {
    if (!raw) return '';
    const fenceRegex =
      /```(?:tsx|typescript|jsx|javascript|ts|js|html|xml|react)?[ \t]*\r?\n([\s\S]*?)```/gi;
    let match: RegExpExecArray | null;
    while ((match = fenceRegex.exec(raw)) !== null) {
      const candidate = (match[1] || '').trim();
      if (this.looksLikeRunnableCode(candidate)) {
        return candidate;
      }
    }

    const openMatch = raw.match(
      /```(?:tsx|typescript|jsx|javascript|ts|js|html|xml|react)?[ \t]*\r?\n([\s\S]*)$/i
    );
    if (openMatch && openMatch[1]) {
      return openMatch[1].replace(/```$/, '').trim();
    }

    return raw.trim();
  }

  private extractIntroNote(raw: string): string {
    if (!raw) return '';
    const beforeFence = raw.split('```')[0]?.trim() || '';
    if (beforeFence && beforeFence.length <= 320) {
      return `${beforeFence}\n\nTap Run to preview or open the Code tab below.`;
    }
    return '';
  }

  private createVersionTitle(prompt: string): string {
    const clean = prompt.trim();
    if (clean.length <= 40) return clean;
    return clean.slice(0, 37) + '...';
  }
}

export const aiEngine = new AIEngine();
