import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { ScheduledMatchingCache } from '../scheduledTransactions/helpers';
import { reconcileTransactionSideEffects } from './reconciliation/reconcile';
import type { TransactionSnapshot } from './reconciliation/types';
import { convertFromTransferInternal } from './transfer';
import {
  autoLinkImportedTransactionToScheduledMatch,
  buildBulkTransactionUpdates,
  updateLinkedScheduledTransaction,
  updateTransactionInternal,
} from './update';

function createTransaction(id: string, accountId: string, amount: bigint, pairId: string): Doc<'transaction'> {
  return {
    _id: id as Id<'transaction'>,
    _creationTime: 1,
    workspaceId: 'workspace-1' as Id<'workspace'>,
    bankAccountId: accountId as Id<'bankAccount'>,
    type: 'transfer',
    date: '2026-07-01',
    dateYearMonth: 202607,
    status: 'cleared',
    reviewStatus: 'reviewed',
    source: 'manual',
    movements: [{ amount, readyToAssign: false, sortOrder: 0 }],
    searchText: '',
    totalAmount: amount,
    hasUncategorized: false,
    hasMissingPayee: false,
    transferPairId: pairId as Id<'transaction'>,
    transferPairBankAccountId: (accountId === 'bank-1' ? 'bank-2' : 'bank-1') as Id<'bankAccount'>,
    updatedAt: '2026-07-01T00:00:00.000Z',
    isDeleted: false,
  };
}

function createScheduledTransfer(): Doc<'scheduledTransaction'> {
  return {
    _id: 'scheduled-1' as Id<'scheduledTransaction'>,
    _creationTime: 1,
    workspaceId: 'workspace-1' as Id<'workspace'>,
    transactionType: 'transfer',
    bankAccountId: 'bank-1' as Id<'bankAccount'>,
    transferToAccountId: 'bank-2' as Id<'bankAccount'>,
    entryStatus: 'cleared',
    movements: [{ amount: 5000n, readyToAssign: false }],
    recurrence: 'monthly',
    anchorDate: '2026-07-01',
    nextDate: '2026-07-01',
    status: 'active',
    executionCount: 0,
    reminderEnabled: false,
    updatedAt: '2026-07-01T00:00:00.000Z',
    isDeleted: false,
  };
}

type TestRecord =
  | Doc<'transaction'>
  | Doc<'scheduledTransaction'>
  | Doc<'scheduledTransactionOccurrence'>
  | Doc<'workspace'>
  | Doc<'bankAccount'>
  | Doc<'category'>
  | Doc<'merchant'>;

function createContext(records: TestRecord[]) {
  const recordsById = new Map<string, TestRecord>(records.map((record) => [record._id, record]));
  const get = vi.fn(async (id: string) => recordsById.get(id) ?? null);
  const patch = vi.fn(async (id: string, value: Record<string, unknown>) => {
    const existing = recordsById.get(id);
    if (!existing) throw new Error(`Missing record ${id}`);
    recordsById.set(id, { ...existing, ...value } as typeof existing);
  });

  return {
    ctx: {
      db: {
        get,
        patch,
        query: (table: string) => queryRecords(recordsById.values(), table),
        insert: async (table: string, value: Record<string, unknown>) => {
          const id = `${table}-${recordsById.size}`;
          recordsById.set(id, { ...value, _id: id, _creationTime: 1 } as TestRecord);
          return id;
        },
      },
      runMutation: vi.fn().mockResolvedValue(null),
    } as unknown as MutationCtx,
    recordsById,
    patch,
  };
}

