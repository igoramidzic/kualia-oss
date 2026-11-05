import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { batchResolveMerchantNames } from '../merchants/helpers';

import { resolveMcpAmountMetadata, type McpAmountMetadata } from './tools';
import { buildTransactionUrl } from './transactionLinks';

type FlatTransactionEntry = {
  transactionId: Id<'transaction'>;
  url: string;
  date: string;
  amount: bigint;
  totalAmount: bigint;
  merchantName: string | null;
  bankAccountId: Id<'bankAccount'>;
  bankAccountName: string;
  categoryId: Id<'category'> | null;
  categoryName: string | null;
  readyToAssign: boolean;
  status: 'pending' | 'cleared' | 'reconciled';
  type: 'regular' | 'starting_balance' | 'balance_adjustment' | 'transfer';
  reviewStatus: 'reviewed' | 'needs_review';
  notes: string | null;
  source: NonNullable<Doc<'transaction'>['source']> | null;
  movementIndex: number;
  movementCount: number;
};

export type TransactionListToolPayload = McpAmountMetadata & {
  workspaceId: Id<'workspace'>;
  yearMonth: number;
  currency: string;
  transactions: FlatTransactionEntry[];
  count: number;
  truncated: boolean;
};

type TransactionFilters = {
  accountId?: Id<'bankAccount'>;
  categoryId?: Id<'category'>;
  type?: string;
  limit: number;
};

export async function listTransactionsForMonth(
  ctx: QueryCtx,
  workspace: Doc<'workspace'>,
  yearMonth: number,
  filters: TransactionFilters
): Promise<TransactionListToolPayload> {
  const currencyCode = workspace.currency ?? 'USD';
  const amountMetadata = resolveMcpAmountMetadata(currencyCode);

  // Query transactions for this month using the dateYearMonth index
  const transactions = await ctx.db
    .query('transaction')
    .withIndex('by_workspaceId_dateYearMonth_isDeleted', (q) =>
      q.eq('workspaceId', workspace._id).eq('dateYearMonth', yearMonth).eq('isDeleted', false)
    )
    .collect();

  // Post-filter by accountId and type
  let filtered = transactions;
  if (filters.accountId) {
    filtered = filtered.filter((t) => t.bankAccountId === filters.accountId);
  }
  if (filters.type) {
    filtered = filtered.filter((t) => t.type === filters.type);
  }

  // If filtering by categoryId, keep only transactions that have a matching movement
  if (filters.categoryId) {
    filtered = filtered.filter((t) => t.movements.some((m) => m.categoryId === filters.categoryId));
  }

  // Sort by date desc, then creation time desc
  filtered.sort((a, b) => {
    const dateCompare = new Date(b.date).getTime() - new Date(a.date).getTime();
    if (dateCompare !== 0) return dateCompare;
    return b._creationTime - a._creationTime;
  });

  // Batch-resolve merchant names and bank account names
  const merchantIds = new Set<string>();
  const bankAccountIds = new Set<string>();

  for (const txn of filtered) {
    if (txn.merchantId) merchantIds.add(txn.merchantId);
    bankAccountIds.add(txn.bankAccountId);
  }

  const [merchantNames, bankAccountDocs] = await Promise.all([
    batchResolveMerchantNames(ctx, merchantIds),
    Promise.all([...bankAccountIds].map((id) => ctx.db.get(id as Id<'bankAccount'>))),
  ]);

  const bankAccountNameMap = new Map<string, string>();
  for (const account of bankAccountDocs) {
    if (account) {
      bankAccountNameMap.set(account._id, account.name);
    }
  }

  // Flatten: one row per movement, apply limit
  const flatEntries: FlatTransactionEntry[] = [];
  let truncated = false;

  for (const txn of filtered) {
    const merchantName = txn.merchantId ? (merchantNames.get(txn.merchantId) ?? null) : null;
    const bankAccountName = bankAccountNameMap.get(txn.bankAccountId) ?? 'Unknown';
    const movementCount = txn.movements.length;

    // If filtering by categoryId, only emit matching movements
    const movements = filters.categoryId
      ? txn.movements.filter((m) => m.categoryId === filters.categoryId)
      : txn.movements;

    for (let i = 0; i < movements.length; i++) {
      if (flatEntries.length >= filters.limit) {
        truncated = true;
        break;
      }

      const movement = movements[i];
      flatEntries.push({
        transactionId: txn._id,
        url: buildTransactionUrl(workspace._id, txn._id),
        date: txn.date,
        amount: movement.amount,
        totalAmount: txn.totalAmount,
        merchantName,
        bankAccountId: txn.bankAccountId,
        bankAccountName,
        categoryId: movement.categoryId ?? null,
        categoryName: movement.categoryName ?? null,
        readyToAssign: movement.readyToAssign,
        status: txn.status,
        type: txn.type,
        reviewStatus: txn.reviewStatus,
        notes: txn.notes ?? null,
        source: txn.source ?? null,
        movementIndex: i,
        movementCount,
      });
    }

    if (truncated) break;
  }

  return {
    workspaceId: workspace._id,
    yearMonth,
    currency: currencyCode,
    ...amountMetadata,
    transactions: flatEntries,
    count: flatEntries.length,
    truncated,
  };
}
