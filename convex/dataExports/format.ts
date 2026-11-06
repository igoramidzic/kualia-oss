import { EXPORT_COLUMNS } from './columns';
import { formatBigIntAsDecimal } from '../lib/serialization';

export interface WorkspaceExportRecord {
  workspaceId: string;
  createdAt: number;
  name: string;
  currency: string;
  timezone: string | null;
  readyToAssign: bigint;
  expectedMonthlyIncome: bigint | null;
  transactionDefaultAccountId: string | null;
  transactionDefaultAccountName: string | null;
  transactionDefaultPendingStatus: boolean;
  onboardingCompleted: boolean;
  isArchived: boolean;
  updatedAt: string | null;
}

export interface CategoryExportRecord {
  categoryId: string;
  createdAt: number;
  name: string;
  categoryGroupId: string;
  categoryGroupName: string | null;
  categoryGroupType: 'expense' | 'credit_card' | null;
  sortOrder: number;
  iconName: string | null;
  isSystemCategory: boolean;
  isArchived: boolean;
  categoryType: string | null;
  bankAccountId: string | null;
  targetEnabled: boolean;
  targetType: string | null;
  targetAmount: bigint | null;
  targetFrequency: string | null;
  targetFrequencyInterval: number | null;
  targetDayOfWeek: number | null;
  targetDueDay: number | null;
  targetFirstDueDate: string | null;
  targetDate: string | null;
  targetMonthlyContribution: bigint | null;
  targetBalance: bigint | null;
  updatedAt: string | null;
}

export interface PlanExportRecord {
  categoryId: string;
  categoryName: string;
  categoryGroupId: string;
  categoryGroupName: string;
  categoryGroupType: 'expense' | 'credit_card';
  categoryArchived: boolean;
  categoryType: string | null;
  bankAccountId: string | null;
  monthlyAssignedAmounts: Record<string, bigint>;
  snoozedTargetMonths: Record<string, boolean>;
  monthlySpending: Record<string, { inflowAmount: bigint; outflowAmount: bigint }>;
  creditMonthlySpending: Record<
    string,
    {
      priorBalance: bigint;
      spendingAmount: bigint;
      paymentsAmount: bigint;
      refundedSpending: bigint;
    }
  >;
}

export interface BankAccountExportRecord {
  bankAccountId: string;
  createdAt: number;
  name: string;
  accountType: string;
  currentBalance: bigint;
  pendingBalance: bigint | null;
  clearedBalance: bigint | null;
  isClosed: boolean;
  closedAt: string | null;
  lastReconciledAt: string | null;
  notes: string | null;
  updatedAt: string | null;
}

export interface TransactionMovementExportRecord {
  amount: bigint;
  sortOrder: number;
  categoryId: string | null;
  categoryName: string | null;
  categoryGroupId: string | null;
  categoryGroupName: string | null;
  readyToAssign: boolean;
  notes: string | null;
}

export interface TransactionExportRecord {
  transactionId: string;
  createdAt: number;
  date: string;
  accountId: string;
  accountName: string;
  merchantId: string | null;
  merchantName: string | null;
  type: string;
  status: string;
  reviewStatus: string;
  source: string | null;
  notes: string | null;
  totalAmount: bigint;
  transferPairId: string | null;
  transferAccountId: string | null;
  transferAccountName: string | null;
  scheduledTransactionId: string | null;
  updatedAt: string | null;
  movements: TransactionMovementExportRecord[];
}

export interface WorkspaceExportDataset {
  workspace: WorkspaceExportRecord;
  categories: CategoryExportRecord[];
  plan: PlanExportRecord[];
  bankAccounts: BankAccountExportRecord[];
  transactions: TransactionExportRecord[];
}

export interface WorkspaceExportCounts {
  transactionCount: number;
  transactionMovementRowCount: number;
  categoryCount: number;
  planRowCount: number;
  bankAccountCount: number;
}

interface CsvCell {
  value: string;
  kind: 'raw' | 'text';
}

export interface ExportCsvFile {
  name: string;
  content: string;
}

function raw(value: string | number | boolean | null): CsvCell {
  return { value: value === null ? '' : String(value), kind: 'raw' };
}

function text(value: string | null): CsvCell {
  return { value: value ?? '', kind: 'text' };
}

function money(value: bigint | null, minorUnit: number): CsvCell {
  return raw(value === null ? '' : formatBigIntAsDecimal(value, minorUnit));
}

