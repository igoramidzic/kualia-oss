import { ConvexError, v } from 'convex/values';

import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import { dateToYearMonth } from './categoryBudgets/calculations';
import { isDev } from './lib/devUtils';
import { cleanBase64String } from './lib/logoUtils';

/**
 * DANGEROUS: Deletes all transaction-related data and workspaces.
 * This mutation can ONLY be run in development mode.
 *
 * Deletes data from:
 * - transactionImportRaw
 * - transaction (with embedded movements)
 * - merchant
 * - orgMerchantCategoryMapping
 * - categoryBudget
 * - category
 * - categoryGroup
 * - bankAccount
 * - bankLinkAccount
 * - bankLink
 * - creditCategorySpending
 * - workspace
 *
 * The function automatically schedules itself to continue until all data is deleted.
 */
/**
 * Helper function to delete rows from a table in chunks
 * This prevents exceeding Convex's read limit (4096 reads per function execution)
 * Processes a maximum number of chunks per call to stay under the limit
 */
async function deleteAllInChunks(
  // biome-ignore lint/suspicious/noExplicitAny: Test data helpers intentionally accept arbitrary Convex documents.
  ctx: any,
  tableName: string,
  chunkSize: number = 50,
  maxChunks: number = 60 // Max chunks to process per call (60 * 50 = 3000 reads, well under 4096)
): Promise<{ deleted: number; chunksProcessed: number; hasMore: boolean }> {
  let totalDeleted = 0;
  let chunksProcessed = 0;
  let hasMore = true;

  while (hasMore && chunksProcessed < maxChunks) {
    // Use take() to limit reads per iteration
    const chunk = await ctx.db.query(tableName).take(chunkSize);

    if (chunk.length === 0) {
      hasMore = false;
      break;
    }

    // Delete all items in this chunk
    for (const item of chunk) {
      await ctx.db.delete(item._id);
      totalDeleted++;
    }

    chunksProcessed++;

    // If we got fewer items than chunkSize, we're done with this table
    if (chunk.length < chunkSize) {
      hasMore = false;
    }
  }

  return { deleted: totalDeleted, chunksProcessed, hasMore };
}

/**
 * Internal mutation that performs the actual deletion work
 * This can be called recursively via the scheduler
 */
export const deleteAllTransactionDataInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Delete in order of dependencies (child tables first)
    // Process in small chunks to avoid exceeding read limits
    // Total max chunks per execution: 60 chunks * 50 items = 3000 reads (well under 4096)
    const chunkSize = 50;
    const maxTotalChunks = 60; // Limit TOTAL chunks across all tables per execution

    type DeletionResults = {
      transactionImportRaw: number;
      transactionMovement: number;
      transaction: number;
      merchant: number;
      orgMerchantCategoryMapping: number;
      categoryBudget: number;
      category: number;
      categoryGroup: number;
      bankAccount: number;
      bankLinkAccount: number;
      bankLink: number;
      workspace: number;
    } & Record<string, number>; // Allow index access with string keys

    const results: DeletionResults = {
      transactionImportRaw: 0,
      transactionMovement: 0,
      transaction: 0,
      merchant: 0,
      orgMerchantCategoryMapping: 0,
      categoryBudget: 0,
      category: 0,
      categoryGroup: 0,
      bankAccount: 0,
      bankLinkAccount: 0,
      bankLink: 0,
      workspace: 0,
    };

    let totalChunksProcessed = 0;
    let hasMoreDataInAnyTable = false;

    // Process tables in order, but stop if we hit the total chunk limit
    // Order matters: delete child tables first, workspace last
    const tables = [
      'transactionImportRaw',
      'transactionMovement',
      'transaction',
      'merchant',
      'orgMerchantCategoryMapping',
      'categoryBudget',
      'category',
      'categoryGroup',
      'bankAccount',
      'bankLinkAccount', // Delete bankLinkAccount before bankLink (references bankLink)
      'bankLink',
      'workspace', // Delete workspace last (many tables reference it)
    ] as const;

    for (const tableName of tables) {
      if (totalChunksProcessed >= maxTotalChunks) {
        // We hit the limit, so there's definitely more data
        hasMoreDataInAnyTable = true;
        break;
      }

      const remainingChunks = maxTotalChunks - totalChunksProcessed;
      const result = await deleteAllInChunks(ctx, tableName, chunkSize, remainingChunks);
      results[tableName] += result.deleted;
      totalChunksProcessed += result.chunksProcessed;

      // Track if this table still has more data
      if (result.hasMore) {
        hasMoreDataInAnyTable = true;
      }

      // If we hit the chunk limit, stop processing
      if (totalChunksProcessed >= maxTotalChunks) {
        break;
      }

      // If this table is done (no more data), continue to next table
      if (!result.hasMore) {
        continue;
      }
    }

    // Check if there's more data to process
    // Either we hit the chunk limit OR a table still has more data
    const hasMoreData = totalChunksProcessed >= maxTotalChunks || hasMoreDataInAnyTable;

    // If there's more data, schedule another execution
    if (hasMoreData) {
      await ctx.scheduler.runAfter(0, internal['devUtils'].deleteAllTransactionDataInternal, {});
    }

    return {
      deleted: {
        transactionImportRaw: results.transactionImportRaw,
        transactionMovement: results.transactionMovement,
        transaction: results.transaction,
        merchant: results.merchant,
        orgMerchantCategoryMapping: results.orgMerchantCategoryMapping,
        categoryBudget: results.categoryBudget,
        category: results.category,
        categoryGroup: results.categoryGroup,
        bankAccount: results.bankAccount,
        bankLinkAccount: results.bankLinkAccount,
        bankLink: results.bankLink,
        workspace: results.workspace,
      },
      hasMore: hasMoreData,
      chunksProcessed: totalChunksProcessed,
      note: hasMoreData ? 'More data remains. Scheduling next batch...' : 'All data deleted successfully.',
    };
  },
});

