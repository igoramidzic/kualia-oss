import { abortStream, listStreams } from '@convex-dev/agent';
import { v } from 'convex/values';

import { components } from '../_generated/api';
import { internalAction, internalMutation } from '../_generated/server';

const USERS_PAGE_SIZE = 200;
const THREADS_PAGE_SIZE = 200;

interface AbortStuckStreamsSummary {
  usersScanned: number;
  threadsScanned: number;
  streamsFound: number;
  streamsAborted: number;
}

/**
 * Walks every user-with-threads in the agent component, lists each thread's
 * currently-streaming streams, and aborts them. Wired as a cron (see
 * `convex/crons.ts`) on a 30-min cadence — well above any legitimate stream's
 * lifetime (capped at ~10 min by the Convex action limit), so it acts purely
 * as a safety net for streams the agent's built-in 10-min heartbeat timeout
 * failed to finalize.
 *
 * Pass `dryRun: true` from the dashboard to see how many streams would be
 * aborted without touching anything. Aborts are irreversible — any
 * legitimately-active send in flight at the moment of execution will be
 * cancelled too (the user can retry).
 */
export const abortStuckStreams = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { dryRun = false, reason = 'cleanup-stuck-stream' }): Promise<AbortStuckStreamsSummary> => {
    const summary: AbortStuckStreamsSummary = {
      usersScanned: 0,
      threadsScanned: 0,
      streamsFound: 0,
      streamsAborted: 0,
    };

    let userCursor: string | null = null;
    while (true) {
      const userPage: {
        page: string[];
        continueCursor: string;
        isDone: boolean;
      } = await ctx.runQuery(components.agent.users.listUsersWithThreads, {
        paginationOpts: { numItems: USERS_PAGE_SIZE, cursor: userCursor },
      });

      for (const userId of userPage.page) {
        summary.usersScanned += 1;

        let threadCursor: string | null = null;
        while (true) {
          const threadPage: {
            page: Array<{ _id: string }>;
            continueCursor: string;
            isDone: boolean;
          } = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
            userId,
            order: 'desc',
            paginationOpts: { numItems: THREADS_PAGE_SIZE, cursor: threadCursor },
          });

          for (const thread of threadPage.page) {
            summary.threadsScanned += 1;
            const streams = await listStreams(ctx, components.agent, {
              threadId: thread._id,
              includeStatuses: ['streaming'],
            });
            summary.streamsFound += streams.length;
            if (dryRun) continue;
            for (const stream of streams) {
              const aborted = await abortStream(ctx, components.agent, {
                streamId: stream.streamId,
                reason,
              });
              if (aborted) {
                summary.streamsAborted += 1;
                console.log('[aiChat.cleanup] aborted stuck stream', {
                  threadId: thread._id,
                  streamId: stream.streamId,
                  userId,
                });
              }
            }
          }

          if (threadPage.isDone) break;
          threadCursor = threadPage.continueCursor;
        }
      }

      if (userPage.isDone) break;
      userCursor = userPage.continueCursor;
    }

    if (summary.streamsFound > 0 || summary.streamsAborted > 0) {
      console.log('[aiChat.cleanup] sweep complete', summary);
    }
    return summary;
  },
});

/**
 * Narrower variant: abort every streaming stream on a single known thread.
 * Useful when you've already identified the stuck thread in the dashboard and
 * don't want to walk the entire user/thread space.
 */
export const abortStuckStreamsForThread = internalMutation({
  args: {
    threadId: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { threadId, reason = 'cleanup-stuck-stream' }): Promise<{ aborted: number }> => {
    const streams = await listStreams(ctx, components.agent, {
      threadId,
      includeStatuses: ['streaming'],
    });
    let aborted = 0;
    for (const stream of streams) {
      const ok = await abortStream(ctx, components.agent, {
        streamId: stream.streamId,
        reason,
      });
      if (ok) aborted += 1;
    }
    return { aborted };
  },
});
