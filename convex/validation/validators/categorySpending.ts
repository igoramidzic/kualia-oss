import { v } from 'convex/values';

import type { Id } from '../../_generated/dataModel';
import { internalMutation, internalQuery } from '../../_generated/server';
import { dateToYearMonth } from '../../categoryBudgets/calculations';
import type { CategorySpendingIssue } from '../types';

type SpendingKey = `${string}_${number}`; // categoryId_yearMonth

/**
 * Validate that category.monthlySpending matches calculated values from transaction movements
 */
export const validate = internalQuery({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }): Promise<CategorySpendingIssue[]> => {
    const issues: CategorySpendingIssue[] = [];

    // Get all non-credit-card, non-deleted categories for this workspace
    const categories = await ctx.db
      .query('category')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.and(q.neq(q.field('categoryType'), 'credit_card'), q.eq(q.field('isDeleted'), false)))
      .collect();

    // Create a map to store calculated values
    const calculatedSpending = new Map<
      SpendingKey,
      {
        inflowAmount: bigint;
        outflowAmount: bigint;
      }
    >();

    // Get all transactions for this workspace
    const transactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Build set of valid category IDs for this workspace
    const validCategoryIds = new Set(categories.map((c) => c._id.toString()));

    // Process embedded movements from transactions
    for (const transaction of transactions) {
      // Skip starting_balance and balance_adjustment (not real spending)
      if (transaction.type === 'starting_balance' || transaction.type === 'balance_adjustment') {
        continue;
      }

      const yearMonth = dateToYearMonth(transaction.date);

      for (const movement of transaction.movements ?? []) {
        if (!movement.categoryId) continue;

        // Only process movements for non-credit-card categories
        if (!validCategoryIds.has(movement.categoryId.toString())) continue;

        const key: SpendingKey = `${movement.categoryId}_${yearMonth}`;

        if (!calculatedSpending.has(key)) {
          calculatedSpending.set(key, {
            inflowAmount: 0n,
            outflowAmount: 0n,
          });
        }

        const spending = calculatedSpending.get(key)!;

        if (movement.amount > 0) {
          spending.inflowAmount += movement.amount;
        } else if (movement.amount < 0) {
          // Store outflows as positive values (absolute value)
          spending.outflowAmount += -movement.amount;
        }
      }
    }

    // Compare with stored category.monthlySpending
    for (const category of categories) {
      const monthlySpending = category.monthlySpending ?? {};

      // Check if there are calculated values for categories with no stored data
      if (Object.keys(monthlySpending).length === 0) {
        for (const [key, calc] of calculatedSpending.entries()) {
          const [catIdStr, yearMonthStr] = key.split('_');
          if (catIdStr === category._id.toString()) {
            const yearMonth = parseInt(yearMonthStr);

            if (calc.inflowAmount !== 0n) {
              issues.push({
                type: 'category_spending_mismatch',
                severity: 'error',
                description: `Category "${category.name}" missing monthlySpending entry for ${yearMonth} - inflowAmount`,
                categoryId: category._id,
                categoryName: category.name,
                yearMonth,
                field: 'inflowAmount',
                stored: 0n,
                expected: calc.inflowAmount,
              });
            }

            if (calc.outflowAmount !== 0n) {
              issues.push({
                type: 'category_spending_mismatch',
                severity: 'error',
                description: `Category "${category.name}" missing monthlySpending entry for ${yearMonth} - outflowAmount`,
                categoryId: category._id,
                categoryName: category.name,
                yearMonth,
                field: 'outflowAmount',
                stored: 0n,
                expected: calc.outflowAmount,
              });
            }

            calculatedSpending.delete(key);
          }
        }
        continue;
      }

      // Check stored entries against calculated values
      for (const [yearMonthStr, stored] of Object.entries(monthlySpending)) {
        const yearMonth = parseInt(yearMonthStr, 10);
        const key: SpendingKey = `${category._id}_${yearMonth}`;
        const calculated = calculatedSpending.get(key);

        const calc = calculated ?? {
          inflowAmount: 0n,
          outflowAmount: 0n,
        };

        const storedInflow = stored.inflowAmount ?? 0n;
        const storedOutflow = stored.outflowAmount ?? 0n;

        if (storedInflow !== calc.inflowAmount) {
          issues.push({
            type: 'category_spending_mismatch',
            severity: 'error',
            description: `Category "${category.name}" has incorrect inflowAmount for ${yearMonth}: stored ${storedInflow}, expected ${calc.inflowAmount}`,
            categoryId: category._id,
            categoryName: category.name,
            yearMonth,
            field: 'inflowAmount',
            stored: storedInflow,
            expected: calc.inflowAmount,
          });
        }

        if (storedOutflow !== calc.outflowAmount) {
          issues.push({
            type: 'category_spending_mismatch',
            severity: 'error',
            description: `Category "${category.name}" has incorrect outflowAmount for ${yearMonth}: stored ${storedOutflow}, expected ${calc.outflowAmount}`,
            categoryId: category._id,
            categoryName: category.name,
            yearMonth,
            field: 'outflowAmount',
            stored: storedOutflow,
            expected: calc.outflowAmount,
          });
        }

        calculatedSpending.delete(key);
      }
    }

    // Check for missing records (calculated values not in stored data)
    for (const [key, calc] of calculatedSpending.entries()) {
      const [categoryIdStr, yearMonthStr] = key.split('_');
      const categoryId = categoryIdStr as Id<'category'>;
      const yearMonth = parseInt(yearMonthStr);
      const category = categories.find((c) => c._id === categoryId);

      if (!category) continue;

      if (calc.inflowAmount !== 0n) {
        issues.push({
          type: 'category_spending_mismatch',
          severity: 'error',
          description: `Category "${category.name}" missing monthlySpending entry for ${yearMonth} - inflowAmount`,
          categoryId,
          categoryName: category.name,
          yearMonth,
          field: 'inflowAmount',
          stored: 0n,
          expected: calc.inflowAmount,
        });
      }

      if (calc.outflowAmount !== 0n) {
        issues.push({
          type: 'category_spending_mismatch',
          severity: 'error',
          description: `Category "${category.name}" missing monthlySpending entry for ${yearMonth} - outflowAmount`,
          categoryId,
          categoryName: category.name,
          yearMonth,
          field: 'outflowAmount',
          stored: 0n,
          expected: calc.outflowAmount,
        });
      }
    }

    return issues;
  },
});

