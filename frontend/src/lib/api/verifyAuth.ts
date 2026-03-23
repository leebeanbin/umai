/**
 * Server-side token verification utility for Next.js API routes.
 * Verifies a Bearer token against the backend /auth/me endpoint.
 */

const INTERNAL_API = process.env.INTERNAL_API_URL ?? "http://localhost:8000";

export async function verifyToken(authHeader: string | null): Promise<boolean> {
  if (!authHeader?.startsWith("Bearer ")) return false;
  try {
    const res = await fetch(`${INTERNAL_API}/api/v1/auth/me`, {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
