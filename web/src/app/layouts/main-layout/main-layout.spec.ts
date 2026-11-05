import { CUSTOM_ELEMENTS_SCHEMA, provideZonelessChangeDetection, signal, type WritableSignal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { type NavigationEnd, Router } from '@angular/router';
import {
  nucleoEmail,
  nucleoTransactions,
  nucleoCalendarFilled,
  nucleoBank,
  nucleoReports,
  nucleoPreferences,
} from '@kualia/icons';
import { HlmSidebarService } from '@spartan-ng/helm/sidebar';
import type { Id } from 'convex/_generated/dataModel';
import type { BudgetMonthData } from 'convex/categoryBudgets/types';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiChatLauncherComponent } from '../../components/ai-chat/ai-chat-launcher';
import { NavigationItemComponent } from '../../components/navigation-item/navigation-item';
import { SidebarBankAccountsComponent } from '../../components/sidebar-bank-accounts/sidebar-bank-accounts';
import { SidebarOrganizationDropdownComponent } from '../../components/sidebar-organization-dropdown/sidebar-organization-dropdown';
import { SidebarWorkspaceDropdownComponent } from '../../components/sidebar-workspace-dropdown/sidebar-workspace-dropdown';
import { UserPreferencesService } from '../../core/services/preferences/user-preferences.service';
import { AiChatService } from '../../services/ai-chat.service';
import { AppInitializationService } from '../../services/app-initialization.service';
import { BudgetService } from '../../services/budget.service';
import { BudgetFilterService } from '../../services/budget-filter.service';
import { BudgetMonthService } from '../../services/budget-month.service';
import { CategoryService } from '../../services/category.service';
import { TransactionService } from '../../services/transaction.service';
import { TransactionFilterService } from '../../services/transaction-filter.service';
import { WorkspaceService } from '../../services/workspace.service';
import { MainLayoutComponent } from './main-layout';
import mainLayoutTemplate from './main-layout.html?raw';

