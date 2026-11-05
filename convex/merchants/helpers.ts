import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { appendLogoDevToken } from '../lib/logoUtils';
import { buildSearchText, resolveMerchantName } from '../transactions/helpers';
import type { MerchantChoice } from './types';

const MAX_SUGGESTED_CATEGORIES = 3;

/**
 * Update merchant suggestions based on a new transaction
 * This is a simple O(1) array manipulation - no DB queries needed
 *
 * Category logic: Bump new category to front, remove duplicates, keep max 3
 * Account logic: Simply use the most recent account
 */
export function updateMerchantSuggestionsFromTransaction(
  currentSuggestedCategoryIds: Id<'category'>[] | undefined,
  newCategoryId: Id<'category'> | undefined,
  newBankAccountId: Id<'bankAccount'>
): {
  suggestedCategoryIds: Id<'category'>[];
  suggestedBankAccountId: Id<'bankAccount'>;
} {
  // Start with current array or empty
  let categoryIds = [...(currentSuggestedCategoryIds ?? [])];

  // Update category suggestions if we have a new category
  if (newCategoryId) {
    // If already first, no change needed
    if (categoryIds[0] !== newCategoryId) {
      // Remove if exists elsewhere (dedup)
      categoryIds = categoryIds.filter((id) => id !== newCategoryId);
      // Prepend to front
      categoryIds.unshift(newCategoryId);
      // Trim to max 3
      categoryIds = categoryIds.slice(0, MAX_SUGGESTED_CATEGORIES);
    }
  }

  return {
    suggestedCategoryIds: categoryIds,
    suggestedBankAccountId: newBankAccountId,
  };
}

/**
 * Resolve a merchant name to an id, creating the merchant when no active
 * merchant matches case-insensitively, including names inherited from the
 * global catalog. Imports can supply a logo when a new merchant is needed.
 */
