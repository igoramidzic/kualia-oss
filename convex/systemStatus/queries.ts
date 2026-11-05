import { query } from '../_generated/server';

/**
 * Get system status - NO AUTHENTICATION REQUIRED
 * This query is intentionally public as it must be checked before authentication.
 *
 * Returns:
 * - maintenanceMode: boolean
 * - maintenanceMessage: optional message to display
 * - minIosVersion: optional minimum iOS version required
 * - iosUpdateMessage: optional message for outdated apps
 */
export const getSystemStatus = query({
  args: {},
  handler: async (ctx) => {
    const status = await ctx.db
      .query('systemStatus')
      .withIndex('by_key', (q) => q.eq('key', 'global'))
      .first();

    // If no status document exists, return defaults (system is operational)
    if (!status) {
      return {
        maintenanceMode: false,
        maintenanceMessage: null,
        minIosVersion: null,
        iosUpdateMessage: null,
      };
    }

    return {
      maintenanceMode: status.maintenanceMode,
      maintenanceMessage: status.maintenanceMessage ?? null,
      minIosVersion: status.minIosVersion ?? null,
      iosUpdateMessage: status.iosUpdateMessage ?? null,
    };
  },
});
