import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { components, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { internalMutation, internalQuery } from '../_generated/server';

const PURGE_BATCH_SIZE = 64;

const workspacePurgeStages = [
  'activityLog',
  'pendingTransferMatch',
  'transaction',
  'scheduledTransactionOccurrence',
  'scheduledTransaction',
  'scheduledTransactionSkip',
  'transactionImportRaw',
  'financeKitTransactionImport',
  'categoryBudget',
  'bankAccountFavorite',
  'categoryFavorite',
  'transactionRule',
  'uploadedFile',
  'bankAccount',
  'financeKitAccount',
  'financeKitSyncToken',
  'financeKitConnection',
  'category',
  'categoryGroup',
  'merchant',
  'orgMerchantCategoryMapping',
  'widgetToken',
] as const;
type WorkspacePurgeStage = (typeof workspacePurgeStages)[number];

const workspacePurgeStageValidator = v.union(
  v.literal('activityLog'),
  v.literal('pendingTransferMatch'),
  v.literal('transaction'),
  v.literal('scheduledTransactionOccurrence'),
  v.literal('scheduledTransaction'),
  v.literal('scheduledTransactionSkip'),
  v.literal('transactionImportRaw'),
  v.literal('financeKitTransactionImport'),
  v.literal('categoryBudget'),
  v.literal('bankAccountFavorite'),
  v.literal('categoryFavorite'),
  v.literal('transactionRule'),
  v.literal('uploadedFile'),
  v.literal('bankAccount'),
  v.literal('financeKitAccount'),
  v.literal('financeKitSyncToken'),
  v.literal('financeKitConnection'),
  v.literal('category'),
  v.literal('categoryGroup'),
  v.literal('merchant'),
  v.literal('orgMerchantCategoryMapping'),
  v.literal('widgetToken')
);

const userPurgeStages = [
  'bankAccountFavorite',
  'categoryFavorite',
  'ynabImportStatus',
  'familyGroupInvite',
  'familyGroupMember',
  'mcpToken',
  'mcpOauthAuthorizationCode',
  'mcpOauthAccessToken',
  'mcpOauthRefreshToken',
  'mcpOauthConnection',
  'apiKey',
  'widgetToken',
  'chatAttachment',
  'aiChatUsage',
  'aiChatThreadReadState',
] as const;
type UserPurgeStage = (typeof userPurgeStages)[number];

const userPurgeStageValidator = v.union(
  v.literal('bankAccountFavorite'),
  v.literal('categoryFavorite'),
  v.literal('ynabImportStatus'),
  v.literal('familyGroupInvite'),
  v.literal('familyGroupMember'),
  v.literal('mcpToken'),
  v.literal('mcpOauthAuthorizationCode'),
  v.literal('mcpOauthAccessToken'),
  v.literal('mcpOauthRefreshToken'),
  v.literal('mcpOauthConnection'),
  v.literal('apiKey'),
  v.literal('widgetToken'),
  v.literal('chatAttachment'),
  v.literal('aiChatUsage'),
  v.literal('aiChatThreadReadState')
);

function nextStage<T extends string>(stages: readonly T[], current: T): T | null {
  const next = stages.indexOf(current) + 1;
  return next < stages.length ? (stages[next] ?? null) : null;
}

export function isDeletionOldEnough(deletedAt: string | undefined, deletedBefore: string): boolean {
  return deletedAt !== undefined && deletedAt <= deletedBefore;
}

export function buildPurgeCompletionUpdates(now: string): { purgeCompletedAt: string; updatedAt: string } {
  return { purgeCompletedAt: now, updatedAt: now };
}

export const listEligibleDeletedProfiles = internalQuery({
  args: {
    deletedBefore: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('userProfile')
      .withIndex('by_isDeleted_and_purgeCompletedAt_and_deletedAt', (q) =>
        q.eq('isDeleted', true).eq('purgeCompletedAt', undefined).lte('deletedAt', args.deletedBefore)
      )
      .paginate(args.paginationOpts);
  },
});

export const startPermanentPurge = internalMutation({
  args: {
    userProfileId: v.id('userProfile'),
    clerkId: v.string(),
    deletedBefore: v.string(),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const profile = await ctx.db.get(args.userProfileId);
    if (
      !profile ||
      profile.clerkId !== args.clerkId ||
      profile.isDeleted !== true ||
      profile.purgeCompletedAt !== undefined ||
      !isDeletionOldEnough(profile.deletedAt, args.deletedBefore)
    ) {
      return false;
    }

    if (profile.purgeStartedAt === undefined) {
      const now = new Date().toISOString();
      await ctx.db.patch(profile._id, { purgeStartedAt: now, updatedAt: now });
    }

    // Both cleanup chains are idempotent. Re-enqueueing them from the monthly
    // sweep lets a previously failed scheduled step resume on the next run.
    const agentCleanupFinished: boolean = await ctx.runMutation(components.agent.users.deleteAllForUserIdAsync, {
      userId: args.clerkId,
    });
    void agentCleanupFinished;
    await ctx.scheduler.runAfter(0, internal.accountDeletion.purge.purgeNextWorkspace, {
      userProfileId: profile._id,
      clerkId: args.clerkId,
    });
    return true;
  },
});

async function deleteWorkspaceStageBatch(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>,
  stage: WorkspacePurgeStage
): Promise<number> {
  switch (stage) {
    case 'activityLog': {
      const rows = await ctx.db
        .query('activityLog')
        .withIndex('by_workspaceId_and_occurredAt', (q) => q.eq('workspaceId', workspaceId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('activityLog', row._id);
      return rows.length;
    }
    case 'pendingTransferMatch': {
      const rows = await ctx.db
        .query('pendingTransferMatch')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('pendingTransferMatch', row._id);
      return rows.length;
    }
    case 'transaction': {
      const rows = await ctx.db
        .query('transaction')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('transaction', row._id);
      return rows.length;
    }
    case 'scheduledTransactionOccurrence': {
      const rows = await ctx.db
        .query('scheduledTransactionOccurrence')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('scheduledTransactionOccurrence', row._id);
      return rows.length;
    }
    case 'scheduledTransaction': {
      const rows = await ctx.db
        .query('scheduledTransaction')
        .withIndex('by_workspaceId_isDeleted', (q) => q.eq('workspaceId', workspaceId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('scheduledTransaction', row._id);
      return rows.length;
    }
    case 'scheduledTransactionSkip': {
      const rows = await ctx.db
        .query('scheduledTransactionSkip')
        .withIndex('by_workspaceId_and_occurrenceDate', (q) => q.eq('workspaceId', workspaceId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('scheduledTransactionSkip', row._id);
      return rows.length;
    }
    case 'transactionImportRaw': {
      const rows = await ctx.db
        .query('transactionImportRaw')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('transactionImportRaw', row._id);
      return rows.length;
    }
    case 'financeKitTransactionImport': {
      const rows = await ctx.db
        .query('financeKitTransactionImport')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('financeKitTransactionImport', row._id);
      return rows.length;
    }
    case 'categoryBudget': {
      const rows = await ctx.db
        .query('categoryBudget')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('categoryBudget', row._id);
      return rows.length;
    }
    case 'bankAccountFavorite': {
      const rows = await ctx.db
        .query('bankAccountFavorite')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('bankAccountFavorite', row._id);
      return rows.length;
    }
    case 'categoryFavorite': {
      const rows = await ctx.db
        .query('categoryFavorite')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('categoryFavorite', row._id);
      return rows.length;
    }
    case 'transactionRule': {
      const rows = await ctx.db
        .query('transactionRule')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('transactionRule', row._id);
      return rows.length;
    }
    case 'uploadedFile': {
      const rows = await ctx.db
        .query('uploadedFile')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) {
        await ctx.storage.delete(row.storageId);
        await ctx.db.delete('uploadedFile', row._id);
      }
      return rows.length;
    }
    case 'bankAccount': {
      const rows = await ctx.db
        .query('bankAccount')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('bankAccount', row._id);
      return rows.length;
    }
    case 'financeKitAccount': {
      const rows = await ctx.db
        .query('financeKitAccount')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('financeKitAccount', row._id);
      return rows.length;
    }
    case 'financeKitSyncToken': {
      const rows = await ctx.db
        .query('financeKitSyncToken')
        .withIndex('by_workspaceId_ownerClerkId_deviceId_isRevoked', (q) => q.eq('workspaceId', workspaceId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('financeKitSyncToken', row._id);
      return rows.length;
    }
    case 'financeKitConnection': {
      const rows = await ctx.db
        .query('financeKitConnection')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('financeKitConnection', row._id);
      return rows.length;
    }
    case 'category': {
      const rows = await ctx.db
        .query('category')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('category', row._id);
      return rows.length;
    }
    case 'categoryGroup': {
      const rows = await ctx.db
        .query('categoryGroup')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('categoryGroup', row._id);
      return rows.length;
    }
    case 'merchant': {
      const rows = await ctx.db
        .query('merchant')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('merchant', row._id);
      return rows.length;
    }
    case 'orgMerchantCategoryMapping': {
      const rows = await ctx.db
        .query('orgMerchantCategoryMapping')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('orgMerchantCategoryMapping', row._id);
      return rows.length;
    }
    case 'widgetToken': {
      const rows = await ctx.db
        .query('widgetToken')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('widgetToken', row._id);
      return rows.length;
    }
  }
}

export const purgeNextWorkspace = internalMutation({
  args: {
    userProfileId: v.id('userProfile'),
    clerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const workspace = await ctx.db
      .query('workspace')
      .withIndex('by_ownerClerkId_isDeleted', (q) => q.eq('ownerClerkId', args.clerkId))
      .first();

    if (!workspace) {
      await ctx.scheduler.runAfter(0, internal.accountDeletion.purge.purgeNextBankLink, args);
      return null;
    }

    await ctx.scheduler.runAfter(0, internal.accountDeletion.purge.purgeWorkspaceStage, {
      ...args,
      workspaceId: workspace._id,
      stage: workspacePurgeStages[0],
    });
    return null;
  },
});

export const purgeWorkspaceStage = internalMutation({
  args: {
    userProfileId: v.id('userProfile'),
    clerkId: v.string(),
    workspaceId: v.id('workspace'),
    stage: workspacePurgeStageValidator,
  },
  handler: async (ctx, args) => {
    const deletedCount = await deleteWorkspaceStageBatch(ctx, args.workspaceId, args.stage);
    if (deletedCount === PURGE_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.accountDeletion.purge.purgeWorkspaceStage, args);
      return null;
    }

    const next = nextStage(workspacePurgeStages, args.stage);
    if (next) {
      await ctx.scheduler.runAfter(0, internal.accountDeletion.purge.purgeWorkspaceStage, {
        ...args,
        stage: next,
      });
      return null;
    }

    const workspace = await ctx.db.get(args.workspaceId);
    if (workspace?.ownerClerkId === args.clerkId) {
      await ctx.db.delete('workspace', workspace._id);
    }
    await ctx.scheduler.runAfter(0, internal.accountDeletion.purge.purgeNextWorkspace, {
      userProfileId: args.userProfileId,
      clerkId: args.clerkId,
    });
    return null;
  },
});

export const purgeNextBankLink = internalMutation({
  args: {
    userProfileId: v.id('userProfile'),
    clerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const bankLink = await ctx.db
      .query('bankLink')
      .withIndex('by_ownerId', (q) => q.eq('ownerId', args.clerkId))
      .first();
    if (!bankLink) {
      await ctx.scheduler.runAfter(0, internal.accountDeletion.purge.purgeNextFamilyGroup, args);
      return null;
    }

    await ctx.scheduler.runAfter(0, internal.accountDeletion.purge.purgeBankLinkChildren, {
      ...args,
      bankLinkId: bankLink._id,
      stage: 'webhooks',
    });
    return null;
  },
});

export const purgeBankLinkChildren = internalMutation({
  args: {
    userProfileId: v.id('userProfile'),
    clerkId: v.string(),
    bankLinkId: v.id('bankLink'),
    stage: v.union(v.literal('webhooks'), v.literal('accounts')),
  },
  handler: async (ctx, args) => {
    if (args.stage === 'webhooks') {
      const rows = await ctx.db
        .query('plaidWebhookLog')
        .withIndex('by_bankLinkId', (q) => q.eq('bankLinkId', args.bankLinkId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('plaidWebhookLog', row._id);
      await ctx.scheduler.runAfter(0, internal.accountDeletion.purge.purgeBankLinkChildren, {
        ...args,
        stage: rows.length === PURGE_BATCH_SIZE ? 'webhooks' : 'accounts',
      });
      return null;
    }

    const rows = await ctx.db
      .query('bankLinkAccount')
      .withIndex('by_bankLinkId', (q) => q.eq('bankLinkId', args.bankLinkId))
      .take(PURGE_BATCH_SIZE);
    for (const row of rows) await ctx.db.delete('bankLinkAccount', row._id);
    if (rows.length === PURGE_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.accountDeletion.purge.purgeBankLinkChildren, args);
      return null;
    }

    const bankLink = await ctx.db.get(args.bankLinkId);
    if (bankLink?.ownerId === args.clerkId) await ctx.db.delete('bankLink', bankLink._id);
    await ctx.scheduler.runAfter(0, internal.accountDeletion.purge.purgeNextBankLink, {
      userProfileId: args.userProfileId,
      clerkId: args.clerkId,
    });
    return null;
  },
});

export const purgeNextFamilyGroup = internalMutation({
  args: {
    userProfileId: v.id('userProfile'),
    clerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const group = await ctx.db
      .query('familyGroup')
      .withIndex('by_ownerClerkId_isDeleted', (q) => q.eq('ownerClerkId', args.clerkId))
      .first();
    if (!group) {
      await ctx.scheduler.runAfter(0, internal.accountDeletion.purge.purgeUserStage, {
        ...args,
        stage: userPurgeStages[0],
      });
      return null;
    }

    await ctx.scheduler.runAfter(0, internal.accountDeletion.purge.purgeFamilyGroupChildren, {
      ...args,
      familyGroupId: group._id,
      stage: 'invites',
    });
    return null;
  },
});

export const purgeFamilyGroupChildren = internalMutation({
  args: {
    userProfileId: v.id('userProfile'),
    clerkId: v.string(),
    familyGroupId: v.id('familyGroup'),
    stage: v.union(v.literal('invites'), v.literal('members')),
  },
  handler: async (ctx, args) => {
    if (args.stage === 'invites') {
      const rows = await ctx.db
        .query('familyGroupInvite')
        .withIndex('by_familyGroupId_status_isDeleted', (q) => q.eq('familyGroupId', args.familyGroupId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('familyGroupInvite', row._id);
      await ctx.scheduler.runAfter(0, internal.accountDeletion.purge.purgeFamilyGroupChildren, {
        ...args,
        stage: rows.length === PURGE_BATCH_SIZE ? 'invites' : 'members',
      });
      return null;
    }

    const rows = await ctx.db
      .query('familyGroupMember')
      .withIndex('by_familyGroupId_isDeleted', (q) => q.eq('familyGroupId', args.familyGroupId))
      .take(PURGE_BATCH_SIZE);
    for (const row of rows) await ctx.db.delete('familyGroupMember', row._id);
    if (rows.length === PURGE_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.accountDeletion.purge.purgeFamilyGroupChildren, args);
      return null;
    }

    const group = await ctx.db.get(args.familyGroupId);
    if (group?.ownerClerkId === args.clerkId) await ctx.db.delete('familyGroup', group._id);
    await ctx.scheduler.runAfter(0, internal.accountDeletion.purge.purgeNextFamilyGroup, {
      userProfileId: args.userProfileId,
      clerkId: args.clerkId,
    });
    return null;
  },
});

async function deleteUserStageBatch(
  ctx: MutationCtx,
  userProfileId: Id<'userProfile'>,
  clerkId: string,
  stage: UserPurgeStage
): Promise<number> {
  switch (stage) {
    case 'bankAccountFavorite': {
      const rows = await ctx.db
        .query('bankAccountFavorite')
        .withIndex('by_userProfileId_and_bankAccountId', (q) => q.eq('userProfileId', userProfileId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('bankAccountFavorite', row._id);
      return rows.length;
    }
    case 'categoryFavorite': {
      const rows = await ctx.db
        .query('categoryFavorite')
        .withIndex('by_userProfileId_and_categoryId', (q) => q.eq('userProfileId', userProfileId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('categoryFavorite', row._id);
      return rows.length;
    }
    case 'ynabImportStatus': {
      const rows = await ctx.db
        .query('ynabImportStatus')
        .withIndex('by_userId', (q) => q.eq('userId', userProfileId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('ynabImportStatus', row._id);
      return rows.length;
    }
    case 'familyGroupInvite': {
      const rows = await ctx.db
        .query('familyGroupInvite')
        .withIndex('by_invitedByUserProfileId', (q) => q.eq('invitedByUserProfileId', userProfileId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('familyGroupInvite', row._id);
      return rows.length;
    }
    case 'familyGroupMember': {
      const rows = await ctx.db
        .query('familyGroupMember')
        .withIndex('by_userProfileId_isDeleted', (q) => q.eq('userProfileId', userProfileId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('familyGroupMember', row._id);
      return rows.length;
    }
    case 'mcpToken': {
      const rows = await ctx.db
        .query('mcpToken')
        .withIndex('by_clerkId', (q) => q.eq('clerkId', clerkId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('mcpToken', row._id);
      return rows.length;
    }
    case 'mcpOauthAuthorizationCode': {
      const rows = await ctx.db
        .query('mcpOauthAuthorizationCode')
        .withIndex('by_clerkId', (q) => q.eq('clerkId', clerkId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('mcpOauthAuthorizationCode', row._id);
      return rows.length;
    }
    case 'mcpOauthAccessToken': {
      const rows = await ctx.db
        .query('mcpOauthAccessToken')
        .withIndex('by_clerkId', (q) => q.eq('clerkId', clerkId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('mcpOauthAccessToken', row._id);
      return rows.length;
    }
    case 'mcpOauthRefreshToken': {
      const rows = await ctx.db
        .query('mcpOauthRefreshToken')
        .withIndex('by_clerkId', (q) => q.eq('clerkId', clerkId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('mcpOauthRefreshToken', row._id);
      return rows.length;
    }
    case 'mcpOauthConnection': {
      const rows = await ctx.db
        .query('mcpOauthConnection')
        .withIndex('by_clerkId', (q) => q.eq('clerkId', clerkId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('mcpOauthConnection', row._id);
      return rows.length;
    }
    case 'apiKey': {
      const rows = await ctx.db
        .query('apiKey')
        .withIndex('by_clerkId', (q) => q.eq('clerkId', clerkId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('apiKey', row._id);
      return rows.length;
    }
    case 'widgetToken': {
      const rows = await ctx.db
        .query('widgetToken')
        .withIndex('by_clerkId', (q) => q.eq('clerkId', clerkId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('widgetToken', row._id);
      return rows.length;
    }
    case 'chatAttachment': {
      const rows = await ctx.db
        .query('chatAttachment')
        .withIndex('by_userId_createdAt', (q) => q.eq('userId', clerkId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) {
        await ctx.storage.delete(row.storageId);
        await ctx.db.delete('chatAttachment', row._id);
      }
      return rows.length;
    }
    case 'aiChatUsage': {
      const rows = await ctx.db
        .query('aiChatUsage')
        .withIndex('by_userId_yearMonth', (q) => q.eq('userId', clerkId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('aiChatUsage', row._id);
      return rows.length;
    }
    case 'aiChatThreadReadState': {
      const rows = await ctx.db
        .query('aiChatThreadReadState')
        .withIndex('by_userId', (q) => q.eq('userId', clerkId))
        .take(PURGE_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete('aiChatThreadReadState', row._id);
      return rows.length;
    }
  }
}

export const purgeUserStage = internalMutation({
  args: {
    userProfileId: v.id('userProfile'),
    clerkId: v.string(),
    stage: userPurgeStageValidator,
  },
  handler: async (ctx, args) => {
    const deletedCount = await deleteUserStageBatch(ctx, args.userProfileId, args.clerkId, args.stage);
    if (deletedCount === PURGE_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.accountDeletion.purge.purgeUserStage, args);
      return null;
    }

    const next = nextStage(userPurgeStages, args.stage);
    if (next) {
      await ctx.scheduler.runAfter(0, internal.accountDeletion.purge.purgeUserStage, { ...args, stage: next });
      return null;
    }

    const profile = await ctx.db.get(args.userProfileId);
    if (profile?.clerkId === args.clerkId && profile.isDeleted === true) {
      const now = new Date().toISOString();
      await ctx.db.patch(profile._id, buildPurgeCompletionUpdates(now));
    }
    return null;
  },
});
