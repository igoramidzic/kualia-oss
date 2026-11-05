import { internalMutation } from '../_generated/server';

/**
 * Aggregate subscription funnel by userProfile.referralSource.
 *
 * Every subscription on iOS begins with a free trial, so any user with a (non-deleted)
 * subscription record is treated as having started a trial. This avoids the bug where
 * subscriptionType/periodType/status are overwritten in place when a trial converts to
 * paid, which erases the trial signal from the row.
 *
 * Buckets per referralSource:
 *  - totalUsers:        all userProfiles with this referralSource
 *  - trialStarted:      users who have any subscription record (= ever started a trial)
 *  - converted:         users who ever reached a paid state
 *                       (subscriptionType in monthly/yearly/lifetime, OR periodType in NORMAL/INTRO/PROMOTIONAL/PREPAID)
 *  - currentlyPaying:   users with an active paid subscription right now
 *                       (status=active AND subscriptionType in monthly/yearly/lifetime)
 *  - currentlyTrialing: users with status=trialing right now
 *
 * Trial → paid conversion rate per row = converted / trialStarted.
 *
 * Users with a null/empty referralSource are excluded.
 *
 * Run with:
 *   npx convex run debug/referralSubscriptions:referralFunnel --prod
 */
export const referralFunnel = internalMutation({
  args: {},
  handler: async (ctx) => {
    const profiles = await ctx.db.query('userProfile').collect();
    const subs = await ctx.db
      .query('subscription')
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    const subsByClerkId = new Map<string, typeof subs>();
    for (const sub of subs) {
      const list = subsByClerkId.get(sub.clerkId) ?? [];
      list.push(sub);
      subsByClerkId.set(sub.clerkId, list);
    }

    type Bucket = {
      referralSource: string;
      totalUsers: number;
      trialStarted: number;
      converted: number;
      currentlyTrialing: number;
      currentlyPaying: number;
    };

    const buckets = new Map<string, Bucket>();
    const paidTypes = new Set(['monthly', 'yearly', 'lifetime']);
    const paidPeriodTypes = new Set(['NORMAL', 'INTRO', 'PROMOTIONAL', 'PREPAID']);

    for (const profile of profiles) {
      if (!profile.referralSource || profile.referralSource.trim() === '') continue;
      const key = profile.referralSource;

      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          referralSource: key,
          totalUsers: 0,
          trialStarted: 0,
          converted: 0,
          currentlyTrialing: 0,
          currentlyPaying: 0,
        };
        buckets.set(key, bucket);
      }

      bucket.totalUsers += 1;

      const userSubs = subsByClerkId.get(profile.clerkId) ?? [];
      if (userSubs.length === 0) continue;

      // Every subscription starts with a trial, so any sub record means a trial was started.
      bucket.trialStarted += 1;

      let everPaid = false;
      let nowTrialing = false;
      let nowPaying = false;

      for (const sub of userSubs) {
        if (paidTypes.has(sub.subscriptionType) || (sub.periodType && paidPeriodTypes.has(sub.periodType))) {
          everPaid = true;
        }
        if (sub.status === 'trialing') nowTrialing = true;
        if (sub.status === 'active' && paidTypes.has(sub.subscriptionType)) nowPaying = true;
      }

      if (everPaid) bucket.converted += 1;
      if (nowTrialing) bucket.currentlyTrialing += 1;
      if (nowPaying) bucket.currentlyPaying += 1;
    }

    const rows = Array.from(buckets.values()).sort((a, b) => b.totalUsers - a.totalUsers);

    const totals = rows.reduce(
      (acc, r) => ({
        referralSource: 'TOTAL',
        totalUsers: acc.totalUsers + r.totalUsers,
        trialStarted: acc.trialStarted + r.trialStarted,
        converted: acc.converted + r.converted,
        currentlyTrialing: acc.currentlyTrialing + r.currentlyTrialing,
        currentlyPaying: acc.currentlyPaying + r.currentlyPaying,
      }),
      {
        referralSource: 'TOTAL',
        totalUsers: 0,
        trialStarted: 0,
        converted: 0,
        currentlyTrialing: 0,
        currentlyPaying: 0,
      }
    );

    return { rows, totals };
  },
});
