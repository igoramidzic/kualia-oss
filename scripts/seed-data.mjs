// Pure generator for the synthetic local demo budget used by `pnpm seed`.
// It emits the four CSV files of a Kualia workspace export so the seed goes
// through the same validated import path (`kualiaImport.restore`) as a user's
// own backup: bigint money parsing, ISO timestamps, workspace scoping,
// category/merchant/account aggregates, and activity logs.
// All names, amounts, and credentials are fictional.
import { EXPORT_COLUMNS } from '../convex/dataExports/columns.ts';
import { formatBigIntAsDecimal } from '../convex/lib/serialization.ts';

export const DEMO_EMAIL = 'demo@example.test';
export const DEMO_PASSWORD = 'kualia-demo-budget';
export const DEMO_WORKSPACE_NAME = 'Demo Budget';
export const DEMO_CURRENCY = 'USD';
const MINOR_UNITS = 2;
const SORT_ORDER_GAP = 1000;

const ACCOUNTS = [
  { id: 'demo-acct-checking', name: 'Everyday Checking', type: 'banking_checking', opening: 245000n },
  { id: 'demo-acct-savings', name: 'High-Yield Savings', type: 'banking_savings', opening: 820000n },
  { id: 'demo-acct-card', name: 'Rewards Visa', type: 'credit_credit_card', opening: 0n },
];
const CHECKING = 'demo-acct-checking';
const SAVINGS = 'demo-acct-savings';
const CARD = 'demo-acct-card';

const recurring = (amount, dueDay) => ({ type: 'recurring', amount, frequency: 'monthly', interval: 1, dueDay });
const GROUPS = [
  {
    id: 'demo-group-bills',
    name: 'Bills',
    categories: [
      { id: 'demo-cat-rent', name: 'Rent', icon: 'House', assign: 165000n, target: recurring(165000n, 1) },
      { id: 'demo-cat-utilities', name: 'Utilities', icon: 'Bolt', assign: 14000n, target: recurring(14000n, 5) },
      { id: 'demo-cat-phone', name: 'Phone & Internet', icon: 'Phone', assign: 9500n, target: recurring(9500n, 8) },
      {
        id: 'demo-cat-subscriptions',
        name: 'Subscriptions',
        icon: 'Subscription',
        assign: 2598n,
        target: recurring(2598n, 3),
      },
    ],
  },
  {
    id: 'demo-group-everyday',
    name: 'Everyday',
    categories: [
      {
        id: 'demo-cat-groceries',
        name: 'Groceries',
        icon: 'Shop',
        assign: 65000n,
        target: { type: 'recurring', amount: 15000n, frequency: 'weekly', interval: 1, dayOfWeek: 6 },
      },
      { id: 'demo-cat-dining', name: 'Dining Out', icon: 'Party', assign: 22000n, target: recurring(22000n) },
      { id: 'demo-cat-transport', name: 'Transportation', icon: 'Car', assign: 18000n, target: recurring(18000n) },
      { id: 'demo-cat-household', name: 'Household', icon: 'Home', assign: 12000n },
    ],
  },
  {
    id: 'demo-group-goals',
    name: 'Savings Goals',
    categories: [
      {
        id: 'demo-cat-emergency',
        name: 'Emergency Fund',
        icon: 'PiggyBank',
        assign: 50000n,
        openingAssign: 1000000n,
        target: { type: 'maintain_balance', amount: 1500000n, monthlyContribution: 50000n, targetBalance: 1500000n },
      },
      {
        id: 'demo-cat-vacation',
        name: 'Vacation',
        icon: 'Plane',
        assign: 30000n,
        target: { type: 'one_time', amount: 240000n, targetDateMonthsAhead: 8 },
      },
      {
        id: 'demo-cat-gifts',
        name: 'Gifts',
        icon: 'Heart',
        assign: 5000n,
        target: { type: 'recurring', amount: 60000n, frequency: 'yearly', interval: 1, dueMonthDay: '12-15' },
      },
    ],
  },
];
const CARD_GROUP = { id: 'demo-group-credit', name: 'Credit Card', category: 'demo-cat-card' };

