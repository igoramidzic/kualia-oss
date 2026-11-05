import { inject, Pipe, PipeTransform } from '@angular/core';
import { CurrencyService } from '../../services/currency.service';
import { formatCurrency } from '../utils/formatters';

/**
 * Currency pipe for formatting amounts in templates
 *
 * Usage:
 * {{ amount | currency }}                  // Uses workspace currency
 * {{ amount | currency:'EUR' }}            // Override with specific currency
 * {{ amount | currency:undefined:true }}   // Show sign with workspace currency
 */
@Pipe({
  name: 'currency',
})
export class CurrencyPipe implements PipeTransform {
  private readonly currencyService = inject(CurrencyService);

  transform(value: number | null | undefined, currencyCode?: string, showSign = false): string {
    if (value === null || value === undefined) {
      return '';
    }

    const currency = currencyCode ?? this.currencyService.currencyCode();
    const formatted = formatCurrency(value, currency);

    return showSign && value > 0 ? `+${formatted}` : formatted;
  }
}
