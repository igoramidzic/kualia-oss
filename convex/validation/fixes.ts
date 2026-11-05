import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import { internalMutation, mutation } from '../_generated/server';
import { requireWorkspaceAccess } from '../lib/auth';
import type { FixResult, WorkspaceFixResult } from './types';

// Issue types that can be fixed
const FIXABLE_ISSUE_TYPES = [
  'credit_card_transfer_mismatch', // Must run before credit_spending_mismatch
  'category_spending_mismatch',
  'credit_spending_mismatch',
  'merchant_stats_mismatch',
  'starting_balance_rta_missing',
  'ready_to_assign_mismatch',
  'monthly_income_activity_mismatch',
  'transaction_flag_incorrect',
  'movement_total_mismatch',
  'bank_account_balance_mismatch',
  'bank_account_pending_cleared_mismatch',
] as const;

type FixableIssueType = (typeof FIXABLE_ISSUE_TYPES)[number];

/**
 * Fix all issues for a single workspace
 * Can optionally specify which issue types to fix
 *
 * Each fix runs as a separate scheduled mutation to avoid hitting the 16MB read limit
 * when workspaces have large amounts of data.
 */
export const fixWorkspace = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    issueTypes: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { workspaceId, issueTypes }): Promise<WorkspaceFixResult> => {
    const fixResults: Record<string, FixResult> = {};

    const shouldFix = (type: FixableIssueType): boolean => {
      if (!issueTypes || issueTypes.length === 0) return true;
      return issueTypes.includes(type);
    };

    // Schedule each fix to run as a separate mutation to avoid 16MB read limit
    // Each scheduled mutation gets its own isolated execution context

    // Fix credit card transfer mismatches FIRST
    // This repairs creditCardTransfer metadata before spending is recalculated
    if (shouldFix('credit_card_transfer_mismatch')) {
      await ctx.scheduler.runAfter(0, internal.validation.validators.creditCardTransferMismatch.fix, {
        workspaceId,
      });
      fixResults['creditCardTransferMismatch'] = { fixed: 0, errors: [] };
    }

    // Fix category spending (delay slightly to run after credit card transfer fix)
    if (shouldFix('category_spending_mismatch')) {
      await ctx.scheduler.runAfter(100, internal.validation.validators.categorySpending.fix, { workspaceId });
      fixResults['categorySpending'] = { fixed: 0, errors: [] };
    }

    // Fix credit spending (delay to run after category spending)
    if (shouldFix('credit_spending_mismatch')) {
      await ctx.scheduler.runAfter(200, internal.validation.validators.creditSpending.fix, { workspaceId });
      fixResults['creditSpending'] = { fixed: 0, errors: [] };
    }

    // Fix merchant stats
    if (shouldFix('merchant_stats_mismatch')) {
      await ctx.scheduler.runAfter(300, internal.validation.validators.merchantStats.fix, { workspaceId });
      fixResults['merchantStats'] = { fixed: 0, errors: [] };
    }

    // Fix starting balance RTA (must run before RTA fix)
    if (shouldFix('starting_balance_rta_missing')) {
      await ctx.scheduler.runAfter(400, internal.validation.validators.startingBalanceRTA.fix, { workspaceId });
      fixResults['startingBalanceRTA'] = { fixed: 0, errors: [] };
    }

    // Fix RTA (delay to run after starting balance RTA)
    if (shouldFix('ready_to_assign_mismatch')) {
      await ctx.scheduler.runAfter(500, internal.validation.validators.readyToAssign.fix, { workspaceId });
      fixResults['readyToAssign'] = { fixed: 0, errors: [] };
    }

    // Fix monthly income activity
    if (shouldFix('monthly_income_activity_mismatch')) {
      await ctx.scheduler.runAfter(600, internal.validation.validators.monthlyIncomeActivity.fix, { workspaceId });
      fixResults['monthlyIncomeActivity'] = { fixed: 0, errors: [] };
    }

    // Fix transaction flags
    if (shouldFix('transaction_flag_incorrect')) {
      await ctx.scheduler.runAfter(700, internal.validation.validators.transactionFlags.fix, { workspaceId });
      fixResults['transactionFlags'] = { fixed: 0, errors: [] };
    }

    // Fix movement totals
    if (shouldFix('movement_total_mismatch')) {
      await ctx.scheduler.runAfter(800, internal.validation.validators.movementTotals.fix, { workspaceId });
      fixResults['movementTotals'] = { fixed: 0, errors: [] };
    }

    // Fix bank account balances
    if (shouldFix('bank_account_balance_mismatch')) {
      await ctx.scheduler.runAfter(900, internal.validation.validators.bankAccountBalances.fix, { workspaceId });
      fixResults['bankAccountBalances'] = { fixed: 0, errors: [] };
    }

    // Fix bank account pending/cleared balances
    if (shouldFix('bank_account_pending_cleared_mismatch')) {
      await ctx.scheduler.runAfter(1000, internal.validation.validators.bankAccountPendingCleared.fix, {
        workspaceId,
      });
      fixResults['bankAccountPendingCleared'] = { fixed: 0, errors: [] };
    }

    return {
      workspaceId,
      fixResults,
      fixedAt: new Date().toISOString(),
    };
  },
});

