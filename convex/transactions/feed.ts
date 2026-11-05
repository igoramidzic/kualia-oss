import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { getBankAccountLogoFields } from '../bankAccounts/queries';
import { dateToYearMonth } from '../categoryBudgets/calculations';
import { getCalculatedBudgetForMonth } from '../categoryBudgets/helpers';
import { entityIconColorId, visualIdentityMode } from '../lib/entityIdentity';
import { appendLogoDevToken } from '../lib/logoUtils';
import { accountType } from '../schema';
import { type BudgetChange, budgetChangeValidator } from './budgetReceipt';
import { isCrossBudgetTransfer } from './helpers';

export const MAX_TRANSACTION_FEED_PAGE_SIZE = 100;

export const transactionFeedItemValidator = v.object({
  id: v.id('transaction'),
  transferGroupId: v.union(v.id('transaction'), v.null()),
  scheduledTransactionId: v.union(v.id('scheduledTransaction'), v.null()),
  date: v.string(),
  type: v.union(
    v.literal('regular'),
    v.literal('starting_balance'),
    v.literal('balance_adjustment'),
    v.literal('transfer')
  ),
  status: v.union(v.literal('pending'), v.literal('cleared'), v.literal('reconciled')),
  suggestedTransfer: v.optional(
    v.object({
      status: v.string(),
      detectionReason: v.string(),
      accountConfidence: v.optional(v.number()),
      suggestedCounterpartAccountId: v.optional(v.id('bankAccount')),
      matchedTransactionId: v.optional(v.id('transaction')),
      counterpartAccountName: v.optional(v.string()),
    })
  ),
  reviewStatus: v.union(v.literal('reviewed'), v.literal('needs_review')),
  amount: v.int64(),
  categoryActivity: v.optional(v.object({ amount: v.string(), outflow: v.string(), inflow: v.string() })),
  notes: v.union(v.string(), v.null()),
  merchantName: v.union(v.string(), v.null()),
  merchantLogoUrl: v.union(v.string(), v.null()),
  merchantVisualIdentityMode: v.union(visualIdentityMode, v.null()),
  merchantIconName: v.union(v.string(), v.null()),
  merchantIconColorId: v.union(entityIconColorId, v.null()),
  bankAccountName: v.union(v.string(), v.null()),
  bankAccountType: v.union(accountType, v.null()),
  bankAccountLogoUrl: v.union(v.string(), v.null()),
  transferPairAccountName: v.union(v.string(), v.null()),
  transferPairAccountType: v.union(accountType, v.null()),
  transferPairAccountLogoUrl: v.union(v.string(), v.null()),
  isCreditCardPayment: v.boolean(),
  categoryNames: v.array(v.string()),
  hasUncategorized: v.boolean(),
  hasMissingPayee: v.boolean(),
  deletionBudgetChanges: v.optional(v.array(budgetChangeValidator)),
});

export interface TransactionFeedLookups {
  merchants: ReadonlyMap<Id<'merchant'>, Doc<'merchant'>>;
  globalMerchants: ReadonlyMap<Id<'globalMerchant'>, Doc<'globalMerchant'>>;
  bankAccounts: ReadonlyMap<Id<'bankAccount'>, Doc<'bankAccount'>>;
  categories: ReadonlyMap<Id<'category'>, Doc<'category'>>;
  accountLogoUrls: ReadonlyMap<Id<'bankAccount'>, string | null>;
  transferPairAccountIds: ReadonlyMap<Id<'transaction'>, Id<'bankAccount'>>;
}

