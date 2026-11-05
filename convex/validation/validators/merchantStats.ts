import { v } from 'convex/values';

import { internalMutation, internalQuery } from '../../_generated/server';
import { dateToYearMonth } from '../../categoryBudgets/calculations';
import { isOnBudgetAccountType } from '../../transactions/helpers';
import type { MerchantStatsIssue } from '../types';

/**
 * Validate that merchant.monthlyStats matches calculated values from transactions
 */
export const validate = internalQuery({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }): Promise<MerchantStatsIssue[]> => {
    const issues: MerchantStatsIssue[] = [];

    // Get all merchants for this workspace
    const merchants = await ctx.db
      .query('merchant')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.neq(q.field('isDeleted'), true))
      .collect();

    // Get all transactions for this workspace
    const transactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Build bank account type map to identify off-budget accounts
    const bankAccounts = await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .collect();
    const bankAccountTypeMap = new Map(bankAccounts.map((a) => [a._id, a.accountType]));

    // Build expected monthlyStats by aggregating transactions
    const expectedStats = new Map<
      string,
      Map<
        number,
        {
          totalAmount: bigint;
          transactionCount: bigint;
          inflowAmount: bigint;
          outflowAmount: bigint;
          inflowCount: bigint;
          outflowCount: bigint;
        }
      >
    >();

    for (const tx of transactions) {
      if (!tx.merchantId) continue;

      // Skip off-budget transactions (loans, investments) — they don't count as merchant spending
      const accountType = bankAccountTypeMap.get(tx.bankAccountId);
      if (accountType && !isOnBudgetAccountType(accountType)) continue;

      const yearMonth = dateToYearMonth(tx.date);
      const merchantKey = tx.merchantId.toString();

      if (!expectedStats.has(merchantKey)) {
        expectedStats.set(merchantKey, new Map());
      }

      const merchantStats = expectedStats.get(merchantKey)!;
      if (!merchantStats.has(yearMonth)) {
        merchantStats.set(yearMonth, {
          totalAmount: 0n,
          transactionCount: 0n,
          inflowAmount: 0n,
          outflowAmount: 0n,
          inflowCount: 0n,
          outflowCount: 0n,
        });
      }

      const monthStats = merchantStats.get(yearMonth)!;
      const amount = tx.totalAmount ?? 0n;
      monthStats.totalAmount += amount;
      monthStats.transactionCount += 1n;
      if (amount > 0n) {
        monthStats.inflowAmount += amount;
        monthStats.inflowCount += 1n;
      } else if (amount < 0n) {
        monthStats.outflowAmount += -amount;
        monthStats.outflowCount += 1n;
      }
    }

    // Compare with stored monthlyStats
    for (const merchant of merchants) {
      const stored = merchant.monthlyStats ?? {};
      const expected = expectedStats.get(merchant._id.toString()) ?? new Map();
      const merchantName = merchant.name ?? 'Unknown';

      // Check all stored entries
      for (const [yearMonthStr, storedData] of Object.entries(stored)) {
        const yearMonth = parseInt(yearMonthStr, 10);
        const expectedData = expected.get(yearMonth);

        const expectedTotalAmount = expectedData?.totalAmount ?? 0n;
        const expectedTransactionCount = expectedData?.transactionCount ?? 0n;

        if (storedData.totalAmount !== expectedTotalAmount) {
          issues.push({
            type: 'merchant_stats_mismatch',
            severity: 'error',
            description: `Merchant "${merchantName}" has incorrect totalAmount for ${yearMonth}`,
            merchantId: merchant._id,
            merchantName,
            yearMonth,
            field: 'totalAmount',
            stored: storedData.totalAmount,
            expected: expectedTotalAmount,
          });
        }

        if (storedData.transactionCount !== expectedTransactionCount) {
          issues.push({
            type: 'merchant_stats_mismatch',
            severity: 'error',
            description: `Merchant "${merchantName}" has incorrect transactionCount for ${yearMonth}`,
            merchantId: merchant._id,
            merchantName,
            yearMonth,
            field: 'transactionCount',
            stored: storedData.transactionCount,
            expected: expectedTransactionCount,
          });
        }

        const storedDirectional = merchant.monthlyDirectionalStats?.[yearMonthStr];
        const directionalFields = ['inflowAmount', 'outflowAmount', 'inflowCount', 'outflowCount'] as const;
        for (const field of directionalFields) {
          const storedValue = storedDirectional?.[field] ?? 0n;
          const expectedValue = expectedData?.[field] ?? 0n;
          if (storedValue !== expectedValue) {
            issues.push({
              type: 'merchant_stats_mismatch',
              severity: 'error',
              description: `Merchant "${merchantName}" has incorrect ${field} for ${yearMonth}`,
              merchantId: merchant._id,
              merchantName,
              yearMonth,
              field,
              stored: storedValue,
              expected: expectedValue,
            });
          }
        }

        // Mark as checked
        expected.delete(yearMonth);
      }

      // Check for missing entries (expected but not stored)
      for (const [yearMonth, expectedData] of expected.entries()) {
        if (expectedData.totalAmount !== 0n) {
          issues.push({
            type: 'merchant_stats_mismatch',
            severity: 'error',
            description: `Merchant "${merchantName}" missing monthlyStats for ${yearMonth} - totalAmount`,
            merchantId: merchant._id,
            merchantName,
            yearMonth,
            field: 'totalAmount',
            stored: 0n,
            expected: expectedData.totalAmount,
          });
        }

        if (expectedData.transactionCount !== 0n) {
          issues.push({
            type: 'merchant_stats_mismatch',
            severity: 'error',
            description: `Merchant "${merchantName}" missing monthlyStats for ${yearMonth} - transactionCount`,
            merchantId: merchant._id,
            merchantName,
            yearMonth,
            field: 'transactionCount',
            stored: 0n,
            expected: expectedData.transactionCount,
          });
        }

        const directionalFields = ['inflowAmount', 'outflowAmount', 'inflowCount', 'outflowCount'] as const;
        for (const field of directionalFields) {
          if (expectedData[field] !== 0n) {
            issues.push({
              type: 'merchant_stats_mismatch',
              severity: 'error',
              description: `Merchant "${merchantName}" missing monthlyDirectionalStats for ${yearMonth} - ${field}`,
              merchantId: merchant._id,
              merchantName,
              yearMonth,
              field,
              stored: 0n,
              expected: expectedData[field],
            });
          }
        }
      }
    }

    return issues;
  },
});

