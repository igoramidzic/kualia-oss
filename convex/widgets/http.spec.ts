import { afterEach, describe, expect, it, vi } from 'vitest';

import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { validateWidgetToken } from './helpers';
import { handleBudgetPulse } from './http';

describe('Budget Pulse HTTP boundary', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rejects missing credentials without reading budget data', async () => {
    const runQuery = vi.fn();
    const response = await handleBudgetPulse(
      { runQuery } as unknown as ActionCtx,
      new Request('https://example.com/widget/budget-pulse', { method: 'POST' })
    );
    expect(response.status).toBe(401);
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('returns unauthorized when the atomic token and snapshot query rejects access', async () => {
    const runQuery = vi.fn().mockResolvedValue(null);
    const response = await handleBudgetPulse(
      { runQuery } as unknown as ActionCtx,
      new Request('https://example.com/widget/budget-pulse', {
        method: 'POST',
        headers: { Authorization: 'Bearer revoked' },
      })
    );
    expect(response.status).toBe(401);
  });

  it('ignores client workspace/date overrides and sends the action clock to its authorized query', async () => {
    const now = Date.parse('2026-09-07T12:00:00Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const runQuery = vi.fn().mockResolvedValue({ workspaceName: 'Personal', today: '2026-09-07' });
    const response = await handleBudgetPulse(
      { runQuery } as unknown as ActionCtx,
      new Request('https://example.com/widget/budget-pulse', {
        method: 'POST',
        headers: { Authorization: 'Bearer secret_token' },
        body: JSON.stringify({ workspaceId: 'foreign_workspace', localDate: '2020-01-01', now: 1 }),
      })
    );
    expect(runQuery).toHaveBeenCalledExactlyOnceWith(internal.widgets.queries.getBudgetPulseForWidget, {
      token: 'secret_token',
      now,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ workspaceName: 'Personal', today: '2026-09-07' });
  });
});

describe('widget usage recording', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['2026-09-09T12:00:00.000Z', false],
    ['2026-09-09T11:30:00.001Z', false],
    ['2026-09-09T11:30:00.000Z', true],
    [undefined, true],
    ['invalid', true],
  ])('records %s only when usage metadata is stale', async (lastUsedAt, writes) => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-09T12:30:00.000Z'));
    const runQuery = vi.fn().mockResolvedValue({
      _id: 'widget_token',
      workspaceId: 'workspace_1',
      clerkId: 'owner',
      isRevoked: false,
      lastUsedAt,
    });
    const runMutation = vi.fn().mockResolvedValue(null);
    await expect(validateWidgetToken({ runQuery, runMutation } as unknown as ActionCtx, 'secret')).resolves.toEqual({
      clerkId: 'owner',
      workspaceId: 'workspace_1',
    });
    expect(runQuery).toHaveBeenCalledExactlyOnceWith(internal.widgets.queries.getWidgetTokenByToken, {
      token: 'secret',
    });
    expect(runMutation).toHaveBeenCalledTimes(writes ? 1 : 0);
  });
});
