import { type Infer, v } from 'convex/values';

import { standardizeMerchantName } from '../lib/merchantUtils';
import {
  buildMerchantCategorizationInput,
  type CategoryInput,
  MAX_BATCH_SIZE,
  merchantInput,
  type MerchantInput,
} from './helpers';

export const MAX_COMPARISON_TRANSACTIONS = 50;
export const TYPESAFE_MODEL = 'jev-1.13.0';
export const TYPESAFE_FALLBACK_MIN_PROBABILITY = 0.2;
export const UNCATEGORIZED = 'uncategorized';
export const comparisonVariant = v.union(v.literal('baseline'), v.literal('plaid_v2'));
export type ComparisonVariant = Infer<typeof comparisonVariant>;

/** Plaid's wire convention: positive decimal amounts are outflows. */
export const plaidComparisonTransaction = v.object({
  transaction_id: v.optional(v.string()),
  date: v.optional(v.string()),
  name: v.string(),
  merchant_name: v.optional(v.union(v.string(), v.null())),
  amount: v.number(),
  category: v.optional(v.union(v.array(v.string()), v.null())),
  personal_finance_category: v.optional(
    v.union(v.object({ primary: v.string(), detailed: v.string(), confidence_level: v.optional(v.string()) }), v.null())
  ),
  expectedCategoryId: v.optional(v.union(v.id('category'), v.null())),
});
export type PlaidComparisonTransaction = Infer<typeof plaidComparisonTransaction>;

export const comparisonSample = v.object({
  transaction: plaidComparisonTransaction,
  expectedSource: v.union(
    v.literal('provided'),
    v.literal('reviewed_transaction'),
    v.literal('benchmark_snapshot'),
    v.literal('none')
  ),
});
export type ComparisonSample = Infer<typeof comparisonSample>;

export const benchmarkInfo = v.object({
  id: v.string(),
  workspaceId: v.id('workspace'),
  capturedAt: v.string(),
  cutoffDate: v.string(),
  availableTransactions: v.number(),
});
export type BenchmarkInfo = Infer<typeof benchmarkInfo>;

const categoryChoice = v.object({
  categoryId: v.union(v.id('category'), v.null()),
  categoryName: v.string(),
  probability: v.number(),
});
export const providerAnswer = v.object({
  categoryId: v.union(v.id('category'), v.null()),
  categoryName: v.union(v.string(), v.null()),
  confidence: v.union(v.number(), v.null()),
  selectedProbability: v.optional(v.number()),
  reason: v.union(v.string(), v.null()),
  alternatives: v.array(categoryChoice),
  error: v.union(v.string(), v.null()),
});
export type ProviderAnswer = Infer<typeof providerAnswer>;

export const providerBatch = v.object({
  model: v.string(),
  elapsedMs: v.number(),
  inputTokens: v.union(v.number(), v.null()),
  outputTokens: v.union(v.number(), v.null()),
  answers: v.array(providerAnswer),
  error: v.union(v.string(), v.null()),
  requestJson: v.string(),
  responseJson: v.union(v.string(), v.null()),
});
export type ProviderBatch = Infer<typeof providerBatch>;
export type CategorizationProvider = (
  merchants: MerchantInput[],
  categories: CategoryInput[]
) => Promise<ProviderBatch>;

const providerSummary = v.object({
  models: v.array(v.string()),
  elapsedMs: v.number(),
  inputTokens: v.union(v.number(), v.null()),
  outputTokens: v.union(v.number(), v.null()),
  categorized: v.number(),
  abstained: v.number(),
  errors: v.number(),
  errorDetails: v.array(v.object({ message: v.string(), transactions: v.number(), uniqueMerchants: v.number() })),
  correct: v.union(v.number(), v.null()),
  accuracy: v.union(v.number(), v.null()),
});

