import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { mutation } from '../_generated/server';
import { getAccountTypeCategory } from '../bankAccounts/helpers';
import { requireWorkspaceAccess } from '../lib/auth';

const VALID_GROUPS = ['Banking', 'Credit', 'Investment', 'Loan'];

/**
 * Add a newly created bank account to the workspace's ordering
 * Appends the account to the end of its group's list
 */
export async function addAccountToOrdering(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>,
  accountId: Id<'bankAccount'>,
  accountType: string
): Promise<void> {
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace) return;

  const groupKey = getAccountTypeCategory(accountType);
  const currentOrdering = workspace.bankAccountOrdering ?? {
    groupOrder: VALID_GROUPS,
    accountOrderByGroup: {},
  };

  // Get current account IDs for this group, or empty array
  const currentGroupOrder = currentOrdering.accountOrderByGroup[groupKey] ?? [];

  // Append new account to the end of its group
  await ctx.db.patch(workspaceId, {
    bankAccountOrdering: {
      groupOrder: currentOrdering.groupOrder,
      accountOrderByGroup: {
        ...currentOrdering.accountOrderByGroup,
        [groupKey]: [...currentGroupOrder, accountId],
      },
    },
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Update bank account group order
 * Reorders the groups (Banking, Credit, Investment, Loan) in the workspace
 */
export const updateBankAccountGroupOrder = mutation({
  args: {
    workspaceId: v.id('workspace'),
    groupOrder: v.array(v.string()),
  },
  handler: async (ctx, { workspaceId, groupOrder }) => {
    await requireWorkspaceAccess(ctx, workspaceId);

    const workspace = await ctx.db.get(workspaceId);
    if (!workspace) {
      throw new ConvexError('Workspace not found');
    }

    // Validate group names
    for (const group of groupOrder) {
      if (!VALID_GROUPS.includes(group)) {
        throw new ConvexError(`Invalid group name: ${group}`);
      }
    }

    const currentOrdering = workspace.bankAccountOrdering ?? {
      groupOrder: VALID_GROUPS,
      accountOrderByGroup: {},
    };

    await ctx.db.patch(workspaceId, {
      bankAccountOrdering: {
        ...currentOrdering,
        groupOrder,
      },
      updatedAt: new Date().toISOString(),
    });

    return { success: true };
  },
});

/**
 * Update bank account order for all groups at once
 * This ensures all accounts across all groups have a defined position
 */
export const updateBankAccountOrderAllGroups = mutation({
  args: {
    workspaceId: v.id('workspace'),
    accountOrderByGroup: v.record(v.string(), v.array(v.id('bankAccount'))),
  },
  handler: async (ctx, { workspaceId, accountOrderByGroup }) => {
    await requireWorkspaceAccess(ctx, workspaceId);

    const workspace = await ctx.db.get(workspaceId);
    if (!workspace) {
      throw new ConvexError('Workspace not found');
    }

    // Validate all accounts belong to workspace and correct groups
    for (const [groupKey, accountIds] of Object.entries(accountOrderByGroup)) {
      if (!VALID_GROUPS.includes(groupKey)) {
        throw new ConvexError(`Invalid group name: ${groupKey}`);
      }

      for (const accountId of accountIds) {
        const account = await ctx.db.get(accountId);
        if (!account || account.workspaceId !== workspaceId || account.isDeleted) {
          throw new ConvexError(`Invalid account ID: ${accountId}`);
        }

        const accountGroup = getAccountTypeCategory(account.accountType);
        if (accountGroup !== groupKey) {
          throw new ConvexError(`Account ${accountId} does not belong to group ${groupKey}`);
        }
      }
    }

    const currentOrdering = workspace.bankAccountOrdering ?? {
      groupOrder: VALID_GROUPS,
      accountOrderByGroup: {},
    };

    await ctx.db.patch(workspaceId, {
      bankAccountOrdering: {
        groupOrder: currentOrdering.groupOrder,
        accountOrderByGroup,
      },
      updatedAt: new Date().toISOString(),
    });

    return { success: true };
  },
});
