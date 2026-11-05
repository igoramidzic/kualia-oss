'use node';

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import {
  type BenchmarkInfo,
  type ComparisonReport,
  type ComparisonSample,
  compareCategorization,
  comparisonReport,
  comparisonVariant,
  MAX_COMPARISON_TRANSACTIONS,
  plaidComparisonTransaction,
  printComparisonSummary,
} from './comparison';
import type { CategoryInput } from './helpers';
import { categorizeWithLlm, categorizeWithTypeSafe } from './providers';

/**
 * Compare Gemini and Jev as if Plaid merchants were being categorized for the first time.
 * No inserts, mapping updates, or notifications. Both external APIs incur normal inference usage.
 *
 * Run the fixed development benchmark (defaults to its first 20, maximum 50):
 * pnpm exec convex run llmCategorization/comparisonActions:simulatePlaidImport '{"workspaceId":"...","limit":20}'
 *
 * Or supply Plaid wire inputs (positive amount = purchase; negative = refund/inflow):
 * { workspaceId, transactions: [{ name: "MTA NYCT PAYGO", merchant_name: "MTA", amount: 8.75,
 *   category: ["Travel", "Public Transportation Services"], expectedCategoryId: "..." }] }
 * Expected labels are optional and never sent to either provider. includeRequests adds exact
 * serialized request/response bodies to the returned batches; ordinary logs only print the summary.
 * source: "recent" explicitly selects the previous most-recent-imports behavior.
 * variant: "plaid_v2" tests full statements, current Plaid hints, and readable Jev choices.
 * variant: "baseline" preserves the original comparison. The frozen cases and answer key are identical.
 * typesafeFallbackMinProbability: 0.2 promotes the best category at >=20% when Jev selects
 * Uncategorized. Omit or pass null to disable. The report scores raw and fallback decisions
 * from the same API responses; this comparison policy does not change production categorization.
 */
export const simulatePlaidImport = internalAction({
  args: {
    workspaceId: v.id('workspace'),
    transactions: v.optional(v.array(plaidComparisonTransaction)),
    limit: v.optional(v.number()),
    includeRequests: v.optional(v.boolean()),
    source: v.optional(v.union(v.literal('benchmark'), v.literal('recent'))),
    variant: v.optional(comparisonVariant),
    typesafeFallbackMinProbability: v.optional(v.union(v.number(), v.null())),
  },
  returns: comparisonReport,
  handler: async (
    ctx,
    {
      workspaceId,
      transactions,
      limit = 20,
      includeRequests = false,
      source,
      variant = 'baseline',
      typesafeFallbackMinProbability = null,
    }
  ): Promise<ComparisonReport> => {
    if (transactions && (transactions.length === 0 || transactions.length > MAX_COMPARISON_TRANSACTIONS)) {
      throw new Error(`Supply between 1 and ${MAX_COMPARISON_TRANSACTIONS} transactions`);
    }
    if (transactions && source !== undefined) throw new Error('Supply transactions or source, not both');
    const data: { categories: CategoryInput[]; samples: ComparisonSample[]; benchmark?: BenchmarkInfo } =
      await ctx.runQuery(internal.llmCategorization.comparisonData.loadComparisonData, {
        workspaceId,
        limit: transactions ? 0 : limit,
        source: transactions ? 'recent' : (source ?? 'benchmark'),
      });
    const samples: ComparisonSample[] = transactions
      ? transactions.map((transaction) => ({
          transaction,
          expectedSource: transaction.expectedCategoryId === undefined ? 'none' : 'provided',
        }))
      : data.samples;
    if (samples.length === 0)
      throw new Error('No recent Plaid imports in this workspace. Supply transactions explicitly.');
    const report = await compareCategorization(
      samples,
      data.categories,
      {
        llm: categorizeWithLlm,
        typesafe: (merchants, categories) => categorizeWithTypeSafe(merchants, categories, variant),
      },
      variant,
      typesafeFallbackMinProbability
    );
    if (data.benchmark) {
      report.benchmark = data.benchmark;
      report.notes.unshift(
        `Fixed benchmark ${data.benchmark.id}: the first ${samples.length} of ${data.benchmark.availableTransactions} reviewed cases, with frozen inputs, category options, and saved database answers. Repeat with the same limit to keep the same batch composition.`
      );
    }
    printComparisonSummary(report);
    if (!includeRequests) {
      for (const batch of report.batches) {
        batch.llm.requestJson = '';
        batch.llm.responseJson = null;
        batch.typesafe.requestJson = '';
        batch.typesafe.responseJson = null;
      }
    }
    return report;
  },
});