/**
 * Return type for deletion operations
 */
type DeletionResult = {
  deleted: {
    transactionImportRaw: number;
    transactionMovement: number;
    transaction: number;
    merchant: number;
    orgMerchantCategoryMapping: number;
    categoryBudget: number;
    category: number;
    categoryGroup: number;
    bankAccount: number;
    bankLinkAccount: number;
    bankLink: number;
    workspace: number;
  };
  hasMore: boolean;
  chunksProcessed: number;
  note: string;
};

/**
 * Internal mutation that starts the deletion process
 * This will automatically continue until all data is deleted
 */
export const deleteAllTransactionData = internalMutation({
  args: {},
  handler: async (ctx): Promise<DeletionResult> => {
    // CRITICAL: Only allow in development
    if (!isDev()) {
      throw new ConvexError('This mutation can only be run in development mode');
    }

    // Start the deletion process by calling the internal mutation
    // It will schedule itself to continue if more data remains
    const result: DeletionResult = await ctx.runMutation(internal['devUtils'].deleteAllTransactionDataInternal, {});

    return {
      ...result,
      note: result.hasMore
        ? 'Deletion started. The function will automatically continue until all data is deleted.'
        : 'All data deleted successfully.',
    };
  },
});

/**
 * TEST UTILITY: Manually trigger daily notification for a specific timezone
 * This allows testing the email notification system without waiting for 9am
 *
 * Usage in Convex Dashboard:
 * 1. Go to Functions tab
 * 2. Find "devUtils" -> "testDailyNotification"
 * 3. Click "Run Function"
 * 4. Provide timezone (e.g., "America/New_York", "America/Los_Angeles")
 * 5. Click "Run"
 *
 * Example timezones:
 * - "America/New_York" (Eastern Time)
 * - "America/Los_Angeles" (Pacific Time)
 * - "Europe/London" (London)
 * - "Asia/Tokyo" (Tokyo)
 */
export const testDailyNotification = internalMutation({
  args: {
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, { timezone }) => {
    // CRITICAL: Only allow in development
    if (!isDev()) {
      throw new ConvexError('This mutation can only be run in development mode');
    }

    // Use provided timezone or default to Eastern Time
    const targetTimezone = timezone ?? 'America/New_York';

    // Schedule the notification action
    // biome-ignore lint/suspicious/noExplicitAny: Test data helpers intentionally accept arbitrary Convex documents.
    const sendNotification = (internal as any)['notifications/dailyNotification'].sendDailyNotification;
    await ctx.scheduler.runAfter(0, sendNotification, {
      timezone: targetTimezone,
    });

    return {
      success: true,
      message: `Daily notification scheduled for timezone: ${targetTimezone}`,
      timezone: targetTimezone,
      note: 'Check logs for email sending status. Emails will be sent to all members of workspaces in this timezone.',
    };
  },
});

/**
 * TEST UTILITY: Update bank link status for testing email notifications
 * This allows testing bank link status change email notifications
 *
 * Usage in Convex Dashboard:
 * 1. Go to Functions tab
 * 2. Find "devUtils" -> "updateBankLinkStatus"
 * 3. Click "Run Function"
 * 4. Provide itemId (Plaid item ID) and itemStatus ("Healthy", "Error", "Pending", or "Disconnected")
 * 5. Click "Run"
 *
 * Example:
 * - itemId: "your-plaid-item-id"
 * - itemStatus: "Error" (will trigger email notification)
 * - itemStatus: "Pending" (will trigger email notification)
 * - itemStatus: "Disconnected" (will trigger email notification)
 * - itemStatus: "Healthy" (will NOT trigger email notification)
 */
export const updateBankLinkStatus = internalMutation({
  args: {
    itemId: v.string(),
    itemStatus: v.union(v.literal('Healthy'), v.literal('Error'), v.literal('Pending'), v.literal('Disconnected')),
  },
  handler: async (ctx, { itemId, itemStatus }) => {
    // CRITICAL: Only allow in development
    if (!isDev()) {
      throw new ConvexError('This mutation can only be run in development mode');
    }

    // Call the internal mutation to update status (this will trigger notifications if needed)
    await ctx.runMutation(internal.internal.bankLinks.updateBankLinkStatus, {
      itemId,
      itemStatus,
    });

    return {
      success: true,
      message: `Bank link status updated to ${itemStatus}`,
      itemId,
      itemStatus,
      note:
        itemStatus !== 'Healthy'
          ? 'Email notifications will be sent to all workspace members. Check logs for email sending status.'
          : 'No email notifications sent for Healthy status.',
    };
  },
});

