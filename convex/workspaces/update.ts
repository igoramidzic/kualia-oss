import { ConvexError, v } from 'convex/values';

import { internalMutation, mutation } from '../_generated/server';
import { SORT_ORDER_GAP } from '../categoryGroups/helpers';
import { requireUserProfile, requireWorkspaceAccess, requireWorkspaceManagementAccess } from '../lib/auth';
import { refreshSchedule } from '../scheduledTransactions/occurrences';

/**
 * Update the active workspace for the current user
 */
export const updateActiveWorkspace = mutation({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { workspaceId }) => {
    const { userProfile } = await requireUserProfile(ctx);

    // Verify user has access to this workspace
    await requireWorkspaceAccess(ctx, workspaceId);

    // Update the active workspace ID
    await ctx.db.patch(userProfile._id, {
      activeWorkspaceId: workspaceId,
      updatedAt: new Date().toISOString(),
    });

    return { success: true };
  },
});

/**
 * Internal mutation to update workspace cumulative readyToAssign amount
 */
export const updateWorkspaceReadyToAssign = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    amountDelta: v.int64(), // Can be positive or negative
    yearMonth: v.optional(v.number()), // Deprecated - kept for backwards compatibility, ignored
  },
  handler: async (ctx, { workspaceId, amountDelta }) => {
    const workspace = await ctx.db.get(workspaceId);
    if (!workspace) {
      throw new ConvexError('Workspace not found');
    }

    const currentRTA = workspace.readyToAssign ?? 0n;
    const newRTA = currentRTA + amountDelta;

    await ctx.db.patch(workspaceId, {
      readyToAssign: newRTA,
    });
  },
});

/**
 * Internal mutation to update workspace monthly income tracking (for reports)
 * Tracks inflow and outflow separately for accurate reporting
 *
 * Accepts separate inflowDelta and outflowDelta to properly handle reversals.
 * - inflowDelta: Change to inflow (positive = increase, negative = decrease)
 * - outflowDelta: Change to outflow (positive = increase, negative = decrease)
 */
export const updateWorkspaceMonthlyIncome = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    inflowDelta: v.int64(), // Change to inflow (can be positive or negative)
    outflowDelta: v.int64(), // Change to outflow (can be positive or negative)
    yearMonth: v.number(), // Year-month in format YYYYMM (e.g., 202512)
  },
  handler: async (ctx, { workspaceId, inflowDelta, outflowDelta, yearMonth }) => {
    const workspace = await ctx.db.get(workspaceId);
    if (!workspace) {
      throw new ConvexError('Workspace not found');
    }

    const yearMonthStr = yearMonth.toString();

    // Update monthlyIncomeActivity (tracks inflow/outflow separately)
    const currentActivity = workspace.monthlyIncomeActivity ?? {};
    const currentMonthActivity = currentActivity[yearMonthStr] ?? { inflowAmount: 0n, outflowAmount: 0n };

    // Apply deltas to respective amounts
    // Use Math.max to prevent negative values (shouldn't happen in normal flow but be safe)
    const newInflowAmount = currentMonthActivity.inflowAmount + inflowDelta;
    const newOutflowAmount = currentMonthActivity.outflowAmount + outflowDelta;

    await ctx.db.patch(workspaceId, {
      monthlyIncomeActivity: {
        ...currentActivity,
        [yearMonthStr]: {
          inflowAmount: newInflowAmount < 0n ? 0n : newInflowAmount,
          outflowAmount: newOutflowAmount < 0n ? 0n : newOutflowAmount,
        },
      },
    });
  },
});

/**
 * Update workspace timezone
 */
export const updateWorkspaceTimezone = mutation({
  args: {
    workspaceId: v.id('workspace'),
    timezone: v.string(),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, { workspaceId, timezone }) => {
    await requireWorkspaceManagementAccess(ctx, workspaceId);

    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch {
      throw new ConvexError('Invalid timezone');
    }

    await ctx.db.patch(workspaceId, {
      timezone,
      updatedAt: new Date().toISOString(),
    });

    // Recalculate the derived scan fields for active scheduled transactions so auto-entry
    // stays at 7am and reminders at 9am in the new timezone
    const scheduledTransactions = await ctx.db
      .query('scheduledTransaction')
      .withIndex('by_workspaceId_isDeleted', (q) => q.eq('workspaceId', workspaceId).eq('isDeleted', false))
      .collect();

    for (const scheduled of scheduledTransactions) {
      if (scheduled.status !== 'active') {
        continue;
      }
      await refreshSchedule(ctx, scheduled._id);
    }

    return { success: true };
  },
});

