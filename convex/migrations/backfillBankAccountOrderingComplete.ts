import type { Id } from '../_generated/dataModel';
import { internalMutation } from '../_generated/server';
import { getAccountTypeCategory } from '../bankAccounts/helpers';

const VALID_GROUPS = ['Banking', 'Credit', 'Investment', 'Loan'];

/**
 * Migration: Backfill bankAccountOrdering for ALL workspaces
 *
 * This migration sets the bankAccountOrdering field on all workspaces,
 * ensuring ALL bank accounts (both open and closed) are included in the ordering.
 * This prevents accounts from jumping position when their updatedAt changes.
 *
 * Unlike the original migration, this one:
 * - Runs for ALL workspaces, not just those without bankAccountOrdering
 * - Includes BOTH open and closed accounts (not just open)
 * - Preserves existing order where available, only adding missing accounts
 *
 * Run: npx convex run migrations/backfillBankAccountOrderingComplete:backfillBankAccountOrderingComplete
 */
export const backfillBankAccountOrderingComplete = internalMutation({
  handler: async (ctx) => {
    // Find all non-deleted workspaces
    const workspaces = await ctx.db.query('workspace').collect();
    const workspacesToMigrate = workspaces.filter((w) => !w.isDeleted);

    console.log(`Found ${workspacesToMigrate.length} workspaces to process`);

    if (workspacesToMigrate.length === 0) {
      console.log('No workspaces to process. Migration complete.');
      return {
        success: true,
        total: 0,
        updated: 0,
        skipped: 0,
      };
    }

    let updatedCount = 0;
    let skippedCount = 0;

    for (const workspace of workspacesToMigrate) {
      // Get all non-deleted bank accounts for this workspace (both open AND closed)
      const accounts = await ctx.db
        .query('bankAccount')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspace._id))
        .collect();

      const nonDeletedAccounts = accounts.filter((a) => !a.isDeleted);

      if (nonDeletedAccounts.length === 0) {
        skippedCount++;
        console.log(`Skipping workspace ${workspace._id} (${workspace.name}) - no accounts`);
        continue;
      }

      // Get existing ordering (if any)
      const existingOrdering = workspace.bankAccountOrdering;
      const existingGroupOrder = existingOrdering?.groupOrder ?? VALID_GROUPS;
      const existingAccountOrderByGroup = existingOrdering?.accountOrderByGroup ?? {};

      // Group accounts by category
      const accountsByGroup: Record<string, { id: Id<'bankAccount'>; name: string; isClosed: boolean }[]> = {
        Banking: [],
        Credit: [],
        Loan: [],
        Investment: [],
      };

      for (const account of nonDeletedAccounts) {
        const category = getAccountTypeCategory(account.accountType);
        accountsByGroup[category].push({
          id: account._id,
          name: account.name,
          isClosed: account.isClosed,
        });
      }

      // Build new accountOrderByGroup, preserving existing order where available
      const newAccountOrderByGroup: Record<string, Id<'bankAccount'>[]> = {};
      let hasChanges = false;

      for (const [groupName, groupAccounts] of Object.entries(accountsByGroup)) {
        if (groupAccounts.length === 0) continue;

        const existingOrder = existingAccountOrderByGroup[groupName] ?? [];
        const existingSet = new Set(existingOrder);
        const allAccountIds = new Set(groupAccounts.map((a) => a.id));

        // Start with existing order (filter out any that no longer exist)
        const newOrder: Id<'bankAccount'>[] = existingOrder.filter((id) => allAccountIds.has(id));

        // Find accounts not in the existing order
        const missingAccounts = groupAccounts.filter((a) => !existingSet.has(a.id));

        if (missingAccounts.length > 0) {
          hasChanges = true;
          // Sort missing accounts: open accounts first (alphabetically), then closed (alphabetically)
          missingAccounts.sort((a, b) => {
            if (a.isClosed !== b.isClosed) {
              return a.isClosed ? 1 : -1; // Open accounts first
            }
            return a.name.localeCompare(b.name);
          });
          // Append missing accounts to the end
          newOrder.push(...missingAccounts.map((a) => a.id));
        }

        // Check if any accounts were removed from existing order
        if (newOrder.length !== existingOrder.length) {
          hasChanges = true;
        }

        newAccountOrderByGroup[groupName] = newOrder;
      }

      // Skip if no changes needed
      if (!hasChanges && existingOrdering) {
        skippedCount++;
        console.log(`Skipping workspace ${workspace._id} (${workspace.name}) - already complete`);
        continue;
      }

      // Update workspace
      await ctx.db.patch(workspace._id, {
        bankAccountOrdering: {
          groupOrder: existingGroupOrder,
          accountOrderByGroup: newAccountOrderByGroup,
        },
        updatedAt: new Date().toISOString(),
      });

      updatedCount++;
      console.log(`Updated workspace ${workspace._id} (${workspace.name})`);
    }

    console.log(`Migration complete: ${updatedCount} updated, ${skippedCount} skipped`);
    return {
      success: true,
      total: workspacesToMigrate.length,
      updated: updatedCount,
      skipped: skippedCount,
    };
  },
});
