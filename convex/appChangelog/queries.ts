import { query } from '../_generated/server';

/**
 * Get the latest app changelog - NO AUTHENTICATION REQUIRED
 * This query is intentionally public as changelog must be accessible before authentication.
 *
 * Returns:
 * - Object with { version, changelogUrl } or null if no changelog exists
 */
export const getLatestChangelog = query({
  args: {},
  handler: async (ctx) => {
    const changelog = await ctx.db.query('appChangelog').withIndex('by_version').order('desc').first();

    if (!changelog) {
      return null;
    }

    return { version: changelog.version, changelogUrl: changelog.changelogUrl };
  },
});
