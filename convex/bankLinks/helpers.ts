import { ConvexError } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { listWorkspaceMemberClerkIds } from '../workspaces/access';

type BankLinkAccessCtx = QueryCtx | MutationCtx;

export interface BankLinkAccountAccess {
  bankLink: Doc<'bankLink'>;
  bankLinkAccount: Doc<'bankLinkAccount'>;
}

export async function listBankLinkOwnerClerkIdsForWorkspace(
  ctx: BankLinkAccessCtx,
  workspaceId: Id<'workspace'>
): Promise<string[]> {
  return await listWorkspaceMemberClerkIds(ctx, workspaceId);
}

export async function requireBankLinkAccountAccessForWorkspace(
  ctx: BankLinkAccessCtx,
  workspaceId: Id<'workspace'>,
  bankLinkAccountId: Id<'bankLinkAccount'>
): Promise<BankLinkAccountAccess> {
  const bankLinkAccount = await ctx.db.get(bankLinkAccountId);
  if (!bankLinkAccount || bankLinkAccount.isDeleted) {
    throw new ConvexError('Bank link account not found or cannot be used in this workspace');
  }

  const bankLink = await ctx.db.get(bankLinkAccount.bankLinkId);
  if (!bankLink || bankLink.isDeleted) {
    throw new ConvexError('Bank link account not found or cannot be used in this workspace');
  }

  const allowedOwnerIds = await listBankLinkOwnerClerkIdsForWorkspace(ctx, workspaceId);
  if (!allowedOwnerIds.includes(bankLink.ownerId)) {
    throw new ConvexError('Bank link account not found or cannot be used in this workspace');
  }

  return { bankLink, bankLinkAccount };
}

async function unlinkBankAccountsForPlaidConnectionAccount(
  ctx: MutationCtx,
  bankLinkAccountId: Id<'bankLinkAccount'>,
  shouldUnlinkWorkspace: (workspace: Doc<'workspace'> | null) => boolean,
  nowIso: string
): Promise<number> {
  const linkedBankAccounts = await ctx.db
    .query('bankAccount')
    .withIndex('by_bankLinkAccountId', (q) => q.eq('bankLinkAccountId', bankLinkAccountId))
    .filter((q) => q.eq(q.field('isDeleted'), false))
    .collect();

  let unlinkedCount = 0;

  for (const bankAccount of linkedBankAccounts) {
    const workspace = await ctx.db.get(bankAccount.workspaceId);
    if (!shouldUnlinkWorkspace(workspace)) {
      continue;
    }

    await ctx.db.patch(bankAccount._id, {
      bankLinkAccountId: undefined,
      updatedAt: nowIso,
    });
    unlinkedCount += 1;
  }

  return unlinkedCount;
}

async function unlinkBankAccountsForAppleWalletConnectionAccount(
  ctx: MutationCtx,
  financeKitAccount: Doc<'financeKitAccount'>,
  shouldUnlinkWorkspace: (workspace: Doc<'workspace'> | null) => boolean,
  nowIso: string
): Promise<number> {
  const linkedBankAccounts = await ctx.db
    .query('bankAccount')
    .withIndex('by_financeKitAccountId', (q) => q.eq('financeKitAccountId', financeKitAccount._id))
    .filter((q) => q.eq(q.field('isDeleted'), false))
    .collect();
  const linkedBankAccountsById = new Map(linkedBankAccounts.map((bankAccount) => [bankAccount._id, bankAccount]));

  if (financeKitAccount.bankAccountId && !linkedBankAccountsById.has(financeKitAccount.bankAccountId)) {
    const bankAccount = await ctx.db.get(financeKitAccount.bankAccountId);
    if (bankAccount && !bankAccount.isDeleted) {
      linkedBankAccountsById.set(bankAccount._id, bankAccount);
    }
  }

  let unlinkedCount = 0;
  let shouldClearFinanceKitBackref = false;

  for (const bankAccount of linkedBankAccountsById.values()) {
    const workspace = await ctx.db.get(bankAccount.workspaceId);
    if (!shouldUnlinkWorkspace(workspace)) {
      continue;
    }

    await ctx.db.patch(bankAccount._id, {
      financeKitAccountId: undefined,
      updatedAt: nowIso,
    });

    if (financeKitAccount.bankAccountId === bankAccount._id) {
      shouldClearFinanceKitBackref = true;
    }

    unlinkedCount += 1;
  }

  if (shouldClearFinanceKitBackref) {
    await ctx.db.patch(financeKitAccount._id, {
      bankAccountId: undefined,
      updatedAt: nowIso,
    });
  }

  return unlinkedCount;
}

