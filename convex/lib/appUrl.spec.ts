import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAppUrl, DEFAULT_APP_BASE_URL, getAppBaseUrl, normalizeAppBaseUrl } from './appUrl';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('normalizeAppBaseUrl', () => {
  it.each([
    ['https://budget.example.test', 'https://budget.example.test'],
    ['  https://budget.example.test/  ', 'https://budget.example.test'],
    ['https://budget.example.test///', 'https://budget.example.test'],
    ['https://budget.example.test/app/?x=1#frag', 'https://budget.example.test/app'],
    ['http://192.168.1.20:4200', 'http://192.168.1.20:4200'],
  ])('normalizes %j', (raw, expected) => {
    expect(normalizeAppBaseUrl(raw)).toBe(expected);
  });

  it.each([undefined, null, '', '   ', 'not a url', 'javascript:alert(1)', 'ftp://budget.example.test'])(
    'rejects %j',
    (raw) => {
      expect(normalizeAppBaseUrl(raw)).toBeNull();
    }
  );
});

describe('getAppBaseUrl', () => {
  it('falls back to the local dev origin when KUALIA_APP_URL is unset', () => {
    vi.stubEnv('KUALIA_APP_URL', '');
    expect(DEFAULT_APP_BASE_URL).toBe('http://127.0.0.1:4200');
    expect(getAppBaseUrl()).toBe(DEFAULT_APP_BASE_URL);
  });

  it('falls back to the local dev origin when KUALIA_APP_URL is malformed', () => {
    vi.stubEnv('KUALIA_APP_URL', 'budget.example.test');
    expect(getAppBaseUrl()).toBe(DEFAULT_APP_BASE_URL);
  });

  it('uses KUALIA_APP_URL when configured', () => {
    vi.stubEnv('KUALIA_APP_URL', 'https://budget.example.test/');
    expect(getAppBaseUrl()).toBe('https://budget.example.test');
  });

  it('prefers an explicit value over the environment', () => {
    vi.stubEnv('KUALIA_APP_URL', 'https://budget.example.test');
    expect(getAppBaseUrl('https://other.example.test')).toBe('https://other.example.test');
  });

  it('never falls back to the retired hosted domain', () => {
    vi.stubEnv('KUALIA_APP_URL', '');
    expect(getAppBaseUrl()).not.toContain('kualia.com');
    expect(getAppBaseUrl('not a url')).not.toContain('kualia.com');
  });
});

describe('buildAppUrl', () => {
  it('joins absolute and relative paths onto the base URL', () => {
    vi.stubEnv('KUALIA_APP_URL', 'https://budget.example.test/');
    expect(buildAppUrl('/family/join/abc')).toBe('https://budget.example.test/family/join/abc');
    expect(buildAppUrl('images/logo.png')).toBe('https://budget.example.test/images/logo.png');
  });

  it('preserves a base path for apps served under a sub-path', () => {
    expect(buildAppUrl('/oauth/authorize', 'https://example.test/kualia/')).toBe(
      'https://example.test/kualia/oauth/authorize'
    );
  });

  it('uses the local dev origin by default', () => {
    vi.stubEnv('KUALIA_APP_URL', '');
    expect(buildAppUrl('/abc12345/settings/bank-connections')).toBe(
      'http://127.0.0.1:4200/abc12345/settings/bank-connections'
    );
  });
});
