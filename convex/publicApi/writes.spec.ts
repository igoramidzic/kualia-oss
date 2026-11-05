import type { FunctionArgs, FunctionReturnType } from 'convex/server';
import { describe, expect, it, vi } from 'vitest';

import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { createTransactions } from './writes';

type Row = Record<string, unknown> & { _id: string; _creationTime: number };
type Predicate = (row: Row) => boolean;
class Expressions {
  field(name: string): string {
    return name;
  }
  eq(field: string, value: unknown): Predicate {
    return (row) => row[field] === value;
  }
  and(...predicates: Predicate[]): Predicate {
    return (row) => predicates.every((p) => p(row));
  }
}
class Index {
  filters: [string, unknown][] = [];
  eq(field: string, value: unknown): this {
    this.filters.push([field, value]);
    return this;
  }
}

function setup(destinationType: Doc<'bankAccount'>['accountType'] = 'banking_checking') {
  const tables = new Map<string, Map<string, Row>>();
  const table = (name: string) => {
    let rows = tables.get(name);
    if (!rows) {
      rows = new Map();
      tables.set(name, rows);
    }
    return rows;
  };
  const seed = (name: string, id: string, data: Record<string, unknown>) =>
    table(name).set(id, { _id: id, _creationTime: 1, ...data });
  const get = async (id: string) => {
    for (const rows of tables.values()) {
      const row = rows.get(id);
      if (row) return structuredClone(row);
    }
    return null;
  };
  const patch = async (id: string, values: Record<string, unknown>) => {
    for (const rows of tables.values()) {
      const row = rows.get(id);
      if (row) {
        rows.set(id, { ...row, ...values });
        return;
      }
    }
    throw new Error(`Missing record ${id}`);
  };
  const query = (name: string) => {
    let index = new Index();
    let predicate: Predicate = () => true;
    const collect = async () =>
      [...table(name).values()].filter(
        (r) => index.filters.every(([field, value]) => r[field] === value) && predicate(r)
      );
    const result = {
      withIndex: (_name: string, select: (q: Index) => Index) => {
        index = select(new Index());
        return result;
      },
      filter: (select: (q: Expressions) => Predicate) => {
        predicate = select(new Expressions());
        return result;
      },
      collect,
      first: async () => (await collect())[0] ?? null,
      unique: async () => (await collect())[0] ?? null,
    };
    return result;
  };
  let nextId = 1;
  const db = {
    get,
    patch,
    query,
    insert: async (name: string, data: Record<string, unknown>) => {
      const id = `${name}-${nextId++}`;
      seed(name, id, data);
      return id;
    },
  };
  seed('workspace', 'workspace', {
    name: 'Personal',
    ownerClerkId: 'owner',
    currency: 'EUR',
    readyToAssign: 1000000n,
    transactionDefaultPendingStatus: false,
  });
  for (const [id, balance, type] of [
    ['savings', 702303n, 'banking_savings'],
    ['checking', -125190n, destinationType],
    ['third', 114804n, 'banking_checking'],
  ] as const) {
    seed('bankAccount', id, {
      workspaceId: 'workspace',
      name: id,
      accountType: type,
      currentBalance: balance,
      clearedBalance: balance,
      pendingBalance: 0n,
      monthlyBalances: { '202608': balance, '202609': 0n },
      isDeleted: false,
      isClosed: false,
    });
  }
  seed('category', 'category', {
    workspaceId: 'workspace',
    name: 'Investing',
    categoryGroupId: 'group',
    isDeleted: false,
    sortOrder: 0,
    categoryType: 'custom',
  });
  seed('category', 'credit-category', {
    workspaceId: 'workspace',
    name: 'Credit card',
    categoryGroupId: 'group',
    isDeleted: false,
    sortOrder: 1,
    categoryType: 'credit_card',
    bankAccountId: 'checking',
  });
  const runMutation = vi.fn(async () => null);
  return { ctx: { db, runMutation } as unknown as MutationCtx, db, table, runMutation };
}

