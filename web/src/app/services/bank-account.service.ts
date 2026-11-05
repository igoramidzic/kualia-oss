import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { FunctionReturnType } from 'convex/server';
import { EntityIconColorId, VisualIdentityMode } from '../shared/utils/entity-identity';
import { LocalAuthService } from './local-auth.service';
import { ConvexService } from './convex.service';
import { ReportingService, TrackingEvent } from './reporting.service';
import { WorkspaceService } from './workspace.service';

// Infer the return types directly from the Convex queries
export type BankAccountWithRelations = FunctionReturnType<typeof api.bankAccounts.listBankAccounts>[number];

export interface BankAccountFilters {
  includeDeleted?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class BankAccountService {
  private readonly convexService = inject(ConvexService);
  private readonly clerkService = inject(LocalAuthService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly reportingService = inject(ReportingService);
  private readonly destroyRef = inject(DestroyRef);

  // Signals for state management
  private readonly _bankAccounts = signal<BankAccountWithRelations[]>([]);
  private readonly _loading = signal<boolean>(false);
  private readonly _hasLoaded = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);
  private readonly _filters = signal<BankAccountFilters>({});

  // Context signals for single bank account view
  private readonly _currentBankAccount = signal<BankAccountWithRelations | null>(null);
  private readonly _isLoadingCurrent = signal<boolean>(false);
  private readonly _isUpdatingSlug = signal<boolean>(false);

  // Subscription management
  private bankAccountSubscription?: () => void;
  private currentBankAccountSubscription?: () => void;

  // Public read-only signals
  readonly bankAccounts = this._bankAccounts.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly hasLoaded = this._hasLoaded.asReadonly();
  readonly error = this._error.asReadonly();
  readonly filters = this._filters.asReadonly();

  // Context signals for single bank account view
  readonly currentBankAccount = computed(() => this._currentBankAccount());
  readonly isLoadingCurrent = computed(() => this._isLoadingCurrent());
  readonly isUpdatingSlug = computed(() => this._isUpdatingSlug());

  // Computed values
  readonly sortedBankAccounts = computed(() =>
    [...this._bankAccounts()].sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    })
  );

  readonly totalAccounts = computed(() => this._bankAccounts().length);
  readonly hasAccounts = computed(() => this._bankAccounts().length > 0);

  readonly activeBankAccounts = computed(() => {
    return this._bankAccounts().filter((account) => !account.isDeleted);
  });

  readonly deletedBankAccounts = computed(() => {
    return this._bankAccounts().filter((account) => account.isDeleted);
  });

  readonly linkedAccounts = computed(() => {
    return this._bankAccounts().filter((account) => account.connectionAccount !== null);
  });

  readonly manualAccounts = computed(() => {
    return this._bankAccounts().filter((account) => account.connectionAccount === null);
  });

  constructor() {
    // Start watching bank accounts when authenticated AND workspace is available
    effect(() => {
      const hasWorkspace = !!this.workspaceService.workspaceId();
      const isAuthenticated = this.convexService.isAuthenticated();
      if (isAuthenticated && hasWorkspace) {
        this.startWatchingBankAccounts();
      } else {
        this.stopWatchingBankAccounts();
        this._bankAccounts.set([]);
        this._hasLoaded.set(false);
      }
    });

    // Clean up on destroy
    this.destroyRef.onDestroy(() => {
      this.stopWatchingBankAccounts();
    });
  }

  /**
   * Update filters and refresh bank accounts
   */
  updateFilters(filters: Partial<BankAccountFilters>) {
    this._filters.update((current) => ({ ...current, ...filters }));
    this.startWatchingBankAccounts();
  }

  /**
   * Clear all filters
   */
  clearFilters() {
    this._filters.set({});
    this.startWatchingBankAccounts();
  }

  /**
   * Start watching bank accounts with real-time updates
   */
  private startWatchingBankAccounts() {
    // Stop existing subscription if any
    this.stopWatchingBankAccounts();

    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      return;
    }

    this._loading.set(true);
    this._error.set(null);

    try {
      const filters = this._filters();
      const queryArgs = {
        workspaceId: workspaceId as Id<'workspace'>,
        includeDeleted: filters.includeDeleted ?? false,
      };

      // Subscribe to the query
      const watcher = this.convexService.watchQuery<BankAccountWithRelations[]>(
        api.bankAccounts.listBankAccounts,
        queryArgs
      );

      this.bankAccountSubscription = watcher.subscribe((bankAccounts) => {
        if (bankAccounts !== undefined) {
          this._bankAccounts.set(bankAccounts);
          this._loading.set(false);
          this._hasLoaded.set(true);
        }
      });
    } catch (error) {
      console.error('Error watching bank accounts:', error);
      this._error.set('Failed to load bank accounts');
      this._loading.set(false);
    }
  }

  /**
   * Stop watching bank accounts
   */
  private stopWatchingBankAccounts() {
    if (this.bankAccountSubscription) {
      this.bankAccountSubscription();
      this.bankAccountSubscription = undefined;
    }
  }

  /**
   * Watch a specific bank account by short ID with real-time updates
   */
  watchCurrentBankAccount(shortId: string): () => void {
    // Stop existing subscription if any
    this.stopWatchingCurrentBankAccount();

    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      this._isLoadingCurrent.set(false);
      return () => {
        // No-op cleanup function
      };
    }

    this._isLoadingCurrent.set(true);
    this._error.set(null);

    try {
      const queryArgs = {
        workspaceId: workspaceId as Id<'workspace'>,
        shortId,
      };

      // Subscribe to the query
      const watcher = this.convexService.watchQuery<BankAccountWithRelations | null>(
        api.bankAccounts.getBankAccountByShortId,
        queryArgs
      );

      this.currentBankAccountSubscription = watcher.subscribe((bankAccount) => {
        this._currentBankAccount.set(bankAccount ?? null);
        this._isLoadingCurrent.set(false);
      });

      return () => this.stopWatchingCurrentBankAccount();
    } catch (error) {
      console.error('Error watching current bank account:', error);
      this._error.set('Failed to load bank account');
      this._isLoadingCurrent.set(false);
      return () => {
        // No-op cleanup function
      };
    }
  }

  /**
   * Stop watching the current bank account
   */
  stopWatchingCurrentBankAccount() {
    if (this.currentBankAccountSubscription) {
      this.currentBankAccountSubscription();
      this.currentBankAccountSubscription = undefined;
    }
  }

  /**
   * Create a new bank account
   */
  async createBankAccount(bankAccount: {
    name: string;
    bankLinkAccountId?: Id<'bankLinkAccount'>;
    financeKitAccountId?: Id<'financeKitAccount'>;
    accountType?: string;
    initialBalance?: bigint;
    initialBalanceDate?: string;
    visualIdentityMode?: VisualIdentityMode;
    iconName?: string;
    iconColorId?: EntityIconColorId;
  }): Promise<Id<'bankAccount'> | null> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      console.error('No workspace ID available');
      this._error.set('No workspace selected');
      return null;
    }

    try {
      this._error.set(null);
      const result = await this.convexService.mutation<Id<'bankAccount'>>(api.bankAccounts.createBankAccount, {
        workspaceId: workspaceId as Id<'workspace'>,
        ...bankAccount,
      });
      this.reportingService.capture(TrackingEvent.ACCOUNT_CREATED, {
        type: bankAccount.accountType ?? 'unknown',
        is_linked: false,
      });
      return result;
    } catch (error) {
      console.error('Error creating bank account:', error);
      this._error.set('Failed to create bank account');
      throw error;
    }
  }

  /**
   * Create multiple bank accounts from bank link accounts in a single atomic transaction
   * All accounts are created or none if any validation fails
   */
  async createBankAccountsFromBankLinkAccounts(
    bankLinkAccountIds: Id<'bankLinkAccount'>[],
    initialBalanceDate: string
  ): Promise<Id<'bankAccount'>[]> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      throw new Error('No workspace selected');
    }

    try {
      this._error.set(null);
      const result = await this.convexService.mutation<Id<'bankAccount'>[]>(
        api.bankAccounts.createBankAccountsFromBankLinkAccounts,
        {
          workspaceId: workspaceId as Id<'workspace'>,
          bankLinkAccountIds,
          initialBalanceDate,
        }
      );
      this.reportingService.capture(TrackingEvent.ACCOUNT_CREATED, { type: 'linked', is_linked: true });
      return result;
    } catch (error) {
      console.error('Error creating bank accounts:', error);
      this._error.set('Failed to create bank accounts');
      throw error;
    }
  }

  /**
   * Update an existing bank account
   * @param logoUrl - Logo handling:
   *   - `undefined`: Don't update logo
   *   - `null`: Remove logo explicitly (no logo even if institution has one)
   *   - `'UNSET'`: Reset to default (fall back to institution logo)
   *   - `string`: Set custom logo URL
   */
  async updateBankAccount(
    bankAccountId: Id<'bankAccount'>,
    updates: {
      name?: string;
      notes?: string;
      logoUrl?: string | null;
      visualIdentityMode?: VisualIdentityMode;
      iconName?: string;
      iconColorId?: EntityIconColorId;
    }
  ): Promise<boolean> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      console.error('No workspace ID available');
      this._error.set('No workspace selected');
      return false;
    }

    try {
      this._error.set(null);
      await this.convexService.mutation(api.bankAccounts.updateBankAccount, {
        workspaceId: workspaceId as Id<'workspace'>,
        bankAccountId,
        ...updates,
      });
      this.reportingService.capture(TrackingEvent.ACCOUNT_UPDATED);
      return true;
    } catch (error) {
      console.error('Error updating bank account:', error);
      this._error.set('Failed to update bank account');
      return false;
    }
  }

  async setBankAccountFavorite(bankAccountId: Id<'bankAccount'>, isFavorite: boolean): Promise<boolean> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      this._error.set('No workspace selected');
      return false;
    }

    try {
      this._error.set(null);
      await this.convexService.mutation(api.bankAccounts.setBankAccountFavorite, {
        workspaceId: workspaceId as Id<'workspace'>,
        bankAccountId,
        isFavorite,
      });
      return true;
    } catch (error: unknown) {
      console.error('Failed to update bank account favorite:', error);
      this._error.set(error instanceof Error ? error.message : 'Failed to update bank account favorite');
      return false;
    }
  }

  /**
   * @deprecated Use `BankConnectionService.linkAccount` or `BankConnectionService.unlinkAccount`.
   *
   * Link or unlink a bank account to/from a bank link account
   * @param bankAccountId - The bank account to update
   * @param bankLinkAccountId - The bank link account to link to, or null to unlink
   */
  async linkToBankLinkAccount(
    bankAccountId: Id<'bankAccount'>,
    bankLinkAccountId: Id<'bankLinkAccount'> | null
  ): Promise<void> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      throw new Error('No workspace selected');
    }

    await this.convexService.mutation(api.bankAccounts.updateBankAccount, {
      workspaceId: workspaceId as Id<'workspace'>,
      bankAccountId,
      bankLinkAccountId,
    });
  }

  /**
   * @deprecated Use `BankConnectionService.linkAccount` or `BankConnectionService.unlinkAccount`.
   *
   * Link or unlink a bank account to/from an Apple Wallet account
   * @param bankAccountId - The bank account to update
   * @param financeKitAccountId - The Apple Wallet account to link to, or null to unlink
   */
  async linkToFinanceKitAccount(
    bankAccountId: Id<'bankAccount'>,
    financeKitAccountId: Id<'financeKitAccount'> | null
  ): Promise<void> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      throw new Error('No workspace selected');
    }

    await this.convexService.mutation(api.bankAccounts.updateBankAccount, {
      workspaceId: workspaceId as Id<'workspace'>,
      bankAccountId,
      financeKitAccountId,
    });
  }

  /**
   * Delete a bank account (soft delete)
   */
  async deleteBankAccount(bankAccountId: Id<'bankAccount'>): Promise<boolean> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      console.error('No workspace ID available');
      this._error.set('No workspace selected');
      return false;
    }

    try {
      this._error.set(null);
      await this.convexService.mutation(api.bankAccounts.deleteBankAccount, {
        workspaceId: workspaceId as Id<'workspace'>,
        bankAccountId,
      });
      this.reportingService.capture(TrackingEvent.ACCOUNT_DELETED);
      return true;
    } catch (error) {
      console.error('Error deleting bank account:', error);
      this._error.set('Failed to delete bank account');
      return false;
    }
  }

  /**
   * Get a specific bank account by ID
   */
  async getBankAccount(bankAccountId: Id<'bankAccount'>) {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      console.error('No workspace ID available');
      this._error.set('No workspace selected');
      return null;
    }

    try {
      const account = await this.convexService.getClient().query(api.bankAccounts.getBankAccount, {
        workspaceId: workspaceId as Id<'workspace'>,
        bankAccountId,
      });
      return account;
    } catch (error) {
      console.error('Error getting bank account:', error);
      this._error.set('Failed to get bank account');
      return null;
    }
  }

  /**
   * Get a specific bank account by short ID (last 8 characters)
   * First checks if bank account exists in local state, otherwise fetches from server
   */
  async getBankAccountByShortId(shortId: string) {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      console.error('No workspace ID available');
      this._error.set('No workspace selected');
      return null;
    }

    // First, check if we already have this bank account in local state
    const localBankAccount = this._bankAccounts().find((account) => account._id.slice(-8) === shortId);

    if (localBankAccount) {
      return localBankAccount;
    }

    // If not found locally, fetch from server
    try {
      const account = await this.convexService.getClient().query(api.bankAccounts.getBankAccountByShortId, {
        workspaceId: workspaceId as Id<'workspace'>,
        shortId,
      });
      return account;
    } catch (error) {
      console.error('Error getting bank account by short ID:', error);
      this._error.set('Failed to get bank account');
      return null;
    }
  }

  /**
   * Fetch a specific bank account by short ID directly from the server
   * Always bypasses local cache to get fresh data
   */
  async fetchBankAccountByShortId(shortId: string) {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      console.error('No workspace ID available');
      this._error.set('No workspace selected');
      return null;
    }

    try {
      const account = await this.convexService.getClient().query(api.bankAccounts.getBankAccountByShortId, {
        workspaceId: workspaceId as Id<'workspace'>,
        shortId,
      });
      return account;
    } catch (error) {
      console.error('Error fetching bank account by short ID:', error);
      this._error.set('Failed to get bank account');
      return null;
    }
  }

  /**
   * Refresh bank accounts manually
   */
  refresh() {
    this.startWatchingBankAccounts();
  }

  /**
   * Clear error state
   */
  clearError() {
    this._error.set(null);
  }

  /**
   * Set the current bank account for single account view
   */
  setCurrentBankAccount(bankAccount: BankAccountWithRelations | null) {
    this._currentBankAccount.set(bankAccount);
  }

  /**
   * Set loading state for current bank account
   */
  setLoadingCurrent(isLoading: boolean) {
    this._isLoadingCurrent.set(isLoading);
  }

  /**
   * Set updating slug state
   */
  setUpdatingSlug(isUpdating: boolean) {
    this._isUpdatingSlug.set(isUpdating);
  }
}
