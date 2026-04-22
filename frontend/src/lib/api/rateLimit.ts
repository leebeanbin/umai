/**
 * In-process sliding-window rate limiter for Next.js API routes.
 *
 * Each (key, namespace) pair gets its own counter that resets after windowMs.
 * "key" should be a stable per-user identifier — we use the Bearer token since
 * we don't decode the JWT on the Next.js side.
 *
 * The store is bounded at MAX_ENTRIES; expired windows are evicted on overflow.
 */

type Window = { count: number; reset: number };
const store = new Map<string, Window>();
const MAX_ENTRIES = 5_000;

function evict() {
  if (store.size < MAX_ENTRIES) return;
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.reset < now) store.delete(k);
    if (store.size < MAX_ENTRIES * 0.75) break;
  }
}

/**
 * Returns true if the request is within the rate limit, false if it should
 * be rejected (429).
 *
 * @param namespace  Route identifier so limits don't bleed across routes.
 * @param key        Per-user key (auth header / IP / etc.).
 * @param limit      Max requests allowed per window.
 * @param windowMs   Window size in milliseconds.
 */
export function checkRateLimit(
  namespace: string,
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  evict();
  const storeKey = `${namespace}:${key}`;
  const now      = Date.now();
  const win      = store.get(storeKey);

  if (!win || win.reset < now) {
    store.set(storeKey, { count: 1, reset: now + windowMs });
    return true;
  }

  if (win.count >= limit) return false;
  win.count++;
  return true;
}