export const comparisonReport = v.object({
  mode: v.literal('dry_run'),
  variant: v.optional(comparisonVariant),
  benchmark: v.optional(benchmarkInfo),
  summary: v.object({
    transactions: v.number(),
    uniqueMerchants: v.number(),
    comparable: v.number(),
    agreements: v.number(),
    categoryAgreements: v.number(),
    bothAbstained: v.number(),
    disagreements: v.number(),
    labeled: v.number(),
    llm: providerSummary,
    typesafe: providerSummary,
    typesafeRaw: providerSummary,
    typesafeFallback: v.object({
      minProbability: v.union(v.number(), v.null()),
      applied: v.number(),
      labeled: v.number(),
      correct: v.union(v.number(), v.null()),
      incorrect: v.union(v.number(), v.null()),
      accuracy: v.union(v.number(), v.null()),
    }),
  }),
  rows: v.array(
    v.object({
      index: v.number(),
      transaction: plaidComparisonTransaction,
      normalizedInput: v.union(merchantInput, v.null()),
      expectedSource: comparisonSample.fields.expectedSource,
      expectedCategoryName: v.union(v.string(), v.null()),
      llm: providerAnswer,
      typesafe: providerAnswer,
      typesafeRaw: providerAnswer,
      typesafeFallbackApplied: v.boolean(),
      agrees: v.union(v.boolean(), v.null()),
      llmCorrect: v.union(v.boolean(), v.null()),
      typesafeCorrect: v.union(v.boolean(), v.null()),
    })
  ),
  batches: v.array(v.object({ llm: providerBatch, typesafe: providerBatch })),
  notes: v.array(v.string()),
});
export type ComparisonReport = Infer<typeof comparisonReport>;

export function normalizePlaidComparisonInput(
  transaction: PlaidComparisonTransaction,
  variant: ComparisonVariant = 'baseline'
): MerchantInput | null {
  if (!Number.isFinite(transaction.amount)) throw new Error('Plaid amounts must be finite numbers');
  if (variant === 'plaid_v2') {
    const pfc = transaction.personal_finance_category;
    return buildMerchantCategorizationInput({
      merchantName: transaction.merchant_name,
      originalStatement: transaction.name,
      amountDirection: transaction.amount > 0 ? 'negative' : 'positive',
      plaidCategory: transaction.category,
      personalFinanceCategory: pfc
        ? { primary: pfc.primary, detailed: pfc.detailed, confidence: pfc.confidence_level }
        : null,
    });
  }
  // Match Plaid ingestion's empty-name fallback, then the import scanner's normalization.
  const merchantName = standardizeMerchantName(
    transaction.merchant_name?.trim() ? transaction.merchant_name : transaction.name
  );
  if (!merchantName) return null;
  return {
    merchantName,
    amountDirection: transaction.amount > 0 ? 'negative' : 'positive',
    plaidCategory: transaction.category ?? [],
  };
}

export function merchantKey(merchant: MerchantInput): string {
  const key = `${merchant.merchantName}|${merchant.amountDirection}`;
  return merchant.transactionContext
    ? `${key}|${JSON.stringify([merchant.plaidCategory, merchant.transactionContext])}`
    : key;
}

/** The LLM identifies answers by name: separate same-name transactions with different context. */
export function merchantBatches(merchants: MerchantInput[]): MerchantInput[][] {
  return (['negative', 'positive'] as const).flatMap((direction) => {
    const batches: MerchantInput[][] = [];
    let current: MerchantInput[] = [];
    for (const merchant of merchants.filter((item) => item.amountDirection === direction)) {
      if (
        current.length === MAX_BATCH_SIZE ||
        current.some((item) => item.merchantName.toLowerCase() === merchant.merchantName.toLowerCase())
      ) {
        batches.push(current);
        current = [];
      }
      current.push(merchant);
    }
    if (current.length > 0) batches.push(current);
    return batches;
  });
}

export function failedAnswer(error: string): ProviderAnswer {
  return { categoryId: null, categoryName: null, confidence: null, reason: null, alternatives: [], error };
}

export function categoryLabel(categoryId: string | null, categories: CategoryInput[]): string {
  if (categoryId === null) return 'Uncategorized';
  const category = categories.find((candidate) => candidate.id === categoryId);
  return category ? `${category.groupName} / ${category.name}` : categoryId;
}

