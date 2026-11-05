import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalQuery, query } from '../_generated/server';
import { requireWorkspaceAccess } from '../lib/auth';
import type { ValidationSummary, WorkspaceValidationResult } from './types';

/**
 * Internal query to validate a single workspace
 * Uses the optimized single-pass validation to avoid reading data multiple times
 */
export const validateWorkspace = internalQuery({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }): Promise<WorkspaceValidationResult> => {
    // Delegate to the optimized implementation that queries all data once
    return ctx.runQuery(internal.validation.singleWorkspaceOptimized.validateWorkspaceOptimized, {
      workspaceId,
    }) as Promise<WorkspaceValidationResult>;
  },
});

/**
 * Public query to validate a workspace (requires authentication)
 * Can be used from the dashboard or client to manually trigger validation
 */
export const validateWorkspacePublic = query({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { workspaceId }): Promise<WorkspaceValidationResult> => {
    // Verify user has access to this workspace
    await requireWorkspaceAccess(ctx, workspaceId);

    // Run validation
    return ctx.runQuery(internal.validation.singleWorkspace.validateWorkspace, {
      workspaceId,
    }) as Promise<WorkspaceValidationResult>;
  },
});

/**
 * Get a summary of validation issues (lightweight version)
 * Returns just counts, not full issue details
 */
export const getValidationSummary = query({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (
    ctx,
    { workspaceId }
  ): Promise<{
    workspaceId: string;
    isValid: boolean;
    summary: ValidationSummary;
    validatedAt: string;
  }> => {
    // Verify user has access to this workspace
    await requireWorkspaceAccess(ctx, workspaceId);

    const result = (await ctx.runQuery(internal.validation.singleWorkspace.validateWorkspace, {
      workspaceId,
    })) as WorkspaceValidationResult;

    return {
      workspaceId: result.workspaceId,
      isValid: result.isValid,
      summary: result.summary,
      validatedAt: result.validatedAt,
    };
  },
});
