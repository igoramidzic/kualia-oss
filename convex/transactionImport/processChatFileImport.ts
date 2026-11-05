import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { internalAction, internalMutation } from '../_generated/server';
import { buildActivityContext, recordTransactionActivity } from '../activityLogs/helpers';
import { activityAttributionValidator } from '../activityLogs/types';
import { updateBankAccountBalance } from '../bankAccounts';
import { dateToYearMonth } from '../categoryBudgets/calculations';
import { standardizeMerchantName } from '../lib/merchantUtils';
import { buildImportFingerprint } from '../lib/transactionFingerprint';
import {
  buildMerchantCategorizationInput,
  type LLMCategorizationResult,
  merchantInput,
  type MerchantInput,
} from '../llmCategorization/helpers';
import {
  findPotentialManualMatchWithCache,
  initializeChatImportMatchingCache,
} from '../transactionLinking/transactionMatching';
import { applyRulesToTransactionData } from '../transactionRules/helpers';
import type { TransactionRule } from '../transactionRules/types';
import { buildTransactionComputedFields } from '../transactions/helpers';
import {
  buildBankAccountPropertiesCache,
  buildSnapshotFromTransactionCached,
} from '../transactions/reconciliation/buildSnapshot';
import { reconcileTransactionSideEffects } from '../transactions/reconciliation/reconcile';

import {
  initializeCategorySuggestionCache,
  suggestCategoryForTransactionWithCache,
  type CategorySuggestionResult,
} from './categorySuggestion';

/** Confidence at which a fuzzy match is treated as a hard duplicate (skipped silently). */
const DUPLICATE_AUTO_SKIP_CONFIDENCE = 85;

const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;

/**
 * Per-row input shape the chat tool collects from the agent (which extracted them from a CSV /
 * statement PDF / receipt image). Amount is signed minor units (e.g. "-4250" for $42.50 USD spend).
 */
const transactionMovementInput = v.object({
  amount: v.int64(),
  categoryId: v.optional(v.id('category')),
  readyToAssign: v.optional(v.boolean()),
  notes: v.optional(v.string()),
});

const transactionInput = v.object({
  date: v.string(),
  amount: v.int64(),
  merchantName: v.string(),
  categoryId: v.optional(v.id('category')),
  notes: v.optional(v.string()),
  movements: v.optional(v.array(transactionMovementInput)),
});

export type ChatFileImportInput = {
  date: string;
  amount: bigint;
  merchantName: string;
  categoryId?: Id<'category'>;
  notes?: string;
  movements?: ChatFileImportMovementInput[];
};

export type ChatFileImportMovementInput = {
  amount: bigint;
  categoryId?: Id<'category'>;
  readyToAssign?: boolean;
  notes?: string;
};

export type ChatFileImportCreatedMovement = {
  amount: bigint;
  categoryId: Id<'category'> | null;
  readyToAssign: boolean;
  notes?: string;
};

export type ChatFileImportRow = {
  transactionId: Id<'transaction'>;
  inputIndex: number;
  date: string;
  amount: bigint;
  merchantName: string;
  categoryId: Id<'category'> | null;
  movements: ChatFileImportCreatedMovement[];
  matchType: NonNullable<CategorySuggestionResult['matchType']> | 'agent_provided' | 'uncategorized';
  /** When the row inserted but a fuzzy match suggested it might be a duplicate. */
  suggestedLinkId?: Id<'transaction'>;
  suggestedLinkConfidence?: number;
};

export type ChatFileImportSkippedRow = {
  inputIndex: number;
  date: string;
  amount: bigint;
  merchantName: string;
  reason: 'exact_duplicate' | 'within_batch_duplicate' | 'fuzzy_duplicate';
  matchedTransactionId?: Id<'transaction'>;
  confidence?: number; // present for fuzzy_duplicate
};

export type ChatFileImportResult = {
  workspaceId: Id<'workspace'>;
  bankAccountId: Id<'bankAccount'>;
  created: ChatFileImportRow[];
  skipped: ChatFileImportSkippedRow[];
  failed: Array<{ inputIndex: number; reason: string }>;
};