// ============================================================================
// BUDGET VALIDATION UTILITIES
// ============================================================================

/**
 * Validation report types
 */
type BankAccountDiscrepancy = {
  bankAccountId: Id<'bankAccount'>;
  accountName: string;
  storedBalance: bigint;
  calculatedBalance: bigint;
  difference: bigint;
  transactionCount: number;
};

type CategorySpendingDiscrepancy = {
  categoryId: Id<'category'>;
  categoryName: string;
  yearMonth: number;
  field: 'inflowAmount' | 'outflowAmount';
  stored: bigint;
  calculated: bigint;
  difference: bigint;
};

type CreditCategorySpendingDiscrepancy = {
  categoryId: Id<'category'>;
  categoryName: string;
  bankAccountId: Id<'bankAccount'>;
  yearMonth: number;
  field: 'spendingAmount' | 'paymentsAmount' | 'priorBalance';
  stored: bigint;
  calculated: bigint;
  difference: bigint;
};

type RTADiscrepancy = {
  stored: bigint;
  calculated: bigint;
  difference: bigint;
  breakdown: {
    uncategorizedInflows: bigint;
    uncategorizedOutflows: bigint;
    budgetAssignments: bigint;
    netUncategorized: bigint;
  };
};

type TransactionIntegrityIssue = {
  transactionId: Id<'transaction'>;
  type: 'movement_sum_mismatch' | 'orphaned_movement' | 'broken_transfer_pair' | 'missing_transfer_pair';
  details: string;
  transactionAmount?: bigint;
  movementSum?: bigint;
};

type ValidationReport = {
  workspaceId: Id<'workspace'>;
  timestamp: string;
  isValid: boolean;
  bankAccounts: {
    isValid: boolean;
    discrepancies: BankAccountDiscrepancy[];
    totalChecked: number;
  };
  categorySpending: {
    isValid: boolean;
    discrepancies: CategorySpendingDiscrepancy[];
    totalChecked: number;
  };
  creditCategorySpending: {
    isValid: boolean;
    discrepancies: CreditCategorySpendingDiscrepancy[];
    totalChecked: number;
  };
  readyToAssign: {
    isValid: boolean;
    discrepancy?: RTADiscrepancy;
  };
  transactionIntegrity: {
    isValid: boolean;
    issues: TransactionIntegrityIssue[];
    totalChecked: number;
  };
  summary: {
    totalIssuesFound: number;
    categoriesWithIssues: string[];
  };
};

/**
 * Validate that bank account balances match the sum of their transactions
 */
export const validateBankAccountBalances = internalQuery({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }) => {
    const discrepancies: BankAccountDiscrepancy[] = [];

    // Get all bank accounts for this workspace
    const bankAccounts = await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .collect();

    for (const account of bankAccounts) {
      // Sum all transactions for this account (calculate amounts from movements)
      const transactions = await ctx.db
        .query('transaction')
        .withIndex('by_bankAccountId', (q) => q.eq('bankAccountId', account._id))
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .collect();

      // Calculate balance from embedded movements for each transaction
      let calculatedBalance = BigInt(0);
      for (const tx of transactions) {
        // Use totalAmount if available, otherwise sum embedded movements
        const txAmount = tx.totalAmount ?? tx.movements?.reduce((sum, m) => sum + m.amount, 0n) ?? 0n;
        calculatedBalance += txAmount;
      }

      const storedBalance = account.currentBalance;

      // Check for discrepancy
      if (calculatedBalance !== storedBalance) {
        discrepancies.push({
          bankAccountId: account._id,
          accountName: account.name,
          storedBalance,
          calculatedBalance,
          difference: storedBalance - calculatedBalance,
          transactionCount: transactions.length,
        });
      }
    }

    return {
      isValid: discrepancies.length === 0,
      discrepancies,
      totalChecked: bankAccounts.length,
    };
  },
});

/**
 * Validate that categorySpending records match calculated values from transaction movements
 */
