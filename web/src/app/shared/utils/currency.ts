/**
 * Currency formatting utilities
 *
 * Re-exported from @kualia/shared for backwards compatibility
 */

export type { CurrencyFormat } from '@kualia/shared/currency';

export {
  CURRENCY_FORMATS,
  formatCurrencyDisplay as formatCurrency,
  getCurrencyFormat,
  parseCurrency,
} from '@kualia/shared/currency';
