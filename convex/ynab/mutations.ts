/**
 * Internal mutations for YNAB data import
 */

import { v } from 'convex/values';
import type { Id } from '../_generated/dataModel';
import { internalMutation, type MutationCtx } from '../_generated/server';
import {
  buildActivityContextForClerkId,
  recordBankAccountActivity,
  recordCategoryActivity,
  recordTransactionActivity,
} from '../activityLogs/helpers';
import type { ActivityContext } from '../activityLogs/types';
import { dateToYearMonth } from '../categoryBudgets/calculations';
import { SORT_ORDER_GAP } from '../categoryGroups/helpers';
import { buildTransactionComputedFields } from '../transactions/helpers';
import { getSystemTransactionTypeFromYnabPayee, sanitizeFieldName } from './parseCSV';
import type { KualiaAccountType } from './types';

async function buildYnabActivityContext(ctx: MutationCtx, workspaceId: Id<'workspace'>): Promise<ActivityContext> {
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace) {
    throw new Error('YNAB import workspace not found');
  }
  return await buildActivityContextForClerkId(ctx, workspace.ownerClerkId, { type: 'kualia_ui' });
}

/**
 * Create or update YNAB import status record
 */
export const upsertYnabImportStatus = internalMutation({
  args: {
    userId: v.id('userProfile'),
    workspaceId: v.optional(v.id('workspace')),
    status: v.union(
      v.literal('pending'),
      v.literal('parsing'),
      v.literal('importing'),
      v.literal('completed'),
      v.literal('failed')
    ),
    errorMessage: v.optional(v.string()),
    progress: v.optional(
      v.object({
        currentStep: v.string(),
        accountsTotal: v.number(),
        accountsImported: v.number(),
        categoriesTotal: v.number(),
        categoriesImported: v.number(),
        transactionsTotal: v.number(),
        transactionsImported: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = new Date().toISOString();

    // Check if a record already exists
    const existing = await ctx.db
      .query('ynabImportStatus')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        workspaceId: args.workspaceId ?? existing.workspaceId,
        status: args.status,
        errorMessage: args.errorMessage,
        progress: args.progress,
        updatedAt: now,
      });
      return existing._id;
    } else {
      const id = await ctx.db.insert('ynabImportStatus', {
        userId: args.userId,
        workspaceId: args.workspaceId,
        status: args.status,
        errorMessage: args.errorMessage,
        progress: args.progress,
        createdAt: now,
        updatedAt: now,
      });
      return id;
    }
  },
});

/**
 * Update import progress
 */
export const updateYnabImportProgress = internalMutation({
  args: {
    userId: v.id('userProfile'),
    progress: v.object({
      currentStep: v.string(),
      accountsTotal: v.number(),
      accountsImported: v.number(),
      categoriesTotal: v.number(),
      categoriesImported: v.number(),
      transactionsTotal: v.number(),
      transactionsImported: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('ynabImportStatus')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        progress: args.progress,
        updatedAt: new Date().toISOString(),
      });
    }
  },
});

/**
 * Create workspace for YNAB import
 */
export const createWorkspaceFromYnab = internalMutation({
  args: {
    clerkId: v.string(),
    workspaceName: v.string(),
    currency: v.string(),
  },
  handler: async (ctx, args) => {
    const { clerkId, workspaceName, currency } = args;

    // Create workspace
    const workspaceId = await ctx.db.insert('workspace', {
      name: workspaceName,
      ownerClerkId: clerkId,
      currency,
      isDeleted: false,
      transactionDefaultPendingStatus: false,
      onboardingCompleted: true, // Skip onboarding for imported workspaces
      updatedAt: new Date().toISOString(),
    });

    console.log(`Created workspace ${workspaceId} for YNAB import`);

    return workspaceId;
  },
});

/**
 * Import bank accounts from YNAB
 * Returns a map of YNAB account name -> Convex account ID
 */
