import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BrnDialogClose, BrnDialogContent, BrnDialogTrigger } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialog, HlmDialogContent, HlmDialogFooter, HlmDialogHeader } from '@spartan-ng/helm/dialog';
import { HlmSeparator } from '@spartan-ng/helm/separator';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import {
  nucleoArrowLeft as ArrowLeft,
  nucleoTransfer as ArrowLeftRight,
  nucleoArrowRight as ArrowRight,
  nucleoBadgeCheck as BadgeCheck,
  nucleoCategory as Box,
  nucleoBank as Building2,
  nucleoCalendarRepeating as CalendarDays,
  nucleoCheck as Check,
  nucleoChevronRight as ChevronRight,
  nucleoHistory as ClockFading,
  nucleoCloud as Cloud,
  nucleoQuestion as FileQuestionMark,
  nucleoLink as Link,
  nucleoLock as Lock,
  NucleoIcon,
  nucleoSplit as SplitIconType,
  nucleoTrash as Trash2,
  nucleoWarning as TriangleAlert,
  nucleoUndo as Undo2,
  nucleoClose as X,
} from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { TransactionLinkComparisonDialogComponent } from '../../components/dialogs/transaction-link-comparison-dialog/transaction-link-comparison-dialog';
import { TransferApprovalDialogComponent } from '../../components/dialogs/transfer-approval-dialog/transfer-approval-dialog';
import { AmountSignToggleComponent } from '../../components/transaction/amount-sign-toggle.component';
import { BankAccountSelectorComponent } from '../../components/transaction/bank-account-selector.component';
import { CategorySelectorComponent } from '../../components/transaction/category-selector.component';
import { PayeeChangeEvent, PayeeSelectorComponent } from '../../components/transaction/payee-selector.component';
import {
  PlannedTransactionSelectorComponent,
  type PlannedTransactionSelection,
} from '../../components/transaction/planned-transaction-selector.component';
import { TransactionDatePickerComponent } from '../../components/transaction/transaction-date-picker.component';
import { Split, TransactionSplitsComponent } from '../../components/transaction/transaction-splits.component';
import { BankAccountService } from '../../services/bank-account.service';
import { Category, CategoryService } from '../../services/category.service';
import { LocalAuthService } from '../../services/local-auth.service';
import { ConvexService } from '../../services/convex.service';
import { CurrencyService } from '../../services/currency.service';
import { MerchantService } from '../../services/merchant.service';
import { NavigationService } from '../../services/navigation.service';
import {
  ScheduledTransactionService,
  type ScheduledTransactionWithRelations,
} from '../../services/scheduled-transaction.service';
import { TransactionService, type TransactionWithRelations } from '../../services/transaction.service';
import { UndoRedoService } from '../../services/undo-redo.service';
import { WorkspaceService } from '../../services/workspace.service';
import { ArithmeticCurrencyInputComponent } from '../../shared/components/arithmetic-currency-input/arithmetic-currency-input.component';
import { getCurrencyFormat } from '../../shared/utils/currency';
import { dateToYearMonth } from '../../shared/utils/month.utils';
import { HlmTextarea } from '../../ui/textarea/src/lib/hlm-textarea';
import { TransactionPageService } from '../transaction/transaction-page.service';
@Component({
  selector: 'app-transaction-details',
  imports: [
    RouterLink,
    NucleoIcon,
    ArithmeticCurrencyInputComponent,
    TransactionDatePickerComponent,
    BankAccountSelectorComponent,
    CategorySelectorComponent,
    PayeeSelectorComponent,
    TransactionSplitsComponent,
    AmountSignToggleComponent,
    TransactionLinkComparisonDialogComponent,
    TransferApprovalDialogComponent,
    PlannedTransactionSelectorComponent,
    HlmButton,
    BrnDialogTrigger,
    BrnDialogContent,
    BrnDialogClose,
    HlmTextarea,
    HlmSeparator,
    HlmDialogContent,
    HlmDialog,
    HlmDialogFooter,
    HlmDialogHeader,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transaction-details.html',
  styles: [],
})
export class TransactionDetailsComponent {
  private readonly transactionConvexService = inject(TransactionService);
  private readonly transactionPageService = inject(TransactionPageService);
  private readonly route = inject(ActivatedRoute);
  private readonly merchantService = inject(MerchantService);
  private readonly categoryConvexService = inject(CategoryService);
  private readonly bankAccountConvexService = inject(BankAccountService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly clerkService = inject(LocalAuthService);
  private readonly navigationService = inject(NavigationService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly convexService = inject(ConvexService);
  private readonly scheduledTransactionService = inject(ScheduledTransactionService);
  private readonly undoRedoService = inject(UndoRedoService);
  private readonly currencyService = inject(CurrencyService);
  protected readonly currencyCode = this.currencyService.currencyCode;
  protected readonly currencySymbol = computed(() => getCurrencyFormat(this.currencyService.currencyCode()).symbol);
  protected readonly notesEditor = viewChild<ElementRef<HTMLTextAreaElement>>('notesEditor');
  protected readonly amountEditor = viewChild<ArithmeticCurrencyInputComponent>('amountEditor');
  private isDestroyed = false;
  protected readonly FileQuestion = FileQuestionMark;
  protected readonly ArrowLeft = ArrowLeft;
  protected readonly ArrowLeftRight = ArrowLeftRight;
  protected readonly Box = Box;
  protected readonly Building2 = Building2;
  protected readonly UnmatchIcon = X;
  protected readonly ChevronRight = ChevronRight;
  protected readonly SplitIcon = SplitIconType;
  protected readonly BigInt = BigInt;
  protected readonly ClockFading = ClockFading;
  protected readonly Check = Check;
  protected readonly Lock = Lock;
  protected readonly BadgeCheck = BadgeCheck;
  protected readonly Undo2 = Undo2;
  protected readonly Trash2 = Trash2;
  protected readonly LinkIcon = Link;
  protected readonly CloudIcon = Cloud;
  protected readonly TriangleAlert = TriangleAlert;
  protected readonly ArrowRight = ArrowRight;
  protected readonly RefreshCwIcon = CalendarDays;
  protected readonly Math = Math;
  protected readonly Number = Number;

  readonly transaction = this.transactionPageService.transaction;
  readonly populatedTransaction = this.transactionPageService.populatedTransaction;
  readonly isLoading = this.transactionPageService.isLoading;
  readonly categories = this.categoryConvexService.categories;
  readonly bankAccounts = this.bankAccountConvexService.bankAccounts;
  readonly merchants = this.merchantService.merchants;
  readonly sortedCategories = this.categoryConvexService.sortedCategories;

  // Optimistic state for category selection
  readonly optimisticCategoryId = signal<string | null | undefined>(undefined);
  readonly optimisticReadyToAssign = signal<boolean | undefined>(undefined);

  // Optimistic state for date selection
  readonly optimisticDate = signal<Date | undefined>(undefined);

  // Optimistic state for bank account selection
  readonly optimisticBankAccountId = signal<string | undefined>(undefined);

  // Optimistic state for merchant selection
  readonly optimisticMerchantId = signal<string | null | undefined>(undefined);

  // Optimistic state for transfer pair bank account (when updating transfer payee)
  readonly optimisticTransferPairBankAccountId = signal<string | undefined>(undefined);

  // Optimistic state for transaction type (when converting between transfer and regular)
  // undefined = use actual transaction type, true = optimistically a transfer, false = optimistically not a transfer
  readonly optimisticIsTransfer = signal<boolean | undefined>(undefined);

  // For off-budget side of cross-budget transfers: category from the paired on-budget transaction
  private readonly pairedCategoryId = signal<string | null | undefined>(undefined);
  private readonly pairedReadyToAssign = signal<boolean | undefined>(undefined);
  private fetchedPairedTransactionId: string | null = null;

  // Computed values for category selector with optimistic updates
  readonly displayCategoryId = computed(() => {
    const optimistic = this.optimisticCategoryId();
    if (optimistic !== undefined) {
      return optimistic;
    }
    // Off-budget side of cross-budget transfer: use paired transaction's category
    if (this.isCrossBudgetTransfer() && !this.isCrossBudgetOnBudgetSide()) {
      const paired = this.pairedCategoryId();
      if (paired !== undefined) return paired;
    }
    const movement = this.transaction()?.movements[0];
    return movement?.categoryId ?? null;
  });

  readonly displayReadyToAssign = computed(() => {
    const optimistic = this.optimisticReadyToAssign();
    if (optimistic !== undefined) {
      return optimistic;
    }
    // Off-budget side of cross-budget transfer: use paired transaction's readyToAssign
    if (this.isCrossBudgetTransfer() && !this.isCrossBudgetOnBudgetSide()) {
      const paired = this.pairedReadyToAssign();
      if (paired !== undefined) return paired;
    }
    const movement = this.transaction()?.movements[0];
    return movement?.readyToAssign ?? false;
  });

  // Computed value for bank account selector with optimistic updates
  readonly displayBankAccountId = computed(() => {
    const optimistic = this.optimisticBankAccountId();
    if (optimistic !== undefined) {
      return optimistic;
    }
    return this.transaction()?.bankAccountId ?? null;
  });

  readonly transactionNotes = signal<string>('');
  readonly transactionAmountValue = computed(() => {
    const transaction = this.transaction();
    return transaction?.amount ? Number(transaction.amount) : 0;
  });
  readonly transactionAmountEdit = signal<number>(0);
  readonly amountSign = computed(() => {
    const amount = this.transactionAmountEdit();
    return amount >= 0 ? 'inflow' : 'outflow';
  });
  // Display absolute value in the input field
  readonly transactionAmountDisplay = computed(() => Math.abs(this.transactionAmountEdit()));
  private lastTransactionId = signal<string | null>(null);
  // Computed value for merchant selector with optimistic updates
  readonly displayMerchantId = computed(() => {
    const optimistic = this.optimisticMerchantId();
    if (optimistic !== undefined) {
      return optimistic;
    }
    return this.transaction()?.merchantId ?? null;
  });

  readonly displayMerchantName = computed(() => {
    const transaction = this.transaction();
    const pendingName = this.pendingMerchantName();
    if (pendingName) return pendingName;

    // Check for optimistic merchant ID to show merchant name immediately
    const optimisticId = this.optimisticMerchantId();
    if (optimisticId !== undefined && optimisticId !== null) {
      const merchant = this.merchants().find((m) => m._id === optimisticId);
      if (merchant) return merchant.name;
    }

    return transaction?.merchantName ?? '';
  });
  readonly merchantRoute = computed(() => {
    const transaction = this.transaction();
    if (!transaction?.merchantId) return null;
    return this.getMerchantRoute(transaction.merchantId);
  });
  readonly transactionDate = computed(() => {
    // Use optimistic date if set, otherwise use transaction date
    const optimistic = this.optimisticDate();
    if (optimistic !== undefined) {
      return optimistic;
    }

    const transaction = this.transaction();
    if (!transaction?.date) return new Date();

    // Parse the date string as local date, not UTC
    const [year, month, day] = transaction.date.split('-').map(Number);
    return new Date(year, month - 1, day);
  });
  readonly transactionYearMonth = computed(() => dateToYearMonth(this.transactionDate()));

  readonly canScheduleTransaction = computed(() => {
    const type = this.transaction()?.type;
    return type === 'regular' || type === 'transfer';
  });

  readonly isTransfer = computed(() => {
    return this.transaction()?.type === 'transfer';
  });

  // Optimistic version of isTransfer for UI display during type conversions
  readonly displayIsTransfer = computed(() => {
    const optimistic = this.optimisticIsTransfer();
    if (optimistic !== undefined) {
      return optimistic;
    }
    return this.isTransfer();
  });

  // Cross-budget transfer detection: one account is on-budget, the other off-budget
  readonly isCrossBudgetTransfer = computed(() => {
    const transaction = this.transaction();
    if (transaction?.type !== 'transfer') return false;
    const accountType = transaction.bankAccount?.accountType;
    const pairedAccountId = this.transferPairBankAccountId();
    if (!accountType || !pairedAccountId) return false;
    const pairedAccount = this.bankAccounts().find((a) => a._id === pairedAccountId);
    const pairedAccountType = pairedAccount?.accountType;
    if (!pairedAccountType) return false;
    const isOnBudget = (type: string) => type.startsWith('banking_') || type.startsWith('credit_');
    return isOnBudget(accountType) !== isOnBudget(pairedAccountType);
  });

  // Cross-budget transfer: this transaction is the on-budget side
  readonly isCrossBudgetOnBudgetSide = computed(() => {
    if (!this.isCrossBudgetTransfer()) return false;
    const accountType = this.transaction()?.bankAccount?.accountType;
    if (!accountType) return false;
    return accountType.startsWith('banking_') || accountType.startsWith('credit_');
  });

  // Off-budget account detection (investment/loan accounts don't need categories)
  readonly isOffBudgetAccount = computed(() => {
    const transaction = this.transaction();
    const accountType = transaction?.bankAccount?.accountType;
    if (!accountType) return false;
    return !accountType.startsWith('banking_') && !accountType.startsWith('credit_');
  });

  readonly isStartingBalance = computed(() => {
    return this.transaction()?.type === 'starting_balance';
  });

  readonly isBalanceAdjustment = computed(() => {
    return this.transaction()?.type === 'balance_adjustment';
  });

  readonly isPending = computed(() => {
    return this.transaction()?.status === 'pending';
  });

  readonly isReconciled = computed(() => {
    return this.transaction()?.status === 'reconciled';
  });

  readonly isFormDisabled = computed(() => {
    return this.isReconciled() || this.isDeleted();
  });

  readonly transferPairAccountName = computed(() => {
    return this.transaction()?.transferPairAccountName ?? null;
  });

  readonly transferPairId = computed(() => {
    return this.transaction()?.transferPairId ?? null;
  });

  // Bank accounts available for payee selection (all accounts shown, selection logic handles duplicates)
  readonly payeeBankAccounts = computed(() => {
    return this.bankAccounts();
  });

  // For transfers, get the transfer pair bank account ID to pre-select in payee selector
  // Supports optimistic updates when changing the transfer destination
  readonly transferPairBankAccountId = computed(() => {
    // Check for optimistic value first
    const optimistic = this.optimisticTransferPairBankAccountId();
    if (optimistic !== undefined) {
      return optimistic;
    }

    const transaction = this.transaction();
    if (transaction?.type !== 'transfer' || !transaction.transferPairId) {
      return null;
    }
    // The transfer pair bank account is the "payee" - we need to find it
    // We can look at the transferPairAccountName to match, or find the paired transaction
    // For now, we'll need to look up from the bank accounts by name
    const pairAccountName = this.transferPairAccountName();
    if (!pairAccountName) return null;
    const matchingAccount = this.bankAccounts().find((account) => account.name === pairAccountName);
    return matchingAccount?._id ?? null;
  });

  private readonly transferPairAccount = computed(() => {
    const pairAccountId = this.transferPairBankAccountId();
    if (!pairAccountId) {
      return null;
    }
    return this.bankAccounts().find((account) => account._id === pairAccountId) ?? null;
  });

  getTransferPairRoute(transferPairId: string | null): string | null {
    if (!transferPairId) return null;
    const workspaceShortId = this.workspaceService.workspaceShortId();
    if (!workspaceShortId) return null;
    return `/${workspaceShortId}/transactions/${transferPairId}/details`;
  }
  readonly saving = signal(false);
  readonly savingCategory = signal(false);
  readonly savingBankAccount = signal(false);
  readonly savingMerchant = signal(false);
  readonly savingDate = signal(false);
  readonly savingPending = signal(false);
  readonly savingReviewStatus = signal(false);
  readonly savingRestore = signal(false);
  readonly error = signal<string | null>(null);
  readonly amountError = signal<string | null>(null);
  readonly dateError = signal<string | null>(null);
  readonly pendingMerchantName = signal<string | null>(null);

  // Computed properties for deleted state
  readonly isDeleted = computed(() => this.transaction()?.isDeleted ?? false);

  // Amount change detection (when Plaid updates amount on reviewed transaction)
  readonly hasAmountChange = computed(() => {
    const tx = this.transaction();
    return tx?.originalApprovedAmount !== undefined && tx?.reviewStatus === 'needs_review';
  });

  readonly originalApprovedAmount = computed(() => {
    return this.transaction()?.originalApprovedAmount;
  });

  // Split mode state
  readonly isSplitMode = signal<boolean>(false);
  readonly localSplits = signal<Split[]>([]);
  readonly initialSplits = signal<Split[]>([]);

  // Link comparison dialog state
  readonly showLinkComparisonDialog = signal(false);
  readonly savingLinkApproval = signal(false);

  // Linked import computed properties
  readonly hasLinkedImport = computed(() => {
    const raw = this.transaction();
    return raw != null && 'linkedRawTransactionId' in raw && raw.linkedRawTransactionId != null;
  });

  readonly bankImportCardClasses = computed(() => {
    const base = 'mb-4 rounded-lg border p-3';
    return this.isPendingLinkApproval() ? `${base} border-primary bg-primary/5` : `${base} bg-accent/50`;
  });

  readonly isPendingLinkApproval = computed(() => {
    const raw = this.transaction();
    return this.hasLinkedImport() && raw?.reviewStatus === 'needs_review';
  });

  readonly linkConfidencePercent = computed(() => {
    const raw = this.transaction();
    if (raw && 'linkConfidence' in raw && typeof raw.linkConfidence === 'number') {
      // linkConfidence is already 0-100, not 0-1
      return Math.round(raw.linkConfidence);
    }
    return 0;
  });

  readonly linkReason = computed(() => {
    const raw = this.transaction();
    if (raw && 'linkReason' in raw && typeof raw.linkReason === 'string') {
      return raw.linkReason;
    }
    return null;
  });

  readonly hasLinkDiscrepancies = computed(() => {
    const raw = this.transaction();
    const importDetails = raw?.importDetails;
    if (!importDetails || !this.hasLinkedImport()) return false;

    // Check amount difference
    const amountDiffers = importDetails.amount !== raw.amount;

    const dateDiffers = importDetails.date !== raw.date;

    return amountDiffers || dateDiffers;
  });

  // Check if this is a regular bank import (not linked, has import details)
  readonly isRegularBankImport = computed(() => {
    const raw = this.transaction();
    return raw?.importDetails != null && !this.hasLinkedImport();
  });

  // ============================================================================
  // TRANSFER SUGGESTION COMPUTED PROPERTIES
  // ============================================================================

  // State for transfer approval dialog
  readonly savingTransferApproval = signal(false);

  // Check if transaction has an actionable transfer suggestion
  readonly hasTransferSuggestion = computed(() => {
    const raw = this.transaction();
    if (!raw || !('suggestedTransfer' in raw) || !raw.suggestedTransfer) return false;
    const status = raw.suggestedTransfer.status;
    return status === 'pending' || status === 'linked_pending_approval';
  });

  // Check if this is a linked transfer (both sides imported)
  readonly isLinkedTransferPending = computed(() => {
    const raw = this.transaction();
    if (!raw || !('suggestedTransfer' in raw) || !raw.suggestedTransfer) return false;
    return raw.suggestedTransfer.status === 'linked_pending_approval';
  });

  // Get transfer confidence percent
  readonly transferConfidencePercent = computed(() => {
    const raw = this.transaction();
    if (!raw || !('suggestedTransfer' in raw) || !raw.suggestedTransfer) return 0;
    return Math.round(raw.suggestedTransfer.transferConfidence);
  });

  // Get transfer detection reason
  readonly transferDetectionReason = computed(() => {
    const raw = this.transaction();
    if (!raw || !('suggestedTransfer' in raw) || !raw.suggestedTransfer) return null;
    return raw.suggestedTransfer.detectionReason;
  });

  // Get suggested counterpart account name
  readonly suggestedCounterpartAccountName = computed(() => {
    const raw = this.transaction();
    if (!raw || !('suggestedTransfer' in raw) || !raw.suggestedTransfer) return null;
    const suggestedId = raw.suggestedTransfer.suggestedCounterpartAccountId;
    if (!suggestedId) return null;
    const account = this.bankAccounts().find((a) => a._id === suggestedId);
    return account?.name ?? null;
  });

  // Format detection reason for display
  protected formatDetectionReason(reason: string | null): string {
    if (!reason) return '';
    switch (reason) {
      case 'plaid_transfer_code':
        return 'Bank categorization';
      case 'transfer_category':
        return 'Transfer category';
      case 'amount_match':
        return 'Matching amounts';
      case 'name_pattern':
        return 'Name pattern';
      default:
        return reason.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }

  // ============================================================================
  // PLANNED TRANSACTION LINKING
  // ============================================================================

  readonly savingPlannedLink = signal(false);

  // Fallback copy for a linked schedule that isn't in the active list (paused/completed)
  private readonly linkedPlannedFallback = signal<ScheduledTransactionWithRelations | null>(null);

  readonly linkedScheduledTransactionId = computed((): string | null => {
    const tx = this.transaction();
    return tx?.scheduledTransactionId ?? null;
  });

  readonly hasPlannedLink = computed(() => !!this.linkedScheduledTransactionId());
  readonly linkedPlannedOccurrenceLabel = computed(() => {
    const occurrenceDate = this.transaction()?.scheduledOccurrenceDate;
    return occurrenceDate ? this.formatDateForDisplay(occurrenceDate) : null;
  });

  private readonly linkedPlannedTransaction = computed((): ScheduledTransactionWithRelations | null => {
    const id = this.linkedScheduledTransactionId();
    if (!id) return null;
    const fromList = this.scheduledTransactionService.scheduledTransactions().find((s) => s._id === id);
    if (fromList) return fromList;
    const fallback = this.linkedPlannedFallback();
    return fallback?._id === id ? fallback : null;
  });

  readonly linkedPlannedName = computed((): string | null => {
    const planned = this.linkedPlannedTransaction();
    if (!planned) return null;
    if ((planned.transactionType ?? 'regular') === 'transfer') {
      return `Transfer to ${planned.transferToAccountName ?? 'account'}`;
    }
    return planned.merchantName ?? 'Planned transaction';
  });

  readonly plannedTransactionRoute = computed((): string[] | null => {
    const plannedId = this.linkedScheduledTransactionId();
    if (!plannedId) return null;
    return this.navigationService.getPlannedTransactionRoute(plannedId);
  });

  readonly showPlannedSection = computed(() => {
    const tx = this.transaction();
    if (!tx) return false;
    return tx.type === 'transfer' || (tx.type === 'regular' && !this.isOffBudgetAccount());
  });

  protected safeSetSignal<T>(signal: { set: (value: T) => void }, value: T): void {
    if (!this.isDestroyed) {
      signal.set(value);
    }
  }

  /**
   * Helper to update transaction state locally after a successful mutation.
   * Preserves existing reviewStatus; approval must be explicit.
   */
  private updateTransactionLocally(
    currentTransaction: NonNullable<ReturnType<typeof this.transaction>>,
    updates: Partial<NonNullable<ReturnType<typeof this.transaction>>>
  ): void {
    this.transactionPageService.setTransaction({
      ...currentTransaction,
      ...updates,
    });
  }

  private async refreshPlannedLink(transaction: TransactionWithRelations): Promise<void> {
    if (!transaction.scheduledTransactionId) return;
    const refreshed = await this.transactionConvexService.fetchTransactionById(transaction._id);
    if (refreshed && !this.isDestroyed && this.transaction()?._id === transaction._id) {
      this.transactionPageService.setTransaction(refreshed);
    }
  }

  constructor() {
    // Set up cleanup on destroy
    this.destroyRef.onDestroy(() => {
      this.isDestroyed = true;
    });

    // Update description and amount when transaction changes
    effect(() => {
      const transaction = this.transaction();
      if (transaction && !this.isDestroyed) {
        // Only reset notes if we're not currently saving (to avoid flicker during save)
        if (!this.saving()) {
          this.safeSetSignal(this.transactionNotes, transaction.notes ?? '');
          this.updateEditorContent(transaction.notes ?? '');
        }

        // Reset amount state when transaction data updates (from backend)
        // Only reset if we're not currently saving (to avoid flicker during save)
        if (!this.saving()) {
          const currentEditAmount = this.transactionAmountEdit();
          const transactionAmount = Number(transaction.amount);
          const previousTransactionId = this.lastTransactionId();
          const currentTransactionId = transaction._id;

          // Always update if this is a different transaction (transaction ID changed)
          // Or if: initial load (0) OR values are already in sync (no unsaved edits)
          // This preserves user edits when other fields trigger transaction updates
          const isNewTransaction = previousTransactionId !== currentTransactionId;
          if (isNewTransaction || currentEditAmount === transactionAmount) {
            if (currentEditAmount !== transactionAmount) {
              this.safeSetSignal(this.transactionAmountEdit, transactionAmount);
            }
          }

          // Track the current transaction ID
          if (isNewTransaction) {
            this.lastTransactionId.set(currentTransactionId);
          }
        }

        // Reset optimistic state when transaction data updates (from backend)
        // Only reset if we're not currently saving (to avoid flicker during save)
        if (!this.savingCategory()) {
          // Clear optimistic state if transaction data has been updated externally
          // (e.g., from another tab or after manual refresh)
          const hasOptimisticState =
            this.optimisticCategoryId() !== undefined || this.optimisticReadyToAssign() !== undefined;
          if (hasOptimisticState) {
            // Check if transaction data matches optimistic state - if so, clear it
            const movement = transaction.movements[0];
            const currentCategoryId = movement?.categoryId ?? null;
            const currentReadyToAssign = movement?.readyToAssign ?? false;

            const optimisticCategoryId = this.optimisticCategoryId();
            const optimisticReadyToAssign = this.optimisticReadyToAssign();

            const categoryMatches = optimisticCategoryId === undefined || optimisticCategoryId === currentCategoryId;
            const readyToAssignMatches =
              optimisticReadyToAssign === undefined || optimisticReadyToAssign === currentReadyToAssign;

            if (categoryMatches && readyToAssignMatches) {
              this.optimisticCategoryId.set(undefined);
              this.optimisticReadyToAssign.set(undefined);
            }
          }
        }

        // Reset optimistic date state when transaction data updates (from backend)
        // Only reset if we're not currently saving (to avoid flicker during save)
        if (!this.savingDate()) {
          const optimisticDate = this.optimisticDate();
          if (optimisticDate !== undefined && transaction.date) {
            // Check if transaction date matches optimistic date - if so, clear it
            const optimisticDateString = `${optimisticDate.getFullYear()}-${String(optimisticDate.getMonth() + 1).padStart(2, '0')}-${String(optimisticDate.getDate()).padStart(2, '0')}`;
            if (transaction.date === optimisticDateString) {
              this.optimisticDate.set(undefined);
            }
          }
        }

        // Reset optimistic bank account state when transaction data updates (from backend)
        // Only reset if we're not currently saving (to avoid flicker during save)
        if (!this.savingBankAccount()) {
          const optimisticBankAccountId = this.optimisticBankAccountId();
          if (optimisticBankAccountId !== undefined && transaction.bankAccountId) {
            // Check if transaction bank account matches optimistic bank account - if so, clear it
            if (transaction.bankAccountId === optimisticBankAccountId) {
              this.optimisticBankAccountId.set(undefined);
            }
          }
        }

        // Reset optimistic merchant state when transaction data updates (from backend)
        // Only reset if we're not currently saving (to avoid flicker during save)
        if (!this.savingMerchant()) {
          const optimisticMerchantId = this.optimisticMerchantId();
          if (optimisticMerchantId !== undefined) {
            // Normalize both values for comparison
            const transactionMerchantId = transaction.merchantId ?? null;
            const normalizedOptimistic = optimisticMerchantId ?? null;
            // Check if transaction merchant matches optimistic merchant - if so, clear it
            if (transactionMerchantId === normalizedOptimistic) {
              this.optimisticMerchantId.set(undefined);
            }
          }

          // Also reset optimistic transfer pair bank account state
          const optimisticTransferPairId = this.optimisticTransferPairBankAccountId();
          if (optimisticTransferPairId !== undefined && transaction.transferPairAccountName) {
            // Find the bank account that matches the transaction's transfer pair account name
            const matchingAccount = this.bankAccounts().find(
              (account) => account.name === transaction.transferPairAccountName
            );
            // If the transaction's transfer pair matches the optimistic value, clear it
            if (matchingAccount?._id === optimisticTransferPairId) {
              this.optimisticTransferPairBankAccountId.set(undefined);
            }
          }

          // Also reset optimistic transfer type state
          const optimisticIsTransfer = this.optimisticIsTransfer();
          if (optimisticIsTransfer !== undefined) {
            const actualIsTransfer = transaction.type === 'transfer';
            // If transaction type matches optimistic type, clear it
            if (actualIsTransfer === optimisticIsTransfer) {
              this.optimisticIsTransfer.set(undefined);
            }
          }
        }

        // Auto-enter split mode if transaction has multiple movements
        // Only do this if we're not already in split mode and not currently saving
        if (!this.isSplitMode() && !this.saving() && transaction.movements && transaction.movements.length > 1) {
          // Initialize splits from existing movements
          const splits: Split[] = transaction.movements.map((movement) => ({
            categoryId: movement.categoryId,
            readyToAssign: movement.readyToAssign,
            amount: movement.amount,
          }));

          // Store initial splits for change tracking (deep clone to handle BigInt)
          this.initialSplits.set(splits.map((split) => ({ ...split })));
          this.localSplits.set(splits);
          this.isSplitMode.set(true);
        }

        // Auto-enter split mode if navigated with enterSplitMode state
        const navState = history.state as Record<string, unknown> | null;
        if (!this.isSplitMode() && !this.saving() && navState?.['enterSplitMode']) {
          this.handleEnterSplitMode();
          // Clear the state so it doesn't re-trigger
          history.replaceState({ ...navState, enterSplitMode: undefined }, '');
        }
      }
    });

    // Refresh transaction details after undo/redo completes
    // The service-level undo actions update _rawTransactions but not transactionPageService,
    // so we need to re-fetch and sync the current transaction after each undo/redo.
    effect(() => {
      const version = this.undoRedoService.completedVersion();
      if (version === 0) return; // Skip initial value

      const currentTx = untracked(() => this.transaction());
      if (!currentTx || this.isDestroyed) return;

      // Re-fetch from service after undo/redo to get the latest state
      void this.transactionConvexService.fetchTransactionById(currentTx._id).then((refreshed) => {
        if (refreshed && !this.isDestroyed) {
          this.transactionPageService.setTransaction(refreshed);
          // Force-sync local edit signals that are normally guarded against backend overwrites
          this.safeSetSignal(this.transactionAmountEdit, Number(refreshed.amount));
          this.safeSetSignal(this.transactionNotes, refreshed.notes ?? '');
          this.updateEditorContent(refreshed.notes ?? '');
          // Clear all optimistic state since we're syncing fresh data from undo/redo
          this.optimisticIsTransfer.set(undefined);
          this.optimisticMerchantId.set(undefined);
          this.optimisticTransferPairBankAccountId.set(undefined);
          this.optimisticCategoryId.set(undefined);
          this.optimisticReadyToAssign.set(undefined);
          this.optimisticDate.set(undefined);
          this.optimisticBankAccountId.set(undefined);
          this.pendingMerchantName.set(null);
        }
      });
    });

    // Fetch paired transaction's category for off-budget side of cross-budget transfers
    effect(() => {
      const transaction = this.transaction();
      if (
        this.isCrossBudgetTransfer() &&
        !this.isCrossBudgetOnBudgetSide() &&
        transaction?.transferPairId &&
        this.fetchedPairedTransactionId !== transaction.transferPairId
      ) {
        const pairedId = transaction.transferPairId;
        this.fetchedPairedTransactionId = pairedId;
        void this.fetchPairedCategory(pairedId);
      } else if (!this.isCrossBudgetTransfer() || this.isCrossBudgetOnBudgetSide()) {
        this.pairedCategoryId.set(undefined);
        this.pairedReadyToAssign.set(undefined);
        this.fetchedPairedTransactionId = null;
      }
    });

    // Active schedules come from the shared subscription. Fetch a linked paused/completed
    // schedule once so the transaction page can still show a useful label.
    effect(() => {
      const scheduledTransactionId = this.linkedScheduledTransactionId();
      const activeScheduledTransactions = this.scheduledTransactionService.scheduledTransactions();

      if (
        !scheduledTransactionId ||
        activeScheduledTransactions.some((scheduled) => scheduled._id === scheduledTransactionId)
      ) {
        this.linkedPlannedFallback.set(null);
        return;
      }

      void this.loadLinkedPlannedFallback(scheduledTransactionId);
    });
  }

  private async fetchPairedCategory(pairedId: Id<'transaction'>) {
    const paired = await this.transactionConvexService.getTransactionById(pairedId);
    if (paired && !this.isDestroyed) {
      this.pairedCategoryId.set(paired.movements[0]?.categoryId ?? null);
      this.pairedReadyToAssign.set(paired.movements[0]?.readyToAssign ?? false);
    }
  }

  getCategoryName(categoryId: string | null): string {
    if (!categoryId) return 'None';
    const category = this.categories().find((c: Category) => c._id === categoryId);
    return category?.name ?? 'Unknown';
  }

  getCategoryType(categoryId: string | null): 'income' | 'expense' | 'transfer' | null {
    if (!categoryId) return null;
    // TODO: Categories don't have direct type field - need to get from categoryGroup
    // For now, return null to fix compilation error
    // const category = this.categories().find((c) => c._id === categoryId);
    // return category?.type ?? null;
    return null;
  }

  getBankAccountName(bankAccountId: string | null): string {
    if (!bankAccountId) return 'None';
    const account = this.bankAccounts().find((a) => a._id === bankAccountId);
    return account?.name ?? 'Unknown';
  }

  onBankAccountChange(accountId: string | null) {
    if (accountId) {
      void this.selectBankAccount(accountId);
    }
  }

  formatAmount(amount: number): string {
    return this.currencyService.format(amount);
  }

  formatDate(dateString: string | null): string {
    if (!dateString) return 'N/A';
    // Parse date components directly to avoid timezone issues
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    };
    return date.toLocaleDateString('en-US', options);
  }

  formatDateForInput(dateString: string | null): string {
    if (!dateString) return '';
    // Return the date string as-is since it's already in YYYY-MM-DD format
    return dateString;
  }

  formatDateForDisplay(dateString: string | null): string {
    if (!dateString) return 'Select date';
    // Parse date components directly to avoid timezone issues
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    };
    return date.toLocaleDateString('en-US', options);
  }

  getDateForPicker(dateString: string | null): Date | undefined {
    if (!dateString) return undefined;
    // Parse date components directly to avoid timezone issues
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  isPositiveAmount(): boolean {
    return this.transactionAmountValue() > 0;
  }

  isNegativeAmount(): boolean {
    return this.transactionAmountValue() < 0;
  }

  updateEditorContent(notes: string) {
    const editor = this.notesEditor()?.nativeElement;
    if (editor) {
      editor.value = notes;
    }
  }

  onAmountChange(value: number) {
    // Value is already in base units (cents) from the arithmetic input
    // Always use absolute value — the inflow/outflow toggle controls the sign
    const absoluteValue = Math.abs(value);
    const currentSign = this.amountSign();
    const signedValue = currentSign === 'outflow' ? -absoluteValue : absoluteValue;
    this.safeSetSignal(this.transactionAmountEdit, signedValue);
    this.safeSetSignal(this.amountError, null); // Clear error on input
  }

  onAmountBlur() {
    const currentTransaction = this.transaction();
    if (!currentTransaction) {
      return;
    }

    if (this.isSplitMode()) {
      return;
    }

    // Get the new amount from the edit signal
    const newAmountValue = this.transactionAmountEdit();

    // Only save if amount actually changed (compare number to bigint converted to number)
    if (newAmountValue !== Number(currentTransaction.amount)) {
      void this.saveTransactionAmount();
    }
  }

  onAmountEnter() {
    const currentTransaction = this.transaction();
    if (!currentTransaction) {
      return;
    }

    // Get the new amount from the edit signal
    const newAmountValue = this.transactionAmountEdit();

    // Only save if amount actually changed (compare number to bigint converted to number)
    if (!this.isSplitMode() && newAmountValue !== Number(currentTransaction.amount)) {
      void this.saveTransactionAmount();
    }

    // Blur the input field after saving
    this.amountEditor()?.focus();
    setTimeout(() => {
      const inputElement = this.amountEditor()?.inputElement()?.nativeElement;
      inputElement?.blur();
    }, 0);
  }

  onSignChange(sign: 'inflow' | 'outflow') {
    const currentAmount = this.transactionAmountEdit();
    const absoluteAmount = Math.abs(currentAmount);

    // Apply the new sign
    const newAmount = sign === 'outflow' ? -absoluteAmount : absoluteAmount;

    // Only update and save if the amount actually changed
    if (newAmount !== currentAmount) {
      this.safeSetSignal(this.transactionAmountEdit, newAmount);
      this.normalizeLocalSplitSigns(sign);

      if (this.isSplitMode()) {
        if (this.canSaveLocalSplits()) {
          void this.handleSaveSplits();
        }
      } else {
        void this.saveTransactionAmount();
      }
    }
  }

  onNotesInput(event: Event) {
    const target = event.target as HTMLTextAreaElement;
    this.safeSetSignal(this.transactionNotes, target.value);
    this.safeSetSignal(this.error, null);
  }

  onNotesBlur() {
    const currentTransaction = this.transaction();
    if (!currentTransaction) {
      return;
    }

    const newNotes = this.transactionNotes();
    const currentNotes = currentTransaction.notes ?? '';

    // Only save if notes actually changed
    if (newNotes !== currentNotes) {
      void this.saveTransactionNotes();
    }
  }

  onNotesKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      (event.target as HTMLTextAreaElement).blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      // Revert changes and blur
      const editor = this.notesEditor()?.nativeElement;
      if (editor) {
        editor.value = this.transaction()?.notes ?? '';
        this.safeSetSignal(this.transactionNotes, this.transaction()?.notes ?? '');
        editor.blur();
      }
    }
  }

  selectCategory(categoryId: string | null | 'ready-to-assign') {
    const currentTransaction = this.transaction();
    if (!currentTransaction || this.isFormDisabled()) {
      return;
    }

    // Prevent concurrent calls
    if (this.savingCategory()) {
      return;
    }

    const firstMovement = currentTransaction.movements[0];
    const previousCategoryId = firstMovement?.categoryId ?? null;
    const previousReadyToAssign = firstMovement?.readyToAssign ?? false;

    // Optimistic update - update UI immediately
    if (categoryId === 'ready-to-assign') {
      this.optimisticCategoryId.set(null);
      this.optimisticReadyToAssign.set(true);
    } else {
      this.optimisticCategoryId.set(categoryId);
      this.optimisticReadyToAssign.set(false);
    }

    this.safeSetSignal(this.savingCategory, true);
    this.safeSetSignal(this.error, null);

    // Pass current movements to avoid extra getTransaction query
    const movementsToPass = currentTransaction.movements.map((m) => ({
      amount: m.amount,
      categoryId: m.categoryId,
      readyToAssign: m.readyToAssign ?? false,
      notes: m.notes,
    }));

    // Fire the mutation without awaiting - Convex mutations wait for query consistency
    // which causes unnecessary delay. We use optimistic updates instead.
    let mutationPromise: Promise<boolean>;

    if (this.isCrossBudgetTransfer()) {
      // For cross-budget transfers, use updateTransfer to set category on the on-budget side
      mutationPromise =
        categoryId === 'ready-to-assign'
          ? this.transactionConvexService.updateTransfer(currentTransaction._id, {
              readyToAssign: true,
            })
          : this.transactionConvexService.updateTransfer(currentTransaction._id, {
              categoryId: (categoryId ?? undefined) as Id<'category'> | undefined,
              readyToAssign: false,
            });

      // Keep pairedCategoryId/pairedReadyToAssign in sync for off-budget side
      if (!this.isCrossBudgetOnBudgetSide()) {
        if (categoryId === 'ready-to-assign') {
          this.pairedCategoryId.set(null);
          this.pairedReadyToAssign.set(true);
        } else {
          this.pairedCategoryId.set(categoryId);
          this.pairedReadyToAssign.set(false);
        }
      }
    } else {
      mutationPromise =
        categoryId === 'ready-to-assign'
          ? this.transactionConvexService.updateTransaction(
              currentTransaction._id,
              {
                readyToAssign: true,
                categoryId: null,
              },
              movementsToPass
            )
          : this.transactionConvexService.updateTransaction(
              currentTransaction._id,
              {
                categoryId: categoryId as Id<'category'> | null,
                readyToAssign: false,
              },
              movementsToPass
            );
    }

    // Update the local transaction state immediately (optimistic update)
    const updatedMovements = currentTransaction.movements.map((movement, index) => {
      if (index === 0) {
        if (categoryId === 'ready-to-assign') {
          return {
            ...movement,
            categoryId: undefined,
            readyToAssign: true,
            category: null,
          };
        } else {
          const category = categoryId ? (this.categories().find((c) => c._id === categoryId) ?? null) : null;
          return {
            ...movement,
            categoryId: categoryId ? (categoryId as Id<'category'>) : undefined,
            readyToAssign: false,
            category: category,
          };
        }
      }
      return movement;
    }) as typeof currentTransaction.movements;

    this.updateTransactionLocally(currentTransaction, {
      movements: updatedMovements,
    });

    // Clear optimistic state and re-enable button immediately
    this.optimisticCategoryId.set(undefined);
    this.optimisticReadyToAssign.set(undefined);
    this.safeSetSignal(this.savingCategory, false);

    // Handle errors in background - revert optimistic update if mutation fails
    mutationPromise.catch((err: unknown) => {
      // Revert optimistic update on error
      this.optimisticCategoryId.set(previousCategoryId);
      this.optimisticReadyToAssign.set(previousReadyToAssign);

      // Revert the local transaction state
      this.transactionPageService.setTransaction(currentTransaction);

      this.safeSetSignal(this.error, 'Failed to update category');
      console.error('Error updating category:', err);
    });
  }

  async selectBankAccount(bankAccountId: string | null) {
    if (!bankAccountId) return;
    const currentTransaction = this.transaction();
    if (!currentTransaction || this.isFormDisabled() || currentTransaction.bankAccountId === bankAccountId) {
      return;
    }

    // Prevent concurrent calls
    if (this.savingBankAccount()) {
      return;
    }

    // Store previous bank account ID for potential revert
    const previousBankAccountId = currentTransaction.bankAccountId;

    // Optimistic update - update UI immediately
    this.optimisticBankAccountId.set(bankAccountId);
    this.safeSetSignal(this.savingBankAccount, true);
    this.safeSetSignal(this.error, null);

    try {
      await this.transactionConvexService.updateTransaction(currentTransaction._id, {
        bankAccountId: bankAccountId as Id<'bankAccount'>,
      });

      // Refresh the transaction from the server to get the updated state
      // This ensures nested data (bankAccount, isCrossBudgetTransfer, etc.) updates correctly
      const updatedTransaction = await this.transactionConvexService.fetchTransactionById(currentTransaction._id);
      if (updatedTransaction) {
        this.transactionPageService.setTransaction(updatedTransaction);
      }

      // Clear optimistic state now that we've updated the transaction from the server
      this.optimisticBankAccountId.set(undefined);

      // Show toast if transaction has import details
      if (currentTransaction.importDetails && previousBankAccountId !== bankAccountId) {
        toast.success('Updated transaction');
      }
    } catch (err: unknown) {
      // Revert optimistic update on error
      this.optimisticBankAccountId.set(previousBankAccountId ?? undefined);
      this.safeSetSignal(this.error, 'Failed to update bank account');
      console.error('Error updating bank account:', err);
    } finally {
      this.safeSetSignal(this.savingBankAccount, false);
    }
  }

  async onPayeeChange(change: PayeeChangeEvent) {
    const currentTransaction = this.transaction();
    if (!currentTransaction || this.isFormDisabled()) {
      return;
    }

    const isCurrentlyTransfer = currentTransaction.type === 'transfer';
    const isCurrentlySystem =
      currentTransaction.type === 'starting_balance' || currentTransaction.type === 'balance_adjustment';

    // Scenario 1: Transfer -> Different Bank Account (Update Transfer)
    if (isCurrentlyTransfer && change.type === 'bankAccount' && change.id) {
      // Cannot transfer to the same account - ignore if user selects current bank account
      if (change.id === currentTransaction.bankAccountId) {
        return;
      }
      await this.updateTransferPairAccount(change.id);
      return;
    }

    // Scenario 2: Transfer -> Merchant (Convert from Transfer, then set merchant)
    if (isCurrentlyTransfer && change.type === 'merchant') {
      await this.convertTransferToMerchant(change);
      return;
    }

    // Scenario 3: Regular -> Bank Account (Convert to Transfer)
    if (!isCurrentlyTransfer && !isCurrentlySystem && change.type === 'bankAccount' && change.id) {
      // Cannot transfer to the same account - ignore if user selects current bank account
      if (change.id === currentTransaction.bankAccountId) {
        return;
      }
      await this.convertToTransfer(change.id);
      return;
    }

    // Scenario 4: Regular -> Different Merchant (Update Merchant)
    if (!isCurrentlyTransfer && !isCurrentlySystem && change.type === 'merchant') {
      await this.onMerchantChangeInternal(change);
      return;
    }

    // Scenario 5: Any type -> System (Convert to system transaction type)
    if (change.type === 'system' && change.systemPayeeType) {
      await this.convertToSystemType(change.systemPayeeType);
      return;
    }

    // Scenario 6: System -> Merchant (Convert to regular, then set merchant)
    if (isCurrentlySystem && change.type === 'merchant') {
      await this.convertSystemToMerchant(change);
      return;
    }

    // Scenario 7: System -> Bank Account (Convert to regular, then to transfer)
    if (isCurrentlySystem && change.type === 'bankAccount' && change.id) {
      await this.convertSystemToTransfer(change.id);
      return;
    }
  }

  private async convertToTransfer(toAccountId: string) {
    const currentTransaction = this.transaction();
    if (!currentTransaction) {
      return;
    }

    // Prevent concurrent calls
    if (this.savingMerchant()) {
      return;
    }

    // Clear merchant optimistic state since we're converting to transfer
    this.optimisticMerchantId.set(undefined);
    this.pendingMerchantName.set(null);

    // Set optimistic state for immediate UI feedback
    this.optimisticIsTransfer.set(true);
    this.optimisticTransferPairBankAccountId.set(toAccountId);

    this.safeSetSignal(this.savingMerchant, true);
    this.safeSetSignal(this.error, null);

    try {
      const result = await this.transactionConvexService.convertToTransfer(
        currentTransaction._id,
        toAccountId as Id<'bankAccount'>
      );

      if (result.success) {
        // Refresh the transaction from the server to get the updated state
        // This ensures all computed properties (isTransfer, category visibility, etc.) update correctly
        const updatedTransaction = await this.transactionConvexService.fetchTransactionById(currentTransaction._id);
        if (updatedTransaction) {
          this.transactionPageService.setTransaction(updatedTransaction);
        }

        // Clear optimistic state after successful update
        this.optimisticIsTransfer.set(undefined);
        this.optimisticTransferPairBankAccountId.set(undefined);
      }
    } catch (err: unknown) {
      // Clear optimistic state on error
      this.optimisticIsTransfer.set(undefined);
      this.optimisticTransferPairBankAccountId.set(undefined);
      this.safeSetSignal(this.error, 'Failed to convert to transfer');
      console.error('Error converting to transfer:', err);
    } finally {
      this.safeSetSignal(this.savingMerchant, false);
    }
  }

  /**
   * Scenario 1: Update a transfer's paired bank account
   * When user selects a different bank account for an existing transfer
   */
  private async updateTransferPairAccount(newAccountId: string) {
    const currentTransaction = this.transaction();
    if (!currentTransaction) {
      return;
    }

    // Prevent concurrent calls
    if (this.savingMerchant()) {
      return;
    }

    // Store previous value for potential revert
    const previousTransferPairBankAccountId = this.transferPairBankAccountId();

    // Optimistic update - update UI immediately
    this.optimisticTransferPairBankAccountId.set(newAccountId);

    this.safeSetSignal(this.savingMerchant, true);
    this.safeSetSignal(this.error, null);

    try {
      // Determine if this transaction is the "from" or "to" side of the transfer
      // by checking if amount is negative (from) or positive (to)
      const transactionAmount = Number(currentTransaction.amount);
      const isFromSide = transactionAmount < 0;

      // Update the paired transaction's bank account
      // If we're the "from" side (outflow), the payee is the "to" account -> update toAccountId
      // If we're the "to" side (inflow), the payee is the "from" account -> update fromAccountId
      await this.transactionConvexService.updateTransfer(
        currentTransaction._id,
        isFromSide
          ? { toAccountId: newAccountId as Id<'bankAccount'> }
          : { fromAccountId: newAccountId as Id<'bankAccount'> }
      );

      // Refresh the transaction from the server to get the updated state
      // This ensures all computed properties update correctly
      const updatedTransaction = await this.transactionConvexService.fetchTransactionById(currentTransaction._id);
      if (updatedTransaction) {
        this.transactionPageService.setTransaction(updatedTransaction);
      }

      // Clear optimistic state now that we've updated the transaction locally
      this.optimisticTransferPairBankAccountId.set(undefined);
    } catch (err: unknown) {
      // Revert optimistic update on error
      this.optimisticTransferPairBankAccountId.set(previousTransferPairBankAccountId ?? undefined);
      this.safeSetSignal(this.error, 'Failed to update transfer');
      console.error('Error updating transfer:', err);
    } finally {
      this.safeSetSignal(this.savingMerchant, false);
    }
  }

  /**
   * Scenario 2: Convert a transfer back to a regular transaction with a merchant
   * When user selects a merchant for an existing transfer
   */
  private async convertTransferToMerchant(change: { id: string | null; pendingName?: string }) {
    const currentTransaction = this.transaction();
    if (!currentTransaction) {
      return;
    }

    // Prevent concurrent calls
    if (this.savingMerchant()) {
      return;
    }

    // Capture previous transfer state for undo
    const previousToAccountId = currentTransaction.transferPairBankAccountId;

    // Clear transfer pair optimistic state since we're converting to regular transaction
    this.optimisticTransferPairBankAccountId.set(undefined);

    // Set optimistic state for immediate UI feedback - no longer a transfer
    this.optimisticIsTransfer.set(false);

    // Optimistic update - show merchant name/logo immediately
    if (change.pendingName) {
      this.pendingMerchantName.set(change.pendingName);
      this.optimisticMerchantId.set(null);
    } else {
      this.pendingMerchantName.set(null);
      this.optimisticMerchantId.set(change.id);
    }

    this.safeSetSignal(this.savingMerchant, true);
    this.safeSetSignal(this.error, null);

    try {
      // Step 1: Convert from transfer to regular transaction (silent - no individual undo)
      // The transaction keeps its current bank account and amount
      const transactionAmount = Number(currentTransaction.amount);
      const movements = [{ amount: BigInt(transactionAmount) }];
      await this.transactionConvexService.convertFromTransfer(currentTransaction._id, movements, { silent: true });

      // Step 2: Refresh the transaction from the server to get the updated state
      // This ensures all computed properties (isTransfer, category selector visibility, etc.) update correctly
      const updatedTransaction = await this.transactionConvexService.fetchTransactionById(currentTransaction._id);
      if (updatedTransaction) {
        this.transactionPageService.setTransaction(updatedTransaction);
      }

      // Step 3: Set the merchant on the now-regular transaction (silent - no individual undo)
      // Clear savingMerchant so onMerchantChangeInternal can set it
      this.safeSetSignal(this.savingMerchant, false);
      await this.onMerchantChangeInternal(change, true);

      // Push one combined undo action for both steps
      // The completedVersion effect will refresh the details page after undo/redo
      if (previousToAccountId) {
        this.undoRedoService.pushAction({
          description: 'Converted transfer to merchant',
          type: 'convert-transfer-to-merchant',
          timestamp: Date.now(),
          undo: async () => {
            await this.transactionConvexService.convertToTransfer(currentTransaction._id, previousToAccountId, {
              silent: true,
            });
          },
          redo: async () => {
            await this.transactionConvexService.convertFromTransfer(currentTransaction._id, movements, {
              silent: true,
            });
            await this.transactionConvexService.updateTransaction(
              currentTransaction._id,
              { merchantId: change.id ? (change.id as Id<'merchant'>) : null },
              undefined,
              { silent: true }
            );
          },
        });
      }

      // Clear optimistic type state after successful conversion
      this.optimisticIsTransfer.set(undefined);
    } catch (err: unknown) {
      // Revert optimistic state on error
      this.optimisticIsTransfer.set(undefined);
      this.optimisticMerchantId.set(undefined);
      this.pendingMerchantName.set(null);
      this.safeSetSignal(this.error, 'Failed to convert transfer');
      console.error('Error converting transfer to merchant:', err);
      this.safeSetSignal(this.savingMerchant, false);
    }
  }

  /**
   * Convert any transaction to a system type (starting_balance or balance_adjustment)
   */
  private async convertToSystemType(systemType: 'starting_balance' | 'balance_adjustment') {
    const currentTransaction = this.transaction();
    if (!currentTransaction) {
      return;
    }

    // Prevent concurrent calls
    if (this.savingMerchant()) {
      return;
    }

    // Clear optimistic states
    this.optimisticMerchantId.set(undefined);
    this.pendingMerchantName.set(null);
    this.optimisticIsTransfer.set(undefined);
    this.optimisticTransferPairBankAccountId.set(undefined);

    this.safeSetSignal(this.savingMerchant, true);
    this.safeSetSignal(this.error, null);

    try {
      // Use dedicated service methods for proper toast handling and backend logic
      if (systemType === 'starting_balance') {
        await this.transactionConvexService.convertToStartingBalance(currentTransaction._id);
      } else {
        await this.transactionConvexService.convertToBalanceAdjustment(currentTransaction._id);
      }

      // Refresh the transaction from the server to get the updated state
      const updatedTransaction = await this.transactionConvexService.fetchTransactionById(currentTransaction._id);
      if (updatedTransaction) {
        this.transactionPageService.setTransaction(updatedTransaction);
      }
    } catch (err: unknown) {
      this.safeSetSignal(this.error, 'Failed to update transaction type');
      console.error('Error converting to system type:', err);
    } finally {
      this.safeSetSignal(this.savingMerchant, false);
    }
  }

  /**
   * Convert system transaction to regular with merchant
   */
  private async convertSystemToMerchant(change: { id: string | null; pendingName?: string }) {
    const currentTransaction = this.transaction();
    if (!currentTransaction) {
      return;
    }

    // Prevent concurrent calls
    if (this.savingMerchant()) {
      return;
    }

    // Set optimistic state for merchant
    if (change.pendingName) {
      this.pendingMerchantName.set(change.pendingName);
      this.optimisticMerchantId.set(null);
    } else {
      this.pendingMerchantName.set(null);
      this.optimisticMerchantId.set(change.id ?? undefined);
    }

    this.safeSetSignal(this.savingMerchant, true);
    this.safeSetSignal(this.error, null);

    try {
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        throw new Error('Workspace ID not found');
      }

      // Step 1: Convert to regular transaction
      await this.convexService.mutation(api.transactions.updateTransaction, {
        workspaceId,
        transactionId: currentTransaction._id,
        type: 'regular',
        preserveReviewStatus: true,
      });

      // Step 2: Refresh transaction
      const updatedTransaction = await this.transactionConvexService.fetchTransactionById(currentTransaction._id);
      if (updatedTransaction) {
        this.transactionPageService.setTransaction(updatedTransaction);
      }

      // Step 3: Set merchant
      this.safeSetSignal(this.savingMerchant, false);
      await this.onMerchantChangeInternal(change);

      // Clear optimistic state
      this.optimisticMerchantId.set(undefined);
      this.pendingMerchantName.set(null);
    } catch (err: unknown) {
      // Clear optimistic state on error
      this.optimisticMerchantId.set(undefined);
      this.pendingMerchantName.set(null);
      this.safeSetSignal(this.error, 'Failed to convert transaction');
      console.error('Error converting system to merchant:', err);
      this.safeSetSignal(this.savingMerchant, false);
    }
  }

  /**
   * Convert system transaction to transfer
   */
  private async convertSystemToTransfer(toAccountId: string) {
    const currentTransaction = this.transaction();
    if (!currentTransaction) {
      return;
    }

    // Prevent concurrent calls
    if (this.savingMerchant()) {
      return;
    }

    // Set optimistic state
    this.optimisticIsTransfer.set(true);
    this.optimisticTransferPairBankAccountId.set(toAccountId);

    this.safeSetSignal(this.savingMerchant, true);
    this.safeSetSignal(this.error, null);

    try {
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        throw new Error('Workspace ID not found');
      }

      // Step 1: Convert to regular transaction
      await this.convexService.mutation(api.transactions.updateTransaction, {
        workspaceId,
        transactionId: currentTransaction._id,
        type: 'regular',
        preserveReviewStatus: true,
      });

      // Step 2: Convert to transfer
      const result = await this.transactionConvexService.convertToTransfer(
        currentTransaction._id,
        toAccountId as Id<'bankAccount'>
      );

      if (result.success) {
        // Refresh the transaction from the server
        const updatedTransaction = await this.transactionConvexService.fetchTransactionById(currentTransaction._id);
        if (updatedTransaction) {
          this.transactionPageService.setTransaction(updatedTransaction);
        }

        // Clear optimistic state
        this.optimisticIsTransfer.set(undefined);
        this.optimisticTransferPairBankAccountId.set(undefined);
      }
    } catch (err: unknown) {
      // Clear optimistic state on error
      this.optimisticIsTransfer.set(undefined);
      this.optimisticTransferPairBankAccountId.set(undefined);
      this.safeSetSignal(this.error, 'Failed to convert transaction');
      console.error('Error converting system to transfer:', err);
    } finally {
      this.safeSetSignal(this.savingMerchant, false);
    }
  }

  private async onMerchantChangeInternal(change: { id: string | null; pendingName?: string }, silent = false) {
    const currentTransaction = this.transaction();
    if (!currentTransaction) {
      return;
    }

    // Prevent concurrent calls
    if (this.savingMerchant()) {
      return;
    }

    // Store previous merchant ID for potential revert
    const previousMerchantId = currentTransaction.merchantId;

    // Normalize current merchant ID for comparison
    const normalizedCurrentMerchantId = currentTransaction.merchantId ?? null;
    const newMerchantId = change.id ?? null;

    // If merchant ID is the same, do nothing
    if (normalizedCurrentMerchantId === newMerchantId && !change.pendingName) {
      return;
    }

    // Optimistic update - update UI immediately
    // If creating a new merchant, show pending name immediately
    if (change.pendingName) {
      this.pendingMerchantName.set(change.pendingName);
      // Set optimistic merchant ID to null temporarily (will be updated after merchant creation)
      this.optimisticMerchantId.set(null);
    } else {
      // Clear pending name if selecting existing merchant or null
      this.pendingMerchantName.set(null);
      // Optimistically update to the selected merchant ID
      this.optimisticMerchantId.set(newMerchantId);
    }

    this.safeSetSignal(this.savingMerchant, true);
    this.safeSetSignal(this.error, null);

    try {
      let merchantId: string | null = change.id;
      let merchant = merchantId ? (this.merchants().find((m) => m._id === merchantId) ?? null) : null;

      // If a new merchant needs to be created
      if (change.pendingName) {
        const newMerchant = await this.merchantService.findOrCreateMerchant(change.pendingName);
        merchantId = newMerchant._id;
        merchant = newMerchant;
        // Update optimistic state with the newly created merchant ID
        this.optimisticMerchantId.set(merchantId);
      }

      // Normalize merchant ID to undefined for null (to match Convex's representation)
      const normalizedMerchantId = merchantId ?? undefined;

      // Send null explicitly to clear the merchant, not undefined
      const merchantUpdate = {
        merchantId: normalizedMerchantId ? (normalizedMerchantId as Id<'merchant'>) : null,
      };

      if (silent) {
        await this.transactionConvexService.updateTransaction(currentTransaction._id, merchantUpdate, undefined, {
          silent: true,
        });
      } else {
        await this.transactionConvexService.updateTransaction(currentTransaction._id, merchantUpdate);
      }

      // Update the local state after successful save
      // When setting to null, also clear merchantName and merchantLogo
      const merchantName: string | null =
        merchant?.name ??
        currentTransaction.importDetails?.merchantName ??
        currentTransaction.importDetails?.originalStatement ??
        null;

      this.updateTransactionLocally(currentTransaction, {
        merchantId: normalizedMerchantId as Id<'merchant'> | undefined,
        merchant,
        merchantName,
        merchantLogo: merchant?.logoUrl ?? null,
      });
      await this.refreshPlannedLink(currentTransaction);

      // Clear optimistic state now that we've updated the transaction locally
      this.optimisticMerchantId.set(undefined);
      // Clear pending name after transaction is updated with new merchant ID
      this.pendingMerchantName.set(null);
    } catch (err: unknown) {
      // Revert optimistic update on error
      this.optimisticMerchantId.set(previousMerchantId ?? undefined);
      this.safeSetSignal(this.error, 'Failed to update merchant');
      console.error('Error updating merchant:', err);
      // Clear pending name on error
      this.pendingMerchantName.set(null);
    } finally {
      this.safeSetSignal(this.savingMerchant, false);
    }
  }

  private async saveTransactionAmount() {
    const currentTransaction = this.transaction();

    if (!currentTransaction) {
      return;
    }

    // Get the amount value from edit signal (already in base units)
    const amountInCents = this.transactionAmountEdit();
    const previousAmount = currentTransaction.amount;

    // Validate that amount is not null, undefined, or 0
    if (amountInCents == null || amountInCents === 0) {
      this.safeSetSignal(this.amountError, 'Amount cannot be empty or zero');
      // Revert to original value
      this.safeSetSignal(this.transactionAmountEdit, Number(previousAmount));
      return;
    }

    this.safeSetSignal(this.saving, true);
    this.safeSetSignal(this.amountError, null);

    try {
      await this.transactionConvexService.updateTransaction(currentTransaction._id, {
        amount: BigInt(amountInCents),
      });

      // Update the local state after successful save
      this.updateTransactionLocally(currentTransaction, {
        amount: BigInt(amountInCents),
      });
      await this.refreshPlannedLink(currentTransaction);
      this.transactionPageService.setTransactionAmountEdit(amountInCents);
    } catch (err: unknown) {
      this.safeSetSignal(this.amountError, 'Failed to save transaction amount');
      console.error('Error updating transaction:', err);
      // Revert on error
      this.safeSetSignal(this.transactionAmountEdit, Number(previousAmount));
    } finally {
      this.safeSetSignal(this.saving, false);
    }
  }

  private async saveTransactionNotes() {
    const currentTransaction = this.transaction();
    const newDescription = this.transactionNotes().trim();

    if (!currentTransaction) {
      return;
    }

    const previousNotes = currentTransaction.notes;

    this.safeSetSignal(this.saving, true);
    this.safeSetSignal(this.error, null);

    try {
      await this.transactionConvexService.updateTransaction(currentTransaction._id, {
        notes: newDescription.length > 0 ? newDescription : null,
      });

      // Update the local state after successful save
      this.updateTransactionLocally(currentTransaction, {
        notes: newDescription.length > 0 ? newDescription : undefined,
      });
    } catch (err: unknown) {
      this.safeSetSignal(this.error, 'Failed to save transaction description');
      console.error('Error updating transaction:', err);
      // Revert on error
      this.safeSetSignal(this.transactionNotes, previousNotes ?? '');
      this.updateEditorContent(previousNotes ?? '');
    } finally {
      this.safeSetSignal(this.saving, false);
    }
  }

  async selectDate(newDate: Date) {
    // Format date as YYYY-MM-DD in local timezone
    const year = newDate.getFullYear();
    const month = String(newDate.getMonth() + 1).padStart(2, '0');
    const day = String(newDate.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;

    const currentTransaction = this.transaction();
    if (!currentTransaction || this.isFormDisabled() || currentTransaction.date === dateString) {
      return;
    }

    // Prevent concurrent calls
    if (this.savingDate()) {
      return;
    }

    // Store previous date for potential revert
    const previousDateString = currentTransaction.date;
    const [prevYear, prevMonth, prevDay] = previousDateString.split('-').map(Number);
    const previousDate = new Date(prevYear, prevMonth - 1, prevDay);

    // Optimistic update - update UI immediately
    this.optimisticDate.set(newDate);
    this.safeSetSignal(this.savingDate, true);
    this.safeSetSignal(this.dateError, null);

    try {
      const result = await this.transactionConvexService.updateTransactionSchedule(currentTransaction._id, {
        date: dateString,
      });

      if (!result?.success) {
        throw new Error('Failed to update date');
      }

      if (result.convertedToScheduled && result.scheduledTransactionId) {
        this.navigateToPlannedTransaction(result.scheduledTransactionId);
        return;
      }

      // Update the local state after successful save
      this.updateTransactionLocally(currentTransaction, {
        date: dateString,
      });
      await this.refreshPlannedLink(currentTransaction);

      // Clear optimistic state now that we've updated the transaction locally
      this.optimisticDate.set(undefined);
    } catch (err: unknown) {
      // Revert optimistic update on error
      this.optimisticDate.set(previousDate);
      this.safeSetSignal(this.dateError, 'Failed to update date');
      console.error('Error updating date:', err);
    } finally {
      this.safeSetSignal(this.savingDate, false);
    }
  }

  makeRecurring() {
    const currentTransaction = this.transaction();
    if (!currentTransaction || this.isFormDisabled() || !this.canScheduleTransaction()) {
      return;
    }
    this.transactionConvexService.openMakeRecurringDialog(currentTransaction);
  }

  async togglePending() {
    const currentTransaction = this.transaction();
    if (!currentTransaction) {
      return;
    }

    // Prevent concurrent calls
    if (this.savingPending()) {
      return;
    }

    // Toggle between 'pending' and 'cleared'
    const previousStatus = currentTransaction.status;
    const newStatus = previousStatus === 'pending' ? 'cleared' : 'pending';

    this.safeSetSignal(this.savingPending, true);
    this.safeSetSignal(this.error, null);

    try {
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        throw new Error('Workspace ID not found');
      }

      const mutationPromise = (async () => {
        await this.convexService.mutation(api.transactions.updateTransaction, {
          workspaceId: workspaceId as Id<'workspace'>,
          transactionId: currentTransaction._id,
          status: newStatus,
          preserveReviewStatus: true,
        });

        // Update the local state after successful save
        this.transactionPageService.setTransaction({
          ...currentTransaction,
          status: newStatus,
        });
      })();

      toast.promise(mutationPromise, {
        loading: 'Updating status...',
        success: newStatus === 'pending' ? 'Marked as pending' : 'Marked as cleared',
        error: 'Failed to update status',
      });

      await mutationPromise;

      // Push undo action after success
      const transactionId = currentTransaction._id;
      const setStatus = async (status: 'pending' | 'cleared') => {
        const wsId = this.workspaceService.workspaceId();
        if (!wsId) return;
        await this.convexService.mutation(api.transactions.updateTransaction, {
          workspaceId: wsId as Id<'workspace'>,
          transactionId,
          status,
          preserveReviewStatus: true,
        });
      };
      this.undoRedoService.pushAction({
        description: newStatus === 'pending' ? 'Marked as pending' : 'Marked as cleared',
        type: 'toggle-status',
        timestamp: Date.now(),
        undo: async () => {
          await setStatus(previousStatus as 'pending' | 'cleared');
        },
        redo: async () => {
          await setStatus(newStatus);
        },
      });
    } catch (err: unknown) {
      this.safeSetSignal(this.error, 'Failed to update status');
      console.error('Error updating status:', err);
    } finally {
      this.safeSetSignal(this.savingPending, false);
    }
  }

  async unReconcile() {
    const currentTransaction = this.transaction();
    if (!currentTransaction) {
      return;
    }

    // Prevent concurrent calls
    if (this.savingPending()) {
      return;
    }

    const previousStatus = currentTransaction.status;

    this.safeSetSignal(this.savingPending, true);
    this.safeSetSignal(this.error, null);

    try {
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        throw new Error('Workspace ID not found');
      }

      const mutationPromise = (async () => {
        await this.convexService.mutation(api.transactions.updateTransaction, {
          workspaceId: workspaceId as Id<'workspace'>,
          transactionId: currentTransaction._id,
          status: 'cleared',
          preserveReviewStatus: true,
        });

        // Update the local state after successful save
        this.transactionPageService.setTransaction({
          ...currentTransaction,
          status: 'cleared',
        });
      })();

      toast.promise(mutationPromise, {
        loading: 'Un-reconciling transaction...',
        success: 'Transaction un-reconciled',
        error: 'Failed to un-reconcile',
      });

      await mutationPromise;

      // Push undo action after success
      const transactionId = currentTransaction._id;
      const setStatus = async (status: string) => {
        const wsId = this.workspaceService.workspaceId();
        if (!wsId) return;
        await this.convexService.mutation(api.transactions.updateTransaction, {
          workspaceId: wsId as Id<'workspace'>,
          transactionId,
          status,
          preserveReviewStatus: true,
        });
      };
      this.undoRedoService.pushAction({
        description: 'Transaction un-reconciled',
        type: 'un-reconcile',
        timestamp: Date.now(),
        undo: async () => {
          await setStatus(previousStatus);
        },
        redo: async () => {
          await setStatus('cleared');
        },
      });
    } catch (err: unknown) {
      this.safeSetSignal(this.error, 'Failed to un-reconcile transaction');
      console.error('Error un-reconciling transaction:', err);
    } finally {
      this.safeSetSignal(this.savingPending, false);
    }
  }

  navigateToPlannedTransaction(scheduledTransactionId: string): void {
    void this.navigationService.navigateToPlannedTransaction(scheduledTransactionId);
  }

  getTransactionsLink(): string {
    const workspaceShortId = this.workspaceService.workspaceShortId();
    return workspaceShortId ? `/${workspaceShortId}/transactions` : '/';
  }

  getMerchantSlug(merchantName: string, merchantId: string): string {
    const namePart = merchantName
      .slice(0, 24)
      .replace(/[\s/\\]+/g, '-')
      .replace(/[^a-zA-Z0-9-]/g, '')
      .toLowerCase();
    const idPart = merchantId.slice(-8);
    return `${namePart}-${idPart}`;
  }

  getMerchantRoute(merchantId: string): string | null {
    const merchant = this.merchants().find((m) => m._id === merchantId);
    if (!merchant) return null;

    const workspaceShortId = this.workspaceService.workspaceShortId();
    if (!workspaceShortId) return null;

    const slug = this.getMerchantSlug(merchant.name, merchant._id);
    return `/${workspaceShortId}/settings/merchants/${slug}/details`;
  }

  navigateToMerchant(merchantId: string): void {
    const route = this.getMerchantRoute(merchantId);
    if (route) {
      void this.router.navigate([route]);
    }
  }

  // Split mode handlers
  handleEnterSplitMode() {
    const transaction = this.transaction();
    if (!transaction || this.isFormDisabled()) return;

    // Initialize splits from existing movements if they exist and have multiple movements
    let splits: Split[];
    if (transaction.movements && transaction.movements.length > 1) {
      splits = transaction.movements.map((movement) => ({
        categoryId: movement.categoryId,
        readyToAssign: movement.readyToAssign,
        amount: movement.amount,
      }));
    } else {
      // Create a single empty split row with preselected category if one exists
      const firstMovement = transaction.movements?.[0];
      const initialSplit: Split = {};

      if (firstMovement?.categoryId) {
        initialSplit.categoryId = firstMovement.categoryId;
      }
      if (firstMovement?.readyToAssign) {
        initialSplit.readyToAssign = firstMovement.readyToAssign;
      }
      // Amount remains empty (undefined)

      splits = [initialSplit];
    }

    // Store initial splits for change tracking (deep clone to handle BigInt)
    this.initialSplits.set(splits.map((split) => ({ ...split })));
    this.localSplits.set(splits);
    this.isSplitMode.set(true);
  }

  handleExitSplitMode() {
    this.isSplitMode.set(false);
    this.localSplits.set([]);
    this.initialSplits.set([]);
  }

  handleAddSplit(value: { categoryId: string | null; readyToAssign: boolean }) {
    this.localSplits.update((prev) => [
      ...prev,
      {
        categoryId: value.categoryId ? (value.categoryId as Id<'category'>) : undefined,
        readyToAssign: value.readyToAssign,
      },
    ]);
  }

  handleRemoveSplit(index: number) {
    this.localSplits.update((prev) => {
      // If this is the last split, reset it instead of removing it
      if (prev.length === 1) {
        return [{}];
      }
      // Otherwise, remove the split
      return prev.filter((_, i) => i !== index);
    });
  }

  handleUpdateSplitCategory(event: { index: number; categoryId: string | null; readyToAssign: boolean }) {
    this.localSplits.update((prev) =>
      prev.map((split, i) =>
        i === event.index
          ? {
              ...split,
              categoryId: event.categoryId ? (event.categoryId as Id<'category'>) : undefined,
              readyToAssign: event.readyToAssign,
            }
          : split
      )
    );
  }

  handleUpdateSplitAmount(event: { index: number; amount: bigint | undefined }) {
    this.localSplits.update((prev) =>
      prev.map((split, i) => (i === event.index ? { ...split, amount: event.amount } : split))
    );
  }

  private normalizeLocalSplitSigns(sign: 'inflow' | 'outflow' = this.amountSign()): void {
    const multiplier = sign === 'outflow' ? -1n : 1n;
    this.localSplits.update((prev) =>
      prev.map((split) => {
        if (split.amount === undefined) {
          return split;
        }

        const absoluteAmount = split.amount < 0n ? -split.amount : split.amount;
        return { ...split, amount: absoluteAmount * multiplier };
      })
    );
  }

  private canSaveLocalSplits(): boolean {
    const splits = this.localSplits();
    if (splits.length === 0) {
      return false;
    }

    if (splits.some((split) => split.amount === undefined || split.amount === 0n)) {
      return false;
    }

    const splitsSum = splits.reduce((sum, split) => sum + (split.amount ?? 0n), 0n);
    return splitsSum === BigInt(this.transactionAmountEdit());
  }

  async handleSaveSplits() {
    const transaction = this.transaction();
    const workspaceId = this.workspaceService.workspaceId();
    if (!transaction || !workspaceId) {
      return;
    }

    const splits = this.localSplits();

    // Validate splits
    const splitsSum = splits.reduce((sum, split) => sum + (split.amount ?? 0n), 0n);
    const currentAmount = BigInt(this.transactionAmountEdit());

    if (splits.some((split) => split.amount === undefined)) {
      console.error('All split amounts must be specified');
      return;
    }

    if (splitsSum !== currentAmount) {
      console.error('Splits must sum to transaction amount');
      return;
    }

    if (splits.some((split) => split.amount === 0n)) {
      console.error('Split amounts cannot be zero');
      return;
    }

    if (splits.length === 0) {
      console.error('Must have at least one split');
      return;
    }

    this.safeSetSignal(this.saving, true);
    this.safeSetSignal(this.error, null);

    try {
      // Convert splits to movements format
      const movements = splits.map((split, index) => {
        const originalMovement = transaction.movements?.[index];
        return {
          amount: split.amount,
          categoryId: split.categoryId,
          readyToAssign: split.readyToAssign,
          notes: originalMovement?.notes,
        };
      });

      // Call Convex mutation directly with movements
      await this.convexService.mutation(api.transactions.updateTransaction, {
        workspaceId: workspaceId as Id<'workspace'>,
        transactionId: transaction._id,
        movements,
        preserveReviewStatus: true,
      });

      const updatedMovements: TransactionWithRelations['movements'] = movements.map((movement, index) => {
        const category = movement.categoryId
          ? (this.categories().find((c) => c._id === movement.categoryId) ?? null)
          : null;
        const originalMovement = transaction.movements[index] ?? transaction.movements[0];

        return {
          ...originalMovement,
          amount: movement.amount ?? 0n,
          categoryId: movement.categoryId,
          categoryName: category?.name,
          readyToAssign: movement.readyToAssign ?? false,
          notes: movement.notes,
          sortOrder: index,
          category,
        };
      });

      this.updateTransactionLocally(transaction, {
        amount: currentAmount,
        movements: updatedMovements,
      });
      await this.refreshPlannedLink(transaction);

      // If only one split, exit split mode (it's effectively a regular transaction)
      if (movements.length === 1) {
        this.handleExitSplitMode();
        toast.success('Transaction updated');
      } else {
        // Sync local splits with saved movements to keep split mode active
        const updatedSplits: Split[] = updatedMovements.map((movement) => ({
          categoryId: movement.categoryId,
          readyToAssign: movement.readyToAssign,
          amount: movement.amount,
        }));
        // Update initial splits to the saved state so changes are tracked from this point (deep clone to handle BigInt)
        this.initialSplits.set(updatedSplits.map((split) => ({ ...split })));
        this.localSplits.set(updatedSplits);
        toast.success('Split transaction updated');
      }
    } catch (err: unknown) {
      this.safeSetSignal(this.error, 'Failed to save splits');
      console.error('Failed to save splits:', err);
    } finally {
      this.safeSetSignal(this.saving, false);
    }
  }

  handleCancelSplits() {
    this.handleExitSplitMode();
  }

  async approveTransaction() {
    const currentTransaction = this.transaction();
    if (!currentTransaction) {
      return;
    }

    // Prevent concurrent calls
    if (this.savingReviewStatus()) {
      return;
    }

    this.safeSetSignal(this.savingReviewStatus, true);
    this.safeSetSignal(this.error, null);

    try {
      const success = await this.transactionConvexService.updateReviewStatus(currentTransaction._id, 'approve');

      if (success) {
        // Update the local state after successful save
        this.transactionPageService.setTransaction({
          ...currentTransaction,
          reviewStatus: 'reviewed',
        });
      }
    } catch (err: unknown) {
      this.safeSetSignal(this.error, 'Failed to approve transaction');
      console.error('Error approving transaction:', err);
    } finally {
      this.safeSetSignal(this.savingReviewStatus, false);
    }
  }

  async rejectTransaction() {
    const currentTransaction = this.transaction();
    if (!currentTransaction) {
      return;
    }

    // Prevent concurrent calls
    if (this.savingReviewStatus()) {
      return;
    }

    this.safeSetSignal(this.savingReviewStatus, true);
    this.safeSetSignal(this.error, null);

    try {
      const success = await this.transactionConvexService.updateReviewStatus(currentTransaction._id, 'reject');

      if (success) {
        void this.navigationService.navigateToTransactions();
      }
    } catch (err: unknown) {
      this.safeSetSignal(this.error, 'Failed to reject transaction');
      console.error('Error rejecting transaction:', err);
    } finally {
      this.safeSetSignal(this.savingReviewStatus, false);
    }
  }

  async restoreTransaction() {
    const currentTransaction = this.transaction();
    if (!currentTransaction || !this.isDeleted()) {
      return;
    }

    // Prevent concurrent calls
    if (this.savingRestore()) {
      return;
    }

    this.safeSetSignal(this.savingRestore, true);
    this.safeSetSignal(this.error, null);

    try {
      const mutationPromise = (async () => {
        const success = await this.transactionConvexService.restoreTransaction(currentTransaction._id);

        if (success) {
          // Update local state optimistically
          this.transactionPageService.setTransaction({
            ...currentTransaction,
            isDeleted: false,
            deletedAt: undefined,
          });
        } else {
          throw new Error('Restore operation failed');
        }
      })();

      toast.promise(mutationPromise, {
        loading: 'Restoring transaction...',
        success: 'Transaction restored successfully',
        error: 'Failed to restore transaction',
      });

      await mutationPromise;
    } catch (err: unknown) {
      this.safeSetSignal(this.error, 'Failed to restore transaction');
      console.error('Error restoring transaction:', err);
    } finally {
      this.safeSetSignal(this.savingRestore, false);
    }
  }

  // Link comparison dialog methods
  openLinkComparisonDialog(): void {
    this.showLinkComparisonDialog.set(true);
  }

  closeLinkComparisonDialog(): void {
    this.showLinkComparisonDialog.set(false);
  }

  async onLinkApproved(): Promise<void> {
    this.closeLinkComparisonDialog();
    await this.refreshLinkedTransaction();
  }

  async onLinkUnlinked(): Promise<void> {
    this.closeLinkComparisonDialog();
    await this.refreshLinkedTransaction();
  }

  private async refreshLinkedTransaction(): Promise<void> {
    const transactionId = this.transaction()?._id;
    if (!transactionId) return;
    const refreshed = await this.transactionConvexService.fetchTransactionById(transactionId);
    if (refreshed && this.transaction()?._id === transactionId) {
      this.transactionPageService.setTransaction(refreshed);
    }
  }

  async confirmLinkDirectly(): Promise<void> {
    const currentTransaction = this.transaction();
    if (!currentTransaction || this.savingLinkApproval()) return;

    this.savingLinkApproval.set(true);
    try {
      const success = await this.transactionConvexService.approveTransactionLink(currentTransaction._id);
      if (success) {
        await this.refreshLinkedTransaction();
      }
    } catch (err: unknown) {
      console.error('Error confirming link:', err);
    } finally {
      this.savingLinkApproval.set(false);
    }
  }

  async unlinkDirectly(): Promise<void> {
    const currentTransaction = this.transaction();
    if (!currentTransaction || this.savingLinkApproval()) return;

    this.savingLinkApproval.set(true);
    try {
      const success = await this.transactionConvexService.unlinkTransaction(currentTransaction._id);
      if (success) await this.refreshLinkedTransaction();
    } catch (err: unknown) {
      console.error('Error unlinking transaction:', err);
    } finally {
      this.savingLinkApproval.set(false);
    }
  }

  // ============================================================================
  // TRANSFER SUGGESTION METHODS
  // ============================================================================

  async onTransferApproved(expectedTransactionId?: Id<'transaction'>): Promise<void> {
    const currentTransaction = this.transaction();
    if (!currentTransaction || (expectedTransactionId && currentTransaction._id !== expectedTransactionId)) {
      return;
    }

    const refreshedTransaction = await this.transactionConvexService.fetchTransactionById(currentTransaction._id);
    if (this.transaction()?._id !== currentTransaction._id) {
      return;
    }

    this.transactionPageService.setTransaction(
      refreshedTransaction ?? {
        ...currentTransaction,
        type: 'transfer' as const,
        reviewStatus: 'reviewed',
        suggestedTransfer: currentTransaction.suggestedTransfer
          ? { ...currentTransaction.suggestedTransfer, status: 'approved' as const }
          : undefined,
      }
    );
  }

  onTransferRejected(expectedTransactionId?: Id<'transaction'>): void {
    const currentTransaction = this.transaction();
    if (currentTransaction && (!expectedTransactionId || currentTransaction._id === expectedTransactionId)) {
      this.transactionPageService.setTransaction({
        ...currentTransaction,
        suggestedTransfer: currentTransaction.suggestedTransfer
          ? { ...currentTransaction.suggestedTransfer, status: 'rejected' as const }
          : undefined,
      });
    }
  }

  async rejectTransferSuggestionDirectly(): Promise<void> {
    const currentTransaction = this.transaction();
    if (!currentTransaction || this.savingTransferApproval()) return;

    this.safeSetSignal(this.savingTransferApproval, true);
    this.safeSetSignal(this.error, null);

    try {
      const success = await this.transactionConvexService.rejectTransferSuggestion(currentTransaction._id);
      if (success) {
        this.onTransferRejected(currentTransaction._id);
      } else if (this.transaction()?._id === currentTransaction._id) {
        this.safeSetSignal(this.error, 'Failed to reject transfer suggestion');
      }
    } catch (err: unknown) {
      if (this.transaction()?._id === currentTransaction._id) {
        this.safeSetSignal(this.error, 'Failed to reject transfer suggestion');
      }
      console.error('Error rejecting transfer suggestion:', err);
    } finally {
      this.safeSetSignal(this.savingTransferApproval, false);
    }
  }

  formatImportDate(dateStr: string | undefined | null): string {
    if (!dateStr) return '—';
    try {
      const [year, month, day] = dateStr.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return dateStr;
    }
  }

  // ============================================================================
  // PLANNED TRANSACTION LINKING METHODS
  // ============================================================================

  private async loadLinkedPlannedFallback(scheduledTransactionId: string): Promise<void> {
    const scheduled = await this.scheduledTransactionService.getScheduledTransactionById(
      scheduledTransactionId as Id<'scheduledTransaction'>
    );
    if (!this.isDestroyed && this.linkedScheduledTransactionId() === scheduledTransactionId) {
      this.linkedPlannedFallback.set(scheduled);
    }
  }

  async linkToPlannedTransaction(
    scheduledTransactionId: string,
    silent = false,
    occurrenceDate?: string
  ): Promise<void> {
    const currentTransaction = this.transaction();
    const workspaceId = this.workspaceService.workspaceId();

    if (!currentTransaction || !workspaceId) {
      return;
    }

    if (this.savingPlannedLink()) {
      return;
    }

    const previousScheduledTransactionId = currentTransaction.scheduledTransactionId ?? null;
    const previousOccurrenceDate = currentTransaction.scheduledOccurrenceDate;
    const selectedOccurrenceDate =
      occurrenceDate ??
      (previousScheduledTransactionId === scheduledTransactionId
        ? previousOccurrenceDate
        : this.scheduledTransactionService
            .scheduledTransactions()
            .find((planned) => planned._id === scheduledTransactionId)?.nextDate);
    const transactionId = currentTransaction._id;

    this.safeSetSignal(this.savingPlannedLink, true);
    this.safeSetSignal(this.error, null);

    try {
      await this.convexService.mutation(api.transactions.updateTransaction, {
        workspaceId: workspaceId as Id<'workspace'>,
        transactionId,
        linkedScheduledTransactionId: scheduledTransactionId as Id<'scheduledTransaction'>,
        ...(selectedOccurrenceDate && { linkedScheduledOccurrenceDate: selectedOccurrenceDate }),
        preserveReviewStatus: true,
      });

      const updatedTransaction = await this.transactionConvexService.fetchTransactionById(transactionId);
      if (updatedTransaction && this.transaction()?._id === transactionId) {
        this.transactionPageService.setTransaction(updatedTransaction);
      }

      if (!silent) {
        toast.success('Linked to planned transaction');

        const linkedOccurrenceDate = updatedTransaction?.scheduledOccurrenceDate ?? selectedOccurrenceDate;
        const setPlanned = async (id: string | null, dueDate?: string) => {
          const wsId = this.workspaceService.workspaceId();
          if (!wsId) return;
          await this.convexService.mutation(api.transactions.updateTransaction, {
            workspaceId: wsId as Id<'workspace'>,
            transactionId,
            linkedScheduledTransactionId: id ? (id as Id<'scheduledTransaction'>) : null,
            ...(id && dueDate && { linkedScheduledOccurrenceDate: dueDate }),
            preserveReviewStatus: true,
          });
        };
        this.undoRedoService.pushAction({
          description: 'Linked to planned transaction',
          type: 'link-planned',
          timestamp: Date.now(),
          undo: async () => {
            await setPlanned(previousScheduledTransactionId, previousOccurrenceDate);
          },
          redo: async () => {
            await setPlanned(scheduledTransactionId, linkedOccurrenceDate);
          },
        });
      }
    } catch (err: unknown) {
      console.error('Error linking to planned transaction:', err);
      this.safeSetSignal(this.error, 'Failed to link to planned transaction');
      toast.error('Failed to link to planned transaction');
    } finally {
      this.safeSetSignal(this.savingPlannedLink, false);
    }
  }

  async unlinkFromPlannedTransaction(): Promise<void> {
    const currentTransaction = this.transaction();
    const workspaceId = this.workspaceService.workspaceId();
    const scheduledTransactionId = this.linkedScheduledTransactionId();

    if (!currentTransaction || !workspaceId || !scheduledTransactionId) {
      return;
    }

    if (this.savingPlannedLink()) {
      return;
    }

    const transactionId = currentTransaction._id;
    const occurrenceDate = currentTransaction.scheduledOccurrenceDate;

    this.safeSetSignal(this.savingPlannedLink, true);
    this.safeSetSignal(this.error, null);

    try {
      await this.convexService.mutation(api.transactions.updateTransaction, {
        workspaceId: workspaceId as Id<'workspace'>,
        transactionId,
        linkedScheduledTransactionId: null,
        preserveReviewStatus: true,
      });

      const updatedTransaction = await this.transactionConvexService.fetchTransactionById(transactionId);
      if (updatedTransaction && this.transaction()?._id === transactionId) {
        this.transactionPageService.setTransaction(updatedTransaction);
      }

      const setPlanned = async (id: string | null) => {
        const wsId = this.workspaceService.workspaceId();
        if (!wsId) return;
        await this.convexService.mutation(api.transactions.updateTransaction, {
          workspaceId: wsId as Id<'workspace'>,
          transactionId,
          linkedScheduledTransactionId: id ? (id as Id<'scheduledTransaction'>) : null,
          ...(id && occurrenceDate && { linkedScheduledOccurrenceDate: occurrenceDate }),
          preserveReviewStatus: true,
        });
      };
      this.undoRedoService.pushAction({
        description: 'Unlinked from planned transaction',
        type: 'unlink-planned',
        timestamp: Date.now(),
        undo: async () => {
          await setPlanned(scheduledTransactionId);
        },
        redo: async () => {
          await setPlanned(null);
        },
      });

      toast.success('Unlinked from planned transaction');
    } catch (err: unknown) {
      console.error('Error unlinking from planned transaction:', err);
      this.safeSetSignal(this.error, 'Failed to unlink from planned transaction');
      toast.error('Failed to unlink from planned transaction');
    } finally {
      this.safeSetSignal(this.savingPlannedLink, false);
    }
  }

  onPlannedTransactionChange(selection: PlannedTransactionSelection): void {
    void this.linkToPlannedTransaction(selection.scheduledTransactionId, false, selection.occurrenceDate);
  }
}