describe('combined transfer edits', () => {
  const workspaceId = 'workspace-1' as Id<'workspace'>;
  const categoryId = 'category-1' as Id<'category'>;
  const editorOptions = { preserveEditorFields: true };

  function setup() {
    const from = createTransaction('transaction-from', 'bank-1', -5000n, 'transaction-to');
    const to = createTransaction('transaction-to', 'bank-2', 5000n, 'transaction-from');
    const workspace: Doc<'workspace'> = {
      _id: workspaceId,
      _creationTime: 1,
      name: 'Workspace',
      ownerClerkId: 'user-1',
      transactionDefaultPendingStatus: false,
      timezone: 'UTC',
    };
    const accounts: Doc<'bankAccount'>[] = [from, to].map((transaction, index) => ({
      _id: transaction.bankAccountId,
      _creationTime: 1,
      workspaceId,
      name: `Account ${index + 1}`,
      accountType: index === 0 ? 'banking_checking' : 'investment_brokerage',
      currentBalance: transaction.totalAmount,
      clearedBalance: transaction.totalAmount,
      pendingBalance: 0n,
      isClosed: false,
      isDeleted: false,
    }));
    const category: Doc<'category'> = {
      _id: categoryId,
      _creationTime: 1,
      workspaceId,
      name: 'Investing',
      categoryGroupId: 'group-1' as Id<'categoryGroup'>,
      sortOrder: 0,
      isDeleted: false,
    };
    return { ...createContext([workspace, from, to, category, ...accounts]), from, to };
  }

  function withScheduleCreation(ctx: MutationCtx, recordsById: Map<string, TestRecord>) {
    const scheduledId = 'scheduled-new' as Id<'scheduledTransaction'>;
    const scheduleContext = {
      ...ctx,
      auth: { getUserIdentity: async () => ({ subject: 'user-1' }) },
      db: {
        ...ctx.db,
        query: (table: string) =>
          table === 'userProfile'
            ? { withIndex: () => ({ first: async () => ({ _id: 'profile-1' as Id<'userProfile'> }) }) }
            : queryRecords(recordsById.values(), table),
        insert: async (table: string, value: Record<string, unknown>) => {
          const id = table === 'scheduledTransaction' ? scheduledId : `${table}-${recordsById.size}`;
          recordsById.set(id, { ...value, _id: id, _creationTime: 1 } as TestRecord);
          return id;
        },
      },
    } as unknown as MutationCtx;
    return { scheduleContext, scheduledId };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-11T12:00:00.000Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('reopens and unlinks a planned transfer when its incoming half becomes a regular transaction', async () => {
    const { ctx, recordsById, from, to } = setup();
    const planned = createScheduledTransfer();
    recordsById.set(planned._id, planned);
    await updateLinkedScheduledTransaction(ctx, to, workspaceId, planned._id);

    await convertFromTransferInternal(ctx, { transactionId: to._id });

    expect(recordsById.get(to._id)).toMatchObject({
      type: 'regular',
      isDeleted: false,
      totalAmount: 5000n,
      scheduledTransactionId: undefined,
      scheduledOccurrenceDate: undefined,
    });
    expect(recordsById.get(from._id)).toMatchObject({ isDeleted: true });
    expect(recordsById.get(planned._id)).toMatchObject({ nextDate: '2026-07-01', executionCount: 0 });
    expect([...recordsById.values()].find((record) => 'occurrenceDate' in record)).toMatchObject({
      occurrenceDate: '2026-07-01',
      status: 'pending',
      transactionId: undefined,
      manualOnly: true,
    });
  });

  it('updates amount and category together from the incoming half without reversing the accounts', async () => {
    const { ctx, recordsById, from, to } = setup();
    await updateTransactionInternal(
      ctx,
      workspaceId,
      to._id,
      {
        movements: [{ amount: 6200n }],
        categoryId,
        readyToAssign: false,
        preserveReviewStatus: true,
      },
      editorOptions
    );

    expect(recordsById.get(from._id)).toMatchObject({
      bankAccountId: from.bankAccountId,
      totalAmount: -6200n,
      movements: [{ amount: -6200n, categoryId, readyToAssign: false }],
    });
    expect(recordsById.get(to._id)).toMatchObject({ bankAccountId: to.bankAccountId, totalAmount: 6200n });
    expect((recordsById.get(to._id) as Doc<'transaction'>).movements[0].categoryId).toBeUndefined();
  });

  it('saves a planned association, date, notes and status along with both transfer amounts', async () => {
    const { ctx, recordsById, from, to } = setup();
    const planned = createScheduledTransfer();
    recordsById.set(planned._id, planned);
    await updateTransactionInternal(
      ctx,
      workspaceId,
      from._id,
      {
        movements: [{ amount: -6100n }],
        date: '2026-06-30',
        notes: 'Updated transfer',
        status: 'pending',
        linkedScheduledTransactionId: planned._id,
        preserveReviewStatus: true,
      },
      editorOptions
    );

    for (const transaction of [from, to]) {
      expect(recordsById.get(transaction._id)).toMatchObject({
        scheduledTransactionId: planned._id,
        date: '2026-06-30',
        dateYearMonth: 202606,
        notes: 'Updated transfer',
        status: 'pending',
        reviewStatus: 'reviewed',
      });
    }
    expect(recordsById.get(from.bankAccountId)).toMatchObject({ pendingBalance: -6100n, clearedBalance: 0n });
    expect(recordsById.get(to.bankAccountId)).toMatchObject({ pendingBalance: 6100n, clearedBalance: 0n });
    expect(recordsById.get(planned._id)).toMatchObject({ executionCount: 1, lastEnteredTransactionId: from._id });
  });

  it('clears the planned association and notes while changing the amount', async () => {
    const { ctx, recordsById, from, to } = setup();
    for (const transaction of [from, to]) {
      recordsById.set(transaction._id, {
        ...transaction,
        notes: 'Old note',
        scheduledTransactionId: 'scheduled-1' as Id<'scheduledTransaction'>,
      });
    }
    await updateTransactionInternal(
      ctx,
      workspaceId,
      from._id,
      {
        movements: [{ amount: -6100n }],
        notes: null,
        linkedScheduledTransactionId: null,
        preserveReviewStatus: true,
      },
      editorOptions
    );

    for (const transaction of [from, to]) {
      const updated = recordsById.get(transaction._id) as Doc<'transaction'>;
      expect(updated.scheduledTransactionId).toBeUndefined();
      expect(updated.notes).toBeUndefined();
    }
  });

  it('approves review without clearing an omitted status during an amount edit', async () => {
    const { ctx, recordsById, from } = setup();
    recordsById.set(from._id, { ...from, reviewStatus: 'needs_review' as const, originalApprovedAmount: -4000n });
    await updateTransactionInternal(ctx, workspaceId, from._id, { movements: [{ amount: -6100n }] }, editorOptions);

    expect(recordsById.get(from._id)).toMatchObject({ status: 'cleared', reviewStatus: 'reviewed' });
    expect((recordsById.get(from._id) as Doc<'transaction'>).originalApprovedAmount).toBeUndefined();
  });

  it('keeps a cross-budget transfer uncategorized when clearing its category and changing status', async () => {
    const { ctx, recordsById, from, to } = setup();
    recordsById.set(from._id, {
      ...from,
      movements: [{ ...from.movements[0], categoryId }],
    });
    await updateTransactionInternal(
      ctx,
      workspaceId,
      from._id,
      {
        readyToAssign: false,
        status: 'pending',
        preserveReviewStatus: true,
      },
      editorOptions
    );

    expect(recordsById.get(from._id)).toMatchObject({ hasUncategorized: true, status: 'pending' });
    expect((recordsById.get(from._id) as Doc<'transaction'>).movements[0].categoryId).toBeUndefined();
    expect(recordsById.get(to._id)).toMatchObject({ hasUncategorized: false, status: 'pending' });
  });

  it('rejects an account or category belonging to another workspace before updating either half', async () => {
    const { ctx, recordsById, from, to, patch } = setup();
    recordsById.set(categoryId, {
      ...(recordsById.get(categoryId) as Doc<'category'>),
      workspaceId: 'workspace-other' as Id<'workspace'>,
    });
    await expect(updateTransactionInternal(ctx, workspaceId, from._id, { categoryId }, editorOptions)).rejects.toThrow(
      'Category not found or access denied'
    );
    recordsById.set(to.bankAccountId, {
      ...(recordsById.get(to.bankAccountId) as Doc<'bankAccount'>),
      workspaceId: 'workspace-other' as Id<'workspace'>,
    });
    await expect(
      updateTransactionInternal(ctx, workspaceId, from._id, { toAccountId: to.bankAccountId }, editorOptions)
    ).rejects.toThrow('Bank account not found or access denied');
    expect(patch).not.toHaveBeenCalled();
  });

  it('rejects foreign payees and split categories on regular editor transactions', async () => {
    const { ctx, recordsById, from, patch } = setup();
    const merchantId = 'merchant-foreign' as Id<'merchant'>;
    recordsById.set(from._id, { ...from, type: 'regular' as const });
    recordsById.set(merchantId, {
      _id: merchantId,
      _creationTime: 1,
      name: 'Foreign merchant',
      workspaceId: 'workspace-other' as Id<'workspace'>,
      isDeleted: false,
      updatedAt: '2026-07-01T00:00:00.000Z',
    });
    recordsById.set(categoryId, {
      ...(recordsById.get(categoryId) as Doc<'category'>),
      workspaceId: 'workspace-other' as Id<'workspace'>,
    });

    await expect(updateTransactionInternal(ctx, workspaceId, from._id, { merchantId }, editorOptions)).rejects.toThrow(
      'Payee not found or access denied'
    );
    await expect(
      updateTransactionInternal(
        ctx,
        workspaceId,
        from._id,
        {
          movements: [{ amount: -4000n }, { amount: -1000n, categoryId }],
        },
        editorOptions
      )
    ).rejects.toThrow('Category not found or access denied');
    expect(patch).not.toHaveBeenCalled();
  });

  it('rejects a planned-link change combined with a future conversion instead of ignoring it', async () => {
    const { ctx, from, patch } = setup();
    await expect(
      updateTransactionInternal(
        ctx,
        workspaceId,
        from._id,
        {
          date: '2026-08-10',
          linkedScheduledTransactionId: 'scheduled-1' as Id<'scheduledTransaction'>,
        },
        editorOptions
      )
    ).rejects.toThrow('Choose either an existing planned transaction or a new schedule');
    expect(patch).not.toHaveBeenCalled();
  });

  it.each([false, true])('preserves transfer movement notes only for editor saves: %s', async (editorSave) => {
    const { ctx, recordsById, from, to } = setup();
    for (const transaction of [from, to]) {
      recordsById.set(transaction._id, {
        ...transaction,
        movements: [{ ...transaction.movements[0], notes: `Note for ${transaction._id}` }],
      });
    }
    await updateTransactionInternal(
      ctx,
      workspaceId,
      from._id,
      {
        movements: [{ amount: -6100n }],
        notes: 'Transfer note',
        preserveReviewStatus: true,
      },
      editorSave ? editorOptions : undefined
    );

    for (const transaction of [from, to]) {
      expect((recordsById.get(transaction._id) as Doc<'transaction'>).movements[0].notes).toBe(
        editorSave ? `Note for ${transaction._id}` : undefined
      );
    }
  });

  it('retains legacy transfer-update semantics when editor behavior is not requested', async () => {
    const { ctx, recordsById, from, to } = setup();
    const planned = createScheduledTransfer();
    recordsById.set(planned._id, planned);
    await updateTransactionInternal(ctx, workspaceId, from._id, {
      movements: [{ amount: -6100n }],
      date: '2026-06-30',
      linkedScheduledTransactionId: planned._id,
      preserveReviewStatus: true,
    });

    for (const transaction of [from, to]) {
      expect(recordsById.get(transaction._id)).toMatchObject({ date: '2026-06-30', dateYearMonth: 202607 });
      expect((recordsById.get(transaction._id) as Doc<'transaction'>).scheduledTransactionId).toBeUndefined();
    }
    expect(recordsById.get(planned._id)).toMatchObject({ executionCount: 0 });
  });

  it.each([false, true])('applies status before recurrence creation only for editor saves: %s', async (editorSave) => {
    const { ctx, recordsById, from, to } = setup();
    const { scheduleContext, scheduledId } = withScheduleCreation(ctx, recordsById);

    await updateTransactionInternal(
      scheduleContext,
      workspaceId,
      to._id,
      {
        movements: [{ amount: 6200n }],
        categoryId,
        status: 'pending',
        recurrence: 'monthly',
        entryMode: 'manual',
        preserveReviewStatus: true,
      },
      editorSave ? editorOptions : undefined
    );

    const expectedStatus = editorSave ? 'pending' : 'cleared';
    expect(recordsById.get(scheduledId)).toMatchObject({
      entryStatus: expectedStatus,
      entryMode: 'manual',
      movements: [{ amount: 6200n, categoryId }],
    });
    for (const transaction of [from, to]) {
      expect(recordsById.get(transaction._id)).toMatchObject({
        status: expectedStatus,
        scheduledTransactionId: scheduledId,
      });
    }
  });

  it.each([false, true])(
    'preserves unchanged category or Ready to Assign when an amount edit becomes planned: %s',
    async (readyToAssign) => {
      const { ctx, recordsById, from, to } = setup();
      const { scheduleContext, scheduledId } = withScheduleCreation(ctx, recordsById);
      recordsById.set(from._id, {
        ...from,
        movements: [{ ...from.movements[0], categoryId: readyToAssign ? undefined : categoryId, readyToAssign }],
      });

      const result = await updateTransactionInternal(
        scheduleContext,
        workspaceId,
        to._id,
        {
          movements: [{ amount: 6200n }],
          date: '2026-08-10',
          status: 'pending',
          entryMode: 'manual',
          preserveReviewStatus: true,
        },
        editorOptions
      );

      expect(result).toMatchObject({ convertedToScheduled: true, scheduledTransactionId: scheduledId });
      expect(recordsById.get(scheduledId)).toMatchObject({
        entryStatus: 'pending',
        movements: [{ amount: 6200n, categoryId: readyToAssign ? undefined : categoryId, readyToAssign }],
      });
      expect(recordsById.get(from._id)).toMatchObject({ isDeleted: true });
      expect(recordsById.get(to._id)).toMatchObject({ isDeleted: true });
    }
  );
});

describe('updateLinkedScheduledTransaction', () => {
  const workspaceId = 'workspace-1' as Id<'workspace'>;
  const scheduledId = 'scheduled-1' as Id<'scheduledTransaction'>;
  let fromTransaction: Doc<'transaction'>;
  let toTransaction: Doc<'transaction'>;
  let scheduled: Doc<'scheduledTransaction'>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-11T12:00:00.000Z'));
    fromTransaction = createTransaction('transaction-from', 'bank-1', -5000n, 'transaction-to');
    toTransaction = createTransaction('transaction-to', 'bank-2', 5000n, 'transaction-from');
    scheduled = createScheduledTransfer();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('links both transfer halves and consumes the planned occurrence once using the outflow half', async () => {
    const workspace = {
      _id: workspaceId,
      _creationTime: 1,
      name: 'Workspace',
      updatedAt: '2026-07-01T00:00:00.000Z',
      isDeleted: false,
      timezone: 'UTC',
    } as Doc<'workspace'>;
    const { ctx, recordsById } = createContext([workspace, fromTransaction, toTransaction, scheduled]);

    await updateLinkedScheduledTransaction(ctx, toTransaction, workspaceId, scheduledId);

    expect((recordsById.get(fromTransaction._id) as Doc<'transaction'>).scheduledTransactionId).toBe(scheduledId);
    expect((recordsById.get(toTransaction._id) as Doc<'transaction'>).scheduledTransactionId).toBe(scheduledId);
    expect(recordsById.get(scheduledId)).toMatchObject({
      executionCount: 1,
      lastEnteredTransactionId: fromTransaction._id,
      nextDate: '2026-08-01',
    });
  });

  it('does not consume the occurrence again when one half is already linked and unlinks both halves together', async () => {
    fromTransaction = { ...fromTransaction, scheduledTransactionId: scheduledId };
    const workspace = {
      _id: workspaceId,
      _creationTime: 1,
      name: 'Workspace',
      updatedAt: '2026-07-01T00:00:00.000Z',
      isDeleted: false,
      timezone: 'UTC',
    } as Doc<'workspace'>;
    const { ctx, recordsById } = createContext([workspace, fromTransaction, toTransaction, scheduled]);

    await updateLinkedScheduledTransaction(ctx, toTransaction, workspaceId, scheduledId);

    expect(recordsById.get(scheduledId)).toMatchObject({ executionCount: 0, nextDate: '2026-08-01' });
    expect((recordsById.get(toTransaction._id) as Doc<'transaction'>).scheduledTransactionId).toBe(scheduledId);

    const linkedToTransaction = recordsById.get(toTransaction._id) as Doc<'transaction'>;
    await updateLinkedScheduledTransaction(ctx, linkedToTransaction, workspaceId, null);

    expect((recordsById.get(fromTransaction._id) as Doc<'transaction'>).scheduledTransactionId).toBeUndefined();
    expect((recordsById.get(toTransaction._id) as Doc<'transaction'>).scheduledTransactionId).toBeUndefined();
  });
});

describe('autoLinkImportedTransactionToScheduledMatch', () => {
  it('matches, links, consumes, and removes a planned occurrence from the batch cache', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-11T12:00:00.000Z'));

    const workspaceId = 'workspace-1' as Id<'workspace'>;
    const bankAccountId = 'bank-1' as Id<'bankAccount'>;
    const merchantId = 'merchant-1' as Id<'merchant'>;
    const categoryId = 'category-1' as Id<'category'>;
    const transaction = {
      ...createTransaction('transaction-1', bankAccountId, -5000n, 'unused-pair'),
      type: 'regular' as const,
      source: 'automatic_import' as const,
      transferPairId: undefined,
      transferPairBankAccountId: undefined,
      merchantId,
      movements: [{ amount: -5000n, categoryId, readyToAssign: false, sortOrder: 0 }],
    };
    const scheduled = {
      ...createScheduledTransfer(),
      transactionType: 'regular' as const,
      transferToAccountId: undefined,
      entryMode: 'manual' as const,
      bankAccountId,
      merchantId,
      movements: [{ amount: -5000n, categoryId, readyToAssign: false }],
      anchorDate: '2026-07-11',
      nextDate: '2026-07-11',
    };
    const workspace = {
      _id: workspaceId,
      _creationTime: 1,
      name: 'Workspace',
      updatedAt: '2026-07-01T00:00:00.000Z',
      isDeleted: false,
      timezone: 'UTC',
    } as Doc<'workspace'>;
    const matchingCache: ScheduledMatchingCache = {
      scheduledTransactionsByAccount: new Map([[bankAccountId, [scheduled]]]),
    };
    const { ctx, recordsById } = createContext([workspace, transaction, scheduled]);

    const match = await autoLinkImportedTransactionToScheduledMatch(
      ctx,
      transaction,
      workspaceId,
      {
        bankAccountId,
        merchantId,
        categoryId,
        amount: -5000n,
        date: '2026-07-11',
      },
      matchingCache
    );

    expect(match?.confidence).toBe(100);
    expect((recordsById.get(transaction._id) as Doc<'transaction'>).scheduledTransactionId).toBe(scheduled._id);
    expect(recordsById.get(scheduled._id)).toMatchObject({
      executionCount: 1,
      lastEnteredTransactionId: transaction._id,
      nextDate: '2026-08-11',
    });
    expect(matchingCache.scheduledTransactionsByAccount.has(bankAccountId)).toBe(false);

    vi.useRealTimers();
  });
});

