import { DOCUMENT } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CheckIn } from 'convex/userProfiles/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckInService } from './check-in.service';
import { LocalAuthService } from './local-auth.service';
import { ConvexService } from './convex.service';

describe('foreground check-ins', () => {
  const authenticated = signal(true);
  const session = signal<{ userId: string } | null>({ userId: 'user-1' });
  const bootstrap = vi.fn(async () => undefined);
  const mutation = vi.fn<() => Promise<CheckIn>>();
  let visibility: DocumentVisibilityState;
  let doc: Document;
  const checkIn: CheckIn = {
    days: 1,
    lastDate: '2026-09-08',
    timezone: 'America/New_York',
    startedAt: '2026-09-08T18:00:00Z',
  };

  async function flush() {
    TestBed.tick();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T18:00:00Z'));
    authenticated.set(true);
    session.set({ userId: 'user-1' });
    visibility = 'visible';
    bootstrap.mockReset().mockResolvedValue(undefined);
    mutation.mockReset().mockResolvedValue(checkIn);
    TestBed.configureTestingModule({
      providers: [
        CheckInService,
        { provide: LocalAuthService, useValue: { session } },
        {
          provide: ConvexService,
          useValue: {
            isAuthenticated: authenticated,
            ensureCurrentUserProfile: bootstrap,
            getClient: () => ({ mutation }),
          },
        },
      ],
    });
    doc = TestBed.inject(DOCUMENT);
    vi.spyOn(doc, 'visibilityState', 'get').mockImplementation(() => visibility);
    TestBed.inject(CheckInService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('records a restored signed-in session and deduplicates focus events', async () => {
    await flush();
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(mutation).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mutation).toHaveBeenCalledTimes(1);
  });

  it('waits until a hidden tab becomes visible', async () => {
    visibility = 'hidden';
    await flush();
    expect(mutation).not.toHaveBeenCalled();
    visibility = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(mutation).toHaveBeenCalledTimes(1);
  });

  it('does not record signed-out visits', async () => {
    authenticated.set(false);
    session.set(null);
    await flush();
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mutation).not.toHaveBeenCalled();
  });

  it('records again at account-local midnight with the tab still open', async () => {
    await flush();
    vi.setSystemTime(new Date('2026-09-09T03:58:00Z'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mutation).toHaveBeenCalledTimes(1);
    mutation.mockResolvedValue({ ...checkIn, days: 2, lastDate: '2026-09-09' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mutation).toHaveBeenCalledTimes(2);
  });

  it('retries a failed visit when the connection returns', async () => {
    mutation.mockRejectedValueOnce(new Error('Offline'));
    await flush();
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(mutation).toHaveBeenCalledTimes(2);
  });

  it('does not overlap pending calls and discards a prior account response', async () => {
    let finish: ((result: CheckIn) => void) | undefined;
    mutation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await flush();
    window.dispatchEvent(new Event('focus'));
    expect(mutation).toHaveBeenCalledTimes(1);
    session.set({ userId: 'user-2' });
    await flush();
    expect(mutation).toHaveBeenCalledTimes(2);
    finish?.({ ...checkIn, lastDate: '2026-09-10' });
    await flush();
    vi.setSystemTime(new Date('2026-09-09T18:00:00Z'));
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(mutation).toHaveBeenCalledTimes(3);
  });

  it('does not send a visit if the user signs out during profile bootstrap', async () => {
    let finish: (() => void) | undefined;
    bootstrap.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await flush();
    session.set(null);
    authenticated.set(false);
    await flush();
    finish?.();
    await flush();
    expect(mutation).not.toHaveBeenCalled();
  });
});
