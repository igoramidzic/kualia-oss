import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogFooter, HlmDialogHeader } from '@spartan-ng/helm/dialog';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import {
  nucleoBell as BellRing,
  nucleoCalendarClock as CalendarClock,
  nucleoCheck as Check,
  nucleoHistory as ClockFading,
  nucleoLoader as LoaderCircle,
  NucleoIcon,
  nucleoSplit as SplitIcon,
  nucleoClose as X,
} from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { BankAccountService, BankAccountWithRelations } from '../../../services/bank-account.service';
import { Category, CategoryService } from '../../../services/category.service';
import { ConvexService } from '../../../services/convex.service';
import { MerchantService } from '../../../services/merchant.service';
import { NavigationService } from '../../../services/navigation.service';
import {
  SCHEDULED_REMINDER_OPTIONS,
  ScheduledReminderSelection,
  ScheduledTransactionService,
  UpdateScheduledTransactionInput,
} from '../../../services/scheduled-transaction.service';
import {
  CreateScheduledTransactionResult,
  CreateTransactionDialogContext,
  CreateTransactionDialogDraft,
  TransactionService,
} from '../../../services/transaction.service';
import { UndoRedoService } from '../../../services/undo-redo.service';
import { WorkspaceService } from '../../../services/workspace.service';
import { ArithmeticCurrencyInputComponent } from '../../../shared/components/arithmetic-currency-input/arithmetic-currency-input.component';
import { extractConvexErrorMessage } from '../../../shared/utils/convex-error-message';
import { dateToYearMonth } from '../../../shared/utils/month.utils';
import { Recurrence, recurrenceLabel } from '../../../shared/utils/recurrence.utils';
import { HlmTextarea } from '../../../ui/textarea/src/lib/hlm-textarea';
import { AmountSignToggleComponent } from '../../transaction/amount-sign-toggle.component';
import { BankAccountSelectorComponent } from '../../transaction/bank-account-selector.component';
import { CategorySelectorComponent } from '../../transaction/category-selector.component';
import { PayeeChangeEvent, PayeeSelectorComponent } from '../../transaction/payee-selector.component';
import { TransactionDatePickerComponent } from '../../transaction/transaction-date-picker.component';
import { Split, TransactionSplitsComponent } from '../../transaction/transaction-splits.component';

export function shouldShowPlannedOptions(
  canSchedule: boolean,
  isDateTodayOrPast: boolean,
  recurrence: Recurrence
): boolean {
  return canSchedule && (!isDateTodayOrPast || recurrence !== 'once');
}

export function buildPlannedOptionsUpdate(
  scheduledTransactionId: Id<'scheduledTransaction'>,
  enterAutomatically: boolean,
  reminder: ScheduledReminderSelection
): UpdateScheduledTransactionInput {
  return {
    scheduledTransactionId,
    entryMode: enterAutomatically ? 'auto' : 'manual',
    reminderEnabled: reminder !== 'none',
    reminderOffset: reminder === 'none' ? null : reminder,
  };
}

