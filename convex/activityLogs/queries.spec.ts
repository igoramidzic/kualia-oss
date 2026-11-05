import { describe, expect, it, vi } from 'vitest';

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

import { BUDGET_HISTORY_LIMIT, getBudgetHistory } from './queries';

describe('getBudgetHistory', () => {
  it('uses the assignment activity index, inclusive cutoff, descending order, and result limit', async () => {
    const workspaceId = 'workspace_1' as Id<'workspace'>;
    const since = '2026-06-07T12:00:00.000Z';
    const rows = Array.from({ length: BUDGET_HISTORY_LIMIT + 1 }, (_, index) => ({
      _id: `activity_${index}`,
    })) as Doc<'activityLog'>[];
    const indexConditions: [operator: 'eq' | 'gte', field: string, value: unknown][] = [];
    const indexBuilder = {
      eq(field: string, value: unknown) {
        indexConditions.push(['eq', field, value]);
        return indexBuilder;
      },
      gte(field: string, value: unknown) {
        indexConditions.push(['gte', field, value]);
        return indexBuilder;
      },
    };
    const take = vi.fn().mockResolvedValue(rows);
    const order = vi.fn().mockReturnValue({ take });
    const withIndex = vi.fn((_: string, buildRange: (builder: typeof indexBuilder) => typeof indexBuilder) => {
      buildRange(indexBuilder);
      return { order };
    });
    const query = vi.fn().mockReturnValue({ withIndex });
    const ctx = { db: { query } } as unknown as QueryCtx;

    const result = await getBudgetHistory(ctx, workspaceId, since);

    expect(result.entries).toEqual(rows.slice(0, BUDGET_HISTORY_LIMIT));
    expect(result.hasMore).toBe(true);
    expect(query).toHaveBeenCalledWith('activityLog');
    expect(withIndex).toHaveBeenCalledWith('by_workspaceId_and_type_and_occurredAt', expect.any(Function));
    expect(indexConditions).toEqual([
      ['eq', 'workspaceId', workspaceId],
      ['eq', 'type', 'money_moved'],
      ['gte', 'occurredAt', since],
    ]);
    expect(order).toHaveBeenCalledWith('desc');
    expect(take).toHaveBeenCalledWith(BUDGET_HISTORY_LIMIT + 1);
  });
});