export const validateCategorySpending = internalQuery({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }) => {
    const discrepancies: CategorySpendingDiscrepancy[] = [];

    // Get all categories for this workspace
    const categories = await ctx.db
      .query('category')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.neq(q.field('categoryType'), 'credit_card'))
      .collect();

    // Create a map to store calculated values
    type SpendingKey = `${string}_${number}`; // categoryId_yearMonth
    const calculatedSpending = new Map<
      SpendingKey,
      {
        inflowAmount: bigint;
        outflowAmount: bigint;
      }
    >();

    // Get all transactions for this workspace first
    const transactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Process embedded movements from transactions
    for (const transaction of transactions) {
      const yearMonth = dateToYearMonth(transaction.date);

      for (const movement of transaction.movements ?? []) {
        if (!movement.categoryId) continue;

        const key: SpendingKey = `${movement.categoryId}_${yearMonth}`;

        // Initialize if not exists
        if (!calculatedSpending.has(key)) {
          calculatedSpending.set(key, {
            inflowAmount: BigInt(0),
            outflowAmount: BigInt(0),
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

    // Now compare with stored category.monthlySpending (no longer a separate table)
    let totalChecked = 0;

    for (const category of categories) {
      // monthlySpending is now stored directly on category
      const monthlySpending = category.monthlySpending ?? {};

      // If no stored monthlySpending - check if there are calculated values
      if (Object.keys(monthlySpending).length === 0) {
        for (const [key, calc] of calculatedSpending.entries()) {
          const [catIdStr, yearMonthStr] = key.split('_');
          if (catIdStr === category._id) {
            totalChecked++;
            const yearMonth = parseInt(yearMonthStr);
            // Report as discrepancies (stored = 0, calculated = actual value)
            const fields: Array<keyof typeof calc> = ['inflowAmount', 'outflowAmount'];
            for (const field of fields) {
              if (calc[field] !== BigInt(0)) {
                discrepancies.push({
                  categoryId: category._id,
                  categoryName: category.name,
                  yearMonth,
                  field,
                  stored: BigInt(0),
                  calculated: calc[field],
                  difference: BigInt(0) - calc[field],
                });
              }
            }
            calculatedSpending.delete(key);
          }
        }
        continue;
      }

      // Iterate over monthlySpending map entries
      for (const [yearMonthStr, stored] of Object.entries(monthlySpending)) {
        totalChecked++;
        const yearMonth = parseInt(yearMonthStr, 10);
        const key: SpendingKey = `${category._id}_${yearMonth}`;
        const calculated = calculatedSpending.get(key);

        // If we have no calculated data but there's a stored record, it should be all zeros
        const calc = calculated ?? {
          inflowAmount: BigInt(0),
          outflowAmount: BigInt(0),
        };

        // Check each field
        const fields: Array<keyof typeof calc> = ['inflowAmount', 'outflowAmount'];

        for (const field of fields) {
          const storedValue = stored[field] ?? BigInt(0);
          if (storedValue !== calc[field]) {
            discrepancies.push({
              categoryId: category._id,
              categoryName: category.name,
              yearMonth,
              field,
              stored: storedValue,
              calculated: calc[field],
              difference: storedValue - calc[field],
            });
          }
        }

        // Remove from map so we can detect missing records
        calculatedSpending.delete(key);
      }
    }

    // Any remaining entries in calculatedSpending are missing from the database
    for (const [key, calc] of calculatedSpending.entries()) {
      const [categoryIdStr, yearMonthStr] = key.split('_');
      const categoryId = categoryIdStr as Id<'category'>;
      const yearMonth = parseInt(yearMonthStr);
      const category = categories.find((c) => c._id === categoryId);

      if (!category) continue;

      totalChecked++;

      // Report as discrepancies (stored = 0, calculated = actual value)
      const fields: Array<keyof typeof calc> = ['inflowAmount', 'outflowAmount'];

      for (const field of fields) {
        if (calc[field] !== BigInt(0)) {
          discrepancies.push({
            categoryId,
            categoryName: category.name,
            yearMonth,
            field,
            stored: BigInt(0),
            calculated: calc[field],
            difference: BigInt(0) - calc[field],
          });
        }
      }
    }

    return {
      isValid: discrepancies.length === 0,
      discrepancies,
      totalChecked,
    };
  },
});

/**
 * Validate that category.creditMonthlySpending records match calculated values
 */
export const validateCreditCategorySpending = internalQuery({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }) => {
    const discrepancies: CreditCategorySpendingDiscrepancy[] = [];

    // Get all credit card categories for this workspace
    const creditCardCategories = await ctx.db
      .query('category')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('categoryType'), 'credit_card'))
      .collect();

    // Create a map to store calculated values
    type CreditSpendingKey = `${string}_${string}_${number}`; // categoryId_bankAccountId_yearMonth
    const calculatedSpending = new Map<
      CreditSpendingKey,
      {
        spendingAmount: bigint;
        paymentsAmount: bigint;
      }
    >();

    // Step 1: Calculate spending from embedded movements with creditCardTransfer
    // Get all transactions first
    const allTransactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Process embedded movements from transactions
    for (const transaction of allTransactions) {
      const yearMonth = dateToYearMonth(transaction.date);

      for (const movement of transaction.movements ?? []) {
        // Skip movements without credit card transfer metadata
        if (!movement.creditCardTransfer) continue;

        const { creditCardCategoryId } = movement.creditCardTransfer;
        const key: CreditSpendingKey = `${creditCardCategoryId}_${transaction.bankAccountId}_${yearMonth}`;

        // Initialize if not exists
        if (!calculatedSpending.has(key)) {
          calculatedSpending.set(key, {
            spendingAmount: BigInt(0),
            paymentsAmount: BigInt(0),
          });
        }

        const spending = calculatedSpending.get(key)!;

        // spendingAmount should be negative (it's spending/charges)
        spending.spendingAmount += movement.amount;
      }
    }

    // Step 2: Calculate payments from transfers TO credit card accounts
    const transactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('type'), 'transfer'))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    for (const transaction of transactions) {
      // Check if this is a transfer TO a credit card account
      const bankAccount = await ctx.db.get(transaction.bankAccountId);
      if (!bankAccount) continue;

      const isCreditCard = bankAccount.accountType.startsWith('credit_') || bankAccount.accountType.startsWith('loan_');

      if (!isCreditCard) continue;

      // Find the credit card category for this account
      const creditCardCategory = creditCardCategories.find((c) => c.bankAccountId === bankAccount._id);
      if (!creditCardCategory) continue;

      // Calculate transaction amount from embedded movements
      const transactionAmount =
        transaction.totalAmount ?? transaction.movements?.reduce((sum, m) => sum + m.amount, 0n) ?? 0n;

      // Only count positive amounts (transfers TO the credit card)
      if (transactionAmount <= 0) continue;

      const yearMonth = dateToYearMonth(transaction.date);
      const key: CreditSpendingKey = `${creditCardCategory._id}_${bankAccount._id}_${yearMonth}`;

      // Initialize if not exists
      if (!calculatedSpending.has(key)) {
        calculatedSpending.set(key, {
          spendingAmount: BigInt(0),
          paymentsAmount: BigInt(0),
        });
      }

      const spending = calculatedSpending.get(key)!;
      spending.paymentsAmount += transactionAmount;
    }

    // Step 3: Compare with stored category.creditMonthlySpending
    let totalChecked = 0;

    for (const category of creditCardCategories) {
      // Read creditMonthlySpending directly from category (no longer a separate table)
      const creditMonthlySpending = category.creditMonthlySpending ?? {};

      if (Object.keys(creditMonthlySpending).length === 0) {
        // No stored data - check if there are calculated values
        for (const [key, calc] of calculatedSpending.entries()) {
          const [catIdStr, bankAccountIdStr, yearMonthStr] = key.split('_');
          if (catIdStr === category._id) {
            totalChecked++;
            const yearMonth = parseInt(yearMonthStr);
            // Report as discrepancies (stored = 0, calculated = actual value)
            if (calc.spendingAmount !== BigInt(0)) {
              discrepancies.push({
                categoryId: category._id,
                categoryName: category.name,
                bankAccountId: bankAccountIdStr as Id<'bankAccount'>,
                yearMonth,
                field: 'spendingAmount',
                stored: BigInt(0),
                calculated: calc.spendingAmount,
                difference: BigInt(0) - calc.spendingAmount,
              });
            }
            if (calc.paymentsAmount !== BigInt(0)) {
              discrepancies.push({
                categoryId: category._id,
                categoryName: category.name,
                bankAccountId: bankAccountIdStr as Id<'bankAccount'>,
                yearMonth,
                field: 'paymentsAmount',
                stored: BigInt(0),
                calculated: calc.paymentsAmount,
                difference: BigInt(0) - calc.paymentsAmount,
              });
            }
            calculatedSpending.delete(key);
          }
        }
        continue;
      }

      // Get the bank account ID from the category
      const bankAccountId = category.bankAccountId;
      if (!bankAccountId) continue;

      // Iterate over creditMonthlySpending map entries
      for (const [yearMonthStr, stored] of Object.entries(creditMonthlySpending)) {
        totalChecked++;
        const yearMonth = parseInt(yearMonthStr, 10);
        const key: CreditSpendingKey = `${category._id}_${bankAccountId}_${yearMonth}`;
        const calculated = calculatedSpending.get(key);

        // If we have no calculated data, it should be zeros
        const calc = calculated ?? {
          spendingAmount: BigInt(0),
          paymentsAmount: BigInt(0),
        };

        // Check spendingAmount
        if (stored.spendingAmount !== calc.spendingAmount) {
          discrepancies.push({
            categoryId: category._id,
            categoryName: category.name,
            bankAccountId,
            yearMonth,
            field: 'spendingAmount',
            stored: stored.spendingAmount,
            calculated: calc.spendingAmount,
            difference: stored.spendingAmount - calc.spendingAmount,
          });
        }

        // Check paymentsAmount
        if (stored.paymentsAmount !== calc.paymentsAmount) {
          discrepancies.push({
            categoryId: category._id,
            categoryName: category.name,
            bankAccountId,
            yearMonth,
            field: 'paymentsAmount',
            stored: stored.paymentsAmount,
            calculated: calc.paymentsAmount,
            difference: stored.paymentsAmount - calc.paymentsAmount,
          });
        }

        // Check priorBalance
        // PriorBalance should only be set in the month when the credit card account
        // was created with a starting balance (type = "starting_balance")
        // For all other months, it should be 0
        const expectedPriorBalance = BigInt(0); // Most months should have 0
        // Note: We'd need to check if there's a starting_balance transaction in this month
        // to properly validate priorBalance, but that requires additional queries
        // For now, we just check if priorBalance matches what's stored
        const storedPriorBalance = stored.priorBalance ?? BigInt(0);

        // Validate priorBalance is set correctly
        // A non-zero priorBalance should only exist in one specific month (account creation)
        // We can at least validate that if it's non-zero, we can verify it
        if (storedPriorBalance !== BigInt(0)) {
          // Check if there's a starting_balance transaction for this account in this month
          const startingBalanceTx = await ctx.db
            .query('transaction')
            .withIndex('by_bankAccountId', (q) => q.eq('bankAccountId', bankAccountId))
            .filter((q) => q.and(q.eq(q.field('type'), 'starting_balance'), q.eq(q.field('isDeleted'), false)))
            .first();

          if (startingBalanceTx) {
            const txYearMonth = dateToYearMonth(startingBalanceTx.date);
            if (txYearMonth === yearMonth) {
              // This month should have priorBalance = starting balance amount
              // Calculate amount from embedded movements
              const expectedBalance =
                startingBalanceTx.totalAmount ??
                startingBalanceTx.movements?.reduce((sum, m) => sum + m.amount, 0n) ??
                0n;
              if (storedPriorBalance !== expectedBalance) {
                discrepancies.push({
                  categoryId: category._id,
                  categoryName: category.name,
                  bankAccountId,
                  yearMonth,
                  field: 'priorBalance',
                  stored: storedPriorBalance,
                  calculated: expectedBalance,
                  difference: storedPriorBalance - expectedBalance,
                });
              }
            } else if (storedPriorBalance !== expectedPriorBalance) {
              // This is NOT the starting month, so priorBalance should be 0
              discrepancies.push({
                categoryId: category._id,
                categoryName: category.name,
                bankAccountId,
                yearMonth,
                field: 'priorBalance',
                stored: storedPriorBalance,
                calculated: expectedPriorBalance,
                difference: storedPriorBalance - expectedPriorBalance,
              });
            }
          }
        }

        // Remove from map so we can detect missing records
        calculatedSpending.delete(key);
      }
    }

    // Any remaining entries are missing from the database
    for (const [key, calc] of calculatedSpending.entries()) {
      const [categoryIdStr, bankAccountIdStr, yearMonthStr] = key.split('_');
      const categoryId = categoryIdStr as Id<'category'>;
      const bankAccountId = bankAccountIdStr as Id<'bankAccount'>;
      const yearMonth = parseInt(yearMonthStr);
      const category = creditCardCategories.find((c) => c._id === categoryId);

      if (!category) continue;

      totalChecked++;

      // Report as discrepancies
      if (calc.spendingAmount !== BigInt(0)) {
        discrepancies.push({
          categoryId,
          categoryName: category.name,
          bankAccountId,
          yearMonth,
          field: 'spendingAmount',
          stored: BigInt(0),
          calculated: calc.spendingAmount,
          difference: BigInt(0) - calc.spendingAmount,
        });
      }

      if (calc.paymentsAmount !== BigInt(0)) {
        discrepancies.push({
          categoryId,
          categoryName: category.name,
          bankAccountId,
          yearMonth,
          field: 'paymentsAmount',
          stored: BigInt(0),
          calculated: calc.paymentsAmount,
          difference: BigInt(0) - calc.paymentsAmount,
        });
      }
    }

    return {
      isValid: discrepancies.length === 0,
      discrepancies,
      totalChecked,
    };
  },
});