export async function getOrCreateMerchantByName(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>,
  name: string,
  logoUrl?: string
): Promise<Id<'merchant'>> {
  const trimmed = name.trim();
  const normalized = trimmed.toLowerCase();

  const exactMatches = ctx.db
    .query('merchant')
    .withIndex('by_workspaceId_name', (q) => q.eq('workspaceId', workspaceId).eq('name', trimmed));
  for await (const merchant of exactMatches) {
    if (!merchant.isDeleted) return merchant._id;
  }

  const existingMerchants = ctx.db
    .query('merchant')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId));
  for await (const merchant of existingMerchants) {
    if (merchant.isDeleted) continue;
    const globalMerchant =
      merchant.name === undefined && merchant.globalMerchantId ? await ctx.db.get(merchant.globalMerchantId) : null;
    const resolvedName = merchant.name ?? globalMerchant?.name;
    if (resolvedName?.toLowerCase() === normalized) {
      return merchant._id;
    }
  }

  return ctx.db.insert('merchant', {
    name: trimmed,
    logoUrl,
    workspaceId,
    isDeleted: false,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Batch-resolve merchant ids to display names, falling back to the linked
 * global merchant's name. Shared by the MCP tools and the public REST API.
 */
export async function batchResolveMerchantNames(ctx: QueryCtx, merchantIds: Set<string>): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>();
  if (merchantIds.size === 0) return nameMap;

  const merchants = await Promise.all([...merchantIds].map((id) => ctx.db.get(id as Id<'merchant'>)));

  const globalMerchantIds = new Set<string>();
  const merchantToGlobal = new Map<string, string>();

  for (const merchant of merchants) {
    if (!merchant) continue;
    if (merchant.name) {
      nameMap.set(merchant._id, merchant.name);
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
      if (gm?.name) {
        globalNameMap.set(gm._id, gm.name);
      }
    }

    for (const [merchantId, globalId] of merchantToGlobal) {
      const globalName = globalNameMap.get(globalId);
      if (globalName) {
        nameMap.set(merchantId, globalName);
      }
    }
  }

  return nameMap;
}

export async function getActiveMerchantTransactions(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<'workspace'>,
  merchantId: Id<'merchant'>
): Promise<Doc<'transaction'>[]> {
  return await ctx.db
    .query('transaction')
    .withIndex('by_workspaceId_merchantId', (q) => q.eq('workspaceId', workspaceId).eq('merchantId', merchantId))
    .filter((q) => q.eq(q.field('isDeleted'), false))
    .collect();
}

export async function getActiveMerchantScheduledTransactions(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<'workspace'>,
  merchantId: Id<'merchant'>
): Promise<Doc<'scheduledTransaction'>[]> {
  return await ctx.db
    .query('scheduledTransaction')
    .withIndex('by_workspaceId_merchantId_isDeleted', (q) =>
      q.eq('workspaceId', workspaceId).eq('merchantId', merchantId).eq('isDeleted', false)
    )
    .collect();
}

export async function moveMerchantReferencesAndMergeStats(
  ctx: MutationCtx,
  {
    workspaceId,
    sourceMerchant,
    targetMerchant,
    transactions: preloadedTransactions,
    scheduledTransactions: preloadedScheduledTransactions,
    now,
  }: {
    workspaceId: Id<'workspace'>;
    sourceMerchant: Doc<'merchant'>;
    targetMerchant: Doc<'merchant'>;
    transactions?: Doc<'transaction'>[];
    scheduledTransactions?: Doc<'scheduledTransaction'>[];
    now: string;
  }
): Promise<{
  movedTransactionCount: number;
  updatedRecurringTransactionCount: number;
}> {
  const transactions =
    preloadedTransactions ?? (await getActiveMerchantTransactions(ctx, workspaceId, sourceMerchant._id));
  const targetMerchantName = await resolveMerchantName(ctx, targetMerchant._id);

  for (const transaction of transactions) {
    const categoryNames = (transaction.movements ?? []).map((m) => m.categoryName).filter((n): n is string => !!n);

    const searchText = buildSearchText(
      targetMerchantName,
      categoryNames,
      transaction.totalAmount,
      transaction.type,
      transaction.notes
    );

    await ctx.db.patch(transaction._id, {
      merchantId: targetMerchant._id,
      searchText,
      updatedAt: now,
    });
  }

  const scheduledTransactions =
    preloadedScheduledTransactions ??
    (await getActiveMerchantScheduledTransactions(ctx, workspaceId, sourceMerchant._id));
  for (const scheduled of scheduledTransactions) {
    await ctx.db.patch(scheduled._id, {
      merchantId: targetMerchant._id,
      updatedAt: now,
    });
  }

  const sourceStats = sourceMerchant.monthlyStats ?? {};
  const targetStats: NonNullable<Doc<'merchant'>['monthlyStats']> = { ...(targetMerchant.monthlyStats ?? {}) };
  const sourceDirectionalStats = sourceMerchant.monthlyDirectionalStats ?? {};
  const targetDirectionalStats: NonNullable<Doc<'merchant'>['monthlyDirectionalStats']> = {
    ...(targetMerchant.monthlyDirectionalStats ?? {}),
  };

  for (const [yearMonth, stats] of Object.entries(sourceStats)) {
    const existingStats = targetStats[yearMonth];
    if (existingStats) {
      targetStats[yearMonth] = {
        totalAmount: existingStats.totalAmount + stats.totalAmount,
        transactionCount: existingStats.transactionCount + stats.transactionCount,
      };
    } else {
      targetStats[yearMonth] = {
        totalAmount: stats.totalAmount,
        transactionCount: stats.transactionCount,
      };
    }
  }

  const directionalMonths = new Set([
    ...Object.keys(sourceStats),
    ...Object.keys(targetStats),
    ...Object.keys(sourceDirectionalStats),
    ...Object.keys(targetDirectionalStats),
  ]);

  for (const yearMonth of directionalMonths) {
    const sourceNetStats = sourceStats[yearMonth] ?? { totalAmount: 0n, transactionCount: 0n };
    const targetNetStats = targetMerchant.monthlyStats?.[yearMonth] ?? {
      totalAmount: 0n,
      transactionCount: 0n,
    };
    const sourceDirectional = sourceDirectionalStats[yearMonth] ?? {
      inflowAmount: sourceNetStats.totalAmount > 0n ? sourceNetStats.totalAmount : 0n,
      outflowAmount: sourceNetStats.totalAmount < 0n ? -sourceNetStats.totalAmount : 0n,
      inflowCount: sourceNetStats.totalAmount > 0n ? sourceNetStats.transactionCount : 0n,
      outflowCount: sourceNetStats.totalAmount < 0n ? sourceNetStats.transactionCount : 0n,
    };
    const targetDirectional = targetDirectionalStats[yearMonth] ?? {
      inflowAmount: targetNetStats.totalAmount > 0n ? targetNetStats.totalAmount : 0n,
      outflowAmount: targetNetStats.totalAmount < 0n ? -targetNetStats.totalAmount : 0n,
      inflowCount: targetNetStats.totalAmount > 0n ? targetNetStats.transactionCount : 0n,
      outflowCount: targetNetStats.totalAmount < 0n ? targetNetStats.transactionCount : 0n,
    };

    targetDirectionalStats[yearMonth] = {
      inflowAmount: targetDirectional.inflowAmount + sourceDirectional.inflowAmount,
      outflowAmount: targetDirectional.outflowAmount + sourceDirectional.outflowAmount,
      inflowCount: targetDirectional.inflowCount + sourceDirectional.inflowCount,
      outflowCount: targetDirectional.outflowCount + sourceDirectional.outflowCount,
    };
  }

  await ctx.db.patch(targetMerchant._id, {
    monthlyStats: targetStats,
    monthlyDirectionalStats: targetDirectionalStats,
    updatedAt: now,
  });

  return {
    movedTransactionCount: transactions.length,
    // Legacy response field retained for released clients; it now counts planned schedules.
    updatedRecurringTransactionCount: scheduledTransactions.length,
  };
}

/**
 * Aggregate monthly stats into totals
 */
function aggregateMonthlyStats(monthlyStats: Doc<'merchant'>['monthlyStats']): {
  transactionCount: number;
  totalSpent: bigint;
} {
  if (!monthlyStats) {
    return { transactionCount: 0, totalSpent: 0n };
  }

  let totalSpent = 0n;
  let transactionCount = 0n;

  for (const stats of Object.values(monthlyStats)) {
    totalSpent += stats.totalAmount;
    transactionCount += stats.transactionCount;
  }

  return { transactionCount: Number(transactionCount), totalSpent };
}

function resolveMerchantDisplay(merchant: Doc<'merchant'>, globalMerchant: Doc<'globalMerchant'> | null) {
  const resolvedLogoUrl = merchant.logoUrl === undefined ? globalMerchant?.logoUrl : merchant.logoUrl;
  return {
    name: merchant.name ?? globalMerchant?.name ?? '',
    logoUrl: appendLogoDevToken(resolvedLogoUrl),
    rawLogoUrl: merchant.logoUrl,
    globalMerchantLogoUrl: globalMerchant?.logoUrl,
    visualIdentityMode: merchant.visualIdentityMode ?? 'logo',
    iconName: merchant.iconName,
    iconColorId: merchant.iconColorId,
  };
}

/** Resolve picker labels once per global merchant, without spending or schedule data. */
export async function resolveMerchantChoices(ctx: QueryCtx, merchants: Doc<'merchant'>[]): Promise<MerchantChoice[]> {
  const globalIds = new Set(
    merchants.flatMap((merchant) => (merchant.globalMerchantId ? [merchant.globalMerchantId] : []))
  );
  const globals = await Promise.all([...globalIds].map(async (id) => [id, await ctx.db.get(id)] as const));
  const globalById = new Map(globals);
  return merchants.map((merchant) => {
    const globalMerchant = merchant.globalMerchantId ? (globalById.get(merchant.globalMerchantId) ?? null) : null;
    const { name, logoUrl } = resolveMerchantDisplay(merchant, globalMerchant);
    return {
      _id: merchant._id,
      name,
      logoUrl,
      isDeleted: merchant.isDeleted,
      suggestedCategoryIds: merchant.suggestedCategoryIds,
      suggestedBankAccountId: merchant.suggestedBankAccountId,
    };
  });
}

/**
 * Helper function to resolve merchant with global merchant data
 * Returns merchant with resolved name/logo from global merchant (if linked)
 * Stats are aggregated from monthly data stored on the merchant
 */
export async function resolveMerchant(ctx: QueryCtx, merchant: Doc<'merchant'>) {
  // Aggregate monthly stats to get totals
  const { transactionCount, totalSpent } = aggregateMonthlyStats(merchant.monthlyStats);
  // Legacy response field retained for released clients; it now counts planned schedules.
  const activeRecurringTransactionCount = (
    await getActiveMerchantScheduledTransactions(ctx, merchant.workspaceId, merchant._id)
  ).length;

  // Transform monthlyStats to a simpler format for the client
  // Convert from { "202412": { totalAmount, transactionCount } } to array format
  const monthlyStatsArray = merchant.monthlyStats
    ? Object.entries(merchant.monthlyStats).map(([yearMonth, stats]) => ({
        yearMonth,
        totalAmount: stats.totalAmount,
        transactionCount: Number(stats.transactionCount),
      }))
    : [];

  const globalMerchant = merchant.globalMerchantId ? await ctx.db.get(merchant.globalMerchantId) : null;
  return {
    ...merchant,
    ...resolveMerchantDisplay(merchant, globalMerchant),
    transactionCount,
    activeRecurringTransactionCount,
    totalSpent,
    monthlyStatsArray,
  };
}