/**
 * Fix merchant stats discrepancies by recalculating from transactions
 */
export const fix = internalMutation({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }) => {
    let fixed = 0;
    const errors: string[] = [];

    // Get all merchants for this workspace
    const merchants = await ctx.db
      .query('merchant')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.neq(q.field('isDeleted'), true))
      .collect();

    // Get all transactions for this workspace
    const transactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Build bank account type map to identify off-budget accounts
    const bankAccounts = await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .collect();
    const bankAccountTypeMap = new Map(bankAccounts.map((a) => [a._id, a.accountType]));

    // Build correct monthlyStats
    const calculatedStats = new Map<
      string,
      Map<
        number,
        {
          totalAmount: bigint;
          transactionCount: bigint;
          inflowAmount: bigint;
          outflowAmount: bigint;
          inflowCount: bigint;
          outflowCount: bigint;
        }
      >
    >();

    for (const tx of transactions) {
      if (!tx.merchantId) continue;

      // Skip off-budget transactions (loans, investments) — they don't count as merchant spending
      const accountType = bankAccountTypeMap.get(tx.bankAccountId);
      if (accountType && !isOnBudgetAccountType(accountType)) continue;

      const yearMonth = dateToYearMonth(tx.date);
      const merchantKey = tx.merchantId.toString();

      if (!calculatedStats.has(merchantKey)) {
        calculatedStats.set(merchantKey, new Map());
      }

      const merchantStats = calculatedStats.get(merchantKey)!;
      if (!merchantStats.has(yearMonth)) {
        merchantStats.set(yearMonth, {
          totalAmount: 0n,
          transactionCount: 0n,
          inflowAmount: 0n,
          outflowAmount: 0n,
          inflowCount: 0n,
          outflowCount: 0n,
        });
      }

      const monthStats = merchantStats.get(yearMonth)!;
      const amount = tx.totalAmount ?? 0n;
      monthStats.totalAmount += amount;
      monthStats.transactionCount += 1n;
      if (amount > 0n) {
        monthStats.inflowAmount += amount;
        monthStats.inflowCount += 1n;
      } else if (amount < 0n) {
        monthStats.outflowAmount += -amount;
        monthStats.outflowCount += 1n;
      }
    }

    // Update each merchant (only if different)
    for (const merchant of merchants) {
      try {
        const stats = calculatedStats.get(merchant._id.toString());
        const newMonthlyStats: Record<string, { totalAmount: bigint; transactionCount: bigint }> = {};
        const newMonthlyDirectionalStats: Record<
          string,
          { inflowAmount: bigint; outflowAmount: bigint; inflowCount: bigint; outflowCount: bigint }
        > = {};

        if (stats) {
          for (const [yearMonth, data] of stats.entries()) {
            newMonthlyStats[yearMonth.toString()] = {
              totalAmount: data.totalAmount,
              transactionCount: data.transactionCount,
            };
            newMonthlyDirectionalStats[yearMonth.toString()] = {
              inflowAmount: data.inflowAmount,
              outflowAmount: data.outflowAmount,
              inflowCount: data.inflowCount,
              outflowCount: data.outflowCount,
            };
          }
        }

        // Check if anything actually changed
        const currentStats = merchant.monthlyStats ?? {};
        const serialize = (obj: Record<string, { totalAmount: bigint; transactionCount: bigint }>) =>
          JSON.stringify(
            Object.entries(obj)
              .map(([k, v]) => [
                k,
                { totalAmount: String(v.totalAmount), transactionCount: String(v.transactionCount) },
              ])
              .sort()
          );

        const serializeDirectional = (
          obj: Record<
            string,
            { inflowAmount: bigint; outflowAmount: bigint; inflowCount: bigint; outflowCount: bigint }
          >
        ) =>
          JSON.stringify(
            Object.entries(obj)
              .map(([k, v]) => [
                k,
                {
                  inflowAmount: String(v.inflowAmount),
                  outflowAmount: String(v.outflowAmount),
                  inflowCount: String(v.inflowCount),
                  outflowCount: String(v.outflowCount),
                },
              ])
              .sort()
          );
        const currentDirectionalStats = merchant.monthlyDirectionalStats ?? {};

        if (
          serialize(currentStats) !== serialize(newMonthlyStats) ||
          serializeDirectional(currentDirectionalStats) !== serializeDirectional(newMonthlyDirectionalStats)
        ) {
          await ctx.db.patch(merchant._id, {
            monthlyStats: newMonthlyStats,
            monthlyDirectionalStats: newMonthlyDirectionalStats,
            updatedAt: new Date().toISOString(),
          });
          fixed++;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to fix merchant ${merchant.name}: ${message}`);
      }
    }

    return { fixed, errors };
  },
});
