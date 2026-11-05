import type { FunctionArgs, FunctionReturnType } from 'convex/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { api } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { getCalculatedBudgetForMonth } from '../../categoryBudgets/helpers';
import { requireWorkspaceAccess } from '../../lib/auth';
import { createTransactionFromEditor, createTransferFromEditor } from './createFromEditor';
import { createRegularTransactionHandler } from './createRegular';
import { createTransferTransactionHandler } from './createTransfer';

vi.mock('../../lib/auth', () => ({ requireWorkspaceAccess: vi.fn() }));
vi.mock('../../categoryBudgets/helpers', () => ({ getCalculatedBudgetForMonth: vi.fn() }));
vi.mock('./createRegular', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./createRegular')>()),
  createRegularTransactionHandler: vi.fn(),
}));
vi.mock('./createTransfer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./createTransfer')>()),
  createTransferTransactionHandler: vi.fn(),
}));

type RegularArgs = FunctionArgs<typeof api.transactions.createTransactionFromEditor>;
type TransferArgs = FunctionArgs<typeof api.transactions.createTransferFromEditor>;
type Args = (RegularArgs & { type: 'regular' }) | (TransferArgs & { type: 'transfer' });
type Result = FunctionReturnType<typeof api.transactions.createTransactionFromEditor>;
const regularHandler = (
  createTransactionFromEditor as unknown as {
    _handler: (ctx: MutationCtx, args: RegularArgs) => Promise<Result>;
  }
)._handler;
const transferHandler = (
  createTransferFromEditor as unknown as {
    _handler: (ctx: MutationCtx, args: TransferArgs) => Promise<Result>;
  }
)._handler;
function handler(ctx: MutationCtx, args: Args) {
  if (args.type === 'regular') {
    const { type: _type, ...values } = args;
    return regularHandler(ctx, values);
  }
  const { type: _type, ...values } = args;
  return transferHandler(ctx, values);
}
const workspaceId = 'workspace' as Id<'workspace'>;
const bankId = 'bank' as Id<'bankAccount'>;
const otherId = 'other' as Id<'bankAccount'>;
const categoryId = 'dining' as Id<'category'>;
const transactionId = 'transaction' as Id<'transaction'>;

