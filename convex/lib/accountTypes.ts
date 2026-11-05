/**
 * Account type categories
 */
export const AccountTypeCategory = {
  BANKING: 'banking',
  CREDIT: 'credit',
  INVESTMENT: 'investment',
  LOAN: 'loan',
} as const;

export type AccountTypeCategoryValue = (typeof AccountTypeCategory)[keyof typeof AccountTypeCategory];

/**
 * Get the category for an account type string
 * @param accountType - The raw account type string (e.g., "banking_checking", "credit_credit_card")
 * @returns The category string, or null if the account type is invalid
 */
export function getAccountTypeCategory(accountType: string): AccountTypeCategoryValue | null {
  if (accountType.startsWith('banking_')) return AccountTypeCategory.BANKING;
  if (accountType.startsWith('credit_')) return AccountTypeCategory.CREDIT;
  if (accountType.startsWith('investment_')) return AccountTypeCategory.INVESTMENT;
  if (accountType.startsWith('loan_')) return AccountTypeCategory.LOAN;
  return null;
}

/**
 * Check if an account type is a liability (credit or loan)
 * @param accountType - The raw account type string
 * @returns True if the account type is a liability
 */
export function isLiabilityAccountType(accountType: string): boolean {
  const category = getAccountTypeCategory(accountType);
  return category === AccountTypeCategory.CREDIT || category === AccountTypeCategory.LOAN;
}

/**
 * Check if an account type is an asset (banking or investment)
 * @param accountType - The raw account type string
 * @returns True if the account type is an asset
 */
export function isAssetAccountType(accountType: string): boolean {
  const category = getAccountTypeCategory(accountType);
  return category === AccountTypeCategory.BANKING || category === AccountTypeCategory.INVESTMENT;
}
