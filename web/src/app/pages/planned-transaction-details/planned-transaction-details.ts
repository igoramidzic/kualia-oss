import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { Id } from 'convex/_generated/dataModel';
import {
  nucleoBell as BellRing,
  nucleoCalendarCheck as CalendarArrowDown,
  nucleoCalendarClock as CalendarClock,
  nucleoCheck as Check,
  nucleoChevronDown as ChevronDown,
  nucleoChevronRight as ChevronRight,
  nucleoHistory as ClockFading,
  nucleoLoader as LoaderCircle,
  NucleoIcon,
  nucleoPause as Pause,
  nucleoPlay as Play,
  nucleoSkip as SkipForward,
  nucleoShop as Store,
} from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { confirmSkipPlannedTransaction } from '../../components/dialogs/skip-planned-transaction-dialog/skip-planned-transaction-dialog';
import { TransactionRowBriefComponent } from '../../components/transaction-row/transaction-row-brief';
import { AmountSignToggleComponent } from '../../components/transaction/amount-sign-toggle.component';
import { BankAccountSelectorComponent } from '../../components/transaction/bank-account-selector.component';
import { CategorySelectorComponent } from '../../components/transaction/category-selector.component';
import { PayeeChangeEvent, PayeeSelectorComponent } from '../../components/transaction/payee-selector.component';
import { TransactionDatePickerComponent } from '../../components/transaction/transaction-date-picker.component';
import { Split, TransactionSplitsComponent } from '../../components/transaction/transaction-splits.component';
import { BankAccountService } from '../../services/bank-account.service';
import { CurrencyService } from '../../services/currency.service';
import { MerchantService } from '../../services/merchant.service';
import { NavigationService } from '../../services/navigation.service';
import {
  SCHEDULED_REMINDER_OPTIONS,
  ScheduledMovementInput,
  ScheduledReminderOffset,
  ScheduledReminderSelection,
  ScheduledTransactionService,
  UpdateScheduledTransactionInput,
  UpdateScheduledTransactionResult,
} from '../../services/scheduled-transaction.service';
import { ArithmeticCurrencyInputComponent } from '../../shared/components/arithmetic-currency-input/arithmetic-currency-input.component';
import { extractConvexErrorMessage } from '../../shared/utils/convex-error-message';
import { getCurrencyFormat } from '../../shared/utils/currency';
import { dateToYearMonth } from '../../shared/utils/month.utils';
import { Recurrence } from '../../shared/utils/recurrence.utils';
import { HlmTextarea } from '../../ui/textarea/src/lib/hlm-textarea';
import { PlannedTransactionPageService } from '../planned-transaction/planned-transaction-page.service';

interface OptimisticPlannedFields {
  merchantId?: Id<'merchant'> | null;
  bankAccountId?: Id<'bankAccount'>;
  transferToAccountId?: Id<'bankAccount'> | null;
  transactionType?: 'regular' | 'transfer';
  categoryId?: Id<'category'> | null;
  readyToAssign?: boolean;
  date?: string;
  recurrence?: Recurrence;
  entryStatus?: 'pending' | 'cleared';
  entryMode?: 'auto' | 'manual';
  reminderSelection?: ScheduledReminderSelection;
  status?: 'active' | 'paused' | 'completed';
}

/**
 * Detail body for a planned (scheduled) transaction. Mirrors the transaction detail page
 * (same field editors and layout) but persists through updateScheduledTransaction, adds
 * Enter now / Skip / Pause actions plus entry-mode and reminder settings, and lists the
 * real transactions this schedule has already created underneath.
 */
@Component({
  selector: 'app-planned-transaction-details',
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    HlmButton,
    NucleoIcon,
    AmountSignToggleComponent,
    ArithmeticCurrencyInputComponent,
    PayeeSelectorComponent,
    BankAccountSelectorComponent,
    CategorySelectorComponent,
    TransactionSplitsComponent,
    TransactionDatePickerComponent,
    TransactionRowBriefComponent,
    HlmTextarea,
    HlmSelectImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './planned-transaction-details.html',
  host: { class: 'block h-full' },
})
export class PlannedTransactionDetailsComponent {
  protected readonly Store = Store;
  protected readonly Check = Check;
  protected readonly ClockFading = ClockFading;
  protected readonly CalendarArrowDown = CalendarArrowDown;
  protected readonly CalendarClock = CalendarClock;
  protected readonly LoaderCircle = LoaderCircle;
  protected readonly ChevronDown = ChevronDown;
  protected readonly ChevronRight = ChevronRight;
  protected readonly Pause = Pause;
  protected readonly Play = Play;
  protected readonly SkipForward = SkipForward;
  protected readonly BellRing = BellRing;
  protected readonly reminderOptions = SCHEDULED_REMINDER_OPTIONS;
  protected readonly compactSelectTriggerClass =
    'h-8 border-transparent bg-transparent px-1 py-0 text-xs shadow-none hover:bg-accent hover:text-accent-foreground focus-visible:border-transparent focus-visible:ring-0';

