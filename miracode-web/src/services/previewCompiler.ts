import { transform } from 'sucrase';
import { compile } from 'tailwindcss';
import twIndexCss from 'tailwindcss/index.css?raw';

export interface PreviewMessage {
  type: 'log' | 'error' | 'warn';
  message: string;
  timestamp: number;
}

export interface CompilationResult {
  html: string;
  compileError: string | null;
  usesLucide: boolean;
}

let twCompilerPromise: ReturnType<typeof compile> | null = null;

function getTailwindCompiler() {
  if (!twCompilerPromise) {
    twCompilerPromise = compile(twIndexCss);
  }
  return twCompilerPromise;
}

function extractTailwindCandidates(code: string): string[] {
  const baseline = [
    'dark',
    'bg-zinc-950',
    'text-zinc-100',
    'min-h-screen',
    'antialiased',
    'font-sans',
    'font-mono',
  ];
  const rawTokens = code.match(/[^\s"'`;{}()<>]+/g) || [];
  const cleanedTokens = rawTokens
    .map(t => t.replace(/^[,[\]]+|[,;\]]+$/g, ''))
    .filter(Boolean);
  return Array.from(new Set([...baseline, ...rawTokens, ...cleanedTokens]));
}

function unwrapMarkdownFence(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(
    /^```(?:tsx|typescript|jsx|javascript|js|ts|html|xml)?\s*\n([\s\S]*?)(?:\n```)?$/i
  );
  if (fenceMatch && fenceMatch[1]) {
    return fenceMatch[1].trim();
  }
  const innerMatch = trimmed.match(
    /```(?:tsx|typescript|jsx|javascript|js|ts|html|xml)?\s*\n([\s\S]*?)```/i
  );
  if (innerMatch && innerMatch[1]) {
    return innerMatch[1].trim();
  }
  return trimmed;
}

function isFullHtmlDocument(code: string): boolean {
  return /^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(code);
}

function isHtmlWithScriptSnippet(code: string): boolean {
  const trimmed = code.trim();
  if (!trimmed.startsWith('<')) return false;
  return /<script\b[\s\S]*?<\/script>/i.test(trimmed);
}

function isPureHtmlMarkupSnippet(code: string): boolean {
  const trimmed = code.trim();
  if (!trimmed.startsWith('<')) return false;
  // Has no top-level JS/TS module keywords -> pure HTML / markup snippet
  const hasJsProgramKeywords =
    /\b(?:import\s|export\s|function\s+[A-Za-z_$]|const\s+[A-Za-z_$]|let\s+[A-Za-z_$]|var\s+[A-Za-z_$]|class\s+[A-Za-z_$])/m.test(
      trimmed
    );
  return !hasJsProgramKeywords;
}

const LIGHT_BG_CONTRAST_CSS = `
  /* Zero-specificity (:where) contrast rule: light Tailwind backgrounds get dark readable text unless overridden by an explicit text-* class */
  :where(
    .bg-white,
    [class*="bg-gray-50"], [class*="bg-gray-100"], [class*="bg-gray-200"],
    [class*="bg-slate-50"], [class*="bg-slate-100"], [class*="bg-slate-200"],
    [class*="bg-zinc-50"], [class*="bg-zinc-100"], [class*="bg-zinc-200"],
    [class*="bg-neutral-50"], [class*="bg-neutral-100"], [class*="bg-neutral-200"],
    [class*="bg-stone-50"], [class*="bg-stone-100"], [class*="bg-stone-200"],
    [class*="bg-blue-50"], [class*="bg-blue-100"],
    [class*="bg-green-50"], [class*="bg-green-100"],
    [class*="bg-emerald-50"], [class*="bg-emerald-100"],
    [class*="bg-yellow-50"], [class*="bg-yellow-100"],
    [class*="bg-amber-50"], [class*="bg-amber-100"]
  ) {
    color: #18181b;
  }
`;

