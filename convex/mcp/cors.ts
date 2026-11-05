/**
 * CORS support for the MCP + OAuth HTTP endpoints.
 *
 * Browser-based MCP clients (e.g. claude.ai on the web) send a CORS preflight
 * `OPTIONS` request before POSTing to `/mcp`, and require `Access-Control-*`
 * headers on the actual responses. Native clients (Claude Desktop, curl) don't
 * enforce CORS, which is why the endpoint works everywhere except the web app
 * without these headers. The `WWW-Authenticate` header must be exposed so the
 * browser can read it off the 401 and start the OAuth flow.
 */

const ALLOWED_METHODS = 'GET, POST, DELETE, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, Authorization, MCP-Protocol-Version, Mcp-Session-Id, Accept, Last-Event-ID';
const EXPOSED_HEADERS = 'WWW-Authenticate, Mcp-Session-Id';

export function corsHeaders(request: Request): Record<string, string> {
  // Reflect the caller's Origin when present (falling back to `*` for
  // non-browser callers). These are public, bearer-token endpoints with no
  // cookie auth, so we never set Access-Control-Allow-Credentials.
  const origin = request.headers.get('origin');
  return {
    'access-control-allow-origin': origin ?? '*',
    'access-control-allow-methods': ALLOWED_METHODS,
    'access-control-allow-headers': ALLOWED_HEADERS,
    'access-control-expose-headers': EXPOSED_HEADERS,
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

/** Merge CORS headers onto an existing response, preserving its body and headers. */
export function withCors(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request))) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Answer a CORS preflight `OPTIONS` request. */
export function handleCorsPreflight(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}
