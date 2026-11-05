'use node';

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { env, internalAction } from '../_generated/server';
import { getPostHogClient, shutdownPostHog } from '../lib/posthog';
import { applyTypeSafeFallback, failedAnswer, merchantBatches, TYPESAFE_FALLBACK_MIN_PROBABILITY } from './comparison';
import { type CategoryInput, chunkArray, type LLMCategorizationResult, merchantInput } from './helpers';
import type { MappingResult } from './mutations';
import { categorizeWithTypeSafe } from './providers';

const categorizationResult = v.object({
  merchantName: v.string(),
  categoryId: v.union(v.id('category'), v.null()),
  confidence: v.number(),
  reason: v.optional(v.string()),
});

/**
 * Live categorization uses Jev with the approved plaid_v2 prompt and 20% Uncategorized fallback.
 * Keep the historical function name for existing import callers and queued work.
 * The Gemini provider is used only by the explicit comparison action.
 */
export const categorizeMerchantsWithLLM = internalAction({
  args: { workspaceId: v.id('workspace'), merchants: v.array(merchantInput) },
  returns: v.array(categorizationResult),
  handler: async (ctx, { workspaceId, merchants }): Promise<LLMCategorizationResult[]> => {
    if (merchants.length === 0) return [];
    if (!env.TYPESAFE_API_KEY) {
      console.warn('[CATEGORIZATION] TYPESAFE_API_KEY not configured');
      return merchants.map((merchant) => ({
        merchantName: merchant.merchantName,
        categoryId: null,
        confidence: 0,
        reason: 'TYPESAFE_API_KEY not configured',
      }));
    }
    const hierarchy = await ctx.runQuery(internal.categories.queries.internalListCategoriesHierarchical, {
      workspaceId,
      type: 'expense',
      includeArchived: false,
    });
    const categories: CategoryInput[] = hierarchy.flatMap((group) =>
      group.categories.map((category) => ({
        id: category._id,
        name: category.name,
        groupName: group.group.name,
      }))
    );
    if (categories.length === 0)
      return merchants.map((merchant) => ({
        merchantName: merchant.merchantName,
        categoryId: null,
        confidence: 0,
        reason: 'No categories available',
      }));

    const batches = merchantBatches(merchants);
    const allResults: LLMCategorizationResult[] = [];
    const mappings: MappingResult[] = [];
    try {
      // At most two concurrent API requests; questions within each batch run together.
      for (const group of chunkArray(batches, 2)) {
        const completed = await Promise.all(
          group.map(async (batch) => {
            try {
              const response = await categorizeWithTypeSafe(batch, categories, 'plaid_v2');
              let fallbackCount = 0;
              const results = batch.map((merchant, index) => {
                const raw = response.answers[index] ?? failedAnswer('Missing TypeSafe answer');
                const selected = applyTypeSafeFallback(raw, TYPESAFE_FALLBACK_MIN_PROBABILITY);
                const usedFallback = selected !== raw;
                if (usedFallback) fallbackCount++;
                const result: LLMCategorizationResult = {
                  merchantName: merchant.merchantName,
                  categoryId: selected.error === null ? selected.categoryId : null,
                  // Existing consumers expect a number. Use category probability, including for fallbacks.
                  confidence: selected.error === null ? (selected.selectedProbability ?? 0) : 0,
                  reason:
                    selected.error ??
                    selected.reason ??
                    (selected.categoryId ? 'TypeSafe category choice' : 'TypeSafe abstained'),
                };
                const mapping: MappingResult | null =
                  selected.error === null
                    ? {
                        ...result,
                        amountDirection: merchant.amountDirection,
                        failed: result.categoryId === null,
                        failureReason: result.categoryId === null ? result.reason : undefined,
                        model: response.model,
                        modelConfidence: raw.confidence ?? undefined,
                        usedFallback,
                      }
                    : null;
                return { result, mapping };
              });
              const counts = {
                model: response.model,
                merchants: batch.length,
                categorized: results.filter(({ result }) => result.categoryId !== null).length,
                errors: results.filter(({ mapping }) => mapping === null).length,
                fallbacks: fallbackCount,
                elapsedMs: response.elapsedMs,
                inputTokens: response.inputTokens,
                outputTokens: response.outputTokens,
              };
              console.log('[CATEGORIZATION]', JSON.stringify(counts));
              try {
                getPostHogClient()?.capture({
                  distinctId: workspaceId,
                  event: '$ai_generation',
                  properties: {
                    feature: 'merchant_categorization',
                    $ai_provider: 'typesafe',
                    $ai_model: response.model,
                    $ai_input_tokens: response.inputTokens,
                    $ai_output_tokens: response.outputTokens,
                    $ai_latency: response.elapsedMs / 1000,
                    $ai_is_error: counts.errors > 0,
                    batchSize: batch.length,
                    categoryCount: categories.length,
                    categorized: counts.categorized,
                    fallbackCount,
                    variant: 'plaid_v2',
                    fallbackMinProbability: TYPESAFE_FALLBACK_MIN_PROBABILITY,
                  },
                });
              } catch (error: unknown) {
                console.warn(
                  '[CATEGORIZATION] Analytics failed:',
                  error instanceof Error ? error.message : 'Unknown error'
                );
              }
              return results;
            } catch (error: unknown) {
              const reason = error instanceof Error ? error.message : 'TypeSafe request failed';
              console.warn('[CATEGORIZATION] Batch failed:', reason);
              return batch.map((merchant) => ({
                result: { merchantName: merchant.merchantName, categoryId: null, confidence: 0, reason },
                mapping: null,
              }));
            }
          })
        );
        for (const { result, mapping } of completed.flat()) {
          allResults.push(result);
          if (mapping) mappings.push(mapping);
        }
      }
      // Service failures never replace a mapping or become cached abstentions.
      if (mappings.length > 0)
        await ctx.runMutation(internal.llmCategorization.mutations.storeMappings, {
          workspaceId,
          source: 'typesafe',
          results: mappings,
        });
      return allResults;
    } finally {
      try {
        await shutdownPostHog();
      } catch (error: unknown) {
        console.warn(
          '[CATEGORIZATION] Analytics flush failed:',
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    }
  },
});

/** Convenience wrapper; existing callers now receive Jev decisions through the same contract. */
export const categorizeSingleMerchant = internalAction({
  args: {
    workspaceId: v.id('workspace'),
    merchantName: v.string(),
    amountDirection: v.union(v.literal('positive'), v.literal('negative')),
  },
  returns: categorizationResult,
  handler: async (ctx, { workspaceId, merchantName, amountDirection }): Promise<LLMCategorizationResult> => {
    const results = await ctx.runAction(internal.llmCategorization.action.categorizeMerchantsWithLLM, {
      workspaceId,
      merchants: [{ merchantName, amountDirection }],
    });
    return results[0] ?? { merchantName, categoryId: null, confidence: 0, reason: 'No result returned' };
  },
});
