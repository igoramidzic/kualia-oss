import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { HlmSidebarService } from '@spartan-ng/helm/sidebar';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ResponsiveFilterRowComponent } from '../../components/budget/responsive-filter-row.component';
import { TransactionFilterService } from '../../services/transaction-filter.service';
import { TransactionService, TransactionWithRelations } from '../../services/transaction.service';
import { TransactionsComponent } from './transactions';

// Mock matchMedia for sidebar service
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

describe('TransactionsComponent', () => {
  let component: TransactionsComponent;
  let fixture: ComponentFixture<TransactionsComponent>;
  let queryParams$: Subject<Record<string, string>>;

  // Mock services
  let mockTransactionService: {
    transactions: ReturnType<typeof signal<TransactionWithRelations[]>>;
    loading: ReturnType<typeof signal<boolean>>;
    loadingMore: ReturnType<typeof signal<boolean>>;
    error: ReturnType<typeof signal<string | null>>;
    hasMore: ReturnType<typeof signal<boolean>>;
    pendingCount: ReturnType<typeof signal<number>>;
    needsReviewCount: ReturnType<typeof signal<number>>;
    transferCount: ReturnType<typeof signal<number>>;
    updateFilters: ReturnType<typeof vi.fn>;
    loadMore: ReturnType<typeof vi.fn>;
  };

  let mockTransactionFilterService: {
    setLastFilter: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
    queryParams$ = new Subject<Record<string, string>>();

    mockTransactionService = {
      transactions: signal<TransactionWithRelations[]>([]),
      loading: signal(false),
      loadingMore: signal(false),
      error: signal<string | null>(null),
      hasMore: signal(true),
      pendingCount: signal(0),
      needsReviewCount: signal(0),
      transferCount: signal(0),
      updateFilters: vi.fn().mockResolvedValue(undefined),
      loadMore: vi.fn().mockResolvedValue(undefined),
    };

    mockTransactionFilterService = {
      setLastFilter: vi.fn(),
    };

    const mockSidebarService = {
      setOpenMobile: vi.fn(),
      state: signal('expanded'),
      open: signal(true),
      openMobile: signal(false),
      isMobile: signal(false),
      setOpen: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [TransactionsComponent, RouterModule.forRoot([])],
      providers: [
        provideZonelessChangeDetection(),
        { provide: TransactionService, useValue: mockTransactionService },
        { provide: TransactionFilterService, useValue: mockTransactionFilterService },
        { provide: HlmSidebarService, useValue: mockSidebarService },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParams: queryParams$.asObservable(),
            snapshot: { queryParams: {} },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TransactionsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('filter row layout', () => {
    it('gives desktop filters the available header width before collapsing', () => {
      const filterRows = fixture.debugElement.queryAll(By.directive(ResponsiveFilterRowComponent));
      const desktopFilters = filterRows[0];
      const desktopComponent = desktopFilters.componentInstance as ResponsiveFilterRowComponent;

      expect(desktopFilters.classes['min-w-0']).toBe(true);
      expect(desktopFilters.classes['flex-1']).toBe(true);
      expect(desktopFilters.classes['lg:block']).toBe(true);
      expect(desktopComponent.containerClass()).toBe('flex w-full min-w-0 items-center gap-1 overflow-hidden');
    });

    it('keeps mobile filters on their own row', () => {
      const filterRows = fixture.debugElement.queryAll(By.directive(ResponsiveFilterRowComponent));
      const mobileFilters = filterRows[1];

      expect(mobileFilters.classes['block']).toBe(true);
      expect(mobileFilters.classes['lg:hidden']).toBe(true);
    });

    it('keeps search controls aligned to the right edge', () => {
      const searchInput = fixture.nativeElement.querySelector('input[placeholder="Search..."]') as HTMLInputElement;
      const headerActions = searchInput.parentElement?.parentElement?.parentElement;

      expect(headerActions?.classList.contains('ml-auto')).toBe(true);
      expect(headerActions?.classList.contains('shrink-0')).toBe(true);
    });
  });

  describe('needsReviewCount signal', () => {
    it('should expose needs review count from transaction service', () => {
      mockTransactionService.needsReviewCount.set(5);
      expect(mockTransactionService.needsReviewCount()).toBe(5);
    });

    it('should update when transaction service count changes', () => {
      mockTransactionService.needsReviewCount.set(0);
      expect(mockTransactionService.needsReviewCount()).toBe(0);

      mockTransactionService.needsReviewCount.set(10);
      expect(mockTransactionService.needsReviewCount()).toBe(10);
    });
  });

  describe('pendingCount signal', () => {
    it('should expose pending count from transaction service', () => {
      mockTransactionService.pendingCount.set(3);
      expect(mockTransactionService.pendingCount()).toBe(3);
    });

    it('should update when transaction service count changes', () => {
      mockTransactionService.pendingCount.set(0);
      expect(mockTransactionService.pendingCount()).toBe(0);

      mockTransactionService.pendingCount.set(7);
      expect(mockTransactionService.pendingCount()).toBe(7);
    });
  });

  describe('responsiveFilters computed', () => {
    it('should include all filter with correct properties', () => {
      const filters = component.responsiveFilters();
      const allFilter = filters.find((f) => f.id === 'all');

      expect(allFilter).toBeDefined();
      expect(allFilter?.label).toBe('All');
      expect(allFilter?.queryParams).toEqual({});
    });

    it('should include needs review filter with count when needsReview > 0', () => {
      mockTransactionService.needsReviewCount.set(5);

      const filters = component.responsiveFilters();
      const needsReviewFilter = filters.find((f) => f.id === 'needs_review');

      expect(needsReviewFilter).toBeDefined();
      expect(needsReviewFilter?.label).toBe('Needs Review');
      expect(needsReviewFilter?.count).toBe(5);
      expect(needsReviewFilter?.showCount).toBe(true);
      expect(needsReviewFilter?.isPrimary).toBe(true);
      expect(needsReviewFilter?.queryParams).toEqual({ filter: 'needs_review' });
    });

    it('should include needs review filter without count when needsReview is 0', () => {
      mockTransactionService.needsReviewCount.set(0);

      const filters = component.responsiveFilters();
      const needsReviewFilter = filters.find((f) => f.id === 'needs_review');

      expect(needsReviewFilter).toBeDefined();
      expect(needsReviewFilter?.count).toBeUndefined();
      expect(needsReviewFilter?.showCount).toBe(false);
    });

    it('should include pending filter with count when pending > 0', () => {
      mockTransactionService.pendingCount.set(3);

      const filters = component.responsiveFilters();
      const pendingFilter = filters.find((f) => f.id === 'pending');

      expect(pendingFilter).toBeDefined();
      expect(pendingFilter?.label).toBe('Pending');
      expect(pendingFilter?.count).toBe(3);
      expect(pendingFilter?.showCount).toBe(true);
      expect(pendingFilter?.isWarning).toBe(true);
      expect(pendingFilter?.queryParams).toEqual({ filter: 'pending' });
    });

    it('should include pending filter without count when pending is 0', () => {
      mockTransactionService.pendingCount.set(0);

      const filters = component.responsiveFilters();
      const pendingFilter = filters.find((f) => f.id === 'pending');

      expect(pendingFilter).toBeDefined();
      expect(pendingFilter?.count).toBeUndefined();
      expect(pendingFilter?.showCount).toBe(false);
      expect(pendingFilter?.isWarning).toBe(false);
    });

    it('should include transfer filter with count when transfer > 0', () => {
      mockTransactionService.transferCount.set(7);

      const filters = component.responsiveFilters();
      const transferFilter = filters.find((f) => f.id === 'transfer');

      expect(transferFilter).toBeDefined();
      expect(transferFilter?.label).toBe('Transfers');
      expect(transferFilter?.count).toBe(7);
      expect(transferFilter?.showCount).toBe(true);
      expect(transferFilter?.queryParams).toEqual({ filter: 'transfer' });
    });

    it('should include transfer filter without count when transfer is 0', () => {
      mockTransactionService.transferCount.set(0);

      const filters = component.responsiveFilters();
      const transferFilter = filters.find((f) => f.id === 'transfer');

      expect(transferFilter).toBeDefined();
      expect(transferFilter?.count).toBeUndefined();
      expect(transferFilter?.showCount).toBe(false);
    });

    it('should update counts reactively when service values change', () => {
      mockTransactionService.needsReviewCount.set(0);
      mockTransactionService.pendingCount.set(0);

      let filters = component.responsiveFilters();
      let needsReviewFilter = filters.find((f) => f.id === 'needs_review');
      let pendingFilter = filters.find((f) => f.id === 'pending');

      expect(needsReviewFilter?.showCount).toBe(false);
      expect(pendingFilter?.showCount).toBe(false);

      // Update counts
      mockTransactionService.needsReviewCount.set(8);
      mockTransactionService.pendingCount.set(4);

      filters = component.responsiveFilters();
      needsReviewFilter = filters.find((f) => f.id === 'needs_review');
      pendingFilter = filters.find((f) => f.id === 'pending');

      expect(needsReviewFilter?.count).toBe(8);
      expect(needsReviewFilter?.showCount).toBe(true);
      expect(pendingFilter?.count).toBe(4);
      expect(pendingFilter?.showCount).toBe(true);
    });
  });

  describe('activeFilter computed', () => {
    it('should return "all" when no filter query param', () => {
      queryParams$.next({});
      fixture.detectChanges();

      expect(component.activeFilter()).toBe('all');
    });

    it('should return "needs_review" when filter=needs_review in query params', () => {
      queryParams$.next({ filter: 'needs_review' });
      fixture.detectChanges();

      expect(component.activeFilter()).toBe('needs_review');
    });

    it('should return "pending" when filter=pending in query params', () => {
      queryParams$.next({ filter: 'pending' });
      fixture.detectChanges();

      expect(component.activeFilter()).toBe('pending');
    });

    it('should return "transfer" when filter=transfer in query params', () => {
      queryParams$.next({ filter: 'transfer' });
      fixture.detectChanges();

      expect(component.activeFilter()).toBe('transfer');
    });

    it('should return "all" for unknown filter values', () => {
      queryParams$.next({ filter: 'unknown' });
      fixture.detectChanges();

      expect(component.activeFilter()).toBe('all');
    });
  });

  describe('responsiveFilters isActive state', () => {
    it('should mark all filter as active when filter is "all"', () => {
      queryParams$.next({});
      fixture.detectChanges();

      const filters = component.responsiveFilters();
      const allFilter = filters.find((f) => f.id === 'all');

      expect(allFilter?.isActive).toBe(true);
    });

    it('should mark needs_review filter as active when filter is "needs_review"', () => {
      queryParams$.next({ filter: 'needs_review' });
      fixture.detectChanges();

      const filters = component.responsiveFilters();
      const needsReviewFilter = filters.find((f) => f.id === 'needs_review');

      expect(needsReviewFilter?.isActive).toBe(true);
    });

    it('should mark pending filter as active when filter is "pending"', () => {
      queryParams$.next({ filter: 'pending' });
      fixture.detectChanges();

      const filters = component.responsiveFilters();
      const pendingFilter = filters.find((f) => f.id === 'pending');

      expect(pendingFilter?.isActive).toBe(true);
    });

    it('should mark transfer filter as active when filter is "transfer"', () => {
      queryParams$.next({ filter: 'transfer' });
      fixture.detectChanges();

      const filters = component.responsiveFilters();
      const transferFilter = filters.find((f) => f.id === 'transfer');

      expect(transferFilter?.isActive).toBe(true);
    });

    it('should only have one active filter at a time', () => {
      queryParams$.next({ filter: 'needs_review' });
      fixture.detectChanges();

      const filters = component.responsiveFilters();
      const activeFilters = filters.filter((f) => f.isActive);

      expect(activeFilters).toHaveLength(1);
      expect(activeFilters[0].id).toBe('needs_review');
    });
  });

  describe('filter query params', () => {
    it('should return empty object for all filter query params', () => {
      expect(component.allFilterQueryParams()).toEqual({});
    });

    it('should return needs_review filter query params', () => {
      expect(component.needsReviewFilterQueryParams()).toEqual({ filter: 'needs_review' });
    });

    it('should return pending filter query params', () => {
      expect(component.pendingFilterQueryParams()).toEqual({ filter: 'pending' });
    });

    it('should return transfer filter query params', () => {
      expect(component.transferFilterQueryParams()).toEqual({ filter: 'transfer' });
    });
  });

  describe('ngOnInit', () => {
    it('should call updateFilters with initial filter type', () => {
      queryParams$.next({});
      fixture.detectChanges();

      component.ngOnInit();

      expect(mockTransactionService.updateFilters).toHaveBeenCalledWith({ filterType: 'all', search: undefined });
    });

    it('should call updateFilters with needs_review filter type when query param is set', () => {
      queryParams$.next({ filter: 'needs_review' });
      fixture.detectChanges();

      component.ngOnInit();

      expect(mockTransactionService.updateFilters).toHaveBeenCalledWith({
        filterType: 'needs_review',
        search: undefined,
      });
    });
  });

  describe('loadMore', () => {
    it('should call transactionService.loadMore', () => {
      component.loadMore();
      expect(mockTransactionService.loadMore).toHaveBeenCalled();
    });
  });
});
