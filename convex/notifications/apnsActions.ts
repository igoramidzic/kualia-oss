import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction, internalQuery } from '../_generated/server';

interface NotificationResult {
  success: boolean;
  reason?: string;
}

interface WorkspaceNotificationResult {
  success: boolean;
  sentCount: number;
  totalUsers: number;
}

/**
 * Send transaction notification to a specific user
 */
export const sendTransactionNotification = internalAction({
  args: {
    clerkId: v.string(),
    transactionCount: v.number(),
    workspaceId: v.optional(v.string()),
  },
  handler: async (ctx, { clerkId, transactionCount, workspaceId }): Promise<NotificationResult> => {
    // Get user's notification info - check transaction notification preference
    const userInfo = await ctx.runMutation(internal.notifications.apns.getUserNotificationInfo, {
      clerkId,
      notificationType: 'transaction',
    });

    if (!userInfo) {
      console.log(`[APNS] User profile not found for clerkId: ${clerkId}`);
      return { success: false, reason: 'user_not_found' };
    }

    if (!userInfo.notificationsEnabled) {
      console.log(`[APNS] Notifications disabled for user: ${clerkId}`);
      return { success: false, reason: 'notifications_disabled' };
    }

    if (!userInfo.apnsDeviceToken) {
      console.log(`[APNS] No device token for user: ${clerkId}`);
      return { success: false, reason: 'no_device_token' };
    }

    // Calculate badge count for this user (overspent categories + needs review transactions)
    const badgeCount = await ctx.runMutation(internal.notifications.apns.calculateUserBadgeCount, {
      clerkId,
    });
    console.log(`[APNS] Calculated badge count for user ${clerkId}: ${badgeCount}`);

    // Build notification message
    const title = 'New Transactions';
    const body = transactionCount === 1 ? '1 transaction to review' : `${transactionCount} transactions to review`;

    // Send the push notification with badge count
    await ctx.runAction(internal.notifications.apns.sendPushNotification, {
      deviceToken: userInfo.apnsDeviceToken,
      title,
      body,
      badge: badgeCount,
      type: 'transactions',
      workspaceId,
    });

    return { success: true };
  },
});

/**
 * Send transaction notification to all users in a workspace
 */
export const sendTransactionNotificationForWorkspace = internalAction({
  args: {
    workspaceId: v.id('workspace'),
    transactionCount: v.number(),
  },
  handler: async (ctx, { workspaceId, transactionCount }): Promise<WorkspaceNotificationResult> => {
    console.log(`[APNS] Starting notification for workspace ${workspaceId}, ${transactionCount} new transactions`);

    // Get every user with access to the workspace.
    const clerkIds: string[] = await ctx.runQuery(internal.workspaces.getWorkspaceMemberClerkIds, {
      workspaceId,
    });

    console.log(`[APNS] Found ${clerkIds.length} user(s) in workspace ${workspaceId}`);

    // Send notification to each user
    let successCount = 0;
    for (const clerkId of clerkIds) {
      try {
        const result: NotificationResult = await ctx.runAction(
          internal.notifications.apnsActions.sendTransactionNotification,
          {
            clerkId,
            transactionCount,
            workspaceId: workspaceId as string,
          }
        );
        if (result.success) {
          successCount++;
        }
      } catch (error) {
        console.error(`[APNS] Failed to send notification to user ${clerkId}:`, error);
      }
    }

    console.log(
      `[APNS] Notification complete for workspace ${workspaceId}: ${successCount}/${clerkIds.length} sent successfully`
    );

    return { success: true, sentCount: successCount, totalUsers: clerkIds.length };
  },
});

/**
 * Send planned transaction reminder notification to a specific user
 */
export const sendPlannedReminderNotification = internalAction({
  args: {
    clerkId: v.string(),
    merchantName: v.string(),
    amount: v.int64(), // In cents
    dueDate: v.string(), // ISO date string (YYYY-MM-DD)
    reminderType: v.union(
      v.literal('on_due_date'),
      v.literal('1_day_before'),
      v.literal('2_days_before'),
      v.literal('1_week_before'),
      v.literal('1_month_before')
    ),
    scheduledTransactionId: v.string(),
    workspaceId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { clerkId, merchantName, amount, dueDate, reminderType, scheduledTransactionId, workspaceId }
  ): Promise<NotificationResult> => {
    // Get user's notification info - recurring reminders only check the global toggle
    const userInfo = await ctx.runMutation(internal.notifications.apns.getUserNotificationInfo, {
      clerkId,
      notificationType: 'recurringReminder',
    });

    if (!userInfo) {
      console.log(`[APNS] User profile not found for clerkId: ${clerkId}`);
      return { success: false, reason: 'user_not_found' };
    }

    if (!userInfo.notificationsEnabled) {
      console.log(`[APNS] Reminder notifications disabled for user: ${clerkId}`);
      return { success: false, reason: 'notifications_disabled' };
    }

    if (!userInfo.apnsDeviceToken) {
      console.log(`[APNS] No device token for user: ${clerkId}`);
      return { success: false, reason: 'no_device_token' };
    }

    // Calculate badge count for this user
    const badgeCount = await ctx.runMutation(internal.notifications.apns.calculateUserBadgeCount, {
      clerkId,
    });

    // Format amount (convert cents to dollars)
    const amountNum = Number(amount);
    const isIncome = amountNum > 0;
    const formattedAmount = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(Math.abs(amountNum) / 100);

    // Build notification message based on reminder type
    let body: string;
    switch (reminderType) {
      case 'on_due_date':
        body = `${merchantName} ${formattedAmount} is due today`;
        break;
      case '1_day_before':
        body = `${merchantName} ${formattedAmount} is due tomorrow`;
        break;
      case '2_days_before':
        body = `${merchantName} ${formattedAmount} is due in 2 days`;
        break;
      case '1_week_before':
        body = `${merchantName} ${formattedAmount} is due in 1 week`;
        break;
      case '1_month_before':
        body = `${merchantName} ${formattedAmount} is due in 1 month`;
        break;
    }

    // Send the push notification with badge count and deep link data
    await ctx.runAction(internal.notifications.apns.sendPushNotification, {
      deviceToken: userInfo.apnsDeviceToken,
      title: isIncome ? 'Upcoming Income' : 'Upcoming Payment',
      body,
      badge: badgeCount,
      type: `scheduled:${scheduledTransactionId}`,
      workspaceId,
    });

    return { success: true };
  },
});

