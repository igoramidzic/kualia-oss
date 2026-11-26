import { ConvexError, v } from 'convex/values';

import type { Id } from './_generated/dataModel';
import { internalMutation, type MutationCtx } from './_generated/server';
import { isDev } from './lib/devUtils';

/**
 * Marks the owner of a seeded local workspace as onboarded so `pnpm seed`
 * opens straight into the demo budget. Unlike `completeUserOnboarding`, this
 * does not create an extra default workspace.
 */
export async function completeSeededOwnerOnboarding(
  ctx: Pick<MutationCtx, 'db'>,
  workspaceId: Id<'workspace'>,
  ownerEmail: string,
  name: string
): Promise<null> {
  if (!isDev()) throw new ConvexError('This mutation can only be run in development mode');
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace || workspace.isDeleted || workspace.kualiaImportPending) {
    throw new ConvexError('Seeded workspace not found');
  }
  const profile = await ctx.db
    .query('userProfile')
    .withIndex('by_clerkId', (q) => q.eq('clerkId', workspace.ownerClerkId))
    .unique();
  if (!profile || profile.isDeleted) throw new ConvexError('Workspace owner profile not found');
  // Never touch another user's profile, e.g. the owner of a workspace shared with the demo user.
  if (profile.email.toLowerCase() !== ownerEmail.toLowerCase()) {
    throw new ConvexError('Workspace is not owned by the seeded user');
  }
  await ctx.db.patch(profile._id, {
    name: profile.name ?? name,
    onboardingCompleted: true,
    activeWorkspaceId: workspaceId,
    updatedAt: new Date().toISOString(),
  });
  return null;
}

/** Dev-only: run by `scripts/seed-local.mjs` through the local Convex CLI. */
export const completeSeededUserOnboarding = internalMutation({
  args: { workspaceId: v.id('workspace'), ownerEmail: v.string(), name: v.string() },
  returns: v.null(),
  handler: (ctx, { workspaceId, ownerEmail, name }) =>
    completeSeededOwnerOnboarding(ctx, workspaceId, ownerEmail, name),
});
