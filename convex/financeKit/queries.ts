import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

const MAX_FINANCEKIT_CONNECTIONS = 100;
const MAX_FINANCEKIT_ACCOUNTS_PER_CONNECTION = 100;

type FinanceKitConnection = Doc<'financeKitConnection'>;
type FinanceKitAccount = Doc<'financeKitAccount'>;
type FinanceKitConnectionOwnerView = {
  clerkId: string;
  name: string | null;
  email: string | null;
};
type SharedFinanceKitAccountView = {
  _id: Id<'financeKitAccount'>;
  _creationTime: number;
  workspaceId: Id<'workspace'>;
  connectionId: Id<'financeKitConnection'>;
  externalAccountId: string;
  accountKind: FinanceKitAccount['accountKind'];
  accountType: Doc<'bankAccount'>['accountType'];
  displayName: string;
  institutionName: string;
  accountDescription: undefined;
  currencyCode: string;
  hasCompletedInitialSync: boolean;
  bankAccountId: Id<'bankAccount'>;
  connectedBankAccount: { _id: Id<'bankAccount'>; name: string } | null;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
};

function getFinanceKitConnectionOwnerView(
  ctx: QueryCtx,
  clerkId: string,
  ownerCache: Map<string, Promise<FinanceKitConnectionOwnerView | null>>
): Promise<FinanceKitConnectionOwnerView | null> {
  const cached = ownerCache.get(clerkId);
  if (cached) return cached;

  const owner = ctx.db
    .query('userProfile')
    .withIndex('by_clerkId', (q) => q.eq('clerkId', clerkId))
    .first()
    .then((profile) =>
      profile ? { clerkId: profile.clerkId, name: profile.name ?? null, email: profile.email ?? null } : null
    );
  ownerCache.set(clerkId, owner);
  return owner;
}

async function loadFinanceKitAccountsForConnection(ctx: QueryCtx, connectionId: Id<'financeKitConnection'>) {
  return await ctx.db
    .query('financeKitAccount')
    .withIndex('by_connectionId_isDeleted', (q) => q.eq('connectionId', connectionId).eq('isDeleted', false))
    .take(MAX_FINANCEKIT_ACCOUNTS_PER_CONNECTION);
}

async function buildOwnedConnectionView(
  ctx: QueryCtx,
  connection: FinanceKitConnection,
  accounts: FinanceKitAccount[],
  owner: FinanceKitConnectionOwnerView | null,
  currentOwnerClerkId: string
) {
  const isOwnedByCurrentUser = connection.ownerClerkId === currentOwnerClerkId;
  const enrichedAccounts = await Promise.all(
    accounts.map(async (account) => {
      const bankAccount = account.bankAccountId ? await ctx.db.get(account.bankAccountId) : null;

      return {
        ...account,
        bankAccountId: account.bankAccountId ?? null,
        connectedBankAccount:
          bankAccount && bankAccount.workspaceId === account.workspaceId && !bankAccount.isDeleted
            ? {
                _id: bankAccount._id,
                name: bankAccount.name,
              }
            : null,
      };
    })
  );

  return {
    ...connection,
    ownerClerkId: connection.ownerClerkId,
    owner,
    isOwnedByCurrentUser,
    canManageConnection: isOwnedByCurrentUser,
    accounts: enrichedAccounts,
  };
}

