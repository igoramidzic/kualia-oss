import { getIdentity } from '../lib/identity';
import { ConvexError, v } from 'convex/values';

import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { action, mutation } from '../_generated/server';
import {
  buildActivityContextForClerkId,
  recordBankAccountActivity,
  recordBankConnectionActivity,
} from '../activityLogs/helpers';
import { requireAuth } from '../lib/auth';

/**
 * @deprecated Use `bankConnections.disconnectConnection` from clients.
 *
 * Soft delete a bank link and unlink associated bank accounts
 * Bank accounts and transactions are preserved, but no longer linked to the external connection
 * Bank links are cross-workspace, so we verify ownership by ownerId (user's clerk ID)
 */
export const deleteBankLink = mutation({
  args: {
    bankLinkId: v.id('bankLink'),
  },
  handler: async (ctx, { bankLinkId }) => {
    const identity = await requireAuth(ctx);

    // Verify ownership by ownerId
    const existing = await ctx.db.get(bankLinkId);
    if (!existing || existing.ownerId !== identity.subject) {
      throw new ConvexError('Bank link not found or access denied');
    }

    const now = new Date().toISOString();
    const activityContext = await buildActivityContextForClerkId(ctx, identity.subject, {
      type: 'kualia_ui',
    });

    // 1. Soft delete the bank link
    await ctx.db.patch(bankLinkId, {
      isDeleted: true,
      deletedAt: now,
      updatedAt: now,
    });

    // 2. Find and soft delete all bank link accounts
    const linkAccounts = await ctx.db
      .query('bankLinkAccount')
      .withIndex('by_bankLinkId', (q) => q.eq('bankLinkId', bankLinkId))
      .collect();
    const affectedWorkspaceIds = new Set<Id<'workspace'>>();

    for (const linkAccount of linkAccounts) {
      await ctx.db.patch(linkAccount._id, {
        isDeleted: true,
        deletedAt: now,
        updatedAt: now,
      });

      // 3. Find bankAccount that references this linkAccount and unlink it
      // (do not delete the bank account or its transactions)
      const bankAccounts = await ctx.db
        .query('bankAccount')
        .withIndex('by_bankLinkAccountId', (q) => q.eq('bankLinkAccountId', linkAccount._id))
        .collect();

      for (const bankAccount of bankAccounts) {
        await ctx.db.patch(bankAccount._id, {
          bankLinkAccountId: undefined,
          updatedAt: now,
        });
        const updatedBankAccount = await ctx.db.get(bankAccount._id);
        if (updatedBankAccount) {
          affectedWorkspaceIds.add(bankAccount.workspaceId);
          await recordBankAccountActivity(ctx, {
            workspaceId: bankAccount.workspaceId,
            context: activityContext,
            type: 'bank_account_updated',
            before: bankAccount,
            after: updatedBankAccount,
          });
        }
      }
    }

    const institution = await ctx.db.get(existing.globalInstitutionId);
    for (const workspaceId of affectedWorkspaceIds) {
      await recordBankConnectionActivity(ctx, {
        workspaceId,
        context: activityContext,
        type: 'bank_connection_disconnected',
        connection: {
          id: existing._id,
          provider: 'plaid',
          institutionName: institution?.name ?? 'Bank connection',
          accountNames: linkAccounts.map((account) => account.name),
        },
      });
    }
  },
});

/**
 * @deprecated Use `bankConnections.disconnectConnection` from clients.
 *
 * Delete a bank link by disconnecting from Plaid and soft deleting the record
 * Bank links are cross-workspace, so we only need the bankLinkId
 */
export const deleteBankLinkAction = action({
  args: {
    bankLinkId: v.id('bankLink'),
  },
  handler: async (ctx, { bankLinkId }) => {
    // Get user context for logging
    const identity = await getIdentity(ctx);
    const userId = identity?.subject;

    try {
      // First, disconnect from Plaid
      const disconnectResult = await ctx.runAction(api.bankProviders.disconnectPlaidItem, {
        bankLinkId,
      });

      if (!disconnectResult.success) {
        console.error('[Bank Link Delete] Plaid disconnect returned failure', {
          bankLinkId,
          userId,
        });
        throw new ConvexError('Failed to disconnect from Plaid');
      }

      // If Plaid disconnect succeeds, soft delete the bank link
      await ctx.runMutation(api.bankLinks.deleteBankLink, {
        bankLinkId,
      });

      return { success: true };
    } catch (error: unknown) {
      console.error('[Bank Link Delete] Error during delete action', error);

      if (error instanceof ConvexError) {
        throw error;
      }

      if (error instanceof Error) {
        throw new ConvexError(`Failed to delete bank connection: ${error.message}`);
      }

      throw new ConvexError('Failed to delete bank connection');
    }
  },
});
