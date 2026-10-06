/**
 * Cloudflare Pages KV when the project has a binding named ANALYTICS; otherwise a process-local
 * store so `wrangler pages dev` still shows `/api/stats` for the life of that process.
 */
import { MemoryStore, type AnalyticsStore, type ListPage } from './store';

export interface AnalyticsKv {
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<unknown>;
  get(key: string): Promise<string | null>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

export interface AnalyticsEnv {
  ANALYTICS?: AnalyticsKv;
}

class KvStore implements AnalyticsStore {
  readonly persistent = true;

  constructor(private kv: AnalyticsKv) {}

  put(key: string, value: string, expirationTtl?: number): Promise<void> {
    return this.kv.put(key, value, expirationTtl ? { expirationTtl } : undefined).then(() => undefined);
  }

  get(key: string): Promise<string | null> {
    return this.kv.get(key);
  }

  async list(prefix: string, cursor?: string): Promise<ListPage> {
    const page = await this.kv.list({ prefix, cursor, limit: 1000 });
    const done = page.list_complete || !page.cursor;
    return {
      keys: page.keys.map((key) => key.name),
      done,
      cursor: done ? undefined : page.cursor,
    };
  }
}

const memoryKey = '__unseenAnalytics';

function sharedMemory(): MemoryStore {
  const scope = globalThis as typeof globalThis & { [memoryKey]?: MemoryStore };
  return (scope[memoryKey] ??= new MemoryStore());
}

export function storeFromEnv(env: AnalyticsEnv): AnalyticsStore {
  return env.ANALYTICS ? new KvStore(env.ANALYTICS) : sharedMemory();
}
