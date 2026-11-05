import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { reconcileScheduledOccurrence } from '../scheduledTransactions/occurrences';
import { applyCategoryChangeToTransaction } from '../transactions/helpers/categoryUpdate';
import { buildSnapshotFromTransaction } from '../transactions/reconciliation/buildSnapshot';

import type { Transaction, TransactionRule } from './types';

export function evaluateStringCondition(
  value: string | undefined,
  conditions: Array<{ matchType: 'contains' | 'exactlyMatches'; value: string }> | undefined
): boolean {
  if (!conditions || conditions.length === 0) return true;
  if (!value) return false;

  const lowerValue = value.toLowerCase();
  return conditions.some((condition) => {
    const lowerConditionValue = condition.value.toLowerCase();
    return condition.matchType === 'contains'
      ? lowerValue.includes(lowerConditionValue)
      : lowerValue === lowerConditionValue;
  });
}

export function evaluateAmountCondition(
  amount: bigint,
  conditions:
    | Array<{
        operator: 'equals' | 'lessThan' | 'greaterThan' | 'between';
        value: bigint;
        valueTo?: bigint;
      }>
    | undefined
): boolean {
  if (!conditions || conditions.length === 0) return true;

  return conditions.some((condition) => {
    switch (condition.operator) {
      case 'equals':
        return amount === condition.value;
      case 'lessThan':
        return amount < condition.value;
      case 'greaterThan':
        return amount > condition.value;
      case 'between':
        return condition.valueTo !== undefined && amount >= condition.value && amount <= condition.valueTo;
      default:
        return false;
    }
  });
}

export function evaluateBankAccountCondition(
  bankAccountId: Id<'bankAccount'>,
  conditions: Array<Id<'bankAccount'>> | undefined
): boolean {
  if (!conditions || conditions.length === 0) return true;
  return conditions.includes(bankAccountId);
}

export async function getMerchantName(
  ctx: QueryCtx | MutationCtx,
  merchantId: Id<'merchant'> | undefined
): Promise<string | undefined> {
  if (!merchantId) return undefined;

  const merchant = await ctx.db.get(merchantId);
  if (!merchant) return undefined;

  if (merchant.name) return merchant.name;

  if (merchant.globalMerchantId) {
    const globalMerchant = await ctx.db.get(merchant.globalMerchantId);
    return globalMerchant?.name;
  }

  return undefined;
}

function getTransactionAmount(transaction: Transaction): bigint {
  return transaction.totalAmount ?? transaction.movements?.reduce((sum, m) => sum + m.amount, 0n) ?? 0n;
}

export async function evaluateRule(
  ctx: QueryCtx | MutationCtx,
  transaction: Transaction,
  rule: TransactionRule
): Promise<boolean> {
  const { conditions } = rule;

  if (!evaluateStringCondition(transaction.importDetails?.originalStatement, conditions.originalStatement)) {
    return false;
  }

  const merchantName = await getMerchantName(ctx, transaction.merchantId);
  if (!evaluateStringCondition(merchantName, conditions.merchantName)) {
    return false;
  }

  if (!evaluateAmountCondition(getTransactionAmount(transaction), conditions.amount)) {
    return false;
  }

  if (!evaluateBankAccountCondition(transaction.bankAccountId, conditions.bankAccountId)) {
    return false;
  }

  return true;
}

export function evaluateRuleWithCache(
  _ctx: QueryCtx | MutationCtx,
  transaction: Transaction,
  rule: TransactionRule,
  merchantNameCache: Map<Id<'merchant'>, string | undefined>
): boolean {
  const { conditions } = rule;

  if (!evaluateStringCondition(transaction.importDetails?.originalStatement, conditions.originalStatement)) {
    return false;
  }

  const merchantName = transaction.merchantId ? merchantNameCache.get(transaction.merchantId) : undefined;
  if (!evaluateStringCondition(merchantName, conditions.merchantName)) {
    return false;
  }

  if (!evaluateAmountCondition(getTransactionAmount(transaction), conditions.amount)) {
    return false;
  }

  if (!evaluateBankAccountCondition(transaction.bankAccountId, conditions.bankAccountId)) {
    return false;
  }

  return true;
}

