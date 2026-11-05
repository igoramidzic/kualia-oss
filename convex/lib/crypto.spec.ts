import { describe, expect, it } from 'vitest';

import { generateMcpTokenValue, generateOpaqueToken, sha256Base64Url, sha256Hex } from './crypto';

describe('sha256Hex', () => {
  it('matches known SHA-256 test vectors', async () => {
    // Standard NIST vectors for the empty string and "abc".
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('produces 64 lowercase hex characters', async () => {
    expect(await sha256Hex('kualia_deadbeef')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic and collision-sensitive to input', async () => {
    expect(await sha256Hex('same')).toBe(await sha256Hex('same'));
    expect(await sha256Hex('key-a')).not.toBe(await sha256Hex('key-b'));
  });
});

describe('sha256Base64Url', () => {
  it('matches the known base64url vector for "abc"', async () => {
    expect(await sha256Base64Url('abc')).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
  });

  it('emits url-safe characters with no padding', async () => {
    const encoded = await sha256Base64Url('some-verifier-value');
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded).not.toContain('=');
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
  });
});

describe('generateOpaqueToken', () => {
  it('prefixes the token and appends 64 hex chars (32 random bytes)', () => {
    const token = generateOpaqueToken('kualia_');
    expect(token).toMatch(/^kualia_[0-9a-f]{64}$/);
  });

  it('works with an empty prefix', () => {
    expect(generateOpaqueToken('')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns a fresh value on every call', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateOpaqueToken('kualia_')));
    expect(tokens.size).toBe(50);
  });
});

describe('generateMcpTokenValue', () => {
  it('uses the kualia_mcp_ prefix', () => {
    expect(generateMcpTokenValue()).toMatch(/^kualia_mcp_[0-9a-f]{64}$/);
  });
});