describe('buildBulkTransactionUpdates', () => {
  it('preserves each regular transaction amount when replacing its category', () => {
    const transaction = {
      ...createTransaction('transaction-1', 'bank-1', -7250n, 'unused-pair'),
      type: 'regular' as const,
      transferPairId: undefined,
      transferPairBankAccountId: undefined,
    };
    const categoryId = 'category-1' as Id<'category'>;

    expect(buildBulkTransactionUpdates(transaction, { categoryId })).toEqual({
      movements: [
        {
          amount: -7250n,
          categoryId,
          readyToAssign: undefined,
        },
      ],
    });
  });

  it('maps an account update to the selected side of a transfer', () => {
    const fromTransaction = createTransaction('transaction-from', 'bank-1', -5000n, 'transaction-to');
    const toTransaction = createTransaction('transaction-to', 'bank-2', 5000n, 'transaction-from');
    const accountId = 'bank-3' as Id<'bankAccount'>;

    expect(buildBulkTransactionUpdates(fromTransaction, { bankAccountId: accountId })).toEqual({
      fromAccountId: accountId,
    });
    expect(buildBulkTransactionUpdates(toTransaction, { bankAccountId: accountId })).toEqual({
      toAccountId: accountId,
    });
  });

  it('keeps null notes as an explicit clear without adding unrelated fields', () => {
    const transaction = {
      ...createTransaction('transaction-1', 'bank-1', -5000n, 'unused-pair'),
      type: 'regular' as const,
      transferPairId: undefined,
      transferPairBankAccountId: undefined,
    };

    expect(buildBulkTransactionUpdates(transaction, { notes: null })).toEqual({ notes: null });
  });
});

