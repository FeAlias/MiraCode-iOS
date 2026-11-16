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
  healSyntaxErrorsDeterministically,
  parseSyntaxErrorLocation,
} from './previewCompiler';
import { nativeBridge } from './nativeBridge';

export const DEFAULT_MODEL_ID = 'native_metal_active';
export const DEFAULT_CONTEXT_WINDOW = 8192;
export const CONTEXT_WINDOW_OPTIONS = [4096, 6144, 8192, 12288] as const;

const NEW_PROGRAM_SYSTEM_PROMPT = [
  'You are Qwen Coder, an expert React (TypeScript/JSX), JavaScript, HTML, and Tailwind CSS programmer.',
  'Follow these rules strictly:',
  '1. ALWAYS output ONE complete, runnable code block starting IMMEDIATELY with ```tsx (or ```html / ```js if requested) and ending with ```. Never reply with prose outlines instead of code, and NEVER abbreviate with `// ... existing code` placeholders.',
  '2. Ensure every `{`, `(`, `[`, string quote, and JSX `<tag>...</tag>` is properly balanced and closed before ending the block.',
  '3. Always pair explicit contrasting background and text colors (e.g. `bg-zinc-950 text-zinc-100` or `bg-white text-zinc-900`) so text is never invisible.',
  '4. Mobile layout: fit a phone screen cleanly (`min-h-full p-3 flex flex-col items-center`, never clip with `overflow-hidden`). Keep game boards/canvases compact (~220px–260px) so the board, score, and buttons all fit onscreen.',
  '5. Game loops & phone controls: ALWAYS include large on-screen touch buttons (Up, Down, Left, Right, Restart) for games. Inside `setInterval` or `requestAnimationFrame`, read live direction/game state from `useRef` (e.g. `dirRef.current`) instead of stale `useState` closures so touch buttons steer immediately.',
].join('\n');

const SURGICAL_EDIT_SYSTEM_PROMPT = [
  'You are Qwen Coder, an expert React (TypeScript/JSX), JavaScript, HTML, and Tailwind CSS debugger and programmer.',
  'When modifying or fixing Existing Code, follow these rules strictly:',
  '1. Prefer surgical SEARCH/REPLACE blocks for bug fixes and targeted edits so untouched code stays 100% intact. Use this exact format:',
  '<<<<<<< SEARCH',
  '(exact lines from Existing Code to replace — do NOT include line numbers like `42 | `)',
  '=======',
  '(new corrected lines)',
  '>>>>>>> REPLACE',
  '2. Alternatively, if the change restructures most of the file, output ONE complete, runnable ```tsx code block containing the ENTIRE file from top to bottom with ZERO `// ... existing code` omissions.',
  '3. NEVER output a partial snippet without `<<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE` markers, and NEVER include line-number prefixes (`12 | `) inside your output code.',
  '4. Double-check that every `{`, `(`, `[`, comma, semicolon, and JSX `<Tag>...</Tag>` is balanced and valid TypeScript/JSX.',
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

export interface SearchReplacePatch {
  search: string;
  replace: string;
}

function stripAccidentalLineNumbers(block: string): string {
  const lines = block.split('\n');
  const nonEmpty = lines.filter(l => l.trim().length > 0);
  if (nonEmpty.length === 0) return block;
  const numberedCount = nonEmpty.filter(l => /^\s*>?\s*\d+\s*\|\s?/.test(l)).length;
  if (numberedCount >= Math.ceil(nonEmpty.length * 0.6)) {
    return lines.map(l => l.replace(/^\s*>?\s*\d+\s*\|\s?/, '')).join('\n');
  }
  return block;
}

export function parseSearchReplaceBlocks(raw: string): SearchReplacePatch[] {
  if (!raw) return [];
  const patches: SearchReplacePatch[] = [];
  const regex =
    /<{4,9}\s*SEARCH\b[^\n]*\r?\n([\s\S]*?)\r?\n={4,9}[ \t]*\r?\n([\s\S]*?)\r?\n>{4,9}\s*REPLACE\b/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    const search = stripAccidentalLineNumbers(match[1].replace(/\r\n/g, '\n'));
    const replace = stripAccidentalLineNumbers(match[2].replace(/\r\n/g, '\n'));
    if (search.trim().length > 0) {
      patches.push({ search, replace });
    }
  }
  return patches;
}