const FIX_ALL_BATCH_SIZE = 5;

/**
 * Entry point to fix all workspaces.
 * Kicks off cursor-based batch processing that calls fixWorkspace on each workspace.
 */
export const fixAllWorkspaces = internalMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.validation.fixes.processFixBatch, {
      cursor: undefined,
      totalProcessed: 0,
      totalFixed: 0,
    });
  },
});

/**
 * Process a batch of workspaces, calling fixWorkspace on each.
 * Uses cursor-based pagination to avoid timeout issues.
 */
export const processFixBatch = internalMutation({
  args: {
    cursor: v.optional(v.id('workspace')),
    totalProcessed: v.number(),
    totalFixed: v.number(),
  },
  handler: async (ctx, { cursor, totalProcessed, totalFixed }) => {
    let workspacesQuery = ctx.db.query('workspace');

    if (cursor) {
      const cursorWorkspace = await ctx.db.get(cursor);
      if (cursorWorkspace) {
        workspacesQuery = workspacesQuery.filter((q) => q.gt(q.field('_creationTime'), cursorWorkspace._creationTime));
      }
    }

    const workspaces = await workspacesQuery.take(FIX_ALL_BATCH_SIZE + 1);
    const hasMore = workspaces.length > FIX_ALL_BATCH_SIZE;
    const toProcess = workspaces.slice(0, FIX_ALL_BATCH_SIZE);

    let batchFixed = 0;

    for (const workspace of toProcess) {
      try {
        const result = await ctx.runMutation(internal.validation.fixes.fixWorkspace, {
          workspaceId: workspace._id,
        });
        const totalFixedInWorkspace = Object.values(result.fixResults).reduce((sum, r) => sum + r.fixed, 0);
        if (totalFixedInWorkspace > 0) {
          batchFixed++;
        }
      } catch (error) {
        console.error(`[FixAll] Error fixing workspace ${workspace._id}:`, error);
      }
    }

    const newTotalProcessed = totalProcessed + toProcess.length;
    const newTotalFixed = totalFixed + batchFixed;
    const lastWorkspaceId = toProcess[toProcess.length - 1]?._id ?? null;

    if (hasMore && lastWorkspaceId) {
      await ctx.scheduler.runAfter(0, internal.validation.fixes.processFixBatch, {
        cursor: lastWorkspaceId,
        totalProcessed: newTotalProcessed,
        totalFixed: newTotalFixed,
      });
    } else {
      console.log(`[FixAll] Complete. Processed: ${newTotalProcessed}, Workspaces with fixes: ${newTotalFixed}`);
    }
  },
});

/**
 * Public fix endpoint with authentication
 * Fixes all issues for the specified workspace
 */
export const fixWorkspacePublic = mutation({
  args: {
    workspaceId: v.id('workspace'),
    issueTypes: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { workspaceId, issueTypes }): Promise<WorkspaceFixResult> => {
    // Verify user has access to this workspace
    await requireWorkspaceAccess(ctx, workspaceId);

    return ctx.runMutation(internal.validation.fixes.fixWorkspace, {
      workspaceId,
      issueTypes,
    }) as Promise<WorkspaceFixResult>;
  },
});

/**
 * Result type for loan credit card category cleanup
 */
interface LoanCreditCardCleanupResult {
  found: number;
  deleted: number;
  categoriesDeleted: Array<{
    categoryId: string;
    categoryName: string;
    bankAccountId: string;
    bankAccountName: string;
    accountType: string;
  }>;
  errors: string[];
}

