import { describe, expect, it } from 'vitest';

import type { Id } from '../_generated/dataModel';
import { BENCHMARK_INFO, BENCHMARK_WORKSPACE_ID, loadCategorizationBenchmark } from './benchmark';
import { merchantKey, normalizePlaidComparisonInput } from './comparison';

describe('fixed reviewed categorization benchmark', () => {
  it('contains 50 dated, labeled, unique source transactions and representative fixed prefixes', () => {
    const all = loadCategorizationBenchmark(BENCHMARK_WORKSPACE_ID, 50);
    const first20 = loadCategorizationBenchmark(BENCHMARK_WORKSPACE_ID, 20);
    expect(all.samples).toHaveLength(BENCHMARK_INFO.availableTransactions);
    expect(first20.samples).toEqual(all.samples.slice(0, 20));
    expect(new Set(all.samples.map((sample) => sample.transaction.transaction_id)).size).toBe(50);
    expect(new Set(first20.samples.map((sample) => sample.transaction.expectedCategoryId)).size).toBe(20);
    expect(new Set(all.samples.map((sample) => sample.transaction.expectedCategoryId)).size).toBe(26);
    const categoryIds = new Set(all.categories.map((category) => category.id));
    for (const sample of all.samples) {
      expect(sample.expectedSource).toBe('benchmark_snapshot');
      expect(categoryIds.has(sample.transaction.expectedCategoryId as Id<'category'>)).toBe(true);
      expect(sample.transaction.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect((sample.transaction.date ?? '') <= BENCHMARK_INFO.cutoffDate).toBe(true);
      expect(normalizePlaidComparisonInput(sample.transaction)).not.toBeNull();
    }
    expect(all.samples.some((sample) => sample.transaction.amount < 0)).toBe(true);
  });

  it('excludes opaque Apple charges and personal-intent labels while keeping recognizable difficult merchants', () => {
    const all = loadCategorizationBenchmark(BENCHMARK_WORKSPACE_ID, 50);
    expect(all.benchmark.id).toBe('reviewed-categorization-2026-09-21-v2');
    const labelsByInput = new Map<string, string>();
    for (const { transaction } of all.samples) {
      expect(transaction.merchant_name?.toLowerCase() ?? '').not.toContain('apple');
      expect(transaction.name.toUpperCase()).not.toMatch(/APPLE\.COM|APPLE CASH|ZELLE/);
      const input = normalizePlaidComparisonInput(transaction, 'plaid_v2');
      expect(input).not.toBeNull();
      if (!input) continue;
      const key = merchantKey(input);
      const existing = labelsByInput.get(key);
      if (existing) expect(transaction.expectedCategoryId).toBe(existing);
      labelsByInput.set(key, transaction.expectedCategoryId ?? '');
    }
    const names = all.samples.map(({ transaction }) => transaction.merchant_name);
    expect(names).toEqual(expect.arrayContaining(['Mint Mobile', 'BYLT Basics HQ', 'Fandango']));
  });

  it('returns independent copies so later consumers cannot alter the frozen inputs or answers', () => {
    const original = loadCategorizationBenchmark(BENCHMARK_WORKSPACE_ID, 20);
    const changed = loadCategorizationBenchmark(BENCHMARK_WORKSPACE_ID, 20);
    changed.samples[0].transaction.name = 'Changed';
    changed.samples[0].transaction.category?.push('Injected hint');
    changed.samples[0].transaction.expectedCategoryId = null;
    changed.categories[0].name = 'Changed';
    changed.benchmark.id = 'Changed';
    expect(loadCategorizationBenchmark(BENCHMARK_WORKSPACE_ID, 20)).toEqual(original);
  });

  it('rejects a different workspace and invalid counts instead of silently changing the sample', () => {
    expect(() => loadCategorizationBenchmark('other-workspace' as Id<'workspace'>, 20)).toThrow('different workspace');
    for (const limit of [0, -1, 1.5, 51, NaN]) {
      expect(() => loadCategorizationBenchmark(BENCHMARK_WORKSPACE_ID, limit)).toThrow('integer from 1 to 50');
    }
    expect(loadCategorizationBenchmark(BENCHMARK_WORKSPACE_ID, 1).samples).toHaveLength(1);
  });
});
