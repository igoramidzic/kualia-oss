import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import { Id } from 'convex/_generated/dataModel';
import {
  nucleoCalendarClock as CalendarClock,
  nucleoHistory as ClockFading,
  NucleoIcon,
  nucleoTrash as Trash2,
} from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { BankAccountService } from '../../services/bank-account.service';
import { CurrencyService } from '../../services/currency.service';
import { MerchantService } from '../../services/merchant.service';
import { NavigationService } from '../../services/navigation.service';
import {
  ScheduledMovementInput,
  ScheduledTransactionService,
  ScheduledTransactionWithRelations,
} from '../../services/scheduled-transaction.service';
import { UndoRedoService } from '../../services/undo-redo.service';
import { extractConvexErrorMessage } from '../../shared/utils/convex-error-message';
import { DEFAULT_BANK_ACCOUNT_ICON_NAME, DEFAULT_MERCHANT_ICON_NAME } from '../../shared/utils/entity-identity';
import { dateToYearMonth } from '../../shared/utils/month.utils';
import { recurrenceLabel } from '../../shared/utils/recurrence.utils';
import { HlmContextMenuImports } from '../../ui/context-menu/src';
import { HlmDropdownMenuImports } from '../../ui/dropdown-menu/src';
import { EntityMarkComponent } from '../entity-mark/entity-mark.component';
import { BankAccountSelectorComponent } from '../transaction/bank-account-selector.component';
import { CategorySelectorComponent } from '../transaction/category-selector.component';
import { PayeeChangeEvent, PayeeSelectorComponent } from '../transaction/payee-selector.component';
import { TransactionDatePickerComponent } from '../transaction/transaction-date-picker.component';

/**
 * A register-style row for a single scheduled (future-dated) transaction. Mirrors the layout
 * and inline editing of `app-transaction-row` (date / payee / category / account), but every
 * edit is persisted through `updateScheduledTransaction`. Amount is display-only here (parity
 * with the register row) and editable on the scheduled detail page. Clicking the row navigates
 * to that detail page.
 */
