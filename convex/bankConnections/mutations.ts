import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { mutation } from '../_generated/server';
import { createBankAccountHandler } from '../bankAccounts/create';
import { updateBankAccountHandler } from '../bankAccounts/update';
import { requireBankLinkAccountAccessForWorkspace } from '../bankLinks/helpers';
import { disconnectConnectionInternal } from '../financeKit/mutations';
import { requireWorkspaceAccess } from '../lib/auth';
import { getCurrentDateForTimezone } from '../lib/dates';
import { isValidIsoDate } from '../scheduledTransactions/recurrence';
import {
  appleWalletConnectionRefValidator,
  bankConnectionAccountRefValidator,
  bankConnectionRefValidator,
} from './types';

export function resolvePlaidSyncStartDate(date: string | undefined, timezone: string | undefined): string {
  const today = getCurrentDateForTimezone(timezone);
  const startDate = date ?? today;
  if (!isValidIsoDate(startDate) || startDate > today) {
    throw new ConvexError('Choose a valid start date on or before today');
  }
  return startDate;
}

export const createBankAccountFromConnectionAccount = mutation({
  args: {
    workspaceId: v.id('workspace'),
    connectionAccount: bankConnectionAccountRefValidator,
    initialBalanceDate: v.optional(v.string()),
  },
  returns: v.id('bankAccount'),
  handler: async (ctx, args): Promise<Id<'bankAccount'>> => {
    const { workspaceId } = await requireWorkspaceAccess(ctx, args.workspaceId);

    if (args.connectionAccount.provider === 'plaid') {
      if (!args.initialBalanceDate) {
        throw new ConvexError('initialBalanceDate is required when creating an account from a Plaid connection');
      }
      const workspace = await ctx.db.get(workspaceId);
      const startDate = resolvePlaidSyncStartDate(args.initialBalanceDate, workspace?.timezone);

      const { bankLinkAccount } = await requireBankLinkAccountAccessForWorkspace(
        ctx,
        workspaceId,
        args.connectionAccount.accountId
      );

      const bankAccountId = await createBankAccountHandler(ctx, {
        workspaceId,
        name: bankLinkAccount.name,
        bankLinkAccountId: args.connectionAccount.accountId,
        initialBalance: BigInt(bankLinkAccount.initialBalance ?? 0),
        initialBalanceDate: startDate,
      });
      const generation = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await ctx.db.patch(bankAccountId, {
        plaidInitialSync: {
          bankLinkAccountId: bankLinkAccount._id,
          startDate,
          status: 'pending',
          preserveBalance: true,
          generation,
        },
      });
      await ctx.scheduler.runAfter(0, internal.bankProviders.plaid.initialAccountSync.syncAccount, {
        bankAccountId,
        bankLinkAccountId: bankLinkAccount._id,
        generation,
      });
      return bankAccountId;
    }

    const appleWalletAccount = await ctx.db.get(args.connectionAccount.accountId);
    if (!appleWalletAccount || appleWalletAccount.workspaceId !== workspaceId || appleWalletAccount.isDeleted) {
      throw new ConvexError('Apple Wallet account not found or does not belong to workspace');
    }

    return await createBankAccountHandler(ctx, {
      workspaceId,
      name: appleWalletAccount.displayName,
      financeKitAccountId: args.connectionAccount.accountId,
    });
  },
});

export const linkAccount = mutation({
  args: {
    workspaceId: v.id('workspace'),
    bankAccountId: v.id('bankAccount'),
    connectionAccount: bankConnectionAccountRefValidator,
    initialBalanceDate: v.optional(v.string()),
  },
  returns: v.object({ success: v.literal(true) }),
  handler: async (ctx, args): Promise<{ success: true }> => {
    const { workspaceId } = await requireWorkspaceAccess(ctx, args.workspaceId);

    if (args.connectionAccount.provider === 'plaid') {
      const workspace = await ctx.db.get(workspaceId);
      const startDate = resolvePlaidSyncStartDate(args.initialBalanceDate, workspace?.timezone);
      const result = await updateBankAccountHandler(ctx, {
        workspaceId,
        bankAccountId: args.bankAccountId,
        bankLinkAccountId: args.connectionAccount.accountId,
      });
      const generation = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await ctx.db.patch(args.bankAccountId, {
        plaidInitialSync: {
          bankLinkAccountId: args.connectionAccount.accountId,
          startDate,
          status: 'pending',
          preserveBalance: false,
          generation,
        },
      });
      await ctx.scheduler.runAfter(0, internal.bankProviders.plaid.initialAccountSync.syncAccount, {
        bankAccountId: args.bankAccountId,
        bankLinkAccountId: args.connectionAccount.accountId,
        generation,
      });
      return result;
    }

    return await updateBankAccountHandler(ctx, {
      workspaceId,
      bankAccountId: args.bankAccountId,
      financeKitAccountId: args.connectionAccount.accountId,
    });
  },
});

export const unlinkAccount = mutation({
  args: {
    workspaceId: v.id('workspace'),
    bankAccountId: v.id('bankAccount'),
  },
  handler: async (ctx, args): Promise<{ success: true }> => {
    const { workspaceId } = await requireWorkspaceAccess(ctx, args.workspaceId);

    return await updateBankAccountHandler(ctx, {
      workspaceId,
      bankAccountId: args.bankAccountId,
      bankLinkAccountId: null,
      financeKitAccountId: null,
    });
  },
});

export const disconnectAppleWalletConnection = mutation({
  args: {
    workspaceId: v.id('workspace'),
    connection: appleWalletConnectionRefValidator,
  },
  handler: async (ctx, args): Promise<{ disconnectedAccountCount: number }> => {
    const { workspaceId, user } = await requireWorkspaceAccess(ctx, args.workspaceId);

    const result = await disconnectConnectionInternal(ctx, {
      workspaceId,
      ownerClerkId: user.subject,
      connectionId: args.connection.connectionId,
    });
    await ctx.runMutation(internal.activityLogs.internal.recordAppleWalletConnectionEvent, {
      workspaceId,
      connectionId: args.connection.connectionId,
      type: 'bank_connection_disconnected',
      attribution: { clerkId: user.subject, source: { type: 'kualia_ui' } },
    });
    return result;
  },
});

export const disconnectConnectionMutation = mutation({
  args: {
    workspaceId: v.id('workspace'),
    connection: bankConnectionRefValidator,
  },
  handler: async (ctx, args): Promise<{ disconnectedAccountCount: number }> => {
    const { workspaceId, user } = await requireWorkspaceAccess(ctx, args.workspaceId);

    if (args.connection.provider !== 'apple_wallet') {
      throw new ConvexError('Plaid connections must be disconnected through bankConnections.disconnectConnection');
    }

    const result = await disconnectConnectionInternal(ctx, {
      workspaceId,
      ownerClerkId: user.subject,
      connectionId: args.connection.connectionId,
    });
    await ctx.runMutation(internal.activityLogs.internal.recordAppleWalletConnectionEvent, {
      workspaceId,
      connectionId: args.connection.connectionId,
      type: 'bank_connection_disconnected',
      attribution: { clerkId: user.subject, source: { type: 'kualia_ui' } },
    });
    return result;
  },
});