  private readonly pageService = inject(PlannedTransactionPageService);
  private readonly scheduledService = inject(ScheduledTransactionService);
  private readonly currencyService = inject(CurrencyService);
  private readonly merchantService = inject(MerchantService);
  private readonly bankAccountService = inject(BankAccountService);
  private readonly navigationService = inject(NavigationService);
  private readonly dialogService = inject(HlmDialogService);

  readonly scheduled = this.pageService.scheduled;
  readonly isLoading = this.pageService.isLoading;

  // Entered (linked) transactions
  readonly enteredTransactions = this.pageService.sortedTransactions;
  readonly enteredLoading = this.pageService.transactionsLoading;
  readonly enteredLoadingMore = this.pageService.loadingMore;
  readonly enteredHasMore = this.pageService.hasMore;
  readonly enteredError = this.pageService.transactionsError;
  readonly enteredExpanded = signal<boolean>(true);

  readonly currencySymbol = computed(() => getCurrencyFormat(this.currencyService.currencyCode()).symbol);
  readonly bankAccounts = this.bankAccountService.bankAccounts;

  // Local edit state for typed fields
  readonly amountSign = signal<'inflow' | 'outflow'>('outflow');
  readonly amountAbs = signal<number>(0);
  readonly notes = signal<string>('');
  readonly optimisticMerchantName = signal<string | null>(null);
  private readonly optimisticFields = signal<OptimisticPlannedFields>({});

  // Split editing
  readonly isSplitMode = signal<boolean>(false);
  readonly localSplits = signal<Split[]>([]);
  readonly initialSplits = signal<Split[]>([]);

  // Saving flags
  readonly savingAmount = signal<boolean>(false);
  readonly savingMerchant = signal<boolean>(false);
  readonly savingBankAccount = signal<boolean>(false);
  readonly savingCategory = signal<boolean>(false);
  readonly savingDate = signal<boolean>(false);
  readonly savingRecurrence = signal<boolean>(false);
  readonly savingEntryStatus = signal<boolean>(false);
  readonly savingEntryMode = signal<boolean>(false);
  readonly savingPaused = signal<boolean>(false);
  readonly savingReminder = signal<boolean>(false);
  readonly savingNotes = signal<boolean>(false);
  readonly savingSplits = signal<boolean>(false);
  readonly entering = signal<boolean>(false);
  readonly skipping = signal<boolean>(false);

  private syncedId: string | null = null;

  readonly signedAmount = computed(() => (this.amountSign() === 'outflow' ? -this.amountAbs() : this.amountAbs()));
  readonly signedAmountBigInt = computed(() => BigInt(Math.round(this.signedAmount())));

