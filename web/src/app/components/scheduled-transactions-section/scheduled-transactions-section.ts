import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import {
  nucleoCalendarClock as CalendarClock,
  nucleoChevronDown as ChevronDown,
  nucleoChevronRight as ChevronRight,
  NucleoIcon,
} from '@kualia/icons';
import { UserPreferencesService } from '../../core/services/preferences/user-preferences.service';
import { ScheduledTransactionService } from '../../services/scheduled-transaction.service';
import { TransactionSelectionService } from '../../services/transaction-selection.service';
import { ScheduledTransactionRowComponent } from '../scheduled-transaction-row/scheduled-transaction-row';

/**
 * YNAB-style "Planned" section rendered above the transactions register. Lists upcoming
 * planned (scheduled) transactions as register-style rows (same layout + inline editing as
 * the register), each selectable via a checkbox. Renders nothing when the workspace has no
 * active schedules.
 */
@Component({
  selector: 'app-scheduled-transactions-section',
  imports: [NucleoIcon, ScheduledTransactionRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './scheduled-transactions-section.html',
})
export class ScheduledTransactionsSectionComponent {
  protected readonly CalendarClock = CalendarClock;
  protected readonly ChevronDown = ChevronDown;
  protected readonly ChevronRight = ChevronRight;

  private readonly scheduledTransactionService = inject(ScheduledTransactionService);
  private readonly selectionService = inject(TransactionSelectionService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly userPreferences = inject(UserPreferencesService);

  readonly expanded = this.userPreferences.plannedTransactionsSectionOpen;

  // Align columns with the register below: account badge always shown, notes column responsive.
  readonly showBankAccountBadge = true;
  readonly showNotes = signal<boolean>(false);

  readonly scheduledTransactions = this.scheduledTransactionService.scheduledTransactions;
  readonly hasScheduled = computed(() => this.scheduledTransactions().length > 0);

  constructor() {
    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    this.showNotes.set(mediaQuery.matches);
    const onMediaChange = (e: MediaQueryListEvent) => this.showNotes.set(e.matches);
    mediaQuery.addEventListener('change', onMediaChange);
    this.destroyRef.onDestroy(() => mediaQuery.removeEventListener('change', onMediaChange));
  }

  toggleExpanded(): void {
    this.userPreferences.togglePlannedTransactionsSection();
  }

  isScheduledSelected(scheduledId: string) {
    return this.selectionService.isScheduledSelected(scheduledId);
  }

  onScheduledCheckbox(event: { id: string; event: Event }): void {
    this.selectionService.toggleScheduled(event.id);
  }
}