@Component({
  selector: 'app-create-transaction-dialog-content',
  imports: [
    HlmButton,
    NucleoIcon,
    HlmDialogFooter,
    ArithmeticCurrencyInputComponent,
    TransactionDatePickerComponent,
    BankAccountSelectorComponent,
    CategorySelectorComponent,
    PayeeSelectorComponent,
    AmountSignToggleComponent,
    TransactionSplitsComponent,
    HlmTextarea,
    HlmDialogHeader,
    HlmSelectImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './create-transaction-dialog-content.html',
  styles: [],
})
export class CreateTransactionDialogContentComponent implements AfterViewInit {
  protected readonly LoaderCircle = LoaderCircle;
  protected readonly X = X;
  protected readonly ClockFading = ClockFading;
  protected readonly Check = Check;
  protected readonly CalendarClock = CalendarClock;
  protected readonly BellRing = BellRing;
  protected readonly SplitIcon = SplitIcon;
  protected readonly BigInt = BigInt;
  protected readonly submitShortcutModifier = this.getSubmitShortcutModifier();
  protected readonly reminderOptions = SCHEDULED_REMINDER_OPTIONS;
  protected readonly compactSelectTriggerClass =
    'h-8 border-transparent bg-transparent px-1 py-0 text-xs shadow-none hover:bg-accent hover:text-accent-foreground focus-visible:border-transparent focus-visible:ring-0';

  private readonly merchantService = inject(MerchantService);
  private readonly categoryConvexService = inject(CategoryService);
  private readonly bankAccountConvexService = inject(BankAccountService);
  private readonly transactionService = inject(TransactionService);
  private readonly scheduledTransactionService = inject(ScheduledTransactionService);
  private readonly navigationService = inject(NavigationService);
  private readonly convexService = inject(ConvexService);
  private readonly undoRedoService = inject(UndoRedoService);
  private readonly workspaceService = inject(WorkspaceService);
  protected readonly dialogRef = injectBrnDialogContext<
    {
      close: (result?: unknown) => void;
    } & CreateTransactionDialogContext
  >();
  protected readonly amountEditor = viewChild<ArithmeticCurrencyInputComponent>('amountEditor');
  protected readonly notesEditor = viewChild<ElementRef<HTMLTextAreaElement>>('notesEditor');

  readonly errorOccurred = output<string>();

  private readonly _creating = signal<boolean>(false);
  readonly creating = this._creating.asReadonly();
  readonly transactionAmountValue = signal<number | null>(null);
  readonly amountSign = signal<'inflow' | 'outflow'>('outflow');
  // Display absolute value in the input field
  readonly transactionAmountDisplay = computed(() => {
    const amount = this.transactionAmountValue();
    return amount !== null ? Math.abs(amount) : null;
  });
  readonly selectedBankAccount = signal<BankAccountWithRelations | null>(null);
  readonly selectedBankAccountId = computed(() => this.selectedBankAccount()?._id ?? null);
  readonly selectedCategory = signal<Category | null>(null);
  readonly selectedCategoryId = computed(() => this.selectedCategory()?._id ?? null);
  readonly readyToAssign = signal<boolean>(false);
  readonly selectedMerchantIdValue = signal<string | null>(null);
  readonly selectedMerchantId = computed(() => this.selectedMerchantIdValue());
  readonly selectedMerchant = computed(() => {
    const id = this.selectedMerchantIdValue();
    if (!id) return null;
    return this.merchants().find((m) => m._id === id) ?? null;
  });
  readonly pendingMerchantName = signal<string | null>(null);

  // Transfer-related state
  readonly isTransfer = signal<boolean>(false);
  readonly selectedPayeeBankAccountId = signal<string | null>(null);

  // System type state (starting_balance or balance_adjustment)
  readonly systemType = signal<'starting_balance' | 'balance_adjustment' | null>(null);
  readonly isSystemType = computed(() => this.systemType() !== null);

  // Computed transaction type for payee selector
  readonly transactionType = computed<'regular' | 'transfer' | 'starting_balance' | 'balance_adjustment'>(() => {
    const system = this.systemType();
    if (system) return system;
    if (this.isTransfer()) return 'transfer';
    return 'regular';
  });

  // Cross-budget transfer detection
  readonly isCrossBudgetTransfer = computed(() => {
    if (!this.isTransfer()) return false;
    const bankAccount = this.selectedBankAccount();
    const payeeAccountId = this.selectedPayeeBankAccountId();
    if (!bankAccount?.accountType || !payeeAccountId) return false;
    const payeeAccount = this.bankAccounts().find((a) => a._id === payeeAccountId);
    if (!payeeAccount?.accountType) return false;
    const isOnBudget = (type: string) => type.startsWith('banking_') || type.startsWith('credit_');
    return isOnBudget(bankAccount.accountType) !== isOnBudget(payeeAccount.accountType);
  });

  // Off-budget account detection (investment/loan accounts don't need categories)
  readonly isSelectedAccountOffBudget = computed(() => {
    const account = this.selectedBankAccount();
    if (!account?.accountType) return false;
    return !account.accountType.startsWith('banking_') && !account.accountType.startsWith('credit_');
  });

  // Bank accounts available for payee selection. Closed accounts are hidden since
  // they cannot be the destination of a new transfer.
  readonly payeeBankAccounts = computed(() => {
    return this.bankAccounts().filter((account) => !account.isClosed);
  });
  readonly selectedDate = signal<Date>(new Date());
  readonly selectedYearMonth = computed(() => dateToYearMonth(this.selectedDate()));
  readonly payeeSelectorTransactionAmount = computed(() => {
    const amount = this.transactionAmountValue();
    if (amount !== null) {
      return amount;
    }
    return this.amountSign() === 'outflow' ? -1 : 1;
  });
  // Initialize isPending from workspace defaults, defaulting to true if not set
  readonly isPending = signal<boolean>(this.workspaceService.workspace()?.transactionDefaultPendingStatus ?? true);
  readonly transactionNotes = signal<string>('');

  // Tracking signals for auto-apply logic
  // When user manually selects category or account, don't auto-apply merchant suggestions
  readonly categoryManuallySelected = signal<boolean>(false);
  readonly accountManuallySelected = signal<boolean>(false);

  // Computed signal to check if date is today or in the past
  readonly isDateTodayOrPast = computed(() => {
    const selected = new Date(this.selectedDate());
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    selected.setHours(0, 0, 0, 0);
    return selected <= today;
  });

  // Scheduling is supported for regular transactions and transfers (not system types)
  readonly canSchedule = computed(() => this.transactionType() === 'regular' || this.transactionType() === 'transfer');
  readonly recurrence = signal<Recurrence>('once');
  // Future dates are allowed for regular transactions/transfers (they become scheduled transactions);
  // system types keep the default max of today.
  readonly datePickerMax = computed<Date | null | undefined>(() => (this.canSchedule() ? null : undefined));
  // A future-dated regular transaction or transfer is scheduled instead of entered
  readonly isScheduling = computed(() => this.canSchedule() && !this.isDateTodayOrPast());
  readonly hasPlannedSchedule = computed(() =>
    shouldShowPlannedOptions(this.canSchedule(), this.isDateTodayOrPast(), this.recurrence())
  );
  readonly enterAutomatically = linkedSignal(() => {
    const sourceAccountId =
      this.isTransfer() && this.payeeSelectorTransactionAmount() > 0
        ? this.selectedPayeeBankAccountId()
        : this.selectedBankAccountId();
    const sourceAccount = this.bankAccountConvexService
      .bankAccounts()
      .find((account) => account._id === sourceAccountId);
    return !sourceAccount?.bankLinkAccountId && !sourceAccount?.financeKitAccountId;
  });
  readonly reminderSelection = signal<ScheduledReminderSelection>('none');
  readonly reminderToString = (value: ScheduledReminderSelection): string =>
    this.reminderOptions.find((option) => option.value === value)?.label ?? 'No reminder';

  readonly bankAccounts = this.bankAccountConvexService.bankAccounts;
  readonly categories = this.categoryConvexService.categories;
  readonly merchants = this.merchantService.merchants;
  readonly sortedCategories = this.categoryConvexService.sortedCategories;

  // Split mode state
  readonly isSplitMode = signal<boolean>(false);
  readonly localSplits = signal<Split[]>([]);
  readonly initialSplits = signal<Split[]>([]);

  ngAfterViewInit() {
    // Preselect bank account based on:
    // 1. Dialog context (if opened from bank account page)
    // 2. Workspace default account
    // 3. First available account
    const accounts = this.bankAccounts().filter((a) => !a.isClosed);
    console.log(
      '[CreateTransactionDialog] ngAfterViewInit - accounts:',
      accounts.map((a) => ({ name: a.name, _id: a._id }))
    );
    console.log('[CreateTransactionDialog] ngAfterViewInit - dialogRef.bankAccountId:', this.dialogRef.bankAccountId);
    console.log('[CreateTransactionDialog] ngAfterViewInit - dialogRef full:', this.dialogRef);

    if (accounts.length > 0 && !this.selectedBankAccount()) {
      const draft = this.dialogRef.draft;
      const contextAccountId = this.dialogRef.bankAccountId;
      const defaultAccountId = this.workspaceService.workspace()?.transactionDefaultAccountId;
      const targetAccountId = draft?.bankAccountId ?? contextAccountId ?? defaultAccountId;

      console.log('[CreateTransactionDialog] ngAfterViewInit - contextAccountId:', contextAccountId);
      console.log('[CreateTransactionDialog] ngAfterViewInit - defaultAccountId:', defaultAccountId);
      console.log('[CreateTransactionDialog] ngAfterViewInit - targetAccountId:', targetAccountId);

      const selectedAccount = targetAccountId ? accounts.find((a) => a._id === targetAccountId) : accounts[0];
      console.log(
        '[CreateTransactionDialog] ngAfterViewInit - selectedAccount:',
        selectedAccount?.name,
        selectedAccount?._id
      );
      this.selectedBankAccount.set(selectedAccount ?? accounts[0]);

      // When opened from a bank account page, treat the preselected account as user-chosen
      // so a merchant's suggestedBankAccountId doesn't override it.
      if (contextAccountId) {
        this.accountManuallySelected.set(true);
      }
    }

    if (this.dialogRef.draft) {
      this.applyDraft(this.dialogRef.draft);
    } else if (this.dialogRef.initialDate) {
      // Lightweight prefill (e.g. Planned calendar day click): just the date; a future
      // date makes this a planned transaction with the default 'once' recurrence.
      const initialDate = this.parseIsoDate(this.dialogRef.initialDate);
      if (initialDate) {
        this.selectedDate.set(initialDate);
      }
    }

    // Focus the amount input on dialog open
    setTimeout(() => {
      this.amountEditor()?.focus();
    }, 100);
  }

  onDateChange(date: Date | null | undefined) {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
      return;
    }

    this.selectedDate.set(date);
  }

  private applyDraft(draft: CreateTransactionDialogDraft): void {
    const bankAccount = this.bankAccounts().find((account) => account._id === draft.bankAccountId) ?? null;
    if (bankAccount) {
      this.selectedBankAccount.set(bankAccount);
      this.accountManuallySelected.set(true);
    }

    const date = this.parseIsoDate(draft.date);
    if (date) {
      this.selectedDate.set(date);
    }
    this.recurrence.set(draft.recurrence);

    const amount = Number(draft.amount);
    this.transactionAmountValue.set(amount);
    this.amountSign.set(draft.amount < 0n ? 'outflow' : 'inflow');

    this.transactionNotes.set(draft.notes ?? '');
    this.isPending.set(draft.status === 'pending');

    this.systemType.set(null);
    this.isTransfer.set(draft.type === 'transfer');
    this.selectedPayeeBankAccountId.set(draft.transferToAccountId ?? null);

    if (draft.type === 'regular') {
      this.selectedMerchantIdValue.set(draft.merchantId ?? null);
      this.pendingMerchantName.set(draft.merchantId ? null : (draft.pendingMerchantName ?? null));
    } else {
      this.selectedMerchantIdValue.set(null);
      this.pendingMerchantName.set(null);
    }

    if (draft.movements.length > 1) {
      const splits = draft.movements.map((movement) => ({
        amount: movement.amount,
        categoryId: movement.categoryId,
        readyToAssign: movement.readyToAssign ?? false,
      }));
      this.localSplits.set(splits);
      this.initialSplits.set(splits.map((split) => ({ ...split })));
      this.isSplitMode.set(true);
      this.selectedCategory.set(null);
      this.readyToAssign.set(false);
      this.categoryManuallySelected.set(true);
      return;
    }

    const movement = draft.movements[0];
    if (movement?.readyToAssign) {
      this.selectedCategory.set(null);
      this.readyToAssign.set(true);
      this.categoryManuallySelected.set(true);
    } else if (movement?.categoryId) {
      const category = this.categories().find((candidate) => candidate._id === movement.categoryId) ?? null;
      this.selectedCategory.set(category);
      this.readyToAssign.set(false);
      this.categoryManuallySelected.set(true);
    }
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

  onAmountChange(value: number) {
    // Value is already in base units (cents) from the arithmetic input
    // Apply the current sign (from radio button) to the entered value
    const absoluteValue = Math.abs(value);
    const currentSign = this.amountSign();
    const signedValue = currentSign === 'outflow' ? -absoluteValue : absoluteValue;
    this.transactionAmountValue.set(signedValue);
  }

  onSignChange(sign: 'inflow' | 'outflow') {
    this.amountSign.set(sign);
    // Update the amount value with the new sign if there's an existing amount
    const currentAmount = this.transactionAmountValue();
    if (currentAmount !== null) {
      const absoluteAmount = Math.abs(currentAmount);
      const newAmount = sign === 'outflow' ? -absoluteAmount : absoluteAmount;
      this.transactionAmountValue.set(newAmount);
    }
    this.normalizeLocalSplitSigns(sign);
  }

  onBankAccountChange(accountId: string | null) {
    const account = accountId ? (this.bankAccounts().find((a) => a._id === accountId) ?? null) : null;
    this.selectedBankAccount.set(account);
    // Mark as manually selected so merchant suggestions don't override
    this.accountManuallySelected.set(true);
  }

  onCategoryChange(categoryId: string | null | 'ready-to-assign') {
    // Mark as manually selected so merchant suggestions don't override
    this.categoryManuallySelected.set(true);

    if (categoryId === 'ready-to-assign') {
      this.selectedCategory.set(null);
      this.readyToAssign.set(true);
    } else {
      this.readyToAssign.set(false);
      const category = categoryId ? (this.categories().find((c: Category) => c._id === categoryId) ?? null) : null;
      this.selectedCategory.set(category);
    }
  }

  onPayeeChange(change: PayeeChangeEvent) {
    if (change.type === 'system' && change.systemPayeeType) {
      // System type selected (Starting Balance or Balance Adjustment)
      this.systemType.set(change.systemPayeeType);
      this.isTransfer.set(false);
      this.selectedPayeeBankAccountId.set(null);
      // Clear merchant selection
      this.selectedMerchantIdValue.set(null);
      this.pendingMerchantName.set(null);
    } else if (change.type === 'bankAccount') {
      // Bank account selected - this is a transfer
      this.systemType.set(null);
      this.isTransfer.set(true);
      this.selectedPayeeBankAccountId.set(change.id);
      this.clampFutureDateToToday();
      // Clear merchant selection
      this.selectedMerchantIdValue.set(null);
      this.pendingMerchantName.set(null);

      // If the selected payee bank account is the same as the "from" bank account, clear it
      if (change.id === this.selectedBankAccountId()) {
        this.selectedBankAccount.set(null);
      }
    } else {
      // Merchant selected - this is a regular transaction
      this.systemType.set(null);
      this.isTransfer.set(false);
      this.selectedPayeeBankAccountId.set(null);

      if (change.pendingName) {
        this.pendingMerchantName.set(change.pendingName);
        this.selectedMerchantIdValue.set(null);
      } else {
        this.pendingMerchantName.set(null);
        this.selectedMerchantIdValue.set(change.id);

        // Auto-apply merchant suggestions for existing merchants
        if (change.id) {
          const merchant = this.merchants().find((m) => m._id === change.id);
          if (merchant) {
            // Auto-apply first category suggestion if user hasn't manually selected (skip for off-budget accounts)
            if (
              !this.categoryManuallySelected() &&
              !this.isSelectedAccountOffBudget() &&
              merchant.suggestedCategoryIds?.length
            ) {
              const firstSuggestionId = merchant.suggestedCategoryIds[0];
              const category = this.categories().find((c: Category) => c._id === firstSuggestionId);
              if (category) {
                this.selectedCategory.set(category);
              }
            }

            // Auto-apply account suggestion if user hasn't manually selected
            if (!this.accountManuallySelected() && merchant.suggestedBankAccountId) {
              const account = this.bankAccounts().find((a) => a._id === merchant.suggestedBankAccountId);
              if (account) {
                this.selectedBankAccount.set(account);
              }
            }
          }
        }
      }
    }
  }

  // System types don't support future dates, so clamp back to today if the user
  // picked a future date while still in a schedulable mode.
  private clampFutureDateToToday(): void {
    if (!this.isDateTodayOrPast()) {
      this.selectedDate.set(new Date());
    }
  }

  onBankAccountChangeForTransfer(accountId: string | null) {
    // If changing the "from" bank account and it matches the payee bank account, clear the payee
    // Stay in transfer mode so user can select a different To account
    if (accountId && accountId === this.selectedPayeeBankAccountId()) {
      this.selectedPayeeBankAccountId.set(null);
    }
    this.onBankAccountChange(accountId);
  }

  togglePending(): void {
    this.isPending.update((current) => !current);
  }

  onNotesInput(): void {
    const editor = this.notesEditor()?.nativeElement;
    if (editor) {
      this.transactionNotes.set(editor.value ?? '');
    }
  }

  onNotesKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      (event.target as HTMLElement).blur();
    }
  }

  @HostListener('keydown', ['$event'])
  onDialogKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void this.createTransaction();
  }

  onAmountEnterKey(): void {
    if (!this.creating()) {
      void this.createTransaction();
    }
  }

  async createTransaction() {
    if (this.creating()) {
      return;
    }

    // Evaluate any pending arithmetic expression before submitting
    const editor = this.amountEditor();
    if (editor) {
      const evaluatedValue = editor.getValue();
      if (evaluatedValue !== 0 || this.transactionAmountValue() !== null) {
        this.onAmountChange(evaluatedValue);
      }
    }
    const amount = this.transactionAmountValue();
    const bankAccount = this.selectedBankAccount();
    const category = this.selectedCategory();
    const merchant = this.selectedMerchantId();
    const pendingMerchantName = this.pendingMerchantName();
    const isTransfer = this.isTransfer();
    const payeeBankAccountId = this.selectedPayeeBankAccountId();
    const systemTypeValue = this.systemType();

    if (amount === null) {
      toast.error('Amount is required');
      return;
    }

    if (!bankAccount) {
      toast.error('Bank account is required');
      return;
    }

    // Validate transfer-specific requirements
    if (isTransfer && !payeeBankAccountId) {
      toast.error('Please select a destination account for the transfer');
      return;
    }

    try {
      this._creating.set(true);

      // Format date as YYYY-MM-DD in local timezone
      const date = this.selectedDate();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateString = `${year}-${month}-${day}`;

      const notes = this.transactionNotes();
      const workspaceId = this.workspaceService.workspaceId();

      if (!workspaceId) {
        toast.error('No workspace selected');
        return;
      }

      if (systemTypeValue) {
        // Create starting balance or balance adjustment transaction
        const mutation =
          systemTypeValue === 'starting_balance'
            ? api.transactions.createStartingBalanceTransaction
            : api.transactions.createBalanceAdjustmentTransaction;

        const newTransactionId = await this.convexService.mutation<Id<'transaction'>>(mutation, {
          workspaceId: workspaceId as Id<'workspace'>,
          bankAccountId: bankAccount._id,
          date: dateString,
          movements: [
            {
              amount: BigInt(amount),
              readyToAssign: true,
            },
          ],
          notes: notes || undefined,
        });

        this.dialogRef.close();

        if (newTransactionId) {
          const typeLabel = systemTypeValue === 'starting_balance' ? 'Starting balance' : 'Balance adjustment';
          toast.success(`${typeLabel} created`, {
            action: {
              label: 'View',
              onClick: () => {
                void this.navigationService.navigateToTransaction(newTransactionId);
              },
            },
          });
        }
      } else if (isTransfer && payeeBankAccountId) {
        // Create transfer transaction
        // Determine fromAccountId and toAccountId based on amount sign
        // Negative amount = outflow from current account TO payee account
        // Positive amount = inflow to current account FROM payee account
        const isOutflow = amount < 0;
        const fromAccountId = isOutflow ? bankAccount._id : (payeeBankAccountId as Id<'bankAccount'>);
        const toAccountId = isOutflow ? (payeeBankAccountId as Id<'bankAccount'>) : bankAccount._id;

        const result = await this.transactionService.createTransfer({
          fromAccountId,
          toAccountId,
          amount: BigInt(Math.abs(amount)), // Transfer API expects positive amount
          date: dateString,
          notes: notes || undefined,
          ...(this.isCrossBudgetTransfer() && category?._id && { categoryId: category._id }),
          ...(this.isCrossBudgetTransfer() && this.readyToAssign() && { readyToAssign: true }),
          recurrence: this.recurrence(),
        });

        if (!(await this.applyPlannedOptions(result))) {
          this.closeWithPlannedOptionsError(result);
          return;
        }
        this.closeAndShowCreateResultToast(result, 'Transfer created', 'Transfer');
      } else {
        // Create regular transaction
        // Create new merchant if needed
        let merchantId: Id<'merchant'> | undefined = merchant as Id<'merchant'> | undefined;
        if (pendingMerchantName && !merchant) {
          const newMerchant = await this.merchantService.findOrCreateMerchant(pendingMerchantName);
          merchantId = newMerchant._id;
        }

        // Check if we're in split mode and have valid splits
        const inSplitMode = this.isSplitMode();
        const splits = this.localSplits();

        if (inSplitMode && splits.length > 0) {
          // Validate splits sum to transaction amount
          const splitsSum = splits.reduce((sum, split) => sum + (split.amount ?? 0n), 0n);
          const transactionAmount = BigInt(amount);

          if (splitsSum !== transactionAmount) {
            toast.error('Split amounts must sum to the transaction total');
            return;
          }

          if (splits.some((split) => split.amount === undefined || split.amount === 0n)) {
            toast.error('All splits must have an amount');
            return;
          }

          // Create transaction with multiple movements (splits)
          const movements = splits.map((split) => ({
            amount: split.amount!,
            categoryId: split.categoryId,
            readyToAssign: split.readyToAssign ?? false,
          }));

          const result = await this.convexService.mutation<CreateScheduledTransactionResult>(
            api.transactions.createRegularTransaction,
            {
              workspaceId: workspaceId as Id<'workspace'>,
              date: dateString,
              bankAccountId: bankAccount._id,
              movements,
              ...(merchantId && { merchantId }),
              status: this.isPending() ? 'pending' : 'cleared',
              ...(notes && { notes }),
              ...(this.recurrence() !== 'once' && { recurrence: this.recurrence() }),
            }
          );

          if (!(await this.applyPlannedOptions(result))) {
            this.closeWithPlannedOptionsError(result);
            return;
          }
          this.closeAndShowCreateResultToast(result, 'Split transaction created');
        } else {
          // Create transaction - amount already in cents from currency input
          // User enters the sign themselves (negative for expenses, positive for income)
          const result = await this.transactionService.createTransaction({
            bankAccountId: bankAccount._id,
            amount: BigInt(amount),
            date: dateString,
            categoryId: category?._id,
            readyToAssign: this.readyToAssign(),
            merchantId,
            status: this.isPending() ? 'pending' : 'cleared',
            notes: notes || undefined,
            recurrence: this.recurrence(),
          });

          if (!(await this.applyPlannedOptions(result))) {
            this.closeWithPlannedOptionsError(result);
            return;
          }
          if (typeof result === 'string') {
            const newTransactionId = result;
            this.dialogRef.close(result);
            this.undoRedoService.pushAction({
              description: 'Transaction created',
              type: 'transaction-create',
              timestamp: Date.now(),
              undo: async () => {
                const deleted = await this.transactionService.deleteTransaction(newTransactionId);
                if (!deleted) throw new Error('Failed to delete transaction');
              },
              redo: async () => {
                const restored = await this.transactionService.restoreTransaction(newTransactionId);
                if (!restored) throw new Error('Failed to restore transaction');
              },
            });

            toast.success('Transaction created', {
              action: {
                label: 'Undo',
                onClick: () => void this.undoRedoService.undo(),
              },
            });
          } else if (result) {
            this.closeAndShowCreateResultToast(result, 'Transaction created');
          } else {
            this.dialogRef.close();
          }
        }
      }
    } catch (error: unknown) {
      console.error('Error creating transaction:', error);
      const errorMessage = extractConvexErrorMessage(error, 'Failed to create transaction');
      toast.error(errorMessage);
    } finally {
      this._creating.set(false);
    }
  }

  private async applyPlannedOptions(result: CreateScheduledTransactionResult | null): Promise<boolean> {
    if (!result || typeof result === 'string') {
      return true;
    }

    try {
      await this.scheduledTransactionService.updateScheduledTransaction(
        buildPlannedOptionsUpdate(result.scheduledTransactionId, this.enterAutomatically(), this.reminderSelection())
      );
      return true;
    } catch (error: unknown) {
      console.error('Failed to save planned transaction options:', error);
      return false;
    }
  }

  private closeWithPlannedOptionsError(result: CreateScheduledTransactionResult | null): void {
    this.dialogRef.close(result);
    if (!result || typeof result === 'string') {
      return;
    }

    toast.error('Planned transaction created, but its options could not be saved', {
      action: {
        label: 'View',
        onClick: () => {
          void this.navigationService.navigateToPlannedTransaction(result.scheduledTransactionId);
        },
      },
    });
  }

  /**
   * Show the right toast for the createRegularTransaction result union: a plain id means a
   * transaction was entered (legacy path); an object means a schedule was created, with an
   * immediate transaction too when the date was today/past and a recurrence was set.
   */
  private showCreateResultToast(
    result: CreateScheduledTransactionResult | null,
    createdMessage: string,
    scheduledSubject = 'Transaction'
  ): void {
    if (!result) {
      return;
    }

    if (typeof result === 'string') {
      const transactionId = result;
      toast.success(createdMessage, {
        action: {
          label: 'View',
          onClick: () => {
            void this.navigationService.navigateToTransaction(transactionId);
          },
        },
      });
      return;
    }

    const nextDateLabel = this.formatScheduleDate(result.nextDate);
    const repeatLabel = recurrenceLabel(this.recurrence()).toLowerCase();

    if (result.transactionId) {
      const transactionId = result.transactionId;
      toast.success(createdMessage, {
        description: `Repeats ${repeatLabel} · next on ${nextDateLabel}`,
        action: {
          label: 'View',
          onClick: () => {
            void this.navigationService.navigateToTransaction(transactionId);
          },
        },
      });
    } else {
      toast.success(`${scheduledSubject} scheduled for ${nextDateLabel}`, {
        ...(this.recurrence() !== 'once' && { description: `Repeats ${repeatLabel}` }),
        action: {
          label: 'View',
          onClick: () => {
            void this.navigationService.navigateToPlannedTransaction(result.scheduledTransactionId);
          },
        },
      });
    }
  }

  private closeAndShowCreateResultToast(
    result: CreateScheduledTransactionResult | null,
    createdMessage: string,
    scheduledSubject = 'Transaction'
  ): void {
    if (this.dialogRef.source === 'transaction-details') {
      this.showCreateResultToast(result, createdMessage, scheduledSubject);
      this.dialogRef.close(result);
      return;
    }

    this.dialogRef.close(result);
    this.showCreateResultToast(result, createdMessage, scheduledSubject);
  }

  private formatScheduleDate(isoDate: string): string {
    const [year, month, day] = isoDate.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  // Split mode handlers
  handleEnterSplitMode() {
    const category = this.selectedCategory();

    // Initialize splits with a single empty split row, pre-selecting the current category if one exists
    const initialSplit: Split = {};

    if (category?._id) {
      initialSplit.categoryId = category._id;
    }
    // Amount remains empty (undefined)

    const splits = [initialSplit];

    // Store initial splits for change tracking
    this.initialSplits.set(splits.map((split) => ({ ...split })));
    this.localSplits.set(splits);
    this.isSplitMode.set(true);

    // Clear the single category selection since we're now in split mode
    this.selectedCategory.set(null);
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
      // If this is the last split, exit split mode instead of keeping an empty row
      if (prev.length === 1) {
        this.handleExitSplitMode();
        return [];
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

  private getSubmitShortcutModifier(): '⌘' | 'Ctrl' {
    if (typeof navigator === 'undefined') {
      return 'Ctrl';
    }

    return /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? '⌘' : 'Ctrl';
  }
}
