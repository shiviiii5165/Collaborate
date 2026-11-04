/**
 * Exact-match browser origin policy for the Collaborate API.
 *
 * Allowed origins (exact scheme + host + port, no wildcards):
 *  1. Production frontends: https://collaborate.aitathastu.com, https://collaborate-umber.vercel.app
 *  2. Origins listed in NEXT_PUBLIC_APP_URL (comma-separated; already used for redirects)
 *  3. Explicitly approved previews in CORS_ALLOWED_ORIGINS (comma-separated exact origins)
 *  4. Outside production only: http://localhost:3000, :3001, :4000
 *
 * Requests WITHOUT an Origin header (server-to-server: the Vercel gateway's fetch,
 * AI Tathastu / payment webhooks, health checks) are not browser cross-origin requests
 * and are unaffected; they rely on their own authentication.
 */
const PRODUCTION_ORIGINS = ['https://collaborate.aitathastu.com', 'https://collaborate-umber.vercel.app'];
const DEV_ORIGINS = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:4000'];

/** Normalizes to an exact origin or returns null for anything malformed / non-http(s) / path-bearing. */
export function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, '');
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function listFromEnv(name: string): string[] {
  return (process.env[name] || '')
    .split(',')
    .map(normalizeOrigin)
    .filter((o): o is string => Boolean(o));
}

export function getAllowedOrigins(): Set<string> {
  const origins = new Set<string>(PRODUCTION_ORIGINS);
  for (const o of listFromEnv('NEXT_PUBLIC_APP_URL')) origins.add(o);
  for (const o of listFromEnv('CORS_ALLOWED_ORIGINS')) origins.add(o);
  if (process.env.NODE_ENV !== 'production') for (const o of DEV_ORIGINS) origins.add(o);
  return origins;
}

/** Exact comparison only. `Origin: null`, lookalike suffixes and other hosts are rejected. */
export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return false;
  // Compare the raw header against normalized entries: no case-folding or path tricks.
  return getAllowedOrigins().has(origin);
}
