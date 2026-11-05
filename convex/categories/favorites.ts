import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { mutation } from '../_generated/server';
import { requireUserProfile, requireWorkspaceAccess } from '../lib/auth';

export async function getFavoriteCategoryIds(
  ctx: QueryCtx,
  workspaceId: Id<'workspace'>,
  clerkId: string
): Promise<Set<Id<'category'>>> {
  const userProfile = await ctx.db
    .query('userProfile')
    .withIndex('by_clerkId', (q) => q.eq('clerkId', clerkId))
    .unique();

  if (!userProfile) {
    return new Set();
  }

  const favorites = await ctx.db
    .query('categoryFavorite')
    .withIndex('by_userProfileId_and_workspaceId_and_isDeleted', (q) =>
      q.eq('userProfileId', userProfile._id).eq('workspaceId', workspaceId).eq('isDeleted', false)
    )
    .collect();

  return new Set(favorites.map((favorite) => favorite.categoryId));
}

export async function setCategoryFavoriteForUser(
  ctx: MutationCtx,
  userProfileId: Id<'userProfile'>,
  workspaceId: Id<'workspace'>,
  categoryId: Id<'category'>,
  isFavorite: boolean
): Promise<void> {
  const existing = await ctx.db
    .query('categoryFavorite')
    .withIndex('by_userProfileId_and_categoryId', (q) =>
      q.eq('userProfileId', userProfileId).eq('categoryId', categoryId)
    )
    .unique();
  const now = new Date().toISOString();

  if (existing) {
    await ctx.db.patch(existing._id, {
      workspaceId,
      isDeleted: !isFavorite,
      deletedAt: isFavorite ? undefined : now,
      updatedAt: now,
    });
    return;
  }

  if (isFavorite) {
    await ctx.db.insert('categoryFavorite', {
      workspaceId,
      userProfileId,
      categoryId,
      updatedAt: now,
      isDeleted: false,
    });
  }
}

export const setCategoryFavorite = mutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
    isFavorite: v.boolean(),
  },
  handler: async (ctx, { workspaceId, categoryId, isFavorite }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);
    const { userProfile } = await requireUserProfile(ctx);
    const category = await ctx.db.get(categoryId);

    if (!category || category.workspaceId !== verifiedWorkspaceId || category.isDeleted) {
      throw new ConvexError('Category not found or does not belong to workspace');
    }

    await setCategoryFavoriteForUser(ctx, userProfile._id, verifiedWorkspaceId, categoryId, isFavorite);
    return { success: true };
  },
});