/**
 * Validate that workspace readyToAssign matches calculated value
 */
export const validateReadyToAssign = internalQuery({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }) => {
    // Get the workspace
    const workspace = await ctx.db.get(workspaceId);
    if (!workspace) {
      throw new Error('Workspace not found');
    }

    let uncategorizedInflows = BigInt(0);
    let uncategorizedOutflows = BigInt(0);

    // Get all transactions for this workspace first
    const allTransactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Process embedded movements that are ready-to-assign
    for (const transaction of allTransactions) {
      // Get the bank account to check if it's a credit card
      const bankAccount = await ctx.db.get(transaction.bankAccountId);
      if (!bankAccount) continue;

      const isCreditCard =
        bankAccount.accountType?.startsWith('credit_') || bankAccount.accountType?.startsWith('loan_');

      // Skip starting balances on credit cards (they represent debt, not available money)
      if (isCreditCard && transaction.type === 'starting_balance') {
        continue;
      }

      for (const movement of transaction.movements ?? []) {
        // Only process ready-to-assign movements
        if (!movement.readyToAssign) continue;

        if (movement.amount > 0) {
          uncategorizedInflows += movement.amount;
        } else if (movement.amount < 0) {
          uncategorizedOutflows += movement.amount;
        }
      }
    }

    const netUncategorized = uncategorizedInflows + uncategorizedOutflows;

    // Get all budget assignments
    const budgetAssignments = await ctx.db
      .query('categoryBudget')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .collect();

    const totalBudgetAssignments = budgetAssignments.reduce((sum, budget) => {
      const monthlyAmounts = budget.monthlyAssignedAmounts ?? {};
      const categoryTotal = Object.values(monthlyAmounts).reduce((catSum, amount) => catSum + amount, BigInt(0));
      return sum + categoryTotal;
    }, BigInt(0));

    // Calculate expected RTA
    const calculatedRTA = netUncategorized - totalBudgetAssignments;
    const storedRTA = workspace.readyToAssign ?? BigInt(0);

    const isValid = calculatedRTA === storedRTA;

    return {
      isValid,
      discrepancy: isValid
        ? undefined
        : {
            stored: storedRTA,
            calculated: calculatedRTA,
            difference: storedRTA - calculatedRTA,
            breakdown: {
              uncategorizedInflows,
              uncategorizedOutflows,
              budgetAssignments: totalBudgetAssignments,
              netUncategorized,
            },
          },
    };
  },
});

