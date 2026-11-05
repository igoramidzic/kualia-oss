import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { resolveMcpAmountMetadata, type McpAmountMetadata } from './tools';

export type CategoryGroupsToolPayload = {
  workspaceId: Id<'workspace'>;
  groups: Array<{
    groupId: Id<'categoryGroup'>;
    name: string;
    type: 'expense' | 'credit_card';
    isSystemGroup: boolean;
    sortOrder: number;
    categories: Array<{
      categoryId: Id<'category'>;
      name: string;
      sortOrder: number;
      iconName: string | undefined;
      categoryType: 'custom' | 'owner_investment' | 'revenue' | 'credit_card_payment' | 'credit_card' | undefined;
      isSystemCategory: boolean;
      isArchived: boolean;
    }>;
  }>;
};

type CategoryType = 'custom' | 'owner_investment' | 'revenue' | 'credit_card_payment' | 'credit_card' | undefined;

export function resolveCategoryNameFromBankAccount(
  categoryName: string,
  categoryType: CategoryType,
  bankAccountId: string | undefined,
  bankAccountNamesById: ReadonlyMap<string, string>
): string {
  if (categoryType !== 'credit_card' || !bankAccountId) {
    return categoryName;
  }

  return bankAccountNamesById.get(bankAccountId) ?? categoryName;
}

export async function listCategoryGroupsWithCategories(
  ctx: QueryCtx,
  workspaceId: Id<'workspace'>
): Promise<CategoryGroupsToolPayload> {
  const [groups, categories, bankAccounts] = await Promise.all([
    ctx.db
      .query('categoryGroup')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .collect(),
    ctx.db
      .query('category')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .collect(),
    ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .collect(),
  ]);

  const bankAccountNamesById = new Map<string, string>();
  for (const bankAccount of bankAccounts) {
    if (bankAccount.isDeleted) {
      continue;
    }

    bankAccountNamesById.set(bankAccount._id, bankAccount.name);
  }

  const activeGroups = groups
    .filter((group) => !group.isDeleted)
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }

      return a.name.localeCompare(b.name);
    });

  const activeCategories = categories.filter((category) => !category.isDeleted);
  const categoriesByGroup = new Map<Id<'categoryGroup'>, Array<(typeof activeCategories)[number]>>();

  for (const category of activeCategories) {
    const groupCategories = categoriesByGroup.get(category.categoryGroupId);
    if (groupCategories) {
      groupCategories.push(category);
      continue;
    }

    categoriesByGroup.set(category.categoryGroupId, [category]);
  }

  for (const groupCategories of categoriesByGroup.values()) {
    groupCategories.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }

      return a.name.localeCompare(b.name);
    });
  }

  return {
    workspaceId,
    groups: activeGroups.map((group) => ({
      groupId: group._id,
      name: group.name,
      type: group.type,
      isSystemGroup: group.isSystemGroup ?? false,
      sortOrder: group.sortOrder,
      categories: (categoriesByGroup.get(group._id) ?? []).map((category) => ({
        categoryId: category._id,
        name: resolveCategoryNameFromBankAccount(
          category.name,
          category.categoryType,
          category.bankAccountId,
          bankAccountNamesById
        ),
        sortOrder: category.sortOrder,
        iconName: category.iconName,
        categoryType: category.categoryType,
        isSystemCategory: category.isSystemCategory ?? false,
        isArchived: category.isArchived ?? false,
      })),
    })),
  };
}

// ============================================================================
// CATEGORY TARGETS
// ============================================================================

type CategoryTargetEntry = {
  categoryId: Id<'category'>;
  categoryName: string;
  groupName: string;
  targetType: 'recurring' | 'recurring_rollover' | 'maintain_balance' | 'one_time';
  targetAmount: bigint | null;
  targetFrequency: string | null;
  targetFrequencyInterval: number | null;
  targetFirstDueDate: string | null;
  targetTargetDate: string | null;
  targetTargetBalance: bigint | null;
  targetMonthlyContribution: bigint | null;
  targetDueDay: number | null;
};

export type CategoryTargetsToolPayload = McpAmountMetadata & {
  workspaceId: Id<'workspace'>;
  currency: string;
  categories: CategoryTargetEntry[];
};

export async function listCategoryTargets(
  ctx: QueryCtx,
  workspace: Doc<'workspace'>
): Promise<CategoryTargetsToolPayload> {
  const currencyCode = workspace.currency ?? 'USD';
  const amountMetadata = resolveMcpAmountMetadata(currencyCode);

  const [groups, categories, bankAccounts] = await Promise.all([
    ctx.db
      .query('categoryGroup')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspace._id))
      .collect(),
    ctx.db
      .query('category')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspace._id))
      .collect(),
    ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspace._id))
      .collect(),
  ]);

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

  const targetCategories: CategoryTargetEntry[] = [];

  for (const category of categories) {
    if (category.isDeleted || !category.enableTarget || !category.target_type) {
      continue;
    }

    const categoryName = resolveCategoryNameFromBankAccount(
      category.name,
      category.categoryType,
      category.bankAccountId,
      bankAccountNamesById
    );

    targetCategories.push({
      categoryId: category._id,
      categoryName,
      groupName: groupNameById.get(category.categoryGroupId) ?? 'Unknown',
      targetType: category.target_type,
      targetAmount: category.target_amount ?? null,
      targetFrequency: category.target_frequency ?? null,
      targetFrequencyInterval: category.target_frequencyInterval ?? null,
      targetFirstDueDate: category.target_firstDueDate ?? null,
      targetTargetDate: category.target_targetDate ?? null,
      targetTargetBalance: category.target_targetBalance ?? null,
      targetMonthlyContribution: category.target_monthlyContribution ?? null,
      targetDueDay: category.target_dueDay ?? null,
    });
  }

  return {
    workspaceId: workspace._id,
    currency: currencyCode,
    ...amountMetadata,
    categories: targetCategories,
  };
}
