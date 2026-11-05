import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalAuthService } from './local-auth.service';

const http = vi.hoisted(() => ({ action: vi.fn(), setAuth: vi.fn(), clearAuth: vi.fn() }));
vi.mock('convex/browser', () => ({
  ConvexHttpClient: class {
    action = http.action;
    setAuth = http.setAuth;
    clearAuth = http.clearAuth;
  },
}));

const storageKey = 'kualia.auth.http://127.0.0.1:3210';
function tokens(seconds = 3600, session = 'session1') {
  const payload = {
    sub: `user1|${session}`,
    email: 'local@example.test',
    exp: Math.floor(Date.now() / 1000) + seconds,
  };
  return {
    token: `${btoa('{}')}.${btoa(JSON.stringify(payload))}.test-signature`,
    refreshToken: `test-refresh-${session}`,
  };
}

describe('LocalAuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async (_name: string, callback: () => Promise<string | null>) => callback(),
      },
    });
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: Router, useValue: { navigate: vi.fn().mockResolvedValue(true) } },
      ],
    });
  });

  it('signs up through the password provider and stores a stable user ID', async () => {
    http.action.mockResolvedValue({ tokens: tokens() });
    const service = TestBed.inject(LocalAuthService);
    expect(await service.signInWithPassword('local@example.test', 'example-password', 'signUp')).toEqual({
      success: true,
    });
    expect(http.action).toHaveBeenCalledWith(expect.anything(), {
      provider: 'password',
      params: { email: 'local@example.test', password: 'example-password', flow: 'signUp' },
    });
    expect(service.user()?.id).toBe('user1');
    expect(service.user()?.emailVerified).toBe(false);
    expect(service.session()?.userId).toBe('user1');
  });

  it('restores a valid saved session without a refresh request', async () => {
    const saved = tokens();
    localStorage.setItem(storageKey, JSON.stringify(saved));
    const service = TestBed.inject(LocalAuthService);
    await Promise.resolve();
    expect(await service.getConvexToken()).toBe(saved.token);
    expect(http.action).not.toHaveBeenCalled();
    expect(service.isAuthenticated()).toBe(true);
  });

  it('serializes simultaneous refresh calls and stores the rotated token', async () => {
    const saved = tokens(-1);
    const rotated = tokens(3600, 'session2');
    localStorage.setItem(storageKey, JSON.stringify(saved));
    http.action.mockResolvedValue({ tokens: rotated });
    const service = TestBed.inject(LocalAuthService);
    const result = await Promise.all([service.getConvexToken(), service.getConvexToken()]);
    expect(result).toEqual([rotated.token, rotated.token]);
    expect(http.action).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(storageKey) ?? '{}')).toEqual(rotated);
    expect(service.user()?.id).toBe('user1');
  });

  it('clears a rejected refresh and malformed persisted sessions', async () => {
    localStorage.setItem(storageKey, JSON.stringify(tokens(-1)));
    http.action.mockRejectedValue(new Error('invalid refresh'));
    const service = TestBed.inject(LocalAuthService);
    expect(await service.getConvexToken()).toBeNull();
    expect(service.user()).toBeNull();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it('does not reveal provider errors or save credentials after a failed sign-in', async () => {
    http.action.mockRejectedValue(new Error('Account does not exist: private detail'));
    const service = TestBed.inject(LocalAuthService);
    const result = await service.signInWithPassword('local@example.test', 'wrong-password', 'signIn');
    expect(result.success).toBe(false);
    expect(result.error).not.toContain('private detail');
    expect(service.user()).toBeNull();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it('invalidates the server session and clears local state on logout', async () => {
    localStorage.setItem(storageKey, JSON.stringify(tokens()));
    http.action.mockResolvedValue(null);
    const service = TestBed.inject(LocalAuthService);
    await service.logout();
    expect(http.action).toHaveBeenCalledWith(expect.anything(), {});
    expect(service.user()).toBeNull();
    expect(service.session()).toBeNull();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });
});
