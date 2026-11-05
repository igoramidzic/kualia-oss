import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import { internalMutation } from '../_generated/server';

export function shouldSkipPlaidImportBalance(
  account: Pick<Doc<'bankAccount'>, 'plaidInitialSync'> | null,
  isFirstSync: boolean | undefined
): boolean {
  return account?.plaidInitialSync
    ? account.plaidInitialSync.status === 'pending' && account.plaidInitialSync.preserveBalance
    : (isFirstSync ?? false);
}

import {
  buildActivityContextForClerkId,
  buildSystemActivityContextForWorkspace,
  recordTransactionActivity,
} from '../activityLogs/helpers';
import type { ActivityContext } from '../activityLogs/types';
import { updateBankAccountBalance } from '../bankAccounts';
import { dateToYearMonth } from '../categoryBudgets/calculations';
import { findAutoLinkScheduledMatch, initializeScheduledMatchingCache } from '../scheduledTransactions/helpers';
import {
  findPotentialManualMatchWithCache,
  initializeTransactionMatchingCache,
} from '../transactionLinking/transactionMatching';
import { applyRulesToTransactionData } from '../transactionRules/helpers';
import type { TransactionRule } from '../transactionRules/types';
import { buildTransactionComputedFields } from '../transactions/helpers';
import {
  buildBankAccountPropertiesCache,
  buildSnapshotFromTransactionCached,
} from '../transactions/reconciliation/buildSnapshot';
import { reconcileTransactionSideEffects } from '../transactions/reconciliation/reconcile';
import { autoLinkImportedTransactionToScheduledMatch } from '../transactions/update';
import {
  buildSuggestedTransferObject,
  createPendingTransferMatch,
  isTransferEligibleAccountType,
  isValidManualTransferPlaceholder,
  markPendingTransferMatchAsMatched,
  processTransferDetection,
  resolveTransferImportDisposition,
  selectAvailableTransferCounterpart,
} from '../transferDetection';
import {
  type CategorySuggestionResult,
  initializeCategorySuggestionCache,
  suggestCategoryForTransactionWithCache,
} from './categorySuggestion';

type BankAccountImportProperties = {
  isCreditCardAccount: boolean;
  isExcludedFromRTA: boolean;
  creditCardCategoryId: Id<'category'> | null;
};

type ImportedMovementData = {
  categoryId: Id<'category'> | undefined;
  readyToAssign: boolean;
  amount: bigint;
  notes: undefined;
  sortOrder: number;
  creditCardTransfer:
    | {
        creditCardCategoryId: Id<'category'>;
        spendingCategoryId: Id<'category'>;
      }
    | undefined;
};

export function buildImportedMovementData(args: {
  amount: bigint;
  categoryId: Id<'category'> | undefined;
  readyToAssign?: boolean;
  isTransferDetected?: boolean;
  bankAccountProperties: BankAccountImportProperties | undefined;
}): ImportedMovementData[] {
  // Rules and category suggestions win. Only otherwise-uncategorized cash inflows
  // default to RTA; credit-card refunds and possible transfers still need review.
  const readyToAssign =
    args.readyToAssign ??
    (args.amount > 0n &&
      args.categoryId === undefined &&
      !args.isTransferDetected &&
      args.bankAccountProperties?.isExcludedFromRTA === false);
  const creditCardTransfer =
    args.bankAccountProperties?.isCreditCardAccount &&
    args.bankAccountProperties.creditCardCategoryId &&
    args.categoryId
      ? {
          creditCardCategoryId: args.bankAccountProperties.creditCardCategoryId,
          spendingCategoryId: args.categoryId,
        }
      : undefined;

  return [
    {
      categoryId: args.categoryId,
      readyToAssign,
      amount: args.amount,
      notes: undefined,
      sortOrder: 0,
      creditCardTransfer,
    },
  ];
}

export function recordRegularImportTransferVeto(
  vetoedRawTransactionIds: Set<string>,
  rawTransactionId: Id<'transactionImportRaw'>,
  linkedRawTransactionId?: Id<'transactionImportRaw'>
): void {
  vetoedRawTransactionIds.add(rawTransactionId.toString());
  if (linkedRawTransactionId) {
    vetoedRawTransactionIds.add(linkedRawTransactionId.toString());
  }
}

/**
 * Internal mutation to process raw transaction imports from any provider
 * Takes transactions with status 'awaiting_insert_job' and inserts them into the transaction table
 * Creates or upserts merchants based on the provider's merchant name
 */