export const importBankAccounts = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    accounts: v.array(
      v.object({
        name: v.string(),
        accountType: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const { workspaceId, accounts } = args;
    const accountIdMap: Record<string, string> = {};
    const activityContext = await buildYnabActivityContext(ctx, workspaceId);

    for (const account of accounts) {
      const accountId = await ctx.db.insert('bankAccount', {
        name: account.name,
        workspaceId,
        accountType: account.accountType as KualiaAccountType,
        currentBalance: BigInt(0), // Will be calculated after transactions
        isClosed: false,
        isDeleted: false,
      });
      const bankAccount = await ctx.db.get(accountId);
      if (bankAccount) {
        await recordBankAccountActivity(ctx, {
          workspaceId,
          context: activityContext,
          type: 'bank_account_created',
          after: bankAccount,
        });
      }

      // Use sanitized key for the map (account names can have special characters)
      accountIdMap[sanitizeFieldName(account.name)] = accountId;
    }

    console.log(`Imported ${accounts.length} bank accounts`);

    return accountIdMap;
  },
});

/**
 * Import category groups from YNAB
 * Returns a map of YNAB group name -> Convex group ID
 */
export const importCategoryGroups = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    groups: v.array(
      v.object({
        name: v.string(),
        type: v.union(v.literal('expense'), v.literal('credit_card')),
        isHidden: v.boolean(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const { workspaceId, groups } = args;
    const groupIdMap: Record<string, string> = {};

    let sortOrder = SORT_ORDER_GAP;

    for (const group of groups) {
      const groupId = await ctx.db.insert('categoryGroup', {
        name: group.name,
        type: group.type,
        workspaceId,
        isSystemGroup: false,
        sortOrder,
        isDeleted: false,
      });

      // Use sanitized key for the map (group names can have special characters)
      groupIdMap[sanitizeFieldName(group.name)] = groupId;
      sortOrder += SORT_ORDER_GAP;
    }

    console.log(`Imported ${groups.length} category groups`);

    return groupIdMap;
  },
});

/**
 * Import categories from YNAB
 * Returns a map of "groupName:categoryName" -> Convex category ID
 */
export const importCategories = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    groupIdMap: v.record(v.string(), v.string()),
    categories: v.array(
      v.object({
        name: v.string(),
        groupName: v.string(),
        isArchived: v.boolean(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const { workspaceId, groupIdMap, categories } = args;
    const categoryIdMap: Record<string, string> = {};
    const activityContext = await buildYnabActivityContext(ctx, workspaceId);

    // Track sort order per group (use sanitized keys)
    const groupSortOrders: Record<string, number> = {};

    for (const category of categories) {
      // Use sanitized key to look up the group
      const sanitizedGroupName = sanitizeFieldName(category.groupName);
      const groupId = groupIdMap[sanitizedGroupName];

      if (!groupId) {
        console.warn(`Category group not found: ${category.groupName}`);
        continue;
      }

      // Get next sort order for this group
      const sortOrder = groupSortOrders[sanitizedGroupName] ?? SORT_ORDER_GAP;
      groupSortOrders[sanitizedGroupName] = sortOrder + SORT_ORDER_GAP;

      const categoryId = await ctx.db.insert('category', {
        name: category.name,
        workspaceId,
        categoryGroupId: groupId as Id<'categoryGroup'>,
        sortOrder,
        isDeleted: false,
        isArchived: category.isArchived,
        categoryType: 'custom',
      });
      const createdCategory = await ctx.db.get(categoryId);
      if (createdCategory) {
        await recordCategoryActivity(ctx, {
          workspaceId,
          context: activityContext,
          type: 'category_created',
          after: createdCategory,
        });
      }

      // Use sanitized key for the map (category names can have emojis/special chars)
      const key = `${sanitizeFieldName(category.groupName)}:${sanitizeFieldName(category.name)}`;
      categoryIdMap[key] = categoryId;
    }

    console.log(`Imported ${categories.length} categories`);

    return categoryIdMap;
  },
});

/**
 * Import category budgets (monthly assignments) from YNAB
 */
export const importCategoryBudgets = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryIdMap: v.record(v.string(), v.string()),
    budgets: v.array(
      v.object({
        categoryKey: v.string(), // "groupName:categoryName"
        monthlyAssignments: v.record(v.string(), v.number()), // yearMonth -> workspace currency base units
      })
    ),
  },
  handler: async (ctx, args) => {
    const { workspaceId, categoryIdMap, budgets } = args;
    const now = new Date().toISOString();
    let count = 0;

    for (const budget of budgets) {
      const categoryId = categoryIdMap[budget.categoryKey];

      if (!categoryId) {
        continue;
      }

      // Only create budget if there are non-zero assignments
      const hasAssignments = Object.values(budget.monthlyAssignments).some((v) => v !== 0);

      if (!hasAssignments) {
        continue;
      }

      // Convert to bigint
      const monthlyAssignedAmounts: Record<string, bigint> = {};
      for (const [yearMonth, amount] of Object.entries(budget.monthlyAssignments)) {
        if (amount !== 0) {
          monthlyAssignedAmounts[yearMonth] = BigInt(amount);
        }
      }

      await ctx.db.insert('categoryBudget', {
        categoryId: categoryId as Id<'category'>,
        workspaceId,
        monthlyAssignedAmounts,
        updatedAt: now,
      });

      count++;
    }

    console.log(`Imported ${count} category budgets`);

    return count;
  },
});

