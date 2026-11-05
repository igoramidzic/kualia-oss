import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import { nucleoInfo as Info, NucleoIcon } from '@kualia/icons';
import { TransactionSelectionService } from '../../services/transaction-selection.service';

/**
 * The register column header (checkbox / info / Date / Payee / Account / Category / Notes /
 * Amount) as a standalone row, so it can sit ABOVE the scheduled section on the transactions
 * page and act as a shared header for both the scheduled rows and the register rows below.
 *
 * The select-all checkbox drives the same TransactionSelectionService the table rows use, via
 * the visible-transaction-ids the table publishes. `app-transactions-table` keeps its own
 * internal header for its other embeddings (recurring / bank-account views).
 */
@Component({
  selector: 'app-transactions-column-header',
  imports: [NucleoIcon, HlmCheckbox],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="group bg-content-background grid h-10 shrink-0 items-center border-b pr-2 pl-0 text-sm select-none sm:pr-3"
      [style.grid-template-columns]="
        showBankAccountBadge() && showNotes()
          ? '2rem 2rem 7.5rem 1fr 1fr 1fr 1fr 5.5rem 1.5rem'
          : showBankAccountBadge()
            ? '2rem 2rem 7.5rem 1fr 1fr 1fr 5.5rem 1.5rem'
            : showNotes()
              ? '2rem 2rem 7.5rem 1fr 1fr 1fr 5.5rem 1.5rem'
              : '2rem 2rem 7.5rem 1fr 1fr 5.5rem 1.5rem'
      "
    >
      <div
        class="flex h-full cursor-default items-center justify-center"
        tabindex="-1"
        (click)="$event.stopPropagation(); onHeaderCheckboxClick()"
        (keydown.enter)="$event.stopPropagation(); onHeaderCheckboxClick()"
        (keydown.space)="$event.stopPropagation(); onHeaderCheckboxClick(); $event.preventDefault()"
      >
        <hlm-checkbox
          [checked]="headerCheckboxState() === true"
          [indeterminate]="headerCheckboxState() === 'indeterminate'"
          class="group-hover:border-primary"
        />
      </div>
      <div class="flex items-center justify-center">
        <nucleo-icon [icon]="Info" [size]="14" class="text-muted-foreground" />
      </div>
      <div class="text-muted-foreground">Date</div>
      <div class="text-muted-foreground pl-0">Payee</div>
      @if (showBankAccountBadge()) {
        <div class="text-muted-foreground">Account</div>
      }
      <div class="text-muted-foreground">Category</div>
      @if (showNotes()) {
        <div class="text-muted-foreground">Notes</div>
      }
      <div class="text-muted-foreground text-right">Amount</div>
      <div></div>
    </div>
  `,
})
export class TransactionsColumnHeaderComponent {
  protected readonly Info = Info;

  private readonly selectionService = inject(TransactionSelectionService);
  private readonly destroyRef = inject(DestroyRef);

  readonly showBankAccountBadge = input<boolean>(true);

  // Notes column is responsive (lg+), matching the table and scheduled section.
  readonly showNotes = signal<boolean>(false);

  private readonly visibleTransactionIds = computed(() => this.selectionService.getVisibleTransactionIds());

  readonly headerCheckboxState = computed<boolean | 'indeterminate'>(() => {
    const selectedIds = this.selectionService.selectedTransactionIds();
    const visibleIds = this.visibleTransactionIds();

    if (selectedIds.size === 0) return false;

    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    if (allSelected) return true;

    return 'indeterminate';
  });

  constructor() {
    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    this.showNotes.set(mediaQuery.matches);
    const onMediaChange = (e: MediaQueryListEvent) => this.showNotes.set(e.matches);
    mediaQuery.addEventListener('change', onMediaChange);
    this.destroyRef.onDestroy(() => mediaQuery.removeEventListener('change', onMediaChange));
  }

  onHeaderCheckboxClick(): void {
    const currentState = this.headerCheckboxState();
    if (currentState === false) {
      this.selectionService.selectAllTransactions(this.visibleTransactionIds());
    } else {
      this.selectionService.deselectAll();
    }
  }
}
