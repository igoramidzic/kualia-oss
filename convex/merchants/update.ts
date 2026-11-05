import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalMutation, mutation } from '../_generated/server';
import { buildActivityContext, recordMerchantActivity } from '../activityLogs/helpers';
import { requireWorkspaceAccess } from '../lib/auth';
import { entityIconColorId, type EntityIconColorId, visualIdentityMode } from '../lib/entityIdentity';
import { stripLogoDevToken } from '../lib/logoUtils';

interface MerchantMonthlyStats {
  totalAmount: bigint;
  transactionCount: bigint;
}

export interface MerchantMonthlyDirectionalStats {
  inflowAmount: bigint;
  outflowAmount: bigint;
  inflowCount: bigint;
  outflowCount: bigint;
}

/**
 * Apply one transaction addition/removal to both the legacy net totals and
 * the gross directional totals used by reports.
 */
export function applyMerchantTransactionStats(
  currentStats: MerchantMonthlyStats,
  currentDirectionalStats: MerchantMonthlyDirectionalStats,
  transactionAmount: bigint,
  transactionCountDelta: bigint
): {
  stats: MerchantMonthlyStats;
  directionalStats: MerchantMonthlyDirectionalStats;
} {
  const amountDelta = transactionAmount * transactionCountDelta;
  const inflowAmountDelta = transactionAmount > 0n ? amountDelta : 0n;
  const outflowAmountDelta = transactionAmount < 0n ? -amountDelta : 0n;
  const inflowCountDelta = transactionAmount > 0n ? transactionCountDelta : 0n;
  const outflowCountDelta = transactionAmount < 0n ? transactionCountDelta : 0n;

  return {
    stats: {
      totalAmount: currentStats.totalAmount + amountDelta,
      transactionCount: currentStats.transactionCount + transactionCountDelta,
    },
    directionalStats: {
      inflowAmount: currentDirectionalStats.inflowAmount + inflowAmountDelta,
      outflowAmount: currentDirectionalStats.outflowAmount + outflowAmountDelta,
      inflowCount: currentDirectionalStats.inflowCount + inflowCountDelta,
      outflowCount: currentDirectionalStats.outflowCount + outflowCountDelta,
    },
  };
}

function directionalStatsFallback(stats: MerchantMonthlyStats): MerchantMonthlyDirectionalStats {
  return {
    inflowAmount: stats.totalAmount > 0n ? stats.totalAmount : 0n,
    outflowAmount: stats.totalAmount < 0n ? -stats.totalAmount : 0n,
    inflowCount: stats.totalAmount > 0n ? stats.transactionCount : 0n,
    outflowCount: stats.totalAmount < 0n ? stats.transactionCount : 0n,
  };
}

export function shouldUpdateMerchantDirectionalStats(
  monthlyStats: Record<string, MerchantMonthlyStats>,
  monthlyDirectionalStats: Record<string, MerchantMonthlyDirectionalStats> | undefined
): boolean {
  return monthlyDirectionalStats !== undefined || Object.keys(monthlyStats).length === 0;
}

/**
 * Helper function to convert ISO date string to YYYYMM string
 */
function dateToYearMonthString(isoDate: string): string {
  const parts = isoDate.split('-');
  const year = parts[0];
  const month = parts[1];
  return `${year}${month}`;
}

/**
 * Internal mutation to update merchant transaction statistics
 * Called from transaction create/update/delete/restore/import operations
 */
export const updateMerchantStatsForTransaction = internalMutation({
  args: {
    merchantId: v.optional(v.id('merchant')),
    transactionDate: v.string(), // ISO date string (YYYY-MM-DD)
    transactionCountDelta: v.int64(),
    transactionAmount: v.int64(),
  },
  handler: async (ctx, { merchantId, transactionDate, transactionCountDelta, transactionAmount }) => {
    if (!merchantId) return;

    const merchant = await ctx.db.get(merchantId);
    if (!merchant || merchant.isDeleted) return;

    const yearMonth = dateToYearMonthString(transactionDate);
    const currentMonthlyStats = merchant.monthlyStats ?? {};
    const currentMonthStats = currentMonthlyStats[yearMonth] ?? { totalAmount: 0n, transactionCount: 0n };
    // Do not create a partial directional history for a legacy merchant while
    // the backfill is pending. New merchants (no legacy stats) and merchants
    // with the field already initialized are safe to update incrementally.
    const shouldUpdateDirectionalStats = shouldUpdateMerchantDirectionalStats(
      currentMonthlyStats,
      merchant.monthlyDirectionalStats
    );
    const currentMonthlyDirectionalStats = merchant.monthlyDirectionalStats ?? {};
    const currentMonthDirectionalStats =
      currentMonthlyDirectionalStats[yearMonth] ?? directionalStatsFallback(currentMonthStats);

    const { stats: newMonthStats, directionalStats: newMonthDirectionalStats } = applyMerchantTransactionStats(
      currentMonthStats,
      currentMonthDirectionalStats,
      transactionAmount,
      transactionCountDelta
    );

    await ctx.db.patch(merchantId, {
      monthlyStats: {
        ...currentMonthlyStats,
        [yearMonth]: newMonthStats,
      },
      ...(shouldUpdateDirectionalStats
        ? {
            monthlyDirectionalStats: {
              ...currentMonthlyDirectionalStats,
              [yearMonth]: newMonthDirectionalStats,
            },
          }
        : {}),
      updatedAt: new Date().toISOString(),
    });
  },
});

