/**
 * Type definitions for YNAB CSV data import
 */

/**
 * Parsed row from plan.csv (budget assignments)
 * CSV columns: Month, Category Group/Category, Category Group, Category, Assigned, Activity, Available
 */
export interface YnabPlanRow {
  month: string; // "Apr 2022"
  categoryGroupCategory: string; // "Savings: Emergency Fund"
  categoryGroup: string; // "Savings"
  category: string; // "Emergency Fund"
  assigned: string; // "$500.00"
  activity: string; // "$0.00"
  available: string; // "$500.00"
}

/**
 * Parsed row from register.csv (transactions)
 * CSV columns: Account, Flag, Date, Payee, Category Group/Category, Category Group, Category, Memo, Outflow, Inflow, Cleared
 */
export interface YnabRegisterRow {
  account: string; // "SoFi Checking"
  flag: string; // "" or color name
  date: string; // "01/08/2026" (MM/DD/YYYY)
  payee: string; // "Transfer : Chase CC" or "Starbucks"
  categoryGroupCategory: string; // "Savings: Emergency Fund" or ""
  categoryGroup: string; // "Savings" or ""
  category: string; // "Emergency Fund" or ""
  memo: string; // "" or "Split (1/2)"
  outflow: string; // "$500.00" or "$0.00"
  inflow: string; // "$0.00" or "$500.00"
  cleared: string; // "Cleared", "Uncleared", or "Reconciled"
}

/**
 * Account type mapping for user confirmation
 */
export interface AccountTypeMapping {
  accountName: string;
  inferredType: KualiaAccountType | null; // null means no confident match
  confirmedType: KualiaAccountType | null; // null means user must select
}

/**
 * Kualia account types (subset for YNAB import)
 * These are the most common types that YNAB users will have
 */
/**
 * Supported YNAB date formats for CSV exports
 */
export type YnabDateFormat = 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD' | 'DD.MM.YYYY';

export type KualiaAccountType =
  | 'banking_checking'
  | 'banking_savings'
  | 'banking_cash'
  | 'credit_credit_card'
  | 'investment_brokerage'
  | 'investment_401k'
  | 'investment_ira'
  | 'investment_roth_ira'
  | 'investment_hsa'
  | 'loan_auto'
  | 'loan_mortgage'
  | 'loan_student'
  | 'loan_other';

/**
 * Movement within a transaction (for splits)
 */
export interface ParsedMovement {
  categoryGroup: string;
  category: string;
  amount: number; // In workspace currency base units, signed (negative for outflow)
  notes: string;
  sortOrder: number;
  isReadyToAssign: boolean;
}

/**
 * Grouped transaction with all its movements (handles splits)
 */
export interface GroupedTransaction {
  account: string;
  date: string; // ISO format "2026-01-08"
  payee: string;
  movements: ParsedMovement[];
  totalAmount: number; // Sum of movements in workspace currency base units
  status: 'pending' | 'cleared' | 'reconciled';
  isTransfer: boolean;
  transferToAccount: string | null; // Account name if transfer
  originalRows: YnabRegisterRow[]; // For debugging
}

/**
 * Parsed category group from plan.csv
 */
export interface ParsedCategoryGroup {
  name: string;
  type: 'expense' | 'credit_card';
  isHidden: boolean;
  categories: string[];
}

/**
 * Parsed category with monthly assignments
 */
export interface ParsedCategory {
  name: string;
  groupName: string;
  isArchived: boolean;
  monthlyAssignments: Record<string, number>; // yearMonth -> amount in workspace currency base units
}

/**
 * Progress tracking for import status updates
 */
export interface ImportProgress {
  currentStep: string;
  accountsTotal: number;
  accountsImported: number;
  categoriesTotal: number;
  categoriesImported: number;
  transactionsTotal: number;
  transactionsImported: number;
}

/**
 * Import preview stats returned after parsing
 */
export interface ImportPreview {
  accountCount: number;
  monthCount: number;
  categoryCount: number;
  transactionCount: number;
}

/**
 * Result type for parseYnabFiles action
 */
export type ParseResult =
  | { success: false; error: string }
  | {
      success: true;
      accountMappings: AccountTypeMapping[];
      preview: ImportPreview;
    };

/**
 * Result type for startYnabImport action
 */
export type ImportResult =
  | { success: false; error: string }
  | {
      success: true;
      workspaceId: string;
      stats: {
        accounts: number;
        categoryGroups: number;
        categories: number;
        transactions: number;
        merchants: number;
        transferPairs: number;
      };
    };

/**
 * Month abbreviation to number mapping for date parsing
 */
export const MONTH_ABBREVIATIONS: Record<string, string> = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
};

/**
 * Account type inference patterns
 * Order matters - more specific patterns should come first
 */
export const ACCOUNT_TYPE_PATTERNS: Array<{
  pattern: RegExp;
  type: KualiaAccountType;
}> = [
  // Investment accounts
  { pattern: /roth\s*ira/i, type: 'investment_roth_ira' },
  { pattern: /401k|401\(k\)/i, type: 'investment_401k' },
  { pattern: /\bira\b/i, type: 'investment_ira' },
  { pattern: /\bhsa\b/i, type: 'investment_hsa' },
  { pattern: /brokerage/i, type: 'investment_brokerage' },

  // Credit cards - specific card names first
  { pattern: /apple\s*card/i, type: 'credit_credit_card' },
  { pattern: /chase\s*(sapphire|freedom|slate|amazon)/i, type: 'credit_credit_card' },
  { pattern: /citi\s*(double|custom|diamond|rewards)/i, type: 'credit_credit_card' },
  { pattern: /capital\s*one/i, type: 'credit_credit_card' },
  { pattern: /bank\s*of\s*america/i, type: 'credit_credit_card' },
  { pattern: /wells\s*fargo.*card/i, type: 'credit_credit_card' },
  { pattern: /american\s*express/i, type: 'credit_credit_card' },
  { pattern: /\bamex\b/i, type: 'credit_credit_card' },
  { pattern: /\bvisa\b/i, type: 'credit_credit_card' },
  { pattern: /mastercard/i, type: 'credit_credit_card' },
  { pattern: /discover/i, type: 'credit_credit_card' },
  { pattern: /credit\s*card|cc\b/i, type: 'credit_credit_card' },
  // Common card brand names
  { pattern: /sapphire|freedom|venture|quicksilver/i, type: 'credit_credit_card' },
  { pattern: /platinum|gold\s*card|rewards\s*card/i, type: 'credit_credit_card' },

  // Loans
  { pattern: /mortgage/i, type: 'loan_mortgage' },
  { pattern: /student\s*loan/i, type: 'loan_student' },
  { pattern: /auto\s*loan|car\s*loan/i, type: 'loan_auto' },
  { pattern: /\bloan\b/i, type: 'loan_other' },

  // Banking
  { pattern: /savings/i, type: 'banking_savings' },
  { pattern: /checking/i, type: 'banking_checking' },
  { pattern: /venmo|paypal|cash\s*app|zelle/i, type: 'banking_cash' },
  { pattern: /\bcash\b/i, type: 'banking_cash' },
];
