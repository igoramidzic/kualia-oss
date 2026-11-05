import { internalMutation } from '../_generated/server';
import { getCurrentYearMonth } from '../categoryTargets/helpers';

/**
 * Migration: Convert all category targets to use firstDueDate instead of startDate
 * and remove the recurring_dated type
 *
 * Changes:
 * 1. recurring_dated → recurring (with firstDueDate from startDate)
 * 2. recurring/recurring_rollover without startDate → add firstDueDate = current month
 * 3. All targets get firstDueDate field
 */
export const migrateTargetsToFirstDueDate = internalMutation({
  handler: async (ctx) => {
    // Targets are stored in the category table with target_ prefix fields
    const categories = await ctx.db.query('category').collect();
    const categoriesWithTargets = categories.filter((cat) => cat.target_type !== undefined && cat.target_type !== null);

    console.log(`Found ${categoriesWithTargets.length} targets to migrate`);

    let migratedCount = 0;
    let skippedCount = 0;

    for (const category of categoriesWithTargets) {
      // Skip if already has firstDueDate (already migrated)
      if (category.target_firstDueDate) {
        skippedCount++;
        continue;
      }

      const currentYearMonth = getCurrentYearMonth();
      const year = Math.floor(currentYearMonth / 100);
      const month = currentYearMonth % 100;
      const currentMonthDate = `${year}-${month.toString().padStart(2, '0')}-01`;

      // Determine firstDueDate
      let firstDueDate: string;
      // Check for legacy startDate field (if it exists in the category)
      const legacyStartDate = (category as unknown as { startDate?: string }).startDate;
      if (legacyStartDate) {
        // Use existing startDate
        firstDueDate = legacyStartDate;
      } else {
        // Default to first day of current month
        firstDueDate = currentMonthDate;
      }

      // Determine new target type
      // Check for legacy recurring_dated type (no longer in schema but may exist in old data)
      const legacyTargetType = category.target_type as
        | 'recurring'
        | 'recurring_rollover'
        | 'maintain_balance'
        | 'recurring_dated'
        | undefined;
      let newTargetType = category.target_type;
      if (legacyTargetType === 'recurring_dated') {
        newTargetType = 'recurring';
      }

      // Update the category's target fields
      await ctx.db.patch(category._id, {
        target_type: newTargetType as 'recurring' | 'recurring_rollover' | 'maintain_balance',
        target_firstDueDate: firstDueDate,
      });

      migratedCount++;

      console.log(
        `Migrated target ${category._id}: type=${category.target_type}→${newTargetType}, firstDueDate=${firstDueDate}`
      );
    }

    console.log(`Migration complete: ${migratedCount} migrated, ${skippedCount} skipped`);

    return {
      success: true,
      total: categoriesWithTargets.length,
      migrated: migratedCount,
      skipped: skippedCount,
    };
  },
});
