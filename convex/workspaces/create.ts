import { ConvexError, v } from 'convex/values';

import { Id } from '../_generated/dataModel';
import { MutationCtx, internalMutation, mutation } from '../_generated/server';
import { requireUserProfile, requireWorkspaceAccess } from '../lib/auth';

import { SORT_ORDER_GAP } from './helpers';
import { DEFAULT_CATEGORY_GROUPS } from './update';

/**
 * Internal mutation to create default categories for a new workspace
 * This is called after a workspace is created
 */
export const createDefaultCategories = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { workspaceId }) => {
    // Define category structure with groups and their categories
    const categoryStructure = [
      {
        group: 'Personnel',
        type: 'expense' as const,
        categories: [
          { name: 'Founder Salary', icon: 'Users' },
          { name: 'Contractors', icon: 'UserPlus' },
          { name: 'Payroll Taxes', icon: 'Receipt' },
        ],
      },
      {
        group: 'Tech & Infra',
        type: 'expense' as const,
        categories: [
          { name: 'Cloud Hosting', icon: 'Cloud' },
          { name: 'Domain & DNS', icon: 'Globe' },
          { name: 'SaaS Tools', icon: 'Wrench' },
          { name: 'APIs & Services', icon: 'Plug' },
          { name: 'AI Tools', icon: 'Sparkles' },
        ],
      },
      {
        group: 'Product & Dev',
        type: 'expense' as const,
        categories: [
          { name: 'Design Tools', icon: 'Palette' },
          { name: 'Dev Tools', icon: 'Code' },
          { name: 'Analytics', icon: 'BarChart' },
        ],
      },
      {
        group: 'Sales & Marketing',
        type: 'expense' as const,
        categories: [
          { name: 'Advertising', icon: 'Megaphone' },
          { name: 'Marketing Tools', icon: 'Target' },
        ],
      },
      {
        group: 'Legal',
        type: 'expense' as const,
        categories: [{ name: 'Legal Fees', icon: 'Scale' }],
      },
      {
        group: 'Administrative',
        type: 'expense' as const,
        categories: [
          { name: 'Licenses & Fees', icon: 'FileText' },
          { name: 'Subscriptions', icon: 'Repeat' },
          { name: 'Taxes', icon: 'ReceiptText' },
          { name: 'Uncategorized', icon: 'Box' },
        ],
      },
    ];

    // Insert category groups first, then categories
    let groupSortOrder = 0;
    for (const { group, type, categories } of categoryStructure) {
      const groupId = await ctx.db.insert('categoryGroup', {
        name: group,
        type,
        workspaceId,
        sortOrder: groupSortOrder,
        isDeleted: false,
        updatedAt: new Date().toISOString(),
      });
      groupSortOrder += SORT_ORDER_GAP;

      // Insert categories with categoryGroupId reference
      let categorySortOrder = 0;
      for (const category of categories) {
        await ctx.db.insert('category', {
          name: category.name,
          workspaceId,
          categoryGroupId: groupId,
          sortOrder: categorySortOrder,
          iconName: category.icon,
          isDeleted: false,
          updatedAt: new Date().toISOString(),
        });
        categorySortOrder += SORT_ORDER_GAP;
      }
    }

    // Create workspace-specific credit card category group after expense groups
    await ctx.db.insert('categoryGroup', {
      name: 'Credit Card',
      type: 'credit_card',
      workspaceId,
      sortOrder: groupSortOrder,
      isDeleted: false,
      updatedAt: new Date().toISOString(),
    });
  },
});

/**
 * Create a new workspace
 */
export const createWorkspace = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, { name }) => {
    // Get the current user profile and identity
    const { userProfile, user } = await requireUserProfile(ctx);

    // Create the workspace
    const workspaceId = await ctx.db.insert('workspace', {
      name,
      ownerClerkId: user.subject,
      readyToAssign: 0n,
      onboardingCompleted: false,
      transactionDefaultPendingStatus: false,
      isDeleted: false,
      updatedAt: new Date().toISOString(),
    });

    // Set this workspace as the user's active workspace
    await ctx.db.patch(userProfile._id, {
      activeWorkspaceId: workspaceId,
      updatedAt: new Date().toISOString(),
    });

    return workspaceId;
  },
});

