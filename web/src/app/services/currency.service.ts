import { computed, inject, Injectable } from '@angular/core';
import {
  formatCompactCurrency as formatCompactCurrencyUtil,
  formatCurrency as formatCurrencyUtil,
} from '../shared/utils/formatters';
import { WorkspaceService } from './workspace.service';

const DEFAULT_CURRENCY = 'USD';

@Injectable({
  providedIn: 'root',
})
export class CurrencyService {
  private readonly workspaceService = inject(WorkspaceService);

  /**
   * The workspace currency code (e.g., 'USD', 'EUR')
   * Falls back to 'USD' if not set
   */
  readonly currencyCode = computed(() => {
    return this.workspaceService.workspace()?.currency ?? DEFAULT_CURRENCY;
  });

  /**
   * Format an amount using the workspace currency
   * @param amountInBaseUnits Amount in base units (e.g., cents)
   * @returns Formatted currency string
   */
  format(amountInBaseUnits: number | bigint): string {
    return formatCurrencyUtil(amountInBaseUnits, this.currencyCode());
  }

  /**
   * Format an amount with a sign prefix using the workspace currency
   * @param amountInBaseUnits Amount in base units (e.g., cents)
   * @returns Formatted currency string with + prefix for positive amounts
   */
  formatWithSign(amountInBaseUnits: number | bigint): string {
    const formatted = formatCurrencyUtil(amountInBaseUnits, this.currencyCode());
    const amount = typeof amountInBaseUnits === 'bigint' ? Number(amountInBaseUnits) : amountInBaseUnits;
    return amount > 0 ? `+${formatted}` : formatted;
  }

  /**
   * Format an amount in compact notation using the workspace currency
   * @param amountInBaseUnits Amount in base units (e.g., cents)
   * @returns Formatted currency string in compact notation (e.g., $1.2k, $3.5M)
   */
  formatCompact(amountInBaseUnits: number | bigint): string {
    return formatCompactCurrencyUtil(amountInBaseUnits, this.currencyCode());
  }
}
