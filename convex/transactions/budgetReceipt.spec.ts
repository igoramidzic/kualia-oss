import { type FunctionArgs, type FunctionReturnType, getFunctionName } from 'convex/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { getCalculatedBudgetForMonth } from '../categoryBudgets/helpers';
import { updateCategorySpendingForTransaction } from '../categoryBudgets/update';
import { requireWorkspaceAccess } from '../lib/auth';
import { captureBudgetBalances, finishBudgetReceipt, transactionBudgetTargets } from './budgetReceipt';
import { deleteTransactions, restoreTransactions } from './delete';
import { buildSnapshotFromTransaction } from './reconciliation/buildSnapshot';
import { reconcileTransactionSideEffects } from './reconciliation/reconcile';
import { updateTransactionFromEditor } from './update';

vi.mock('../categoryBudgets/helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../categoryBudgets/helpers')>()),
  getCalculatedBudgetForMonth: vi.fn(),
}));
vi.mock('../lib/auth', () => ({ requireWorkspaceAccess: vi.fn() }));
vi.mock('../activityLogs/helpers', () => ({ buildActivityContext: vi.fn(), recordTransactionActivity: vi.fn() }));
vi.mock('./reconciliation/buildSnapshot', () => ({
  buildSnapshotFromTransaction: vi.fn(async (_ctx: unknown, transaction: unknown) => transaction),
}));
vi.mock('./reconciliation/reconcile', () => ({ reconcileTransactionSideEffects: vi.fn() }));

const workspaceId = 'workspace' as Id<'workspace'>;
const bankId = 'bank' as Id<'bankAccount'>;
const diningId = 'dining' as Id<'category'>;
const groceriesId = 'groceries' as Id<'category'>;
const transactionId = 'transaction' as Id<'transaction'>;
const pairId = 'pair' as Id<'transaction'>;
type TestRow = Record<string, unknown> & { _id: string };

type BatchArgs = FunctionArgs<typeof api.transactions.deleteTransactions>;
type BatchResult = FunctionReturnType<typeof api.transactions.deleteTransactions>;
function batchHandler(registered: unknown) {
  return (registered as { _handler: (ctx: MutationCtx, args: BatchArgs) => Promise<BatchResult> })._handler;
}

function setup() {
  const balances = new Map<string, bigint>([
    ['dining:202609', -1_000n],
    ['groceries:202609', 2_000n],
  ]);
  const rows = new Map<string, TestRow>([
    [workspaceId, { _id: workspaceId, readyToAssign: 10_000n }],
    [bankId, { _id: bankId, workspaceId }],
    [diningId, { _id: diningId, workspaceId, name: 'Dining out' }],
    [groceriesId, { _id: groceriesId, workspaceId, name: 'Groceries' }],
    [
      transactionId,
      {
        _id: transactionId,
        workspaceId,
        bankAccountId: bankId,
        date: '2026-09-04',
        type: 'regular',
        isDeleted: false,
        movements: [{ categoryId: diningId, amount: -3_000n, readyToAssign: false }],
      },
    ],
  ]);
  const ctx = {
    db: {
      get: vi.fn(async (id: string) => rows.get(id) ?? null),
      patch: vi.fn(async (id: string, values: Record<string, unknown>) => {
        const row = rows.get(id);
        if (!row) throw new Error('Missing row');
        rows.set(id, { ...row, ...values });
      }),
    },
  } as unknown as MutationCtx;
  vi.mocked(requireWorkspaceAccess).mockResolvedValue({ workspaceId, user: { subject: 'user' } } as Awaited<
    ReturnType<typeof requireWorkspaceAccess>
  >);
  vi.mocked(getCalculatedBudgetForMonth).mockImplementation(async (_ctx, _workspaceId, categoryId, yearMonth) => ({
    yearMonth,
    available: balances.get(`${categoryId}:${yearMonth}`) ?? 0n,
    assignedAmount: 0n,
    spentAmount: 0n,
    carryover: 0n,
  }));
  vi.mocked(reconcileTransactionSideEffects).mockImplementation(async (_ctx, before, after) => {
    for (const [snapshot, sign] of [
      [before, -1n],
      [after, 1n],
    ] as const) {
      for (const movement of snapshot?.movements ?? []) {
        if (!movement.categoryId) continue;
        const key = `${movement.categoryId}:${snapshot?.date.slice(0, 7).replace('-', '')}`;
        balances.set(key, (balances.get(key) ?? 0n) + sign * movement.amount);
      }
    }
  });
  return { ctx, rows, balances };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(buildSnapshotFromTransaction).mockImplementation(
    async (_ctx, transaction) => transaction as unknown as Awaited<ReturnType<typeof buildSnapshotFromTransaction>>
  );
});

