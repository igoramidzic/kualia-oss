/**
 * Discord webhook helper.
 *
 * Resolves a webhook URL for a given channel name, building Discord-shaped
 * embed payloads from the generic notification args used across the backend.
 *
 * URL lookup order:
 *   1. `DISCORD_WEBHOOK_<CHANNEL>` (channel uppercased, `-` → `_`)
 *   2. `DISCORD_WEBHOOK_URL` (default)
 *
 * If neither is configured, posting is a no-op (logged warning).
 */

export const DISCORD_NOTIFICATIONS_CHANNEL = 'notifications';

export interface DiscordNotificationArgs {
  channel: string;
  title: string;
  description?: string;
  emoji?: string;
  userId?: string;
  userEmail?: string;
  metadata?: Record<string, string>;
}

interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

interface DiscordEmbed {
  title: string;
  description?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
  timestamp?: string;
}

interface DiscordWebhookPayload {
  embeds: DiscordEmbed[];
}

// Discord embed colors (decimal). Default is Discord blurple.
const DEFAULT_COLOR = 0x5865f2;
const COLOR_BY_EMOJI: Record<string, number> = {
  '⚠️': 0xffa500, // orange — warning
  '✅': 0x00c853, // green — success
  '❌': 0xff0000, // red — error
  '💳': 0x5865f2, // blurple — purchase
  '💰': 0x00c853, // green — conversion / money in
  '🆓': 0x9c27b0, // purple — trial
  '👋': 0x2196f3, // blue — signup
  '🎁': 0xe91e63, // pink — gift / free month
  '🧹': 0x607d8b, // gray — cleanup
  '📊': 0x2196f3, // blue — report
  '😢': 0x795548, // brown — cancellation
  '😞': 0x795548, // brown — refund
};

function colorFor(emoji?: string): number {
  if (!emoji) return DEFAULT_COLOR;
  return COLOR_BY_EMOJI[emoji] ?? DEFAULT_COLOR;
}

function channelEnvVar(channel: string): string {
  const normalized = channel.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return `DISCORD_WEBHOOK_${normalized}`;
}

function resolveWebhookUrl(channel: string): string | null {
  const channelSpecific = process.env[channelEnvVar(channel)];
  if (channelSpecific) return channelSpecific;
  return process.env['DISCORD_WEBHOOK_URL'] ?? null;
}

function buildEmbed(args: DiscordNotificationArgs): DiscordEmbed {
  const { title, description, emoji, userId, userEmail, metadata } = args;

  const fields: DiscordEmbedField[] = [];
  if (metadata) {
    for (const [name, value] of Object.entries(metadata)) {
      if (value === undefined || value === null || value === '') continue;
      fields.push({ name, value, inline: true });
    }
  }

  const embed: DiscordEmbed = {
    title: emoji ? `${emoji} ${title}` : title,
    color: colorFor(emoji),
    timestamp: new Date().toISOString(),
  };

  if (description) embed.description = description;
  if (fields.length > 0) embed.fields = fields;
  if (userEmail) {
    embed.footer = { text: `User: ${userEmail}` };
  } else if (userId) {
    embed.footer = { text: `User: ${userId}` };
  }

  return embed;
}

/**
 * Post a notification to a Discord webhook. Fire-and-forget at call sites
 * (this function does not throw — failures are logged).
 */
export async function postDiscordNotification(args: DiscordNotificationArgs): Promise<void> {
  const url = resolveWebhookUrl(args.channel);

  if (!url) {
    console.warn(
      `Discord webhook not configured for channel "${args.channel}" - ` +
        `set ${channelEnvVar(args.channel)} or DISCORD_WEBHOOK_URL`
    );
    return;
  }

  const payload: DiscordWebhookPayload = {
    embeds: [buildEmbed(args)],
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '<unreadable>');
      console.error('Discord webhook returned non-OK response:', {
        channel: args.channel,
        status: response.status,
        body,
      });
    }
  } catch (error: unknown) {
    console.error('Failed to send Discord notification:', {
      channel: args.channel,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
