import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { getCreditCardCategoryForAccount, isAccountExcludedFromRTA, isCreditCardAccount } from '../helpers';
import type { BankAccountPropertiesCache, TransactionSnapshot } from './types';

/**
 * Build a TransactionSnapshot from an existing transaction document.
 * Reads bank account properties (credit card status, RTA exclusion) from the database.
 */
export async function buildSnapshotFromTransaction(
  ctx: MutationCtx,
  transaction: Doc<'transaction'>
): Promise<TransactionSnapshot> {
  const movements = transaction.movements ?? [];
  const totalAmount = transaction.totalAmount ?? movements.reduce((sum, m) => sum + m.amount, 0n);

  const isCreditCard = await isCreditCardAccount(ctx, transaction.bankAccountId);
  const isExcludedFromRTA = await isAccountExcludedFromRTA(ctx, transaction.bankAccountId);
  const creditCardCategoryId = isCreditCard
    ? await getCreditCardCategoryForAccount(ctx, transaction.bankAccountId)
    : null;

  return {
    workspaceId: transaction.workspaceId,
    transactionId: transaction._id,
    scheduledTransactionId: transaction.scheduledTransactionId,
    scheduledOccurrenceDate: transaction.scheduledOccurrenceDate,
    scheduledOccurrenceRevision: transaction.scheduledOccurrenceRevision,
    bankAccountId: transaction.bankAccountId,
    type: transaction.type,
    date: transaction.date,
    status: transaction.status,
    totalAmount,
    isCreditCardAccount: isCreditCard,
    isExcludedFromRTA,
    creditCardCategoryId,
    merchantId: transaction.merchantId,
    movements: movements.map((m) => ({
      categoryId: m.categoryId,
      readyToAssign: m.readyToAssign,
      amount: m.amount,
      creditCardTransfer: m.creditCardTransfer,
    })),
    transferPairId: transaction.transferPairId,
    transferPairBankAccountId: transaction.transferPairBankAccountId,
  };
}

/**
 * Build a TransactionSnapshot from explicit values (for cases where the transaction
 * hasn't been inserted yet, or we need to construct the "after" state manually).
 */
export async function buildSnapshotFromValues(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<'workspace'>;
    transactionId: Id<'transaction'>;
    bankAccountId: Id<'bankAccount'>;
    type: 'regular' | 'starting_balance' | 'balance_adjustment' | 'transfer';
    date: string;
    status: 'pending' | 'cleared' | 'reconciled';
    totalAmount: bigint;
    merchantId: Id<'merchant'> | undefined;
    movements: Array<{
      categoryId?: Id<'category'>;
      readyToAssign: boolean;
      amount: bigint;
      creditCardTransfer?: {
        creditCardCategoryId: Id<'category'>;
        spendingCategoryId: Id<'category'>;
      };
    }>;
    transferPairId?: Id<'transaction'>;
    transferPairBankAccountId?: Id<'bankAccount'>;
  }
): Promise<TransactionSnapshot> {
  const isCreditCard = await isCreditCardAccount(ctx, args.bankAccountId);
  const isExcludedFromRTA = await isAccountExcludedFromRTA(ctx, args.bankAccountId);
  const creditCardCategoryId = isCreditCard ? await getCreditCardCategoryForAccount(ctx, args.bankAccountId) : null;

  return {
    workspaceId: args.workspaceId,
    transactionId: args.transactionId,
    bankAccountId: args.bankAccountId,
    type: args.type,
    date: args.date,
    status: args.status,
    totalAmount: args.totalAmount,
    isCreditCardAccount: isCreditCard,
    isExcludedFromRTA,
    creditCardCategoryId,
    merchantId: args.merchantId,
    movements: args.movements.map((m) => ({
      categoryId: m.categoryId,
      readyToAssign: m.readyToAssign,
      amount: m.amount,
      creditCardTransfer: m.creditCardTransfer,
    })),
    transferPairId: args.transferPairId,
    transferPairBankAccountId: args.transferPairBankAccountId,
  };
}

/**
 * Pre-compute bank account properties for a set of bank accounts.
 * Use this before processing batches of transactions to avoid repeated DB reads.
 */
export async function buildBankAccountPropertiesCache(
  ctx: MutationCtx,
  bankAccountIds: Id<'bankAccount'>[]
): Promise<BankAccountPropertiesCache> {
  const cache: BankAccountPropertiesCache = new Map();
  const uniqueIds = [...new Set(bankAccountIds)];

  for (const bankAccountId of uniqueIds) {
    const isCreditCard = await isCreditCardAccount(ctx, bankAccountId);
    const excludedFromRTA = await isAccountExcludedFromRTA(ctx, bankAccountId);
    const ccCategoryId = isCreditCard ? await getCreditCardCategoryForAccount(ctx, bankAccountId) : null;
    cache.set(bankAccountId, {
      isCreditCardAccount: isCreditCard,
      isExcludedFromRTA: excludedFromRTA,
      creditCardCategoryId: ccCategoryId,
    });
  }

  return cache;
}

/**
 * Build a TransactionSnapshot using cached bank account properties.
 * Falls back to DB reads if the bank account is not in the cache.
 */
export async function buildSnapshotFromTransactionCached(
  ctx: MutationCtx,
  transaction: Doc<'transaction'>,
  cache: BankAccountPropertiesCache
): Promise<TransactionSnapshot> {
  const movements = transaction.movements ?? [];
  const totalAmount = transaction.totalAmount ?? movements.reduce((sum, m) => sum + m.amount, 0n);

  const cached = cache.get(transaction.bankAccountId);
  const isCreditCard = cached?.isCreditCardAccount ?? (await isCreditCardAccount(ctx, transaction.bankAccountId));
  const excludedFromRTA = cached?.isExcludedFromRTA ?? (await isAccountExcludedFromRTA(ctx, transaction.bankAccountId));
  const creditCardCategoryId =
    cached?.creditCardCategoryId ??
    (isCreditCard ? await getCreditCardCategoryForAccount(ctx, transaction.bankAccountId) : null);

  return {
    workspaceId: transaction.workspaceId,
    transactionId: transaction._id,
    scheduledTransactionId: transaction.scheduledTransactionId,
    scheduledOccurrenceDate: transaction.scheduledOccurrenceDate,
    scheduledOccurrenceRevision: transaction.scheduledOccurrenceRevision,
    bankAccountId: transaction.bankAccountId,
    type: transaction.type,
    date: transaction.date,
    status: transaction.status,
    totalAmount,
    isCreditCardAccount: isCreditCard,
    isExcludedFromRTA: excludedFromRTA,
    creditCardCategoryId,
    merchantId: transaction.merchantId,
    movements: movements.map((m) => ({
      categoryId: m.categoryId,
      readyToAssign: m.readyToAssign,
      amount: m.amount,
      creditCardTransfer: m.creditCardTransfer,
    })),
    transferPairId: transaction.transferPairId,
    transferPairBankAccountId: transaction.transferPairBankAccountId,
  };
}