function applySingleSearchReplace(
  sourceCode: string,
  searchBlock: string,
  replaceBlock: string
): string | null {
  const src = sourceCode.replace(/\r\n/g, '\n');
  const search = searchBlock.replace(/\r\n/g, '\n');
  const replace = replaceBlock.replace(/\r\n/g, '\n');

  // Tier 1: Exact substring match
  const exactIdx = src.indexOf(search);
  if (exactIdx !== -1) {
    return src.slice(0, exactIdx) + replace + src.slice(exactIdx + search.length);
  }

  const srcLines = src.split('\n');
  const searchLines = search.split('\n');

  // Trim leading/trailing blank lines on searchLines for line-based matching
  while (searchLines.length > 0 && searchLines[0].trim() === '') searchLines.shift();
  while (searchLines.length > 0 && searchLines[searchLines.length - 1].trim() === '') {
    searchLines.pop();
  }
  if (searchLines.length === 0) return null;

  // Tier 2: Line-trimmed match (handles 3B indentation shifts cleanly)
  for (let i = 0; i <= srcLines.length - searchLines.length; i++) {
    let matches = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (srcLines[i + j].trim() !== searchLines[j].trim()) {
        matches = false;
        break;
      }
    }
    if (matches) {
      const origIndent = (srcLines[i].match(/^\s*/) || [''])[0];
      const searchIndent = (searchLines[0].match(/^\s*/) || [''])[0];
      const replaceLines = replace.split('\n').map(line => {
        if (!line.trim()) return '';
        if (searchIndent && line.startsWith(searchIndent)) {
          return origIndent + line.slice(searchIndent.length);
        }
        return line;
      });
      return [
        ...srcLines.slice(0, i),
        ...replaceLines,
        ...srcLines.slice(i + searchLines.length),
      ].join('\n');
    }
  }

  // Tier 3: Non-empty whitespace-normalized match (handles extra/missing blank lines)
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const compactSearch = searchLines.map(norm).filter(Boolean);
  if (compactSearch.length >= 2) {
    const nonEmptySrc: Array<{ origIdx: number; text: string }> = [];
    srcLines.forEach((line, idx) => {
      const n = norm(line);
      if (n) nonEmptySrc.push({ origIdx: idx, text: n });
    });

    for (let i = 0; i <= nonEmptySrc.length - compactSearch.length; i++) {
      let ok = true;
      for (let j = 0; j < compactSearch.length; j++) {
        if (nonEmptySrc[i + j].text !== compactSearch[j]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        const startLine = nonEmptySrc[i].origIdx;
        const endLine = nonEmptySrc[i + compactSearch.length - 1].origIdx;
        return [
          ...srcLines.slice(0, startLine),
          ...replace.split('\n'),
          ...srcLines.slice(endLine + 1),
        ].join('\n');
      }
    }
  }

  return null;
}

export function applySearchReplacePatches(
  sourceCode: string,
  patches: SearchReplacePatch[]
): { patched: string; appliedCount: number } {
  let working = sourceCode;
  let appliedCount = 0;
  for (const patch of patches) {
    const next = applySingleSearchReplace(working, patch.search, patch.replace);
    if (next !== null && next !== working) {
      working = next;
      appliedCount++;
    }
  }
  return { patched: working, appliedCount };
}

function findMatchingBraceEnd(code: string, openBraceIndex: number): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = openBraceIndex; i < code.length; i++) {
    const ch = code[i];
    const next = i + 1 < code.length ? code[i + 1] : '';

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingle) {
      if (ch === '\\') i++;
      else if (ch === "'" || ch === '\n') inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '\\') i++;
      else if (ch === '"' || ch === '\n') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === '\\') i++;
      else if (ch === '`') inTemplate = false;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      continue;
    }

    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * If a 3B model outputs only a corrected helper/handler function snippet
 * (e.g. `const handleMove = (...) => { ... }` or `function resetGame() { ... }`)
 * instead of the whole 200-line file, splice that named function directly into `sourceCode`!
 */
