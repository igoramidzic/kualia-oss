import { Agent, type UsageHandler } from '@convex-dev/agent';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

import { components, internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { SYSTEM_PROMPT } from './prompts';

export const openrouter = createOpenRouter({
  apiKey: process.env['OPENROUTER_API_KEY'] ?? '',
  appName: 'Kualia Finance',
  appUrl: 'https://kualia.com',
});

export const chatModelId = 'google/gemini-3.8-flash';
export const chatModel = openrouter.chat(chatModelId);
export const titleModel = openrouter.chat('google/gemini-2.5-flash');

/**
 * Forward each LLM step's usage to PostHog via a Node-runtime internal action.
 * The handler itself runs in the agent's host runtime (V8 isolate for chat
 * mutations/actions) and can't import `posthog-node` directly, so we schedule.
 * `runAfter(0)` queues immediately; the action fires in a separate context
 * with its own PostHog client, so an analytics failure can't poison the chat
 * stream.
 *
 * The agent library narrows its `ActionCtx` to the bits it uses (no
 * `scheduler`), but at runtime the host always passes the full Convex
 * `ActionCtx` — so we widen it back to access the scheduler.
 */
const recordUsage: UsageHandler = (ctx, args) => {
  const fullCtx = ctx as unknown as ActionCtx;
  const usage = args.usage;
  void fullCtx.scheduler.runAfter(0, internal.aiChat.usageTracking.recordChatUsage, {
    userId: args.userId,
    threadId: args.threadId,
    agentName: args.agentName,
    model: args.model,
    provider: args.provider,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedInputTokens: usage.cachedInputTokens,
    reasoningTokens: usage.reasoningTokens,
  });
  if (args.userId) {
    void fullCtx.scheduler.runAfter(0, internal.aiChat.usage.incrementMonthlyUsage, {
      userId: args.userId,
      model: args.model,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cachedInputTokens: usage.cachedInputTokens ?? 0,
    });
  }
};

/**
 * Shared agent instance. `streamText` doesn't accept a per-call model
 * override, so the action path wraps this with a PostHog-traced variant; this
 * untraced agent is used for thread metadata operations from queries/mutations.
 */
export const chatAgent = new Agent(components.agent, {
  name: 'Kualia Assistant',
  languageModel: chatModel,
  instructions: SYSTEM_PROMPT,
  usageHandler: recordUsage,
});
