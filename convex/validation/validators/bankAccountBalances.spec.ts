import { describe, expect, it, vi } from 'vitest';

import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { fix } from './bankAccountBalances';
import { applyFix as applyPendingCleared } from './bankAccountPendingCleared';

type Row = Record<string, unknown> & { _id: string };
type Predicate = (row: Row) => boolean;
class Expressions {
  field(name: string): string {
    return name;
  }
  eq(name: string, value: unknown): Predicate {
    return (r) => r[name] === value;
  }
  neq(name: string, value: unknown): Predicate {
    return (r) => r[name] !== value;
  }
}
class Index {
  filters: [string, unknown][] = [];
  eq(name: string, value: unknown): this {
    this.filters.push([name, value]);
    return this;
  }
}
const workspaceId = 'workspace' as Id<'workspace'>;
const fixBalances = (
  fix as unknown as {
    _handler: (
      ctx: MutationCtx,
      args: { workspaceId: Id<'workspace'> }
    ) => Promise<{ fixed: number; errors: string[] }>;
  }
)._handler;
const fixPendingCleared = (
  applyPendingCleared as unknown as {
    _handler: (
      ctx: MutationCtx,
      args: { bankAccountId: Id<'bankAccount'>; calculatedPending: bigint; calculatedCleared: bigint }
    ) => Promise<{ fixed: boolean }>;
  }
)._handler;

function setup() {
  const accounts: Row[] = [
    ['savings', 702303n, 702303n],
    ['revolut', -125190n, -462908n],
    ['millenium', 114804n, 452522n],
  ].map(([id, balance, initial]) => ({
    _id: String(id),
    workspaceId,
    name: id,
    accountType: 'banking_checking',
    currentBalance: balance,
    pendingBalance: 0n,
    clearedBalance: balance,
    monthlyBalances: { '202608': initial, '202609': 0n },
    isDeleted: false,
  }));
  const transactions: Row[] = [];
  const add = (accountId: string, amount: bigint, date: string) => {
    transactions.push({
      _id: `transaction-${transactions.length}`,
      workspaceId,
      bankAccountId: accountId,
      date,
      totalAmount: amount,
      movements: [{ amount }],
      status: 'cleared',
      isDeleted: false,
    });
  };
  add('savings', 702303n, '2026-08-01');
  add('revolut', -462908n, '2026-08-01');
  add('millenium', 452522n, '2026-08-01');
  for (const [from, to, amount, date] of [
    ['millenium', 'revolut', 111100n, '2026-09-02'],
    ['millenium', 'revolut', 56601n, '2026-09-05'],
    ['millenium', 'revolut', 170017n, '2026-09-10'],
    ['savings', 'revolut', 128500n, '2026-09-18'],
    ['revolut', 'millenium', 7079n, '2026-09-24'],
  ] as const) {
    add(from, -amount, date);
    add(to, amount, date);
  }
  const patch = vi.fn(async (id: string, data: Record<string, unknown>) => {
    const row = accounts.find((a) => a._id === id);
    if (!row) throw new Error('Unexpected write outside bank accounts');
    Object.assign(row, data);
  });
  const db = {
    get: async (id: string) => structuredClone(accounts.find((a) => a._id === id) ?? null),
    patch,
    query: (table: string) => {
      const rows = table === 'bankAccount' ? accounts : transactions;
      let index = new Index();
      let predicate: Predicate = () => true;
      const matches = () =>
        rows.filter((r) => index.filters.every(([field, value]) => r[field] === value) && predicate(r));
      const result = {
        withIndex: (_name: string, select: (q: Index) => Index) => {
          index = select(new Index());
          return result;
        },
        filter: (select: (q: Expressions) => Predicate) => {
          predicate = select(new Expressions());
          return result;
        },
        collect: async () => structuredClone(matches()),
        async *[Symbol.asyncIterator]() {
          yield* structuredClone(matches());
        },
      };
      return result;
    },
  };
  return { ctx: { db } as unknown as MutationCtx, accounts, transactions, patch };
}

describe('workspace bank account balance repair', () => {
  it('repairs all five missing transfers, including history whose current balances were already corrected', async () => {
    const { ctx, accounts, transactions, patch } = setup();
    const originalTransactions = structuredClone(transactions);
    expect(await fixBalances(ctx, { workspaceId })).toEqual({ fixed: 3, errors: [] });
    expect(accounts.map((a) => a.currentBalance)).toEqual([573803n, -3769n, 121883n]);
    expect(accounts.map((a) => a.monthlyBalances)).toEqual([
      { '202608': 702303n, '202609': -128500n },
      { '202608': -462908n, '202609': 459139n },
      { '202608': 452522n, '202609': -330639n },
    ]);
    for (const account of accounts) {
      await fixPendingCleared(ctx, {
        bankAccountId: account._id as Id<'bankAccount'>,
        calculatedPending: 0n,
        calculatedCleared: account.currentBalance as bigint,
      });
      expect(account.clearedBalance).toBe(account.currentBalance);
    }
    expect(transactions).toEqual(originalTransactions);
    const writes = patch.mock.calls.length;
    expect(await fixBalances(ctx, { workspaceId })).toEqual({ fixed: 0, errors: [] });
    expect(patch).toHaveBeenCalledTimes(writes);
  });

  it('repairs history even if a previous workspace fix already corrected currentBalance', async () => {
    const { ctx, accounts } = setup();
    const balances = [573803n, -3769n, 121883n];
    accounts.forEach((account, index) => {
      account.currentBalance = balances[index];
    });
    expect(await fixBalances(ctx, { workspaceId })).toEqual({ fixed: 3, errors: [] });
    expect(accounts.map((a) => a.currentBalance)).toEqual(balances);
    expect(accounts[1].monthlyBalances).toEqual({ '202608': -462908n, '202609': 459139n });
  });

  it('ignores deleted and foreign transactions and replaces stale history entries', async () => {
    const { ctx, accounts, transactions } = setup();
    transactions.push({ ...transactions[0], _id: 'deleted', isDeleted: true, totalAmount: 999n });
    transactions.push({ ...transactions[0], _id: 'foreign', workspaceId: 'foreign', totalAmount: 999n });
    accounts[0].monthlyBalances = { '202607': 999n };
    // Legacy rows can have movements without totalAmount.
    delete transactions[0].totalAmount;
    expect(await fixBalances(ctx, { workspaceId })).toEqual({ fixed: 3, errors: [] });
    expect(accounts[0]).toMatchObject({
      currentBalance: 573803n,
      monthlyBalances: { '202608': 702303n, '202609': -128500n },
    });
    expect(accounts[0].monthlyBalances).not.toHaveProperty('202607');
  });

  it('preserves the existing liability exclusion and does not touch other workspaces', async () => {
    const { ctx, accounts, patch } = setup();
    accounts[0].accountType = 'credit_credit_card';
    accounts[1].accountType = 'loan_other';
    accounts[2].workspaceId = 'foreign';
    expect(await fixBalances(ctx, { workspaceId })).toEqual({ fixed: 0, errors: [] });
    expect(patch).not.toHaveBeenCalled();
  });
});
