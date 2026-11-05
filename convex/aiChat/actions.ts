import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { action } from '../_generated/server';

/**
 * Send a user prompt to the chat agent and stream the response.
 *
 * The reply text is streamed to all subscribers of `listMessages` via the agent
 * component's websocket-backed delta sync — clients don't need to read the
 * action's return value to receive tokens.
 *
 * The frontend prepends a `<kualia-context>{...}</kualia-context>` block to the
 * very first user message in a thread; later turns send plain prompts.
 *
 * This thin V8 wrapper exists only so the `convex/aiChat.ts` barrel can keep
 * re-exporting `sendMessage` without dragging `@posthog/ai`'s Node-only tracing
 * middleware into the V8 bundle. The real implementation lives in
 * `actionsNode.ts` (`'use node'`), invoked synchronously here.
 */
export const sendMessage = action({
  args: {
    threadId: v.optional(v.string()),
    prompt: v.string(),
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.id('_storage'),
          mediaType: v.string(),
          filename: v.string(),
        })
      )
    ),
  },
  handler: async (ctx, args): Promise<{ threadId: string }> => {
    return await ctx.runAction(internal.aiChat.actionsNode.sendMessageImpl, args);
  },
});
