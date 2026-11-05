import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { CurrencyService } from '../../../services/currency.service';
import { MonthlySpending } from '../../../services/spending-report.service';

interface SummaryStat {
  label: string;
  value: string;
}

@Component({
  selector: 'app-reports-summary-card',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div>
      <h2 class="mb-3 text-sm font-semibold">Summary</h2>

      @if (!monthData()) {
        <div class="text-muted-foreground text-sm">No data available</div>
      } @else {
        <dl class="space-y-2">
          @for (stat of stats(); track stat.label) {
            <div class="flex items-center justify-between">
              <dt class="text-muted-foreground text-sm">{{ stat.label }}</dt>
              <dd class="text-sm font-medium">{{ stat.value }}</dd>
            </div>
          }
        </dl>
      }
    </div>
  `,
})
export class ReportsSummaryCardComponent {
  private readonly currencyService = inject(CurrencyService);

  // Input
  readonly monthData = input<MonthlySpending | undefined>();

  // Computed stats
  readonly stats = computed<SummaryStat[]>(() => {
    const data = this.monthData();
    if (!data) return [];

    const stats: SummaryStat[] = [];

    // Total spending
    stats.push({
      label: 'Total spending',
      value: this.currencyService.format(data.totalSpending),
    });

    // Total income
    stats.push({
      label: 'Total income',
      value: this.currencyService.format(data.totalIncome),
    });

    // Monthly income (from RTA)
    if (data.monthlyIncome !== 0n) {
      stats.push({
        label: 'Monthly income',
        value: this.currencyService.format(data.monthlyIncome),
      });
    }

    // Net activity
    const netActivity = data.totalIncome - data.totalSpending;
    stats.push({
      label: 'Net',
      value: this.currencyService.format(netActivity),
    });

    // Category count
    const categoryCount = data.categorySpending.items.length;
    if (categoryCount > 0) {
      stats.push({
        label: 'Categories with spending',
        value: categoryCount.toString(),
      });
    }

    return stats;
  });
}