async function unlinkBankAccountsForOwnerPlaidConnections(
  ctx: MutationCtx,
  ownerClerkId: string,
  shouldUnlinkWorkspace: (workspace: Doc<'workspace'> | null) => boolean,
  nowIso: string
): Promise<number> {
  const bankLinks = await ctx.db
    .query('bankLink')
    .withIndex('by_ownerId', (q) => q.eq('ownerId', ownerClerkId))
    .filter((q) => q.neq(q.field('isDeleted'), true))
    .collect();

  let unlinkedCount = 0;

  for (const bankLink of bankLinks) {
    const bankLinkAccounts = await ctx.db
      .query('bankLinkAccount')
      .withIndex('by_bankLinkId', (q) => q.eq('bankLinkId', bankLink._id))
      .filter((q) => q.neq(q.field('isDeleted'), true))
      .collect();

    for (const bankLinkAccount of bankLinkAccounts) {
      unlinkedCount += await unlinkBankAccountsForPlaidConnectionAccount(
        ctx,
        bankLinkAccount._id,
        shouldUnlinkWorkspace,
        nowIso
      );
    }
  }

  return unlinkedCount;
}

async function listActiveWorkspacesOwnedByClerkIds(
  ctx: MutationCtx,
  ownerClerkIds: Iterable<string>
): Promise<Doc<'workspace'>[]> {
  const workspacesById = new Map<Id<'workspace'>, Doc<'workspace'>>();

  for (const ownerClerkId of ownerClerkIds) {
    const workspaces = await ctx.db
      .query('workspace')
      .withIndex('by_ownerClerkId_isDeleted', (q) => q.eq('ownerClerkId', ownerClerkId))
      .collect();

    for (const workspace of workspaces) {
      if (workspace.isDeleted) {
        continue;
      }

      workspacesById.set(workspace._id, workspace);
    }
  }

  return Array.from(workspacesById.values());
}

async function unlinkBankAccountsForOwnerAppleWalletConnections(
  ctx: MutationCtx,
  ownerClerkId: string,
  familyWorkspaces: Doc<'workspace'>[],
  shouldUnlinkWorkspace: (workspace: Doc<'workspace'> | null) => boolean,
  nowIso: string
): Promise<number> {
  let unlinkedCount = 0;

  for (const workspace of familyWorkspaces) {
    const connections = await ctx.db
      .query('financeKitConnection')
      .withIndex('by_workspaceId_ownerClerkId_isDeleted', (q) =>
        q.eq('workspaceId', workspace._id).eq('ownerClerkId', ownerClerkId).eq('isDeleted', false)
      )
      .collect();

    for (const connection of connections) {
      const financeKitAccounts = await ctx.db
        .query('financeKitAccount')
        .withIndex('by_connectionId_isDeleted', (q) => q.eq('connectionId', connection._id).eq('isDeleted', false))
        .collect();

      for (const financeKitAccount of financeKitAccounts) {
        unlinkedCount += await unlinkBankAccountsForAppleWalletConnectionAccount(
          ctx,
          financeKitAccount,
          shouldUnlinkWorkspace,
          nowIso
        );
      }
    }
  }

  return unlinkedCount;
}

