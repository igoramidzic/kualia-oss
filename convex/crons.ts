import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

const crons = cronJobs();

/**
 * Daily data integrity validation
 * Runs at 3 AM UTC every day to validate all workspace data
 * Sends Discord report if any issues are found
 */
crons.cron('data-integrity-validation', '0 3 * * *', internal.validation.batchOrchestrator.startValidationRun);

/**
 * Daily transfer match expiration
 * Runs at 4 AM UTC every day to expire pending transfer matches
 * that have passed their 30-day expiration window without finding a counterpart
 */
crons.cron('expire-pending-transfer-matches', '0 4 * * *', internal.transferDetection.internal.expireOldPendingMatches);

/**
 * Weekly cleanup of old pending matches
 * Runs every Sunday at 5 AM UTC to soft-delete expired/rejected matches older than 90 days
 */
crons.cron('cleanup-old-pending-matches', '0 5 * * 0', internal.transferDetection.internal.cleanupOldPendingMatches);

/**
 * Daily signup report
 * Runs at 7 AM EST (12:00 UTC) every day
 * Sends Discord notification with signup stats: last 24h, vs previous day, 7-day average
 */
crons.cron('daily-signup-report', '0 12 * * *', internal.discord.dailySignupReport.runDailySignupReport);

/**
 * Scheduled transaction auto-entry
 * Runs at 5 minutes past every hour to enter due scheduled transactions into the register.
 * Each schedule's nextRunAt targets 7am in its workspace's timezone on the due date, so
 * entries land shortly after 7am local time everywhere. Offset from scheduled-reminders
 * (minute 0) to spread load.
 */
crons.cron(
  'scheduled-transaction-entry',
  '5 * * * *',
  internal.scheduledTransactions.cron.processDueScheduledTransactions
);

/**
 * Scheduled (planned) transaction reminders
 * Runs at the top of every hour to send push notifications for due planned-transaction
 * reminders (9am in each workspace's timezone).
 */
crons.cron('scheduled-reminders', '0 * * * *', internal.scheduledTransactions.reminders.processScheduledReminders);

/**
 * Weekly cleanup of orphaned logo files
 * Runs every Sunday at 6 AM UTC to delete logo files that have been orphaned for more than 7 days
 * This prevents storage bloat from replaced/removed custom logos
 */
crons.cron('cleanup-orphaned-logos', '0 6 * * 0', internal.storage.logoCleanup.cleanupOrphanedLogos);

/**
 * Weekly Plaid disconnection for links without effective app access.
 * Runs every Sunday at 2 AM UTC, after a seven-day recovery grace period.
 * Protects valid personal, lifetime, promotional, family, and shared-workspace access.
 */
crons.cron(
  'disconnect-expired-plaid-items',
  '0 2 * * 0',
  internal.revenuecat.expiredSubscriptionCleanup.processExpiredSubscriptions,
  {}
);

/**
 * AI chat stuck-stream sweeper.
 *
 * Aborts any agent-component stream still in `streaming` status. Safety net
 * behind two earlier mechanisms:
 *   (1) the action's own poll loop in actionsNode.ts:292
 *   (2) the agent component's built-in 10-min `lastHeartbeat` timeout
 *
 * Either of those should normally finalize a stream — this cron only catches
 * the case where both failed (e.g. Convex killed the action at the 600s
 * wall-clock limit before the heartbeat reschedule fired, leaving a dangling
 * streamingMessages row whose subscribers keep re-firing `streams:list`).
 *
 * 30-min cadence is well above any legitimate stream's lifetime (capped at ~10
 * min by the Convex action limit), so this won't collide with a live send.
 */
crons.cron('ai-chat-stuck-stream-sweep', '*/30 * * * *', internal.aiChat.cleanup.abortStuckStreams, {});

/**
 * Durable retry for account-deletion web billing cancellation.
 * Pending RevenueCat/Stripe cancellations remain eligible until a provider
 * confirms that renewal has stopped, even after the generic cleanup retries end.
 */
crons.interval(
  'retry-account-deletion-billing-cancellations',
  { hours: 1 },
  internal.accountDeletion.actionsNode.processPendingBillingCancellations,
  {}
);

/**
 * Monthly permanent deletion of financial data whose 30-day retention period has elapsed.
 * Clerk identity, profile tombstones, Loops opt-outs, and billing history are retained.
 */
crons.cron('purge-deleted-user-accounts', '0 6 1 * *', internal.accountDeletion.actionsNode.processDeletedAccounts, {});

export default crons;
