import { getCurrencyDecimals } from '../../packages/shared/src/currency/currency-conversion';
import type { Doc } from '../_generated/dataModel';
import { addDays } from '../lib/dates';
import { appendLogoDevToken } from '../lib/logoUtils';
import { isValidIsoDate, nextOccurrence } from '../scheduledTransactions/recurrence';
import { getScheduledTransactionType } from '../scheduledTransactions/types';
import type { HomeDashboard, HomeForecastAccount, HomeOccurrence } from './types';

export const HOME_LIMITS = { accounts: 200, schedules: 500, attention: 500, spending: 2_000, display: 30 } as const;
const forecastTypes = new Set([
  'banking_checking',
  'banking_savings',
  'banking_cash_management',
  'banking_money_market',
  'banking_other',
]);

export function buildHomeDashboard(input: {
  workspace: Doc<'workspace'>;
  today: string;
  accounts: Doc<'bankAccount'>[];
  schedules: Doc<'scheduledTransaction'>[];
  reviews: Doc<'transaction'>[];
  uncategorized: Doc<'transaction'>[];
  recent: Doc<'transaction'>[];
  merchants: Doc<'merchant'>[];
}): HomeDashboard {
  const { workspace, today } = input;
  const throughDate = addDays(today, 7);
  const belongs = (row: { workspaceId: unknown; isDeleted?: boolean }) =>
    row.workspaceId === workspace._id && !row.isDeleted;
  const allAccounts = input.accounts.slice(0, HOME_LIMITS.accounts).filter(belongs);
  const accounts = new Map(allAccounts.filter((a) => !a.isClosed).map((a) => [a._id, a]));
  const merchants = new Map(input.merchants.filter(belongs).map((m) => [m._id, m]));
  let isPartial = input.accounts.length > HOME_LIMITS.accounts || input.schedules.length > HOME_LIMITS.schedules;
  const occurrences: HomeOccurrence[] = [];
  let remainingSteps = 20_000;

  for (const schedule of input.schedules.slice(0, HOME_LIMITS.schedules)) {
    if (!belongs(schedule) || schedule.status !== 'active') continue;
    const account = accounts.get(schedule.bankAccountId);
    if (!account) continue;
    const isTransfer = getScheduledTransactionType(schedule) === 'transfer';
    const destination = schedule.transferToAccountId ? accounts.get(schedule.transferToAccountId) : undefined;
    if (isTransfer && (!destination || destination._id === account._id)) {
      isPartial = true;
      continue;
    }
    if (!isValidIsoDate(schedule.nextDate) || !isValidIsoDate(schedule.anchorDate)) {
      isPartial = true;
      continue;
    }
    const total = schedule.movements.reduce((sum, movement) => sum + movement.amount, 0n);
    const amount = isTransfer ? -(total < 0n ? -total : total) : total;
    const name = isTransfer
      ? `Transfer to ${destination?.name}`
      : ((schedule.merchantId ? merchants.get(schedule.merchantId)?.name : undefined) ??
        schedule.notes ??
        'Scheduled transaction');
    const append = (date: string, isOverdue: boolean) =>
      occurrences.push({
        id: `${schedule._id}:${date}`,
        scheduledTransactionId: schedule._id,
        logoUrl: !isTransfer && schedule.merchantId ? (merchants.get(schedule.merchantId)?.logoUrl ?? null) : null,
        name,
        accountId: account._id,
        accountName: account.name,
        transferToAccountId: destination?._id ?? null,
        transferToAccountName: destination?.name ?? null,
        date,
        day: Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000),
        amount: amount.toString(),
        isTransfer,
        isOverdue,
      });
    // nextDate advances atomically whenever an occurrence is entered or linked.
    // Only synthesize from that cursor: register transactions already affect currentBalance.
    let date: string | undefined = schedule.nextDate;
    let overdue: string | undefined;
    let steps = 0;
    while (date !== undefined && date <= throughDate && steps < 400 && remainingSteps > 0) {
      if (date < today) overdue = date;
      else append(date, false);
      date =
        schedule.recurrence === 'once' ? undefined : nextOccurrence(date, schedule.recurrence, schedule.anchorDate);
      steps++;
      remainingSteps--;
    }
    if (date !== undefined && date <= throughDate) isPartial = true;
    if (overdue) append(overdue, true);
  }

  const upcoming = occurrences
    .filter((o) => !o.isOverdue)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const overdue = occurrences.filter((o) => o.isOverdue).sort((a, b) => a.date.localeCompare(b.date));
  const forecasts: HomeForecastAccount[] = [];
  if (!isPartial) {
    for (const account of accounts.values()) {
      if (!forecastTypes.has(account.accountType)) continue;
      const relevant = upcoming.filter((o) => o.accountId === account._id || o.transferToAccountId === account._id);
      let balance = account.currentBalance;
      let lowestBalance = balance;
      let lowestDay = 0;
      const points = [{ day: -1, amount: balance.toString() }];
      for (let day = 0; day <= 7; day++) {
        const todays = relevant.filter((o) => o.day === day);
        const deltas = todays.map((o) => (o.accountId === account._id ? BigInt(o.amount) : -BigInt(o.amount)));
        // Payments have dates, not settlement times. Debit-first checks prevent an
        // expected same-day paycheck from silently hiding a possible shortfall.
        const intradayLow = balance + deltas.filter((amount) => amount < 0n).reduce((sum, amount) => sum + amount, 0n);
        if (intradayLow < lowestBalance) {
          lowestBalance = intradayLow;
          lowestDay = day;
        }
        balance += deltas.reduce((sum, amount) => sum + amount, 0n);
        points.push({ day, amount: balance.toString() });
      }
      forecasts.push({
        id: account._id,
        name: account.name,
        currentBalance: account.currentBalance.toString(),
        points,
        lowestDay,
        lowestBalance: lowestBalance.toString(),
        hasUpcoming: relevant.length > 0,
      });
    }
  }
  forecasts.sort((a, b) => {
    const left = BigInt(a.lowestBalance);
    const right = BigInt(b.lowestBalance);
    return left < right ? -1 : left > right ? 1 : a.name.localeCompare(b.name);
  });

  const group = (rows: Doc<'transaction'>[], kind: 'reviews' | 'uncategorized') => {
    const visible = rows
      .slice(0, HOME_LIMITS.attention)
      .filter((t) => belongs(t) && (kind === 'reviews' ? t.reviewStatus === 'needs_review' : t.hasUncategorized));
    return {
      count: visible.length,
      hasMore: rows.length > HOME_LIMITS.attention,
      items: visible.slice(0, HOME_LIMITS.display).map((t) => ({
        id: t._id,
        name:
          (t.merchantId ? merchants.get(t.merchantId)?.name : undefined) ??
          t.importDetails?.merchantName ??
          t.importDetails?.originalStatement ??
          t.notes ??
          (t.type === 'transfer' ? 'Transfer' : 'Transaction'),
        accountName: allAccounts.find((a) => a._id === t.bankAccountId)?.name ?? 'Account',
        date: t.date,
        amount: t.totalAmount.toString(),
      })),
    };
  };
  const currentStart = addDays(today, -7);
  const previousStart = addDays(today, -14);
  let current = 0n;
  let previous = 0n;
  for (const t of input.recent) {
    const account = allAccounts.find((a) => a._id === t.bankAccountId);
    if (
      !belongs(t) ||
      t.type !== 'regular' ||
      t.totalAmount >= 0n ||
      !account ||
      !(account.accountType.startsWith('banking_') || account.accountType.startsWith('credit_')) ||
      t.date < previousStart ||
      t.date >= today
    )
      continue;
    if (t.date >= currentStart) current -= t.totalAmount;
    else previous -= t.totalAmount;
  }
  const currencyCode = (workspace.currency ?? 'USD').toUpperCase();
  return {
    workspace: {
      id: workspace._id,
      name: workspace.name,
      currencyCode,
      minorUnit: getCurrencyDecimals(currencyCode),
      timezoneIdentifier: workspace.timezone ?? 'UTC',
    },
    today,
    throughDate,
    isPartial,
    reviews: group(input.reviews, 'reviews'),
    uncategorized: group(input.uncategorized, 'uncategorized'),
    accounts: forecasts,
    upcoming: upcoming.slice(0, HOME_LIMITS.display),
    upcomingCount: upcoming.length,
    overdue: overdue.slice(0, HOME_LIMITS.display),
    overdueCount: overdue.length,
    incoming: upcoming
      .filter((o) => !o.isTransfer && BigInt(o.amount) > 0n)
      .reduce((sum, o) => sum + BigInt(o.amount), 0n)
      .toString(),
    outgoing: upcoming
      .filter((o) => !o.isTransfer && BigInt(o.amount) < 0n)
      .reduce((sum, o) => sum - BigInt(o.amount), 0n)
      .toString(),
    spending:
      input.recent.length > HOME_LIMITS.spending ||
      input.accounts.length > HOME_LIMITS.accounts ||
      (current === 0n && previous === 0n)
        ? null
        : { current: current.toString(), previous: previous.toString(), currentStart, previousStart },
  };
}

export function resolveHomeMerchant(merchant: Doc<'merchant'>, global?: Doc<'globalMerchant'>): Doc<'merchant'> {
  const logo = merchant.logoUrl === undefined ? global?.logoUrl : merchant.logoUrl;
  return {
    ...merchant,
    name: merchant.name ?? global?.name,
    logoUrl: merchant.visualIdentityMode === 'icon' ? null : (appendLogoDevToken(logo) ?? null),
  };
}