/** Uses absolute category probability; never renormalize away the probability of Uncategorized. */
export function applyTypeSafeFallback(answer: ProviderAnswer, minProbability: number | null): ProviderAnswer {
  if (minProbability === null || answer.error !== null || answer.categoryId !== null) return answer;
  const abstention = answer.alternatives.find((option) => option.categoryId === null);
  const candidates = answer.alternatives
    .filter((option) => option.categoryId !== null)
    .sort((a, b) => b.probability - a.probability);
  const best = candidates[0];
  if (
    !abstention ||
    !best ||
    !Number.isFinite(best.probability) ||
    best.probability < minProbability ||
    best.probability <= 0 ||
    best.probability > abstention.probability ||
    best.probability > 1 ||
    candidates[1]?.probability === best.probability
  )
    return answer;
  return {
    ...answer,
    categoryId: best.categoryId,
    categoryName: best.categoryName,
    // The model's confidence describes its original choice, not our runner-up policy.
    confidence: null,
    selectedProbability: best.probability,
    reason: `Fallback from Uncategorized: ${best.categoryName} has ${(best.probability * 100).toFixed(1)}% probability.`,
  };
}

async function runProvider(
  provider: CategorizationProvider,
  merchants: MerchantInput[],
  categories: CategoryInput[]
): Promise<ProviderBatch> {
  const started = Date.now();
  try {
    return await provider(merchants, categories);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Provider request failed';
    return {
      model: 'unavailable',
      elapsedMs: Date.now() - started,
      inputTokens: null,
      outputTokens: null,
      answers: merchants.map(() => failedAnswer(message)),
      error: message,
      requestJson: '',
      responseJson: null,
    };
  }
}

