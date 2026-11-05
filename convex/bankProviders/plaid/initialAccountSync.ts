import { v } from 'convex/values';
import type { Transaction } from 'plaid';

import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { internalAction, internalMutation, internalQuery } from '../../_generated/server';
import { requireBankLinkAccountAccessForWorkspace } from '../../bankLinks/helpers';
import { getSafePlaidErrorDetails, plaidClient, plaidConfig } from './plaidClient';
import { convertPlaidTransaction, plaidRawImportValidator } from './plaidTransactionSync';

const accountArgs = {
  bankAccountId: v.id('bankAccount'),
  bankLinkAccountId: v.id('bankLinkAccount'),
  generation: v.string(),
};
type AccountArgs = { bankAccountId: Id<'bankAccount'>; bankLinkAccountId: Id<'bankLinkAccount'>; generation: string };
type SyncContext = {
  workspaceId: Id<'workspace'>;
  accessToken: string;
  plaidAccountId: string;
  startDate: string;
  preserveBalance: boolean;
};

export async function getPendingAccount(ctx: QueryCtx | MutationCtx, args: AccountArgs, requirePending = true) {
  const account = await ctx.db.get(args.bankAccountId);
  if (
    !account ||
    account.isDeleted ||
    account.isClosed ||
    account.bankLinkAccountId !== args.bankLinkAccountId ||
    account.plaidInitialSync?.bankLinkAccountId !== args.bankLinkAccountId ||
    account.plaidInitialSync.generation !== args.generation ||
    (requirePending && account.plaidInitialSync.status !== 'pending')
  ) {
    return null;
  }
  const workspace = await ctx.db.get(account.workspaceId);
  if (!workspace || workspace.isDeleted || workspace.isArchived) return null;
  const { bankLink, bankLinkAccount } = await requireBankLinkAccountAccessForWorkspace(
    ctx,
    account.workspaceId,
    args.bankLinkAccountId
  );
  if (bankLink.itemStatus === 'Disconnected') return null;
  return { account, bankLink, bankLinkAccount };
}

export const getContext = internalQuery({
  args: accountArgs,
  returns: v.union(
    v.null(),
    v.object({
      workspaceId: v.id('workspace'),
      accessToken: v.string(),
      plaidAccountId: v.string(),
      startDate: v.string(),
      preserveBalance: v.boolean(),
    })
  ),
  handler: async (ctx, args): Promise<SyncContext | null> => {
    const context = await getPendingAccount(ctx, args);
    if (!context) return null;
    return {
      workspaceId: context.account.workspaceId,
      accessToken: context.bankLink.accessToken,
      plaidAccountId: context.bankLinkAccount.plaidAccountId,
      startDate: context.account.plaidInitialSync!.startDate,
      preserveBalance: context.account.plaidInitialSync!.preserveBalance,
    };
  },
});

export const insertBatch = internalMutation({
  args: { ...accountArgs, transactions: v.array(plaidRawImportValidator) },
  returns: v.object({ active: v.boolean(), rawImportIds: v.array(v.id('transactionImportRaw')) }),
  handler: async (ctx, args): Promise<{ active: boolean; rawImportIds: Id<'transactionImportRaw'>[] }> => {
    const context = await getPendingAccount(ctx, args);
    if (!context) return { active: false, rawImportIds: [] };
    const result = await ctx.runMutation(internal.bankProviders.plaid.plaidTransactionSync.upsertTransactions, {
      workspaceId: context.account.workspaceId,
      transactions: args.transactions.filter(
        (transaction) => transaction.plaidAccountId === context.bankLinkAccount.plaidAccountId
      ),
    });
    if (result.updatedInsertedIds.length > 0) {
      await ctx.runMutation(
        internal.transactionImport.updateLinkedTransactions.updateLinkedTransactionsFromRawImports,
        {
          rawImportIds: result.updatedInsertedIds,
        }
      );
    }
    const processed = await ctx.runMutation(
      internal.transactionImport.processRawTransactionImports.processRawTransactionImports,
      {
        workspaceId: context.account.workspaceId,
        isFirstSync: false,
        rawImportIds: result.rawImportIds,
      }
    );
    if (processed.errorCount > 0) throw new Error('Initial bank account import needs another attempt');
    return { active: true, rawImportIds: result.rawImportIds };
  },
});