function setup(accountType = 'banking_checking', otherType = 'investment_brokerage') {
  let available = 5_000n;
  let readyToAssign = 10_000n;
  const rows = new Map<string, Record<string, unknown>>([
    [workspaceId, { _id: workspaceId, timezone: 'UTC', readyToAssign }],
    [bankId, { _id: bankId, workspaceId, accountType, isDeleted: false, isClosed: false }],
    [otherId, { _id: otherId, workspaceId, accountType: otherType, isDeleted: false, isClosed: false }],
    [categoryId, { _id: categoryId, workspaceId, name: 'Dining out', isDeleted: false }],
  ]);
  const ctx = {
    db: {
      get: vi.fn(async (id: string) => rows.get(id) ?? null),
      query: (table: string) => queryRecords(rows.values(), table),
      insert: async (table: string, value: Record<string, unknown>) => {
        const id = `${table}-${rows.size}`;
        rows.set(id, { ...value, _id: id, _creationTime: 1 });
        return id;
      },
      patch: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        rows.set(id, { ...rows.get(id), ...patch });
      }),
    },
  } as unknown as MutationCtx;
  vi.mocked(requireWorkspaceAccess).mockResolvedValue({ workspaceId } as Awaited<
    ReturnType<typeof requireWorkspaceAccess>
  >);
  vi.mocked(getCalculatedBudgetForMonth).mockImplementation(async () => ({
    yearMonth: 202609,
    available,
    assignedAmount: 5_000n,
    spentAmount: available - 5_000n,
    carryover: 0n,
  }));
  const change = (amount: bigint) => {
    available += amount;
  };
  const changeRta = (amount: bigint) => {
    readyToAssign += amount;
    rows.set(workspaceId, { _id: workspaceId, timezone: 'UTC', readyToAssign });
  };
  vi.mocked(createRegularTransactionHandler).mockImplementation(async (_ctx, args) => {
    for (const movement of args.movements) {
      if (movement.categoryId) change(movement.amount);
      if (movement.readyToAssign) changeRta(movement.amount);
    }
    return transactionId;
  });
  vi.mocked(createTransferTransactionHandler).mockImplementation(async (_ctx, args) => {
    if (args.categoryId) change(args.fromAccountId === bankId ? -args.amount : args.amount);
    return transactionId;
  });
  const regular: Args = {
    type: 'regular',
    workspaceId,
    bankAccountId: bankId,
    date: '2026-09-04',
    movements: [{ amount: -6_000n, categoryId }],
  };
  return { ctx, regular, rows, change };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('transaction creation budget receipt', () => {
  it('exports object argument validators accepted by Convex for both entry types', () => {
    for (const registered of [createTransactionFromEditor, createTransferFromEditor]) {
      const exported = registered as unknown as { exportArgs: () => string };
      const validator = JSON.parse(exported.exportArgs()) as { type: string };
      expect(validator.type).toBe('object');
    }
  });
  it('captures authoritative before and after amounts around a successful outflow', async () => {
    const { ctx, regular } = setup();
    const result = await handler(ctx, regular);
    expect(result.transactionId).toBe(transactionId);
    expect(result.budgetChanges).toEqual([
      { categoryId, yearMonth: 202609, name: 'Dining out', before: 5_000n, after: -1_000n },
    ]);
    expect(createRegularTransactionHandler).toHaveBeenCalledWith(ctx, regular);
    expect(getCalculatedBudgetForMonth).toHaveBeenCalledWith(ctx, workspaceId, categoryId, 202609);
  });

  it('combines duplicate split categories and supports refunds', async () => {
    const { ctx, regular } = setup();
    const result = await handler(ctx, {
      ...regular,
      movements: [
        { amount: 2_000n, categoryId },
        { amount: -500n, categoryId },
      ],
    });
    expect(result.budgetChanges[0]).toMatchObject({ before: 5_000n, after: 6_500n });
    expect(getCalculatedBudgetForMonth).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])('uses the correct side of a cross-budget transfer (incoming: %s)', async (incoming) => {
    const { ctx } = setup();
    const result = await handler(ctx, {
      type: 'transfer',
      workspaceId,
      fromAccountId: incoming ? otherId : bankId,
      toAccountId: incoming ? bankId : otherId,
      amount: 6_000n,
      date: '2026-09-04',
      categoryId,
    });
    expect(result.budgetChanges[0]).toMatchObject({ before: 5_000n, after: incoming ? 11_000n : -1_000n });
    expect(createTransferTransactionHandler).toHaveBeenCalledTimes(1);
    expect(createRegularTransactionHandler).not.toHaveBeenCalled();
  });

  it('does not show category movement for transfers between on-budget accounts', async () => {
    const { ctx } = setup('banking_checking', 'banking_savings');
    const result = await handler(ctx, {
      type: 'transfer',
      workspaceId,
      fromAccountId: bankId,
      toAccountId: otherId,
      amount: 6_000n,
      date: '2026-09-04',
    });
    expect(result.budgetChanges).toEqual([]);
    expect(getCalculatedBudgetForMonth).not.toHaveBeenCalled();
  });

  it('captures Ready to Assign and omits category math for off-budget accounts', async () => {
    const { ctx, regular } = setup();
    const result = await handler(ctx, { ...regular, movements: [{ amount: 2_000n, readyToAssign: true }] });
    expect(result.budgetChanges).toEqual([{ name: 'Ready to Assign', before: 10_000n, after: 12_000n }]);
    const offBudget = setup('investment_brokerage');
    expect((await handler(offBudget.ctx, offBudget.regular)).budgetChanges).toEqual([]);
  });

  it('schedules a future entry without claiming money has moved', async () => {
    const { ctx, regular } = setup();
    const scheduledTransactionId = 'schedule' as Id<'scheduledTransaction'>;
    vi.mocked(createRegularTransactionHandler).mockResolvedValueOnce({
      scheduledTransactionId,
      nextDate: '2099-01-01',
    });
    const result = await handler(ctx, { ...regular, date: '2099-01-01' });
    expect(result).toEqual({ scheduledTransactionId, budgetChanges: [] });
    expect(getCalculatedBudgetForMonth).not.toHaveBeenCalled();
  });

  it.each(['regular', 'transfer'] as const)('links a new %s and consumes the occurrence once', async (type) => {
    const { ctx, regular, rows } = setup();
    const plannedId = 'planned' as Id<'scheduledTransaction'>;
    rows.set(plannedId, {
      _id: plannedId,
      workspaceId,
      transactionType: type,
      movements: [{ amount: type === 'transfer' ? 6000n : -6000n }],
      bankAccountId: bankId,
      transferToAccountId: type === 'transfer' ? otherId : undefined,
      status: 'active',
      recurrence: 'once',
      nextDate: '2026-09-04',
      anchorDate: '2026-09-04',
      executionCount: 0,
      entryMode: 'manual',
      isDeleted: false,
    });
    rows.set(transactionId, {
      _id: transactionId,
      workspaceId,
      type,
      totalAmount: -6_000n,
      bankAccountId: bankId,
      date: regular.date,
      transferPairBankAccountId: type === 'transfer' ? otherId : undefined,
      transferPairId: type === 'transfer' ? 'pair' : undefined,
    });
    rows.set('pair', {
      _id: 'pair',
      workspaceId,
      type: 'transfer',
      totalAmount: 6_000n,
      bankAccountId: otherId,
      date: regular.date,
      transferPairBankAccountId: bankId,
      transferPairId: transactionId,
    });
    const args: Args =
      type === 'regular'
        ? { ...regular, linkedScheduledTransactionId: plannedId }
        : {
            type,
            workspaceId,
            fromAccountId: bankId,
            toAccountId: otherId,
            amount: 6_000n,
            date: regular.date,
            linkedScheduledTransactionId: plannedId,
          };
    const result = await handler(ctx, args);
    expect(result.transactionId).toBe(transactionId);
    expect(rows.get(transactionId)?.scheduledTransactionId).toBe(plannedId);
    expect(rows.get(plannedId)).toMatchObject({
      status: 'completed',
      executionCount: 1,
      lastEnteredTransactionId: transactionId,
    });
    if (type === 'transfer') expect(rows.get('pair')?.scheduledTransactionId).toBe(plannedId);
    // The editor-only argument must not leak into the lower-level creation input.
    const calls =
      type === 'regular'
        ? vi.mocked(createRegularTransactionHandler).mock.calls
        : vi.mocked(createTransferTransactionHandler).mock.calls;
    expect(calls[0]?.[1]).not.toHaveProperty('linkedScheduledTransactionId');
  });

  it('advances a recurring planned transaction after linking a new entry', async () => {
    const { ctx, regular, rows } = setup();
    const plannedId = 'planned' as Id<'scheduledTransaction'>;
    rows.set(plannedId, {
      _id: plannedId,
      workspaceId,
      bankAccountId: bankId,
      status: 'active',
      recurrence: 'monthly',
      nextDate: '2099-01-04',
      movements: [{ amount: -6000n }],
      anchorDate: '2099-01-04',
      executionCount: 2,
      entryMode: 'manual',
    });
    rows.set(transactionId, {
      _id: transactionId,
      workspaceId,
      bankAccountId: bankId,
      date: regular.date,
      type: 'regular',
      totalAmount: -6_000n,
    });
    await handler(ctx, { ...regular, linkedScheduledTransactionId: plannedId });
    expect(rows.get(plannedId)).toMatchObject({ status: 'active', nextDate: '2099-02-04', executionCount: 3 });
  });

  it.each([
    { workspaceId: 'foreign' },
    { isDeleted: true },
    { status: 'completed' },
    { status: 'paused' },
    { bankAccountId: otherId },
    { transactionType: 'transfer' },
  ])('rejects an unavailable or incompatible plan before creating: %o', async (patch) => {
    const { ctx, regular, rows } = setup();
    const plannedId = 'planned' as Id<'scheduledTransaction'>;
    rows.set(plannedId, {
      _id: plannedId,
      workspaceId,
      bankAccountId: bankId,
      status: 'active',
      ...patch,
    });
    await expect(handler(ctx, { ...regular, linkedScheduledTransactionId: plannedId })).rejects.toThrow();
    expect(createRegularTransactionHandler).not.toHaveBeenCalled();
  });

  it.each([{ date: '2099-01-01' }, { recurrence: 'monthly' as const }])(
    'rejects linking while creating another schedule: %o',
    async (patch) => {
      const { ctx, regular } = setup();
      await expect(
        handler(ctx, {
          ...regular,
          ...patch,
          linkedScheduledTransactionId: 'planned' as Id<'scheduledTransaction'>,
        })
      ).rejects.toThrow('either');
      expect(createRegularTransactionHandler).not.toHaveBeenCalled();
    }
  );

  it('does not manufacture a receipt on failure or for unchanged categories', async () => {
    const { ctx, regular } = setup();
    vi.mocked(createRegularTransactionHandler).mockRejectedValueOnce(new Error('Save failed'));
    await expect(handler(ctx, regular)).rejects.toThrow('Save failed');
    vi.mocked(createRegularTransactionHandler).mockResolvedValueOnce(transactionId);
    expect((await handler(ctx, regular)).budgetChanges).toEqual([]);
  });

  it('rejects unauthenticated, foreign-account, and foreign-category requests before creation', async () => {
    const { ctx, regular, rows } = setup();
    vi.mocked(requireWorkspaceAccess).mockRejectedValueOnce(new Error('Not signed in'));
    await expect(handler(ctx, regular)).rejects.toThrow('Not signed in');
    rows.set(bankId, { ...rows.get(bankId), workspaceId: 'foreign' });
    await expect(handler(ctx, regular)).rejects.toThrow('open account');
    rows.set(bankId, { ...rows.get(bankId), workspaceId });
    rows.set(categoryId, { ...rows.get(categoryId), workspaceId: 'foreign' });
    await expect(handler(ctx, regular)).rejects.toThrow('Category not found');
    expect(createRegularTransactionHandler).not.toHaveBeenCalled();
  });
});

function queryRecords(records: Iterable<object>, table: string) {
  const filters: { field: string; value: unknown }[] = [];
  const builder = {
    eq(field: string, value: unknown) {
      filters.push({ field, value });
      return builder;
    },
  };
  const matching = () =>
    [...records]
      .filter((value) => {
        const row = value as Record<string, unknown>;
        const belongs =
          table === 'scheduledTransactionOccurrence'
            ? row.scheduleRevision !== undefined && row.occurrenceDate !== undefined
            : table === 'transaction'
              ? row.date !== undefined && row.totalAmount !== undefined
              : false;
        return belongs && filters.every(({ field, value: expected }) => row[field] === expected);
      })
      .sort((a, b) =>
        String((a as Record<string, unknown>).occurrenceDate ?? '').localeCompare(
          String((b as Record<string, unknown>).occurrenceDate ?? '')
        )
      );
  const query = {
    withIndex(_name: string, callback: (index: typeof builder) => unknown) {
      callback(builder);
      return query;
    },
    order(_direction: 'asc' | 'desc') {
      return query;
    },
    unique: async () => matching()[0] ?? null,
    first: async () => matching()[0] ?? null,
    collect: async () => matching(),
    take: async (limit: number) => matching().slice(0, limit),
  };
  return query;
}