/**
 * Update a merchant
 */
export const updateMerchant = mutation({
  args: {
    workspaceId: v.id('workspace'),
    merchantId: v.id('merchant'),
    name: v.optional(v.string()),
    // Special handling for logoUrl:
    // - "UNSET" string: delete field (fall back to global merchant logo)
    // - string URL: use this custom logo
    // - null: explicitly no logo (even if global has one)
    logoUrl: v.optional(v.union(v.string(), v.null())),
    visualIdentityMode: v.optional(visualIdentityMode),
    iconName: v.optional(v.string()),
    iconColorId: v.optional(entityIconColorId),
  },
  handler: async (ctx, args) => {
    const { workspaceId, merchantId, name, logoUrl, visualIdentityMode: nextMode, iconName, iconColorId } = args;
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);

    const merchant = await ctx.db.get(merchantId);
    if (!merchant || merchant.workspaceId !== verifiedWorkspaceId || merchant.isDeleted) {
      throw new ConvexError('Merchant not found or does not belong to workspace');
    }

    // Check for duplicate name if name is being updated
    if (name !== undefined) {
      const trimmedName = name.trim();
      if (trimmedName.length === 0) {
        throw new ConvexError('Merchant name cannot be empty');
      }
      const normalizedName = trimmedName.toLowerCase();
      const existingMerchants = await ctx.db
        .query('merchant')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .collect();

      const duplicate = existingMerchants.find((m) => m._id !== merchantId && m.name?.toLowerCase() === normalizedName);

      if (duplicate) {
        throw new ConvexError('A merchant with this name already exists');
      }
    }

    const updates: {
      name?: string;
      logoUrl?: string | null | undefined;
      visualIdentityMode?: 'logo' | 'icon';
      iconName?: string;
      iconColorId?: EntityIconColorId;
      updatedAt: string;
    } = {
      updatedAt: new Date().toISOString(),
    };

    // Check if name was provided in args (save trimmed version)
    if ('name' in args && name !== undefined) {
      updates.name = name.trim();
    }

    if ('visualIdentityMode' in args && nextMode !== undefined) {
      updates.visualIdentityMode = nextMode;
    }

    if ('iconName' in args && iconName !== undefined) {
      updates.iconName = iconName;
    }

    if ('iconColorId' in args && iconColorId !== undefined) {
      updates.iconColorId = iconColorId;
    }

    // Check if logoUrl was provided in args
    // Three states:
    // - "UNSET": delete field (fall back to global merchant logo)
    // - string URL: use this custom logo (strip any token before saving)
    // - null: explicitly no logo (even if global has one)
    if ('logoUrl' in args) {
      // If logo is changing, mark any previous uploads as orphaned for cleanup
      if (logoUrl !== merchant.logoUrl) {
        await ctx.runMutation(internal.storage.logoUpload.markLogoOrphaned, {
          entityType: 'merchant',
          entityId: merchantId,
          newLogoUrl: logoUrl,
        });
      }

      if (logoUrl === 'UNSET') {
        // Delete the field to fall back to global merchant logo
        updates.logoUrl = undefined;
      } else if (logoUrl === null) {
        // Explicitly no logo
        updates.logoUrl = null;
      } else if (logoUrl) {
        // Strip token from logo URL before saving (defensive, for Logo.dev URLs)
        updates.logoUrl = stripLogoDevToken(logoUrl);
      }

      updates.visualIdentityMode = 'logo';
    }

    await ctx.db.patch(merchantId, updates);

    // Propagate name change to transaction searchText if name was updated
    if ('name' in args) {
      await ctx.runMutation(internal.internal.propagateNameChanges.propagateMerchantNameChange, {
        merchantId,
        workspaceId: verifiedWorkspaceId,
      });
    }

    const updatedMerchant = await ctx.db.get(merchantId);
    if (updatedMerchant) {
      await recordMerchantActivity(ctx, {
        workspaceId: verifiedWorkspaceId,
        context: await buildActivityContext(ctx, {
          clerkId: user.subject,
          source: { type: 'kualia_ui' },
        }),
        type: 'merchant_updated',
        before: merchant,
        after: updatedMerchant,
      });
    }

    return { success: true };
  },
});
