import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  effect,
  inject,
  input,
  isDevMode,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSidebarImports, HlmSidebarService } from '@spartan-ng/helm/sidebar';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import {
  nucleoWarningCircle as AlertCircle,
  nucleoTransactions as TransactionsIcon,
  nucleoBadgeCheck as BadgeCheck,
  nucleoEmail as BudgetIcon,
  nucleoCalendarFilled as PlannedIcon,
  nucleoCheck as Check,
  nucleoSupport as LifeBuoy,
  NucleoIcon,
  type NucleoIconData,
  nucleoSystemAppearance as Monitor,
  nucleoMoon as Moon,
  nucleoSidebarLeftClose as PanelLeftClose,
  nucleoSidebarLeftOpen as PanelLeftOpen,
  nucleoReports as ReportsIcon,
  nucleoPreferences as Settings,
  nucleoSun as Sun,
  nucleoBank as AccountsIcon,
} from '@kualia/icons';
import { filter, map } from 'rxjs';
import { AiChatLauncherComponent } from '../../components/ai-chat/ai-chat-launcher';
import { NavigationItemComponent } from '../../components/navigation-item/navigation-item';
import { SidebarBankAccountsComponent } from '../../components/sidebar-bank-accounts/sidebar-bank-accounts';
import { SidebarOrganizationDropdownComponent } from '../../components/sidebar-organization-dropdown/sidebar-organization-dropdown';
import { SidebarWorkspaceDropdownComponent } from '../../components/sidebar-workspace-dropdown/sidebar-workspace-dropdown';
import { type Theme, UserPreferencesService } from '../../core/services/preferences/user-preferences.service';
import { AiChatService } from '../../services/ai-chat.service';
import { AppInitializationService } from '../../services/app-initialization.service';
import { BudgetService } from '../../services/budget.service';
import { BudgetFilterService } from '../../services/budget-filter.service';
import { BudgetMonthService } from '../../services/budget-month.service';
import { CategoryService } from '../../services/category.service';
import { TransactionService } from '../../services/transaction.service';
import { TransactionFilterService } from '../../services/transaction-filter.service';
import { WorkspaceService } from '../../services/workspace.service';
import { getCurrentYearMonth } from '../../shared/utils/month.utils';
import { HlmDropdownMenuImports } from '../../ui/dropdown-menu/src';
import { HlmTooltip } from '../../ui/tooltip/src';

interface NavItem {
  label: string;
  route: string;
  icon: NucleoIconData;
  exactMatch?: boolean;
  badgeCount?: number | null;
  badgeText?: string | null;
  alertIcon?: NucleoIconData | null;
}

