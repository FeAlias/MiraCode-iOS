export interface Env {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
}

const HF_PREFIX = '/api/model-proxy/hf/';
const GH_PREFIX = '/api/model-proxy/gh/';

function resolveUpstreamUrl(pathname: string): string | null {
  if (pathname.startsWith(HF_PREFIX)) {
    const rest = pathname.slice(HF_PREFIX.length);
    // Restrict strictly to official MLC-AI model repositories on Hugging Face
    if (!rest.startsWith('mlc-ai/') || rest.includes('..')) {
      return null;
    }
    return `https://huggingface.co/${rest}`;
  }

  if (pathname.startsWith(GH_PREFIX)) {
    const rest = pathname.slice(GH_PREFIX.length);
    // Restrict strictly to official MLC-AI WebGPU WASM runtime libraries on GitHub
    if (!rest.startsWith('mlc-ai/binary-mlc-llm-libs/') || rest.includes('..')) {
      return null;
    }
    return `https://raw.githubusercontent.com/${rest}`;
  }

  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/model-proxy/ping') {
      return new Response(JSON.stringify({ ok: true, edgeProxy: true }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'X-Aether-Edge-Proxy': '1',
        },
      });
    }

    if (url.pathname.startsWith('/api/model-proxy/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', { status: 405 });
      }

      const upstreamUrl = resolveUpstreamUrl(url.pathname);
      if (!upstreamUrl) {
        return new Response('Forbidden upstream model path', { status: 403 });
      }

      const upstreamHeaders = new Headers();
      upstreamHeaders.set('User-Agent', 'AetherCode-Edge-Worker/1.0');
      const rangeHeader = request.headers.get('Range') || request.headers.get('range');
      if (rangeHeader) {
        upstreamHeaders.set('Range', rangeHeader);
      }

      try {
        const upstreamRes = await fetch(upstreamUrl, {
          method: request.method,
          headers: upstreamHeaders,
          redirect: 'follow',
        });

        const responseHeaders = new Headers();
        responseHeaders.set(
          'Content-Type',
          upstreamRes.headers.get('content-type') || 'application/octet-stream'
        );

        const contentLength = upstreamRes.headers.get('content-length');
        if (contentLength) {
          responseHeaders.set('Content-Length', contentLength);
        }

        const contentRange = upstreamRes.headers.get('content-range');
        if (contentRange) {
          responseHeaders.set('Content-Range', contentRange);
        }

        const acceptRanges = upstreamRes.headers.get('accept-ranges');
        if (acceptRanges) {
          responseHeaders.set('Accept-Ranges', acceptRanges);
        }

        responseHeaders.set('Cache-Control', 'no-store');
        responseHeaders.set('X-Aether-Edge-Proxy', '1');

        return new Response(upstreamRes.body, {
          status: upstreamRes.status,
          headers: responseHeaders,
        });
      } catch (err: any) {
        return new Response(
          `Edge proxy upstream fetch error: ${err?.message || String(err)}`,
          {
            status: 502,
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'X-Aether-Edge-Proxy': '1',
            },
          }
        );
      }
    }

    return env.ASSETS.fetch(request);
  },
};