export const finish = internalMutation({
  args: { ...accountArgs, currentBalance: v.optional(v.int64()) },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const context = await getPendingAccount(ctx, args);
    if (!context) return false;
    const { account, bankLink } = context;
    if (account.plaidInitialSync!.preserveBalance) {
      if (args.currentBalance === undefined) throw new Error('Plaid has not provided a current account balance');
      await ctx.runMutation(internal.bankAccounts.calculateAndInsertStartingBalances, {
        workspaceId: account.workspaceId,
        bankLinkId: bankLink._id,
        bankAccountId: account._id,
        initialBalanceDate: account.plaidInitialSync!.startDate,
        currentBalance: args.currentBalance,
      });
    }
    await ctx.db.patch(account._id, {
      plaidInitialSync: { ...account.plaidInitialSync!, status: 'complete' },
      updatedAt: new Date().toISOString(),
    });
    await ctx.scheduler.runAfter(0, internal.bankProviders.plaid.initialAccountSync.drainAccountImports, {
      bankAccountId: args.bankAccountId,
      bankLinkAccountId: args.bankLinkAccountId,
      generation: args.generation,
    });
    await ctx.scheduler.runAfter(0, internal.bankProviders.plaid.plaidTransactionSync.syncTransactions, {
      itemId: bankLink.itemId,
    });
    return true;
  },
});

export const drainAccountImports = internalMutation({
  args: accountArgs,
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const context = await getPendingAccount(ctx, args, false);
    if (!context || context.account.plaidInitialSync?.status !== 'complete') return null;
    const pending = ctx.db
      .query('transactionImportRaw')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', context.account.workspaceId));
    const rawImportIds: Id<'transactionImportRaw'>[] = [];
    for await (const transaction of pending) {
      if (
        transaction.plaidAccountId === context.bankLinkAccount.plaidAccountId &&
        transaction.importStatus === 'awaiting_insert_job'
      ) {
        rawImportIds.push(transaction._id);
        if (rawImportIds.length === 100) break;
      }
    }
    if (rawImportIds.length === 0) return null;
    await ctx.runMutation(internal.transactionImport.processRawTransactionImports.processRawTransactionImports, {
      workspaceId: context.account.workspaceId,
      isFirstSync: false,
      rawImportIds,
    });
    if (rawImportIds.length === 100) {
      await ctx.scheduler.runAfter(0, internal.bankProviders.plaid.initialAccountSync.drainAccountImports, args);
    }
    return null;
  },
});

// Each placement gets a replay of its own account. The shared item cursor is
// intentionally untouched, so selecting another account later cannot skip data.
export const syncAccount = internalAction({
  args: { ...accountArgs, attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { attempt = 0, ...args }): Promise<null> => {
    const context = await ctx.runQuery(internal.bankProviders.plaid.initialAccountSync.getContext, args);
    if (!context) return null;
    try {
      let cursor: string | undefined;
      let hasMore = true;
      let pages = 0;
      let notReady = false;
      const transactions = new Map<string, Transaction>();
      while (hasMore) {
        if (++pages > 20) throw new Error('Initial bank account import exceeded the page limit');
        const response = await plaidClient.transactionsSync({
          access_token: context.accessToken,
          cursor,
          count: 500,
          options: { days_requested: plaidConfig.transactionsDaysRequested },
        });
        for (const transaction of [...response.data.added, ...response.data.modified]) {
          if (transaction.account_id === context.plaidAccountId)
            transactions.set(transaction.transaction_id, transaction);
        }
        for (const transaction of response.data.removed) transactions.delete(transaction.transaction_id);
        cursor = response.data.next_cursor;
        hasMore = response.data.has_more;
        notReady = response.data.transactions_update_status === 'NOT_READY';
      }
      if (notReady) throw new Error('Plaid is still preparing initial transactions');

      let currentBalance: bigint | undefined;
      if (context.preserveBalance) {
        const response = await plaidClient.accountsGet({ access_token: context.accessToken });
        const account = response.data.accounts.find((account) => account.account_id === context.plaidAccountId);
        if (!account) throw new Error('Connected account is no longer available');
        if (account.balances.current === null) throw new Error('Plaid has not provided a current account balance');
        const direction = account.type === 'credit' || account.type === 'loan' ? -1 : 1;
        currentBalance = BigInt(Math.round(account.balances.current * 100) * direction);
      }
      const imports = [...transactions.values()].map((transaction) =>
        convertPlaidTransaction(transaction, context.startDate)
      );
      for (let offset = 0; offset < imports.length; offset += 100) {
        const result = await ctx.runMutation(internal.bankProviders.plaid.initialAccountSync.insertBatch, {
          ...args,
          transactions: imports.slice(offset, offset + 100),
        });
        if (!result.active) return null;
      }
      await ctx.runMutation(internal.bankProviders.plaid.initialAccountSync.finish, {
        ...args,
        currentBalance,
      });
    } catch (error: unknown) {
      if (attempt < 5) {
        await ctx.scheduler.runAfter(
          Math.min(10_000 * 2 ** attempt, 120_000),
          internal.bankProviders.plaid.initialAccountSync.syncAccount,
          {
            ...args,
            attempt: attempt + 1,
          }
        );
      } else {
        console.error('Initial Plaid account sync failed:', getSafePlaidErrorDetails(error));
        throw new Error('Unable to finish the initial bank account import');
      }
    }
    return null;
  },
});