describe('credit-card cross-budget transfer conversion', () => {
  it('reapplies categorized credit-card spending when an outflow becomes a transfer', async () => {
    const workspaceId = 'workspace-1' as Id<'workspace'>;
    const transactionId = 'transaction-1' as Id<'transaction'>;
    const creditAccountId = 'credit-account' as Id<'bankAccount'>;
    const investmentAccountId = 'investment-account' as Id<'bankAccount'>;
    const creditCategoryId = 'credit-category' as Id<'category'>;
    const spendingCategoryId = 'spending-category' as Id<'category'>;
    const runMutation = vi.fn().mockResolvedValue(null);
    const ctx = { runMutation } as unknown as MutationCtx;

    const before: TransactionSnapshot = {
      workspaceId,
      transactionId,
      bankAccountId: creditAccountId,
      type: 'regular',
      date: '2026-07-09',
      status: 'cleared',
      totalAmount: -225465n,
      isCreditCardAccount: true,
      isExcludedFromRTA: true,
      creditCardCategoryId: creditCategoryId,
      merchantId: undefined,
      movements: [
        {
          categoryId: spendingCategoryId,
          readyToAssign: false,
          amount: -225465n,
          creditCardTransfer: { creditCardCategoryId: creditCategoryId, spendingCategoryId },
        },
      ],
      transferPairId: undefined,
      transferPairBankAccountId: undefined,
    };
    const after: TransactionSnapshot = {
      ...before,
      type: 'transfer',
      movements: [{ categoryId: spendingCategoryId, readyToAssign: false, amount: -225465n }],
      transferPairId: 'transaction-pair' as Id<'transaction'>,
      transferPairBankAccountId: investmentAccountId,
    };

    await reconcileTransactionSideEffects(ctx, before, after, { skipBankAccountBalance: true });

    expect(runMutation).toHaveBeenNthCalledWith(1, internal.categoryBudgets.reverseMoneyMovementBetweenCategories, {
      workspaceId,
      fromCategoryId: creditCategoryId,
      toCategoryId: spendingCategoryId,
      amount: -225465n,
      transactionDate: '2026-07-09',
      isRefund: false,
    });
    expect(runMutation).toHaveBeenNthCalledWith(2, internal.categoryBudgets.moveMoneyBetweenCategories, {
      workspaceId,
      fromCategoryId: spendingCategoryId,
      toCategoryId: creditCategoryId,
      amount: -225465n,
      transactionDate: '2026-07-09',
      isRefund: false,
    });
    expect(runMutation).toHaveBeenCalledTimes(2);
  });
});

