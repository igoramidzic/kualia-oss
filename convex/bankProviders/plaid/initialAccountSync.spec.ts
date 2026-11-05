import { type FunctionReference, getFunctionName } from 'convex/server';
import type { Transaction } from 'plaid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Doc, Id } from '../../_generated/dataModel';
import type { ActionCtx, MutationCtx } from '../../_generated/server';
import { requireBankLinkAccountAccessForWorkspace } from '../../bankLinks/helpers';
import { processRawTransactionImports } from '../../transactionImport/processRawTransactionImports';
import { drainAccountImports, finish, getPendingAccount, insertBatch, syncAccount } from './initialAccountSync';
import { plaidClient } from './plaidClient';
import { convertPlaidTransaction } from './plaidTransactionSync';

vi.mock('../../bankLinks/helpers', () => ({ requireBankLinkAccountAccessForWorkspace: vi.fn() }));

const bankAccountId = 'bank_account_target' as Id<'bankAccount'>;
const bankLinkAccountId = 'bank_link_account_target' as Id<'bankLinkAccount'>;
const workspaceId = 'workspace_target' as Id<'workspace'>;
const bankLinkId = 'bank_link_1' as Id<'bankLink'>;
const args = { bankAccountId, bankLinkAccountId, generation: 'current-attempt' };
const rawImportId = 'raw_target' as Id<'transactionImportRaw'>;

type AccountArgs = typeof args;
type ConvertedTransaction = ReturnType<typeof convertPlaidTransaction>;
const insertHandler = (
  insertBatch as unknown as {
    _handler: (ctx: MutationCtx, args: AccountArgs & { transactions: ConvertedTransaction[] }) => Promise<unknown>;
  }
)._handler;
const finishHandler = (
  finish as unknown as {
    _handler: (ctx: MutationCtx, args: AccountArgs & { currentBalance?: bigint }) => Promise<boolean>;
  }
)._handler;
const syncHandler = (
  syncAccount as unknown as {
    _handler: (ctx: ActionCtx, args: AccountArgs & { attempt?: number }) => Promise<null>;
  }
)._handler;
const drainHandler = (
  drainAccountImports as unknown as { _handler: (ctx: MutationCtx, args: AccountArgs) => Promise<null> }
)._handler;
const processHandler = (
  processRawTransactionImports as unknown as {
    _handler: (ctx: MutationCtx, args: { workspaceId: Id<'workspace'> }) => Promise<unknown>;
  }
)._handler;

function functionName(reference: unknown): string {
  return getFunctionName(reference as FunctionReference<'mutation'>);
}

function transaction(id: string, plaidAccountId = 'plaid_target', amount = 12): Transaction {
  return {
    transaction_id: id,
    account_id: plaidAccountId,
    date: '2026-09-06',
    amount,
    pending: false,
  } as Transaction;
}

function mutationContext(overrides: Partial<Doc<'bankAccount'>> = {}) {
  const account = {
    _id: bankAccountId,
    workspaceId,
    bankLinkAccountId,
    currentBalance: 100000n,
    isClosed: false,
    isDeleted: false,
    plaidInitialSync: {
      bankLinkAccountId,
      generation: args.generation,
      startDate: '2026-09-06',
      status: 'pending',
      preserveBalance: true,
    },
    ...overrides,
  } as Doc<'bankAccount'>;
  const patch = vi.fn(async (id: string, updates: Partial<Doc<'bankAccount'>>) => {
    if (id === bankAccountId) Object.assign(account, updates);
  });
  const runMutation = vi.fn().mockResolvedValue(null);
  const runAfter = vi.fn();
  const ctx = {
    db: {
      get: vi.fn(async (id: string) => {
        if (id === bankAccountId) return account;
        if (id === workspaceId) return { _id: workspaceId, isDeleted: false, isArchived: false };
        return null;
      }),
      patch,
    },
    runMutation,
    scheduler: { runAfter },
  } as unknown as MutationCtx;
  return { ctx, account, patch, runMutation, runAfter };
}

function queryFixture(records: Record<string, unknown>[]) {
  const query = {
    withIndex: vi.fn(() => query),
    filter: vi.fn(() => query),
    collect: async () => records,
    async *[Symbol.asyncIterator]() {
      yield* records;
    },
  };
  return query;
}

