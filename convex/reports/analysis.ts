import { ConvexError, type Infer, v } from 'convex/values';

import type { toExplorerEntry } from './explorer';

export const reportRange = v.object({ start: v.string(), end: v.string() });
export const reportKind = v.union(v.literal('spending'), v.literal('moneyIn'), v.literal('cashFlow'));
export const reportFilters = v.object({
  accountIds: v.array(v.id('bankAccount')),
  categoryIds: v.array(v.string()),
  merchantIds: v.array(v.string()),
  includesPending: v.boolean(),
  reviewStatus: v.union(v.literal('reviewed'), v.literal('needs_review'), v.null()),
  categoryId: v.union(v.string(), v.null()),
  merchantId: v.union(v.string(), v.null()),
});
const totals = v.object({ outflow: v.string(), inflow: v.string(), count: v.number() });
const rank = v.object({
  id: v.string(),
  name: v.string(),
  logoURL: v.union(v.string(), v.null()),
  amount: v.string(),
  previousAmount: v.string(),
  count: v.number(),
});
const option = v.object({ id: v.string(), title: v.string() });
export const reportSummary = v.object({
  range: reportRange,
  totals,
  previous: totals,
  buckets: v.array(v.object({ range: reportRange, totals, previous: totals })),
  categories: v.array(rank),
  merchants: v.array(rank),
  spendingDays: v.number(),
  categoryCount: v.number(),
  merchantCount: v.number(),
  accounts: v.array(option),
  categoryOptions: v.array(option),
  merchantOptions: v.array(option),
  optionsTruncated: v.boolean(),
});
export type ExplorerEntry = NonNullable<ReturnType<typeof toExplorerEntry>>;
export type ReportRange = Infer<typeof reportRange>;
export type ReportKind = Infer<typeof reportKind>;
export type ReportFilters = Infer<typeof reportFilters>;
export type ReportSummary = Infer<typeof reportSummary>;
const DAY = 86_400_000;
const time = (day: string) => Date.parse(`${day}T00:00:00Z`);
const key = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);
export const dayCount = (range: ReportRange) => Math.round((time(range.end) - time(range.start)) / DAY) + 1;
const contains = (range: ReportRange, date: string) => date >= range.start && date <= range.end;

export function validateFilters(filters: ReportFilters) {
  if ([filters.accountIds, filters.categoryIds, filters.merchantIds].some((ids) => ids.length > 1000)) {
    throw new ConvexError('Choose up to 1,000 values per filter.');
  }
}

/** Disjoint ranges avoid reading the gap in year-over-year reports or counting
 * overlapping multi-year comparisons twice. At most four independent workers. */
export function reportReadRanges(current: ReportRange, comparison: ReportRange): ReportRange[] {
  const sorted = [current, comparison].sort((a, b) => a.start.localeCompare(b.start));
  const ranges =
    time(sorted[1].start) <= time(sorted[0].end) + DAY
      ? [{ start: sorted[0].start, end: sorted[0].end > sorted[1].end ? sorted[0].end : sorted[1].end }]
      : sorted;
  const result: ReportRange[] = [];
  for (const range of ranges) {
    const step = Math.ceil(dayCount(range) / (ranges.length === 1 ? 4 : 2));
    for (let start = time(range.start); start <= time(range.end); start += step * DAY) {
      result.push({ start: key(start), end: key(Math.min(start + (step - 1) * DAY, time(range.end))) });
    }
  }
  return result;
}

export function reportBuckets(range: ReportRange, kind: ReportKind = 'spending'): ReportRange[] {
  const days = dayCount(range);
  const first = new Date(time(range.start));
  const last = new Date(time(range.end));
  const months = (last.getUTCFullYear() - first.getUTCFullYear()) * 12 + last.getUTCMonth() - first.getUTCMonth() + 1;
  const monthStep = Math.max(1, Math.ceil(months / 36));
  const buckets: ReportRange[] = [];
  let start = time(range.start);
  while (start <= time(range.end)) {
    const next = new Date(start);
    if (days <= 100) next.setUTCDate(next.getUTCDate() + (days <= 31 || kind === 'cashFlow' ? 1 : 7));
    else {
      next.setUTCDate(1);
      next.setUTCMonth(next.getUTCMonth() + monthStep);
    }
    const end = Math.min(next.getTime() - DAY, time(range.end));
    buckets.push({ start: key(start), end: key(end) });
    start = next.getTime();
  }
  return buckets;
}

export function matchingMovements(entry: ExplorerEntry, filters: ReportFilters) {
  if (
    (!filters.includesPending && entry.status === 'pending') ||
    (filters.reviewStatus !== null && filters.reviewStatus !== entry.reviewStatus) ||
    (filters.accountIds.length > 0 && !filters.accountIds.includes(entry.accountId)) ||
    (filters.merchantIds.length > 0 && !filters.merchantIds.includes(entry.merchantId)) ||
    (filters.merchantId !== null && filters.merchantId !== entry.merchantId)
  )
    return [];
  return entry.movements.filter(
    (movement) =>
      (filters.categoryIds.length === 0 || filters.categoryIds.includes(movement.categoryId)) &&
      (filters.categoryId === null || filters.categoryId === movement.categoryId)
  );
}
export function matchesDirection(amount: bigint, kind: ReportKind) {
  return kind === 'cashFlow' || (kind === 'spending' ? amount < 0n : amount > 0n);
}

