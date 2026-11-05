import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { internalAction, internalQuery } from '../_generated/server';
import { getSafePlaidErrorDetails, plaidClient } from '../bankProviders/plaid/plaidClient';
import { type CleanupDecision, decisionValidator, inspectBankLink } from '../lib/plaidCleanup';

const PAGE_SIZE = 25;

const summaryValidator = v.object({
  inspected: v.number(),
  protected: v.number(),
  gracePeriod: v.number(),
  eligible: v.number(),
  disconnected: v.number(),
  alreadyRemoved: v.number(),
  errors: v.number(),
});
type CleanupSummary = {
  inspected: number;
  protected: number;
  gracePeriod: number;
  eligible: number;
  disconnected: number;
  alreadyRemoved: number;
  errors: number;
};

function emptySummary(): CleanupSummary {
  return { inspected: 0, protected: 0, gracePeriod: 0, eligible: 0, disconnected: 0, alreadyRemoved: 0, errors: 0 };
}

/** Admin-only manual entry point. Defaults to a complete, read-only preview. */
export const runNow = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  returns: v.union(
    v.object({ mode: v.literal('preview'), summary: summaryValidator }),
    v.object({ mode: v.literal('started'), scheduledFunctionId: v.id('_scheduled_functions') })
  ),
  handler: async (
    ctx,
    { dryRun = true }
  ): Promise<
    { mode: 'preview'; summary: CleanupSummary } | { mode: 'started'; scheduledFunctionId: Id<'_scheduled_functions'> }
  > => {
    if (!dryRun) {
      const scheduledFunctionId = await ctx.scheduler.runAfter(
        0,
        internal.revenuecat.expiredSubscriptionCleanup.processExpiredSubscriptions,
        {}
      );
      return { mode: 'started', scheduledFunctionId };
    }

    const summary = emptySummary();
    const now = new Date().toISOString();
    let cursor: string | null = null;
    do {
      const page: { decisions: CleanupDecision[]; nextCursor: string | null } = await ctx.runQuery(
        internal.revenuecat.expiredSubscriptionCleanup.previewCleanup,
        {
          cursor: cursor ?? undefined,
          now,
        }
      );
      for (const decision of page.decisions) {
        summary.inspected++;
        switch (decision.status) {
          case 'protected':
            summary.protected++;
            break;
          case 'grace_period':
            summary.gracePeriod++;
            break;
          case 'eligible':
            summary.eligible++;
            break;
          case 'removed':
            summary.alreadyRemoved++;
            break;
          case 'review':
            summary.errors++;
            break;
        }
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
    return { mode: 'preview', summary };
  },
});

/** Read-only preview. No credentials, mutations, scheduling, or notifications. */
export const previewCleanup = internalQuery({
  args: { cursor: v.optional(v.string()), now: v.string() },
  returns: v.object({ decisions: v.array(decisionValidator), nextCursor: v.union(v.string(), v.null()) }),
  handler: async (ctx, { cursor, now }) => {
    const at = new Date(now);
    if (!Number.isFinite(at.getTime())) throw new Error('Invalid cleanup timestamp');
    const page = await ctx.db
      .query('bankLink')
      .withIndex('by_creation_time')
      .paginate({ numItems: PAGE_SIZE, cursor: cursor ?? null });
    const decisions: CleanupDecision[] = [];
    for (const bankLink of page.page) decisions.push(await inspectBankLink(ctx, bankLink, at));
    return { decisions, nextCursor: page.isDone ? null : page.continueCursor };
  },
});

/** Fresh access check immediately before an external removal, including previously deleted rows. */
export const getRemovalCandidate = internalQuery({
  args: { bankLinkId: v.id('bankLink'), now: v.string() },
  returns: v.union(v.object({ decision: decisionValidator, accessToken: v.union(v.string(), v.null()) }), v.null()),
  handler: async (ctx, { bankLinkId, now }) => {
    const at = new Date(now);
    if (!Number.isFinite(at.getTime())) throw new Error('Invalid cleanup timestamp');
    const bankLink = await ctx.db.get(bankLinkId);
    if (!bankLink) return null;
    const decision = await inspectBankLink(ctx, bankLink, at);
    return { decision, accessToken: decision.status === 'eligible' ? bankLink.accessToken : null };
  },
});