const handler = (
  createTransactions as unknown as {
    _handler: (
      ctx: MutationCtx,
      args: FunctionArgs<typeof internal.publicApi.writes.createTransactions>
    ) => Promise<FunctionReturnType<typeof internal.publicApi.writes.createTransactions>>;
  }
)._handler;

const args = {
  clerkId: 'owner',
  workspaceId: 'workspace',
  attribution: {
    clerkId: 'owner',
    source: {
      type: 'public_api' as const,
      apiKeyId: 'api-key' as Id<'apiKey'>,
      apiKeyLabel: 'Test',
      apiKeyPrefix: 'test',
    },
  },
};
const transfer = {
  type: 'transfer',
  from_account_id: 'savings',
  to_account_id: 'checking',
  amount: '1285.00',
  date: '2026-09-18',
};

describe('public API transfer balances', () => {
  it.each([undefined, 'reviewed'] as const)('applies both legs once with review_status=%s', async (reviewStatus) => {
    const { ctx, db, table } = setup();
    const result = await handler(ctx, { ...args, rows: [{ ...transfer, review_status: reviewStatus }] });

    expect(result.body.transactions).toHaveLength(2);
    const [from, to] = [...table('transaction').values()];
    expect(from).toMatchObject({
      totalAmount: -128500n,
      transferPairId: to._id,
      reviewStatus: reviewStatus ?? 'needs_review',
    });
    expect(to).toMatchObject({
      totalAmount: 128500n,
      transferPairId: from._id,
      reviewStatus: reviewStatus ?? 'needs_review',
    });
    expect(await db.get('savings')).toMatchObject({
      currentBalance: 573803n,
      clearedBalance: 573803n,
      pendingBalance: 0n,
      monthlyBalances: { '202608': 702303n, '202609': -128500n },
    });
    expect(await db.get('checking')).toMatchObject({
      currentBalance: 3310n,
      clearedBalance: 3310n,
      pendingBalance: 0n,
      monthlyBalances: { '202608': -125190n, '202609': 128500n },
    });
    expect(await db.get('workspace')).toMatchObject({ readyToAssign: 1000000n });
    expect(table('activityLog').size).toBe(1);
  });

  it('accumulates transfers sharing an account in the same API batch', async () => {
    const { ctx, db } = setup();
    await handler(ctx, {
      ...args,
      rows: [
        transfer,
        {
          type: 'transfer',
          from_account_id: 'checking',
          to_account_id: 'third',
          amount: '70.79',
          date: '2026-09-24',
        },
      ],
    });
    expect(await db.get('savings')).toMatchObject({ currentBalance: 573803n });
    expect(await db.get('checking')).toMatchObject({ currentBalance: -3769n, clearedBalance: -3769n });
    expect(await db.get('third')).toMatchObject({ currentBalance: 121883n, clearedBalance: 121883n });
  });

  it('reconciles the on-budget category for a transfer to an investment account', async () => {
    const { ctx, db, runMutation } = setup('investment_brokerage');
    await handler(ctx, { ...args, rows: [{ ...transfer, category_id: 'category' }] });
    expect(await db.get('savings')).toMatchObject({ currentBalance: 573803n });
    expect(await db.get('checking')).toMatchObject({ currentBalance: 3310n });
    expect(runMutation).toHaveBeenCalledWith(internal.categoryBudgets.updateCategorySpendingForTransaction, {
      workspaceId: 'workspace',
      categoryId: 'category',
      transactionDate: '2026-09-18',
      amountDelta: -128500n,
      transactionCountDelta: 1n,
    });
  });

  it('records credit card payment side effects along with both account balances', async () => {
    const { ctx, db } = setup('credit_credit_card');
    await handler(ctx, { ...args, rows: [transfer] });
    expect(await db.get('checking')).toMatchObject({ currentBalance: 3310n });
    expect(await db.get('credit-category')).toMatchObject({
      creditMonthlySpending: { '202609': { paymentsAmount: 128500n } },
    });
  });
});
