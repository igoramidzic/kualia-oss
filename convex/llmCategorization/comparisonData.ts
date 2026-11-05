import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalQuery } from '../_generated/server';
import { loadCategorizationBenchmark } from './benchmark';
import {
  type BenchmarkInfo,
  benchmarkInfo,
  type ComparisonSample,
  comparisonSample,
  MAX_COMPARISON_TRANSACTIONS,
} from './comparison';
import type { CategoryInput } from './helpers';

/** Admin/CLI-only data loader. Every lookup is scoped to the supplied workspace. */
export const loadComparisonData = internalQuery({
  args: {
    workspaceId: v.id('workspace'),
    limit: v.number(),
    source: v.optional(v.union(v.literal('benchmark'), v.literal('recent'))),
  },
  returns: v.object({
    categories: v.array(v.object({ id: v.id('category'), name: v.string(), groupName: v.string() })),
    samples: v.array(comparisonSample),
    benchmark: v.optional(benchmarkInfo),
  }),
  handler: async (
    ctx,
    { workspaceId, limit, source = 'recent' }
  ): Promise<{
    categories: Array<CategoryInput & { id: Id<'category'> }>;
    samples: ComparisonSample[];
    benchmark?: BenchmarkInfo;
  }> => {
    const workspace = await ctx.db.get(workspaceId);
    if (!workspace || workspace.isDeleted) throw new ConvexError('Workspace not found');
    if (!Number.isInteger(limit) || limit < 0 || limit > MAX_COMPARISON_TRANSACTIONS) {
      throw new ConvexError(`limit must be an integer from 0 to ${MAX_COMPARISON_TRANSACTIONS}`);
    }
    if (source === 'benchmark') return loadCategorizationBenchmark(workspaceId, limit);
    const hierarchy = await ctx.runQuery(internal.categories.queries.internalListCategoriesHierarchical, {
      workspaceId,
      type: 'expense',
      includeArchived: false,
    });
    const categories = hierarchy.flatMap((group) =>
      group.categories.map((category) => ({
        id: category._id,
        name: category.name,
        groupName: group.group.name,
      }))
    );
    const categoryIds = new Set(categories.map((category: CategoryInput) => category.id));
    const raw =
      limit === 0
        ? []
        : await ctx.db
            .query('transactionImportRaw')
            .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
            .order('desc')
            .take(limit);
    const samples: ComparisonSample[] = [];
    for (const transaction of raw) {
      const imported = await ctx.db
        .query('transaction')
        .withIndex('by_transactionImportRawId', (q) => q.eq('transactionImportRawId', transaction._id))
        .first();
      const linked =
        imported ??
        (await ctx.db
          .query('transaction')
          .withIndex('by_workspaceId_linkedRawTransactionId', (q) =>
            q.eq('workspaceId', workspaceId).eq('linkedRawTransactionId', transaction._id)
          )
          .first());
      const movement = linked?.movements.length === 1 ? linked.movements[0] : undefined;
      const expectedCategoryId =
        linked?.workspaceId === workspaceId &&
        !linked.isDeleted &&
        linked.reviewStatus === 'reviewed' &&
        linked.type === 'regular' &&
        !movement?.readyToAssign &&
        movement?.categoryId &&
        categoryIds.has(movement.categoryId)
          ? movement.categoryId
          : undefined;
      samples.push({
        expectedSource: expectedCategoryId ? 'reviewed_transaction' : 'none',
        transaction: {
          // Use local row IDs for traceability instead of Plaid transaction IDs.
          transaction_id: transaction._id,
          date: transaction.date,
          name: transaction.originalStatement ?? transaction.merchantName ?? '',
          merchant_name: transaction.merchantName ?? null,
          amount: -Number(transaction.amount) / 100,
          category: transaction.plaidCategory,
          ...(transaction.plaidPersonalFinanceCategory
            ? {
                personal_finance_category: {
                  primary: transaction.plaidPersonalFinanceCategory.primary,
                  detailed: transaction.plaidPersonalFinanceCategory.detailed,
                  ...(transaction.plaidPersonalFinanceCategory.confidence
                    ? { confidence_level: transaction.plaidPersonalFinanceCategory.confidence }
                    : {}),
                },
              }
            : {}),
          ...(expectedCategoryId ? { expectedCategoryId } : {}),
        },
      });
    }
    return { categories, samples };
  },
});