/**
 * Update workspace expected monthly income
 */
export const updateWorkspaceExpectedMonthlyIncome = mutation({
  args: {
    workspaceId: v.id('workspace'),
    expectedMonthlyIncome: v.union(v.int64(), v.null()),
  },
  handler: async (ctx, { workspaceId, expectedMonthlyIncome }) => {
    await requireWorkspaceManagementAccess(ctx, workspaceId);

    await ctx.db.patch(workspaceId, {
      expectedMonthlyIncome: expectedMonthlyIncome ?? undefined,
      updatedAt: new Date().toISOString(),
    });

    return { success: true };
  },
});

/**
 * Update workspace currency
 */
export const updateWorkspaceCurrency = mutation({
  args: {
    workspaceId: v.id('workspace'),
    currency: v.string(),
  },
  handler: async (ctx, { workspaceId, currency }) => {
    await requireWorkspaceManagementAccess(ctx, workspaceId);

    await ctx.db.patch(workspaceId, {
      currency,
      updatedAt: new Date().toISOString(),
    });

    return { success: true };
  },
});

/**
 * Update workspace name
 */
export const updateWorkspaceName = mutation({
  args: {
    workspaceId: v.id('workspace'),
    name: v.string(),
  },
  handler: async (ctx, { workspaceId, name }) => {
    await requireWorkspaceManagementAccess(ctx, workspaceId);

    await ctx.db.patch(workspaceId, {
      name,
      updatedAt: new Date().toISOString(),
    });

    return { success: true };
  },
});

/**
 * Update workspace settings (name, currency, transaction defaults)
 */
export const updateWorkspaceSettings = mutation({
  args: {
    workspaceId: v.id('workspace'),
    name: v.string(),
    currency: v.string(),
    transactionDefaultPendingStatus: v.boolean(),
    transactionDefaultAccountId: v.optional(v.union(v.id('bankAccount'), v.null())),
  },
  handler: async (
    ctx,
    { workspaceId, name, currency, transactionDefaultPendingStatus, transactionDefaultAccountId }
  ) => {
    await requireWorkspaceManagementAccess(ctx, workspaceId);

    // Validate name is not empty
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new ConvexError('Workspace name cannot be empty');
    }

    // If an account ID is provided, verify it belongs to this workspace
    if (transactionDefaultAccountId) {
      const account = await ctx.db.get(transactionDefaultAccountId);
      if (!account || account.workspaceId !== workspaceId || account.isDeleted) {
        throw new ConvexError('Invalid account selected');
      }
    }

    await ctx.db.patch(workspaceId, {
      name: trimmedName,
      currency,
      transactionDefaultPendingStatus,
      transactionDefaultAccountId: transactionDefaultAccountId ?? undefined,
      updatedAt: new Date().toISOString(),
    });

    return { success: true };
  },
});

/**
 * Default category groups and their categories for new workspaces
 */
export const DEFAULT_CATEGORY_GROUPS = [
  {
    name: 'Bills',
    categories: [
      '🚗 Auto Loan',
      '🏠 Rent/Mortgage',
      '💡 Electric',
      '🔥 Gas',
      '💧 Water',
      '🌐 Internet',
      '📱 Phone',
      '🛡️ Insurance',
      '📺 Subscriptions',
    ],
  },
  {
    name: 'Needs',
    categories: [
      '🛒 Groceries',
      '🚗 Transportation',
      '⛽ Fuel',
      '🏥 Medical',
      '🧴 Personal Care',
      '🏡 Household',
      '🐾 Pet Care',
      '👶 Childcare',
    ],
  },
  {
    name: 'Savings',
    categories: [
      '🏦 Emergency Fund',
      '✈️ Vacation',
      '🔨 Home Improvement',
      '🚘 Car Fund',
      '🎓 Education',
      '👴 Retirement',
    ],
  },
  {
    name: 'Wants',
    categories: [
      '🍽️ Dining Out',
      '🎬 Entertainment',
      '🛍️ Shopping',
      '👕 Clothing',
      '🎨 Hobbies',
      '💪 Fitness',
      '💵 Fun Money',
      '🎁 Gifts',
    ],
  },
];