/** Resolve logos once per authorized account, rather than once per transaction. */
export async function getTransactionFeedAccountLogos(
  ctx: QueryCtx,
  bankAccounts: ReadonlyMap<Id<'bankAccount'>, Doc<'bankAccount'>>
): Promise<Map<Id<'bankAccount'>, string | null>> {
  const linkAccountIds = new Set(
    [...bankAccounts.values()].flatMap((account) =>
      account.visualIdentityMode !== 'icon' && account.logoUrl === undefined && account.bankLinkAccountId
        ? [account.bankLinkAccountId]
        : []
    )
  );
  const linkAccounts = await Promise.all([...linkAccountIds].map((id) => ctx.db.get(id)));
  const linkAccountMap = new Map(
    linkAccounts
      .filter((account): account is Doc<'bankLinkAccount'> => account !== null && !account.isDeleted)
      .map((account) => [account._id, account])
  );
  const linkIds = new Set([...linkAccountMap.values()].map((account) => account.bankLinkId));
  const links = await Promise.all([...linkIds].map((id) => ctx.db.get(id)));
  const linkMap = new Map(
    links.filter((link): link is Doc<'bankLink'> => link !== null && !link.isDeleted).map((link) => [link._id, link])
  );
  const institutionIds = new Set([...linkMap.values()].map((link) => link.globalInstitutionId));
  const institutions = await Promise.all([...institutionIds].map((id) => ctx.db.get(id)));
  const institutionMap = new Map(
    institutions.filter((institution) => institution !== null).map((institution) => [institution._id, institution])
  );

  return new Map(
    [...bankAccounts.values()].map((account) => {
      if (account.visualIdentityMode === 'icon') return [account._id, null];
      const linkAccount = account.bankLinkAccountId ? linkAccountMap.get(account.bankLinkAccountId) : undefined;
      const link = linkAccount ? linkMap.get(linkAccount.bankLinkId) : undefined;
      const institution = link ? institutionMap.get(link.globalInstitutionId) : undefined;
      const { resolvedLogoUrl } = getBankAccountLogoFields(account, institution ?? null, !!account.financeKitAccountId);
      return [account._id, resolvedLogoUrl ?? null];
    })
  );
}

export function getTransferGroupId(
  transaction: Pick<Doc<'transaction'>, '_id' | 'transferPairId' | 'type'>
): Id<'transaction'> | null {
  if (transaction.type !== 'transfer') {
    return null;
  }

  const pairId = transaction.transferPairId;
  if (!pairId) {
    return transaction._id;
  }

  return transaction._id < pairId ? transaction._id : pairId;
}

function resolveMerchantDisplay(transaction: Doc<'transaction'>, lookups: TransactionFeedLookups) {
  const importedName = transaction.importDetails?.merchantName ?? transaction.importDetails?.originalStatement ?? null;
  const merchant = transaction.merchantId ? lookups.merchants.get(transaction.merchantId) : undefined;

  if (!merchant) {
    return {
      name: importedName,
      logoUrl: null,
      visualIdentityMode: null,
      iconName: null,
      iconColorId: null,
    } as const;
  }

  const globalMerchant = merchant.globalMerchantId ? lookups.globalMerchants.get(merchant.globalMerchantId) : undefined;
  const resolvedLogoUrl =
    merchant.logoUrl === undefined ? globalMerchant?.logoUrl : merchant.logoUrl === null ? undefined : merchant.logoUrl;

  return {
    name: merchant.name ?? globalMerchant?.name ?? importedName,
    logoUrl: appendLogoDevToken(resolvedLogoUrl) ?? null,
    visualIdentityMode: merchant.visualIdentityMode ?? 'logo',
    iconName: merchant.iconName ?? null,
    iconColorId: merchant.iconColorId ?? null,
  } as const;
}

function getCategoryNames(transaction: Doc<'transaction'>, lookups: TransactionFeedLookups): string[] {
  const names = new Set<string>();

  for (const movement of transaction.movements) {
    if (movement.readyToAssign) {
      names.add('Ready to Assign');
      continue;
    }

    if (movement.categoryId) {
      const category = lookups.categories.get(movement.categoryId);
      const categoryName = category?.name ?? movement.categoryName;
      if (categoryName) {
        names.add(categoryName);
      } else if (transaction.hasUncategorized) {
        names.add('Uncategorized');
      }
      continue;
    }

    if (movement.categoryName) {
      names.add(movement.categoryName);
    } else if (transaction.hasUncategorized) {
      names.add('Uncategorized');
    }
  }

  return [...names];
}

