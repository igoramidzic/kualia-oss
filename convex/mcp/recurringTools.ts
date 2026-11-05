import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import type { Recurrence } from '../scheduledTransactions/types';

import { resolveMcpAmountMetadata, type McpAmountMetadata } from './tools';

/**
 * MCP payload for kualia_list_recurring_transactions, now sourced from the unified
 * scheduledTransaction ("planned") table. Field names are kept for agent compatibility:
 * frequency/frequencyInterval are the legacy projection of the recurrence, and the new
 * `recurrence` field carries the exact value (including 'once'/'twice_a_month', which
 * have no legacy projection and report their closest frequency).
 */
type RecurringTransactionEntry = {
  recurringTransactionId: Id<'scheduledTransaction'>;
  merchantName: string;
  categoryName: string | null;
  categoryId: Id<'category'> | null;
  expectedAmount: bigint;
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'once';
  frequencyInterval: number;
  recurrence: Recurrence;
  startDate: string;
  nextDueDate: string;
  status: 'active' | 'inactive';
  notes: string | null;
  reminderEnabled: boolean;
};

export type RecurringTransactionsToolPayload = McpAmountMetadata & {
  workspaceId: Id<'workspace'>;
  currency: string;
  recurringTransactions: RecurringTransactionEntry[];
};

const RECURRENCE_TO_LEGACY: Record<
  Recurrence,
  { frequency: RecurringTransactionEntry['frequency']; frequencyInterval: number }
> = {
  once: { frequency: 'once', frequencyInterval: 1 },
  daily: { frequency: 'daily', frequencyInterval: 1 },
  weekly: { frequency: 'weekly', frequencyInterval: 1 },
  every_other_week: { frequency: 'weekly', frequencyInterval: 2 },
  every_three_weeks: { frequency: 'weekly', frequencyInterval: 3 },
  every_four_weeks: { frequency: 'weekly', frequencyInterval: 4 },
  twice_a_month: { frequency: 'monthly', frequencyInterval: 1 },
  monthly: { frequency: 'monthly', frequencyInterval: 1 },
  every_other_month: { frequency: 'monthly', frequencyInterval: 2 },
  quarterly: { frequency: 'monthly', frequencyInterval: 3 },
  every_four_months: { frequency: 'monthly', frequencyInterval: 4 },
  twice_a_year: { frequency: 'monthly', frequencyInterval: 6 },
  yearly: { frequency: 'yearly', frequencyInterval: 1 },
  every_other_year: { frequency: 'yearly', frequencyInterval: 2 },
};

export async function listRecurringTransactionsForMcp(
  ctx: QueryCtx,
  workspace: Doc<'workspace'>,
  status: 'active' | 'inactive' | undefined
): Promise<RecurringTransactionsToolPayload> {
  const currencyCode = workspace.currency ?? 'USD';
  const amountMetadata = resolveMcpAmountMetadata(currencyCode);
  const filterStatus = status ?? 'active';

  const scheduled = await ctx.db
    .query('scheduledTransaction')
    .withIndex('by_workspaceId_isDeleted', (q) => q.eq('workspaceId', workspace._id).eq('isDeleted', false))
    .collect();

  // Legacy status vocabulary: active stays active; paused/completed report as inactive
  const matching = scheduled.filter((s) => (filterStatus === 'active' ? s.status === 'active' : s.status !== 'active'));

  // Batch-resolve merchant and category names
  const merchantIds = new Set<string>();
  const categoryIds = new Set<string>();

  for (const s of matching) {
    if (s.merchantId) merchantIds.add(s.merchantId);
    const categoryId = s.movements[0]?.categoryId;
    if (categoryId) categoryIds.add(categoryId);
  }

  const [merchantDocs, categoryDocs] = await Promise.all([
    Promise.all([...merchantIds].map((id) => ctx.db.get(id as Id<'merchant'>))),
    Promise.all([...categoryIds].map((id) => ctx.db.get(id as Id<'category'>))),
  ]);

  // Resolve merchant names (with globalMerchant fallback)
  const merchantNameMap = new Map<string, string>();
  const globalMerchantIds = new Set<string>();
  const merchantToGlobal = new Map<string, string>();

  for (const merchant of merchantDocs) {
    if (!merchant) continue;
    if (merchant.name) {
      merchantNameMap.set(merchant._id, merchant.name);
    } else if (merchant.globalMerchantId) {
      globalMerchantIds.add(merchant.globalMerchantId);
      merchantToGlobal.set(merchant._id, merchant.globalMerchantId);
    }
  }

  if (globalMerchantIds.size > 0) {
    const globalMerchants = await Promise.all(
      [...globalMerchantIds].map((id) => ctx.db.get(id as Id<'globalMerchant'>))
    );
    const globalNameMap = new Map<string, string>();
    for (const gm of globalMerchants) {
      if (gm?.name) globalNameMap.set(gm._id, gm.name);
    }
    for (const [mid, gid] of merchantToGlobal) {
      const name = globalNameMap.get(gid);
      if (name) merchantNameMap.set(mid, name);
    }
  }

  // Category name map
  const categoryNameMap = new Map<string, string>();
  for (const cat of categoryDocs) {
    if (cat && !cat.isDeleted) {
      categoryNameMap.set(cat._id, cat.name);
    }
  }

  const entries: RecurringTransactionEntry[] = matching.map((s) => {
    const legacy = RECURRENCE_TO_LEGACY[s.recurrence];
    const categoryId = s.movements[0]?.categoryId;
    const totalAmount = s.movements.reduce((sum, movement) => sum + movement.amount, 0n);
    const isTransfer = s.transactionType === 'transfer';
    const merchantName = s.merchantId
      ? (merchantNameMap.get(s.merchantId) ?? 'Unknown')
      : isTransfer
        ? 'Transfer'
        : 'Unknown';
    return {
      recurringTransactionId: s._id,
      merchantName,
      categoryName: categoryId ? (categoryNameMap.get(categoryId) ?? null) : null,
      categoryId: categoryId ?? null,
      expectedAmount: totalAmount,
      frequency: legacy.frequency,
      frequencyInterval: legacy.frequencyInterval,
      recurrence: s.recurrence,
      startDate: s.anchorDate,
      // For overdue manual-mode schedules nextDate can be in the past; report it as-is
      // so agents can see overdue items
      nextDueDate: s.nextDate,
      status: s.status === 'active' ? 'active' : 'inactive',
      notes: s.notes ?? null,
      reminderEnabled: s.reminderEnabled ?? false,
    };
  });

  // Sort by next due date ascending
  entries.sort((a, b) => (a.nextDueDate < b.nextDueDate ? -1 : a.nextDueDate > b.nextDueDate ? 1 : 0));

  return {
    workspaceId: workspace._id,
    currency: currencyCode,
    ...amountMetadata,
    recurringTransactions: entries,
  };
}