export async function removeEligibleBankLink(
  ctx: ActionCtx,
  bankLinkId: Id<'bankLink'>
): Promise<'disconnected' | 'protected' | 'grace_period' | 'removed' | 'review'> {
  const candidate = await ctx.runQuery(internal.revenuecat.expiredSubscriptionCleanup.getRemovalCandidate, {
    bankLinkId,
    now: new Date().toISOString(),
  });
  if (!candidate) return 'removed';
  if (candidate.decision.status !== 'eligible') return candidate.decision.status;
  if (!candidate.accessToken) throw new Error('Eligible bank link has no access token');
  try {
    // Legacy rows without a provider are also Plaid. Never just mark them removed locally.
    await plaidClient.itemRemove({ access_token: candidate.accessToken }, { timeout: 10_000 });
  } catch (error: unknown) {
    const details = getSafePlaidErrorDetails(error);
    if (details.error_code !== 'ITEM_NOT_FOUND' && details.error_code !== 'INVALID_ACCESS_TOKEN') {
      // Do not persist/log Axios request objects, tokens, or upstream error messages.
      throw new Error(
        `Plaid removal failed: ${details.error_code ?? 'UNKNOWN'} (${details.request_id ?? 'no request id'})`
      );
    }
  }
  // Failed local finalization stays eligible; the next run safely retries an already-removed Item.
  await ctx.runMutation(internal.internal.bankLinks.softDeleteBankLink, {
    bankLinkId,
    externalProviderDisconnected: true,
  });
  return 'disconnected';
}

/** Weekly sweep over bank links, not subscription rows. Bounded pages continue as separate actions. */
export const processExpiredSubscriptions = internalAction({
  args: { cursor: v.optional(v.string()), summary: v.optional(summaryValidator) },
  returns: v.object({ summary: summaryValidator, nextCursor: v.union(v.string(), v.null()) }),
  handler: async (
    ctx,
    { cursor, summary: previous }
  ): Promise<{ summary: CleanupSummary; nextCursor: string | null }> => {
    const summary = previous ?? emptySummary();
    const page = await ctx.runQuery(internal.revenuecat.expiredSubscriptionCleanup.previewCleanup, {
      cursor,
      now: new Date().toISOString(),
    });
    for (const decision of page.decisions) {
      summary.inspected++;
      if (decision.status === 'review') {
        summary.errors++;
        console.error('Plaid cleanup access review required', {
          bankLinkId: decision.bankLinkId,
          reason: decision.reason,
        });
        continue;
      }
      if (decision.status === 'removed') {
        summary.alreadyRemoved++;
        continue;
      }
      if (decision.status === 'protected') {
        summary.protected++;
        continue;
      }
      if (decision.status === 'grace_period') {
        summary.gracePeriod++;
        continue;
      }
      summary.eligible++;
      try {
        const result = await removeEligibleBankLink(ctx, decision.bankLinkId);
        if (result === 'disconnected') summary.disconnected++;
        else if (result === 'protected') summary.protected++;
        else if (result === 'grace_period') summary.gracePeriod++;
        else if (result === 'review') summary.errors++;
        else summary.alreadyRemoved++;
      } catch (error: unknown) {
        summary.errors++;
        console.error('Plaid cleanup failed; will retry next sweep', {
          bankLinkId: decision.bankLinkId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
    if (page.nextCursor !== null) {
      await ctx.scheduler.runAfter(0, internal.revenuecat.expiredSubscriptionCleanup.processExpiredSubscriptions, {
        cursor: page.nextCursor,
        summary,
      });
    } else {
      console.log('Plaid access cleanup complete', summary);
      await ctx.runAction(internal.discord.sendDiscordNotification, {
        channel: 'cleanup',
        title: 'Plaid Access Cleanup',
        description: `Checked: ${summary.inspected} | Protected: ${summary.protected} | Grace: ${summary.gracePeriod}\nDisconnected: ${summary.disconnected} | Errors: ${summary.errors}`,
        emoji: summary.errors > 0 ? '⚠️' : '🧹',
        metadata: Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, String(value)])),
      });
    }
    return { summary, nextCursor: page.nextCursor };
  },
});
