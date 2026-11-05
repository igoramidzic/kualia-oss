import { describe, expect, it, vi } from 'vitest';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { processRawTransactionImports } from '../transactionImport/processRawTransactionImports';
import {
  findPotentialManualMatch,
  findPotentialManualMatchWithCache,
  initializeTransactionMatchingCache,
} from './transactionMatching';

vi.mock('../activityLogs/helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../activityLogs/helpers')>()),
  buildSystemActivityContextForWorkspace: vi.fn(),
  recordTransactionActivity: vi.fn(),
}));
vi.mock('../transferDetection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../transferDetection')>()),
  processTransferDetection: vi.fn(async () => new Map()),
}));

const workspaceId = 'workspace' as Id<'workspace'>;
const bankAccountId = 'checking' as Id<'bankAccount'>;
const merchantId = 'keybank' as Id<'merchant'>;
const rawTransactionId = 'paycheck_import' as Id<'transactionImportRaw'>;
const input = {
  workspaceId,
  bankAccountId,
  rawTransactionId,
  amount: 366519n,
  date: '2026-09-23',
  merchantName: undefined,
};

function paycheck(overrides: Partial<Doc<'transaction'>> = {}): Doc<'transaction'> {
  return {
    _id: 'entered_paycheck' as Id<'transaction'>,
    _creationTime: 1,
    workspaceId,
    bankAccountId,
    merchantId,
    type: 'regular',
    source: 'scheduled',
    date: input.date,
    dateYearMonth: 202609,
    status: 'pending',
    reviewStatus: 'reviewed',
    scheduledTransactionId: 'paycheck_plan' as Id<'scheduledTransaction'>,
    scheduledOccurrenceDate: input.date,
    movements: [{ amount: input.amount, readyToAssign: true, sortOrder: 0 }],
    totalAmount: input.amount,
    searchText: 'keybank national',
    hasUncategorized: false,
    hasMissingPayee: false,
    isDeleted: false,
    ...overrides,
  };
}

type Row = Record<string, unknown>;
type Predicate = (transaction: Row) => boolean;
const filter = {
  field: (field: string) => (row: Row) => row[field],
  eq:
    (field: (row: Row) => unknown, value: unknown): Predicate =>
    (row) =>
      field(row) === value,
  and:
    (...conditions: Predicate[]): Predicate =>
    (row) =>
      conditions.every((condition) => condition(row)),
  or:
    (...conditions: Predicate[]): Predicate =>
    (row) =>
      conditions.some((condition) => condition(row)),
};

function context(transactions: Doc<'transaction'>[], related: Record<string, Row[]> = {}): MutationCtx {
  const tables: Record<string, Row[]> = {
    transaction: transactions,
    merchant: [{ _id: merchantId, workspaceId, name: 'KEYBANK NATIONAL', isDeleted: false }],
    ...related,
  };
  const get = (id: string) =>
    Object.values(tables)
      .flat()
      .find((row) => row._id === id) ?? null;
  return {
    db: {
      get: async (id: string) => get(id),
      patch: async (id: string, fields: Row) => {
        const row = get(id);
        if (!row) throw new Error(`Missing test row: ${id}`);
        Object.assign(row, fields);
      },
      insert: vi.fn(async () => {
        throw new Error('Matching an existing paycheck must not insert a row');
      }),
      query: (table: string) => {
        let rows = [...(tables[table] ?? [])];
        const index = {
          eq: (field: string, value: unknown) => {
            rows = rows.filter((row) => row[field] === value);
            return index;
          },
        };
        const query = {
          withIndex: (_name: string, apply: (value: typeof index) => unknown) => {
            apply(index);
            return query;
          },
          filter: (apply: (value: typeof filter) => Predicate) => {
            rows = rows.filter(apply(filter));
            return query;
          },
          collect: async () => rows,
          take: async (limit: number) => rows.slice(0, limit),
          first: async () => rows[0] ?? null,
          order: () => query,
        };
        return query;
      },
    },
  } as unknown as MutationCtx;
}

