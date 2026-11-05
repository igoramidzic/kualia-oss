import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { FunctionReturnType } from 'convex/server';
import { extractConvexErrorMessage } from '../shared/utils/convex-error-message';
import { EntityIconColorId, VisualIdentityMode } from '../shared/utils/entity-identity';
import { LocalAuthService } from './local-auth.service';
import { ConvexService } from './convex.service';
import { WorkspaceService } from './workspace.service';

// Infer the return types directly from the Convex queries
// Use getMerchant return type instead since listMerchants has a union return type
export type Merchant = Awaited<FunctionReturnType<typeof api.merchants.getMerchant>>;

export interface MerchantFilters {
  includeDeleted?: boolean;
  search?: string;
}

@Injectable({
  providedIn: 'root',
})
export class MerchantService {
  private readonly convexService = inject(ConvexService);
  private readonly clerkService = inject(LocalAuthService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly destroyRef = inject(DestroyRef);

  // Signals for state management
  private readonly _allMerchants = signal<Merchant[]>([]);
  private readonly _loading = signal<boolean>(false);
  private readonly _hasLoaded = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);
  private readonly _filters = signal<MerchantFilters>({});
  private readonly _dialogOpen = signal<boolean>(false);

  // Subscription management
  private merchantSubscription?: () => void;

  // Dialog opener function
  private dialogOpener?: () => void;

  // Public read-only signals
  readonly loading = this._loading.asReadonly();
  readonly hasLoaded = this._hasLoaded.asReadonly();
  readonly error = this._error.asReadonly();
  readonly filters = this._filters.asReadonly();
  readonly dialogOpen = this._dialogOpen.asReadonly();

  // Filtered merchants computed from all merchants and search filter
  readonly merchants = computed(() => {
    const allMerchants = this._allMerchants();
    const filters = this._filters();
    const search = filters.search?.toLowerCase().trim();

    let filteredMerchants = allMerchants;

    if (search) {
      filteredMerchants = filteredMerchants.filter((merchant) => merchant.name.toLowerCase().includes(search));
    }

    // Sort by transaction count (descending)
    // Create a copy before sorting to avoid mutation
    return [...filteredMerchants].sort((a, b) => (b.transactionCount ?? 0) - (a.transactionCount ?? 0));
  });

  // Computed values
  readonly totalMerchants = computed(() => this._allMerchants().length);
  readonly hasMerchants = computed(() => this._allMerchants().length > 0);

  readonly activeMerchants = computed(() => {
    return this._allMerchants().filter((merchant) => !merchant.isDeleted);
  });

  readonly deletedMerchants = computed(() => {
    return this._allMerchants().filter((merchant) => merchant.isDeleted);
  });

  constructor() {
    // Start watching merchants when authenticated AND workspace is available
    effect(() => {
      const hasWorkspace = !!this.workspaceService.workspaceId();
      if (this.convexService.isAuthenticated() && hasWorkspace) {
        this.startWatchingMerchants();
      } else {
        this.stopWatchingMerchants();
        this._allMerchants.set([]);
        this._hasLoaded.set(false);
      }
    });

    // Clean up on destroy
    this.destroyRef.onDestroy(() => {
      this.stopWatchingMerchants();
    });
  }

  /**
   * Update filters (client-side filtering, no server request)
   */
  updateFilters(filters: Partial<MerchantFilters>) {
    this._filters.update((current) => ({ ...current, ...filters }));
    // Only restart subscription if includeDeleted changes (requires server query)
    const previousIncludeDeleted = this._filters().includeDeleted;
    const newIncludeDeleted = filters.includeDeleted;
    if (newIncludeDeleted !== undefined && newIncludeDeleted !== previousIncludeDeleted) {
      this.startWatchingMerchants();
    }
  }

  /**
   * Clear all filters
   */
  clearFilters() {
    const hadIncludeDeleted = this._filters().includeDeleted;
    this._filters.set({});
    // Only restart if includeDeleted was previously set
    if (hadIncludeDeleted) {
      this.startWatchingMerchants();
    }
  }

