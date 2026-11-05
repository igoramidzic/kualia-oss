/**
 * CSV parsing utilities for YNAB data import
 */

import type {
  AccountTypeMapping,
  GroupedTransaction,
  KualiaAccountType,
  ParsedCategory,
  ParsedCategoryGroup,
  ParsedMovement,
  YnabDateFormat,
  YnabPlanRow,
  YnabRegisterRow,
} from './types';
import { ACCOUNT_TYPE_PATTERNS, MONTH_ABBREVIATIONS } from './types';

/**
 * Sanitize a string to be safe for use as a Convex Record field name.
 * Convex only allows non-control ASCII characters (codes 32-126).
 * This replaces any non-ASCII or control characters with their Unicode code point.
 */
export function sanitizeFieldName(name: string): string {
  let result = '';
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    // ASCII printable range: 32-126
    if (code >= 32 && code <= 126) {
      result += name[i];
    } else {
      // Replace with underscore and code point (e.g., emoji becomes _128663_)
      result += `_${code}_`;
    }
  }
  return result;
}

/**
 * Strip UTF-8 BOM character from the start of a string
 */
function stripBOM(content: string): string {
  if (content.charCodeAt(0) === 0xfeff) {
    return content.slice(1);
  }
  return content;
}

/**
 * Parse a CSV line, handling quoted fields with commas
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  // Add the last field
  result.push(current.trim());

  return result;
}

function isEmptyCSVRecord(fields: string[]): boolean {
  return fields.every((field) => field.trim() === '');
}

const ZERO_DECIMAL_CURRENCIES = new Set([
  'AFN',
  'ALL',
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'IQD',
  'IRR',
  'ISK',
  'JPY',
  'KMF',
  'KPW',
  'KRW',
  'LAK',
  'LBP',
  'MGA',
  'MMK',
  'PYG',
  'RSD',
  'RWF',
  'SLL',
  'SOS',
  'SYP',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
  'YER',
]);

const THREE_DECIMAL_CURRENCIES = new Set(['BHD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

export function getCurrencyMinorUnit(currencyCode: string): number {
  const normalizedCurrencyCode = currencyCode.trim().toUpperCase();

  if (ZERO_DECIMAL_CURRENCIES.has(normalizedCurrencyCode)) {
    return 0;
  }

  if (THREE_DECIMAL_CURRENCIES.has(normalizedCurrencyCode)) {
    return 3;
  }

  return 2;
}

function detectDecimalSeparator(value: string, minorUnit: number): '.' | ',' | null {
  const lastDot = value.lastIndexOf('.');
  const lastComma = value.lastIndexOf(',');

  if (lastDot !== -1 && lastComma !== -1) {
    return lastDot > lastComma ? '.' : ',';
  }

  const separator = lastDot !== -1 ? '.' : lastComma !== -1 ? ',' : null;
  if (separator === null) {
    return null;
  }

  const lastSeparatorIndex = value.lastIndexOf(separator);
  const digitsBefore = value.slice(0, lastSeparatorIndex).replace(/\D/g, '');
  const digitsAfter = value.slice(lastSeparatorIndex + 1).replace(/\D/g, '');

  if (!digitsBefore || !digitsAfter) {
    return null;
  }

  if (minorUnit === 0) {
    // YNAB exports can still include trailing ".00" or ",00" for zero-decimal currencies.
    if (digitsAfter.length <= 2) {
      return separator;
    }

    return null;
  }

  if (digitsAfter.length <= minorUnit) {
    return separator;
  }

  return null;
}

/**
 * Parse currency string to base units for the selected workspace currency.
 * Handles both "1,234.56" and "1.234,56" YNAB exports.
 */
