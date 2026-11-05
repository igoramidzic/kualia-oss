import { v } from 'convex/values';
import { SignJWT, importPKCS8 } from 'jose';

import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { internalAction, internalMutation, internalQuery } from '../_generated/server';
import {
  calculateBudgetCarryoverChain,
  calculateCreditCardCarryoverChain,
  getNextYearMonth,
  type CreditCardMonthInput,
  type MonthBudgetInput,
} from '../categoryBudgets/calculations';
import { isDev } from '../lib/devUtils';
import { listAccessibleWorkspacesForClerkId } from '../workspaces/access';

// APNs JWTs are valid for 60 minutes, but we refresh at 50 minutes to be safe
const JWT_LIFETIME_MS = 50 * 60 * 1000;

/**
 * Get a cached APNs JWT if it's still valid
 */
export const getCachedApnsJwt = internalQuery({
  args: {},
  handler: async (ctx) => {
    const cached = await ctx.db.query('apnsTokenCache').first();
    if (cached && cached.expiresAt > Date.now()) {
      return cached.jwt;
    }
    return null;
  },
});

/**
 * Store a new APNs JWT in the cache (replaces any existing one)
 */
export const setCachedApnsJwt = internalMutation({
  args: {
    jwt: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, { jwt, expiresAt }) => {
    const existing = await ctx.db.query('apnsTokenCache').collect();
    for (const doc of existing) {
      await ctx.db.delete(doc._id);
    }
    await ctx.db.insert('apnsTokenCache', { jwt, expiresAt });
  },
});

/**
 * Get or create an APNs JWT, using DB cache to avoid rate limiting
 */
async function getOrCreateApnsJwt(
  ctx: ActionCtx,
  keyId: string,
  teamId: string,
  apnsKeyBase64: string
): Promise<string> {
  const cached = await ctx.runQuery(internal.notifications.apns.getCachedApnsJwt, {});
  if (cached) {
    return cached as string;
  }

  const keyPem = atob(apnsKeyBase64);
  const privateKey = await importPKCS8(keyPem, 'ES256');

  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt()
    .sign(privateKey);

  await ctx.runMutation(internal.notifications.apns.setCachedApnsJwt, {
    jwt,
    expiresAt: Date.now() + JWT_LIFETIME_MS,
  });

  return jwt;
}

/**
 * Send a push notification via Apple Push Notification Service (APNs)
 */
