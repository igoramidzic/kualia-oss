import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { BrnPopover, BrnPopoverContent, BrnPopoverTrigger } from '@spartan-ng/brain/popover';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import { HlmPopoverContent } from '@spartan-ng/helm/popover';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import {
  nucleoTransfer as ArrowLeftRight,
  nucleoBadgeCheck as BadgeCheck,
  nucleoChevronRight as ChevronRight,
  nucleoCheckCircle as CircleCheck,
  nucleoHistory as ClockFading,
  nucleoInfo as Info,
  nucleoLink as Link,
  nucleoLock as Lock,
  NucleoIcon,
  nucleoTransactions as Receipt,
  nucleoTrash as Trash2,
  nucleoClose as X,
} from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { BankAccountService } from '../../services/bank-account.service';
import { ConvexService } from '../../services/convex.service';
import { CurrencyService } from '../../services/currency.service';
import { IconService } from '../../services/icon.service';
import { MerchantService } from '../../services/merchant.service';
import { NavigationService } from '../../services/navigation.service';
import { TransactionService, TransactionWithRelations } from '../../services/transaction.service';
import { UndoRedoService } from '../../services/undo-redo.service';
import { WorkspaceService } from '../../services/workspace.service';
import { DEFAULT_BANK_ACCOUNT_ICON_NAME, DEFAULT_MERCHANT_ICON_NAME } from '../../shared/utils/entity-identity';
import { dateToYearMonth } from '../../shared/utils/month.utils';
import { HlmContextMenuImports } from '../../ui/context-menu/src';
import { HlmDropdownMenuImports } from '../../ui/dropdown-menu/src';
import { EntityMarkComponent } from '../entity-mark/entity-mark.component';
import { BankAccountSelectorComponent } from '../transaction/bank-account-selector.component';
import { CategorySelectorComponent } from '../transaction/category-selector.component';
import { PayeeChangeEvent, PayeeSelectorComponent } from '../transaction/payee-selector.component';
import { TransactionDatePickerComponent } from '../transaction/transaction-date-picker.component';