  readonly firstMovement = computed(() => this.scheduled()?.movements[0]);
  readonly displayCategoryId = computed(() => {
    const optimistic = this.optimisticFields();
    return 'categoryId' in optimistic ? (optimistic.categoryId ?? null) : (this.firstMovement()?.categoryId ?? null);
  });
  readonly displayReadyToAssign = computed(() => {
    const optimistic = this.optimisticFields();
    return 'readyToAssign' in optimistic
      ? (optimistic.readyToAssign ?? false)
      : (this.firstMovement()?.readyToAssign ?? false);
  });
  readonly displayMerchantId = computed(() => {
    const optimistic = this.optimisticFields();
    return 'merchantId' in optimistic ? (optimistic.merchantId ?? null) : (this.scheduled()?.merchantId ?? null);
  });
  readonly displayBankAccountId = computed(() => {
    const optimistic = this.optimisticFields();
    return 'bankAccountId' in optimistic
      ? (optimistic.bankAccountId ?? null)
      : (this.scheduled()?.bankAccountId ?? null);
  });
  readonly transactionType = computed(() =>
    'transactionType' in this.optimisticFields()
      ? (this.optimisticFields().transactionType ?? 'regular')
      : (this.scheduled()?.transactionType ?? 'regular')
  );
  readonly isTransfer = computed(() => this.transactionType() === 'transfer');
  readonly displayTransferToAccountId = computed(() => {
    const optimistic = this.optimisticFields();
    return 'transferToAccountId' in optimistic
      ? (optimistic.transferToAccountId ?? null)
      : (this.scheduled()?.transferToAccountId ?? null);
  });
  readonly transferPayeeAccounts = computed(() => {
    const sourceAccountId = this.displayBankAccountId();
    const destinationAccountId = this.displayTransferToAccountId();
    return this.bankAccounts().filter(
      (account) =>
        !account.isDeleted &&
        (account._id !== sourceAccountId || account._id === destinationAccountId) &&
        (!account.isClosed || account._id === destinationAccountId)
    );
  });
  readonly transferSourceExcludeIds = computed(() => {
    const destinationAccountId = this.displayTransferToAccountId();
    return destinationAccountId ? [destinationAccountId] : [];
  });
  readonly displayDate = computed(() => {
    const optimistic = this.optimisticFields();
    const iso = 'date' in optimistic ? optimistic.date : this.scheduled()?.nextDate;
    if (!iso) return new Date();
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(year, month - 1, day);
  });
  readonly displayYearMonth = computed(() => dateToYearMonth(this.displayDate()));
  readonly recurrence = computed<Recurrence>(() => {
    const optimistic = this.optimisticFields();
    return 'recurrence' in optimistic ? (optimistic.recurrence ?? 'once') : (this.scheduled()?.recurrence ?? 'once');
  });
  readonly isPending = computed(() => {
    const optimistic = this.optimisticFields();
    const status = 'entryStatus' in optimistic ? optimistic.entryStatus : this.scheduled()?.entryStatus;
    return status === 'pending';
  });
  readonly displayStatus = computed(() => {
    const optimistic = this.optimisticFields();
    return 'status' in optimistic ? optimistic.status : this.scheduled()?.status;
  });
  readonly isCompleted = computed(() => this.displayStatus() === 'completed');
  readonly isPaused = computed(() => this.displayStatus() === 'paused');
  readonly isActive = computed(() => this.displayStatus() === 'active');
  readonly isEditable = computed(() => !this.isCompleted());
  // Missing entryMode means 'auto' (backend contract)
  readonly isAutoEntry = computed(() => {
    const optimistic = this.optimisticFields();
    const entryMode = 'entryMode' in optimistic ? optimistic.entryMode : this.scheduled()?.entryMode;
    return (entryMode ?? 'auto') === 'auto';
  });
  readonly reminderEnabled = computed(() => this.scheduled()?.reminderEnabled ?? false);
  readonly reminderOffset = computed<ScheduledReminderOffset>(() => this.scheduled()?.reminderOffset ?? 'on_due_date');
  readonly reminderSelection = computed<ScheduledReminderSelection>(() => {
    const optimistic = this.optimisticFields();
    return 'reminderSelection' in optimistic
      ? (optimistic.reminderSelection ?? 'none')
      : this.reminderEnabled()
        ? this.reminderOffset()
        : 'none';
  });
  readonly reminderToString = (value: ScheduledReminderSelection): string =>
    this.reminderOptions.find((option) => option.value === value)?.label ?? 'No reminder';
  readonly isCrossBudgetTransfer = computed(() => {
    if (!this.isTransfer()) return false;
    const source = this.bankAccounts().find((account) => account._id === this.displayBankAccountId());
    const destination = this.bankAccounts().find((account) => account._id === this.displayTransferToAccountId());
    if (!source || !destination) return false;
    return this.isOnBudgetAccountType(source.accountType) !== this.isOnBudgetAccountType(destination.accountType);
  });
  readonly nextDueDateLabel = computed(() => {
    const scheduled = this.scheduled();
    return scheduled ? this.formatDisplayDate(scheduled.nextDate) : null;
  });

  readonly busy = computed(() => this.entering() || this.skipping() || this.savingSplits());

  constructor() {
    // (Re)initialize local form state whenever a different schedule loads
    effect(() => {
      const scheduled = this.scheduled();
      if (!scheduled || this.syncedId === scheduled._id) return;
      this.syncedId = scheduled._id;
      this.optimisticFields.set({});
      this.optimisticMerchantName.set(null);

      const total = scheduled.movements.reduce((sum, m) => sum + m.amount, 0n);
      this.amountSign.set(scheduled.transactionType === 'transfer' || total < 0n ? 'outflow' : 'inflow');
      this.amountAbs.set(Math.abs(Number(total)));
      this.notes.set(scheduled.notes ?? '');

      if (scheduled.movements.length > 1) {
        this.enterSplitModeFromMovements();
      } else {
        this.isSplitMode.set(false);
        this.localSplits.set([]);
        this.initialSplits.set([]);
      }
    });
  }

