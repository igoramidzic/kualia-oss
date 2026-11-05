import { internalMutation } from '../_generated/server';

/**
 * Initialize the system status document.
 * Run this once via Convex dashboard to create the initial document.
 */
export const initializeSystemStatus = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query('systemStatus')
      .withIndex('by_key', (q) => q.eq('key', 'global'))
      .first();

    if (existing) {
      return { success: false, message: 'System status already exists' };
    }

    await ctx.db.insert('systemStatus', {
      key: 'global',
      maintenanceMode: false,
      maintenanceMessage: undefined,
      minIosVersion: undefined,
      iosUpdateMessage: undefined,
      updatedAt: new Date().toISOString(),
    });

    return { success: true, message: 'System status initialized' };
  },
});
