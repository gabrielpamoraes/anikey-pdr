/**
 * Minimal fixed-window rate limiter, in memory.
 *
 * Good enough for a single instance and as a brake on password guessing / signing-link probing.
 * When running several instances, swap `store` for a shared one (Redis/Upstash) behind the same function.
 */
type Entry = { count: number; resetAt: number };
const store = new Map<string, Entry>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const entry = store.get(key);
  if (!entry || entry.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    if (store.size > 10_000) {
      for (const [k, v] of store) if (v.resetAt <= now) store.delete(k);
    }
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}

export function resetRateLimits(): void {
  store.clear();
}
