import { ConvexError, v } from 'convex/values';
import { query } from '../_generated/server';
import { requireWorkspaceAccess } from '../lib/auth';
import { addDays, getCurrentDateForTimezone } from '../lib/dates';
import { buildHomeDashboard, HOME_LIMITS, resolveHomeMerchant } from './calculations';
import { dashboard } from './types';

export const getHomeDashboard = query({
  args: { workspaceId: v.id('workspace'), refreshKey: v.optional(v.string()) },
  returns: dashboard,
  handler: async (ctx, args) => {
    const { workspaceId } = await requireWorkspaceAccess(ctx, args.workspaceId);
    const workspace = await ctx.db.get(workspaceId);
    if (!workspace || workspace.isDeleted) throw new ConvexError('Workspace not found');
    // The client changes refreshKey at workspace-local midnight to invalidate a
    // cached time-dependent query. The server remains authoritative for the date.
    const today = getCurrentDateForTimezone(workspace.timezone);
    const [accounts, schedules, reviews, uncategorized, recent] = await Promise.all([
      ctx.db
        .query('bankAccount')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .take(HOME_LIMITS.accounts + 1),
      ctx.db
        .query('scheduledTransaction')
        .withIndex('by_workspaceId_isDeleted', (q) => q.eq('workspaceId', workspaceId).eq('isDeleted', false))
        .take(HOME_LIMITS.schedules + 1),
      ctx.db
        .query('transaction')
        .withIndex('by_workspaceId_reviewStatus_isDeleted', (q) =>
          q.eq('workspaceId', workspaceId).eq('reviewStatus', 'needs_review').eq('isDeleted', false)
        )
        .order('desc')
        .take(HOME_LIMITS.attention + 1),
      ctx.db
        .query('transaction')
        .withIndex('by_workspaceId_hasUncategorized_isDeleted', (q) =>
          q.eq('workspaceId', workspaceId).eq('hasUncategorized', true).eq('isDeleted', false)
        )
        .order('desc')
        .take(HOME_LIMITS.attention + 1),
      ctx.db
        .query('transaction')
        .withIndex('by_workspaceId_isDeleted_date', (q) =>
          q.eq('workspaceId', workspaceId).eq('isDeleted', false).gte('date', addDays(today, -14)).lt('date', today)
        )
        .take(HOME_LIMITS.spending + 1),
    ]);
    const merchantIds = new Set(
      [
        ...schedules.slice(0, HOME_LIMITS.schedules),
        ...reviews.slice(0, HOME_LIMITS.display),
        ...uncategorized.slice(0, HOME_LIMITS.display),
      ].flatMap((row) => (row.merchantId ? [row.merchantId] : []))
    );
    const merchantDocs = await Promise.all([...merchantIds].map((id) => ctx.db.get(id)));
    const merchants = merchantDocs
      .filter((m) => m !== null)
      .filter((m) => m.workspaceId === workspaceId && !m.isDeleted);
    const globalIds = new Set(merchants.flatMap((m) => (m.globalMerchantId ? [m.globalMerchantId] : [])));
    const globals = new Map(
      (await Promise.all([...globalIds].map((id) => ctx.db.get(id)))).filter((m) => m !== null).map((m) => [m._id, m])
    );
    const resolvedMerchants = merchants.map((m) =>
      resolveHomeMerchant(m, m.globalMerchantId ? globals.get(m.globalMerchantId) : undefined)
    );
    return buildHomeDashboard({
      workspace,
      today,
      accounts,
      schedules,
      reviews,
      uncategorized,
      recent,
      merchants: resolvedMerchants,
    });
  },
});
