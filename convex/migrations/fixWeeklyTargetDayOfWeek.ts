import { internalMutation } from '../_generated/server';

/**
 * Migration: Fix weekly and monthly targets with incorrect day fields
 *
 * Issues from Supabase migration:
 * 1. Weekly targets: target_day (0-6) was mapped to target_dueDay instead of target_dayOfWeek
 * 2. Monthly targets: target_day=0 (last day of month) should be target_dueDay=-1
 * 3. Monthly targets: some have null target_dueDay
 *
 * This migration:
 * - Weekly: Copies target_dueDay (0-6) to target_dayOfWeek if not already set
 * - Monthly: Converts target_dueDay=0 to target_dueDay=-1 (last day convention)
 * - Monthly: Sets default target_dueDay=-1 if null
 */
export const fixWeeklyTargetDayOfWeek = internalMutation({
  handler: async (ctx) => {
    const categories = await ctx.db.query('category').collect();
    const targetsToFix = categories.filter((cat) => cat.enableTarget === true && cat.target_frequency);

    console.log(`Found ${targetsToFix.length} targets to check`);

    let weeklyFixed = 0;
    let weeklyAlreadyCorrect = 0;
    let weeklyNoData = 0;
    let monthlyFixed = 0;
    let monthlyAlreadyCorrect = 0;

    for (const category of targetsToFix) {
      if (category.target_frequency === 'weekly') {
        // WEEKLY: Fix dayOfWeek
        if (category.target_dayOfWeek !== undefined && category.target_dayOfWeek !== null) {
          weeklyAlreadyCorrect++;
          console.log(
            `Weekly ${category._id} (${category.name}): dayOfWeek already set to ${category.target_dayOfWeek}`
          );
          continue;
        }

        // Check if dueDay has a valid day-of-week value (0-6)
        const dueDay = category.target_dueDay;
        if (dueDay !== undefined && dueDay !== null && dueDay >= 0 && dueDay <= 6) {
          await ctx.db.patch(category._id, {
            target_dayOfWeek: dueDay,
            target_dueDay: undefined, // Clear since not applicable for weekly
            updatedAt: new Date().toISOString(),
          });

          weeklyFixed++;
          console.log(`Weekly ${category._id} (${category.name}): copied dueDay=${dueDay} to dayOfWeek`);
        } else {
          weeklyNoData++;
          console.log(`Weekly ${category._id} (${category.name}): no valid day data found (dueDay=${dueDay})`);
        }
      } else if (category.target_frequency === 'monthly') {
        // MONTHLY: Fix dueDay
        const dueDay = category.target_dueDay;

        if (dueDay === -1 || (dueDay !== undefined && dueDay !== null && dueDay >= 1 && dueDay <= 31)) {
          // Already correct: -1 (last day) or 1-31
          monthlyAlreadyCorrect++;
          console.log(`Monthly ${category._id} (${category.name}): dueDay already correct (${dueDay})`);
          continue;
        }

        // Fix: 0 means "last day" in Supabase, convert to -1
        // Fix: null/undefined should default to -1 (last day)
        const newDueDay = dueDay === 0 ? -1 : -1; // Default to last day of month

        await ctx.db.patch(category._id, {
          target_dueDay: newDueDay,
          updatedAt: new Date().toISOString(),
        });

        monthlyFixed++;
        console.log(`Monthly ${category._id} (${category.name}): fixed dueDay from ${dueDay} to ${newDueDay}`);
      }
    }

    console.log(`\nMigration complete:`);
    console.log(`Weekly targets:`);
    console.log(`  - Fixed: ${weeklyFixed}`);
    console.log(`  - Already correct: ${weeklyAlreadyCorrect}`);
    console.log(`  - No data: ${weeklyNoData}`);
    console.log(`Monthly targets:`);
    console.log(`  - Fixed: ${monthlyFixed}`);
    console.log(`  - Already correct: ${monthlyAlreadyCorrect}`);

    return {
      success: true,
      weekly: {
        fixed: weeklyFixed,
        alreadyCorrect: weeklyAlreadyCorrect,
        noData: weeklyNoData,
      },
      monthly: {
        fixed: monthlyFixed,
        alreadyCorrect: monthlyAlreadyCorrect,
      },
    };
  },
});