/**
 * Validate transaction integrity (movement sums, transfer pairs, etc.)
 */
export const validateTransactionIntegrity = internalQuery({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }) => {
    const issues: TransactionIntegrityIssue[] = [];

    // Get all transactions for this workspace
    const transactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Check each transaction
    for (const transaction of transactions) {
      // Get embedded movements
      const movements = transaction.movements ?? [];

      // Calculate transaction amount from embedded movements
      const movementSum = movements.reduce((sum, m) => sum + m.amount, 0n);

      // Verify totalAmount matches sum of movements
      if (transaction.totalAmount !== undefined && transaction.totalAmount !== movementSum) {
        issues.push({
          transactionId: transaction._id,
          type: 'movement_sum_mismatch',
          details: `Transaction totalAmount (${transaction.totalAmount}) doesn't match movement sum (${movementSum})`,
          transactionAmount: transaction.totalAmount,
          movementSum,
        });
      }

      // Check that movements exist
      if (movements.length === 0) {
        issues.push({
          transactionId: transaction._id,
          type: 'orphaned_movement',
          details: `Transaction has no embedded movements`,
        });
      }

      // Check transfer pairs
      if (transaction.type === 'transfer') {
        if (!transaction.transferPairId) {
          issues.push({
            transactionId: transaction._id,
            type: 'missing_transfer_pair',
            details: 'Transfer transaction is missing transferPairId',
          });
        } else {
          // Verify the pair exists and is valid
          const pairTransaction = await ctx.db.get(transaction.transferPairId);

          if (!pairTransaction) {
            issues.push({
              transactionId: transaction._id,
              type: 'broken_transfer_pair',
              details: `Transfer pair ${transaction.transferPairId} does not exist`,
            });
          } else {
            // Check that amounts are opposite using embedded movements
            const pairMovementSum =
              pairTransaction.totalAmount ?? pairTransaction.movements?.reduce((sum, m) => sum + m.amount, 0n) ?? 0n;

            if (movementSum !== -pairMovementSum) {
              issues.push({
                transactionId: transaction._id,
                type: 'broken_transfer_pair',
                details: `Transfer pair amounts do not match: ${movementSum} and ${pairMovementSum} (should be opposite)`,
                transactionAmount: movementSum,
                movementSum: pairMovementSum,
              });
            }

            // Check that the pair points back to this transaction
            if (pairTransaction.transferPairId !== transaction._id) {
              issues.push({
                transactionId: transaction._id,
                type: 'broken_transfer_pair',
                details: `Transfer pair does not point back to this transaction`,
              });
            }
          }
        }
      }
    }

    // Note: With embedded movements, orphaned movements are no longer possible
    // since movements are stored directly on the transaction document

    return {
      isValid: issues.length === 0,
      issues,
      totalChecked: transactions.length,
    };
  },
});