  private setOptimisticFields(fields: Partial<OptimisticPlannedFields>): void {
    this.optimisticFields.update((current) => ({ ...current, ...fields }));
  }

  private clearOptimisticFields(...keys: (keyof OptimisticPlannedFields)[]): void {
    this.optimisticFields.update((current) => {
      const next = { ...current };
      for (const key of keys) {
        delete next[key];
      }
      return next;
    });
  }

  private isOnBudgetAccountType(accountType: string): boolean {
    return accountType.startsWith('banking_') || accountType.startsWith('credit_');
  }

  private buildSingleMovement(): ScheduledMovementInput {
    const notes = this.firstMovement()?.notes;
    const readyToAssign = this.displayReadyToAssign();
    const categoryId = this.displayCategoryId();
    return {
      amount: this.isTransfer() ? this.amountAbsBigInt() : this.signedAmountBigInt(),
      ...(readyToAssign ? { readyToAssign: true } : categoryId ? { categoryId } : {}),
      ...(notes ? { notes } : {}),
    };
  }

  private async patch(
    input: Omit<UpdateScheduledTransactionInput, 'scheduledTransactionId'>
  ): Promise<UpdateScheduledTransactionResult | null> {
    const scheduled = this.scheduled();
    if (!scheduled || !this.ensureEditable()) return null;
    const transactionType = input.transactionType ?? scheduled.transactionType ?? 'regular';
    const update: UpdateScheduledTransactionInput = {
      scheduledTransactionId: scheduled._id,
      transactionType,
      ...input,
    };

    if (transactionType === 'transfer') {
      update.bankAccountId = input.bankAccountId ?? scheduled.bankAccountId;
      update.transferToAccountId = input.transferToAccountId ?? scheduled.transferToAccountId ?? null;
      update.merchantId = null;
    }

    return this.scheduledService.updateScheduledTransaction(update);
  }

  private ensureEditable(): boolean {
    if (this.isEditable()) {
      return true;
    }
    toast.info('Schedule completed', {
      description: 'This planned transaction has already been entered.',
    });
    return false;
  }

  private amountAbsBigInt(): bigint {
    return BigInt(Math.round(Math.abs(this.amountAbs())));
  }

  private buildTransferConversionMovement(): ScheduledMovementInput {
    const first = this.firstMovement();
    return {
      amount: this.amountAbsBigInt(),
      ...(first?.readyToAssign ? { readyToAssign: true } : first?.categoryId ? { categoryId: first.categoryId } : {}),
      ...(first?.notes ? { notes: first.notes } : {}),
    };
  }

  private buildRegularMovementFromTransfer(): ScheduledMovementInput {
    const first = this.firstMovement();
    return {
      amount: -this.amountAbsBigInt(),
      ...(first?.readyToAssign ? { readyToAssign: true } : first?.categoryId ? { categoryId: first.categoryId } : {}),
      ...(first?.notes ? { notes: first.notes } : {}),
    };
  }

  private async resolveMerchantId(value: PayeeChangeEvent): Promise<Id<'merchant'> | null> {
    let merchantId = value.id ?? null;
    if (!merchantId && value.pendingName) {
      const merchant = await this.merchantService.findOrCreateMerchant(value.pendingName);
      merchantId = merchant._id;
    }
    return (merchantId as Id<'merchant'>) ?? null;
  }

  // --- Amount ---
  async onSignChange(sign: 'inflow' | 'outflow'): Promise<void> {
    if (!this.ensureEditable()) return;
    if (sign === this.amountSign()) return;
    if (this.isTransfer()) {
      await this.persistTransferDirection(sign);
      return;
    }
    this.amountSign.set(sign);
    if (!this.isSplitMode()) {
      await this.persistAmount();
    }
  }

  onAmountChange(value: number): void {
    if (!this.isEditable()) return;
    this.amountAbs.set(Math.abs(value));
  }

  onAmountBlur(): void {
    if (!this.ensureEditable()) return;
    if (!this.isSplitMode()) {
      void this.persistAmount();
    }
  }

  private async persistAmount(): Promise<void> {
    if (this.amountAbs() === 0) return;
    const scheduled = this.scheduled();
    if (!scheduled) return;
    const previousTotal = scheduled.movements.reduce((sum, movement) => sum + movement.amount, 0n);
    const previousSign =
      (scheduled.transactionType ?? 'regular') === 'transfer'
        ? this.amountSign()
        : previousTotal < 0n
          ? 'outflow'
          : 'inflow';
    this.savingAmount.set(true);
    try {
      await this.patch({ movements: [this.buildSingleMovement()] });
    } catch (err: unknown) {
      this.amountSign.set(previousSign);
      this.amountAbs.set(Math.abs(Number(previousTotal)));
      toast.error(extractConvexErrorMessage(err, 'Failed to update amount'));
    } finally {
      this.savingAmount.set(false);
    }
  }

