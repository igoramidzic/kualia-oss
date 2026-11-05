import { ConvexError, v } from 'convex/values';

import { getCurrencyDecimals } from '../../packages/shared/src/currency/currency-conversion';
import type { Id } from '../_generated/dataModel';
import { internalQuery, query, type QueryCtx } from '../_generated/server';
import { requireAuth, requireUserProfile, requireWorkspaceAccess } from '../lib/auth';
import {
  canManageWorkspace,
  listAccessibleWorkspacesForClerkId,
  listWorkspaceMemberClerkIds,
  getWorkspaceAccessForClerkId as resolveWorkspaceAccessForClerkId,
  selectDefaultAccessibleWorkspace,
  type AccessibleWorkspace,
  type WorkspaceAccessKind,
  type WorkspaceAccessRole,
} from './access';
import { calculateWorkspaceNavigationAttention } from './helpers';

interface WorkspaceOwnerView {
  clerkId: string;
  name: string | null;
  email: string | null;
}

interface WorkspaceListView {
  _id: Id<'workspace'>;
  _creationTime: number;
  name: string;
  currencyCode: string;
  minorUnit: number;
  timezoneIdentifier: string | null;
  role: WorkspaceAccessRole;
  isArchived: boolean;
  ownerClerkId: string;
  owner: WorkspaceOwnerView | null;
  accessKind: WorkspaceAccessKind;
  canManage: boolean;
}

interface WorkspaceSectionsView {
  ownWorkspaces: WorkspaceListView[];
  sharedWorkspaces: WorkspaceListView[];
}

async function getOwnerView(
  ctx: QueryCtx,
  ownerClerkId: string,
  ownerCache: Map<string, WorkspaceOwnerView | null>
): Promise<WorkspaceOwnerView | null> {
  if (ownerCache.has(ownerClerkId)) {
    return ownerCache.get(ownerClerkId) ?? null;
  }

  const ownerProfile = await ctx.db
    .query('userProfile')
    .withIndex('by_clerkId', (q) => q.eq('clerkId', ownerClerkId))
    .first();
  const owner = ownerProfile
    ? {
        clerkId: ownerProfile.clerkId,
        name: ownerProfile.name ?? null,
        email: ownerProfile.email ?? null,
      }
    : null;

  ownerCache.set(ownerClerkId, owner);
  return owner;
}

async function toWorkspaceListView(
  ctx: QueryCtx,
  accessibleWorkspace: AccessibleWorkspace,
  ownerCache: Map<string, WorkspaceOwnerView | null>
): Promise<WorkspaceListView> {
  const workspace = accessibleWorkspace.workspace;
  const currencyCode = (workspace.currency ?? 'USD').toUpperCase();

  return {
    _id: workspace._id,
    _creationTime: workspace._creationTime,
    name: workspace.name,
    currencyCode,
    minorUnit: getCurrencyDecimals(currencyCode),
    timezoneIdentifier: workspace.timezone ?? null,
    role: accessibleWorkspace.role,
    isArchived: workspace.isArchived ?? false,
    ownerClerkId: accessibleWorkspace.ownerClerkId,
    owner: await getOwnerView(ctx, accessibleWorkspace.ownerClerkId, ownerCache),
    accessKind: accessibleWorkspace.kind,
    canManage: canManageWorkspace(accessibleWorkspace),
  };
}

export async function getWorkspaceSectionsForClerkId(ctx: QueryCtx, clerkId: string): Promise<WorkspaceSectionsView> {
  const accessibleWorkspaces = await listAccessibleWorkspacesForClerkId(ctx, clerkId);
  const ownerCache = new Map<string, WorkspaceOwnerView | null>();
  const ownWorkspaces: WorkspaceListView[] = [];
  const sharedWorkspaces: WorkspaceListView[] = [];

  for (const accessibleWorkspace of accessibleWorkspaces) {
    const view = await toWorkspaceListView(ctx, accessibleWorkspace, ownerCache);
    if (accessibleWorkspace.kind === 'family') {
      sharedWorkspaces.push(view);
    } else {
      ownWorkspaces.push(view);
    }
  }

  return {
    ownWorkspaces,
    sharedWorkspaces,
  };
}

async function getCurrentSubscriptionSummary(ctx: QueryCtx, clerkId: string) {
  const subscription = await ctx.db
    .query('subscription')
    .withIndex('by_clerkId', (q) => q.eq('clerkId', clerkId))
    .filter((q) => q.eq(q.field('isDeleted'), false))
    .first();

  const subscriptionData = subscription
    ? {
        productId: subscription.productId,
        status: subscription.status,
        subscriptionType: subscription.subscriptionType,
        periodType: subscription.periodType,
        expiresAt: subscription.expiresAt,
      }
    : null;

  const now = new Date();
  const hasActiveNonExpiredSubscription = subscription
    ? (subscription.status === 'active' || subscription.status === 'trialing') &&
      (!subscription.expiresAt || new Date(subscription.expiresAt) > now)
    : false;

  return {
    subscription: subscriptionData,
    hasActiveNonExpiredSubscription,
  };
}