/**
 * Internal mutation to automatically create a workspace for new users
 * Called from Clerk webhook on user.created event
 */
export const createAutomaticWorkspace = internalMutation({
  args: {
    clerkId: v.string(),
    defaultWorkspaceName: v.string(),
  },
  handler: async (ctx, { clerkId, defaultWorkspaceName }) => {
    // Create workspace document
    const workspaceId = await ctx.db.insert('workspace', {
      name: defaultWorkspaceName,
      ownerClerkId: clerkId,
      readyToAssign: 0n,
      onboardingCompleted: false,
      transactionDefaultPendingStatus: false,
      isDeleted: false,
      updatedAt: new Date().toISOString(),
    });

    return workspaceId;
  },
});

/**
 * Create a new workspace with options for currency and category setup
 * Used when manually creating a workspace from the app
 */
export const createWorkspaceWithOptions = mutation({
  args: {
    name: v.string(),
    currency: v.string(),
    categoryOption: v.union(v.literal('default'), v.literal('copy')),
    sourceWorkspaceId: v.optional(v.id('workspace')),
  },
  handler: async (ctx, { name, currency, categoryOption, sourceWorkspaceId }) => {
    const { userProfile, user } = await requireUserProfile(ctx);
    const timestamp = new Date().toISOString();

    // Validate name
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new ConvexError('Workspace name cannot be empty');
    }

    // If copying from a workspace, verify user has access to it and get its settings
    let sourceWorkspace = null;
    if (categoryOption === 'copy') {
      if (!sourceWorkspaceId) {
        throw new ConvexError('Source workspace is required when copying categories');
      }
      await requireWorkspaceAccess(ctx, sourceWorkspaceId);
      sourceWorkspace = await ctx.db.get(sourceWorkspaceId);
    }

    // Create the workspace with currency and timezone (copy timezone from source if available)
    const workspaceId = await ctx.db.insert('workspace', {
      name: trimmedName,
      ownerClerkId: user.subject,
      currency,
      timezone: sourceWorkspace?.timezone,
      readyToAssign: 0n,
      onboardingCompleted: true, // Mark as completed since we're setting up categories
      transactionDefaultPendingStatus: false,
      isDeleted: false,
      updatedAt: timestamp,
    });

    // Set as active workspace
    await ctx.db.patch(userProfile._id, {
      activeWorkspaceId: workspaceId,
      updatedAt: timestamp,
    });

    // Set up categories based on option
    if (categoryOption === 'copy' && sourceWorkspaceId) {
      // Copy categories from source workspace
      await copyCategoriesFromWorkspace(ctx, sourceWorkspaceId, workspaceId, timestamp);
    } else {
      // Create default categories
      await createDefaultCategoriesForWorkspace(ctx, workspaceId, timestamp);
    }

    return workspaceId;
  },
});

/**
 * Helper to create default categories for a workspace
 */
async function createDefaultCategoriesForWorkspace(ctx: MutationCtx, workspaceId: Id<'workspace'>, timestamp: string) {
  // Create category groups and their categories from DEFAULT_CATEGORY_GROUPS
  for (let groupIndex = 0; groupIndex < DEFAULT_CATEGORY_GROUPS.length; groupIndex++) {
    const groupDef = DEFAULT_CATEGORY_GROUPS[groupIndex];

    const categoryGroupId = await ctx.db.insert('categoryGroup', {
      name: groupDef.name,
      type: 'expense',
      workspaceId,
      sortOrder: groupIndex * SORT_ORDER_GAP,
      isDeleted: false,
      updatedAt: timestamp,
    });

    for (let categoryIndex = 0; categoryIndex < groupDef.categories.length; categoryIndex++) {
      const categoryName = groupDef.categories[categoryIndex];

      await ctx.db.insert('category', {
        name: categoryName,
        workspaceId,
        categoryGroupId,
        sortOrder: categoryIndex * SORT_ORDER_GAP,
        isDeleted: false,
        updatedAt: timestamp,
      });
    }
  }

  // Create the Credit Card group
  await ctx.db.insert('categoryGroup', {
    name: 'Credit Card',
    type: 'credit_card',
    workspaceId,
    sortOrder: DEFAULT_CATEGORY_GROUPS.length * SORT_ORDER_GAP,
    isDeleted: false,
    updatedAt: timestamp,
  });
}