/**
 * Main validation function: Validates all budget calculations for a workspace
 *
 * This function performs comprehensive validation of:
 * - Bank account balances
 * - Category spending calculations
 * - Credit card spending calculations
 * - Ready to Assign calculations
 * - Transaction integrity
 *
 * Returns a detailed report of all discrepancies found.
 *
 * Usage in Convex Dashboard:
 * 1. Go to Functions tab
 * 2. Find "devUtils" -> "validateWorkspaceBudgets"
 * 3. Click "Run Function"
 * 4. Provide workspaceId
 * 5. Click "Run"
 *
 * @param workspaceId - The workspace to validate
 * @returns ValidationReport with all findings
 */
export const validateWorkspaceBudgets = internalQuery({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }) => {
    // CRITICAL: Only allow in development
    if (!isDev()) {
      throw new ConvexError('This function can only be run in development mode');
    }

    // Run all validation checks
    const bankAccounts = await ctx.runQuery(internal['devUtils'].validateBankAccountBalances, { workspaceId });

    const categorySpending = await ctx.runQuery(internal['devUtils'].validateCategorySpending, { workspaceId });

    const creditCategorySpending = await ctx.runQuery(internal['devUtils'].validateCreditCategorySpending, {
      workspaceId,
    });

    const readyToAssign = await ctx.runQuery(internal['devUtils'].validateReadyToAssign, { workspaceId });

    const transactionIntegrity = await ctx.runQuery(internal['devUtils'].validateTransactionIntegrity, { workspaceId });

    // Calculate summary
    const totalIssuesFound =
      bankAccounts.discrepancies.length +
      categorySpending.discrepancies.length +
      creditCategorySpending.discrepancies.length +
      (readyToAssign.discrepancy ? 1 : 0) +
      transactionIntegrity.issues.length;

    // Collect all categories with issues
    const categoriesWithIssues = new Set<string>();

    categorySpending.discrepancies.forEach((d: CategorySpendingDiscrepancy) =>
      categoriesWithIssues.add(d.categoryName)
    );
    creditCategorySpending.discrepancies.forEach((d: CreditCategorySpendingDiscrepancy) =>
      categoriesWithIssues.add(d.categoryName)
    );

    const isValid =
      bankAccounts.isValid &&
      categorySpending.isValid &&
      creditCategorySpending.isValid &&
      readyToAssign.isValid &&
      transactionIntegrity.isValid;

    const report: ValidationReport = {
      workspaceId,
      timestamp: new Date().toISOString(),
      isValid,
      bankAccounts,
      categorySpending,
      creditCategorySpending,
      readyToAssign,
      transactionIntegrity,
      summary: {
        totalIssuesFound,
        categoriesWithIssues: Array.from(categoriesWithIssues),
      },
    };

    return report;
  },
});

