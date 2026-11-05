import type { PaginationOptions } from 'convex/server';
import { type Infer, v } from 'convex/values';
import { stream } from 'convex-helpers/server/stream';

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import schema from '../schema';
import { type TransactionFeedLookups, toTransactionFeedItem } from './feed';
import { reportMerchantIdentity, reportMovementGroup } from './reportFilters';

export const transactionFeedSearchValidator = v.object({
  text: v.string(),
  categoryId: v.optional(v.union(v.id('category'), v.literal('uncategorized'), v.literal('ready-to-assign'))),
  groupId: v.optional(v.union(v.id('categoryGroup'), v.literal('ungrouped'), v.literal('ready-to-assign'))),
  merchantId: v.optional(v.id('merchant')),
  unlinkedMerchantName: v.optional(v.string()),
  reportActivity: v.optional(v.boolean()),
  status: v.optional(
    v.union(v.literal('pending'), v.literal('cleared'), v.literal('reconciled'), v.literal('needs_review'))
  ),
  flow: v.optional(v.union(v.literal('inflow'), v.literal('outflow'), v.literal('transfer'))),
  hasNotes: v.optional(v.boolean()),
  includeSuggestedTransfers: v.optional(v.boolean()),
});

export type TransactionFeedSearch = Infer<typeof transactionFeedSearchValidator>;

export const MAX_TRANSACTION_SEARCH_ROWS = 5_000;
export const MAX_TRANSACTION_SEARCH_BYTES = 4_000_000;

/** Fill a page with matches inside one server request. Embedded split categories
 * and cross-field text need TypeScript predicates, applied BEFORE pagination.
 * Large histories still have a bounded, resumable scan rather than an unlimited read.
 */
export async function searchTransactionFeedPage(
  ctx: QueryCtx,
  workspaceId: Id<'workspace'>,
  args: {
    bankAccountId?: Id<'bankAccount'>;
    startDate?: string;
    endDate?: string;
    search: TransactionFeedSearch;
    paginationOpts: PaginationOptions;
  },
  minorUnit: number,
  loadLookups: (transactions: readonly Doc<'transaction'>[]) => Promise<TransactionFeedLookups>
) {
  const db = stream(ctx.db, schema);
  const accountId = args.bankAccountId;
  const status = args.search.status;
  // Report history includes timestamped imports on the final calendar day.
  const endDate = args.endDate && args.search.reportActivity ? `${args.endDate}~` : args.endDate;
  const query = accountId
    ? db.query('transaction').withIndex('by_workspaceId_bankAccountId_isDeleted_date', (q) => {
        const scoped = q.eq('workspaceId', workspaceId).eq('bankAccountId', accountId).eq('isDeleted', false);
        if (args.startDate && endDate) return scoped.gte('date', args.startDate).lte('date', endDate);
        if (args.startDate) return scoped.gte('date', args.startDate);
        if (endDate) return scoped.lte('date', endDate);
        return scoped;
      })
    : status && status !== 'needs_review'
      ? db.query('transaction').withIndex('by_workspaceId_status_isDeleted_date', (q) => {
          const scoped = q.eq('workspaceId', workspaceId).eq('status', status).eq('isDeleted', false);
          if (args.startDate && endDate) return scoped.gte('date', args.startDate).lte('date', endDate);
          if (args.startDate) return scoped.gte('date', args.startDate);
          if (endDate) return scoped.lte('date', endDate);
          return scoped;
        })
      : db.query('transaction').withIndex('by_workspaceId_isDeleted_date', (q) => {
          const scoped = q.eq('workspaceId', workspaceId).eq('isDeleted', false);
          if (args.startDate && endDate) return scoped.gte('date', args.startDate).lte('date', endDate);
          if (args.startDate) return scoped.gte('date', args.startDate);
          if (endDate) return scoped.lte('date', endDate);
          return scoped;
        });
  const terms = transactionSearchTerms(args.search.text);
  const groups = new Map<Id<'categoryGroup'>, Doc<'categoryGroup'>>();
  const loadedGroups = new Set<Id<'categoryGroup'>>();
  return query
    .order('desc')
    .filterWith(async (transaction) => {
      if (!transactionMatchesFeedFilters(transaction, args.search)) return false;
      const needsRelations =
        args.search.reportActivity ||
        args.search.groupId ||
        args.search.merchantId ||
        args.search.unlinkedMerchantName !== undefined;
      if (!needsRelations && terms.length === 0) return true;
      const lookups = await loadLookups([transaction]);
      if (args.search.groupId) {
        for (const category of lookups.categories.values()) {
          if (loadedGroups.has(category.categoryGroupId)) continue;
          loadedGroups.add(category.categoryGroupId);
          const group = await ctx.db.get(category.categoryGroupId);
          if (group?.workspaceId === workspaceId) groups.set(group._id, group);
        }
      }
      return (
        (!needsRelations || transactionMatchesFeedRelations(transaction, args.search, lookups, groups)) &&
        transactionMatchesFeedText(transaction, lookups, terms, minorUnit)
      );
    })
    .paginate(args.paginationOpts);
}

/** Keep split-category activity separate from the full transaction amount. Strings
 * preserve exact minor units even when several int64 movements are summed. */