/**
 * Import merchants from YNAB payee names
 * Returns a map of payee name -> Convex merchant ID
 *
 * @deprecated Use importMerchantsBatch instead to avoid Convex field limits
 */
export const importMerchants = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    payeeNames: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const { workspaceId, payeeNames } = args;
    const merchantIdMap: Record<string, string> = {};
    const now = new Date().toISOString();

    for (const name of payeeNames) {
      const merchantId = await ctx.db.insert('merchant', {
        name,
        workspaceId,
        isDeleted: false,
        updatedAt: now,
      });

      // Use sanitized key for the map (payee names can have special characters)
      merchantIdMap[sanitizeFieldName(name)] = merchantId;
    }

    console.log(`Imported ${payeeNames.length} merchants`);

    return merchantIdMap;
  },
});

/**
 * Import a batch of merchants from YNAB payee names
 * Returns a map of payee name -> Convex merchant ID
 *
 * Use this function instead of importMerchants to avoid Convex's 1024 field limit
 * by processing merchants in batches of 800 or fewer.
 */
export const importMerchantsBatch = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    payeeNames: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const { workspaceId, payeeNames } = args;
    const merchantIdMap: Record<string, string> = {};
    const now = new Date().toISOString();

    for (const name of payeeNames) {
      const merchantId = await ctx.db.insert('merchant', {
        name,
        workspaceId,
        isDeleted: false,
        updatedAt: now,
      });

      // Use sanitized key for the map (payee names can have special characters)
      merchantIdMap[sanitizeFieldName(name)] = merchantId;
    }

    console.log(`Imported ${payeeNames.length} merchants in batch`);

    return merchantIdMap;
  },
});

/**
 * Import a batch of transactions from YNAB
 */
