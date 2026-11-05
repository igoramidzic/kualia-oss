import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { BrnComboboxImports } from '@spartan-ng/brain/combobox';
import { BrnPopoverContent } from '@spartan-ng/brain/popover';
import { HlmComboboxImports } from '@spartan-ng/helm/combobox';
import {
  nucleoTransfer as ArrowLeftRight,
  nucleoCalendarClock as CalendarClock,
  NucleoIcon,
  nucleoShop as Store,
} from '@kualia/icons';
import { CurrencyService } from '../../services/currency.service';
import { MerchantService } from '../../services/merchant.service';
import {
  ScheduledTransactionService,
  ScheduledTransactionWithRelations,
} from '../../services/scheduled-transaction.service';
import { recurrenceLabel } from '../../shared/utils/recurrence.utils';
import { formatDateForDisplay } from '../../shared/utils/date-utils';

export interface PlannedTransactionSelection {
  scheduledTransactionId: string;
  occurrenceDate: string;
}

/**
 * Combobox of the workspace's ACTIVE planned (scheduled) transactions, used on the
 * transaction detail page to link a real transaction to the schedule it fulfills.
 */
@Component({
  selector: 'app-planned-transaction-selector',
  imports: [NgTemplateOutlet, NucleoIcon, BrnComboboxImports, BrnPopoverContent, HlmComboboxImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-combobox sideOffset="5" autoFocus="first-tabbable" [disabled]="disabled()">
      <hlm-combobox-trigger [class]="buttonClass() + ' h-8'" [variant]="variant()" [showIcon]="false" stopPropagation>
        <span class="flex min-w-0 flex-1 items-center gap-2">
          <nucleo-icon [icon]="CalendarClock" [size]="14" class="text-muted-foreground flex-shrink-0" />
          <span class="text-muted-foreground min-w-0 truncate">Link to planned transaction</span>
        </span>
      </hlm-combobox-trigger>
      <div
        *brnPopoverContent
        hlmComboboxContent
        class="!max-h-88 !w-80 **:data-[slot=input-group]:border-0 **:data-[slot=input-group]:bg-transparent"
      >
        <div class="border-border border-b">
          <hlm-combobox-input
            placeholder="Search planned transactions..."
            [showTrigger]="false"
            (input)="searchQuery.set($any($event.target).value)"
          />
        </div>
        <div hlmComboboxList>
          <!-- Suggested Matches -->
          @if (suggestedMatches().length > 0) {
            <div hlmComboboxGroup>
              <div hlmComboboxLabel>Suggested matches</div>
              @for (planned of suggestedMatches(); track planned._id) {
                <hlm-combobox-item [value]="planned._id + '-suggested'" (click)="selectPlanned(planned)">
                  <ng-container *ngTemplateOutlet="plannedOption; context: { $implicit: planned }" />
                </hlm-combobox-item>
              }
            </div>
          }

          <!-- All Planned Transactions -->
          @if (filteredPlanned().length > 0) {
            <div hlmComboboxGroup>
              <div hlmComboboxLabel>All planned transactions</div>
              @for (planned of filteredPlanned(); track planned._id) {
                <hlm-combobox-item [value]="planned._id" (click)="selectPlanned(planned)">
                  <ng-container *ngTemplateOutlet="plannedOption; context: { $implicit: planned }" />
                </hlm-combobox-item>
              }
            </div>
          }
        </div>
        <hlm-combobox-empty>No planned transactions found.</hlm-combobox-empty>
      </div>
    </hlm-combobox>

    <ng-template #plannedOption let-planned>
      <div class="flex w-full min-w-0 items-center justify-between gap-2">
        <div class="flex min-w-0 flex-1 items-center gap-2">
          @if (logoUrl(planned)) {
            <img
              [src]="logoUrl(planned)"
              [alt]="displayName(planned)"
              class="h-5 w-5 flex-shrink-0 rounded-full object-cover"
            />
          } @else {
            <div class="bg-accent flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full">
              <nucleo-icon
                [icon]="isTransfer(planned) ? ArrowLeftRight : StoreIcon"
                [size]="12"
                class="text-muted-foreground"
              />
            </div>
          }
          <span class="min-w-0 flex-1 text-left">
            <span class="block truncate">{{ displayName(planned) }}</span>
            <span class="text-muted-foreground block text-xs">
              Due {{ formatDueDate(planned) }} · {{ formatRecurrence(planned) }}
            </span>
          </span>
          <span class="text-muted-foreground ml-1 flex-shrink-0 text-xs">
            {{ formatAmount(planned) }}
          </span>
        </div>
      </div>
    </ng-template>
  `,
})
export class PlannedTransactionSelectorComponent {
  private readonly scheduledTransactionService = inject(ScheduledTransactionService);
  private readonly merchantService = inject(MerchantService);
  private readonly currencyService = inject(CurrencyService);

  // Inputs
  readonly disabled = input<boolean>(false);
  readonly variant = input<'outline' | 'ghost'>('outline');
  readonly buttonClass = input<string>('w-fit justify-between text-xs');

  // Transaction context for matching
  readonly transactionMerchantId = input<string | null>(null);
  readonly transactionAmount = input<bigint | null>(null);
  readonly transactionType = input<'regular' | 'transfer'>('regular');
  readonly transactionBankAccountId = input<string | null>(null);
  readonly transferPairAccountId = input<string | null>(null);

  // Outputs
  readonly plannedTransactionChange = output<PlannedTransactionSelection>();

  // Internal state
  readonly searchQuery = signal<string>('');

  // Icons
  readonly CalendarClock = CalendarClock;
  readonly ArrowLeftRight = ArrowLeftRight;
  readonly StoreIcon = Store;

  // Active planned transactions (the live subscription lists active schedules only)
  readonly allPlanned = this.scheduledTransactionService.scheduledTransactions;
  readonly matchingPlanned = computed(() => {
    const amount = this.transactionAmount();
    return this.allPlanned().filter((planned) => {
      if (this.isTransfer(planned) !== (this.transactionType() === 'transfer')) return false;
      if (this.isTransfer(planned) || amount === null) return true;
      const expectedAmount = this.totalAmount(planned);
      return amount !== 0n && expectedAmount !== 0n && amount < 0n === expectedAmount < 0n;
    });
  });

  private totalAmount(planned: ScheduledTransactionWithRelations): bigint {
    return planned.movements.reduce((sum, movement) => sum + movement.amount, 0n);
  }

  isTransfer(planned: ScheduledTransactionWithRelations): boolean {
    return (planned.transactionType ?? 'regular') === 'transfer';
  }

  displayName(planned: ScheduledTransactionWithRelations): string {
    if (this.isTransfer(planned)) {
      return `Transfer to ${planned.transferToAccountName ?? 'account'}`;
    }
    const merchantName = planned.merchantId
      ? this.merchantService.merchants().find((merchant) => merchant._id === planned.merchantId)?.name
      : null;
    return planned.merchantName ?? merchantName ?? 'No payee';
  }

  logoUrl(planned: ScheduledTransactionWithRelations): string | null {
    if (this.isTransfer(planned) || !planned.merchantId) return null;
    return this.merchantService.merchants().find((merchant) => merchant._id === planned.merchantId)?.logoUrl ?? null;
  }

  // Get suggested matches (same merchant OR amount within 10%)
  readonly suggestedMatches = computed(() => {
    const merchantId = this.transactionMerchantId();
    const amount = this.transactionAmount();
    const all = this.matchingPlanned();

    if (!merchantId && !amount) return [];

    const suggestions = all.filter((planned) => {
      const accountId = this.transactionBankAccountId();
      if (accountId) {
        if (this.isTransfer(planned)) {
          const pairAccountId = this.transferPairAccountId();
          const sourceId = amount !== null && amount > 0n ? pairAccountId : accountId;
          const destinationId = amount !== null && amount > 0n ? accountId : pairAccountId;
          if (sourceId !== planned.bankAccountId || destinationId !== planned.transferToAccountId) return false;
        } else if (accountId !== planned.bankAccountId) {
          return false;
        }
      }

      // Match by merchant
      if (merchantId && planned.merchantId === merchantId) {
        return true;
      }

      // Match by amount within 10%
      if (amount !== null) {
        const expectedAmount = this.totalAmount(planned);
        const transactionAmount = amount < 0n ? -amount : amount;
        const plannedAmount = expectedAmount < 0n ? -expectedAmount : expectedAmount;

        if (plannedAmount > 0n && transactionAmount > 0n) {
          const difference =
            transactionAmount > plannedAmount ? transactionAmount - plannedAmount : plannedAmount - transactionAmount;
          const tolerance = plannedAmount / 10n;
          if (difference <= tolerance) {
            return true;
          }
        }
      }

      return false;
    });

    return this.applySearch(suggestions);
  });

  // All planned transactions excluding suggested ones
  readonly filteredPlanned = computed(() => {
    const suggestedIds = new Set(this.suggestedMatches().map((s) => s._id));
    return this.applySearch(this.matchingPlanned().filter((planned) => !suggestedIds.has(planned._id)));
  });

  private applySearch(planned: ScheduledTransactionWithRelations[]): ScheduledTransactionWithRelations[] {
    const query = this.searchQuery().toLowerCase().trim();
    if (!query) return planned;
    return planned.filter((p) => this.displayName(p).toLowerCase().includes(query));
  }

  selectPlanned(planned: ScheduledTransactionWithRelations): void {
    this.plannedTransactionChange.emit({
      scheduledTransactionId: planned._id,
      occurrenceDate: planned.nextDate,
    });
    this.searchQuery.set('');
  }

  formatDueDate(planned: ScheduledTransactionWithRelations): string {
    return formatDateForDisplay(planned.nextDate);
  }

  formatRecurrence(planned: ScheduledTransactionWithRelations): string {
    return recurrenceLabel(planned.recurrence);
  }

  formatAmount(planned: ScheduledTransactionWithRelations): string {
    const amount = this.totalAmount(planned);
    return this.currencyService.format(amount < 0n ? -amount : amount);
  }
}
