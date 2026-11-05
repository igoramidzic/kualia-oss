import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { query } from '../_generated/server';
import { requireAuth, requireWorkspaceAccess } from '../lib/auth';
import { appendLogoDevToken } from '../lib/logoUtils';
import { listBankLinkOwnerClerkIdsForWorkspace } from './helpers';

interface BankLinkOwnerView {
  clerkId: string;
  name: string | null;
  email: string | null;
}

function getBankLinkOwnerView(
  ctx: QueryCtx,
  clerkId: string,
  ownerCache: Map<string, Promise<BankLinkOwnerView | null>>
): Promise<BankLinkOwnerView | null> {
  const cached = ownerCache.get(clerkId);
  if (cached) return cached;

  const owner = ctx.db
    .query('userProfile')
    .withIndex('by_clerkId', (q) => q.eq('clerkId', clerkId))
    .first()
    .then((profile) =>
      profile ? { clerkId: profile.clerkId, name: profile.name ?? null, email: profile.email ?? null } : null
    );
  // Cache the in-flight read so connections owned by the same person share it.
  ownerCache.set(clerkId, owner);
  return owner;
}

export async function listBankLinksInternal(
  ctx: QueryCtx,
  args: {
    workspaceId: Id<'workspace'>;
    currentUserClerkId: string;
  }
) {
  const ownerIds = await listBankLinkOwnerClerkIdsForWorkspace(ctx, args.workspaceId);

  // Bank links are owned by users, and every active family member can see each other's links.
  const bankLinksByOwner = await Promise.all(
    ownerIds.map((ownerId) =>
      ctx.db
        .query('bankLink')
        .withIndex('by_ownerId', (q) => q.eq('ownerId', ownerId))
        .filter((q) => q.neq(q.field('isDeleted'), true))
        .collect()
    )
  );
  const bankLinks = bankLinksByOwner.flat().sort((left, right) => {
    const leftIsCurrentUser = left.ownerId === args.currentUserClerkId;
    const rightIsCurrentUser = right.ownerId === args.currentUserClerkId;
    if (leftIsCurrentUser !== rightIsCurrentUser) {
      return leftIsCurrentUser ? -1 : 1;
    }

    return left._creationTime - right._creationTime;
  });
  const ownerCache = new Map<string, Promise<BankLinkOwnerView | null>>();
  const institutionCache = new Map<Id<'globalInstitution'>, Promise<Doc<'globalInstitution'> | null>>();

  // Populate institution data and accounts for each bank link
  return Promise.all(
    bankLinks.map(async (link) => {
      let institution = link.globalInstitutionId ? institutionCache.get(link.globalInstitutionId) : undefined;
      if (!institution && link.globalInstitutionId) {
        institution = ctx.db.get(link.globalInstitutionId);
        institutionCache.set(link.globalInstitutionId, institution);
      }
      const [globalInstitution, owner, bankLinkAccounts] = await Promise.all([
        institution ?? Promise.resolve(null),
        getBankLinkOwnerView(ctx, link.ownerId, ownerCache),
        ctx.db
          .query('bankLinkAccount')
          .withIndex('by_bankLinkId', (q) => q.eq('bankLinkId', link._id))
          .filter((q) => q.neq(q.field('isDeleted'), true))
          .collect(),
      ]);

      // For each account, check if it's linked using targeted index lookup
      const enrichedAccounts = await Promise.all(
        bankLinkAccounts.map(async (account) => {
          // PERFORMANCE: Direct index lookup instead of scanning all accounts
          const connectedBankAccount = await ctx.db
            .query('bankAccount')
            .withIndex('by_bankLinkAccountId', (q) => q.eq('bankLinkAccountId', account._id))
            .filter((q) => q.and(q.eq(q.field('workspaceId'), args.workspaceId), q.eq(q.field('isDeleted'), false)))
            .first();

          // Return full account data with linkage info
          return {
            _id: account._id,
            name: account.name,
            accountType: account.accountType,
            accountNumberMask: account.accountNumberMask ?? null,
            initialBalance: account.initialBalance ?? null,
            officialName: account.officialName,
            currentBalance: account.currentBalance,
            availableBalance: account.availableBalance,
            lastUpdated: account.lastUpdated,
            hasCompletedInitialSync: connectedBankAccount?.plaidInitialSync
              ? connectedBankAccount.plaidInitialSync.status === 'complete'
              : (link.hasCompletedFirstSync ?? false),
            // Add connected bank account if linked
            connectedBankAccount: connectedBankAccount
              ? {
                  _id: connectedBankAccount._id,
                  name: connectedBankAccount.name,
                }
              : null,
          };
        })
      );

      return {
        _id: link._id,
        _creationTime: link._creationTime,
        itemId: link.itemId,
        itemStatus: link.itemStatus,
        reauthorization: link.reauthorization,
        lastSyncedAt: link.lastSyncedAt,
        hasCompletedFirstSync: link.hasCompletedFirstSync ?? false,
        ownerId: link.ownerId,
        owner,
        isOwnedByCurrentUser: link.ownerId === args.currentUserClerkId,
        canManageConnection: link.ownerId === args.currentUserClerkId,
        // Return as "institution" for frontend
        institution: globalInstitution
          ? {
              _id: globalInstitution._id,
              name: globalInstitution.name,
              logo: appendLogoDevToken(globalInstitution.logoUrl),
              primaryColor: globalInstitution.primaryColor,
            }
          : null,
        // Include accounts array with linkage info
        accounts: enrichedAccounts,
      };
    })
  );
}

