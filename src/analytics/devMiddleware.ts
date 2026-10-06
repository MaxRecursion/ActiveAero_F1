/**
 * Same collect and stats routes the Cloudflare function serves, for `vite` and `vite preview`.
 */
import type { Plugin } from 'vite';
import { handleAnalytics } from './server.ts';
import { MemoryStore } from './store.ts';

interface NodeRequest {
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  on(event: 'data', listener: (chunk: Uint8Array | string) => void): void;
  on(event: 'end', listener: () => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
}

interface NodeResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: Uint8Array | string): void;
}

function analyticsPath(url: string | undefined): '/api/collect' | '/api/stats' | null {
  const path = (url ?? '').split('?')[0] ?? '';
  if (path === '/api/collect' || path.endsWith('/api/collect')) return '/api/collect';
  if (path === '/api/stats' || path.endsWith('/api/stats')) return '/api/stats';
  return null;
}

function readBody(req: NodeRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const parts: string[] = [];
    req.on('data', (chunk) => {
      parts.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
      if (parts.join('').length > 4096) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(parts.join('')));
    req.on('error', reject);
  });
}

function headerValue(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join(', ');
  return null;
}

async function serve(req: NodeRequest, res: NodeResponse, store: MemoryStore): Promise<boolean> {
  const pathname = analyticsPath(req.url);
  if (!pathname) return false;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    const joined = headerValue(value);
    if (joined) headers.set(name, joined);
  }
  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const request = new Request(`http://${headerValue(req.headers.host) ?? 'localhost'}${req.url ?? pathname}`, {
    method,
    headers,
    body: hasBody ? await readBody(req) : undefined,
  });
  const response = await handleAnalytics(request, store, pathname);
  res.statusCode = response?.status ?? 404;
  response?.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(new Uint8Array(await (response ?? new Response('not found')).arrayBuffer()));
  return true;
}

export function analyticsDevPlugin(): Plugin {
  const store = new MemoryStore();
  return {
    name: 'unseen-analytics',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void serve(req as unknown as NodeRequest, res as unknown as NodeResponse, store).then(
          (handled) => {
            if (!handled) next();
          },
          (err) => next(err),
        );
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        void serve(req as unknown as NodeRequest, res as unknown as NodeResponse, store).then(
          (handled) => {
            if (!handled) next();
          },
          (err) => next(err),
        );
      });
    },
  };
}
