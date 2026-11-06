import { validate } from 'convex-helpers/validators';
import type { Validator } from 'convex/values';
import { CURRENCY_INFO } from '../../packages/shared/src/currency/currency-info';
import { getCurrencyDecimals } from '../../packages/shared/src/currency/currency-conversion';
import type { Doc } from '../_generated/dataModel';
import type { ArchiveFile } from '../dataExports/archive';
import { parseDecimalToBigIntMinorUnits } from '../lib/serialization';
import { applyMerchantTransactionStats } from '../merchants/update';
import schema from '../schema';
import { SORT_ORDER_GAP } from '../categoryGroups/helpers';
import { readExportTables } from './csv';

type Draft<T extends 'bankAccount' | 'category' | 'categoryGroup' | 'merchant'> = Omit<
  Doc<T>,
  '_id' | '_creationTime' | 'workspaceId'
>;
type Category = Omit<Draft<'category'>, 'categoryGroupId' | 'bankAccountId'> & {
  groupKey: string;
  accountKey: string;
  assignments: Record<string, bigint>;
  snoozed: Record<string, boolean>;
};
type TransactionRow = ReturnType<typeof readExportTables>['transactions'][number];

function field<T, O extends 'optional' | 'required'>(validator: Validator<T, O>, value: string, label: string) {
  const input = value === '' && validator.isOptional === 'optional' ? undefined : value;
  if (!validate(validator, input)) throw new Error(`Invalid ${label}.`);
  return input;
}
function flag(value: string) {
  if (value !== 'true' && value !== 'false') throw new Error('Expected a true or false value.');
  return value === 'true';
}
function integer(value: string) {
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Invalid whole number.');
  return Number(value);
}
function creationTime(iso: string) {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) throw new Error('Invalid creation timestamp.');
  return timestamp;
}

