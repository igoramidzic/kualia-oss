'use node';

import { v } from 'convex/values';

import { internalAction } from '../_generated/server';
import { getPostHogClient } from '../lib/posthog';
import { computeCost } from './pricing';

/**
 * Capture a single LLM step (one tool-calling round trip) to PostHog.
 *
 * Scheduled by the chat agents' `usageHandler` after every model step. We
 * route through an internal action (rather than calling PostHog from the
 * agent's handler directly) because the handler runs in the V8 isolate and
 * `posthog-node` requires the Node runtime — splitting this off lets
 * `agent.ts` stay non-`use node` so the queries/mutations that import it
 * still load.
 */
export const recordChatUsage = internalAction({
  args: {
    userId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    agentName: v.optional(v.string()),
    model: v.string(),
    provider: v.string(),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    cachedInputTokens: v.optional(v.number()),
    reasoningTokens: v.optional(v.number()),
  },
  handler: async (_ctx, args): Promise<void> => {
    const posthog = getPostHogClient();
    if (!posthog) return;

    if (!args.userId) return;

    const inputTokens = args.inputTokens ?? 0;
    const outputTokens = args.outputTokens ?? 0;
    const cachedInputTokens = args.cachedInputTokens ?? 0;
    const cost = computeCost(args.model, inputTokens, outputTokens, cachedInputTokens);

    posthog.capture({
      distinctId: args.userId,
      event: 'ai_chat_llm_step',
      properties: {
        thread_id: args.threadId,
        agent_name: args.agentName,
        model: args.model,
        provider: args.provider,
        tokens_input: inputTokens,
        tokens_input_cached: cachedInputTokens,
        tokens_output: outputTokens,
        tokens_total: args.totalTokens ?? inputTokens + outputTokens,
        tokens_reasoning: args.reasoningTokens,
        cost_input_usd: cost.costInputUsd,
        cost_cached_input_usd: cost.costCachedInputUsd,
        cost_output_usd: cost.costOutputUsd,
        cost_total_usd: cost.costTotalUsd,
        cost_priced: cost.priced,
      },
    });

    await posthog.flush();
  },
});