/**
 * Internal query to get workspace by workspace ID
 */
export const getByWorkspaceId = internalQuery({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { workspaceId }) => {
    return await ctx.db.get(workspaceId);
  },
});

/**
 * Internal query for actions that need workspace access checks without direct db access.
 */
export const getWorkspaceAccessForClerkId = internalQuery({
  args: {
    workspaceId: v.id('workspace'),
    clerkId: v.string(),
  },
  handler: async (
    ctx,
    { workspaceId, clerkId }
  ): Promise<
    | {
        ok: true;
        accessKind: WorkspaceAccessKind;
        ownerClerkId: string;
      }
    | { ok: false; code: 'NOT_FOUND' | 'FORBIDDEN'; message: string }
  > => {
    const access = await resolveWorkspaceAccessForClerkId(ctx, workspaceId, clerkId);
    if (access) {
      return {
        ok: true,
        accessKind: access.kind,
        ownerClerkId: access.ownerClerkId,
      };
    }

    const workspace = await ctx.db.get(workspaceId);
    if (!workspace || workspace.isDeleted) {
      return { ok: false, code: 'NOT_FOUND', message: 'Workspace not found' };
    }

    return { ok: false, code: 'FORBIDDEN', message: 'Access denied: You do not have access to this workspace' };
  },
});

/**
 * Internal query used by MCP action-backed tools (which can't access ctx.db) to resolve the
 * workspace for the caller, defaulting to their first accessible workspace when neither
 * `requestedWorkspaceId` nor `activeWorkspaceId` is provided. Returns a discriminated union so
 * the action gets a structured failure for missing/no-access/archived cases instead of a throw.
 */
export const resolveWorkspaceForChatTool = internalQuery({
  args: {
    clerkId: v.string(),
    activeWorkspaceId: v.optional(v.id('workspace')),
    requestedWorkspaceId: v.optional(v.id('workspace')),
  },
  handler: async (
    ctx,
    { clerkId, activeWorkspaceId, requestedWorkspaceId }
  ): Promise<
    | {
        ok: true;
        workspaceId: import('../_generated/dataModel').Id<'workspace'>;
        currency: string;
        timezone: string | undefined;
      }
    | { ok: false; code: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_ARGUMENT'; message: string }
  > => {
    let targetWorkspaceId = requestedWorkspaceId ?? activeWorkspaceId;
    if (!targetWorkspaceId) {
      const accessibleWorkspaces = await listAccessibleWorkspacesForClerkId(ctx, clerkId);
      targetWorkspaceId = selectDefaultAccessibleWorkspace(accessibleWorkspaces)?.workspace._id;
    }
    if (!targetWorkspaceId) {
      return { ok: false, code: 'NOT_FOUND', message: 'No workspace specified and no active workspace is set' };
    }

    const access = await resolveWorkspaceAccessForClerkId(ctx, targetWorkspaceId, clerkId);
    if (!access) {
      const workspace = await ctx.db.get(targetWorkspaceId);
      if (!workspace || workspace.isDeleted) {
        return { ok: false, code: 'NOT_FOUND', message: 'Workspace not found' };
      }
      return { ok: false, code: 'FORBIDDEN', message: 'You do not have access to this workspace' };
    }

    const workspace = access.workspace;
    if (workspace.isDeleted) {
      return { ok: false, code: 'NOT_FOUND', message: 'Workspace not found' };
    }
    if (workspace.isArchived) {
      return { ok: false, code: 'FORBIDDEN', message: 'Workspace is archived' };
    }
    return {
      ok: true,
      workspaceId: workspace._id,
      currency: workspace.currency ?? 'USD',
      timezone: workspace.timezone,
    };
  },
});

/**
 * Internal query to get every Clerk ID with access to a workspace.
 */
export const getWorkspaceMemberClerkIds = internalQuery({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { workspaceId }) => {
    return await listWorkspaceMemberClerkIds(ctx, workspaceId);
  },
});

/**
 * Get all workspaces for the current user
 */
export const getUserWorkspaces = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    const sections = await getWorkspaceSectionsForClerkId(ctx, user.subject);

    return [...sections.ownWorkspaces, ...sections.sharedWorkspaces];
  },
});

/**
 * Get workspaces grouped for the future family workspace picker UI.
 */
