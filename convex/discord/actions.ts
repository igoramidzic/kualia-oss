import { v } from 'convex/values';

import { internalAction } from '../_generated/server';
import { postDiscordNotification } from '../lib/discord';

/**
 * Send a notification to Discord.
 *
 * Channel selects which webhook URL to use (see `lib/discord.ts` for the
 * env var lookup). Metadata is rendered as inline embed fields, emoji
 * prepends the title and drives the embed color.
 *
 * Fire-and-forget: this action never throws — webhook failures are logged.
 */
export const sendDiscordNotification = internalAction({
  args: {
    channel: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    emoji: v.optional(v.string()),
    userId: v.optional(v.string()),
    userEmail: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (_ctx, args) => {
    await postDiscordNotification(args);
  },
});