describe('editor transfer conversion', () => {
  function setup(amount: bigint, overrides: Partial<Doc<'transaction'>> = {}) {
    const original = {
      ...createTransaction('transaction-1', 'bank-1', amount, 'unused'),
      type: 'regular' as const,
      transferPairId: undefined,
      transferPairBankAccountId: undefined,
      reviewStatus: 'needs_review' as const,
      notes: 'Imported note',
      ...overrides,
    };
    const accounts: Doc<'bankAccount'>[] = ['bank-1', 'bank-2'].map((id) => ({
      _id: id as Id<'bankAccount'>,
      _creationTime: 1,
      workspaceId: original.workspaceId,
      name: id,
      accountType: 'banking_checking',
      currentBalance: 0n,
      isClosed: false,
      isDeleted: false,
    }));
    const state = createContext([original, ...accounts]);
    const insert = vi.fn(async (_table: string, value: Record<string, unknown>) => {
      const id = 'created-pair' as Id<'transaction'>;
      state.recordsById.set(id, { ...value, _id: id, _creationTime: 1 } as Doc<'transaction'>);
      return id;
    });
    const ctx = { ...state.ctx, db: { ...state.ctx.db, insert } } as unknown as MutationCtx;
    return { ...state, ctx, original, insert };
  }

  it.each([-1200n, 1200n])(
    'keeps the opened account and sign while converting %s and saving other fields',
    async (amount) => {
      const { resolveEditorTransferType } = await import('./update');
      const { ctx, recordsById, original, insert } = setup(amount);
      const updates = {
        fromAccountId: (amount < 0n ? 'bank-1' : 'bank-2') as Id<'bankAccount'>,
        toAccountId: (amount < 0n ? 'bank-2' : 'bank-1') as Id<'bankAccount'>,
        movements: [{ amount: amount * 2n }],
        notes: 'Edited at approval',
        status: 'pending' as const,
        date: '2026-07-02',
        reviewStatus: 'reviewed' as const,
        preserveReviewStatus: true,
      };
      const id = await resolveEditorTransferType(ctx, original.workspaceId, original, 'transfer', updates);
      await updateTransactionInternal(ctx, original.workspaceId, id, updates, { preserveEditorFields: true });
      expect(insert).toHaveBeenCalledOnce();
      expect(recordsById.get(id)).toMatchObject({
        type: 'transfer',
        bankAccountId: 'bank-1',
        totalAmount: amount * 2n,
        reviewStatus: 'reviewed',
        status: 'pending',
        date: '2026-07-02',
        notes: 'Edited at approval',
        transferPairBankAccountId: 'bank-2',
      });
      expect(recordsById.get('created-pair')).toMatchObject({ bankAccountId: 'bank-2', totalAmount: -amount * 2n });
    }
  );

  it.each([-1200n, 1200n])(
    'allows a direction edit before conversion while retaining the opened account: %s',
    async (amount) => {
      const { resolveEditorTransferType } = await import('./update');
      const { ctx, recordsById, original } = setup(amount);
      const updates = {
        fromAccountId: (amount > 0n ? 'bank-1' : 'bank-2') as Id<'bankAccount'>,
        toAccountId: (amount > 0n ? 'bank-2' : 'bank-1') as Id<'bankAccount'>,
        movements: [{ amount: -amount, readyToAssign: false }],
        preserveReviewStatus: true,
      };
      const id = await resolveEditorTransferType(ctx, original.workspaceId, original, 'transfer', updates);
      await updateTransactionInternal(ctx, original.workspaceId, id, updates, { preserveEditorFields: true });
      expect(recordsById.get(id)).toMatchObject({ bankAccountId: 'bank-1', totalAmount: -amount, type: 'transfer' });
      expect(recordsById.get('created-pair')).toMatchObject({ bankAccountId: 'bank-2', totalAmount: amount });
    }
  );

  it('uses the linked approval mutation without creating another imported counterpart', async () => {
    const { resolveEditorTransferType } = await import('./update');
    const { ctx, recordsById, original, insert } = setup(1200n, {
      suggestedTransfer: {
        status: 'linked_pending_approval',
        transferConfidence: 95,
        detectionReason: 'Matching imports',
        matchedTransactionId: 'matched' as Id<'transaction'>,
      },
    });
    recordsById.set('matched', {
      ...original,
      _id: 'matched' as Id<'transaction'>,
      bankAccountId: 'bank-2' as Id<'bankAccount'>,
    });
    const id = await resolveEditorTransferType(ctx, original.workspaceId, original, 'transfer', {
      fromAccountId: 'bank-2' as Id<'bankAccount'>,
      toAccountId: 'bank-1' as Id<'bankAccount'>,
    });
    const { api } = await import('../_generated/api');
    expect(ctx.runMutation).toHaveBeenCalledWith(api.transferDetection.approveLinkedTransfer, {
      workspaceId: original.workspaceId,
      transactionId: original._id,
    });
    expect(id).toBe(original._id);
    expect(insert).not.toHaveBeenCalled();
  });

  it('continues editing the surviving transaction when approval deduplicates an import', async () => {
    const { resolveEditorTransferType } = await import('./update');
    const { ctx, original, insert } = setup(-1200n, {
      suggestedTransfer: { status: 'pending', transferConfidence: 90, detectionReason: 'Bank transfer' },
    });
    vi.mocked(ctx.runMutation).mockResolvedValue({ success: true, transactionId: 'existing-placeholder' });
    expect(
      await resolveEditorTransferType(ctx, original.workspaceId, original, 'transfer', {
        toAccountId: 'bank-2' as Id<'bankAccount'>,
      })
    ).toBe('existing-placeholder');
    expect(insert).not.toHaveBeenCalled();
  });

  it.each(['foreign', 'closed', 'missing', 'same'])(
    'rejects a %s counterpart before conversion writes',
    async (kind) => {
      const { resolveEditorTransferType } = await import('./update');
      const { ctx, recordsById, original, insert, patch } = setup(-1200n);
      const other = recordsById.get('bank-2') as Doc<'bankAccount'>;
      if (kind === 'foreign') recordsById.set('bank-2', { ...other, workspaceId: 'elsewhere' as Id<'workspace'> });
      if (kind === 'closed') recordsById.set('bank-2', { ...other, isClosed: true });
      await expect(
        resolveEditorTransferType(ctx, original.workspaceId, original, 'transfer', {
          toAccountId: (kind === 'same' ? 'bank-1' : kind === 'missing' ? undefined : 'bank-2') as
            | Id<'bankAccount'>
            | undefined,
        })
      ).rejects.toThrow();
      expect(insert).not.toHaveBeenCalled();
      expect(patch).not.toHaveBeenCalled();
    }
  );

  it('turns an unpaired legacy transfer back into a regular transaction', async () => {
    const { resolveEditorTransferType } = await import('./update');
    const { ctx, original, recordsById } = setup(1200n, { type: 'transfer' });
    await resolveEditorTransferType(ctx, original.workspaceId, original, 'regular', {});
    expect(recordsById.get(original._id)).toMatchObject({
      type: 'regular',
      bankAccountId: 'bank-1',
      totalAmount: 1200n,
    });
  });

  it.each([false, true])('reverses a transfer and preserves an imported counterpart: %s', async (imported) => {
    const { resolveEditorTransferType } = await import('./update');
    const { ctx, original, recordsById } = setup(-1200n, {
      type: 'transfer',
      transferPairId: 'matched' as Id<'transaction'>,
      transferPairBankAccountId: 'bank-2' as Id<'bankAccount'>,
    });
    recordsById.set('matched', {
      ...createTransaction('matched', 'bank-2', 1200n, original._id),
      ...(imported ? { transactionImportRawId: 'raw-import' as Id<'transactionImportRaw'> } : {}),
    });
    await resolveEditorTransferType(ctx, original.workspaceId, original, 'regular', {});
    expect(recordsById.get(original._id)).toMatchObject({ type: 'regular', totalAmount: -1200n });
    expect(recordsById.get('matched')).toMatchObject(
      imported
        ? { type: 'regular', totalAmount: 1200n, isDeleted: false, reviewStatus: 'needs_review' }
        : { isDeleted: true }
    );
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
