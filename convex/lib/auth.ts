import { getIdentity } from './identity';
import type { GenericActionCtx, GenericMutationCtx, GenericQueryCtx } from 'convex/server';
import { ConvexError } from 'convex/values';

import type { DataModel, Id } from '../_generated/dataModel';
import { canManageWorkspace, getWorkspaceAccessForClerkId } from '../workspaces/access';

type QueryCtx = GenericQueryCtx<DataModel>;
type MutationCtx = GenericMutationCtx<DataModel>;
type ActionCtx = GenericActionCtx<DataModel>;

export async function requireAuth(ctx: QueryCtx | MutationCtx) {
  // With Clerk, authentication is handled through JWT tokens
  const identity = await getIdentity(ctx);
  if (!identity) {
    throw new ConvexError('Authentication required');
  }
  return identity;
}

export async function requireUserProfile(ctx: QueryCtx | MutationCtx) {
  const identity = await requireAuth(ctx);

  // Find the user profile by Clerk ID
  const userProfile = await ctx.db
    .query('userProfile')
    .withIndex('by_clerkId', (q) => q.eq('clerkId', identity.subject))
    .first();

  if (!userProfile || userProfile.isDeleted === true) {
    // User profile should be created by the webhook when user signs up
    throw new ConvexError('User profile not found. Please ensure your account is properly set up.');
  }

  return { user: identity, userProfile };
}

export async function requireWorkspaceAccess(ctx: QueryCtx | MutationCtx, workspaceId: Id<'workspace'>) {
  const user = await requireAuth(ctx);

  const userProfile = await ctx.db
    .query('userProfile')
    .withIndex('by_clerkId', (q) => q.eq('clerkId', user.subject))
    .first();
  if (userProfile?.isDeleted === true) {
    throw new ConvexError('This account has been deleted');
  }

  const access = await getWorkspaceAccessForClerkId(ctx, workspaceId, user.subject);
  if (!access) {
    throw new ConvexError('Access denied: You do not have access to this workspace');
  }

  return { user, workspaceId, accessKind: access.kind, canManage: canManageWorkspace(access) };
}

export async function requireWorkspaceManagementAccess(ctx: QueryCtx | MutationCtx, workspaceId: Id<'workspace'>) {
  const user = await requireAuth(ctx);

  const userProfile = await ctx.db
    .query('userProfile')
    .withIndex('by_clerkId', (q) => q.eq('clerkId', user.subject))
    .first();
  if (userProfile?.isDeleted === true) {
    throw new ConvexError('This account has been deleted');
  }

  const access = await getWorkspaceAccessForClerkId(ctx, workspaceId, user.subject);
  if (!access) {
    throw new ConvexError('Access denied: You do not have access to this workspace');
  }

  if (!canManageWorkspace(access)) {
    throw new ConvexError('Access denied: You do not have permission to manage this workspace');
  }

  return { user, workspaceId, accessKind: access.kind };
}

// Action-compatible auth helpers
// Actions can't access ctx.db, so they have simpler auth logic

export async function requireAuthAction(ctx: ActionCtx) {
  // With Clerk, authentication is handled through JWT tokens
  const identity = await getIdentity(ctx);
  if (!identity) {
    throw new ConvexError('Authentication required');
  }
  return identity;
}

export async function requireWorkspaceAccessAction(ctx: ActionCtx, workspaceId: Id<'workspace'>) {
  const identity = await requireAuthAction(ctx);

  // Get user profile
  // Dynamic import to avoid circular dependency type issues
  const { internal } = await import('../_generated/api');
  const userProfile = await ctx.runQuery(internal.clerk.getUserByClerkId, {
    clerkId: identity.subject,
  });

  if (!userProfile || userProfile.isDeleted === true) {
    throw new ConvexError('User profile not found. Please ensure your account is properly set up.');
  }

  const access = await ctx.runQuery(internal.workspaces.getWorkspaceAccessForClerkId, {
    workspaceId,
    clerkId: identity.subject,
  });

  if (!access.ok) {
    throw new ConvexError(access.message);
  }

  return { user: identity, userProfile, workspaceId, accessKind: access.accessKind };
}
