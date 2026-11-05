import { internalMutation } from '../_generated/server';

/**
 * Backfill global merchant logos from workspace-level merchant overrides.
 *
 * This mutation finds all global merchants without logos and populates them
 * with logos from workspace merchants that have custom logo overrides.
 *
 * The mutation is idempotent and can be run multiple times safely.
 *
 * @returns Summary object with counts of total merchants processed and logos added
 */
export const backfillGlobalMerchantLogos = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Step 1: Query all global merchants without logos
    const globalMerchantsWithoutLogos = await ctx.db
      .query('globalMerchant')
      .filter((q) => q.eq(q.field('logoUrl'), undefined))
      .collect();

    let logosPopulated = 0;

    // Step 2: For each global merchant without a logo, find workspace merchants with logos
    for (const globalMerchant of globalMerchantsWithoutLogos) {
      // Query all workspace merchants (we need to collect all since we can't filter by just globalMerchantId)
      const allWorkspaceMerchants = await ctx.db.query('merchant').collect();

      // Find the first workspace merchant with a logo for this global merchant
      const workspaceMerchant = allWorkspaceMerchants.find(
        (m) =>
          m.globalMerchantId === globalMerchant._id && m.logoUrl !== undefined && m.logoUrl !== null && !m.isDeleted
      );

      // Step 3: Update global merchant if we found a logo
      if (workspaceMerchant?.logoUrl) {
        await ctx.db.patch(globalMerchant._id, {
          logoUrl: workspaceMerchant.logoUrl,
          updatedAt: new Date().toISOString(),
        });
        logosPopulated++;
      }
    }

    // Step 4: Return summary
    return {
      totalGlobalMerchantsWithoutLogos: globalMerchantsWithoutLogos.length,
      logosPopulated,
    };
  },
});
