/** Simple in-memory TTL cache — persists across requests in the Express process */
interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number;
}

const store = new Map<string, CacheEntry>();

export function cacheGet(key: string): any | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > entry.ttl) {
    store.delete(key);
    return null;
  }
  return entry.data;
}

export function cacheSet(key: string, data: any, ttlMs: number): void {
  store.set(key, { data, timestamp: Date.now(), ttl: ttlMs });
}

/** Get stale data even if TTL expired — for fallback on upstream errors */
export function cacheGetStale(key: string): any | null {
  const entry = store.get(key);
  return entry?.data ?? null;
}

export function cacheStats(): { keys: number; entries: string[] } {
  return {
    keys: store.size,
    entries: Array.from(store.keys()),
  };
}
