import { ConvexError, v } from 'convex/values';

import { getCurrencyInfo } from '../../packages/shared/src/currency/currency-info';
import { internal } from '../_generated/api';
import { mutation } from '../_generated/server';
import { clearAdAttribution } from '../ads/attribution';
import { adAttributionInput } from '../ads/types';
import { SORT_ORDER_GAP } from '../categoryGroups/helpers';
import { createCategoryTargetImpl } from '../categoryTargets/create';
import { updateCategoryTargetImpl } from '../categoryTargets/update';
import { requireUserProfile } from '../lib/auth';
import { getCurrentYearMonthForTimezone } from '../lib/dates';
import {
  DEFAULT_CATEGORY_GROUPS,
  generateCategoriesFromAnswers,
  onboardingAnswersValidator,
} from '../workspaces/update';
import { nextCheckIn, normalizeProfileName } from './helpers';
import { checkInValidator } from './types';

/** Record a foreground visit for the authenticated person, independent of their workspace. */
export const recordCheckIn = mutation({
  args: { timezone: v.string() },
  returns: checkInValidator,
  handler: async (ctx, { timezone }) => {
    // Profiles are user-owned, so use the existing profile auth boundary (no orgId).
    const { userProfile } = await requireUserProfile(ctx);
    const now = new Date();
    const checkIn = nextCheckIn(userProfile.checkIn, timezone, now);
    if (checkIn !== userProfile.checkIn) {
      await ctx.db.patch(userProfile._id, { checkIn });
    }
    return checkIn;
  },
});

/** Create the guided iOS budget atomically, retaining an unfinished profile for safe resumption. */
export const prepareGuidedOnboarding = mutation({
  args: {
    onboardingAnswers: onboardingAnswersValidator,
    currency: v.string(),
    timezone: v.string(),
  },
  returns: v.object({ workspaceId: v.id('workspace') }),
  handler: async (ctx, { onboardingAnswers, currency, timezone }) => {
    const { userProfile, user } = await requireUserProfile(ctx);
    if (userProfile.onboardingCompleted) throw new ConvexError('Onboarding is already complete.');
    const normalizedCurrency = currency.trim().toUpperCase();
    if (!getCurrencyInfo(normalizedCurrency)) throw new ConvexError('Choose a supported currency.');
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    } catch (_error: unknown) {
      throw new ConvexError('Choose a valid timezone.');
    }
    if (
      onboardingAnswers.transportation.length > 3 ||
      onboardingAnswers.household.length > 4 ||
      onboardingAnswers.financialGoals.length > 7
    ) {
      throw new ConvexError('Choose each answer only once.');
    }

    const timestamp = new Date().toISOString();
    const existing = userProfile.activeWorkspaceId ? await ctx.db.get(userProfile.activeWorkspaceId) : null;
    // The profile and workspace are written in the same transaction. A replay after
    // a lost response reuses this workspace and never creates duplicate envelopes.
    const reusable = existing && existing.ownerClerkId === user.subject && !existing.isDeleted && !existing.isArchived;
    const workspaceId = reusable
      ? existing._id
      : await ctx.db.insert('workspace', {
          name: 'Personal Budget',
          ownerClerkId: user.subject,
          currency: normalizedCurrency,
          timezone,
          readyToAssign: 0n,
          onboardingCompleted: false,
          transactionDefaultPendingStatus: false,
          isDeleted: false,
          updatedAt: timestamp,
        });
    const [existingCategories, existingGroups] = await Promise.all([
      ctx.db
        .query('category')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .take(1001),
      ctx.db
        .query('categoryGroup')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .take(1001),
    ]);
    if (existingCategories.length > 1000 || existingGroups.length > 1000)
      throw new ConvexError('This budget is too large for guided setup. Contact support for help.');
    const activeExpenseGroupIds = new Set(
      existingGroups
        .filter((group) => !group.isDeleted && !group.deletedAt && group.type === 'expense')
        .map((group) => group._id)
    );
    const hasExpenseCategory = existingCategories.some(
      (category) =>
        !category.isDeleted &&
        !category.deletedAt &&
        !category.isArchived &&
        category.categoryType !== 'credit_card' &&
        activeExpenseGroupIds.has(category.categoryGroupId)
    );
    if (!hasExpenseCategory) {
      const groups = generateCategoriesFromAnswers({
        ...onboardingAnswers,
        transportation: [...new Set(onboardingAnswers.transportation)],
        household: [...new Set(onboardingAnswers.household)],
        financialGoals: [...new Set(onboardingAnswers.financialGoals)],
      });
      for (const [groupIndex, group] of groups.entries()) {
        const matchingGroup = existingGroups.find(
          (existingGroup) =>
            !existingGroup.isDeleted &&
            !existingGroup.deletedAt &&
            existingGroup.type === 'expense' &&
            existingGroup.name === group.name
        );
        const categoryGroupId =
          matchingGroup?._id ??
          (await ctx.db.insert('categoryGroup', {
            name: group.name,
            type: 'expense',
            workspaceId,
            sortOrder: groupIndex * SORT_ORDER_GAP,
            isDeleted: false,
            updatedAt: timestamp,
          }));
        for (const [index, name] of group.categories.entries()) {
          await ctx.db.insert('category', {
            name,
            workspaceId,
            categoryGroupId,
            sortOrder: index * SORT_ORDER_GAP,
            isDeleted: false,
            updatedAt: timestamp,
          });
        }
      }
    }
    await ctx.db.patch(userProfile._id, { activeWorkspaceId: workspaceId, updatedAt: timestamp });
    return { workspaceId };
  },
});

