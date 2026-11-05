import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { toast } from 'ngx-sonner';
import { EntityIconColorId, VisualIdentityMode } from '../shared/utils/entity-identity';
import { BankAccountService, BankAccountWithRelations } from './bank-account.service';
import { Category, CategoryService } from './category.service';
import { ConvexService } from './convex.service';
import { Merchant, MerchantService } from './merchant.service';
import { ReportingService, TrackingEvent } from './reporting.service';
import { UndoRedoService } from './undo-redo.service';
import { WorkspaceService } from './workspace.service';

// Import types from Convex (frontend populates relations locally)
import type { Recurrence } from 'convex/scheduledTransactions/types';
import type {
  TransactionMovementWithRelations as ConvexMovementWithRelations,
  RawTransactionWithMovements,
} from 'convex/transactions/types';

export type RawTransaction = RawTransactionWithMovements;

/**
 * Result of api.transactions.createRegularTransaction. The legacy path (no recurrence,
 * date today or in the past) returns the plain transaction id; a future date or a
 * recurrence returns the object shape - branch on `typeof result === 'string'`.
 */
export type CreateScheduledTransactionResult =
  | Id<'transaction'>
  | {
      transactionId?: Id<'transaction'>;
      transferPairTransactionId?: Id<'transaction'>;
      scheduledTransactionId: Id<'scheduledTransaction'>;
      nextDate: string;
    };
export type CreateRegularTransactionResult = CreateScheduledTransactionResult;
export type CreateTransferTransactionResult = CreateScheduledTransactionResult;

export type UpdateTransactionScheduleResult = {
  success: boolean;
  scheduledTransactionId?: Id<'scheduledTransaction'>;
  nextDate?: string;
  convertedToScheduled?: boolean;
  deletedTransactionId?: Id<'transaction'>;
  deletedTransferPairTransactionId?: Id<'transaction'>;
};

// Re-export movement type with frontend category type
export interface TransactionMovementWithRelations extends Omit<ConvexMovementWithRelations, 'category'> {
  category: Category | null;
}

// Transaction with all relations populated by frontend
// Extends raw transaction and adds populated fields
export interface TransactionWithRelations extends RawTransactionWithMovements {
  // Populated bank account (transformed from BankAccountWithRelations)
  bankAccount: {
    _id: Id<'bankAccount'>;
    _creationTime: number;
    name: string;
    visualIdentityMode?: VisualIdentityMode;
    iconName?: string;
    iconColorId?: EntityIconColorId;
    workspaceId: Id<'workspace'>;
    bankLinkAccountId?: Id<'bankLinkAccount'>;
    currentBalance: bigint;
    isDeleted: boolean;
    updatedAt?: string;
    deletedAt?: string;
    accountType: string;
    bankLinkAccount: {
      _id: Id<'bankLinkAccount'>;
      _creationTime: number;
      bankLinkId: Id<'bankLink'>;
      accountType: string;
      currentBalance: bigint | null;
      availableBalance: bigint | null;
      accountNumberMask: string | null;
      officialName: string | null;
      bankLink: {
        _id: Id<'bankLink'>;
        _creationTime: number;
        workspaceId: Id<'workspace'>;
        itemStatus: string;
        lastSyncedAt?: string;
        globalInstitutionId?: Id<'globalInstitution'>;
      } | null;
    } | null;
    institution: {
      _id: Id<'globalInstitution'>;
      _creationTime: number;
      name: string;
      logoUrl?: string;
      primaryColor?: string;
      updatedAt?: string;
    } | null;
  } | null;

  // Populated merchant
  merchant: {
    _id: Id<'merchant'>;
    name: string;
    logoUrl?: string;
    visualIdentityMode?: VisualIdentityMode;
    iconName?: string;
    iconColorId?: EntityIconColorId;
  } | null;

  // Resolved merchant info (fallback to import details)
  merchantName: string | null;
  merchantLogo: string | null;
  merchantVisualIdentityMode: VisualIdentityMode | null;
  merchantIconName: string | null;
  merchantIconColorId: EntityIconColorId | null;

  // Populated movements with categories
  movements: TransactionMovementWithRelations[];

  // Transfer pair info (frontend computed)
  transferPairAccountName: string | null;
  transferPairAccountLogo: string | null;
  transferPairAccountVisualIdentityMode: VisualIdentityMode | null;
  transferPairAccountIconName: string | null;
  transferPairAccountIconColorId: EntityIconColorId | null;

  // Calculated amount (sum of movements)
  amount: bigint;

  // For transfer transactions, indicates if this crosses the budget boundary
  isCrossBudgetTransfer: boolean;
}

export type TransactionFilterType = 'all' | 'needs_review' | 'pending' | 'transfer';

export interface CreateTransactionDialogMovementDraft {
  amount: bigint;
  categoryId?: Id<'category'>;
  readyToAssign?: boolean;
  notes?: string;
}

export interface CreateTransactionDialogDraft {
  type: 'regular' | 'transfer';
  date: string;
  recurrence: Recurrence;
  bankAccountId: Id<'bankAccount'>;
  transferToAccountId?: Id<'bankAccount'>;
  amount: bigint;
  merchantId?: Id<'merchant'>;
  pendingMerchantName?: string;
  movements: CreateTransactionDialogMovementDraft[];
  notes?: string;
  status?: 'pending' | 'cleared';
}

export interface CreateTransactionDialogContext {
  bankAccountId?: Id<'bankAccount'>;
  draft?: CreateTransactionDialogDraft;
  /**
   * Prefill just the date (ISO YYYY-MM-DD) without a full draft, e.g. from the Planned
   * calendar. Ignored when a draft is provided. Recurrence keeps the dialog default ('once').
   */
  initialDate?: string;
  source?: 'transaction-details';
}

export interface TransactionFilters {
  startDate?: string;
  endDate?: string;
  categoryId?: Id<'category'>;
  merchantId?: Id<'merchant'>;
  bankAccountId?: Id<'bankAccount'>;
  filterType?: TransactionFilterType;
  search?: string;
}

interface TransactionToastOptions {
  loading?: string;
  success?: string | ((result: unknown) => string);
  error?: string | ((error: unknown) => string);
  enabled?: boolean;
  silent?: boolean;
}

const PAGE_SIZE = 50;

