import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  HostListener,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import {
  nucleoTransfer as ArrowLeftRight,
  nucleoBadgeCheck as BadgeCheck,
  nucleoHistory as ClockFading,
  nucleoInfo as Info,
  nucleoLayers as Layers,
  NucleoIcon,
  nucleoPlus as Plus,
  nucleoRedo as Redo2,
  nucleoSearch as Search,
  nucleoUndo as Undo2,
  nucleoClose as X,
} from '@kualia/icons';
import { debounceTime, distinctUntilChanged, skip } from 'rxjs';
import { FilterConfig, ResponsiveFilterRowComponent } from '../../components/budget/responsive-filter-row.component';
import { ScheduledTransactionsSectionComponent } from '../../components/scheduled-transactions-section/scheduled-transactions-section';
import { SidebarToggleComponent } from '../../components/sidebar-toggle/sidebar-toggle';
import { TransactionsColumnHeaderComponent } from '../../components/transactions-table/transactions-column-header';
import { TransactionsTableComponent } from '../../components/transactions-table/transactions-table';
import { AiChatService } from '../../services/ai-chat.service';
import { TransactionFilterService } from '../../services/transaction-filter.service';
import { TransactionFilterType, TransactionService } from '../../services/transaction.service';
import { UndoRedoService } from '../../services/undo-redo.service';

