import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { mutation } from '../_generated/server';
import { requireUserProfile, requireWorkspaceAccess } from '../lib/auth';

export async function getFavoriteBankAccountIds(
  ctx: QueryCtx,
  workspaceId: Id<'workspace'>,
  clerkId: string
): Promise<Set<Id<'bankAccount'>>> {
  const userProfile = await ctx.db
    .query('userProfile')
    .withIndex('by_clerkId', (q) => q.eq('clerkId', clerkId))
    .unique();

  if (!userProfile) {
    return new Set();
  }

  const favorites = await ctx.db
    .query('bankAccountFavorite')
    .withIndex('by_userProfileId_and_workspaceId_and_isDeleted', (q) =>
      q.eq('userProfileId', userProfile._id).eq('workspaceId', workspaceId).eq('isDeleted', false)
    )
    .collect();

  return new Set(favorites.map((favorite) => favorite.bankAccountId));
}

export async function setBankAccountFavoriteForUser(
  ctx: MutationCtx,
  userProfileId: Id<'userProfile'>,
  workspaceId: Id<'workspace'>,
  bankAccountId: Id<'bankAccount'>,
  isFavorite: boolean
): Promise<void> {
  const existing = await ctx.db
    .query('bankAccountFavorite')
    .withIndex('by_userProfileId_and_bankAccountId', (q) =>
      q.eq('userProfileId', userProfileId).eq('bankAccountId', bankAccountId)
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
    await ctx.db.insert('bankAccountFavorite', {
      workspaceId,
      userProfileId,
      bankAccountId,
      updatedAt: now,
      isDeleted: false,
    });
  }
}

export const setBankAccountFavorite = mutation({
  args: {
    workspaceId: v.id('workspace'),
    bankAccountId: v.id('bankAccount'),
    isFavorite: v.boolean(),
  },
  handler: async (ctx, { workspaceId, bankAccountId, isFavorite }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);
    const { userProfile } = await requireUserProfile(ctx);
    const bankAccount = await ctx.db.get(bankAccountId);

    if (!bankAccount || bankAccount.workspaceId !== verifiedWorkspaceId || bankAccount.isDeleted) {
      throw new ConvexError('Bank account not found or does not belong to workspace');
    }

    await setBankAccountFavoriteForUser(ctx, userProfile._id, verifiedWorkspaceId, bankAccountId, isFavorite);

    return { success: true };
  },
});
