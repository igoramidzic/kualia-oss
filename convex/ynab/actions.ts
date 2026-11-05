/**
 * Public actions for YNAB import
 */

import { v } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import { action } from '../_generated/server';
import { requireAuthAction } from '../lib/auth';
import {
  extractAccountTypeMappings,
  extractCategories,
  groupSplitTransactions,
  parsePlanCSV,
  parseRegisterCSV,
} from './parseCSV';
import type { ParseResult } from './types';

/**
 * Parse YNAB CSV files and return account mappings for user review
 * Call this first to let the user confirm/adjust account types before import
 */
export const parseYnabFiles = action({
  args: {
    planCsvContent: v.string(),
    registerCsvContent: v.string(),
    currency: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ParseResult> => {
    const identity = await requireAuthAction(ctx);

    // Dynamic import to avoid circular type references
    const { internal } = await import('../_generated/api');

    // Get user profile
    const userProfile: Doc<'userProfile'> | null = await ctx.runQuery(internal.clerk.getUserByClerkId, {
      clerkId: identity.subject,
    });

    if (!userProfile) {
      return {
        success: false,
        error: 'User profile not found',
      };
    }

    try {
      // Update status to parsing
      await ctx.runMutation(internal.ynab.mutations.upsertYnabImportStatus, {
        userId: userProfile._id,
        status: 'parsing',
      });

      // Parse CSVs directly (no internal action call to avoid circular refs)
      const registerRows = parseRegisterCSV(args.registerCsvContent);
      const planRows = parsePlanCSV(args.planCsvContent);
      const currency = args.currency ?? 'USD';
      const registerDateSamples = registerRows
        .map((row) => row.date.trim())
        .filter((date) => date.length > 0)
        .slice(0, 5);
      const dashedDateCount = registerRows.filter((row) => /^\d{2}-\d{2}-\d{4}$/.test(row.date.trim())).length;
      console.log('[YNAB Import] parseYnabFiles date diagnostics', {
        registerRowCount: registerRows.length,
        dashedDateCount,
        registerDateSamples,
      });

      // Extract data
      const accountMappings = extractAccountTypeMappings(registerRows);
      const categories = extractCategories(planRows, currency);
      const transactions = groupSplitTransactions(registerRows, currency);

      // Count unique months from plan data
      const uniqueMonths = new Set(planRows.map((row) => row.month).filter(Boolean));

      return {
        success: true,
        accountMappings,
        preview: {
          accountCount: accountMappings.length,
          monthCount: uniqueMonths.size,
          categoryCount: categories.length,
          transactionCount: transactions.length,
        },
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error parsing files';
      console.error('[YNAB Import] parseYnabFiles failed', {
        errorMessage,
        errorStack: error instanceof Error ? error.stack : undefined,
      });

      await ctx.runMutation(internal.ynab.mutations.upsertYnabImportStatus, {
        userId: userProfile._id,
        status: 'failed',
        errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  },
});

/**
 * Start the YNAB import with user-confirmed account type mappings
 * Call this after user has reviewed and confirmed account types
 *
 * This action schedules the import to run asynchronously and returns immediately.
 * The frontend should subscribe to ynabImportStatus to track progress.
 */
export const startYnabImport = action({
  args: {
    planCsvContent: v.string(),
    registerCsvContent: v.string(),
    accountTypeMappings: v.array(
      v.object({
        accountName: v.string(),
        accountType: v.string(),
      })
    ),
    workspaceName: v.optional(v.string()),
    currency: v.optional(v.string()),
    currentDate: v.string(), // User local date in YYYY-MM-DD
  },
  handler: async (ctx, args): Promise<{ success: true } | { success: false; error: string }> => {
    const identity = await requireAuthAction(ctx);

    // Dynamic import to avoid circular type references
    const { internal } = await import('../_generated/api');

    // Get user profile
    const userProfile: Doc<'userProfile'> | null = await ctx.runQuery(internal.clerk.getUserByClerkId, {
      clerkId: identity.subject,
    });

    if (!userProfile) {
      return {
        success: false,
        error: 'User profile not found',
      };
    }

    // Set initial status to importing so the UI can transition immediately
    await ctx.runMutation(internal.ynab.mutations.upsertYnabImportStatus, {
      userId: userProfile._id,
      status: 'importing',
      progress: {
        currentStep: 'Starting import...',
        accountsTotal: args.accountTypeMappings.length,
        accountsImported: 0,
        categoriesTotal: 0,
        categoriesImported: 0,
        transactionsTotal: 0,
        transactionsImported: 0,
      },
    });

    // Schedule the import action to run asynchronously (runs in background)
    await ctx.scheduler.runAfter(0, internal.ynab.importData.importYnabData, {
      userId: userProfile._id,
      planCsvContent: args.planCsvContent,
      registerCsvContent: args.registerCsvContent,
      accountTypeMappings: args.accountTypeMappings,
      workspaceName: args.workspaceName,
      currency: args.currency ?? 'USD',
      currentDate: args.currentDate,
    });

    // Return immediately - the import will run in the background
    return { success: true };
  },
});