describe('budget feedback for edits and deletion', () => {
  it('returns both balances from an editor recategorization using real budget calculations and reconciliation', async () => {
    const { ctx, rows } = setup();
    const budgetHelpers =
      await vi.importActual<typeof import('../categoryBudgets/helpers')>('../categoryBudgets/helpers');
    const snapshots = await vi.importActual<typeof import('./reconciliation/buildSnapshot')>(
      './reconciliation/buildSnapshot'
    );
    const reconciliation =
      await vi.importActual<typeof import('./reconciliation/reconcile')>('./reconciliation/reconcile');
    vi.mocked(getCalculatedBudgetForMonth).mockImplementation(budgetHelpers.getCalculatedBudgetForMonth);
    vi.mocked(buildSnapshotFromTransaction).mockImplementation(snapshots.buildSnapshotFromTransaction);
    vi.mocked(reconcileTransactionSideEffects).mockImplementation(reconciliation.reconcileTransactionSideEffects);
    rows.set(bankId, { _id: bankId, workspaceId, name: 'Checking', accountType: 'banking_checking' });
    rows.set(transactionId, {
      ...rows.get(transactionId),
      _id: transactionId,
      status: 'cleared',
      reviewStatus: 'reviewed',
      totalAmount: -3_000n,
    });
    rows.set(diningId, {
      ...rows.get(diningId),
      _id: diningId,
      monthlySpending: { '202609': { inflowAmount: 0n, outflowAmount: 3_000n } },
    });
    const realCtx = {
      ...ctx,
      db: {
        ...ctx.db,
        query: () => ({ withIndex: () => ({ first: async () => ({ monthlyAssignedAmounts: { '202609': 2_000n } }) }) }),
      },
      runMutation: async (ref: Parameters<MutationCtx['runMutation']>[0], args: unknown) => {
        expect(getFunctionName(ref)).toBe('categoryBudgets:updateCategorySpendingForTransaction');
        const handler = (
          updateCategorySpendingForTransaction as unknown as {
            _handler: (
              ctx: MutationCtx,
              args: FunctionArgs<
                typeof import('../_generated/api').internal.categoryBudgets.updateCategorySpendingForTransaction
              >
            ) => Promise<void>;
          }
        )._handler;
        await handler(realCtx, args as Parameters<typeof handler>[1]);
      },
    } as unknown as MutationCtx;
    const handler = (
      updateTransactionFromEditor as unknown as {
        _handler: (
          ctx: MutationCtx,
          args: FunctionArgs<typeof api.transactions.updateTransactionFromEditor>
        ) => Promise<FunctionReturnType<typeof api.transactions.updateTransactionFromEditor>>;
      }
    )._handler;
    const result = await handler(realCtx, {
      workspaceId,
      transactionId,
      includeBudgetChanges: true,
      preserveReviewStatus: true,
      movements: [{ categoryId: groceriesId, amount: -3_000n, readyToAssign: false }],
    });
    expect(result.budgetChanges).toEqual([
      { categoryId: diningId, yearMonth: 202609, name: 'Dining out', before: -1_000n, after: 2_000n },
      { categoryId: groceriesId, yearMonth: 202609, name: 'Groceries', before: 2_000n, after: -1_000n },
    ]);
  });

  it('captures the old and new categories when an edit moves money between envelopes', async () => {
    const { ctx, balances } = setup();
    const targets = await transactionBudgetTargets(ctx, workspaceId, [transactionId], {
      movements: [{ categoryId: groceriesId }],
    });
    const before = await captureBudgetBalances(ctx, workspaceId, targets);
    balances.set('dining:202609', 2_000n);
    balances.set('groceries:202609', -1_000n);
    expect(await finishBudgetReceipt(ctx, workspaceId, before)).toEqual([
      { categoryId: diningId, yearMonth: 202609, name: 'Dining out', before: -1_000n, after: 2_000n },
      { categoryId: groceriesId, yearMonth: 202609, name: 'Groceries', before: 2_000n, after: -1_000n },
    ]);
  });

  it('captures both months for date edits and emits only balances that actually changed', async () => {
    const { ctx, balances } = setup();
    const targets = await transactionBudgetTargets(ctx, workspaceId, [transactionId], { date: '2026-10-04' });
    expect(targets).toEqual([
      { categoryId: diningId, yearMonth: 202609 },
      { categoryId: diningId, yearMonth: 202610 },
    ]);
    const before = await captureBudgetBalances(ctx, workspaceId, targets);
    balances.set('dining:202609', 2_000n);
    expect(await finishBudgetReceipt(ctx, workspaceId, before)).toEqual([
      { categoryId: diningId, yearMonth: 202609, name: 'Dining out', before: -1_000n, after: 2_000n },
    ]);
  });

  it('gets the budget side when editing the uncategorized side of a transfer and deduplicates pairs', async () => {
    const { ctx, rows } = setup();
    rows.set(pairId, { ...rows.get(transactionId), _id: pairId, transferPairId: transactionId });
    rows.set(transactionId, { ...rows.get(transactionId), _id: transactionId, transferPairId: pairId, movements: [] });
    const targets = await transactionBudgetTargets(ctx, workspaceId, [transactionId, pairId]);
    expect(targets).toEqual([{ categoryId: diningId, yearMonth: 202609 }]);
  });

  it('returns money to the category on deletion and reverses it on Undo, inside each mutation', async () => {
    const { ctx, rows } = setup();
    const args = { workspaceId, transactionIds: [transactionId], includeBudgetChanges: true };
    const deleted = await batchHandler(deleteTransactions)(ctx, args);
    expect(rows.get(transactionId)?.isDeleted).toBe(true);
    expect(deleted.budgetChanges).toEqual([
      { categoryId: diningId, yearMonth: 202609, name: 'Dining out', before: -1_000n, after: 2_000n },
    ]);
    const restored = await batchHandler(restoreTransactions)(ctx, args);
    expect(rows.get(transactionId)?.isDeleted).toBe(false);
    expect(restored.budgetChanges).toEqual([
      { categoryId: diningId, yearMonth: 202609, name: 'Dining out', before: 2_000n, after: -1_000n },
    ]);
  });

  it('deletes a transfer pair once even when both sides are requested', async () => {
    const { ctx, rows } = setup();
    rows.set(pairId, { ...rows.get(transactionId), _id: pairId, type: 'transfer', transferPairId: transactionId });
    rows.set(transactionId, {
      ...rows.get(transactionId),
      _id: transactionId,
      type: 'transfer',
      transferPairId: pairId,
      movements: [],
    });
    const result = await batchHandler(deleteTransactions)(ctx, {
      workspaceId,
      transactionIds: [transactionId, pairId],
      includeBudgetChanges: true,
    });
    expect(result.budgetChanges?.[0]).toMatchObject({ before: -1_000n, after: 2_000n });
    expect(rows.get(pairId)?.isDeleted).toBe(true);
    expect(reconcileTransactionSideEffects).toHaveBeenCalledTimes(2);
  });

  it('keeps legacy delete results and avoids budget reads unless requested', async () => {
    const { ctx } = setup();
    expect(await batchHandler(deleteTransactions)(ctx, { workspaceId, transactionIds: [transactionId] })).toEqual({
      success: true,
    });
    expect(getCalculatedBudgetForMonth).not.toHaveBeenCalled();
  });

  it('rejects foreign records and malformed dates before reading budget balances', async () => {
    const { ctx, rows } = setup();
    await expect(transactionBudgetTargets(ctx, workspaceId, [transactionId], { date: 'invalid' })).rejects.toThrow(
      'valid transaction date'
    );
    rows.set(transactionId, { ...rows.get(transactionId), _id: transactionId, workspaceId: 'foreign' });
    await expect(transactionBudgetTargets(ctx, workspaceId, [transactionId])).rejects.toThrow('this workspace');
    expect(getCalculatedBudgetForMonth).not.toHaveBeenCalled();
  });
});
