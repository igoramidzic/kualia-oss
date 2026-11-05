import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, ViewChild } from '@angular/core';
import { ActiveElement, ChartConfiguration, ChartData, ChartEvent } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import { CurrencyService } from '../../../services/currency.service';
import { CategorySpendingData } from '../../../services/spending-report.service';

// Maximum items to show before grouping into "Everything else" (11 + "Everything Else" = 12 total)
const MAX_VISIBLE_ITEMS = 11;

// Predefined color palette for chart categories
const CATEGORY_COLORS = [
  '#3b82f6', // blue-500
  '#22c55e', // green-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#06b6d4', // cyan-500
  '#84cc16', // lime-500
  '#f97316', // orange-500
  '#6366f1', // indigo-500
  '#14b8a6', // teal-500
  '#a855f7', // purple-500
];

// Color for "Everything else" segment (12th color in palette)
const EVERYTHING_ELSE_COLOR = CATEGORY_COLORS[11]; // purple-500

@Component({
  selector: 'app-spending-donut-chart',
  imports: [BaseChartDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="relative h-64 w-64 sm:h-80 sm:w-80">
      <canvas
        baseChart
        [data]="chartData()"
        [options]="chartOptions"
        type="doughnut"
        (chartClick)="onChartClick($event)"
      ></canvas>
      <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span class="text-2xl font-bold">{{ formattedTotal() }}</span>
        <span class="text-muted-foreground text-sm">Total</span>
      </div>
    </div>
  `,
})
export class SpendingDonutChartComponent {
  private readonly currencyService = inject(CurrencyService);

  @ViewChild(BaseChartDirective) chart?: BaseChartDirective;

  // Inputs
  readonly data = input<CategorySpendingData[]>([]);
  readonly total = input<bigint>(0n);
  readonly selectedId = input<string | null>(null);
  readonly hoveredId = input<string | null>(null);
  readonly showAll = input<boolean>(false);

  // Outputs
  readonly categoryClick = output<CategorySpendingData>();

  constructor() {
    // Update chart when hoveredId changes
    effect(() => {
      const hovered = this.hoveredId();
      if (this.chart?.chart) {
        this.updateChartHighlight(hovered);
      }
    });
  }

  /**
   * Update chart segment highlighting based on hovered item
   * Sets the active element to trigger Chart.js built-in hover styling
   */
  private updateChartHighlight(hoveredId: string | null): void {
    const chart = this.chart?.chart;
    if (!chart?.data.datasets[0]) return;

    const sortedItems = this.sortedItems();
    const showAll = this.showAll();

    if (hoveredId) {
      const hoveredIndex = sortedItems.findIndex((item) => item.categoryId === hoveredId);

      if (hoveredIndex >= 0) {
        // If not showing all and the hovered item is in the "Everything else" group
        if (!showAll && sortedItems.length > MAX_VISIBLE_ITEMS && hoveredIndex >= MAX_VISIBLE_ITEMS) {
          // Highlight the "Everything else" segment (last segment)
          chart.setActiveElements([{ datasetIndex: 0, index: MAX_VISIBLE_ITEMS }]);
        } else {
          // Highlight the specific segment
          chart.setActiveElements([{ datasetIndex: 0, index: hoveredIndex }]);
        }
      }
    } else {
      // Clear active elements
      chart.setActiveElements([]);
    }

    chart.update('none');
  }

  // Chart options
  readonly chartOptions: ChartConfiguration<'doughnut'>['options'] = {
    responsive: true,
    maintainAspectRatio: true,
    cutout: '70%',
    animation: false,
    layout: {
      padding: 10, // Space for hover offset expansion
    },
    onHover: (event, elements) => {
      const canvas = event.native?.target as HTMLCanvasElement | undefined;
      if (canvas) {
        canvas.style.cursor = elements.length > 0 ? 'pointer' : 'default';
      }
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: true,
        callbacks: {
          label: (context) => {
            const label = context.label ?? '';
            const value = context.parsed ?? 0;
            // Format as currency (value is already in cents as a number)
            const formatted = this.currencyService.format(BigInt(Math.round(value)));
            return `${label}: ${formatted}`;
          },
        },
      },
    },
  };

  // Sorted items for consistent ordering by gross outflow.
  readonly sortedItems = computed(() => {
    const items = this.data();
    if (!items) return [];
    return [...items].sort((a, b) => Number(b.outflowAmount - a.outflowAmount));
  });

  // Build chart data from category spending
  readonly chartData = computed<ChartData<'doughnut'>>(() => {
    const sortedItems = this.sortedItems();
    if (sortedItems.length === 0) {
      return {
        labels: [],
        datasets: [
          {
            data: [],
            backgroundColor: [],
            borderWidth: 0,
          },
        ],
      };
    }

    const showAll = this.showAll();

    // If showing all or we have 12 or fewer items, show everything
    if (showAll || sortedItems.length <= MAX_VISIBLE_ITEMS) {
      return {
        labels: sortedItems.map((item) => item.categoryName),
        datasets: [
          {
            data: sortedItems.map((item) => Number(item.outflowAmount)),
            backgroundColor: this.generateColors(sortedItems.length),
            borderWidth: 0,
            hoverOffset: 8,
          },
        ],
      };
    }

    // Group items beyond MAX_VISIBLE_ITEMS into "Everything else"
    const visibleItems = sortedItems.slice(0, MAX_VISIBLE_ITEMS);
    const hiddenItems = sortedItems.slice(MAX_VISIBLE_ITEMS);
    const everythingElseTotal = hiddenItems.reduce((sum, item) => sum + Number(item.outflowAmount), 0);

    const labels = [...visibleItems.map((item) => item.categoryName), 'Everything else'];
    const data = [...visibleItems.map((item) => Number(item.outflowAmount)), everythingElseTotal];
    const colors = [...this.generateColors(MAX_VISIBLE_ITEMS), EVERYTHING_ELSE_COLOR];

    return {
      labels,
      datasets: [
        {
          data,
          backgroundColor: colors,
          borderWidth: 0,
          hoverOffset: 8,
        },
      ],
    };
  });

  // Formatted total
  readonly formattedTotal = computed(() => {
    return this.currencyService.format(this.total());
  });

  /**
   * Generate colors for chart segments
   */
  private generateColors(count: number): string[] {
    return Array.from({ length: count }, (_, i) => CATEGORY_COLORS[i % CATEGORY_COLORS.length]);
  }

  /**
   * Handle chart click events
   */
  onChartClick(event: { event?: ChartEvent; active?: object[] }): void {
    const activeElements = event.active as ActiveElement[] | undefined;
    if (!activeElements || activeElements.length === 0) {
      return;
    }

    const clickedIndex = activeElements[0].index;
    const items = this.data();

    // Get sorted items (same order as chart data)
    const sortedItems = [...items].sort((a, b) => Number(b.outflowAmount - a.outflowAmount));

    if (clickedIndex >= 0 && clickedIndex < sortedItems.length) {
      const clickedItem = sortedItems[clickedIndex];
      this.categoryClick.emit(clickedItem);
    }
  }
}