type MerchantLLMRequest = MerchantInput;

/**
 * Look at the input rows and return the set of unique merchants whose category should be
 * predicted by Jev (no agent-provided categoryId, no existing successful mapping in
 * orgMerchantCategoryMapping, no user merchant suggestion). Mirrors `scanMerchantsNeedingCategorization`
 * in [processWithLLM.ts](convex/transactionImport/processWithLLM.ts) but for in-memory inputs.
 */
export const scanChatInputsForLLM = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    transactions: v.array(transactionInput),
  },
  returns: v.array(merchantInput),
  handler: async (ctx, { workspaceId, transactions }): Promise<MerchantLLMRequest[]> => {
    if (transactions.length === 0) return [];

    // Build the dedupe key set from inputs that need a suggestion at all.
    const candidates = new Map<string, MerchantLLMRequest>();
    for (const txn of transactions) {
      // Explicit split movements should persist as provided. Do not ask the LLM to infer a
      // whole-transaction category and then apply it to a split row.
      if (txn.movements && txn.movements.length > 0) continue;
      // Skip rows where the agent already picked a category — they don't need an LLM call.
      if (txn.categoryId) continue;
      const merchant = buildMerchantCategorizationInput({
        merchantName: txn.merchantName,
        originalStatement: txn.merchantName,
        amountDirection: txn.amount >= 0n ? 'positive' : 'negative',
      });
      if (!merchant) continue;
      const key = `${merchant.merchantName}|${merchant.amountDirection}`;
      if (!candidates.has(key)) {
        candidates.set(key, merchant);
      }
    }
    if (candidates.size === 0) return [];

    // Skip merchants that already have a successful mapping (manual or prior LLM run).
    const merchantsWithSuggestionsLookup = new Set<string>();
    const merchants = await ctx.db
      .query('merchant')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();
    for (const merchant of merchants) {
      if (!merchant.suggestedCategoryIds || merchant.suggestedCategoryIds.length === 0) continue;
      let merchantName = merchant.name;
      if (!merchantName && merchant.globalMerchantId) {
        const globalMerchant = await ctx.db.get(merchant.globalMerchantId);
        merchantName = globalMerchant?.name;
      }
      if (!merchantName) continue;
      const standardized = standardizeMerchantName(merchantName);
      if (standardized) merchantsWithSuggestionsLookup.add(standardized);
    }

    const out: MerchantLLMRequest[] = [];
    for (const candidate of candidates.values()) {
      const existingMapping = await ctx.db
        .query('orgMerchantCategoryMapping')
        .withIndex('by_workspaceId_merchantName_amountDirection', (q) =>
          q
            .eq('workspaceId', workspaceId)
            .eq('merchantName', candidate.merchantName)
            .eq('amountDirection', candidate.amountDirection)
        )
        .first();
      if (existingMapping && existingMapping.categoryId && !existingMapping.categorizationFailed) continue;
      // For expenses, the user's prior categorizations on this merchant are good enough — skip LLM.
      if (candidate.amountDirection === 'negative' && merchantsWithSuggestionsLookup.has(candidate.merchantName)) {
        continue;
      }
      out.push(candidate);
    }
    return out;
  },
});

/**
 * Insert the chat-imported transactions. Runs after any LLM categorization has populated
 * orgMerchantCategoryMapping so the categorySuggestion cache picks the freshest mappings up.
 *
 * Per row we resolve in this priority order:
 *  1. Agent-provided categoryId (validated against this workspace).
 *  2. Active transaction rule match.
 *  3. categorySuggestion cache (mapping → user merchant suggestion → history vote).
 * Anything still uncategorized is inserted with no category — the row stays needs_review and
 * the user can fix it from the transactions page.
 */