/**
 * Apply rules to transaction data BEFORE database insert.
 * Returns modified transaction data and the ID of the applied rule.
 * Caller should pre-sort rules by priority.
 */
export function applyRulesToTransactionData(
  transactionData: {
    merchantId?: Id<'merchant'>;
    rawMerchantName?: string;
    categoryId?: Id<'category'>;
    amount: bigint;
    bankAccountId: Id<'bankAccount'>;
    importDetails?: {
      originalStatement?: string;
      merchantName?: string;
    };
  },
  rules: TransactionRule[],
  merchantNameCache: Map<Id<'merchant'>, string | undefined>
): {
  data: {
    merchantId?: Id<'merchant'>;
    categoryId?: Id<'category'>;
  };
  appliedRuleId?: Id<'transactionRule'>;
} {
  for (const rule of rules) {
    const { conditions } = rule;

    if (!evaluateStringCondition(transactionData.importDetails?.originalStatement, conditions.originalStatement)) {
      continue;
    }

    const merchantName =
      transactionData.rawMerchantName ??
      (transactionData.merchantId ? merchantNameCache.get(transactionData.merchantId) : undefined);
    if (!evaluateStringCondition(merchantName, conditions.merchantName)) {
      continue;
    }

    if (!evaluateAmountCondition(transactionData.amount, conditions.amount)) {
      continue;
    }

    if (!evaluateBankAccountCondition(transactionData.bankAccountId, conditions.bankAccountId)) {
      continue;
    }

    return {
      data: {
        merchantId: rule.actions.setMerchantId ?? transactionData.merchantId,
        categoryId: rule.actions.setCategoryId ?? transactionData.categoryId,
      },
      appliedRuleId: rule._id,
    };
  }

  return {
    data: {
      merchantId: transactionData.merchantId,
      categoryId: transactionData.categoryId,
    },
  };
}

export async function applyRulesToTransaction(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>,
  transactionId: Id<'transaction'>
): Promise<void> {
  try {
    const rules = await ctx.db
      .query('transactionRule')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .filter((q) => q.eq(q.field('isActive'), true))
      .collect();

    const sortedRules = rules.sort((a, b) => a.priority - b.priority);

    const transaction = await ctx.db.get(transactionId);
    if (!transaction) return;

    for (const rule of sortedRules) {
      if (!(await evaluateRule(ctx, transaction, rule))) continue;

      if (rule.actions.setMerchantId !== undefined) {
        await ctx.db.patch(transactionId, {
          merchantId: rule.actions.setMerchantId,
          updatedAt: new Date().toISOString(),
        });
      }

      if (rule.actions.setCategoryId !== undefined && transaction.movements?.length > 0) {
        await applyCategoryChangeToTransaction(ctx, {
          workspaceId,
          transactionId,
          transaction,
          newCategoryId: rule.actions.setCategoryId,
          movementIndex: 0,
        });
      } else {
        await reconcilePlannedLinkAfterRule(ctx, transaction);
      }

      break;
    }
  } catch (error: unknown) {
    console.error('Failed to apply rules to transaction:', error);
  }
}

/** Merchant-only rules bypass financial reconciliation, but still invalidate old planned matches. */
export async function reconcilePlannedLinkAfterRule(ctx: MutationCtx, before: Transaction): Promise<void> {
  if (!before.scheduledTransactionId) return;
  const after = await ctx.db.get(before._id);
  if (!after || before.merchantId === after.merchantId) return;
  await reconcileScheduledOccurrence(
    ctx,
    await buildSnapshotFromTransaction(ctx, before),
    await buildSnapshotFromTransaction(ctx, after)
  );
}
