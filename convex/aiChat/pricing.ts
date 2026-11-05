/**
 * Per-million-token prices for chat models, in USD. Used to estimate cost for
 * both the `ai_chat_llm_step` PostHog event and the persisted monthly-usage
 * row that gates the $10/month spend limit. `cachedInput` is the published
 * cache-read rate. Models not in this table report `priced: false`
 * so the analytics consumer can ignore the cost number — and the spend limit
 * effectively excludes those steps from the running total.
 */
export const MODEL_PRICING_USD_PER_1M: Record<string, { input: number; output: number; cachedInput?: number }> = {
  'google/gemini-2.5-flash': { input: 0.3, output: 2.5, cachedInput: 0.03 },
  // Gemini 3.8 Flash introductory rates through December 31, 2026.
  // https://ai.google.dev/gemini-api/docs/pricing
  // Standard rates starting January 1, 2027: input 1.5, output 7.5, cachedInput 0.15.
  'google/gemini-3.8-flash': { input: 0.75, output: 3.75, cachedInput: 0.075 },
};

export interface CostBreakdown {
  costInputUsd: number;
  costCachedInputUsd: number;
  costOutputUsd: number;
  costTotalUsd: number;
  priced: boolean;
}

export function computeCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens: number
): CostBreakdown {
  const pricing = MODEL_PRICING_USD_PER_1M[model];
  if (!pricing) {
    return { costInputUsd: 0, costCachedInputUsd: 0, costOutputUsd: 0, costTotalUsd: 0, priced: false };
  }

  const uncachedInputTokens = Math.max(inputTokens - cachedInputTokens, 0);
  const cachedInputRate = pricing.cachedInput ?? pricing.input;
  const costInputUsd = (uncachedInputTokens * pricing.input) / 1_000_000;
  const costCachedInputUsd = (cachedInputTokens * cachedInputRate) / 1_000_000;
  const costOutputUsd = (outputTokens * pricing.output) / 1_000_000;

  return {
    costInputUsd,
    costCachedInputUsd,
    costOutputUsd,
    costTotalUsd: costInputUsd + costCachedInputUsd + costOutputUsd,
    priced: true,
  };
}
