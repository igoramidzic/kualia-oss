import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { query } from '../_generated/server';
import { listBankLinksInternal } from '../bankLinks/queries';
import { listConnectionsInternal } from '../financeKit/queries';
import { requireWorkspaceAccess } from '../lib/auth';
import { getAppleWalletLogoUrl } from '../lib/logoUtils';

type PlaidConnectionView = Awaited<ReturnType<typeof listBankLinksInternal>>[number];
type AppleWalletConnectionView = Awaited<ReturnType<typeof listConnectionsInternal>>[number];
type BankConnectionStatus = 'connected' | 'needs_attention' | 'pending' | 'disconnected';

function mapPlaidStatus(status: PlaidConnectionView['itemStatus']): BankConnectionStatus {
  switch (status) {
    case 'Healthy':
      return 'connected';
    case 'Pending':
      return 'pending';
    case 'Error':
      return 'needs_attention';
    case 'Disconnected':
      return 'disconnected';
  }
}

function mapAppleWalletStatus(status: AppleWalletConnectionView['status']): BankConnectionStatus {
  switch (status) {
    case 'active':
      return 'connected';
    case 'disconnected':
      return 'disconnected';
  }
}

function getStatusLabel(status: BankConnectionStatus): string {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'needs_attention':
      return 'Needs attention';
    case 'pending':
      return 'Pending';
    case 'disconnected':
      return 'Disconnected';
  }
}

function toConnectedBankAccount(account: { _id: Doc<'bankAccount'>['_id']; name: string } | null) {
  return account
    ? {
        _id: account._id,
        name: account.name,
      }
    : null;
}

export function toPlaidConnection(connection: PlaidConnectionView) {
  const provider = 'plaid' as const;
  const status = mapPlaidStatus(connection.itemStatus);

  return {
    id: connection._id,
    ref: {
      provider,
      connectionId: connection._id,
    },
    provider,
    displayName: connection.institution?.name ?? 'Unknown Institution',
    logoUrl: connection.institution?.logo ?? null,
    primaryColor: connection.institution?.primaryColor ?? null,
    status,
    statusLabel: getStatusLabel(status),
    rawStatus: connection.itemStatus,
    reauthorization: connection.reauthorization ?? null,
    lastSyncedAt: connection.lastSyncedAt ?? null,
    owner: connection.owner,
    isOwnedByCurrentUser: connection.isOwnedByCurrentUser,
    canManageConnection: connection.canManageConnection,
    management: {
      type: 'kualia' as const,
      label: 'Managed in Kualia',
    },
    accounts: connection.accounts.map((account) => ({
      id: account._id,
      ref: {
        provider,
        accountId: account._id,
      },
      name: account.name,
      accountType: account.accountType,
      accountNumberMask: account.accountNumberMask,
      initialBalance: account.initialBalance,
      currencyCode: null,
      description: account.officialName ?? null,
      hasCompletedInitialSync: account.hasCompletedInitialSync,
      isLinked: account.connectedBankAccount !== null,
      linkedToBankAccount: toConnectedBankAccount(account.connectedBankAccount),
    })),
  };
}

export function toAppleWalletConnection(connection: AppleWalletConnectionView) {
  const provider = 'apple_wallet' as const;
  const status = mapAppleWalletStatus(connection.status);

  return {
    id: connection._id,
    ref: {
      provider,
      connectionId: connection._id,
    },
    provider,
    displayName: 'Apple Wallet',
    logoUrl: getAppleWalletLogoUrl(),
    primaryColor: null,
    status,
    statusLabel: getStatusLabel(status),
    rawStatus: connection.status,
    reauthorization: null,
    lastSyncedAt: connection.lastSyncedAt ?? null,
    syncStartDate: connection.syncStartDate,
    owner: connection.owner,
    isOwnedByCurrentUser: connection.isOwnedByCurrentUser,
    canManageConnection: connection.canManageConnection,
    management: {
      type: 'ios' as const,
      label: 'Managed from iOS',
    },
    accounts: connection.accounts.map((account) => ({
      id: account._id,
      ref: {
        provider,
        accountId: account._id,
      },
      name: account.displayName,
      accountType: account.accountType ?? null,
      accountNumberMask: null,
      initialBalance: null,
      currencyCode: account.currencyCode ?? null,
      externalAccountId: account.externalAccountId,
      accountKind: account.accountKind,
      institutionName: account.institutionName ?? null,
      description: account.accountDescription ?? null,
      hasCompletedInitialSync: account.hasCompletedInitialSync,
      isLinked: account.connectedBankAccount !== null,
      linkedToBankAccount: toConnectedBankAccount(account.connectedBankAccount),
    })),
  };
}

export const listConnections = query({
  args: {
    workspaceId: v.id('workspace'),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { workspaceId, user } = await requireWorkspaceAccess(ctx, args.workspaceId);
    const [plaidConnections, appleWalletConnections] = await Promise.all([
      listBankLinksInternal(ctx, {
        workspaceId,
        currentUserClerkId: user.subject,
      }),
      listConnectionsInternal(ctx, {
        workspaceId,
        ownerClerkId: user.subject,
        deviceId: args.deviceId,
      }),
    ]);

    return [...plaidConnections.map(toPlaidConnection), ...appleWalletConnections.map(toAppleWalletConnection)];
  },
});
