import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { internalAction } from '../../_generated/server';
import { plaidClient, plaidConfig } from './plaidClient';

/**
 * Update the webhook URL for a Plaid item
 * This is called during migration from Supabase to update the webhook to the Convex endpoint
 */
export const updateItemWebhook = internalAction({
  args: {
    bankLinkId: v.id('bankLink'),
  },
  handler: async (ctx, { bankLinkId }): Promise<{ success: boolean; error?: string }> => {
    // Fetch the bank link record
    const bankLink = await ctx.runQuery(internal.internal.bankLinks.getBankLink, {
      bankLinkId,
    });

    if (!bankLink) {
      console.error('[Plaid Webhook Update] Bank link not found', bankLinkId);
      await ctx.runMutation(internal.internal.bankLinks.updateWebhookMigrationStatus, {
        bankLinkId,
        status: 'failed',
      });
      return { success: false, error: 'Bank link not found' };
    }

    // Skip if already completed or not needed
    if (bankLink.webhookMigrationStatus === 'completed' || bankLink.webhookMigrationStatus === 'not_needed') {
      console.log('[Plaid Webhook Update] Already processed, skipping', bankLinkId, bankLink.webhookMigrationStatus);
      return { success: true };
    }

    const webhookUrl = plaidConfig.webhook;
    if (!webhookUrl) {
      console.error('[Plaid Webhook Update] PLAID_TRANSACTIONS_WEBHOOK not configured');
      await ctx.runMutation(internal.internal.bankLinks.updateWebhookMigrationStatus, {
        bankLinkId,
        status: 'failed',
      });
      return { success: false, error: 'Webhook URL not configured' };
    }

    try {
      // Call Plaid's itemWebhookUpdate API
      await plaidClient.itemWebhookUpdate({
        access_token: bankLink.accessToken,
        webhook: webhookUrl,
      });

      console.log('[Plaid Webhook Update] Successfully updated webhook for bank link', bankLinkId);

      // Mark as completed
      await ctx.runMutation(internal.internal.bankLinks.updateWebhookMigrationStatus, {
        bankLinkId,
        status: 'completed',
      });

      return { success: true };
    } catch (error: unknown) {
      console.error('[Plaid Webhook Update] Error calling Plaid itemWebhookUpdate API', {
        bankLinkId,
        itemId: bankLink.itemId,
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      });

      // Mark as failed
      await ctx.runMutation(internal.internal.bankLinks.updateWebhookMigrationStatus, {
        bankLinkId,
        status: 'failed',
      });

      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  },
});

interface ProcessResult {
  total: number;
  successful: number;
  failed: number;
  results: Array<{
    bankLinkId: Id<'bankLink'>;
    itemId: string;
    success: boolean;
    error?: string;
  }>;
}

/**
 * Process all pending webhook migrations
 * Run this manually after Supabase migration to update all webhooks to point to Convex
 */
export const processPendingWebhookUpdates = internalAction({
  args: {},
  handler: async (ctx): Promise<ProcessResult> => {
    // Get all bank links with pending webhook migration status
    const pendingBankLinks = await ctx.runQuery(internal.internal.bankLinks.listPendingWebhookMigrations, {});

    console.log(`[Plaid Webhook Migration] Found ${pendingBankLinks.length} pending bank links`);

    const results: ProcessResult['results'] = [];
    let successful = 0;
    let failed = 0;

    for (const bankLink of pendingBankLinks) {
      console.log(`[Plaid Webhook Migration] Processing bank link ${bankLink._id} (itemId: ${bankLink.itemId})`);

      const result = await ctx.runAction(internal.bankProviders.plaid.updateItemWebhook.updateItemWebhook, {
        bankLinkId: bankLink._id,
      });

      if (result.success) {
        successful++;
      } else {
        failed++;
      }

      results.push({
        bankLinkId: bankLink._id,
        itemId: bankLink.itemId,
        success: result.success,
        error: result.error,
      });
    }

    console.log(
      `[Plaid Webhook Migration] Completed: ${successful} successful, ${failed} failed out of ${pendingBankLinks.length} total`
    );

    return {
      total: pendingBankLinks.length,
      successful,
      failed,
      results,
    };
  },
});
