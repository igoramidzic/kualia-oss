import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { yearMonthToString } from '../categoryBudgets/calculations';
import { listBudgetDataByMonthForWorkspace } from '../categoryBudgets/queries';

import { listCategoryGroupsWithCategories } from './categoryTools';
import { resolveMcpAmountMetadata, type McpAmountMetadata } from './tools';

type EnvelopeMonthCategory = {
  categoryId: Id<'category'>;
  name: string;
  sortOrder: number;
  isSystemCategory: boolean;
  isArchived: boolean;
  categoryType: 'custom' | 'owner_investment' | 'revenue' | 'credit_card_payment' | 'credit_card' | undefined;
  assignedAmount: bigint;
  totalSpent: bigint;
  carryoverFromPrevious: bigint;
  available: bigint;
  activity?: bigint;
  inflowAmount?: bigint;
  outflowAmount?: bigint;
  priorBalance?: bigint;
  currentBalance?: bigint;
  spendingAmount?: bigint;
  paymentsAmount?: bigint;
  fundedSpending?: bigint;
  paymentsAndReturns?: bigint;
  totalActivity?: bigint;
  activityThisMonth?: bigint;
  target: {
    assignmentNeeded: bigint;
    remainingToAssign: bigint;
    overfundedByAmount: bigint;
    underfundedAmount: bigint;
    fundedRatio: number;
    isSnoozed?: boolean;
    currentMonthInInterval?: number;
    totalMonthsInInterval?: number;
    cumulativeAssigned?: bigint;
    cumulativeTargetNeeded?: bigint;
  };
};

type EnvelopeMonthGroup = {
  groupId: Id<'categoryGroup'>;
  name: string;
  type: 'expense' | 'credit_card';
  sortOrder: number;
  isSystemGroup: boolean;
  categories: EnvelopeMonthCategory[];
};

type EnvelopeMonthSummary = {
  percentageFunded: number;
  totalTargetAmount: bigint;
  totalFunded: bigint;
  totalRemainingToFund: bigint;
  totalOverspent: bigint;
  extraFunding: bigint;
  coverOverspending: bigint;
};

export type EnvelopeMonthStatusPayload = McpAmountMetadata & {
  workspaceId: Id<'workspace'>;
  yearMonth: number;
  yearMonthString: string;
  currency: string;
  readyToAssign: bigint;
  summary: EnvelopeMonthSummary;
  groups: EnvelopeMonthGroup[];
};

export type EnvelopeMonthStatusFilter =
  | { kind: 'categoryId'; value: Id<'category'> }
  | { kind: 'categoryName'; value: string }
  | { kind: 'groupId'; value: Id<'categoryGroup'> }
  | { kind: 'groupName'; value: string };

export type EnvelopeMonthStatusFilterErrorCode = 'INVALID_ARGUMENT' | 'NOT_FOUND';

export class EnvelopeMonthStatusFilterError extends Error {
  readonly code: EnvelopeMonthStatusFilterErrorCode;

  constructor(code: EnvelopeMonthStatusFilterErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function readOptionalFilterString(args: Record<string, unknown>, fieldName: string): string | undefined {
  const value = args[fieldName];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new EnvelopeMonthStatusFilterError(
      'INVALID_ARGUMENT',
      `${fieldName} must be a non-empty string when provided`
    );
  }

  return value;
}

function normalizeFilterName(value: string): string {
  return value.trim().toLowerCase();
}

function duplicateCategoryMessage(
  name: string,
  matches: Array<{ group: EnvelopeMonthGroup; category: EnvelopeMonthCategory }>
): string {
  const candidates = matches
    .map(({ group, category }) => `${category.name} (categoryId: ${category.categoryId}, group: ${group.name})`)
    .join('; ');

  return `Multiple categories matched "${name}". Use categoryId to disambiguate. Candidates: ${candidates}`;
}

function duplicateGroupMessage(name: string, matches: EnvelopeMonthGroup[]): string {
  const candidates = matches.map((group) => `${group.name} (groupId: ${group.groupId})`).join('; ');

  return `Multiple groups matched "${name}". Use groupId to disambiguate. Candidates: ${candidates}`;
}

export function parseEnvelopeMonthStatusFilterInput(
  args: Record<string, unknown>
): EnvelopeMonthStatusFilter | undefined {
  const selectors: EnvelopeMonthStatusFilter[] = [];

  const categoryId = readOptionalFilterString(args, 'categoryId');
  if (categoryId !== undefined) {
    selectors.push({ kind: 'categoryId', value: categoryId as Id<'category'> });
  }

  const categoryName = readOptionalFilterString(args, 'categoryName');
  if (categoryName !== undefined) {
    selectors.push({ kind: 'categoryName', value: categoryName });
  }

  const groupId = readOptionalFilterString(args, 'groupId');
  if (groupId !== undefined) {
    selectors.push({ kind: 'groupId', value: groupId as Id<'categoryGroup'> });
  }

  const groupName = readOptionalFilterString(args, 'groupName');
  if (groupName !== undefined) {
    selectors.push({ kind: 'groupName', value: groupName });
  }

  if (selectors.length > 1) {
    throw new EnvelopeMonthStatusFilterError(
      'INVALID_ARGUMENT',
      'Pass at most one envelope month status filter: categoryId, categoryName, groupId, or groupName'
    );
  }

  return selectors[0];
}

export function filterEnvelopeMonthStatus(
  payload: EnvelopeMonthStatusPayload,
  filter: EnvelopeMonthStatusFilter | undefined
): EnvelopeMonthStatusPayload {
  if (!filter) {
    return payload;
  }

  if (filter.kind === 'groupId') {
    const group = payload.groups.find((candidate) => candidate.groupId === filter.value);
    if (!group) {
      throw new EnvelopeMonthStatusFilterError('NOT_FOUND', `No category group found for groupId ${filter.value}`);
    }

    return {
      ...payload,
      groups: [group],
    };
  }

  if (filter.kind === 'groupName') {
    const normalizedName = normalizeFilterName(filter.value);
    const matches = payload.groups.filter((group) => normalizeFilterName(group.name) === normalizedName);

    if (matches.length === 0) {
      throw new EnvelopeMonthStatusFilterError('NOT_FOUND', `No category group found named "${filter.value.trim()}"`);
    }

    if (matches.length > 1) {
      throw new EnvelopeMonthStatusFilterError('INVALID_ARGUMENT', duplicateGroupMessage(filter.value.trim(), matches));
    }

    return {
      ...payload,
      groups: [matches[0]],
    };
  }

  const matches: Array<{ group: EnvelopeMonthGroup; category: EnvelopeMonthCategory }> = [];
  for (const group of payload.groups) {
    for (const category of group.categories) {
      const isMatch =
        filter.kind === 'categoryId'
          ? category.categoryId === filter.value
          : normalizeFilterName(category.name) === normalizeFilterName(filter.value);

      if (isMatch) {
        matches.push({ group, category });
      }
    }
  }

  if (matches.length === 0) {
    const label =
      filter.kind === 'categoryId' ? `categoryId ${filter.value}` : `category named "${filter.value.trim()}"`;
    throw new EnvelopeMonthStatusFilterError('NOT_FOUND', `No ${label} found`);
  }

  if (matches.length > 1) {
    throw new EnvelopeMonthStatusFilterError(
      'INVALID_ARGUMENT',
      duplicateCategoryMessage(filter.value.toString().trim(), matches)
    );
  }

  const [{ group, category }] = matches;

  return {
    ...payload,
    groups: [
      {
        ...group,
        categories: [category],
      },
    ],
  };
}

export async function getEnvelopeMonthStatus(
  ctx: QueryCtx,
  workspace: Doc<'workspace'>,
  yearMonth: number,
  currentYearMonth: number
): Promise<EnvelopeMonthStatusPayload> {
  const currencyCode = workspace.currency ?? 'USD';
  const amountMetadata = resolveMcpAmountMetadata(currencyCode);

  const [groupedCategories, budgetData] = await Promise.all([
    listCategoryGroupsWithCategories(ctx, workspace._id),
    listBudgetDataByMonthForWorkspace(ctx, workspace._id, currentYearMonth),
  ]);

  const selectedMonth = budgetData.months.find((month) => month.yearMonth === yearMonth);
  if (!selectedMonth) {
    throw new Error(`Budget month ${yearMonth} is outside the available range`);
  }

  const groups: EnvelopeMonthGroup[] = groupedCategories.groups.map((group) => {
    const categories: EnvelopeMonthCategory[] = group.categories
      .map((groupCategory) => {
        const monthData = selectedMonth.budgetData[groupCategory.categoryId];
        if (!monthData) {
          return null;
        }

        const payloadCategory: EnvelopeMonthCategory = {
          categoryId: groupCategory.categoryId,
          name: groupCategory.name,
          sortOrder: groupCategory.sortOrder,
          isSystemCategory: groupCategory.isSystemCategory,
          isArchived: groupCategory.isArchived,
          categoryType: groupCategory.categoryType,
          assignedAmount: monthData.assignedAmount,
          totalSpent: monthData.totalSpent,
          carryoverFromPrevious: monthData.carryoverFromPrevious,
          available: monthData.available,
          target: {
            assignmentNeeded: monthData.target.assignmentNeeded,
            remainingToAssign: monthData.target.remainingToAssign,
            overfundedByAmount: monthData.target.overfundedByAmount,
            underfundedAmount: monthData.target.underfundedAmount,
            fundedRatio: monthData.target.fundedRatio,
            isSnoozed: monthData.target.isSnoozed,
            currentMonthInInterval: monthData.target.currentMonthInInterval,
            totalMonthsInInterval: monthData.target.totalMonthsInInterval,
            cumulativeAssigned: monthData.target.cumulativeAssigned,
            cumulativeTargetNeeded: monthData.target.cumulativeTargetNeeded,
          },
        };

        if (groupCategory.categoryType === 'credit_card') {
          payloadCategory.priorBalance = monthData.priorBalance;
          payloadCategory.currentBalance = monthData.currentBalance;
          payloadCategory.activity = monthData.activity;
          payloadCategory.activityThisMonth = monthData.activityThisMonth;
          payloadCategory.spendingAmount = monthData.spendingAmount;
          payloadCategory.paymentsAmount = monthData.paymentsAmount;
          payloadCategory.fundedSpending = monthData.fundedSpending;
          payloadCategory.paymentsAndReturns = monthData.paymentsAndReturns;
          payloadCategory.totalActivity = monthData.totalActivity;
        } else {
          payloadCategory.inflowAmount = monthData.inflowAmount;
          payloadCategory.outflowAmount = monthData.outflowAmount;
          payloadCategory.activity = monthData.activity;
        }

        return payloadCategory;
      })
      .filter((category): category is EnvelopeMonthCategory => category !== null);

    return {
      groupId: group.groupId,
      name: group.name,
      type: group.type,
      sortOrder: group.sortOrder,
      isSystemGroup: group.isSystemGroup,
      categories,
    };
  });

  return {
    workspaceId: workspace._id,
    yearMonth,
    yearMonthString: yearMonthToString(yearMonth),
    currency: currencyCode,
    ...amountMetadata,
    readyToAssign: budgetData.readyToAssign,
    summary: selectedMonth.summary,
    groups,
  };
}