beforeEach(() => {
  vi.mocked(requireBankLinkAccountAccessForWorkspace).mockResolvedValue({
    bankLink: { _id: bankLinkId, itemId: 'item_shared', itemStatus: 'Healthy', accessToken: 'access_test' },
    bankLinkAccount: { _id: bankLinkAccountId, plaidAccountId: 'plaid_target' },
  } as Awaited<ReturnType<typeof requireBankLinkAccountAccessForWorkspace>>);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('targeted Plaid replay mutations', () => {
  it('rejects an old generation after the same account and source have been relinked', async () => {
    const { ctx, runMutation, patch, runAfter } = mutationContext();
    const staleArgs = { ...args, generation: 'previous-attempt' };

    await expect(getPendingAccount(ctx, staleArgs)).resolves.toBeNull();
    await expect(insertHandler(ctx, { ...staleArgs, transactions: [] })).resolves.toEqual({
      active: false,
      rawImportIds: [],
    });
    await expect(finishHandler(ctx, { ...staleArgs, currentBalance: 200000n })).resolves.toBe(false);

    expect(requireBankLinkAccountAccessForWorkspace).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(runAfter).not.toHaveBeenCalled();
  });

  it.each([{ isClosed: true }, { isDeleted: true }, { bankLinkAccountId: undefined }, { plaidInitialSync: undefined }])(
    'does not replay inactive or legacy unmarked accounts: %j',
    async (overrides) => {
      const { ctx } = mutationContext(overrides);
      await expect(getPendingAccount(ctx, args)).resolves.toBeNull();
    }
  );

  it('consumes only the target account raw IDs and propagates changes to already imported transactions', async () => {
    const { ctx, runMutation } = mutationContext();
    runMutation
      .mockResolvedValueOnce({ rawImportIds: [rawImportId], updatedInsertedIds: [rawImportId] })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ processedCount: 1, errorCount: 0 });
    const target = convertPlaidTransaction(transaction('target_txn'), null);
    const unrelated = convertPlaidTransaction(transaction('unrelated_txn', 'plaid_unrelated'), null);

    await expect(insertHandler(ctx, { ...args, transactions: [target, unrelated] })).resolves.toEqual({
      active: true,
      rawImportIds: [rawImportId],
    });

    expect(runMutation.mock.calls.map(([reference]) => functionName(reference))).toEqual([
      'bankProviders/plaid/plaidTransactionSync:upsertTransactions',
      'transactionImport/updateLinkedTransactions:updateLinkedTransactionsFromRawImports',
      'transactionImport/processRawTransactionImports:processRawTransactionImports',
    ]);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({ workspaceId, transactions: [target] });
    expect(runMutation.mock.calls[1]?.[1]).toEqual({ rawImportIds: [rawImportId] });
    expect(runMutation.mock.calls[2]?.[1]).toEqual({
      workspaceId,
      isFirstSync: false,
      rawImportIds: [rawImportId],
    });
  });

  it('leaves a new account pending when a fresh bank balance is unavailable', async () => {
    const { ctx, account, runMutation, patch, runAfter } = mutationContext();

    await expect(finishHandler(ctx, args)).rejects.toThrow('current account balance');

    expect(account.plaidInitialSync?.status).toBe('pending');
    expect(runMutation).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(runAfter).not.toHaveBeenCalled();
  });

  it('finishes an existing manual account without rewriting its baseline or sweeping workspace imports', async () => {
    const { ctx, account, runMutation, runAfter } = mutationContext({
      currentBalance: 90000n,
      plaidInitialSync: { ...args, startDate: '2026-09-06', status: 'pending', preserveBalance: false },
    });

    await expect(finishHandler(ctx, args)).resolves.toBe(true);

    expect(account.currentBalance).toBe(90000n);
    expect(account.plaidInitialSync?.status).toBe('complete');
    expect(runMutation).not.toHaveBeenCalled();
    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), args);
    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), { itemId: 'item_shared' });
  });

  it('reconciles only the selected new account and then completes its generation', async () => {
    const { ctx, account, runMutation } = mutationContext();

    await expect(finishHandler(ctx, { ...args, currentBalance: 100000n })).resolves.toBe(true);

    expect(runMutation).toHaveBeenCalledOnce();
    expect(functionName(runMutation.mock.calls[0]?.[0])).toBe('bankAccounts:calculateAndInsertStartingBalances');
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      workspaceId,
      bankLinkId,
      bankAccountId,
      initialBalanceDate: '2026-09-06',
      currentBalance: 100000n,
    });
    expect(account.plaidInitialSync).toMatchObject({ status: 'complete', generation: args.generation });
  });

  it('leaves a late webhook raw queued while the new account baseline is being reconciled', async () => {
    const { ctx, account, patch } = mutationContext();
    const pendingRaw = {
      _id: rawImportId,
      workspaceId,
      plaidAccountId: 'plaid_target',
      importStatus: 'awaiting_insert_job',
      amount: -10000n,
    };
    const processorContext = {
      ...ctx,
      db: {
        ...ctx.db,
        get: async (id: string) => (id === bankLinkAccountId ? { plaidAccountId: 'plaid_target' } : null),
        query: (table: string) => queryFixture(table === 'bankAccount' ? [account] : [pendingRaw]),
      },
    } as unknown as MutationCtx;

    await expect(processHandler(processorContext, { workspaceId })).resolves.toMatchObject({
      processedCount: 0,
      errorCount: 0,
    });

    expect(patch).not.toHaveBeenCalled();
    expect(pendingRaw.importStatus).toBe('awaiting_insert_job');
    expect(account.currentBalance).toBe(100000n);
  });

  it('drains only late target imports after baseline completion', async () => {
    const { ctx, runMutation } = mutationContext({
      plaidInitialSync: { ...args, startDate: '2026-09-06', status: 'complete', preserveBalance: true },
    });
    const pending = queryFixture([
      { _id: rawImportId, plaidAccountId: 'plaid_target', importStatus: 'awaiting_insert_job' },
      { _id: 'raw_other_account', plaidAccountId: 'plaid_other', importStatus: 'awaiting_insert_job' },
      { _id: 'raw_already_imported', plaidAccountId: 'plaid_target', importStatus: 'inserted' },
    ]);
    const drainContext = { ...ctx, db: { ...ctx.db, query: () => pending } } as unknown as MutationCtx;

    await drainHandler(drainContext, args);

    expect(runMutation).toHaveBeenCalledOnce();
    expect(runMutation.mock.calls[0]?.[1]).toEqual({ workspaceId, isFirstSync: false, rawImportIds: [rawImportId] });
  });
});