/**
 * Send planned transaction reminder notification to all users in a workspace
 */
export const sendPlannedReminderForWorkspace = internalAction({
  args: {
    workspaceId: v.id('workspace'),
    merchantName: v.string(),
    amount: v.int64(),
    dueDate: v.string(),
    reminderType: v.union(
      v.literal('on_due_date'),
      v.literal('1_day_before'),
      v.literal('2_days_before'),
      v.literal('1_week_before'),
      v.literal('1_month_before')
    ),
    scheduledTransactionId: v.string(),
  },
  handler: async (
    ctx,
    { workspaceId, merchantName, amount, dueDate, reminderType, scheduledTransactionId }
  ): Promise<WorkspaceNotificationResult> => {
    console.log(`[APNS] Starting planned reminder for workspace ${workspaceId}, ${merchantName}`);

    // Get every user with access to the workspace.
    const clerkIds: string[] = await ctx.runQuery(internal.workspaces.getWorkspaceMemberClerkIds, {
      workspaceId,
    });

    console.log(`[APNS] Found ${clerkIds.length} user(s) in workspace ${workspaceId}`);

    // Send notification to each user
    let successCount = 0;
    for (const clerkId of clerkIds) {
      try {
        const result: NotificationResult = await ctx.runAction(
          internal.notifications.apnsActions.sendPlannedReminderNotification,
          {
            clerkId,
            merchantName,
            amount,
            dueDate,
            reminderType,
            scheduledTransactionId,
            workspaceId: workspaceId as string,
          }
        );
        if (result.success) {
          successCount++;
        }
      } catch (error) {
        console.error(`[APNS] Failed to send recurring reminder to user ${clerkId}:`, error);
      }
    }

    console.log(
      `[APNS] Planned reminder complete for workspace ${workspaceId}: ${successCount}/${clerkIds.length} sent successfully`
    );

    return { success: true, sentCount: successCount, totalUsers: clerkIds.length };
  },
});

/**
 * Get institution name for a bank link (used by notification actions)
 */
export const getInstitutionNameForBankLink = internalQuery({
  args: { bankLinkId: v.id('bankLink') },
  handler: async (ctx, { bankLinkId }): Promise<string> => {
    const bankLink = await ctx.db.get(bankLinkId);
    if (!bankLink) return 'Your bank';
    const institution = await ctx.db.get(bankLink.globalInstitutionId);
    return institution?.name ?? 'Your bank';
  },
});

/**
 * Send push notification when a bank link status transitions from Healthy to non-Healthy
 */
export const sendBankLinkStatusNotification = internalAction({
  args: {
    clerkId: v.string(),
    bankLinkId: v.id('bankLink'),
    newStatus: v.union(v.literal('Error'), v.literal('Pending'), v.literal('Disconnected')),
    workspaceId: v.optional(v.string()),
  },
  handler: async (ctx, { clerkId, bankLinkId, newStatus, workspaceId }): Promise<NotificationResult> => {
    // Check global notification toggle
    const userInfo = await ctx.runMutation(internal.notifications.apns.getUserNotificationInfo, {
      clerkId,
      notificationType: 'transaction',
    });

    if (!userInfo) {
      console.log(`[APNS] User profile not found for clerkId: ${clerkId}`);
      return { success: false, reason: 'user_not_found' };
    }

    if (!userInfo.notificationsEnabled) {
      console.log(`[APNS] Notifications disabled for user: ${clerkId}`);
      return { success: false, reason: 'notifications_disabled' };
    }

    if (!userInfo.apnsDeviceToken) {
      console.log(`[APNS] No device token for user: ${clerkId}`);
      return { success: false, reason: 'no_device_token' };
    }

    // Get institution name for the notification
    const institutionName = await ctx.runQuery(internal.notifications.apnsActions.getInstitutionNameForBankLink, {
      bankLinkId,
    });

    const badgeCount = await ctx.runMutation(internal.notifications.apns.calculateUserBadgeCount, {
      clerkId,
    });

    const title = 'Bank Connection Issue';
    const body =
      newStatus === 'Pending'
        ? `${institutionName} requires re-authentication`
        : newStatus === 'Disconnected'
          ? `${institutionName} has been disconnected`
          : `${institutionName} has a connection error`;

    await ctx.runAction(internal.notifications.apns.sendPushNotification, {
      deviceToken: userInfo.apnsDeviceToken,
      title,
      body,
      badge: badgeCount,
      type: 'bankLink',
      workspaceId,
    });

    return { success: true };
  },
});