export const importTransactionBatch = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    accountIdMap: v.record(v.string(), v.string()),
    categoryIdMap: v.record(v.string(), v.string()),
    merchantIdMap: v.record(v.string(), v.string()),
    transactions: v.array(
      v.object({
        account: v.string(),
        date: v.string(), // ISO format
        payee: v.string(),
        movements: v.array(
          v.object({
            categoryGroup: v.string(),
            category: v.string(),
            amount: v.number(), // workspace currency base units, signed
            notes: v.string(),
            sortOrder: v.number(),
            isReadyToAssign: v.boolean(),
          })
        ),
        totalAmount: v.number(), // workspace currency base units
        status: v.union(v.literal('pending'), v.literal('cleared'), v.literal('reconciled')),
        isTransfer: v.boolean(),
        transferToAccount: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const { workspaceId, accountIdMap, categoryIdMap, merchantIdMap, transactions } = args;
    const now = new Date().toISOString();
    let count = 0;
    const activityContext = await buildYnabActivityContext(ctx, workspaceId);

    for (const txn of transactions) {
      // Use sanitized keys for lookups
      const bankAccountId = accountIdMap[sanitizeFieldName(txn.account)];

      if (!bankAccountId) {
        console.warn(`Bank account not found: ${txn.account}`);
        continue;
      }

      const systemType = getSystemTransactionTypeFromYnabPayee(txn.payee);
      const transactionType: 'regular' | 'transfer' | 'starting_balance' | 'balance_adjustment' = txn.isTransfer
        ? 'transfer'
        : (systemType ?? 'regular');

      // Only regular transactions should have merchant IDs
      const merchantId = transactionType === 'regular' ? merchantIdMap[sanitizeFieldName(txn.payee)] : undefined;

      // Build movements
      const movementsInput = txn.movements.map((m) => {
        // Use sanitized keys for category lookup
        const categoryKey =
          m.categoryGroup && m.category ? `${sanitizeFieldName(m.categoryGroup)}:${sanitizeFieldName(m.category)}` : '';
        const categoryId = categoryKey ? categoryIdMap[categoryKey] : undefined;

        return {
          categoryId: categoryId ? (categoryId as Id<'category'>) : undefined,
          readyToAssign: m.isReadyToAssign,
          amount: BigInt(m.amount),
          notes: m.notes || undefined,
          sortOrder: m.sortOrder,
        };
      });

      // Build computed fields
      const computedFields = await buildTransactionComputedFields(ctx, {
        merchantId: merchantId ? (merchantId as Id<'merchant'>) : undefined,
        bankAccountId: bankAccountId as Id<'bankAccount'>,
        transactionType,
        movements: movementsInput,
      });

      // Create transaction
      const transactionId = await ctx.db.insert('transaction', {
        bankAccountId: bankAccountId as Id<'bankAccount'>,
        type: transactionType,
        date: txn.date,
        workspaceId,
        merchantId: merchantId ? (merchantId as Id<'merchant'>) : undefined,
        notes: undefined,
        isDeleted: false,
        status: txn.status,
        source: 'manual',
        reviewStatus: 'reviewed',
        dateYearMonth: dateToYearMonth(txn.date),
        movements: computedFields.movements,
        searchText: computedFields.searchText,
        totalAmount: computedFields.totalAmount,
        hasUncategorized: computedFields.hasUncategorized,
        hasMissingPayee: computedFields.hasMissingPayee,
        updatedAt: now,
      });
      const createdTransaction = await ctx.db.get(transactionId);
      if (createdTransaction) {
        await recordTransactionActivity(ctx, {
          workspaceId,
          context: activityContext,
          type: 'transaction_created',
          after: createdTransaction,
        });
      }

      count++;
    }

    console.log(`Imported ${count} transactions in batch`);

    return count;
  },
});

/**
 * Link transfer pairs after all transactions are imported
 * Finds matching transfers and links them together
 *
 * @deprecated Use collectTransfersBatch + writeTransferPairLinks from the action instead
 */
export const linkTransferPairs = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, args) => {
    const { workspaceId } = args;

    // Get all transfer transactions
    const transfers = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('type'), 'transfer'))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    let linkedCount = 0;

    // Group by date for matching
    const transfersByDate = new Map<string, typeof transfers>();

    for (const t of transfers) {
      const existing = transfersByDate.get(t.date) ?? [];
      existing.push(t);
      transfersByDate.set(t.date, existing);
    }

    // Find pairs within each date group
    for (const dateTransfers of transfersByDate.values()) {
      for (let i = 0; i < dateTransfers.length; i++) {
        const t1 = dateTransfers[i];

        // Skip if already linked
        if (t1.transferPairId) {
          continue;
        }

        // Find matching counterpart (opposite amount, different account)
        for (let j = i + 1; j < dateTransfers.length; j++) {
          const t2 = dateTransfers[j];

          // Skip if already linked
          if (t2.transferPairId) {
            continue;
          }

          // Check if amounts are opposite and accounts are different
          if (t1.totalAmount === -t2.totalAmount && t1.bankAccountId !== t2.bankAccountId) {
            // Link them together
            await ctx.db.patch(t1._id, {
              transferPairId: t2._id,
              transferPairBankAccountId: t2.bankAccountId,
            });

            await ctx.db.patch(t2._id, {
              transferPairId: t1._id,
              transferPairBankAccountId: t1.bankAccountId,
            });

            linkedCount++;
            break;
          }
        }
      }
    }

    console.log(`Linked ${linkedCount} transfer pairs`);

    return linkedCount;
  },
});

// Batch size for paginated queries (well under 4096 read limit)
const PAGINATE_BATCH_SIZE = 500;

/**
 * Collect a batch of unlinked transfer transactions for pair matching.
 * Returns minimal transfer data and a cursor for the next batch.
 */