/**
 * @deprecated Use `bankConnections.listConnections` for a provider-neutral connection list.
 */
export const listBankLinks = query({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { workspaceId }) => {
    const { user, workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);
    return await listBankLinksInternal(ctx, {
      workspaceId: verifiedWorkspaceId,
      currentUserClerkId: user.subject,
    });
  },
});

/**
 * Check for duplicate bank link by institution ID and account masks
 * Bank links are cross-workspace, so we check by user (ownerId)
 */
export const checkDuplicateBankLink = query({
  args: {
    institutionId: v.string(),
    accountMasks: v.array(v.string()),
  },
  handler: async (ctx, { institutionId, accountMasks }) => {
    const identity = await requireAuth(ctx);

    // Find global institution by provider institution ID
    const globalInstitution = await ctx.db
      .query('globalInstitution')
      .withIndex('by_providerInstitutionId', (q) => q.eq('providerInstitutionId', institutionId))
      .first();

    if (!globalInstitution) {
      return { hasDuplicate: false };
    }

    // Find all bank links for this user and global institution
    const bankLinks = await ctx.db
      .query('bankLink')
      .withIndex('by_ownerId', (q) => q.eq('ownerId', identity.subject))
      .filter((q) =>
        q.and(q.eq(q.field('globalInstitutionId'), globalInstitution._id), q.neq(q.field('isDeleted'), true))
      )
      .collect();

    // Check if any bank link has accounts with matching masks
    for (const bankLink of bankLinks) {
      const linkAccounts = await ctx.db
        .query('bankLinkAccount')
        .withIndex('by_bankLinkId', (q) => q.eq('bankLinkId', bankLink._id))
        .filter((q) => q.neq(q.field('isDeleted'), true))
        .collect();

      const existingMasks = linkAccounts.map((acc) => acc.accountNumberMask).filter((mask): mask is string => !!mask);

      // Check if any of the provided masks match existing masks
      const hasMatch = accountMasks.some((mask) => existingMasks.includes(mask));

      if (hasMatch) {
        return {
          hasDuplicate: true,
          institutionName: globalInstitution.name,
          matchingMasks: accountMasks.filter((mask) => existingMasks.includes(mask)),
        };
      }
    }

    return { hasDuplicate: false };
  },
});
