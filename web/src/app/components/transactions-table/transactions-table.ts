import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import { nucleoTransfer as ArrowLeftRight, nucleoInfo as Info, NucleoIcon } from '@kualia/icons';
import { filter } from 'rxjs';
import { InfiniteScrollDirective } from '../../directives/infinite-scroll.directive';
import { TransactionSelectionService } from '../../services/transaction-selection.service';
import { TransactionWithRelations } from '../../services/transaction.service';
import { TransactionRowComponent } from '../transaction-row/transaction-row';
import { BulkActionsToolbarComponent } from './bulk-actions-toolbar';

const SCROLL_POSITION_KEY = 'transactions-scroll-position';

@Component({
  selector: 'app-transactions-table',
  imports: [
    CommonModule,
    NucleoIcon,
    HlmCheckbox,
    TransactionRowComponent,
    ScrollingModule,
    InfiniteScrollDirective,
    BulkActionsToolbarComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transactions-table.html',
  styles: `
    :host ::ng-deep .cdk-virtual-scroll-content-wrapper {
      width: 100%;
    }
    :host ::ng-deep cdk-virtual-scroll-viewport {
      overflow: visible;
      contain: content;
    }
  `,
})
export class TransactionsTableComponent {
  protected readonly ArrowLeftRight = ArrowLeftRight;
  protected readonly Info = Info;

  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly selectionService = inject(TransactionSelectionService);

  readonly viewport = viewChild<CdkVirtualScrollViewport>('viewport');
  readonly scrollContainer = viewChild<ElementRef<HTMLElement>>('scrollContainer');
  readonly toolbarContainer = viewChild<ElementRef<HTMLElement>>('toolbarContainer');

  // Inputs
  readonly transactions = input.required<TransactionWithRelations[]>();
  readonly loading = input.required<boolean>();
  readonly loadingMore = input<boolean>(false);
  readonly error = input<string | null>(null);
  readonly hasMore = input<boolean>(true);
  readonly showBankAccountBadge = input<boolean>(true);
  readonly showHeader = input<boolean>(false);
  readonly headerTemplate = input<TemplateRef<unknown>>();
  readonly toolbarTemplate = input<TemplateRef<unknown>>();

  // Outputs
  readonly loadMore = output<void>();

  // Responsive: hide notes column on medium or smaller screens
  readonly showNotes = signal(false);

  // Row height for virtual scrolling (h-10 = 40px)
  readonly itemSize = 40;

  private scrollRestored = false;

  // Track scrollbar width for header alignment
  private readonly scrollbarWidth = signal(0);
  readonly headerPaddingRight = computed(() => `calc(0.75rem + ${this.scrollbarWidth()}px)`);

  // Track toolbar height for sticky offset of column headers
  private readonly toolbarHeightPx = signal(0);
  readonly toolbarHeight = computed(() => `${this.toolbarHeightPx()}px`);

  // Computed visible transaction IDs for range selection
  readonly visibleTransactionIds = computed(() => {
    return this.transactions().map((t) => t._id);
  });

  // Computed: check if any selections exist
  readonly hasSelections = computed(() => this.selectionService.hasSelections());

  // Computed: determine header checkbox state ('indeterminate' | true | false)
  readonly headerCheckboxState = computed<boolean | 'indeterminate'>(() => {
    const selectedIds = this.selectionService.selectedTransactionIds();
    const visibleIds = this.visibleTransactionIds();

    if (selectedIds.size === 0) return false;

    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    if (allSelected) return true;

    return 'indeterminate';
  });

  constructor() {
    // Track screen size for responsive notes column (lg = 1024px)
    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    this.showNotes.set(mediaQuery.matches);
    const onMediaChange = (e: MediaQueryListEvent) => this.showNotes.set(e.matches);
    mediaQuery.addEventListener('change', onMediaChange);
    this.destroyRef.onDestroy(() => mediaQuery.removeEventListener('change', onMediaChange));

    // Save scroll position when navigating away from transactions list page
    const subscription = this.router.events
      .pipe(
        filter((event) => event instanceof NavigationStart),
        filter((event) => {
          // Only save if we're navigating away from the transactions list page (not detail page)
          const navEvent = event;
          const currentUrl = this.router.url.split('?')[0];
          const nextUrl = navEvent.url.split('?')[0];

          // Check if we're on the transactions list page (not detail page)
          // The list page URL ends with '/transactions' or '/transactions/' but doesn't have an ID segment after it
          // Remove trailing slash for comparison
          const normalizedCurrentUrl = currentUrl.replace(/\/$/, '');
          const isOnTransactionsList = normalizedCurrentUrl.endsWith('/transactions');

          // Save if we're on the list page and navigating away (to detail or elsewhere)
          return isOnTransactionsList && currentUrl !== nextUrl;
        })
      )
      .subscribe(() => {
        this.saveScrollPosition();
      });

    // Cleanup subscription on destroy
    this.destroyRef.onDestroy(() => {
      subscription.unsubscribe();
      // Also save scroll position on component destroy as a fallback
      this.saveScrollPosition();
    });

    // Restore scroll position when both data and DOM are ready
    effect(() => {
      const transactionsList = this.transactions();
      const isLoading = this.loading();
      const vp = this.viewport();

      // Only restore if:
      // 1. We haven't restored yet (prevent multiple restorations)
      // 2. Not loading (data is ready)
      // 3. Transactions are loaded (data is ready)
      // 4. Viewport exists (DOM is ready)
      if (!this.scrollRestored && !isLoading && transactionsList.length > 0 && vp) {
        // Use requestAnimationFrame to ensure the viewport is ready
        requestAnimationFrame(() => {
          this.restoreScrollPosition();
          this.scrollRestored = true;
        });
      }
    });

    // Measure scrollbar width when scroll container is available
    effect(() => {
      const container = this.scrollContainer();
      if (container) {
        requestAnimationFrame(() => {
          const el = container.nativeElement;
          const width = el.offsetWidth - el.clientWidth;
          this.scrollbarWidth.set(width);
        });
      }
    });

    // Measure toolbar height for sticky column header offset
    effect(() => {
      const toolbar = this.toolbarContainer();
      if (toolbar) {
        requestAnimationFrame(() => {
          this.toolbarHeightPx.set(toolbar.nativeElement.offsetHeight);
        });
      } else {
        this.toolbarHeightPx.set(0);
      }
    });

    // Update visible transaction IDs in selection service
    effect(() => {
      this.selectionService.setVisibleTransactionIds(this.visibleTransactionIds());
    });
  }

  trackByTransactionId(_index: number, transaction: TransactionWithRelations): string {
    return transaction._id;
  }

  onScrolled(): void {
    this.loadMore.emit();
  }

  // Check if transaction is selected
  isTransactionSelected(transactionId: string) {
    return this.selectionService.isTransactionSelected(transactionId);
  }

  // Checkbox change handler
  onTransactionCheckboxChange(transactionId: string, event?: Event): void {
    const lastClicked = this.selectionService.getLastClickedTransactionId();

    if (event && 'shiftKey' in event && (event as MouseEvent | KeyboardEvent).shiftKey && lastClicked) {
      // Range selection
      this.selectionService.selectRange(lastClicked, transactionId);
    } else {
      // Toggle single
      this.selectionService.toggleTransaction(transactionId);
    }

    this.selectionService.setLastClickedTransactionId(transactionId);
  }

  // Header checkbox click handler (select all / deselect all)
  onHeaderCheckboxClick(event: Event): void {
    event.preventDefault();
    const currentState = this.headerCheckboxState();
    // If unchecked, select all. If checked or indeterminate, deselect all.
    if (currentState === false) {
      this.selectionService.selectAllTransactions(this.visibleTransactionIds());
    } else {
      this.selectionService.deselectAll();
    }
  }

  private saveScrollPosition(): void {
    const vp = this.viewport();
    if (vp) {
      const scrollTop = vp.measureScrollOffset('top');
      if (scrollTop > 0) {
        sessionStorage.setItem(SCROLL_POSITION_KEY, scrollTop.toString());
      }
    }
  }

  private restoreScrollPosition(): void {
    const vp = this.viewport();
    if (!vp) {
      return;
    }

    const savedPosition = sessionStorage.getItem(SCROLL_POSITION_KEY);
    if (savedPosition) {
      const scrollTop = parseInt(savedPosition, 10);
      if (!isNaN(scrollTop) && scrollTop > 0) {
        vp.scrollToOffset(scrollTop);
        // Clear saved position after successful restoration
        sessionStorage.removeItem(SCROLL_POSITION_KEY);
      }
    }
  }
}