/**
 * Fix category spending discrepancies by recalculating from transactions
 */
export const fix = internalMutation({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }) => {
    let fixed = 0;
    const errors: string[] = [];

    // Get all non-credit-card, non-deleted categories for this workspace
    const categories = await ctx.db
      .query('category')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.and(q.neq(q.field('categoryType'), 'credit_card'), q.eq(q.field('isDeleted'), false)))
      .collect();

    // Get all transactions for this workspace
    const transactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Build set of valid category IDs for this workspace
    const validCategoryIds = new Set(categories.map((c) => c._id.toString()));

    // Calculate correct spending for each category
    const calculatedSpending = new Map<string, Map<number, { inflowAmount: bigint; outflowAmount: bigint }>>();

    for (const transaction of transactions) {
      // Skip starting_balance and balance_adjustment (not real spending)
      if (transaction.type === 'starting_balance' || transaction.type === 'balance_adjustment') {
        continue;
      }

      const yearMonth = dateToYearMonth(transaction.date);

      for (const movement of transaction.movements ?? []) {
        if (!movement.categoryId) continue;
        if (!validCategoryIds.has(movement.categoryId.toString())) continue;

        const catId = movement.categoryId.toString();
        if (!calculatedSpending.has(catId)) {
          calculatedSpending.set(catId, new Map());
        }

        const catSpending = calculatedSpending.get(catId)!;
        if (!catSpending.has(yearMonth)) {
          catSpending.set(yearMonth, { inflowAmount: 0n, outflowAmount: 0n });
        }

        const spending = catSpending.get(yearMonth)!;
        if (movement.amount > 0) {
          spending.inflowAmount += movement.amount;
        } else if (movement.amount < 0) {
          spending.outflowAmount += -movement.amount;
        }
      }
    }

    // Update each category with correct monthlySpending (only if different)
    for (const category of categories) {
      try {
        const catSpending = calculatedSpending.get(category._id.toString());
        const newMonthlySpending: Record<string, { inflowAmount: bigint; outflowAmount: bigint }> = {};

        if (catSpending) {
          for (const [yearMonth, spending] of catSpending.entries()) {
            newMonthlySpending[yearMonth.toString()] = spending;
          }
        }

        // Count transactions for this category
        let transactionCount = 0n;
        for (const tx of transactions) {
          for (const m of tx.movements ?? []) {
            if (m.categoryId === category._id) {
              transactionCount += 1n;
              break; // Count each transaction once
            }
          }
        }

        // Check if anything actually changed
        const currentSpending = category.monthlySpending ?? {};
        const currentCount = category.transactionCount ?? 0n;

        const spendingChanged =
          JSON.stringify(
            Object.entries(currentSpending)
              .map(([k, v]) => [k, { inflowAmount: String(v.inflowAmount), outflowAmount: String(v.outflowAmount) }])
              .sort()
          ) !==
          JSON.stringify(
            Object.entries(newMonthlySpending)
              .map(([k, v]) => [k, { inflowAmount: String(v.inflowAmount), outflowAmount: String(v.outflowAmount) }])
              .sort()
          );
        const countChanged = currentCount !== transactionCount;

        if (spendingChanged || countChanged) {
          await ctx.db.patch(category._id, {
            monthlySpending: newMonthlySpending,
            transactionCount,
          });
          fixed++;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to fix category ${category.name}: ${message}`);
      }
    }

    return { fixed, errors };
  },
});