/** A lost save response can be retried without replacing a target or creating a second one. */
export const prepareGuidedOnboardingTarget = mutation({
  args: { workspaceId: v.id('workspace'), categoryId: v.id('category'), amount: v.number() },
  returns: v.object({ categoryId: v.id('category') }),
  handler: async (ctx, { workspaceId, categoryId, amount }) => {
    const { userProfile, user } = await requireUserProfile(ctx);
    const workspace = await ctx.db.get(workspaceId);
    if (
      userProfile.onboardingCompleted ||
      userProfile.activeWorkspaceId !== workspaceId ||
      !workspace ||
      workspace.ownerClerkId !== user.subject ||
      workspace.isDeleted ||
      workspace.isArchived
    )
      throw new ConvexError('Your onboarding workspace is no longer available.');
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new ConvexError('Enter a positive target amount.');
    const category = await ctx.db.get(categoryId);
    if (
      !category ||
      category.workspaceId !== workspaceId ||
      category.isDeleted ||
      category.isArchived ||
      category.categoryType === 'credit_card'
    ) {
      throw new ConvexError('Choose one of your spending or saving categories.');
    }
    if (!category.enableTarget) {
      const month = getCurrentYearMonthForTimezone(workspace.timezone);
      await createCategoryTargetImpl(ctx, {
        workspaceId,
        categoryId,
        amount,
        targetType: 'recurring',
        frequency: 'monthly',
        frequencyInterval: 1,
        firstDueDate: `${Math.floor(month / 100)}-${String(month % 100).padStart(2, '0')}-01`,
        attribution: { clerkId: user.subject, source: { type: 'kualia_ui' } },
      });
    } else if (
      category.target_amount !== BigInt(amount) ||
      category.target_type !== 'recurring' ||
      category.target_frequency !== 'monthly'
    ) {
      await updateCategoryTargetImpl(ctx, {
        workspaceId,
        categoryId,
        amount,
        targetType: 'recurring',
        frequency: 'monthly',
        frequencyInterval: 1,
        dayOfWeek: null,
        dueDay: null,
        targetDate: null,
        monthlyContribution: null,
        targetBalance: null,
        attribution: { clerkId: user.subject, source: { type: 'kualia_ui' } },
      });
    }
    return { categoryId };
  },
});

