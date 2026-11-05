import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import {
  nucleoTransfer as ArrowLeftRight,
  nucleoCalendarCheck as CalendarArrowDown,
  nucleoCalendarClock as CalendarClock,
  NucleoIcon,
  nucleoPause as Pause,
  nucleoPlay as Play,
  nucleoSkip as SkipForward,
  nucleoTrash as Trash2,
} from '@kualia/icons';
import { CurrencyService } from '../../services/currency.service';
import { MerchantService } from '../../services/merchant.service';
import { PlannedBaseTransaction, PlannedMonthlyEntry } from '../../services/planned-transaction.service';
import { recurrenceLabel } from '../../shared/utils/recurrence.utils';
import { HlmContextMenuImports } from '../../ui/context-menu/src';
import { HlmDropdownMenuImports } from '../../ui/dropdown-menu/src';

export type PlannedTransactionAction = 'enter' | 'pause' | 'skip' | 'delete';

/**
 * A single planned-transaction row for the Planned page. In the monthly tab it renders a
 * month occurrence (entry + coverage status); in the "All" tab it renders the schedule
 * itself (entry omitted, date = next occurrence).
 */
@Component({
  selector: 'app-planned-transaction-row',
  imports: [NucleoIcon, ...HlmContextMenuImports, ...HlmDropdownMenuImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './planned-transaction-row.html',
})
export class PlannedTransactionRowComponent {
  protected readonly CalendarClock = CalendarClock;
  protected readonly ArrowLeftRight = ArrowLeftRight;
  protected readonly CalendarArrowDown = CalendarArrowDown;
  protected readonly Pause = Pause;
  protected readonly Play = Play;
  protected readonly SkipForward = SkipForward;
  protected readonly Trash2 = Trash2;

  private readonly currencyService = inject(CurrencyService);
  private readonly merchantService = inject(MerchantService);

  // Inputs
  readonly base = input.required<PlannedBaseTransaction>();
  readonly entry = input<PlannedMonthlyEntry | null>(null);
  readonly isLast = input<boolean>(false);
  readonly showContextMenu = input<boolean>(false);

  // Outputs
  readonly rowClick = output<PlannedBaseTransaction>();
  readonly action = output<{ action: PlannedTransactionAction; planned: PlannedBaseTransaction }>();

  // Grid template columns with even spacing and appropriate min-widths
  readonly gridTemplateColumns =
    'minmax(160px, 1fr) minmax(130px, 1fr) minmax(100px, 1fr) minmax(100px, 1fr) minmax(90px, 1fr)';

  readonly isTransfer = computed(() => (this.base().transactionType ?? 'regular') === 'transfer');

  // Computed: display name is merchant name, or the transfer destination
  readonly displayName = computed(() => {
    const base = this.base();
    if (this.isTransfer()) {
      return `Transfer to ${base.transferToAccountName ?? 'account'}`;
    }
    const merchantName = base.merchantId
      ? this.merchantService.merchants().find((merchant) => merchant._id === base.merchantId)?.name
      : undefined;
    return base.merchantName ?? merchantName ?? 'No payee';
  });

  // Computed: get merchant logo or null (looked up client-side; transfers have none)
  readonly merchantLogo = computed(() => {
    const merchantId = this.base().merchantId;
    if (this.isTransfer() || !merchantId) return null;
    return this.merchantService.merchants().find((merchant) => merchant._id === merchantId)?.logoUrl ?? null;
  });

  readonly isPaid = computed(() => this.entry()?.coverage.status === 'paid');
  readonly canActOnOccurrence = computed(() => {
    if (this.base().status !== 'active') return false;
    const entry = this.entry();
    return (
      entry === null ||
      (entry.occurrenceDate === this.base().nextDate &&
        (entry.coverage.status === 'upcoming' || entry.coverage.status === 'overdue'))
    );
  });

  // Computed: category display for the category column
  readonly categoryDisplay = computed<{ badge: string | null; empty: string | null }>(() => {
    const base = this.base();
    const firstMovement = base.movements[0];
    if (this.isTransfer() && !firstMovement?.categoryId && !firstMovement?.readyToAssign) {
      return { badge: 'Transfer', empty: null };
    }
    if (base.movements.length > 1) {
      return { badge: `Split (${base.movements.length})`, empty: null };
    }
    if (firstMovement?.readyToAssign) {
      return { badge: 'Ready to Assign', empty: null };
    }
    if (firstMovement?.categoryName) {
      return { badge: firstMovement.categoryName, empty: null };
    }
    return { badge: null, empty: 'Not assigned' };
  });

  // Computed: recurrence label (e.g., "Monthly", "Every 3 weeks")
  readonly recurrenceDisplay = computed(() => recurrenceLabel(this.base().recurrence));

  // Auto-entering schedules get a small badge so users can tell them apart
  readonly isAutoEntry = computed(() => (this.base().entryMode ?? 'auto') === 'auto');

  // Computed: formatted amount. Paid occurrences show the actual paid amount with the
  // expected amount struck through when they differ; income is green with a + prefix.
  readonly formattedAmount = computed(() => {
    const base = this.base();
    const entry = this.entry();
    const isTransfer = this.isTransfer();
    const expectedAmount = base.totalAmount;
    const isIncome = !isTransfer && expectedAmount >= 0n;

    const format = (amount: bigint): string => {
      const formatted = this.currencyService.format(amount < 0n ? -amount : amount);
      return isIncome ? `+${formatted}` : formatted;
    };

    if (entry?.coverage.status === 'paid') {
      // paidAmount is an absolute value; apply the expected sign for display
      const paidAbs = entry.coverage.paidAmount;
      const expectedAbs = expectedAmount < 0n ? -expectedAmount : expectedAmount;
      return {
        display: format(paidAbs),
        isIncome,
        showExpected: paidAbs !== expectedAbs,
        expectedDisplay: format(expectedAbs),
      };
    }

    return {
      display: format(expectedAmount),
      isIncome,
      showExpected: false,
      expectedDisplay: '',
    };
  });

  // Computed: date with relative suffix (suffix hidden when paid)
  readonly dateFormatted = computed(() => {
    const entry = this.entry();
    const dateStr = entry ? entry.displayDate : this.base().nextDate;
    if (!dateStr) return { date: 'N/A', relative: '' };

    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const diffTime = date.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // Include the year when it isn't the current year
    const currentYear = today.getFullYear();
    const dateOptions: Intl.DateTimeFormatOptions =
      year !== currentYear ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' };
    const datePart = date.toLocaleDateString('en-US', dateOptions);

    let relativePart: string;
    if (diffDays < 0) {
      const absDays = Math.abs(diffDays);
      relativePart = absDays === 1 ? '1 day ago' : `${absDays} days ago`;
    } else if (diffDays === 0) {
      relativePart = 'Today';
    } else if (diffDays === 1) {
      relativePart = '1 day';
    } else {
      relativePart = `${diffDays} days`;
    }

    return { date: datePart, relative: relativePart };
  });

  onClick(): void {
    this.rowClick.emit(this.base());
  }

  onAction(action: PlannedTransactionAction): void {
    if ((action === 'enter' || action === 'skip') && !this.canActOnOccurrence()) return;
    if (action === 'pause' && this.base().status === 'completed') return;
    this.action.emit({ action, planned: this.base() });
  }
}
