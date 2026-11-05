import { ConvexError } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

const MAX_FINANCEKIT_ACCOUNTS_PER_CONNECTION = 100;

type FinanceKitAccount = Doc<'financeKitAccount'>;
type FinanceKitConnection = Doc<'financeKitConnection'>;

async function requireOwnedFinanceKitConnection(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<'workspace'>;
    ownerClerkId: string;
    deviceId?: string;
    connectionId: Id<'financeKitConnection'>;
  }
): Promise<FinanceKitConnection> {
  const connection = await ctx.db.get(args.connectionId);
  if (
    !connection ||
    connection.workspaceId !== args.workspaceId ||
    connection.isDeleted ||
    connection.status !== 'active'
  ) {
    throw new ConvexError('FinanceKit connection not found');
  }

  if (connection.ownerClerkId !== args.ownerClerkId) {
    throw new ConvexError('Access denied: FinanceKit connection belongs to another user');
  }

  if (args.deviceId !== undefined && connection.deviceId !== args.deviceId) {
    throw new ConvexError('Access denied: FinanceKit connection belongs to another device');
  }

  return connection;
}

async function loadFinanceKitAccountsForConnection(
  ctx: MutationCtx,
  connectionId: Id<'financeKitConnection'>
): Promise<FinanceKitAccount[]> {
  return await ctx.db
    .query('financeKitAccount')
    .withIndex('by_connectionId_isDeleted', (q) => q.eq('connectionId', connectionId).eq('isDeleted', false))
    .take(MAX_FINANCEKIT_ACCOUNTS_PER_CONNECTION);
}

export async function disconnectConnectionInternal(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<'workspace'>;
    ownerClerkId: string;
    deviceId?: string;
    connectionId: Id<'financeKitConnection'>;
  }
): Promise<{ disconnectedAccountCount: number }> {
  const connection = await requireOwnedFinanceKitConnection(ctx, args);
  const accounts = await loadFinanceKitAccountsForConnection(ctx, connection._id);
  const now = new Date().toISOString();

  for (const account of accounts) {
    await disconnectFinanceKitAccount(ctx, {
      workspaceId: args.workspaceId,
      account,
      now,
    });
  }

  await ctx.db.patch(connection._id, {
    status: 'disconnected',
    isDeleted: true,
    deletedAt: now,
    updatedAt: now,
  });

  return { disconnectedAccountCount: accounts.length };
}

async function disconnectFinanceKitAccount(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<'workspace'>;
    account: FinanceKitAccount;
    now: string;
  }
): Promise<void> {
  const linkedBankAccountId = args.account.bankAccountId;

  await ctx.db.patch(args.account._id, {
    bankAccountId: undefined,
    isDeleted: true,
    deletedAt: args.now,
    updatedAt: args.now,
  });

  if (!linkedBankAccountId) {
    return;
  }

  const bankAccount = await ctx.db.get(linkedBankAccountId);
  if (bankAccount && bankAccount.workspaceId === args.workspaceId && !bankAccount.isDeleted) {
    await ctx.db.patch(bankAccount._id, {
      financeKitAccountId: undefined,
      updatedAt: args.now,
    });
  }
}
