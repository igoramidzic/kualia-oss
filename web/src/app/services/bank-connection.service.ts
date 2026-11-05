import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { api } from 'convex/_generated/api';
import type { Id } from 'convex/_generated/dataModel';
import { FunctionReturnType } from 'convex/server';
import { ConvexService } from './convex.service';
import { WorkspaceService } from './workspace.service';

type BankConnectionsQueryResult = FunctionReturnType<typeof api.bankConnections.listConnections>;
export type BankConnection = BankConnectionsQueryResult[number];
export type BankConnectionAccount = BankConnection['accounts'][number];
export type BankConnectionRef = BankConnection['ref'];
export type BankConnectionAccountRef = BankConnectionAccount['ref'];
export type BankConnectionProvider = BankConnection['provider'];

export interface BankLinkAccountGroupAccount {
  _id: Id<'bankLinkAccount'>;
  name: string;
  accountType: string;
  accountNumberMask: string | null;
  initialBalance: number | null;
  isLinked: boolean;
  linkedToBankAccount: { _id: Id<'bankAccount'>; name: string } | null;
}

export interface BankLinkAccountGroup {
  bankLinkId: Id<'bankLink'>;
  itemStatus: 'Healthy' | 'Error' | 'Pending' | 'Disconnected';
  lastSyncedAt: string | null;
  owner: BankConnection['owner'];
  isOwnedByCurrentUser: boolean;
  canManageConnection: boolean;
  institution: {
    name: string;
    logo: string | null;
    primaryColor: string | null;
  } | null;
  accounts: BankLinkAccountGroupAccount[];
}

type PlaidBankConnection = BankConnection & {
  provider: 'plaid';
  ref: { provider: 'plaid'; connectionId: Id<'bankLink'> };
};

function isPlaidConnection(connection: BankConnection): connection is PlaidBankConnection {
  return connection.provider === 'plaid' && connection.ref.provider === 'plaid';
}

function getPlaidItemStatus(connection: BankConnection): BankLinkAccountGroup['itemStatus'] {
  switch (connection.status) {
    case 'connected':
      return 'Healthy';
    case 'needs_attention':
      return 'Error';
    case 'pending':
      return 'Pending';
    case 'disconnected':
      return 'Disconnected';
  }
}

@Injectable({
  providedIn: 'root',
})
export class BankConnectionService {
  private readonly convexService = inject(ConvexService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _connections = signal<BankConnection[]>([]);
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);

  private connectionsSubscription?: () => void;

  readonly connections = this._connections.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  /**
   * @deprecated Use `connections` for the provider-neutral connection list.
   */
  readonly bankLinkAccountGroups = computed<BankLinkAccountGroup[]>(() =>
    this._connections()
      .filter(isPlaidConnection)
      .map((connection) => ({
        bankLinkId: connection.ref.connectionId,
        itemStatus: getPlaidItemStatus(connection),
        lastSyncedAt: connection.lastSyncedAt,
        owner: connection.owner,
        isOwnedByCurrentUser: connection.isOwnedByCurrentUser,
        canManageConnection: connection.canManageConnection,
        institution: {
          name: connection.displayName,
          logo: connection.logoUrl,
          primaryColor: connection.primaryColor,
        },
        accounts: connection.accounts.flatMap((account) => {
          if (account.ref.provider !== 'plaid') {
            return [];
          }

          return [
            {
              _id: account.ref.accountId,
              name: account.name,
              accountType: account.accountType ?? 'banking_other',
              accountNumberMask: account.accountNumberMask,
              initialBalance: account.initialBalance,
              isLinked: account.isLinked,
              linkedToBankAccount: account.linkedToBankAccount,
            },
          ];
        }),
      }))
  );

  constructor() {
    effect(() => {
      const hasWorkspace = !!this.workspaceService.workspaceId();
      if (this.convexService.isAuthenticated() && hasWorkspace) {
        this.startWatchingBankConnections();
      } else {
        this.stopWatchingBankConnections();
        this._connections.set([]);
      }
    });

    this.destroyRef.onDestroy(() => {
      this.stopWatchingBankConnections();
    });
  }

  private startWatchingBankConnections(): void {
    if (this.connectionsSubscription) {
      return;
    }

    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      return;
    }

    this._loading.set(true);
    this._error.set(null);

    try {
      const watcher = this.convexService.watchQuery<BankConnectionsQueryResult>(api.bankConnections.listConnections, {
        workspaceId: workspaceId as Id<'workspace'>,
      });

      this.connectionsSubscription = watcher.subscribe((data) => {
        if (data !== undefined) {
          this._connections.set(data);
          this._loading.set(false);
        }
      });
    } catch (error: unknown) {
      console.error('Error watching bank connections:', error);
      this._error.set('Failed to load bank connections');
      this._loading.set(false);
    }
  }

  private stopWatchingBankConnections(): void {
    if (this.connectionsSubscription) {
      this.connectionsSubscription();
      this.connectionsSubscription = undefined;
    }

    this._loading.set(false);
  }

  refresh(): void {
    this.stopWatchingBankConnections();
    this.startWatchingBankConnections();
  }

  clearError(): void {
    this._error.set(null);
  }

  async createBankAccountFromConnectionAccount(
    connectionAccount: BankConnectionAccountRef,
    options: { initialBalanceDate?: string } = {}
  ): Promise<Id<'bankAccount'>> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      throw new Error('No workspace selected');
    }

    return await this.convexService.mutation<Id<'bankAccount'>>(
      api.bankConnections.createBankAccountFromConnectionAccount,
      {
        workspaceId: workspaceId as Id<'workspace'>,
        connectionAccount,
        ...(options.initialBalanceDate !== undefined ? { initialBalanceDate: options.initialBalanceDate } : {}),
      }
    );
  }

  async linkAccount(bankAccountId: Id<'bankAccount'>, connectionAccount: BankConnectionAccountRef): Promise<void> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      throw new Error('No workspace selected');
    }

    await this.convexService.mutation(api.bankConnections.linkAccount, {
      workspaceId: workspaceId as Id<'workspace'>,
      bankAccountId,
      connectionAccount,
    });
  }

  async unlinkAccount(bankAccountId: Id<'bankAccount'>): Promise<void> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      throw new Error('No workspace selected');
    }

    await this.convexService.mutation(api.bankConnections.unlinkAccount, {
      workspaceId: workspaceId as Id<'workspace'>,
      bankAccountId,
    });
  }

  async disconnectConnection(connection: BankConnectionRef): Promise<{ disconnectedAccountCount: number | null }> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      throw new Error('No workspace selected');
    }

    return await this.convexService.action<{ disconnectedAccountCount: number | null }>(
      api.bankConnections.disconnectConnection,
      {
        workspaceId: workspaceId as Id<'workspace'>,
        connection,
      }
    );
  }
}
