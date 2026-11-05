import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { listWorkspaceMemberClerkIds } from '../workspaces/access';
import { listSubscriptionsForClerkId, resolveAppAccessForClerkId } from './appAccess';

export const PLAID_CLEANUP_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const RELATED_RECORD_LIMIT = 100;

export const decisionValidator = v.object({
  bankLinkId: v.id('bankLink'),
  ownerId: v.string(),
  status: v.union(
    v.literal('protected'),
    v.literal('grace_period'),
    v.literal('eligible'),
    v.literal('removed'),
    v.literal('review')
  ),
  reason: v.string(),
  eligibleAfter: v.union(v.string(), v.null()),
});
export type CleanupDecision = {
  bankLinkId: Id<'bankLink'>;
  ownerId: string;
  status: 'protected' | 'grace_period' | 'eligible' | 'removed' | 'review';
  reason: string;
  eligibleAfter: string | null;
};

// Missing/invalid dates fail closed instead of accidentally expiring a grace period.
export function cleanupEligibleAfter(timestamps: Array<string | number | null | undefined>): number | null {
  let latest = 0;
  for (const timestamp of timestamps) {
    if (timestamp === null || timestamp === undefined) continue;
    const parsed = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
    if (!Number.isFinite(parsed)) return null;
    latest = Math.max(latest, parsed);
  }
  return latest + PLAID_CLEANUP_GRACE_MS;
}

type AccessProtection = {
  hasAppAccess: boolean;
  timestamps: Array<string | number | null | undefined>;
  familyMemberIds: string[];
};

async function getAccessProtection(ctx: QueryCtx, clerkId: string, now: Date): Promise<AccessProtection> {
  const access = await resolveAppAccessForClerkId(ctx, clerkId, now);
  if (access.hasAppAccess) return { hasAppAccess: true, timestamps: [], familyMemberIds: [] };

  const subscriptions = await listSubscriptionsForClerkId(ctx, clerkId);
  const profile = await ctx.db
    .query('userProfile')
    .withIndex('by_clerkId', (q) => q.eq('clerkId', clerkId))
    .first();
  // Include removed memberships so a recent loss of family access receives the same grace period.
  const memberships = await ctx.db
    .query('familyGroupMember')
    .withIndex('by_clerkId_isDeleted', (q) => q.eq('clerkId', clerkId))
    .take(RELATED_RECORD_LIMIT + 1);
  if (memberships.length > RELATED_RECORD_LIMIT) throw new Error('Family history exceeds cleanup read limit');
  const timestamps: AccessProtection['timestamps'] = [profile?.lastReactivatedAt];
  const familyMemberIds = new Set<string>();
  for (const subscription of subscriptions) timestamps.push(subscription.expiresAt, subscription.updatedAt);
  for (const membership of memberships) {
    timestamps.push(membership.updatedAt, membership.deletedAt);
    const group = await ctx.db.get(membership.familyGroupId);
    if (group) timestamps.push(group.updatedAt, group.deletedAt);
    if (!membership.isDeleted && group && !group.isDeleted) {
      const members = await ctx.db
        .query('familyGroupMember')
        .withIndex('by_familyGroupId_isDeleted', (q) => q.eq('familyGroupId', group._id).eq('isDeleted', false))
        .take(RELATED_RECORD_LIMIT + 1);
      if (members.length > RELATED_RECORD_LIMIT) throw new Error('Family exceeds cleanup read limit');
      for (const member of members) familyMemberIds.add(member.clerkId);
    }
  }
  if (access.familyAccess) {
    const ownerSubscriptions = await listSubscriptionsForClerkId(ctx, access.familyAccess.ownerClerkId);
    for (const subscription of ownerSubscriptions) timestamps.push(subscription.expiresAt, subscription.updatedAt);
  }
  return { hasAppAccess: false, timestamps, familyMemberIds: [...familyMemberIds] };
}

