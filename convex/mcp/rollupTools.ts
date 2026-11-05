import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

import { resolveCategoryNameFromBankAccount } from './categoryTools';
import { resolveMcpAmountMetadata, type McpAmountMetadata } from './tools';

type CategoryRollupEntry = {
  categoryId: Id<'category'>;
  categoryName: string;
  groupName: string;
  totalAssigned: bigint;
  totalInflow: bigint;
  totalOutflow: bigint;
  netSpending: bigint;
  monthCount: number;
};

export type CategoryRollupToolPayload = McpAmountMetadata & {
  workspaceId: Id<'workspace'>;
  currency: string;
  monthRange: {
    startYearMonth: number;
    endYearMonth: number;
  };
  categories: CategoryRollupEntry[];
};

export async function getCategoryRollup(
  ctx: QueryCtx,
  workspace: Doc<'workspace'>,
  yearMonths: number[]
): Promise<CategoryRollupToolPayload> {
  const currencyCode = workspace.currency ?? 'USD';
  const amountMetadata = resolveMcpAmountMetadata(currencyCode);

  const [groups, categories, budgets, bankAccounts] = await Promise.all([
    ctx.db
      .query('categoryGroup')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspace._id))
      .collect(),
    ctx.db
      .query('category')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspace._id))
      .collect(),
    ctx.db
      .query('categoryBudget')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspace._id))
      .collect(),
    ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspace._id))
      .collect(),
  ]);

  // Build lookup maps
  const groupNameById = new Map<string, string>();
  for (const group of groups) {
    if (!group.isDeleted) {
      groupNameById.set(group._id, group.name);
    }
  }

  const bankAccountNamesById = new Map<string, string>();
  for (const account of bankAccounts) {
    if (!account.isDeleted) {
      bankAccountNamesById.set(account._id, account.name);
    }
  }

  // Build budget lookup: categoryId -> monthlyAssignedAmounts
  const budgetByCategoryId = new Map<string, Record<string, bigint>>();
  for (const budget of budgets) {
    budgetByCategoryId.set(budget.categoryId, budget.monthlyAssignedAmounts);
  }

  const yearMonthKeys = new Set(yearMonths.map((ym) => ym.toString()));

  const entries: CategoryRollupEntry[] = [];

  for (const category of categories) {
    if (category.isDeleted) continue;

    let totalAssigned = 0n;
    let totalInflow = 0n;
    let totalOutflow = 0n;
    let monthCount = 0;

    // Sum spending from category.monthlySpending
    const monthlySpending = category.monthlySpending ?? {};
    for (const ymKey of yearMonthKeys) {
      const spending = monthlySpending[ymKey];
      if (spending) {
        totalInflow += spending.inflowAmount;
        totalOutflow += spending.outflowAmount;
        monthCount++;
      }
    }

    // Sum assigned amounts from categoryBudget.monthlyAssignedAmounts
    const assignedAmounts = budgetByCategoryId.get(category._id);
    if (assignedAmounts) {
      for (const ymKey of yearMonthKeys) {
        const assigned = assignedAmounts[ymKey];
        if (assigned !== undefined) {
          totalAssigned += assigned;
          if (!monthlySpending[ymKey]) {
            monthCount++;
          }
        }
      }
    }

    // Skip categories with zero activity in the entire range
    if (totalAssigned === 0n && totalInflow === 0n && totalOutflow === 0n) {
      continue;
    }

    const categoryName = resolveCategoryNameFromBankAccount(
      category.name,
      category.categoryType,
      category.bankAccountId,
      bankAccountNamesById
    );

    entries.push({
      categoryId: category._id,
      categoryName,
      groupName: groupNameById.get(category.categoryGroupId) ?? 'Unknown',
      totalAssigned,
      totalInflow,
      totalOutflow,
      netSpending: totalOutflow - totalInflow,
      monthCount,
    });
  }

  // Sort by netSpending descending (biggest spenders first)
  entries.sort((a, b) => {
    const diff = b.netSpending - a.netSpending;
    if (diff > 0n) return 1;
    if (diff < 0n) return -1;
    return a.categoryName.localeCompare(b.categoryName);
  });

  return {
    workspaceId: workspace._id,
    currency: currencyCode,
    ...amountMetadata,
    monthRange: {
      startYearMonth: yearMonths[0],
      endYearMonth: yearMonths[yearMonths.length - 1],
    },
    categories: entries,
  };
}
