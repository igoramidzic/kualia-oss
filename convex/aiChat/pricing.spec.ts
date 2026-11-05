import { describe, expect, it } from 'vitest';

import { computeCost } from './pricing';

describe('computeCost', () => {
  it('includes Gemini 3.8 Flash replies in spending totals with discounted cached input', () => {
    const result = computeCost('google/gemini-3.8-flash', 1_000_000, 1_000_000, 200_000);
    expect(result.priced).toBe(true);
    expect(result.costInputUsd).toBeCloseTo(0.6, 6);
    expect(result.costCachedInputUsd).toBeCloseTo(0.015, 6);
    expect(result.costOutputUsd).toBeCloseTo(3.75, 6);
    expect(result.costTotalUsd).toBeCloseTo(4.365, 6);
  });

  it('reports priced=false and zero cost for unknown models so they bypass the spend cap', () => {
    const result = computeCost('openai/gpt-mystery', 1_000_000, 1_000_000, 0);
    expect(result.priced).toBe(false);
    expect(result.costTotalUsd).toBe(0);
  });

  it('charges the cached-input rate for cached tokens and the base rate for the rest', () => {
    const result = computeCost('google/gemini-3.8-flash', 1_000_000, 0, 200_000);
    expect(result.priced).toBe(true);
    expect(result.costInputUsd).toBeCloseTo(0.6, 6);
    expect(result.costCachedInputUsd).toBeCloseTo(0.015, 6);
    expect(result.costOutputUsd).toBe(0);
    expect(result.costTotalUsd).toBeCloseTo(0.615, 6);
  });

  it('clamps cached tokens that exceed the input total — billing never goes negative', () => {
    const result = computeCost('google/gemini-3.8-flash', 100, 0, 500);
    expect(result.costInputUsd).toBe(0);
    // All 500 cached tokens still bill at the cached rate
    expect(result.costCachedInputUsd).toBeCloseTo((500 * 0.075) / 1_000_000, 9);
  });

  it('prices Gemini 2.5 Flash titles with the published cache-read rate', () => {
    const result = computeCost('google/gemini-2.5-flash', 1_000_000, 1_000_000, 200_000);
    expect(result.priced).toBe(true);
    expect(result.costInputUsd).toBeCloseTo(0.24, 6);
    expect(result.costCachedInputUsd).toBeCloseTo(0.006, 6);
    expect(result.costOutputUsd).toBeCloseTo(2.5, 6);
    expect(result.costTotalUsd).toBeCloseTo(2.746, 6);
  });
});