export const getWorkspaceSections = query({
  args: {},
  handler: async (ctx): Promise<WorkspaceSectionsView> => {
    const user = await requireAuth(ctx);
    return await getWorkspaceSectionsForClerkId(ctx, user.subject);
  },
});

/**
 * Get workspace by short ID (last 8 characters)
 */
export const getWorkspaceByShortId = query({
  args: {
    shortId: v.string(),
  },
  handler: async (ctx, { shortId }) => {
    const user = await requireAuth(ctx);
    const accessibleWorkspaces = await listAccessibleWorkspacesForClerkId(ctx, user.subject);
    const ownerCache = new Map<string, WorkspaceOwnerView | null>();

    for (const accessibleWorkspace of accessibleWorkspaces) {
      const { workspace } = accessibleWorkspace;
      if (!workspace.isArchived && workspace._id.slice(-8) === shortId) {
        const subscriptionSummary = await getCurrentSubscriptionSummary(ctx, user.subject);
        return {
          _id: workspace._id,
          _creationTime: workspace._creationTime,
          name: workspace.name,
          readyToAssign: workspace.readyToAssign ?? 0n,
          currency: workspace.currency,
          subscription: subscriptionSummary.subscription,
          hasActiveNonExpiredSubscription: subscriptionSummary.hasActiveNonExpiredSubscription,
          timezone: workspace.timezone,
          expectedMonthlyIncome: workspace.expectedMonthlyIncome,
          bankAccountOrdering: workspace.bankAccountOrdering,
          onboardingCompleted: workspace.onboardingCompleted,
          transactionDefaultAccountId: workspace.transactionDefaultAccountId,
          transactionDefaultPendingStatus: workspace.transactionDefaultPendingStatus,
          ownerClerkId: accessibleWorkspace.ownerClerkId,
          owner: await getOwnerView(ctx, accessibleWorkspace.ownerClerkId, ownerCache),
          canManage: canManageWorkspace(accessibleWorkspace),
        };
      }
    }

    // Workspace not found or user doesn't have access
    return null;
  },
});

/**
 * Get the current workspace
 */
export const getWorkspace = query({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { workspaceId }) => {
    const { user, workspaceId: verifiedWorkspaceId, canManage } = await requireWorkspaceAccess(ctx, workspaceId);

    const workspace = await ctx.db.get(verifiedWorkspaceId);

    if (!workspace || workspace.isDeleted) {
      throw new ConvexError('Workspace not found');
    }

    if (workspace.isArchived) {
      throw new ConvexError('Workspace is archived');
    }

    const subscriptionSummary = await getCurrentSubscriptionSummary(ctx, user.subject);
    const ownerCache = new Map<string, WorkspaceOwnerView | null>();

    return {
      _id: workspace._id,
      _creationTime: workspace._creationTime,
      name: workspace.name,
      readyToAssign: workspace.readyToAssign ?? 0n,
      currency: workspace.currency,
      subscription: subscriptionSummary.subscription,
      hasActiveNonExpiredSubscription: subscriptionSummary.hasActiveNonExpiredSubscription,
      timezone: workspace.timezone,
      expectedMonthlyIncome: workspace.expectedMonthlyIncome,
      bankAccountOrdering: workspace.bankAccountOrdering,
      onboardingCompleted: workspace.onboardingCompleted,
      transactionDefaultAccountId: workspace.transactionDefaultAccountId,
      transactionDefaultPendingStatus: workspace.transactionDefaultPendingStatus,
      ownerClerkId: workspace.ownerClerkId,
      owner: await getOwnerView(ctx, workspace.ownerClerkId, ownerCache),
      canManage,
    };
  },
});

/**
 * Presence-only navigation status for the user's accessible workspaces.
 */
export const getNavigationAttention = query({
  // A new key refreshes the current-month calculation after foreground/month rollover.
  args: { refreshKey: v.optional(v.string()) },
  returns: v.array(
    v.object({
      workspaceId: v.id('workspace'),
      currentMonth: v.number(),
      timezone: v.string(),
      hasOverspending: v.boolean(),
      hasOverassignment: v.boolean(),
      hasMissingCategory: v.boolean(),
      hasMissingPayee: v.boolean(),
      hasNewTransactions: v.boolean(),
    })
  ),
  handler: async (ctx) => {
    const { user } = await requireUserProfile(ctx);
    const workspaces = await listAccessibleWorkspacesForClerkId(ctx, user.subject);
    return await Promise.all(
      workspaces
        .filter(({ workspace }) => !workspace.isDeleted && !workspace.isArchived)
        .map(({ workspace }) => calculateWorkspaceNavigationAttention(ctx, workspace))
    );
  },
});