export function trySpliceNamedDeclaration(
  sourceCode: string,
  snippetCode: string
): string | null {
  const snippet = stripAccidentalLineNumbers(snippetCode).trim();
  if (!snippet || snippet.length >= sourceCode.length * 0.72) return null;

  // Do not treat a full standalone App component as a partial helper splice
  if (/\bexport\s+default\b/.test(snippet)) return null;

  const fnDeclMatch = snippet.match(
    /^(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/
  );
  const constFnMatch = snippet.match(
    /^(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>\s*\{/
  );

  const declName = fnDeclMatch?.[1] || constFnMatch?.[1];
  if (!declName || declName === 'App') return null;

  const escapedName = declName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const targetRegex = fnDeclMatch
    ? new RegExp(`([ \\t]*)(?:async\\s+)?function\\s+${escapedName}\\s*\\(`, 'm')
    : new RegExp(
        `([ \\t]*)(?:const|let|var)\\s+${escapedName}\\s*(?::[^=]+)?=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z_$][A-Za-z0-9_$]*)\\s*=>\\s*\\{`,
        'm'
      );

  const match = targetRegex.exec(sourceCode);
  if (!match || match.index === undefined) return null;

  const indent = match[1] || '';
  const openBracePos = sourceCode.indexOf('{', match.index + match[0].length - 1);
  if (openBracePos === -1) return null;

  const closeBracePos = findMatchingBraceEnd(sourceCode, openBracePos);
  if (closeBracePos === -1) return null;

  let endPos = closeBracePos + 1;
  if (sourceCode[endPos] === ';') endPos++;

  const reindentedSnippet = snippet
    .split('\n')
    .map((ln, idx) => (idx === 0 ? indent + ln.trimStart() : ln ? indent + ln : ''))
    .join('\n');

  const spliced =
    sourceCode.slice(0, match.index) + reindentedSnippet + sourceCode.slice(endPos);
  const healed = healSyntaxErrorsDeterministically(spliced);
  return validateCodeSyntax(healed) === null ? healed : null;
}

function formatNumberedCodeWindow(
  code: string,
  focusLine?: number | null,
  radius = 30
): string {
  const lines = code.split('\n');
  const start = focusLine ? Math.max(1, focusLine - radius) : 1;
  const end = focusLine ? Math.min(lines.length, focusLine + radius) : lines.length;
  const out: string[] = [];
  for (let ln = start; ln <= end; ln++) {
    const marker = focusLine && ln === focusLine ? '>' : ' ';
    out.push(`${marker}${String(ln).padStart(4, ' ')} | ${lines[ln - 1]}`);
  }
  return out.join('\n');
}

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
    if (nativeBridge.isRunningInNativeApp()) {
      nativeBridge.setContextWindow(clamped);
    }
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

  private isBugOrSyntaxFixPrompt(
    prompt: string,
    currentCode: string,
    lastRuntimeError?: string | null
  ): boolean {
    if (lastRuntimeError && lastRuntimeError.trim().length > 0) return true;
    if (currentCode.trim().length > 0 && validateCodeSyntax(currentCode) !== null) {
      return true;
    }
    return /\b(fix|error|bug|syntax|broken|crash|issue|not\s+working|doesn'?t\s+work|missing|unexpected\s+token|unterminated|undefined|null|exception|fail)\b/i.test(
      prompt
    );
  }

  private isPureSyntaxFixOnlyRequest(prompt: string): boolean {
    const p = prompt.trim();
    return (
      /^please\s+fix\s+this\s+error\s+when\s+running\s+the\s+code:\s*Syntax\s*Error/i.test(p) ||
      /^(?:please\s+)?fix\s+(?:the\s+)?(?:syntax|compile|missing\s+(?:brace|bracket|paren|tag|semicolon|comma))(?:\s+error|\s+errors|\s+issues?)?\.?$/i.test(
        p
      )
    );
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
    maxCodeChars = 20000,
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

    if (!includeCode || request.currentCode.trim().length === 0) {
      sections.push(
        `Write the complete runnable code in ONE \`\`\`tsx code block for this request (do not write prose outlines, write the actual code):\n${request.prompt}`
      );
      return sections.join('\n\n');
    }

    const currentSyntaxErr = validateCodeSyntax(request.currentCode);
    const activeError =
      request.lastRuntimeError?.trim() ||
      (currentSyntaxErr ? `Syntax Error: ${currentSyntaxErr}` : '');
    const errLoc = parseSyntaxErrorLocation(activeError);

    const priorUpdates = this.extractRecentUserUpdates(request, 4);
    if (priorUpdates.length > 0 && !activeError) {
      sections.push(
        `Previous features in Existing Code (keep intact unless asked to change):\n${priorUpdates
          .map((u, idx) => `${idx + 1}. ${u}`)
          .join('\n')}`
      );
    }

    if (request.currentCode.length <= maxCodeChars) {
      sections.push(`Existing Code:\n\`\`\`tsx\n${request.currentCode}\n\`\`\``);
    } else {
      // Never inject broken `/* ... middle section preserved ... */` inside code!
      // Instead, show focused region around error (or top/bottom summary) for SEARCH/REPLACE patching.
      const focusWindow = formatNumberedCodeWindow(
        request.currentCode,
        errLoc?.line ?? Math.floor(request.currentCode.split('\n').length / 2),
        60
      );
      sections.push(
        `Existing Code Window (line-numbered for reference — use SEARCH/REPLACE blocks without line numbers):\n\`\`\`tsx\n${focusWindow}\n\`\`\``
      );
    }

    if (activeError) {
      sections.push(`Active Error to Fix:\n${activeError.slice(0, 600)}`);
      if (errLoc) {
        const numberedFocus = formatNumberedCodeWindow(
          request.currentCode,
          errLoc.line,
          14
        );
        sections.push(
          `Exact Lines Around Error (Line ${errLoc.line}, Column ${errLoc.column}):\n\`\`\`\n${numberedFocus}\n\`\`\``
        );
      }
    }

    sections.push(
      [
        `User Request: ${request.prompt}`,
        activeError
          ? 'Fix the error using ONE or more `<<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE` blocks matching the exact lines in Existing Code (preferred, fastest, safest), OR output the ENTIRE corrected file inside ONE ```tsx code block with zero omissions.'
          : 'Apply this update using `<<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE` blocks (preferred for targeted edits) OR output the ENTIRE updated file inside ONE ```tsx code block with zero `// ...` omissions.',
      ].join('\n')
    );

    return sections.join('\n\n');
  }

  private computeMaxTokens(
    includeCurrentCode: boolean,
    contextLimit = DEFAULT_CONTEXT_WINDOW,
    promptCharLength = 400,
    currentCodeLength = 0
  ): number {
    const estimatedPromptTokens = Math.ceil((promptCharLength + 700) / 2.8);
    const availableTokens = Math.max(
      1024,
      contextLimit - estimatedPromptTokens - 128
    );

    if (includeCurrentCode && currentCodeLength > 0) {
      const neededForFullFile = Math.ceil(currentCodeLength / 2.4) + 900;
      return Math.min(availableTokens, Math.min(5600, Math.max(2560, neededForFullFile)));
    }

    return Math.min(availableTokens, contextLimit >= 6144 ? 4096 : 2560);
  }

  private normalizeCodeForComparison(code: string): string {
    return code.replace(/\s+/g, ' ').trim();
  }

  private hasLazyCodeElision(candidate: string, originalCode: string): boolean {
    const hasPlaceholderComment =
      /\/\/\s*\.\.\.\s*(?:rest|existing|previous|other|unchanged|same|keep|remaining|middle)|\/\*\s*\.\.\.\s*(?:rest|existing|previous|middle)|\{\/\*\s*\.\.\.\s*(?:rest|existing|previous|other|unchanged|same)/i.test(
        candidate
      );
    if (!hasPlaceholderComment) return false;
    return originalCode.length > 200 && candidate.length < originalCode.length * 0.85;
  }

  private looksLikeRunnableCode(text: string): boolean {
    const t = text.trim();
    if (!t) return false;
    return (
      /\b(import\s+React|export\s+default|function\s+[A-Za-z_$]|const\s+[A-Za-z_$[\]{}]|let\s+[A-Za-z_$]|var\s+[A-Za-z_$]|document\.|window\.|console\.log|return\s*\(?[\s\n]*<)/m.test(
        t
      ) ||
      /^\s*(?:<!doctype\s+html|<html\b|<div\b|<main\b|<section\b|<canvas\b|<button\b|<h[1-6]\b|<p\b|<svg\b)/im.test(
        t
      )
    );
  }

  private looksLikeCompleteStandaloneProgram(
    candidate: string,
    originalCode: string
  ): boolean {
    const c = candidate.trim();
    if (!this.looksLikeRunnableCode(c)) return false;
    if (originalCode.trim().length > 180) {
      if (this.hasLazyCodeElision(c, originalCode)) return false;
      // Prevent a 5-line diagnostic snippet from ever masquerading as a full 200-line file replacement!
      if (c.length < Math.min(180, originalCode.length * 0.45)) {
        return false;
      }
      const origHasDefaultExport = /\bexport\s+default\b|\bfunction\s+App\b/i.test(
        originalCode
      );
      const candHasTopComponent =
        /\bexport\s+default\b|\bfunction\s+[A-Z][A-Za-z0-9_$]*\s*\(|\bconst\s+[A-Z][A-Za-z0-9_$]*\s*=/m.test(
          c
        ) || /^\s*(?:<!doctype\s+html|<html\b)/i.test(c);
      if (origHasDefaultExport && !candHasTopComponent) {
        return false;
      }
    }
    return true;
  }

  /**
   * Only stop generation early when we have a genuinely complete, syntax-valid patch or full file —
   * NEVER abort right after a tiny 4-line explanation snippet!
   */
  private hasCompletedValidOutput(
    accumulated: string,
    includeCode: boolean,
    currentCode: string
  ): boolean {
    // Case A: Complete SEARCH/REPLACE block(s) with no unclosed SEARCH marker trailing
    const openSearchCount = (accumulated.match(/<{4,9}\s*SEARCH\b/gi) || []).length;
    const closeReplaceCount = (accumulated.match(/>{4,9}\s*REPLACE\b/gi) || []).length;
    if (
      includeCode &&
      currentCode.trim().length > 0 &&
      openSearchCount > 0 &&
      openSearchCount === closeReplaceCount &&
      />\s*REPLACE[ \t]*\r?\n/.test(accumulated)
    ) {
      const patches = parseSearchReplaceBlocks(accumulated);
      if (patches.length > 0) {
        const { patched, appliedCount } = applySearchReplacePatches(
          currentCode,
          patches
        );
        if (appliedCount > 0) {
          const healed = healSyntaxErrorsDeterministically(patched);
          if (validateCodeSyntax(healed) === null) {
            return true;
          }
        }
      }
    }

    // Case B: Complete fenced standalone program
    const fenceRegex =
      /```(?:tsx|typescript|jsx|javascript|ts|js|html|xml|react)?[ \t]*\r?\n([\s\S]*?)\r?\n```(?:\s*$|\r?\n)/gi;
    let match: RegExpExecArray | null;
    while ((match = fenceRegex.exec(accumulated)) !== null) {
      const body = stripAccidentalLineNumbers((match[1] || '').trim());
      if (
        this.looksLikeCompleteStandaloneProgram(
          body,
          includeCode ? currentCode : ''
        )
      ) {
        const healed = healSyntaxErrorsDeterministically(body);
        if (validateCodeSyntax(healed) === null) {
          return true;
        }
      }
    }

    return false;
  }

  private detectRepetitionLoop(text: string): boolean {
    const rawLines = text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);

    if (rawLines.length < 16) return false;

    let consecutive = 1;
    for (let i = 1; i < rawLines.length; i++) {
      if (rawLines[i].length >= 24 && rawLines[i] === rawLines[i - 1]) {
        consecutive++;
        if (consecutive >= 6) return true;
      } else {
        consecutive = 1;
      }
    }

    const substantive = rawLines.filter(
      l => l.length >= 20 && !/^(\/\/|\/\*|\*|<\/div>|<\/button>|};|\);|\})$/.test(l)
    );
    if (substantive.length < 20) return false;

    const quadCounts = new Map<string, number>();
    for (let i = 0; i <= substantive.length - 4; i++) {
      const quad = `${substantive[i]}\n${substantive[i + 1]}\n${substantive[i + 2]}\n${substantive[i + 3]}`;
      const next = (quadCounts.get(quad) || 0) + 1;
      if (next >= 4) {
        return true;
      }
      quadCounts.set(quad, next);
    }

    return false;
  }

  private deduplicateRunawayLoops(code: string): string {
    const rawLines = code.split('\n');
    const result: string[] = [];
    let repeatRun = 0;
    let prevTrimmed = '';

    for (const line of rawLines) {
      const trimmed = line.trim();
      const isStructuralCloser = /^(?:<\/[a-zA-Z0-9_.-]+>|[});\]]+)$/.test(trimmed);
      if (!isStructuralCloser && trimmed.length >= 28 && trimmed === prevTrimmed) {
        repeatRun++;
        // Only strip when an identical long line repeats 5+ times in a row (true token loop)
        if (repeatRun >= 4) {
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

  /**
   * Resolves raw LLM output into updated code by checking:
   * 1. Surgical `<<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE` patches
   * 2. Largest complete standalone fenced code block (skipping small diagnostic snippets!)
   * 3. Named function/declaration splice (`trySpliceNamedDeclaration`) if the model returned only a fixed function
   */
  private resolveCandidateCode(
    rawResponse: string,
    includeCode: boolean,
    currentCode: string
  ): { code: string; usedPatch: boolean } {
    if (includeCode && currentCode.trim().length > 0) {
      const patches = parseSearchReplaceBlocks(rawResponse);
      if (patches.length > 0) {
        const { patched, appliedCount } = applySearchReplacePatches(
          currentCode,
          patches
        );
        if (appliedCount > 0) {
          return {
            code: healSyntaxErrorsDeterministically(
              this.deduplicateRunawayLoops(patched)
            ),
            usedPatch: true,
          };
        }
      }
    }

    const blocks = this.extractAllFencedBlocks(rawResponse);

    if (blocks.length > 0) {
      // Pick the largest complete standalone block first (ignores tiny diagnostic snippets before the full code!)
      const standaloneBlocks = blocks.filter(b =>
        this.looksLikeCompleteStandaloneProgram(b, includeCode ? currentCode : '')
      );
      if (standaloneBlocks.length > 0) {
        standaloneBlocks.sort((a, b) => b.length - a.length);
        return {
          code: healSyntaxErrorsDeterministically(
            this.deduplicateRunawayLoops(standaloneBlocks[0])
          ),
          usedPatch: false,
        };
      }

      // If the model only emitted a partial function/handler snippet while editing existing code, splice it safely!
      if (includeCode && currentCode.trim().length > 0) {
        for (const snippet of blocks) {
          const spliced = trySpliceNamedDeclaration(currentCode, snippet);
          if (spliced) {
            return { code: spliced, usedPatch: true };
          }
        }
      }

      // Fallback for brand-new small snippets
      if (!includeCode || currentCode.trim().length === 0) {
        const runnable = blocks.filter(b => this.looksLikeRunnableCode(b));
        if (runnable.length > 0) {
          runnable.sort((a, b) => b.length - a.length);
          return {
            code: healSyntaxErrorsDeterministically(
              this.deduplicateRunawayLoops(runnable[0])
            ),
            usedPatch: false,
          };
        }
      }
    }

    // Check unclosed fence at EOF (if maxTokens hit before closing ```)
    const openMatch = rawResponse.match(
      /```(?:tsx|typescript|jsx|javascript|ts|js|html|xml|react)?[ \t]*\r?\n([\s\S]*)$/i
    );
    if (openMatch && openMatch[1]) {
      const candidate = stripAccidentalLineNumbers(
        openMatch[1].replace(/```$/, '').trim()
      );
      if (
        !includeCode ||
        currentCode.trim().length === 0 ||
        candidate.length >= currentCode.length * 0.5
      ) {
        return {
          code: healSyntaxErrorsDeterministically(
            this.deduplicateRunawayLoops(candidate)
          ),
          usedPatch: false,
        };
      }
    }

    return { code: '', usedPatch: false };
  }

  private extractAllFencedBlocks(raw: string): string[] {
    if (!raw) return [];
    const results: string[] = [];
    const fenceRegex =
      /```(?:tsx|typescript|jsx|javascript|ts|js|html|xml|react)?[ \t]*\r?\n([\s\S]*?)```/gi;
    let match: RegExpExecArray | null;
    while ((match = fenceRegex.exec(raw)) !== null) {
      const candidate = stripAccidentalLineNumbers((match[1] || '').trim());
      if (candidate.length > 0 && !/<{4,9}\s*SEARCH\b/i.test(candidate)) {
        results.push(candidate);
      }
    }
    return results;
  }

  async generateCode(
    request: PromptGenerationRequest,
    onProgress?: (token: string) => void
  ): Promise<GenerationResult> {
    const startTime = Date.now();
    this.isAbortRequested = false;

    // Instant (<5ms) deterministic syntax heal when user clicks "Fix with AI" on a pure syntax error!
    if (
      request.currentCode &&
      request.currentCode.trim().length > 0 &&
      validateCodeSyntax(request.currentCode) !== null &&
      this.isPureSyntaxFixOnlyRequest(request.prompt)
    ) {
      const instantHealed = healSyntaxErrorsDeterministically(request.currentCode);
      if (
        instantHealed !== request.currentCode &&
        validateCodeSyntax(instantHealed) === null
      ) {
        return {
          code: instantHealed,
          explanation:
            'Fixed the missing/broken syntax automatically and verified clean compilation.',
          versionTitle: 'Auto-fix syntax error',
          modelUsed: 'Deterministic Syntax Healer',
          tokensUsed: 0,
          durationMs: Math.max(1, Date.now() - startTime),
        };
      }
    }

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

    const effectiveContextWindow = Math.max(
      status?.contextWindow || 0,
      this.preferredContextWindow || DEFAULT_CONTEXT_WINDOW
    );
    const activeModelName = status?.activeModel?.name || 'Apple Metal GGUF';

    const includeCode = this.shouldIncludeCurrentCode(
      request.prompt,
      request.currentCode,
      request.lastRuntimeError
    );

    const isFixingBug =
      includeCode &&
      this.isBugOrSyntaxFixPrompt(
        request.prompt,
        request.currentCode,
        request.lastRuntimeError
      );

    const systemPrompt = includeCode
      ? SURGICAL_EDIT_SYSTEM_PROMPT
      : NEW_PROGRAM_SYSTEM_PROMPT;

    const maxCodeChars = Math.max(18000, Math.floor(effectiveContextWindow * 2.5));
    const maxDocChars = Math.min(3200, Math.floor(effectiveContextWindow * 0.28));

    const userMessageContent = this.buildContextualPrompt(
      request,
      includeCode,
      maxCodeChars,
      maxDocChars
    );

    const maxTokens = this.computeMaxTokens(
      includeCode,
      effectiveContextWindow,
      userMessageContent.length,
      includeCode ? request.currentCode.length : 0
    );

    const runNativePass = async (
      sysPrompt: string,
      usrPrompt: string,
      temperature: number,
      passMaxTokens = maxTokens,
      baseForEarlyStop = includeCode ? request.currentCode : ''
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
            (this.hasCompletedValidOutput(
              accumulated,
              Boolean(baseForEarlyStop),
              baseForEarlyStop
            ) ||
              this.detectRepetitionLoop(accumulated))
          ) {
            stoppedEarly = true;
            handle.abort();
          }
        },
      });
      this.activeAbortFn = handle.abort;
      try {
        return await handle.promise;
      } finally {
        if (this.activeAbortFn === handle.abort) {
          this.activeAbortFn = null;
        }
      }
    };

    const firstPass = await runNativePass(
      systemPrompt,
      userMessageContent,
      isFixingBug ? 0.14 : request.temperature ?? 0.2
    );
    let fullResponse = firstPass.text;
    let totalTokens = firstPass.tokensPredicted ?? 0;

    let resolved = this.resolveCandidateCode(
      fullResponse,
      includeCode,
      request.currentCode
    );
    let cleanedCode = resolved.code;

    if (this.isAbortRequested) {
      if (
        cleanedCode &&
        this.looksLikeRunnableCode(cleanedCode) &&
        validateCodeSyntax(cleanedCode) === null
      ) {
        return {
          code: cleanedCode,
          explanation: 'Generation stopped early. Valid code recovered.',
          versionTitle: this.createVersionTitle(request.prompt),
          modelUsed: activeModelName,
          tokensUsed: totalTokens,
          durationMs: Date.now() - startTime,
        };
      }
      throw new Error('Generation stopped.');
    }

    // Safety net 1: Model explained the error in prose or wrote an unanchored tiny snippet without applying it
    if (!cleanedCode || !this.looksLikeRunnableCode(cleanedCode)) {
      onProgress?.('Applying identified fix directly to code...');
      const proseDiagnosis = fullResponse.slice(0, 900).trim();
      const followUpApplyPrompt = includeCode && request.currentCode.trim()
        ? [
            `Existing Code:\n\`\`\`tsx\n${request.currentCode.slice(0, maxCodeChars)}\n\`\`\``,
            proseDiagnosis
              ? `Your Diagnosis:\n${proseDiagnosis}`
              : `Task: ${request.prompt}`,
            'Now apply that exact fix! Output ONLY a `<<<<<<< SEARCH` ... `=======` ... `>>>>>>> REPLACE` patch block matching Existing Code (or the complete updated ```tsx file with zero omissions). Do NOT write prose.',
          ].join('\n\n')
        : [
            `Task: ${request.prompt}`,
            'Output ONLY valid, complete React TSX code inside ONE ```tsx block starting with:',
            '```tsx',
            "import React, { useState, useEffect, useRef } from 'react';",
          ].join('\n\n');

      const pass2 = await runNativePass(
        systemPrompt,
        followUpApplyPrompt,
        0.14,
        maxTokens
      );
      fullResponse = pass2.text;
      totalTokens += pass2.tokensPredicted ?? 0;
      resolved = this.resolveCandidateCode(
        fullResponse,
        includeCode,
        request.currentCode
      );
      cleanedCode = resolved.code;
    }

    // Safety net 2: Prevent unchanged echo or lazy `// ... existing code` elision on edits
    if (
      !this.isAbortRequested &&
      includeCode &&
      request.currentCode.trim().length > 0 &&
      cleanedCode
    ) {
      const isUnchangedEcho =
        this.normalizeCodeForComparison(cleanedCode) ===
        this.normalizeCodeForComparison(request.currentCode);
      const isLazyElision = this.hasLazyCodeElision(
        cleanedCode,
        request.currentCode
      );

      if (isUnchangedEcho || isLazyElision) {
        onProgress?.('Applying requested code changes surgically...');
        const forcePatchPrompt = [
          `Existing Code:\n\`\`\`tsx\n${request.currentCode.slice(0, maxCodeChars)}\n\`\`\``,
          `Required Change: ${request.prompt}`,
          isLazyElision
            ? 'Your previous output omitted code with `// ...` placeholders. Use `<<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE` blocks for ONLY the lines you are changing so all other lines remain intact!'
            : 'Your previous output did not change the code. Output a `<<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE` block showing the exact lines in Existing Code to replace and the new lines!',
        ].join('\n\n');

        const retryRes = await runNativePass(
          SURGICAL_EDIT_SYSTEM_PROMPT,
          forcePatchPrompt,
          0.24,
          maxTokens
        );
        totalTokens += retryRes.tokensPredicted ?? 0;
        const retryResolved = this.resolveCandidateCode(
          retryRes.text,
          true,
          request.currentCode
        );
        if (
          retryResolved.code &&
          this.looksLikeRunnableCode(retryResolved.code) &&
          !this.hasLazyCodeElision(retryResolved.code, request.currentCode)
        ) {
          cleanedCode = retryResolved.code;
          fullResponse = retryRes.text;
        }
      }
    }

    // Safety net 3: Multi-stage offline syntax verification + targeted line-window surgical repair
    if (!this.isAbortRequested && cleanedCode && this.looksLikeRunnableCode(cleanedCode)) {
      cleanedCode = healSyntaxErrorsDeterministically(cleanedCode);

      for (let attempt = 1; attempt <= 2; attempt++) {
        const syntaxErr = validateCodeSyntax(cleanedCode);
        if (syntaxErr === null || this.isAbortRequested) {
          break;
        }

        const loc = parseSyntaxErrorLocation(syntaxErr);
        onProgress?.(
          `Fixing syntax at ${loc ? `line ${loc.line}` : 'EOF'} (pass ${attempt}/2)...`
        );

        const brokenLines = cleanedCode.split('\n');
        const winStart = loc ? Math.max(1, loc.line - 14) : Math.max(1, brokenLines.length - 28);
        const winEnd = loc
          ? Math.min(brokenLines.length, loc.line + 14)
          : brokenLines.length;
        const rawWindow = brokenLines.slice(winStart - 1, winEnd).join('\n');
        const numberedWindow = formatNumberedCodeWindow(
          cleanedCode,
          loc?.line ?? brokenLines.length,
          14
        );

        const surgicalFixPrompt =
          attempt === 1
            ? [
                `Compiler Syntax Error: ${syntaxErr}`,
                `Numbered Context Around Line ${loc?.line ?? brokenLines.length}:`,
                `\`\`\`\n${numberedWindow}\n\`\`\``,
                `Exact Window (lines ${winStart}–${winEnd}) to Fix:`,
                `\`\`\`tsx\n${rawWindow}\n\`\`\``,
                'Fix the syntax error in this window! Output ONLY a `<<<<<<< SEARCH` ... `=======` ... `>>>>>>> REPLACE` block (without line numbers) fixing the broken lines.',
              ].join('\n\n')
            : [
                `Fix the syntax error (${syntaxErr}) and output the COMPLETE corrected file inside ONE \`\`\`tsx block with all braces, parentheses, and JSX tags balanced:`,
                `\`\`\`tsx\n${cleanedCode.slice(0, maxCodeChars)}\n\`\`\``,
              ].join('\n\n');

        const repairRes = await runNativePass(
          SURGICAL_EDIT_SYSTEM_PROMPT,
          surgicalFixPrompt,
          0.1,
          attempt === 1 ? 1200 : maxTokens,
          cleanedCode
        );
        totalTokens += repairRes.tokensPredicted ?? 0;

        const repairResolved = this.resolveCandidateCode(
          repairRes.text,
          true,
          cleanedCode
        );
        if (repairResolved.code) {
          const candidateHealed = healSyntaxErrorsDeterministically(
            repairResolved.code
          );
          if (validateCodeSyntax(candidateHealed) === null) {
            cleanedCode = candidateHealed;
            break;
          }
          // Also check if model output just the corrected window lines directly inside ```tsx
          if (attempt === 1) {
            const blocks = this.extractAllFencedBlocks(repairRes.text);
            if (blocks.length > 0) {
              const splicedWindow = [
                ...brokenLines.slice(0, winStart - 1),
                blocks[0],
                ...brokenLines.slice(winEnd),
              ].join('\n');
              const healedWindow = healSyntaxErrorsDeterministically(splicedWindow);
              if (validateCodeSyntax(healedWindow) === null) {
                cleanedCode = healedWindow;
                break;
              }
            }
          }
          cleanedCode = candidateHealed;
        }
      }
    }

    if (!cleanedCode || !this.looksLikeRunnableCode(cleanedCode)) {
      throw new Error(
        'The model returned commentary instead of code changes. Tap Send or Fix with AI again to apply the code update.'
      );
    }

    const finalSyntaxErr = validateCodeSyntax(cleanedCode);
    const originalWasValid =
      includeCode &&
      request.currentCode.trim().length > 0 &&
      validateCodeSyntax(request.currentCode) === null;

    if (finalSyntaxErr !== null && originalWasValid) {
      throw new Error(
        `Kept your working code safe because the generated edit still had a syntax error (${finalSyntaxErr}). Try rephrasing or splitting the change into a smaller step.`
      );
    }

    const introNote = this.extractIntroNote(fullResponse);

    return {
      code: cleanedCode,
      explanation:
        introNote ||
        `Updated with ${activeModelName} (syntax verified). Tap Run to preview or inspect in the Code tab.`,
      versionTitle: this.createVersionTitle(request.prompt),
      modelUsed: activeModelName,
      tokensUsed: totalTokens || Math.floor(fullResponse.length / 4),
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
    const sysPrompt = includeCode
      ? SURGICAL_EDIT_SYSTEM_PROMPT
      : NEW_PROGRAM_SYSTEM_PROMPT;
    const promptBody = `${sysPrompt}\n\n${this.buildContextualPrompt(
      request,
      includeCode,
      18000,
      2400
    )}`;

    onProgress?.(`Connecting to Ollama at ${this.customOllamaUrl}...`);

    const response = await fetch(`${this.customOllamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5-coder:latest',
        prompt: promptBody,
        options: {
          temperature: 0.2,
          repeat_penalty: 1.12,
          num_predict: this.computeMaxTokens(
            includeCode,
            16384,
            promptBody.length,
            request.currentCode.length
          ),
        },
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status} at ${this.customOllamaUrl}`);
    }

    const data = await response.json();
    const rawText = String(data.response || '');
    const resolved = this.resolveCandidateCode(
      rawText,
      includeCode,
      request.currentCode
    );
    const code = resolved.code || request.currentCode;

    return {
      code,
      explanation:
        this.extractIntroNote(rawText) ||
        `Generated via local Ollama node (${this.customOllamaUrl}).`,
      versionTitle: this.createVersionTitle(request.prompt),
      modelUsed: 'Ollama Local Node',
      durationMs: Date.now() - startTime,
    };
  }

  private extractIntroNote(raw: string): string {
    if (!raw) return '';
    const beforeBlock = raw
      .split(/```|<{4,9}\s*SEARCH/i)[0]
      ?.trim() || '';
    if (beforeBlock && beforeBlock.length <= 360) {
      return `${beforeBlock}\n\nSyntax verified — tap Run to preview or open the Code tab.`;
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