/**
 * Cleanup credit card categories that were incorrectly created for loan accounts.
 * This mutation:
 * 1. Finds all credit card categories linked to loan bank accounts
 * 2. Deletes associated categoryBudget rows and releases funds to RTA
 * 3. Soft deletes the categories
 * 4. Runs fixWorkspace to ensure data consistency
 */
export const cleanupLoanCreditCardCategories = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { workspaceId }): Promise<LoanCreditCardCleanupResult> => {
    const result: LoanCreditCardCleanupResult = {
      found: 0,
      deleted: 0,
      categoriesDeleted: [],
      errors: [],
    };

    // Find all credit card categories for this workspace
    const creditCardCategories = await ctx.db
      .query('category')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.and(q.eq(q.field('categoryType'), 'credit_card'), q.eq(q.field('isDeleted'), false)))
      .collect();

    // Filter to only those linked to loan accounts
    const categoriesToDelete: Array<{
      category: Doc<'category'>;
      bankAccount: Doc<'bankAccount'>;
    }> = [];

    for (const category of creditCardCategories) {
      if (!category.bankAccountId) continue;

      const bankAccount = await ctx.db.get(category.bankAccountId);
      if (!bankAccount) continue;

      // Check if this is a loan account type
      if (bankAccount.accountType?.startsWith('loan_')) {
        result.found++;
        categoriesToDelete.push({ category, bankAccount });
      }
    }

    if (categoriesToDelete.length === 0) {
      return result;
    }

    const timestamp = new Date().toISOString();

    // Process each category
    for (const { category, bankAccount } of categoriesToDelete) {
      try {
        // 1. Find and delete associated categoryBudget rows, releasing funds to RTA
        const categoryBudget = await ctx.db
          .query('categoryBudget')
          .withIndex('by_workspaceId_categoryId', (q) =>
            q.eq('workspaceId', workspaceId).eq('categoryId', category._id)
          )
          .first();

        if (categoryBudget) {
          // Release assigned amounts back to ReadyToAssign for each month
          const monthlyAmounts = categoryBudget.monthlyAssignedAmounts ?? {};
          for (const [yearMonthStr, amount] of Object.entries(monthlyAmounts)) {
            if (amount !== 0n) {
              await ctx.runMutation(internal.workspaces.updateWorkspaceReadyToAssign, {
                workspaceId,
                amountDelta: amount, // Positive delta adds back to readyToAssign
                yearMonth: parseInt(yearMonthStr, 10),
              });
            }
          }

          // Delete the categoryBudget row
          await ctx.db.delete(categoryBudget._id);
        }

        // 2. Soft delete the category
        await ctx.db.patch(category._id, {
          isDeleted: true,
          deletedAt: timestamp,
          updatedAt: timestamp,
        });

        result.deleted++;
        result.categoriesDeleted.push({
          categoryId: category._id,
          categoryName: category.name,
          bankAccountId: bankAccount._id,
          bankAccountName: bankAccount.name,
          accountType: bankAccount.accountType ?? 'unknown',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`Failed to delete category ${category.name}: ${message}`);
      }
    }

    // 3. Run fixWorkspace to ensure data consistency
    if (result.deleted > 0) {
      try {
        await ctx.runMutation(internal.validation.fixes.fixWorkspace, {
          workspaceId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`fixWorkspace failed: ${message}`);
      }
    }

    return result;
  },
});

/**
 * Public endpoint to cleanup credit card categories incorrectly created for loan accounts.
 * Call this to find and delete any credit card categories linked to loan bank accounts.
 */
export const cleanupLoanCreditCardCategoriesPublic = mutation({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { workspaceId }): Promise<LoanCreditCardCleanupResult> => {
    // Verify user has access to this workspace
    await requireWorkspaceAccess(ctx, workspaceId);

    return ctx.runMutation(internal.validation.fixes.cleanupLoanCreditCardCategories, {
      workspaceId,
    }) as Promise<LoanCreditCardCleanupResult>;
  },
});

/**
 * Result type for detecting loan credit card category issues across all workspaces
 */