/**
 * Helper to copy categories from a source workspace
 * Only copies custom expense category groups and their categories (not credit_card or system categories)
 */
async function copyCategoriesFromWorkspace(
  ctx: MutationCtx,
  sourceWorkspaceId: Id<'workspace'>,
  targetWorkspaceId: Id<'workspace'>,
  timestamp: string
) {
  // Get all non-deleted category groups from source workspace (expense type only)
  const sourceGroups = await ctx.db
    .query('categoryGroup')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', sourceWorkspaceId))
    .filter((q) => q.and(q.eq(q.field('isDeleted'), false), q.eq(q.field('type'), 'expense')))
    .collect();

  // Sort by sortOrder to maintain order
  sourceGroups.sort((a, b) => a.sortOrder - b.sortOrder);

  // Copy each group and its categories
  for (let groupIndex = 0; groupIndex < sourceGroups.length; groupIndex++) {
    const sourceGroup = sourceGroups[groupIndex];

    // Create the category group in target workspace
    const newGroupId = await ctx.db.insert('categoryGroup', {
      name: sourceGroup.name,
      type: 'expense',
      workspaceId: targetWorkspaceId,
      sortOrder: groupIndex * SORT_ORDER_GAP,
      isDeleted: false,
      updatedAt: timestamp,
    });

    // Get categories for this group
    const sourceCategories = await ctx.db
      .query('category')
      .withIndex('by_categoryGroupId_sortOrder', (q) => q.eq('categoryGroupId', sourceGroup._id))
      .filter((q) =>
        q.and(
          q.eq(q.field('isDeleted'), false),
          q.or(q.eq(q.field('isArchived'), false), q.eq(q.field('isArchived'), undefined))
        )
      )
      .collect();

    // Sort by sortOrder
    sourceCategories.sort((a, b) => a.sortOrder - b.sortOrder);

    // Copy each category
    for (let categoryIndex = 0; categoryIndex < sourceCategories.length; categoryIndex++) {
      const sourceCategory = sourceCategories[categoryIndex];

      await ctx.db.insert('category', {
        name: sourceCategory.name,
        workspaceId: targetWorkspaceId,
        categoryGroupId: newGroupId,
        sortOrder: categoryIndex * SORT_ORDER_GAP,
        iconName: sourceCategory.iconName,
        isDeleted: false,
        updatedAt: timestamp,
        // Copy target settings if they exist
        enableTarget: sourceCategory.enableTarget,
        target_type: sourceCategory.target_type,
        target_amount: sourceCategory.target_amount,
        target_frequency: sourceCategory.target_frequency,
        target_frequencyInterval: sourceCategory.target_frequencyInterval,
        target_dayOfWeek: sourceCategory.target_dayOfWeek,
        target_dueDay: sourceCategory.target_dueDay,
        target_firstDueDate: sourceCategory.target_firstDueDate,
        target_targetDate: sourceCategory.target_targetDate,
        target_monthlyContribution: sourceCategory.target_monthlyContribution,
        target_targetBalance: sourceCategory.target_targetBalance,
      });
    }
  }

  // Create the Credit Card group
  await ctx.db.insert('categoryGroup', {
    name: 'Credit Card',
    type: 'credit_card',
    workspaceId: targetWorkspaceId,
    sortOrder: sourceGroups.length * SORT_ORDER_GAP,
    isDeleted: false,
    updatedAt: timestamp,
  });
}