function unescapeText(value: string) {
  return value.replace(/^'(?=[\t\r ]*[=+\-@])/, '');
}
export function referenced<T>(map: Map<string, T>, key: string, kind: string): T {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Missing ${kind}. Select all four files from the same export.`);
  return value;
}
function unique<T>(map: Map<string, T>, key: string, value: T, kind: string) {
  if (!key || map.has(key)) throw new Error(`Missing or duplicate ${kind} ID.`);
  map.set(key, value);
}

type Tables = ReturnType<typeof readExportTables>;
type MoneyParser = (value: string) => bigint;

function readAccounts(rows: Tables['accounts'], money: MoneyParser) {
  const accounts = new Map<string, Draft<'bankAccount'>>();
  for (const r of rows) {
    unique(
      accounts,
      r.bank_account_id,
      {
        name: unescapeText(r.name),
        importedCreatedAt: creationTime(r.created_at),
        accountType: field(schema.tables.bankAccount.validator.fields.accountType, r.account_type, 'account type'),
        currentBalance: money(r.current_balance),
        pendingBalance: r.pending_balance ? money(r.pending_balance) : undefined,
        clearedBalance: r.cleared_balance ? money(r.cleared_balance) : undefined,
        monthlyBalances: {},
        isClosed: flag(r.is_closed),
        closedAt: r.closed_at || undefined,
        lastReconciledAt: r.last_reconciled_at || undefined,
        notes: unescapeText(r.notes) || undefined,
        updatedAt: r.updated_at || undefined,
        isDeleted: false,
      },
      'account'
    );
  }
  return accounts;
}

function readCategories(rows: Tables['categories'], accounts: Map<string, Draft<'bankAccount'>>, money: MoneyParser) {
  const groups = new Map<string, Draft<'categoryGroup'>>();
  const categories = new Map<string, Category>();
  const creditCategories = new Map<string, string>();
  const catFields = schema.tables.category.validator.fields;
  for (const r of rows) {
    if (!r.category_group_id) throw new Error('A category has no group ID.');
    const groupName = unescapeText(r.category_group_name) || 'Imported categories';
    let group = groups.get(r.category_group_id);
    if (!group) {
      group = { name: groupName, type: 'expense', sortOrder: groups.size * SORT_ORDER_GAP, isDeleted: false };
      groups.set(r.category_group_id, group);
    }
    if (group.name !== groupName) throw new Error('Conflicting category group names.');
    if (r.bank_account_id) referenced(accounts, r.bank_account_id, 'category bank account');
    if (
      r.category_type === 'credit_card' ||
      (r.bank_account_id && accounts.get(r.bank_account_id)?.accountType.startsWith('credit_'))
    ) {
      group.type = 'credit_card';
      if (r.bank_account_id) creditCategories.set(r.bank_account_id, r.category_id);
    }
    if (group.type === 'credit_card') group.isSystemGroup = true;
    unique(
      categories,
      r.category_id,
      {
        name: unescapeText(r.name),
        importedCreatedAt: creationTime(r.created_at),
        groupKey: r.category_group_id,
        accountKey: r.bank_account_id,
        sortOrder: integer(r.sort_order),
        iconName: r.icon_name || undefined,
        isDeleted: false,
        isArchived: flag(r.is_archived),
        isSystemCategory: flag(r.is_system_category),
        categoryType: field(catFields.categoryType, r.category_type, 'category type'),
        enableTarget: flag(r.target_enabled),
        target_type: field(catFields.target_type, r.target_type, 'target type'),
        target_frequency: field(catFields.target_frequency, r.target_frequency, 'target frequency'),
        target_amount: r.target_amount ? money(r.target_amount) : undefined,
        target_frequencyInterval: r.target_frequency_interval ? integer(r.target_frequency_interval) : undefined,
        target_dayOfWeek: r.target_day_of_week ? integer(r.target_day_of_week) : undefined,
        target_dueDay: r.target_due_day ? integer(r.target_due_day) : undefined,
        target_firstDueDate: r.target_first_due_date || undefined,
        target_targetDate: r.target_date || undefined,
        target_monthlyContribution: r.target_monthly_contribution ? money(r.target_monthly_contribution) : undefined,
        target_targetBalance: r.target_balance ? money(r.target_balance) : undefined,
        updatedAt: r.updated_at || undefined,
        monthlySpending: {},
        assignments: {},
        snoozed: {},
        transactionCount: 0n,
      },
      'category'
    );
  }

  return { groups, categories, creditCategories };
}

function readPlan(
  rows: Tables['plan'],
  categories: Map<string, Category>,
  groups: Map<string, Draft<'categoryGroup'>>,
  money: MoneyParser
) {
  let assigned = 0n;
  for (const r of rows) {
    const cat = referenced(categories, r.category_id, 'plan category');
    const month = r.year_month;
    if (!/^\d{4}(0[1-9]|1[012])$/.test(month) || month in cat.assignments || r.category_group_id !== cat.groupKey) {
      throw new Error('Invalid or duplicate category month in plan.csv.');
    }
    cat.assignments[month] = money(r.assigned);
    assigned += cat.assignments[month];
    if (flag(r.target_snoozed)) cat.snoozed[month] = true;
    const inflowAmount = money(r.inflow_activity),
      outflowAmount = money(r.outflow_activity);
    if (inflowAmount - outflowAmount !== money(r.net_activity)) throw new Error('Inconsistent plan activity.');
    cat.monthlySpending ??= {};
    cat.monthlySpending[month] = { inflowAmount, outflowAmount };
    const credit = {
      priorBalance: money(r.credit_prior_balance),
      spendingAmount: money(r.credit_spending),
      paymentsAmount: money(r.credit_payments),
      refundedSpending: money(r.credit_refunded_spending),
    };
    if (groups.get(cat.groupKey)?.type === 'credit_card' || Object.values(credit).some((n) => n !== 0n)) {
      cat.creditMonthlySpending ??= {};
      cat.creditMonthlySpending[month] = credit;
    }
  }

  return assigned;
}

function readTransactions(
  rowsFromFile: Tables['transactions'],
  accounts: Map<string, Draft<'bankAccount'>>,
  categories: Map<string, Category>,
  money: MoneyParser
) {
  const merchants = new Map<string, Draft<'merchant'>>();
  const monthlyIncomeActivity: NonNullable<Doc<'workspace'>['monthlyIncomeActivity']> = {};
  let income = 0n;
  const pendingByAccount = new Map<string, bigint>();
  const grouped = new Map<string, TransactionRow[]>();
  for (const r of rowsFromFile) {
    if (!r.transaction_id) throw new Error('Missing transaction ID.');
    const rows = grouped.get(r.transaction_id) ?? [];
    rows.push(r);
    grouped.set(r.transaction_id, rows);
  }
  const txnFields = schema.tables.transaction.validator.fields;
  const transactions = Array.from(grouped, ([key, rows]) => {
    rows.sort((a, b) => integer(a.movement_index) - integer(b.movement_index));
    const first = rows[0];
    const account = referenced(accounts, first.bank_account_id, 'transaction account');
    if (first.transfer_bank_account_id) referenced(accounts, first.transfer_bank_account_id, 'transfer account');
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(first.date) ||
      !Number.isFinite(Date.parse(first.date)) ||
      new Date(first.date).toISOString().slice(0, 10) !== first.date
    )
      throw new Error('Invalid transaction date.');
    const month = first.date.slice(0, 7).replace('-', '');
    const totalAmount = money(first.transaction_total);
    const type = field(txnFields.type, first.transaction_type, 'transaction type');
    const categoryKeys = new Set<string>();
    const split = rows.length > 1;
    const movements = rows.flatMap((r, index) => {
      if (
        integer(r.movement_count) !== rows.length ||
        integer(r.movement_index) !== index + 1 ||
        flag(r.is_split) !== split ||
        transactionColumns.some((column) => r[column] !== first[column])
      )
        throw new Error('Incomplete or inconsistent transaction split in transactions.csv.');
      if (!r.movement_amount && rows.length === 1) return [];
      const amount = money(r.movement_amount);
      if (r.category_id) {
        categoryKeys.add(r.category_id);
      }
      const readyToAssignMovement = !r.category_id && r.category_name === 'Ready to Assign';
      if (readyToAssignMovement && account.accountType.startsWith('banking_')) {
        income += amount;
        if (type !== 'starting_balance' && type !== 'balance_adjustment') {
          const activity = (monthlyIncomeActivity[month] ??= { inflowAmount: 0n, outflowAmount: 0n });
          if (amount > 0n) activity.inflowAmount += amount;
          else activity.outflowAmount -= amount;
        }
      }
      return [
        {
          categoryKey: r.category_id,
          categoryName: unescapeText(r.category_name) || undefined,
          readyToAssign: readyToAssignMovement,
          amount,
          sortOrder: index,
          notes: unescapeText(r.movement_notes) || undefined,
        },
      ];
    });
    if (movements.length && movements.reduce((sum, m) => sum + m.amount, 0n) !== totalAmount)
      throw new Error('Transaction total does not match its movements.');
    for (const categoryKey of categoryKeys) {
      const category = referenced(categories, categoryKey, 'transaction category');
      category.transactionCount = (category.transactionCount ?? 0n) + 1n;
    }
    if (first.status === 'pending') {
      pendingByAccount.set(first.bank_account_id, (pendingByAccount.get(first.bank_account_id) ?? 0n) + totalAmount);
    }
    account.monthlyBalances ??= {};
    account.monthlyBalances[month] = (account.monthlyBalances[month] ?? 0n) + totalAmount;
    const merchantName = unescapeText(first.merchant_name);
    const merchantKey = first.merchant_id ? 'id/' + first.merchant_id : merchantName ? 'name/' + merchantName : '';
    if (merchantKey) {
      const merchant = merchants.get(merchantKey) ?? {
        name: merchantName || 'Unknown merchant',
        isDeleted: false,
        updatedAt: new Date().toISOString(),
      };
      merchant.monthlyStats ??= {};
      merchant.monthlyDirectionalStats ??= {};
      const { stats, directionalStats } = applyMerchantTransactionStats(
        merchant.monthlyStats[month] ?? { transactionCount: 0n, totalAmount: 0n },
        merchant.monthlyDirectionalStats[month] ?? {
          inflowAmount: 0n,
          outflowAmount: 0n,
          inflowCount: 0n,
          outflowCount: 0n,
        },
        totalAmount,
        1n
      );
      merchant.monthlyStats[month] = stats;
      merchant.monthlyDirectionalStats[month] = directionalStats;
      merchants.set(merchantKey, merchant);
    }
    return {
      key,
      accountKey: first.bank_account_id,
      transferKey: first.transfer_pair_transaction_id,
      transferAccountKey: first.transfer_bank_account_id,
      type,
      date: first.date,
      importedCreatedAt: creationTime(first.created_at),
      dateYearMonth: Number(month),
      status: field(txnFields.status, first.status, 'transaction status'),
      reviewStatus: field(txnFields.reviewStatus, first.review_status, 'transaction review status'),
      source: field(txnFields.source, first.source, 'transaction source'),
      notes: unescapeText(first.transaction_notes) || undefined,
      updatedAt: first.updated_at || undefined,
      merchantKey,
      merchantName,
      totalAmount,
      movements,
    };
  });
  const byKey = new Map(transactions.map((t) => [t.key, t]));
  for (const t of transactions) {
    if (!t.transferKey) continue;
    const pair = referenced(byKey, t.transferKey, 'paired transfer transaction');
    if (
      t.type !== 'transfer' ||
      t.key === pair.key ||
      pair.transferKey !== t.key ||
      (t.transferAccountKey && pair.accountKey !== t.transferAccountKey)
    )
      throw new Error('Inconsistent transfer pair in transactions.csv.');
    t.transferAccountKey = pair.accountKey;
  }
  // Legacy exports can omit one or both balance components. Keep the exported
  // current balance authoritative and derive only the missing component(s).
  for (const [key, account] of accounts) {
    account.pendingBalance ??=
      account.clearedBalance === undefined
        ? (pendingByAccount.get(key) ?? 0n)
        : account.currentBalance - account.clearedBalance;
    account.clearedBalance ??= account.currentBalance - account.pendingBalance;
  }
  return { transactions, merchants, income, monthlyIncomeActivity };
}

export function prepareImport(files: ArchiveFile[], currency: string) {
  if (!/^[A-Z]{3}$/.test(currency) || !CURRENCY_INFO[currency])
    throw new Error('Choose a supported workspace currency.');
  const decimals = getCurrencyDecimals(currency);
  function money(value: string) {
    const amount = parseDecimalToBigIntMinorUnits(value, decimals);
    if (BigInt.asIntN(64, amount) !== amount) throw new Error('Amount exceeds the supported currency range.');
    return amount;
  }

  const tables = readExportTables(files);
  const accounts = readAccounts(tables.accounts, money);
  const { groups, categories, creditCategories } = readCategories(tables.categories, accounts, money);
  const assigned = readPlan(tables.plan, categories, groups, money);
  const { transactions, merchants, income, monthlyIncomeActivity } = readTransactions(
    tables.transactions,
    accounts,
    categories,
    money
  );
  const readyToAssign = income - assigned;
  if (BigInt.asIntN(64, readyToAssign) !== readyToAssign)
    throw new Error('Ready to Assign exceeds the supported currency range.');
  return {
    accounts,
    categories,
    groups,
    merchants,
    transactions,
    creditCategories,
    readyToAssign,
    monthlyIncomeActivity,
  };
}

const transactionColumns = [
  'date',
  'bank_account_id',
  'merchant_id',
  'merchant_name',
  'transaction_type',
  'status',
  'review_status',
  'source',
  'transaction_notes',
  'transaction_total',
  'transfer_pair_transaction_id',
  'transfer_bank_account_id',
  'scheduled_transaction_id',
] as const;
