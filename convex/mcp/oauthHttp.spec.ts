import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionCtx } from '../_generated/server';
import { handleOAuthAuthorizationServerMetadataGet, handleOAuthAuthorizeGet } from './oauthHttp';

const unusedActionCtx = {} as ActionCtx;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('OAuth authorization endpoint compatibility', () => {
  it('advertises an authorization endpoint on the issuer origin', async () => {
    vi.stubEnv('KUALIA_APP_URL', 'https://app.kualia.com');
    const request = new Request('https://api.kualia.com/.well-known/oauth-authorization-server');

    const response = await handleOAuthAuthorizationServerMetadataGet(unusedActionCtx, request);
    const metadata = (await response.json()) as Record<string, unknown>;

    expect(metadata['issuer']).toBe('https://api.kualia.com');
    expect(metadata['authorization_endpoint']).toBe('https://api.kualia.com/oauth/authorize');
  });

  it('redirects authorization requests to the app while preserving OAuth parameters', async () => {
    vi.stubEnv('KUALIA_APP_URL', 'https://app.kualia.com');
    const request = new Request(
      'https://api.kualia.com/oauth/authorize?response_type=code&client_id=codex&state=state-123&scope=app%3Aread'
    );

    const response = await handleOAuthAuthorizeGet(unusedActionCtx, request);
    const redirectUrl = new URL(response.headers.get('location') ?? '');

    expect(response.status).toBe(302);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(redirectUrl.origin).toBe('https://app.kualia.com');
    expect(redirectUrl.pathname).toBe('/oauth/authorize');
    expect(redirectUrl.searchParams.get('response_type')).toBe('code');
    expect(redirectUrl.searchParams.get('client_id')).toBe('codex');
    expect(redirectUrl.searchParams.get('state')).toBe('state-123');
    expect(redirectUrl.searchParams.get('scope')).toBe('app:read');
  });
});
