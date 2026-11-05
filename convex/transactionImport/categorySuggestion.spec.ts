import { describe, expect, it } from 'vitest';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { buildImportedMovementData } from './processRawTransactionImports';

import {
  type CategorySuggestionCache,
  type CategorySuggestionResult,
  suggestCategoryForTransactionWithCache,
} from './categorySuggestion';

const workspaceId = 'workspace_1' as Id<'workspace'>;
const expenseGroupId = 'categoryGroup_expense' as Id<'categoryGroup'>;
const funMoneyId = 'category_fun_money' as Id<'category'>;
const coffeeId = 'category_coffee' as Id<'category'>;
const archivedCategoryId = 'category_archived' as Id<'category'>;

const unusedCtx = {
  db: {
    query: (_table: string) => {
      throw new Error('DB query should not be reached');
    },
    get: async (_id: string) => null,
  },
} as unknown as MutationCtx;

function buildCategory(id: Id<'category'>, name: string): Doc<'category'> {
  return {
    _id: id,
    _creationTime: 0,
    name,
    workspaceId,
    categoryGroupId: expenseGroupId,
    sortOrder: 0,
    isDeleted: false,
    isArchived: false,
    categoryType: 'custom',
  };
}

function buildCache(args: {
  suggestedCategoryIds?: Id<'category'>[];
  eligibleCategories?: Doc<'category'>[];
  mappingCache?: Map<string, CategorySuggestionResult | null>;
  historicalData?: CategorySuggestionCache['historicalData'];
}): CategorySuggestionCache {
  const eligibleCategories = args.eligibleCategories ?? [
    buildCategory(funMoneyId, 'Fun Money'),
    buildCategory(coffeeId, 'Coffee'),
  ];

  return {
    eligibleCategories,
    eligibleCategoryIds: new Set(eligibleCategories.map((category) => category._id)),
    historicalData: args.historicalData ?? [],
    mappingCache: args.mappingCache ?? new Map(),
    merchantSuggestionCache: new Map([['starbucks', args.suggestedCategoryIds ?? [funMoneyId, coffeeId]]]),
  };
}