@Component({
  selector: 'app-transaction-row',
  imports: [
    RouterLink,
    NucleoIcon,
    HlmCheckbox,
    HlmButton,
    BrnPopover,
    BrnPopoverTrigger,
    BrnPopoverContent,
    HlmPopoverContent,
    ...HlmContextMenuImports,
    ...HlmDropdownMenuImports,
    EntityMarkComponent,
    BankAccountSelectorComponent,
    CategorySelectorComponent,
    PayeeSelectorComponent,
    TransactionDatePickerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transaction-row.html',
})
export class TransactionRowComponent {
  protected readonly ArrowLeftRight = ArrowLeftRight;
  protected readonly ClockFading = ClockFading;
  protected readonly Receipt = Receipt;
  protected readonly Lock = Lock;
  protected readonly CircleCheck = CircleCheck;
  protected readonly Info = Info;
  protected readonly XIcon = X;
  protected readonly BadgeCheck = BadgeCheck;
  protected readonly ChevronRight = ChevronRight;
  protected readonly LinkIcon = Link;
  protected readonly Trash2 = Trash2;
  protected readonly defaultMerchantIconName = DEFAULT_MERCHANT_ICON_NAME;
  protected readonly defaultBankAccountIconName = DEFAULT_BANK_ACCOUNT_ICON_NAME;

  private readonly iconService = inject(IconService);
  private readonly navigationService = inject(NavigationService);
  private readonly transactionService = inject(TransactionService);
  private readonly currencyService = inject(CurrencyService);
  private readonly merchantService = inject(MerchantService);
  private readonly bankAccountService = inject(BankAccountService);
  private readonly router = inject(Router);
  private readonly convex = inject(ConvexService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly undoRedoService = inject(UndoRedoService);

  // Inputs
  readonly transaction = input.required<TransactionWithRelations>();
  readonly showBankAccountBadge = input<boolean>(true);
  readonly showNotes = input<boolean>(false);
  readonly isLast = input<boolean>(false);
  readonly isSelected = input<boolean>(false);

  // Outputs
  readonly checkboxChange = output<{ id: string; event: Event }>();

  // Optimistic update state for category
  private readonly _optimisticCategoryId = signal<string | null | undefined>(undefined);
  private readonly _optimisticReadyToAssign = signal<boolean | undefined>(undefined);
  readonly isSavingCategory = signal<boolean>(false);

  // Optimistic update state for merchant
  private readonly _optimisticMerchantId = signal<string | null | undefined>(undefined);
  private readonly _optimisticPendingMerchantName = signal<string | null | undefined>(undefined);
  private readonly _optimisticMerchantLogo = signal<string | null | undefined>(undefined);
  readonly isSavingMerchant = signal<boolean>(false);

  // Optimistic update state for transfer operations
  private readonly _optimisticIsTransfer = signal<boolean | undefined>(undefined);
  private readonly _optimisticTransferPairBankAccountId = signal<string | undefined>(undefined);

  // Review status popover state
  readonly reviewStatusPopoverState = signal<'open' | 'closed'>('closed');
  readonly isSavingReviewStatus = signal<boolean>(false);

  // Computed values that use optimistic state when available
  readonly displayCategoryId = computed(() => {
    const optimistic = this._optimisticCategoryId();
    if (optimistic !== undefined) {
      return optimistic;
    }
    return this.getCategoryId(this.transaction());
  });

  readonly displayIsReadyToAssign = computed(() => {
    const optimistic = this._optimisticReadyToAssign();
    if (optimistic !== undefined) {
      return optimistic;
    }
    return this.isReadyToAssign(this.transaction());
  });

  readonly displayMerchantId = computed(() => {
    const optimistic = this._optimisticMerchantId();
    if (optimistic !== undefined) {
      return optimistic;
    }
    return this.transaction().merchant?._id ?? null;
  });

  readonly displayPendingMerchantName = computed(() => {
    const optimistic = this._optimisticPendingMerchantName();
    if (optimistic !== undefined) {
      return optimistic;
    }
    return null;
  });

  readonly displayMerchantLogo = computed(() => {
    const optimistic = this._optimisticMerchantLogo();
    if (optimistic !== undefined) {
      return optimistic;
    }
    return this.transaction().merchantLogo;
  });

  readonly displayMerchantVisualIdentityMode = computed(() => {
    return this.transaction().merchantVisualIdentityMode;
  });

  readonly displayMerchantIconName = computed(() => {
    return this.transaction().merchantIconName ?? DEFAULT_MERCHANT_ICON_NAME;
  });

  readonly displayMerchantIconColorId = computed(() => {
    return this.transaction().merchantIconColorId;
  });

  readonly isSaving = computed(() => this.isSavingCategory() || this.isSavingMerchant());

  // Linked import indicators
  readonly hasLinkedImport = computed(() => {
    const raw = this.transaction();
    return 'linkedRawTransactionId' in raw && raw.linkedRawTransactionId != null;
  });

  readonly isPendingLinkApproval = computed(() => {
    const raw = this.transaction();
    return this.hasLinkedImport() && raw.reviewStatus === 'needs_review';
  });

  // Transfer suggestion indicators
  readonly hasTransferSuggestion = computed(() => {
    const suggestion = this.transaction().suggestedTransfer;
    if (!suggestion) return false;
    return suggestion.status === 'pending' || suggestion.status === 'linked_pending_approval';
  });

  readonly isLinkedTransferSuggestion = computed(() => {
    const suggestion = this.transaction().suggestedTransfer;
    if (!suggestion) return false;
    return suggestion.status === 'linked_pending_approval';
  });

  // Only confirmed transfers use transfer presentation. Suggestions retain their
  // imported merchant and category so false positives remain understandable.
  readonly displayAsTransfer = computed(() => {
    return this.displayIsTransfer();
  });

  readonly suggestedCounterpartAccountId = computed(() => {
    const suggestion = this.transaction().suggestedTransfer;
    if (!suggestion) return null;
    return suggestion.suggestedCounterpartAccountId ?? null;
  });

  readonly hasLinkDiscrepancies = computed(() => {
    const raw = this.transaction();
    const importDetails = raw.importDetails;
    if (!importDetails || !this.hasLinkedImport()) return false;

    // Check amount difference
    const amountDiffers = importDetails.amount !== raw.amount;

    // Check date difference (more than 2 days)
    if (importDetails.date && raw.date) {
      const [importYear, importMonth, importDay] = importDetails.date.split('-').map(Number);
      const [manualYear, manualMonth, manualDay] = raw.date.split('-').map(Number);
      const importDate = new Date(importYear, importMonth - 1, importDay);
      const manualDate = new Date(manualYear, manualMonth - 1, manualDay);
      const daysDiff = Math.abs(importDate.getTime() - manualDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysDiff > 2) return true;
    }

    return amountDiffers;
  });

  // Computed values for transfer display with optimistic updates
  readonly displayIsTransfer = computed(() => {
    const optimistic = this._optimisticIsTransfer();
    if (optimistic !== undefined) return optimistic;
    return this.transaction().type === 'transfer';
  });

  readonly displayTransferPairBankAccountId = computed(() => {
    const optimistic = this._optimisticTransferPairBankAccountId();
    if (optimistic !== undefined) return optimistic;
    const transaction = this.transaction();
    if (transaction.type !== 'transfer') return null;
    // Use the raw transferPairBankAccountId directly, fall back to name-based lookup
    if (transaction.transferPairBankAccountId) return transaction.transferPairBankAccountId;
    const pairAccountName = transaction.transferPairAccountName;
    if (!pairAccountName) return null;
    const account = this.bankAccountService.bankAccounts().find((a) => a.name === pairAccountName);
    return account?._id ?? null;
  });

  // Resolved logo for the transfer pair bank account (or suggested counterpart)
  readonly displayTransferPairLogo = computed(() => {
    // For actual transfers, look up the paired account's logo
    const pairId = this.displayTransferPairBankAccountId();
    if (pairId) {
      const account = this.bankAccountService.bankAccounts().find((a) => a._id === pairId);
      return account?.resolvedLogoUrl ?? null;
    }
    // For transfer suggestions, look up the suggested counterpart's logo
    const suggestedId = this.suggestedCounterpartAccountId();
    if (suggestedId) {
      const account = this.bankAccountService.bankAccounts().find((a) => a._id === suggestedId);
      return account?.resolvedLogoUrl ?? null;
    }
    return null;
  });

  readonly displayTransferPairVisualIdentityMode = computed(() => {
    const account = this.displayTransferPairAccount();
    return account?.visualIdentityMode ?? this.transaction().transferPairAccountVisualIdentityMode;
  });

  readonly displayTransferPairIconName = computed(() => {
    const account = this.displayTransferPairAccount();
    return account?.iconName ?? this.transaction().transferPairAccountIconName ?? DEFAULT_BANK_ACCOUNT_ICON_NAME;
  });

  readonly displayTransferPairIconColorId = computed(() => {
    const account = this.displayTransferPairAccount();
    return account?.iconColorId ?? this.transaction().transferPairAccountIconColorId;
  });

  private readonly displayTransferPairAccount = computed(() => {
    const pairId = this.displayTransferPairBankAccountId();
    if (pairId) {
      return this.bankAccountService.bankAccounts().find((a) => a._id === pairId) ?? null;
    }

    const suggestedId = this.suggestedCounterpartAccountId();
    if (suggestedId) {
      return this.bankAccountService.bankAccounts().find((a) => a._id === suggestedId) ?? null;
    }

    return null;
  });

  // Off-budget account detection (investment/loan accounts don't need categories)
  readonly isOffBudgetAccount = computed(() => {
    const transaction = this.transaction();
    const accountType = transaction.bankAccount?.accountType;
    if (!accountType) return false;
    return !accountType.startsWith('banking_') && !accountType.startsWith('credit_');
  });

  // Cross-budget transfer detection: this transaction is the on-budget side
  readonly isCrossBudgetOnBudgetSide = computed(() => {
    const transaction = this.transaction();
    if (transaction.type !== 'transfer') return false;
    const accountType = transaction.bankAccount?.accountType;
    const pairedAccountId = transaction.transferPairBankAccountId;
    if (!accountType || !pairedAccountId) return false;
    const pairedAccount = this.bankAccountService.bankAccounts().find((a) => a._id === pairedAccountId);
    const pairedAccountType = pairedAccount?.accountType;
    if (!pairedAccountType) return false;
    const isOnBudget = (type: string) => type.startsWith('banking_') || type.startsWith('credit_');
    // This side must be on-budget AND the other side must be off-budget
    return isOnBudget(accountType) && !isOnBudget(pairedAccountType);
  });

  // Cross-budget transfer detection: this transaction is the off-budget side
  readonly isCrossBudgetOffBudgetSide = computed(() => {
    const transaction = this.transaction();
    if (transaction.type !== 'transfer') return false;
    const accountType = transaction.bankAccount?.accountType;
    const pairedAccountId = transaction.transferPairBankAccountId;
    if (!accountType || !pairedAccountId) return false;
    const pairedAccount = this.bankAccountService.bankAccounts().find((a) => a._id === pairedAccountId);
    const pairedAccountType = pairedAccount?.accountType;
    if (!pairedAccountType) return false;
    const isOnBudget = (type: string) => type.startsWith('banking_') || type.startsWith('credit_');
    return !isOnBudget(accountType) && isOnBudget(pairedAccountType);
  });

  // Bank accounts available for payee selection (all accounts shown, selection logic handles duplicates)
  readonly payeeBankAccounts = computed(() => {
    return this.bankAccountService.activeBankAccounts();
  });

  // Bank account IDs to exclude from the bank account selector (transfer pair account for transfers)
  readonly excludedBankAccountIds = computed(() => {
    const transaction = this.transaction();
    // For transfer transactions, exclude the transfer pair bank account
    if (transaction.type === 'transfer' && transaction.transferPairBankAccountId) {
      return [transaction.transferPairBankAccountId];
    }
    return [];
  });

  // Optimistic state for bank account
  private readonly _optimisticBankAccountId = signal<string | undefined>(undefined);
  readonly isSavingBankAccount = signal<boolean>(false);

  // Display bank account ID with optimistic updates
  readonly displayBankAccountId = computed(() => {
    const optimistic = this._optimisticBankAccountId();
    if (optimistic !== undefined) {
      return optimistic;
    }
    return this.transaction().bankAccountId;
  });

  // Optimistic state for date
  private readonly _optimisticDate = signal<Date | undefined>(undefined);
  readonly isSavingDate = signal<boolean>(false);

  // Display date with optimistic updates (returns Date object for the date picker)
  readonly displayDate = computed(() => {
    const optimistic = this._optimisticDate();
    if (optimistic !== undefined) {
      return optimistic;
    }
    const dateString = this.transaction().date;
    if (!dateString) return new Date();
    // Parse the date string as local date (YYYY-MM-DD format)
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, month - 1, day);
  });
  readonly displayYearMonth = computed(() => dateToYearMonth(this.displayDate()));
  canScheduleTransaction(transaction: TransactionWithRelations): boolean {
    return transaction.type === 'regular' || transaction.type === 'transfer';
  }

  // Amount change detection (when Plaid updates amount on reviewed transaction)
  readonly hasAmountChange = computed(() => {
    const tx = this.transaction();
    return tx.originalApprovedAmount !== undefined && tx.reviewStatus === 'needs_review';
  });

  // Original approved amount (for strikethrough display)
  readonly originalApprovedAmount = computed(() => {
    return this.transaction().originalApprovedAmount;
  });

  formatOriginalAmount(amountInCents: bigint | number): string {
    const amount = typeof amountInCents === 'bigint' ? Number(amountInCents) : amountInCents;
    return this.currencyService.format(Math.abs(amount));
  }

  formatAmount(amountInCents: bigint | number): { display: string; isPositive: boolean } {
    const amount = typeof amountInCents === 'bigint' ? Number(amountInCents) : amountInCents;
    const isPositive = amount >= 0;
    const formatted = this.currencyService.format(Math.abs(amount));

    return {
      display: isPositive ? `+${formatted}` : formatted,
      isPositive,
    };
  }

  formatDate(dateString: string | null): string {
    if (!dateString) return 'N/A';

    let date: Date;

    if (dateString.includes('T')) {
      date = new Date(dateString);
    } else {
      const [year, month, day] = dateString.split('-').map(Number);
      date = new Date(year, month - 1, day);
    }

    if (isNaN(date.getTime())) {
      return 'N/A';
    }

    const now = new Date();
    const isCurrentYear = date.getFullYear() === now.getFullYear();

    const options: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      ...(isCurrentYear ? {} : { year: 'numeric' }),
    };
    return date.toLocaleDateString('en-US', options);
  }

  getBankAccountName(transaction: TransactionWithRelations): string {
    return transaction.bankAccount?.name ?? 'Unknown Account';
  }

  getMovementCategoryName(movement: TransactionWithRelations['movements'][number] | undefined): string {
    if (!movement) {
      return 'None';
    }
    if (movement.readyToAssign) {
      return 'Ready to Assign';
    }
    return movement.category?.name ?? 'None';
  }

  hasMovementCategory(movement: TransactionWithRelations['movements'][number] | undefined): boolean {
    if (!movement) {
      return false;
    }
    return movement.readyToAssign || movement.category !== null;
  }

  isSplitTransaction(transaction: TransactionWithRelations): boolean {
    return transaction.movements.length > 1;
  }

  formatMovementAmount(amount: bigint): string {
    return this.currencyService.format(Math.abs(Number(amount)));
  }

  getMerchantName(transaction: TransactionWithRelations): string {
    if (transaction.type === 'transfer' && transaction.transferPairAccountName) {
      const direction = transaction.amount > 0n ? 'from' : 'to';
      return `Transfer ${direction} ${transaction.transferPairAccountName}`;
    }
    return transaction.merchantName ?? '—';
  }

  getMerchantLogo(transaction: TransactionWithRelations): string | null {
    if (transaction.type === 'transfer') {
      return null;
    }
    return transaction.merchantLogo;
  }

  isTransfer(transaction: TransactionWithRelations): boolean {
    return transaction.type === 'transfer';
  }

  isStartingBalance(transaction: TransactionWithRelations): boolean {
    return transaction.type === 'starting_balance';
  }

  isBalanceAdjustment(transaction: TransactionWithRelations): boolean {
    return transaction.type === 'balance_adjustment';
  }

  getInstitutionLogo(transaction: TransactionWithRelations): string | null {
    return transaction.bankAccount?.institution?.logoUrl ?? null;
  }

  getTransactionUrl(transactionId: string): string[] {
    return this.navigationService.getTransactionRoute(transactionId);
  }

  onSplitClick(transaction: TransactionWithRelations): void {
    void this.router.navigate(this.navigationService.getTransactionRoute(transaction._id), {
      state: { enterSplitMode: true },
    });
  }

  getBankAccountUrl(bankAccountId: string): string[] {
    return this.navigationService.getBankAccountRoute(bankAccountId);
  }

  getMerchantUrl(merchantId: string): string[] {
    return this.navigationService.getMerchantRoute(merchantId);
  }

  /**
   * Get the payee link URL for navigation
   * Returns the bank account URL for transfers, merchant URL for regular transactions
   */
  getPayeeLinkUrl(): string[] | null {
    if (this.displayIsTransfer()) {
      const transferPairAccountId = this.displayTransferPairBankAccountId();
      if (transferPairAccountId) {
        return this.getBankAccountUrl(transferPairAccountId);
      }
      return null;
    }

    const merchantId = this.displayMerchantId();
    if (merchantId) {
      return this.getMerchantUrl(merchantId);
    }

    return null;
  }

  isPending(transaction: TransactionWithRelations): boolean {
    return transaction.status === 'pending';
  }

  isReconciled(transaction: TransactionWithRelations): boolean {
    return transaction.status === 'reconciled';
  }

  getCategoryId(transaction: TransactionWithRelations): string | null {
    const firstMovement = transaction.movements[0];
    return firstMovement?.category?._id ?? null;
  }

  isReadyToAssign(transaction: TransactionWithRelations): boolean {
    return transaction.movements[0]?.readyToAssign ?? false;
  }

  async onCategoryChange(
    transaction: TransactionWithRelations,
    value: string | null | 'ready-to-assign'
  ): Promise<void> {
    const transactionId = transaction._id;
    const originalCategoryId = this.getCategoryId(transaction);
    const originalReadyToAssign = this.isReadyToAssign(transaction);

    if (value === 'ready-to-assign' && originalReadyToAssign) {
      return;
    }
    if (value !== 'ready-to-assign' && value === originalCategoryId && !originalReadyToAssign) {
      return;
    }

    if (value === 'ready-to-assign') {
      this._optimisticCategoryId.set(null);
      this._optimisticReadyToAssign.set(true);
    } else {
      this._optimisticCategoryId.set(value);
      this._optimisticReadyToAssign.set(false);
    }

    this.isSavingCategory.set(true);

    const currentMovements = transaction.movements.map((movement) => ({
      amount: movement.amount,
      categoryId: movement.category?._id,
      readyToAssign: movement.readyToAssign,
      notes: movement.notes,
    }));

    try {
      let success: boolean;

      if (this.isCrossBudgetOnBudgetSide()) {
        success = await this.transactionService.updateTransfer(
          transactionId,
          value === 'ready-to-assign'
            ? { readyToAssign: true }
            : {
                categoryId: (value ?? undefined) as Id<'category'> | undefined,
                readyToAssign: false,
              }
        );
      } else if (value === 'ready-to-assign') {
        success = await this.transactionService.updateTransaction(
          transactionId,
          { readyToAssign: true },
          currentMovements
        );
      } else {
        success = await this.transactionService.updateTransaction(
          transactionId,
          { categoryId: value as Id<'category'> | null, readyToAssign: false },
          currentMovements
        );
      }

      if (!success) {
        throw new Error('Failed to update category');
      }

      this._optimisticCategoryId.set(undefined);
      this._optimisticReadyToAssign.set(undefined);
    } catch {
      this._optimisticCategoryId.set(originalCategoryId);
      this._optimisticReadyToAssign.set(originalReadyToAssign);

      setTimeout(() => {
        this._optimisticCategoryId.set(undefined);
        this._optimisticReadyToAssign.set(undefined);
      }, 100);
    } finally {
      this.isSavingCategory.set(false);
    }
  }

  async onPayeeChange(transaction: TransactionWithRelations, value: PayeeChangeEvent): Promise<void> {
    const isCurrentlyTransfer = transaction.type === 'transfer';
    const isCurrentlySystem = transaction.type === 'starting_balance' || transaction.type === 'balance_adjustment';

    // Scenario 1: Transfer -> Different Bank Account (Update Transfer)
    if (isCurrentlyTransfer && value.type === 'bankAccount' && value.id) {
      // Cannot transfer to the same account - ignore if user selects current bank account
      if (value.id === transaction.bankAccountId) {
        return;
      }
      await this.updateTransferPairAccount(transaction, value.id);
      return;
    }

    // Scenario 2: Transfer -> Merchant (Convert from Transfer, then set merchant)
    if (isCurrentlyTransfer && value.type === 'merchant') {
      await this.convertTransferToMerchant(transaction, value);
      return;
    }

    // Scenario 3: Regular -> Bank Account (Convert to Transfer)
    if (!isCurrentlyTransfer && value.type === 'bankAccount' && value.id) {
      // Cannot transfer to the same account - ignore if user selects current bank account
      if (value.id === transaction.bankAccountId) {
        return;
      }
      await this.convertToTransfer(transaction, value.id);
      return;
    }

    // Scenario 4: Regular -> Different Merchant (Update Merchant)
    if (!isCurrentlyTransfer && !isCurrentlySystem && value.type === 'merchant') {
      await this.onMerchantChangeInternal(transaction, { id: value.id, pendingName: value.pendingName }, false);
      return;
    }

    // Scenario 5: Any type -> System (Convert to system transaction type)
    if (value.type === 'system' && value.systemPayeeType) {
      await this.convertToSystemType(transaction, value.systemPayeeType);
      return;
    }

    // Scenario 6: System -> Merchant (Convert to regular, then set merchant)
    if (isCurrentlySystem && value.type === 'merchant') {
      await this.convertSystemToMerchant(transaction, value);
      return;
    }

    // Scenario 7: System -> Bank Account (Convert to regular, then to transfer)
    if (isCurrentlySystem && value.type === 'bankAccount' && value.id) {
      // Cannot transfer to the same account - ignore if user selects current bank account
      if (value.id === transaction.bankAccountId) {
        return;
      }
      await this.convertSystemToTransfer(transaction, value.id);
      return;
    }
  }

  /**
   * Scenario 1: Update a transfer's paired bank account
   */
  private async updateTransferPairAccount(transaction: TransactionWithRelations, newAccountId: string): Promise<void> {
    const transactionId = transaction._id;

    // Prevent concurrent calls
    if (this.isSavingMerchant()) {
      return;
    }

    // Store previous value for potential revert
    const previousTransferPairBankAccountId = this.displayTransferPairBankAccountId();

    // Optimistic update
    this._optimisticTransferPairBankAccountId.set(newAccountId);
    this.isSavingMerchant.set(true);

    try {
      // Determine if this transaction is the "from" or "to" side of the transfer
      const transactionAmount = Number(transaction.amount);
      const isFromSide = transactionAmount < 0;

      await this.transactionService.updateTransfer(
        transactionId,
        isFromSide
          ? { toAccountId: newAccountId as Id<'bankAccount'> }
          : { fromAccountId: newAccountId as Id<'bankAccount'> }
      );

      // Clear optimistic state on success
      this._optimisticTransferPairBankAccountId.set(undefined);
    } catch {
      // Revert optimistic state on error
      this._optimisticTransferPairBankAccountId.set(previousTransferPairBankAccountId ?? undefined);

      setTimeout(() => {
        this._optimisticTransferPairBankAccountId.set(undefined);
      }, 100);
    } finally {
      this.isSavingMerchant.set(false);
    }
  }

  /**
   * Scenario 2: Convert a transfer back to a regular transaction with a merchant
   */
  private async convertTransferToMerchant(
    transaction: TransactionWithRelations,
    change: { id: string | null; pendingName?: string }
  ): Promise<void> {
    const transactionId = transaction._id;

    // Prevent concurrent calls
    if (this.isSavingMerchant()) {
      return;
    }

    // Capture previous transfer state for undo
    const previousToAccountId = transaction.transferPairBankAccountId;

    // Clear transfer pair optimistic state since we're converting to regular transaction
    this._optimisticTransferPairBankAccountId.set(undefined);

    // Set optimistic state for immediate UI feedback - no longer a transfer
    this._optimisticIsTransfer.set(false);

    // Optimistic update - show merchant name/logo immediately
    if (change.pendingName) {
      this._optimisticPendingMerchantName.set(change.pendingName);
      this._optimisticMerchantId.set(null);
    } else {
      this._optimisticPendingMerchantName.set(null);
      this._optimisticMerchantId.set(change.id);
    }

    this.isSavingMerchant.set(true);

    try {
      // Step 1: Convert from transfer to regular transaction (silent - no individual undo)
      const transactionAmount = Number(transaction.amount);
      const movements = [{ amount: BigInt(transactionAmount) }];
      await this.transactionService.convertFromTransfer(transactionId, movements, { silent: true });

      // Step 2: Set the merchant on the now-regular transaction
      this.isSavingMerchant.set(false);

      // Create a mock regular transaction for the merchant update
      const regularTransaction: TransactionWithRelations = {
        ...transaction,
        type: 'regular',
        transferPairId: undefined,
        transferPairAccountName: null,
        transferPairAccountLogo: null,
      };

      await this.onMerchantChangeInternal(regularTransaction, change, true);

      // Push one combined undo action for both steps
      if (previousToAccountId) {
        this.undoRedoService.pushAction({
          description: 'Converted transfer to merchant',
          type: 'convert-transfer-to-merchant',
          timestamp: Date.now(),
          undo: async () => {
            await this.transactionService.convertToTransfer(transactionId, previousToAccountId, { silent: true });
          },
          redo: async () => {
            await this.transactionService.convertFromTransfer(transactionId, movements, { silent: true });
            await this.transactionService.updateTransaction(
              transactionId,
              { merchantId: change.id ? (change.id as Id<'merchant'>) : null },
              undefined,
              { silent: true }
            );
          },
        });
      }

      // Clear optimistic type state after successful conversion
      this._optimisticIsTransfer.set(undefined);
    } catch {
      // Revert optimistic state on error
      this._optimisticIsTransfer.set(undefined);
      this._optimisticMerchantId.set(undefined);
      this._optimisticPendingMerchantName.set(null);

      this.isSavingMerchant.set(false);
    }
  }

  /**
   * Scenario 3: Convert a regular transaction to a transfer
   */
  private async convertToTransfer(transaction: TransactionWithRelations, toAccountId: string): Promise<void> {
    const transactionId = transaction._id;

    // Prevent concurrent calls
    if (this.isSavingMerchant()) {
      return;
    }

    // Clear merchant optimistic state since we're converting to transfer
    this._optimisticMerchantId.set(undefined);
    this._optimisticPendingMerchantName.set(null);

    // Set optimistic state for immediate UI feedback
    this._optimisticIsTransfer.set(true);
    this._optimisticTransferPairBankAccountId.set(toAccountId);

    this.isSavingMerchant.set(true);

    try {
      const result = await this.transactionService.convertToTransfer(transactionId, toAccountId as Id<'bankAccount'>);

      if (result.success) {
        // Clear optimistic state after successful update
        this._optimisticIsTransfer.set(undefined);
        this._optimisticTransferPairBankAccountId.set(undefined);
      }
    } catch {
      // Clear optimistic state on error
      this._optimisticIsTransfer.set(undefined);
      this._optimisticTransferPairBankAccountId.set(undefined);
    } finally {
      this.isSavingMerchant.set(false);
    }
  }

  /**
   * Scenario 5: Convert any transaction to a system type (starting_balance or balance_adjustment)
   */
  private async convertToSystemType(
    transaction: TransactionWithRelations,
    systemType: 'starting_balance' | 'balance_adjustment'
  ): Promise<void> {
    const transactionId = transaction._id;

    // Prevent concurrent calls
    if (this.isSavingMerchant()) {
      return;
    }

    // Clear optimistic states
    this._optimisticMerchantId.set(undefined);
    this._optimisticPendingMerchantName.set(undefined);
    this._optimisticIsTransfer.set(undefined);
    this._optimisticTransferPairBankAccountId.set(undefined);

    this.isSavingMerchant.set(true);

    try {
      // Use dedicated service methods for proper toast handling and backend logic
      if (systemType === 'starting_balance') {
        await this.transactionService.convertToStartingBalance(transactionId);
      } else {
        await this.transactionService.convertToBalanceAdjustment(transactionId);
      }
    } catch (error: unknown) {
      console.error('Failed to convert to system type:', error);
    } finally {
      this.isSavingMerchant.set(false);
    }
  }

  /**
   * Scenario 6: Convert system transaction to regular with merchant
   */
  private async convertSystemToMerchant(
    transaction: TransactionWithRelations,
    change: { id: string | null; pendingName?: string }
  ): Promise<void> {
    const transactionId = transaction._id;

    // Prevent concurrent calls
    if (this.isSavingMerchant()) {
      return;
    }

    // Set optimistic state for merchant
    if (change.pendingName) {
      this._optimisticPendingMerchantName.set(change.pendingName);
      this._optimisticMerchantId.set(null);
    } else {
      this._optimisticPendingMerchantName.set(null);
      this._optimisticMerchantId.set(change.id);
    }

    this.isSavingMerchant.set(true);

    try {
      // Step 1: Convert to regular transaction
      await this.convex.mutation(api.transactions.updateTransaction, {
        workspaceId: this.workspaceService.workspaceId() as Id<'workspace'>,
        transactionId,
        type: 'regular',
        preserveReviewStatus: true,
      });

      // Step 2: Handle merchant creation or selection
      let merchantId: Id<'merchant'> | null = change.id as Id<'merchant'> | null;
      if (change.pendingName) {
        const newMerchantId = await this.merchantService.createMerchant({ name: change.pendingName });
        if (!newMerchantId) {
          throw new Error('Failed to create merchant');
        }
        merchantId = newMerchantId;
        this._optimisticMerchantId.set(merchantId);
        this._optimisticPendingMerchantName.set(null);
      }

      // Step 3: Update transaction with merchant
      await this.transactionService.updateTransaction(transactionId, {
        merchantId,
      });

      // Clear optimistic state on success
      this._optimisticMerchantId.set(undefined);
      this._optimisticPendingMerchantName.set(undefined);
    } catch (error: unknown) {
      console.error('Failed to convert system to merchant:', error);

      // Clear optimistic state on error
      this._optimisticMerchantId.set(undefined);
      this._optimisticPendingMerchantName.set(undefined);
    } finally {
      this.isSavingMerchant.set(false);
    }
  }

  /**
   * Scenario 7: Convert system transaction to transfer
   */
  private async convertSystemToTransfer(transaction: TransactionWithRelations, toAccountId: string): Promise<void> {
    const transactionId = transaction._id;

    // Prevent concurrent calls
    if (this.isSavingMerchant()) {
      return;
    }

    // Set optimistic state
    this._optimisticIsTransfer.set(true);
    this._optimisticTransferPairBankAccountId.set(toAccountId);

    this.isSavingMerchant.set(true);

    try {
      // Step 1: Convert to regular transaction
      await this.convex.mutation(api.transactions.updateTransaction, {
        workspaceId: this.workspaceService.workspaceId() as Id<'workspace'>,
        transactionId,
        type: 'regular',
        preserveReviewStatus: true,
      });

      // Step 2: Convert to transfer
      const result = await this.transactionService.convertToTransfer(transactionId, toAccountId as Id<'bankAccount'>);

      if (result.success) {
        // Clear optimistic state after successful update
        this._optimisticIsTransfer.set(undefined);
        this._optimisticTransferPairBankAccountId.set(undefined);
      }
    } catch (error: unknown) {
      console.error('Failed to convert system to transfer:', error);

      // Clear optimistic state on error
      this._optimisticIsTransfer.set(undefined);
      this._optimisticTransferPairBankAccountId.set(undefined);
    } finally {
      this.isSavingMerchant.set(false);
    }
  }

  private async onMerchantChangeInternal(
    transaction: TransactionWithRelations,
    value: { id: string | null; pendingName?: string },
    silent = false
  ): Promise<void> {
    const transactionId = transaction._id;

    // Store original values for rollback
    const originalMerchantId = transaction.merchant?._id ?? null;

    // Skip if selecting the same merchant (and no pending name)
    if (!value.pendingName && value.id === originalMerchantId) {
      return;
    }

    // Set optimistic state immediately
    if (value.pendingName) {
      this._optimisticMerchantId.set(null);
      this._optimisticPendingMerchantName.set(value.pendingName);
      this._optimisticMerchantLogo.set(null);
    } else {
      this._optimisticMerchantId.set(value.id);
      this._optimisticPendingMerchantName.set(null);
      // Look up the merchant logo from the merchants list
      const merchant = value.id ? this.merchantService.merchants().find((m) => m._id === value.id) : null;
      this._optimisticMerchantLogo.set(merchant?.logoUrl ?? null);
    }

    this.isSavingMerchant.set(true);

    try {
      let merchantId: Id<'merchant'> | null = value.id as Id<'merchant'> | null;

      // If there's a pending name, create the merchant first
      if (value.pendingName) {
        const newMerchantId = await this.merchantService.createMerchant({ name: value.pendingName });
        if (!newMerchantId) {
          throw new Error('Failed to create merchant');
        }
        merchantId = newMerchantId;
      }

      // Update the transaction with the merchant
      const success = await this.transactionService.updateTransaction(
        transactionId,
        {
          merchantId,
        },
        undefined,
        { silent }
      );

      if (!success) {
        throw new Error('Failed to update merchant');
      }

      // Clear optimistic state on success - real data will take over
      this._optimisticMerchantId.set(undefined);
      this._optimisticPendingMerchantName.set(undefined);
      this._optimisticMerchantLogo.set(undefined);
    } catch {
      // Rollback optimistic state on error
      this._optimisticMerchantId.set(originalMerchantId);
      this._optimisticPendingMerchantName.set(null);
      this._optimisticMerchantLogo.set(transaction.merchantLogo);

      // Clear optimistic state after brief delay to allow real data to show
      setTimeout(() => {
        this._optimisticMerchantId.set(undefined);
        this._optimisticPendingMerchantName.set(undefined);
        this._optimisticMerchantLogo.set(undefined);
      }, 100);
    } finally {
      this.isSavingMerchant.set(false);
    }
  }

  /**
   * Approve a transfer suggestion
   */
  async approveTransferSuggestion(transaction: TransactionWithRelations): Promise<void> {
    this.reviewStatusPopoverState.set('closed');
    this.isSavingReviewStatus.set(true);
    try {
      const txId = transaction._id;
      // Read status directly from the transaction parameter to avoid signal timing issues
      const suggestion = transaction.suggestedTransfer;
      if (!suggestion) return;

      if (suggestion.status === 'linked_pending_approval') {
        await this.transactionService.approveLinkedTransfer(txId);
      } else {
        const counterpartId = suggestion.suggestedCounterpartAccountId;
        await this.transactionService.approveTransferSuggestion(txId, counterpartId);
      }
    } finally {
      this.isSavingReviewStatus.set(false);
    }
  }

  /**
   * Reject a transfer suggestion
   */
  async rejectTransferSuggestion(transaction: TransactionWithRelations): Promise<void> {
    this.reviewStatusPopoverState.set('closed');
    this.isSavingReviewStatus.set(true);
    try {
      await this.transactionService.rejectTransferSuggestion(transaction._id);
    } finally {
      this.isSavingReviewStatus.set(false);
    }
  }

  onCheckboxClick(event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    const transactionId = this.transaction()._id;
    this.checkboxChange.emit({ id: transactionId, event });
  }

  /**
   * Delete transaction via context menu
   */
  async onContextMenuDelete(): Promise<void> {
    const transactionId = this.transaction()._id;
    const success = await this.transactionService.deleteTransaction(transactionId);

    if (success) {
      this.undoRedoService.pushAction({
        description: 'Transaction deleted',
        type: 'transaction-delete',
        timestamp: Date.now(),
        undo: async () => {
          const restored = await this.transactionService.restoreTransaction(transactionId);
          if (!restored) throw new Error('Failed to restore transaction');
        },
        redo: async () => {
          const deleted = await this.transactionService.deleteTransaction(transactionId);
          if (!deleted) throw new Error('Failed to delete transaction');
        },
      });
      toast('Transaction deleted', {
        action: {
          label: 'Undo',
          onClick: () => void this.undoRedoService.undo(),
        },
      });
    } else {
      toast.error('Failed to delete transaction');
    }
  }

  /**
   * Update transaction status via context menu
   */
  async onContextMenuUpdateStatus(status: 'pending' | 'cleared'): Promise<void> {
    const transaction = this.transaction();
    const transactionId = transaction._id;

    const mutationPromise = (async () => {
      await this.convex.mutation(api.transactions.updateTransaction, {
        workspaceId: this.workspaceService.workspaceId() as Id<'workspace'>,
        transactionId,
        status,
        preserveReviewStatus: true,
      });
      return true;
    })();

    const label = status === 'pending' ? 'pending' : 'cleared';
    toast.promise(mutationPromise, {
      loading: `Marking as ${label}...`,
      success: `Marked as ${label}`,
      error: `Failed to mark as ${label}`,
    });

    await mutationPromise;
  }

  /**
   * Get review status icon
   */
  getReviewStatusIcon(reviewStatus: 'reviewed' | 'needs_review' | undefined) {
    if (reviewStatus === 'reviewed') return this.CircleCheck;
    if (reviewStatus === 'needs_review') return this.Info;
    return this.Info;
  }

  /**
   * Get review status icon color
   */
  getReviewStatusIconClass(reviewStatus: 'reviewed' | 'needs_review' | undefined): string {
    if (reviewStatus === 'reviewed') return 'text-muted-foreground';
    if (reviewStatus === 'needs_review') return 'text-primary';
    return 'text-muted-foreground';
  }

  /**
   * Get review status button visibility class
   */
  getReviewStatusButtonClass(reviewStatus: 'reviewed' | 'needs_review' | undefined): string {
    if (reviewStatus === 'needs_review') {
      return 'text-primary hover:text-primary'; // Always visible, primary color (stays primary on hover)
    }
    if (reviewStatus === 'reviewed') {
      return 'text-muted-foreground'; // Always visible, muted color
    }
    // Undefined: hover-only visibility (like checkbox)
    return 'text-muted-foreground opacity-0 transition-none group-hover:opacity-100 focus-visible:opacity-100';
  }

  /**
   * Handle review status popover state change
   */
  onReviewStatusPopoverStateChange(state: 'open' | 'closed'): void {
    this.reviewStatusPopoverState.set(state);
  }

  /**
   * Approve transaction
   */
  async approveTransaction(transaction: TransactionWithRelations): Promise<void> {
    // Close popover immediately to prevent it from staying open when transaction is filtered out
    this.reviewStatusPopoverState.set('closed');

    this.isSavingReviewStatus.set(true);
    try {
      await this.transactionService.updateReviewStatus(transaction._id, 'approve');
    } finally {
      this.isSavingReviewStatus.set(false);
    }
  }

  /**
   * Confirm link for a linked transaction
   */
  async confirmLink(transaction: TransactionWithRelations): Promise<void> {
    // Close popover immediately to prevent it from staying open when transaction is filtered out
    this.reviewStatusPopoverState.set('closed');

    this.isSavingReviewStatus.set(true);
    try {
      await this.transactionService.approveTransactionLink(transaction._id);
    } finally {
      this.isSavingReviewStatus.set(false);
    }
  }

  /**
   * Unlink a linked transaction
   */
  async unlinkTransaction(transaction: TransactionWithRelations): Promise<void> {
    // Close popover immediately to prevent it from staying open when transaction is filtered out
    this.reviewStatusPopoverState.set('closed');

    this.isSavingReviewStatus.set(true);
    try {
      await this.transactionService.unlinkTransaction(transaction._id);
    } finally {
      this.isSavingReviewStatus.set(false);
    }
  }

  /**
   * Handle bank account change from the selector
   */
  async onBankAccountChange(transaction: TransactionWithRelations, newBankAccountId: string | null): Promise<void> {
    if (!newBankAccountId) return;

    const transactionId = transaction._id;
    const originalBankAccountId = transaction.bankAccountId;

    // Skip if selecting the same account
    if (newBankAccountId === originalBankAccountId) {
      return;
    }

    // Set optimistic state immediately
    this._optimisticBankAccountId.set(newBankAccountId);
    this.isSavingBankAccount.set(true);

    try {
      const success = await this.transactionService.updateTransaction(transactionId, {
        bankAccountId: newBankAccountId as Id<'bankAccount'>,
      });

      if (!success) {
        throw new Error('Failed to update bank account');
      }

      // Clear optimistic state on success - real data will take over
      this._optimisticBankAccountId.set(undefined);
    } catch {
      // Rollback optimistic state on error
      this._optimisticBankAccountId.set(originalBankAccountId);

      // Clear optimistic state after brief delay to allow real data to show
      setTimeout(() => {
        this._optimisticBankAccountId.set(undefined);
      }, 100);
    } finally {
      this.isSavingBankAccount.set(false);
    }
  }

  /**
   * Handle date change from the date picker
   */
  async onDateChange(transaction: TransactionWithRelations, newDate: Date): Promise<void> {
    const transactionId = transaction._id;

    // Format date as YYYY-MM-DD in local timezone
    const year = newDate.getFullYear();
    const month = String(newDate.getMonth() + 1).padStart(2, '0');
    const day = String(newDate.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;

    // Skip if selecting the same date
    if (dateString === transaction.date) {
      return;
    }

    // Store previous date for potential revert
    const previousDateString = transaction.date;
    const [prevYear, prevMonth, prevDay] = previousDateString.split('-').map(Number);
    const previousDate = new Date(prevYear, prevMonth - 1, prevDay);

    // Set optimistic state immediately
    this._optimisticDate.set(newDate);
    this.isSavingDate.set(true);

    try {
      const result = await this.transactionService.updateTransactionSchedule(transactionId, {
        date: dateString,
      });

      if (!result?.success) {
        throw new Error('Failed to update date');
      }

      // Clear optimistic state on success - real data will take over
      this._optimisticDate.set(undefined);
    } catch {
      // Rollback optimistic state on error
      this._optimisticDate.set(previousDate);

      // Clear optimistic state after brief delay to allow real data to show
      setTimeout(() => {
        this._optimisticDate.set(undefined);
      }, 100);
    } finally {
      this.isSavingDate.set(false);
    }
  }

  onMakeRecurring(transaction: TransactionWithRelations): void {
    if (!this.canScheduleTransaction(transaction)) {
      return;
    }
    this.transactionService.openMakeRecurringDialog(transaction);
  }
}