export const processRawTransactionImports = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    isFirstSync: v.optional(v.boolean()),
    rawImportIds: v.optional(v.array(v.id('transactionImportRaw'))),
  },
  returns: v.object({ processedCount: v.number(), errorCount: v.number(), timestamp: v.string() }),
  handler: async (ctx, args) => {
    console.log(`\n========== processRawTransactionImports START ==========`);
    console.log(`Workspace ID: ${args.workspaceId}`);
    console.log(`Is First Sync: ${args.isFirstSync ?? false}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);

    let processedCount = 0;
    let errorCount = 0;

    // ==========================================
    // STEP 1: Load all data upfront
    // ==========================================

    // Get ALL raw transactions that are ready to be inserted (no batching)
    let rawTransactions = args.rawImportIds
      ? (await Promise.all([...new Set(args.rawImportIds)].map((id) => ctx.db.get(id)))).filter(
          (record): record is NonNullable<typeof record> =>
            record !== null && record.workspaceId === args.workspaceId && record.importStatus === 'awaiting_insert_job'
        )
      : await ctx.db
          .query('transactionImportRaw')
          .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
          .filter((q) => q.eq(q.field('importStatus'), 'awaiting_insert_job'))
          .collect();

    const allBankAccounts = await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .collect();
    if (args.rawImportIds === undefined) {
      const replayAccounts = allBankAccounts.filter(
        (account) => account.plaidInitialSync?.status === 'pending' && account.plaidInitialSync.preserveBalance
      );
      const connectionAccounts = await Promise.all(
        replayAccounts.map((account) => ctx.db.get(account.plaidInitialSync!.bankLinkAccountId))
      );
      const reservedPlaidAccountIds = new Set(connectionAccounts.map((account) => account?.plaidAccountId));
      rawTransactions = rawTransactions.filter(
        (transaction) => !reservedPlaidAccountIds.has(transaction.plaidAccountId)
      );
    }

    console.log(`\n[STEP 1] Found ${rawTransactions.length} raw transactions to process`);

    if (rawTransactions.length === 0) {
      console.log(`No transactions to process. Exiting.`);
      console.log(`========== processRawTransactionImports END ==========\n`);
      return {
        processedCount: 0,
        errorCount: 0,
        timestamp: new Date().toISOString(),
      };
    }

    // IMPORTANT: Immediately mark all raw transactions as 'processing' to prevent concurrent processing
    // This acts as a lock so if multiple calls happen simultaneously, only one will process each transaction
    console.log(`\n[STEP 1B] Marking ${rawTransactions.length} transactions as processing (lock)`);
    const lockTimestamp = new Date().toISOString();
    for (const rawTxn of rawTransactions) {
      await ctx.db.patch(rawTxn._id, {
        importStatus: 'processing' as const,
        updatedAt: lockTimestamp,
      });
    }
    console.log(`[STEP 1B] All transactions marked as processing`);

    const bankAccountMap = new Map(
      allBankAccounts.filter((ba) => ba.bankLinkAccountId).map((ba) => [ba.bankLinkAccountId!, ba])
    );
    const bankAccountByIdMap = new Map(allBankAccounts.map((ba) => [ba._id, ba]));
    const eligibleTransferAccountIds = new Set(
      allBankAccounts
        .filter((account) => !account.isDeleted && isTransferEligibleAccountType(account.accountType))
        .map((account) => account._id.toString())
    );

    // Pre-compute bank account properties for snapshot building (avoids repeated DB reads)
    const bankAccountPropertiesCache = await buildBankAccountPropertiesCache(
      ctx,
      allBankAccounts.map((ba) => ba._id)
    );

    // Load bank link accounts that are linked to bank accounts in this workspace
    // (bankLinkAccount no longer has workspaceId - we find them through bankAccount)
    const bankLinkAccountIds = allBankAccounts
      .map((ba) => ba.bankLinkAccountId)
      .filter((id): id is NonNullable<typeof id> => id !== undefined);

    const allBankLinkAccounts = await Promise.all([...new Set(bankLinkAccountIds)].map((id) => ctx.db.get(id)));
    const bankLinkAccountMap = new Map(
      allBankLinkAccounts
        .filter((bla): bla is NonNullable<typeof bla> => bla !== null)
        .map((bla) => [bla.plaidAccountId, bla])
    );
    const defaultActivityContext = await buildSystemActivityContextForWorkspace(ctx, args.workspaceId, 'bank_import');
    const bankLinkIds = [
      ...new Set(
        allBankLinkAccounts
          .filter((account): account is NonNullable<typeof account> => account !== null)
          .map((account) => account.bankLinkId)
      ),
    ];
    const bankLinks = await Promise.all(bankLinkIds.map((id) => ctx.db.get(id)));
    const activityContextByClerkId = new Map<string, ActivityContext>();
    const ownerByBankLinkId = new Map(
      bankLinks
        .filter((link): link is NonNullable<typeof link> => link !== null)
        .map((link) => [link._id, link.ownerId] as const)
    );
    const activityContextByBankAccountId = new Map<Id<'bankAccount'>, ActivityContext>();
    for (const bankAccount of allBankAccounts) {
      if (!bankAccount.bankLinkAccountId) continue;
      const bankLinkAccount = allBankLinkAccounts.find((account) => account?._id === bankAccount.bankLinkAccountId);
      if (!bankLinkAccount) continue;
      const ownerClerkId = ownerByBankLinkId.get(bankLinkAccount.bankLinkId);
      if (!ownerClerkId) continue;
      let context = activityContextByClerkId.get(ownerClerkId);
      if (!context) {
        context = await buildActivityContextForClerkId(ctx, ownerClerkId, {
          type: 'system',
          process: 'bank_import',
        });
        activityContextByClerkId.set(ownerClerkId, context);
      }
      activityContextByBankAccountId.set(bankAccount._id, context);
    }

    console.log(`\n[BALANCE][STEP 1] Loaded ${allBankAccounts.length} bank accounts`);
    for (const ba of allBankAccounts) {
      console.log(
        `[BALANCE]  - Bank Account ${ba._id} (${ba.name}): currentBalance=${ba.currentBalance}, bankLinkAccountId=${ba.bankLinkAccountId ?? 'none'}`
      );
    }

    // Load all existing inserted raw transactions to check for duplicates
    const existingInsertedRawTxns = await ctx.db
      .query('transactionImportRaw')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .filter((q) => q.eq(q.field('importStatus'), 'inserted'))
      .collect();
    const existingPlaidTxnIdSet = new Set(existingInsertedRawTxns.map((txn) => txn.plaidTransactionId));

    // Also check if transactions already exist in the final transaction table
    // This prevents duplicates when the same raw transaction is processed multiple times
    const existingTransactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .collect();
    const existingTransactionRawIds = new Set(
      existingTransactions.filter((txn) => txn.transactionImportRawId).map((txn) => txn.transactionImportRawId!)
    );

    // Load all merchants in one query
    const allMerchants = await ctx.db
      .query('merchant')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Load global merchants one by one to avoid recursion limit
    const globalMerchantMap = new Map<string, { name: string; logoUrl?: string }>();
    for (const merchant of allMerchants) {
      if (merchant.globalMerchantId && !globalMerchantMap.has(merchant.globalMerchantId)) {
        const globalMerchant = await ctx.db.get(merchant.globalMerchantId);
        if (globalMerchant) {
          globalMerchantMap.set(merchant.globalMerchantId, {
            name: globalMerchant.name,
            logoUrl: globalMerchant.logoUrl,
          });
        }
      }
    }

    // Build merchant map by resolved name
    const merchantMap = new Map<string, Doc<'merchant'>>();
    for (const merchant of allMerchants) {
      // Resolve name: use merchant.name if set, otherwise use global merchant name
      const resolvedName =
        merchant.name ??
        (merchant.globalMerchantId ? globalMerchantMap.get(merchant.globalMerchantId)?.name : undefined);
      if (resolvedName) {
        merchantMap.set(resolvedName, merchant);
      }
    }

    // Build case-insensitive merchant lookup map
    const merchantMapLowercase = new Map<string, Doc<'merchant'>>();
    for (const [name, merchant] of merchantMap.entries()) {
      merchantMapLowercase.set(name.toLowerCase(), merchant);
    }

    const merchantByGlobalIdMap = new Map(
      allMerchants.filter((m) => m.globalMerchantId).map((m) => [m.globalMerchantId!, m])
    );

    // ==========================================
    // STEP 2: Process all transactions using cached data
    // ==========================================

    // Track new merchants to create
    const newMerchantsToCreate: Array<{
      name: string;
      logoUrl?: string;
    }> = [];

    // Track transactions to insert
    const transactionsToInsert: Array<{
      rawTxnId: import('../_generated/dataModel').Id<'transactionImportRaw'>;
      bankAccountId: import('../_generated/dataModel').Id<'bankAccount'>;
      amount: bigint;
      date: string;
      merchantName: string | undefined;
      merchantId: import('../_generated/dataModel').Id<'merchant'> | undefined;
      status: 'pending' | 'cleared' | 'reconciled';
      plaidCategory: string[];
      importDetails: {
        provider: 'plaid';
        originalStatement: string | undefined;
        merchantName: string | undefined;
        date: string;
        postedDate: string | undefined;
        amount: bigint;
        authorizedDate: string | undefined;
      };
    }> = [];

    // Track status updates for raw transactions
    const statusUpdates: Array<{
      id: import('../_generated/dataModel').Id<'transactionImportRaw'>;
      status: 'inserted' | 'error';
      errorMessage?: string;
    }> = [];

    for (const rawTxn of rawTransactions) {
      try {
        // Look up bank link account from cache
        const bankLinkAccount = bankLinkAccountMap.get(rawTxn.plaidAccountId);

        if (!bankLinkAccount) {
          statusUpdates.push({
            id: rawTxn._id,
            status: 'error',
            errorMessage: 'Bank link account not found',
          });
          errorCount++;
          continue;
        }

        // Look up bank account from cache
        const bankAccount = bankAccountMap.get(bankLinkAccount._id);

        if (!bankAccount) {
          statusUpdates.push({
            id: rawTxn._id,
            status: 'error',
            errorMessage: 'Bank account not found or not linked',
          });
          errorCount++;
          continue;
        }

        // Check if transaction already exists from cache (by plaidTransactionId)
        if (existingPlaidTxnIdSet.has(rawTxn.plaidTransactionId)) {
          statusUpdates.push({
            id: rawTxn._id,
            status: 'inserted',
          });
          processedCount++;
          continue;
        }

        // Also check if this raw transaction has already been inserted into the transaction table
        // This prevents duplicates when performSync is called multiple times
        if (existingTransactionRawIds.has(rawTxn._id)) {
          statusUpdates.push({
            id: rawTxn._id,
            status: 'inserted',
          });
          processedCount++;
          continue;
        }

        // Handle merchant matching with case-insensitive lookup
        let merchantNameForTransaction: string | undefined;
        let resolvedMerchantId: Id<'merchant'> | undefined;

        const merchantName = rawTxn.merchantName;
        const originalStatement = rawTxn.originalStatement;

        // Strategy 1: Try Plaid's merchantName (exact match)
        if (merchantName) {
          const exactMatch = merchantMap.get(merchantName);
          if (exactMatch) {
            merchantNameForTransaction = merchantName;
            resolvedMerchantId = exactMatch._id;
          }
        }

        // Strategy 2: Try merchantName (case-insensitive)
        if (!resolvedMerchantId && merchantName) {
          const ciMatch = merchantMapLowercase.get(merchantName.toLowerCase());
          if (ciMatch) {
            // Use the existing merchant's resolved name
            const resolvedName =
              ciMatch.name ??
              (ciMatch.globalMerchantId ? globalMerchantMap.get(ciMatch.globalMerchantId)?.name : undefined);
            merchantNameForTransaction = resolvedName ?? merchantName;
            resolvedMerchantId = ciMatch._id;
          }
        }

        // Strategy 3: Try originalStatement (case-insensitive) if no merchantName match
        if (!resolvedMerchantId && originalStatement) {
          const ciMatch = merchantMapLowercase.get(originalStatement.toLowerCase());
          if (ciMatch) {
            const resolvedName =
              ciMatch.name ??
              (ciMatch.globalMerchantId ? globalMerchantMap.get(ciMatch.globalMerchantId)?.name : undefined);
            merchantNameForTransaction = resolvedName ?? originalStatement;
            resolvedMerchantId = ciMatch._id;
          }
        }

        // Strategy 4: Create new merchant if we have a merchantName but no match
        if (!resolvedMerchantId && merchantName) {
          const queuedByName = newMerchantsToCreate.find((m) => m.name === merchantName);
          if (!queuedByName) {
            newMerchantsToCreate.push({
              name: merchantName,
              logoUrl: rawTxn.logoUrl,
            });
          }
          merchantNameForTransaction = merchantName;
        }

        // Queue transaction for insert
        transactionsToInsert.push({
          rawTxnId: rawTxn._id,
          bankAccountId: bankAccount._id,
          amount: rawTxn.amount,
          date: rawTxn.date,
          merchantName: merchantNameForTransaction,
          merchantId: resolvedMerchantId,
          status: rawTxn.pending ? 'pending' : 'cleared',
          plaidCategory: rawTxn.plaidCategory,
          importDetails: {
            provider: 'plaid', // TODO: Detect provider from bankLink
            originalStatement: rawTxn.originalStatement ?? undefined,
            merchantName: rawTxn.merchantName ?? undefined,
            date: rawTxn.date,
            postedDate: rawTxn.postedDate ?? undefined,
            amount: rawTxn.amount,
            authorizedDate: rawTxn.authorizedDate ?? undefined,
          },
        });

        // Queue status update
        statusUpdates.push({
          id: rawTxn._id,
          status: 'inserted',
        });

        processedCount++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        statusUpdates.push({
          id: rawTxn._id,
          status: 'error',
          errorMessage,
        });
        errorCount++;
      }
    }

    // ==========================================
    // STEP 2B: Transfer Detection Phase
    // ==========================================

    // Build maps for transfer detection
    const bankAccountMapForTransfer = new Map(
      allBankAccounts.filter((ba) => ba.bankLinkAccountId).map((ba) => [ba.bankLinkAccountId!.toString(), ba])
    );
    const bankLinkAccountMapForTransfer = new Map(
      Array.from(bankLinkAccountMap.entries()).map(([plaidAccountId, bla]) => [
        plaidAccountId,
        { _id: bla._id, plaidAccountId },
      ])
    );

    // Only transactions that passed import validation can participate in
    // matching. Invalid or duplicate raw rows must not become ghost
    // counterparts for transactions that will actually be inserted.
    const rawTransactionIdsToInsert = new Set(transactionsToInsert.map((transaction) => transaction.rawTxnId));
    const rawTransactionsForDetection = rawTransactions.filter((raw) => rawTransactionIdsToInsert.has(raw._id));

    console.log(`\n[STEP 2B] Running transfer detection on ${rawTransactionsForDetection.length} raw transactions`);
    const transferDetectionResults = await processTransferDetection(ctx, {
      workspaceId: args.workspaceId,
      rawTransactions: rawTransactionsForDetection,
      bankAccountMap: bankAccountMapForTransfer,
      bankLinkAccountMap: bankLinkAccountMapForTransfer,
    });

    const transferDetectionCount = Array.from(transferDetectionResults.values()).filter(
      (r) => r.isLikelyTransfer
    ).length;
    console.log(
      `[STEP 2B] Detected ${transferDetectionCount} potential transfers out of ${rawTransactionsForDetection.length}`
    );

    // ==========================================
    // STEP 3: Batch write all data
    // ==========================================

    const timestamp = new Date().toISOString();

    console.log(`\n[STEP 3] Starting batch write`);
    console.log(`  - Transactions to insert: ${transactionsToInsert.length}`);
    console.log(`  - New merchants to create: ${newMerchantsToCreate.length}`);
    console.log(`  - Status updates: ${statusUpdates.length}`);
    console.log(`  - Potential transfers: ${transferDetectionCount}`);

    // ==========================================
    // STEP 3A: Create global merchants
    // ==========================================

    // Create or get global merchants one by one to avoid recursion limit
    const globalMerchantIdMap = new Map<string, import('../_generated/dataModel').Id<'globalMerchant'>>();

    for (const merchantData of newMerchantsToCreate) {
      // Check if global merchant already exists by name
      const existing = await ctx.db
        .query('globalMerchant')
        .withIndex('by_name', (q) => q.eq('name', merchantData.name))
        .first();

      if (existing) {
        globalMerchantIdMap.set(merchantData.name, existing._id);
        continue;
      }

      // Create new global merchant (even without plaidMerchantEntityId or logo)
      const globalId = await ctx.db.insert('globalMerchant', {
        name: merchantData.name,
        logoUrl: merchantData.logoUrl,
        isVerified: false,
        updatedAt: timestamp,
      });
      globalMerchantIdMap.set(merchantData.name, globalId);
    }

    // ==========================================
    // STEP 3B: Create org-specific merchant records
    // ==========================================

    const newMerchantIds = new Map<string, import('../_generated/dataModel').Id<'merchant'>>();
    for (const merchantData of newMerchantsToCreate) {
      // Get global merchant ID from our map (all merchants now have global records)
      const globalMerchantId = globalMerchantIdMap.get(merchantData.name);

      // Check if org already has this merchant by globalMerchantId
      if (globalMerchantId) {
        const existingByGlobalId = merchantByGlobalIdMap.get(globalMerchantId);
        if (existingByGlobalId) {
          newMerchantIds.set(merchantData.name, existingByGlobalId._id);
          merchantMap.set(merchantData.name, existingByGlobalId);
          continue;
        }
      }

      // Create org-specific merchant record linked to global merchant
      const merchantId = await ctx.db.insert('merchant', {
        workspaceId: args.workspaceId,
        globalMerchantId,
        name: undefined, // Name comes from globalMerchant
        logoUrl: undefined, // Logo comes from globalMerchant
        isDeleted: false,
        updatedAt: timestamp,
      });
      newMerchantIds.set(merchantData.name, merchantId);
      merchantMap.set(merchantData.name, {
        _id: merchantId,
        workspaceId: args.workspaceId,
        globalMerchantId,
        name: undefined,
        logoUrl: undefined,
        isDeleted: false,
        updatedAt: timestamp,
        deletedAt: undefined,
        _creationTime: Date.now(),
      });
    }

    // Insert all transactions with rule-applied data
    // Group transactions by bank account for batch balance updates
    const balanceUpdates = new Map<Id<'bankAccount'>, { pending: bigint; cleared: bigint }>();

    // Track batch-linked transfer pairs for updating after all transactions are created
    const batchLinkedTransactions = new Map<
      string,
      {
        transactionId: Id<'transaction'>;
        linkedRawTransactionId: Id<'transactionImportRaw'>;
      }
    >();

    console.log(`\n[STEP 3] Inserting ${transactionsToInsert.length} transactions`);

    // Initialize caches ONCE before processing all transactions
    // This avoids repeated queries for historical data
    const categorySuggestionCache = await initializeCategorySuggestionCache(ctx, args.workspaceId);
    const transactionMatchingCache = await initializeTransactionMatchingCache(ctx, args.workspaceId);
    const scheduledMatchingCache = await initializeScheduledMatchingCache(ctx, args.workspaceId);
    // Load and sort transaction rules by priority (lower number = higher priority)
    // Rules are applied BEFORE category suggestion to give users explicit control
    const allRules = await ctx.db
      .query('transactionRule')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .filter((q) => q.and(q.eq(q.field('isActive'), true), q.eq(q.field('isDeleted'), false)))
      .collect();
    const sortedRules: TransactionRule[] = allRules.sort((a, b) => a.priority - b.priority);
    console.log(`[RULES] Loaded ${sortedRules.length} active transaction rules`);

    // Build merchant name cache for rule evaluation
    const merchantNameCache = new Map<Id<'merchant'>, string | undefined>();
    for (const merchant of merchantMap.values()) {
      merchantNameCache.set(merchant._id, merchant.name);
    }

    // Build reverse map: merchant ID → resolved name (for post-rule category suggestion)
    const merchantIdToResolvedName = new Map<Id<'merchant'>, string>();
    for (const [resolvedName, merchant] of merchantMap.entries()) {
      merchantIdToResolvedName.set(merchant._id, resolvedName);
    }

    // Track rules applied for updating usage stats
    const rulesAppliedCount = new Map<Id<'transactionRule'>, number>();
    const claimedTransferCounterpartIds = new Set<string>();
    const regularIntentTransferVetoRawIds = new Set<string>();

    for (const txnData of transactionsToInsert) {
      const transferDetection = selectAvailableTransferCounterpart(
        transferDetectionResults.get(txnData.rawTxnId.toString()),
        claimedTransferCounterpartIds
      );

      // Resolve merchantId from merchantName if not set yet.
      // This is necessary because new merchants are created after the transaction loop,
      // so resolvedMerchantId would be undefined for new merchants.
      // Suggested transfers retain their normal imported merchant/category data
      // until the user approves conversion, so rejection is lossless.
      let finalMerchantId = txnData.merchantId;
      if (!finalMerchantId && txnData.merchantName) {
        const merchant = merchantMap.get(txnData.merchantName);
        finalMerchantId = merchant?._id;
      }

      // STEP 3a: Apply transaction rules FIRST (highest priority - explicit user intent)
      // Rules can set both merchant and category, overriding automatic suggestions
      let categorySuggestion: CategorySuggestionResult;
      let ruleAppliedCategoryId: Id<'category'> | undefined;

      // Try applying rules first (if any exist)
      if (sortedRules.length > 0) {
        const ruleResult = applyRulesToTransactionData(
          {
            merchantId: finalMerchantId,
            rawMerchantName: txnData.merchantName,
            amount: txnData.amount,
            bankAccountId: txnData.bankAccountId,
            importDetails: {
              originalStatement: txnData.importDetails.originalStatement,
              merchantName: txnData.importDetails.merchantName,
            },
          },
          sortedRules,
          merchantNameCache
        );

        if (ruleResult.appliedRuleId) {
          console.log(`[RULES] Rule ${ruleResult.appliedRuleId} matched for transaction ${txnData.rawTxnId}`);

          // Track usage for this rule
          const currentCount = rulesAppliedCount.get(ruleResult.appliedRuleId) ?? 0;
          rulesAppliedCount.set(ruleResult.appliedRuleId, currentCount + 1);

          // Override merchant if rule specifies one
          if (ruleResult.data.merchantId !== undefined) {
            finalMerchantId = ruleResult.data.merchantId;
          }

          // Track if rule set a category
          ruleAppliedCategoryId = ruleResult.data.categoryId;
        }
      }

      // Use rule's category if set, otherwise use automatic suggestion
      if (ruleAppliedCategoryId !== undefined) {
        categorySuggestion = { categoryId: ruleAppliedCategoryId, matchType: 'rule_applied' };
      } else {
        // If a rule changed the merchant, use the post-rule merchant name for category suggestion.
        // This ensures we look up suggestions for the correct merchant (e.g., "Citrus Park Cafe"
        // instead of the raw Plaid name "Citrus Park Cyclery" that a rule remapped).
        const merchantNameForSuggestion = finalMerchantId
          ? (merchantIdToResolvedName.get(finalMerchantId) ?? txnData.importDetails.merchantName)
          : txnData.importDetails.merchantName;

        categorySuggestion = await suggestCategoryForTransactionWithCache(
          ctx,
          args.workspaceId,
          {
            merchantName: merchantNameForSuggestion,
            originalStatement: txnData.importDetails.originalStatement,
            amount: txnData.amount,
            plaidCategory: txnData.plaidCategory,
            date: txnData.date,
            bankAccountId: txnData.bankAccountId,
          },
          categorySuggestionCache
        );
      }

      // An existing manual regular transaction is also explicit regular
      // intent, so it must preempt transfer promotion just like a planned
      // transaction match.
      const potentialMatch = findPotentialManualMatchWithCache(
        {
          workspaceId: args.workspaceId,
          bankAccountId: txnData.bankAccountId,
          amount: txnData.amount,
          date: txnData.date,
          merchantName: txnData.importDetails.merchantName,
          rawTransactionId: txnData.rawTxnId,
        },
        transactionMatchingCache
      );

      const scheduledMatchCandidate = findAutoLinkScheduledMatch(
        {
          bankAccountId: txnData.bankAccountId,
          merchantId: finalMerchantId,
          categoryId: categorySuggestion.categoryId,
          amount: txnData.amount,
          date: txnData.date,
        },
        scheduledMatchingCache
      );
      const rawTransactionIdString = txnData.rawTxnId.toString();
      if (scheduledMatchCandidate || potentialMatch) {
        recordRegularImportTransferVeto(
          regularIntentTransferVetoRawIds,
          txnData.rawTxnId,
          transferDetection?.linkedRawTransactionId
        );

        const linkedRawTransactionIdString = transferDetection?.linkedRawTransactionId?.toString();
        if (linkedRawTransactionIdString) {
          // If the linked half was inserted earlier in this loop, remove its
          // suggestion now. Convex mutations are atomic, so clients never see
          // the transient one-sided batch suggestion.
          const previouslyInsertedPair = batchLinkedTransactions.get(linkedRawTransactionIdString);
          if (previouslyInsertedPair) {
            const previouslyInsertedTransaction = await ctx.db.get(previouslyInsertedPair.transactionId);
            if (previouslyInsertedTransaction?.suggestedTransfer) {
              await ctx.db.patch(previouslyInsertedPair.transactionId, {
                suggestedTransfer: undefined,
                updatedAt: timestamp,
              });
            }
            batchLinkedTransactions.delete(linkedRawTransactionIdString);
          }
        }
      }

      const matchedCounterpartId = transferDetection?.matchedTransactionId;
      const isMatchedCounterpartAvailable =
        matchedCounterpartId === undefined || !claimedTransferCounterpartIds.has(matchedCounterpartId.toString());
      const transferDisposition = resolveTransferImportDisposition(
        transferDetection,
        regularIntentTransferVetoRawIds.has(rawTransactionIdString),
        isMatchedCounterpartAvailable
      );
      let isTransferDetected = transferDisposition.shouldSuggestTransfer;

      // Check if this is a manual_transfer_match - link to existing manual transfer instead of creating new
      if (
        isTransferDetected &&
        transferDetection?.matchType === 'manual_transfer_match' &&
        transferDetection.matchedTransactionId
      ) {
        // ========================================
        // MANUAL TRANSFER MATCH: Update existing manual transfer placeholder with real bank data
        // ========================================
        console.log(
          `[TRANSFER LINK] Manual transfer match found for raw txn ${txnData.rawTxnId} -> manual transfer ${transferDetection.matchedTransactionId}`
        );

        const existingManualTransfer = await ctx.db.get(transferDetection.matchedTransactionId);
        const existingManualTransferPair = existingManualTransfer?.transferPairId
          ? await ctx.db.get(existingManualTransfer.transferPairId)
          : null;
        if (
          !existingManualTransfer ||
          !isValidManualTransferPlaceholder(
            existingManualTransfer,
            existingManualTransferPair,
            args.workspaceId,
            eligibleTransferAccountIds
          )
        ) {
          console.log(
            `[TRANSFER LINK] Manual transfer ${transferDetection.matchedTransactionId} is no longer actionable, falling through to regular processing`
          );
          isTransferDetected = false;
        } else {
          // Update the existing manual transfer with the real bank import data
          await ctx.db.patch(existingManualTransfer._id, {
            transactionImportRawId: txnData.rawTxnId,
            importDetails: txnData.importDetails,
            reviewStatus: 'reviewed' as const, // Keep as reviewed since it was already approved
            updatedAt: timestamp,
          });

          console.log(
            `[TRANSFER LINK] Updated manual transfer ${existingManualTransfer._id} with import details from ${txnData.rawTxnId}`
          );
          claimedTransferCounterpartIds.add(transferDetection.matchedTransactionId.toString());

          // No balance update - the manual transfer already counted when it was created
          // No RTA update - the manual transfer doesn't affect RTA (it's a transfer)
          // No merchant stats update - transfers don't have merchants
          // No category spending update - transfers don't have categories
          continue;
        }
      }

      if (potentialMatch) {
        // ========================================
        // MATCH FOUND: Update the existing manual transaction
        // ========================================
        console.log(
          `[LINKING] Match found for raw txn ${txnData.rawTxnId} -> manual txn ${potentialMatch.manualTransactionId} (${potentialMatch.confidence}% confidence)`
        );

        // Get the manual transaction to check if it needs categorization
        const manualTxn = await ctx.db.get(potentialMatch.manualTransactionId);
        if (!manualTxn) {
          console.log(`[LINKING] Manual transaction ${potentialMatch.manualTransactionId} not found, skipping link`);
          continue;
        }

        // Check if manual transaction is uncategorized (has movements without categoryId)
        const isUncategorized = manualTxn.movements?.some(
          (m) => !m.categoryId && !m.readyToAssign && !m.creditCardTransfer
        );

        // Build the update object
        const linkUpdate: {
          linkedRawTransactionId: typeof txnData.rawTxnId;
          linkedAt: number;
          linkConfidence: number;
          linkReason: string;
          importDetails: typeof txnData.importDetails;
          transactionImportRawId: typeof txnData.rawTxnId;
          reviewStatus: 'needs_review';
          updatedAt: string;
          movements?: typeof manualTxn.movements;
          searchText?: string;
          hasUncategorized?: boolean;
        } = {
          linkedRawTransactionId: txnData.rawTxnId,
          linkedAt: Date.now(),
          linkConfidence: potentialMatch.confidence,
          linkReason: potentialMatch.reason,
          importDetails: txnData.importDetails,
          transactionImportRawId: txnData.rawTxnId,
          reviewStatus: 'needs_review' as const,
          updatedAt: timestamp,
        };

        // If uncategorized, try to suggest a category using the import's merchant data
        // Build before snapshot for reconciliation (only if adding category)
        let needsReconcile = false;

        if (isUncategorized && manualTxn.movements) {
          console.log(
            `[LINKING] Manual transaction ${potentialMatch.manualTransactionId} is uncategorized, suggesting category`
          );

          const categorySuggestion = await suggestCategoryForTransactionWithCache(
            ctx,
            args.workspaceId,
            {
              merchantName: txnData.importDetails.merchantName,
              originalStatement: txnData.importDetails.originalStatement,
              amount: txnData.amount,
              plaidCategory: txnData.plaidCategory,
              date: txnData.date,
              bankAccountId: txnData.bankAccountId,
            },
            categorySuggestionCache
          );

          if (categorySuggestion.categoryId) {
            console.log(
              `[LINKING] Suggested category ${categorySuggestion.categoryId} for manual transaction ${potentialMatch.manualTransactionId}`
            );

            // Update the uncategorized movements with the suggested category
            const updatedMovements = manualTxn.movements.map((m) => {
              if (!m.categoryId && !m.readyToAssign && !m.creditCardTransfer) {
                return { ...m, categoryId: categorySuggestion.categoryId };
              }
              return m;
            });

            linkUpdate.movements = updatedMovements;
            linkUpdate.hasUncategorized = false;

            // Update searchText to include the new category name
            const category = await ctx.db.get(categorySuggestion.categoryId);
            if (category && manualTxn.searchText) {
              // Append category name to existing search text
              const categoryToken = category.name
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, '')
                .replace(/\s+/g, '');
              linkUpdate.searchText = manualTxn.searchText + ' ' + categoryToken;
            }

            needsReconcile = true;
          }
        }

        // Build before snapshot (before patching)
        const beforeSnapshot = needsReconcile
          ? await buildSnapshotFromTransactionCached(ctx, manualTxn, bankAccountPropertiesCache)
          : null;

        // Update the manual transaction with import details and link info
        await ctx.db.patch(potentialMatch.manualTransactionId, linkUpdate);

        const linkedManualTransaction = await ctx.db.get(potentialMatch.manualTransactionId);
        if (linkedManualTransaction) {
          await recordTransactionActivity(ctx, {
            workspaceId: args.workspaceId,
            context: activityContextByBankAccountId.get(manualTxn.bankAccountId) ?? defaultActivityContext,
            type: 'transaction_updated',
            before: manualTxn,
            after: linkedManualTransaction,
          });
        }

        // Reconcile side effects if category was added
        if (needsReconcile && beforeSnapshot) {
          const updatedManualTxn = await ctx.db.get(potentialMatch.manualTransactionId);
          if (updatedManualTxn) {
            const afterSnapshot = await buildSnapshotFromTransactionCached(
              ctx,
              updatedManualTxn,
              bankAccountPropertiesCache
            );
            await reconcileTransactionSideEffects(ctx, beforeSnapshot, afterSnapshot, {
              skipBankAccountBalance: true,
            });
          }
        }

        // Remove matched transaction from cache to prevent double-matching
        const cachedTransactions = transactionMatchingCache.manualTransactionsByAccount.get(txnData.bankAccountId);
        if (cachedTransactions) {
          const filteredTransactions = cachedTransactions.filter((t) => t._id !== potentialMatch.manualTransactionId);
          transactionMatchingCache.manualTransactionsByAccount.set(txnData.bankAccountId, filteredTransactions);
        }

        // NO balance update for matched transactions - manual transaction already counted
        // NO RTA update - manual transaction already impacted RTA when created
      } else {
        // ========================================
        // NO MATCH: Create new imported transaction (existing behavior)
        // ========================================

        // Note: transferDetection and isTransferDetected are already defined at the start of the loop
        const movementData = buildImportedMovementData({
          categoryId: categorySuggestion.categoryId,
          isTransferDetected,
          amount: txnData.amount,
          bankAccountProperties: bankAccountPropertiesCache.get(txnData.bankAccountId),
        });

        const computedFields = await buildTransactionComputedFields(ctx, {
          merchantId: finalMerchantId,
          bankAccountId: txnData.bankAccountId,
          importDetails: txnData.importDetails,
          transactionType: 'regular',
          movements: movementData,
        });

        // Build the transaction data
        const transactionData: Parameters<typeof ctx.db.insert<'transaction'>>[1] = {
          bankAccountId: txnData.bankAccountId,
          date: txnData.date,
          merchantId: finalMerchantId,
          status: txnData.status,
          importDetails: txnData.importDetails,
          type: 'regular',
          source: 'automatic_import' as const,
          reviewStatus: 'needs_review' as const,
          transactionImportRawId: txnData.rawTxnId,
          isDeleted: false,
          workspaceId: args.workspaceId,
          dateYearMonth: dateToYearMonth(txnData.date),
          updatedAt: timestamp,
          movements: computedFields.movements,
          searchText: computedFields.searchText,
          totalAmount: computedFields.totalAmount,
          hasUncategorized: computedFields.hasUncategorized,
          hasMissingPayee: computedFields.hasMissingPayee,
        };

        // Add suggestedTransfer if transfer was detected
        if (isTransferDetected && transferDetection) {
          transactionData.suggestedTransfer = buildSuggestedTransferObject(transferDetection);
          console.log(
            `[TRANSFER] Detected transfer: ${txnData.rawTxnId} (${transferDetection.transferConfidence}% confidence, reason: ${transferDetection.detectionReason})`
          );
        }

        const newTransactionId = await ctx.db.insert('transaction', transactionData);
        if (isTransferDetected && matchedCounterpartId) {
          claimedTransferCounterpartIds.add(matchedCounterpartId.toString());
        }

        if (!isTransferDetected) {
          const importedTransaction = await ctx.db.get(newTransactionId);
          if (importedTransaction) {
            const scheduledMatch = await autoLinkImportedTransactionToScheduledMatch(
              ctx,
              importedTransaction,
              args.workspaceId,
              {
                bankAccountId: txnData.bankAccountId,
                merchantId: finalMerchantId,
                categoryId: categorySuggestion.categoryId,
                amount: txnData.amount,
                date: txnData.date,
              },
              scheduledMatchingCache
            );
            if (scheduledMatch) {
              console.log(
                `[PLANNED] Auto-linked ${newTransactionId} to ${scheduledMatch.scheduledTransaction._id} ` +
                  `(${scheduledMatch.confidence}% confidence: ${scheduledMatch.reason})`
              );
            }
          }
        }

        if (transferDisposition.shouldCreatePendingMatch && transferDetection) {
          await createPendingTransferMatch(
            ctx,
            args.workspaceId,
            newTransactionId,
            txnData.bankAccountId,
            txnData.amount,
            txnData.date,
            transferDetection
          );
        }

        if (transferDisposition.shouldConfirmPendingMatch && transferDetection?.matchedTransactionId) {
          await markPendingTransferMatchAsMatched(
            ctx,
            transferDetection.matchedTransactionId,
            newTransactionId,
            timestamp
          );
        }

        // Track created transaction for batch-linking (will update after all transactions are created)
        if (isTransferDetected && transferDetection?.linkedRawTransactionId) {
          batchLinkedTransactions.set(txnData.rawTxnId.toString(), {
            transactionId: newTransactionId,
            linkedRawTransactionId: transferDetection.linkedRawTransactionId,
          });
        }

        // Bidirectional linking for existing_match and pending_match:
        // When a new transaction matches an existing one, update the existing transaction's
        // suggestedTransfer to linked_pending_approval so both sides show as linked
        if (
          isTransferDetected &&
          transferDetection &&
          (transferDetection.matchType === 'existing_match' || transferDetection.matchType === 'pending_match') &&
          transferDetection.matchedTransactionId
        ) {
          const existingMatchedTxn = await ctx.db.get(transferDetection.matchedTransactionId);
          if (existingMatchedTxn && !existingMatchedTxn.isDeleted) {
            const existingStatus = existingMatchedTxn.suggestedTransfer?.status;
            // Only update if status allows it (don't overwrite terminal states)
            if (
              existingStatus === undefined ||
              existingStatus === 'pending' ||
              existingStatus === 'approved_no_destination'
            ) {
              const updatedSuggestedTransfer = existingMatchedTxn.suggestedTransfer
                ? {
                    ...existingMatchedTxn.suggestedTransfer,
                    matchedTransactionId: newTransactionId,
                    status: 'linked_pending_approval' as const,
                    suggestedCounterpartAccountId:
                      existingMatchedTxn.suggestedTransfer.suggestedCounterpartAccountId ?? txnData.bankAccountId,
                  }
                : {
                    transferConfidence: transferDetection.transferConfidence,
                    accountConfidence: transferDetection.accountConfidence,
                    suggestedCounterpartAccountId: txnData.bankAccountId,
                    matchedTransactionId: newTransactionId,
                    detectionReason: transferDetection.detectionReason,
                    status: 'linked_pending_approval' as const,
                  };

              await ctx.db.patch(transferDetection.matchedTransactionId, {
                suggestedTransfer: updatedSuggestedTransfer,
                updatedAt: timestamp,
              });
              console.log(
                `[TRANSFER] Bidirectional link: updated existing txn ${transferDetection.matchedTransactionId} -> new txn ${newTransactionId}`
              );
            }
          }
        }

        // Reconcile side effects (RTA, merchant stats, category spending)
        // Balance is managed via aggregated updates below, so skip it here
        const newTransaction = await ctx.db.get(newTransactionId);
        if (newTransaction) {
          const afterSnapshot = await buildSnapshotFromTransactionCached(
            ctx,
            newTransaction,
            bankAccountPropertiesCache
          );
          await reconcileTransactionSideEffects(ctx, null, afterSnapshot, { skipBankAccountBalance: true });
          await recordTransactionActivity(ctx, {
            workspaceId: args.workspaceId,
            context: activityContextByBankAccountId.get(newTransaction.bankAccountId) ?? defaultActivityContext,
            type: 'transaction_created',
            after: newTransaction,
          });
        }

        // Track balance update for this bank account (only for new transactions)
        const current = balanceUpdates.get(txnData.bankAccountId) ?? { pending: 0n, cleared: 0n };
        if (txnData.status === 'pending') {
          current.pending += txnData.amount;
        } else {
          current.cleared += txnData.amount;
        }
        balanceUpdates.set(txnData.bankAccountId, current);
      }
    }

    // ==========================================
    // STEP 3D: Link batch-matched transfer pairs
    // ==========================================
    // After all transactions are created, update batch-linked pairs with each other's IDs
    if (batchLinkedTransactions.size > 0) {
      console.log(`\n[STEP 3D] Linking ${batchLinkedTransactions.size} batch-matched transfer pairs`);

      for (const [rawTxnIdStr, { transactionId, linkedRawTransactionId }] of batchLinkedTransactions) {
        // Find the paired transaction
        const pairedEntry = batchLinkedTransactions.get(linkedRawTransactionId.toString());
        if (pairedEntry) {
          // Update this transaction with the paired transaction ID
          const existingTxn = await ctx.db.get(transactionId);
          if (existingTxn?.suggestedTransfer) {
            await ctx.db.patch(transactionId, {
              suggestedTransfer: {
                ...existingTxn.suggestedTransfer,
                matchedTransactionId: pairedEntry.transactionId,
                status: 'linked_pending_approval' as const,
              },
              updatedAt: timestamp,
            });
            console.log(`[TRANSFER] Linked ${transactionId} <-> ${pairedEntry.transactionId}`);
          }
        }
      }
    }

    console.log(`\n[BALANCE][STEP 3] Calculating balance updates`);
    console.log(`[BALANCE]  isFirstSync: ${args.isFirstSync ?? false}`);
    console.log(`[BALANCE]  Number of accounts with balance changes: ${balanceUpdates.size}`);

    for (const [bankAccountId, { pending, cleared }] of balanceUpdates) {
      const bankAccount = allBankAccounts.find((ba) => ba._id === bankAccountId);
      console.log(
        `[BALANCE]  - Account ${bankAccountId} (${bankAccount?.name ?? 'unknown'}): pending=${pending}, cleared=${cleared}, total=${pending + cleared}`
      );
    }

    // Apply balance updates to all affected bank accounts
    // ONLY update balances on subsequent syncs, NOT on first sync
    // On first sync, the currentBalance already reflects the balance INCLUDING these transactions
    if (!args.isFirstSync || allBankAccounts.some((account) => account.plaidInitialSync !== undefined)) {
      console.log(`\n[BALANCE][STEP 3] Applying balance updates (NOT first sync)`);
      // Use today's date for balance history since these are aggregated updates from recent imports
      const todayDate = new Date().toISOString().split('T')[0];
      for (const [bankAccountId, { pending, cleared }] of balanceUpdates) {
        const bankAccount = await ctx.db.get(bankAccountId);
        if (shouldSkipPlaidImportBalance(bankAccount, args.isFirstSync)) continue;
        const oldBalance = bankAccount?.currentBalance ?? 0n;
        const totalDelta = pending + cleared;
        const newBalance = oldBalance + totalDelta;

        console.log(
          `[BALANCE]  - Updating ${bankAccountId}: ${oldBalance} + ${totalDelta} (pending=${pending}, cleared=${cleared}) = ${newBalance}`
        );
        if (pending !== 0n) {
          await updateBankAccountBalance(ctx, bankAccountId, pending, todayDate, 'pending');
        }
        if (cleared !== 0n) {
          await updateBankAccountBalance(ctx, bankAccountId, cleared, todayDate, 'cleared');
        }
      }
    } else {
      console.log(
        `\n[BALANCE][STEP 3] Skipping balance updates (first sync - balance already includes these transactions)`
      );
    }

    // ==========================================
    // STEP 3E: Update rule usage statistics
    // ==========================================
    if (rulesAppliedCount.size > 0) {
      console.log(`\n[STEP 3E] Updating usage stats for ${rulesAppliedCount.size} rules`);
      for (const [ruleId, count] of rulesAppliedCount) {
        const rule = await ctx.db.get(ruleId);
        if (rule) {
          await ctx.db.patch(ruleId, {
            usageCount: (rule.usageCount ?? 0) + count,
            lastUsedAt: timestamp,
            updatedAt: timestamp,
          });
          console.log(`[RULES] Updated rule ${ruleId}: +${count} usages`);
        }
      }
    }

    // Update all raw transaction statuses
    for (const update of statusUpdates) {
      await ctx.db.patch(update.id, {
        importStatus: update.status,
        processedAt: timestamp,
        errorMessage: update.errorMessage,
      });
    }

    // Final balance check
    console.log(`\n[BALANCE][FINAL STATE] Bank account balances after processing`);
    for (const ba of allBankAccounts) {
      const updatedAccount = await ctx.db.get(ba._id);
      console.log(
        `[BALANCE]  - Account ${ba._id} (${ba.name}): ${ba.currentBalance} -> ${updatedAccount?.currentBalance ?? 'deleted'}`
      );
    }

    console.log(`\n[RESULT] Processed: ${processedCount}, Errors: ${errorCount}`);
    console.log(`========== processRawTransactionImports END ==========\n`);

    return {
      processedCount,
      errorCount,
      timestamp,
    };
  },
});