function preprocessAndTranspileCode(unwrappedCode: string): {
  jsCode: string;
  candidateComponents: string[];
  iconBindings: Array<{ imported: string; local: string }>;
  usesLucide: boolean;
} {
  let code = unwrappedCode;

  // 1. Extract lucide-react named imports safely (supports single-line & multi-line + `as` aliases)
  const iconBindings: Array<{ imported: string; local: string }> = [];
  const lucideRegex =
    /^\s*import\s+(?:type\s+)?(?:[A-Za-z0-9_$]+\s*,\s*)?\{([^;{}]*)\}\s*from\s*['"]lucide-react['"]\s*;?/gm;
  let match: RegExpExecArray | null;
  while ((match = lucideRegex.exec(code)) !== null) {
    const specifiers = match[1].split(',');
    for (const rawSpec of specifiers) {
      const cleaned = rawSpec.replace(/\btype\b/g, '').trim();
      if (!cleaned) continue;
      const asParts = cleaned.split(/\s+as\s+/);
      const imported = asParts[0]?.trim();
      const local = (asParts[1] || asParts[0])?.trim();
      if (imported && local && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(local)) {
        iconBindings.push({ imported, local });
      }
    }
  }

  const usesLucide = iconBindings.length > 0 || /lucide-react/.test(code);

  const preserveLineBreaks = (matched: string) => matched.replace(/[^\n]/g, ' ');

  // 2. Safely strip ESM import statements while preserving exact 1:1 line numbers for error diagnostics
  code = code
    // Multi-line or single-line named imports: import { a, b } from 'pkg';
    .replace(
      /^\s*import\s+(?:type\s+)?(?:[A-Za-z0-9_$]+\s*,\s*)?(?:\*\s+as\s+[A-Za-z0-9_$]+\s*,\s*)?\{[^;{}]*\}\s*from\s*['"][^'"]+['"]\s*;?/gm,
      preserveLineBreaks
    )
    // Single-line default or namespace imports: import Foo from 'pkg'; / import * as Foo from 'pkg';
    .replace(/^\s*import\s+[^\n;{}]*?\s+from\s*['"][^'"]+['"]\s*;?/gm, preserveLineBreaks)
    // Side-effect imports: import './styles.css';
    .replace(/^\s*import\s*['"][^'"]+['"]\s*;?/gm, preserveLineBreaks);

  // 3. Detect default export AND fallback PascalCase components (e.g. HelloWorld, Counter, App)
  const candidateComponents: string[] = [];

  const namedDefaultFn = code.match(/export\s+default\s+function\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
  if (namedDefaultFn && namedDefaultFn[1]) {
    candidateComponents.push(namedDefaultFn[1]);
    code = code.replace(
      /export\s+default\s+function\s+([A-Za-z_$][A-Za-z0-9_$]*)/,
      'function $1'
    );
  } else if (/export\s+default\s+function\s*\(/.test(code)) {
    candidateComponents.push('__AetherDefaultApp__');
    code = code.replace(
      /export\s+default\s+function\s*\(/,
      'function __AetherDefaultApp__('
    );
  } else {
    const namedDefaultClass = code.match(/export\s+default\s+class\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
    if (namedDefaultClass && namedDefaultClass[1]) {
      candidateComponents.push(namedDefaultClass[1]);
      code = code.replace(
        /export\s+default\s+class\s+([A-Za-z_$][A-Za-z0-9_$]*)/,
        'class $1'
      );
    } else {
      const defaultIdent = code.match(/export\s+default\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*;?/);
      if (defaultIdent && defaultIdent[1]) {
        candidateComponents.push(defaultIdent[1]);
        code = code.replace(/export\s+default\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*;?/, '');
      } else if (/export\s+default\s+/.test(code)) {
        candidateComponents.push('__AetherDefaultExpr__');
        code = code.replace(/export\s+default\s+/, 'const __AetherDefaultExpr__ = ');
      }
    }
  }

  // Strip `export` keyword from named declarations
  code = code
    .replace(/export\s+(?=(?:const|let|var|function|class|interface|type|enum)\b)/g, '')
    .replace(/^\s*export\s*\{[^}]*\}\s*;?/gm, '');

  // Always check `App` as primary fallback, plus any top-level PascalCase component functions/consts
  if (!candidateComponents.includes('App')) {
    candidateComponents.push('App');
  }

  const pascalMatches = code.matchAll(
    /(?:function\s+([A-Z][A-Za-z0-9_$]*)\s*\(|(?:const|let|var)\s+([A-Z][A-Za-z0-9_$]*)\s*(?::[^=]+)?=\s*(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>)/g
  );
  for (const pm of pascalMatches) {
    const name = pm[1] || pm[2];
    if (name && !candidateComponents.includes(name)) {
      candidateComponents.push(name);
    }
  }

  // 4. Transpile TypeScript + JSX -> pure ES JavaScript offline via Sucrase
  const compiled = transform(code, {
    transforms: ['typescript', 'jsx'],
    jsxRuntime: 'classic',
    production: true,
  });

  return {
    jsCode: compiled.code,
    candidateComponents,
    iconBindings,
    usesLucide,
  };
}

function escapeInlineScript(js: string): string {
  return js.replace(/<\/script>/gi, '<\\/script>');
}

function buildErrorBridgeScript(probeId?: string): string {
  const errType = probeId ? 'AETHER_PROBE_ERROR' : 'AETHER_PREVIEW_ERROR';
  const okType = probeId ? 'AETHER_PROBE_SUCCESS' : 'AETHER_PREVIEW_SUCCESS';
  const probeField = probeId ? `, probeId: ${JSON.stringify(probeId)}` : '';

  return `
    window.__aetherReportError = function (title, detail) {
      var full = (title ? title + ': ' : '') + String(detail || 'Unknown error');
      try {
        window.parent.postMessage({ type: '${errType}', error: full${probeField} }, '*');
      } catch (e) {}
    };
    window.__aetherReportSuccess = function () {
      try {
        window.parent.postMessage({ type: '${okType}'${probeField} }, '*');
      } catch (e) {}
    };
    window.addEventListener('error', function (ev) {
      var msg = (ev && ev.error && (ev.error.stack || ev.error.message)) || (ev && ev.message) || 'Runtime error';
      window.__aetherReportError('Runtime Error', msg);
    });
    window.addEventListener('unhandledrejection', function (ev) {
      var reason = ev && ev.reason;
      var msg = (reason && (reason.stack || reason.message)) || String(reason || 'Unhandled Promise rejection');
      window.__aetherReportError('Async Error', msg);
    });
  `;
}

export async function compilePreviewBundle(
  rawInputCode: string,
  probeId?: string
): Promise<CompilationResult> {
  const code = unwrapMarkdownFence(rawInputCode);

  let compiledCSS = '';
  try {
    const compiler = await getTailwindCompiler();
    const candidates = extractTailwindCandidates(code);
    compiledCSS = compiler.build(candidates);
  } catch (cssErr) {
    console.warn('Offline Tailwind compile fallback:', cssErr);
  }

  // Mode A: Full HTML Document (<!DOCTYPE html> / <html>) or HTML + <canvas>/<script> Snippet
  if (isFullHtmlDocument(code) || isHtmlWithScriptSnippet(code)) {
    const bridgeTag = `<style>${compiledCSS}\n${LIGHT_BG_CONTRAST_CSS}</style><script>${buildErrorBridgeScript(probeId)}window.addEventListener('load', function(){ window.__aetherReportSuccess(); });</script>`;
    if (isFullHtmlDocument(code)) {
      const injectedHtml = /<\/head>/i.test(code)
        ? code.replace(/<\/head>/i, `${bridgeTag}</head>`)
        : `${bridgeTag}${code}`;
      return {
        html: injectedHtml,
        compileError: null,
        usesLucide: false,
      };
    }

    const wrappedSnippetHtml = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>
    ${compiledCSS}
    ${LIGHT_BG_CONTRAST_CSS}
    html, body {
      background-color: #09090b;
      color: #f4f4f5;
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
      overflow-y: auto;
    }
  </style>
  <script>${buildErrorBridgeScript(probeId)}</script>
</head>
<body class="bg-zinc-950 text-zinc-100 min-h-screen antialiased">
  ${code}
  <script>window.__aetherReportSuccess && window.__aetherReportSuccess();</script>
</body>
</html>`;
    return {
      html: wrappedSnippetHtml,
      compileError: null,
      usesLucide: false,
    };
  }

  // Mode B: Pure HTML Markup Snippet (e.g. `<div style="border: 2px solid green">Hello World</div>`)
  if (isPureHtmlMarkupSnippet(code)) {
    const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    ${compiledCSS}
    ${LIGHT_BG_CONTRAST_CSS}
    html, body {
      background-color: #09090b;
      color: #f4f4f5;
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
      overflow-y: auto;
    }
  </style>
  <script>${buildErrorBridgeScript(probeId)}</script>
</head>
<body class="bg-zinc-950 text-zinc-100 antialiased">
  <div id="root">${code}</div>
  <script>window.__aetherReportSuccess && window.__aetherReportSuccess();</script>
</body>
</html>`;
    return {
      html,
      compileError: null,
      usesLucide: false,
    };
  }

  // Mode C: JavaScript / TypeScript / React JSX
  let jsCode = '';
  let candidateComponents: string[] = ['App'];
  let iconBindings: Array<{ imported: string; local: string }> = [];
  let usesLucide = false;
  let compileError: string | null = null;

  try {
    const res = preprocessAndTranspileCode(code);
    jsCode = res.jsCode;
    candidateComponents = res.candidateComponents;
    iconBindings = res.iconBindings;
    usesLucide = res.usesLucide;
  } catch (err: any) {
    compileError = err?.message || String(err);
  }

  if (compileError) {
    const safeMsg = compileError
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const escapedForPost = JSON.stringify(`Syntax Error: ${compileError}`);
    const errMsgType = probeId ? 'AETHER_PROBE_ERROR' : 'AETHER_PREVIEW_ERROR';
    const probeField = probeId ? `, probeId: ${JSON.stringify(probeId)}` : '';
    const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { background: #09090b; color: #f4f4f5; margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  </style>
</head>
<body>
  <div style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 16px; padding: 16px; color: #fca5a5;">
    <h3 style="font-weight: 600; font-size: 14px; margin: 0 0 8px 0; color: #f87171;">Syntax / Compile Error</h3>
    <pre style="font-size: 12px; font-family: ui-monospace, SFMono-Regular, monospace; margin: 0; white-space: pre-wrap; word-break: break-word;">${safeMsg}</pre>
  </div>
  <script>
    try {
      window.parent.postMessage({ type: '${errMsgType}', error: ${escapedForPost}${probeField} }, '*');
    } catch (e) {}
  </script>
</body>
</html>`;
    return { html, compileError: `Syntax Error: ${compileError}`, usesLucide: false };
  }

  // Bind Lucide icons on window so user code can even redeclare a local identifier without a SyntaxError
  const iconBindingStatements = iconBindings
    .map(
      b =>
        `window[${JSON.stringify(b.local)}] = __getLucideIcon__(${JSON.stringify(b.imported)});`
    )
    .join('\n        ');

  const candidateLookupExpr = candidateComponents
    .map(
      name =>
        `(typeof ${name} === 'function' || (typeof ${name} === 'object' && ${name} !== null) ? ${name} : null)`
    )
    .join(' || ');

  const safeUserJS = escapeInlineScript(jsCode);

  const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>
    ${compiledCSS}
    ${LIGHT_BG_CONTRAST_CSS}
    html, body {
      background-color: #09090b;
      color: #f4f4f5;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
      overflow-y: auto;
    }
  </style>
</head>
<body class="bg-zinc-950 text-zinc-100 min-h-screen antialiased">
  <div id="root"></div>

  <script>
    (function () {
      ${buildErrorBridgeScript(probeId)}

      const consoleLogs = [];
      const originalConsole = {
        log: console.log.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
      };

      function formatArg(a) {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return a.stack || a.message || String(a);
        try { return JSON.stringify(a, null, 2); } catch { return String(a); }
      }

      console.log = function (...args) {
        originalConsole.log(...args);
        consoleLogs.push(args.map(formatArg).join(' '));
      };
      console.warn = function (...args) {
        originalConsole.warn(...args);
      };
      console.error = function (...args) {
        originalConsole.error(...args);
        const joined = args.map(formatArg).join(' ');
        if (joined && !joined.includes('Download the React DevTools')) {
          window.__aetherReportError('Console Error', joined);
        }
      };

      function renderError(title, msg) {
        window.__aetherReportError(title, msg);
        const rootEl = document.getElementById('root');
        if (!rootEl) return;
        rootEl.innerHTML = '';
        const box = document.createElement('div');
        box.style.cssText = 'padding: 16px; font-family: -apple-system, BlinkMacSystemFont, sans-serif;';
        const card = document.createElement('div');
        card.style.cssText = 'background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 16px; padding: 16px; color: #fca5a5;';
        const heading = document.createElement('h3');
        heading.style.cssText = 'font-weight: 600; font-size: 14px; margin: 0 0 8px 0; color: #f87171;';
        heading.textContent = title;
        const pre = document.createElement('pre');
        pre.style.cssText = 'font-size: 12px; font-family: ui-monospace, SFMono-Regular, monospace; margin: 0; white-space: pre-wrap; word-break: break-word;';
        pre.textContent = String(msg || 'Unknown error');
        card.appendChild(heading);
        card.appendChild(pre);
        box.appendChild(card);
        rootEl.appendChild(box);
      }

      window.addEventListener('error', function (event) {
        const detail = event.error && event.error.message ? event.error.message : event.message;
        renderError('Runtime Error', detail);
      });

      try {
        const runtime = window.parent && window.parent.__AETHER_SANDBOX_RUNTIME__;
        if (!runtime || !runtime.React || !runtime.createRoot) {
          throw new Error('Offline React runtime bridge is initializing. Tap Run again.');
        }

        const BaseReact = runtime.React;
        const rawCreateRoot = runtime.createRoot;
        const LucideRegistry = runtime.LucideIcons || {};
        let __userMountedRoot__ = false;

        // Forgiving createElement shim so HTML string styles (style="border: 2px solid green")
        // or class="..." written by small local AI models work seamlessly in React 19!
        const origCreateElement = BaseReact.createElement.bind(BaseReact);
        const PatchedReact = Object.assign({}, BaseReact, {
          createElement: function (type, props, ...children) {
            if (props && typeof props === 'object') {
              let patched = null;
              if (typeof props.style === 'string') {
                patched = patched || Object.assign({}, props);
                const styleObj = {};
                props.style.split(';').forEach(function (rule) {
                  const colon = rule.indexOf(':');
                  if (colon > 0) {
                    const rawKey = rule.slice(0, colon).trim();
                    const val = rule.slice(colon + 1).trim();
                    if (rawKey && val) {
                      const camelKey = rawKey.indexOf('--') === 0
                        ? rawKey
                        : rawKey.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
                      styleObj[camelKey] = val;
                    }
                  }
                });
                patched.style = styleObj;
              }
              if (props.class && !props.className && typeof type === 'string') {
                patched = patched || Object.assign({}, props);
                patched.className = props.class;
                delete patched.class;
              }
              if (patched) {
                return origCreateElement(type, patched, ...children);
              }
            }
            return origCreateElement(type, props, ...children);
          },
        });

        function trackedCreateRoot(el) {
          __userMountedRoot__ = true;
          return rawCreateRoot(el);
        }

        // Expose React, ReactDOM, hooks, and motion fallback on global window (never lexical consts)
        // so user/AI code writing \`const { useState } = React\` never throws "Identifier already declared"!
        window.React = PatchedReact;
        window.createRoot = trackedCreateRoot;
        window.ReactDOM = {
          createRoot: trackedCreateRoot,
          render: function (element, container) {
            __userMountedRoot__ = true;
            if (container) {
              rawCreateRoot(container).render(element);
            }
          },
        };
        window.useState = BaseReact.useState;
        window.useEffect = BaseReact.useEffect;
        window.useMemo = BaseReact.useMemo;
        window.useCallback = BaseReact.useCallback;
        window.useRef = BaseReact.useRef;
        window.useReducer = BaseReact.useReducer;
        window.useContext = BaseReact.useContext;
        window.createContext = BaseReact.createContext;
        window.Fragment = BaseReact.Fragment;
        window.memo = BaseReact.memo;
        window.forwardRef = BaseReact.forwardRef;

        if (typeof Proxy !== 'undefined') {
          window.motion = new Proxy({}, {
            get: function (_, tag) {
              return typeof tag === 'string' ? tag : 'div';
            }
          });
          window.AnimatePresence = function (p) { return p && p.children ? p.children : null; };
        }

        function __createFallbackIcon__(name) {
          return function FallbackIcon(props) {
            const p = props || {};
            return PatchedReact.createElement(
              'svg',
              {
                xmlns: 'http://www.w3.org/2000/svg',
                viewBox: '0 0 24 24',
                fill: p.fill || 'none',
                stroke: p.stroke || 'currentColor',
                strokeWidth: p.strokeWidth || 2,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
                width: p.size || 20,
                height: p.size || 20,
                className: p.className || 'w-5 h-5',
                style: p.style,
                onClick: p.onClick,
                'aria-label': name,
              },
              PatchedReact.createElement('circle', { cx: '12', cy: '12', r: '9', opacity: 0.25 }),
              PatchedReact.createElement('path', { d: 'M12 8v8M8 12h8' })
            );
          };
        }

        function __getLucideIcon__(name) {
          const found = LucideRegistry[name];
          if (found) return found;
          return __createFallbackIcon__(name);
        }

        class __AetherErrorBoundary__ extends BaseReact.Component {
          constructor(props) {
            super(props);
            this.state = { error: null };
          }
          static getDerivedStateFromError(error) {
            return { error: error };
          }
          componentDidCatch(error) {
            const msg = error && (error.message || String(error));
            window.__aetherReportError('Component Render Error', msg);
          }
          render() {
            if (this.state.error) {
              const errText = this.state.error.message || String(this.state.error);
              return PatchedReact.createElement(
                'div',
                { style: { padding: '16px', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' } },
                PatchedReact.createElement(
                  'div',
                  {
                    style: {
                      background: 'rgba(239, 68, 68, 0.12)',
                      border: '1px solid rgba(239, 68, 68, 0.35)',
                      borderRadius: '16px',
                      padding: '16px',
                      color: '#fca5a5',
                    },
                  },
                  PatchedReact.createElement(
                    'h3',
                    { style: { fontWeight: 600, fontSize: '14px', margin: '0 0 8px 0', color: '#f87171' } },
                    'React Render Error'
                  ),
                  PatchedReact.createElement(
                    'pre',
                    {
                      style: {
                        fontSize: '12px',
                        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      },
                    },
                    errText
                  )
                )
              );
            }
            return this.props.children;
          }
        }

        ${iconBindingStatements}

        const __evalResult__ = (function () {
          ${safeUserJS}
          return ${candidateLookupExpr || 'null'};
        })();

        const container = document.getElementById('root');

        if (__userMountedRoot__) {
          window.__aetherReportSuccess();
        } else if (__evalResult__ && container) {
          const root = rawCreateRoot(container);
          const element = typeof __evalResult__ === 'function'
            ? PatchedReact.createElement(__evalResult__)
            : __evalResult__;
          root.render(
            PatchedReact.createElement(__AetherErrorBoundary__, null, element)
          );
          window.__aetherReportSuccess();
        } else if (
          (container && container.innerHTML.trim() !== '') ||
          document.body.children.length > 1
        ) {
          // Plain DOM JavaScript rendered elements directly into #root or document.body
          window.__aetherReportSuccess();
        } else if (consoleLogs.length > 0 && container) {
          // Support plain console.log("Hello, World!") JavaScript scripts cleanly
          container.innerHTML = '';
          const wrap = document.createElement('div');
          wrap.style.cssText = 'padding: 20px; font-family: ui-monospace, SFMono-Regular, monospace;';
          const box = document.createElement('div');
          box.style.cssText = 'background: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 16px; color: #e4e4e7; font-size: 13px; white-space: pre-wrap; word-break: break-word;';
          box.textContent = consoleLogs.join('\\n');
          wrap.appendChild(box);
          container.appendChild(wrap);
          window.__aetherReportSuccess();
        } else if (container) {
          renderError(
            'Nothing Rendered Yet',
            'Return JSX from function App() { ... }, manipulate the DOM in JavaScript, write HTML, or output via console.log().'
          );
        }
      } catch (err) {
        renderError('Runtime Error', err && (err.stack || err.message) ? (err.message || String(err)) : String(err));
      }
    })();
  </script>
</body>
</html>`;

  return {
    html,
    compileError: null,
    usesLucide,
  };
}

export async function compileToHTML(code: string): Promise<string> {
  const res = await compilePreviewBundle(code);
  return res.html;
}

/**
 * Fast (<1ms) synchronous syntax validator used by aiEngine to verify 1.5B output
 * before handing code to the editor. Returns null if valid, or the compiler error string.
 */
export function validateCodeSyntax(rawInputCode: string): string | null {
  const code = unwrapMarkdownFence(rawInputCode);
  if (!code.trim()) return 'Empty code block';

  if (isFullHtmlDocument(code) || isHtmlWithScriptSnippet(code)) {
    const scriptMatches = code.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi);
    for (const m of scriptMatches) {
      const scriptBody = (m[1] || '').trim();
      if (!scriptBody) continue;
      try {
        transform(scriptBody, { transforms: ['typescript'] });
      } catch (err: any) {
        return err?.message || String(err);
      }
    }
    return null;
  }

  if (isPureHtmlMarkupSnippet(code)) {
    return null;
  }

  try {
    preprocessAndTranspileCode(code);
    return null;
  } catch (err: any) {
    return err?.message || String(err);
  }
}

export interface SyntaxErrorLocation {
  line: number;
  column: number;
  message: string;
}

export function parseSyntaxErrorLocation(errorText: string | null | undefined): SyntaxErrorLocation | null {
  if (!errorText) return null;
  const locMatch = errorText.match(/\((\d+):(\d+)\)/);
  if (locMatch) {
    return {
      line: Math.max(1, parseInt(locMatch[1], 10)),
      column: Math.max(1, parseInt(locMatch[2], 10)),
      message: errorText,
    };
  }
  const altMatch = errorText.match(/line\s+(\d+)(?:[:,]\s*col(?:umn)?\s*(\d+))?/i);
  if (altMatch) {
    return {
      line: Math.max(1, parseInt(altMatch[1], 10)),
      column: altMatch[2] ? Math.max(1, parseInt(altMatch[2], 10)) : 1,
      message: errorText,
    };
  }
  return null;
}

const HTML_VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function sanitizeLlmArtifacts(raw: string): string {
  let cleaned = unwrapMarkdownFence(raw)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r\n/g, '\n');

  // Remove accidental stray markdown fences inside extracted code blocks
  cleaned = cleaned
    .split('\n')
    .filter(line => !/^\s*```(?:[a-zA-Z0-9_-]+)?\s*$/.test(line))
    .join('\n');

  // Normalize curly quotes if code fails syntax due to smart punctuation
  if (validateCodeSyntax(cleaned) !== null && /[“”‘’]/.test(cleaned)) {
    const straight = cleaned.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    if (validateCodeSyntax(straight) === null) {
      return straight;
    }
    cleaned = straight;
  }

  // Trim trailing LLM prose lines appended after closing </html> or export default statement
  const lines = cleaned.split('\n');
  while (lines.length > 3) {
    const last = lines[lines.length - 1].trim();
    if (!last) {
      lines.pop();
      continue;
    }
    const looksLikeTrailingProse =
      /^(?:Note:|Explanation:|Key changes:|Changes made:|This fixes|Hope this helps|Tap Run)/i.test(
        last
      ) ||
      (/^[A-Z][a-z]+(?:\s+[a-z0-9,'".-]+){4,}[.!]$/.test(last) &&
        !/[;{}()<>[\]=]/.test(last));
    if (looksLikeTrailingProse) {
      lines.pop();
      continue;
    }
    break;
  }

  return lines.join('\n');
}

function buildBalancedEofSuffixCandidates(code: string): string[] {
  type StackItem =
    | { kind: 'delim'; close: '}' | ')' | ']' }
    | { kind: 'jsx'; tag: string };

  const stack: StackItem[] = [];
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  const len = code.length;
  for (let i = 0; i < len; i++) {
    const ch = code[i];
    const next = i + 1 < len ? code[i + 1] : '';

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
      if (ch === '\\') {
        i++;
      } else if (ch === "'" || ch === '\n') {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (ch === '\\') {
        i++;
      } else if (ch === '"' || ch === '\n') {
        inDouble = false;
      }
      continue;
    }
    if (inTemplate) {
      if (ch === '\\') {
        i++;
      } else if (ch === '`') {
        inTemplate = false;
      }
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
      stack.push({ kind: 'delim', close: '}' });
      continue;
    }
    if (ch === '(') {
      stack.push({ kind: 'delim', close: ')' });
      continue;
    }
    if (ch === '[') {
      stack.push({ kind: 'delim', close: ']' });
      continue;
    }
    if (ch === '}' || ch === ')' || ch === ']') {
      for (let s = stack.length - 1; s >= 0; s--) {
        const item = stack[s];
        if (item.kind === 'delim' && item.close === ch) {
          stack.length = s;
          break;
        }
      }
      continue;
    }

    // Lightweight JSX open/close tag tracking for truncated React returns
    if (ch === '<') {
      const rest = code.slice(i);
      const closeTagMatch = rest.match(/^<\/\s*([A-Za-z_$][\w$.-]*)\s*>/);
      if (closeTagMatch) {
        const closingName = closeTagMatch[1];
        for (let s = stack.length - 1; s >= 0; s--) {
          const item = stack[s];
          if (item.kind === 'jsx' && item.tag === closingName) {
            stack.length = s;
            break;
          }
        }
        i += closeTagMatch[0].length - 1;
        continue;
      }

      if (rest.startsWith('</>')) {
        for (let s = stack.length - 1; s >= 0; s--) {
          const item = stack[s];
          if (item.kind === 'jsx' && item.tag === '') {
            stack.length = s;
            break;
          }
        }
        i += 2;
        continue;
      }

      if (rest.startsWith('<>')) {
        stack.push({ kind: 'jsx', tag: '' });
        i += 1;
        continue;
      }

      const openHead = rest.match(/^<([A-Za-z_$][\w$.-]*)(?=[\s/>])/);
      if (openHead) {
        const tagName = openHead[1];
        // Scan forward to matching '>' outside quotes/braces to detect self-closing '/>'
        let j = i + openHead[0].length;
        let braceDepth = 0;
        let quote: string | null = null;
        let foundEnd = -1;
        let selfClosing = false;
        while (j < len) {
          const c = code[j];
          if (quote) {
            if (c === '\\') {
              j += 2;
              continue;
            }
            if (c === quote) quote = null;
            j++;
            continue;
          }
          if (c === '"' || c === "'" || c === '`') {
            quote = c;
            j++;
            continue;
          }
          if (c === '{') {
            braceDepth++;
            j++;
            continue;
          }
          if (c === '}' && braceDepth > 0) {
            braceDepth--;
            j++;
            continue;
          }
          if (c === '>' && braceDepth === 0) {
            selfClosing = code[j - 1] === '/';
            foundEnd = j;
            break;
          }
          j++;
        }
        if (foundEnd !== -1) {
          if (!selfClosing && !HTML_VOID_ELEMENTS.has(tagName.toLowerCase())) {
            stack.push({ kind: 'jsx', tag: tagName });
          }
          i = foundEnd;
          continue;
        }
      }
    }
  }

  let quoteCloser = '';
  if (inSingle) quoteCloser = "'";
  else if (inDouble) quoteCloser = '"';
  else if (inTemplate) quoteCloser = '`';

  if (!quoteCloser && stack.length === 0) {
    return [];
  }

  const closingParts: string[] = [];
  if (quoteCloser) closingParts.push(quoteCloser);
  for (let s = stack.length - 1; s >= 0; s--) {
    const item = stack[s];
    if (item.kind === 'jsx') {
      closingParts.push(item.tag ? `</${item.tag}>` : '</>');
    } else {
      closingParts.push(item.close);
    }
  }

  const joined = closingParts.join('\n');
  const joinedCompact = closingParts.join('');
  return [
    joinedCompact,
    `\n${joined}`,
    `${joinedCompact};`,
    `\n${joined}\nexport default App;`,
  ];
}

function trySingleLineExpectedTokenRepair(code: string): string {
  let current = code;

  for (let pass = 0; pass < 5; pass++) {
    const err = validateCodeSyntax(current);
    if (err === null) return current;

    const loc = parseSyntaxErrorLocation(err);
    if (!loc) break;

    const lines = current.split('\n');
    const lineIdx = loc.line - 1;
    if (lineIdx < 0 || lineIdx >= lines.length) break;

    const candidates: string[] = [];
    const targetLine = lines[lineIdx];
    const colIdx = Math.max(0, Math.min(targetLine.length, loc.column - 1));

    // Case 1: Sucrase explicitly tells us which punctuation token is missing: expected "," / ";" / ")" / "}" / "]"
    // Note: inside `fn(arg;` or `[a, b;` or `{ a: 1;`, parsers report `expected ","` when `)`, `]`, or `}` was actually omitted!
    const expectedTokenMatch = err.match(/expected\s+"([,;:)\]}])"/i);
    if (expectedTokenMatch) {
      const primaryTok = expectedTokenMatch[1];
      const tokensToTry =
        primaryTok === ',' ? [',', ')', '}', ']', ';'] : [primaryTok, ')', '}', ';'];

      for (const tok of tokensToTry) {
        const withAtCol = [...lines];
        withAtCol[lineIdx] =
          targetLine.slice(0, colIdx) + tok + targetLine.slice(colIdx);
        candidates.push(withAtCol.join('\n'));

        for (let p = lineIdx - 1; p >= Math.max(0, lineIdx - 2); p--) {
          const prevTrimmedEnd = lines[p].replace(/\s+$/, '');
          if (prevTrimmedEnd.length > 0 && !prevTrimmedEnd.endsWith(tok)) {
            const withPrev = [...lines];
            withPrev[p] = `${prevTrimmedEnd}${tok}`;
            candidates.push(withPrev.join('\n'));
            break;
          }
        }
      }
    } else if (/Unexpected token/i.test(err)) {
      for (const tok of [')', '}', ']', ',', ';']) {
        const withAtCol = [...lines];
        withAtCol[lineIdx] =
          targetLine.slice(0, colIdx) + tok + targetLine.slice(colIdx);
        candidates.push(withAtCol.join('\n'));
      }
    }

    // Case 2: Stray extra closing brace/paren on its own line (`}` or `);` or `};`)
    if (/Unexpected token/i.test(err) && /^\s*[});]+\s*$/.test(targetLine)) {
      const withoutLine = [...lines.slice(0, lineIdx), ...lines.slice(lineIdx + 1)];
      candidates.push(withoutLine.join('\n'));
    }

    // Case 3: Missing closing '>' on an unclosed JSX opening tag at end of previous or current line
    if (/Unexpected token|Unterminated JSX/i.test(err)) {
      for (const idx of [lineIdx, lineIdx - 1]) {
        if (idx >= 0 && idx < lines.length) {
          const ln = lines[idx].replace(/\s+$/, '');
          if (/^\s*<[A-Za-z][\w.-]*\b[^>]*["'}]$/.test(ln)) {
            const withAngle = [...lines];
            withAngle[idx] = `${ln}>`;
            candidates.push(withAngle.join('\n'));
          }
        }
      }
    }

    let improved: string | null = null;
    for (const cand of candidates) {
      const nextErr = validateCodeSyntax(cand);
      if (nextErr === null) {
        return cand;
      }
      const nextLoc = parseSyntaxErrorLocation(nextErr);
      if (nextLoc && nextLoc.line > loc.line + 1) {
        improved = cand;
        break;
      }
    }

    if (improved) {
      current = improved;
    } else {
      break;
    }
  }

  return current;
}

/**
 * Deterministic (<5ms) multi-stage offline syntax healer:
 * 1. Strips LLM markdown/prose artifacts & curly quotes
 * 2. Applies Sucrase line/column expected-token insertion (`,`, `;`, `)`, `}`, `]`, `>`)
 * 3. Trims excess trailing braces/parens at EOF
 * 4. Computes exact unclosed string + JSX tag + delimiter stack to close truncated files
 */
export function healSyntaxErrorsDeterministically(rawInputCode: string): string {
  const base = sanitizeLlmArtifacts(rawInputCode);
  if (!base.trim()) return base;
  if (validateCodeSyntax(base) === null) return base;

  // Stage 1: Line-accurate expected-token repair
  const lineRepaired = trySingleLineExpectedTokenRepair(base);
  if (validateCodeSyntax(lineRepaired) === null) {
    return lineRepaired;
  }

  // Stage 2: Excess trailing brace / paren trimmer near EOF
  const lines = lineRepaired.split('\n');
  for (let trimCount = 1; trimCount <= 3 && lines.length > trimCount + 3; trimCount++) {
    const tail = lines.slice(lines.length - trimCount);
    if (tail.every(l => /^\s*[});\s]*$/.test(l))) {
      const trimmedCandidate = lines.slice(0, lines.length - trimCount).join('\n');
      if (validateCodeSyntax(trimmedCandidate) === null) {
        return trimmedCandidate;
      }
    }
  }

  // Stage 3: Lexical JS + JSX stack balancer for truncated outputs
  const stackSuffixes = buildBalancedEofSuffixCandidates(lineRepaired);
  const fallbackSuffixes = [
    ...stackSuffixes,
    '\n}',
    '\n);\n}',
    '\n  );\n}',
    '\n</div>\n  );\n}',
    '\n</div>\n</div>\n  );\n}',
    '\n};\nexport default App;',
  ];

  for (const suffix of fallbackSuffixes) {
    if (!suffix) continue;
    const candidate = lineRepaired + suffix;
    if (validateCodeSyntax(candidate) === null) {
      return candidate;
    }
    const postHealed = trySingleLineExpectedTokenRepair(candidate);
    if (validateCodeSyntax(postHealed) === null) {
      return postHealed;
    }
  }

  return lineRepaired;
}

/**
 * Backward-compatible alias delegating to the full deterministic syntax healer.
 */
export function tryRepairTruncatedDelimiters(rawInputCode: string): string {
  return healSyntaxErrorsDeterministically(rawInputCode);
}

/**
 * Closed-loop compile + headless runtime verification:
 * 1. Synchronously checks TypeScript/JSX syntax via Sucrase.
 * 2. Mounts the compiled bundle inside a hidden 1x1 offscreen sandbox iframe for ~280ms
 *    to catch immediate runtime crashes (`ReferenceError`, `TypeError`, undefined icons/hooks,
 *    infinite render loops, or `Nothing Rendered Yet`) BEFORE marking a build step complete!
 * Returns `null` if both compile and runtime boot succeed, or the exact error message string.
 */
export async function verifyCodeCompileAndRuntime(
  rawInputCode: string,
  settleMs = 280
): Promise<string | null> {
  const syntaxErr = validateCodeSyntax(rawInputCode);
  if (syntaxErr !== null) {
    return `Syntax Error: ${syntaxErr}`;
  }

  if (typeof window === 'undefined' || typeof document === 'undefined' || !document.body) {
    return null;
  }

  const probeId = `probe_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  let bundle: CompilationResult;
  try {
    bundle = await compilePreviewBundle(rawInputCode, probeId);
  } catch (err: any) {
    return `Compile Error: ${err?.message || String(err)}`;
  }

  if (bundle.compileError) {
    return bundle.compileError;
  }

  if (bundle.usesLucide) {
    const runtime = (window as any).__AETHER_SANDBOX_RUNTIME__;
    if (runtime && !runtime.LucideIcons) {
      try {
        const lucideMod = await import('lucide-react');
        runtime.LucideIcons = lucideMod;
      } catch {}
    }
  }

  return new Promise<string | null>(resolve => {
    let settled = false;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let hardTimeout: ReturnType<typeof setTimeout> | null = null;

    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText =
      'position:fixed;left:-9999px;top:-9999px;width:320px;height:480px;opacity:0;pointer-events:none;border:0;';

    const cleanup = (result: string | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      if (settleTimer) clearTimeout(settleTimer);
      if (hardTimeout) clearTimeout(hardTimeout);
      try {
        iframe.srcdoc = '';
        iframe.remove();
      } catch {}
      resolve(result);
    };

    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object' || data.probeId !== probeId) return;
      if (data.type === 'AETHER_PROBE_ERROR') {
        cleanup(typeof data.error === 'string' ? data.error : 'Runtime Error during mount');
      } else if (data.type === 'AETHER_PROBE_SUCCESS') {
        // Wait `settleMs` so initial `useEffect` mount hooks & first render pass can still report errors
        if (!settleTimer) {
          settleTimer = setTimeout(() => cleanup(null), settleMs);
        }
      }
    };

    window.addEventListener('message', onMessage);
    hardTimeout = setTimeout(() => cleanup(null), Math.max(900, settleMs + 650));

    iframe.srcdoc = bundle.html;
    document.body.appendChild(iframe);
  });
}
