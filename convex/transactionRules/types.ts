import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';

export const conditionsValidator = v.object({
  originalStatement: v.optional(
    v.array(
      v.object({
        matchType: v.union(v.literal('contains'), v.literal('exactlyMatches')),
        value: v.string(),
      })
    )
  ),
  merchantName: v.optional(
    v.array(
      v.object({
        matchType: v.union(v.literal('contains'), v.literal('exactlyMatches')),
        value: v.string(),
      })
    )
  ),
  amount: v.optional(
    v.array(
      v.object({
        operator: v.union(v.literal('equals'), v.literal('lessThan'), v.literal('greaterThan'), v.literal('between')),
        value: v.int64(),
        valueTo: v.optional(v.int64()),
      })
    )
  ),
  bankAccountId: v.optional(v.array(v.id('bankAccount'))),
});

export const actionsValidator = v.object({
  setMerchantId: v.optional(v.id('merchant')),
  setCategoryId: v.optional(v.id('category')),
});

export type Transaction = Doc<'transaction'>;
export type TransactionRule = Doc<'transactionRule'>;