  private async persistTransferDirection(sign: 'inflow' | 'outflow'): Promise<void> {
    const sourceAccountId = this.displayBankAccountId();
    const destinationAccountId = this.displayTransferToAccountId();
    if (!sourceAccountId || !destinationAccountId) return;

    this.savingAmount.set(true);
    this.amountSign.set(sign);
    this.setOptimisticFields({
      bankAccountId: destinationAccountId,
      transferToAccountId: sourceAccountId,
    });
    try {
      await this.patch({
        bankAccountId: destinationAccountId,
        transferToAccountId: sourceAccountId,
      });
    } catch (err: unknown) {
      this.amountSign.set(sign === 'outflow' ? 'inflow' : 'outflow');
      toast.error(extractConvexErrorMessage(err, 'Failed to update transfer direction'));
    } finally {
      this.clearOptimisticFields('bankAccountId', 'transferToAccountId');
      this.savingAmount.set(false);
    }
  }

  // --- Payee ---
  async onPayeeChange(value: PayeeChangeEvent): Promise<void> {
    if (!this.ensureEditable()) return;
    const isTransfer = this.isTransfer();

    if (isTransfer && value.type === 'bankAccount' && value.id) {
      if (value.id === this.displayTransferToAccountId()) return;
      this.savingMerchant.set(true);
      this.setOptimisticFields({ transferToAccountId: value.id as Id<'bankAccount'> });
      try {
        await this.patch({ transferToAccountId: value.id as Id<'bankAccount'> });
      } catch (err: unknown) {
        toast.error(extractConvexErrorMessage(err, 'Failed to update destination account'));
      } finally {
        this.clearOptimisticFields('transferToAccountId');
        this.savingMerchant.set(false);
      }
      return;
    }

    if (isTransfer && value.type === 'merchant') {
      this.savingMerchant.set(true);
      this.optimisticMerchantName.set(value.pendingName ?? null);
      this.setOptimisticFields({
        transactionType: 'regular',
        transferToAccountId: null,
        merchantId: value.id as Id<'merchant'> | null,
      });
      try {
        const merchantId = await this.resolveMerchantId(value);
        this.setOptimisticFields({ merchantId });
        await this.patch({
          transactionType: 'regular',
          transferToAccountId: null,
          merchantId,
          movements: [this.buildRegularMovementFromTransfer()],
        });
        this.amountSign.set('outflow');
        this.isSplitMode.set(false);
        this.localSplits.set([]);
        this.initialSplits.set([]);
      } catch (err: unknown) {
        toast.error(extractConvexErrorMessage(err, 'Failed to update payee'));
      } finally {
        this.optimisticMerchantName.set(null);
        this.clearOptimisticFields('transactionType', 'transferToAccountId', 'merchantId');
        this.savingMerchant.set(false);
      }
      return;
    }

    if (!isTransfer && value.type === 'bankAccount' && value.id) {
      if (value.id === this.displayBankAccountId()) return;
      this.savingMerchant.set(true);
      this.setOptimisticFields({
        transactionType: 'transfer',
        transferToAccountId: value.id as Id<'bankAccount'>,
        merchantId: null,
      });
      try {
        await this.patch({
          transactionType: 'transfer',
          transferToAccountId: value.id as Id<'bankAccount'>,
          merchantId: null,
          movements: [this.buildTransferConversionMovement()],
        });
        this.amountSign.set('outflow');
        this.isSplitMode.set(false);
        this.localSplits.set([]);
        this.initialSplits.set([]);
      } catch (err: unknown) {
        toast.error(extractConvexErrorMessage(err, 'Failed to update destination account'));
      } finally {
        this.clearOptimisticFields('transactionType', 'transferToAccountId', 'merchantId');
        this.savingMerchant.set(false);
      }
      return;
    }

    if (value.type !== 'merchant') return;
    this.savingMerchant.set(true);
    this.optimisticMerchantName.set(value.pendingName ?? null);
    this.setOptimisticFields({ merchantId: value.id as Id<'merchant'> | null });
    try {
      const merchantId = await this.resolveMerchantId(value);
      this.setOptimisticFields({ merchantId });
      await this.patch({ merchantId });
    } catch (err: unknown) {
      toast.error(extractConvexErrorMessage(err, 'Failed to update payee'));
    } finally {
      this.optimisticMerchantName.set(null);
      this.clearOptimisticFields('merchantId');
      this.savingMerchant.set(false);
    }
  }