export const sendPushNotification = internalAction({
  args: {
    deviceToken: v.string(),
    title: v.string(),
    body: v.string(),
    badge: v.optional(v.number()),
    type: v.optional(v.string()),
    workspaceId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    const keyId = process.env['APNS_KEY_ID'];
    const teamId = process.env['APNS_TEAM_ID'];
    const bundleId = process.env['APNS_BUNDLE_ID'];
    const apnsKeyBase64 = process.env['APNS_KEY'];

    if (!keyId || !teamId || !bundleId || !apnsKeyBase64) {
      console.error('[APNS] Missing APNs configuration environment variables');
      throw new Error('APNs not configured');
    }

    // Determine APNs environment: use sandbox for dev, production otherwise
    const apnsHost = isDev() ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';

    // Get or create a cached JWT to avoid TooManyProviderTokenUpdates rate limiting
    const jwt = await getOrCreateApnsJwt(ctx, keyId, teamId, apnsKeyBase64);

    const payload = {
      aps: {
        alert: {
          title: args.title,
          body: args.body,
        },
        badge: args.badge ?? 0,
        sound: 'default',
      },
      // Custom data for deep linking
      ...(args.type && { type: args.type }),
      ...(args.workspaceId && { workspaceId: args.workspaceId }),
    };

    const response = await fetch(`https://${apnsHost}/3/device/${args.deviceToken}`, {
      method: 'POST',
      headers: {
        authorization: `bearer ${jwt}`,
        'apns-topic': bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[APNS] Error: ${response.status} - ${errorText}`);
      // If JWT was rejected, clear cache so the next invocation generates a fresh one
      if (response.status === 403) {
        await ctx.runMutation(internal.notifications.apns.setCachedApnsJwt, {
          jwt: '',
          expiresAt: 0,
        });
      }
      throw new Error(`APNs request failed: ${response.status}`);
    }

    return { success: true };
  },
});

/**
 * Get user's notification info (device token and preference)
 * Checks both global toggle and granular notification type settings
 */
export const getUserNotificationInfo = internalMutation({
  args: {
    clerkId: v.string(),
    notificationType: v.optional(
      v.union(v.literal('transaction'), v.literal('reminder'), v.literal('recurringReminder'))
    ),
  },
  handler: async (ctx, { clerkId, notificationType = 'transaction' }) => {
    const userProfile = await ctx.db
      .query('userProfile')
      .filter((q) => q.eq(q.field('clerkId'), clerkId))
      .first();

    if (!userProfile) {
      return null;
    }

    const globalEnabled = userProfile.notificationsEnabled ?? false;
    if (!globalEnabled) {
      return {
        apnsDeviceToken: userProfile.apnsDeviceToken,
        notificationsEnabled: false,
      };
    }

    // Recurring reminder notifications only depend on the global toggle
    if (notificationType === 'recurringReminder') {
      return {
        apnsDeviceToken: userProfile.apnsDeviceToken,
        notificationsEnabled: true,
        reminderFrequency: userProfile.notificationPreferences?.reminderFrequency,
      };
    }

    const prefs = userProfile.notificationPreferences;
    const typeEnabled =
      notificationType === 'transaction' ? (prefs?.newTransactionsEnabled ?? true) : (prefs?.remindersEnabled ?? false);

    return {
      apnsDeviceToken: userProfile.apnsDeviceToken,
      notificationsEnabled: typeEnabled,
      reminderFrequency: prefs?.reminderFrequency,
    };
  },
});

/**
 * Calculate the total badge count for a user across all their workspaces.
 * Badge count = overspent categories + needs review transactions + unhealthy institutions
 */
export const calculateUserBadgeCount = internalMutation({
  args: {
    clerkId: v.string(),
  },
  handler: async (ctx, { clerkId }): Promise<number> => {
    const accessibleWorkspaces = await listAccessibleWorkspacesForClerkId(ctx, clerkId);

    if (accessibleWorkspaces.length === 0) {
      return 0;
    }

    let totalBadgeCount = 0;

    for (const { workspace } of accessibleWorkspaces) {
      const workspaceId = workspace._id;

      const [needsReviewTransactions, uncategorizedTransactions, missingPayeeTransactions, bankAccounts] =
        await Promise.all([
          ctx.db
            .query('transaction')
            .withIndex('by_workspaceId_reviewStatus_isDeleted', (q) =>
              q.eq('workspaceId', workspaceId).eq('reviewStatus', 'needs_review').eq('isDeleted', false)
            )
            .collect(),
          ctx.db
            .query('transaction')
            .withIndex('by_workspaceId_hasUncategorized_isDeleted', (q) =>
              q.eq('workspaceId', workspaceId).eq('hasUncategorized', true).eq('isDeleted', false)
            )
            .collect()
            .then((transactions) => transactions.filter((t) => t.reviewStatus === 'reviewed')),
          ctx.db
            .query('transaction')
            .withIndex('by_workspaceId_hasMissingPayee_isDeleted', (q) =>
              q.eq('workspaceId', workspaceId).eq('hasMissingPayee', true).eq('isDeleted', false)
            )
            .collect()
            .then((transactions) => transactions.filter((t) => t.reviewStatus === 'reviewed')),
          ctx.db
            .query('bankAccount')
            .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
            .filter((q) => q.eq(q.field('isDeleted'), false))
            .collect(),
        ]);

      const needsReviewIds = new Set([
        ...needsReviewTransactions.map((t) => t._id),
        ...uncategorizedTransactions.map((t) => t._id),
        ...missingPayeeTransactions.map((t) => t._id),
      ]);
      const needsReviewCount = needsReviewIds.size;

      const [categories, categoryBudgets] = await Promise.all([
        ctx.db
          .query('category')
          .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
          .filter((q) => q.eq(q.field('isDeleted'), false))
          .collect(),
        ctx.db
          .query('categoryBudget')
          .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
          .collect(),
      ]);

      const now = new Date();
      const currentYearMonth = now.getFullYear() * 100 + (now.getMonth() + 1);

      // Build budget lookup: categoryId -> yearMonth -> assignedAmount
      const budgetMap = new Map<string, Map<number, bigint>>();
      for (const budget of categoryBudgets) {
        const monthlyAmounts = budget.monthlyAssignedAmounts ?? {};
        const categoryBudgetMap = new Map<number, bigint>();
        for (const [ymStr, amount] of Object.entries(monthlyAmounts)) {
          categoryBudgetMap.set(parseInt(ymStr, 10), amount);
        }
        if (categoryBudgetMap.size > 0) {
          budgetMap.set(budget.categoryId, categoryBudgetMap);
        }
      }

      // Build spending lookup from categories
      const spendingMap = new Map<string, Map<number, { inflowAmount: bigint; outflowAmount: bigint }>>();
      const creditSpendingMap = new Map<
        string,
        Map<number, { priorBalance: bigint; spendingAmount: bigint; paymentsAmount: bigint; refundedSpending: bigint }>
      >();

      for (const category of categories) {
        if (category.categoryType === 'credit_card') {
          const creditMonthlySpending = category.creditMonthlySpending ?? {};
          const map = new Map<
            number,
            { priorBalance: bigint; spendingAmount: bigint; paymentsAmount: bigint; refundedSpending: bigint }
          >();
          for (const [ymStr, spending] of Object.entries(creditMonthlySpending)) {
            map.set(parseInt(ymStr, 10), spending);
          }
          if (map.size > 0) {
            creditSpendingMap.set(category._id, map);
          }
        } else {
          const monthlySpending = category.monthlySpending ?? {};
          const map = new Map<number, { inflowAmount: bigint; outflowAmount: bigint }>();
          for (const [ymStr, spending] of Object.entries(monthlySpending)) {
            map.set(parseInt(ymStr, 10), spending);
          }
          if (map.size > 0) {
            spendingMap.set(category._id, map);
          }
        }
      }

      // Calculate overspent count using proper carryover chain (matching queries.ts pattern)
      let overspentCount = 0;
      for (const category of categories) {
        if (category.isArchived) continue;

        const isCreditCard = category.categoryType === 'credit_card';
        const catBudgets = budgetMap.get(category._id);

        // Find the earliest month with any data for this category
        let earliestMonth: number | null = null;

        if (catBudgets) {
          for (const ym of catBudgets.keys()) {
            if (earliestMonth === null || ym < earliestMonth) earliestMonth = ym;
          }
        }

        if (isCreditCard) {
          const catCreditSpending = creditSpendingMap.get(category._id);
          if (catCreditSpending) {
            for (const ym of catCreditSpending.keys()) {
              if (earliestMonth === null || ym < earliestMonth) earliestMonth = ym;
            }
          }

          // No data at all — not overspent
          if (earliestMonth === null) continue;

          // Build the monthly input chain from earliest month through current month
          const monthInputs: CreditCardMonthInput[] = [];
          let month = earliestMonth;
          while (month <= currentYearMonth) {
            const assignedAmount = catBudgets?.get(month) ?? 0n;
            const spending = catCreditSpending?.get(month);
            monthInputs.push({
              yearMonth: month,
              assignedAmount,
              priorBalance: spending?.priorBalance ?? 0n,
              spendingAmount: spending?.spendingAmount ?? 0n,
              paymentsAmount: spending?.paymentsAmount ?? 0n,
              refundedSpending: spending?.refundedSpending ?? 0n,
            });
            month = getNextYearMonth(month);
          }

          const results = calculateCreditCardCarryoverChain(monthInputs);
          const currentResult = results[results.length - 1];
          if (currentResult && currentResult.available < 0n) {
            overspentCount++;
          }
        } else {
          const catSpending = spendingMap.get(category._id);
          if (catSpending) {
            for (const ym of catSpending.keys()) {
              if (earliestMonth === null || ym < earliestMonth) earliestMonth = ym;
            }
          }

          // No data at all — not overspent
          if (earliestMonth === null) continue;

          // Build the monthly input chain from earliest month through current month
          const monthInputs: MonthBudgetInput[] = [];
          let month = earliestMonth;
          while (month <= currentYearMonth) {
            const assignedAmount = catBudgets?.get(month) ?? 0n;
            const spending = catSpending?.get(month);
            monthInputs.push({
              yearMonth: month,
              assignedAmount,
              inflowAmount: spending?.inflowAmount ?? 0n,
              outflowAmount: spending?.outflowAmount ?? 0n,
            });
            month = getNextYearMonth(month);
          }

          const results = calculateBudgetCarryoverChain(monthInputs);
          const currentResult = results[results.length - 1];
          if (currentResult && currentResult.available < 0n) {
            overspentCount++;
          }
        }
      }

      // Count unhealthy institutions (Error, Pending, or Disconnected status)
      const unhealthyBankLinkIds = new Set<string>();
      for (const bankAccount of bankAccounts) {
        if (!bankAccount.bankLinkAccountId) continue;

        const bankLinkAccount = await ctx.db.get(bankAccount.bankLinkAccountId);
        if (!bankLinkAccount || bankLinkAccount.isDeleted) continue;

        const bankLink = await ctx.db.get(bankLinkAccount.bankLinkId);
        if (!bankLink || bankLink.isDeleted) continue;

        if (bankLink.itemStatus !== 'Healthy') {
          unhealthyBankLinkIds.add(bankLink._id);
        }
      }
      const unhealthyInstitutionsCount = unhealthyBankLinkIds.size;

      totalBadgeCount += needsReviewCount + overspentCount + unhealthyInstitutionsCount;
    }

    return totalBadgeCount;
  },
});
