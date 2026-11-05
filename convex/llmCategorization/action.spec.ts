import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { getPostHogClient, shutdownPostHog } from '../lib/posthog';
import { categorizeMerchantsWithLLM } from './action';
import { failedAnswer, type ProviderAnswer, type ProviderBatch } from './comparison';
import type { LLMCategorizationResult, MerchantInput } from './helpers';
import { callOpenRouterUntracked, categorizeWithTypeSafe } from './providers';

vi.mock('../lib/posthog', () => ({ getPostHogClient: vi.fn(() => null), shutdownPostHog: vi.fn() }));
vi.mock('./providers', () => ({ callOpenRouterUntracked: vi.fn(), categorizeWithTypeSafe: vi.fn() }));
const workspaceId = 'workspace' as Id<'workspace'>;
const expense = 'expense' as Id<'category'>;
const refund = 'refund' as Id<'category'>;
const handler = (
  categorizeMerchantsWithLLM as unknown as {
    _handler: (
      ctx: ActionCtx,
      args: { workspaceId: Id<'workspace'>; merchants: MerchantInput[] }
    ) => Promise<LLMCategorizationResult[]>;
  }
)._handler;
function context() {
  const runQuery = vi.fn(async () => [
    {
      group: { name: 'Daily' },
      categories: [
        { _id: expense, name: 'Shopping' },
        { _id: refund, name: 'Refunds' },
      ],
    },
  ]);
  const runMutation = vi.fn();
  return { ctx: { runQuery, runMutation } as unknown as ActionCtx, runQuery, runMutation };
}
function choice(categoryId: Id<'category'> | null, probability = 0.8): ProviderAnswer {
  return {
    categoryId,
    categoryName: categoryId ?? 'Uncategorized',
    confidence: 0.91,
    selectedProbability: probability,
    reason: null,
    error: null,
    alternatives: [
      { categoryId, categoryName: categoryId ?? 'Uncategorized', probability },
      {
        categoryId: categoryId ? null : expense,
        categoryName: categoryId ? 'Uncategorized' : 'Shopping',
        probability: 0.2,
      },
    ],
  };
}
function batch(answers: ProviderAnswer[]): ProviderBatch {
  return {
    model: 'jev-1.13.0',
    answers,
    elapsedMs: 10,
    inputTokens: 40,
    outputTokens: 20,
    error: null,
    requestJson: '{}',
    responseJson: '{}',
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubEnv('TYPESAFE_API_KEY', 'test-key');
  vi.stubEnv('OPENROUTER_API_KEY', '');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('live Jev categorization', () => {
  it('uses approved inputs and fallback, persists probability/provenance, and keeps purchase/refund directions separate', async () => {
    vi.mocked(categorizeWithTypeSafe).mockImplementation(async (merchants) =>
      batch(
        merchants.map((merchant) => {
          if (merchant.merchantName === 'error') return failedAnswer('Timeout');
          if (merchant.merchantName === 'fallback') return choice(null);
          if (merchant.merchantName === 'unknown')
            return {
              ...choice(null, 0.9),
              alternatives: [
                { categoryId: null, categoryName: 'Uncategorized', probability: 0.9 },
                { categoryId: expense, categoryName: 'Shopping', probability: 0.1 },
              ],
            };
          return choice(merchant.amountDirection === 'negative' ? expense : refund);
        })
      )
    );
    const { ctx, runMutation } = context();
    const merchants: MerchantInput[] = ['coffee', 'fallback', 'unknown', 'error'].map((merchantName) => ({
      merchantName,
      amountDirection: 'negative',
      transactionContext: {
        statementName: 'Full statement',
        bankHintSource: 'personal_finance_category',
        bankHintConfidence: 'HIGH',
      },
    }));
    merchants.push({ merchantName: 'coffee', amountDirection: 'positive' });
    const results = await handler(ctx, { workspaceId, merchants });
    expect(results.map((row) => row.categoryId)).toEqual([expense, expense, null, null, refund]);
    expect(results[1].confidence).toBe(0.2);
    expect(categorizeWithTypeSafe).toHaveBeenCalledTimes(2);
    expect(vi.mocked(categorizeWithTypeSafe).mock.calls.every((call) => call[2] === 'plaid_v2')).toBe(true);
    expect(vi.mocked(categorizeWithTypeSafe).mock.calls[0][0][0].transactionContext).toEqual(
      merchants[0].transactionContext
    );
    expect(callOpenRouterUntracked).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      workspaceId,
      source: 'typesafe',
      results: [
        expect.objectContaining({
          merchantName: 'coffee',
          categoryId: expense,
          amountDirection: 'negative',
          usedFallback: false,
        }),
        expect.objectContaining({
          merchantName: 'fallback',
          confidence: 0.2,
          model: 'jev-1.13.0',
          modelConfidence: 0.91,
          usedFallback: true,
          failed: false,
        }),
        expect.objectContaining({ merchantName: 'unknown', categoryId: null, failed: true }),
        expect.objectContaining({ merchantName: 'coffee', categoryId: refund, amountDirection: 'positive' }),
      ],
    });
  });

  it('returns uncategorized during a Jev outage without calling Gemini or poisoning mappings', async () => {
    vi.mocked(categorizeWithTypeSafe).mockRejectedValue(new Error('Jev unavailable'));
    const { ctx, runMutation } = context();
    const results = await handler(ctx, {
      workspaceId,
      merchants: [{ merchantName: 'shop', amountDirection: 'negative' }],
    });
    expect(results).toEqual([{ merchantName: 'shop', categoryId: null, confidence: 0, reason: 'Jev unavailable' }]);
    expect(runMutation).not.toHaveBeenCalled();
    expect(callOpenRouterUntracked).not.toHaveBeenCalled();
  });

  it('skips calls and writes when the TypeSafe key is absent', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', '');
    const { ctx, runMutation, runQuery } = context();
    const results = await handler(ctx, {
      workspaceId,
      merchants: [{ merchantName: 'shop', amountDirection: 'negative' }],
    });
    expect(results[0].reason).toContain('TYPESAFE_API_KEY');
    expect(runMutation).not.toHaveBeenCalled();
    expect(runQuery).not.toHaveBeenCalled();
    expect(categorizeWithTypeSafe).not.toHaveBeenCalled();
    expect(callOpenRouterUntracked).not.toHaveBeenCalled();
  });

  it('continues storing successful choices when analytics capture or flush fails', async () => {
    vi.mocked(getPostHogClient).mockImplementation(() => {
      throw new Error('Analytics down');
    });
    vi.mocked(shutdownPostHog).mockRejectedValue(new Error('Flush failed'));
    vi.mocked(categorizeWithTypeSafe).mockResolvedValue(batch([choice(expense)]));
    const { ctx, runMutation } = context();
    expect(
      (await handler(ctx, { workspaceId, merchants: [{ merchantName: 'shop', amountDirection: 'negative' }] }))[0]
        .categoryId
    ).toBe(expense);
    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  it('bounds API concurrency to two batches', async () => {
    let running = 0;
    let peak = 0;
    vi.mocked(categorizeWithTypeSafe).mockImplementation(async (merchants) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
      running--;
      return batch(merchants.map(() => choice(expense)));
    });
    const { ctx } = context();
    const results = await handler(ctx, {
      workspaceId,
      merchants: Array.from({ length: 81 }, (_, i) => ({ merchantName: `shop-${i}`, amountDirection: 'negative' })),
    });
    expect(results).toHaveLength(81);
    expect(peak).toBe(2);
    expect(categorizeWithTypeSafe).toHaveBeenCalledTimes(5);
  });
});
