import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { BENCHMARK_INFO, BENCHMARK_WORKSPACE_ID } from './benchmark';
import type { ComparisonReport, PlaidComparisonTransaction, ProviderBatch } from './comparison';
import { simulatePlaidImport } from './comparisonActions';
import { categorizeWithLlm, categorizeWithTypeSafe } from './providers';

vi.mock('./providers', () => ({ categorizeWithLlm: vi.fn(), categorizeWithTypeSafe: vi.fn() }));

const workspaceId = 'workspace' as Id<'workspace'>;
const categoryId = 'transit' as Id<'category'>;
const handler = (
  simulatePlaidImport as unknown as {
    _handler: (
      ctx: ActionCtx,
      args: {
        workspaceId: Id<'workspace'>;
        transactions?: PlaidComparisonTransaction[];
        limit?: number;
        includeRequests?: boolean;
        source?: 'benchmark' | 'recent';
        variant?: 'baseline' | 'plaid_v2';
        typesafeFallbackMinProbability?: number | null;
      }
    ) => Promise<ComparisonReport>;
  }
)._handler;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const batch: ProviderBatch = {
    model: 'test',
    elapsedMs: 1,
    inputTokens: 2,
    outputTokens: 3,
    error: null,
    requestJson: 'request body',
    responseJson: 'response body',
    answers: [{ categoryId, categoryName: 'Transit', confidence: 1, reason: null, alternatives: [], error: null }],
  };
  vi.mocked(categorizeWithLlm).mockImplementation(async () => structuredClone(batch));
  vi.mocked(categorizeWithTypeSafe).mockImplementation(async () => structuredClone(batch));
});
afterEach(() => vi.restoreAllMocks());

describe('simulatePlaidImport', () => {
  it('accepts an opt-in fallback threshold while preserving the original provider response', async () => {
    const raw: ProviderBatch = {
      model: 'jev',
      elapsedMs: 1,
      inputTokens: 2,
      outputTokens: 3,
      error: null,
      requestJson: 'request body',
      responseJson: 'raw response',
      answers: [
        {
          categoryId: null,
          categoryName: 'Uncategorized',
          confidence: 0.8,
          reason: null,
          error: null,
          selectedProbability: 0.8,
          alternatives: [
            { categoryId: null, categoryName: 'Uncategorized', probability: 0.8 },
            { categoryId, categoryName: 'Transit', probability: 0.2 },
          ],
        },
      ],
    };
    vi.mocked(categorizeWithTypeSafe).mockResolvedValueOnce(raw);
    const runQuery = vi.fn(async () => ({
      categories: [{ id: categoryId, name: 'Transit', groupName: 'Transport' }],
      samples: [],
    }));
    const report = await handler({ runQuery } as unknown as ActionCtx, {
      workspaceId,
      variant: 'plaid_v2',
      typesafeFallbackMinProbability: 0.2,
      includeRequests: true,
      transactions: [{ name: 'MTA', amount: 8.75, expectedCategoryId: categoryId }],
    });
    expect(report.summary.typesafeFallback).toMatchObject({ minProbability: 0.2, applied: 1, correct: 1, accuracy: 1 });
    expect(report.summary.typesafeRaw.correct).toBe(0);
    expect(report.summary.typesafe.correct).toBe(1);
    expect(report.batches[0].typesafe.responseJson).toBe('raw response');
    expect(raw.answers[0].categoryId).toBeNull();
  });

  it('routes the opt-in variant to both providers with the same context and reports its version', async () => {
    const runQuery = vi.fn(async () => ({
      categories: [{ id: categoryId, name: 'Transit', groupName: 'Transport' }],
      samples: [],
    }));
    const report = await handler({ runQuery } as unknown as ActionCtx, {
      workspaceId,
      variant: 'plaid_v2',
      transactions: [{ name: 'MTA PAYGO', merchant_name: 'MTA', amount: 8.75 }],
    });
    expect(report.variant).toBe('plaid_v2');
    const calls = vi.mocked(categorizeWithLlm).mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall?.[0][0].transactionContext?.statementName).toBe('MTA PAYGO');
    expect(categorizeWithTypeSafe).toHaveBeenLastCalledWith(lastCall?.[0], lastCall?.[1], 'plaid_v2');
  });

  it('calls only a read query and both providers; it never invokes mutations or the import action', async () => {
    const runQuery = vi.fn(async () => ({
      categories: [{ id: categoryId, name: 'Transit', groupName: 'Transport' }],
      samples: [],
    }));
    const runMutation = vi.fn();
    const runAction = vi.fn();
    const ctx = { runQuery, runMutation, runAction } as unknown as ActionCtx;
    const report = await handler(ctx, {
      workspaceId,
      transactions: [{ name: 'MTA', amount: 8.75, expectedCategoryId: categoryId }],
    });
    expect(runQuery.mock.calls).toHaveLength(1);
    expect(runMutation).not.toHaveBeenCalled();
    expect(runAction).not.toHaveBeenCalled();
    expect(categorizeWithLlm).toHaveBeenCalled();
    expect(categorizeWithTypeSafe).toHaveBeenCalled();
    expect(report.summary.llm.accuracy).toBe(1);
    expect(report.batches[0].typesafe.responseJson).toBeNull();
    expect(report.batches[0].llm.requestJson).toBe('');
  });

  it('supports explicit recent-import mode and returns request/response details only when requested', async () => {
    const runQuery = vi.fn(async () => ({
      categories: [{ id: categoryId, name: 'Transit', groupName: 'Transport' }],
      samples: [{ transaction: { name: 'MTA', amount: 8.75 }, expectedSource: 'none' }],
    }));
    const report = await handler({ runQuery } as unknown as ActionCtx, {
      workspaceId,
      limit: 1,
      includeRequests: true,
      source: 'recent',
    });
    expect(runQuery).toHaveBeenCalledWith(expect.anything(), { workspaceId, limit: 1, source: 'recent' });
    expect(report.batches[0].typesafe.responseJson).toBe('response body');
    expect(report.summary.labeled).toBe(0);
  });

  it('defaults to 20 fixed labeled cases and returns benchmark provenance', async () => {
    const runQuery = vi.fn(async () => ({
      categories: [{ id: categoryId, name: 'Transit', groupName: 'Transport' }],
      samples: [
        {
          transaction: { name: 'MTA', amount: 8.75, expectedCategoryId: categoryId },
          expectedSource: 'benchmark_snapshot',
        },
      ],
      benchmark: BENCHMARK_INFO,
    }));
    const result = await handler({ runQuery } as unknown as ActionCtx, { workspaceId: BENCHMARK_WORKSPACE_ID });
    expect(runQuery).toHaveBeenCalledWith(expect.anything(), {
      workspaceId: BENCHMARK_WORKSPACE_ID,
      limit: 20,
      source: 'benchmark',
    });
    expect(result.benchmark).toEqual(BENCHMARK_INFO);
    expect(result.summary.labeled).toBe(1);
    expect(result.summary.llm.correct).toBe(1);
    expect(result.summary.typesafe.accuracy).toBe(1);
  });

  it('rejects ambiguous custom-input and dataset selection before reading data', async () => {
    const runQuery = vi.fn();
    await expect(
      handler({ runQuery } as unknown as ActionCtx, {
        workspaceId,
        source: 'benchmark',
        transactions: [{ name: 'MTA', amount: 8.75 }],
      })
    ).rejects.toThrow('not both');
    expect(runQuery).not.toHaveBeenCalled();
  });
});
