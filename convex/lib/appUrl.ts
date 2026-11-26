/**
 * Base URL of the Kualia web app, used for links the backend generates
 * (emails, invite links, MCP transaction links, OAuth redirects, static assets).
 *
 * Configure `KUALIA_APP_URL` in the Convex environment when the web app is
 * served from another origin. Without it, links point at the local dev server
 * started by `pnpm dev`; they never fall back to the retired hosted domains.
 */
export const KUALIA_APP_URL_ENV_VAR = 'KUALIA_APP_URL';
export const DEFAULT_APP_BASE_URL = 'http://127.0.0.1:4200';

/**
 * Normalizes an http(s) base URL: trims it, drops query/hash and trailing
 * slashes. Returns null for empty, malformed, or non-http(s) values.
 */
export function normalizeAppBaseUrl(raw: string | undefined | null): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (error: unknown) {
    void error;
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  parsed.hash = '';
  parsed.search = '';
  return parsed.toString().replace(/\/+$/, '');
}

/**
 * Returns the configured app base URL, or the local dev origin when
 * `KUALIA_APP_URL` is unset or invalid. `configured` overrides the env lookup
 * (useful for callers that already read it, and for tests).
 */
export function getAppBaseUrl(configured: string | undefined = process.env[KUALIA_APP_URL_ENV_VAR]): string {
  return normalizeAppBaseUrl(configured) ?? DEFAULT_APP_BASE_URL;
}

/** Joins an absolute app path (e.g. `/family/join/abc`) onto the app base URL. */
export function buildAppUrl(path: string, configured?: string): string {
  const base = getAppBaseUrl(configured);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}