async function unlinkBankAccountsForOwnerBankConnections(
  ctx: MutationCtx,
  ownerClerkId: string,
  familyWorkspaces: Doc<'workspace'>[],
  shouldUnlinkWorkspace: (workspace: Doc<'workspace'> | null) => boolean,
  nowIso: string
): Promise<number> {
  let unlinkedCount = 0;

  unlinkedCount += await unlinkBankAccountsForOwnerPlaidConnections(ctx, ownerClerkId, shouldUnlinkWorkspace, nowIso);
  unlinkedCount += await unlinkBankAccountsForOwnerAppleWalletConnections(
    ctx,
    ownerClerkId,
    familyWorkspaces,
    shouldUnlinkWorkspace,
    nowIso
  );

  return unlinkedCount;
}

async function revokeWorkspaceCredentialsForClerkId(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>,
  clerkId: string,
  nowIso: string
): Promise<void> {
  const widgetTokens = await ctx.db
    .query('widgetToken')
    .withIndex('by_clerkId_workspaceId', (q) => q.eq('clerkId', clerkId).eq('workspaceId', workspaceId))
    .collect();

  for (const token of widgetTokens) {
    if (!token.isRevoked) {
      await ctx.db.patch(token._id, { isRevoked: true });
    }
  }

  const financeKitTokens = await ctx.db
    .query('financeKitSyncToken')
    .withIndex('by_workspaceId_ownerClerkId_deviceId_isRevoked', (q) =>
      q.eq('workspaceId', workspaceId).eq('ownerClerkId', clerkId)
    )
    .collect();

  for (const token of financeKitTokens) {
    if (!token.isRevoked) {
      await ctx.db.patch(token._id, {
        isRevoked: true,
        revokedAt: nowIso,
        refreshedAt: nowIso,
      });
    }
  }
}

async function revokeSeparatedFamilyWorkspaceCredentials(
  ctx: MutationCtx,
  memberClerkId: string,
  familyMemberClerkIds: Set<string>,
  familyWorkspaces: Doc<'workspace'>[],
  nowIso: string
): Promise<void> {
  for (const workspace of familyWorkspaces) {
    if (workspace.ownerClerkId !== memberClerkId) {
      await revokeWorkspaceCredentialsForClerkId(ctx, workspace._id, memberClerkId, nowIso);
      continue;
    }

    for (const clerkId of familyMemberClerkIds) {
      if (clerkId !== memberClerkId) {
        await revokeWorkspaceCredentialsForClerkId(ctx, workspace._id, clerkId, nowIso);
      }
    }
  }
}

export async function unlinkBankAccountsForSeparatedFamilyMember(
  ctx: MutationCtx,
  {
    memberClerkId,
    familyMemberClerkIds,
    nowIso,
  }: {
    memberClerkId: string;
    familyMemberClerkIds: string[];
    nowIso: string;
  }
): Promise<number> {
  const familyMemberClerkIdSet = new Set(familyMemberClerkIds);
  const familyWorkspaces = await listActiveWorkspacesOwnedByClerkIds(ctx, familyMemberClerkIdSet);
  let unlinkedCount = 0;

  await revokeSeparatedFamilyWorkspaceCredentials(ctx, memberClerkId, familyMemberClerkIdSet, familyWorkspaces, nowIso);

  unlinkedCount += await unlinkBankAccountsForOwnerBankConnections(
    ctx,
    memberClerkId,
    familyWorkspaces,
    (workspace) => workspace !== null && workspace.ownerClerkId !== memberClerkId,
    nowIso
  );

  for (const ownerClerkId of familyMemberClerkIdSet) {
    if (ownerClerkId === memberClerkId) {
      continue;
    }

    unlinkedCount += await unlinkBankAccountsForOwnerBankConnections(
      ctx,
      ownerClerkId,
      familyWorkspaces,
      (workspace) => workspace !== null && workspace.ownerClerkId === memberClerkId,
      nowIso
    );
  }

  return unlinkedCount;
}
