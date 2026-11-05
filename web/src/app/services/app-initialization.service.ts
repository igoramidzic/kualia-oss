import { DOCUMENT } from '@angular/common';
import { computed, effect, Injectable, inject, isDevMode } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map, startWith } from 'rxjs/operators';
import { BudgetService } from './budget.service';
import { CategoryService } from './category.service';
import { MerchantService } from './merchant.service';
import { SystemStatusService } from './system-status.service';
import { TransactionService } from './transaction.service';
import { WorkspaceService } from './workspace.service';

/**
 * Service that coordinates the loading of all critical app data
 * and provides a single source of truth for whether the app is ready to use.
 *
 * This service is used to show a loading spinner on workspace routes
 * until all required data has been loaded from the backend.
 */
@Injectable({
  providedIn: 'root',
})
export class AppInitializationService {
  private readonly categoryService = inject(CategoryService);
  private readonly merchantService = inject(MerchantService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly budgetService = inject(BudgetService);
  private readonly transactionService = inject(TransactionService);
  private readonly systemStatusService = inject(SystemStatusService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly debugLoading =
    isDevMode() && typeof window !== 'undefined' && !navigator.userAgent.includes('jsdom');
  private lastDebugSnapshot = '';

  private readonly initialUrl =
    this.router.url !== '/'
      ? this.router.url
      : `${this.document.location?.pathname ?? '/'}${this.document.location?.search ?? ''}`;

  // Track current route to detect workspace routes early
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this.initialUrl)
    ),
    { initialValue: this.initialUrl }
  );

  private readonly initialNavigationCompleted = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => true),
      startWith(this.router.navigated === true)
    ),
    { initialValue: this.router.navigated === true }
  );

  readonly hasCompletedInitialNavigation = computed(() => this.initialNavigationCompleted());

  // Check if current URL is a workspace route (/:workspaceShortId/...)
  private readonly isOnWorkspaceRoute = computed(() => {
    const url = this.currentUrl();
    // Workspace routes follow the pattern /:workspaceShortId/something
    // They don't start with known non-workspace routes
    const nonWorkspaceRoutes = [
      '/login',
      '/signup',
      '/workspaces',
      '/join',
      '/family',
      '/auth',
      '/settings',
      '/subscribe',
      '/user-onboarding',
      // Landing page, privacy, and terms-of-service are served by kualia.com (marketing site)
    ];
    const isNonWorkspace = nonWorkspaceRoutes.some((route) => url.startsWith(route));

    if (isNonWorkspace) {
      return false;
    }

    // The router reports '/' while the initial guards resolve, including when the
    // browser was opened directly on a workspace URL. Keep the loading shell visible
    // until that navigation redirects to its final authenticated route.
    if (url === '/') {
      return true;
    }

    // If URL starts with /[shortId]/... it's a workspace route
    // Short IDs are 8+ character strings after the first slash
    const regex = /^\/([a-z0-9]{8,})(\/|$)/;
    const match = regex.exec(url);
    return match !== null;
  });

  readonly usesMainLayout = computed(() => {
    const url = this.currentUrl();
    if (url === '/') {
      return true;
    }

    if (!this.isOnWorkspaceRoute()) {
      return false;
    }

    return !/^\/[a-z0-9]{8,}\/(settings|onboarding)(\/|$)/.test(url);
  });

  readonly usesSettingsLayout = computed(() => {
    const url = this.currentUrl();
    return url.startsWith('/settings') || /^\/[a-z0-9]{8,}\/settings(\/|$)/.test(url);
  });

  constructor() {
    effect(() => {
      if (!this.debugLoading) {
        return;
      }

      const snapshot = {
        url: this.currentUrl(),
        workspaceRoute: this.isOnWorkspaceRoute(),
        usesMainLayout: this.usesMainLayout(),
        usesSettingsLayout: this.usesSettingsLayout(),
        initialNavigationCompleted: this.hasCompletedInitialNavigation(),
        ready: this.isAppReady(),
        systemStatusLoaded: this.systemStatusService.hasLoaded(),
        workspace: {
          loading: this.workspaceService.loadingWorkspace(),
          requestedId: this.workspaceService.workspaceId(),
          loadedId: this.workspaceService.workspace()?._id ?? null,
        },
        categories: {
          loading: this.categoryService.loading(),
          hasLoaded: this.categoryService.hasLoaded(),
        },
        merchants: {
          loading: this.merchantService.loading(),
          hasLoaded: this.merchantService.hasLoaded(),
        },
        budget: {
          loading: this.budgetService.loading(),
          hasLoaded: this.budgetService.hasLoaded(),
        },
        transactionStatusCounts: {
          loading: this.transactionService.loadingStatusCounts(),
          hasLoaded: this.transactionService.hasLoadedStatusCounts(),
        },
      };
      const serializedSnapshot = JSON.stringify(snapshot);
      if (serializedSnapshot === this.lastDebugSnapshot) {
        return;
      }

      this.lastDebugSnapshot = serializedSnapshot;
      console.debug('[Kualia loading]', snapshot);
    });
  }

  /**
   * Computed signal that determines if the app is ready to be used.
   *
   * Returns true when:
   * 1. System status has been loaded (maintenance mode check)
   * 2. Not on a workspace route (for non-workspace routes like /login, /workspaces)
   * 3. On a workspace route AND all critical data has finished loading:
   *    - Category hierarchy
   *    - Merchants
   *    - Workspace data (matching the current workspace ID)
   *    - Budget month data
   *    - Transaction status counts (uncategorized and pending)
   *
   * This checks the current URL to immediately show loading when navigating to a workspace route,
   * even before the workspace guard completes and sets the workspace ID.
   */
  readonly isAppReady = computed(() => {
    const isOnWorkspace = this.isOnWorkspaceRoute();

    // For non-workspace routes (landing page, login, etc.), render immediately
    // No need to wait for system status or any backend data
    if (!isOnWorkspace) {
      return true;
    }

    // For workspace routes, system status must be loaded first (for maintenance mode check)
    if (!this.systemStatusService.hasLoaded()) {
      return false;
    }

    const workspaceId = this.workspaceService.workspaceId();
    const loadingWorkspace = this.workspaceService.loadingWorkspace();

    // If workspace is still being fetched, show loading
    if (loadingWorkspace) {
      return false;
    }

    // On a workspace route - must wait for workspace ID to be set
    if (!workspaceId) {
      return false;
    }

    // Verify workspace data exists and matches the current workspace ID
    // This prevents showing the app with stale data from a previous workspace
    const workspace = this.workspaceService.workspace();
    const hasCorrectWorkspaceData = workspace?._id === workspaceId;

    // If we don't have the correct workspace data yet, show loading
    if (!hasCorrectWorkspaceData) {
      return false;
    }

    // Loading signals begin as false, so they cannot distinguish "not started"
    // from "finished." Require the first response from every critical query to
    // avoid briefly revealing an empty routed layout between those states.
    const allServicesLoaded =
      this.categoryService.hasLoaded() &&
      !this.categoryService.loading() &&
      this.merchantService.hasLoaded() &&
      !this.merchantService.loading() &&
      this.budgetService.hasLoaded() &&
      !this.budgetService.loading() &&
      this.transactionService.hasLoadedStatusCounts() &&
      !this.transactionService.loadingStatusCounts();

    return allServicesLoaded;
  });
}