describe('MainLayoutComponent', () => {
  let component: MainLayoutComponent;
  let fixture: ComponentFixture<MainLayoutComponent>;
  let appReady: WritableSignal<boolean>;
  let initialNavigationCompleted: WritableSignal<boolean>;
  let routerEvents$: Subject<NavigationEnd>;
  let currentUrl: string;

  // Mock services
  let mockWorkspaceService: {
    workspaceShortId: ReturnType<typeof signal<string | null>>;
  };

  let mockBudgetMonthService: {
    getLastViewedMonth: ReturnType<typeof vi.fn>;
    getLastViewedMonthQueryParam: ReturnType<typeof vi.fn>;
  };

  let mockBudgetFilterService: {
    getLastFilterQueryParam: ReturnType<typeof vi.fn>;
  };

  let mockBudgetService: {
    months: ReturnType<typeof signal<BudgetMonthData[]>>;
  };

  let mockCategoryService: {
    categoryHierarchy: ReturnType<typeof signal<{ categories: { _id: Id<'category'>; isDeleted: boolean }[] }[]>>;
  };

  let mockTransactionFilterService: {
    getLastFilterQueryParam: ReturnType<typeof vi.fn>;
    setLastFilter: ReturnType<typeof vi.fn>;
  };

  let mockTransactionService: {
    pendingCount: ReturnType<typeof signal<number>>;
    needsReviewCount: ReturnType<typeof signal<number>>;
  };

  let mockSidebarService: {
    open: ReturnType<typeof signal<boolean>>;
    openMobile: ReturnType<typeof signal<boolean>>;
    isMobile: ReturnType<typeof signal<boolean>>;
    variant: ReturnType<typeof signal>;
    state: ReturnType<typeof signal<'expanded' | 'collapsed'>>;
    setOpenMobile: ReturnType<typeof vi.fn>;
    setVariant: ReturnType<typeof vi.fn>;
    toggleSidebar: ReturnType<typeof vi.fn>;
  };

  const createComponent = (initialUrl = '/test-workspace/transactions') => {
    currentUrl = initialUrl;
    routerEvents$ = new Subject<NavigationEnd>();
    appReady = signal(true);
    initialNavigationCompleted = signal(true);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MainLayoutComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: Router,
          useValue: {
            get url() {
              return currentUrl;
            },
            events: routerEvents$.asObservable(),
          },
        },
        {
          provide: AppInitializationService,
          useValue: { isAppReady: appReady, hasCompletedInitialNavigation: initialNavigationCompleted },
        },
        {
          provide: AiChatService,
          useValue: {
            expanded: signal(false),
            setChatPanelTargetRect: vi.fn(),
          },
        },
        {
          provide: UserPreferencesService,
          useValue: {
            theme: signal('system'),
            resolvedTheme: signal('light'),
            setTheme: vi.fn(),
          },
        },
        { provide: WorkspaceService, useValue: mockWorkspaceService },
        { provide: BudgetMonthService, useValue: mockBudgetMonthService },
        { provide: BudgetFilterService, useValue: mockBudgetFilterService },
        { provide: BudgetService, useValue: mockBudgetService },
        { provide: CategoryService, useValue: mockCategoryService },
        { provide: TransactionFilterService, useValue: mockTransactionFilterService },
        { provide: TransactionService, useValue: mockTransactionService },
        { provide: HlmSidebarService, useValue: mockSidebarService },
      ],
    });
    TestBed.overrideComponent(MainLayoutComponent, {
      remove: {
        imports: [
          AiChatLauncherComponent,
          NavigationItemComponent,
          SidebarBankAccountsComponent,
          SidebarOrganizationDropdownComponent,
          SidebarWorkspaceDropdownComponent,
        ],
      },
      add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    });

    fixture = TestBed.createComponent(MainLayoutComponent);
    component = fixture.componentInstance;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockWorkspaceService = {
      workspaceShortId: signal<string | null>('test-workspace'),
    };

    mockBudgetMonthService = {
      getLastViewedMonth: vi.fn(() => 202511),
      getLastViewedMonthQueryParam: vi.fn(() => '2025-11'),
    };

    mockBudgetFilterService = {
      getLastFilterQueryParam: vi.fn(() => null),
    };

    mockBudgetService = {
      months: signal<BudgetMonthData[]>([]),
    };

    mockCategoryService = {
      categoryHierarchy: signal([]),
    };

    mockTransactionFilterService = {
      getLastFilterQueryParam: vi.fn(() => null),
      setLastFilter: vi.fn(),
    };

    mockTransactionService = {
      pendingCount: signal(0),
      needsReviewCount: signal(0),
    };

    mockSidebarService = {
      open: signal(true),
      openMobile: signal(false),
      isMobile: signal(false),
      variant: signal('sidebar'),
      state: signal<'expanded' | 'collapsed'>('expanded'),
      setOpenMobile: vi.fn(),
      setVariant: vi.fn(),
      toggleSidebar: vi.fn(),
    };

    createComponent();
  });

  describe('hasNeedsReviewTransactions', () => {
    it('should return false when needs review count is 0', () => {
      mockTransactionService.needsReviewCount.set(0);
      expect(component.hasNeedsReviewTransactions()).toBe(false);
    });

    it('should return true when needs review count is greater than 0', () => {
      mockTransactionService.needsReviewCount.set(5);
      expect(component.hasNeedsReviewTransactions()).toBe(true);
    });

    it('should update reactively when needs review count changes', () => {
      mockTransactionService.needsReviewCount.set(0);
      expect(component.hasNeedsReviewTransactions()).toBe(false);

      mockTransactionService.needsReviewCount.set(10);
      expect(component.hasNeedsReviewTransactions()).toBe(true);

      mockTransactionService.needsReviewCount.set(0);
      expect(component.hasNeedsReviewTransactions()).toBe(false);
    });
  });

  describe('needsReviewRoutePath', () => {
    it('should return correct route path with workspace short ID', () => {
      mockWorkspaceService.workspaceShortId.set('my-workspace');
      expect(component.needsReviewRoutePath()).toBe('/my-workspace/transactions');
    });

    it('should return empty string when workspace short ID is not available', () => {
      mockWorkspaceService.workspaceShortId.set(null);
      expect(component.needsReviewRoutePath()).toBe('');
    });
  });

  describe('needsReviewQueryParams', () => {
    it('should return correct query params for needs_review filter', () => {
      const params = component.needsReviewQueryParams();
      expect(params).toEqual({ filter: 'needs_review' });
    });
  });

  describe('isNeedsReviewFilterActive', () => {
    it('should return false when not on transactions page', () => {
      createComponent('/test-workspace/budget');
      expect(component.isNeedsReviewFilterActive()).toBe(false);
    });

    it('should return false when on transactions page without filter param', () => {
      createComponent('/test-workspace/transactions');
      expect(component.isNeedsReviewFilterActive()).toBe(false);
    });

    it('should return true when on transactions page with filter=needs_review', () => {
      createComponent('/test-workspace/transactions?filter=needs_review');
      expect(component.isNeedsReviewFilterActive()).toBe(true);
    });

    it('should return false when on transactions page with different filter', () => {
      createComponent('/test-workspace/transactions?filter=pending');
      expect(component.isNeedsReviewFilterActive()).toBe(false);
    });

    it('should return false when on bank-account page', () => {
      createComponent('/test-workspace/bank-account/123');
      expect(component.isNeedsReviewFilterActive()).toBe(false);
    });
  });

  describe('handleNeedsReviewClick', () => {
    it('should close mobile sidebar when needs review link is clicked', () => {
      component.handleNeedsReviewClick();
      expect(mockSidebarService.setOpenMobile).toHaveBeenCalledWith(false);
    });
  });

  describe('toggleSidebar', () => {
    it('should toggle the sidebar through the sidebar service', () => {
      component.toggleSidebar();
      expect(mockSidebarService.toggleSidebar).toHaveBeenCalledOnce();
    });
  });

  describe('sidebar scrolling', () => {
    it('applies the scroll-aware fade to the sidebar content container', () => {
      expect(mainLayoutTemplate).toContain('class="sidebar-scroll-fade pb-10 group-data-[collapsible=icon]:pb-0"');
    });

    it('keeps one content card mounted while its routed content fades in', () => {
      expect(mainLayoutTemplate).toContain('[class.content-area]="shellEnabled()"');
      expect(mainLayoutTemplate).toContain('[class.opacity-100]="contentReady()"');
      expect(mainLayoutTemplate).toContain('<ng-content />');
      expect(mainLayoutTemplate).not.toContain('<router-outlet />');
      expect(mainLayoutTemplate).toContain('<hlm-spinner class="text-primary text-3xl"');
    });

    it('keeps route-owned horizontal scrolling inside the content card', () => {
      expect(mainLayoutTemplate).toContain('class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"');
      expect(mainLayoutTemplate).toContain(
        'class="h-full min-w-0 max-w-full overflow-hidden transition-opacity duration-200"'
      );
    });

    it('fades the complete sidebar content without fading the sidebar shell', () => {
      expect(mainLayoutTemplate.match(/\[class\.opacity-100\]="revealReady\(\)"/g)).toHaveLength(4);
      expect(mainLayoutTemplate).toContain('class="transition-opacity duration-200"');
      expect(mainLayoutTemplate).toContain('@if (shellEnabled())');
    });

    it('waits for initial route activation before revealing the shell', () => {
      initialNavigationCompleted.set(false);
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('[data-loading-region="sidebar-content"]')?.classList.contains('opacity-0')).toBe(true);
      expect(host.querySelector('[data-loading-region="route-content"]')?.classList.contains('opacity-0')).toBe(true);

      initialNavigationCompleted.set(true);
      fixture.detectChanges();

      expect(host.querySelector('[data-loading-region="sidebar-content"]')?.classList.contains('opacity-100')).toBe(
        true
      );
      expect(host.querySelector('[data-loading-region="route-content"]')?.classList.contains('opacity-100')).toBe(true);
    });

    it('shows the settings layout outline until settings navigation completes', () => {
      fixture.componentRef.setInput('shellEnabled', false);
      fixture.componentRef.setInput('settingsShellEnabled', true);
      initialNavigationCompleted.set(false);
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      const placeholder = host.querySelector('[data-loading-region="settings-placeholder"]');
      expect(placeholder?.classList.contains('opacity-100')).toBe(true);
      expect(mainLayoutTemplate).toContain(
        'class="bg-background hidden h-full w-[var(--sidebar-width)] shrink-0 md:block"'
      );
      expect(mainLayoutTemplate).not.toContain('bg-sidebar hidden h-full w-64');
      expect(host.querySelector('[data-loading-region="route-content"]')?.classList.contains('opacity-0')).toBe(true);

      initialNavigationCompleted.set(true);
      fixture.detectChanges();

      expect(placeholder?.classList.contains('opacity-0')).toBe(true);
      expect(host.querySelector('[data-loading-region="route-content"]')?.classList.contains('opacity-100')).toBe(true);
    });

    it('preserves the shell nodes while readiness changes in place', () => {
      appReady.set(false);
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      const appLayout = host.querySelector('[data-loading-region="app-layout"]');
      const contentCard = host.querySelector('[data-loading-region="content-card"]');
      const sidebarContent = host.querySelector('[data-loading-region="sidebar-content"]');
      const routeContent = host.querySelector('[data-loading-region="route-content"]');
      const spinner = host.querySelector('[data-loading-region="spinner"]');

      expect(contentCard).not.toBeNull();
      expect(sidebarContent?.classList.contains('opacity-0')).toBe(true);
      expect(routeContent?.classList.contains('opacity-0')).toBe(true);
      expect(spinner?.classList.contains('opacity-100')).toBe(true);

      appReady.set(true);
      fixture.detectChanges();

      expect(host.querySelector('[data-loading-region="app-layout"]')).toBe(appLayout);
      expect(host.querySelector('[data-loading-region="content-card"]')).toBe(contentCard);
      expect(host.querySelector('[data-loading-region="sidebar-content"]')).toBe(sidebarContent);
      expect(host.querySelector('[data-loading-region="route-content"]')).toBe(routeContent);
      expect(host.querySelector('[data-loading-region="spinner"]')).toBe(spinner);
      expect(sidebarContent?.classList.contains('opacity-100')).toBe(true);
      expect(routeContent?.classList.contains('opacity-100')).toBe(true);
      expect(spinner?.classList.contains('opacity-0')).toBe(true);
    });
  });

  describe('help and feedback', () => {
    it('uses a compact gap between footer actions', () => {
      expect(mainLayoutTemplate.match(/flex-col[^\n]*gap-1/g)).toHaveLength(2);
    });

    it('places the theme picker to the right of the expanded user menu', () => {
      const profileRow = mainLayoutTemplate.match(
        /<div class="flex items-center gap-1">[\s\S]*?<app-sidebar-organization-dropdown class="min-w-0 flex-1" \/>[\s\S]*?aria-label="Theme"[\s\S]*?<\/div>/
      );

      expect(profileRow).not.toBeNull();
    });

    it('places the workspace dropdown before the sidebar collapse button', () => {
      const workspaceDropdownIndex = mainLayoutTemplate.indexOf('<app-sidebar-workspace-dropdown');
      const collapseButtonIndex = mainLayoutTemplate.indexOf('[attr.aria-label]="sidebarToggleLabel()"');

      expect(workspaceDropdownIndex).toBeGreaterThan(-1);
      expect(collapseButtonIndex).toBeGreaterThan(workspaceDropdownIndex);
    });

    it('does not show tooltips on theme or sidebar toggle buttons', () => {
      expect(mainLayoutTemplate).not.toContain('[hlmTooltip]="\'Theme\'"');
      expect(mainLayoutTemplate).not.toContain('[hlmTooltip]="sidebarToggleLabel()"');
      expect(mainLayoutTemplate).not.toContain('[hlmTooltip]="\'Expand sidebar\'"');
    });
  });

  describe('navItems with needs review transactions', () => {
    it('matches the current iOS feature icons', () => {
      createComponent('/test-workspace/budget');

      expect(component['navItems']().map(({ label, icon }) => [label, icon])).toEqual([
        ['Budget', nucleoEmail],
        ['Transactions', nucleoTransactions],
        ['Planned', nucleoCalendarFilled],
        ['Accounts', nucleoBank],
        ['Reports', nucleoReports],
        ['Settings', nucleoPreferences],
      ]);
    });

    it('should include transactions nav item', () => {
      createComponent('/test-workspace/budget');

      const navItems = component['navItems']();
      const transactionsItem = navItems.find((item) => item.label === 'Transactions');

      expect(transactionsItem).toBeDefined();
      expect(transactionsItem?.route).toContain('/test-workspace/transactions');
    });

    it('should preserve transaction filter in route when filter is set', () => {
      mockTransactionFilterService.getLastFilterQueryParam.mockReturnValue('needs_review');
      createComponent('/test-workspace/budget');

      const navItems = component['navItems']();
      const transactionsItem = navItems.find((item) => item.label === 'Transactions');

      expect(transactionsItem?.route).toContain('filter=needs_review');
    });

    it('places workspace settings directly after reports', () => {
      const navItems = component['navItems']();
      const reportsIndex = navItems.findIndex((item) => item.label === 'Reports');
      const settingsIndex = navItems.findIndex((item) => item.label === 'Settings');

      expect(settingsIndex).toBe(reportsIndex + 1);
      expect(navItems[settingsIndex]?.route).toBe('/test-workspace/settings');
    });
  });
});