describe('suggestCategoryForTransactionWithCache', () => {
  it.each(['llm', 'typesafe'])('defaults an inflow to RTA instead of a saved %s category', async (source) => {
    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({
            first: async () => ({ categoryId: coffeeId, source, confidence: 0.5 }),
          }),
        }),
        get: async () => buildCategory(coffeeId, 'Miscellaneous'),
      },
    } as unknown as MutationCtx;
    const cache = buildCache({ suggestedCategoryIds: [] });
    for (let attempt = 0; attempt < 2; attempt++) {
      const suggestion = await suggestCategoryForTransactionWithCache(
        ctx,
        workspaceId,
        { originalStatement: 'KEYBANK NATIONAL', amount: 366519n, plaidCategory: ['Transfer', 'Credit'] },
        cache
      );
      expect(suggestion.categoryId).toBeUndefined();
      expect(
        buildImportedMovementData({
          amount: 366519n,
          categoryId: suggestion.categoryId,
          bankAccountProperties: {
            isCreditCardAccount: false,
            isExcludedFromRTA: false,
            creditCardCategoryId: null,
          },
        })[0]
      ).toMatchObject({ readyToAssign: true, categoryId: undefined });
    }
  });

  it('preserves an explicit income mapping', async () => {
    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({ first: async () => ({ categoryId: coffeeId, source: 'manual' }) }),
        }),
        get: async () => buildCategory(coffeeId, 'Coffee'),
      },
    } as unknown as MutationCtx;
    const suggestion = await suggestCategoryForTransactionWithCache(
      ctx,
      workspaceId,
      { merchantName: 'Starbucks', amount: 625n, plaidCategory: [] },
      buildCache({})
    );
    expect(suggestion).toMatchObject({ categoryId: coffeeId, matchType: 'merchant_mapping' });
  });

  it('preserves reviewed inflow history when an AI mapping is ignored', async () => {
    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({ first: async () => ({ categoryId: funMoneyId, source: 'llm' }) }),
        }),
        get: async () => buildCategory(funMoneyId, 'Miscellaneous'),
      },
    } as unknown as MutationCtx;
    const suggestion = await suggestCategoryForTransactionWithCache(
      ctx,
      workspaceId,
      { merchantName: 'Starbucks', amount: 625n, plaidCategory: [] },
      buildCache({
        historicalData: [
          {
            standardizedMerchantName: 'starbucks',
            originalStatement: undefined,
            categoryId: coffeeId,
            date: new Date().toISOString().split('T')[0],
            amountDirection: 'positive',
          },
        ],
      })
    );
    expect(suggestion).toMatchObject({ categoryId: coffeeId, matchType: 'history_merchant' });
  });

  it('applies an approved Jev runner-up mapping without inflating its 20% probability', async () => {
    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({
            first: async () => ({ categoryId: coffeeId, source: 'typesafe', confidence: 0.2, usedFallback: true }),
          }),
        }),
        get: async () => buildCategory(coffeeId, 'Coffee'),
      },
    } as unknown as MutationCtx;
    const result = await suggestCategoryForTransactionWithCache(
      ctx,
      workspaceId,
      { merchantName: 'Starbucks', amount: -625n, plaidCategory: [] },
      buildCache({ suggestedCategoryIds: [] })
    );
    expect(result).toMatchObject({ categoryId: coffeeId, matchType: 'merchant_mapping', confidence: 0.2 });
  });

  it('uses the first valid merchant suggestion for expense transactions', async () => {
    const result = await suggestCategoryForTransactionWithCache(
      unusedCtx,
      workspaceId,
      {
        merchantName: 'Starbucks',
        amount: -625n,
        plaidCategory: [],
      },
      buildCache({ suggestedCategoryIds: [funMoneyId, coffeeId] })
    );

    expect(result.categoryId).toBe(funMoneyId);
    expect(result.categoryName).toBe('Fun Money');
    expect(result.matchType).toBe('merchant_suggestion');
  });

  it('prefers a merchant suggestion over a stale mapping or history vote for expenses', async () => {
    const mappingCache = new Map<string, CategorySuggestionResult | null>([
      [
        'starbucks|negative',
        {
          categoryId: coffeeId,
          categoryName: 'Coffee',
          confidence: 1,
          matchType: 'merchant_mapping',
        },
      ],
    ]);

    const result = await suggestCategoryForTransactionWithCache(
      unusedCtx,
      workspaceId,
      {
        merchantName: 'Starbucks Store #123',
        originalStatement: 'Starbucks Store #123',
        amount: -625n,
        plaidCategory: [],
      },
      buildCache({
        suggestedCategoryIds: [funMoneyId, coffeeId],
        mappingCache,
        historicalData: [
          {
            standardizedMerchantName: 'starbucks',
            originalStatement: 'starbucks store #123',
            categoryId: coffeeId,
            date: new Date().toISOString().split('T')[0],
            amountDirection: 'negative',
          },
        ],
      })
    );

    expect(result.categoryId).toBe(funMoneyId);
    expect(result.matchType).toBe('merchant_suggestion');
  });

  it('falls through to the next valid merchant suggestion when earlier suggestions are inactive', async () => {
    const result = await suggestCategoryForTransactionWithCache(
      unusedCtx,
      workspaceId,
      {
        merchantName: 'Starbucks',
        amount: -625n,
        plaidCategory: [],
      },
      buildCache({
        suggestedCategoryIds: [archivedCategoryId, coffeeId],
        eligibleCategories: [buildCategory(coffeeId, 'Coffee')],
      })
    );

    expect(result.categoryId).toBe(coffeeId);
    expect(result.categoryName).toBe('Coffee');
    expect(result.matchType).toBe('merchant_suggestion');
  });

  it('does not use expense merchant suggestions for income transactions', async () => {
    const mappingCache = new Map<string, CategorySuggestionResult | null>([
      [
        'starbucks|positive',
        {
          categoryId: coffeeId,
          categoryName: 'Coffee',
          confidence: 1,
          matchType: 'merchant_mapping',
        },
      ],
    ]);

    const result = await suggestCategoryForTransactionWithCache(
      unusedCtx,
      workspaceId,
      {
        merchantName: 'Starbucks',
        amount: 625n,
        plaidCategory: [],
      },
      buildCache({
        suggestedCategoryIds: [funMoneyId],
        mappingCache,
      })
    );

    expect(result.categoryId).toBe(coffeeId);
    expect(result.matchType).toBe('merchant_mapping');
  });
});