type Totals = { outflow: bigint; inflow: bigint; count: number };
type Rank = { id: string; name: string; logoURL: string | null; amount: bigint; previousAmount: bigint; count: number };
const emptyTotals = (): Totals => ({ outflow: 0n, inflow: 0n, count: 0 });
const transportTotals = (value: Totals) => ({
  ...value,
  outflow: value.outflow.toString(),
  inflow: value.inflow.toString(),
});

/** Streaming exact-integer reduction. Keeps summaries, never a client ledger.
 * Query batches stay bounded; longer history does not enlarge an individual DB read. */
export function createReportAccumulator(
  range: ReportRange,
  comparison: ReportRange,
  kind: ReportKind,
  filters: ReportFilters
) {
  const current = emptyTotals();
  const previous = emptyTotals();
  const buckets = reportBuckets(range, kind).map((range) => ({
    range,
    totals: emptyTotals(),
    previous: emptyTotals(),
  }));
  const categories = new Map<string, Rank>();
  const merchants = new Map<string, Rank>();
  const accounts = new Map<string, string>();
  const categoryOptions = new Map<string, string>();
  const merchantOptions = new Map<string, string>();
  const spendingDates = new Set<string>();
  const seen = new Set<string>();
  const add = (total: Totals, outflow: bigint, inflow: bigint, count: number) => {
    total.outflow += outflow;
    total.inflow += inflow;
    total.count += count;
  };
  return {
    consume(entries: ExplorerEntry[]) {
      for (const entry of entries) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        const isCurrent = contains(range, entry.date);
        const isPrevious = contains(comparison, entry.date);
        if (!isCurrent && !isPrevious) continue;
        accounts.set(entry.accountId, entry.accountName);
        merchantOptions.set(entry.merchantId, entry.merchantName);
        for (const movement of entry.movements) categoryOptions.set(movement.categoryId, movement.categoryName);
        const movements = matchingMovements(entry, filters);
        if (movements.length === 0) continue;
        let outflow = 0n;
        let inflow = 0n;
        let matches = false;
        const categoryAmounts = new Map<string, { name: string; amount: bigint }>();
        let merchantAmount = 0n;
        for (const movement of movements) {
          const amount = BigInt(movement.amount);
          if (amount < 0n) outflow -= amount;
          else inflow += amount;
          if (matchesDirection(amount, kind)) matches = true;
          // Cash flow's breakdown explains money out, while its chart shows both directions.
          if (kind === 'moneyIn' ? amount > 0n : amount < 0n) {
            const absolute = amount < 0n ? -amount : amount;
            merchantAmount += absolute;
            const category = categoryAmounts.get(movement.categoryId) ?? { name: movement.categoryName, amount: 0n };
            category.amount += absolute;
            categoryAmounts.set(movement.categoryId, category);
          }
        }
        if (isCurrent) {
          add(current, outflow, inflow, matches ? 1 : 0);
          if (outflow > 0n) spendingDates.add(entry.date);
          const bucket = buckets.find((bucket) => contains(bucket.range, entry.date));
          if (bucket) add(bucket.totals, outflow, inflow, matches ? 1 : 0);
        }
        if (isPrevious) {
          add(previous, outflow, inflow, matches ? 1 : 0);
          const alignedDate = key(time(range.start) + time(entry.date) - time(comparison.start));
          const bucket = buckets.find((bucket) => contains(bucket.range, alignedDate));
          if (bucket) add(bucket.previous, outflow, inflow, matches ? 1 : 0);
        }
        const addRank = (map: Map<string, Rank>, id: string, name: string, logoURL: string | null, amount: bigint) => {
          const row = map.get(id) ?? { id, name, logoURL, amount: 0n, previousAmount: 0n, count: 0 };
          if (isCurrent) {
            row.amount += amount;
            row.count += 1;
          }
          if (isPrevious) row.previousAmount += amount;
          map.set(id, row);
        };
        for (const [id, value] of categoryAmounts) addRank(categories, id, value.name, null, value.amount);
        if (merchantAmount > 0n)
          addRank(merchants, entry.merchantId, entry.merchantName, entry.merchantLogoUrl, merchantAmount);
      }
    },
    finish(): ReportSummary {
      const ranks = (map: Map<string, Rank>) =>
        Array.from(map.values())
          .filter((row) => row.amount > 0n)
          .sort((a, b) => (a.amount === b.amount ? a.name.localeCompare(b.name) : a.amount > b.amount ? -1 : 1));
      const transportRanks = (rows: Rank[]) =>
        rows
          .slice(0, 200)
          .map((row) => ({ ...row, amount: row.amount.toString(), previousAmount: row.previousAmount.toString() }));
      const options = (map: Map<string, string>) =>
        Array.from(map, ([id, title]) => ({ id, title }))
          .sort((a, b) => a.title.localeCompare(b.title))
          .slice(0, 1000);
      const categoryRanks = ranks(categories);
      const merchantRanks = ranks(merchants);
      return {
        range,
        totals: transportTotals(current),
        previous: transportTotals(previous),
        buckets: buckets.map((bucket) => ({
          ...bucket,
          totals: transportTotals(bucket.totals),
          previous: transportTotals(bucket.previous),
        })),
        categories: transportRanks(categoryRanks),
        merchants: transportRanks(merchantRanks),
        categoryCount: categoryRanks.length,
        merchantCount: merchantRanks.length,
        spendingDays: spendingDates.size,
        accounts: options(accounts),
        categoryOptions: options(categoryOptions),
        merchantOptions: options(merchantOptions),
        optionsTruncated: [accounts, categoryOptions, merchantOptions].some((map) => map.size > 1000),
      };
    },
  };
}