  // --- Bank account ---
  async onBankAccountChange(newBankAccountId: string | null): Promise<void> {
    if (!this.ensureEditable()) return;
    if (!newBankAccountId) return;
    if (newBankAccountId === this.displayBankAccountId()) return;
    this.savingBankAccount.set(true);
    this.setOptimisticFields({ bankAccountId: newBankAccountId as Id<'bankAccount'> });
    try {
      await this.patch({ bankAccountId: newBankAccountId as Id<'bankAccount'> });
    } catch (err: unknown) {
      toast.error(extractConvexErrorMessage(err, 'Failed to update account'));
    } finally {
      this.clearOptimisticFields('bankAccountId');
      this.savingBankAccount.set(false);
    }
  }

  // --- Category (single movement) ---
  async selectCategory(value: string | null | 'ready-to-assign'): Promise<void> {
    if (!this.ensureEditable()) return;
    this.savingCategory.set(true);
    this.setOptimisticFields({
      categoryId: value === 'ready-to-assign' ? null : (value as Id<'category'> | null),
      readyToAssign: value === 'ready-to-assign',
    });
    try {
      const notes = this.firstMovement()?.notes;
      const movement: ScheduledMovementInput = {
        amount: this.isTransfer() ? this.amountAbsBigInt() : this.signedAmountBigInt(),
        ...(value === 'ready-to-assign'
          ? { readyToAssign: true }
          : value
            ? { categoryId: value as Id<'category'> }
            : {}),
        ...(notes ? { notes } : {}),
      };
      await this.patch({ movements: [movement] });
    } catch (err: unknown) {
      toast.error(extractConvexErrorMessage(err, 'Failed to update category'));
    } finally {
      this.clearOptimisticFields('categoryId', 'readyToAssign');
      this.savingCategory.set(false);
    }
  }

  // --- Date (next occurrence) ---
  async selectDate(newDate: Date): Promise<void> {
    if (!this.ensureEditable()) return;
    const iso = this.formatDateToISO(newDate);
    if (iso === this.scheduled()?.nextDate) return;
    const scheduled = this.scheduled();
    if (!scheduled) return;

    const enterDue = this.isDueDate(iso);
    if (enterDue) {
      const confirmed = await this.scheduledService.confirmEnterDueDate(scheduled, iso);
      if (!confirmed) {
        return;
      }
    }

    this.savingDate.set(true);
    this.setOptimisticFields({ date: iso });
    try {
      const result = await this.scheduledService.updateScheduledTransaction({
        scheduledTransactionId: scheduled._id,
        date: iso,
        ...(enterDue && { enterDue: true }),
      });
      if (result.entered) {
        const transactionId = result.transactionId;
        toast.success('Transaction entered', {
          ...(result.status === 'active' && {
            description: `Next occurrence on ${this.formatDisplayDate(result.nextDate)}`,
          }),
          ...(transactionId && {
            action: {
              label: 'View',
              onClick: () => void this.navigationService.navigateToTransaction(transactionId),
            },
          }),
        });
        await this.pageService.reload({ refreshLinkedTransactions: true });
      }
    } catch (err: unknown) {
      toast.error(extractConvexErrorMessage(err, 'Failed to update date'));
    } finally {
      this.clearOptimisticFields('date');
      this.savingDate.set(false);
    }
  }

  // --- Recurrence ---
  async selectRecurrence(recurrence: Recurrence): Promise<void> {
    if (!this.ensureEditable()) return;
    if (recurrence === this.recurrence()) return;
    this.savingRecurrence.set(true);
    this.setOptimisticFields({ recurrence });
    try {
      await this.patch({ recurrence });
    } catch (err: unknown) {
      toast.error(extractConvexErrorMessage(err, 'Failed to update recurrence'));
    } finally {
      this.clearOptimisticFields('recurrence');
      this.savingRecurrence.set(false);
    }
  }

  // --- Entry status ---
  async togglePending(): Promise<void> {
    if (!this.ensureEditable()) return;
    const entryStatus = this.isPending() ? 'cleared' : 'pending';
    this.savingEntryStatus.set(true);
    this.setOptimisticFields({ entryStatus });
    try {
      await this.patch({ entryStatus });
    } catch (err: unknown) {
      toast.error(extractConvexErrorMessage(err, 'Failed to update status'));
    } finally {
      this.clearOptimisticFields('entryStatus');
      this.savingEntryStatus.set(false);
    }
  }

