import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { CurrencyService } from '../../services/currency.service';

@Component({
  selector: 'app-transaction-amount-badge',
  imports: [HlmBadge],
  template: `
    <span hlmBadge variant="outline" class="bg-content-background h-6 font-normal">
      {{ formattedAmount() }}
    </span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TransactionAmountBadgeComponent {
  private readonly currencyService = inject(CurrencyService);

  readonly amount = input.required<number | bigint>();
  readonly categoryType = input<'income' | 'expense' | null>(null);

  readonly isPositive = computed(() => {
    const type = this.categoryType();
    if (type) {
      return type === 'income';
    }
    const amount = this.amount();
    return typeof amount === 'bigint' ? amount > 0n : amount > 0;
  });

  readonly formattedAmount = computed(() => {
    return this.currencyService.format(this.amount());
  });
}
