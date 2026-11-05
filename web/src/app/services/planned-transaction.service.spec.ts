import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { api } from 'convex/_generated/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDateToString } from '../shared/utils/date-utils';
import { ConvexService } from './convex.service';
import { PlannedTransactionService } from './planned-transaction.service';
import { WorkspaceService } from './workspace.service';

describe('PlannedTransactionService calendar dates', () => {
  const workspace = signal<{ timezone?: string }>({ timezone: 'America/New_York' });
  const unsubscribe = vi.fn();
  const watchQuery = vi.fn(() => ({ subscribe: vi.fn(() => unsubscribe) }));

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T03:59:00Z'));
    workspace.set({ timezone: 'America/New_York' });
    watchQuery.mockClear();
    unsubscribe.mockClear();
    TestBed.configureTestingModule({
      providers: [
        { provide: ConvexService, useValue: { isAuthenticated: signal(true), watchQuery } },
        { provide: WorkspaceService, useValue: { workspaceId: signal('workspace-1'), workspace } },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('uses the workspace day instead of UTC for due and overdue calculations', () => {
    const service = TestBed.inject(PlannedTransactionService);
    TestBed.tick();

    expect(service.today()).toBe('2026-09-16');
    expect(watchQuery).toHaveBeenCalledWith(api.scheduledTransactions.listPlannedTransactionsData, {
      workspaceId: 'workspace-1',
      today: '2026-09-16',
    });
  });

  it('refreshes the subscription when midnight passes with the app open', async () => {
    const service = TestBed.inject(PlannedTransactionService);
    TestBed.tick();

    await vi.advanceTimersByTimeAsync(60_000);
    TestBed.tick();

    expect(service.today()).toBe('2026-09-17');
    expect(watchQuery).toHaveBeenCalledTimes(2);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(watchQuery).toHaveBeenLastCalledWith(api.scheduledTransactions.listPlannedTransactionsData, {
      workspaceId: 'workspace-1',
      today: '2026-09-17',
    });
  });

  it('recalculates today when the workspace timezone changes', () => {
    const service = TestBed.inject(PlannedTransactionService);
    TestBed.tick();

    workspace.set({ timezone: 'Asia/Tokyo' });
    TestBed.tick();

    expect(service.today()).toBe('2026-09-17');
    expect(watchQuery).toHaveBeenCalledTimes(2);
  });

  it('falls back to the device calendar date for an invalid timezone', () => {
    workspace.set({ timezone: 'invalid' });
    const service = TestBed.inject(PlannedTransactionService);

    expect(service.today()).toBe(formatDateToString(new Date()));
  });
});
