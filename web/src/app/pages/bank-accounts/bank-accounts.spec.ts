import { provideZonelessChangeDetection, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmSidebarService } from '@spartan-ng/helm/sidebar';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserPreferencesService } from '../../core/services/preferences/user-preferences.service';
import { BankAccountService, type BankAccountWithRelations } from '../../services/bank-account.service';
import { ConvexService } from '../../services/convex.service';
import { CurrencyService } from '../../services/currency.service';
import { IconService } from '../../services/icon.service';
import { NavigationService } from '../../services/navigation.service';
import { WorkspaceService } from '../../services/workspace.service';
import { formatCompactCurrency, formatCurrency } from '../../shared/utils/formatters';
import type { AccountsNetWorthReport } from './account-balance-chart';
import { BankAccountsComponent } from './bank-accounts';
import { NetWorthChartComponent } from './net-worth-chart';

vi.mock('@atlaskit/pragmatic-drag-and-drop-auto-scroll/element', () => ({ autoScrollForElements: () => vi.fn() }));
vi.mock('@atlaskit/pragmatic-drag-and-drop/element/adapter', () => ({
  monitorForElements: () => vi.fn(),
  draggable: () => vi.fn(),
  dropTargetForElements: () => vi.fn(),
}));

describe('BankAccountsComponent balance overview', () => {
  let fixture: ComponentFixture<BankAccountsComponent>;
  let receiveReport: (report: AccountsNetWorthReport) => void;
  let failReport: () => void;
  let unsubscribe: ReturnType<typeof vi.fn>;
  let onUpdate: ReturnType<typeof vi.fn>;
  let workspaceId: ReturnType<typeof signal<string | null>>;
  let accounts: ReturnType<typeof signal<BankAccountWithRelations[]>>;

  beforeEach(async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    workspaceId = signal<string | null>('workspace_one');
    accounts = signal<BankAccountWithRelations[]>([
      {
        _id: 'checking_12345678',
        name: 'Checking',
        accountType: 'banking_checking',
        currentBalance: 30000n,
        firstBalanceYearMonth: '2026-08',
        isFavorite: false,
        isClosed: false,
        visualIdentityMode: 'logo',
      } as BankAccountWithRelations,
    ]);
    unsubscribe = vi.fn();
    onUpdate = vi.fn((_query: unknown, _args: unknown, next: typeof receiveReport, error: typeof failReport) => {
      receiveReport = next;
      failReport = error;
      return unsubscribe;
    });
    await TestBed.configureTestingModule({
      imports: [BankAccountsComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: BankAccountService,
          useValue: { bankAccounts: accounts, hasAccounts: signal(true), loading: signal(false), error: signal(null) },
        },
        { provide: ConvexService, useValue: { isAuthenticated: () => true, getClient: () => ({ onUpdate }) } },
        { provide: WorkspaceService, useValue: { workspaceId, workspace: signal(undefined) } },
        {
          provide: CurrencyService,
          useValue: { format: formatCurrency, formatCompact: formatCompactCurrency, formatWithSign: formatCurrency },
        },
        { provide: IconService, useValue: { getIconByName: () => null } },
        { provide: HlmDialogService, useValue: {} },
        { provide: HlmSidebarService, useValue: {} },
        { provide: NavigationService, useValue: {} },
        {
          provide: UserPreferencesService,
          useValue: {
            getBankAccountGroupCollapsedState: () => false,
            getClosedAccountsVisibleState: () => false,
            resolvedTheme: signal('light'),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(BankAccountsComponent);
    // Pin the month so eligibility does not depend on the test runner's date.
    Object.defineProperty(fixture.componentInstance, 'currentMonth', { value: '2026-10' });
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    vi.restoreAllMocks();
  });

  function publishHistory(): void {
    receiveReport({
      currentMonth: '2026-10',
      months: ['2026-08', '2026-09', '2026-10'].map((yearMonth) => ({
        yearMonth,
        netWorth: 10000n,
        totalAssets: 10000n,
        totalLiabilities: 0n,
        accounts: [
          { accountId: 'checking_12345678', accountName: 'Checking', accountType: 'banking_checking', balance: 10000n },
        ],
        netWorthDelta: null,
        netWorthPercentageChange: null,
        categoryBalances: [],
      })),
    });
    fixture.detectChanges();
  }

  it('places the overview above the rows and removes the accounts details sidebar', () => {
    const root = fixture.nativeElement as HTMLElement;
    const chart = root.querySelector('app-net-worth-chart');
    const row = root.querySelector('a[hlmContextMenuTrigger]');

    expect(chart).not.toBeNull();
    expect(chart?.compareDocumentPosition(row as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(root.querySelector('app-bank-account-sidebar')).toBeNull();
    expect(root.querySelector('app-bank-account-sidebar-toggle')).toBeNull();
  });

  it('keeps charts out of the account rows when balance history is available', () => {
    publishHistory();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('a[hlmContextMenuTrigger] canvas')).toBeNull();
    expect(root.querySelector('a[hlmContextMenuTrigger]')?.textContent).toContain('$300.00');
    expect(root.querySelector('app-net-worth-chart canvas')).not.toBeNull();
  });

  it('clears old history and replaces the subscription when the workspace changes', () => {
    publishHistory();
    workspaceId.set('workspace_two');
    fixture.detectChanges();

    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenLastCalledWith(
      expect.anything(),
      { workspaceId: 'workspace_two', currentYearMonth: 202610n },
      expect.any(Function),
      expect.any(Function)
    );
    expect(fixture.componentInstance.netWorthReport()).toBeUndefined();
    expect(fixture.componentInstance.historyLoading()).toBe(true);
  });

  it('clears unavailable history on query failure and unsubscribes on destroy', () => {
    publishHistory();
    failReport();
    fixture.detectChanges();

    expect(fixture.componentInstance.historyError()).toBe(true);
    expect(fixture.componentInstance.netWorthReport()).toBeUndefined();
    expect(fixture.nativeElement.textContent).toContain('Balance history is unavailable.');
    fixture.destroy();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('reuses the budget filter row to filter both account rows and historical chart values', async () => {
    accounts.update((entries) => [
      ...entries,
      {
        ...entries[0],
        _id: 'brokerage_87654321',
        name: 'Brokerage',
        accountType: 'investment_brokerage',
        currentBalance: 90000n,
      } as BankAccountWithRelations,
    ]);
    publishHistory();
    const report = fixture.componentInstance.netWorthReport();
    if (!report) throw new Error('Expected report');
    receiveReport({
      ...report,
      months: report.months.map((month) => ({
        ...month,
        accounts: [
          ...month.accounts,
          {
            accountId: 'brokerage_87654321',
            accountType: 'investment_brokerage',
            accountName: 'Brokerage',
            balance: 80000n,
          },
        ],
      })),
    });

    await TestBed.inject(Router).navigateByUrl('/?filter=investments');
    fixture.detectChanges();

    expect(fixture.componentInstance.activeAccountType()).toBe('Investment');
    expect(fixture.componentInstance.groupedBankAccountsWithSeparation().map((group) => group.label)).toEqual([
      'Investment',
    ]);
    const root = fixture.nativeElement as HTMLElement;
    const rows = Array.from(root.querySelectorAll('a[hlmContextMenuTrigger]'));
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('Brokerage');
    expect(root.querySelectorAll('app-responsive-filter-row')).toHaveLength(2);
    expect(root.querySelector('app-net-worth-chart')?.textContent).toContain('$900.00');
    const chart = fixture.debugElement.query(By.directive(NetWorthChartComponent))
      .componentInstance as NetWorthChartComponent;
    expect(chart.chartData().datasets[0].data).toEqual([80000, 80000, 90000]);
    const activeFilter = fixture.componentInstance.responsiveFilters().find((filter) => filter.isActive);
    expect(activeFilter?.label).toBe('Investments');
    expect(activeFilter?.count).toBe(1);

    await TestBed.inject(Router).navigateByUrl('/');
    fixture.detectChanges();
    expect(fixture.componentInstance.activeAccountType()).toBe('all');
    expect(root.querySelectorAll('a[hlmContextMenuTrigger]')).toHaveLength(2);
    expect(root.querySelector('app-net-worth-chart')?.textContent).toContain('$1,200.00');
  });

  it('falls back to All for invalid or unavailable account types and omits empty filter chips', async () => {
    await TestBed.inject(Router).navigateByUrl('/?filter=loans');
    fixture.detectChanges();

    expect(fixture.componentInstance.activeAccountType()).toBe('all');
    expect(
      fixture.componentInstance
        .responsiveFilters()
        .filter((filter) => filter.isVisible !== false)
        .map((filter) => filter.label)
    ).toEqual(['All', 'Cash']);

    await TestBed.inject(Router).navigateByUrl('/?filter=unknown');
    fixture.detectChanges();
    expect(fixture.componentInstance.activeAccountType()).toBe('all');
  });
});
