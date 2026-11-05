import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction, internalMutation } from '../_generated/server';
import { isDev } from '../lib/devUtils';

const HOURS_24_MS = 24 * 60 * 60 * 1000;
const DAYS_7_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Entry point for daily signup report (called by cron job)
 * Queries user signups and schedules the Discord notification
 */
export const runDailySignupReport = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Skip in development
    if (isDev()) {
      return null;
    }

    const now = Date.now();
    const twentyFourHoursAgo = now - HOURS_24_MS;
    const fortyEightHoursAgo = now - 2 * HOURS_24_MS;
    const sevenDaysAgo = now - DAYS_7_MS;

    // Query all user profiles
    // Using filter on _creationTime since there's no index for it
    const allProfiles = await ctx.db.query('userProfile').collect();

    // Count signups in different time periods
    const last24hCount = allProfiles.filter((p) => p._creationTime >= twentyFourHoursAgo).length;

    const previous24hCount = allProfiles.filter(
      (p) => p._creationTime >= fortyEightHoursAgo && p._creationTime < twentyFourHoursAgo
    ).length;

    const last7DaysCount = allProfiles.filter((p) => p._creationTime >= sevenDaysAgo).length;

    const sevenDayAverage = last7DaysCount / 7;

    // Schedule the Discord notification action
    await ctx.scheduler.runAfter(0, internal.discord.dailySignupReport.sendSignupReport, {
      last24hCount,
      previous24hCount,
      sevenDayAverage,
    });

    return {
      last24hCount,
      previous24hCount,
      sevenDayAverage,
    };
  },
});

/**
 * Send the signup report to Discord
 * Called by runDailySignupReport after gathering stats
 */
export const sendSignupReport = internalAction({
  args: {
    last24hCount: v.number(),
    previous24hCount: v.number(),
    sevenDayAverage: v.number(),
  },
  handler: async (ctx, { last24hCount, previous24hCount, sevenDayAverage }) => {
    const change = last24hCount - previous24hCount;
    const changeText = change > 0 ? `+${change}` : change < 0 ? `${change}` : 'No change';

    const description =
      `${last24hCount} new users (${changeText} vs previous day)\n` +
      `7-day avg: ${sevenDayAverage.toFixed(1)} signups/day`;

    try {
      await ctx.runAction(internal.discord.sendDiscordNotification, {
        channel: 'daily-report',
        title: 'Daily Signup Report',
        description,
        emoji: '📊',
        metadata: {
          last24h: String(last24hCount),
          previous24h: String(previous24hCount),
          sevenDayAverage: sevenDayAverage.toFixed(1),
          change: changeText,
        },
      });
      console.log('Daily signup report sent successfully', {
        last24hCount,
        previous24hCount,
        sevenDayAverage,
      });
      return { success: true };
    } catch (error: unknown) {
      console.error('Failed to send daily signup report:', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
