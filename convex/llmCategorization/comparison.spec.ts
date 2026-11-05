import { describe, expect, it, vi } from 'vitest';

import type { Id } from '../_generated/dataModel';
import {
  applyTypeSafeFallback,
  type ComparisonSample,
  compareCategorization,
  normalizePlaidComparisonInput,
  type ProviderAnswer,
  type ProviderBatch,
} from './comparison';
import type { CategoryInput, MerchantInput } from './helpers';

const shopping = 'shopping' as Id<'category'>;
const groceries = 'groceries' as Id<'category'>;
const categories: CategoryInput[] = [
  { id: shopping, name: 'Shopping', groupName: 'Daily' },
  { id: groceries, name: 'Groceries', groupName: 'Daily' },
];
function answer(categoryId: Id<'category'> | null): ProviderAnswer {
  return {
    categoryId,
    categoryName: categoryId ?? 'Uncategorized',
    confidence: 0.9,
    reason: null,
    error: null,
    alternatives: [],
  };
}
function batch(answers: ProviderAnswer[]): ProviderBatch {
  return {
    model: 'test',
    elapsedMs: 10,
    inputTokens: 20,
    outputTokens: 5,
    answers,
    error: null,
    requestJson: '{}',
    responseJson: '{}',
  };
}
function sample(name: string, amount: number, expectedCategoryId?: Id<'category'> | null): ComparisonSample {
  return {
    transaction: { name, amount, ...(expectedCategoryId !== undefined ? { expectedCategoryId } : {}) },
    expectedSource: expectedCategoryId === undefined ? 'none' : 'provided',
  };
}

function abstention(probability: number): ProviderAnswer {
  return {
    ...answer(null),
    confidence: 0.95,
    selectedProbability: 1 - probability - 0.01,
    alternatives: [
      { categoryId: null, categoryName: 'Uncategorized', probability: 1 - probability - 0.01 },
      { categoryId: shopping, categoryName: 'Daily / Shopping', probability },
      { categoryId: groceries, categoryName: 'Daily / Groceries', probability: 0.01 },
    ],
  };
}

describe('TypeSafe Uncategorized fallback', () => {
  it.each([
    { threshold: 0.2, probability: 0.2, promoted: true },
    { threshold: 0.2, probability: 0.199, promoted: false },
    { threshold: 0.15, probability: 0.18, promoted: true },
    { threshold: 0.2, probability: 0.18, promoted: false },
    { threshold: 0.2, probability: 0.05, promoted: false },
  ])(
    'uses absolute runner-up probability ($probability) at threshold $threshold',
    ({ threshold, probability, promoted }) => {
      const raw = abstention(probability);
      const snapshot = structuredClone(raw);
      const result = applyTypeSafeFallback(raw, threshold);
      expect(result.categoryId).toBe(promoted ? shopping : null);
      if (promoted) expect(result).toMatchObject({ selectedProbability: probability, confidence: null });
      else expect(result).toBe(raw);
      expect(raw).toEqual(snapshot);
    }
  );

  it('leaves errors, actual category choices, missing distributions, and tied category runners-up unchanged', () => {
    const tied = {
      ...abstention(0.2),
      alternatives: [
        { categoryId: null, categoryName: 'Uncategorized', probability: 0.6 },
        { categoryId: shopping, categoryName: 'Shopping', probability: 0.2 },
        { categoryId: groceries, categoryName: 'Groceries', probability: 0.2 },
      ],
    };
    const fixtures = [
      tied,
      { ...abstention(0.2), error: 'Invalid response' },
      { ...abstention(0.2), categoryId: groceries },
      answer(null),
    ];
    for (const raw of fixtures) expect(applyTypeSafeFallback(raw, 0.15)).toBe(raw);
    const disabled = abstention(0.2);
    expect(applyTypeSafeFallback(disabled, null)).toBe(disabled);
  });
});

describe('Plaid comparison normalization', () => {
  it('uses current Plaid hints and retains statement evidence only in the opt-in variant', () => {
    const transaction = {
      name: 'MOBILE PLAN MONTHLY',
      merchant_name: 'Mobile Provider',
      amount: 30,
      category: ['Food and Drink', 'Restaurants'],
      personal_finance_category: {
        primary: 'RENT_AND_UTILITIES',
        detailed: 'RENT_AND_UTILITIES_TELEPHONE',
        confidence_level: 'HIGH',
      },
      expectedCategoryId: shopping,
    };
    expect(normalizePlaidComparisonInput(transaction)?.plaidCategory).toEqual(transaction.category);
    const improved = normalizePlaidComparisonInput(transaction, 'plaid_v2');
    expect(improved).toEqual({
      merchantName: 'mobile provider',
      amountDirection: 'negative',
      plaidCategory: ['RENT AND UTILITIES', 'RENT AND UTILITIES TELEPHONE'],
      transactionContext: {
        statementName: transaction.name,
        bankHintSource: 'personal_finance_category',
        bankHintConfidence: 'HIGH',
      },
    });
    expect(normalizePlaidComparisonInput({ name: 'Store', amount: 1, category: ['Shops'] }, 'plaid_v2')).toMatchObject({
      plaidCategory: ['Shops'],
      transactionContext: { bankHintSource: 'legacy_category' },
    });
  });

  it('converts Plaid purchases and refunds to Kualia direction and uses the import merchant normalizer', () => {
    expect(
      normalizePlaidComparisonInput({
        name: 'Unhelpful statement',
        merchant_name: 'Amazon.com LLC',
        amount: 16.2,
        category: ['Shops'],
      })
    ).toEqual({ merchantName: 'amazoncom', amountDirection: 'negative', plaidCategory: ['Shops'] });
    expect(normalizePlaidComparisonInput({ name: 'AMAZON.COM', amount: -16.2 })?.amountDirection).toBe('positive');
    expect(
      normalizePlaidComparisonInput({ name: 'MTA NYCT PAYGO', merchant_name: '', amount: 8.75 })?.merchantName
    ).toBe('mta nyct paygo');
    expect(normalizePlaidComparisonInput({ name: 'PURCHASE', amount: 10 })).toBeNull();
    expect(() => normalizePlaidComparisonInput({ name: 'Amazon', amount: NaN })).toThrow('finite');
  });
});