const MERCHANTS = {
  payroll: 'Northwind Payroll',
  rent: 'Maple Court Apartments',
  utilities: 'City Power & Water',
  phone: 'Brightline Mobile',
  streaming: 'Streamly',
  music: 'Tunebox',
  grocer: 'Green Basket Market',
  bistro: 'Corner Bistro',
  noodles: 'Noodle House',
  fuel: 'Fuel Stop',
  transit: 'Metro Transit',
  bigBox: 'Everything Mart',
};

/** Small deterministic PRNG so the same `today` always yields the same budget. */
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Whole cents in [min, max]. */
const cents = (random, min, max) => BigInt(min + Math.floor(random() * (max - min + 1)));

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;
const yearMonthKey = (date) => date.slice(0, 7).replace('-', '');
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function addMonths(year, month, delta) {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}
function assertIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`Expected a YYYY-MM-DD date, received ${value}.`);
  }
}
export function localIsoDate(now = new Date()) {
  return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

const allCategories = () => GROUPS.flatMap((group) => group.categories.map((category) => ({ ...category, group })));

/**
 * Builds the demo budget as plain records plus the export CSV files.
 * @param {{ today?: string, months?: number }} [options] `today` is the local calendar date (YYYY-MM-DD).
 */
export function buildDemoBudget({ today = localIsoDate(), months = 4 } = {}) {
  assertIsoDate(today);
  if (!Number.isInteger(months) || months < 1 || months > 24) throw new Error('months must be between 1 and 24.');
  const [todayYear, todayMonth] = today.split('-').map(Number);
  const first = addMonths(todayYear, todayMonth, -(months - 1));
  const startDate = isoDate(first.year, first.month, 1);
  const pendingFrom = new Date(Date.parse(`${today}T00:00:00Z`) - 2 * 86400000).toISOString().slice(0, 10);
  const monthList = Array.from({ length: months }, (_, i) => addMonths(first.year, first.month, i));

  const transactions = [];
  let sequence = 0;
  function add(date, account, { merchant, type = 'regular', notes, movements, transfer }) {
    if (date > today || date < startDate) return null;
    sequence += 1;
    const id = `demo-txn-${String(sequence).padStart(4, '0')}`;
    const status = date >= pendingFrom && type === 'regular' ? 'pending' : 'cleared';
    const transaction = {
      id,
      date,
      account,
      merchant,
      type,
      status,
      reviewStatus: status === 'pending' ? 'needs_review' : 'reviewed',
      notes,
      movements,
      transfer,
      createdAt: new Date(Date.parse(`${date}T12:00:00Z`) + sequence * 1000).toISOString(),
    };
    transactions.push(transaction);
    return transaction;
  }
  const spend = (date, account, merchant, categoryId, amount, notes) =>
    add(date, account, { merchant, notes, movements: [{ categoryId, amount: -amount }] });
  function transfer(date, from, to, amount, notes) {
    if (date > today) return;
    const out = add(date, from, { type: 'transfer', notes, movements: [{ amount: -amount }] });
    const into = add(date, to, { type: 'transfer', notes, movements: [{ amount }] });
    out.transfer = { pair: into.id, account: to };
    into.transfer = { pair: out.id, account: from };
  }

  for (const account of ACCOUNTS) {
    if (account.opening === 0n) continue;
    add(startDate, account.id, {
      type: 'starting_balance',
      movements: [{ readyToAssign: true, amount: account.opening }],
    });
  }

  monthList.forEach(({ year, month }, index) => {
    const random = rng(0x6b75616c + index * 7919);
    const day = (d) => isoDate(year, month, Math.min(d, daysInMonth(year, month)));
    const paycheck = 245000n;
    for (const d of [1, 15]) {
      add(day(d), CHECKING, {
        merchant: MERCHANTS.payroll,
        notes: 'Synthetic paycheck',
        movements: [{ readyToAssign: true, amount: paycheck }],
      });
    }
    spend(day(1), CHECKING, MERCHANTS.rent, 'demo-cat-rent', 165000n);
    spend(day(5), CHECKING, MERCHANTS.utilities, 'demo-cat-utilities', cents(random, 9800, 15800));
    spend(day(8), CARD, MERCHANTS.phone, 'demo-cat-phone', 9500n);
    spend(day(3), CARD, MERCHANTS.streaming, 'demo-cat-subscriptions', 1599n);
    spend(day(4), CARD, MERCHANTS.music, 'demo-cat-subscriptions', 999n);
    for (const d of [4, 11, 18, 25]) spend(day(d), CARD, MERCHANTS.grocer, 'demo-cat-groceries', cents(random, 6400, 15200));
    spend(day(6), CARD, MERCHANTS.bistro, 'demo-cat-dining', cents(random, 2800, 6400));
    spend(day(13), CARD, MERCHANTS.noodles, 'demo-cat-dining', cents(random, 1800, 3600));
    spend(day(21), CARD, MERCHANTS.bistro, 'demo-cat-dining', cents(random, 3200, 7800), 'Dinner with friends');
    spend(day(9), CARD, MERCHANTS.fuel, 'demo-cat-transport', cents(random, 4200, 6100));
    spend(day(20), CHECKING, MERCHANTS.transit, 'demo-cat-transport', 8500n, 'Monthly transit pass');
    // Split: one big-box receipt across groceries and household supplies.
    const groceries = cents(random, 4200, 9800);
    const household = cents(random, 2100, 6400);
    add(day(12), CARD, {
      merchant: MERCHANTS.bigBox,
      notes: 'Split receipt',
      movements: [
        { categoryId: 'demo-cat-groceries', amount: -groceries, notes: 'Pantry restock' },
        { categoryId: 'demo-cat-household', amount: -household, notes: 'Cleaning supplies' },
      ],
    });
    if (index === 1) {
      add(day(14), CARD, {
        merchant: MERCHANTS.bigBox,
        notes: 'Returned an unused lamp',
        movements: [{ categoryId: 'demo-cat-household', amount: 1999n }],
      });
    }
    transfer(day(16), CHECKING, SAVINGS, 30000n, 'Monthly savings transfer');
  });

  // Pay the card each month (on the 27th) for the previous month's activity.
  for (let i = 1; i < monthList.length; i += 1) {
    const prev = monthList[i - 1];
    const prevKey = `${prev.year}${pad(prev.month)}`;
    const owed = -transactions
      .filter((t) => t.account === CARD && t.type === 'regular' && yearMonthKey(t.date) === prevKey)
      .reduce((sum, t) => sum + t.movements.reduce((s, m) => s + m.amount, 0n), 0n);
    const { year, month } = monthList[i];
    if (owed > 0n) transfer(isoDate(year, month, 27), CHECKING, CARD, owed, 'Card payment');
  }

  return finalize({ transactions, monthList, startDate, today });
}

function finalize({ transactions, monthList, startDate, today }) {
  const monthKeys = monthList.map(({ year, month }) => `${year}${pad(month)}`);
  const accountName = new Map(ACCOUNTS.map((a) => [a.id, a.name]));
  const categories = allCategories();
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const createdAt = `${startDate}T09:00:00.000Z`;
  const [y, m] = today.split('-').map(Number);

  // Balances.
  const balances = new Map(ACCOUNTS.map((a) => [a.id, { current: 0n, pending: 0n }]));
  for (const t of transactions) {
    const total = t.movements.reduce((sum, mv) => sum + mv.amount, 0n);
    t.total = total;
    const balance = balances.get(t.account);
    balance.current += total;
    if (t.status === 'pending') balance.pending += total;
  }

  // Plan activity mirrors the category/credit validators in convex/validation/validators.
  const activity = new Map();
  const credit = new Map(monthKeys.map((k) => [k, { spending: 0n, payments: 0n, refunded: 0n }]));
  let income = 0n;
  for (const t of transactions) {
    const key = yearMonthKey(t.date);
    for (const mv of t.movements) {
      if (mv.readyToAssign) income += mv.amount;
      if (!mv.categoryId || t.type === 'starting_balance') continue;
      const id = `${mv.categoryId}/${key}`;
      const entry = activity.get(id) ?? { inflow: 0n, outflow: 0n };
      if (mv.amount > 0n) entry.inflow += mv.amount;
      else entry.outflow -= mv.amount;
      activity.set(id, entry);
      if (t.account === CARD && t.type === 'regular') {
        const month = credit.get(key);
        if (mv.amount > 0n) month.refunded += mv.amount;
        else month.spending -= mv.amount;
      }
    }
    if (t.account === CARD && t.type === 'transfer' && t.total > 0n) credit.get(key).payments += t.total;
  }

  const assignments = new Map();
  let assigned = 0n;
  for (const c of categories) {
    monthKeys.forEach((key, index) => {
      const amount = c.assign + (index === 0 ? (c.openingAssign ?? 0n) : 0n);
      assignments.set(`${c.id}/${key}`, amount);
      assigned += amount;
    });
  }

  const money = (value) => (value === undefined ? '' : formatBigIntAsDecimal(value, MINOR_UNITS));
  const targetColumns = (target) => {
    if (!target) return { target_enabled: 'false' };
    const targetDate = target.targetDateMonthsAhead
      ? (() => {
          const due = addMonths(y, m, target.targetDateMonthsAhead);
          return isoDate(due.year, due.month, 1);
        })()
      : '';
    const firstDue = target.dueMonthDay
      ? `${y}-${target.dueMonthDay}`
      : target.dueDay
        ? isoDate(Number(startDate.slice(0, 4)), Number(startDate.slice(5, 7)), target.dueDay)
        : '';
    return {
      target_enabled: 'true',
      target_type: target.type,
      target_amount: money(target.amount),
      target_frequency: target.frequency ?? '',
      target_frequency_interval: target.interval === undefined ? '' : String(target.interval),
      target_day_of_week: target.dayOfWeek === undefined ? '' : String(target.dayOfWeek),
      target_due_day: target.dueDay === undefined ? '' : String(target.dueDay),
      target_first_due_date: firstDue,
      target_date: targetDate,
      target_monthly_contribution: money(target.monthlyContribution),
      target_balance: money(target.targetBalance),
    };
  };

  const categoryRows = [
    ...GROUPS.flatMap((group) =>
      group.categories.map((c, index) => ({
        category_id: c.id,
        name: c.name,
        category_group_id: group.id,
        category_group_name: group.name,
        sort_order: String(index * SORT_ORDER_GAP),
        icon_name: c.icon,
        is_system_category: 'false',
        is_archived: 'false',
        category_type: 'custom',
        ...targetColumns(c.target),
        created_at: createdAt,
        updated_at: createdAt,
      }))
    ),
    {
      category_id: CARD_GROUP.category,
      name: accountName.get(CARD),
      category_group_id: CARD_GROUP.id,
      category_group_name: CARD_GROUP.name,
      sort_order: '0',
      icon_name: 'CreditCard',
      is_system_category: 'true',
      is_archived: 'false',
      category_type: 'credit_card',
      bank_account_id: CARD,
      target_enabled: 'false',
      created_at: createdAt,
      updated_at: createdAt,
    },
  ];

  const planRows = monthKeys.flatMap((key) => [
    ...categories.map((c) => {
      const a = activity.get(`${c.id}/${key}`) ?? { inflow: 0n, outflow: 0n };
      return {
        year_month: key,
        category_group_id: c.group.id,
        category_group_name: c.group.name,
        category_id: c.id,
        category_name: c.name,
        category_archived: 'false',
        assigned: money(assignments.get(`${c.id}/${key}`)),
        inflow_activity: money(a.inflow),
        outflow_activity: money(a.outflow),
        net_activity: money(a.inflow - a.outflow),
        target_snoozed: 'false',
        credit_prior_balance: money(0n),
        credit_spending: money(0n),
        credit_payments: money(0n),
        credit_refunded_spending: money(0n),
      };
    }),
    {
      year_month: key,
      category_group_id: CARD_GROUP.id,
      category_group_name: CARD_GROUP.name,
      category_id: CARD_GROUP.category,
      category_name: accountName.get(CARD),
      category_archived: 'false',
      assigned: money(0n),
      inflow_activity: money(0n),
      outflow_activity: money(0n),
      net_activity: money(0n),
      target_snoozed: 'false',
      credit_prior_balance: money(0n),
      credit_spending: money(credit.get(key).spending),
      credit_payments: money(credit.get(key).payments),
      credit_refunded_spending: money(credit.get(key).refunded),
    },
  ]);

  const accountRows = ACCOUNTS.map((a) => {
    const balance = balances.get(a.id);
    return {
      bank_account_id: a.id,
      name: a.name,
      account_type: a.type,
      current_balance: money(balance.current),
      pending_balance: money(balance.pending),
      cleared_balance: money(balance.current - balance.pending),
      is_closed: 'false',
      notes: 'Synthetic demo account',
      created_at: createdAt,
      updated_at: createdAt,
    };
  });

  const merchantIds = new Map(Object.values(MERCHANTS).map((name, i) => [name, `demo-merchant-${i + 1}`]));
  const transactionRows = transactions.flatMap((t) =>
    t.movements.map((mv, index) => {
      const category = mv.categoryId ? categoryById.get(mv.categoryId) : undefined;
      return {
        transaction_id: t.id,
        movement_index: String(index + 1),
        movement_count: String(t.movements.length),
        is_split: String(t.movements.length > 1),
        date: t.date,
        bank_account_id: t.account,
        bank_account_name: accountName.get(t.account),
        merchant_id: t.merchant ? merchantIds.get(t.merchant) : '',
        merchant_name: t.merchant ?? '',
        transaction_type: t.type,
        status: t.status,
        review_status: t.reviewStatus,
        source: 'manual',
        transaction_notes: t.notes ?? '',
        transaction_total: money(t.total),
        movement_amount: money(mv.amount),
        category_group_id: category?.group.id ?? '',
        category_group_name: category?.group.name ?? '',
        category_id: mv.categoryId ?? '',
        category_name: mv.readyToAssign ? 'Ready to Assign' : (category?.name ?? ''),
        movement_notes: mv.notes ?? '',
        transfer_pair_transaction_id: t.transfer?.pair ?? '',
        transfer_bank_account_id: t.transfer?.account ?? '',
        transfer_bank_account_name: t.transfer ? accountName.get(t.transfer.account) : '',
        scheduled_transaction_id: '',
        created_at: t.createdAt,
        updated_at: t.createdAt,
      };
    })
  );

  const files = [
    { name: 'categories.csv', content: toCsv('categories.csv', categoryRows) },
    { name: 'plan.csv', content: toCsv('plan.csv', planRows) },
    { name: 'bank-accounts.csv', content: toCsv('bank-accounts.csv', accountRows) },
    { name: 'transactions.csv', content: toCsv('transactions.csv', transactionRows) },
  ];
  return {
    files,
    summary: {
      startDate,
      today,
      months: monthKeys,
      accounts: ACCOUNTS.map((a) => ({ id: a.id, name: a.name, type: a.type, balance: balances.get(a.id).current })),
      categoryCount: categoryRows.length,
      transactionCount: transactions.length,
      splitCount: transactions.filter((t) => t.movements.length > 1).length,
      transferCount: transactions.filter((t) => t.type === 'transfer').length / 2,
      income,
      assigned,
      readyToAssign: income - assigned,
    },
    transactions,
  };
}

function escapeCell(value) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
/** Serializes rows in the export's column order (missing columns are blank), matching dataExports/format.ts. */
export function toCsv(name, rows) {
  const columns = EXPORT_COLUMNS[name];
  if (!columns) throw new Error(`Unknown export file ${name}.`);
  for (const row of rows) {
    const unknown = Object.keys(row).filter((key) => !columns.includes(key));
    if (unknown.length) throw new Error(`${name} has unknown columns: ${unknown.join(', ')}`);
  }
  const lines = [columns.join(','), ...rows.map((row) => columns.map((c) => escapeCell(row[c] ?? '')).join(','))];
  return `﻿${lines.join('\r\n')}\r\n`;
}