@Injectable({
  providedIn: 'root',
})
export class TransactionService {
  private readonly convexService = inject(ConvexService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly reportingService = inject(ReportingService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly categoryService = inject(CategoryService);
  private readonly bankAccountService = inject(BankAccountService);
  private readonly merchantService = inject(MerchantService);
  private readonly undoRedoService = inject(UndoRedoService);

  // Signals for state management - store raw transactions from backend
  private readonly _rawTransactions = signal<RawTransaction[]>([]);
  private readonly _loading = signal<boolean>(false);
  private readonly _loadingMore = signal<boolean>(false);
  private readonly _hasLoaded = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);
  private readonly _filters = signal<TransactionFilters>({});
  private readonly _cursor = signal<string | null>(null);
  private readonly _hasMore = signal<boolean>(true);

  // Transaction status counts (pre-loaded during initialization)
  private readonly _statusCounts = signal<{
    pendingCount: number;
    needsReviewCount: number;
    transferCount: number;
  }>({
    pendingCount: 0,
    needsReviewCount: 0,
    transferCount: 0,
  });
  private readonly _loadingStatusCounts = signal<boolean>(false);
  private readonly _hasLoadedStatusCounts = signal<boolean>(false);

  // Real-time subscription management
  private readonly _loadedTransactionIds = signal<Set<Id<'transaction'>>>(new Set());
  private transactionSubscription?: () => void;
  private statusCountsSubscription?: () => void;

  // Dialog opener function with optional context
  private dialogOpener?: (context?: CreateTransactionDialogContext) => void;

  // Current bank account context for transaction creation (set by bank account pages)
  private readonly _currentBankAccountContext = signal<Id<'bankAccount'> | null>(null);

  // Computed: populate transactions using local service data
  readonly transactions = computed(() => {
    const rawTransactions = this._rawTransactions();
    const categories = this.categoryService.categories();
    const bankAccounts = this.bankAccountService.bankAccounts();
    const merchants = this.merchantService.merchants();

    // Build lookup maps for efficient population
    const categoryMap = new Map<string, Category>();
    categories.forEach((c) => categoryMap.set(c._id, c));

    const bankAccountMap = new Map<string, BankAccountWithRelations>();
    bankAccounts.forEach((a) => bankAccountMap.set(a._id, a));

    const merchantMap = new Map<string, Merchant>();
    merchants.forEach((m) => merchantMap.set(m._id, m));

    // Populate each transaction
    return rawTransactions.map((raw) => this.populateTransaction(raw, categoryMap, bankAccountMap, merchantMap));
  });

  // Public read-only signals
  readonly loading = this._loading.asReadonly();
  readonly loadingMore = this._loadingMore.asReadonly();
  readonly hasLoaded = this._hasLoaded.asReadonly();
  readonly error = this._error.asReadonly();
  readonly filters = this._filters.asReadonly();
  readonly hasMore = this._hasMore.asReadonly();

  // Transaction status counts (pre-loaded during initialization)
  readonly statusCounts = this._statusCounts.asReadonly();
  readonly pendingCount = computed(() => this._statusCounts().pendingCount);
  readonly needsReviewCount = computed(() => this._statusCounts().needsReviewCount);
  readonly transferCount = computed(() => this._statusCounts().transferCount);
  readonly loadingStatusCounts = this._loadingStatusCounts.asReadonly();
  readonly hasLoadedStatusCounts = this._hasLoadedStatusCounts.asReadonly();

  // Computed values based on populated transactions
  readonly totalTransactions = computed(() => this.transactions().length);
  readonly hasTransactions = computed(() => this.transactions().length > 0);

  readonly totalAmount = computed(() => {
    return this.transactions().reduce((sum, transaction) => sum + transaction.amount, 0n);
  });

  readonly expenseTotal = computed(() => {
    return this.transactions()
      .filter((t) => t.amount < 0)
      .reduce((sum, t) => sum + BigInt(Math.abs(Number(t.amount))), 0n);
  });

  readonly incomeTotal = computed(() => {
    return this.transactions()
      .filter((t) => t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0n);
  });

  readonly transactionsByCategory = computed(() => {
    const grouped = new Map<string, TransactionWithRelations[]>();
    this.transactions().forEach((transaction) => {
      const categoryName = transaction.movements[0]?.category?.name ?? 'Uncategorized';
      const existing = grouped.get(categoryName) ?? [];
      grouped.set(categoryName, [...existing, transaction]);
    });
    return grouped;
  });

  readonly transactionsByMerchant = computed(() => {
    const grouped = new Map<string, TransactionWithRelations[]>();
    this.transactions().forEach((transaction) => {
      const merchantName = transaction.merchant?.name ?? 'Unknown';
      const existing = grouped.get(merchantName) ?? [];
      grouped.set(merchantName, [...existing, transaction]);
    });
    return grouped;
  });

  // Track workspace ID for change detection
  private lastWorkspaceId: string | null = null;

  constructor() {
    // Watch for workspace changes and reset transaction state
    effect(() => {
      const workspaceId = this.workspaceService.workspaceId();
      const hasWorkspace = !!workspaceId;
      const isAuthenticated = this.convexService.isAuthenticated();

      // Check if workspace changed (not just initial load)
      const workspaceChanged = this.lastWorkspaceId !== null && this.lastWorkspaceId !== workspaceId;

      if (isAuthenticated && hasWorkspace) {
        // If workspace changed, clear transactions and reset state
        if (workspaceChanged) {
          this.stopWatchingTransactions();
          this._rawTransactions.set([]);
          this._loadedTransactionIds.set(new Set());
          this._hasLoaded.set(false);
          this._cursor.set(null);
          this._hasMore.set(true);
          this._filters.set({});
          this._error.set(null);
        }
        this.startWatchingStatusCounts();
      } else {
        this.stopWatchingTransactions();
        this.stopWatchingStatusCounts();
        this._rawTransactions.set([]);
        this._loadedTransactionIds.set(new Set());
        this._statusCounts.set({ pendingCount: 0, needsReviewCount: 0, transferCount: 0 });
        this._hasLoadedStatusCounts.set(false);
        this._hasLoaded.set(false);
      }

      this.lastWorkspaceId = workspaceId;
    });

    // Clean up on destroy
    this.destroyRef.onDestroy(() => {
      this.stopWatchingTransactions();
      this.stopWatchingStatusCounts();
    });
  }

  /**
   * Start watching loaded transactions for real-time updates
   * Uses listTransactions with reactive pagination for all filter types
   */
  private startWatchingTransactions() {
    // Stop existing subscription first
    this.stopWatchingTransactions();

    const workspaceId = this.workspaceService.workspaceId();
    const currentTransactions = this._rawTransactions();

    if (!workspaceId) {
      return;
    }

    const filters = this._filters();
    const filterType = filters.filterType ?? 'all';

    // For 'all' filter with infinite scroll, only watch if we have loaded transactions
    // For filtered views (needs_review, pending, transfer), always watch even if empty to receive new items
    if (filterType === 'all' && currentTransactions.length === 0) {
      return;
    }

    // Watch all loaded transactions using listTransactions
    // This automatically handles additions, deletions, and updates
    const numItems =
      filterType === 'all'
        ? currentTransactions.length // Watch all loaded items for infinite scroll
        : 1000; // Filtered queries return complete small result sets

    const watcher = this.convexService.watchQuery<{ page: RawTransaction[] }>(api.transactions.listTransactions, {
      workspaceId: workspaceId as Id<'workspace'>,
      paginationOpts: { numItems, cursor: null },
      search: filters.search ?? undefined,
      pending: filterType === 'pending' ? true : undefined,
      needsReview: filterType === 'needs_review' ? true : undefined,
      transfer: filterType === 'transfer' ? true : undefined,
      bankAccountId: filters.bankAccountId,
      merchantId: filters.merchantId,
    });

    this.transactionSubscription = watcher.subscribe((result) => {
      if (result !== undefined) {
        // Replace entire transaction list with reactive results
        this._rawTransactions.set(result.page);

        // Update loaded IDs to match current result set
        this._loadedTransactionIds.set(new Set(result.page.map((t) => t._id)));
      }
    });
  }

  /**
   * Stop watching transactions (cleanup subscription)
   */
  private stopWatchingTransactions() {
    if (this.transactionSubscription) {
      this.transactionSubscription();
      this.transactionSubscription = undefined;
    }
  }

  /**
   * Populate raw transactions with related data from local services.
   * Useful for components that fetch raw transactions directly (e.g., reports).
   */
  populateTransactions(rawTransactions: RawTransaction[]): TransactionWithRelations[] {
    const categories = this.categoryService.categories();
    const bankAccounts = this.bankAccountService.bankAccounts();
    const merchants = this.merchantService.merchants();

    // Build lookup maps for efficient population
    const categoryMap = new Map<string, Category>();
    categories.forEach((c) => categoryMap.set(c._id, c));

    const bankAccountMap = new Map<string, BankAccountWithRelations>();
    bankAccounts.forEach((a) => bankAccountMap.set(a._id, a));

    const merchantMap = new Map<string, Merchant>();
    merchants.forEach((m) => merchantMap.set(m._id, m));

    return rawTransactions.map((raw) => this.populateTransaction(raw, categoryMap, bankAccountMap, merchantMap));
  }

  /**
   * Populate a raw transaction with related data from local services
   */
  private populateTransaction(
    raw: RawTransaction,
    categoryMap: Map<string, Category>,
    bankAccountMap: Map<string, BankAccountWithRelations>,
    merchantMap: Map<string, Merchant>
  ): TransactionWithRelations {
    // Populate movements with categories (handle undefined movements for legacy data)
    const populatedMovements = (raw.movements ?? []).map((movement) => ({
      ...movement,
      category: movement.categoryId ? (categoryMap.get(movement.categoryId) ?? null) : null,
    }));

    // Calculate amount from movements
    const amount = populatedMovements.reduce((sum, m) => sum + m.amount, 0n);

    // Get bank account from service
    const serviceBankAccount = bankAccountMap.get(raw.bankAccountId) ?? null;

    // Get merchant
    const merchant = raw.merchantId ? (merchantMap.get(raw.merchantId) ?? null) : null;

    // Compute merchantName - prefer merchant, fallback to importDetails
    const merchantName =
      merchant?.name ?? raw.importDetails?.merchantName ?? raw.importDetails?.originalStatement ?? null;
    const merchantLogo = merchant?.logoUrl ?? null;
    const merchantVisualIdentityMode = merchant?.visualIdentityMode ?? null;
    const merchantIconName = merchant?.iconName ?? null;
    const merchantIconColorId = merchant?.iconColorId ?? null;

    // For transfers, get the paired account name and logo using transferPairBankAccountId
    let transferPairAccountName: string | null = null;
    let transferPairAccountLogo: string | null = null;
    let transferPairAccountVisualIdentityMode: VisualIdentityMode | null = null;
    let transferPairAccountIconName: string | null = null;
    let transferPairAccountIconColorId: EntityIconColorId | null = null;
    let isCrossBudgetTransfer = false;
    if (raw.type === 'transfer' && raw.transferPairBankAccountId) {
      // Directly look up the paired bank account using the denormalized field
      const pairedBankAccount = bankAccountMap.get(raw.transferPairBankAccountId);
      transferPairAccountName = pairedBankAccount?.name ?? null;
      transferPairAccountLogo = pairedBankAccount?.resolvedLogoUrl ?? null;
      transferPairAccountVisualIdentityMode = pairedBankAccount?.visualIdentityMode ?? null;
      transferPairAccountIconName = pairedBankAccount?.iconName ?? null;
      transferPairAccountIconColorId = pairedBankAccount?.iconColorId ?? null;

      // Check if this transfer crosses the budget boundary
      const accountType = serviceBankAccount?.accountType;
      const pairedAccountType = pairedBankAccount?.accountType;
      if (accountType && pairedAccountType) {
        const isOnBudget = (type: string) => type.startsWith('banking_') || type.startsWith('credit_');
        isCrossBudgetTransfer = isOnBudget(accountType) !== isOnBudget(pairedAccountType);
      }
    }

    // Transform bank account to match TransactionWithRelations structure
    // The service returns a different shape than what TransactionWithRelations expects
    const bankAccount = serviceBankAccount
      ? ({
          _id: serviceBankAccount._id,
          _creationTime: new Date(serviceBankAccount.createdAt ?? Date.now()).getTime(),
          name: serviceBankAccount.name,
          visualIdentityMode: serviceBankAccount.visualIdentityMode,
          iconName: serviceBankAccount.iconName,
          iconColorId: serviceBankAccount.iconColorId,
          workspaceId: serviceBankAccount.workspaceId,
          bankLinkAccountId: serviceBankAccount.bankLinkAccountId,
          currentBalance: serviceBankAccount.currentBalance,
          isDeleted: serviceBankAccount.isDeleted,
          updatedAt: serviceBankAccount.updatedAt,
          deletedAt: serviceBankAccount.deletedAt,
          accountType: serviceBankAccount.accountType,
          bankLinkAccount: serviceBankAccount.bankLinkAccount
            ? {
                _id: serviceBankAccount.bankLinkAccount._id,
                _creationTime: 0,
                bankLinkId: serviceBankAccount.bankLinkAccount.bankLink?._id ?? ('' as never),
                accountType: serviceBankAccount.bankLinkAccount.accountType,
                currentBalance: serviceBankAccount.bankLinkAccount.currentBalance ?? null,
                availableBalance: serviceBankAccount.bankLinkAccount.availableBalance ?? null,
                accountNumberMask: serviceBankAccount.bankLinkAccount.accountNumberMask ?? null,
                officialName: serviceBankAccount.bankLinkAccount.officialName ?? null,
                bankLink: serviceBankAccount.bankLinkAccount.bankLink
                  ? {
                      _id: serviceBankAccount.bankLinkAccount.bankLink._id,
                      _creationTime: 0,
                      workspaceId: serviceBankAccount.workspaceId,
                      itemStatus: serviceBankAccount.bankLinkAccount.bankLink.itemStatus,
                      lastSyncedAt: serviceBankAccount.bankLinkAccount.bankLink.lastSyncedAt,
                      globalInstitutionId: undefined,
                      plaidAccessToken: undefined,
                      plaidItemId: undefined,
                    }
                  : null,
              }
            : null,
          institution: serviceBankAccount.bankLinkAccount?.bankLink?.institution
            ? {
                _id: serviceBankAccount.bankLinkAccount.bankLink.institution._id,
                _creationTime: 0,
                name: serviceBankAccount.bankLinkAccount.bankLink.institution.name,
                logoUrl: serviceBankAccount.bankLinkAccount.bankLink.institution.logoUrl,
                primaryColor: serviceBankAccount.bankLinkAccount.bankLink.institution.primaryColor,
                updatedAt: serviceBankAccount.bankLinkAccount.bankLink.institution.updatedAt,
              }
            : null,
        } as TransactionWithRelations['bankAccount'])
      : null;

    return {
      ...raw,
      bankAccount,
      merchant: merchant
        ? {
            ...merchant,
            name: merchant.name,
            logoUrl: merchant.logoUrl ?? undefined,
            visualIdentityMode: merchant.visualIdentityMode,
            iconName: merchant.iconName,
            iconColorId: merchant.iconColorId,
          }
        : null,
      merchantName,
      merchantLogo,
      merchantVisualIdentityMode,
      merchantIconName,
      merchantIconColorId,
      movements: populatedMovements,
      transferPairAccountName,
      transferPairAccountLogo,
      transferPairAccountVisualIdentityMode,
      transferPairAccountIconName,
      transferPairAccountIconColorId,
      amount,
      isCrossBudgetTransfer,
    };
  }

  /**
   * Update filters and fetch new data
   * This resets pagination and fetches fresh data with the new filters
   */
  async updateFilters(filters: Partial<TransactionFilters>) {
    const currentFilters = this._filters();
    const newFilters = { ...currentFilters, ...filters };

    // Check if filters actually changed (only check filters that are sent to the API)
    const filtersChanged =
      currentFilters.filterType !== newFilters.filterType ||
      currentFilters.search !== newFilters.search ||
      currentFilters.bankAccountId !== newFilters.bankAccountId ||
      currentFilters.merchantId !== newFilters.merchantId;

    this._filters.set(newFilters);

    // Track search events
    if (filters.search && filters.search.length > 0) {
      this.reportingService.capture(TrackingEvent.SEARCH_PERFORMED, { query_length: filters.search.length });
    }

    // Only fetch if filters changed
    if (filtersChanged) {
      await this.fetchTransactions();
    }
  }

  /**
   * Clear all filters and fetch fresh data
   */
  async clearFilters() {
    this._filters.set({});
    await this.fetchTransactions();
  }

  /**
   * Fetch transactions with current filters (resets pagination)
   */
  async fetchTransactions() {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      return;
    }

    // Reset pagination state
    this._cursor.set(null);
    this._hasMore.set(true);
    this._loading.set(true);
    this._error.set(null);

    try {
      const filters = this._filters();
      const filterType = filters.filterType ?? 'all';

      if (filterType === 'all') {
        // Use paginated query for "all" filter
        const result = await this.convexService.getClient().query(api.transactions.listTransactions, {
          workspaceId: workspaceId as Id<'workspace'>,
          paginationOpts: { numItems: PAGE_SIZE, cursor: null },
          search: filters.search ?? undefined,
          bankAccountId: filters.bankAccountId,
          merchantId: filters.merchantId,
        });

        this._rawTransactions.set(result.page);
        this._cursor.set(result.continueCursor);
        this._hasMore.set(!result.isDone);

        // Track loaded transaction IDs and start real-time subscription
        this._loadedTransactionIds.set(new Set(result.page.map((t) => t._id)));
        this.startWatchingTransactions();
      } else {
        // Use listTransactions with needs_review/pending/transfer filters (no pagination needed)
        const result = await this.convexService.getClient().query(api.transactions.listTransactions, {
          workspaceId: workspaceId as Id<'workspace'>,
          paginationOpts: { numItems: 1000, cursor: null }, // Get all matching for filtered queries
          search: filters.search ?? undefined,
          pending: filterType === 'pending' ? true : undefined,
          needsReview: filterType === 'needs_review' ? true : undefined,
          transfer: filterType === 'transfer' ? true : undefined,
        });

        this._rawTransactions.set(result.page);
        this._cursor.set(null);
        this._hasMore.set(false); // Filtered queries return all results

        // Track loaded transaction IDs and start real-time subscription
        this._loadedTransactionIds.set(new Set(result.page.map((t) => t._id)));
        this.startWatchingTransactions();
      }

      this._hasLoaded.set(true);
    } catch (error) {
      console.error('Error fetching transactions:', error);
      this._error.set('Failed to load transactions');
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Load more transactions (pagination)
   */
  async loadMore() {
    const workspaceId = this.workspaceService.workspaceId();
    const cursor = this._cursor();
    const filters = this._filters();
    const filterType = filters.filterType ?? 'all';

    // Only paginated queries support loading more
    if (!workspaceId || !cursor || filterType !== 'all' || this._loadingMore()) {
      return;
    }

    this._loadingMore.set(true);

    try {
      const result = await this.convexService.getClient().query(api.transactions.listTransactions, {
        workspaceId: workspaceId as Id<'workspace'>,
        paginationOpts: { numItems: PAGE_SIZE, cursor },
        search: filters.search ?? undefined,
        bankAccountId: filters.bankAccountId,
        merchantId: filters.merchantId,
      });

      // Append new transactions to existing list
      this._rawTransactions.update((current) => [...current, ...result.page]);
      this._cursor.set(result.continueCursor);
      this._hasMore.set(!result.isDone);

      // Add new transaction IDs to tracked set
      this._loadedTransactionIds.update((current) => {
        const newSet = new Set(current);
        result.page.forEach((t) => newSet.add(t._id));
        return newSet;
      });

      // Restart subscription to watch the expanded set of loaded transactions
      this.startWatchingTransactions();
    } catch (error) {
      console.error('Error loading more transactions:', error);
      this._error.set('Failed to load more transactions');
    } finally {
      this._loadingMore.set(false);
    }
  }

  /**
   * Refresh transactions (re-fetch with current filters)
   */
  async refresh() {
    await this.fetchTransactions();
  }

  /**
   * Execute a mutation with toast notification
   */
  private executeWithToast<T>(mutationPromise: Promise<T>, options?: TransactionToastOptions): Promise<T> {
    const enabled = options?.enabled ?? (options?.silent !== undefined ? !options.silent : true);
    const opts = {
      loading: options?.loading ?? 'Processing...',
      success: options?.success ?? 'Success',
      error: options?.error ?? 'Operation failed',
    };

    if (enabled) {
      toast.promise(mutationPromise, {
        loading: opts.loading,
        success:
          typeof opts.success === 'function'
            ? (result: T) => (opts.success as (result: unknown) => string)(result)
            : opts.success,
        error: (err: unknown): string => {
          const msg = typeof opts.error === 'function' ? opts.error(err) : opts.error;
          console.error('Transaction operation failed:', err);
          return msg;
        },
      });
    }

    return mutationPromise;
  }

  /**
   * Create a new transaction.
   *
   * A future date (or a recurrence other than 'once') creates a scheduled transaction on the
   * backend, which returns the object shape instead of a plain transaction id — see
   * {@link CreateRegularTransactionResult}.
   */
  async createTransaction(transaction: {
    bankAccountId: Id<'bankAccount'>;
    amount: bigint;
    date: string;
    merchantId?: Id<'merchant'>;
    categoryId?: Id<'category'>;
    readyToAssign?: boolean;
    notes?: string;
    status?: 'pending' | 'cleared';
    recurrence?: Recurrence;
  }): Promise<CreateRegularTransactionResult | null> {
    try {
      this._error.set(null);
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        return null;
      }

      // Convert categoryId into movements array with category on first movement
      // Follow the same pattern as updateTransaction for consistency
      let categoryId: Id<'category'> | undefined = transaction.categoryId;
      let readyToAssign: boolean = transaction.readyToAssign ?? false;

      // Mutual exclusivity rules (same as updateTransaction):
      // 1. If readyToAssign is true, categoryId must be undefined
      // 2. If categoryId is explicitly set (even if undefined), and it's not ready-to-assign, clear readyToAssign
      if (readyToAssign) {
        categoryId = undefined;
      } else if (transaction.categoryId === undefined && !readyToAssign) {
        // If no categoryId provided and not ready-to-assign, default to undefined
        categoryId = undefined;
        readyToAssign = false;
      }

      // Create a single movement with the category on the first movement
      const movements = [
        {
          amount: transaction.amount,
          categoryId,
          readyToAssign,
          notes: transaction.notes,
        },
      ];

      const result = await this.convexService.mutation<CreateRegularTransactionResult>(
        api.transactions.createRegularTransaction,
        {
          workspaceId: workspaceId as Id<'workspace'>,
          date: transaction.date,
          bankAccountId: transaction.bankAccountId,
          movements,
          ...(transaction.merchantId && { merchantId: transaction.merchantId }),
          ...(transaction.status && { status: transaction.status }),
          ...(transaction.notes && { notes: transaction.notes }),
          ...(transaction.recurrence && transaction.recurrence !== 'once' && { recurrence: transaction.recurrence }),
        }
      );

      // Add the new transaction to the list and update subscriptions
      // (a future-dated create returns only a schedule - nothing enters the register yet)
      const transactionId = typeof result === 'string' ? result : result?.transactionId;
      if (transactionId) {
        this.reportingService.capture(TrackingEvent.TRANSACTION_CREATED, {
          has_category: !!transaction.categoryId,
          status: transaction.status ?? 'cleared',
        });
        await this.refreshTransaction(transactionId);
        this.startWatchingTransactions();
      }

      return result;
    } catch (error: unknown) {
      console.error('Error creating transaction:', error);
      this._error.set('Failed to create transaction');
      return null;
    }
  }

  /**
   * Update an existing transaction
   */
  async updateTransaction(
    transactionId: Id<'transaction'>,
    updates: {
      amount?: bigint;
      date?: string;
      categoryId?: Id<'category'> | null;
      readyToAssign?: boolean;
      merchantId?: Id<'merchant'> | null;
      bankAccountId?: Id<'bankAccount'>;
      notes?: string | null;
    },
    // Optional: pass current movements to avoid extra query when already available
    currentMovements?: {
      amount: bigint;
      categoryId?: Id<'category'> | undefined;
      readyToAssign: boolean;
      notes?: string | undefined;
    }[],
    toastOptions?: TransactionToastOptions
  ): Promise<boolean> {
    try {
      this._error.set(null);
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        return false;
      }

      // Capture previous values for undo (before mutation)
      const isSilent = toastOptions?.silent === true || toastOptions?.enabled === false;
      let previousUpdates: typeof updates | undefined;
      let previousMovements: typeof currentMovements | undefined;

      if (!isSilent) {
        const existingTx = this._rawTransactions().find((t) => t._id === transactionId);
        if (existingTx) {
          previousUpdates = {};
          if ('amount' in updates) previousUpdates.amount = existingTx.movements[0]?.amount;
          if ('date' in updates) previousUpdates.date = existingTx.date;
          if ('categoryId' in updates) previousUpdates.categoryId = existingTx.movements[0]?.categoryId ?? null;
          if ('readyToAssign' in updates) previousUpdates.readyToAssign = existingTx.movements[0]?.readyToAssign;
          if ('merchantId' in updates) previousUpdates.merchantId = existingTx.merchantId ?? null;
          if ('bankAccountId' in updates) previousUpdates.bankAccountId = existingTx.bankAccountId;
          if ('notes' in updates) previousUpdates.notes = existingTx.notes ?? null;
        }

        if (currentMovements) {
          previousMovements = currentMovements.map((m) => ({ ...m }));
        }
      }

      // If categoryId, readyToAssign, or amount is provided, we need to construct movements
      if ('categoryId' in updates || 'readyToAssign' in updates || 'amount' in updates) {
        let movements: {
          amount: bigint;
          categoryId?: Id<'category'> | undefined;
          readyToAssign: boolean;
          notes?: string | undefined;
        }[];

        // Use provided movements if available, otherwise fetch transaction
        if (currentMovements) {
          movements = currentMovements.map((movement, index) => {
            if (index === 0) {
              // Determine categoryId first
              let categoryId: Id<'category'> | undefined;
              if ('categoryId' in updates) {
                // If categoryId is explicitly provided (even if null), use it
                categoryId = updates.categoryId ?? undefined;
              } else {
                // If categoryId not in updates, use existing value
                categoryId = movement.categoryId ?? undefined;
              }

              // Determine readyToAssign value
              let readyToAssign: boolean;
              if ('readyToAssign' in updates) {
                // If readyToAssign is explicitly provided, use it
                readyToAssign = updates.readyToAssign ?? false;
              } else {
                // Otherwise keep existing value
                readyToAssign = movement.readyToAssign ?? false;
              }

              // Mutual exclusivity rules:
              // 1. If readyToAssign is true, categoryId must be undefined
              // 2. If categoryId is explicitly set (even to undefined/null), and it's not ready-to-assign, clear readyToAssign
              if (readyToAssign) {
                categoryId = undefined;
              } else if ('categoryId' in updates && categoryId === undefined) {
                // If categoryId was explicitly set to null/undefined (No category), ensure readyToAssign is false
                readyToAssign = false;
              }

              // Update the first movement with new categoryId/readyToAssign/amount
              return {
                amount: updates.amount ?? movement.amount,
                categoryId,
                readyToAssign,
                notes: movement.notes,
              };
            }
            // Keep other movements as-is
            return {
              amount: movement.amount,
              categoryId: movement.categoryId ?? undefined,
              readyToAssign: movement.readyToAssign ?? false,
              notes: movement.notes,
            };
          });
        } else {
          // Fallback: fetch transaction if movements not provided
          const transaction = await this.convexService.getClient().query(api.transactions.getTransaction, {
            workspaceId: workspaceId as Id<'workspace'>,
            transactionId,
          });

          if (!transaction) {
            this._error.set('Transaction not found');
            return false;
          }

          // Construct movements array from existing movements, updating the first one
          movements = transaction.movements.map((movement, index) => {
            if (index === 0) {
              // Determine categoryId first
              let categoryId: Id<'category'> | undefined;
              if ('categoryId' in updates) {
                // If categoryId is explicitly provided (even if null), use it
                categoryId = updates.categoryId ?? undefined;
              } else {
                // If categoryId not in updates, use existing value
                categoryId = movement.categoryId ?? undefined;
              }

              // Determine readyToAssign value
              let readyToAssign: boolean;
              if ('readyToAssign' in updates) {
                // If readyToAssign is explicitly provided, use it
                readyToAssign = updates.readyToAssign ?? false;
              } else {
                // Otherwise keep existing value
                readyToAssign = movement.readyToAssign ?? false;
              }

              // Mutual exclusivity rules:
              // 1. If readyToAssign is true, categoryId must be undefined
              // 2. If categoryId is explicitly set (even to undefined/null), and it's not ready-to-assign, clear readyToAssign
              if (readyToAssign) {
                categoryId = undefined;
              } else if ('categoryId' in updates && categoryId === undefined) {
                // If categoryId was explicitly set to null/undefined (No category), ensure readyToAssign is false
                readyToAssign = false;
              }

              // Update the first movement with new categoryId/readyToAssign/amount
              return {
                amount: updates.amount ?? movement.amount,
                categoryId,
                readyToAssign,
                notes: movement.notes,
              };
            }
            // Keep other movements as-is
            return {
              amount: movement.amount,
              categoryId: movement.categoryId ?? undefined,
              readyToAssign: movement.readyToAssign ?? false,
              notes: movement.notes,
            };
          });
        }

        // Determine contextual success message based on what's being updated
        let successMessage = 'Transaction updated';
        if ('categoryId' in updates || 'readyToAssign' in updates) {
          successMessage = 'Category updated';
        } else if ('merchantId' in updates) {
          successMessage = 'Merchant updated';
        } else if ('amount' in updates) {
          successMessage = 'Amount updated';
        } else if ('date' in updates) {
          successMessage = 'Date updated';
        } else if ('bankAccountId' in updates) {
          successMessage = 'Account updated';
        } else if ('notes' in updates) {
          successMessage = 'Notes updated';
        }

        const mutationPromise = (async () => {
          await this.convexService.mutation(api.transactions.updateTransaction, {
            workspaceId: workspaceId as Id<'workspace'>,
            transactionId,
            movements,
            ...(updates.date && { date: updates.date }),
            ...(updates.merchantId !== undefined && { merchantId: updates.merchantId }),
            ...(updates.bankAccountId && { bankAccountId: updates.bankAccountId }),
            ...(updates.notes !== undefined && { notes: updates.notes }),
            preserveReviewStatus: true,
          });
          this.reportingService.capture(TrackingEvent.TRANSACTION_UPDATED);
          return true;
        })();

        const result = await this.executeWithToast(mutationPromise, {
          loading: 'Updating transaction...',
          success: successMessage,
          error: 'Failed to update transaction',
          ...toastOptions,
        });

        // Update _rawTransactions locally so subsequent undo captures read correct state
        if (result) {
          this.patchRawTransaction(transactionId, updates, movements);
        }

        this.pushUndoForUpdate(
          result,
          isSilent,
          successMessage,
          transactionId,
          updates,
          previousUpdates,
          previousMovements
        );

        return result;
      } else {
        // No category/readyToAssign/amount update, use simple update
        // Determine contextual success message based on what's being updated
        let successMessage = 'Transaction updated';
        if ('merchantId' in updates) {
          successMessage = 'Merchant updated';
        } else if ('date' in updates) {
          successMessage = 'Date updated';
        } else if ('bankAccountId' in updates) {
          successMessage = 'Account updated';
        } else if ('notes' in updates) {
          successMessage = 'Notes updated';
        }

        const mutationPromise = (async () => {
          await this.convexService.mutation(api.transactions.updateTransaction, {
            workspaceId: workspaceId as Id<'workspace'>,
            transactionId,
            ...(updates.date && { date: updates.date }),
            ...(updates.merchantId !== undefined && { merchantId: updates.merchantId }),
            ...(updates.bankAccountId && { bankAccountId: updates.bankAccountId }),
            ...(updates.notes !== undefined && { notes: updates.notes }),
            preserveReviewStatus: true,
          });
          this.reportingService.capture(TrackingEvent.TRANSACTION_UPDATED);
          return true;
        })();

        const result = await this.executeWithToast(mutationPromise, {
          loading: 'Updating transaction...',
          success: successMessage,
          error: 'Failed to update transaction',
          ...toastOptions,
        });

        // Update _rawTransactions locally so subsequent undo captures read correct state
        if (result) {
          this.patchRawTransaction(transactionId, updates);
        }

        this.pushUndoForUpdate(
          result,
          isSilent,
          successMessage,
          transactionId,
          updates,
          previousUpdates,
          previousMovements
        );

        return result;
      }
    } catch (error) {
      console.error('Error updating transaction:', error);
      this._error.set('Failed to update transaction');
      return false;
    }
  }

