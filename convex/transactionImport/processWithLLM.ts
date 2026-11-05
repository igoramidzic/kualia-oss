import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction, internalMutation } from '../_generated/server';
import { standardizeMerchantName } from '../lib/merchantUtils';
import {
  buildMerchantCategorizationInput,
  type LLMCategorizationResult,
  merchantInput,
  type MerchantInput,
} from '../llmCategorization/helpers';

/** Result type for the processRawTransactionImports mutation */
interface ImportResult {
  processedCount: number;
  errorCount: number;
  timestamp: string;
}

type MerchantForLLM = MerchantInput;

/**
 * Action wrapper for processing raw transaction imports with Jev categorization.
 *
 * This action:
 * 1. Pre-scans raw transactions to find unique merchants without existing mappings
 * 2. Calls Jev for batch categorization of unknown merchants (in parallel batches of 20)
 * 3. Stores Jev results in mapping table
 * 4. Runs the existing processRawTransactionImports mutation
 */
export const processTransactionImportsWithLLM = internalAction({
  args: {
    workspaceId: v.id('workspace'),
    isFirstSync: v.optional(v.boolean()),
  },
  returns: v.object({ processedCount: v.number(), errorCount: v.number(), timestamp: v.string() }),
  handler: async (ctx, { workspaceId, isFirstSync }): Promise<ImportResult> => {
    console.log(`\n[IMPORT] Starting transaction import with Jev categorization`);
    console.log(`[JEV-IMPORT] Workspace: ${workspaceId}, isFirstSync: ${isFirstSync ?? false}`);

    // Step 1: Pre-scan raw transactions to find unique merchants needing categorization
    const merchantsNeedingLLM: MerchantForLLM[] = await ctx.runMutation(
      internal.transactionImport.processWithLLM.scanMerchantsNeedingCategorization,
      { workspaceId }
    );

    console.log(`[JEV-IMPORT] Found ${merchantsNeedingLLM.length} merchants needing Jev categorization`);

    // Step 2: Call Jev for batch categorization if needed
    if (merchantsNeedingLLM.length > 0) {
      try {
        const llmResults: LLMCategorizationResult[] = await ctx.runAction(
          internal.llmCategorization.action.categorizeMerchantsWithLLM,
          {
            workspaceId,
            merchants: merchantsNeedingLLM,
          }
        );
        console.log(`[JEV-IMPORT] Jev categorized ${llmResults.length} merchants`);

        // Log results summary
        const categorized = llmResults.filter((r: LLMCategorizationResult) => r.categoryId !== null).length;
        const abstained = llmResults.filter((r: LLMCategorizationResult) => r.categoryId === null).length;
        console.log(`[JEV-IMPORT] Categorized: ${categorized}, Abstained: ${abstained}`);
      } catch (error: unknown) {
        console.error('[JEV-IMPORT] Jev categorization failed:', error);
        // Continue with import - transactions will be uncategorized or use history-based predictions
      }
    }

    // Step 3: Run the existing processRawTransactionImports mutation
    // It will now find the Jev mappings in orgMerchantCategoryMapping
    const result: ImportResult = await ctx.runMutation(
      internal.transactionImport.processRawTransactionImports.processRawTransactionImports,
      {
        workspaceId,
        isFirstSync,
      }
    );

    console.log(`[JEV-IMPORT] Import completed: processed=${result.processedCount}, errors=${result.errorCount}`);

    // Send push notification if transactions were inserted
    if (result.processedCount > 0) {
      try {
        await ctx.runAction(internal.notifications.apnsActions.sendTransactionNotificationForWorkspace, {
          workspaceId,
          transactionCount: result.processedCount,
        });
      } catch (error: unknown) {
        // Don't fail the import if notification fails
        console.error('[JEV-IMPORT] Failed to send push notification:', error);
      }
    }

    return result;
  },
});

/**
 * Internal mutation to scan raw transactions and identify merchants needing Jev categorization.
 * Returns a list of unique merchant names that don't have existing mappings.
 *
 * NOTE: This is a lightweight check that only looks at existing mappings.
 * History-based prediction is handled during the actual categorySuggestion phase.
 */