export function transactionCategoryActivity(transaction: Doc<'transaction'>, categoryId: string) {
  let amount = 0n;
  let outflow = 0n;
  let inflow = 0n;
  for (const movement of transaction.movements) {
    if (movement.categoryId !== categoryId) continue;
    amount += movement.amount;
    // Purchases and refunds also carry card-funding metadata. Only the card
    // category's funding movement is excluded, not the spending category's split.
    if (
      movement.creditCardTransfer?.creditCardCategoryId === categoryId ||
      transaction.type === 'starting_balance' ||
      transaction.type === 'balance_adjustment'
    )
      continue;
    if (movement.amount < 0n) outflow -= movement.amount;
    else inflow += movement.amount;
  }
  return { amount: amount.toString(), outflow: outflow.toString(), inflow: inflow.toString() };
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.+-]+/gu, ' ')
    .trim();
}

export function transactionSearchTerms(text: string): string[] {
  return normalize(text).split(/\s+/).filter(Boolean);
}

export function transactionMatchesFeedFilters(transaction: Doc<'transaction'>, search: TransactionFeedSearch): boolean {
  if (search.reportActivity && (transaction.type !== 'regular' || transaction.status === 'pending')) return false;
  if (search.status === 'needs_review') {
    if (transaction.reviewStatus !== 'needs_review') return false;
  } else if (search.status && transaction.status !== search.status) return false;
  if (
    search.flow === 'transfer' &&
    transaction.type !== 'transfer' &&
    !(
      search.includeSuggestedTransfers &&
      transaction.reviewStatus === 'needs_review' &&
      (transaction.suggestedTransfer?.status === 'pending' ||
        transaction.suggestedTransfer?.status === 'linked_pending_approval')
    )
  )
    return false;
  if (!search.reportActivity) {
    if (search.flow === 'inflow' && (transaction.type === 'transfer' || transaction.totalAmount <= 0n)) return false;
    if (search.flow === 'outflow' && (transaction.type === 'transfer' || transaction.totalAmount >= 0n)) return false;
  }
  if (
    search.hasNotes &&
    !transaction.notes?.trim() &&
    !transaction.movements.some((movement) => movement.notes?.trim())
  )
    return false;
  // Report direction and category must match the SAME split, checked after hydration.
  if (search.reportActivity) return true;
  if (search.categoryId === 'uncategorized') return transaction.hasUncategorized;
  if (search.categoryId === 'ready-to-assign') return transaction.movements.some((movement) => movement.readyToAssign);
  return !search.categoryId || transaction.movements.some((movement) => movement.categoryId === search.categoryId);
}

export function transactionMatchesFeedRelations(
  transaction: Doc<'transaction'>,
  search: TransactionFeedSearch,
  lookups: TransactionFeedLookups,
  groups: ReadonlyMap<Id<'categoryGroup'>, Doc<'categoryGroup'>>
): boolean {
  if (search.reportActivity && !lookups.bankAccounts.has(transaction.bankAccountId)) return false;
  const merchant = reportMerchantIdentity(transaction, lookups);
  if (search.merchantId && merchant.id !== search.merchantId) return false;
  if (search.unlinkedMerchantName !== undefined && merchant.id !== `unlinked:${search.unlinkedMerchantName}`)
    return false;
  if (!search.reportActivity && !search.groupId) return true;
  return transaction.movements.some((movement) => {
    const categoryId = movement.readyToAssign ? 'ready-to-assign' : (movement.categoryId ?? 'uncategorized');
    if (search.categoryId && categoryId !== search.categoryId) return false;
    if (search.groupId && reportMovementGroup(movement, lookups, groups).groupId !== search.groupId) return false;
    return (
      !search.reportActivity ||
      (search.flow === 'inflow'
        ? movement.amount > 0n
        : search.flow === 'outflow'
          ? movement.amount < 0n
          : movement.amount !== 0n)
    );
  });
}

function decimalAmount(amount: bigint, minorUnit: number): string {
  const absolute = amount < 0n ? -amount : amount;
  const digits = absolute.toString().padStart(minorUnit + 1, '0');
  return `${amount < 0n ? '-' : ''}${minorUnit === 0 ? digits : `${digits.slice(0, -minorUnit)}.${digits.slice(-minorUnit)}`}`;
}

/** Match current authorized display names, including renamed accounts/categories,
 * without relying on a historical searchText backfill. Every word can match a
 * different field; each read remains a bounded, indexed page of history. */
export function transactionMatchesFeedText(
  transaction: Doc<'transaction'>,
  lookups: TransactionFeedLookups,
  terms: readonly string[],
  minorUnit: number
): boolean {
  if (terms.length === 0) return true;
  const item = toTransactionFeedItem(transaction, lookups);
  const text = normalize(
    [
      item.merchantName,
      item.bankAccountName,
      item.bankAccountType?.replaceAll('_', ' '),
      item.transferPairAccountName,
      ...item.categoryNames,
      item.notes,
      transaction.importDetails?.merchantName,
      transaction.importDetails?.originalStatement,
      transaction.plaidMerchantName,
      transaction.date,
      transaction.status,
      transaction.reviewStatus.replaceAll('_', ' '),
      transaction.type.replaceAll('_', ' '),
      transaction.source?.replaceAll('_', ' '),
      item.isCreditCardPayment ? 'credit card payment' : '',
      transaction.totalAmount.toString(),
      decimalAmount(transaction.totalAmount, minorUnit),
      ...transaction.movements.map((movement) => decimalAmount(movement.amount, minorUnit)),
    ]
      .filter((value) => value !== null && value !== undefined)
      .join(' ')
  );
  return terms.every((term) => text.includes(term));
}