/**
 * Onboarding questionnaire answer types
 */
type HousingType = 'rent' | 'own' | 'family';
type TransportationType = 'car' | 'transit' | 'walk_bike';
type HouseholdType = 'just_me' | 'partner' | 'children' | 'pets';
type FinancialGoal = 'emergency' | 'vacation' | 'debt' | 'home' | 'retirement' | 'education' | 'car';

interface OnboardingAnswers {
  housing: HousingType;
  transportation: TransportationType[];
  household: HouseholdType[];
  financialGoals: FinancialGoal[];
}

/**
 * Generate personalized category groups based on onboarding questionnaire answers
 */
export function generateCategoriesFromAnswers(
  answers: OnboardingAnswers
): Array<{ name: string; categories: string[] }> {
  // Base categories that everyone gets
  const billsCategories: string[] = [
    '💡 Electric',
    '🔥 Gas',
    '💧 Water',
    '🌐 Internet',
    '📱 Phone',
    '📺 Subscriptions',
  ];
  const needsCategories: string[] = ['🛒 Groceries', '🏥 Medical', '🧴 Personal Care', '🏡 Household'];
  const savingsCategories: string[] = [];
  const wantsCategories: string[] = [
    '🍽️ Dining Out',
    '🎬 Entertainment',
    '🛍️ Shopping',
    '👕 Clothing',
    '🎨 Hobbies',
    '💪 Fitness',
    '💵 Fun Money',
    '🎁 Gifts',
  ];

  // Housing-based categories
  switch (answers.housing) {
    case 'rent':
      billsCategories.unshift('🏠 Rent');
      billsCategories.push('🛡️ Renters Insurance');
      break;
    case 'own':
      billsCategories.unshift('🏠 Mortgage');
      billsCategories.push('🛡️ Homeowners Insurance', '🏛️ Property Tax');
      savingsCategories.push('🔨 Home Improvement');
      break;
    case 'family':
      // No housing costs for living with family
      break;
  }

  // Transportation-based categories (multiple selections allowed)
  if (answers.transportation.includes('car')) {
    billsCategories.push('🚗 Auto Loan', '🛡️ Auto Insurance');
    needsCategories.push('⛽ Fuel', '🔧 Car Maintenance');
  }
  if (answers.transportation.includes('transit')) {
    billsCategories.push('🚇 Transit Pass');
  }
  if (answers.transportation.includes('walk_bike')) {
    needsCategories.push('🚲 Bike Maintenance');
  }

  // Household-based categories
  if (answers.household.includes('partner')) {
    wantsCategories.push('💕 Date Nights');
  }
  if (answers.household.includes('children')) {
    needsCategories.push('👶 Childcare', '🎨 Kids Activities', '📚 School Supplies');
    wantsCategories.push('👕 Kids Clothing');
  }
  if (answers.household.includes('pets')) {
    needsCategories.push('🐾 Pet Care');
    billsCategories.push('🏥 Vet Bills');
  }

  // Financial goals -> Savings categories
  const goalToCategoryMap: Record<FinancialGoal, string> = {
    emergency: '🏦 Emergency Fund',
    vacation: '✈️ Vacation',
    debt: '💳 Debt Payoff',
    home: '🏠 House Down Payment',
    retirement: '👴 Retirement',
    education: '🎓 Education',
    car: '🚘 Car Fund',
  };

  for (const goal of answers.financialGoals) {
    savingsCategories.push(goalToCategoryMap[goal]);
  }

  // Build the final category groups structure
  const categoryGroups: Array<{ name: string; categories: string[] }> = [
    { name: 'Bills', categories: billsCategories },
    { name: 'Needs', categories: needsCategories },
  ];

  // Only add Savings group if there are savings categories
  if (savingsCategories.length > 0) {
    categoryGroups.push({ name: 'Savings', categories: savingsCategories });
  }

  categoryGroups.push({ name: 'Wants', categories: wantsCategories });

  return categoryGroups;
}

/**
 * Convex validator for onboarding answers
 */
