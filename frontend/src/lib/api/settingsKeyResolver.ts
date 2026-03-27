/**
 * Resolves API keys from environment variables with DB fallback.
 * Priority: env var → backend admin settings DB (60s cache via Next.js fetch cache)
 */

const INTERNAL_API = process.env.INTERNAL_API_URL ?? "http://localhost:8000";

type SettingsShape = {
  connections?: Record<string, string>;
  images?: Record<string, string>;
};

async function fetchAdminSettings(authHeader: string): Promise<SettingsShape> {
  try {
    const res = await fetch(`${INTERNAL_API}/api/v1/admin/settings`, {
      headers: { Authorization: authHeader },
      next: { revalidate: 10 },
    });
    if (res.ok) {
      return await res.json() as SettingsShape;
    }
  } catch { /* backend unreachable */ }
  return {};
}

/**
 * Resolve a key with priority: envVar → settings[section][field] → settings[fallbackSection][fallbackField]
 */
export async function resolveSettingsKey(
  authHeader: string,
  envVar: string | undefined,
  primary: { section: keyof SettingsShape; field: string },
  fallback?: { section: keyof SettingsShape; field: string },
): Promise<string> {
  if (envVar) return envVar;
  const s = await fetchAdminSettings(authHeader);
  const primaryVal = (s[primary.section] as Record<string, string> | undefined)?.[primary.field];
  if (primaryVal) return primaryVal;
  if (fallback) {
    return (s[fallback.section] as Record<string, string> | undefined)?.[fallback.field] ?? "";
  }
  return "";
}
