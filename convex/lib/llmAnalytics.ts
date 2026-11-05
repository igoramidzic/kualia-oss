'use node';

import { OpenAI as PostHogOpenAI } from '@posthog/ai';
import OpenAI from 'openai';
import { PostHog } from 'posthog-node';

let posthogClient: PostHog | null = null;
let trackedOpenAIClient: PostHogOpenAI | null = null;

/**
 * Get or create a PostHog client for LLM analytics.
 * Returns null if POSTHOG_API_KEY is not configured.
 */
function getPostHogClient(): PostHog | null {
  if (!process.env['POSTHOG_API_KEY']) {
    return null;
  }

  if (!posthogClient) {
    posthogClient = new PostHog(process.env['POSTHOG_API_KEY'], {
      host: process.env['POSTHOG_API_HOST'] ?? 'https://us.i.posthog.com',
      flushAt: 1,
      flushInterval: 0,
    });
  }

  return posthogClient;
}

/**
 * Get or create a tracked OpenAI client that sends LLM analytics to PostHog.
 * Uses OpenRouter as the backend via the OpenAI-compatible API.
 *
 * Returns null if either OPENROUTER_API_KEY or POSTHOG_API_KEY is not configured.
 *
 * @example
 * ```typescript
 * const client = getTrackedOpenAIClient();
 * if (!client) {
 *   console.warn('LLM analytics not configured');
 *   return;
 * }
 *
 * const response = await client.chat.completions.create({
 *   model: 'google/gemini-2.5-flash',
 *   messages: [{ role: 'user', content: 'Hello' }],
 *   posthogDistinctId: workspaceId,
 *   posthogProperties: {
 *     feature: 'merchant_categorization',
 *     batchSize: 20,
 *   },
 * });
 * ```
 */
export function getTrackedOpenAIClient(): PostHogOpenAI | null {
  const openrouterApiKey = process.env['OPENROUTER_API_KEY'];
  const posthog = getPostHogClient();

  if (!openrouterApiKey) {
    console.warn('[LLM Analytics] OPENROUTER_API_KEY not configured');
    return null;
  }

  if (!posthog) {
    console.warn('[LLM Analytics] POSTHOG_API_KEY not configured - analytics disabled');
    return null;
  }

  if (!trackedOpenAIClient) {
    trackedOpenAIClient = new PostHogOpenAI({
      apiKey: openrouterApiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      posthog,
      defaultHeaders: {
        'HTTP-Referer': 'https://kualia.com',
        'X-Title': 'Kualia Finance',
      },
    });
  }

  return trackedOpenAIClient;
}

/**
 * Get a basic OpenAI client for OpenRouter without PostHog tracking.
 * Use this as a fallback when PostHog is not configured.
 *
 * Returns null if OPENROUTER_API_KEY is not configured.
 */
export function getUntrackedOpenAIClient(): OpenAI | null {
  const openrouterApiKey = process.env['OPENROUTER_API_KEY'];

  if (!openrouterApiKey) {
    return null;
  }

  // Create a new instance each time since we don't want to mix with tracked client
  return new OpenAI({
    apiKey: openrouterApiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': 'https://kualia.com',
      'X-Title': 'Kualia Finance',
    },
  });
}

/**
 * Shutdown the LLM analytics clients gracefully.
 * Call this at the end of your action to ensure all events are flushed.
 */
export async function shutdownLLMAnalytics(): Promise<void> {
  if (posthogClient) {
    await posthogClient.shutdown();
    posthogClient = null;
  }
  trackedOpenAIClient = null;
}