/** Completion is recorded only after a real target and a funded or explicit practice exercise. */
export const finishGuidedOnboarding = mutation({
  args: {
    workspaceId: v.id('workspace'),
    categoryId: v.id('category'),
    practicedWithoutFunds: v.boolean(),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, { workspaceId, categoryId, practicedWithoutFunds }) => {
    const { userProfile, user } = await requireUserProfile(ctx);
    const workspace = await ctx.db.get(workspaceId);
    if (
      userProfile.activeWorkspaceId !== workspaceId ||
      !workspace ||
      workspace.ownerClerkId !== user.subject ||
      workspace.isDeleted ||
      workspace.isArchived
    )
      throw new ConvexError('Your onboarding workspace is no longer available.');
    if (userProfile.onboardingCompleted) return { success: true };
    const category = await ctx.db.get(categoryId);
    if (
      !category ||
      category.workspaceId !== workspaceId ||
      category.isDeleted ||
      category.isArchived ||
      !category.enableTarget ||
      (category.target_amount ?? 0n) <= 0n
    ) {
      throw new ConvexError('Set your first category target before continuing.');
    }
    const budget = await ctx.db
      .query('categoryBudget')
      .withIndex('by_workspaceId_categoryId', (q) => q.eq('workspaceId', workspaceId).eq('categoryId', categoryId))
      .first();
    const currentMonth = String(getCurrentYearMonthForTimezone(workspace.timezone));
    const assigned = budget?.monthlyAssignedAmounts[currentMonth] ?? 0n;
    if (assigned <= 0n && (!practicedWithoutFunds || (workspace.readyToAssign ?? 0n) > 0n)) {
      throw new ConvexError('Use Quick Assign to give your first category some money.');
    }
    const timestamp = new Date().toISOString();
    await ctx.db.patch(workspaceId, { onboardingCompleted: true, updatedAt: timestamp });
    await ctx.db.patch(userProfile._id, { onboardingCompleted: true, updatedAt: timestamp });
    return { success: true };
  },
});

/**
 * Update user profile
 */
export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
  },
  handler: async (ctx, { name }) => {
    const { userProfile } = await requireUserProfile(ctx);

    const updates: Partial<typeof userProfile> = {
      updatedAt: new Date().toISOString(),
    };

    if (name !== undefined) {
      const normalizedName = normalizeProfileName(name);

      if (normalizedName !== undefined) {
        updates.name = normalizedName;

        // Sync first name change to Loops audience.
        await ctx.scheduler.runAfter(0, internal.notifications.loops.updateContact, {
          email: userProfile.email,
          firstName: normalizedName,
        });
      }
    }

    await ctx.db.patch(userProfile._id, updates);

    return { success: true };
  },
});

/**
 * Complete user onboarding
 * - Always creates a new workspace ("Personal Budget")
 * - Creates personalized categories synchronously based on questionnaire answers
 * - Optionally sets onboardingCompleted to true on user profile (defaults to false)
 * - Workspace onboardingCompleted remains false (user completes workspace setup separately)
 * - Returns the created workspace ID
 *
 * When completeOnboarding is false, call setUserOnboardingCompleted separately after
 * workspace data has loaded to avoid showing a loading spinner during the transition.
 */
export const completeUserOnboarding = mutation({
  args: {
    onboardingAnswers: v.optional(onboardingAnswersValidator),
    workspaceName: v.optional(v.string()),
    completeOnboarding: v.optional(v.boolean()),
    adAttribution: v.optional(adAttributionInput),
  },
  handler: async (ctx, { onboardingAnswers, workspaceName }) => {
    const { userProfile, user } = await requireUserProfile(ctx);

    // Prevent double onboarding
    if (userProfile.onboardingCompleted === true) {
      throw new ConvexError('User onboarding already completed');
    }

    const timestamp = new Date().toISOString();

    // Always create a new workspace
    const workspaceId = await ctx.db.insert('workspace', {
      name: workspaceName ?? 'Personal Budget',
      ownerClerkId: user.subject,
      readyToAssign: 0n,
      onboardingCompleted: false,
      transactionDefaultPendingStatus: false,
      isDeleted: false,
      updatedAt: timestamp,
    });

    // Create categories synchronously
    const categoryGroups = onboardingAnswers
      ? generateCategoriesFromAnswers(onboardingAnswers)
      : DEFAULT_CATEGORY_GROUPS;

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

    // Update user profile with active workspace and always mark onboarding complete.
    // This must be atomic with workspace creation to prevent users getting stuck
    // with a workspace created but onboardingCompleted still false.
    await ctx.db.patch(userProfile._id, {
      activeWorkspaceId: workspaceId,
      onboardingCompleted: true,
      updatedAt: timestamp,
    });

    // Accept legacy attribution arguments without retaining them or sending conversions.
    await clearAdAttribution(ctx, userProfile);

    return {
      success: true,
      workspaceId,
      adConsentRevocation: null,
    };
  },
});