/** Runs the classifier fallback on every eligible input, bypassing rules and cached mappings. No writes. */
export async function compareCategorization(
  samples: ComparisonSample[],
  categories: CategoryInput[],
  providers: { llm: CategorizationProvider; typesafe: CategorizationProvider },
  variant: ComparisonVariant = 'baseline',
  typesafeFallbackMinProbability: number | null = null
): Promise<ComparisonReport> {
  if (
    typesafeFallbackMinProbability !== null &&
    (!Number.isFinite(typesafeFallbackMinProbability) ||
      typesafeFallbackMinProbability <= 0 ||
      typesafeFallbackMinProbability > 1)
  ) {
    throw new Error('typesafeFallbackMinProbability must be greater than 0 and at most 1, or null to disable');
  }
  if (samples.length === 0 || samples.length > MAX_COMPARISON_TRANSACTIONS) {
    throw new Error(`Supply between 1 and ${MAX_COMPARISON_TRANSACTIONS} transactions`);
  }
  const categoryIds = new Set(categories.map((category) => category.id));
  if (categoryIds.size === 0) throw new Error('Workspace has no active expense categories');
  for (const sample of samples) {
    const expected = sample.transaction.expectedCategoryId;
    if (expected && !categoryIds.has(expected))
      throw new Error('Expected category must be an active expense category in this workspace');
  }
  const normalized = samples.map((sample) => normalizePlaidComparisonInput(sample.transaction, variant));
  const unique = new Map<string, MerchantInput>();
  for (const merchant of normalized) {
    if (merchant && !unique.has(merchantKey(merchant))) unique.set(merchantKey(merchant), merchant);
  }
  const results = new Map<string, { llm: ProviderAnswer; typesafe: ProviderAnswer }>();
  const batches: ComparisonReport['batches'] = [];
  // Bound concurrency to two requests. Each TypeSafe request asks all merchant questions together.
  for (const merchants of merchantBatches([...unique.values()])) {
    const [llm, typesafe] = await Promise.all([
      runProvider(providers.llm, merchants, categories),
      runProvider(providers.typesafe, merchants, categories),
    ]);
    batches.push({ llm, typesafe });
    merchants.forEach((merchant, index) =>
      results.set(merchantKey(merchant), {
        llm: llm.answers[index] ?? failedAnswer('Missing LLM answer'),
        typesafe: typesafe.answers[index] ?? failedAnswer('Missing TypeSafe answer'),
      })
    );
  }
  const rows: ComparisonReport['rows'] = samples.map((sample, index) => {
    const merchant = normalized[index];
    const result = merchant ? results.get(merchantKey(merchant)) : undefined;
    const llm = result?.llm ?? failedAnswer('No usable merchant or statement after import normalization');
    const typesafeRaw = result?.typesafe ?? failedAnswer('No usable merchant or statement after import normalization');
    const typesafe = applyTypeSafeFallback(typesafeRaw, typesafeFallbackMinProbability);
    const expected = sample.transaction.expectedCategoryId;
    return {
      index,
      transaction: sample.transaction,
      normalizedInput: merchant,
      expectedSource: sample.expectedSource,
      expectedCategoryName: expected === undefined ? null : categoryLabel(expected, categories),
      llm,
      typesafe,
      typesafeRaw,
      typesafeFallbackApplied: typesafe !== typesafeRaw,
      agrees: llm.error || typesafe.error ? null : llm.categoryId === typesafe.categoryId,
      llmCorrect: expected === undefined ? null : llm.error === null && llm.categoryId === expected,
      typesafeCorrect: expected === undefined ? null : typesafe.error === null && typesafe.categoryId === expected,
    };
  });
  const labeled = rows.filter((row) => row.transaction.expectedCategoryId !== undefined).length;
  const summarize = (provider: 'llm' | 'typesafe' | 'typesafeRaw'): Infer<typeof providerSummary> => {
    const runs = batches.map((batch) => batch[provider === 'typesafeRaw' ? 'typesafe' : provider]);
    const correct = rows.filter(
      (row) =>
        row.transaction.expectedCategoryId !== undefined &&
        row[provider].error === null &&
        row[provider].categoryId === row.transaction.expectedCategoryId
    ).length;
    const errorGroups = new Map<string, { transactions: number; merchants: Set<string> }>();
    for (const row of rows) {
      const message = row[provider].error;
      if (message === null) continue;
      const group = errorGroups.get(message) ?? { transactions: 0, merchants: new Set<string>() };
      group.transactions++;
      group.merchants.add(row.normalizedInput ? merchantKey(row.normalizedInput) : `row:${row.index}`);
      errorGroups.set(message, group);
    }
    return {
      models: [...new Set(runs.map((run) => run.model))],
      elapsedMs: runs.reduce((sum, run) => sum + run.elapsedMs, 0),
      inputTokens:
        runs.length > 0 && runs.every((run) => run.inputTokens !== null)
          ? runs.reduce((sum, run) => sum + (run.inputTokens ?? 0), 0)
          : null,
      outputTokens:
        runs.length > 0 && runs.every((run) => run.outputTokens !== null)
          ? runs.reduce((sum, run) => sum + (run.outputTokens ?? 0), 0)
          : null,
      categorized: rows.filter((row) => !row[provider].error && row[provider].categoryId !== null).length,
      abstained: rows.filter((row) => !row[provider].error && row[provider].categoryId === null).length,
      errors: rows.filter((row) => row[provider].error !== null).length,
      errorDetails: [...errorGroups].map(([message, group]) => ({
        message,
        transactions: group.transactions,
        uniqueMerchants: group.merchants.size,
      })),
      correct: labeled > 0 ? correct : null,
      accuracy: labeled > 0 ? correct / labeled : null,
    };
  };
  const fallbackRows = rows.filter((row) => row.typesafeFallbackApplied);
  const fallbackLabeled = fallbackRows.filter((row) => row.typesafeCorrect !== null).length;
  const fallbackCorrect = fallbackRows.filter((row) => row.typesafeCorrect === true).length;
  return {
    mode: 'dry_run',
    variant,
    rows,
    batches,
    summary: {
      transactions: rows.length,
      uniqueMerchants: unique.size,
      comparable: rows.filter((row) => row.agrees !== null).length,
      agreements: rows.filter((row) => row.agrees === true).length,
      categoryAgreements: rows.filter((row) => row.agrees === true && row.llm.categoryId !== null).length,
      bothAbstained: rows.filter((row) => row.agrees === true && row.llm.categoryId === null).length,
      disagreements: rows.filter((row) => row.agrees === false).length,
      labeled,
      llm: summarize('llm'),
      typesafe: summarize('typesafe'),
      typesafeRaw: summarize('typesafeRaw'),
      typesafeFallback: {
        minProbability: typesafeFallbackMinProbability,
        applied: fallbackRows.length,
        labeled: fallbackLabeled,
        correct: fallbackLabeled > 0 ? fallbackCorrect : null,
        incorrect: fallbackLabeled > 0 ? fallbackLabeled - fallbackCorrect : null,
        accuracy: fallbackLabeled > 0 ? fallbackCorrect / fallbackLabeled : null,
      },
    },
    notes: [
      'No transactions or merchant mappings are written. Rules, prior user choices, and cached mappings are bypassed to compare the model fallback.',
      variant === 'baseline'
        ? 'Baseline: both providers receive the same normalized merchant, amount direction, legacy Plaid category hints, and category options as the existing LLM. Numeric amounts, full statements, PFC, and expected answers are not added separately to model context.'
        : 'plaid_v2: both providers receive normalized merchant, direction, full statement, and personal_finance_category hints with confidence (legacy hints only when PFC is absent). Jev also uses readable choice keys. Numeric amounts, dates, transaction IDs, and expected answers are excluded.',
      variant === 'baseline'
        ? 'Repeated merchants are deduplicated by name and direction, keeping the first bank hint, just like the import scanner.'
        : 'Only identical merchant/direction/context inputs are deduplicated; uniqueMerchants counts those distinct inputs. Same-name transactions with different context run in separate batches so their answers cannot be mixed.',
      'Agreement and error counts are per transaction, so repeated merchants count more than once. Agreements include both matching categories and mutual abstentions; errorDetails also counts distinct merchant/direction inputs.',
      'LLM confidence is self-reported; TypeSafe confidence measures distribution concentration. They are not interchangeable accuracy estimates.',
      "typesafeRaw preserves Jev's original decisions; typesafe applies the optional Uncategorized fallback. Both use the same responses, so their token/latency totals describe the same API calls, not additional usage. Fallbacks use absolute option probability, never the model's confidence or renormalized probabilities. Tied category runners-up remain uncategorized. Fallback confidence is null; selectedProbability and the original typesafeRaw confidence remain visible.",
      'Accuracy uses explicit expected answers or eligible reviewed expenses, including the fixed snapshot of reviewed transactions. Provider errors count as incorrect. Split transactions, actual transfers, and Ready-to-Assign movements are excluded from database-derived answer keys; regular credit-card purchases are eligible.',
    ],
  };
}

