import { provideZonelessChangeDetection, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { PointElement } from 'chart.js';
import type { BaseChartDirective } from 'ng2-charts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserPreferencesService } from '../../core/services/preferences/user-preferences.service';
import type { BankAccountWithRelations } from '../../services/bank-account.service';
import { CurrencyService } from '../../services/currency.service';
import { formatCompactCurrency, formatCurrency } from '../../shared/utils/formatters';
import type { AccountsNetWorthReport } from './account-balance-chart';
import { NetWorthChartComponent } from './net-worth-chart';

function account(accountType: string, currentBalance: bigint): BankAccountWithRelations {
  return { _id: accountType, accountType, currentBalance } as BankAccountWithRelations;
}

function history(balances: bigint[]): AccountsNetWorthReport {
  return {
    currentMonth: '2026-10',
    months: balances.map((netWorth, index) => ({
      yearMonth: `2026-${String(index + 5).padStart(2, '0')}`,
      accounts: [
        { accountId: 'banking_checking', accountType: 'banking_checking', accountName: 'Checking', balance: netWorth },
      ],
      netWorth,
      totalAssets: netWorth,
      totalLiabilities: 0n,
      netWorthDelta: null,
      netWorthPercentageChange: null,
      categoryBalances: [],
    })),
  };
}

describe('NetWorthChartComponent', () => {
  let fixture: ComponentFixture<NetWorthChartComponent>;

  beforeEach(async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await TestBed.configureTestingModule({
      imports: [NetWorthChartComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: UserPreferencesService, useValue: { resolvedTheme: signal('light') } },
        {
          provide: CurrencyService,
          useValue: {
            format: formatCurrency,
            formatCompact: formatCompactCurrency,
            formatWithSign: (value: bigint) => `${value > 0n ? '+' : ''}${formatCurrency(value)}`,
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(NetWorthChartComponent);
    fixture.componentRef.setInput('accounts', [
      account('banking_checking', 10000n),
      account('investment_brokerage', 20000n),
      account('credit_credit_card', -5000n),
    ]);
    fixture.componentRef.setInput('currentMonth', '2026-10');
    fixture.componentRef.setInput('report', history([10000n, 12000n, 15000n, 20000n, 22000n]));
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    vi.restoreAllMocks();
  });

  it('renders net worth, assets, positive debt, and the cash/investment allocation', () => {
    expect(fixture.componentInstance.totals()).toEqual({
      cash: 10000n,
      investments: 20000n,
      assets: 30000n,
      liabilities: 5000n,
      netWorth: 25000n,
    });
    expect(fixture.nativeElement.textContent).toContain('$250.00');
    expect(fixture.nativeElement.textContent).toContain('$300.00');
    expect(fixture.nativeElement.textContent).toContain('$50.00');
    expect(fixture.componentInstance.cashPercentage()).toBeCloseTo(100 / 3);
  });

  it('updates chart data and change figures when a range button is clicked', () => {
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const button = buttons.find((entry) => entry.textContent?.trim() === '1M');
    button?.click();
    fixture.detectChanges();

    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(fixture.componentInstance.points()).toHaveLength(2);
    expect(fixture.componentInstance.change()?.amount).toBe(3000n);
    expect(fixture.nativeElement.textContent).toContain('since Sep 2026');
    expect(fixture.componentInstance.chartData().datasets[0].data).toEqual([22000, 25000]);
  });

  it('shows a loading status and hides the graph until history loads', () => {
    fixture.componentRef.setInput('historyLoading', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('Loading');
    expect(fixture.nativeElement.querySelector('canvas')).toBeNull();
    expect(fixture.componentInstance.change()).toBeNull();
  });

  it('keeps live totals visible when history fails', () => {
    fixture.componentRef.setInput('historyError', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('$250.00');
    expect(fixture.nativeElement.textContent).toContain('Balance history is unavailable.');
    expect(fixture.nativeElement.querySelector('canvas')).toBeNull();
  });

  it('shows an honest empty history state instead of a fabricated trend', () => {
    fixture.componentRef.setInput('report', undefined);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Monthly history will appear');
    expect(fixture.nativeElement.querySelector('canvas')).toBeNull();
    expect(fixture.componentInstance.change()).toBeNull();
  });

  it('omits percentage changes with a zero baseline and formats a decline', () => {
    fixture.componentRef.setInput('report', history([0n]));
    fixture.detectChanges();
    expect(fixture.componentInstance.change()?.percentage).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Infinity');

    fixture.componentRef.setInput('report', history([30000n]));
    fixture.detectChanges();
    expect(fixture.componentInstance.change()?.amount).toBe(-5000n);
    expect(fixture.nativeElement.querySelector('.text-destructive').textContent).toContain('-$50.00');
  });

  it('handles debt-only accounts without an invalid asset allocation', () => {
    fixture.componentRef.setInput('accounts', [account('loan_mortgage', -50000n)]);
    fixture.detectChanges();

    expect(fixture.componentInstance.totals().netWorth).toBe(-50000n);
    expect(fixture.componentInstance.cashPercentage()).toBe(0);
    expect(fixture.nativeElement.textContent).not.toContain('Investments');
  });

  function chartElement(): HTMLCanvasElement {
    return fixture.nativeElement.querySelector('canvas') as HTMLCanvasElement;
  }

  function chartMock() {
    const chart = {
      getElementsAtEventForMode: vi.fn(() => [{ datasetIndex: 0, index: 2, element: new PointElement() }]),
      setActiveElements: vi.fn(),
      getDatasetMeta: vi.fn(() => ({
        data: fixture.componentInstance.points().map(() => ({ tooltipPosition: () => ({ x: 100, y: 50 }) })),
      })),
      tooltip: { setActiveElements: vi.fn() },
      update: vi.fn(),
      destroy: vi.fn(),
    };
    const directive = fixture.componentInstance.chart();
    if (!directive) throw new Error('Expected chart directive');
    directive.chart = chart as unknown as NonNullable<BaseChartDirective['chart']>;
    return chart;
  }

  function hoverAt(index: number): void {
    const chart = fixture.componentInstance.chart()?.chart;
    if (!chart) throw new Error('Expected chart');
    fixture.componentInstance
      .chartOptions()
      .onHover?.(
        { type: 'mousemove', x: 100, y: 50, native: new MouseEvent('mousemove') },
        [{ datasetIndex: 0, index, element: new PointElement() }],
        chart
      );
  }

  it('uses a responsive library area chart with native circular markers and index tooltips', () => {
    const component = fixture.componentInstance;
    expect(component.chart()).toBeDefined();
    expect(component.chartData().datasets[0].fill).toBe('start');
    expect(component.chartData().datasets[0].pointStyle).toBe('circle');
    expect(component.chartOptions().responsive).toBe(true);
    expect(component.chartOptions().maintainAspectRatio).toBe(false);
    expect(component.chartOptions().interaction).toEqual({ mode: 'index', axis: 'x', intersect: false });
    expect(component.chartOptions().plugins?.tooltip?.enabled).toBe(true);
    expect(fixture.nativeElement.querySelector('svg')).toBeNull();
  });

  it('inspects the date supplied by native hit testing and restores live totals on mouse leave', () => {
    const chart = chartMock();
    const element = chartElement();
    hoverAt(1);
    fixture.detectChanges();

    expect(fixture.componentInstance.activePoint()?.point.month).toBe('2026-06');
    expect(fixture.componentInstance.displayedTotals().netWorth).toBe(12000n);
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('Jun 2026');
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('$120.00');
    expect(chart.tooltip.setActiveElements).toHaveBeenLastCalledWith([{ datasetIndex: 0, index: 1 }], {
      x: 100,
      y: 50,
    });

    element.dispatchEvent(new MouseEvent('mouseleave'));
    fixture.detectChanges();
    expect(fixture.componentInstance.activePoint()).toBeNull();
    expect(fixture.componentInstance.displayedTotals().netWorth).toBe(25000n);
  });

  it('pins a clicked date across hover movements until the selection is cleared', () => {
    const chart = chartMock();
    const element = chartElement();
    element.dispatchEvent(new MouseEvent('click', { clientX: 260, bubbles: true }));
    hoverAt(5);
    element.dispatchEvent(new MouseEvent('mouseleave'));
    fixture.detectChanges();

    expect(fixture.componentInstance.activePoint()?.point.month).toBe('2026-07');
    expect(chart.getElementsAtEventForMode).toHaveBeenCalledWith(
      expect.any(MouseEvent),
      'index',
      { axis: 'x', intersect: false },
      false
    );
    const clear = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (button) => (button as HTMLButtonElement).textContent === 'Clear selection'
    ) as HTMLButtonElement;
    clear.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.activePoint()).toBeNull();
  });

  it('omits the inspect date dropdown while retaining screen-reader date announcements', () => {
    expect(fixture.nativeElement.querySelector('select')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Inspect date');
    expect(fixture.nativeElement.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();
  });

  it('supports arrow keys, Home, End, and Escape for date selection', () => {
    const element = chartElement();
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.pinnedMonth()).toBe('2026-09');
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.pinnedMonth()).toBe('2026-05');
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.pinnedMonth()).toBe('2026-06');
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.pinnedMonth()).toBe('2026-10');
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.activePoint()).toBeNull();
  });

  it('clears selections when the range or filtered accounts change', () => {
    fixture.componentInstance.togglePinnedMonth('2026-07');
    fixture.componentInstance.selectedRange.set('1M');
    fixture.detectChanges();
    expect(fixture.componentInstance.pinnedMonth()).toBeNull();

    fixture.componentInstance.togglePinnedMonth('2026-09');
    fixture.componentRef.setInput('accounts', [account('investment_brokerage', 20000n)]);
    fixture.detectChanges();
    expect(fixture.componentInstance.pinnedMonth()).toBeNull();
  });

  it('keeps a pinned date when the same accounts receive refreshed live balances', () => {
    fixture.componentInstance.togglePinnedMonth('2026-07');
    fixture.detectChanges();
    fixture.componentRef.setInput('accounts', [
      account('banking_checking', 15000n),
      account('investment_brokerage', 20000n),
      account('credit_credit_card', -5000n),
    ]);
    fixture.detectChanges();
    expect(fixture.componentInstance.pinnedMonth()).toBe('2026-07');
    expect(fixture.componentInstance.displayedTotals().netWorth).toBe(15000n);
  });
});
