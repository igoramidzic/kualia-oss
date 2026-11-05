import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppInitializationService } from './app-initialization.service';
import { BudgetService } from './budget.service';
import { CategoryService } from './category.service';
import { MerchantService } from './merchant.service';
import { SystemStatusService } from './system-status.service';
import { TransactionService } from './transaction.service';
import { WorkspaceService } from './workspace.service';

describe('AppInitializationService', () => {
  let routerEvents$: Subject<NavigationEnd>;
  let currentUrl: string;
  let service: AppInitializationService;
  let workspaceId: WritableSignal<string | null>;
  let workspace: WritableSignal<{ _id: string } | null>;
  let categoryHasLoaded: WritableSignal<boolean>;
  let merchantHasLoaded: WritableSignal<boolean>;
  let budgetHasLoaded: WritableSignal<boolean>;
  let statusCountsHaveLoaded: WritableSignal<boolean>;

  beforeEach(() => {
    currentUrl = '/';
    routerEvents$ = new Subject<NavigationEnd>();
    workspaceId = signal<string | null>(null);
    workspace = signal<{ _id: string } | null>(null);
    categoryHasLoaded = signal(false);
    merchantHasLoaded = signal(false);
    budgetHasLoaded = signal(false);
    statusCountsHaveLoaded = signal(false);

    TestBed.configureTestingModule({
      providers: [
        {
          provide: Router,
          useValue: {
            get url() {
              return currentUrl;
            },
            events: routerEvents$.asObservable(),
          },
        },
        { provide: CategoryService, useValue: { loading: signal(false), hasLoaded: categoryHasLoaded } },
        { provide: MerchantService, useValue: { loading: signal(false), hasLoaded: merchantHasLoaded } },
        {
          provide: WorkspaceService,
          useValue: {
            workspaceId,
            loadingWorkspace: signal(false),
            workspace,
          },
        },
        { provide: BudgetService, useValue: { loading: signal(false), hasLoaded: budgetHasLoaded } },
        {
          provide: TransactionService,
          useValue: { loadingStatusCounts: signal(false), hasLoadedStatusCounts: statusCountsHaveLoaded },
        },
        { provide: SystemStatusService, useValue: { hasLoaded: signal(true) } },
      ],
    });

    service = TestBed.inject(AppInitializationService);
  });

  it('keeps the app shell visible while the initial root navigation resolves', () => {
    expect(service.isAppReady()).toBe(false);
    expect(service.usesMainLayout()).toBe(true);
  });

  it('renders a non-workspace route once navigation resolves', () => {
    currentUrl = '/login';
    routerEvents$.next(new NavigationEnd(1, '/', '/login'));

    expect(service.isAppReady()).toBe(true);
    expect(service.usesMainLayout()).toBe(false);
    expect(service.hasCompletedInitialNavigation()).toBe(true);
  });

  it('uses the persistent shell only for primary workspace pages', () => {
    currentUrl = '/workspace1/budget';
    routerEvents$.next(new NavigationEnd(1, '/', currentUrl));

    expect(service.usesMainLayout()).toBe(true);
    expect(service.usesSettingsLayout()).toBe(false);

    currentUrl = '/workspace1/settings/profile';
    routerEvents$.next(new NavigationEnd(2, '/workspace1/budget', currentUrl));

    expect(service.usesMainLayout()).toBe(false);
    expect(service.usesSettingsLayout()).toBe(true);

    currentUrl = '/workspace1/onboarding';
    routerEvents$.next(new NavigationEnd(3, '/workspace1/settings/profile', currentUrl));

    expect(service.usesMainLayout()).toBe(false);
    expect(service.usesSettingsLayout()).toBe(false);
  });

  it('identifies global account settings for the settings placeholder', () => {
    currentUrl = '/settings/profile';
    routerEvents$.next(new NavigationEnd(1, '/', currentUrl));

    expect(service.usesMainLayout()).toBe(false);
    expect(service.usesSettingsLayout()).toBe(true);
  });

  it('keeps the shell visible until every critical workspace query has returned', () => {
    currentUrl = '/workspace1/budget';
    routerEvents$.next(new NavigationEnd(1, '/', currentUrl));
    workspaceId.set('workspace_1');
    workspace.set({ _id: 'workspace_1' });

    expect(service.isAppReady()).toBe(false);

    categoryHasLoaded.set(true);
    merchantHasLoaded.set(true);
    budgetHasLoaded.set(true);
    statusCountsHaveLoaded.set(true);

    expect(service.isAppReady()).toBe(true);
  });
});
