// Step definitions for YNAB import wizard
export enum YnabImportStep {
  Upload = 0,
  AccountMapping = 1,
  Importing = 2,
  Complete = 3,
}

export const TOTAL_STEPS = 4;

// Account type options for mapping
// These must match the accountType union in convex/schema.ts
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

export interface AccountTypeOption {
  value: KualiaAccountType;
  label: string;
  description: string;
}

export const ACCOUNT_TYPE_OPTIONS: AccountTypeOption[] = [
  // Banking
  {
    value: 'banking_checking',
    label: 'Checking',
    description: 'Primary spending account',
  },
  {
    value: 'banking_savings',
    label: 'Savings',
    description: 'Savings or money market account',
  },
  {
    value: 'banking_cash',
    label: 'Cash',
    description: 'Physical cash, Venmo, PayPal, Cash App',
  },

  // Credit
  {
    value: 'credit_credit_card',
    label: 'Credit Card',
    description: 'Credit card account',
  },

  // Investment
  {
    value: 'investment_brokerage',
    label: 'Brokerage',
    description: 'Investment or brokerage account',
  },
  {
    value: 'investment_401k',
    label: '401(k)',
    description: 'Employer-sponsored retirement',
  },
  {
    value: 'investment_ira',
    label: 'IRA',
    description: 'Individual Retirement Account',
  },
  {
    value: 'investment_roth_ira',
    label: 'Roth IRA',
    description: 'Roth IRA account',
  },
  {
    value: 'investment_hsa',
    label: 'HSA',
    description: 'Health Savings Account',
  },

  // Loans
  {
    value: 'loan_mortgage',
    label: 'Mortgage',
    description: 'Home loan or mortgage',
  },
  {
    value: 'loan_auto',
    label: 'Auto Loan',
    description: 'Car or vehicle loan',
  },
  {
    value: 'loan_student',
    label: 'Student Loan',
    description: 'Student loan or education debt',
  },
  {
    value: 'loan_other',
    label: 'Other Loan',
    description: 'Personal or other loan',
  },
];

// Step metadata for display
export interface StepConfig {
  step: YnabImportStep;
  title: string;
  subtitle?: string;
}

export const STEP_CONFIGS: StepConfig[] = [
  {
    step: YnabImportStep.Upload,
    title: 'Upload YNAB Files',
    subtitle: 'Export your plan.csv and register.csv from YNAB',
  },
  {
    step: YnabImportStep.AccountMapping,
    title: 'Confirm Account Types',
    subtitle: 'Review and adjust the detected account types',
  },
  {
    step: YnabImportStep.Importing,
    title: 'Importing Your Data',
    subtitle: 'Please wait while we import your budget',
  },
  {
    step: YnabImportStep.Complete,
    title: 'Import Complete!',
    subtitle: 'Your YNAB data has been successfully imported',
  },
];
