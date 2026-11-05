import { v } from 'convex/values';

import { internalMutation, internalQuery, query } from '../_generated/server';
import { requireAuth } from '../lib/auth';
import { computeCost } from './pricing';

/**
 * Hardcoded monthly spend cap (USD). Once a user's accumulated `costUsd` for the
 * current calendar month meets or exceeds this number, new chat turns are
 * refused — both client-side (banner + disabled input) and server-side
 * (`sendMessage` action throws). A single in-flight multi-step turn that
 * crosses the cap mid-run is allowed to finish; the next turn is the gate.
 */
export const MONTHLY_USD_LIMIT = 10;

/**
 * Global circuit breaker across all users. We don't expect to hit this — at
 * the per-user $10 cap it would take 10 users maxing out — but it bounds the
 * blast radius if pricing changes, the cap is misconfigured, or a model with
 * high per-token cost is added without updating the table. No client UI for
 * this; chat just refuses with an error until next month.
 */
export const GLOBAL_MONTHLY_USD_LIMIT = 100;

/** UTC `YYYY-MM` bucket key used as the second component of the index. */
function currentYearMonth(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

export interface MonthlyUsageSummary {
  yearMonth: string;
  costUsd: number;
  limitUsd: number;
  limitReached: boolean;
}

/**
 * Upsert the (userId, yearMonth) row and increment running totals by the cost
 * of one LLM step. Scheduled from the chat agents' `usageHandler` after every
 * step. Steps for unpriced models contribute zero cost (but still bump the
 * step count and token totals).
 */
export const incrementMonthlyUsage = internalMutation({
  args: {
    userId: v.string(),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cachedInputTokens: v.number(),
  },
  handler: async (ctx, args) => {
    const cost = computeCost(args.model, args.inputTokens, args.outputTokens, args.cachedInputTokens);
    const yearMonth = currentYearMonth();
    const existing = await ctx.db
      .query('aiChatUsage')
      .withIndex('by_userId_yearMonth', (q) => q.eq('userId', args.userId).eq('yearMonth', yearMonth))
      .first();
    const now = new Date().toISOString();
    if (existing) {
      await ctx.db.patch(existing._id, {
        costUsd: existing.costUsd + cost.costTotalUsd,
        inputTokens: existing.inputTokens + args.inputTokens,
        cachedInputTokens: existing.cachedInputTokens + args.cachedInputTokens,
        outputTokens: existing.outputTokens + args.outputTokens,
        stepCount: existing.stepCount + 1,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert('aiChatUsage', {
        userId: args.userId,
        yearMonth,
        costUsd: cost.costTotalUsd,
        inputTokens: args.inputTokens,
        cachedInputTokens: args.cachedInputTokens,
        outputTokens: args.outputTokens,
        stepCount: 1,
        updatedAt: now,
      });
    }
  },
});

/**
 * Pre-flight check used by `sendMessage`. Internal so we don't expose the raw
 * userId argument shape to clients — they always read their own usage via the
 * client-facing `getCurrentUsage` query.
 */
export const getMonthlyUsageInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }): Promise<MonthlyUsageSummary> => {
    const yearMonth = currentYearMonth();
    const row = await ctx.db
      .query('aiChatUsage')
      .withIndex('by_userId_yearMonth', (q) => q.eq('userId', userId).eq('yearMonth', yearMonth))
      .first();
    const costUsd = row?.costUsd ?? 0;
    return {
      yearMonth,
      costUsd,
      limitUsd: MONTHLY_USD_LIMIT,
      limitReached: costUsd >= MONTHLY_USD_LIMIT,
    };
  },
});

/**
 * Sum every user's spend for the current month — drives the global circuit
 * breaker in `sendMessage`. Internal-only: we don't surface this to clients.
 */
export const getGlobalMonthlyUsageInternal = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ yearMonth: string; costUsd: number; limitUsd: number; limitReached: boolean }> => {
    const yearMonth = currentYearMonth();
    const rows = await ctx.db
      .query('aiChatUsage')
      .withIndex('by_yearMonth', (q) => q.eq('yearMonth', yearMonth))
      .collect();
    const costUsd = rows.reduce((sum, r) => sum + r.costUsd, 0);
    return {
      yearMonth,
      costUsd,
      limitUsd: GLOBAL_MONTHLY_USD_LIMIT,
      limitReached: costUsd >= GLOBAL_MONTHLY_USD_LIMIT,
    };
  },
});

/**
 * Reactive client-facing query backing the chat panel's banner + disable
 * state. Returns the caller's own current-month rollup; never reveals other
 * users' usage.
 */
export const getCurrentUsage = query({
  args: {},
  handler: async (ctx): Promise<MonthlyUsageSummary> => {
    const identity = await requireAuth(ctx);
    const yearMonth = currentYearMonth();
    const row = await ctx.db
      .query('aiChatUsage')
      .withIndex('by_userId_yearMonth', (q) => q.eq('userId', identity.subject).eq('yearMonth', yearMonth))
      .first();
    const costUsd = row?.costUsd ?? 0;
    return {
      yearMonth,
      costUsd,
      limitUsd: MONTHLY_USD_LIMIT,
      limitReached: costUsd >= MONTHLY_USD_LIMIT,
    };
  },
});
