import { describe, expect, it } from 'vitest';

import { normalizeCategoryName, parseAndValidateResponse, type CategoryInput, type MerchantInput } from './helpers';

const DINING_ID = 'cat_dining_id_123';
const NETFLIX_ID = 'cat_netflix_id_456';
const GROCERIES_ID = 'cat_groceries_id_789';

const categories: CategoryInput[] = [
  { id: DINING_ID, name: '🍔 Dining Out', groupName: 'Day to Day' },
  { id: NETFLIX_ID, name: '🍿 Netflix', groupName: 'Monthly Bills' },
  { id: GROCERIES_ID, name: '🛒 Groceries', groupName: 'Day to Day' },
];

const validCategoryIds = new Set<string>([DINING_ID, NETFLIX_ID, GROCERIES_ID]);

const merchants: MerchantInput[] = [
  { merchantName: 'aplpay chipotle', amountDirection: 'negative' },
  { merchantName: 'netflixcom', amountDirection: 'negative' },
  { merchantName: 'aplpay publix 1534', amountDirection: 'negative' },
  { merchantName: 'xyz garbage code', amountDirection: 'negative' },
];

function fakeResponse(results: unknown[]): unknown {
  return {
    choices: [{ message: { content: JSON.stringify({ results }) } }],
  };
}

describe('normalizeCategoryName', () => {
  it('strips leading emoji and whitespace', () => {
    expect(normalizeCategoryName('🍔 Dining Out')).toBe('dining out');
  });

  it('is a no-op for plain names', () => {
    expect(normalizeCategoryName('Dining Out')).toBe('dining out');
  });

  it('is case-insensitive', () => {
    expect(normalizeCategoryName('DINING OUT')).toBe('dining out');
  });
});

describe('parseAndValidateResponse name fallback', () => {
  it('accepts an exact doc-id match (the happy path)', () => {
    const response = fakeResponse([
      { merchantName: 'aplpay chipotle', categoryId: DINING_ID, confidence: 0.9, reason: 'Chipotle -> Dining Out' },
    ]);
    const out = parseAndValidateResponse(response, [merchants[0]], validCategoryIds, categories);
    expect(out).toHaveLength(1);
    expect(out[0].categoryId).toBe(DINING_ID);
  });

  it('falls back to category name match when the model returns the bare name', () => {
    const response = fakeResponse([
      { merchantName: 'aplpay chipotle', categoryId: 'Dining Out', confidence: 0.9, reason: 'Chipotle -> Dining Out' },
    ]);
    const out = parseAndValidateResponse(response, [merchants[0]], validCategoryIds, categories);
    expect(out[0].categoryId).toBe(DINING_ID);
  });

  it('falls back when the model returns the emoji-prefixed name', () => {
    const response = fakeResponse([
      { merchantName: 'netflixcom', categoryId: '🍿 Netflix', confidence: 0.95, reason: 'Direct match' },
    ]);
    const out = parseAndValidateResponse(response, [merchants[1]], validCategoryIds, categories);
    expect(out[0].categoryId).toBe(NETFLIX_ID);
  });

  it('parses the trailing "-> Category" suffix from reason when categoryId is null', () => {
    const response = fakeResponse([
      {
        merchantName: 'aplpay publix 1534',
        categoryId: null,
        confidence: 0.85,
        reason: 'Publix is a grocery store -> Groceries',
      },
    ]);
    const out = parseAndValidateResponse(response, [merchants[2]], validCategoryIds, categories);
    expect(out[0].categoryId).toBe(GROCERIES_ID);
  });

  it('still returns null for genuinely unmatched category ids', () => {
    const response = fakeResponse([
      { merchantName: 'xyz garbage code', categoryId: 'NotARealCategory', confidence: 0.0, reason: 'Unrecognizable' },
    ]);
    const out = parseAndValidateResponse(response, [merchants[3]], validCategoryIds, categories);
    expect(out[0].categoryId).toBeNull();
  });

  it('recovers a 20-merchant batch where every categoryId is the bare name (the original bug)', () => {
    const big: MerchantInput[] = [
      { merchantName: 'aplpay chipotle', amountDirection: 'negative' },
      { merchantName: 'netflixcom', amountDirection: 'negative' },
      { merchantName: 'aplpay publix 1534', amountDirection: 'negative' },
    ];
    const response = fakeResponse([
      { merchantName: 'aplpay chipotle', categoryId: 'Dining Out', confidence: 0.9 },
      { merchantName: 'netflixcom', categoryId: 'Netflix', confidence: 0.95 },
      { merchantName: 'aplpay publix 1534', categoryId: 'Groceries', confidence: 0.85 },
    ]);
    const out = parseAndValidateResponse(response, big, validCategoryIds, categories);
    expect(out.filter((r) => r.categoryId !== null)).toHaveLength(3);
  });

  it('fills in missing merchants with null results', () => {
    const response = fakeResponse([{ merchantName: 'aplpay chipotle', categoryId: DINING_ID, confidence: 0.9 }]);
    const out = parseAndValidateResponse(response, merchants, validCategoryIds, categories);
    expect(out).toHaveLength(merchants.length);
    expect(out.find((r) => r.merchantName === 'netflixcom')?.categoryId).toBeNull();
  });

  it('matches emoji-preserved name verbatim (the most common LLM output shape)', () => {
    const response = fakeResponse([{ merchantName: 'aplpay chipotle', categoryId: '🍔 Dining Out', confidence: 0.9 }]);
    const out = parseAndValidateResponse(response, [merchants[0]], validCategoryIds, categories);
    expect(out[0].categoryId).toBe(DINING_ID);
  });

  it('refuses ambiguous emoji-stripped fallback when two categories share a base name', () => {
    // Two categories whose names differ only by emoji — common in real configs.
    const RUNNING_ID = 'cat_running_id';
    const STRENGTH_ID = 'cat_strength_id';
    const collisionCategories: CategoryInput[] = [
      { id: RUNNING_ID, name: '🏃 Fitness', groupName: 'Day to Day' },
      { id: STRENGTH_ID, name: '💪 Fitness', groupName: 'Day to Day' },
    ];
    const collisionValid = new Set<string>([RUNNING_ID, STRENGTH_ID]);
    const merchant: MerchantInput = { merchantName: 'gym charge', amountDirection: 'negative' };

    // Bare "Fitness" is ambiguous → must NOT pick one at random.
    const ambiguous = fakeResponse([{ merchantName: 'gym charge', categoryId: 'Fitness', confidence: 0.7 }]);
    const ambiguousOut = parseAndValidateResponse(ambiguous, [merchant], collisionValid, collisionCategories);
    expect(ambiguousOut[0].categoryId).toBeNull();

    // But explicit "💪 Fitness" must still match its specific id.
    const explicit = fakeResponse([{ merchantName: 'gym charge', categoryId: '💪 Fitness', confidence: 0.9 }]);
    const explicitOut = parseAndValidateResponse(explicit, [merchant], collisionValid, collisionCategories);
    expect(explicitOut[0].categoryId).toBe(STRENGTH_ID);
  });
});