export const collectTransfersBatch = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .paginate({
        numItems: PAGINATE_BATCH_SIZE,
        cursor: args.cursor ?? null,
      });

    const transfers = results.page
      .filter((t) => t.type === 'transfer' && !t.isDeleted && !t.transferPairId)
      .map((t) => ({
        _id: t._id,
        date: t.date,
        totalAmount: Number(t.totalAmount),
        bankAccountId: t.bankAccountId,
      }));

    return {
      transfers,
      continueCursor: results.continueCursor,
      isDone: results.isDone,
    };
  },
});

/**
 * Write transfer pair links in a batch.
 */
export const writeTransferPairLinks = internalMutation({
  args: {
    pairs: v.array(
      v.object({
        id1: v.id('transaction'),
        id2: v.id('transaction'),
        bankAccountId1: v.id('bankAccount'),
        bankAccountId2: v.id('bankAccount'),
      })
    ),
  },
  handler: async (ctx, args) => {
    for (const pair of args.pairs) {
      await ctx.db.patch(pair.id1, {
        transferPairId: pair.id2,
        transferPairBankAccountId: pair.bankAccountId2,
      });
      await ctx.db.patch(pair.id2, {
        transferPairId: pair.id1,
        transferPairBankAccountId: pair.bankAccountId1,
      });
    }
    return args.pairs.length;
  },
});

/**
 * Calculate and update account balances after import
 *
 * @deprecated Use getWorkspaceBankAccountIds + sumAccountTransactionsBatch + writeAccountBalance instead
 */
export const finalizeAccountBalances = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, args) => {
    const { workspaceId } = args;

    // Get all bank accounts
    const accounts = await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    for (const account of accounts) {
      // Get all transactions for this account
      const transactions = await ctx.db
        .query('transaction')
        .withIndex('by_bankAccountId', (q) => q.eq('bankAccountId', account._id))
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .collect();

      // Sum up all transaction amounts
      let balance = BigInt(0);
      for (const txn of transactions) {
        balance += txn.totalAmount;
      }

      // Update account balance
      await ctx.db.patch(account._id, {
        currentBalance: balance,
        updatedAt: new Date().toISOString(),
      });
    }

    console.log(`Finalized balances for ${accounts.length} accounts`);

    return accounts.length;
  },
});

/**
 * Get all bank account IDs for a workspace.
 */
export const getWorkspaceBankAccountIds = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, args) => {
    const accounts = await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .collect();

    return accounts.filter((a) => !a.isDeleted).map((a) => a._id);
  },
});

/**
 * Sum transactions for a single bank account in a paginated batch.
 * Returns partial sum and cursor for next batch.
 */
export const sumAccountTransactionsBatch = internalMutation({
  args: {
    bankAccountId: v.id('bankAccount'),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query('transaction')
      .withIndex('by_bankAccountId', (q) => q.eq('bankAccountId', args.bankAccountId))
      .paginate({
        numItems: PAGINATE_BATCH_SIZE,
        cursor: args.cursor ?? null,
      });

    let partialSum = 0;
    for (const txn of results.page) {
      if (!txn.isDeleted) {
        partialSum += Number(txn.totalAmount);
      }
    }

    return {
      partialSum,
      continueCursor: results.continueCursor,
      isDone: results.isDone,
    };
  },
});

/**
 * Write the calculated balance for a single bank account.
 */
export const writeAccountBalance = internalMutation({
  args: {
    bankAccountId: v.id('bankAccount'),
    balance: v.int64(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.bankAccountId, {
      currentBalance: args.balance,
      updatedAt: new Date().toISOString(),
    });
  },
});

/**
 * Update category spending after import
 *
 * @deprecated Use collectCategorySpendingBatch + writeCategorySpendingBatch instead
 */