export function toTransactionFeedItem(transaction: Doc<'transaction'>, lookups: TransactionFeedLookups) {
  const merchant = resolveMerchantDisplay(transaction, lookups);
  const account = lookups.bankAccounts.get(transaction.bankAccountId);
  const pairAccountId = transaction.transferPairBankAccountId ?? lookups.transferPairAccountIds.get(transaction._id);
  const pairAccount = pairAccountId ? lookups.bankAccounts.get(pairAccountId) : undefined;
  const isTransfer = transaction.type === 'transfer';
  const source = transaction.totalAmount < 0n ? account : pairAccount;
  const destination = transaction.totalAmount > 0n ? account : pairAccount;
  const isCreditCardPayment =
    isTransfer &&
    transaction.totalAmount !== 0n &&
    source?.accountType.startsWith('banking_') === true &&
    destination?.accountType.startsWith('credit_') === true;
  const suggestion = transaction.suggestedTransfer;
  const hasSuggestion =
    transaction.reviewStatus === 'needs_review' &&
    (suggestion?.status === 'pending' || suggestion?.status === 'linked_pending_approval');
  const suggestedAccountId =
    suggestion?.suggestedCounterpartAccountId ??
    (suggestion?.status === 'linked_pending_approval'
      ? lookups.transferPairAccountIds.get(transaction._id)
      : undefined);
  const suggestedAccount = suggestedAccountId ? lookups.bankAccounts.get(suggestedAccountId) : undefined;
  const reliableAccount =
    suggestedAccount &&
    !suggestedAccount.isClosed &&
    !suggestedAccount.isDeleted &&
    suggestedAccount._id !== transaction.bankAccountId &&
    (suggestion?.status === 'linked_pending_approval' || (suggestion?.accountConfidence ?? 0) >= 70)
      ? suggestedAccount
      : undefined;
  const notes = [
    ...new Set(
      [transaction.notes, ...transaction.movements.map((movement) => movement.notes)]
        .map((note) => note?.trim())
        .filter((note): note is string => !!note)
    ),
  ].join('\n');

  return {
    id: transaction._id,
    transferGroupId: getTransferGroupId(transaction),
    scheduledTransactionId: transaction.scheduledTransactionId ?? null,
    date: transaction.date,
    type: transaction.type,
    status: transaction.status,
    reviewStatus: transaction.reviewStatus,
    ...(hasSuggestion && suggestion
      ? {
          suggestedTransfer: {
            status: suggestion.status,
            detectionReason: suggestion.detectionReason,
            ...(suggestion.accountConfidence !== undefined ? { accountConfidence: suggestion.accountConfidence } : {}),
            ...(reliableAccount
              ? { suggestedCounterpartAccountId: reliableAccount._id, counterpartAccountName: reliableAccount.name }
              : {}),
            ...(suggestion.matchedTransactionId ? { matchedTransactionId: suggestion.matchedTransactionId } : {}),
          },
        }
      : {}),
    amount: transaction.totalAmount,
    notes: notes.length > 0 ? notes : null,
    merchantName: merchant.name,
    merchantLogoUrl: merchant.logoUrl,
    merchantVisualIdentityMode: merchant.visualIdentityMode,
    merchantIconName: merchant.iconName,
    merchantIconColorId: merchant.iconColorId,
    bankAccountName: account?.name ?? null,
    bankAccountType: account?.accountType ?? null,
    bankAccountLogoUrl: account ? (lookups.accountLogoUrls.get(account._id) ?? null) : null,
    transferPairAccountName: pairAccount?.name ?? null,
    transferPairAccountType: pairAccount?.accountType ?? null,
    transferPairAccountLogoUrl: pairAccount ? (lookups.accountLogoUrls.get(pairAccount._id) ?? null) : null,
    isCreditCardPayment,
    categoryNames:
      isTransfer && !isCrossBudgetTransfer(account?.accountType, pairAccount?.accountType)
        ? []
        : getCategoryNames(transaction, lookups),
    hasUncategorized: transaction.hasUncategorized,
    hasMissingPayee: transaction.hasMissingPayee,
  };
}

export function toTransactionFeedItems(transactions: readonly Doc<'transaction'>[], lookups: TransactionFeedLookups) {
  return transactions.map((transaction) => toTransactionFeedItem(transaction, lookups));
}

