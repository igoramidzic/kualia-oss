import { Doc } from 'convex/_generated/dataModel';

type AccountType = Doc<'bankAccount'>['accountType'];

/**
 * Account type category keys as stored in the database.
 * These are the raw category values used for data operations.
 */
export type AccountTypeCategory = 'Banking' | 'Credit' | 'Investment' | 'Loan';

/**
 * Maps account type category keys to user-friendly display names.
 * "Banking" is displayed as "Cash" for clarity.
 */
const ACCOUNT_TYPE_CATEGORY_DISPLAY_NAMES: Record<AccountTypeCategory, string> = {
  Banking: 'Cash',
  Credit: 'Credit',
  Investment: 'Investment',
  Loan: 'Loan',
};

/**
 * Gets the user-friendly display name for an account type category.
 * @param category - The account type category key (e.g., "Banking", "Credit")
 * @returns The display name (e.g., "Cash" for "Banking")
 */
export function formatAccountTypeCategory(category: AccountTypeCategory | string): string {
  if (category in ACCOUNT_TYPE_CATEGORY_DISPLAY_NAMES) {
    return ACCOUNT_TYPE_CATEGORY_DISPLAY_NAMES[category as AccountTypeCategory];
  }
  return category;
}

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  // Banking
  banking_checking: 'Checking',
  banking_savings: 'Savings',
  banking_cash: 'Cash',
  banking_cash_management: 'Cash Management',
  banking_money_market: 'Money Market',
  banking_cd: 'CD',
  banking_other: 'Other',

  // Credit
  credit_credit_card: 'Credit Card',
  credit_line_of_credit: 'Line of Credit',
  credit_other: 'Other',

  // Investment
  investment_brokerage: 'Brokerage',
  investment_401k: '401(k)',
  investment_ira: 'IRA',
  investment_keogh: 'Keogh',
  investment_roth_ira: 'Roth IRA',
  investment_roth_401k: 'Roth 401(k)',
  investment_hsa: 'HSA',
  investment_sep_ira: 'SEP IRA',
  investment_simple_ira: 'SIMPLE IRA',
  investment_529_plan: '529 Plan',
  investment_403b: '403(b)',
  investment_other: 'Other',

  // Loan
  loan_auto: 'Auto',
  loan_business: 'Business',
  loan_commercial: 'Commercial',
  loan_construction: 'Construction',
  loan_home_equity: 'Home Equity',
  loan_mortgage: 'Mortgage',
  loan_student: 'Student',
  loan_other: 'Other',
};

/**
 * Checks if an account type is supported for linking (banking and credit only).
 * Investment and loan accounts are not yet supported.
 * @param accountType - The account type string (e.g., "banking_checking", "investment_401k")
 * @returns True if the account type is supported for linking
 */
export function isSupportedForLinking(accountType: string | null | undefined): boolean {
  if (!accountType) return false;
  return accountType.startsWith('banking_') || accountType.startsWith('credit_');
}

/**
 * Formats an account type enum value to a human-readable display string.
 * @param accountType - The account type from the Convex schema
 * @returns The formatted display text (e.g., "banking_checking" -> "Checking")
 */
export function formatAccountType(accountType: AccountType | string | null | undefined): string {
  if (!accountType) {
    return '—';
  }

  // Check if it's a known account type
  if (accountType in ACCOUNT_TYPE_LABELS) {
    return ACCOUNT_TYPE_LABELS[accountType as AccountType];
  }

  // Fallback: transform unknown types by removing prefix and title-casing
  return accountType
    .split('_')
    .slice(1) // Remove the category prefix (banking_, credit_, etc.)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}
