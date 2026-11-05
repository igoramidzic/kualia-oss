import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CategoryInput, MerchantInput } from './helpers';
import { buildTypeSafeRequest, categorizeWithLlm, categorizeWithTypeSafe } from './providers';

const categories: CategoryInput[] = [{ id: 'transit', name: 'Public Transit', groupName: 'Transport' }];
const merchants: MerchantInput[] = [
  { merchantName: 'mta', amountDirection: 'negative', plaidCategory: ['Travel', 'Public Transportation Services'] },
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('TypeSafe provider', () => {
  it('maps readable options back to IDs, including duplicate category names, without exposing database IDs to Jev', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', 'test-key');
    const duplicateNames = [...categories, { ...categories[0], id: 'transit-2' }];
    const contextual = [
      {
        ...merchants[0],
        transactionContext: {
          statementName: 'MTA NYCT PAYGO',
          bankHintSource: 'personal_finance_category' as const,
          bankHintConfidence: 'HIGH',
        },
      },
    ];
    const request = buildTypeSafeRequest(contextual, duplicateNames, 'plaid_v2');
    const keys = Object.keys(request.questions.merchant_0.criteria);
    expect(keys).toEqual(['1: Transport / Public Transit', '2: Transport / Public Transit', 'uncategorized']);
    expect(JSON.stringify(request)).not.toContain('transit-2');
    expect(request.state.merchants[0].transactionContext).toEqual(contextual[0].transactionContext);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              model: 'jev-1.13.0',
              usage: { input_tokens: 10, output_tokens: 10 },
              answers: {
                merchant_0: {
                  type: 'choice',
                  choice: keys[1],
                  confidence: 0.9,
                  probabilities: { [keys[0]]: 0.1, [keys[1]]: 0.9, [keys[2]]: 0 },
                },
              },
            }),
            { status: 200 }
          )
      )
    );
    const result = await categorizeWithTypeSafe(contextual, duplicateNames, 'plaid_v2');
    expect(result.answers[0]).toMatchObject({
      categoryId: 'transit-2',
      selectedProbability: 0.9,
      error: null,
      alternatives: [{ categoryId: 'transit-2' }, { categoryId: 'transit' }, { categoryId: null }],
    });
  });

  it('asks all merchant questions in one request, with explicit field paths and an abstention option', () => {
    const request = buildTypeSafeRequest([...merchants, { ...merchants[0], merchantName: 'amtrak' }], categories);
    expect(Object.keys(request.questions)).toEqual(['merchant_0', 'merchant_1']);
    expect(request.questions.merchant_1.instructions).toContain('`merchants[1]`');
    expect(request.questions.merchant_0.criteria).toMatchObject({
      transit: 'Public Transit in budget group Transport',
      uncategorized: expect.any(String),
    });
    expect(request.state.merchants).toHaveLength(2);
    expect(() =>
      buildTypeSafeRequest(
        merchants,
        Array.from({ length: 255 }, (_, i) => ({ ...categories[0], id: `category_${i}` }))
      )
    ).toThrow('254');
  });

  it('uses the real SDK transport and returns model, usage, probabilities, and raw responses', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', 'test-key');
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: 'jev-1.13.0',
            usage: { input_tokens: 120, output_tokens: 20 },
            answers: {
              merchant_0: {
                type: 'choice',
                choice: 'transit',
                confidence: 0.8,
                probabilities: { transit: 0.9, uncategorized: 0.1 },
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );
    vi.stubGlobal('fetch', fetch);
    const result = await categorizeWithTypeSafe(merchants, categories);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ model: 'jev-1.13.0', inputTokens: 120, outputTokens: 20, error: null });
    expect(result.answers[0]).toMatchObject({
      categoryId: 'transit',
      confidence: 0.8,
      selectedProbability: 0.9,
      error: null,
      alternatives: [
        { categoryId: 'transit', probability: 0.9 },
        { categoryId: null, probability: 0.1 },
      ],
    });
    expect(result.requestJson).not.toContain('test-key');
    expect(JSON.parse(result.responseJson ?? '{}').model).toBe('jev-1.13.0');
  });

  it.each([
    { choice: 'foreign', confidence: 0.9, probabilities: { foreign: 1 } },
    { choice: 'transit', confidence: 0.9, probabilities: { transit: 0.8, uncategorized: 0.8 } },
    { choice: 'transit', confidence: 2, probabilities: { transit: 1, uncategorized: 0 } },
    { choice: 'transit', confidence: 0.9, probabilities: { transit: 1 } },
    { choice: 'transit', confidence: 0.9, probabilities: { transit: 0.6, uncategorized: 0.38 } },
  ])('rejects invalid response values instead of treating them as categories', async (answer) => {
    vi.stubEnv('TYPESAFE_API_KEY', 'test-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              model: 'jev-1.13.0',
              usage: { input_tokens: 1, output_tokens: 1 },
              answers: { merchant_0: { type: 'choice', ...answer } },
            }),
            { status: 200 }
          )
      )
    );
    const result = await categorizeWithTypeSafe(merchants, categories);
    expect(result.answers[0].error).toBeTruthy();
    expect(result.answers[0].categoryId).toBeNull();
  });

  it.each([0.33, 0.35])('accepts rounded totals at the 0.99/1.01 boundary (second probability %s)', async (other) => {
    vi.stubEnv('TYPESAFE_API_KEY', 'test-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              model: 'jev-1.13.0',
              usage: { input_tokens: 1, output_tokens: 1 },
              answers: {
                merchant_0: {
                  type: 'choice',
                  choice: 'transit',
                  confidence: 0.5,
                  probabilities: { transit: 0.66, uncategorized: other },
                },
              },
            }),
            { status: 200 }
          )
      )
    );
    const result = await categorizeWithTypeSafe(merchants, categories);
    expect(result.answers[0]).toMatchObject({ categoryId: 'transit', error: null });
    expect(result.answers[0].alternatives.map((option) => option.probability)).toEqual([0.66, other]);
  });

  it('reports a missing API key without making a network call', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', '');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const result = await categorizeWithTypeSafe(merchants, categories);
    expect(result.error).toContain('TYPESAFE_API_KEY');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('LLM comparison provider', () => {
  it('reuses the production prompt/parser and records token usage and explanations', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-openrouter');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: 'completion',
              object: 'chat.completion',
              created: 0,
              model: 'google/gemini-2.5-flash',
              usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
              choices: [
                {
                  index: 0,
                  finish_reason: 'stop',
                  message: {
                    role: 'assistant',
                    content: JSON.stringify({
                      results: [
                        { merchantName: 'mta', categoryId: 'transit', confidence: 0.95, reason: 'Public transit' },
                      ],
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
      )
    );
    const result = await categorizeWithLlm(merchants, categories);
    expect(result).toMatchObject({ inputTokens: 100, outputTokens: 25, error: null });
    expect(result.answers[0]).toMatchObject({ categoryId: 'transit', confidence: 0.95, reason: 'Public transit' });
    expect(JSON.parse(result.requestJson).messages[1].content).toContain('Public Transportation Services');
  });
});
