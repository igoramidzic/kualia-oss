import { v } from 'convex/values';
import { decodeProtectedHeader, importJWK, jwtVerify } from 'jose';
import type { JWKPublicKey, RemovedTransaction, Transaction } from 'plaid';

import { internal } from '../../_generated/api';
import type { Doc, Id } from '../../_generated/dataModel';
import type { ActionCtx, MutationCtx } from '../../_generated/server';
import { internalAction, internalMutation } from '../../_generated/server';
import { getSafePlaidErrorDetails, plaidClient, plaidConfig } from './plaidClient';

type IncomingPlaidRawImportStatus = 'awaiting_insert_job' | 'blocked_before_first_day';

type PlaidWebhookPayload = {
  item_id?: string;
  webhook_type?: string;
  webhook_code?: string;
  error?: { error_code?: string };
  consent_expiration_time?: string;
  disconnect_time?: string;
  reason?: string;
};

type PlaidWebhookVerificationKeyLoader = (keyId: string) => Promise<JWKPublicKey>;

const PLAID_WEBHOOK_MAX_AGE_SECONDS = 5 * 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePlaidWebhookPayload(rawBody: string): PlaidWebhookPayload {
  const parsed: unknown = JSON.parse(rawBody);
  if (!isRecord(parsed)) {
    throw new Error('Plaid webhook payload must be an object');
  }

  const error = isRecord(parsed['error']) ? parsed['error'] : undefined;
  return {
    item_id: typeof parsed['item_id'] === 'string' ? parsed['item_id'] : undefined,
    webhook_type: typeof parsed['webhook_type'] === 'string' ? parsed['webhook_type'] : undefined,
    webhook_code: typeof parsed['webhook_code'] === 'string' ? parsed['webhook_code'] : undefined,
    consent_expiration_time:
      typeof parsed['consent_expiration_time'] === 'string' ? parsed['consent_expiration_time'] : undefined,
    disconnect_time: typeof parsed['disconnect_time'] === 'string' ? parsed['disconnect_time'] : undefined,
    reason: typeof parsed['reason'] === 'string' ? parsed['reason'] : undefined,
    error: error
      ? {
          error_code: typeof error['error_code'] === 'string' ? error['error_code'] : undefined,
        }
      : undefined,
  };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function constantTimeStringEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function loadPlaidWebhookVerificationKey(keyId: string): Promise<JWKPublicKey> {
  const response = await plaidClient.webhookVerificationKeyGet({ key_id: keyId });
  return response.data.key;
}

export async function verifyPlaidWebhook(
  signedJwt: string | null,
  rawBody: string,
  loadVerificationKey: PlaidWebhookVerificationKeyLoader = loadPlaidWebhookVerificationKey
): Promise<boolean> {
  if (!signedJwt) {
    return false;
  }

  try {
    const header = decodeProtectedHeader(signedJwt);
    if (header.alg !== 'ES256' || typeof header.kid !== 'string' || header.kid.length === 0) {
      return false;
    }

    const key = await loadVerificationKey(header.kid);
    const now = Math.floor(Date.now() / 1000);
    if (
      key.alg !== 'ES256' ||
      key.crv !== 'P-256' ||
      key.kid !== header.kid ||
      key.kty !== 'EC' ||
      key.use !== 'sig' ||
      (key.expired_at !== null && key.expired_at <= now)
    ) {
      return false;
    }

    const verificationKey = await importJWK(
      {
        alg: key.alg,
        crv: key.crv,
        kid: key.kid,
        kty: key.kty,
        use: key.use,
        x: key.x,
        y: key.y,
      },
      'ES256'
    );
    const { payload } = await jwtVerify(signedJwt, verificationKey, {
      algorithms: ['ES256'],
      maxTokenAge: `${PLAID_WEBHOOK_MAX_AGE_SECONDS} sec`,
    });

    if (
      typeof payload.iat !== 'number' ||
      payload.iat > now ||
      now - payload.iat > PLAID_WEBHOOK_MAX_AGE_SECONDS ||
      typeof payload['request_body_sha256'] !== 'string'
    ) {
      return false;
    }

    const bodyHash = await sha256Hex(rawBody);
    return constantTimeStringEqual(bodyHash, payload['request_body_sha256']);
  } catch (error: unknown) {
    console.warn('Rejected Plaid webhook verification:', getSafePlaidErrorDetails(error));
    return false;
  }
}

type ClearedPendingTransition = {
  amount: number;
  authorizedDate: string | null;
  date: string;
  logoUrl: string | null;
  merchantEntityId: string | null;
  merchantName: string | null;
  originalStatement: string | null;
  plaidPersonalFinanceCategory: {
    primary: string;
    detailed: string;
    confidence: string | null;
  } | null;
  plaidTransactionCode: string | null;
  plaidTransactionId: string;
  postedDate: string | null;
  website: string | null;
};

export function resolvePlaidRawImportStatus(
  existingStatus: Doc<'transactionImportRaw'>['importStatus'],
  incomingStatus: IncomingPlaidRawImportStatus
): Doc<'transactionImportRaw'>['importStatus'] {
  return existingStatus === 'inserted' ? existingStatus : incomingStatus;
}

export async function reconcilePendingToClearedTransition(
  ctx: MutationCtx,
  pendingPlaidTransactionId: string,
  clearedTransaction: ClearedPendingTransition,
  now: string
): Promise<{
  updatedCount: number;
  updatedInsertedIds: Id<'transactionImportRaw'>[];
}> {
  const existingRawImports = ctx.db
    .query('transactionImportRaw')
    .withIndex('by_plaidTransactionId', (q) => q.eq('plaidTransactionId', pendingPlaidTransactionId));
  const updatedInsertedIds: Id<'transactionImportRaw'>[] = [];
  let updatedCount = 0;

  for await (const existingRawImport of existingRawImports) {
    await ctx.db.patch(existingRawImport._id, {
      plaidTransactionId: clearedTransaction.plaidTransactionId,
      pending: false,
      pendingTransactionId: pendingPlaidTransactionId,
      date: clearedTransaction.date,
      postedDate: clearedTransaction.postedDate ?? undefined,
      amount: BigInt(clearedTransaction.amount),
      authorizedDate: clearedTransaction.authorizedDate ?? undefined,
      merchantName: clearedTransaction.merchantName ?? undefined,
      originalStatement: clearedTransaction.originalStatement ?? undefined,
      logoUrl: clearedTransaction.logoUrl ?? undefined,
      website: clearedTransaction.website ?? undefined,
      merchantEntityId: clearedTransaction.merchantEntityId ?? undefined,
      plaidTransactionCode: clearedTransaction.plaidTransactionCode ?? undefined,
      plaidPersonalFinanceCategory: clearedTransaction.plaidPersonalFinanceCategory
        ? {
            primary: clearedTransaction.plaidPersonalFinanceCategory.primary,
            detailed: clearedTransaction.plaidPersonalFinanceCategory.detailed,
            confidence: clearedTransaction.plaidPersonalFinanceCategory.confidence ?? undefined,
          }
        : undefined,
      updatedAt: now,
    });

    if (existingRawImport.importStatus === 'inserted') {
      updatedInsertedIds.push(existingRawImport._id);
    }
    updatedCount++;
  }

  return { updatedCount, updatedInsertedIds };
}

/**
 * HTTP handler for syncing transactions from Plaid
 */
export const syncTransactionsWebhook = async (ctx: ActionCtx, request: Request) => {
  let webhookLogId: Id<'plaidWebhookLog'> | undefined;

  try {
    const rawBody = await request.text();
    const isVerified = await verifyPlaidWebhook(request.headers.get('Plaid-Verification'), rawBody);
    if (!isVerified) {
      return new Response('Invalid Plaid webhook signature', { status: 401 });
    }

    const payload = parsePlaidWebhookPayload(rawBody);
    const { item_id, webhook_type, webhook_code, error } = payload;

    if (!item_id) {
      return new Response('Missing item_id', { status: 400 });
    }

    console.log(`Plaid webhook received: ${webhook_type}/${webhook_code} for item ${item_id}`);

    // Create webhook log entry
    webhookLogId = await ctx.runMutation(internal.bankProviders.plaid.plaidTransactionSync.createWebhookLog, {
      itemId: item_id,
      webhookType: webhook_type || 'UNKNOWN',
      webhookCode: webhook_code || 'UNKNOWN',
      rawPayload: rawBody,
      status: 'received',
    });

    // Handle ITEM webhook types that affect connection status
    if (webhook_type === 'ITEM') {
      if (webhook_code === 'ERROR' && error?.error_code === 'ITEM_LOGIN_REQUIRED') {
        // Bank link requires re-authentication
        await ctx.runMutation(internal.internal.bankLinks.updateBankLinkStatus, {
          itemId: item_id,
          itemStatus: 'Disconnected',
        });
        // Mark webhook as skipped (no sync needed)
        await ctx.runMutation(internal.bankProviders.plaid.plaidTransactionSync.updateWebhookLogStatus, {
          webhookLogId,
          status: 'skipped',
        });
        return new Response('Bank link marked as disconnected', {
          status: 200,
        });
      }

      if (webhook_code === 'PENDING_EXPIRATION' || webhook_code === 'PENDING_DISCONNECT') {
        const consentExpiring = webhook_code === 'PENDING_EXPIRATION';
        const deadline = consentExpiring ? payload.consent_expiration_time : payload.disconnect_time;
        // Older or incomplete payloads still warrant a warning, even without a valid deadline.
        const requiredBy =
          deadline && Number.isFinite(Date.parse(deadline)) ? new Date(deadline).toISOString() : undefined;
        await ctx.runMutation(internal.internal.bankLinks.setBankLinkReauthorization, {
          itemId: item_id,
          reauthorization: {
            reason: consentExpiring ? 'consent_expiring' : 'connection_expiring',
            requiredBy,
            providerReason: payload.reason,
          },
        });
        await ctx.runMutation(internal.bankProviders.plaid.plaidTransactionSync.updateWebhookLogStatus, {
          webhookLogId,
          status: 'skipped',
        });
        return new Response('Bank link marked as requiring reauthorization soon', { status: 200 });
      }

      if (webhook_code === 'USER_PERMISSION_REVOKED') {
        // User revoked permission
        await ctx.runMutation(internal.internal.bankLinks.updateBankLinkStatus, {
          itemId: item_id,
          itemStatus: 'Disconnected',
        });
        await ctx.runMutation(internal.bankProviders.plaid.plaidTransactionSync.updateWebhookLogStatus, {
          webhookLogId,
          status: 'skipped',
        });
        return new Response('Bank link marked as disconnected', {
          status: 200,
        });
      }

      if (webhook_code === 'LOGIN_REPAIRED') {
        // Login repair does not necessarily renew consent; preserve any separate expiration warning.
        await ctx.runMutation(internal.internal.bankLinks.updateBankLinkStatus, {
          itemId: item_id,
          itemStatus: 'Healthy',
        });
        await ctx.runMutation(internal.bankProviders.plaid.plaidTransactionSync.updateWebhookLogStatus, {
          webhookLogId,
          status: 'skipped',
        });
        return new Response('Bank link marked as healthy', { status: 200 });
      }
    }

    // For transaction webhooks and other events, perform the sync
    await ctx.runAction(internal.bankProviders.plaid.plaidTransactionSync.performSync, {
      itemId: item_id,
      webhookLogId,
    });

    return new Response('Transaction sync completed', { status: 200 });
  } catch (error: unknown) {
    console.error('Error in transaction sync webhook:', getSafePlaidErrorDetails(error));
    // Update webhook log with error if we have one
    if (webhookLogId) {
      try {
        await ctx.runMutation(internal.bankProviders.plaid.plaidTransactionSync.updateWebhookLogStatus, {
          webhookLogId,
          status: 'error',
          errorMessage: 'Unable to process the bank transaction update',
        });
      } catch (logError: unknown) {
        console.error('Failed to update webhook log with error:', getSafePlaidErrorDetails(logError));
      }
    }
    return new Response('Internal server error', { status: 500 });
  }
};

/**
 * Internal action to sync transactions for a specific item
 * Can be called by other internal actions or schedulers
 */
export const syncTransactions = internalAction({
  args: {
    itemId: v.string(),
    webhookLogId: v.optional(v.id('plaidWebhookLog')),
  },
  handler: async (ctx, { itemId, webhookLogId }) => {
    await ctx.runAction(internal.bankProviders.plaid.plaidTransactionSync.performSync, { itemId, webhookLogId });
  },
});

/**
 * Internal action to perform the transaction sync
 * Uses action instead of mutation to allow external API calls to Plaid
 */
export function convertPlaidTransaction(txn: Transaction, bankLinkFirstDay: string | null) {
  // Extract date-only part from datetime if present
  let postedDate = null;
  if (txn.datetime) {
    postedDate = txn.datetime.split('T')[0];
  } else if (txn.date) {
    postedDate = txn.date;
  }

  // Determine import status: block transactions before first day during first sync
  // Transactions ON the first day should be allowed (not blocked)
  let importStatus: 'awaiting_insert_job' | 'blocked_before_first_day';
  if (bankLinkFirstDay && txn.date < bankLinkFirstDay) {
    importStatus = 'blocked_before_first_day' as const;
    console.log(`[BLOCKED] txn.date="${txn.date}" < bankLinkFirstDay="${bankLinkFirstDay}" => blocked`);
  } else {
    importStatus = 'awaiting_insert_job' as const;
    if (bankLinkFirstDay) {
      console.log(`[ALLOWED] txn.date="${txn.date}" >= bankLinkFirstDay="${bankLinkFirstDay}" => allowed`);
    }
  }

  return {
    plaidAccountId: txn.account_id,
    amount: Math.floor(txn.amount * -100), // Convert to cents and invert sign
    plaidCategory: txn.category || [],
    date: txn.date,
    merchantName: txn.merchant_name || null,
    originalStatement: txn.name || null,
    pending: txn.pending || false,
    pendingTransactionId: txn.pending_transaction_id || null,
    plaidTransactionId: txn.transaction_id,
    logoUrl: txn.logo_url || null,
    website: txn.website || null,
    authorizedDate: txn.authorized_date || null,
    postedDate,
    merchantEntityId: txn.merchant_entity_id || null,
    importStatus,
    // Transfer detection fields
    plaidTransactionCode: txn.transaction_code || null,
    plaidPersonalFinanceCategory: txn.personal_finance_category
      ? {
          primary: txn.personal_finance_category.primary,
          detailed: txn.personal_finance_category.detailed,
          confidence: txn.personal_finance_category.confidence_level || null,
        }
      : null,
  };
}

export const performSync = internalAction({
  args: {
    itemId: v.string(),
    webhookLogId: v.optional(v.id('plaidWebhookLog')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { itemId, webhookLogId } = args;

    // Get bank link information
    const bankLink = await ctx.runMutation(internal.bankProviders.plaid.plaidTransactionSync.getBankLink, { itemId });

    if (!bankLink) {
      throw new Error(`Bank link not found for item_id: ${itemId}`);
    }

    // Update webhook log with bankLinkId and mark as syncing
    if (webhookLogId) {
      await ctx.runMutation(internal.bankProviders.plaid.plaidTransactionSync.updateWebhookLogStatus, {
        webhookLogId,
        status: 'syncing',
        syncStartedAt: new Date().toISOString(),
        bankLinkId: bankLink._id,
      });
    }

    // Link can complete before the user chooses where accounts belong. Keep the
    // cursor intact until a workspace can receive the transactions.
    if (bankLink.workspaceIds.length === 0) {
      // Mark as completed with empty response
      if (webhookLogId) {
        await ctx.runMutation(internal.bankProviders.plaid.plaidTransactionSync.updateWebhookLogWithSyncResponse, {
          webhookLogId,
          syncResponse: {
            addedTransactions: [],
            modifiedTransactions: [],
            removedTransactionIds: [],
            initialCursor: bankLink.nextCursor,
            finalCursor: bankLink.nextCursor,
            addedCount: 0,
            modifiedCount: 0,
            removedCount: 0,
          },
          status: 'completed',
        });
      }
      return null;
    }

    for (const account of bankLink.initialSyncAccounts) {
      await ctx.scheduler.runAfter(0, internal.bankProviders.plaid.initialAccountSync.syncAccount, account);
    }

    // Initialize variables for the sync loop
    const initialCursor = bankLink.nextCursor || undefined;
    let cursor = initialCursor;
    let hasMore = true;
    let addedTransactions: Transaction[] = [];
    const modifiedTransactions: Transaction[] = [];
    const removedTransactionIds: string[] = [];

    // Fetch all transactions using the Plaid sync API
    while (hasMore) {
      try {
        const syncResponse = await plaidClient.transactionsSync({
          access_token: bankLink.accessToken,
          cursor: cursor,
          options: {
            days_requested: plaidConfig.transactionsDaysRequested, // Use config instead of hardcoded value
          },
        });

        // Accumulate transactions
        if (syncResponse.data.added && syncResponse.data.added.length > 0) {
          addedTransactions.push(...syncResponse.data.added);
        }

        if (syncResponse.data.modified && syncResponse.data.modified.length > 0) {
          modifiedTransactions.push(...syncResponse.data.modified);
        }

        if (syncResponse.data.removed && syncResponse.data.removed.length > 0) {
          syncResponse.data.removed.forEach((removed: RemovedTransaction) => {
            removedTransactionIds.push(removed.transaction_id);
          });
        }

        // Update cursor and hasMore flag
        cursor = syncResponse.data.next_cursor;
        hasMore = syncResponse.data.has_more;
      } catch (error: unknown) {
        console.error('Error during transaction sync:', getSafePlaidErrorDetails(error));
        throw new Error('Unable to sync bank transactions');
      }
    }

    // Use the user's local date (initialBalanceDate) for marking blocked transactions during first sync
    // This ensures transactions are blocked based on the user's timezone, not server time
    const bankLinkFirstDay = bankLink.isFirstSync && bankLink.initialBalanceDate ? bankLink.initialBalanceDate : null;

    console.log(
      `[SYNC] isFirstSync=${bankLink.isFirstSync}, initialBalanceDate="${bankLink.initialBalanceDate}", bankLinkFirstDay="${bankLinkFirstDay}"`
    );

    const convertTransaction = (txn: Transaction) => convertPlaidTransaction(txn, bankLinkFirstDay);

    // Detect pending→cleared transitions: Plaid sends removed=[pendingId] + added=[clearedTxn]
    // We update existing transactions instead of delete+create to preserve linked data
    const pendingToClearedMap = new Map<string, Transaction>();
    for (const txn of addedTransactions) {
      if (txn.pending_transaction_id && !txn.pending) {
        pendingToClearedMap.set(txn.pending_transaction_id, txn);
      }
    }

    const pendingToClearedIds = removedTransactionIds.filter((id) => pendingToClearedMap.has(id));
    const actualRemovedIds = removedTransactionIds.filter((id) => !pendingToClearedMap.has(id));

    console.log(
      `[SYNC] Detected ${pendingToClearedIds.length} pending→cleared transitions, ${actualRemovedIds.length} actual removals`
    );

    if (pendingToClearedIds.length > 0) {
      const transitions = pendingToClearedIds.map((pendingId) => ({
        pendingPlaidTransactionId: pendingId,
        clearedTransaction: convertTransaction(pendingToClearedMap.get(pendingId)!),
      }));

      const result = await ctx.runMutation(
        internal.bankProviders.plaid.plaidTransactionSync.handlePendingToClearedTransitions,
        {
          transitions,
        }
      );

      // Propagate updates to linked transactions through the reconciliation system
      if (result.updatedInsertedIds.length > 0) {
        console.log(`Propagating pending→cleared updates to ${result.updatedInsertedIds.length} linked transaction(s)`);
        await ctx.runMutation(
          internal.transactionImport.updateLinkedTransactions.updateLinkedTransactionsFromRawImports,
          { rawImportIds: result.updatedInsertedIds }
        );
      }

      // Remove handled transactions from addedTransactions so they're not processed again
      const handledIds = new Set(pendingToClearedIds.map((id) => pendingToClearedMap.get(id)!.transaction_id));
      addedTransactions = addedTransactions.filter((txn) => !handledIds.has(txn.transaction_id));
    }

    if (actualRemovedIds.length > 0) {
      await ctx.runMutation(internal.bankProviders.plaid.plaidTransactionSync.removeTransactions, {
        transactionIds: actualRemovedIds,
      });
    }

    // Process transactions for each workspace
    // Bank links are cross-workspace, so we need to sync to all workspaces that have linked bankAccounts
    const { plaidAccountToWorkspaces, workspaceIds } = bankLink;

    // Get the set of plaidAccountIds that have bankAccounts in each workspace
    const getPlaidAccountIdsForWorkspace = (wsId: string): Set<string> => {
      const accountIds = new Set<string>();
      for (const [plaidAccountId, wsIds] of Object.entries(plaidAccountToWorkspaces)) {
        if (wsIds.includes(wsId)) {
          accountIds.add(plaidAccountId);
        }
      }
      return accountIds;
    };

    // Process added transactions
    if (addedTransactions.length > 0) {
      const allTransactionsToUpsert = addedTransactions.map(convertTransaction);
      const blockedCount = allTransactionsToUpsert.filter(
        (txn) => txn.importStatus === 'blocked_before_first_day'
      ).length;

      if (blockedCount > 0) {
        console.log(
          `Marked ${blockedCount} added transactions as blocked_before_first_day (firstDay: ${bankLinkFirstDay})`
        );
      }

      // Upsert transactions for each workspace
      for (const workspaceId of workspaceIds) {
        // Skip archived workspaces - don't sync new transactions
        const workspace = await ctx.runQuery(internal.workspaces.getByWorkspaceId, {
          workspaceId: workspaceId as Id<'workspace'>,
        });
        if (workspace?.isArchived) {
          console.log(`Skipping transaction sync for archived workspace ${workspaceId}`);
          continue;
        }

        const accountIdsForWorkspace = getPlaidAccountIdsForWorkspace(workspaceId);
        const transactionsForWorkspace = allTransactionsToUpsert.filter((txn) =>
          accountIdsForWorkspace.has(txn.plaidAccountId)
        );

        if (transactionsForWorkspace.length > 0) {
          await ctx.runMutation(internal.bankProviders.plaid.plaidTransactionSync.upsertTransactions, {
            transactions: transactionsForWorkspace,
            workspaceId: workspaceId as Id<'workspace'>,
          });
        }
      }
    }

    // Process modified transactions
    if (modifiedTransactions.length > 0) {
      const allTransactionsToUpsert = modifiedTransactions.map(convertTransaction);
      const blockedCount = allTransactionsToUpsert.filter(
        (txn) => txn.importStatus === 'blocked_before_first_day'
      ).length;

      if (blockedCount > 0) {
        console.log(
          `Marked ${blockedCount} modified transactions as blocked_before_first_day (firstDay: ${bankLinkFirstDay})`
        );
      }

      // Upsert transactions for each workspace and propagate updates to linked transactions
      for (const workspaceId of workspaceIds) {
        // Skip archived workspaces - don't sync modified transactions
        const workspace = await ctx.runQuery(internal.workspaces.getByWorkspaceId, {
          workspaceId: workspaceId as Id<'workspace'>,
        });
        if (workspace?.isArchived) {
          console.log(`Skipping transaction sync for archived workspace ${workspaceId}`);
          continue;
        }

        const accountIdsForWorkspace = getPlaidAccountIdsForWorkspace(workspaceId);
        const transactionsForWorkspace = allTransactionsToUpsert.filter((txn) =>
          accountIdsForWorkspace.has(txn.plaidAccountId)
        );

        if (transactionsForWorkspace.length > 0) {
          const upsertResult = await ctx.runMutation(
            internal.bankProviders.plaid.plaidTransactionSync.upsertTransactions,
            {
              transactions: transactionsForWorkspace,
              workspaceId: workspaceId as Id<'workspace'>,
            }
          );

          // Propagate updates to linked transactions for raw imports that were already inserted
          if (upsertResult.updatedInsertedIds.length > 0) {
            console.log(
              `Propagating updates to ${upsertResult.updatedInsertedIds.length} linked transaction(s) for workspace ${workspaceId}`
            );
            await ctx.runMutation(
              internal.transactionImport.updateLinkedTransactions.updateLinkedTransactionsFromRawImports,
              {
                rawImportIds: upsertResult.updatedInsertedIds,
              }
            );
          }
        }
      }
    }

    // Update the bank_link with the new cursor and last_synced_at timestamp
    await ctx.runMutation(internal.bankProviders.plaid.plaidTransactionSync.updateBankLinkCursor, {
      bankLinkId: bankLink._id,
      cursor: cursor,
    });

    // Process the raw transaction imports if we added or modified any transactions
    if (addedTransactions.length > 0 || modifiedTransactions.length > 0) {
      console.log(
        `Processing ${addedTransactions.length} added, ${modifiedTransactions.length} modified transactions (wasFirstSync=${bankLink.isFirstSync})`
      );

      // Process for each workspace (using LLM-enhanced categorization)
      for (const workspaceId of workspaceIds) {
        try {
          const result = await ctx.runAction(
            internal.transactionImport.processWithLLM.processTransactionImportsWithLLM,
            {
              workspaceId: workspaceId as Id<'workspace'>,
              isFirstSync: bankLink.isFirstSync,
            }
          );

          // After processing transactions, handle balance updates
          if (bankLink.isFirstSync) {
            // Within the initial 10-minute window - all webhooks are part of initial sync
            // Calculate/adjust starting balances for this sync
            // - First webhook: Creates starting balance transactions
            // - Subsequent webhooks (within 10 min): Adjusts starting balance by subtracting new transactions
            await ctx.runMutation(internal.bankAccounts.calculateAndInsertStartingBalances, {
              bankLinkId: bankLink._id,
              workspaceId: workspaceId as Id<'workspace'>,
              // Don't pass initialBalanceDate - let mutation calculate from transactions
              // It will use: earliest transaction date - 1 day, or yesterday if no transactions
            });
            console.log(`Starting balances calculated/adjusted (initial sync window) for workspace ${workspaceId}`);
          }
          // Note: For subsequent syncs, balances are automatically calculated from transactions
          // No need to sync balances separately - they're derived from transaction data

          console.log(
            `performSync completed for workspace ${workspaceId}: processed=${result.processedCount}, errors=${result.errorCount}, added=${addedTransactions.length}, modified=${modifiedTransactions.length}, removed=${removedTransactionIds.length}`
          );
        } catch (error: unknown) {
          console.error(
            `Error processing raw transaction imports for workspace ${workspaceId}:`,
            getSafePlaidErrorDetails(error)
          );
          // Don't throw here - we've already inserted the raw transactions
          // They'll be processed by the next sync or manual run
        }
      }
    }

    // Mark first sync as complete so future syncs don't block transactions
    if (bankLink.isFirstSync) {
      await ctx.runMutation(internal.bankProviders.plaid.plaidTransactionSync.markFirstSyncComplete, {
        bankLinkId: bankLink._id,
      });
      console.log(`Marked first sync as complete for bankLink ${bankLink._id}`);
    }

    // Update webhook log with full sync response
    if (webhookLogId) {
      await ctx.runMutation(internal.bankProviders.plaid.plaidTransactionSync.updateWebhookLogWithSyncResponse, {
        webhookLogId,
        syncResponse: {
          // Store full Plaid transaction objects as JSON strings
          addedTransactions: addedTransactions.map((txn) => JSON.stringify(txn)),
          modifiedTransactions: modifiedTransactions.map((txn) => JSON.stringify(txn)),
          removedTransactionIds,
          initialCursor,
          finalCursor: cursor,
          addedCount: addedTransactions.length,
          modifiedCount: modifiedTransactions.length,
          removedCount: removedTransactionIds.length,
        },
        status: 'completed',
      });
    }
    return null;
  },
});

/**
 * Internal mutation to get bank link by itemId
 * Since bank links are cross-workspace, we find workspaces through bankLinkAccount -> bankAccount
 */
export const getBankLink = internalMutation({
  args: { itemId: v.string() },
  handler: async (ctx, args) => {
    const bankLink = await ctx.db
      .query('bankLink')
      .withIndex('by_itemId', (q) => q.eq('itemId', args.itemId))
      .first();

    if (!bankLink) {
      return null;
    }

    // Determine if this is the first sync based on the hasCompletedFirstSync flag
    // This is more reliable than timing-based approach
    const isFirstSync = !bankLink.hasCompletedFirstSync;

    // Get all bankLinkAccounts for this bankLink
    const bankLinkAccounts = await ctx.db
      .query('bankLinkAccount')
      .withIndex('by_bankLinkId', (q) => q.eq('bankLinkId', bankLink._id))
      .filter((q) => q.neq(q.field('isDeleted'), true))
      .collect();

    // Build a map of plaidAccountId -> workspaceIds
    // Each bankLinkAccount can be linked to multiple bankAccounts in different workspaces
    const plaidAccountToWorkspaces: Record<string, string[]> = {};
    const initialSyncAccounts: Array<{
      bankAccountId: Id<'bankAccount'>;
      bankLinkAccountId: Id<'bankLinkAccount'>;
      generation: string;
    }> = [];

    for (const linkAccount of bankLinkAccounts) {
      const bankAccounts = await ctx.db
        .query('bankAccount')
        .withIndex('by_bankLinkAccountId', (q) => q.eq('bankLinkAccountId', linkAccount._id))
        .filter((q) => q.neq(q.field('isDeleted'), true))
        .collect();

      const workspaceIds = bankAccounts.map((ba) => ba.workspaceId);
      for (const account of bankAccounts) {
        if (account.plaidInitialSync?.status === 'pending') {
          initialSyncAccounts.push({
            bankAccountId: account._id,
            bankLinkAccountId: linkAccount._id,
            generation: account.plaidInitialSync.generation,
          });
        }
      }
      if (workspaceIds.length > 0) {
        plaidAccountToWorkspaces[linkAccount.plaidAccountId] = workspaceIds;
      }
    }

    // Get unique workspace IDs
    const allWorkspaceIds = new Set<string>();
    for (const wsIds of Object.values(plaidAccountToWorkspaces)) {
      for (const wsId of wsIds) {
        allWorkspaceIds.add(wsId);
      }
    }

    return {
      _id: bankLink._id,
      accessToken: bankLink.accessToken,
      nextCursor: bankLink.nextCursor,
      isFirstSync,
      createdAt: bankLink.createdAt,
      initialBalanceDate: bankLink.initialBalanceDate,
      // Map of plaidAccountId -> workspaceIds
      plaidAccountToWorkspaces,
      // All unique workspace IDs that have bankAccounts linked to this bankLink
      workspaceIds: Array.from(allWorkspaceIds),
      initialSyncAccounts,
    };
  },
});

/**
 * Internal mutation to check if bank link has accounts
 */
export const checkBankLinkAccounts = internalMutation({
  args: { bankLinkId: v.id('bankLink') },
  handler: async (ctx, args) => {
    const accounts = await ctx.db
      .query('bankLinkAccount')
      .filter((q) => q.eq(q.field('bankLinkId'), args.bankLinkId))
      .first();

    return accounts !== null;
  },
});

/**
 * Internal mutation to remove transactions
 */
export const removeTransactions = internalMutation({
  args: {
    transactionIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // Process removals in batches to avoid hitting document limits
    for (const transactionId of args.transactionIds) {
      // Use the index to efficiently find the transaction
      const transaction = await ctx.db
        .query('transactionImportRaw')
        .withIndex('by_plaidTransactionId', (q) => q.eq('plaidTransactionId', transactionId))
        .first();

      if (transaction) {
        await ctx.db.delete(transaction._id);
      }
    }
  },
});

/**
 * Handle pending→cleared transitions by updating existing raw imports instead of delete+create.
 * This preserves linked transaction data when Plaid clears a pending transaction.
 */
export const handlePendingToClearedTransitions = internalMutation({
  args: {
    transitions: v.array(
      v.object({
        pendingPlaidTransactionId: v.string(),
        clearedTransaction: v.object({
          plaidAccountId: v.string(),
          amount: v.number(),
          plaidCategory: v.array(v.string()),
          date: v.string(),
          merchantName: v.union(v.string(), v.null()),
          originalStatement: v.union(v.string(), v.null()),
          pending: v.boolean(),
          pendingTransactionId: v.union(v.string(), v.null()),
          plaidTransactionId: v.string(),
          logoUrl: v.union(v.string(), v.null()),
          website: v.union(v.string(), v.null()),
          authorizedDate: v.union(v.string(), v.null()),
          postedDate: v.union(v.string(), v.null()),
          merchantEntityId: v.union(v.string(), v.null()),
          importStatus: v.union(v.literal('awaiting_insert_job'), v.literal('blocked_before_first_day')),
          plaidTransactionCode: v.union(v.string(), v.null()),
          plaidPersonalFinanceCategory: v.union(
            v.object({
              primary: v.string(),
              detailed: v.string(),
              confidence: v.union(v.string(), v.null()),
            }),
            v.null()
          ),
        }),
      })
    ),
  },
  handler: async (ctx, args) => {
    let updatedCount = 0;
    let notFoundCount = 0;
    const updatedInsertedIds: Id<'transactionImportRaw'>[] = [];
    const now = new Date().toISOString();

    for (const { pendingPlaidTransactionId, clearedTransaction } of args.transitions) {
      const result = await reconcilePendingToClearedTransition(ctx, pendingPlaidTransactionId, clearedTransaction, now);
      if (result.updatedCount === 0) {
        notFoundCount++;
      }
      updatedCount += result.updatedCount;
      updatedInsertedIds.push(...result.updatedInsertedIds);
    }

    console.log(`[PENDING→CLEARED] Updated: ${updatedCount}, Not found: ${notFoundCount}`);
    return { updatedCount, notFoundCount, updatedInsertedIds };
  },
});

/**
 * Internal mutation to upsert transactions
 * Returns IDs of raw imports that were already 'inserted' and got updated (for propagation to linked transactions)
 */
export const plaidRawImportValidator = v.object({
  plaidAccountId: v.string(),
  amount: v.number(),
  plaidCategory: v.array(v.string()),
  date: v.string(),
  merchantName: v.union(v.string(), v.null()),
  originalStatement: v.union(v.string(), v.null()),
  pending: v.boolean(),
  pendingTransactionId: v.union(v.string(), v.null()),
  plaidTransactionId: v.string(),
  logoUrl: v.union(v.string(), v.null()),
  website: v.union(v.string(), v.null()),
  authorizedDate: v.union(v.string(), v.null()),
  postedDate: v.union(v.string(), v.null()),
  merchantEntityId: v.union(v.string(), v.null()),
  importStatus: v.union(v.literal('awaiting_insert_job'), v.literal('blocked_before_first_day')),
  // Transfer detection fields
  plaidTransactionCode: v.union(v.string(), v.null()),
  plaidPersonalFinanceCategory: v.union(
    v.object({
      primary: v.string(),
      detailed: v.string(),
      confidence: v.union(v.string(), v.null()),
    }),
    v.null()
  ),
});

export const upsertTransactions = internalMutation({
  args: {
    transactions: v.array(plaidRawImportValidator),
    workspaceId: v.id('workspace'),
  },
  returns: v.object({
    updatedInsertedIds: v.array(v.id('transactionImportRaw')),
    rawImportIds: v.array(v.id('transactionImportRaw')),
  }),
  handler: async (ctx, args) => {
    // Track IDs of raw imports that were already 'inserted' and got updated
    // These need to propagate updates to their linked transactions
    const updatedInsertedIds: Id<'transactionImportRaw'>[] = [];
    const rawImportIds: Id<'transactionImportRaw'>[] = [];
    const startDateByPlaidAccountId = new Map<string, string | undefined>();

    for (const txn of args.transactions) {
      if (!startDateByPlaidAccountId.has(txn.plaidAccountId)) {
        const connectionAccount = await ctx.db
          .query('bankLinkAccount')
          .withIndex('by_plaidAccountId', (q) => q.eq('plaidAccountId', txn.plaidAccountId))
          .first();
        let startDate: string | undefined;
        if (connectionAccount) {
          const accounts = ctx.db
            .query('bankAccount')
            .withIndex('by_bankLinkAccountId', (q) => q.eq('bankLinkAccountId', connectionAccount._id));
          for await (const account of accounts) {
            if (account.workspaceId === args.workspaceId && !account.isDeleted) {
              startDate = account.plaidInitialSync?.startDate;
              break;
            }
          }
        }
        startDateByPlaidAccountId.set(txn.plaidAccountId, startDate);
      }
      const startDate = startDateByPlaidAccountId.get(txn.plaidAccountId);
      const incomingStatus = startDate
        ? txn.date < startDate
          ? 'blocked_before_first_day'
          : 'awaiting_insert_job'
        : txn.importStatus;
      // Use the compound index to find existing transactions for THIS workspace
      // (the same plaidTransactionId can exist in multiple workspaces)
      const existingTxn = await ctx.db
        .query('transactionImportRaw')
        .withIndex('by_workspaceId_plaidTransactionId', (q) =>
          q.eq('workspaceId', args.workspaceId).eq('plaidTransactionId', txn.plaidTransactionId)
        )
        .first();

      const transactionData = {
        plaidAccountId: txn.plaidAccountId,
        amount: BigInt(txn.amount), // Already converted to cents in the action
        plaidCategory: txn.plaidCategory,
        date: txn.date,
        merchantName: txn.merchantName || undefined,
        originalStatement: txn.originalStatement || undefined,
        pending: txn.pending,
        pendingTransactionId: txn.pendingTransactionId || undefined,
        plaidTransactionId: txn.plaidTransactionId,
        logoUrl: txn.logoUrl || undefined,
        website: txn.website || undefined,
        authorizedDate: txn.authorizedDate || undefined,
        postedDate: txn.postedDate || undefined,
        merchantEntityId: txn.merchantEntityId || undefined,
        importStatus: existingTxn
          ? resolvePlaidRawImportStatus(existingTxn.importStatus, incomingStatus)
          : incomingStatus,
        updatedAt: new Date().toISOString(),
        // Transfer detection fields
        plaidTransactionCode: txn.plaidTransactionCode || undefined,
        plaidPersonalFinanceCategory: txn.plaidPersonalFinanceCategory
          ? {
              primary: txn.plaidPersonalFinanceCategory.primary,
              detailed: txn.plaidPersonalFinanceCategory.detailed,
              confidence: txn.plaidPersonalFinanceCategory.confidence || undefined,
            }
          : undefined,
      };

      if (existingTxn) {
        rawImportIds.push(existingTxn._id);
        // Track if this was an already-inserted transaction being updated
        // These will need to propagate updates to their linked transactions
        if (existingTxn.importStatus === 'inserted') {
          updatedInsertedIds.push(existingTxn._id);
        }
        await ctx.db.patch(existingTxn._id, transactionData);
      } else {
        rawImportIds.push(
          await ctx.db.insert('transactionImportRaw', {
            ...transactionData,
            workspaceId: args.workspaceId,
          })
        );
      }
    }

    return { updatedInsertedIds, rawImportIds };
  },
});

/**
 * Internal mutation to update bank link cursor
 */
export const updateBankLinkCursor = internalMutation({
  args: {
    bankLinkId: v.id('bankLink'),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.bankLinkId, {
      nextCursor: args.cursor,
      lastSyncedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  },
});

/**
 * Internal mutation to mark first sync as complete
 */
export const markFirstSyncComplete = internalMutation({
  args: {
    bankLinkId: v.id('bankLink'),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.bankLinkId, {
      hasCompletedFirstSync: true,
      updatedAt: new Date().toISOString(),
    });
  },
});

/**
 * Internal mutation to create a webhook log entry when a webhook is received
 */
export const createWebhookLog = internalMutation({
  args: {
    itemId: v.string(),
    webhookType: v.string(),
    webhookCode: v.string(),
    rawPayload: v.string(),
    status: v.union(
      v.literal('received'),
      v.literal('syncing'),
      v.literal('completed'),
      v.literal('skipped'),
      v.literal('error')
    ),
    bankLinkId: v.optional(v.id('bankLink')),
  },
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    return await ctx.db.insert('plaidWebhookLog', {
      itemId: args.itemId,
      webhookType: args.webhookType,
      webhookCode: args.webhookCode,
      rawPayload: args.rawPayload,
      status: args.status,
      bankLinkId: args.bankLinkId,
      receivedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Internal mutation to update webhook log status (e.g., mark as syncing)
 */
export const updateWebhookLogStatus = internalMutation({
  args: {
    webhookLogId: v.id('plaidWebhookLog'),
    status: v.union(
      v.literal('received'),
      v.literal('syncing'),
      v.literal('completed'),
      v.literal('skipped'),
      v.literal('error')
    ),
    errorMessage: v.optional(v.string()),
    syncStartedAt: v.optional(v.string()),
    bankLinkId: v.optional(v.id('bankLink')),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.webhookLogId, {
      status: args.status,
      errorMessage: args.errorMessage,
      syncStartedAt: args.syncStartedAt,
      bankLinkId: args.bankLinkId,
      updatedAt: new Date().toISOString(),
    });
  },
});

/**
 * Internal mutation to update webhook log with sync response
 */
export const updateWebhookLogWithSyncResponse = internalMutation({
  args: {
    webhookLogId: v.id('plaidWebhookLog'),
    syncResponse: v.object({
      addedTransactions: v.array(v.string()),
      modifiedTransactions: v.array(v.string()),
      removedTransactionIds: v.array(v.string()),
      initialCursor: v.optional(v.string()),
      finalCursor: v.optional(v.string()),
      addedCount: v.number(),
      modifiedCount: v.number(),
      removedCount: v.number(),
    }),
    status: v.union(v.literal('completed'), v.literal('error')),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.webhookLogId, {
      syncResponse: args.syncResponse,
      status: args.status,
      errorMessage: args.errorMessage,
      syncCompletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  },
});