  /**
   * Update a transaction's date and/or recurrence. This path can convert an entered
   * transaction into a scheduled transaction when the date moves into the future.
   */
  async updateTransactionSchedule(
    transactionId: Id<'transaction'>,
    updates: {
      date?: string;
      recurrence?: Recurrence;
    },
    toastOptions?: TransactionToastOptions
  ): Promise<UpdateTransactionScheduleResult | null> {
    try {
      this._error.set(null);
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        return null;
      }

      const mutationPromise = (async () => {
        const result = await this.convexService.mutation<UpdateTransactionScheduleResult>(
          api.transactions.updateTransaction,
          {
            workspaceId: workspaceId as Id<'workspace'>,
            transactionId,
            ...(updates.date !== undefined && { date: updates.date }),
            ...(updates.recurrence !== undefined && { recurrence: updates.recurrence }),
            preserveReviewStatus: true,
          }
        );
        this.reportingService.capture(TrackingEvent.TRANSACTION_UPDATED);
        return result;
      })();

      const result = await this.executeWithToast(mutationPromise, {
        loading: 'Updating transaction...',
        success: (value: unknown) => {
          const scheduleResult = value as UpdateTransactionScheduleResult;
          if (scheduleResult.convertedToScheduled) {
            return 'Transaction scheduled';
          }
          if (scheduleResult.scheduledTransactionId) {
            return 'Recurrence scheduled';
          }
          return 'Date updated';
        },
        error: 'Failed to update transaction',
        ...toastOptions,
      });

      if (result.convertedToScheduled) {
        const deletedTransactionId = result.deletedTransactionId ?? transactionId;
        this.removeTransactionFromList(deletedTransactionId);
        if (result.deletedTransferPairTransactionId) {
          this.removeTransactionFromList(result.deletedTransferPairTransactionId);
        }
      } else if (updates.date !== undefined) {
        this.patchRawTransaction(transactionId, { date: updates.date });
      }

      return result;
    } catch (error: unknown) {
      console.error('Error updating transaction schedule:', error);
      this._error.set('Failed to update transaction');
      return null;
    }
  }

  /**
   * Update transaction review status (approve or reject)
   * Note: Rejecting a transaction soft-deletes it (sets isDeleted = true)
   */
  async updateReviewStatus(
    transactionId: Id<'transaction'>,
    action: 'approve' | 'reject',
    toastOptions?: TransactionToastOptions
  ): Promise<boolean> {
    try {
      this._error.set(null);
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        return false;
      }

      if (action === 'approve') {
        // Approve: set reviewStatus to 'reviewed'
        const mutationPromise = (async () => {
          await this.convexService.mutation(api.transactions.updateTransaction, {
            workspaceId: workspaceId as Id<'workspace'>,
            transactionId,
            reviewStatus: 'reviewed',
          });
          return true;
        })();

        return await this.executeWithToast(mutationPromise, {
          loading: 'Approving transaction...',
          success: 'Transaction approved',
          error: 'Failed to approve transaction',
          ...toastOptions,
        });
      } else {
        // Reject: soft delete the transaction
        const mutationPromise = (async () => {
          await this.convexService.mutation(api.transactions.deleteTransaction, {
            workspaceId: workspaceId as Id<'workspace'>,
            transactionId,
          });
          return true;
        })();

        return await this.executeWithToast(mutationPromise, {
          loading: 'Rejecting transaction...',
          success: 'Transaction rejected',
          error: 'Failed to reject transaction',
          ...toastOptions,
        });
      }
    } catch (error) {
      console.error('Error updating review status:', error);
      this._error.set('Failed to update review status');
      return false;
    }
  }

  /**
   * Get transaction statistics
   */
  async getTransactionStats(startDate?: string, endDate?: string) {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      return null;
    }

    try {
      const stats = await this.convexService.getClient().query(api.transactions.getTransactionStats, {
        workspaceId: workspaceId as Id<'workspace'>,
        startDate,
        endDate,
      });
      return stats;
    } catch (error) {
      console.error('Error getting transaction stats:', error);
      this._error.set('Failed to get transaction statistics');
      return null;
    }
  }

  /**
   * Clear error state
   */
  clearError() {
    this._error.set(null);
  }

  /**
   * Invalidate a transaction from the local cache
   * This forces getTransactionById to fetch fresh data from the server
   */
  invalidateTransaction(transactionId: Id<'transaction'>): void {
    this._rawTransactions.update((transactions) => transactions.filter((t) => t._id !== transactionId));
  }

  /**
   * Refresh a transaction by fetching fresh data from the server
   * Updates the transaction in-place if it exists, or adds it to the list if not
   * Also updates the loaded IDs set for real-time subscription
   */
  async refreshTransaction(transactionId: Id<'transaction'>): Promise<void> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) return;

    try {
      const freshTransaction = await this.convexService.getClient().query(api.transactions.getTransaction, {
        workspaceId: workspaceId as Id<'workspace'>,
        transactionId,
      });

      if (freshTransaction) {
        // Update in-place or add if not present
        this._rawTransactions.update((transactions) => {
          const index = transactions.findIndex((t) => t._id === transactionId);
          if (index >= 0) {
            // Update existing transaction in-place
            const updated = [...transactions];
            updated[index] = freshTransaction;
            return updated;
          } else {
            // Add new transaction (insert at appropriate position by date, then creation time)
            const newList = [...transactions, freshTransaction];
            // Sort by date descending, then by creation time to maintain order
            newList.sort((a, b) => {
              const dateCompare = new Date(b.date).getTime() - new Date(a.date).getTime();
              if (dateCompare !== 0) return dateCompare;
              return b._creationTime - a._creationTime;
            });
            return newList;
          }
        });

        // Ensure it's in the loaded IDs set for real-time subscription
        this._loadedTransactionIds.update((ids) => {
          const newSet = new Set(ids);
          newSet.add(transactionId);
          return newSet;
        });
      }
    } catch (error) {
      console.error('Error refreshing transaction:', error);
    }
  }

  /**
   * Remove a transaction from the local cache by ID
   * Used when a paired transfer transaction is deleted
   */
  private removeTransactionFromList(transactionId: Id<'transaction'>): void {
    this._rawTransactions.update((transactions) => transactions.filter((t) => t._id !== transactionId));
    this._loadedTransactionIds.update((ids) => {
      const newSet = new Set(ids);
      newSet.delete(transactionId);
      return newSet;
    });
  }

  private pushUndoForUpdate(
    result: boolean,
    isSilent: boolean,
    successMessage: string,
    transactionId: Id<'transaction'>,
    updates: Record<string, unknown>,
    previousUpdates: Record<string, unknown> | undefined,
    previousMovements?: { amount: bigint; categoryId?: Id<'category'>; readyToAssign: boolean; notes?: string }[]
  ): void {
    if (!result || !previousUpdates || isSilent) return;

    this.undoRedoService.pushAction({
      description: successMessage,
      type: 'transaction-update',
      timestamp: Date.now(),
      undo: async () => {
        const reverted = await this.updateTransaction(transactionId, previousUpdates, previousMovements, {
          silent: true,
        });
        if (!reverted) throw new Error('Failed to revert transaction');
      },
      redo: async () => {
        const reapplied = await this.updateTransaction(transactionId, updates, undefined, { silent: true });
        if (!reapplied) throw new Error('Failed to reapply transaction update');
      },
    });
  }

  /**
   * Patch a raw transaction in _rawTransactions with updated field values.
   * This keeps _rawTransactions in sync after mutations so that subsequent
   * undo state captures read the correct previous values.
   */
  private patchRawTransaction(
    transactionId: Id<'transaction'>,
    updates: Record<string, unknown>,
    movements?: { amount: bigint; categoryId?: Id<'category'>; readyToAssign: boolean; notes?: string }[]
  ): void {
    this._rawTransactions.update((transactions) => {
      const index = transactions.findIndex((t) => t._id === transactionId);
      if (index < 0) return transactions;

      const tx = transactions[index];
      if (!tx) return transactions;
      const patched = { ...tx };

      if ('date' in updates && typeof updates['date'] === 'string') patched.date = updates['date'];
      if ('merchantId' in updates) patched.merchantId = updates['merchantId'] as Id<'merchant'> | undefined;
      if ('bankAccountId' in updates) patched.bankAccountId = updates['bankAccountId'] as Id<'bankAccount'>;
      if ('notes' in updates) patched.notes = (updates['notes'] as string | null) ?? undefined;

      // Patch movements if provided (covers amount, categoryId, readyToAssign changes)
      if (movements) {
        patched.movements = movements.map((m, i) => ({
          ...(tx.movements[i] ?? {}),
          amount: m.amount,
          categoryId: m.categoryId,
          readyToAssign: m.readyToAssign,
          notes: m.notes,
        }));
      }

      const result = [...transactions];
      result[index] = patched;
      return result;
    });
  }

  /**
   * Get a transaction by its full ID
   * First checks if transaction exists in local state, otherwise fetches from server
   */
  async getTransactionById(transactionId: Id<'transaction'>): Promise<TransactionWithRelations | null> {
    // First, check if we already have this transaction in local state
    const localTransaction = this.transactions().find((t) => t._id === transactionId);

    if (localTransaction) {
      return localTransaction;
    }

    return this.fetchTransactionById(transactionId);
  }

  /**
   * Force fetch a transaction from the server (bypasses local cache)
   * Use this after mutations that significantly change the transaction (e.g., type conversion)
   */
  async fetchTransactionById(transactionId: Id<'transaction'>): Promise<TransactionWithRelations | null> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      return null;
    }

    try {
      const transaction = await this.convexService.getClient().query(api.transactions.getTransaction, {
        workspaceId: workspaceId as Id<'workspace'>,
        transactionId,
      });
      if (!transaction) return null;

      // Convex returns a populated transaction; add the frontend-only field
      // The type assertion is safe because Convex type is structurally compatible
      const transactionWithRelations = {
        ...transaction,
        merchantVisualIdentityMode:
          transaction.merchantVisualIdentityMode ?? transaction.merchant?.visualIdentityMode ?? null,
        merchantIconName: transaction.merchantIconName ?? transaction.merchant?.iconName ?? null,
        merchantIconColorId: transaction.merchantIconColorId ?? transaction.merchant?.iconColorId ?? null,
        transferPairAccountLogo: null, // Server doesn't provide this
        transferPairAccountVisualIdentityMode: transaction.transferPairAccountVisualIdentityMode ?? null,
        transferPairAccountIconName: transaction.transferPairAccountIconName ?? null,
        transferPairAccountIconColorId: transaction.transferPairAccountIconColorId ?? null,
      } as TransactionWithRelations;

      // Track in _rawTransactions so undo state capture works (e.g., from details page)
      this._rawTransactions.update((transactions) => {
        const index = transactions.findIndex((t) => t._id === transactionId);
        if (index >= 0) {
          const updated = [...transactions];
          updated[index] = transactionWithRelations;
          return updated;
        }
        return [...transactions, transactionWithRelations];
      });
      this._loadedTransactionIds.update((ids) => {
        const newSet = new Set(ids);
        newSet.add(transactionId);
        return newSet;
      });

      return transactionWithRelations;
    } catch (error) {
      console.error('Error fetching transaction by ID:', error);
      return null;
    }
  }

  /**
   * Delete a transaction (soft delete)
   */
  async deleteTransaction(transactionId: Id<'transaction'>): Promise<boolean> {
    try {
      this._error.set(null);
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        return false;
      }

      // Find the paired transaction ID before deletion so we can remove it from the list
      const currentTransaction = this._rawTransactions().find((t) => t._id === transactionId);
      const pairedTransactionId = currentTransaction?.transferPairId;

      await this.convexService.mutation(api.transactions.deleteTransaction, {
        workspaceId: workspaceId as Id<'workspace'>,
        transactionId,
      });
      this.reportingService.capture(TrackingEvent.TRANSACTION_DELETED);

      // Remove from local state
      this._rawTransactions.update((transactions) => transactions.filter((t) => t._id !== transactionId));

      // Also remove the paired transaction from local state if this was a transfer
      // (the backend mutation already deleted both sides)
      if (pairedTransactionId) {
        this.removeTransactionFromList(pairedTransactionId);
      }

      return true;
    } catch (error) {
      console.error('Error deleting transaction:', error);
      this._error.set('Failed to delete transaction');
      return false;
    }
  }

  /**
   * Delete multiple transactions (soft delete)
   */
  async deleteTransactions(transactionIds: Id<'transaction'>[]): Promise<boolean> {
    try {
      this._error.set(null);
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        return false;
      }

      // Collect paired transaction IDs before deletion
      const pairedIds = new Set<string>();
      for (const id of transactionIds) {
        const tx = this._rawTransactions().find((t) => t._id === id);
        if (tx?.transferPairId) {
          pairedIds.add(tx.transferPairId);
        }
      }

      await this.convexService.mutation(api.transactions.deleteTransactions, {
        workspaceId: workspaceId as Id<'workspace'>,
        transactionIds,
      });

      // Remove deleted transactions and their pairs from local state
      const deletedIds = new Set<string>([...transactionIds, ...pairedIds]);
      this._rawTransactions.update((transactions) => transactions.filter((t) => !deletedIds.has(t._id)));
      this._loadedTransactionIds.update((ids) => {
        const newSet = new Set(ids);
        deletedIds.forEach((id) => newSet.delete(id as Id<'transaction'>));
        return newSet;
      });

      return true;
    } catch (error) {
      console.error('Error deleting transactions:', error);
      this._error.set('Failed to delete transactions');
      return false;
    }
  }

  /**
   * Update status for multiple transactions
   * Silently skips reconciled transactions
   */
  async updateTransactionsStatus(transactionIds: Id<'transaction'>[], status: 'pending' | 'cleared'): Promise<boolean> {
    try {
      this._error.set(null);
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        return false;
      }

      await this.convexService.mutation(api.transactions.updateTransactionsStatus, {
        workspaceId: workspaceId as Id<'workspace'>,
        transactionIds,
        status,
      });

      return true;
    } catch (error) {
      console.error('Error updating transaction statuses:', error);
      this._error.set('Failed to update transaction statuses');
      return false;
    }
  }

  /**
   * Restore multiple deleted transactions
   */
  async restoreTransactions(transactionIds: Id<'transaction'>[]): Promise<boolean> {
    try {
      this._error.set(null);
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        return false;
      }

      await this.convexService.mutation(api.transactions.restoreTransactions, {
        workspaceId: workspaceId as Id<'workspace'>,
        transactionIds,
      });

      return true;
    } catch (error) {
      console.error('Error restoring transactions:', error);
      this._error.set('Failed to restore transactions');
      return false;
    }
  }

  /**
   * Approve (mark as reviewed) multiple transactions in one mutation
   */
  async approveTransactions(transactionIds: Id<'transaction'>[]): Promise<boolean> {
    try {
      this._error.set(null);
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        return false;
      }

      await this.convexService.mutation(api.transactions.approveTransactions, {
        workspaceId: workspaceId as Id<'workspace'>,
        transactionIds,
      });

      return true;
    } catch (error) {
      console.error('Error approving transactions:', error);
      this._error.set('Failed to approve transactions');
      return false;
    }
  }

  /**
   * Restore a deleted transaction
   */
  async restoreTransaction(transactionId: Id<'transaction'>): Promise<boolean> {
    try {
      this._error.set(null);
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        return false;
      }

      await this.convexService.mutation(api.transactions.restoreTransaction, {
        workspaceId: workspaceId as Id<'workspace'>,
        transactionId,
      });
      return true;
    } catch (error) {
      console.error('Error restoring transaction:', error);
      this._error.set('Failed to restore transaction');
      return false;
    }
  }

  /**
   * Create a transfer transaction between two bank accounts
   */
  async createTransfer(params: {
    fromAccountId: Id<'bankAccount'>;
    toAccountId: Id<'bankAccount'>;
    amount: bigint;
    date: string;
    notes?: string;
    categoryId?: Id<'category'>;
    readyToAssign?: boolean;
    recurrence?: Recurrence;
  }): Promise<CreateTransferTransactionResult | null> {
    try {
      this._error.set(null);
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        return null;
      }

      const result = await this.convexService.mutation<CreateTransferTransactionResult>(
        api.transactions.createTransferTransaction,
        {
          workspaceId: workspaceId as Id<'workspace'>,
          fromAccountId: params.fromAccountId,
          toAccountId: params.toAccountId,
          amount: params.amount,
          date: params.date,
          notes: params.notes,
          ...(params.categoryId && { categoryId: params.categoryId }),
          ...(params.readyToAssign && { readyToAssign: params.readyToAssign }),
          ...(params.recurrence && params.recurrence !== 'once' && { recurrence: params.recurrence }),
        }
      );

      // Add entered transfer transactions to the list. Future-dated transfers only create
      // a schedule, so there is nothing to refresh in the transaction register yet.
      const transactionId = typeof result === 'string' ? result : result?.transactionId;
      if (transactionId) {
        await this.refreshTransaction(transactionId);

        const explicitPairId = typeof result === 'string' ? undefined : result.transferPairTransactionId;
        if (explicitPairId) {
          await this.refreshTransaction(explicitPairId);
        } else {
          const fromTransaction = this._rawTransactions().find((t) => t._id === transactionId);
          if (fromTransaction?.transferPairId) {
            await this.refreshTransaction(fromTransaction.transferPairId);
          }
        }

        this.startWatchingTransactions();
      }

      return result;
    } catch (error: unknown) {
      console.error('Error creating transfer:', error);
      this._error.set('Failed to create transfer');
      return null;
    }
  }

  /**
   * Convert a regular transaction to a transfer transaction
   */
  async convertToTransfer(
    transactionId: Id<'transaction'>,
    toAccountId: Id<'bankAccount'>,
    toastOptions?: TransactionToastOptions
  ): Promise<{ success: boolean; pairedTransactionId: Id<'transaction'> }> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      throw new Error('Workspace ID not found');
    }

    // Capture previous state for undo before mutation
    const isSilent = toastOptions?.silent === true || toastOptions?.enabled === false;
    const existingTx = this._rawTransactions().find((t) => t._id === transactionId);
    const previousMerchantId = existingTx?.merchantId;
    const previousMovements = existingTx?.movements.map((m) => ({
      amount: m.amount,
      categoryId: m.categoryId,
      readyToAssign: m.readyToAssign ?? false,
      notes: m.notes,
    }));

    try {
      this._error.set(null);
      const mutationPromise = (async () => {
        const result: { success: boolean; pairedTransactionId: Id<'transaction'> } = await this.convexService.mutation(
          api.transactions.convertToTransfer,
          {
            transactionId,
            workspaceId: workspaceId as Id<'workspace'>,
            toAccountId,
          }
        );

        // Refresh both transactions to update the UI
        // This ensures both the original and paired transactions appear in the table
        if (result.success) {
          await this.refreshTransaction(transactionId);
          await this.refreshTransaction(result.pairedTransactionId);
          this.startWatchingTransactions();
        }

        return result;
      })();

      const result = await this.executeWithToast(mutationPromise, {
        loading: 'Converting to transfer...',
        success: 'Converted to transfer',
        error: 'Failed to convert to transfer',
        ...toastOptions,
      });

      if (result.success && !isSilent && previousMovements) {
        this.undoRedoService.pushAction({
          description: 'Converted to transfer',
          type: 'convert-to-transfer',
          timestamp: Date.now(),
          undo: async () => {
            await this.convertFromTransfer(
              transactionId,
              previousMovements.map((m) => ({ amount: m.amount, notes: m.notes })),
              { silent: true }
            );
            // Restore merchant and category
            const restoreUpdates: Record<string, unknown> = {};
            if (previousMerchantId) restoreUpdates['merchantId'] = previousMerchantId;
            if (previousMovements[0]?.categoryId) restoreUpdates['categoryId'] = previousMovements[0].categoryId;
            if (previousMovements[0]?.readyToAssign)
              restoreUpdates['readyToAssign'] = previousMovements[0].readyToAssign;
            if (Object.keys(restoreUpdates).length > 0) {
              await this.updateTransaction(transactionId, restoreUpdates, undefined, { silent: true });
            }
          },
          redo: async () => {
            await this.convertToTransfer(transactionId, toAccountId, { silent: true });
          },
        });
      }

      return result;
    } catch (error) {
      console.error('Error converting transaction to transfer:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to convert transaction to transfer';
      this._error.set(errorMessage);
      throw error;
    }
  }

  /**
   * Convert a transfer transaction back to a regular transaction
   */
  async convertFromTransfer(
    transactionId: Id<'transaction'>,
    movements: { amount: bigint; notes?: string }[],
    toastOptions?: TransactionToastOptions
  ): Promise<boolean> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      throw new Error('Workspace ID not found');
    }

    // Find the paired transaction ID before conversion so we can remove it from the list
    const currentTransaction = this._rawTransactions().find((t) => t._id === transactionId);
    const pairedTransactionId = currentTransaction?.transferPairId;

    // Capture previous state for undo
    const isSilent = toastOptions?.silent === true || toastOptions?.enabled === false;
    const previousToAccountId = currentTransaction?.transferPairBankAccountId;

    try {
      this._error.set(null);
      const mutationPromise = (async () => {
        await this.convexService.mutation(api.transactions.convertFromTransfer, {
          transactionId,
          workspaceId: workspaceId as Id<'workspace'>,
          movements,
        });

        // Refresh the converted transaction (now regular)
        await this.refreshTransaction(transactionId);

        // Remove the paired transaction from the list (it's now deleted)
        if (pairedTransactionId) {
          this.removeTransactionFromList(pairedTransactionId);
        }

        // Restart subscription with updated IDs
        this.startWatchingTransactions();

        return true;
      })();

      const result = await this.executeWithToast(mutationPromise, {
        loading: 'Converting transaction...',
        success: 'Converted to regular transaction',
        error: 'Failed to convert transaction',
        ...toastOptions,
      });

      if (result && !isSilent && previousToAccountId) {
        this.undoRedoService.pushAction({
          description: 'Converted to regular transaction',
          type: 'convert-from-transfer',
          timestamp: Date.now(),
          undo: async () => {
            await this.convertToTransfer(transactionId, previousToAccountId, { silent: true });
          },
          redo: async () => {
            await this.convertFromTransfer(transactionId, movements, { silent: true });
          },
        });
      }

      return result;
    } catch (error) {
      console.error('Error converting transfer to regular transaction:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to convert transfer to regular transaction';
      this._error.set(errorMessage);
      throw error;
    }
  }

  /**
   * Update a transfer transaction (change destination or source account)
   */
  async updateTransfer(
    transactionId: Id<'transaction'>,
    options: {
      toAccountId?: Id<'bankAccount'>;
      fromAccountId?: Id<'bankAccount'>;
      categoryId?: Id<'category'>;
      readyToAssign?: boolean;
    },
    toastOptions?: TransactionToastOptions
  ): Promise<boolean> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      throw new Error('Workspace ID not found');
    }

    // Capture previous state for undo
    const isSilent = toastOptions?.silent === true || toastOptions?.enabled === false;
    const existingTx = this._rawTransactions().find((t) => t._id === transactionId);
    const previousOptions: typeof options = {};
    if (options.toAccountId) {
      previousOptions.toAccountId = existingTx?.transferPairBankAccountId;
    }
    if (options.fromAccountId) {
      previousOptions.fromAccountId = existingTx?.transferPairBankAccountId;
    }

    try {
      this._error.set(null);
      const mutationPromise = (async () => {
        await this.convexService.mutation(api.transactions.updateTransfer, {
          transactionId,
          workspaceId: workspaceId as Id<'workspace'>,
          ...(options.toAccountId && { toAccountId: options.toAccountId }),
          ...(options.fromAccountId && { fromAccountId: options.fromAccountId }),
          ...(options.categoryId && { categoryId: options.categoryId }),
          ...(options.readyToAssign !== undefined && { readyToAssign: options.readyToAssign }),
        });

        // Refresh the transaction to update the UI in-place
        await this.refreshTransaction(transactionId);
        this.startWatchingTransactions();

        return true;
      })();

      const result = await this.executeWithToast(mutationPromise, {
        loading: 'Updating transfer...',
        success: 'Transfer updated',
        error: 'Failed to update transfer',
        ...toastOptions,
      });

      if (result && !isSilent && (previousOptions.toAccountId ?? previousOptions.fromAccountId)) {
        this.undoRedoService.pushAction({
          description: 'Transfer updated',
          type: 'update-transfer',
          timestamp: Date.now(),
          undo: async () => {
            await this.updateTransfer(transactionId, previousOptions, { silent: true });
          },
          redo: async () => {
            await this.updateTransfer(transactionId, options, { silent: true });
          },
        });
      }

      return result;
    } catch (error) {
      console.error('Error updating transfer:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to update transfer';
      this._error.set(errorMessage);
      throw error;
    }
  }

  /**
   * Convert a transaction to a starting balance
   */
  async convertToStartingBalance(
    transactionId: Id<'transaction'>,
    toastOptions?: TransactionToastOptions
  ): Promise<boolean> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      throw new Error('Workspace ID not found');
    }

    // Find the paired transaction ID before conversion so we can remove it from the list (if transfer)
    const currentTransaction = this._rawTransactions().find((t) => t._id === transactionId);
    const pairedTransactionId = currentTransaction?.transferPairId;

    try {
      this._error.set(null);
      const mutationPromise = (async () => {
        await this.convexService.mutation(api.transactions.convertToStartingBalance, {
          transactionId,
          workspaceId: workspaceId as Id<'workspace'>,
        });

        // Refresh the converted transaction
        await this.refreshTransaction(transactionId);

        // Remove the paired transaction from the list if it existed (it's now deleted)
        if (pairedTransactionId) {
          this.removeTransactionFromList(pairedTransactionId);
        }

        // Restart subscription with updated IDs
        this.startWatchingTransactions();

        return true;
      })();

      return await this.executeWithToast(mutationPromise, {
        loading: 'Converting transaction...',
        success: 'Converted to starting balance',
        error: 'Failed to convert transaction',
        ...toastOptions,
      });
    } catch (error) {
      console.error('Error converting to starting balance:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to convert transaction';
      this._error.set(errorMessage);
      throw error;
    }
  }

  /**
   * Convert a transaction to a balance adjustment
   */
  async convertToBalanceAdjustment(
    transactionId: Id<'transaction'>,
    toastOptions?: TransactionToastOptions
  ): Promise<boolean> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      throw new Error('Workspace ID not found');
    }

    // Find the paired transaction ID before conversion so we can remove it from the list (if transfer)
    const currentTransaction = this._rawTransactions().find((t) => t._id === transactionId);
    const pairedTransactionId = currentTransaction?.transferPairId;

    try {
      this._error.set(null);
      const mutationPromise = (async () => {
        await this.convexService.mutation(api.transactions.convertToBalanceAdjustment, {
          transactionId,
          workspaceId: workspaceId as Id<'workspace'>,
        });

        // Refresh the converted transaction
        await this.refreshTransaction(transactionId);

        // Remove the paired transaction from the list if it existed (it's now deleted)
        if (pairedTransactionId) {
          this.removeTransactionFromList(pairedTransactionId);
        }

        // Restart subscription with updated IDs
        this.startWatchingTransactions();

        return true;
      })();

      return await this.executeWithToast(mutationPromise, {
        loading: 'Converting transaction...',
        success: 'Converted to balance adjustment',
        error: 'Failed to convert transaction',
        ...toastOptions,
      });
    } catch (error) {
      console.error('Error converting to balance adjustment:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to convert transaction';
      this._error.set(errorMessage);
      throw error;
    }
  }

  /**
   * Start watching transaction status counts for real-time updates
   * Pre-loads uncategorized and pending transaction counts during app initialization
   */
  private startWatchingStatusCounts() {
    // Stop existing subscription first
    this.stopWatchingStatusCounts();

    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      return;
    }

    this._loadingStatusCounts.set(true);
    this._hasLoadedStatusCounts.set(false);

    const watcher = this.convexService.watchQuery<{
      pendingCount: number;
      needsReviewCount: number;
      transferCount: number;
    }>(api.transactions.getTransactionStatusCounts, { workspaceId: workspaceId as Id<'workspace'> });

    this.statusCountsSubscription = watcher.subscribe((counts) => {
      if (counts !== undefined) {
        this._statusCounts.set(counts);
        this._loadingStatusCounts.set(false);
        this._hasLoadedStatusCounts.set(true);
      }
    });
  }

  /**
   * Stop watching transaction status counts (cleanup subscription)
   */
  private stopWatchingStatusCounts() {
    if (this.statusCountsSubscription) {
      this.statusCountsSubscription();
      this.statusCountsSubscription = undefined;
    }
  }

  /**
   * Set the dialog opener function (called by layout component)
   */
  setDialogOpener(opener: (context?: CreateTransactionDialogContext) => void): void {
    this.dialogOpener = opener;
  }

  /**
   * Open the create transaction dialog
   * Uses bank account context if set by a bank account page
   */
  openCreateDialog(context?: CreateTransactionDialogContext): void {
    if (this.dialogOpener) {
      // Use provided context, or get from current bank account context if on a bank account page
      const finalContext = context ?? this.getCurrentBankAccountContext();
      console.log('[TransactionService] openCreateDialog - context:', context);
      console.log('[TransactionService] openCreateDialog - finalContext:', finalContext);
      this.dialogOpener(finalContext);
    }
  }

  openMakeRecurringDialog(transaction: TransactionWithRelations): void {
    if (transaction.type !== 'regular' && transaction.type !== 'transfer') {
      return;
    }

    const nextDate = this.getNextMonthlyDueDate(transaction.date);
    const movements = transaction.movements.map((movement) => ({
      amount: movement.amount,
      ...(movement.categoryId !== undefined && { categoryId: movement.categoryId }),
      ...(movement.readyToAssign !== undefined && { readyToAssign: movement.readyToAssign }),
      ...(movement.notes !== undefined && { notes: movement.notes }),
    }));
    const merchantId = transaction.type === 'regular' ? transaction.merchantId : undefined;
    const pendingMerchantName =
      transaction.type === 'regular' && !merchantId && transaction.merchantName ? transaction.merchantName : undefined;

    this.openCreateDialog({
      bankAccountId: transaction.bankAccountId,
      source: 'transaction-details',
      draft: {
        type: transaction.type,
        date: nextDate,
        recurrence: 'monthly',
        bankAccountId: transaction.bankAccountId,
        ...(transaction.type === 'transfer' &&
          transaction.transferPairBankAccountId && { transferToAccountId: transaction.transferPairBankAccountId }),
        amount: transaction.amount,
        ...(merchantId !== undefined && { merchantId }),
        ...(pendingMerchantName !== undefined && { pendingMerchantName }),
        movements,
        ...(transaction.notes !== undefined && { notes: transaction.notes }),
        status: transaction.status === 'pending' ? 'pending' : 'cleared',
      },
    });
  }

  private getNextMonthlyDueDate(anchorDate: string): string {
    const anchor = this.parseIsoDate(anchorDate) ?? new Date();
    let nextDate = this.addOneCalendarMonth(anchor);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    while (nextDate <= today) {
      nextDate = this.addOneCalendarMonth(nextDate);
    }

    return this.formatLocalIsoDate(nextDate);
  }

  private parseIsoDate(value: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
      return null;
    }

    const [, yearText, monthText, dayText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
  }

  private addOneCalendarMonth(date: Date): Date {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const lastDayOfTargetMonth = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(day, lastDayOfTargetMonth));
  }

  private formatLocalIsoDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Set the current bank account context for transaction creation.
   * Called by bank account pages when they mount.
   */
  setCurrentBankAccountContext(bankAccountId: Id<'bankAccount'>): void {
    this._currentBankAccountContext.set(bankAccountId);
  }

  /**
   * Clear the current bank account context.
   * Called by bank account pages when they unmount.
   */
  clearCurrentBankAccountContext(): void {
    console.log('[TransactionService] clearCurrentBankAccountContext');
    this._currentBankAccountContext.set(null);
  }

  /**
   * Get the current bank account context if set.
   * Used to pre-select bank account in transaction creation dialog.
   */
  private getCurrentBankAccountContext(): CreateTransactionDialogContext | undefined {
    const bankAccountId = this._currentBankAccountContext();
    console.log('[TransactionService] getCurrentBankAccountContext:', bankAccountId);

    if (bankAccountId) {
      return { bankAccountId };
    }

    return undefined;
  }

  /**
   * Approve a transaction link (confirm auto-linked import is correct)
   * Optionally applies resolution choices for discrepancies
   */
  async approveTransactionLink(
    transactionId: Id<'transaction'>,
    resolutions?: {
      useImportAmount?: boolean;
      useImportDate?: boolean;
      useImportMerchant?: boolean;
    }
  ): Promise<boolean> {
    try {
      this._error.set(null);
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        return false;
      }

      const mutationPromise = (async () => {
        await this.convexService.mutation(api.transactionLinking.approveTransactionLink, {
          workspaceId: workspaceId as Id<'workspace'>,
          transactionId,
          resolutions,
        });
        return true;
      })();

      return await this.executeWithToast(mutationPromise, {
        loading: 'Confirming link...',
        success: 'Link confirmed',
        error: 'Failed to confirm link',
      });
    } catch (error: unknown) {
      console.error('Error approving transaction link:', error);
      this._error.set('Failed to confirm link');
      return false;
    }
  }

  /**
   * Unlink a transaction from its auto-linked import
   * Restores the manual transaction and creates a new imported transaction
   */
  async unlinkTransaction(transactionId: Id<'transaction'>): Promise<boolean> {
    try {
      this._error.set(null);
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        return false;
      }

      const mutationPromise = (async () => {
        await this.convexService.mutation(api.transactionLinking.unlinkTransaction, {
          workspaceId: workspaceId as Id<'workspace'>,
          transactionId,
        });
        return true;
      })();

      return await this.executeWithToast(mutationPromise, {
        loading: 'Unlinking transaction...',
        success: 'Transaction unlinked',
        error: 'Failed to unlink transaction',
      });
    } catch (error: unknown) {
      console.error('Error unlinking transaction:', error);
      this._error.set('Failed to unlink transaction');
      return false;
    }
  }

  // ============================================================================
  // TRANSFER DETECTION METHODS
  // ============================================================================

  /**
   * Approve a transfer suggestion (for single-side imports)
   * If counterpartAccountId provided: Creates paired transaction, links both
   * If no counterpartAccountId: Marks as transfer, status='approved_no_destination'
   */
  async approveTransferSuggestion(
    transactionId: Id<'transaction'>,
    counterpartAccountId?: Id<'bankAccount'>
  ): Promise<boolean> {
    try {
      this._error.set(null);
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        return false;
      }

      const mutationPromise = (async () => {
        await this.convexService.mutation(api.transferDetection.approveTransferSuggestion, {
          workspaceId: workspaceId as Id<'workspace'>,
          transactionId,
          counterpartAccountId,
        });

        // Refresh the transaction to update the UI
        await this.refreshTransaction(transactionId);
        this.startWatchingTransactions();

        return true;
      })();

      return await this.executeWithToast(mutationPromise, {
        loading: 'Confirming transfer...',
        success: counterpartAccountId ? 'Transfer confirmed' : 'Marked as transfer',
        error: 'Failed to confirm transfer',
      });
    } catch (error) {
      console.error('Error approving transfer suggestion:', error);
      this._error.set('Failed to confirm transfer');
      return false;
    }
  }

  /**
   * Approve a linked transfer (when both sides are already imported)
   * Cascades approval to the paired transaction
   */
  async approveLinkedTransfer(transactionId: Id<'transaction'>): Promise<boolean> {
    try {
      this._error.set(null);
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        return false;
      }

      const mutationPromise = (async () => {
        await this.convexService.mutation(api.transferDetection.approveLinkedTransfer, {
          workspaceId: workspaceId as Id<'workspace'>,
          transactionId,
        });

        // Refresh the transaction to update the UI
        await this.refreshTransaction(transactionId);
        this.startWatchingTransactions();

        return true;
      })();

      return await this.executeWithToast(mutationPromise, {
        loading: 'Approving transfer...',
        success: 'Transfer approved',
        error: 'Failed to approve transfer',
      });
    } catch (error) {
      console.error('Error approving linked transfer:', error);
      this._error.set('Failed to approve transfer');
      return false;
    }
  }

  /**
   * Reject a transfer suggestion
   * Keeps as regular transaction, marks suggestion as rejected
   * If linked pair exists, unlinks and marks other side as regular too
   */
  async rejectTransferSuggestion(transactionId: Id<'transaction'>): Promise<boolean> {
    try {
      this._error.set(null);
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        return false;
      }

      const mutationPromise = (async () => {
        await this.convexService.mutation(api.transferDetection.rejectTransferSuggestion, {
          workspaceId: workspaceId as Id<'workspace'>,
          transactionId,
        });

        // Refresh the transaction to update the UI
        await this.refreshTransaction(transactionId);
        this.startWatchingTransactions();

        return true;
      })();

      return await this.executeWithToast(mutationPromise, {
        loading: 'Processing...',
        success: 'Not a transfer',
        error: 'Failed to reject transfer suggestion',
      });
    } catch (error) {
      console.error('Error rejecting transfer suggestion:', error);
      this._error.set('Failed to reject transfer suggestion');
      return false;
    }
  }
}
