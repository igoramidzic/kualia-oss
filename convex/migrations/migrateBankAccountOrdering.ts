import type { Id } from '../_generated/dataModel';
import { internalMutation } from '../_generated/server';
import { getAccountTypeCategory } from '../lib/accountTypes';

/**
 * Migration: Backfill bankAccountOrdering for workspaces that don't have it
 *
 * This migration sets the bankAccountOrdering field on all workspaces that don't have it set.
 * Accounts are grouped by category (Banking, Credit, Loan, Investment) and sorted alphabetically
 * within each group.
 *
 * Run: npx convex run migrations/migrateBankAccountOrdering:backfillBankAccountOrdering
 */
export const backfillBankAccountOrdering = internalMutation({
  handler: async (ctx) => {
    const groupOrder = ['Banking', 'Credit', 'Loan', 'Investment'];

    // Find all workspaces without bankAccountOrdering
    const workspaces = await ctx.db.query('workspace').collect();
    const workspacesToMigrate = workspaces.filter((w) => !w.bankAccountOrdering && !w.isDeleted);

    console.log(`Found ${workspacesToMigrate.length} workspaces to migrate`);

    if (workspacesToMigrate.length === 0) {
      console.log('No workspaces to migrate. Migration complete.');
      return {
        success: true,
        total: 0,
        migrated: 0,
        skipped: 0,
      };
    }

    let migratedCount = 0;
    let skippedCount = 0;

    for (const workspace of workspacesToMigrate) {
      // Get all non-deleted, non-closed bank accounts for this workspace
      const accounts = await ctx.db
        .query('bankAccount')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspace._id))
        .collect();

      const nonDeletedAccounts = accounts.filter((a) => !a.isDeleted && !a.isClosed);

      if (nonDeletedAccounts.length === 0) {
        skippedCount++;
        console.log(`Skipping workspace ${workspace._id} (${workspace.name}) - no accounts`);
        continue;
      }

      // Group accounts by category
      const accountsByGroup: Record<string, { id: Id<'bankAccount'>; name: string }[]> = {
        Banking: [],
        Credit: [],
        Loan: [],
        Investment: [],
      };

      for (const account of nonDeletedAccounts) {
        const category = getAccountTypeCategory(account.accountType);
        if (!category) continue;

        // Capitalize: banking → Banking
        const groupName = category.charAt(0).toUpperCase() + category.slice(1);
        if (accountsByGroup[groupName]) {
          accountsByGroup[groupName].push({ id: account._id, name: account.name });
        }
      }

      // Sort alphabetically within each group
      const accountOrderByGroup: Record<string, Id<'bankAccount'>[]> = {};
      for (const [groupName, groupAccounts] of Object.entries(accountsByGroup)) {
        if (groupAccounts.length > 0) {
          groupAccounts.sort((a, b) => a.name.localeCompare(b.name));
          accountOrderByGroup[groupName] = groupAccounts.map((a) => a.id);
        }
      }

      // Update workspace
      await ctx.db.patch(workspace._id, {
        bankAccountOrdering: { groupOrder, accountOrderByGroup },
        updatedAt: new Date().toISOString(),
      });

      migratedCount++;
      console.log(`Migrated workspace ${workspace._id} (${workspace.name})`);
    }

    console.log(`Migration complete: ${migratedCount} migrated, ${skippedCount} skipped (no accounts)`);
    return {
      success: true,
      total: workspacesToMigrate.length,
      migrated: migratedCount,
      skipped: skippedCount,
    };
  },
});
