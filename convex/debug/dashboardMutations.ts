import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalMutation } from '../_generated/server';
import type { WorkspaceValidationResult } from '../validation/types';

/**
 * Dashboard mutation to validate a workspace - easier to trigger from dashboard
 * Run with: npx convex run debug/dashboardMutations:validateWorkspace '{"workspaceId": "..."}' --prod
 */
export const validateWorkspace = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { workspaceId }): Promise<WorkspaceValidationResult> => {
    return ctx.runQuery(internal.validation.singleWorkspaceOptimized.validateWorkspaceOptimized, {
      workspaceId,
    }) as Promise<WorkspaceValidationResult>;
  },
});

/**
 * Dashboard mutation to explain RTA - easier to trigger from dashboard
 * Run with: npx convex run debug/dashboardMutations:explainReadyToAssign '{"workspaceId": "..."}' --prod
 */
export const explainReadyToAssign = internalMutation({
  args: {
    workspaceId: v.string(),
  },
  // biome-ignore lint/suspicious/noExplicitAny: Debug mutations intentionally accept arbitrary table documents.
  handler: async (ctx, { workspaceId }): Promise<any> => {
    return ctx.runQuery(internal.workspaces.explainReadyToAssign.explainReadyToAssign, {
      workspaceId,
    });
  },
});