interface LoanCreditCardIssueDetectionResult {
  totalAffectedWorkspaces: number;
  totalAffectedCategories: number;
  workspaces: Array<{
    workspaceId: string;
    categories: Array<{
      categoryId: string;
      categoryName: string;
      bankAccountId: string;
      bankAccountName: string;
      accountType: string;
    }>;
  }>;
}

/**
 * Detect all workspaces that have credit card categories incorrectly linked to loan accounts.
 * This is an internal mutation for admin use - no auth required.
 */
export const detectAllLoanCreditCardCategoryIssues = internalMutation({
  args: {},
  handler: async (ctx): Promise<LoanCreditCardIssueDetectionResult> => {
    const result: LoanCreditCardIssueDetectionResult = {
      totalAffectedWorkspaces: 0,
      totalAffectedCategories: 0,
      workspaces: [],
    };

    // Find all credit card categories across all workspaces
    const allCreditCardCategories = await ctx.db
      .query('category')
      .filter((q) => q.and(q.eq(q.field('categoryType'), 'credit_card'), q.eq(q.field('isDeleted'), false)))
      .collect();

    // Group by workspace and filter to only those linked to loan accounts
    const workspaceMap = new Map<
      string,
      Array<{
        categoryId: string;
        categoryName: string;
        bankAccountId: string;
        bankAccountName: string;
        accountType: string;
      }>
    >();

    for (const category of allCreditCardCategories) {
      if (!category.bankAccountId || !category.workspaceId) continue;

      const bankAccount = await ctx.db.get(category.bankAccountId);
      if (!bankAccount) continue;

      // Check if this is a loan account type
      if (bankAccount.accountType?.startsWith('loan_')) {
        const workspaceId = category.workspaceId;
        if (!workspaceMap.has(workspaceId)) {
          workspaceMap.set(workspaceId, []);
        }
        workspaceMap.get(workspaceId)!.push({
          categoryId: category._id,
          categoryName: category.name,
          bankAccountId: bankAccount._id,
          bankAccountName: bankAccount.name,
          accountType: bankAccount.accountType ?? 'unknown',
        });
        result.totalAffectedCategories++;
      }
    }

    // Convert map to array
    for (const [workspaceId, categories] of workspaceMap) {
      result.workspaces.push({ workspaceId, categories });
    }
    result.totalAffectedWorkspaces = workspaceMap.size;

    return result;
  },
});

/**
 * Result type for batch cleanup of all loan credit card category issues
 */
interface BatchLoanCreditCardCleanupResult {
  totalWorkspacesProcessed: number;
  totalCategoriesDeleted: number;
  workspaceResults: Array<{
    workspaceId: string;
    deleted: number;
    errors: string[];
  }>;
  errors: string[];
}

/**
 * Cleanup all credit card categories incorrectly created for loan accounts across ALL workspaces.
 * This is an internal mutation for admin use - processes all affected workspaces.
 */
export const cleanupAllLoanCreditCardCategories = internalMutation({
  args: {},
  handler: async (ctx): Promise<BatchLoanCreditCardCleanupResult> => {
    const result: BatchLoanCreditCardCleanupResult = {
      totalWorkspacesProcessed: 0,
      totalCategoriesDeleted: 0,
      workspaceResults: [],
      errors: [],
    };

    // First, detect all affected workspaces
    const detection = await ctx.runMutation(internal.validation.fixes.detectAllLoanCreditCardCategoryIssues, {});

    if (detection.totalAffectedWorkspaces === 0) {
      return result;
    }

    // Process each affected workspace
    for (const workspace of detection.workspaces) {
      try {
        const cleanupResult = await ctx.runMutation(internal.validation.fixes.cleanupLoanCreditCardCategories, {
          workspaceId: workspace.workspaceId as Doc<'workspace'>['_id'],
        });

        result.totalWorkspacesProcessed++;
        result.totalCategoriesDeleted += cleanupResult.deleted;
        result.workspaceResults.push({
          workspaceId: workspace.workspaceId,
          deleted: cleanupResult.deleted,
          errors: cleanupResult.errors,
        });

        if (cleanupResult.errors.length > 0) {
          result.errors.push(`Workspace ${workspace.workspaceId}: ${cleanupResult.errors.join(', ')}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`Failed to process workspace ${workspace.workspaceId}: ${message}`);
        result.workspaceResults.push({
          workspaceId: workspace.workspaceId,
          deleted: 0,
          errors: [message],
        });
      }
    }

    return result;
  },
});
