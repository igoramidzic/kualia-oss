import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { nucleoLayers as Layers, NucleoIcon } from '@kualia/icons';
import {
  PRESET_LABELS,
  ReportRange,
  ReportRangePresetKind,
  ReportsRangePickerComponent,
} from '../../components/reports/reports-range-picker/reports-range-picker';
import { ReportsSummaryCardComponent } from '../../components/reports/reports-summary-card/reports-summary-card';
import { ReportsTransactionsListComponent } from '../../components/reports/reports-transactions-list/reports-transactions-list';
import { SpendingCategoryLegendComponent } from '../../components/reports/spending-category-legend/spending-category-legend';
import { SpendingDonutChartComponent } from '../../components/reports/spending-donut-chart/spending-donut-chart';
import { SidebarToggleComponent } from '../../components/sidebar-toggle/sidebar-toggle';
import { CurrencyService } from '../../services/currency.service';
import { CategorySpendingData, SpendingReportService } from '../../services/spending-report.service';
import {
  formatMonthShort,
  formatYearMonth,
  getCurrentYearMonth,
  getNextYearMonth,
  getPreviousYearMonth,
  subtractMonths,
  validateYearMonth,
} from '../../shared/utils/month.utils';
import { HlmSelectImports } from '../../ui/select/src';

// Filter type for category breakdown
export type ReportsFilterType = 'categories' | 'groups' | 'merchants';

// Helper to convert YYYY-MM string to YYYYMM number
function yearMonthStringToNumber(yearMonth: string): number {
  const [year, month] = yearMonth.split('-').map(Number);
  return year * 100 + month;
}

// Helper to convert YYYYMM number to YYYY-MM string
function yearMonthNumberToString(yearMonth: number): string {
  const year = Math.floor(yearMonth / 100);
  const month = yearMonth % 100;
  return `${year}-${month.toString().padStart(2, '0')}`;
}

