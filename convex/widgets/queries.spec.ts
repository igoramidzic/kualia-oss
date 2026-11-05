import { describe, expect, it } from 'vitest';

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import {
  buildWidgetBudgetPulse,
  getAuthorizedWidgetTokenByToken,
  getBudgetPulseForWidget,
  type WidgetBudgetPulse,
} from './queries';

type TableName = 'widgetToken' | 'workspace' | 'familyGroup' | 'familyGroupMember' | 'category' | 'categoryBudget';
type FakeRecord = Record<string, unknown> & { _id: string };
type FakeFilter = { field: string; value: unknown };

class FakeIndexBuilder {
  readonly filters: FakeFilter[] = [];

  eq(field: string, value: unknown): FakeIndexBuilder {
    this.filters.push({ field, value });
    return this;
  }
}

class FakeQuery {
  constructor(
    private readonly records: FakeRecord[],
    private readonly filters: FakeFilter[] = []
  ) {}

  withIndex(_indexName: string, callback: (q: FakeIndexBuilder) => FakeIndexBuilder): FakeQuery {
    const builder = new FakeIndexBuilder();
    callback(builder);
    return new FakeQuery(this.records, builder.filters);
  }

  async first(): Promise<FakeRecord | null> {
    return this.records.find((record) => this.filters.every((filter) => record[filter.field] === filter.value)) ?? null;
  }

  async take(limit: number): Promise<FakeRecord[]> {
    return this.records
      .filter((record) => this.filters.every((filter) => record[filter.field] === filter.value))
      .slice(0, limit);
  }
}

class FakeDb {
  constructor(private readonly recordsByTable: Map<TableName, Map<string, FakeRecord>>) {}

  async get(id: string): Promise<FakeRecord | null> {
    for (const records of this.recordsByTable.values()) {
      const record = records.get(id);
      if (record) {
        return record;
      }
    }
    return null;
  }

  query(tableName: TableName): FakeQuery {
    return new FakeQuery(Array.from((this.recordsByTable.get(tableName) ?? new Map()).values()));
  }
}

function createQueryContext(recordsByTable: Partial<Record<TableName, FakeRecord[]>>): QueryCtx {
  const tables = new Map<TableName, Map<string, FakeRecord>>();
  for (const tableName of [
    'widgetToken',
    'workspace',
    'familyGroup',
    'familyGroupMember',
    'category',
    'categoryBudget',
  ] as const) {
    const records = recordsByTable[tableName] ?? [];
    tables.set(tableName, new Map(records.map((record) => [record._id, record])));
  }
  return { db: new FakeDb(tables) } as unknown as QueryCtx;
}

function workspace(ownerClerkId: string, isArchived = false): FakeRecord {
  return {
    _id: 'workspace_1' as Id<'workspace'>,
    _creationTime: 1,
    ownerClerkId,
    isArchived,
    isDeleted: false,
  };
}

function widgetToken(clerkId: string): FakeRecord {
  return {
    _id: 'widget_token_1' as Id<'widgetToken'>,
    _creationTime: 1,
    workspaceId: 'workspace_1' as Id<'workspace'>,
    clerkId,
    token: 'secret_token',
    createdAt: '2026-08-04T00:00:00.000Z',
    isRevoked: false,
  };
}

describe('getAuthorizedWidgetTokenByToken', () => {
  it('accepts a token while its owner retains workspace access', async () => {
    const ctx = createQueryContext({
      widgetToken: [widgetToken('clerk_owner')],
      workspace: [workspace('clerk_owner')],
    });

    await expect(getAuthorizedWidgetTokenByToken(ctx, 'secret_token')).resolves.toMatchObject({
      clerkId: 'clerk_owner',
    });
  });

  it('rejects a token after its owner loses workspace access', async () => {
    const ctx = createQueryContext({
      widgetToken: [widgetToken('clerk_removed')],
      workspace: [workspace('clerk_owner')],
    });

    await expect(getAuthorizedWidgetTokenByToken(ctx, 'secret_token')).resolves.toBeNull();
  });

  it('rejects a token for an archived workspace', async () => {
    const ctx = createQueryContext({
      widgetToken: [widgetToken('clerk_owner')],
      workspace: [workspace('clerk_owner', true)],
    });

    await expect(getAuthorizedWidgetTokenByToken(ctx, 'secret_token')).resolves.toBeNull();
  });
});

const budgetPulseQuery = getBudgetPulseForWidget as unknown as {
  _handler: (ctx: QueryCtx, args: { token: string; now: number }) => Promise<WidgetBudgetPulse | null>;
};
const workspaceId = 'workspace_1' as Id<'workspace'>;
const otherWorkspaceId = 'workspace_other' as Id<'workspace'>;
const categoryId = 'category_1' as Id<'category'>;

function pulseWorkspace(overrides: Partial<Doc<'workspace'>> = {}): Doc<'workspace'> {
  return {
    _id: workspaceId,
    _creationTime: 1,
    ownerClerkId: 'clerk_owner',
    name: 'Personal',
    transactionDefaultPendingStatus: false,
    currency: 'usd',
    timezone: 'America/New_York',
    ...overrides,
  };
}

function category(overrides: Partial<Doc<'category'>> = {}): Doc<'category'> {
  return {
    _id: categoryId,
    _creationTime: 1,
    workspaceId,
    categoryGroupId: 'group_1' as Id<'categoryGroup'>,
    name: 'Groceries',
    categoryType: 'custom',
    sortOrder: 0,
    isDeleted: false,
    ...overrides,
  };
}

