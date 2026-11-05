import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalMutation, internalQuery } from '../_generated/server';
import { bankConnectionReauthorizationValidator } from '../bankConnections/types';

/**
 * Create a bank link record
 * Bank links are cross-workspace and owned by a user (ownerId = clerk ID)
 */
export const createBankLink = internalMutation({
  args: {
    accessToken: v.string(),
    globalInstitutionId: v.id('globalInstitution'),
    itemId: v.string(),
    itemStatus: v.union(v.literal('Healthy'), v.literal('Error'), v.literal('Pending'), v.literal('Disconnected')),
    ownerId: v.string(),
    provider: v.literal('plaid'),
    initialBalanceDate: v.optional(v.string()), // ISO date string (YYYY-MM-DD)
  },
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    return await ctx.db.insert('bankLink', {
      accessToken: args.accessToken,
      globalInstitutionId: args.globalInstitutionId,
      itemId: args.itemId,
      itemStatus: args.itemStatus,
      ownerId: args.ownerId,
      provider: args.provider,
      initialBalanceDate: args.initialBalanceDate,
      createdAt: now,
      updatedAt: now,
      isDeleted: false,
      hasCompletedFirstSync: false,
      webhookMigrationStatus: 'not_needed', // Native Convex links already have correct webhook
    });
  },
});

/**
 * Get a bank link by ID
 */
export const getBankLink = internalQuery({
  args: {
    bankLinkId: v.id('bankLink'),
  },
  handler: async (ctx, { bankLinkId }) => {
    return await ctx.db.get(bankLinkId);
  },
});

/**
 * List bank links for a user (by ownerId)
 * Bank links are cross-workspace, so we query by user instead of workspace
 */
export const listBankLinks = internalQuery({
  args: {
    ownerId: v.string(),
  },
  handler: async (ctx, { ownerId }) => {
    return await ctx.db
      .query('bankLink')
      .withIndex('by_ownerId', (q) => q.eq('ownerId', ownerId))
      .filter((q) => q.neq(q.field('isDeleted'), true))
      .collect();
  },
});

/**
 * Update bank link status
 */
export const updateBankLinkStatus = internalMutation({
  args: {
    itemId: v.string(),
    itemStatus: v.union(v.literal('Healthy'), v.literal('Error'), v.literal('Pending'), v.literal('Disconnected')),
    clearReauthorization: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { itemId, itemStatus, clearReauthorization }) => {
    const bankLink = await ctx.db
      .query('bankLink')
      .withIndex('by_itemId', (q) => q.eq('itemId', itemId))
      .first();

    if (bankLink && !bankLink.isDeleted) {
      const previousStatus = bankLink.itemStatus;

      await ctx.db.patch(bankLink._id, {
        itemStatus,
        reauthorization: clearReauthorization || itemStatus === 'Disconnected' ? undefined : bankLink.reauthorization,
        updatedAt: new Date().toISOString(),
      });

      // Send push notification if transitioning from Healthy to non-Healthy
      if (previousStatus === 'Healthy' && itemStatus !== 'Healthy') {
        await ctx.scheduler.runAfter(0, internal.notifications.apnsActions.sendBankLinkStatusNotification, {
          clerkId: bankLink.ownerId,
          bankLinkId: bankLink._id,
          newStatus: itemStatus,
        });
      }
    }
    return null;
  },
});

/** Record a provider warning without changing health or reviving a disconnected item. */
export const setBankLinkReauthorization = internalMutation({
  args: {
    itemId: v.string(),
    reauthorization: bankConnectionReauthorizationValidator,
  },
  returns: v.null(),
  handler: async (ctx, { itemId, reauthorization }) => {
    const bankLink = await ctx.db
      .query('bankLink')
      .withIndex('by_itemId', (q) => q.eq('itemId', itemId))
      .first();

    if (!bankLink || bankLink.isDeleted || bankLink.itemStatus === 'Disconnected') return null;

    await ctx.db.patch(bankLink._id, {
      reauthorization,
      updatedAt: new Date().toISOString(),
    });
    return null;
  },
});

/**
 * Soft-delete a bank link and all its associated records.
 * This is called after successfully disconnecting from Plaid.
 * - Soft-deletes the bankLink record
 * - Soft-deletes all bankLinkAccount records
 * - Unlinks all bankAccount records (sets bankLinkAccountId to undefined)
 */
export const softDeleteBankLink = internalMutation({
  args: {
    bankLinkId: v.id('bankLink'),
    externalProviderDisconnected: v.optional(v.boolean()),
  },
  handler: async (ctx, { bankLinkId, externalProviderDisconnected = true }) => {
    const now = new Date().toISOString();
    const bankLink = await ctx.db.get(bankLinkId);

    if (!bankLink) {
      return { success: true };
    }

    // 1. Get all bank link accounts for this bank link
    const bankLinkAccounts = await ctx.db
      .query('bankLinkAccount')
      .withIndex('by_bankLinkId', (q) => q.eq('bankLinkId', bankLinkId))
      .filter((q) => q.neq(q.field('isDeleted'), true))
      .collect();

    // 2. For each bank link account, unlink any connected bank accounts
    for (const bla of bankLinkAccounts) {
      // Find all bank accounts linked to this bank link account (across all workspaces)
      const linkedBankAccounts = await ctx.db
        .query('bankAccount')
        .withIndex('by_bankLinkAccountId', (q) => q.eq('bankLinkAccountId', bla._id))
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .collect();

      // Unlink each bank account
      for (const ba of linkedBankAccounts) {
        await ctx.db.patch(ba._id, {
          bankLinkAccountId: undefined,
          updatedAt: now,
        });
      }

      // Soft-delete the bank link account
      await ctx.db.patch(bla._id, {
        isDeleted: true,
        deletedAt: now,
        updatedAt: now,
      });
    }

    // 3. Soft-delete the bank link itself
    await ctx.db.patch(bankLinkId, {
      isDeleted: true,
      deletedAt: now,
      updatedAt: now,
      itemStatus: 'Disconnected',
      providerDisconnectedAt: externalProviderDisconnected ? now : bankLink.providerDisconnectedAt,
    });

    return { success: true };
  },
});

/**
 * List bank links with pending webhook migration status
 * Used by the manual webhook update process
 */
export const listPendingWebhookMigrations = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query('bankLink')
      .filter((q) => q.and(q.eq(q.field('webhookMigrationStatus'), 'pending'), q.neq(q.field('isDeleted'), true)))
      .collect();
  },
});

/**
 * Update the webhook migration status for a bank link
 * Used by the Plaid webhook update action to track progress
 */
export const updateWebhookMigrationStatus = internalMutation({
  args: {
    bankLinkId: v.id('bankLink'),
    status: v.union(v.literal('not_needed'), v.literal('pending'), v.literal('completed'), v.literal('failed')),
  },
  handler: async (ctx, { bankLinkId, status }) => {
    await ctx.db.patch(bankLinkId, {
      webhookMigrationStatus: status,
      updatedAt: new Date().toISOString(),
    });
  },
});