export const insertChatImportedTransactions = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    bankAccountId: v.id('bankAccount'),
    transactions: v.array(transactionInput),
    forceInsert: v.optional(v.boolean()),
    attribution: activityAttributionValidator,
  },
  handler: async (
    ctx,
    { workspaceId, bankAccountId, transactions, forceInsert = false, attribution }
  ): Promise<ChatFileImportResult> => {
    const bankAccount = await ctx.db.get(bankAccountId);
    if (!bankAccount || bankAccount.isDeleted || bankAccount.workspaceId !== workspaceId) {
      throw new ConvexError('Bank account not found or does not belong to this workspace');
    }

    const activityContext = await buildActivityContext(ctx, attribution);
    const timestamp = new Date().toISOString();

    // Pre-load shared state once.
    const categorySuggestionCache = await initializeCategorySuggestionCache(ctx, workspaceId);
    const validCategoryIds = categorySuggestionCache.eligibleCategoryIds;
    const bankAccountPropertiesCache = await buildBankAccountPropertiesCache(ctx, [bankAccountId]);

    // Dedup state (only built when not forcing — saves a query when the user already confirmed
    // they want the rows imported anyway).
    const matchingCache = forceInsert ? null : await initializeChatImportMatchingCache(ctx, workspaceId, bankAccountId);
    const seenFingerprintsInBatch = new Set<string>();

    const allRules = await ctx.db
      .query('transactionRule')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.and(q.eq(q.field('isActive'), true), q.eq(q.field('isDeleted'), false)))
      .collect();
    const sortedRules: TransactionRule[] = allRules.sort((a, b) => a.priority - b.priority);

    // Existing merchants for case-insensitive lookup. New ones are queued and created on the fly.
    const existingMerchants = await ctx.db
      .query('merchant')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    const merchantByName = new Map<string, Doc<'merchant'>>(); // key: lowercased resolved name
    for (const merchant of existingMerchants) {
      let resolvedName = merchant.name;
      if (!resolvedName && merchant.globalMerchantId) {
        const globalMerchant = await ctx.db.get(merchant.globalMerchantId);
        resolvedName = globalMerchant?.name;
      }
      if (resolvedName) merchantByName.set(resolvedName.toLowerCase(), merchant);
    }

    const merchantNameCacheForRules = new Map<Id<'merchant'>, string | undefined>();
    for (const merchant of existingMerchants) {
      merchantNameCacheForRules.set(merchant._id, merchant.name);
    }

    const created: ChatFileImportRow[] = [];
    const skipped: ChatFileImportSkippedRow[] = [];
    const failed: Array<{ inputIndex: number; reason: string }> = [];

    for (let i = 0; i < transactions.length; i++) {
      const txn = transactions[i];
      try {
        if (txn.amount === 0n) {
          failed.push({ inputIndex: i, reason: 'Transaction amount cannot be zero' });
          continue;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(txn.date) || Number.isNaN(new Date(txn.date).getTime())) {
          failed.push({ inputIndex: i, reason: 'Invalid date — expected YYYY-MM-DD' });
          continue;
        }

        // Layered dedup. Skipped on `forceInsert: true` so a user-confirmed re-run actually inserts.
        const fingerprint = buildImportFingerprint({
          date: txn.date,
          amount: txn.amount,
          merchantName: txn.merchantName,
        });
        let suggestedLinkOnInsert: { id: Id<'transaction'>; confidence: number; reason: string } | undefined;

        if (!forceInsert) {
          // 1. Within-batch duplicate (same fingerprint already processed in this run).
          if (seenFingerprintsInBatch.has(fingerprint)) {
            skipped.push({
              inputIndex: i,
              date: txn.date,
              amount: txn.amount,
              merchantName: txn.merchantName.trim(),
              reason: 'within_batch_duplicate',
            });
            continue;
          }

          // 2. Exact fingerprint match against an existing transaction on this account.
          const existingByFingerprint = await ctx.db
            .query('transaction')
            .withIndex('by_workspaceId_bankAccountId_importFingerprint', (q) =>
              q.eq('workspaceId', workspaceId).eq('bankAccountId', bankAccountId).eq('importFingerprint', fingerprint)
            )
            .filter((q) => q.eq(q.field('isDeleted'), false))
            .first();
          if (existingByFingerprint) {
            seenFingerprintsInBatch.add(fingerprint);
            skipped.push({
              inputIndex: i,
              date: txn.date,
              amount: txn.amount,
              merchantName: txn.merchantName.trim(),
              reason: 'exact_duplicate',
              matchedTransactionId: existingByFingerprint._id,
            });
            continue;
          }

          // 3. Fuzzy match (reuse Plaid linker scoring) against ALL regular transactions on the
          // account. ≥85 → skip; 65-84 → insert with suggestedLinkId so the review UI surfaces it.
          if (matchingCache) {
            const candidate = findPotentialManualMatchWithCache(
              {
                workspaceId,
                bankAccountId,
                amount: txn.amount,
                date: txn.date,
                merchantName: txn.merchantName.trim() || undefined,
              },
              matchingCache
            );
            if (candidate && candidate.confidence >= DUPLICATE_AUTO_SKIP_CONFIDENCE) {
              seenFingerprintsInBatch.add(fingerprint);
              skipped.push({
                inputIndex: i,
                date: txn.date,
                amount: txn.amount,
                merchantName: txn.merchantName.trim(),
                reason: 'fuzzy_duplicate',
                matchedTransactionId: candidate.manualTransactionId,
                confidence: candidate.confidence,
              });
              continue;
            }
            if (candidate) {
              suggestedLinkOnInsert = {
                id: candidate.manualTransactionId,
                confidence: candidate.confidence,
                reason: candidate.reason,
              };
            }
          }
        }
        seenFingerprintsInBatch.add(fingerprint);

        // Resolve / create the org-level merchant. New merchants get a globalMerchant record too,
        // so future imports across workspaces can share the canonical entity.
        let merchantId: Id<'merchant'> | undefined;
        const trimmedMerchantName = txn.merchantName.trim();
        if (trimmedMerchantName.length > 0) {
          const existing = merchantByName.get(trimmedMerchantName.toLowerCase());
          if (existing) {
            merchantId = existing._id;
          } else {
            const existingGlobal = await ctx.db
              .query('globalMerchant')
              .withIndex('by_name', (q) => q.eq('name', trimmedMerchantName))
              .first();
            const globalMerchantId = existingGlobal
              ? existingGlobal._id
              : await ctx.db.insert('globalMerchant', {
                  name: trimmedMerchantName,
                  isVerified: false,
                  updatedAt: timestamp,
                });
            merchantId = await ctx.db.insert('merchant', {
              workspaceId,
              globalMerchantId,
              name: undefined,
              logoUrl: undefined,
              isDeleted: false,
              updatedAt: timestamp,
            });
            merchantByName.set(trimmedMerchantName.toLowerCase(), {
              _id: merchantId,
              workspaceId,
              globalMerchantId,
              name: undefined,
              logoUrl: undefined,
              isDeleted: false,
              updatedAt: timestamp,
              deletedAt: undefined,
              _creationTime: Date.now(),
            } as Doc<'merchant'>);
            merchantNameCacheForRules.set(merchantId, undefined);
          }
        }

        const hasExplicitMovements = txn.movements !== undefined && txn.movements.length > 0;

        // Decide on the category in priority order for single-movement imports. Explicit split
        // rows bypass this so each movement's category / Ready-to-Assign / uncategorized state is
        // preserved exactly as the caller provided it.
        let categoryId: Id<'category'> | undefined;
        let matchType: ChatFileImportRow['matchType'] = 'uncategorized';

        if (!hasExplicitMovements && txn.categoryId) {
          // Validate the agent-provided category — wrong workspace or deleted means we ignore it.
          if (validCategoryIds.has(txn.categoryId)) {
            categoryId = txn.categoryId;
            matchType = 'agent_provided';
          }
        }

        if (!hasExplicitMovements && !categoryId && sortedRules.length > 0) {
          const ruleResult = applyRulesToTransactionData(
            {
              merchantId,
              rawMerchantName: trimmedMerchantName || undefined,
              amount: txn.amount,
              bankAccountId,
              importDetails: {
                originalStatement: undefined,
                merchantName: trimmedMerchantName || undefined,
              },
            },
            sortedRules,
            merchantNameCacheForRules
          );
          if (ruleResult.appliedRuleId) {
            if (ruleResult.data.merchantId !== undefined) merchantId = ruleResult.data.merchantId;
            if (ruleResult.data.categoryId !== undefined) {
              categoryId = ruleResult.data.categoryId;
              matchType = 'rule_applied';
            }
          }
        }

        if (!hasExplicitMovements && !categoryId) {
          const suggestion = await suggestCategoryForTransactionWithCache(
            ctx,
            workspaceId,
            {
              merchantName: trimmedMerchantName || undefined,
              originalStatement: undefined,
              amount: txn.amount,
              plaidCategory: [],
              date: txn.date,
              bankAccountId,
            },
            categorySuggestionCache
          );
          if (suggestion.categoryId) {
            categoryId = suggestion.categoryId;
            matchType = suggestion.matchType ?? 'uncategorized';
          }
        }

        // Build the embedded movements, with credit-card transfer metadata when applicable.
        const accountProps = bankAccountPropertiesCache.get(bankAccountId);
        const movementInput = hasExplicitMovements
          ? txn.movements!.map((movement, movementIndex) => {
              if (movement.amount === 0n) {
                throw new Error(`Movement ${movementIndex + 1} amount cannot be zero`);
              }
              if (movement.categoryId && !validCategoryIds.has(movement.categoryId)) {
                throw new Error(`Movement ${movementIndex + 1} category not found in this workspace`);
              }
              const readyToAssign = movement.readyToAssign ?? false;
              if (readyToAssign && movement.categoryId) {
                throw new Error(`Movement ${movementIndex + 1} cannot be both categorized and Ready to Assign`);
              }
              const creditCardTransfer =
                accountProps?.isCreditCardAccount && accountProps.creditCardCategoryId && movement.categoryId
                  ? {
                      creditCardCategoryId: accountProps.creditCardCategoryId,
                      spendingCategoryId: movement.categoryId,
                    }
                  : undefined;

              return {
                categoryId: movement.categoryId,
                readyToAssign,
                amount: movement.amount,
                notes: movement.notes,
                sortOrder: movementIndex,
                creditCardTransfer,
              };
            })
          : [
              {
                categoryId,
                readyToAssign: false,
                amount: txn.amount,
                notes: txn.notes,
                sortOrder: 0,
                creditCardTransfer:
                  accountProps?.isCreditCardAccount && accountProps.creditCardCategoryId && categoryId
                    ? {
                        creditCardCategoryId: accountProps.creditCardCategoryId,
                        spendingCategoryId: categoryId,
                      }
                    : undefined,
              },
            ];

        if (hasExplicitMovements) {
          const movementsTotal = movementInput.reduce((sum, movement) => sum + movement.amount, 0n);
          if (movementsTotal !== txn.amount) {
            throw new Error(
              `Movement amounts must sum to transaction amount. Expected ${txn.amount}, got ${movementsTotal}`
            );
          }
          matchType = movementInput.some((movement) => movement.categoryId || movement.readyToAssign)
            ? 'agent_provided'
            : 'uncategorized';
          categoryId = movementInput.length === 1 ? movementInput[0].categoryId : undefined;
        }

        const computedFields = await buildTransactionComputedFields(ctx, {
          merchantId,
          bankAccountId,
          transactionType: 'regular',
          movements: movementInput,
          notes: txn.notes,
        });

        const transactionId = await ctx.db.insert('transaction', {
          bankAccountId,
          date: txn.date,
          merchantId,
          notes: txn.notes,
          status: 'cleared',
          type: 'regular',
          source: 'chat_import',
          importFingerprint: fingerprint,
          reviewStatus: 'needs_review',
          isDeleted: false,
          workspaceId,
          dateYearMonth: dateToYearMonth(txn.date),
          updatedAt: timestamp,
          movements: computedFields.movements,
          searchText: computedFields.searchText,
          totalAmount: computedFields.totalAmount,
          hasUncategorized: computedFields.hasUncategorized,
          hasMissingPayee: computedFields.hasMissingPayee,
          suggestedLinkId: suggestedLinkOnInsert?.id,
          suggestedLinkConfidence: suggestedLinkOnInsert?.confidence,
          suggestedLinkReason: suggestedLinkOnInsert?.reason,
        });

        // Apply RTA / category spending / merchant stats side effects (no balance — that's batched below).
        const inserted = await ctx.db.get(transactionId);
        if (inserted) {
          const afterSnapshot = await buildSnapshotFromTransactionCached(ctx, inserted, bankAccountPropertiesCache);
          await reconcileTransactionSideEffects(ctx, null, afterSnapshot, { skipBankAccountBalance: true });
          await recordTransactionActivity(ctx, {
            workspaceId,
            context: activityContext,
            type: 'transaction_created',
            after: inserted,
          });
        }

        await updateBankAccountBalance(ctx, bankAccountId, txn.amount, txn.date, 'cleared');

        created.push({
          transactionId,
          inputIndex: i,
          date: txn.date,
          amount: txn.amount,
          merchantName: trimmedMerchantName,
          categoryId: categoryId ?? null,
          movements: computedFields.movements.map((movement) => ({
            amount: movement.amount,
            categoryId: movement.categoryId ?? null,
            readyToAssign: movement.readyToAssign,
            notes: movement.notes,
          })),
          matchType,
          suggestedLinkId: suggestedLinkOnInsert?.id,
          suggestedLinkConfidence: suggestedLinkOnInsert?.confidence,
        });
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : 'Unknown error';
        failed.push({ inputIndex: i, reason });
      }
    }

    return {
      workspaceId,
      bankAccountId,
      created,
      skipped,
      failed,
    };
  },
});