  /**
   * Start watching merchants with real-time updates
   */
  private startWatchingMerchants() {
    // Stop existing subscription if any
    this.stopWatchingMerchants();

    this._loading.set(true);
    this._error.set(null);

    try {
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._loading.set(false);
        return;
      }

      const filters = this._filters();
      const queryArgs = {
        workspaceId: workspaceId as Id<'workspace'>,
        includeDeleted: filters.includeDeleted ?? false,
      };

      // Subscribe to the query
      const watcher = this.convexService.watchQuery<Merchant[]>(api.merchants.listMerchants, queryArgs);

      this.merchantSubscription = watcher.subscribe((merchants) => {
        if (merchants !== undefined) {
          this._allMerchants.set(merchants);
          this._loading.set(false);
          this._hasLoaded.set(true);
        }
      });
    } catch (error) {
      console.error('Error watching merchants:', error);
      this._error.set('Failed to load merchants');
      this._loading.set(false);
    }
  }

  /**
   * Stop watching merchants
   */
  private stopWatchingMerchants() {
    if (this.merchantSubscription) {
      this.merchantSubscription();
      this.merchantSubscription = undefined;
    }
  }

  /**
   * Create a new merchant
   */
  async createMerchant(merchant: {
    name: string;
    logoUrl?: string;
    visualIdentityMode?: VisualIdentityMode;
    iconName?: string;
    iconColorId?: EntityIconColorId;
  }): Promise<Id<'merchant'> | null> {
    try {
      this._error.set(null);
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        return null;
      }
      const result = await this.convexService.mutation<Id<'merchant'>>(api.merchants.createMerchant, {
        workspaceId: workspaceId as Id<'workspace'>,
        ...merchant,
      });
      return result;
    } catch (error) {
      console.error('Error creating merchant:', error);
      this._error.set('Failed to create merchant');
      return null;
    }
  }

  /**
   * Update an existing merchant
   *
   * logoUrl states:
   * - 'UNSET': Delete field and fall back to global merchant logo
   * - string URL: Set custom logo
   * - null: Explicitly set no logo (even if global has one)
   *
   * @throws Error with the actual error message from the backend
   */
  async updateMerchant(
    merchantId: Id<'merchant'>,
    updates: {
      name?: string;
      logoUrl?: string | null;
      visualIdentityMode?: VisualIdentityMode;
      iconName?: string;
      iconColorId?: EntityIconColorId;
    }
  ): Promise<void> {
    this._error.set(null);
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      throw new Error('No workspace selected');
    }
    try {
      await this.convexService.mutation(api.merchants.updateMerchant, {
        workspaceId: workspaceId as Id<'workspace'>,
        merchantId,
        ...updates,
      });
    } catch (error: unknown) {
      throw new Error(extractConvexErrorMessage(error, 'Failed to update merchant'));
    }
  }
  /**
   * Merge one merchant into another
   * All transactions from sourceMerchant will be moved to targetMerchant,
   * spending stats will be combined, and sourceMerchant will be deleted.
   */
  async mergeMerchants(
    sourceMerchantId: Id<'merchant'>,
    targetMerchantId: Id<'merchant'>
  ): Promise<{ mergedTransactionCount: number } | null> {
    try {
      this._error.set(null);
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        return null;
      }
      const result = await this.convexService.mutation<{ mergedTransactionCount: number }>(
        api.merchants.mergeMerchants,
        {
          workspaceId: workspaceId as Id<'workspace'>,
          sourceMerchantId,
          targetMerchantId,
        }
      );
      return result;
    } catch (error) {
      console.error('Error merging merchants:', error);
      throw new Error(extractConvexErrorMessage(error, 'Failed to merge merchants'));
    }
  }

  /**
   * Delete a merchant. If the merchant has transactions or planned templates,
   * targetMerchantId is required so those references can be moved first.
   */
  async deleteMerchant(
    merchantId: Id<'merchant'>,
    targetMerchantId?: Id<'merchant'>
  ): Promise<{
    success: true;
    movedTransactionCount: number;
    updatedRecurringTransactionCount: number;
  }> {
    this._error.set(null);
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      throw new Error('No workspace selected');
    }

    try {
      return await this.convexService.mutation<{
        success: true;
        movedTransactionCount: number;
        updatedRecurringTransactionCount: number;
      }>(api.merchants.deleteMerchant, {
        workspaceId: workspaceId as Id<'workspace'>,
        merchantId,
        targetMerchantId: targetMerchantId ?? undefined,
      });
    } catch (error: unknown) {
      throw new Error(extractConvexErrorMessage(error, 'Failed to delete merchant'));
    }
  }

  /**
   * Get a specific merchant by ID
   */
  async getMerchant(merchantId: Id<'merchant'>) {
    try {
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        return null;
      }
      const merchant = await this.convexService.getClient().query(api.merchants.getMerchant, {
        workspaceId: workspaceId as Id<'workspace'>,
        merchantId,
      });
      return merchant;
    } catch (error) {
      console.error('Error getting merchant:', error);
      this._error.set('Failed to get merchant');
      return null;
    }
  }

  /**
   * Get a merchant by the last 8 characters of its ID
   */
  async getMerchantByShortId(shortId: string): Promise<Merchant | null> {
    try {
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        return null;
      }
      const merchant = await this.convexService.getClient().query(api.merchants.getMerchantByShortId, {
        workspaceId: workspaceId as Id<'workspace'>,
        shortId,
      });
      return merchant;
    } catch (error) {
      console.error('Error getting merchant by short ID:', error);
      this._error.set('Failed to get merchant');
      return null;
    }
  }

  /**
   * Refresh merchants manually
   */
  refresh() {
    this.startWatchingMerchants();
  }

  /**
   * Find an existing merchant or create a new one
   */
  async findOrCreateMerchant(name: string): Promise<Merchant> {
    const normalizedName = name.trim().replace(/\s+/g, ' ');

    // First check if merchant exists (case-insensitive)
    const merchants = this.merchants();
    const existingMerchant = merchants.find((m) => m.name.toLowerCase() === normalizedName.toLowerCase());

    if (existingMerchant) {
      return existingMerchant;
    }

    // Create new merchant if not found
    const merchantId = await this.createMerchant({ name: normalizedName });
    if (!merchantId) {
      throw new Error('Failed to create merchant');
    }

    // Fetch the newly created merchant
    const newMerchant = await this.getMerchant(merchantId);
    if (!newMerchant) {
      throw new Error('Failed to fetch newly created merchant');
    }

    return newMerchant;
  }

  /**
   * Clear error state
   */
  clearError() {
    this._error.set(null);
  }

  /**
   * Set the dialog opener function (called by layout component)
   */
  setDialogOpener(opener: () => void): void {
    this.dialogOpener = opener;
  }

  /**
   * Open the create merchant dialog
   */
  openCreateDialog(): void {
    if (this.dialogOpener) {
      this._dialogOpen.set(true);
      this.dialogOpener();
    }
  }

  /**
   * Mark dialog as closed
   */
  closeDialog(): void {
    this._dialogOpen.set(false);
  }
}