/**
 * Import global institutions from provided data
 * This function can be run on both dev and prod environments
 *
 * Usage in Convex Dashboard:
 * 1. Go to Functions tab
 * 2. Find "devUtils" -> "importGlobalInstitutions"
 * 3. Click "Run Function"
 * 4. Provide data array with institution objects
 * 5. Click "Run"
 *
 * Example data structure:
 * {
 *   "data": [
 *     {
 *       "institution_id": "ins_123",
 *       "name": "Bank Name",
 *       "logo": "iVBORw0KGgo...", // base64 string (optional)
 *       "primary_color": "#00668f" // optional
 *     }
 *   ]
 * }
 */
export const importGlobalInstitutions = internalAction({
  args: {
    data: v.array(
      v.object({
        // Support both formats:
        // 1. Original format with institution_id
        institution_id: v.optional(v.string()),
        // 2. Convex export format with providerInstitutionId
        providerInstitutionId: v.optional(v.string()),

        // Required field
        name: v.string(),

        // Logo can be base64 (original format) or URL (Convex export format)
        logo: v.optional(v.union(v.string(), v.null())),
        logoUrl: v.optional(v.union(v.string(), v.null())),

        // Color field (both formats)
        primary_color: v.optional(v.string()),
        primaryColor: v.optional(v.string()),

        // Provider field (Convex export format)
        provider: v.optional(v.string()),

        // Fields we accept but ignore (original format)
        idx: v.optional(v.number()),
        created_at: v.optional(v.string()),
        updated_at: v.optional(v.string()),
        id: v.optional(v.string()),

        // Convex system fields we accept but ignore
        _id: v.optional(v.string()),
        _creationTime: v.optional(v.number()),
        isVerified: v.optional(v.boolean()),
        updatedAt: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, { data }) => {
    const results: Array<{
      institution_id: string;
      name: string;
      success: boolean;
      error?: string;
      globalInstitutionId?: string;
    }> = [];

    for (const institution of data) {
      // Support both field name formats
      const institutionId = institution.providerInstitutionId ?? institution.institution_id ?? '';
      const primaryColor = institution.primaryColor ?? institution.primary_color;
      const provider: 'Plaid' = 'Plaid';

      try {
        // Determine logo URL - either use existing URL or convert base64
        let logoUrl: string | undefined;

        // If logoUrl is already provided (Convex export format), use it directly
        if (institution.logoUrl && institution.logoUrl !== null) {
          logoUrl = institution.logoUrl;
        }
        // Otherwise, convert base64 logo to file URL if logo exists (original format)
        else if (institution.logo && institution.logo !== null) {
          try {
            // Extract MIME type from data URL
            const mimeTypeMatch = institution.logo.match(/^data:(image\/\w+);base64,/);
            const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : 'image/png';

            // Clean and validate base64 string
            const base64Data = cleanBase64String(institution.logo);
            if (!base64Data) {
              console.warn(`Invalid or truncated base64 logo for ${institutionId}, skipping logo storage`);
            } else {
              // Convert base64 to binary
              const binaryString = atob(base64Data);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }

              // Create blob and store in Convex storage
              const blob = new Blob([bytes], { type: mimeType });
              const storageId = await ctx.storage.store(blob);

              // Get the storage URL
              logoUrl = (await ctx.storage.getUrl(storageId)) ?? undefined;
            }
          } catch (error: unknown) {
            console.error(`Failed to store institution logo for ${institutionId}:`, error);
            // Continue without logo if storage fails
          }
        }

        // Upsert global institution
        const upsertResult = await ctx.runMutation(internal.globalInstitutions.mutations.upsertGlobalInstitution, {
          providerInstitutionId: institutionId,
          provider,
          name: institution.name,
          logoUrl,
          primaryColor: primaryColor ?? undefined,
        });

        results.push({
          institution_id: institutionId,
          name: institution.name,
          success: true,
          globalInstitutionId: upsertResult.id,
        });
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Failed to import institution ${institutionId}:`, error);

        results.push({
          institution_id: institutionId,
          name: institution.name,
          success: false,
          error: errorMessage,
        });
      }
    }

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return {
      total: data.length,
      successful,
      failed,
      results,
    };
  },
});