export function parseCurrencyToBaseUnits(value: string, currencyCode = 'USD'): number {
  if (!value || value.trim() === '') {
    return 0;
  }

  const trimmedValue = value.trim();
  const isNegative = trimmedValue.includes('-') || (trimmedValue.startsWith('(') && trimmedValue.endsWith(')'));
  const numericValue = trimmedValue.replace(/[^\d.,]/g, '');

  if (!numericValue) {
    return 0;
  }

  const minorUnit = getCurrencyMinorUnit(currencyCode);
  const decimalSeparator = detectDecimalSeparator(numericValue, minorUnit);
  let normalizedNumber: string;

  if (decimalSeparator) {
    const decimalIndex = numericValue.lastIndexOf(decimalSeparator);
    const integerPart = numericValue.slice(0, decimalIndex).replace(/\D/g, '') || '0';
    const fractionalPart = numericValue.slice(decimalIndex + 1).replace(/\D/g, '');
    normalizedNumber = `${integerPart}.${fractionalPart}`;
  } else {
    normalizedNumber = numericValue.replace(/\D/g, '');
  }

  const parsedAmount = Number(normalizedNumber);
  if (!Number.isFinite(parsedAmount)) {
    return 0;
  }

  const baseUnits = Math.round(parsedAmount * Math.pow(10, minorUnit));

  return isNegative ? -baseUnits : baseUnits;
}

/**
 * Parse currency string to cents for existing USD callers.
 */
export function parseCurrencyToZentys(value: string): number {
  return parseCurrencyToBaseUnits(value, 'USD');
}

/**
 * Detect the date format used in YNAB register rows by examining date values.
 * Checks separator to identify format family, then disambiguates slash-separated
 * formats by scanning rows for a date value > 12 (which must be a day, not a month).
 */
function detectDateFormat(rows: YnabRegisterRow[]): YnabDateFormat {
  // Sample up to 10 rows to find a non-empty date for separator detection
  const sampleRows = rows.slice(0, 10);
  const sampleDate = sampleRows.find((r) => r.date.trim())?.date ?? '';

  if (sampleDate.includes('-')) {
    const sampleParts = sampleDate.split('-');
    const firstPart = sampleParts[0];
    if (firstPart.length === 4) return 'YYYY-MM-DD';

    // Hyphen-separated with year at the end: disambiguate day/month order
    for (const row of rows) {
      const parts = row.date.split('-');
      if (parts.length !== 3) continue;

      const first = parseInt(parts[0], 10);
      const second = parseInt(parts[1], 10);

      // If the first part > 12, it can't be a month → DD-MM-YYYY
      if (first > 12) return 'DD/MM/YYYY';
      // If the second part > 12, it can't be a month → MM-DD-YYYY
      if (second > 12) return 'MM/DD/YYYY';
    }

    // Ambiguous values (all <= 12) default to DD-MM-YYYY for dashed dates
    if (sampleParts.length === 3 && sampleParts[2]?.length === 4) {
      return 'DD/MM/YYYY';
    }
  }

  if (sampleDate.includes('.')) {
    const sampleParts = sampleDate.split('.');
    if (sampleParts[0]?.length === 4) return 'YYYY-MM-DD';

    return 'DD.MM.YYYY';
  }

  // Slash-separated: check for year-first format, then disambiguate day/month
  const slashParts = sampleDate.split('/');
  if (slashParts[0]?.length === 4) return 'YYYY-MM-DD';

  for (const row of rows) {
    const parts = row.date.split('/');
    if (parts.length !== 3) continue;

    const first = parseInt(parts[0], 10);
    const second = parseInt(parts[1], 10);

    // If the first part > 12, it can't be a month → DD/MM/YYYY
    if (first > 12) return 'DD/MM/YYYY';
    // If the second part > 12, it can't be a month → MM/DD/YYYY
    if (second > 12) return 'MM/DD/YYYY';
  }

  // All values ≤ 12, ambiguous — default to MM/DD/YYYY
  return 'MM/DD/YYYY';
}

/**
 * Parse YNAB date string to ISO format using the detected date format.
 * Output: "2026-01-08"
 */
