import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import type { ChartConfiguration, ChartData } from 'chart.js';
import { getRelativePosition } from 'chart.js/helpers';
import { BaseChartDirective } from 'ng2-charts';
import { UserPreferencesService } from '../../core/services/preferences/user-preferences.service';
import type { BankAccountWithRelations } from '../../services/bank-account.service';
import { CurrencyService } from '../../services/currency.service';
import {
  type AccountsNetWorthReport,
  buildNetWorthPoints,
  type NetWorthRange,
  selectBalanceRange,
} from './account-balance-chart';

@Component({
  selector: 'app-net-worth-chart',
  imports: [BaseChartDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="bg-background rounded-xl border p-4 sm:p-6" aria-label="Net worth overview">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <h2 class="text-muted-foreground text-sm">Net worth</h2>
            @if (activePoint(); as active) {
              <span class="text-muted-foreground text-xs">· {{ pointDateLabel(active.point.month) }}</span>
            }
            @if (pinnedMonth()) {
              <button type="button" class="text-muted-foreground hover:text-foreground rounded px-1 text-xs underline"
                (click)="clearSelection()">Clear selection</button>
            }
          </div>
          <p class="mt-2 text-3xl font-semibold tracking-tight tabular-nums sm:text-5xl">
            {{ currency.format(displayedTotals().netWorth) }}
          </p>
          @if (change(); as change) {
            <p class="text-muted-foreground mt-3 flex flex-wrap gap-x-2 gap-y-1 text-xs sm:text-sm">
              <span [class.text-emerald-600]="change.amount >= 0" [class.dark:text-emerald-400]="change.amount >= 0"
                [class.text-destructive]="change.amount < 0">{{ currency.formatWithSign(change.amount) }}</span>
              @if (change.percentage !== null) {
                <span>{{ change.percentage > 0 ? '+' : '' }}{{ change.percentage.toFixed(2) }}%</span>
              }
              <span>since {{ monthLabel(change.month, true) }}</span>
            </p>
          }
        </div>
        <div class="flex flex-col items-end gap-4">
          <div class="inline-flex rounded-full border p-1" role="group" aria-label="Net worth time range">
            @for (range of ranges; track range) {
              <button type="button" class="text-muted-foreground hover:text-foreground rounded-full px-3 py-1.5 text-sm transition-colors"
                [class.bg-accent]="selectedRange() === range" [class.text-foreground]="selectedRange() === range"
                [attr.aria-pressed]="selectedRange() === range" (click)="selectedRange.set(range)">{{ range }}</button>
            }
          </div>
          <dl class="flex gap-5 text-right text-sm">
            <div><dt class="text-muted-foreground">Assets</dt><dd class="mt-1 tabular-nums">{{ currency.format(displayedTotals().assets) }}</dd></div>
            <div class="border-l pl-5"><dt class="text-muted-foreground">Liabilities</dt><dd class="mt-1 tabular-nums">{{ currency.format(displayedTotals().liabilities) }}</dd></div>
          </dl>
        </div>
      </div>
      @if (showAllocation()) {
        <div class="bg-muted mt-6 flex h-2 overflow-hidden rounded-full" aria-hidden="true">
          <div class="bg-foreground h-full" [style.width.%]="cashPercentage()"></div>
          <div class="bg-muted-foreground h-full border-l-2 border-background" [style.width.%]="allocationTotal() > 0 ? 100 - cashPercentage() : 0"></div>
        </div>
        <div class="text-muted-foreground mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs sm:text-sm">
          <span class="flex items-center gap-2"><span class="bg-foreground h-2 w-2 rounded-xs"></span>Cash {{ currency.formatCompact(displayedTotals().cash) }}</span>
          <span class="flex items-center gap-2"><span class="bg-muted-foreground h-2 w-2 rounded-xs"></span>Investments {{ currency.formatCompact(displayedTotals().investments) }}</span>
        </div>
      }
      @if (historyLoading()) {
        <div class="text-muted-foreground flex h-48 items-center justify-center text-sm" role="status">Loading balance history…</div>
      } @else if (historyError()) {
        <div class="text-muted-foreground flex h-48 items-center justify-center text-sm" role="status">Balance history is unavailable.</div>
      } @else if (points().length > 1) {
        <div class="relative mt-6 h-56 sm:h-72">
          <canvas baseChart type="line" [data]="chartData()" [options]="chartOptions()"
            class="focus-visible:ring-ring cursor-crosshair rounded outline-none focus-visible:ring-2"
            tabindex="0" role="img" aria-label="Monthly net worth area chart. Use arrow keys to select a date, Escape to clear."
            (mouseleave)="onChartLeave()" (click)="onCanvasClick($event)" (keydown)="onChartKeyDown($event)">
            Monthly net worth history.
          </canvas>
        </div>
        <span class="sr-only" role="status" aria-live="polite">
          @if (activePoint(); as active) {
            {{ pointDateLabel(active.point.month) }}: {{ currency.format(active.point.balance) }}
          }
        </span>
      } @else {
        <div class="text-muted-foreground flex h-48 items-center justify-center text-center text-sm">Monthly history will appear as you track your accounts.</div>
      }
    </section>
  `,
})
export class NetWorthChartComponent {
  protected readonly currency = inject(CurrencyService);
  private readonly preferences = inject(UserPreferencesService);
  readonly chart = viewChild(BaseChartDirective);
  readonly accounts = input.required<BankAccountWithRelations[]>();
  readonly report = input<AccountsNetWorthReport>();
  readonly currentMonth = input.required<string>();
  readonly historyLoading = input(false);
  readonly historyError = input(false);
  readonly selectedRange = signal<NetWorthRange>('All');
  readonly ranges: NetWorthRange[] = ['1M', '3M', '1Y', 'All'];

  readonly hoveredMonth = signal<string | null>(null);
  readonly pinnedMonth = signal<string | null>(null);
  private readonly selectionContext = computed(
    () =>
      `${this.accounts()
        .map((account) => account._id)
        .sort()
        .join(',')}:${this.currentMonth()}:${this.selectedRange()}`
  );

  constructor() {
    effect(() => {
      this.selectionContext();
      this.historyLoading();
      this.historyError();
      this.clearSelection();
    });
    effect(() => {
      this.hoveredMonth();
      this.activePoint();
      this.chart();
      this.syncChartSelection();
    });
  }

  readonly totals = computed(() => this.summarizeBalances(this.accounts()));
  readonly showAllocation = computed(() => this.totals().cash > 0n || this.totals().investments > 0n);
  readonly displayedTotals = computed(() => {
    const active = this.activePoint();
    if (!active || active.point.month === this.currentMonth()) return this.totals();
    const month = this.report()?.months.find((entry) => entry.yearMonth === active.point.month);
    const balances = new Map(month?.accounts.map((account) => [account.accountId, account.balance]));
    return this.summarizeBalances(
      this.accounts().map((account) => ({
        accountType: account.accountType,
        currentBalance: balances.get(account._id) ?? 0n,
      }))
    );
  });
  readonly allocationTotal = computed(() => {
    const { cash, investments } = this.displayedTotals();
    return (cash > 0n ? cash : 0n) + (investments > 0n ? investments : 0n);
  });
  readonly cashPercentage = computed(() => {
    const cash = this.displayedTotals().cash;
    return this.allocationTotal() === 0n ? 0 : (Number(cash > 0n ? cash : 0n) / Number(this.allocationTotal())) * 100;
  });
  readonly points = computed(() =>
    selectBalanceRange(buildNetWorthPoints(this.report(), this.accounts(), this.currentMonth()), this.selectedRange())
  );
  readonly activePoint = computed(() => {
    if (this.historyLoading() || this.historyError() || this.points().length < 2) return null;
    const month = this.pinnedMonth() ?? this.hoveredMonth();
    const index = this.points().findIndex((point) => point.month === month);
    if (index < 0) return null;
    return {
      point: this.points()[index],
      index,
    };
  });
  readonly change = computed(() => {
    const points = this.points();
    if (points.length < 2 || this.historyLoading() || this.historyError()) return null;
    const first = points[0];
    const amount = this.displayedTotals().netWorth - first.balance;
    return {
      amount,
      month: first.month,
      percentage: first.balance === 0n ? null : (Number(amount) / Math.abs(Number(first.balance))) * 100,
    };
  });
  private readonly chartColors = computed(() =>
    this.preferences.resolvedTheme() === 'dark'
      ? { line: '#fafafa', fill: '#fafafa18', grid: '#ffffff1a', text: '#a1a1aa', background: '#18181b' }
      : { line: '#18181b', fill: '#18181b14', grid: '#e4e4e7', text: '#71717a', background: '#fafafa' }
  );
  readonly chartData = computed<ChartData<'line'>>(() => ({
    labels: this.points().map((point) => point.month),
    datasets: [
      {
        label: 'Net worth',
        data: this.points().map((point) => Number(point.balance)),
        borderColor: this.chartColors().line,
        backgroundColor: this.chartColors().fill,
        borderWidth: 2,
        fill: 'start',
        cubicInterpolationMode: 'monotone',
        pointStyle: 'circle',
        pointRadius: (context) =>
          context.dataIndex === this.activePoint()?.index || context.dataIndex === this.points().length - 1 ? 4 : 0,
        pointHoverRadius: 5,
        pointBackgroundColor: this.chartColors().background,
        pointBorderColor: this.chartColors().line,
        pointBorderWidth: 2,
      },
    ],
  }));
  readonly chartOptions = computed<NonNullable<ChartConfiguration<'line'>['options']>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', axis: 'x', intersect: false },
    onHover: (_event, elements) => this.hoveredMonth.set(this.points()[elements[0]?.index]?.month ?? null),
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: true,
        displayColors: false,
        backgroundColor: this.chartColors().background,
        titleColor: this.chartColors().text,
        bodyColor: this.chartColors().line,
        borderColor: this.chartColors().grid,
        borderWidth: 1,
        padding: 12,
        callbacks: {
          title: (items) => this.pointDateLabel(this.points()[items[0]?.dataIndex]?.month ?? this.currentMonth()),
          label: (item) => this.currency.format(this.points()[item.dataIndex]?.balance ?? 0n),
          footer: (items) =>
            this.points()[items[0]?.dataIndex]?.month === this.pinnedMonth() ? 'Pinned' : 'Click to pin',
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: this.chartColors().text,
          maxTicksLimit: 5,
          maxRotation: 0,
          callback: (_value, index) => this.pointDateLabel(this.points()[index]?.month ?? this.currentMonth()),
        },
      },
      y: {
        position: 'right',
        grace: '10%',
        border: { display: false },
        grid: { color: this.chartColors().grid, drawTicks: false },
        ticks: {
          color: this.chartColors().text,
          padding: 12,
          maxTicksLimit: 5,
          callback: (value) => this.currency.formatCompact(Number(value)),
        },
      },
    },
  }));

  private summarizeBalances(accounts: readonly { accountType: string; currentBalance: bigint }[]) {
    let cash = 0n;
    let investments = 0n;
    let liabilities = 0n;
    for (const account of accounts) {
      if (account.accountType.startsWith('credit_') || account.accountType.startsWith('loan_'))
        liabilities -= account.currentBalance;
      else if (account.accountType.startsWith('investment_')) investments += account.currentBalance;
      else cash += account.currentBalance;
    }
    return { cash, investments, liabilities, assets: cash + investments, netWorth: cash + investments - liabilities };
  }

  clearSelection(): void {
    this.hoveredMonth.set(null);
    this.pinnedMonth.set(null);
  }

  togglePinnedMonth(month: string): void {
    if (this.pinnedMonth() === month) this.clearSelection();
    else this.pinnedMonth.set(month);
  }

  onCanvasClick(event: MouseEvent): void {
    const chart = this.chart()?.chart;
    if (!chart) return;
    const hit = chart.getElementsAtEventForMode(event, 'index', { axis: 'x', intersect: false }, false)[0];
    const index = hit?.index ?? chart.scales['x']?.getValueForPixel(getRelativePosition(event, chart).x);
    const point = index === undefined ? undefined : this.points()[index];
    if (point) this.togglePinnedMonth(point.month);
  }

  onChartLeave(): void {
    this.hoveredMonth.set(null);
    this.syncChartSelection();
  }

  private syncChartSelection(): void {
    const chart = this.chart()?.chart;
    if (!chart) return;
    const active = this.activePoint();
    const elements = active ? [{ datasetIndex: 0, index: active.index }] : [];
    chart.setActiveElements(elements);
    const point = active ? chart.getDatasetMeta(0).data[active.index] : undefined;
    chart.tooltip?.setActiveElements(elements, point?.tooltipPosition(true) ?? { x: 0, y: 0 });
    chart.update('none');
  }

  onChartKeyDown(event: KeyboardEvent): void {
    const points = this.points();
    const index = this.activePoint()?.index ?? points.length - 1;
    let nextIndex: number;
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.clearSelection();
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.togglePinnedMonth(points[index].month);
        return;
      case 'ArrowLeft':
        nextIndex = Math.max(0, index - 1);
        break;
      case 'ArrowRight':
        nextIndex = Math.min(points.length - 1, index + 1);
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = points.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.pinnedMonth.set(points[nextIndex].month);
  }

  pointDateLabel(month: string): string {
    return month === this.currentMonth() ? 'Today' : this.monthLabel(month, true);
  }

  monthLabel(month: string, includeYear = false): string {
    const [year, monthNumber] = month.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', { month: 'short', ...(includeYear ? { year: 'numeric' } : {}) }).format(
      new Date(year, monthNumber - 1, 1)
    );
  }
}