/**
 * Action entry point for the in-app chat / public MCP `kualia_create_transactions` tool.
 *
 * Order of operations:
 *  1. Validate inputs and bank account access (mutation pre-pass).
 *  2. Scan for merchants needing Jev categorization.
 *  3. Batch Jev categorize via `categorizeMerchantsWithLLM` — this writes to
 *     orgMerchantCategoryMapping, which the insert mutation reads transparently.
 *  4. Insert the rows; rules → history → mapping (now Jev-populated) is applied per row.
 */
export const processChatFileImport = internalAction({
  args: {
    workspaceId: v.id('workspace'),
    bankAccountId: v.id('bankAccount'),
    transactions: v.array(transactionInput),
    forceInsert: v.optional(v.boolean()),
    attribution: activityAttributionValidator,
  },
  handler: async (
    ctx,
    { workspaceId, bankAccountId, transactions, forceInsert, attribution }
  ): Promise<ChatFileImportResult> => {
    if (transactions.length === 0) {
      return { workspaceId, bankAccountId, created: [], skipped: [], failed: [] };
    }
    for (const txn of transactions) {
      if (txn.amount < INT64_MIN || txn.amount > INT64_MAX) {
        throw new ConvexError('Transaction amount overflows 64-bit integer range');
      }
    }

    const merchantsForLLM = await ctx.runMutation(
      internal.transactionImport.processChatFileImport.scanChatInputsForLLM,
      {
        workspaceId,
        transactions,
      }
    );

    if (merchantsForLLM.length > 0) {
      try {
        const llmResults: LLMCategorizationResult[] = await ctx.runAction(
          internal.llmCategorization.action.categorizeMerchantsWithLLM,
          {
            workspaceId,
            merchants: merchantsForLLM,
          }
        );
        const categorized = llmResults.filter((r) => r.categoryId !== null).length;
        console.log(`[CHAT-IMPORT] Jev categorized ${categorized}/${llmResults.length} merchants`);
      } catch (error: unknown) {
        // Never fail the whole import on a categorization hiccup — those rows just stay
        // uncategorized and the user can fix them from the needs-review queue.
        console.error('[CHAT-IMPORT] Jev categorization failed:', error);
      }
    }

    return await ctx.runMutation(internal.transactionImport.processChatFileImport.insertChatImportedTransactions, {
      workspaceId,
      bankAccountId,
      transactions,
      forceInsert,
      attribution,
    });
  },
});