/** Cross-workspace, internal-only billing maintenance. The bank link owns its Clerk identity. */
async function inspectBankLinkUnchecked(ctx: QueryCtx, bankLink: Doc<'bankLink'>, now: Date): Promise<CleanupDecision> {
  const base = { bankLinkId: bankLink._id, ownerId: bankLink.ownerId, eligibleAfter: null };
  if (bankLink.providerDisconnectedAt) return { ...base, status: 'removed', reason: 'Provider removal recorded' };

  const protection = await getAccessProtection(ctx, bankLink.ownerId, now);
  if (protection.hasAppAccess) return { ...base, status: 'protected', reason: 'Owner has app access' };

  // Family members can use each other's links even before attaching them to a bank account.
  const checkedUsers = new Set([bankLink.ownerId]);
  for (const clerkId of protection.familyMemberIds) {
    if (checkedUsers.has(clerkId)) continue;
    checkedUsers.add(clerkId);
    const memberProtection = await getAccessProtection(ctx, clerkId, now);
    if (memberProtection.hasAppAccess)
      return { ...base, status: 'protected', reason: 'Family member using shared connections has app access' };
    protection.timestamps.push(...memberProtection.timestamps);
  }

  // An old owner without access can still supply a connection used by a paying family member.
  const linkedAccounts = await ctx.db
    .query('bankLinkAccount')
    .withIndex('by_bankLinkId', (q) => q.eq('bankLinkId', bankLink._id))
    .take(RELATED_RECORD_LIMIT + 1);
  if (linkedAccounts.length > RELATED_RECORD_LIMIT) throw new Error('Linked accounts exceed cleanup read limit');
  const workspaceIds = new Set<Id<'workspace'>>();
  for (const linkedAccount of linkedAccounts) {
    const accounts = await ctx.db
      .query('bankAccount')
      .withIndex('by_bankLinkAccountId', (q) => q.eq('bankLinkAccountId', linkedAccount._id))
      .take(RELATED_RECORD_LIMIT + 1);
    if (accounts.length > RELATED_RECORD_LIMIT) throw new Error('Workspace accounts exceed cleanup read limit');
    for (const account of accounts) if (!account.isDeleted) workspaceIds.add(account.workspaceId);
  }
  for (const workspaceId of workspaceIds) {
    for (const clerkId of await listWorkspaceMemberClerkIds(ctx, workspaceId)) {
      if (checkedUsers.has(clerkId)) continue;
      checkedUsers.add(clerkId);
      const memberProtection = await getAccessProtection(ctx, clerkId, now);
      if (memberProtection.hasAppAccess)
        return { ...base, status: 'protected', reason: 'Shared workspace user has app access' };
      protection.timestamps.push(...memberProtection.timestamps);
    }
  }

  const eligibleAfter = cleanupEligibleAfter([
    bankLink.createdAt ?? bankLink._creationTime,
    bankLink.deletedAt,
    ...protection.timestamps,
  ]);
  if (eligibleAfter === null) return { ...base, status: 'review', reason: 'Invalid access date requires review' };
  return {
    ...base,
    eligibleAfter: new Date(eligibleAfter).toISOString(),
    status: now.getTime() > eligibleAfter ? 'eligible' : 'grace_period',
    reason:
      now.getTime() > eligibleAfter
        ? 'No app access; seven-day grace elapsed'
        : 'Seven-day access recovery grace period',
  };
}

// A broken/oversized record must neither trigger removal nor prevent unrelated links from being checked.
export async function inspectBankLink(ctx: QueryCtx, bankLink: Doc<'bankLink'>, now: Date): Promise<CleanupDecision> {
  try {
    return await inspectBankLinkUnchecked(ctx, bankLink, now);
  } catch (_error: unknown) {
    return {
      bankLinkId: bankLink._id,
      ownerId: bankLink.ownerId,
      status: 'review',
      reason: 'Unable to verify access; retry or review required',
      eligibleAfter: null,
    };
  }
}