export const scanMerchantsNeedingCategorization = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
  },
  returns: v.array(merchantInput),
  handler: async (ctx, { workspaceId }): Promise<MerchantForLLM[]> => {
    const workspace = await ctx.db.get(workspaceId);
    if (!workspace || workspace.isDeleted) throw new ConvexError('Workspace not found');
    // Get raw transactions awaiting processing (limit to prevent data read overflow)
    const rawTransactions = await ctx.db
      .query('transactionImportRaw')
      .withIndex('by_workspaceId_importStatus', (q) =>
        q.eq('workspaceId', workspaceId).eq('importStatus', 'awaiting_insert_job')
      )
      .take(500); // Limit to prevent data overflow

    if (rawTransactions.length === 0) {
      return [];
    }

    console.log(`[SCAN] Processing ${rawTransactions.length} raw transactions`);

    // Collect unique standardized merchant names with their amount direction
    const merchantsToCheck = new Map<string, MerchantForLLM>();

    for (const rawTxn of rawTransactions) {
      // Inflows use explicit rules, manual mappings, or reviewed history during
      // insertion; otherwise cash inflows default to Ready to Assign.
      if (rawTxn.amount > 0n) continue;

      const merchant = buildMerchantCategorizationInput({
        merchantName: rawTxn.merchantName,
        originalStatement: rawTxn.originalStatement,
        amountDirection: rawTxn.amount >= 0n ? 'positive' : 'negative',
        plaidCategory: rawTxn.plaidCategory,
        personalFinanceCategory: rawTxn.plaidPersonalFinanceCategory,
      });
      if (!merchant) continue;
      // Preserve the existing merchant/direction cache policy: the first pending input supplies context.
      const key = `${merchant.merchantName}|${merchant.amountDirection}`;

      if (!merchantsToCheck.has(key)) {
        merchantsToCheck.set(key, merchant);
      }
    }

    console.log(`[SCAN] Found ${merchantsToCheck.size} unique merchants to check`);

    // Build a Set of standardized merchant names that have valid user suggestions (for expenses)
    // This allows us to skip LLM for merchants where we can use the user's previous categorizations
    const merchantsWithSuggestions = await ctx.db
      .query('merchant')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      // This pre-scan is an optimization. The insert phase still applies user suggestions first.
      .take(1000);

    const merchantNamesWithSuggestions = new Set<string>();
    for (const merchant of merchantsWithSuggestions) {
      if (merchant.isDeleted) continue;
      if (!merchant.suggestedCategoryIds || merchant.suggestedCategoryIds.length === 0) continue;

      // Resolve merchant name (check globalMerchantId if local name is empty)
      let merchantName = merchant.name;
      if (!merchantName && merchant.globalMerchantId) {
        const globalMerchant = await ctx.db.get(merchant.globalMerchantId);
        merchantName = globalMerchant?.name;
      }
      if (!merchantName) continue;

      const standardizedName = standardizeMerchantName(merchantName);
      if (standardizedName) {
        merchantNamesWithSuggestions.add(standardizedName);
      }
    }

    // Check which merchants already have SUCCESSFUL mappings
    // We only skip merchants that have been successfully categorized (either by LLM or manually)
    // Failed LLM attempts should NOT prevent retrying - the new prompt may work better
    const merchantsNeedingLLM: MerchantForLLM[] = [];
    let skippedWithMapping = 0;
    let skippedWithSuggestions = 0;

    for (const merchant of merchantsToCheck.values()) {
      // Check for existing SUCCESSFUL mapping using index (O(1) lookup)
      const existingMapping = await ctx.db
        .query('orgMerchantCategoryMapping')
        .withIndex('by_workspaceId_merchantName_amountDirection', (q) =>
          q
            .eq('workspaceId', workspaceId)
            .eq('merchantName', merchant.merchantName)
            .eq('amountDirection', merchant.amountDirection)
        )
        .first();

      // Only skip if we have a SUCCESSFUL mapping (has category and not failed)
      // Do NOT skip failed mappings - we want to retry with improved prompts
      if (existingMapping && existingMapping.categoryId && !existingMapping.categorizationFailed) {
        skippedWithMapping++;
        continue;
      }

      // Skip LLM for expenses if merchant has user suggestions (will use merchant_suggestion match type)
      if (merchant.amountDirection === 'negative' && merchantNamesWithSuggestions.has(merchant.merchantName)) {
        skippedWithSuggestions++;
        continue;
      }

      // No successful mapping or suggestions - needs LLM categorization
      merchantsNeedingLLM.push(merchant);
    }

    console.log(
      `[SCAN] ${merchantsNeedingLLM.length} merchants need LLM categorization (${skippedWithMapping} with mappings, ${skippedWithSuggestions} with user suggestions)`
    );

    return merchantsNeedingLLM;
  },
});
