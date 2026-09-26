import { LRUCache } from 'lru-cache';

const store = new LRUCache<string, object>({ max: 200, ttl: 1000 * 60 * 60 * 6 });
const inflight = new Map<string, Promise<object>>();

/** Memoize an async call by key. Concurrent callers share one in-flight request. */
export async function cached<T extends object>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit) return hit as T;
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const p = fn()
    .then((value) => {
      store.set(key, value, { ttl: ttlMs });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export const HOUR = 1000 * 60 * 60;