@Component({
  selector: 'app-scheduled-transaction-row',
  imports: [
    RouterLink,
    NucleoIcon,
    HlmCheckbox,
    ...HlmContextMenuImports,
    ...HlmDropdownMenuImports,
    EntityMarkComponent,
    BankAccountSelectorComponent,
    CategorySelectorComponent,
    PayeeSelectorComponent,
    TransactionDatePickerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './scheduled-transaction-row.html',
})
export class ScheduledTransactionRowComponent {
  protected readonly CalendarClock = CalendarClock;
  protected readonly ClockFading = ClockFading;
  protected readonly Trash2 = Trash2;
  protected readonly defaultMerchantIconName = DEFAULT_MERCHANT_ICON_NAME;
  protected readonly defaultBankAccountIconName = DEFAULT_BANK_ACCOUNT_ICON_NAME;

  private readonly scheduledService = inject(ScheduledTransactionService);
  private readonly currencyService = inject(CurrencyService);
  private readonly merchantService = inject(MerchantService);
  private readonly bankAccountService = inject(BankAccountService);
  private readonly navigationService = inject(NavigationService);
  private readonly undoRedoService = inject(UndoRedoService);

  // Inputs (mirror app-transaction-row)
  readonly scheduled = input.required<ScheduledTransactionWithRelations>();
  readonly showBankAccountBadge = input<boolean>(true);
  readonly showNotes = input<boolean>(false);
  readonly isLast = input<boolean>(false);
  readonly isSelected = input<boolean>(false);

  // Output: checkbox toggle (same contract as app-transaction-row)
  readonly checkboxChange = output<{ id: string; event: Event }>();

  // Optimistic state so edits show instantly without waiting on the subscription
  private readonly _optimisticDate = signal<Date | undefined>(undefined);
  private readonly _optimisticMerchantId = signal<string | null | undefined>(undefined);
  private readonly _optimisticPendingMerchantName = signal<string | null | undefined>(undefined);
  private readonly _optimisticCategoryId = signal<string | null | undefined>(undefined);
  private readonly _optimisticReadyToAssign = signal<boolean | undefined>(undefined);
  private readonly _optimisticBankAccountId = signal<string | undefined>(undefined);
  private readonly _optimisticTransferToAccountId = signal<string | null | undefined>(undefined);

  readonly isSavingDate = signal<boolean>(false);
  readonly isSavingMerchant = signal<boolean>(false);
  readonly isSavingCategory = signal<boolean>(false);
  readonly isSavingBankAccount = signal<boolean>(false);
  readonly isDeleting = signal<boolean>(false);

  readonly isSplit = computed(() => this.scheduled().movements.length > 1);
  readonly splitCount = computed(() => this.scheduled().movements.length);
  readonly transactionType = computed(() => this.scheduled().transactionType ?? 'regular');
  readonly isTransfer = computed(() => this.transactionType() === 'transfer');

  readonly displayDate = computed(() => {
    const optimistic = this._optimisticDate();
    if (optimistic !== undefined) {
      return optimistic;
    }
    const [year, month, day] = this.scheduled().nextDate.split('-').map(Number);
    return new Date(year, month - 1, day);
  });

  readonly displayYearMonth = computed(() => dateToYearMonth(this.displayDate()));

  readonly displayMerchantId = computed(() => {
    const optimistic = this._optimisticMerchantId();
    if (optimistic !== undefined) {
      return optimistic;
    }
    return this.scheduled().merchantId ?? null;
  });

  readonly displayPendingMerchantName = computed(() => this._optimisticPendingMerchantName() ?? null);

  readonly displayMerchant = computed(() => {
    const id = this.displayMerchantId();
    if (!id) return null;
    return this.merchantService.merchants().find((m) => m._id === id) ?? null;
  });

  readonly bankAccounts = this.bankAccountService.bankAccounts;

  readonly displayTransferToAccountId = computed(() => {
    const optimistic = this._optimisticTransferToAccountId();
    if (optimistic !== undefined) {
      return optimistic;
    }
    return this.scheduled().transferToAccountId ?? null;
  });

  readonly displayTransferToAccount = computed(() => {
    const id = this.displayTransferToAccountId();
    if (!id) return null;
    return this.bankAccounts().find((account) => account._id === id) ?? null;
  });

  readonly displayCategoryId = computed(() => {
    const optimistic = this._optimisticCategoryId();
    if (optimistic !== undefined) {
      return optimistic;
    }
    return this.scheduled().movements[0]?.categoryId ?? null;
  });

  readonly displayReadyToAssign = computed(() => {
    const optimistic = this._optimisticReadyToAssign();
    if (optimistic !== undefined) {
      return optimistic;
    }
    return this.scheduled().movements[0]?.readyToAssign ?? false;
  });

  readonly displayBankAccountId = computed(() => {
    const optimistic = this._optimisticBankAccountId();
    if (optimistic !== undefined) {
      return optimistic;
    }
    return this.scheduled().bankAccountId;
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

  readonly splitCategoryLabel = computed(() => `Split (${this.splitCount()})`);
  readonly hasTransferCategory = computed(() => {
    const first = this.scheduled().movements[0];
    return !!first?.categoryId || first?.readyToAssign === true;
  });

  readonly recurrenceText = computed(() => recurrenceLabel(this.scheduled().recurrence));

  private readonly totalAmount = computed(() => this.scheduled().movements.reduce((sum, m) => sum + m.amount, 0n));
  readonly isPositiveAmount = computed(() => !this.isTransfer() && this.totalAmount() >= 0n);
  readonly amountDisplay = computed(() => {
    const total = this.totalAmount();
    const abs = total < 0n ? -total : total;
    const formatted = this.currencyService.format(abs);
    if (this.isTransfer()) {
      return formatted;
    }
    return this.isPositiveAmount() ? `+${formatted}` : formatted;
  });

  readonly isPending = computed(() => this.scheduled().entryStatus === 'pending');

  readonly scheduledRoute = computed(() => this.navigationService.getPlannedTransactionRoute(this.scheduled()._id));

  onCheckboxClick(event: Event): void {
    this.checkboxChange.emit({ id: this.scheduled()._id, event });
  }

  async onDateChange(newDate: Date): Promise<void> {
    const isoDate = this.formatDateToISO(newDate);
    if (isoDate === this.scheduled().nextDate) {
      return;
    }

    const enterDue = this.isDueDate(isoDate);
    if (enterDue) {
      const confirmed = await this.scheduledService.confirmEnterDueDate(this.scheduled(), isoDate);
      if (!confirmed) {
        return;
      }
    }

    this._optimisticDate.set(newDate);
    this.isSavingDate.set(true);
    try {
      const result = await this.scheduledService.updateScheduledTransaction({
        scheduledTransactionId: this.scheduled()._id,
        date: isoDate,
        ...(enterDue && { enterDue: true }),
      });
      if (result.entered) {
        // A past/today date entered the transaction; let the subscription re-anchor the row.
        this._optimisticDate.set(undefined);
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
      }
    } catch (err: unknown) {
      this._optimisticDate.set(undefined);
      toast.error(extractConvexErrorMessage(err, 'Failed to update date'));
    } finally {
      this.isSavingDate.set(false);
    }
  }

  async onPayeeChange(value: PayeeChangeEvent): Promise<void> {
    if (this.isTransfer()) {
      if (value.type !== 'bankAccount' || !value.id) {
        return;
      }

      this._optimisticTransferToAccountId.set(value.id);
      this.isSavingMerchant.set(true);
      try {
        await this.scheduledService.updateScheduledTransaction({
          scheduledTransactionId: this.scheduled()._id,
          transactionType: 'transfer',
          bankAccountId: this.displayBankAccountId() as Id<'bankAccount'>,
          transferToAccountId: value.id as Id<'bankAccount'>,
          merchantId: null,
        });
      } catch (err: unknown) {
        this._optimisticTransferToAccountId.set(undefined);
        toast.error(extractConvexErrorMessage(err, 'Failed to update destination account'));
      } finally {
        this.isSavingMerchant.set(false);
      }
      return;
    }

    if (value.type !== 'merchant') {
      return;
    }

    this._optimisticMerchantId.set(value.id ?? null);
    this._optimisticPendingMerchantName.set(value.pendingName ?? null);
    this.isSavingMerchant.set(true);
    try {
      let merchantId = value.id ?? null;
      if (!merchantId && value.pendingName) {
        const merchant = await this.merchantService.findOrCreateMerchant(value.pendingName);
        merchantId = merchant._id;
        this._optimisticMerchantId.set(merchantId);
        this._optimisticPendingMerchantName.set(null);
      }
      await this.scheduledService.updateScheduledTransaction({
        scheduledTransactionId: this.scheduled()._id,
        transactionType: 'regular',
        merchantId: (merchantId as Id<'merchant'>) ?? null,
      });
    } catch (err: unknown) {
      this._optimisticMerchantId.set(undefined);
      this._optimisticPendingMerchantName.set(undefined);
      toast.error(extractConvexErrorMessage(err, 'Failed to update payee'));
    } finally {
      this.isSavingMerchant.set(false);
    }
  }

  async onCategoryChange(value: string | null | 'ready-to-assign'): Promise<void> {
    if (this.isSplit()) {
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
    try {
      const first = this.scheduled().movements[0];
      const movement: ScheduledMovementInput = {
        amount: first?.amount ?? this.totalAmount(),
        ...(value === 'ready-to-assign'
          ? { readyToAssign: true }
          : value
            ? { categoryId: value as Id<'category'> }
            : {}),
        ...(first?.notes ? { notes: first.notes } : {}),
      };
      await this.scheduledService.updateScheduledTransaction({
        scheduledTransactionId: this.scheduled()._id,
        ...(this.isTransfer() && {
          transactionType: 'transfer' as const,
          bankAccountId: this.displayBankAccountId() as Id<'bankAccount'>,
          transferToAccountId: this.displayTransferToAccountId() as Id<'bankAccount'>,
          merchantId: null,
        }),
        movements: [movement],
      });
    } catch (err: unknown) {
      this._optimisticCategoryId.set(undefined);
      this._optimisticReadyToAssign.set(undefined);
      toast.error(extractConvexErrorMessage(err, 'Failed to update category'));
    } finally {
      this.isSavingCategory.set(false);
    }
  }

  async onBankAccountChange(newBankAccountId: string | null): Promise<void> {
    if (!newBankAccountId || newBankAccountId === this.scheduled().bankAccountId) {
      return;
    }

    this._optimisticBankAccountId.set(newBankAccountId);
    this.isSavingBankAccount.set(true);
    try {
      await this.scheduledService.updateScheduledTransaction({
        scheduledTransactionId: this.scheduled()._id,
        ...(this.isTransfer() && {
          transactionType: 'transfer' as const,
          transferToAccountId: this.displayTransferToAccountId() as Id<'bankAccount'>,
          merchantId: null,
        }),
        bankAccountId: newBankAccountId as Id<'bankAccount'>,
      });
    } catch (err: unknown) {
      this._optimisticBankAccountId.set(undefined);
      toast.error(extractConvexErrorMessage(err, 'Failed to update account'));
    } finally {
      this.isSavingBankAccount.set(false);
    }
  }

  async onContextMenuDelete(): Promise<void> {
    if (this.isDeleting()) {
      return;
    }

    this.isDeleting.set(true);
    try {
      const scheduledTransactionId = this.scheduled()._id;
      await this.scheduledService.deleteScheduledTransaction(scheduledTransactionId);
      this.undoRedoService.pushAction({
        description: 'Planned transaction deleted',
        type: 'planned-transaction-delete',
        timestamp: Date.now(),
        undo: () => this.scheduledService.restoreScheduledTransaction(scheduledTransactionId),
        redo: () => this.scheduledService.deleteScheduledTransaction(scheduledTransactionId),
      });
      toast('Planned transaction deleted', {
        action: {
          label: 'Undo',
          onClick: () => void this.undoRedoService.undo(),
        },
      });
    } catch (err: unknown) {
      toast.error(extractConvexErrorMessage(err, 'Failed to delete planned transaction'));
    } finally {
      this.isDeleting.set(false);
    }
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