/** Include a transfer's other side even when it falls outside this page or account. */
export async function getFeedDeletionTransactions(
  ctx: QueryCtx,
  workspaceId: Id<'workspace'>,
  transactions: readonly Doc<'transaction'>[]
): Promise<Doc<'transaction'>[]> {
  const byId = new Map(transactions.map((transaction) => [transaction._id, transaction]));
  const pairIds = new Set(
    transactions.flatMap((transaction) =>
      transaction.type === 'transfer' && transaction.transferPairId && !byId.has(transaction.transferPairId)
        ? [transaction.transferPairId]
        : []
    )
  );
  for (const pair of await Promise.all([...pairIds].map((id) => ctx.db.get(id)))) {
    if (
      pair &&
      !pair.isDeleted &&
      pair.workspaceId === workspaceId &&
      pair.type === 'transfer' &&
      pair.transferPairId &&
      byId.get(pair.transferPairId)?.transferPairId === pair._id
    ) {
      byId.set(pair._id, pair);
    }
  }
  return [...byId.values()];
}

/** Preload feedback with the page, so a swipe needs no network round trip.
 * Read each category/month only once; the mutation still returns authoritative balances.
 */
export async function getFeedDeletionBudgetChanges(
  ctx: QueryCtx,
  workspace: Doc<'workspace'>,
  transactions: readonly Doc<'transaction'>[],
  lookups: TransactionFeedLookups
): Promise<Map<string, BudgetChange[]>> {
  const balances = new Map<string, Promise<bigint>>();
  const transactionChanges = await Promise.all(
    transactions.map(async (transaction) => {
      const account = lookups.bankAccounts.get(transaction.bankAccountId);
      if (!account) return [];
      const yearMonth = dateToYearMonth(transaction.date);
      return Promise.all(
        transaction.movements.map(async (movement): Promise<BudgetChange | null> => {
          let change: BudgetChange;
          if (movement.readyToAssign && account.accountType.startsWith('banking_')) {
            change = { name: 'Ready to Assign', before: workspace.readyToAssign ?? 0n, after: 0n };
          } else if (
            movement.categoryId &&
            !(transaction.type === 'starting_balance' && account.accountType.startsWith('credit_'))
          ) {
            const category = lookups.categories.get(movement.categoryId);
            if (!category || category.workspaceId !== workspace._id) return null;
            const key = `${category._id}:${yearMonth}`;
            let balance = balances.get(key);
            if (!balance) {
              balance = getCalculatedBudgetForMonth(ctx, workspace._id, category._id, yearMonth).then(
                (value) => value.available
              );
              balances.set(key, balance);
            }
            change = { categoryId: category._id, yearMonth, name: category.name, before: await balance, after: 0n };
          } else return null;
          return { ...change, after: change.before - movement.amount };
        })
      );
    })
  );
  // Start independent category/month reads together, then combine in original order
  // so split movements and both transfer sides retain deterministic receipt ordering.
  const groups = new Map<string, Map<string, BudgetChange>>();
  for (const [index, transaction] of transactions.entries()) {
    const groupID = getTransferGroupId(transaction) ?? transaction._id;
    const changes = groups.get(groupID) ?? new Map<string, BudgetChange>();
    groups.set(groupID, changes);
    for (const change of transactionChanges[index]) {
      if (!change) continue;
      const key = `${change.categoryId ?? 'rta'}:${change.yearMonth ?? 0}`;
      const existing = changes.get(key);
      changes.set(key, { ...change, after: (existing?.after ?? change.before) + change.after - change.before });
    }
  }
  // A transfer can affect the same category in two months. Earlier changes carry forward.
  for (const changes of groups.values()) {
    const originals = [...changes.values()].map((change) => ({ ...change }));
    for (const change of changes.values()) {
      const yearMonth = change.yearMonth;
      if (!change.categoryId || !yearMonth) continue;
      change.after += originals
        .filter(
          (other) =>
            other.categoryId === change.categoryId && other.yearMonth !== undefined && other.yearMonth < yearMonth
        )
        .reduce((sum, other) => sum + other.after - other.before, 0n);
    }
  }
  return new Map(
    [...groups].map(([id, changes]) => [id, [...changes.values()].filter((change) => change.before !== change.after)])
  );
}