describe('compareCategorization', () => {
  it('scores original and fallback choices from the same responses, including wrong and unlabeled fallbacks', async () => {
    const llm = vi.fn(async (merchants: MerchantInput[]) => batch(merchants.map(() => answer(shopping))));
    const typesafe = vi.fn(async (merchants: MerchantInput[]) =>
      batch(merchants.map((merchant) => (merchant.merchantName === 'known' ? answer(shopping) : abstention(0.2))))
    );
    const report = await compareCategorization(
      [
        sample('Market', 10, shopping),
        sample('Cafe', 10, groceries),
        sample('Unknown', 10, null),
        sample('Unlabeled', 10),
        sample('Known', 10, shopping),
      ],
      categories,
      { llm, typesafe },
      'plaid_v2',
      0.2
    );
    expect(llm).toHaveBeenCalledTimes(1);
    expect(typesafe).toHaveBeenCalledTimes(1);
    expect(report.summary).toMatchObject({
      labeled: 4,
      typesafeRaw: { categorized: 1, abstained: 4, correct: 2, accuracy: 0.5 },
      typesafe: { categorized: 5, abstained: 0, correct: 2, accuracy: 0.5 },
      typesafeFallback: { minProbability: 0.2, applied: 4, labeled: 3, correct: 1, incorrect: 2, accuracy: 1 / 3 },
    });
    expect(report.rows[0]).toMatchObject({
      typesafeFallbackApplied: true,
      typesafeRaw: { categoryId: null, confidence: 0.95 },
      typesafe: { categoryId: shopping, confidence: null, selectedProbability: 0.2 },
    });
    expect(report.batches[0].typesafe.answers[0].categoryId).toBeNull();
    expect(report.summary.typesafe.inputTokens).toBe(report.summary.typesafeRaw.inputTokens);
  });

  it('leaves fallback disabled by default and reports unavailable fallback accuracy without labeled promotions', async () => {
    const providers = { llm: async () => batch([answer(shopping)]), typesafe: async () => batch([abstention(0.2)]) };
    const report = await compareCategorization([sample('Market', 10)], categories, providers);
    expect(report.summary.typesafe).toEqual(report.summary.typesafeRaw);
    expect(report.summary.typesafeFallback).toEqual({
      minProbability: null,
      applied: 0,
      labeled: 0,
      correct: null,
      incorrect: null,
      accuracy: null,
    });
    const enabled = await compareCategorization([sample('Market', 10)], categories, providers, 'baseline', 0.2);
    expect(enabled.summary.typesafeFallback).toMatchObject({
      applied: 1,
      labeled: 0,
      correct: null,
      incorrect: null,
      accuracy: null,
    });
  });

  it.each([0, -0.1, 20, NaN, Infinity])(
    'rejects invalid fallback probability %s before making model calls',
    async (threshold) => {
      const provider = vi.fn(async () => batch([]));
      await expect(
        compareCategorization(
          [sample('Market', 10)],
          categories,
          { llm: provider, typesafe: provider },
          'baseline',
          threshold
        )
      ).rejects.toThrow('typesafeFallbackMinProbability');
      expect(provider).not.toHaveBeenCalled();
    }
  );

  it('keeps different statements for the same merchant separate and sends identical unlabeled context to both providers', async () => {
    const llm = vi.fn(async (merchants: MerchantInput[]) => batch(merchants.map(() => answer(shopping))));
    const typesafe = vi.fn(async (merchants: MerchantInput[]) => batch(merchants.map(() => answer(shopping))));
    const purchase = {
      ...sample('STORE MARKETPLACE', 7, shopping),
      transaction: {
        ...sample('STORE MARKETPLACE', 7, shopping).transaction,
        merchant_name: 'Store',
      },
    };
    const subscription = {
      ...purchase,
      transaction: { ...purchase.transaction, name: 'STORE MEMBERSHIP', expectedCategoryId: groceries },
    };
    const report = await compareCategorization(
      [purchase, subscription, purchase],
      categories,
      { llm, typesafe },
      'plaid_v2'
    );
    expect(llm).toHaveBeenCalledTimes(2);
    expect(llm.mock.calls).toEqual(typesafe.mock.calls);
    expect(
      llm.mock.calls.map(([merchants]) => merchants.map((merchant) => merchant.transactionContext?.statementName))
    ).toEqual([['STORE MARKETPLACE'], ['STORE MEMBERSHIP']]);
    expect(JSON.stringify(llm.mock.calls)).not.toContain('expectedCategoryId');
    expect(JSON.stringify(llm.mock.calls)).not.toContain('"amount":');
    expect(report.variant).toBe('plaid_v2');
    expect(report.summary.uniqueMerchants).toBe(2);
    expect(report.summary.labeled).toBe(3);
  });

  it('keeps purchase/refund decisions separate, deduplicates merchants, and hides expected labels from both providers', async () => {
    const provider = vi.fn(async (merchants: MerchantInput[]) =>
      batch(merchants.map((merchant) => answer(merchant.amountDirection === 'negative' ? shopping : groceries)))
    );
    const report = await compareCategorization(
      [sample('Amazon', 16, shopping), sample('Amazon', 22), sample('Amazon', -16, groceries)],
      categories,
      { llm: provider, typesafe: provider }
    );
    expect(provider).toHaveBeenCalledTimes(4);
    expect(provider.mock.calls.map(([merchants]) => merchants[0].amountDirection)).toEqual([
      'negative',
      'negative',
      'positive',
      'positive',
    ]);
    expect(provider.mock.calls[0][0]).toEqual([
      { merchantName: 'amazon', amountDirection: 'negative', plaidCategory: [] },
    ]);
    expect(report.rows.map((row) => row.llm.categoryId)).toEqual([shopping, shopping, groceries]);
    expect(report.summary).toMatchObject({
      transactions: 3,
      uniqueMerchants: 2,
      agreements: 3,
      labeled: 2,
      llm: { accuracy: 1, correct: 2, inputTokens: 40 },
    });
  });

  it('distinguishes service errors from abstention and excludes errors from agreement', async () => {
    const report = await compareCategorization([sample('Unknown', 1, null)], categories, {
      llm: async () => batch([answer(null)]),
      typesafe: async () => {
        throw new Error('TypeSafe unavailable');
      },
    });
    expect(report.summary).toMatchObject({
      comparable: 0,
      agreements: 0,
      disagreements: 0,
      llm: { abstained: 1, errors: 0, accuracy: 1 },
      typesafe: { abstained: 0, errors: 1, accuracy: 0 },
    });
    expect(report.rows[0].agrees).toBeNull();
  });

  it('does not present unlabeled agreement as accuracy and retains disagreements', async () => {
    const report = await compareCategorization([sample('Costco', 70)], categories, {
      llm: async () => batch([answer(shopping)]),
      typesafe: async () => batch([answer(groceries)]),
    });
    expect(report.summary).toMatchObject({
      disagreements: 1,
      labeled: 0,
      llm: { accuracy: null, correct: null },
      typesafe: { accuracy: null, correct: null },
    });
  });

  it('separates mutual abstentions from category matches and identifies repeated merchant errors', async () => {
    const cvsError = { ...answer(null), error: 'Invalid probability total' };
    const report = await compareCategorization(
      [sample('CVS', 10), sample('CVS', 20), sample('CVS', 30), sample('Shop', 10), sample('Unknown', 10)],
      categories,
      {
        llm: async () => batch([answer(shopping), answer(shopping), answer(null)]),
        typesafe: async () => batch([cvsError, answer(shopping), answer(null)]),
      }
    );
    expect(report.summary).toMatchObject({
      transactions: 5,
      uniqueMerchants: 3,
      agreements: 2,
      categoryAgreements: 1,
      bothAbstained: 1,
      comparable: 2,
      typesafe: {
        errors: 3,
        errorDetails: [{ message: 'Invalid probability total', transactions: 3, uniqueMerchants: 1 }],
      },
    });
  });

  it('rejects foreign expected categories and oversized input before calling either provider', async () => {
    const provider = vi.fn(async () => batch([]));
    await expect(
      compareCategorization([sample('Store', 1, 'foreign' as Id<'category'>)], categories, {
        llm: provider,
        typesafe: provider,
      })
    ).rejects.toThrow('this workspace');
    await expect(
      compareCategorization(
        Array.from({ length: 51 }, () => sample('Store', 1)),
        categories,
        { llm: provider, typesafe: provider }
      )
    ).rejects.toThrow('50');
    expect(provider).not.toHaveBeenCalled();
  });

  it('does not call the providers when import normalization removes the entire merchant name', async () => {
    const provider = vi.fn(async () => batch([]));
    const report = await compareCategorization([sample('PURCHASE', 10)], categories, {
      llm: provider,
      typesafe: provider,
    });
    expect(provider).not.toHaveBeenCalled();
    expect(report.summary.llm.errors).toBe(1);
  });
});