/**
 * Update user's APNs device token for push notifications
 */
export const updateApnsDeviceToken = mutation({
  args: {
    apnsDeviceToken: v.string(),
  },
  returns: v.object({ success: v.literal(true) }),
  handler: async (ctx, { apnsDeviceToken }) => {
    const { userProfile } = await requireUserProfile(ctx);

    // iOS reports its token at launch. Rewriting an unchanged profile invalidates
    // every subscription that reads the profile during workspace authorization.
    if (userProfile.apnsDeviceToken === apnsDeviceToken) return { success: true } as const;

    await ctx.db.patch(userProfile._id, {
      apnsDeviceToken,
      updatedAt: new Date().toISOString(),
    });

    return { success: true } as const;
  },
});

/**
 * Update user's notification preference (global toggle)
 */
export const updateNotificationPreference = mutation({
  args: {
    notificationsEnabled: v.boolean(),
  },
  handler: async (ctx, { notificationsEnabled }) => {
    const { userProfile } = await requireUserProfile(ctx);

    await ctx.db.patch(userProfile._id, {
      notificationsEnabled,
      updatedAt: new Date().toISOString(),
    });

    return { success: true };
  },
});

/**
 * Update granular notification preferences
 * Supports partial updates - only provided fields are updated
 */
export const updateNotificationPreferences = mutation({
  args: {
    newTransactionsEnabled: v.optional(v.boolean()),
    remindersEnabled: v.optional(v.boolean()),
    reminderFrequency: v.optional(v.union(v.literal('gentle'), v.literal('aggressive'), v.literal('relentless'))),
  },
  handler: async (ctx, args) => {
    const { userProfile } = await requireUserProfile(ctx);

    const currentPrefs = userProfile.notificationPreferences ?? {
      newTransactionsEnabled: true,
      remindersEnabled: false,
      reminderFrequency: undefined,
    };

    const updatedPrefs = {
      newTransactionsEnabled: args.newTransactionsEnabled ?? currentPrefs.newTransactionsEnabled,
      remindersEnabled: args.remindersEnabled ?? currentPrefs.remindersEnabled,
      reminderFrequency: args.reminderFrequency ?? currentPrefs.reminderFrequency,
    };

    await ctx.db.patch(userProfile._id, {
      notificationPreferences: updatedPrefs,
      updatedAt: new Date().toISOString(),
    });

    return { success: true };
  },
});

/**
 * Set user onboarding completed
 * Simple mutation that marks user onboarding as complete.
 * Called by iOS after workspace data has been loaded.
 */
export const setUserOnboardingCompleted = mutation({
  args: {},
  handler: async (ctx) => {
    const { userProfile } = await requireUserProfile(ctx);

    // Prevent double completion
    if (userProfile.onboardingCompleted === true) {
      return { success: true };
    }

    await ctx.db.patch(userProfile._id, {
      onboardingCompleted: true,
      updatedAt: new Date().toISOString(),
    });

    return { success: true };
  },
});

/**
 * Request a free month from the paywall
 * Sends a Discord notification with the user's email and Clerk ID
 *
 * @deprecated The free-month request flow was removed from the iOS paywall.
 * Kept for backwards compatibility with older iOS clients still in the wild.
 * Remove once the next iOS update has rolled out.
 */
export const requestFreeMonth = mutation({
  args: {},
  handler: async (ctx) => {
    const { userProfile, user } = await requireUserProfile(ctx);

    // Send Discord notification (fire-and-forget)
    await ctx.scheduler.runAfter(0, internal.discord.sendDiscordNotification, {
      channel: 'free-month',
      title: 'Free Month Requested',
      description: userProfile.email,
      emoji: '🎁',
      userId: user.subject,
      metadata: { email: userProfile.email },
    });

    return { success: true };
  },
});
