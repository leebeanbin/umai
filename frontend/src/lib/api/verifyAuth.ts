/**
 * Server-side token verification utility for Next.js API routes.
 * Verifies a Bearer token against the backend /auth/me endpoint.
 *
 * Results are cached in process memory for VALID_TTL / INVALID_TTL ms to avoid
 * a backend round-trip on every proxied request. The cache is bounded at
 * MAX_ENTRIES; expired entries are evicted when it fills.
 */

const INTERNAL_API = process.env.INTERNAL_API_URL ?? "http://localhost:8000";

const VALID_TTL   = 60_000;  // 60 s — safe; well below typical JWT expiry
const INVALID_TTL =  5_000;  // 5 s  — limits repeated bad-token hammering
const MAX_ENTRIES = 1_000;

type CacheEntry = { valid: boolean; exp: number };
const cache = new Map<string, CacheEntry>();

function evict() {
  if (cache.size < MAX_ENTRIES) return;
  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.exp < now) cache.delete(k);
    if (cache.size < MAX_ENTRIES * 0.75) break;
  }
}

export async function verifyToken(authHeader: string | null): Promise<boolean> {
  if (!authHeader?.startsWith("Bearer ")) return false;

  const now    = Date.now();
  const cached = cache.get(authHeader);
  if (cached && cached.exp > now) return cached.valid;

  evict();

  try {
    const res = await fetch(`${INTERNAL_API}/api/v1/auth/me`, {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(3000),
    });
    const valid = res.ok;
    cache.set(authHeader, { valid, exp: now + (valid ? VALID_TTL : INVALID_TTL) });
    return valid;
  } catch {
    return false;
  }
}
