import { ConvexError } from 'convex/values';

import { APP_READ_SCOPE, BUDGETS_WRITE_SCOPE, LEGACY_REPORTS_READ_SCOPE, TRANSACTIONS_WRITE_SCOPE } from './tools';

export const OAUTH_CODE_CHALLENGE_METHOD = 'S256' as const;
export const OAUTH_TOKEN_ENDPOINT_AUTH_METHOD = 'none' as const;
export const OAUTH_GRANT_TYPES = ['authorization_code', 'refresh_token'] as const;
export const OAUTH_RESPONSE_TYPES = ['code'] as const;

export const OAUTH_AUTH_CODE_TTL_SECONDS = 10 * 60;
export const OAUTH_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const OAUTH_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

const PKCE_CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const SUPPORTED_SCOPES = [APP_READ_SCOPE, BUDGETS_WRITE_SCOPE, TRANSACTIONS_WRITE_SCOPE] as const;

export function normalizeScope(scope: string | undefined): string[] {
  if (!scope || scope.trim().length === 0) {
    return [APP_READ_SCOPE];
  }

  const requestedScopes = scope
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const normalizedScopes = requestedScopes.map((item) => (item === LEGACY_REPORTS_READ_SCOPE ? APP_READ_SCOPE : item));
  const uniqueScopes = [...new Set(normalizedScopes)];
  if (uniqueScopes.length === 0) {
    return [APP_READ_SCOPE];
  }

  const unsupportedScope = uniqueScopes.find(
    (item) => !SUPPORTED_SCOPES.includes(item as (typeof SUPPORTED_SCOPES)[number])
  );
  if (unsupportedScope) {
    throw new ConvexError(`Unsupported scope: ${unsupportedScope}`);
  }

  return uniqueScopes;
}

export function validateClientId(clientId: string): string {
  const trimmed = clientId.trim();
  if (!trimmed) {
    throw new ConvexError('client_id is required');
  }

  if (trimmed.length > 200) {
    throw new ConvexError('client_id is too long');
  }

  return trimmed;
}

export function validateRedirectUri(redirectUri: string): string {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new ConvexError('redirect_uri must be a valid URL');
  }

  // https: claimed-URL redirects (web clients).
  if (parsed.protocol === 'https:') {
    return parsed.toString();
  }

  // http: is only allowed for loopback redirects (native apps, RFC 8252 §7.3).
  const isLoopback =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '::1' ||
    parsed.hostname === '[::1]';
  if (parsed.protocol === 'http:' && isLoopback) {
    return parsed.toString();
  }

  // Reject cleartext http on non-loopback hosts, but accept private-use URI schemes
  // (RFC 8252 §7.1) such as a native app's deep-link callback (e.g. Claude Desktop's
  // `claude://...`). Security is enforced by exact-match against the client's registered
  // redirect URIs plus PKCE at authorize/token time, not by disallowing custom schemes —
  // so a single custom-scheme URI must not fail the whole client registration.
  if (parsed.protocol === 'http:') {
    throw new ConvexError('redirect_uri must use https, a loopback http address, or a private-use URI scheme');
  }

  return parsed.toString();
}

export function validateCodeChallenge(codeChallenge: string): string {
  const trimmed = codeChallenge.trim();
  if (!PKCE_CODE_CHALLENGE_PATTERN.test(trimmed)) {
    throw new ConvexError('code_challenge must be 43-128 URL-safe characters');
  }

  return trimmed;
}

export function validateCodeChallengeMethod(codeChallengeMethod: string): typeof OAUTH_CODE_CHALLENGE_METHOD {
  if (codeChallengeMethod !== OAUTH_CODE_CHALLENGE_METHOD) {
    throw new ConvexError(`code_challenge_method must be ${OAUTH_CODE_CHALLENGE_METHOD}`);
  }

  return OAUTH_CODE_CHALLENGE_METHOD;
}

export function validateCodeVerifier(codeVerifier: string): string {
  const trimmed = codeVerifier.trim();
  if (!PKCE_CODE_CHALLENGE_PATTERN.test(trimmed)) {
    throw new ConvexError('code_verifier must be 43-128 URL-safe characters');
  }

  return trimmed;
}

export function formatScopes(scopes: string[]): string {
  return scopes.join(' ');
}

export function validateTokenEndpointAuthMethod(tokenEndpointAuthMethod: string | undefined): string {
  if (!tokenEndpointAuthMethod) {
    return OAUTH_TOKEN_ENDPOINT_AUTH_METHOD;
  }

  if (tokenEndpointAuthMethod !== OAUTH_TOKEN_ENDPOINT_AUTH_METHOD) {
    throw new ConvexError(`token_endpoint_auth_method must be ${OAUTH_TOKEN_ENDPOINT_AUTH_METHOD}`);
  }

  return OAUTH_TOKEN_ENDPOINT_AUTH_METHOD;
}

export function normalizeGrantTypes(grantTypes: string[] | undefined): string[] {
  if (!grantTypes || grantTypes.length === 0) {
    return [...OAUTH_GRANT_TYPES];
  }

  const uniqueGrantTypes = [...new Set(grantTypes.map((item) => item.trim()).filter((item) => item.length > 0))];
  if (uniqueGrantTypes.length === 0) {
    return [...OAUTH_GRANT_TYPES];
  }

  const unsupportedGrantType = uniqueGrantTypes.find((item) => !OAUTH_GRANT_TYPES.includes(item as never));
  if (unsupportedGrantType) {
    throw new ConvexError(`Unsupported grant_type: ${unsupportedGrantType}`);
  }

  if (!uniqueGrantTypes.includes('authorization_code')) {
    throw new ConvexError('grant_types must include authorization_code');
  }

  return uniqueGrantTypes;
}

export function normalizeResponseTypes(responseTypes: string[] | undefined): string[] {
  if (!responseTypes || responseTypes.length === 0) {
    return [...OAUTH_RESPONSE_TYPES];
  }

  const uniqueResponseTypes = [...new Set(responseTypes.map((item) => item.trim()).filter((item) => item.length > 0))];
  if (uniqueResponseTypes.length === 0) {
    return [...OAUTH_RESPONSE_TYPES];
  }

  const unsupportedResponseType = uniqueResponseTypes.find((item) => !OAUTH_RESPONSE_TYPES.includes(item as never));
  if (unsupportedResponseType) {
    throw new ConvexError(`Unsupported response_type: ${unsupportedResponseType}`);
  }

  if (!uniqueResponseTypes.includes('code')) {
    throw new ConvexError('response_types must include code');
  }

  return uniqueResponseTypes;
}

export function plusSecondsIso(nowMs: number, seconds: number): string {
  return new Date(nowMs + seconds * 1000).toISOString();
}