export function printComparisonSummary(report: ComparisonReport): void {
  console.log('[CATEGORIZATION-VARIANT]', report.variant ?? 'baseline');
  if (report.benchmark) console.log('[CATEGORIZATION-BENCHMARK]', JSON.stringify(report.benchmark));
  console.log('[CATEGORIZATION-COMPARISON]', JSON.stringify(report.summary));
  if (report.summary.labeled === 0) {
    console.log(
      'Accuracy is unavailable: no expected categories were supplied or found on eligible reviewed transactions. Correct counts are null, not zero.'
    );
  }
  for (const row of report.rows) {
    const jevCertainty = row.typesafeFallbackApplied
      ? `fallback probability ${((row.typesafe.selectedProbability ?? 0) * 100).toFixed(1)}%; original: Uncategorized`
      : `confidence ${row.typesafe.confidence ?? '-'}; probability ${row.typesafe.selectedProbability ?? '-'}`;
    console.log(
      `[${row.index + 1}] ${row.normalizedInput?.merchantName ?? row.transaction.name} (${row.normalizedInput?.amountDirection ?? 'unknown'}) | LLM: ${row.llm.error ?? row.llm.categoryName} (${row.llm.confidence ?? '-'}) | Jev: ${row.typesafe.error ?? row.typesafe.categoryName} (${jevCertainty}) | expected: ${row.expectedCategoryName ?? 'unlabeled'} | ${row.agrees === null ? 'ERROR' : row.agrees ? 'AGREE' : 'DISAGREE'}`
    );
  }
}