export const onboardingAnswersValidator = v.object({
  housing: v.union(v.literal('rent'), v.literal('own'), v.literal('family')),
  transportation: v.array(v.union(v.literal('car'), v.literal('transit'), v.literal('walk_bike'))),
  household: v.array(v.union(v.literal('just_me'), v.literal('partner'), v.literal('children'), v.literal('pets'))),
  financialGoals: v.array(
    v.union(
      v.literal('emergency'),
      v.literal('vacation'),
      v.literal('debt'),
      v.literal('home'),
      v.literal('retirement'),
      v.literal('education'),
      v.literal('car')
    )
  ),
});

/**
 * Internal mutation to complete workspace onboarding (no auth check - for scheduler use)
 * Creates categories based on onboarding answers or defaults if not provided.
 */
export const completeWorkspaceOnboardingInternal = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    onboardingAnswers: v.optional(onboardingAnswersValidator),
  },
  handler: async (ctx, { workspaceId, onboardingAnswers }) => {
    // Check if workspace already has category groups (avoid duplicates on re-run)
    const existingGroups = await ctx.db
      .query('categoryGroup')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .first();

    const timestamp = new Date().toISOString();

    // Only create categories if none exist
    if (!existingGroups) {
      // Use personalized categories if answers provided, otherwise use defaults
      const categoryGroups = onboardingAnswers
        ? generateCategoriesFromAnswers(onboardingAnswers)
        : DEFAULT_CATEGORY_GROUPS;

      // Create category groups and their categories
      for (let groupIndex = 0; groupIndex < categoryGroups.length; groupIndex++) {
        const groupDef = categoryGroups[groupIndex];

        // Create the category group
        const categoryGroupId = await ctx.db.insert('categoryGroup', {
          name: groupDef.name,
          type: 'expense',
          workspaceId,
          sortOrder: groupIndex * SORT_ORDER_GAP,
          isDeleted: false,
          updatedAt: timestamp,
        });

        // Create categories within the group
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
    }

    await ctx.db.patch(workspaceId, {
      onboardingCompleted: true,
      updatedAt: timestamp,
    });

    return { success: true };
  },
});

/**
 * Complete workspace onboarding
 * Optionally accepts onboarding questionnaire answers to create personalized categories.
 * If no answers provided, uses default category structure.
 */
export const completeWorkspaceOnboarding = mutation({
  args: {
    workspaceId: v.id('workspace'),
    onboardingAnswers: v.optional(onboardingAnswersValidator),
  },
  handler: async (ctx, { workspaceId, onboardingAnswers }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceManagementAccess(ctx, workspaceId);

    // Check if workspace already has category groups (avoid duplicates on re-run)
    const existingGroups = await ctx.db
      .query('categoryGroup')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .first();

    const timestamp = new Date().toISOString();

    // Only create categories if none exist
    if (!existingGroups) {
      // Use personalized categories if answers provided, otherwise use defaults
      const categoryGroups = onboardingAnswers
        ? generateCategoriesFromAnswers(onboardingAnswers)
        : DEFAULT_CATEGORY_GROUPS;

      // Create category groups and their categories
      for (let groupIndex = 0; groupIndex < categoryGroups.length; groupIndex++) {
        const groupDef = categoryGroups[groupIndex];

        // Create the category group
        const categoryGroupId = await ctx.db.insert('categoryGroup', {
          name: groupDef.name,
          type: 'expense',
          workspaceId: verifiedWorkspaceId,
          sortOrder: groupIndex * SORT_ORDER_GAP,
          isDeleted: false,
          updatedAt: timestamp,
        });

        // Create categories within the group
        for (let categoryIndex = 0; categoryIndex < groupDef.categories.length; categoryIndex++) {
          const categoryName = groupDef.categories[categoryIndex];

          await ctx.db.insert('category', {
            name: categoryName,
            workspaceId: verifiedWorkspaceId,
            categoryGroupId,
            sortOrder: categoryIndex * SORT_ORDER_GAP,
            isDeleted: false,
            updatedAt: timestamp,
          });
        }
      }
    }

    await ctx.db.patch(workspaceId, {
      onboardingCompleted: true,
      updatedAt: timestamp,
    });

    return { success: true };
  },
});