async function buildSharedConnectionView(
  ctx: QueryCtx,
  workspaceId: Id<'workspace'>,
  connection: FinanceKitConnection,
  accounts: FinanceKitAccount[],
  owner: FinanceKitConnectionOwnerView | null,
  currentOwnerClerkId: string
) {
  const isOwnedByCurrentUser = connection.ownerClerkId === currentOwnerClerkId;

  const accountViews = await Promise.all(
    accounts.map(async (account): Promise<SharedFinanceKitAccountView | null> => {
      if (!account.bankAccountId) {
        return null;
      }

      const bankAccount = await ctx.db.get(account.bankAccountId);
      if (!bankAccount || bankAccount.workspaceId !== workspaceId || bankAccount.isDeleted) {
        return null;
      }

      return {
        _id: account._id,
        _creationTime: account._creationTime,
        workspaceId: account.workspaceId,
        connectionId: account.connectionId,
        externalAccountId: `shared:${account._id}`,
        accountKind: account.accountKind,
        accountType: bankAccount.accountType,
        displayName: bankAccount.name,
        institutionName: 'Apple Wallet',
        accountDescription: undefined,
        currencyCode: account.currencyCode,
        hasCompletedInitialSync: account.hasCompletedInitialSync,
        bankAccountId: bankAccount._id,
        connectedBankAccount: {
          _id: bankAccount._id,
          name: bankAccount.name,
        },
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
        isDeleted: account.isDeleted,
      };
    })
  );
  const sharedAccounts = accountViews.filter(isPresent);

  if (sharedAccounts.length === 0) {
    return null;
  }

  return {
    _id: connection._id,
    _creationTime: connection._creationTime,
    workspaceId: connection.workspaceId,
    deviceId: 'shared',
    status: connection.status,
    syncStartDate: connection.syncStartDate,
    lastSyncedAt: connection.lastSyncedAt,
    ownerClerkId: connection.ownerClerkId,
    owner,
    isOwnedByCurrentUser,
    canManageConnection: isOwnedByCurrentUser,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    isDeleted: connection.isDeleted,
    accounts: sharedAccounts,
  };
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

export async function listConnectionsInternal(
  ctx: QueryCtx,
  args: {
    workspaceId: Id<'workspace'>;
    ownerClerkId: string;
    deviceId?: string;
  }
) {
  const ownerCache = new Map<string, Promise<FinanceKitConnectionOwnerView | null>>();
  const workspaceConnections = await ctx.db
    .query('financeKitConnection')
    .withIndex('by_workspaceId_isDeleted', (q) => q.eq('workspaceId', args.workspaceId).eq('isDeleted', false))
    .take(MAX_FINANCEKIT_CONNECTIONS);

  // Most workspaces fit in one page. Reuse that page for owned and shared views;
  // retain the targeted owner query if the workspace page may be truncated.
  let ownedConnections = workspaceConnections.filter(
    (connection) =>
      connection.ownerClerkId === args.ownerClerkId &&
      (args.deviceId === undefined || connection.deviceId === args.deviceId)
  );
  if (workspaceConnections.length === MAX_FINANCEKIT_CONNECTIONS) {
    const deviceId = args.deviceId;
    ownedConnections =
      deviceId === undefined
        ? await ctx.db
            .query('financeKitConnection')
            .withIndex('by_workspaceId_ownerClerkId_isDeleted', (q) =>
              q.eq('workspaceId', args.workspaceId).eq('ownerClerkId', args.ownerClerkId).eq('isDeleted', false)
            )
            .take(MAX_FINANCEKIT_CONNECTIONS)
        : await ctx.db
            .query('financeKitConnection')
            .withIndex('by_workspaceId_ownerClerkId_deviceId_isDeleted', (q) =>
              q
                .eq('workspaceId', args.workspaceId)
                .eq('ownerClerkId', args.ownerClerkId)
                .eq('deviceId', deviceId)
                .eq('isDeleted', false)
            )
            .take(MAX_FINANCEKIT_CONNECTIONS);
  }

  const ownedConnectionIds = new Set(ownedConnections.map((connection) => connection._id));
  const sharedConnections = workspaceConnections.filter((connection) => !ownedConnectionIds.has(connection._id));
  const connectionViews = await Promise.all(
    [...ownedConnections, ...sharedConnections].map(async (connection) => {
      const [accounts, owner] = await Promise.all([
        loadFinanceKitAccountsForConnection(ctx, connection._id),
        getFinanceKitConnectionOwnerView(ctx, connection.ownerClerkId, ownerCache),
      ]);
      return ownedConnectionIds.has(connection._id)
        ? await buildOwnedConnectionView(ctx, connection, accounts, owner, args.ownerClerkId)
        : await buildSharedConnectionView(ctx, args.workspaceId, connection, accounts, owner, args.ownerClerkId);
    })
  );

  return connectionViews.filter(isPresent);
}
