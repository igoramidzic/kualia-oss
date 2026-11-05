import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConvexService } from './convex.service';
import { LocalAuthService } from './local-auth.service';

const client = vi.hoisted(() => ({ setAuth: vi.fn() }));
vi.mock('convex/browser', () => ({
  ConvexClient: class {
    setAuth = client.setAuth;
  },
}));

describe('Convex authentication synchronization', () => {
  beforeEach(() => vi.clearAllMocks());
  it('does not reinstall the token fetcher when the same user rotates a session token', () => {
    const user = signal<{ id: string } | null>({ id: 'user1' });
    const session = signal({ token: 'first-token', userId: 'user1' });
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: LocalAuthService, useValue: { user, session, getConvexToken: vi.fn() } },
      ],
    });
    TestBed.inject(ConvexService);
    TestBed.tick();
    expect(client.setAuth).toHaveBeenCalledTimes(1);
    user.set({ id: 'user1' });
    session.set({ token: 'rotated-token', userId: 'user1' });
    TestBed.tick();
    expect(client.setAuth).toHaveBeenCalledTimes(1);
    user.set(null);
    TestBed.tick();
    expect(client.setAuth).toHaveBeenCalledTimes(2);
  });
});