function protectSpreadsheetText(value: string): string {
  return /^[\t\r ]*[=+\-@]/.test(value) ? `'${value}` : value;
}

function escapeCsvCell(cell: CsvCell): string {
  const value = cell.kind === 'text' ? protectSpreadsheetText(cell.value) : cell.value;
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function buildCsv(headers: readonly string[], rows: readonly CsvCell[][]): string {
  const header = headers.map((value) => escapeCsvCell(raw(value))).join(',');
  const body = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
  return `\uFEFF${header}${body.length > 0 ? `\r\n${body}` : ''}\r\n`;
}

function isoDate(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function getExportCategoryName(
  storedName: string,
  categoryType: string | null,
  categoryGroupType: 'expense' | 'credit_card' | null,
  bankAccountId: string | null,
  bankAccountNames: ReadonlyMap<string, string>
): string {
  const isCreditCard = categoryType === 'credit_card' || categoryGroupType === 'credit_card';
  return isCreditCard && bankAccountId ? (bankAccountNames.get(bankAccountId) ?? storedName) : storedName;
}

function buildCategoriesCsv(
  categories: readonly CategoryExportRecord[],
  bankAccountNames: ReadonlyMap<string, string>,
  minorUnit: number
): string {
  return buildCsv(
    EXPORT_COLUMNS['categories.csv'],
    [...categories]
      .sort(
        (left, right) =>
          (left.categoryGroupName ?? '').localeCompare(right.categoryGroupName ?? '') ||
          left.sortOrder - right.sortOrder ||
          left.name.localeCompare(right.name)
      )
      .map((category) => [
        raw(category.categoryId),
        text(
          getExportCategoryName(
            category.name,
            category.categoryType,
            category.categoryGroupType,
            category.bankAccountId,
            bankAccountNames
          )
        ),
        raw(category.categoryGroupId),
        text(category.categoryGroupName),
        raw(category.sortOrder),
        raw(category.iconName),
        raw(category.isSystemCategory),
        raw(category.isArchived),
        raw(category.categoryType),
        raw(category.bankAccountId),
        raw(category.targetEnabled),
        raw(category.targetType),
        money(category.targetAmount, minorUnit),
        raw(category.targetFrequency),
        raw(category.targetFrequencyInterval),
        raw(category.targetDayOfWeek),
        raw(category.targetDueDay),
        raw(category.targetFirstDueDate),
        raw(category.targetDate),
        money(category.targetMonthlyContribution, minorUnit),
        money(category.targetBalance, minorUnit),
        raw(isoDate(category.createdAt)),
        raw(category.updatedAt),
      ])
  );
}

function buildPlanCsv(
  plan: readonly PlanExportRecord[],
  bankAccountNames: ReadonlyMap<string, string>,
  minorUnit: number
): { content: string; rowCount: number } {
  const rows: Array<{
    yearMonth: string;
    categoryGroupName: string;
    categoryName: string;
    cells: CsvCell[];
  }> = [];

  for (const category of plan) {
    const categoryName = getExportCategoryName(
      category.categoryName,
      category.categoryType,
      category.categoryGroupType,
      category.bankAccountId,
      bankAccountNames
    );
    const months = new Set([
      ...Object.keys(category.monthlyAssignedAmounts),
      ...Object.keys(category.snoozedTargetMonths),
      ...Object.keys(category.monthlySpending),
      ...Object.keys(category.creditMonthlySpending),
    ]);
    for (const yearMonth of [...months].sort()) {
      const activity = category.monthlySpending[yearMonth];
      const creditActivity = category.creditMonthlySpending[yearMonth];
      const inflow = activity?.inflowAmount ?? 0n;
      const outflow = activity?.outflowAmount ?? 0n;
      rows.push({
        yearMonth,
        categoryGroupName: category.categoryGroupName,
        categoryName,
        cells: [
          raw(yearMonth),
          raw(category.categoryGroupId),
          text(category.categoryGroupName),
          raw(category.categoryId),
          text(categoryName),
          raw(category.categoryArchived),
          money(category.monthlyAssignedAmounts[yearMonth] ?? 0n, minorUnit),
          money(inflow, minorUnit),
          money(outflow, minorUnit),
          money(inflow - outflow, minorUnit),
          raw(category.snoozedTargetMonths[yearMonth] === true),
          money(creditActivity?.priorBalance ?? 0n, minorUnit),
          money(creditActivity?.spendingAmount ?? 0n, minorUnit),
          money(creditActivity?.paymentsAmount ?? 0n, minorUnit),
          money(creditActivity?.refundedSpending ?? 0n, minorUnit),
        ],
      });
    }
  }

  rows.sort(
    (left, right) =>
      left.yearMonth.localeCompare(right.yearMonth) ||
      left.categoryGroupName.localeCompare(right.categoryGroupName) ||
      left.categoryName.localeCompare(right.categoryName)
  );

  return {
    content: buildCsv(
      EXPORT_COLUMNS['plan.csv'],
      rows.map((row) => row.cells)
    ),
    rowCount: rows.length,
  };
}

function buildBankAccountsCsv(accounts: readonly BankAccountExportRecord[], minorUnit: number): string {
  return buildCsv(
    EXPORT_COLUMNS['bank-accounts.csv'],
    [...accounts]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((account) => [
        raw(account.bankAccountId),
        text(account.name),
        raw(account.accountType),
        money(account.currentBalance, minorUnit),
        money(account.pendingBalance, minorUnit),
        money(account.clearedBalance, minorUnit),
        raw(account.isClosed),
        raw(account.closedAt),
        raw(account.lastReconciledAt),
        text(account.notes),
        raw(isoDate(account.createdAt)),
        raw(account.updatedAt),
      ])
  );
}

function buildTransactionsCsv(
  transactions: readonly TransactionExportRecord[],
  minorUnit: number
): { content: string; movementRowCount: number } {
  const rows: CsvCell[][] = [];
  const sortedTransactions = [...transactions].sort(
    (left, right) => left.date.localeCompare(right.date) || left.createdAt - right.createdAt
  );

  for (const transaction of sortedTransactions) {
    const movements: Array<TransactionMovementExportRecord | null> =
      transaction.movements.length > 0
        ? [...transaction.movements].sort((left, right) => left.sortOrder - right.sortOrder)
        : [null];
    const movementCount = movements.length;

    movements.forEach((movement, index) => {
      rows.push([
        raw(transaction.transactionId),
        raw(index + 1),
        raw(movementCount),
        raw(movementCount > 1),
        raw(transaction.date),
        raw(transaction.accountId),
        text(transaction.accountName),
        raw(transaction.merchantId),
        text(transaction.merchantName),
        raw(transaction.type),
        raw(transaction.status),
        raw(transaction.reviewStatus),
        raw(transaction.source),
        text(transaction.notes),
        money(transaction.totalAmount, minorUnit),
        money(movement?.amount ?? null, minorUnit),
        raw(movement?.categoryGroupId ?? null),
        text(movement?.categoryGroupName ?? null),
        raw(movement?.categoryId ?? null),
        text(movement?.readyToAssign === true ? 'Ready to Assign' : (movement?.categoryName ?? null)),
        text(movement?.notes ?? null),
        raw(transaction.transferPairId),
        raw(transaction.transferAccountId),
        text(transaction.transferAccountName),
        raw(transaction.scheduledTransactionId),
        raw(isoDate(transaction.createdAt)),
        raw(transaction.updatedAt),
      ]);
    });
  }

  return {
    content: buildCsv(EXPORT_COLUMNS['transactions.csv'], rows),
    movementRowCount: rows.length,
  };
}

export function buildWorkspaceExportCsvFiles(
  dataset: WorkspaceExportDataset,
  minorUnit: number
): { files: ExportCsvFile[]; counts: WorkspaceExportCounts } {
  const bankAccountNames = new Map(dataset.bankAccounts.map((account) => [account.bankAccountId, account.name]));
  const plan = buildPlanCsv(dataset.plan, bankAccountNames, minorUnit);
  const transactions = buildTransactionsCsv(dataset.transactions, minorUnit);

  return {
    files: [
      { name: 'categories.csv', content: buildCategoriesCsv(dataset.categories, bankAccountNames, minorUnit) },
      { name: 'plan.csv', content: plan.content },
      { name: 'bank-accounts.csv', content: buildBankAccountsCsv(dataset.bankAccounts, minorUnit) },
      { name: 'transactions.csv', content: transactions.content },
    ],
    counts: {
      transactionCount: dataset.transactions.length,
      transactionMovementRowCount: transactions.movementRowCount,
      categoryCount: dataset.categories.length,
      planRowCount: plan.rowCount,
      bankAccountCount: dataset.bankAccounts.length,
    },
  };
}