export const finalizeCategorySpending = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, args) => {
    const { workspaceId } = args;

    // Get all transactions with categories
    const transactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Build spending map: categoryId -> yearMonth -> { inflow, outflow }
    const spendingMap = new Map<string, Map<string, { inflow: bigint; outflow: bigint }>>();

    for (const txn of transactions) {
      const yearMonth = String(txn.dateYearMonth);

      for (const movement of txn.movements) {
        if (!movement.categoryId || movement.readyToAssign) {
          continue;
        }

        const categoryId = movement.categoryId as string;

        if (!spendingMap.has(categoryId)) {
          spendingMap.set(categoryId, new Map());
        }

        const categorySpending = spendingMap.get(categoryId)!;

        if (!categorySpending.has(yearMonth)) {
          categorySpending.set(yearMonth, { inflow: BigInt(0), outflow: BigInt(0) });
        }

        const monthSpending = categorySpending.get(yearMonth)!;

        if (movement.amount > 0) {
          monthSpending.inflow += movement.amount;
        } else {
          monthSpending.outflow += -movement.amount; // Store as positive
        }
      }
    }

    // Update each category
    for (const [categoryId, monthlySpending] of spendingMap) {
      const category = await ctx.db.get(categoryId as Id<'category'>);

      if (!category) {
        continue;
      }

      const monthlySpendingRecord: Record<string, { inflowAmount: bigint; outflowAmount: bigint }> = {};

      for (const [yearMonth, spending] of monthlySpending) {
        monthlySpendingRecord[yearMonth] = {
          inflowAmount: spending.inflow,
          outflowAmount: spending.outflow,
        };
      }

      await ctx.db.patch(categoryId as Id<'category'>, {
        monthlySpending: monthlySpendingRecord,
        updatedAt: new Date().toISOString(),
      });
    }

    console.log(`Finalized spending for ${spendingMap.size} categories`);

    return spendingMap.size;
  },
});

/**
 * Collect category spending data from a batch of transactions.
 * Returns partial spending map and cursor for next batch.
 */
export const collectCategorySpendingBatch = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .paginate({
        numItems: PAGINATE_BATCH_SIZE,
        cursor: args.cursor ?? null,
      });

    // Build partial spending map from this batch: categoryId -> yearMonth -> { inflow, outflow }
    const spending: Record<string, Record<string, { inflow: number; outflow: number }>> = {};

    for (const txn of results.page) {
      if (txn.isDeleted) continue;

      const yearMonth = String(txn.dateYearMonth);

      for (const movement of txn.movements) {
        if (!movement.categoryId || movement.readyToAssign) continue;

        const categoryId = movement.categoryId as string;

        if (!spending[categoryId]) {
          spending[categoryId] = {};
        }
        if (!spending[categoryId][yearMonth]) {
          spending[categoryId][yearMonth] = { inflow: 0, outflow: 0 };
        }

        const amount = Number(movement.amount);
        if (amount > 0) {
          spending[categoryId][yearMonth].inflow += amount;
        } else {
          spending[categoryId][yearMonth].outflow += -amount;
        }
      }
    }

    return {
      spending,
      continueCursor: results.continueCursor,
      isDone: results.isDone,
    };
  },
});

/**
 * Write accumulated category spending data in a batch.
 */
export const writeCategorySpendingBatch = internalMutation({
  args: {
    categories: v.array(
      v.object({
        categoryId: v.id('category'),
        monthlySpending: v.record(
          v.string(),
          v.object({
            inflowAmount: v.int64(),
            outflowAmount: v.int64(),
          })
        ),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    for (const cat of args.categories) {
      await ctx.db.patch(cat.categoryId, {
        monthlySpending: cat.monthlySpending,
        updatedAt: now,
      });
    }
    return args.categories.length;
  },
});

/**
 * Delete a workspace created during YNAB import (for cleanup on failure)
 */
export const deleteYnabImportWorkspace = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { workspaceId }) => {
    const timestamp = new Date().toISOString();

    // Soft delete the workspace
    await ctx.db.patch(workspaceId, {
      isDeleted: true,
      deletedAt: timestamp,
      updatedAt: timestamp,
    });

    console.log(`Deleted workspace ${workspaceId} due to import failure`);
  },
});

/**
 * Mark import as complete and update user's active workspace
 */
export const completeYnabImport = internalMutation({
  args: {
    userId: v.id('userProfile'),
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, args) => {
    const { userId, workspaceId } = args;
    const now = new Date().toISOString();

    // Update import status
    const status = await ctx.db
      .query('ynabImportStatus')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();

    if (status) {
      await ctx.db.patch(status._id, {
        status: 'completed',
        workspaceId,
        updatedAt: now,
      });
    }

    // Update user's active workspace
    await ctx.db.patch(userId, {
      activeWorkspaceId: workspaceId,
      updatedAt: now,
    });

    console.log(`Completed YNAB import for user ${userId}`);
  },
});
