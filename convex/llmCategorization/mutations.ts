import { ConvexError, type Infer, v } from 'convex/values';

import { internalMutation } from '../_generated/server';

export const mappingResult = v.object({
  merchantName: v.string(),
  categoryId: v.union(v.id('category'), v.null()),
  confidence: v.number(),
  amountDirection: v.union(v.literal('positive'), v.literal('negative')),
  failed: v.optional(v.boolean()),
  failureReason: v.optional(v.string()),
  model: v.optional(v.string()),
  modelConfidence: v.optional(v.number()),
  usedFallback: v.optional(v.boolean()),
  reason: v.optional(v.string()),
});
export type MappingResult = Infer<typeof mappingResult>;

/** Persist automated choices without overwriting a manual choice made during inference. */
export const storeMappings = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    results: v.array(mappingResult),
    source: v.optional(v.union(v.literal('typesafe'), v.literal('llm'))),
  },
  returns: v.null(),
  handler: async (ctx, { workspaceId, results, source = 'llm' }) => {
    const workspace = await ctx.db.get(workspaceId);
    if (!workspace || workspace.isDeleted) throw new ConvexError('Workspace not found');
    const timestamp = new Date().toISOString();

    for (const result of results) {
      if (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1) {
        throw new ConvexError('Categorization probability must be between 0 and 1');
      }
      if (result.categoryId) {
        const category = await ctx.db.get(result.categoryId);
        if (!category || category.workspaceId !== workspaceId || category.isDeleted || category.isArchived) continue;
        const group = await ctx.db.get(category.categoryGroupId);
        if (!group || group.workspaceId !== workspaceId || group.isDeleted || group.type !== 'expense') continue;
      }
      // Check if mapping already exists for this merchant + direction
      const existing = await ctx.db
        .query('orgMerchantCategoryMapping')
        .withIndex('by_workspaceId_merchantName_amountDirection', (q) =>
          q
            .eq('workspaceId', workspaceId)
            .eq('merchantName', result.merchantName)
            .eq('amountDirection', result.amountDirection)
        )
        .first();

      // A concurrent request may have supplied a manual or successful cached choice after the scan.
      if (existing && (existing.source === 'manual' || (existing.categoryId && !existing.categorizationFailed)))
        continue;
      const provenance = {
        source,
        model: result.model,
        modelConfidence: result.modelConfidence,
        usedFallback: result.usedFallback,
      };

      if (existing) {
        // Update existing mapping
        await ctx.db.patch(existing._id, {
          categoryId: result.categoryId ?? undefined,
          ...provenance,
          confidence: result.confidence,
          categorizationFailed: result.failed ?? (!result.categoryId && result.confidence < 0.5),
          failureReason: result.failureReason,
          updatedAt: timestamp,
        });
      } else if (result.categoryId) {
        // Create new mapping only if we have a category
        await ctx.db.insert('orgMerchantCategoryMapping', {
          merchantName: result.merchantName,
          categoryId: result.categoryId,
          workspaceId,
          ...provenance,
          confidence: result.confidence,
          timesApplied: 0,
          timesOverridden: 0,
          amountDirection: result.amountDirection,
          categorizationFailed: false,
          updatedAt: timestamp,
        });
      } else {
        // Record abstained/failed categorization (no category assigned)
        await ctx.db.insert('orgMerchantCategoryMapping', {
          merchantName: result.merchantName,
          categoryId: undefined,
          workspaceId,
          ...provenance,
          confidence: result.confidence,
          timesApplied: 0,
          timesOverridden: 0,
          amountDirection: result.amountDirection,
          categorizationFailed: true,
          failureReason: result.failureReason ?? 'Categorizer abstained',
          updatedAt: timestamp,
        });
      }
    }
    return null;
  },
});
