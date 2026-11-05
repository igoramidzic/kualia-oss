/**
 * Main orchestration action for YNAB data import
 */

import { v } from 'convex/values';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { internalAction } from '../_generated/server';
import {
  extractCategories,
  extractCategoryGroups,
  extractMerchantNames,
  filterFutureTransactions,
  groupSplitTransactions,
  parsePlanCSV,
  parseRegisterCSV,
  sanitizeFieldName,
} from './parseCSV';
import type { ImportProgress, ImportResult } from './types';

const TRANSACTION_BATCH_SIZE = 30;
const MERCHANT_BATCH_SIZE = 800;
const PAIR_WRITE_BATCH_SIZE = 100;
const CATEGORY_WRITE_BATCH_SIZE = 50;

/**
 * Main import action - imports all YNAB data into a new workspace
 */
export const importYnabData = internalAction({
  args: {
    userId: v.id('userProfile'),
    planCsvContent: v.string(),
    registerCsvContent: v.string(),
    accountTypeMappings: v.array(
      v.object({
        accountName: v.string(),
        accountType: v.string(),
      })
    ),
    workspaceName: v.optional(v.string()),
    currency: v.optional(v.string()),
    currentDate: v.string(), // User local date in YYYY-MM-DD
  },
  handler: async (ctx, args): Promise<ImportResult> => {
    const { userId, planCsvContent, registerCsvContent, accountTypeMappings, workspaceName, currentDate } = args;
    const currency = args.currency ?? 'USD';

    console.log('Starting YNAB import...');

    // Track workspace ID for cleanup on failure
    let createdWorkspaceId: Id<'workspace'> | null = null;

    try {
      // Get user profile for clerkId
      const userProfile: Doc<'userProfile'> | null = await ctx.runQuery(internal.clerk.queries.getUserById, { userId });

      if (!userProfile) {
        throw new Error('User profile not found');
      }

      // Update status to importing
      await ctx.runMutation(internal.ynab.mutations.upsertYnabImportStatus, {
        userId,
        status: 'importing',
        progress: {
          currentStep: 'Parsing CSV files',
          accountsTotal: 0,
          accountsImported: 0,
          categoriesTotal: 0,
          categoriesImported: 0,
          transactionsTotal: 0,
          transactionsImported: 0,
        },
      });

      // Parse CSVs
      console.log('Parsing CSV files...');
      const registerRows = parseRegisterCSV(registerCsvContent);
      const planRows = parsePlanCSV(planCsvContent);

      // Extract data
      const categoryGroups = extractCategoryGroups(planRows);
      const categories = extractCategories(planRows, currency);
      const allTransactions = groupSplitTransactions(registerRows, currency);
      const transactions = filterFutureTransactions(allTransactions, currentDate);
      const skippedFutureTransactions = allTransactions.length - transactions.length;
      const merchantNames = extractMerchantNames(transactions);

      if (skippedFutureTransactions > 0) {
        console.log(`Skipping ${skippedFutureTransactions} future-dated transaction(s) after ${currentDate}`);
      }

      // Create account type map from user-confirmed mappings
      const accountTypeMap = new Map<string, string>();
      for (const mapping of accountTypeMappings) {
        accountTypeMap.set(mapping.accountName, mapping.accountType);
      }

      // Update progress
      const progress: ImportProgress = {
        currentStep: 'Creating workspace',
        accountsTotal: accountTypeMappings.length,
        accountsImported: 0,
        categoriesTotal: categories.length,
        categoriesImported: 0,
        transactionsTotal: transactions.length,
        transactionsImported: 0,
      };

      await ctx.runMutation(internal.ynab.mutations.updateYnabImportProgress, {
        userId,
        progress,
      });

      // Step 1: Create workspace
      console.log('Creating workspace...');
      const workspaceId = await ctx.runMutation(internal.ynab.mutations.createWorkspaceFromYnab, {
        clerkId: userProfile.clerkId,
        workspaceName: workspaceName ?? 'YNAB Import',
        currency,
      });

      // Track workspace ID for cleanup on failure
      createdWorkspaceId = workspaceId;

      // Step 2: Import bank accounts
      progress.currentStep = 'Importing accounts';
      await ctx.runMutation(internal.ynab.mutations.updateYnabImportProgress, {
        userId,
        progress,
      });

      console.log('Importing bank accounts...');
      const accounts = accountTypeMappings.map((m) => ({
        name: m.accountName,
        accountType: m.accountType,
      }));

      const accountIdMap: Record<string, string> = await ctx.runMutation(internal.ynab.mutations.importBankAccounts, {
        workspaceId,
        accounts,
      });

      progress.accountsImported = accountTypeMappings.length;

      // Step 3: Import category groups
      progress.currentStep = 'Importing category groups';
      await ctx.runMutation(internal.ynab.mutations.updateYnabImportProgress, {
        userId,
        progress,
      });

      console.log('Importing category groups...');
      const groups = categoryGroups.map((g) => ({
        name: g.name,
        type: g.type,
        isHidden: g.isHidden,
      }));

      const groupIdMap: Record<string, string> = await ctx.runMutation(internal.ynab.mutations.importCategoryGroups, {
        workspaceId,
        groups,
      });

      // Step 4: Import categories
      progress.currentStep = 'Importing categories';
      await ctx.runMutation(internal.ynab.mutations.updateYnabImportProgress, {
        userId,
        progress,
      });

      console.log('Importing categories...');
      const categoriesData = categories.map((c) => ({
        name: c.name,
        groupName: c.groupName,
        isArchived: c.isArchived,
      }));

      const categoryIdMap: Record<string, string> = await ctx.runMutation(internal.ynab.mutations.importCategories, {
        workspaceId,
        groupIdMap,
        categories: categoriesData,
      });

      progress.categoriesImported = categories.length;

      // Step 5: Import category budgets
      progress.currentStep = 'Importing budget assignments';
      await ctx.runMutation(internal.ynab.mutations.updateYnabImportProgress, {
        userId,
        progress,
      });

      console.log('Importing category budgets...');
      const budgets = categories
        .filter((c) => Object.keys(c.monthlyAssignments).length > 0)
        .map((c) => ({
          // Use sanitized keys to match the categoryIdMap keys
          categoryKey: `${sanitizeFieldName(c.groupName)}:${sanitizeFieldName(c.name)}`,
          monthlyAssignments: c.monthlyAssignments,
        }));

      await ctx.runMutation(internal.ynab.mutations.importCategoryBudgets, {
        workspaceId,
        categoryIdMap,
        budgets,
      });

      // Step 6: Import merchants in batches to avoid Convex's 1024 field limit
      progress.currentStep = 'Importing merchants';
      await ctx.runMutation(internal.ynab.mutations.updateYnabImportProgress, {
        userId,
        progress,
      });

      console.log(`Importing ${merchantNames.length} merchants in batches of ${MERCHANT_BATCH_SIZE}...`);
      const merchantIdMap: Record<string, string> = {};

      for (let i = 0; i < merchantNames.length; i += MERCHANT_BATCH_SIZE) {
        const batch = merchantNames.slice(i, i + MERCHANT_BATCH_SIZE);
        const batchResult: Record<string, string> = await ctx.runMutation(
          internal.ynab.mutations.importMerchantsBatch,
          {
            workspaceId,
            payeeNames: batch,
          }
        );
        Object.assign(merchantIdMap, batchResult);
      }

      // Step 7: Import transactions in batches
      console.log(`Importing ${transactions.length} transactions in batches of ${TRANSACTION_BATCH_SIZE}...`);

      for (let i = 0; i < transactions.length; i += TRANSACTION_BATCH_SIZE) {
        const batch = transactions.slice(i, i + TRANSACTION_BATCH_SIZE);

        progress.currentStep = `Importing transactions (${Math.min(i + TRANSACTION_BATCH_SIZE, transactions.length)}/${transactions.length})`;
        progress.transactionsImported = i;
        await ctx.runMutation(internal.ynab.mutations.updateYnabImportProgress, {
          userId,
          progress,
        });

        const transactionData = batch.map((txn) => ({
          account: txn.account,
          date: txn.date,
          payee: txn.payee,
          movements: txn.movements.map((m) => ({
            categoryGroup: m.categoryGroup,
            category: m.category,
            amount: m.amount,
            notes: m.notes,
            sortOrder: m.sortOrder,
            isReadyToAssign: m.isReadyToAssign,
          })),
          totalAmount: txn.totalAmount,
          status: txn.status,
          isTransfer: txn.isTransfer,
          transferToAccount: txn.transferToAccount ?? undefined,
        }));

        // Filter merchantIdMap to only include merchants referenced in this batch
        // This avoids Convex's 1024 field limit on the argument object
        const batchPayees = new Set(batch.map((txn) => sanitizeFieldName(txn.payee)));
        const filteredMerchantIdMap: Record<string, string> = {};
        for (const payee of batchPayees) {
          if (merchantIdMap[payee]) {
            filteredMerchantIdMap[payee] = merchantIdMap[payee];
          }
        }

        await ctx.runMutation(internal.ynab.mutations.importTransactionBatch, {
          workspaceId,
          accountIdMap,
          categoryIdMap,
          merchantIdMap: filteredMerchantIdMap,
          transactions: transactionData,
        });
      }

      progress.transactionsImported = transactions.length;

      // Step 8: Link transfer pairs (paginated to avoid read limits)
      progress.currentStep = 'Linking transfer pairs';
      await ctx.runMutation(internal.ynab.mutations.updateYnabImportProgress, {
        userId,
        progress,
      });

      console.log('Linking transfer pairs...');
      const transferPairsLinked = await linkTransferPairsPaginated(ctx, workspaceId);

      // Step 9: Finalize account balances (paginated per account)
      progress.currentStep = 'Calculating account balances';
      await ctx.runMutation(internal.ynab.mutations.updateYnabImportProgress, {
        userId,
        progress,
      });

      console.log('Finalizing account balances...');
      await finalizeAccountBalancesPaginated(ctx, workspaceId);

      // Step 10: Finalize category spending (paginated)
      progress.currentStep = 'Calculating category spending';
      await ctx.runMutation(internal.ynab.mutations.updateYnabImportProgress, {
        userId,
        progress,
      });

      console.log('Finalizing category spending...');
      await finalizeCategorySpendingPaginated(ctx, workspaceId);

      // Step 11: Run fixWorkspace to calculate derived values
      // This calculates pendingBalance/clearedBalance on bank accounts and readyToAssign on workspace
      progress.currentStep = 'Finalizing workspace data';
      await ctx.runMutation(internal.ynab.mutations.updateYnabImportProgress, {
        userId,
        progress,
      });

      console.log('Running fixWorkspace to calculate derived values...');
      await ctx.runMutation(internal.validation.fixes.fixWorkspace, {
        workspaceId,
      });

      // Step 12: Complete import
      progress.currentStep = 'Completing import';
      await ctx.runMutation(internal.ynab.mutations.updateYnabImportProgress, {
        userId,
        progress,
      });

      console.log('Completing import...');
      await ctx.runMutation(internal.ynab.mutations.completeYnabImport, {
        userId,
        workspaceId,
      });

      console.log('YNAB import completed successfully!');

      return {
        success: true,
        workspaceId,
        stats: {
          accounts: accountTypeMappings.length,
          categoryGroups: categoryGroups.length,
          categories: categories.length,
          transactions: transactions.length,
          merchants: merchantNames.length,
          transferPairs: transferPairsLinked,
        },
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during import';

      console.error('YNAB import failed:', errorMessage);

      // Clean up the workspace if it was created
      if (createdWorkspaceId) {
        try {
          await ctx.runMutation(internal.ynab.mutations.deleteYnabImportWorkspace, {
            workspaceId: createdWorkspaceId,
          });
        } catch (cleanupError: unknown) {
          console.error('Failed to clean up workspace after import failure:', cleanupError);
        }
      }

      await ctx.runMutation(internal.ynab.mutations.upsertYnabImportStatus, {
        userId,
        status: 'failed',
        errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  },
});

/**
 * Link transfer pairs using paginated reads to avoid the 4096 read limit.
 * Collects all unlinked transfers in batches, matches pairs in memory, then writes links.
 */
async function linkTransferPairsPaginated(ctx: ActionCtx, workspaceId: Id<'workspace'>): Promise<number> {
  // Collect all unlinked transfers across paginated batches
  const allTransfers: Array<{
    _id: Id<'transaction'>;
    date: string;
    totalAmount: number;
    bankAccountId: Id<'bankAccount'>;
  }> = [];

  let cursor: string | undefined;
  let isDone = false;

  while (!isDone) {
    const batch: {
      transfers: typeof allTransfers;
      continueCursor: string;
      isDone: boolean;
    } = await ctx.runMutation(internal.ynab.mutations.collectTransfersBatch, {
      workspaceId,
      cursor,
    });
    allTransfers.push(...batch.transfers);
    cursor = batch.continueCursor;
    isDone = batch.isDone;
  }

  // Match pairs in memory (same logic as the original linkTransferPairs)
  const pairs: Array<{
    id1: Id<'transaction'>;
    id2: Id<'transaction'>;
    bankAccountId1: Id<'bankAccount'>;
    bankAccountId2: Id<'bankAccount'>;
  }> = [];

  const transfersByDate = new Map<string, typeof allTransfers>();
  for (const t of allTransfers) {
    const group = transfersByDate.get(t.date) ?? [];
    group.push(t);
    transfersByDate.set(t.date, group);
  }

  const linked = new Set<string>();
  for (const dateTransfers of transfersByDate.values()) {
    for (let i = 0; i < dateTransfers.length; i++) {
      const t1 = dateTransfers[i];
      if (linked.has(t1._id)) continue;

      for (let j = i + 1; j < dateTransfers.length; j++) {
        const t2 = dateTransfers[j];
        if (linked.has(t2._id)) continue;

        if (t1.totalAmount === -t2.totalAmount && t1.bankAccountId !== t2.bankAccountId) {
          pairs.push({
            id1: t1._id,
            id2: t2._id,
            bankAccountId1: t1.bankAccountId,
            bankAccountId2: t2.bankAccountId,
          });
          linked.add(t1._id);
          linked.add(t2._id);
          break;
        }
      }
    }
  }

  // Write pair links in batches
  for (let i = 0; i < pairs.length; i += PAIR_WRITE_BATCH_SIZE) {
    await ctx.runMutation(internal.ynab.mutations.writeTransferPairLinks, {
      pairs: pairs.slice(i, i + PAIR_WRITE_BATCH_SIZE),
    });
  }

  console.log(`Linked ${pairs.length} transfer pairs (paginated)`);
  return pairs.length;
}

/**
 * Finalize account balances using paginated reads per account.
 */
async function finalizeAccountBalancesPaginated(ctx: ActionCtx, workspaceId: Id<'workspace'>): Promise<void> {
  const accountIds: Id<'bankAccount'>[] = await ctx.runMutation(internal.ynab.mutations.getWorkspaceBankAccountIds, {
    workspaceId,
  });

  for (const bankAccountId of accountIds) {
    let totalBalance = 0;
    let cursor: string | undefined;
    let isDone = false;

    while (!isDone) {
      const batch: { partialSum: number; continueCursor: string; isDone: boolean } = await ctx.runMutation(
        internal.ynab.mutations.sumAccountTransactionsBatch,
        { bankAccountId, cursor }
      );
      totalBalance += batch.partialSum;
      cursor = batch.continueCursor;
      isDone = batch.isDone;
    }

    await ctx.runMutation(internal.ynab.mutations.writeAccountBalance, {
      bankAccountId,
      balance: BigInt(totalBalance),
    });
  }

  console.log(`Finalized balances for ${accountIds.length} accounts (paginated)`);
}

/**
 * Finalize category spending using paginated reads.
 * Collects spending data in batches, accumulates in memory, then writes per category.
 */
async function finalizeCategorySpendingPaginated(ctx: ActionCtx, workspaceId: Id<'workspace'>): Promise<void> {
  // Accumulate spending across paginated batches
  const spendingMap: Record<string, Record<string, { inflow: number; outflow: number }>> = {};
  let cursor: string | undefined;
  let isDone = false;

  while (!isDone) {
    const batch: {
      spending: typeof spendingMap;
      continueCursor: string;
      isDone: boolean;
    } = await ctx.runMutation(internal.ynab.mutations.collectCategorySpendingBatch, {
      workspaceId,
      cursor,
    });

    // Merge partial spending into accumulated map
    for (const [categoryId, months] of Object.entries(batch.spending)) {
      if (!spendingMap[categoryId]) {
        spendingMap[categoryId] = {};
      }
      for (const [yearMonth, amounts] of Object.entries(months)) {
        if (!spendingMap[categoryId][yearMonth]) {
          spendingMap[categoryId][yearMonth] = { inflow: 0, outflow: 0 };
        }
        spendingMap[categoryId][yearMonth].inflow += amounts.inflow;
        spendingMap[categoryId][yearMonth].outflow += amounts.outflow;
      }
    }

    cursor = batch.continueCursor;
    isDone = batch.isDone;
  }

  // Write spending data in batches of categories
  const categoryEntries = Object.entries(spendingMap);

  for (let i = 0; i < categoryEntries.length; i += CATEGORY_WRITE_BATCH_SIZE) {
    const batch = categoryEntries.slice(i, i + CATEGORY_WRITE_BATCH_SIZE);

    const categories = batch.map(([categoryId, months]) => {
      const monthlySpending: Record<string, { inflowAmount: bigint; outflowAmount: bigint }> = {};
      for (const [yearMonth, amounts] of Object.entries(months)) {
        monthlySpending[yearMonth] = {
          inflowAmount: BigInt(Math.round(amounts.inflow)),
          outflowAmount: BigInt(Math.round(amounts.outflow)),
        };
      }
      return {
        categoryId: categoryId as Id<'category'>,
        monthlySpending,
      };
    });

    await ctx.runMutation(internal.ynab.mutations.writeCategorySpendingBatch, {
      categories,
    });
  }

  console.log(`Finalized spending for ${categoryEntries.length} categories (paginated)`);
}