function budget(overrides: Partial<Doc<'categoryBudget'>> = {}): Doc<'categoryBudget'> {
  return {
    _id: 'budget_1' as Id<'categoryBudget'>,
    _creationTime: 1,
    workspaceId,
    categoryId,
    monthlyAssignedAmounts: { '202609': 10_000n },
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

describe('Budget Pulse widget', () => {
  it('preserves historical carryover and refunds, counts only this month assignment/activity, and ignores future data', () => {
    const result = buildWidgetBudgetPulse(
      pulseWorkspace(),
      '2026-09-07',
      [
        category({
          monthlySpending: {
            '202601': { inflowAmount: 0n, outflowAmount: 2_000n },
            '202609': { inflowAmount: 500n, outflowAmount: 3_000n },
          },
        }),
      ],
      [budget({ monthlyAssignedAmounts: { '202001': 20_000n, '202609': 10_000n, '202610': 999_999n } })]
    );

    expect(result).toEqual({
      workspaceName: 'Personal',
      currencyCode: 'USD',
      month: '2026-09',
      today: '2026-09-07',
      daysRemaining: 24,
      totalAvailable: 25_500,
      totalAssigned: 10_000,
      totalActivity: -2_500,
      overspentCount: 0,
      overspentAmount: 0,
    });
  });

  it('keeps negative envelope balances visible and includes legacy untyped envelopes', () => {
    const result = buildWidgetBudgetPulse(
      pulseWorkspace(),
      '2026-09-30',
      [
        category({
          categoryType: undefined,
          monthlySpending: { '202609': { inflowAmount: 0n, outflowAmount: 15_000n } },
        }),
        category({
          _id: 'category_2' as Id<'category'>,
          monthlySpending: { '202608': { inflowAmount: 0n, outflowAmount: 2_000n } },
        }),
      ],
      [budget()]
    );
    expect(result).toMatchObject({
      totalAvailable: -7_000,
      totalActivity: -15_000,
      overspentCount: 2,
      overspentAmount: 7_000,
      daysRemaining: 1,
    });
  });

  it('excludes archived/deleted categories, card reserves, and another workspace from all totals', () => {
    const categories = [
      category(),
      category({ isArchived: true }),
      category({ isDeleted: true }),
      category({ categoryType: 'credit_card' }),
      category({ categoryType: 'credit_card_payment' }),
      category({ workspaceId: otherWorkspaceId }),
    ];
    const result = buildWidgetBudgetPulse(pulseWorkspace(), '2026-09-01', categories, [
      budget(),
      budget({ workspaceId: otherWorkspaceId, monthlyAssignedAmounts: { '202609': 999_999n } }),
    ]);
    expect(result).toMatchObject({
      totalAvailable: 10_000,
      totalAssigned: 10_000,
      totalActivity: 0,
      overspentCount: 0,
    });
  });

  it.each([
    ['America/Los_Angeles', '2026-10-01T02:00:00Z', '2026-09-30', 1],
    ['Australia/Sydney', '2026-09-30T15:00:00Z', '2026-10-01', 31],
    ['UTC', '2028-02-01T12:00:00Z', '2028-02-01', 29],
    ['Invalid/Timezone', '2026-09-07T12:00:00Z', '2026-09-07', 24],
  ])('derives calendar boundaries in %s', async (timezone, now, today, daysRemaining) => {
    const ctx = createQueryContext({
      widgetToken: [widgetToken('clerk_owner')],
      workspace: [pulseWorkspace({ timezone })],
      category: [category()],
      categoryBudget: [budget()],
    });
    await expect(
      budgetPulseQuery._handler(ctx, { token: 'secret_token', now: Date.parse(now) })
    ).resolves.toMatchObject({
      today,
      month: today.slice(0, 7),
      daysRemaining,
    });
  });

  it('uses only the token workspace for indexed category and assignment reads', async () => {
    const ctx = createQueryContext({
      widgetToken: [widgetToken('clerk_owner')],
      workspace: [pulseWorkspace(), pulseWorkspace({ _id: otherWorkspaceId })],
      category: [category(), category({ _id: 'foreign_category' as Id<'category'>, workspaceId: otherWorkspaceId })],
      categoryBudget: [
        budget(),
        budget({
          _id: 'foreign_budget' as Id<'categoryBudget'>,
          workspaceId: otherWorkspaceId,
          categoryId: 'foreign_category' as Id<'category'>,
          monthlyAssignedAmounts: { '202609': 999_999n },
        }),
      ],
    });
    await expect(
      budgetPulseQuery._handler(ctx, { token: 'secret_token', now: Date.parse('2026-09-07T12:00:00Z') })
    ).resolves.toMatchObject({ totalAssigned: 10_000 });
  });

  it.each(['missing', 'revoked', 'removed', 'archived', 'deleted'])('rejects %s authorization', async (reason) => {
    const token = widgetToken(reason === 'removed' ? 'clerk_removed' : 'clerk_owner');
    if (reason === 'revoked') token.isRevoked = true;
    const ctx = createQueryContext({
      widgetToken: reason === 'missing' ? [] : [token],
      workspace: [pulseWorkspace({ isArchived: reason === 'archived', isDeleted: reason === 'deleted' })],
    });
    await expect(
      budgetPulseQuery._handler(ctx, { token: 'secret_token', now: Date.parse('2026-09-07T12:00:00Z') })
    ).resolves.toBeNull();
  });

  it('refuses to return misleading totals when bounded reads overflow', async () => {
    const ctx = createQueryContext({
      widgetToken: [widgetToken('clerk_owner')],
      workspace: [pulseWorkspace()],
      category: Array.from({ length: 1_001 }, (_, index) => category({ _id: `category_${index}` as Id<'category'> })),
    });
    await expect(
      budgetPulseQuery._handler(ctx, { token: 'secret_token', now: Date.parse('2026-09-07T12:00:00Z') })
    ).rejects.toThrow('too large');
  });
});
