import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction, internalMutation } from '../_generated/server';
import { isDev } from '../lib/devUtils';
import type { BatchValidationResult, WorkspaceIssuesSummary } from './types';

const DEFAULT_BATCH_SIZE = 15;

/**
 * Entry point for validation run (called by cron job or manually)
 * Generates a run ID and starts processing
 */
export const startValidationRun = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (isDev()) {
      return null;
    }

    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();

    // Schedule the first batch
    await ctx.scheduler.runAfter(0, internal.validation.batchOrchestrator.processBatch, {
      cursor: undefined,
      batchSize: DEFAULT_BATCH_SIZE,
      runId,
      batchNumber: 1,
      accumulatedIssues: [],
      totalProcessed: 0,
      startedAt,
    });

    return { runId, startedAt };
  },
});

/**
 * Process a batch of workspaces
 * Uses cursor-based pagination to iterate through all workspaces
 */
export const processBatch = internalMutation({
  args: {
    cursor: v.optional(v.id('workspace')),
    batchSize: v.optional(v.number()),
    runId: v.string(),
    batchNumber: v.number(),
    accumulatedIssues: v.array(
      v.object({
        workspaceId: v.id('workspace'),
        workspaceName: v.string(),
        issueCount: v.number(),
        issueTypes: v.array(v.string()),
      })
    ),
    totalProcessed: v.number(),
    startedAt: v.string(),
  },
  handler: async (ctx, args): Promise<BatchValidationResult> => {
    const {
      cursor,
      batchSize = DEFAULT_BATCH_SIZE,
      runId,
      batchNumber,
      accumulatedIssues,
      totalProcessed,
      startedAt,
    } = args;

    // Query workspaces with pagination
    let workspacesQuery = ctx.db.query('workspace');

    if (cursor) {
      const cursorWorkspace = await ctx.db.get(cursor);
      if (cursorWorkspace) {
        workspacesQuery = workspacesQuery.filter((q) => q.gt(q.field('_creationTime'), cursorWorkspace._creationTime));
      }
    }

    // Take one extra to check if there are more
    const workspaces = await workspacesQuery.take(batchSize + 1);

    const hasMore = workspaces.length > batchSize;
    const toProcess = workspaces.slice(0, batchSize);

    // Validate each workspace
    const batchIssues: WorkspaceIssuesSummary[] = [];

    for (const workspace of toProcess) {
      try {
        const validationResult = await ctx.runQuery(internal.validation.singleWorkspace.validateWorkspace, {
          workspaceId: workspace._id,
        });

        if (!validationResult.isValid) {
          const issueTypes: string[] = validationResult.issues.map((i: { type: string }) => i.type);
          batchIssues.push({
            workspaceId: workspace._id,
            workspaceName: workspace.name ?? 'Unknown',
            issueCount: validationResult.summary.totalIssues,
            issueTypes: Array.from(new Set(issueTypes)),
          });
        }
      } catch (error) {
        console.error(`[Validation] Error validating workspace ${workspace._id}:`, error);
        // Continue processing other workspaces
      }
    }

    const newAccumulatedIssues = [...accumulatedIssues, ...batchIssues];
    const newTotalProcessed = totalProcessed + toProcess.length;
    const lastWorkspaceId = toProcess[toProcess.length - 1]?._id ?? null;

    if (hasMore && lastWorkspaceId) {
      // Schedule next batch
      await ctx.scheduler.runAfter(0, internal.validation.batchOrchestrator.processBatch, {
        cursor: lastWorkspaceId,
        batchSize,
        runId,
        batchNumber: batchNumber + 1,
        accumulatedIssues: newAccumulatedIssues,
        totalProcessed: newTotalProcessed,
        startedAt,
      });
    } else {
      // Final batch - send report

      await ctx.scheduler.runAfter(0, internal.validation.discordReporter.sendReport, {
        runId,
        startedAt,
        completedAt: new Date().toISOString(),
        totalWorkspacesProcessed: newTotalProcessed,
        workspacesWithIssues: newAccumulatedIssues,
      });
    }

    return {
      runId,
      batchNumber,
      processedCount: toProcess.length,
      hasMore,
      lastCursor: lastWorkspaceId,
      workspacesWithIssues: batchIssues,
    };
  },
});

/**
 * Manually trigger validation for a specific workspace
 * Useful for testing or targeted validation
 */
export const validateSingleWorkspace = internalAction({
  args: {
    workspaceId: v.id('workspace'),
    sendReport: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { workspaceId, sendReport = false }
  ): Promise<{
    workspaceId: string;
    workspaceName: string;
    isValid: boolean;
    summary: {
      totalIssues: number;
    };
  }> => {
    const result = (await ctx.runQuery(internal.validation.singleWorkspace.validateWorkspace, {
      workspaceId,
    })) as {
      workspaceId: string;
      workspaceName: string;
      isValid: boolean;
      issues: Array<{ type: string }>;
      summary: { totalIssues: number };
    };

    if (sendReport && !result.isValid) {
      const runId = `manual-${crypto.randomUUID().slice(0, 8)}`;
      const issueTypes = result.issues.map((i) => i.type);

      await ctx.runAction(internal.validation.discordReporter.sendReport, {
        runId,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        totalWorkspacesProcessed: 1,
        workspacesWithIssues: [
          {
            workspaceId: workspaceId,
            workspaceName: result.workspaceName,
            issueCount: result.summary.totalIssues,
            issueTypes: [...new Set(issueTypes)],
          },
        ],
      });
    }

    return {
      workspaceId: result.workspaceId,
      workspaceName: result.workspaceName,
      isValid: result.isValid,
      summary: result.summary,
    };
  },
});