@Component({
  selector: 'app-main-layout',
  imports: [
    RouterLink,
    SidebarOrganizationDropdownComponent,
    SidebarWorkspaceDropdownComponent,
    SidebarBankAccountsComponent,
    NavigationItemComponent,
    AiChatLauncherComponent,
    HlmButton,
    HlmSpinner,
    HlmTooltip,
    NucleoIcon,
    ...HlmDropdownMenuImports,
    ...HlmSidebarImports,
  ],
  templateUrl: './main-layout.html',
  styleUrl: './main-layout.css',
  host: { class: 'block h-full' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MainLayoutComponent {
  private readonly workspaceService = inject(WorkspaceService);
  private readonly budgetMonthService = inject(BudgetMonthService);
  private readonly budgetFilterService = inject(BudgetFilterService);
  private readonly budgetService = inject(BudgetService);
  private readonly categoryService = inject(CategoryService);
  private readonly transactionFilterService = inject(TransactionFilterService);
  private readonly transactionService = inject(TransactionService);
  private readonly router = inject(Router);
  private readonly sidebarService = inject(HlmSidebarService);
  private readonly userPreferencesService = inject(UserPreferencesService);
  private readonly appInitializationService = inject(AppInitializationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly debugLoading =
    isDevMode() && typeof window !== 'undefined' && !navigator.userAgent.includes('jsdom');
  private lastDebugSnapshot = '';
  protected readonly aiChat = inject(AiChatService);

  private readonly mainEl = viewChild<ElementRef<HTMLElement>>('mainEl');
  readonly shellEnabled = input(true);
  readonly settingsShellEnabled = input(false);
  readonly isAppReady = this.appInitializationService.isAppReady;
  readonly revealReady = computed(
    () => this.isAppReady() && this.appInitializationService.hasCompletedInitialNavigation()
  );
  readonly contentReady = computed(() => (!this.shellEnabled() && !this.settingsShellEnabled()) || this.revealReady());

  constructor() {
    afterNextRender(() => {
      if (this.debugLoading) {
        console.debug('[Kualia loading] Main layout rendered', {
          shellEnabled: this.shellEnabled(),
          settingsShellEnabled: this.settingsShellEnabled(),
          ready: this.isAppReady(),
          revealReady: this.revealReady(),
        });
      }
    });
    this.destroyRef.onDestroy(() => {
      if (this.debugLoading) {
        console.debug('[Kualia loading] Main layout destroyed');
      }
    });

    effect(() => {
      if (!this.debugLoading) {
        return;
      }

      const snapshot = {
        shellEnabled: this.shellEnabled(),
        settingsShellEnabled: this.settingsShellEnabled(),
        ready: this.isAppReady(),
        revealReady: this.revealReady(),
        contentReady: this.contentReady(),
      };
      const serializedSnapshot = JSON.stringify(snapshot);
      if (serializedSnapshot === this.lastDebugSnapshot) {
        return;
      }

      this.lastDebugSnapshot = serializedSnapshot;
      console.debug('[Kualia loading] Main layout state', snapshot);
    });

    // Publish where the chat panel should expand to — the original (un-expanded) content card's
    // bounds. Computed from <main>'s rect using the default padding values from the template, so
    // the target stays stable when expansion overrides those paddings. Width matches the original
    // content card's width per UX intent (card shrinks behind, but the chat panel doesn't).
    //
    // Constants below mirror the Tailwind classes on <main> and the chat-bar wrapper:
    //   <main class="lg:pe-2 lg:pt-2 lg:pb-1">  →  pt=8, pe=8, pb=4, ps=0
    //   <bar  class="lg:pt-1">                  →  bar height = h-8 (32) + pt-1 (4) = 36
    const DEFAULT_MAIN_PT = 8;
    const DEFAULT_MAIN_PE = 8;
    const DEFAULT_MAIN_PS = 0;
    const DEFAULT_MAIN_PB = 4;
    const DEFAULT_BAR_HEIGHT = 36;

    effect((onCleanup) => {
      const el = this.mainEl()?.nativeElement;
      if (!el || !this.shellEnabled()) {
        this.aiChat.setChatPanelTargetRect(null);
        return;
      }
      if (this.workspaceService.workspaceShortId()) {
        this.loadPlaidScript();
      }
      const publish = () => {
        const rect = el.getBoundingClientRect();
        this.aiChat.setChatPanelTargetRect({
          top: rect.top + DEFAULT_MAIN_PT,
          left: rect.left + DEFAULT_MAIN_PS,
          width: rect.width - DEFAULT_MAIN_PS - DEFAULT_MAIN_PE,
          height: rect.height - DEFAULT_MAIN_PT - DEFAULT_MAIN_PB - DEFAULT_BAR_HEIGHT,
        });
      };
      publish();
      const observer = new ResizeObserver(publish);
      observer.observe(el);
      window.addEventListener('resize', publish);
      onCleanup(() => {
        observer.disconnect();
        window.removeEventListener('resize', publish);
        this.aiChat.setChatPanelTargetRect(null);
      });
    });
  }

  // Track current router URL to reactively update nav items
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url)
    ),
    { initialValue: this.router.url }
  );

  // Check if there are overspent categories in the current month
  readonly hasOverspentCategories = computed(() => {
    const currentMonth = getCurrentYearMonth();
    const months = this.budgetService.months();
    const budgetData = months.find((m) => m.yearMonth === currentMonth);
    if (!budgetData) return false;

    const categoryHierarchy = this.categoryService.categoryHierarchy();
    const budgetDataByCategory = budgetData.budgetData;

    for (const groupData of categoryHierarchy) {
      for (const category of groupData.categories) {
        if (category.isDeleted) continue;
        const categoryBudget = budgetDataByCategory[category._id];
        if (categoryBudget && categoryBudget.available < 0n) {
          return true;
        }
      }
    }

    return false;
  });

  // Check if there are needs review transactions
  readonly hasNeedsReviewTransactions = computed(() => {
    return this.transactionService.needsReviewCount() > 0;
  });

  readonly AlertCircle = AlertCircle;
  readonly BadgeCheck = BadgeCheck;
  readonly Check = Check;
  readonly LifeBuoy = LifeBuoy;
  readonly PanelLeftOpen = PanelLeftOpen;

  // Theme toggle
  readonly currentTheme = computed(() => this.userPreferencesService.theme());
  readonly themeOptions: { value: Theme; label: string; icon: NucleoIconData }[] = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ];
  readonly currentThemeIcon = computed(() => {
    const theme = this.currentTheme();
    if (theme === 'system') {
      return this.userPreferencesService.resolvedTheme() === 'dark' ? Moon : Sun;
    }
    return theme === 'dark' ? Moon : Sun;
  });

  protected readonly sidebarToggleLabel = computed(() =>
    this.sidebarService.state() === 'collapsed' ? 'Expand sidebar' : 'Collapse sidebar'
  );
  protected readonly sidebarToggleIcon = computed(() =>
    this.sidebarService.state() === 'collapsed' ? PanelLeftOpen : PanelLeftClose
  );
  selectTheme(theme: Theme): void {
    this.userPreferencesService.setTheme(theme);
  }

  toggleSidebar(): void {
    this.sidebarService.toggleSidebar();
  }

  // Computed signal for overspent filter route path
  readonly overspentRoutePath = computed(() => {
    const workspaceShortId = this.workspaceService.workspaceShortId();
    if (!workspaceShortId) return '';
    return `/${workspaceShortId}/budget`;
  });

  // Computed signal for overspent filter query params
  readonly overspentQueryParams = computed(() => {
    const monthParam = this.budgetMonthService.getLastViewedMonthQueryParam();
    const params: Record<string, string> = { filter: 'overspent' };
    if (monthParam) {
      params['month'] = monthParam;
    }
    return params;
  });

  // Check if the overspent filter is active (for active styling of alert link)
  readonly isOverspentFilterActive = computed(() => {
    const url = this.currentUrl();
    if (!url.includes('/budget')) return false;

    // Check if filter=overspent is in the query parameters
    const urlParts = url.split('?');
    if (urlParts.length > 1) {
      const params = new URLSearchParams(urlParts[1]);
      return params.get('filter') === 'overspent';
    }
    return false;
  });

  // Computed signal for needs review filter route path
  readonly needsReviewRoutePath = computed(() => {
    const workspaceShortId = this.workspaceService.workspaceShortId();
    if (!workspaceShortId) return '';
    return `/${workspaceShortId}/transactions`;
  });

  // Computed signal for needs review filter query params
  readonly needsReviewQueryParams = computed(() => {
    return { filter: 'needs_review' };
  });

  // Check if the needs review filter is active (for active styling of link)
  readonly isNeedsReviewFilterActive = computed(() => {
    const url = this.currentUrl();
    if (!url.includes('/transactions')) return false;

    // Check if filter=needs_review is in the query parameters
    const urlParts = url.split('?');
    if (urlParts.length > 1) {
      const params = new URLSearchParams(urlParts[1]);
      return params.get('filter') === 'needs_review';
    }
    return false;
  });

  handleOverspentClick(): void {
    this.sidebarService.setOpenMobile(false);
  }

  handleNeedsReviewClick(): void {
    this.sidebarService.setOpenMobile(false);
  }

  protected readonly navItems = computed<NavItem[]>(() => {
    const workspaceShortId = this.workspaceService.workspaceShortId();
    if (!workspaceShortId) return [];

    // Build budget route with query params
    const monthParam = this.budgetMonthService.getLastViewedMonthQueryParam();
    const url = this.currentUrl();
    const isOnBudgetPage = url.includes('/budget');

    // Get filter from current URL if on budget page, otherwise use stored filter
    let filterParam: string | undefined;
    if (isOnBudgetPage) {
      const urlParts = url.split('?');
      if (urlParts.length > 1) {
        const params = new URLSearchParams(urlParts[1]);
        filterParam = params.get('filter') ?? undefined;
      }
    } else {
      // Use stored filter when not on budget page
      filterParam = this.budgetFilterService.getLastFilterQueryParam() ?? undefined;
    }

    const queryParams: string[] = [];
    if (monthParam) {
      queryParams.push(`month=${monthParam}`);
    }
    if (filterParam && filterParam !== 'all') {
      queryParams.push(`filter=${filterParam}`);
    }

    const budgetRoute =
      queryParams.length > 0 ? `/${workspaceShortId}/budget?${queryParams.join('&')}` : `/${workspaceShortId}/budget`;

    // Build transactions route with query params
    const isOnTransactionsPage = url.includes('/transactions') && !url.includes('/bank-account');

    // Get filter from current URL if on transactions page, otherwise use stored filter
    let transactionFilterParam: string | undefined;
    if (isOnTransactionsPage) {
      const urlParts = url.split('?');
      if (urlParts.length > 1) {
        const params = new URLSearchParams(urlParts[1]);
        transactionFilterParam = params.get('filter') ?? undefined;
      }
    } else {
      // Use stored filter when not on transactions page
      transactionFilterParam = this.transactionFilterService.getLastFilterQueryParam() ?? undefined;
    }

    const transactionsRoute =
      transactionFilterParam && transactionFilterParam !== 'all'
        ? `/${workspaceShortId}/transactions?filter=${transactionFilterParam}`
        : `/${workspaceShortId}/transactions`;

    return [
      {
        label: 'Budget',
        route: budgetRoute,
        icon: BudgetIcon,
        exactMatch: false,
      },
      {
        label: 'Transactions',
        route: transactionsRoute,
        icon: TransactionsIcon,
        exactMatch: false,
      },
      {
        label: 'Planned',
        route: `/${workspaceShortId}/planned`,
        icon: PlannedIcon,
        exactMatch: false,
      },
      {
        label: 'Accounts',
        route: `/${workspaceShortId}/bank-accounts`,
        icon: AccountsIcon,
        exactMatch: true,
      },
      {
        label: 'Reports',
        route: `/${workspaceShortId}/reports`,
        icon: ReportsIcon,
        exactMatch: false,
      },
      {
        label: 'Settings',
        route: `/${workspaceShortId}/settings`,
        icon: Settings,
        exactMatch: false,
      },
    ];
  });

  private loadPlaidScript(): void {
    // Check if script already exists
    if (document.getElementById('plaid-script')) {
      return;
    }

    // Create and append the Plaid script
    const script = document.createElement('script');
    script.id = 'plaid-script';
    script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    script.async = true;
    document.head.appendChild(script);
  }
}