describe('matching entered paychecks to Plaid imports', () => {
  it('links the raw import without another paycheck, balance impact, or planned occurrence', async () => {
    const transaction = paycheck();
    const account = {
      _id: bankAccountId,
      workspaceId,
      bankLinkAccountId: 'linked_account',
      name: 'Checking',
      accountType: 'banking_checking',
      currentBalance: input.amount,
      pendingBalance: input.amount,
      clearedBalance: 0n,
      isDeleted: false,
      isClosed: false,
    };
    const workspace = { _id: workspaceId, readyToAssign: input.amount };
    const plan = {
      _id: transaction.scheduledTransactionId,
      workspaceId,
      bankAccountId,
      merchantId,
      isDeleted: false,
      transactionType: 'regular',
      status: 'active',
      entryMode: 'manual',
      nextDate: '2026-10-07',
      executionCount: 9,
      movements: transaction.movements,
    };
    const raw = {
      _id: rawTransactionId,
      workspaceId,
      plaidAccountId: 'plaid_checking',
      plaidTransactionId: 'plaid_paycheck',
      amount: input.amount,
      date: input.date,
      originalStatement: 'KEYBANK NATIONAL',
      plaidCategory: ['Transfer', 'Credit'],
      pending: false,
      importStatus: 'awaiting_insert_job',
    };
    const ctx = context([transaction], {
      bankAccount: [account],
      bankLinkAccount: [{ _id: 'linked_account', plaidAccountId: 'plaid_checking', bankLinkId: 'bank_link' }],
      workspace: [workspace],
      scheduledTransaction: [plan],
      transactionImportRaw: [raw],
    });
    const before = structuredClone({ account, workspace, plan, movements: transaction.movements });
    const handler = (
      processRawTransactionImports as unknown as {
        _handler: (ctx: MutationCtx, args: { workspaceId: Id<'workspace'> }) => Promise<unknown>;
      }
    )._handler;

    expect(await handler(ctx, { workspaceId })).toMatchObject({ processedCount: 1, errorCount: 0 });
    expect(transaction).toMatchObject({
      source: 'scheduled',
      linkedRawTransactionId: rawTransactionId,
      transactionImportRawId: rawTransactionId,
      reviewStatus: 'needs_review',
      scheduledTransactionId: plan._id,
      scheduledOccurrenceDate: input.date,
    });
    expect({ account, workspace, plan, movements: transaction.movements }).toEqual(before);
    expect(raw.importStatus).toBe('inserted');
    expect(ctx.db.insert).not.toHaveBeenCalled();

    expect(await handler(ctx, { workspaceId })).toMatchObject({ processedCount: 0, errorCount: 0 });
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it.each(['manual', 'scheduled'] as const)(
    'finds an existing %s paycheck even without a Plaid merchant name',
    async (source) => {
      const transaction = paycheck({ source });
      const ctx = context([transaction]);
      const cache = await initializeTransactionMatchingCache(ctx, workspaceId);
      expect(findPotentialManualMatchWithCache(input, cache)).toMatchObject({
        manualTransactionId: transaction._id,
        confidence: 70,
        matchFactors: { amountMatch: 'exact', dateDelta: 0 },
      });
      expect(await findPotentialManualMatch(ctx, input)).toMatchObject({ manualTransactionId: transaction._id });
    }
  );

  it('matches an already-entered split without creating another transaction', async () => {
    const transaction = paycheck({
      movements: [
        { amount: 300000n, readyToAssign: true, sortOrder: 0 },
        { amount: 66519n, readyToAssign: true, sortOrder: 1 },
      ],
    });
    const ctx = context([transaction]);
    const cache = await initializeTransactionMatchingCache(ctx, workspaceId);
    expect(findPotentialManualMatchWithCache(input, cache)?.manualTransactionId).toBe(transaction._id);
    expect((await findPotentialManualMatch(ctx, input))?.manualTransactionId).toBe(transaction._id);
  });

  it.each<Partial<Doc<'transaction'>>>([
    { source: 'automatic_import' },
    { source: 'chat_import' },
    { isDeleted: true },
    { workspaceId: 'other_workspace' as Id<'workspace'> },
    { bankAccountId: 'other_account' as Id<'bankAccount'> },
    { linkedRawTransactionId: 'already_linked' as Id<'transactionImportRaw'> },
    { transactionImportRawId: 'already_imported' as Id<'transactionImportRaw'> },
    { financeKitTransactionImportId: 'financekit_import' as Id<'financeKitTransactionImport'> },
    { rejectedLinkIds: [rawTransactionId] },
    { date: '2026-08-23' },
    { type: 'transfer' },
    { totalAmount: -366519n },
  ])('does not link an ineligible or previously imported entry %#', async (overrides) => {
    const ctx = context([paycheck(overrides)]);
    const cache = await initializeTransactionMatchingCache(ctx, workspaceId);
    expect(findPotentialManualMatchWithCache(input, cache)).toBeNull();
    expect(await findPotentialManualMatch(ctx, input)).toBeNull();
  });
});