  // --- Entry mode (Enter automatically) ---
  async onEntryModeToggle(autoEntry: boolean): Promise<void> {
    if (!this.ensureEditable()) return;
    if (autoEntry === this.isAutoEntry()) return;
    this.savingEntryMode.set(true);
    this.setOptimisticFields({ entryMode: autoEntry ? 'auto' : 'manual' });
    try {
      await this.patch({ entryMode: autoEntry ? 'auto' : 'manual' });
    } catch (err: unknown) {
      toast.error(extractConvexErrorMessage(err, 'Failed to update entry mode'));
    } finally {
      this.clearOptimisticFields('entryMode');
      this.savingEntryMode.set(false);
    }
  }

  // --- Pause / Resume ---
  async togglePaused(): Promise<void> {
    if (!this.ensureEditable()) return;
    const pausing = !this.isPaused();
    this.savingPaused.set(true);
    this.setOptimisticFields({ status: pausing ? 'paused' : 'active' });
    try {
      const result = await this.patch({ paused: pausing });
      if (pausing) {
        toast.success('Planned transaction paused');
      } else {
        toast.success('Planned transaction resumed', {
          ...(result &&
            !result.entered &&
            result.nextDate && {
              description: `Next occurrence on ${this.formatDisplayDate(result.nextDate)}`,
            }),
        });
      }
      // Paused schedules leave the live active list; refresh the fallback copy
      await this.pageService.reload();
    } catch (err: unknown) {
      toast.error(extractConvexErrorMessage(err, `Failed to ${pausing ? 'pause' : 'resume'} planned transaction`));
    } finally {
      this.clearOptimisticFields('status');
      this.savingPaused.set(false);
    }
  }

  // --- Skip ---
  async skip(): Promise<void> {
    const scheduled = this.scheduled();
    if (!scheduled || !this.ensureEditable()) return;
    if (!this.isActive()) return;

    const confirmed = await confirmSkipPlannedTransaction(this.dialogService, scheduled);
    if (!confirmed) return;

    this.skipping.set(true);
    try {
      const result = await this.scheduledService.skip(scheduled._id);
      if (result.status === 'active') {
        toast.success('Occurrence skipped', {
          description: `Next occurrence on ${this.formatDisplayDate(result.nextDate)}`,
        });
      } else {
        toast.success('Schedule completed', {
          description: 'The one-time schedule was skipped and completed.',
        });
      }
      await this.pageService.reload();
    } catch (err: unknown) {
      toast.error(extractConvexErrorMessage(err, 'Failed to skip planned transaction'));
    } finally {
      this.skipping.set(false);
    }
  }

  // --- Reminders ---
  async selectReminder(selection: ScheduledReminderSelection): Promise<void> {
    if (!this.ensureEditable()) return;
    if (selection === this.reminderSelection()) return;
    this.savingReminder.set(true);
    this.setOptimisticFields({ reminderSelection: selection });
    try {
      await this.patch({
        reminderEnabled: selection !== 'none',
        reminderOffset: selection === 'none' ? null : selection,
      });
    } catch (err: unknown) {
      toast.error(extractConvexErrorMessage(err, 'Failed to update reminder'));
    } finally {
      this.clearOptimisticFields('reminderSelection');
      this.savingReminder.set(false);
    }
  }

  // --- Notes ---
  async onNotesBlur(): Promise<void> {
    if (!this.ensureEditable()) return;
    const value = this.notes().trim();
    const previousNotes = this.scheduled()?.notes ?? '';
    if (previousNotes === value) return;
    this.savingNotes.set(true);
    try {
      await this.patch({ notes: value ? value : null });
    } catch (err: unknown) {
      this.notes.set(previousNotes);
      toast.error(extractConvexErrorMessage(err, 'Failed to update notes'));
    } finally {
      this.savingNotes.set(false);
    }
  }

  onNotesKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLTextAreaElement;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      target.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      // Revert to the saved value and blur
      this.notes.set(this.scheduled()?.notes ?? '');
      target.blur();
    }
  }

  // --- Enter now ---
  async enterNow(): Promise<void> {
    const scheduled = this.scheduled();
    if (!scheduled) return;
    if (!this.ensureEditable()) return;
    this.entering.set(true);
    try {
      const result = await this.scheduledService.enterNow(scheduled._id);
      toast.success('Transaction entered', {
        ...(result.status === 'active' && {
          description: `Next occurrence on ${this.formatDisplayDate(result.nextDate)}`,
        }),
        action: {
          label: 'View',
          onClick: () => void this.navigationService.navigateToTransaction(result.transactionId),
        },
      });
      await this.pageService.reload({ refreshLinkedTransactions: true });
    } catch (err: unknown) {
      toast.error(extractConvexErrorMessage(err, 'Failed to enter planned transaction'));
    } finally {
      this.entering.set(false);
    }
  }

  // --- Splits ---
  handleEnterSplitMode(): void {
    if (!this.ensureEditable()) return;
    if (this.isTransfer()) return;
    this.enterSplitModeFromMovements();
  }

  private enterSplitModeFromMovements(): void {
    const scheduled = this.scheduled();
    if (!scheduled) return;

    let splits: Split[];
    if (scheduled.movements.length > 1) {
      splits = scheduled.movements.map((m) => ({
        categoryId: m.categoryId,
        readyToAssign: m.readyToAssign,
        amount: m.amount,
      }));
    } else {
      const first = scheduled.movements[0];
      const initial: Split = {};
      if (first?.categoryId) initial.categoryId = first.categoryId;
      if (first?.readyToAssign) initial.readyToAssign = first.readyToAssign;
      splits = [initial];
    }

    this.initialSplits.set(splits.map((s) => ({ ...s })));
    this.localSplits.set(splits);
    this.isSplitMode.set(true);
  }

  handleAddSplit(value: { categoryId: string | null; readyToAssign: boolean }): void {
    if (!this.isEditable()) return;
    this.localSplits.update((prev) => [
      ...prev,
      {
        categoryId: value.categoryId ? (value.categoryId as Id<'category'>) : undefined,
        readyToAssign: value.readyToAssign,
      },
    ]);
  }

  handleRemoveSplit(index: number): void {
    if (!this.isEditable()) return;
    this.localSplits.update((prev) => (prev.length === 1 ? [{}] : prev.filter((_, i) => i !== index)));
  }

  handleUpdateSplitCategory(event: { index: number; categoryId: string | null; readyToAssign: boolean }): void {
    if (!this.isEditable()) return;
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

  handleUpdateSplitAmount(event: { index: number; amount: bigint | undefined }): void {
    if (!this.isEditable()) return;
    this.localSplits.update((prev) =>
      prev.map((split, i) => (i === event.index ? { ...split, amount: event.amount } : split))
    );
  }

  async handleSaveSplits(): Promise<void> {
    if (!this.ensureEditable()) return;
    const splits = this.localSplits();
    const target = this.signedAmountBigInt();
    const sum = splits.reduce((acc, s) => acc + (s.amount ?? 0n), 0n);
    if (splits.some((s) => s.amount === undefined || s.amount === 0n)) {
      toast.error('All split amounts must be specified');
      return;
    }
    if (sum !== target) {
      toast.error('Splits must sum to the total amount');
      return;
    }

    this.savingSplits.set(true);
    try {
      const movements: ScheduledMovementInput[] = splits.map((s) => ({
        amount: s.amount!,
        ...(s.readyToAssign ? { readyToAssign: true } : s.categoryId ? { categoryId: s.categoryId } : {}),
      }));
      await this.patch({ movements });
      this.initialSplits.set(splits.map((s) => ({ ...s })));
      toast.success('Splits updated');
    } catch (err: unknown) {
      toast.error(extractConvexErrorMessage(err, 'Failed to update splits'));
    } finally {
      this.savingSplits.set(false);
    }
  }

  async handleCancelSplits(): Promise<void> {
    if (!this.ensureEditable()) return;
    // Collapse back to a single movement using the first split's category
    const first = this.localSplits()[0];
    this.isSplitMode.set(false);
    this.localSplits.set([]);
    this.initialSplits.set([]);

    // Only persist a collapse when the schedule currently has multiple movements
    if ((this.scheduled()?.movements.length ?? 0) <= 1) return;

    this.savingSplits.set(true);
    try {
      const movement: ScheduledMovementInput = {
        amount: this.signedAmountBigInt(),
        ...(first?.readyToAssign ? { readyToAssign: true } : first?.categoryId ? { categoryId: first.categoryId } : {}),
      };
      await this.patch({ movements: [movement] });
    } catch (err: unknown) {
      toast.error(extractConvexErrorMessage(err, 'Failed to update category'));
    } finally {
      this.savingSplits.set(false);
    }
  }

  toggleEnteredExpanded(): void {
    this.enteredExpanded.update((v) => !v);
  }

  loadMoreEntered(): void {
    void this.pageService.loadMore();
  }

  getPlannedLink(): string[] {
    return this.navigationService.getPlannedRoute();
  }

  private formatDateToISO(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private isDueDate(isoDate: string): boolean {
    return isoDate <= this.formatDateToISO(new Date());
  }

  private formatDisplayDate(isoDate: string): string {
    const [year, month, day] = isoDate.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
}