export function parseYnabDate(date: string, format: YnabDateFormat): string {
  const parts = date.trim().split(/[./-]/);
  if (parts.length !== 3) throw new Error(`Invalid date format: ${date}`);

  let month: string;
  let day: string;
  let year: string;

  switch (format) {
    case 'YYYY-MM-DD': {
      [year, month, day] = parts;
      break;
    }
    case 'DD.MM.YYYY': {
      [day, month, year] = parts;
      break;
    }
    case 'DD/MM/YYYY': {
      [day, month, year] = parts;
      break;
    }
    case 'MM/DD/YYYY':
    default: {
      [month, day, year] = parts;
      break;
    }
  }

  const normalizedYear = year.trim();
  if (!/^\d{4}$/.test(normalizedYear)) {
    throw new Error(`Invalid year in date: ${date}. Expected a 4-digit year.`);
  }

  const normalizedMonth = month.trim();
  if (!/^\d{1,2}$/.test(normalizedMonth)) {
    throw new Error(`Invalid month in date: ${date}`);
  }

  const monthNumber = parseInt(normalizedMonth, 10);
  if (monthNumber < 1 || monthNumber > 12) {
    throw new Error(`Invalid month in date: ${date}`);
  }

  const normalizedDay = day.trim();
  if (!/^\d{1,2}$/.test(normalizedDay)) {
    throw new Error(`Invalid day in date: ${date}`);
  }

  const dayNumber = parseInt(normalizedDay, 10);
  if (dayNumber < 1 || dayNumber > 31) {
    throw new Error(`Invalid day in date: ${date}`);
  }

  return `${normalizedYear}-${String(monthNumber).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
}

/**
 * Parse YNAB month format to yearMonth key
 * Input: "Apr 2022"
 * Output: "202204"
 */
export function parseYnabMonth(month: string): string {
  const parts = month.trim().split(' ');
  if (parts.length !== 2) {
    throw new Error(`Invalid month format: ${month}`);
  }

  const [monthAbbr, year] = parts;
  const monthNum = MONTH_ABBREVIATIONS[monthAbbr];

  if (!monthNum) {
    throw new Error(`Unknown month abbreviation: ${monthAbbr}`);
  }

  return `${year}${monthNum}`;
}

/**
 * Infer Kualia account type from YNAB account name
 * Returns null if no confident match is found
 */
export function inferAccountType(name: string): KualiaAccountType | null {
  for (const { pattern, type } of ACCOUNT_TYPE_PATTERNS) {
    if (pattern.test(name)) {
      return type;
    }
  }

  // No confident match found
  return null;
}

/**
 * Parse plan.csv content into structured rows
 */
export function parsePlanCSV(csvContent: string): YnabPlanRow[] {
  const content = stripBOM(csvContent);
  const lines = content.split('\n').filter((line) => line.trim());

  if (lines.length === 0) {
    return [];
  }

  // Skip header row
  const dataLines = lines.slice(1);

  return dataLines.map((line) => {
    const fields = parseCSVLine(line);

    return {
      month: fields[0] ?? '',
      categoryGroupCategory: fields[1] ?? '',
      categoryGroup: fields[2] ?? '',
      category: fields[3] ?? '',
      assigned: fields[4] ?? '$0.00',
      activity: fields[5] ?? '$0.00',
      available: fields[6] ?? '$0.00',
    };
  });
}

/**
 * Parse register.csv content into structured rows
 */
export function parseRegisterCSV(csvContent: string): YnabRegisterRow[] {
  const content = stripBOM(csvContent);
  const lines = content
    .split('\n')
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim());

  if (lines.length === 0) {
    return [];
  }

  // Skip header row
  const dataLines = lines.slice(1);

  return dataLines.flatMap(({ line, lineNumber }) => {
    const fields = parseCSVLine(line);
    if (isEmptyCSVRecord(fields)) {
      return [];
    }

    const row: YnabRegisterRow = {
      account: fields[0] ?? '',
      flag: fields[1] ?? '',
      date: fields[2] ?? '',
      payee: fields[3] ?? '',
      categoryGroupCategory: fields[4] ?? '',
      categoryGroup: fields[5] ?? '',
      category: fields[6] ?? '',
      memo: fields[7] ?? '',
      outflow: fields[8] ?? '$0.00',
      inflow: fields[9] ?? '$0.00',
      cleared: fields[10] ?? 'Uncleared',
    };

    if (!row.date.trim()) {
      throw new Error(
        `register.csv row ${lineNumber} is missing a date${describeRegisterRow(row)}. Fix this row or remove it, then try importing again.`
      );
    }

    return [row];
  });
}

/**
 * Extract unique account names with inferred types from register rows
 * Accounts without a confident type match are sorted to the top for user attention
 */
export function extractAccountTypeMappings(rows: YnabRegisterRow[]): AccountTypeMapping[] {
  const accountNames = new Set<string>();

  for (const row of rows) {
    if (row.account) {
      accountNames.add(row.account);
    }
  }

  const mappings = Array.from(accountNames).map((name) => {
    const inferredType = inferAccountType(name);
    return {
      accountName: name,
      inferredType,
      // Leave null if no confident match - user must select
      confirmedType: inferredType,
    };
  });

  // Sort: accounts without confident type match first (need attention), then alphabetically
  return mappings.sort((a, b) => {
    const aConfident = a.inferredType !== null;
    const bConfident = b.inferredType !== null;

    if (aConfident !== bConfident) {
      return aConfident ? 1 : -1; // Unconfident ones first
    }

    return a.accountName.localeCompare(b.accountName);
  });
}

/**
 * Check if a row represents a transfer transaction
 * Returns the destination account name if it's a transfer, null otherwise
 */
function getTransferDestination(payee: string): string | null {
  const match = payee.match(/^Transfer\s*:\s*(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Map YNAB system payees to Kualia system transaction types.
 */
export function getSystemTransactionTypeFromYnabPayee(payee: string): 'starting_balance' | 'balance_adjustment' | null {
  const normalizedPayee = payee.trim().toLowerCase();

  if (normalizedPayee === 'starting balance') {
    return 'starting_balance';
  }

  if (normalizedPayee === 'reconciliation balance adjustment') {
    return 'balance_adjustment';
  }

  return null;
}

/**
 * Parse cleared status to Kualia transaction status
 */
function parseTransactionStatus(cleared: string): 'pending' | 'cleared' | 'reconciled' {
  const normalized = cleared.trim().toLowerCase();

  if (normalized === 'reconciled') {
    return 'reconciled';
  }

  if (normalized === 'cleared') {
    return 'cleared';
  }

  return 'pending';
}

/**
 * Check if a memo indicates this is part of a split transaction
 * Returns { isSplit: boolean, splitIndex: number, splitTotal: number }
 */
function parseSplitMemo(memo: string): {
  isSplit: boolean;
  splitIndex: number;
  splitTotal: number;
} {
  const match = memo.match(/Split\s*\((\d+)\/(\d+)\)/i);

  if (match) {
    return {
      isSplit: true,
      splitIndex: parseInt(match[1], 10),
      splitTotal: parseInt(match[2], 10),
    };
  }

  return { isSplit: false, splitIndex: 0, splitTotal: 0 };
}

/**
 * Generate a unique key for grouping split transactions
 */
function getSplitGroupKey(row: YnabRegisterRow): string {
  return `${row.account}|${row.date}|${row.payee}`;
}

/**
 * Check if category indicates income (Ready to Assign)
 */
function isIncomeCategory(categoryGroup: string, category: string): boolean {
  return categoryGroup.toLowerCase() === 'inflow' && category.toLowerCase() === 'ready to assign';
}

function describeRegisterRow(row: YnabRegisterRow): string {
  const details: string[] = [];
  const account = row.account.trim();
  const payee = row.payee.trim();

  if (account) {
    details.push(`account: ${account}`);
  }

  if (payee) {
    details.push(`payee: ${payee}`);
  }

  return details.length > 0 ? ` (${details.join(', ')})` : '';
}

function requireRegisterRowDate(row: YnabRegisterRow, rowIndex: number): string {
  const date = row.date.trim();
  if (date) {
    return date;
  }

  throw new Error(
    `YNAB register row ${rowIndex + 1} is missing a date${describeRegisterRow(row)}. Fix this row or remove it, then try importing again.`
  );
}

/**
 * Group split transactions and create movements
 */
export function groupSplitTransactions(rows: YnabRegisterRow[], currencyCode = 'USD'): GroupedTransaction[] {
  const dateFormat = detectDateFormat(rows);
  const transactions: GroupedTransaction[] = [];
  const splitGroups = new Map<string, YnabRegisterRow[]>();

  // First pass: identify and group splits
  for (const [rowIndex, row] of rows.entries()) {
    const date = requireRegisterRowDate(row, rowIndex);
    const { isSplit } = parseSplitMemo(row.memo);

    if (isSplit) {
      const key = getSplitGroupKey(row);
      const group = splitGroups.get(key) ?? [];
      group.push(row);
      splitGroups.set(key, group);
    } else {
      // Non-split transaction - process directly
      const outflow = parseCurrencyToBaseUnits(row.outflow, currencyCode);
      const inflow = parseCurrencyToBaseUnits(row.inflow, currencyCode);
      const amount = inflow - outflow; // Positive for inflow, negative for outflow

      const transferDest = getTransferDestination(row.payee);
      const isReadyToAssign = isIncomeCategory(row.categoryGroup, row.category);

      const movement: ParsedMovement = {
        categoryGroup: row.categoryGroup,
        category: row.category,
        amount,
        notes: row.memo,
        sortOrder: 0,
        isReadyToAssign,
      };

      transactions.push({
        account: row.account,
        date: parseYnabDate(date, dateFormat),
        payee: row.payee,
        movements: [movement],
        totalAmount: amount,
        status: parseTransactionStatus(row.cleared),
        isTransfer: transferDest !== null,
        transferToAccount: transferDest,
        originalRows: [row],
      });
    }
  }

  // Second pass: process split groups
  for (const [, groupRows] of splitGroups) {
    // Sort by split index
    groupRows.sort((a, b) => {
      const splitA = parseSplitMemo(a.memo);
      const splitB = parseSplitMemo(b.memo);
      return splitA.splitIndex - splitB.splitIndex;
    });

    const firstRow = groupRows[0];
    const transferDest = getTransferDestination(firstRow.payee);

    const movements: ParsedMovement[] = groupRows.map((row, index) => {
      const outflow = parseCurrencyToBaseUnits(row.outflow, currencyCode);
      const inflow = parseCurrencyToBaseUnits(row.inflow, currencyCode);
      const amount = inflow - outflow;
      const isReadyToAssign = isIncomeCategory(row.categoryGroup, row.category);

      // Extract notes from memo, removing the "Split (X/Y)" prefix
      const notes = row.memo.replace(/Split\s*\(\d+\/\d+\)\s*/i, '').trim();

      return {
        categoryGroup: row.categoryGroup,
        category: row.category,
        amount,
        notes,
        sortOrder: index,
        isReadyToAssign,
      };
    });

    const totalAmount = movements.reduce((sum, m) => sum + m.amount, 0);

    transactions.push({
      account: firstRow.account,
      date: parseYnabDate(firstRow.date, dateFormat),
      payee: firstRow.payee,
      movements,
      totalAmount,
      status: parseTransactionStatus(firstRow.cleared),
      isTransfer: transferDest !== null,
      transferToAccount: transferDest,
      originalRows: groupRows,
    });
  }

  // Sort transactions by date (newest first)
  transactions.sort((a, b) => b.date.localeCompare(a.date));

  return transactions;
}

/**
 * Filter out transactions after the user's current local date.
 * Both transaction dates and currentDate must be ISO format "YYYY-MM-DD".
 */
export function filterFutureTransactions(
  transactions: GroupedTransaction[],
  currentDate: string
): GroupedTransaction[] {
  const normalizedCurrentDate = currentDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedCurrentDate)) {
    throw new Error(`Invalid current date format: ${currentDate}. Expected YYYY-MM-DD.`);
  }

  return transactions.filter((transaction) => transaction.date <= normalizedCurrentDate);
}

/**
 * Extract category groups and their categories from plan rows
 * Handles special cases: Credit Card Payments group, Hidden Categories
 */
export function extractCategoryGroups(rows: YnabPlanRow[]): ParsedCategoryGroup[] {
  const groupMap = new Map<string, { type: 'expense' | 'credit_card'; isHidden: boolean; categories: Set<string> }>();

  for (const row of rows) {
    const groupName = row.categoryGroup.trim();
    const categoryName = row.category.trim();

    if (!groupName || !categoryName) {
      continue;
    }

    // Skip "Inflow" group (Ready to Assign) - this is handled as RTA, not a category
    if (groupName.toLowerCase() === 'inflow') {
      continue;
    }

    const isHidden = groupName.toLowerCase().includes('hidden');
    const isCreditCard = groupName.toLowerCase() === 'credit card payments';

    let group = groupMap.get(groupName);

    if (!group) {
      group = {
        type: isCreditCard ? 'credit_card' : 'expense',
        isHidden,
        categories: new Set(),
      };
      groupMap.set(groupName, group);
    }

    group.categories.add(categoryName);
  }

  return Array.from(groupMap.entries()).map(([name, data]) => ({
    name,
    type: data.type,
    isHidden: data.isHidden,
    categories: Array.from(data.categories),
  }));
}

/**
 * Extract categories with their monthly budget assignments from plan rows
 */
export function extractCategories(rows: YnabPlanRow[], currencyCode = 'USD'): ParsedCategory[] {
  // Map of "groupName:categoryName" -> ParsedCategory
  const categoryMap = new Map<string, ParsedCategory>();

  for (const row of rows) {
    const groupName = row.categoryGroup.trim();
    const categoryName = row.category.trim();

    if (!groupName || !categoryName) {
      continue;
    }

    // Skip "Inflow" group (Ready to Assign)
    if (groupName.toLowerCase() === 'inflow') {
      continue;
    }

    const key = `${groupName}:${categoryName}`;
    const isArchived = groupName.toLowerCase().includes('hidden');

    let category = categoryMap.get(key);

    if (!category) {
      category = {
        name: categoryName,
        groupName,
        isArchived,
        monthlyAssignments: {},
      };
      categoryMap.set(key, category);
    }

    // Parse and add the monthly assignment
    const yearMonth = parseYnabMonth(row.month);
    const assignedAmount = parseCurrencyToBaseUnits(row.assigned, currencyCode);

    // Only record non-zero assignments
    if (assignedAmount !== 0) {
      category.monthlyAssignments[yearMonth] = assignedAmount;
    }
  }

  return Array.from(categoryMap.values());
}

/**
 * Extract unique payee names (excluding transfers/system payees) for merchant creation
 */
export function extractMerchantNames(transactions: GroupedTransaction[]): string[] {
  const payeeNames = new Set<string>();

  for (const txn of transactions) {
    // Skip transfers - they don't have real merchants
    if (txn.isTransfer) {
      continue;
    }

    // Skip empty payees
    if (!txn.payee.trim()) {
      continue;
    }

    // Skip system transaction payees - these are transaction types, not merchants
    if (getSystemTransactionTypeFromYnabPayee(txn.payee) !== null) {
      continue;
    }

    payeeNames.add(txn.payee.trim());
  }

  return Array.from(payeeNames).sort();
}