@Component({
  selector: 'app-transactions',
  imports: [
    FormsModule,
    HlmButton,
    NucleoIcon,
    ResponsiveFilterRowComponent,
    ScheduledTransactionsSectionComponent,
    SidebarToggleComponent,
    TransactionsColumnHeaderComponent,
    TransactionsTableComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transactions.html',
})
export class TransactionsComponent implements OnInit {
  protected readonly Plus = Plus;
  protected readonly Redo2 = Redo2;
  protected readonly Layers = Layers;
  protected readonly Info = Info;
  protected readonly ClockFading = ClockFading;
  protected readonly Search = Search;
  protected readonly Undo2 = Undo2;
  protected readonly X = X;

  private readonly transactionService = inject(TransactionService);
  private readonly undoRedoService = inject(UndoRedoService);
  private readonly transactionFilterService = inject(TransactionFilterService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly aiChat = inject(AiChatService);

  // Undo/Redo
  readonly canUndo = this.undoRedoService.canUndo;
  readonly canRedo = this.undoRedoService.canRedo;

  // Search state
  readonly isSearchFocused = signal(false);
  readonly searchQuery = signal((this.route.snapshot.queryParams['search'] as string | undefined) ?? '');
  readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  // Check if clear button should be shown (has search text)
  readonly hasSearchQuery = computed(() => this.searchQuery().trim().length > 0);

  // Input should be expanded when focused or has content
  readonly isSearchExpanded = computed(() => this.isSearchFocused() || this.hasSearchQuery());

  private readonly queryParams = toSignal(this.route.queryParams);

  // Use transactions from the service (server-side filtering/pagination)
  readonly transactions = this.transactionService.transactions;
  readonly loading = this.transactionService.loading;
  readonly loadingMore = this.transactionService.loadingMore;
  readonly error = this.transactionService.error;
  readonly hasMore = this.transactionService.hasMore;

  // Transaction status counts for badges
  readonly pendingCount = this.transactionService.pendingCount;
  readonly needsReviewCount = this.transactionService.needsReviewCount;
  readonly transferCount = this.transactionService.transferCount;

  // Filter state derived from query params
  readonly activeFilter = computed<TransactionFilterType>(() => {
    const filter = this.queryParams()?.['filter'] as string | undefined;
    if (filter === 'needs_review' || filter === 'pending' || filter === 'transfer') {
      return filter;
    }
    return 'all';
  });

  // Query params for filter links
  readonly allFilterQueryParams = computed(() => {
    return {};
  });

  readonly needsReviewFilterQueryParams = computed(() => {
    return { filter: 'needs_review' };
  });

  readonly pendingFilterQueryParams = computed(() => {
    return { filter: 'pending' };
  });

  readonly transferFilterQueryParams = computed(() => {
    return { filter: 'transfer' };
  });

  // Filters for responsive filter row component
  readonly responsiveFilters = computed<FilterConfig[]>(() => {
    const active = this.activeFilter();
    const needsReviewCount = this.needsReviewCount();
    const pendingCount = this.pendingCount();
    const transferCount = this.transferCount();

    return [
      {
        id: 'all',
        label: 'All',
        icon: Layers,
        queryParams: this.allFilterQueryParams(),
        isActive: active === 'all',
      },
      {
        id: 'needs_review',
        label: 'Needs Review',
        icon: BadgeCheck,
        queryParams: this.needsReviewFilterQueryParams(),
        isActive: active === 'needs_review',
        isPrimary: true,
        count: needsReviewCount > 0 ? needsReviewCount : undefined,
        showCount: needsReviewCount > 0,
      },
      {
        id: 'pending',
        label: 'Pending',
        icon: ClockFading,
        queryParams: this.pendingFilterQueryParams(),
        isActive: active === 'pending',
        isWarning: pendingCount > 0,
        count: pendingCount > 0 ? pendingCount : undefined,
        showCount: pendingCount > 0,
      },
      {
        id: 'transfer',
        label: 'Transfers',
        icon: ArrowLeftRight,
        queryParams: this.transferFilterQueryParams(),
        isActive: active === 'transfer',
        count: transferCount > 0 ? transferCount : undefined,
        showCount: transferCount > 0,
      },
    ];
  });

  private lastFilter: TransactionFilterType | null = null;

  constructor() {
    // Track filter changes from URL query params
    // Fetch data when filter changes
    effect(() => {
      const filter = this.activeFilter();
      this.transactionFilterService.setLastFilter(filter);

      // Only trigger fetch if filter actually changed (not on initial load)
      if (this.lastFilter !== null && this.lastFilter !== filter) {
        void this.transactionService.updateFilters({ filterType: filter });
      }
      this.lastFilter = filter;
    });

    // Debounced search - update filters after 500ms of no typing
    toObservable(this.searchQuery)
      .pipe(skip(1), debounceTime(500), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((searchTerm) => {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { search: searchTerm || null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });

        const sanitized = this.sanitizeSearch(searchTerm);
        void this.transactionService.updateFilters({ search: sanitized });
      });
  }

  ngOnInit(): void {
    // Fetch initial transactions with current filter and search
    const initialSearch = this.sanitizeSearch(this.searchQuery());
    void this.transactionService.updateFilters({
      filterType: this.activeFilter(),
      search: initialSearch,
    });
  }

  // Load more transactions when scrolling
  loadMore(): void {
    void this.transactionService.loadMore();
  }

  // Keyboard shortcuts:
  // - Cmd+F (Mac) / Ctrl+F (Windows) to focus search
  // - 1, 2, 3, 4 to switch filters (when not typing in input)
  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    // The expanded chat owns the keyboard while focused — don't steal Cmd+F or filter keys
    // out from under a chat the user is actively driving.
    if (this.aiChat.shouldCaptureShortcuts()) return;

    // Cmd/Ctrl+F to focus search
    if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
      if (!this.isSearchFocused()) {
        event.preventDefault();
        this.focusSearch();
      }
      return;
    }

    // Don't handle number shortcuts if typing in input fields
    const target = event.target as HTMLElement;
    const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    if (!isTyping) {
      // Number keys for filter shortcuts
      if (event.key === '1') {
        event.preventDefault();
        this.navigateToFilter('all');
      } else if (event.key === '2') {
        event.preventDefault();
        this.navigateToFilter('needs_review');
      } else if (event.key === '3') {
        event.preventDefault();
        this.navigateToFilter('pending');
      } else if (event.key === '4') {
        event.preventDefault();
        this.navigateToFilter('transfer');
      }
    }
  }

  // Navigate to a filter and clear search
  private navigateToFilter(filter: TransactionFilterType): void {
    // Clear search when switching filters
    if (this.hasSearchQuery()) {
      this.searchQuery.set('');
    }

    // Navigate based on filter type
    const queryParams = filter === 'all' ? {} : { filter };

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      replaceUrl: false,
    });
  }

  // Search methods
  focusSearch(): void {
    this.searchInput()?.nativeElement.focus();
  }

  clearSearch(): void {
    this.searchQuery.set('');
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { search: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    void this.transactionService.updateFilters({ search: undefined });
    this.searchInput()?.nativeElement.blur();
  }

  onSearchFocus(): void {
    this.isSearchFocused.set(true);
  }

  onSearchBlur(): void {
    this.isSearchFocused.set(false);
  }

  onSearchEscape(): void {
    if (this.hasSearchQuery()) {
      // If has text, clear it
      this.searchQuery.set('');
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { search: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
      void this.transactionService.updateFilters({ search: undefined });
    }
    this.searchInput()?.nativeElement.blur();
  }

  onWrapperSpaceKey(event: Event): void {
    // Only prevent default if the wrapper div itself has focus (not the input)
    // This allows space to work normally when typing in the input field
    const keyboardEvent = event as KeyboardEvent;
    if (
      keyboardEvent.target === keyboardEvent.currentTarget ||
      (keyboardEvent.target as HTMLElement).tagName !== 'INPUT'
    ) {
      keyboardEvent.preventDefault();
      this.focusSearch();
    }
  }

  openCreateTransactionDialog(): void {
    this.transactionService.openCreateDialog();
  }

  undo(): void {
    void this.undoRedoService.undo();
  }

  redo(): void {
    void this.undoRedoService.redo();
  }

  // Strip non-alphanumeric characters to prevent Convex tokenization issues
  // e.g., "$14.73" → "1473", "what's" → "whats"
  // Then remove spaces entirely for exact phrase matching
  // (underscores don't work - Convex tokenizer treats them as word separators)
  // e.g., "dining out" → "diningout"
  // Returns undefined if fewer than 2 chars after sanitization
  private sanitizeSearch(searchTerm: string): string | undefined {
    const sanitized = searchTerm
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '');

    return sanitized.length >= 2 ? sanitized : undefined;
  }
}