describe('targeted Plaid replay action', () => {
  function actionContext() {
    const runQuery = vi.fn().mockResolvedValue({
      workspaceId,
      accessToken: 'access_test',
      plaidAccountId: 'plaid_target',
      startDate: '2026-09-06',
      preserveBalance: true,
    });
    const runMutation = vi.fn().mockResolvedValue({ active: true, rawImportIds: [rawImportId] });
    const runAfter = vi.fn();
    return {
      ctx: { runQuery, runMutation, scheduler: { runAfter } } as unknown as ActionCtx,
      runQuery,
      runMutation,
      runAfter,
    };
  }

  it('replays pages for only the selected account without mutating the shared item cursor', async () => {
    const sync = vi.spyOn(plaidClient, 'transactionsSync');
    sync.mockResolvedValueOnce({
      data: {
        added: [transaction('kept'), transaction('removed'), transaction('other', 'plaid_other')],
        modified: [],
        removed: [],
        next_cursor: 'replay_page_2',
        has_more: true,
      },
    } as unknown as Awaited<ReturnType<typeof plaidClient.transactionsSync>>);
    sync.mockResolvedValueOnce({
      data: {
        added: [],
        modified: [transaction('kept', 'plaid_target', 15)],
        removed: [{ transaction_id: 'removed' }],
        next_cursor: 'replay_finished',
        has_more: false,
      },
    } as unknown as Awaited<ReturnType<typeof plaidClient.transactionsSync>>);
    vi.spyOn(plaidClient, 'accountsGet').mockResolvedValue({
      data: { accounts: [{ account_id: 'plaid_target', type: 'depository', balances: { current: 1000 } }] },
    } as unknown as Awaited<ReturnType<typeof plaidClient.accountsGet>>);
    const { ctx, runMutation, runAfter } = actionContext();

    await syncHandler(ctx, args);

    expect(sync.mock.calls[0]?.[0]?.cursor).toBeUndefined();
    expect(sync.mock.calls[1]?.[0]?.cursor).toBe('replay_page_2');
    expect(runMutation.mock.calls.map(([reference]) => functionName(reference))).toEqual([
      'bankProviders/plaid/initialAccountSync:insertBatch',
      'bankProviders/plaid/initialAccountSync:finish',
    ]);
    expect(runMutation.mock.calls[0]?.[1]).toMatchObject({
      ...args,
      transactions: [{ plaidTransactionId: 'kept', plaidAccountId: 'plaid_target', amount: -1500 }],
    });
    expect(runMutation.mock.calls[1]?.[1]).toEqual({ ...args, currentBalance: 100000n });
    expect(runAfter).not.toHaveBeenCalled();
  });

  it('retries an unready bank response without inserting rows or marking the account complete', async () => {
    vi.spyOn(plaidClient, 'transactionsSync').mockResolvedValue({
      data: {
        added: [],
        modified: [],
        removed: [],
        next_cursor: 'unready',
        has_more: false,
        transactions_update_status: 'NOT_READY',
      },
    } as unknown as Awaited<ReturnType<typeof plaidClient.transactionsSync>>);
    const { ctx, runMutation, runAfter } = actionContext();

    await syncHandler(ctx, args);

    expect(runMutation).not.toHaveBeenCalled();
    expect(runAfter).toHaveBeenCalledWith(10000, expect.anything(), { ...args, attempt: 1 });
  });
});