@Component({
  selector: 'app-reports',
  imports: [
    FormsModule,
    NucleoIcon,
    ReportsRangePickerComponent,
    ReportsSummaryCardComponent,
    ReportsTransactionsListComponent,
    SidebarToggleComponent,
    SpendingCategoryLegendComponent,
    SpendingDonutChartComponent,
    ...HlmSelectImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reports.html',
})
export class ReportsComponent {
  private readonly spendingReportService = inject(SpendingReportService);
  private readonly currencyService = inject(CurrencyService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  // Icons
  protected readonly LayersIcon = Layers;

  // Filter state (initialized from URL in constructor)
  readonly filterType = signal<ReportsFilterType>('categories');
  readonly showAllCategories = signal(false);

  // Range state (initialized from URL in constructor)
  readonly selectedRange = signal<ReportRange>({ type: 'preset', preset: 'thisMonth' });

  // Selected item for filtering transactions (initialized from URL in constructor)
  readonly selectedCategoryId = signal<string | null>(null);

  // Computed filter IDs based on current filter type
  readonly selectedFilterCategoryId = computed(() =>
    this.filterType() === 'categories' ? this.selectedCategoryId() : null
  );
  readonly selectedFilterMerchantId = computed(() =>
    this.filterType() === 'merchants' ? this.selectedCategoryId() : null
  );
  readonly selectedFilterGroupId = computed(() => (this.filterType() === 'groups' ? this.selectedCategoryId() : null));
  readonly selectedReportFlow = computed<'outflow' | null>(() => (this.selectedCategoryId() ? 'outflow' : null));

  // Hovered category for chart highlighting
  readonly hoveredCategoryId = signal<string | null>(null);

  // Query params
  private readonly queryParams = toSignal(this.route.queryParams);

  // Month navigation
  readonly currentMonth = getCurrentYearMonth();

  readonly selectedMonth = computed(() => {
    const monthParam = this.queryParams()?.['month'] as string | undefined;
    if (!monthParam) {
      return this.currentMonth;
    }
    const parsed = parseInt(monthParam, 10);
    if (isNaN(parsed) || !validateYearMonth(parsed)) {
      return this.currentMonth;
    }
    return parsed;
  });

  readonly isCurrentMonth = computed(() => this.selectedMonth() === this.currentMonth);
  readonly monthDisplay = computed(() => formatYearMonth(this.selectedMonth()));

  // Filter type label for display
  readonly filterTypeLabel = computed(() => {
    switch (this.filterType()) {
      case 'categories':
        return 'Category';
      case 'groups':
        return 'Group';
      case 'merchants':
        return 'Merchant';
    }
  });

  // Available range from spending report data
  readonly availableRange = computed(() => {
    const months = this.spendingReportService.months();
    if (months.length === 0) return undefined;

    // Convert YYYY-MM strings to YYYYMM numbers and find min/max
    const yearMonthNumbers = months.map((m) => yearMonthStringToNumber(m.yearMonth));
    const minYearMonth = Math.min(...yearMonthNumbers);
    const maxYearMonth = Math.max(...yearMonthNumbers);

    return { minYearMonth, maxYearMonth };
  });

  readonly canGoPrevious = computed(() => {
    const range = this.availableRange();
    if (!range) return false;
    return this.selectedMonth() > range.minYearMonth;
  });

  readonly canGoNext = computed(() => {
    const range = this.availableRange();
    if (!range) return false;
    return this.selectedMonth() < range.maxYearMonth;
  });

  readonly previousMonth = computed(() => {
    if (!this.canGoPrevious()) return null;
    return getPreviousYearMonth(this.selectedMonth());
  });

  readonly nextMonth = computed(() => {
    if (!this.canGoNext()) return null;
    return getNextYearMonth(this.selectedMonth());
  });

  // Spending data for selected month
  readonly displayMonth = computed(() => {
    const yearMonthString = yearMonthNumberToString(this.selectedMonth());
    return this.spendingReportService.getMonthData(yearMonthString);
  });

  // Whether the range is active (not single-month mode)
  readonly isRangeActive = computed(() => {
    const range = this.selectedRange();
    return !(range.type === 'preset' && range.preset === 'thisMonth');
  });

  // Compute start/end months for the selected range
  readonly monthRange = computed((): { start: number; end: number } | null => {
    const range = this.selectedRange();
    const end = this.selectedMonth();
    const available = this.availableRange();

    switch (range.type) {
      case 'preset':
        switch (range.preset) {
          case 'thisMonth':
            return null;
          case 'lastMonth':
            return { start: subtractMonths(end, 1), end: subtractMonths(end, 1) };
          case 'last3Months':
            return { start: subtractMonths(end, 2), end };
          case 'last6Months':
            return { start: subtractMonths(end, 5), end };
          case 'yearToDate': {
            const year = Math.floor(end / 100);
            return { start: year * 100 + 1, end };
          }
          case 'lastYear': {
            const year = Math.floor(end / 100) - 1;
            return { start: year * 100 + 1, end: year * 100 + 12 };
          }
          case 'allTime':
            if (!available) return null;
            return { start: available.minYearMonth, end: available.maxYearMonth };
        }
        break;
      case 'range': {
        const start = range.start ?? (available ? available.minYearMonth : end);
        const rangeEnd = range.end ?? (available ? available.maxYearMonth : end);
        return { start, end: rangeEnd };
      }
    }
  });

  // Range display label (e.g., "Oct 2025 - Feb 2026")
  readonly rangeLabel = computed(() => {
    const range = this.monthRange();
    if (!range) return '';
    if (range.start === range.end) return formatMonthShort(range.start);
    return `${formatMonthShort(range.start)} - ${formatMonthShort(range.end)}`;
  });

  // End year-month string for transaction queries (null when single-month mode)
  readonly endYearMonthString = computed((): string | null => {
    const range = this.monthRange();
    if (!range) return null;
    return yearMonthNumberToString(range.end);
  });

  // Start year-month string for transaction queries (overrides yearMonthString when range is active)
  readonly startYearMonthString = computed((): string => {
    const range = this.monthRange();
    if (!range) return yearMonthNumberToString(this.selectedMonth());
    return yearMonthNumberToString(range.start);
  });

  // Aggregated display month - merges data across selected range
  readonly aggregatedDisplayMonth = computed(() => {
    const range = this.monthRange();

    // Single month - use existing displayMonth
    if (!range) return this.displayMonth();

    const allMonths = this.spendingReportService.months();
    if (allMonths.length === 0) return undefined;

    // Filter months within the range
    const rangeMonths = allMonths.filter((m) => {
      const ym = yearMonthStringToNumber(m.yearMonth);
      return ym >= range.start && ym <= range.end;
    });

    if (rangeMonths.length === 0) return undefined;

    // Aggregate each direction separately because an entity can appear in both
    // report sections for the same month.
    const categoryMap = new Map<string, { categoryName: string; inflowAmount: bigint; outflowAmount: bigint }>();
    for (const month of rangeMonths) {
      for (const item of month.categorySpending.items) {
        const existing = categoryMap.get(item.categoryId);
        if (existing) {
          existing.outflowAmount += item.outflowAmount;
        } else {
          categoryMap.set(item.categoryId, {
            categoryName: item.categoryName,
            inflowAmount: 0n,
            outflowAmount: item.outflowAmount,
          });
        }
      }
      for (const item of month.categoryIncome.items) {
        const existing = categoryMap.get(item.categoryId);
        if (existing) {
          existing.inflowAmount += item.inflowAmount;
        } else {
          categoryMap.set(item.categoryId, {
            categoryName: item.categoryName,
            inflowAmount: item.inflowAmount,
            outflowAmount: 0n,
          });
        }
      }
    }

    // Split into spending and income, recalculate percentages
    const allCategories = [...categoryMap.entries()].map(([categoryId, data]) => ({
      categoryId,
      categoryName: data.categoryName,
      inflowAmount: data.inflowAmount,
      outflowAmount: data.outflowAmount,
      netActivity: data.inflowAmount - data.outflowAmount,
      actualPercent: 0,
      relativePercent: 0,
    }));

    const spendingItems = allCategories.filter((c) => c.outflowAmount > 0n);
    const incomeItems = allCategories.filter((c) => c.inflowAmount > 0n);

    const totalSpending = spendingItems.reduce((sum, c) => sum + c.outflowAmount, 0n);
    const totalIncome = incomeItems.reduce((sum, c) => sum + c.inflowAmount, 0n);

    // Recalculate percentages for spending
    const maxSpending = spendingItems.reduce((max, c) => (c.outflowAmount > max ? c.outflowAmount : max), 0n);
    for (const item of spendingItems) {
      item.actualPercent = totalSpending > 0n ? Number((item.outflowAmount * 10000n) / totalSpending) / 100 : 0;
      item.relativePercent = maxSpending > 0n ? Number((item.outflowAmount * 10000n) / maxSpending) / 100 : 0;
    }

    // Recalculate percentages for income
    const maxIncome = incomeItems.reduce((max, c) => (c.inflowAmount > max ? c.inflowAmount : max), 0n);
    for (const item of incomeItems) {
      item.actualPercent = totalIncome > 0n ? Number((item.inflowAmount * 10000n) / totalIncome) / 100 : 0;
      item.relativePercent = maxIncome > 0n ? Number((item.inflowAmount * 10000n) / maxIncome) / 100 : 0;
    }

    // Aggregate groups by groupId using raw inflowAmount/outflowAmount
    const groupMap = new Map<
      string,
      { groupName: string; inflowAmount: bigint; outflowAmount: bigint; categories: CategorySpendingData[] }
    >();
    for (const month of rangeMonths) {
      for (const group of month.groupSpending.items) {
        const existing = groupMap.get(group.groupId);
        if (existing) {
          existing.outflowAmount += group.outflowAmount;
        } else {
          groupMap.set(group.groupId, {
            groupName: group.groupName,
            inflowAmount: 0n,
            outflowAmount: group.outflowAmount,
            categories: [],
          });
        }
      }
      for (const group of month.groupIncome.items) {
        const existing = groupMap.get(group.groupId);
        if (existing) {
          existing.inflowAmount += group.inflowAmount;
        } else {
          groupMap.set(group.groupId, {
            groupName: group.groupName,
            inflowAmount: group.inflowAmount,
            outflowAmount: 0n,
            categories: [],
          });
        }
      }
    }

    const allGroups = [...groupMap.entries()].map(([groupId, data]) => ({
      groupId,
      groupName: data.groupName,
      inflowAmount: data.inflowAmount,
      outflowAmount: data.outflowAmount,
      netActivity: data.inflowAmount - data.outflowAmount,
      actualPercent: 0,
      relativePercent: 0,
      categories: data.categories,
    }));

    const groupSpendingItems = allGroups.filter((g) => g.outflowAmount > 0n);
    const groupIncomeItems = allGroups.filter((g) => g.inflowAmount > 0n);

    const totalGroupSpending = groupSpendingItems.reduce((sum, g) => sum + g.outflowAmount, 0n);
    const maxGroupSpending = groupSpendingItems.reduce((max, g) => (g.outflowAmount > max ? g.outflowAmount : max), 0n);
    for (const item of groupSpendingItems) {
      item.actualPercent =
        totalGroupSpending > 0n ? Number((item.outflowAmount * 10000n) / totalGroupSpending) / 100 : 0;
      item.relativePercent = maxGroupSpending > 0n ? Number((item.outflowAmount * 10000n) / maxGroupSpending) / 100 : 0;
    }

    const totalGroupIncome = groupIncomeItems.reduce((sum, g) => sum + g.inflowAmount, 0n);
    const maxGroupIncome = groupIncomeItems.reduce((max, g) => (g.inflowAmount > max ? g.inflowAmount : max), 0n);
    for (const item of groupIncomeItems) {
      item.actualPercent = totalGroupIncome > 0n ? Number((item.inflowAmount * 10000n) / totalGroupIncome) / 100 : 0;
      item.relativePercent = maxGroupIncome > 0n ? Number((item.inflowAmount * 10000n) / maxGroupIncome) / 100 : 0;
    }

    const merchantSpendingMap = new Map<
      string,
      { merchantName: string; totalAmount: bigint; transactionCount: bigint }
    >();
    const merchantIncomeMap = new Map<
      string,
      { merchantName: string; totalAmount: bigint; transactionCount: bigint }
    >();
    for (const month of rangeMonths) {
      for (const merchant of month.merchantSpending.items) {
        const existing = merchantSpendingMap.get(merchant.merchantId);
        if (existing) {
          existing.totalAmount += merchant.totalAmount;
          existing.transactionCount += merchant.transactionCount;
        } else {
          merchantSpendingMap.set(merchant.merchantId, {
            merchantName: merchant.merchantName,
            totalAmount: merchant.totalAmount,
            transactionCount: merchant.transactionCount,
          });
        }
      }
      for (const merchant of month.merchantIncome.items) {
        const existing = merchantIncomeMap.get(merchant.merchantId);
        if (existing) {
          existing.totalAmount += merchant.totalAmount;
          existing.transactionCount += merchant.transactionCount;
        } else {
          merchantIncomeMap.set(merchant.merchantId, {
            merchantName: merchant.merchantName,
            totalAmount: merchant.totalAmount,
            transactionCount: merchant.transactionCount,
          });
        }
      }
    }

    const merchantSpendingItems = [...merchantSpendingMap.entries()].map(([merchantId, data]) => ({
      merchantId,
      merchantName: data.merchantName,
      totalAmount: data.totalAmount,
      transactionCount: data.transactionCount,
      actualPercent: 0,
      relativePercent: 0,
    }));
    const merchantIncomeItems = [...merchantIncomeMap.entries()].map(([merchantId, data]) => ({
      merchantId,
      merchantName: data.merchantName,
      totalAmount: data.totalAmount,
      transactionCount: data.transactionCount,
      actualPercent: 0,
      relativePercent: 0,
    }));
    const allMerchantIds = new Set([...merchantSpendingMap.keys(), ...merchantIncomeMap.keys()]);
    const allMerchants = [...allMerchantIds].map((merchantId) => {
      const spending = merchantSpendingMap.get(merchantId);
      const income = merchantIncomeMap.get(merchantId);
      return {
        merchantId,
        merchantName: income?.merchantName ?? spending?.merchantName ?? 'Unknown',
        totalAmount: (income?.totalAmount ?? 0n) + (spending?.totalAmount ?? 0n),
        transactionCount: (income?.transactionCount ?? 0n) + (spending?.transactionCount ?? 0n),
        actualPercent: 0,
        relativePercent: 0,
      };
    });

    const totalMerchantSpending = merchantSpendingItems.reduce((sum, m) => sum + -m.totalAmount, 0n);
    const maxMerchantSpending = merchantSpendingItems.reduce((max, m) => {
      const abs = -m.totalAmount;
      return abs > max ? abs : max;
    }, 0n);
    for (const item of merchantSpendingItems) {
      const abs = -item.totalAmount;
      item.actualPercent = totalMerchantSpending > 0n ? Number((abs * 10000n) / totalMerchantSpending) / 100 : 0;
      item.relativePercent = maxMerchantSpending > 0n ? Number((abs * 10000n) / maxMerchantSpending) / 100 : 0;
    }

    const totalMerchantIncome = merchantIncomeItems.reduce((sum, m) => sum + m.totalAmount, 0n);
    const maxMerchantIncome = merchantIncomeItems.reduce((max, m) => (m.totalAmount > max ? m.totalAmount : max), 0n);
    for (const item of merchantIncomeItems) {
      item.actualPercent =
        totalMerchantIncome > 0n ? Number((item.totalAmount * 10000n) / totalMerchantIncome) / 100 : 0;
      item.relativePercent = maxMerchantIncome > 0n ? Number((item.totalAmount * 10000n) / maxMerchantIncome) / 100 : 0;
    }

    // Sum monthly income across range
    const totalMonthlyIncome = rangeMonths.reduce((sum, m) => sum + m.monthlyIncome, 0n);
    const totalCategoryInflow = rangeMonths.reduce((sum, m) => sum + m.totalCategoryInflow, 0n);
    const totalCategoryOutflow = rangeMonths.reduce((sum, m) => sum + m.totalCategoryOutflow, 0n);
    const totalCategoryNetActivity = rangeMonths.reduce((sum, m) => sum + m.totalCategoryNetActivity, 0n);
    const totalMerchantSpendingLegacy = rangeMonths.reduce((sum, m) => sum + m.totalMerchantSpending, 0n);

    // Return aggregated MonthlySpending
    return {
      yearMonth: yearMonthNumberToString(range.start),
      monthlyIncome: totalMonthlyIncome,
      totalSpending,
      totalIncome,
      categorySpending: { items: spendingItems, total: totalSpending },
      categoryIncome: { items: incomeItems, total: totalIncome },
      totalCategoryInflow,
      totalCategoryOutflow,
      totalCategoryNetActivity,
      groupSpending: { items: groupSpendingItems, total: totalGroupSpending },
      groupIncome: { items: groupIncomeItems, total: totalGroupIncome },
      merchantSpending: { items: merchantSpendingItems, total: totalMerchantSpending },
      merchantIncome: { items: merchantIncomeItems, total: totalMerchantIncome },
      categories: allCategories,
      groups: allGroups,
      merchants: allMerchants,
      totalMerchantSpending: totalMerchantSpendingLegacy,
    };
  });

  // Chart data - transformed to CategorySpendingData shape based on filter type
  readonly chartData = computed((): CategorySpendingData[] => {
    const monthData = this.aggregatedDisplayMonth();
    if (!monthData) return [];

    switch (this.filterType()) {
      case 'categories':
        return monthData.categorySpending.items;
      case 'groups':
        // Map group data to CategorySpendingData shape
        return monthData.groupSpending.items.map((group) => ({
          categoryId: group.groupId,
          categoryName: group.groupName,
          inflowAmount: group.inflowAmount,
          outflowAmount: group.outflowAmount,
          netActivity: group.netActivity,
          actualPercent: group.actualPercent,
          relativePercent: group.relativePercent,
        }));
      case 'merchants': {
        // Map merchant data to CategorySpendingData shape
        const absMerchantAmount = (amt: bigint) => (amt < 0n ? -amt : amt);
        return monthData.merchantSpending.items.map((merchant) => ({
          categoryId: merchant.merchantId,
          categoryName: merchant.merchantName,
          inflowAmount: 0n,
          outflowAmount: absMerchantAmount(merchant.totalAmount),
          netActivity: merchant.totalAmount,
          actualPercent: merchant.actualPercent,
          relativePercent: merchant.relativePercent,
        }));
      }
    }
  });

  // Total spending for the month
  readonly totalSpending = computed(() => {
    const monthData = this.aggregatedDisplayMonth();
    if (!monthData) return 0n;
    return monthData.totalSpending;
  });

  // Formatted total
  readonly formattedTotal = computed(() => {
    return this.currencyService.format(this.totalSpending());
  });

  // Year-month string for transactions list
  readonly yearMonthString = computed(() => yearMonthNumberToString(this.selectedMonth()));

  // Loading state
  readonly loading = this.spendingReportService.loading;
  readonly hasLoaded = this.spendingReportService.hasLoaded;
  readonly hasData = this.spendingReportService.hasData;

  constructor() {
    // Initialize state from URL query params
    const initialParams = this.route.snapshot.queryParams;

    const filterParam = initialParams['filter'] as string | undefined;
    if (filterParam && ['categories', 'groups', 'merchants'].includes(filterParam)) {
      this.filterType.set(filterParam as ReportsFilterType);
    }

    const rangeParam = initialParams['range'] as string | undefined;
    if (rangeParam) {
      if (rangeParam in PRESET_LABELS) {
        this.selectedRange.set({ type: 'preset', preset: rangeParam as ReportRangePresetKind });
      } else if (rangeParam.includes('-')) {
        // Custom range format: "YYYYMM-YYYYMM"
        const [startStr, endStr] = rangeParam.split('-');
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (!isNaN(start) && !isNaN(end)) {
          this.selectedRange.set({ type: 'range', start, end });
        }
      }
    }

    const selectedParam = initialParams['selected'] as string | undefined;
    if (selectedParam) {
      this.selectedCategoryId.set(selectedParam);
    }

    // Validate and redirect if month is invalid
    effect(() => {
      const monthParam = this.queryParams()?.['month'] as string | undefined;
      if (monthParam) {
        const parsed = parseInt(monthParam, 10);
        if (isNaN(parsed) || !validateYearMonth(parsed)) {
          void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: {},
            replaceUrl: true,
          });
        }
      }
    });
  }

  // Sync current state to URL query params
  private syncQueryParams(): void {
    const queryParams: Record<string, string | null> = {
      month: this.selectedMonth() !== this.currentMonth ? this.selectedMonth().toString() : null,
      filter: this.filterType() !== 'categories' ? this.filterType() : null,
      range: this.serializeRange(this.selectedRange()),
      selected: this.selectedCategoryId(),
    };

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      replaceUrl: true,
    });
  }

  private serializeRange(range: ReportRange): string | null {
    if (range.type === 'preset') {
      return range.preset === 'thisMonth' ? null : range.preset;
    }
    if (range.start != null && range.end != null) {
      return `${range.start}-${range.end}`;
    }
    return null;
  }

  // Month navigation
  navigateToMonth(yearMonth: number): void {
    const queryParams: Record<string, string | null> = {
      month: yearMonth !== this.currentMonth ? yearMonth.toString() : null,
      filter: this.filterType() !== 'categories' ? this.filterType() : null,
      range: this.serializeRange(this.selectedRange()),
      selected: this.selectedCategoryId(),
    };

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      replaceUrl: false,
    });
  }

  // Category click handler
  onCategoryClick(category: CategorySpendingData): void {
    // Toggle selection - if clicking the same category, deselect
    if (this.selectedCategoryId() === category.categoryId) {
      this.selectedCategoryId.set(null);
    } else {
      this.selectedCategoryId.set(category.categoryId);
    }
    this.syncQueryParams();
  }

  // Clear category filter
  clearCategoryFilter(): void {
    this.selectedCategoryId.set(null);
    this.syncQueryParams();
  }

  // Filter type change handler
  onFilterTypeChange(value: string | string[] | null | undefined): void {
    const filterType = value as ReportsFilterType | null | undefined;
    if (filterType) {
      this.filterType.set(filterType);
      // Clear selection when changing filter type
      this.selectedCategoryId.set(null);
      this.syncQueryParams();
    }
  }

  // Range picker change handler
  onRangePickerChange(range: ReportRange): void {
    this.selectedRange.set(range);
    // Clear selection when changing range
    this.selectedCategoryId.set(null);
    this.syncQueryParams();
  }
}
