import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { internalAction, internalMutation, internalQuery, type MutationCtx } from '../_generated/server';
import {
  buildActivityContext,
  recordBankAccountActivity,
  recordMerchantActivity,
  recordTransactionActivity,
} from '../activityLogs/helpers';
import { activityAttributionValidator } from '../activityLogs/types';
import { closeBankAccountForWorkspace } from '../bankAccounts/close';
import { createBankAccountForWorkspace } from '../bankAccounts/create';
import { deleteBankAccountForWorkspace } from '../bankAccounts/delete';
import { createCategoryImpl } from '../categories/create';
import { deleteCategoriesWithRecategorizationImpl } from '../categories/delete';
import { updateCategoryImpl } from '../categories/update';
import { createCategoryGroupImpl } from '../categoryGroups/create';
import { updateCategoryGroupImpl } from '../categoryGroups/update';
import { getCurrentYearMonthForTimezone } from '../lib/dates';
import { getEnvelopeMonthStatus } from '../mcp/budgetTools';
import { createMerchantImpl } from '../merchants/create';
import { deleteMerchantImpl } from '../merchants/delete';
import { batchResolveMerchantNames, getOrCreateMerchantByName } from '../merchants/helpers';
import {
  initializeCategorySuggestionCache,
  suggestCategoryForTransactionWithCache,
  type CategorySuggestionCache,
} from '../transactionImport/categorySuggestion';
import { applyRulesToTransactionData } from '../transactionRules/helpers';
import type { TransactionRule } from '../transactionRules/types';
import { isOnBudgetAccountType } from '../transactions/helpers';
import { createRegularTransactionImpl } from '../transactions/mutations/createRegular';
import { createTransferTransactionImpl } from '../transactions/mutations/createTransfer';
import { updateTransactionInternal } from '../transactions/update';

import {
  ApiError,
  bankAccountToApi,
  categoryToApi,
  formatApiMonth,
  merchantToApi,
  parseApiAmount,
  parseApiDate,
  parseApiMonth,
  parseOptionalString,
  parseRequiredString,
  requireWorkspaceForApi,
  transactionsToApi,
  type ApiWorkspaceContext,
} from './lib';
import { envelopeCategoryToApi } from './reads';

export const MAX_TRANSACTIONS_PER_CREATE = 100;

// Keep in sync with the `accountType` union in convex/schema.ts.
const API_ACCOUNT_TYPES = new Set([
  'banking_checking',
  'banking_savings',
  'banking_cash',
  'banking_cash_management',
  'banking_money_market',
  'banking_cd',
  'banking_other',
  'credit_credit_card',
  'credit_line_of_credit',
  'credit_other',
  'investment_brokerage',
  'investment_401k',
  'investment_ira',
  'investment_keogh',
  'investment_roth_ira',
  'investment_roth_401k',
  'investment_hsa',
  'investment_sep_ira',
  'investment_simple_ira',
  'investment_529_plan',
  'investment_403b',
  'investment_other',
  'loan_auto',
  'loan_business',
  'loan_commercial',
  'loan_construction',
  'loan_home_equity',
  'loan_mortgage',
  'loan_student',
  'loan_other',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireBody(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ApiError(400, 'bad_request', 'Request body must be a JSON object');
  }
  return value;
}

/** Map "already exists" ConvexErrors to 409 conflict; rethrow everything else. */
function rethrowConflict(error: unknown): never {
  if (error instanceof ConvexError && typeof error.data === 'string' && error.data.includes('already exists')) {
    throw new ApiError(409, 'conflict', error.data);
  }
  throw error;
}

async function getOwnedAccount(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>,
  rawId: string,
  field: string
): Promise<Doc<'bankAccount'>> {
  const account = await ctx.db.get(rawId as Id<'bankAccount'>).catch(() => null);
  if (!account || account.isDeleted || account.workspaceId !== workspaceId) {
    throw new ApiError(404, 'not_found', `${field}: account not found`);
  }
  return account;
}

async function validateCategoryForApi(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>,
  rawId: string,
  field: string
): Promise<Id<'category'>> {
  const category = await ctx.db.get(rawId as Id<'category'>).catch(() => null);
  if (!category || category.isDeleted || (!category.isSystemCategory && category.workspaceId !== workspaceId)) {
    throw new ApiError(404, 'not_found', `${field}: category not found`);
  }
  return category._id;
}

async function resolveMerchantInput(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>,
  body: Record<string, unknown>,
  index?: number
): Promise<Id<'merchant'> | null | undefined> {
  const prefix = index === undefined ? '' : `transactions[${index}].`;
  const merchantIdRaw = body['merchant_id'];
  const merchantNameRaw = body['merchant_name'];

  if (merchantIdRaw !== undefined && merchantNameRaw !== undefined) {
    throw new ApiError(400, 'bad_request', `${prefix}merchant_id and ${prefix}merchant_name are mutually exclusive`);
  }

  if (merchantIdRaw !== undefined) {
    if (merchantIdRaw === null) return null;
    if (typeof merchantIdRaw !== 'string') {
      throw new ApiError(400, 'bad_request', `${prefix}merchant_id must be a string or null`);
    }
    const merchant = await ctx.db.get(merchantIdRaw as Id<'merchant'>).catch(() => null);
    if (!merchant || merchant.isDeleted || merchant.workspaceId !== workspaceId) {
      throw new ApiError(404, 'not_found', `${prefix}merchant_id: merchant not found`);
    }
    return merchant._id;
  }

  if (merchantNameRaw !== undefined) {
    if (merchantNameRaw === null) return null;
    if (typeof merchantNameRaw !== 'string') {
      throw new ApiError(400, 'bad_request', `${prefix}merchant_name must be a string or null`);
    }
    const trimmed = merchantNameRaw.trim();
    if (trimmed.length === 0) return null;
    return getOrCreateMerchantByName(ctx, workspaceId, trimmed);
  }

  return undefined;
}

type ParsedMovement = {
  amount: bigint;
  categoryId?: Id<'category'>;
  readyToAssign?: boolean;
  notes?: string;
};

/**
 * Parse the `amount`/`category_id`/`ready_to_assign` shortcut or the `splits`
 * array into internal movements. `existingMovements` allows PATCH callers to
 * change the category while keeping the current amount (and vice versa).
 */
async function parseMovementsInput(
  ctx: MutationCtx,
  workspace: ApiWorkspaceContext,
  body: Record<string, unknown>,
  fieldPrefix: string,
  existingMovements?: Doc<'transaction'>['movements']
): Promise<ParsedMovement[] | undefined> {
  const splitsRaw = body['splits'];
  const amountRaw = body['amount'];
  const categoryIdRaw = body['category_id'];
  const readyToAssignRaw = body['ready_to_assign'];

  const hasShortcut = amountRaw !== undefined || categoryIdRaw !== undefined || readyToAssignRaw !== undefined;
  if (splitsRaw !== undefined && hasShortcut) {
    throw new ApiError(
      400,
      'bad_request',
      `${fieldPrefix}splits cannot be combined with amount, category_id, or ready_to_assign`
    );
  }

  if (splitsRaw !== undefined) {
    if (!Array.isArray(splitsRaw) || splitsRaw.length === 0) {
      throw new ApiError(400, 'bad_request', `${fieldPrefix}splits must be a non-empty array`);
    }
    const movements: ParsedMovement[] = [];
    for (let i = 0; i < splitsRaw.length; i++) {
      const split = splitsRaw[i];
      if (!isRecord(split)) {
        throw new ApiError(400, 'bad_request', `${fieldPrefix}splits[${i}] must be an object`);
      }
      const movement: ParsedMovement = {
        amount: parseApiAmount(split['amount'], `${fieldPrefix}splits[${i}].amount`, workspace.minorUnit),
      };
      if (split['ready_to_assign'] === true) {
        movement.readyToAssign = true;
      } else if (split['category_id'] !== undefined && split['category_id'] !== null) {
        if (typeof split['category_id'] !== 'string') {
          throw new ApiError(400, 'bad_request', `${fieldPrefix}splits[${i}].category_id must be a string`);
        }
        movement.categoryId = await validateCategoryForApi(
          ctx,
          workspace.workspace._id,
          split['category_id'],
          `${fieldPrefix}splits[${i}].category_id`
        );
      }
      const splitNotes = parseOptionalString(split['notes'], `${fieldPrefix}splits[${i}].notes`);
      if (splitNotes !== undefined) movement.notes = splitNotes;
      movements.push(movement);
    }
    return movements;
  }

  if (!hasShortcut) {
    return undefined;
  }

  const existingSingle = existingMovements?.length === 1 ? existingMovements[0] : undefined;
  if (existingMovements && existingMovements.length > 1 && amountRaw !== undefined) {
    throw new ApiError(
      400,
      'bad_request',
      `${fieldPrefix}amount cannot be used on a split transaction — send the full splits array instead`
    );
  }

  let amount: bigint;
  if (amountRaw !== undefined) {
    amount = parseApiAmount(amountRaw, `${fieldPrefix}amount`, workspace.minorUnit);
  } else if (existingSingle) {
    amount = existingSingle.amount;
  } else {
    throw new ApiError(400, 'bad_request', `${fieldPrefix}amount is required`);
  }

  const movement: ParsedMovement = { amount };

  if (readyToAssignRaw !== undefined && typeof readyToAssignRaw !== 'boolean') {
    throw new ApiError(400, 'bad_request', `${fieldPrefix}ready_to_assign must be a boolean`);
  }

  if (readyToAssignRaw === true) {
    movement.readyToAssign = true;
  } else if (categoryIdRaw !== undefined) {
    if (categoryIdRaw !== null) {
      if (typeof categoryIdRaw !== 'string') {
        throw new ApiError(400, 'bad_request', `${fieldPrefix}category_id must be a string or null`);
      }
      movement.categoryId = await validateCategoryForApi(
        ctx,
        workspace.workspace._id,
        categoryIdRaw,
        `${fieldPrefix}category_id`
      );
    }
  } else if (readyToAssignRaw === undefined && existingSingle) {
    // Amount-only PATCH: keep the current categorization.
    movement.categoryId = existingSingle.categoryId;
    movement.readyToAssign = existingSingle.readyToAssign;
    movement.notes = existingSingle.notes;
  }

  return [movement];
}

function parseStatusInput(value: unknown, field: string): 'pending' | 'cleared' | undefined {
  if (value === undefined) return undefined;
  if (value !== 'pending' && value !== 'cleared') {
    throw new ApiError(400, 'bad_request', `${field} must be 'pending' or 'cleared'`);
  }
  return value;
}

function parseReviewStatusInput(value: unknown, field: string): 'reviewed' | 'needs_review' | undefined {
  if (value === undefined) return undefined;
  if (value !== 'reviewed' && value !== 'needs_review') {
    throw new ApiError(400, 'bad_request', `${field} must be 'reviewed' or 'needs_review'`);
  }
  return value;
}

type CategorizationContext = { cache: CategorySuggestionCache; rules: TransactionRule[] };

/**
 * Predict a category for an uncategorized transaction the same way imports and
 * the AI chat do: active transaction rules first, then the shared suggestion
 * cache (learned merchant→category mappings — including any the LLM just wrote —
 * followed by the user's own prior categorizations and reviewed history).
 * Returns undefined when nothing confident matches, leaving the row uncategorized.
 */
async function resolveAutoCategoryForApi(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>,
  input: { merchantId: Id<'merchant'>; bankAccountId: Id<'bankAccount'>; amount: bigint; date: string },
  context: CategorizationContext
): Promise<Id<'category'> | undefined> {
  const merchantName = (await batchResolveMerchantNames(ctx, new Set([input.merchantId]))).get(input.merchantId);

  if (context.rules.length > 0) {
    const ruleResult = applyRulesToTransactionData(
      {
        merchantId: input.merchantId,
        rawMerchantName: merchantName,
        amount: input.amount,
        bankAccountId: input.bankAccountId,
        importDetails: { merchantName },
      },
      context.rules,
      new Map([[input.merchantId, merchantName]])
    );
    if (ruleResult.appliedRuleId && ruleResult.data.categoryId !== undefined) {
      return ruleResult.data.categoryId;
    }
  }

  const suggestion = await suggestCategoryForTransactionWithCache(
    ctx,
    workspaceId,
    {
      merchantName,
      originalStatement: undefined,
      amount: input.amount,
      plaidCategory: [],
      date: input.date,
      bankAccountId: input.bankAccountId,
    },
    context.cache
  );
  return suggestion.categoryId;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/** POST /v1/workspaces/{workspace_id}/accounts */
export const createAccount = internalMutation({
  args: {
    clerkId: v.string(),
    workspaceId: v.string(),
    payload: v.any(),
    attribution: activityAttributionValidator,
  },
  handler: async (ctx, { clerkId, workspaceId, payload, attribution }) => {
    const workspace = await requireWorkspaceForApi(ctx, clerkId, workspaceId);
    const body = requireBody(payload);

    const name = parseRequiredString(body['name'], 'name').trim();
    const type = parseRequiredString(body['type'], 'type');
    if (!API_ACCOUNT_TYPES.has(type)) {
      throw new ApiError(400, 'bad_request', `type must be one of: ${[...API_ACCOUNT_TYPES].join(', ')}`);
    }

    const initialBalance =
      body['initial_balance'] !== undefined
        ? parseApiAmount(body['initial_balance'], 'initial_balance', workspace.minorUnit)
        : undefined;
    const initialBalanceDate =
      body['initial_balance_date'] !== undefined
        ? parseApiDate(body['initial_balance_date'], 'initial_balance_date')
        : undefined;

    const accountId = await createBankAccountForWorkspace(ctx, {
      workspaceId: workspace.workspace._id,
      name,
      accountType: type as Doc<'bankAccount'>['accountType'],
      initialBalance,
      initialBalanceDate,
      attribution,
    });

    const account = await ctx.db.get(accountId);
    if (!account) {
      throw new ApiError(500, 'internal_error', 'Failed to read back created account');
    }

    return {
      minorUnit: workspace.minorUnit,
      body: {
        currency: workspace.currency,
        account: bankAccountToApi(account, isOnBudgetAccountType(account.accountType)),
      },
    };
  },
});

/** PATCH /v1/workspaces/{workspace_id}/accounts/{account_id} */
export const updateAccount = internalMutation({
  args: {
    clerkId: v.string(),
    workspaceId: v.string(),
    accountId: v.string(),
    payload: v.any(),
    attribution: activityAttributionValidator,
  },
  handler: async (ctx, { clerkId, workspaceId, accountId, payload, attribution }) => {
    const workspace = await requireWorkspaceForApi(ctx, clerkId, workspaceId);
    const body = requireBody(payload);
    const account = await getOwnedAccount(ctx, workspace.workspace._id, accountId, 'account_id');
    const context = await buildActivityContext(ctx, attribution);
    let currentAccount = account;

    const patch: { name?: string; notes?: string; updatedAt?: string } = {};

    const name = parseOptionalString(body['name'], 'name');
    if (name !== undefined) {
      if (name.trim().length === 0) {
        throw new ApiError(400, 'bad_request', 'name cannot be empty');
      }
      patch.name = name.trim();
    }

    const notes = parseOptionalString(body['notes'], 'notes');
    if (notes !== undefined) {
      patch.notes = notes;
    }

    if (patch.name !== undefined || patch.notes !== undefined) {
      const before = currentAccount;
      const hasChanges =
        (patch.name !== undefined && patch.name !== before.name) ||
        (patch.notes !== undefined && patch.notes !== before.notes);
      patch.updatedAt = new Date().toISOString();
      await ctx.db.patch(currentAccount._id, patch);
      const after = await ctx.db.get(currentAccount._id);
      if (after) {
        currentAccount = after;
        if (hasChanges) {
          await recordBankAccountActivity(ctx, {
            workspaceId: workspace.workspace._id,
            context,
            type: 'bank_account_updated',
            before,
            after,
          });
        }
      }
    }

    const closed = body['closed'];
    if (closed !== undefined) {
      if (typeof closed !== 'boolean') {
        throw new ApiError(400, 'bad_request', 'closed must be a boolean');
      }
      if (closed && !currentAccount.isClosed) {
        await closeBankAccountForWorkspace(ctx, {
          workspaceId: workspace.workspace._id,
          bankAccountId: currentAccount._id,
          attribution,
        });
      } else if (!closed && currentAccount.isClosed) {
        const before = currentAccount;
        await ctx.db.patch(currentAccount._id, {
          isClosed: false,
          closedAt: undefined,
          updatedAt: new Date().toISOString(),
        });
        const after = await ctx.db.get(currentAccount._id);
        if (after) {
          currentAccount = after;
          await recordBankAccountActivity(ctx, {
            workspaceId: workspace.workspace._id,
            context,
            type: 'bank_account_reopened',
            before,
            after,
          });
        }
      }
    }

    const updated = await ctx.db.get(currentAccount._id);
    if (!updated) {
      throw new ApiError(500, 'internal_error', 'Failed to read back updated account');
    }

    return {
      minorUnit: workspace.minorUnit,
      body: {
        currency: workspace.currency,
        account: bankAccountToApi(updated, isOnBudgetAccountType(updated.accountType)),
      },
    };
  },
});

/** DELETE /v1/workspaces/{workspace_id}/accounts/{account_id} */
export const deleteAccount = internalMutation({
  args: {
    clerkId: v.string(),
    workspaceId: v.string(),
    accountId: v.string(),
    attribution: activityAttributionValidator,
  },
  handler: async (ctx, { clerkId, workspaceId, accountId, attribution }) => {
    const workspace = await requireWorkspaceForApi(ctx, clerkId, workspaceId);
    const account = await getOwnedAccount(ctx, workspace.workspace._id, accountId, 'account_id');

    await deleteBankAccountForWorkspace(ctx, {
      workspaceId: workspace.workspace._id,
      bankAccountId: account._id,
      attribution,
    });

    return {
      minorUnit: workspace.minorUnit,
      body: { deleted: true, id: account._id },
    };
  },
});

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

/**
 * POST /v1/workspaces/{workspace_id}/transactions
 *
 * Accepts up to MAX_TRANSACTIONS_PER_CREATE rows. The batch is atomic: any
 * invalid row aborts the whole request and nothing is created.
 */
export const createTransactions = internalMutation({
  args: {
    clerkId: v.string(),
    workspaceId: v.string(),
    rows: v.array(v.any()),
    attribution: activityAttributionValidator,
  },
  handler: async (ctx, { clerkId, workspaceId, rows, attribution }) => {
    const workspace = await requireWorkspaceForApi(ctx, clerkId, workspaceId);
    const context = await buildActivityContext(ctx, attribution);

    if (rows.length === 0) {
      throw new ApiError(400, 'bad_request', 'At least one transaction is required');
    }
    if (rows.length > MAX_TRANSACTIONS_PER_CREATE) {
      throw new ApiError(400, 'bad_request', `At most ${MAX_TRANSACTIONS_PER_CREATE} transactions per request`);
    }

    const createdIds: Id<'transaction'>[] = [];

    // Suggestion cache + rules are loaded lazily on the first row that actually
    // needs auto-categorization, so batches that supply every category pay
    // nothing for the extra reads.
    let categorizationContext: CategorizationContext | null = null;
    const loadCategorizationContext = async (): Promise<CategorizationContext> => {
      if (categorizationContext) return categorizationContext;
      const rules = await ctx.db
        .query('transactionRule')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspace.workspace._id))
        .filter((q) => q.and(q.eq(q.field('isActive'), true), q.eq(q.field('isDeleted'), false)))
        .collect();
      categorizationContext = {
        cache: await initializeCategorySuggestionCache(ctx, workspace.workspace._id),
        rules: rules.sort((a, b) => a.priority - b.priority),
      };
      return categorizationContext;
    };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!isRecord(row)) {
        throw new ApiError(400, 'bad_request', `transactions[${i}] must be an object`);
      }
      const prefix = `transactions[${i}].`;

      const type = row['type'] ?? 'regular';
      if (type !== 'regular' && type !== 'transfer') {
        throw new ApiError(400, 'bad_request', `${prefix}type must be 'regular' or 'transfer'`);
      }

      const date = parseApiDate(row['date'], `${prefix}date`);
      const notes = parseOptionalString(row['notes'], `${prefix}notes`);
      // API-created rows land in the review queue by default so users can
      // verify programmatic writes in-app before they're considered final.
      const reviewStatus = parseReviewStatusInput(row['review_status'], `${prefix}review_status`) ?? 'needs_review';

      if (type === 'transfer') {
        const fromAccount = await getOwnedAccount(
          ctx,
          workspace.workspace._id,
          parseRequiredString(row['from_account_id'], `${prefix}from_account_id`),
          `${prefix}from_account_id`
        );
        const toAccount = await getOwnedAccount(
          ctx,
          workspace.workspace._id,
          parseRequiredString(row['to_account_id'], `${prefix}to_account_id`),
          `${prefix}to_account_id`
        );
        const amount = parseApiAmount(row['amount'], `${prefix}amount`, workspace.minorUnit);
        if (amount <= 0n) {
          throw new ApiError(400, 'bad_request', `${prefix}amount must be positive for transfers`);
        }

        let categoryId: Id<'category'> | undefined;
        if (row['category_id'] !== undefined && row['category_id'] !== null) {
          if (typeof row['category_id'] !== 'string') {
            throw new ApiError(400, 'bad_request', `${prefix}category_id must be a string`);
          }
          categoryId = await validateCategoryForApi(
            ctx,
            workspace.workspace._id,
            row['category_id'],
            `${prefix}category_id`
          );
        }

        const { fromTransactionId, toTransactionId } = await createTransferTransactionImpl(ctx, {
          fromAccountId: fromAccount._id,
          toAccountId: toAccount._id,
          amount,
          date,
          workspaceId: workspace.workspace._id,
          notes,
          status: 'cleared',
          categoryId,
          reviewStatus,
        });
        const createdTransaction = await ctx.db.get(fromTransactionId);
        if (createdTransaction) {
          await recordTransactionActivity(ctx, {
            workspaceId: workspace.workspace._id,
            context,
            type: 'transaction_created',
            after: createdTransaction,
          });
        }
        createdIds.push(fromTransactionId, toTransactionId);
        continue;
      }

      const account = await getOwnedAccount(
        ctx,
        workspace.workspace._id,
        parseRequiredString(row['account_id'], `${prefix}account_id`),
        `${prefix}account_id`
      );

      const movements = await parseMovementsInput(ctx, workspace, row, prefix);
      if (!movements) {
        throw new ApiError(400, 'bad_request', `${prefix}amount (or splits) is required`);
      }

      const merchantId = await resolveMerchantInput(ctx, workspace.workspace._id, row, i);
      const status = parseStatusInput(row['status'], `${prefix}status`) ?? 'cleared';

      // When the caller doesn't pin a category, auto-categorize a single-movement
      // row the same way imports/chat do (rules → suggestions → LLM mapping →
      // history). The action wrapper runs the LLM pass first so brand-new
      // merchants already have a mapping to pick up here. Splits and explicit
      // Ready-to-Assign rows are left exactly as sent.
      if (
        merchantId &&
        movements.length === 1 &&
        movements[0].categoryId === undefined &&
        movements[0].readyToAssign !== true
      ) {
        const autoCategoryId = await resolveAutoCategoryForApi(
          ctx,
          workspace.workspace._id,
          { merchantId, bankAccountId: account._id, amount: movements[0].amount, date },
          await loadCategorizationContext()
        );
        if (autoCategoryId) {
          movements[0].categoryId = autoCategoryId;
        }
      }

      const transactionId = await createRegularTransactionImpl(ctx, {
        workspaceId: workspace.workspace._id,
        bankAccountId: account._id,
        date,
        movements,
        merchantId: merchantId ?? undefined,
        notes,
        status,
        source: 'manual',
        reviewStatus,
      });
      const createdTransaction = await ctx.db.get(transactionId);
      if (createdTransaction) {
        await recordTransactionActivity(ctx, {
          workspaceId: workspace.workspace._id,
          context,
          type: 'transaction_created',
          after: createdTransaction,
        });
      }
      createdIds.push(transactionId);
    }

    const createdDocs = await Promise.all(createdIds.map((id) => ctx.db.get(id)));
    const transactions = await transactionsToApi(
      ctx,
      createdDocs.filter((doc): doc is Doc<'transaction'> => doc !== null),
      batchResolveMerchantNames
    );

    return {
      minorUnit: workspace.minorUnit,
      body: { currency: workspace.currency, transactions },
    };
  },
});

/**
 * Read-only pre-pass for {@link createTransactionsWithCategorization}: pick out
 * the rows whose category we'll need to auto-predict (regular, no explicit
 * category / Ready-to-Assign / splits, with a resolvable merchant) and return
 * them in the shape the shared LLM scan expects. Rows the insert will reject
 * (bad amount/date, missing merchant) are simply skipped here — the create
 * mutation surfaces the real validation error.
 */
export const prepareTransactionsForCategorization = internalQuery({
  args: { clerkId: v.string(), workspaceId: v.string(), rows: v.array(v.any()) },
  handler: async (ctx, { clerkId, workspaceId, rows }) => {
    const workspace = await requireWorkspaceForApi(ctx, clerkId, workspaceId);

    const llmInputs: Array<{ date: string; amount: bigint; merchantName: string }> = [];
    for (const row of rows) {
      if (!isRecord(row)) continue;
      if ((row['type'] ?? 'regular') !== 'regular') continue;
      if (row['category_id'] !== undefined && row['category_id'] !== null) continue;
      if (row['ready_to_assign'] === true) continue;
      if (row['splits'] !== undefined) continue;
      if (typeof row['date'] !== 'string') continue;

      let merchantName: string | undefined;
      if (typeof row['merchant_name'] === 'string' && row['merchant_name'].trim().length > 0) {
        merchantName = row['merchant_name'].trim();
      } else if (typeof row['merchant_id'] === 'string') {
        const merchant = await ctx.db.get(row['merchant_id'] as Id<'merchant'>).catch(() => null);
        if (merchant && !merchant.isDeleted && merchant.workspaceId === workspace.workspace._id) {
          merchantName = (await batchResolveMerchantNames(ctx, new Set([merchant._id]))).get(merchant._id);
        }
      }
      if (!merchantName) continue;

      let amount: bigint;
      try {
        amount = parseApiAmount(row['amount'], 'amount', workspace.minorUnit);
      } catch {
        continue;
      }

      llmInputs.push({ date: row['date'], amount, merchantName });
    }

    return { workspaceId: workspace.workspace._id, llmInputs };
  },
});

/**
 * Action entry point for POST /transactions. Mirrors the chat/import flow: scan
 * for brand-new merchants, run Jev to populate orgMerchantCategoryMapping,
 * then run the (atomic) insert mutation, which applies rules → suggestions →
 * that fresh mapping → history to any row the caller left uncategorized.
 */
export const createTransactionsWithCategorization = internalAction({
  args: {
    clerkId: v.string(),
    workspaceId: v.string(),
    rows: v.array(v.any()),
    attribution: activityAttributionValidator,
  },
  handler: async (ctx, { clerkId, workspaceId, rows, attribution }): Promise<{ minorUnit: number; body: unknown }> => {
    const { workspaceId: resolvedWorkspaceId, llmInputs } = await ctx.runQuery(
      internal.publicApi.writes.prepareTransactionsForCategorization,
      { clerkId, workspaceId, rows }
    );

    if (llmInputs.length > 0) {
      const merchants = await ctx.runMutation(internal.transactionImport.processChatFileImport.scanChatInputsForLLM, {
        workspaceId: resolvedWorkspaceId,
        transactions: llmInputs,
      });
      if (merchants.length > 0) {
        try {
          await ctx.runAction(internal.llmCategorization.action.categorizeMerchantsWithLLM, {
            workspaceId: resolvedWorkspaceId,
            merchants,
          });
        } catch (error: unknown) {
          // Best-effort: a categorization hiccup must never fail the create. The
          // affected rows just stay uncategorized (needs_review) for the user.
          console.error('Public API Jev categorization failed:', error);
        }
      }
    }

    return await ctx.runMutation(internal.publicApi.writes.createTransactions, {
      clerkId,
      workspaceId,
      rows,
      attribution,
    });
  },
});

/** PATCH /v1/workspaces/{workspace_id}/transactions/{transaction_id} */
export const updateTransaction = internalMutation({
  args: {
    clerkId: v.string(),
    workspaceId: v.string(),
    transactionId: v.string(),
    payload: v.any(),
    attribution: activityAttributionValidator,
  },
  handler: async (ctx, { clerkId, workspaceId, transactionId, payload, attribution }) => {
    const workspace = await requireWorkspaceForApi(ctx, clerkId, workspaceId);
    const body = requireBody(payload);

    const transaction = await ctx.db.get(transactionId as Id<'transaction'>).catch(() => null);
    if (!transaction || transaction.isDeleted || transaction.workspaceId !== workspace.workspace._id) {
      throw new ApiError(404, 'not_found', 'Transaction not found');
    }

    const updates: Record<string, unknown> = {};

    // A transaction's type is immutable via the public API. Converting between
    // regular and transfer through updateTransactionInternal only carries the
    // destination account across — the source account, amount, date, and notes
    // sent on the same request would be silently dropped (matching the in-app
    // `convertToTransfer` mutation, which likewise takes only a destination).
    // Rather than expose that lossy, undocumented path, reject the change and
    // point callers at delete + recreate. An unchanged `type` is a no-op so a
    // GET response can be round-tripped straight back into PATCH.
    if (body['type'] !== undefined) {
      if (body['type'] !== 'regular' && body['type'] !== 'transfer') {
        throw new ApiError(400, 'bad_request', "type must be 'regular' or 'transfer'");
      }
      if (body['type'] !== transaction.type) {
        throw new ApiError(
          400,
          'bad_request',
          "A transaction's type can't be changed after creation. Delete this transaction and create a new one with the desired type instead."
        );
      }
    }

    if (body['date'] !== undefined) {
      updates['date'] = parseApiDate(body['date'], 'date');
    }

    if (body['notes'] !== undefined) {
      if (body['notes'] !== null && typeof body['notes'] !== 'string') {
        throw new ApiError(400, 'bad_request', 'notes must be a string or null');
      }
      updates['notes'] = body['notes'];
    }

    if (body['account_id'] !== undefined) {
      const account = await getOwnedAccount(
        ctx,
        workspace.workspace._id,
        parseRequiredString(body['account_id'], 'account_id'),
        'account_id'
      );
      updates['bankAccountId'] = account._id;
    }

    // from_account_id/to_account_id only ever fed the (now-rejected) type
    // conversion and aren't part of the documented update fields. Reject them
    // rather than silently ignoring them (they'd be dropped on a regular
    // transaction). `account_id` moves a regular transaction between accounts.
    if (body['from_account_id'] !== undefined || body['to_account_id'] !== undefined) {
      throw new ApiError(
        400,
        'bad_request',
        'from_account_id and to_account_id are only accepted when creating a transfer, not when updating one'
      );
    }

    const status = parseStatusInput(body['status'], 'status');
    if (status !== undefined) updates['status'] = status;

    const reviewStatus = parseReviewStatusInput(body['review_status'], 'review_status');
    if (reviewStatus !== undefined) updates['reviewStatus'] = reviewStatus;

    const merchantId = await resolveMerchantInput(ctx, workspace.workspace._id, body);
    if (merchantId !== undefined) updates['merchantId'] = merchantId;

    const movements = await parseMovementsInput(ctx, workspace, body, '', transaction.movements);
    if (movements !== undefined) updates['movements'] = movements;

    if (Object.keys(updates).length === 0) {
      throw new ApiError(400, 'bad_request', 'No supported fields to update were provided');
    }

    // Programmatic edits must not silently approve rows awaiting review —
    // review_status only changes when the caller sends it explicitly.
    await updateTransactionInternal(ctx, workspace.workspace._id, transaction._id, {
      ...(updates as Parameters<typeof updateTransactionInternal>[3]),
      preserveReviewStatus: true,
    });

    const updated = await ctx.db.get(transaction._id);
    if (!updated) {
      throw new ApiError(500, 'internal_error', 'Failed to read back updated transaction');
    }

    await recordTransactionActivity(ctx, {
      workspaceId: workspace.workspace._id,
      context: await buildActivityContext(ctx, attribution),
      type: 'transaction_updated',
      before: transaction,
      after: updated,
    });

    const [mapped] = await transactionsToApi(ctx, [updated], batchResolveMerchantNames);
    return {
      minorUnit: workspace.minorUnit,
      body: { currency: workspace.currency, transaction: mapped },
    };
  },
});

/** DELETE /v1/workspaces/{workspace_id}/transactions/{transaction_id} */
export const deleteTransaction = internalMutation({
  args: {
    clerkId: v.string(),
    workspaceId: v.string(),
    transactionId: v.string(),
    attribution: activityAttributionValidator,
  },
  handler: async (ctx, { clerkId, workspaceId, transactionId, attribution }) => {
    const workspace = await requireWorkspaceForApi(ctx, clerkId, workspaceId);

    const result: { deleted: Id<'transaction'>[]; notFound: string[] } = await ctx.runMutation(
      internal.transactions.softDeleteTransactionsForMcp,
      { workspaceId: workspace.workspace._id, transactionIds: [transactionId], attribution }
    );

    if (result.notFound.length > 0) {
      throw new ApiError(404, 'not_found', 'Transaction not found');
    }

    const deleted = await ctx.db.get(transactionId as Id<'transaction'>);
    const [mapped] = deleted ? await transactionsToApi(ctx, [deleted], batchResolveMerchantNames) : [null];

    return {
      minorUnit: workspace.minorUnit,
      body: { currency: workspace.currency, transaction: mapped },
    };
  },
});

/** POST /v1/workspaces/{workspace_id}/transactions/{transaction_id}/restore */
export const restoreTransaction = internalMutation({
  args: {
    clerkId: v.string(),
    workspaceId: v.string(),
    transactionId: v.string(),
    attribution: activityAttributionValidator,
  },
  handler: async (ctx, { clerkId, workspaceId, transactionId, attribution }) => {
    const workspace = await requireWorkspaceForApi(ctx, clerkId, workspaceId);

    const result: { restored: Id<'transaction'>[]; notFound: string[] } = await ctx.runMutation(
      internal.transactions.restoreTransactionsForMcp,
      { workspaceId: workspace.workspace._id, transactionIds: [transactionId], attribution }
    );

    if (result.notFound.length > 0) {
      throw new ApiError(404, 'not_found', 'Transaction not found or not deleted');
    }

    const restored = await ctx.db.get(transactionId as Id<'transaction'>);
    const [mapped] = restored ? await transactionsToApi(ctx, [restored], batchResolveMerchantNames) : [null];

    return {
      minorUnit: workspace.minorUnit,
      body: { currency: workspace.currency, transaction: mapped },
    };
  },
});

// ---------------------------------------------------------------------------
// Merchants
// ---------------------------------------------------------------------------

/** POST /v1/workspaces/{workspace_id}/merchants */
export const createMerchant = internalMutation({
  args: {
    clerkId: v.string(),
    workspaceId: v.string(),
    payload: v.any(),
    attribution: activityAttributionValidator,
  },
  handler: async (ctx, { clerkId, workspaceId, payload, attribution }) => {
    const workspace = await requireWorkspaceForApi(ctx, clerkId, workspaceId);
    const body = requireBody(payload);
    const name = parseRequiredString(body['name'], 'name');

    let merchantId: Id<'merchant'>;
    try {
      merchantId = await createMerchantImpl(ctx, {
        workspaceId: workspace.workspace._id,
        name,
        activityContext: await buildActivityContext(ctx, attribution),
      });
    } catch (error: unknown) {
      rethrowConflict(error);
    }

    const merchant = await ctx.db.get(merchantId);
    if (!merchant) {
      throw new ApiError(500, 'internal_error', 'Failed to read back created merchant');
    }

    return {
      minorUnit: workspace.minorUnit,
      body: { merchant: merchantToApi(merchant, merchant.name ?? null) },
    };
  },
});

/** PATCH /v1/workspaces/{workspace_id}/merchants/{merchant_id} */
export const updateMerchant = internalMutation({
  args: {
    clerkId: v.string(),
    workspaceId: v.string(),
    merchantId: v.string(),
    payload: v.any(),
    attribution: activityAttributionValidator,
  },
  handler: async (ctx, { clerkId, workspaceId, merchantId, payload, attribution }) => {
    const workspace = await requireWorkspaceForApi(ctx, clerkId, workspaceId);
    const body = requireBody(payload);

    const merchant = await ctx.db.get(merchantId as Id<'merchant'>).catch(() => null);
    if (!merchant || merchant.isDeleted || merchant.workspaceId !== workspace.workspace._id) {
      throw new ApiError(404, 'not_found', 'Merchant not found');
    }

    const name = parseRequiredString(body['name'], 'name').trim();

    const normalized = name.toLowerCase();
    const existingMerchants = await ctx.db
      .query('merchant')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspace.workspace._id))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();
    const duplicate = existingMerchants.find((m) => m._id !== merchant._id && m.name?.toLowerCase() === normalized);
    if (duplicate) {
      throw new ApiError(409, 'conflict', 'A merchant with this name already exists');
    }

    await ctx.db.patch(merchant._id, { name, updatedAt: new Date().toISOString() });

    const updated = await ctx.db.get(merchant._id);
    if (updated) {
      await recordMerchantActivity(ctx, {
        workspaceId: workspace.workspace._id,
        context: await buildActivityContext(ctx, attribution),
        type: 'merchant_updated',
        before: merchant,
        after: updated,
      });
    }
    return {
      minorUnit: workspace.minorUnit,
      body: { merchant: merchantToApi(updated ?? merchant, name) },
    };
  },
});

/** DELETE /v1/workspaces/{workspace_id}/merchants/{merchant_id} */
export const deleteMerchant = internalMutation({
  args: {
    clerkId: v.string(),
    workspaceId: v.string(),
    merchantId: v.string(),
    moveToMerchantId: v.optional(v.string()),
    attribution: activityAttributionValidator,
  },
  handler: async (ctx, { clerkId, workspaceId, merchantId, moveToMerchantId, attribution }) => {
    const workspace = await requireWorkspaceForApi(ctx, clerkId, workspaceId);

    const merchant = await ctx.db.get(merchantId as Id<'merchant'>).catch(() => null);
    if (!merchant || merchant.isDeleted || merchant.workspaceId !== workspace.workspace._id) {
      throw new ApiError(404, 'not_found', 'Merchant not found');
    }

    let targetMerchantId: Id<'merchant'> | undefined;
    if (moveToMerchantId !== undefined) {
      const target = await ctx.db.get(moveToMerchantId as Id<'merchant'>).catch(() => null);
      if (!target || target.isDeleted || target.workspaceId !== workspace.workspace._id) {
        throw new ApiError(404, 'not_found', 'move_to_merchant_id: merchant not found');
      }
      targetMerchantId = target._id;
    }

    const result = await deleteMerchantImpl(ctx, {
      workspaceId: workspace.workspace._id,
      merchantId: merchant._id,
      targetMerchantId,
      activityContext: await buildActivityContext(ctx, attribution),
    });

    return {
      minorUnit: workspace.minorUnit,
      body: {
        deleted: true,
        id: merchant._id,
        moved_transaction_count: result.movedTransactionCount,
        updated_recurring_transaction_count: result.updatedRecurringTransactionCount,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Categories & category groups
// ---------------------------------------------------------------------------

/** POST /v1/workspaces/{workspace_id}/categories */
export const createCategory = internalMutation({
  args: {
    clerkId: v.string(),
    workspaceId: v.string(),
    payload: v.any(),
    attribution: activityAttributionValidator,
  },
  handler: async (ctx, { clerkId, workspaceId, payload, attribution }) => {
    const workspace = await requireWorkspaceForApi(ctx, clerkId, workspaceId);
    const body = requireBody(payload);

    const name = parseRequiredString(body['name'], 'name').trim();
    const groupIdRaw = parseRequiredString(body['group_id'], 'group_id');

    const group = await ctx.db.get(groupIdRaw as Id<'categoryGroup'>).catch(() => null);
    if (!group || group.isDeleted || group.workspaceId !== workspace.workspace._id) {
      throw new ApiError(404, 'not_found', 'group_id: category group not found');
    }
    if (group.type === 'credit_card') {
      throw new ApiError(400, 'bad_request', 'Cannot create categories in the credit card group');
    }

    const categoryId = await createCategoryImpl(ctx, {
      workspaceId: workspace.workspace._id,
      name,
      categoryGroupId: group._id,
      attribution,
    });

    const category = await ctx.db.get(categoryId);
    if (!category) {
      throw new ApiError(500, 'internal_error', 'Failed to read back created category');
    }

    return {
      minorUnit: workspace.minorUnit,
      body: { category: categoryToApi(category, category.name) },
    };
  },
});

/** PATCH /v1/workspaces/{workspace_id}/categories/{category_id} */
export const updateCategory = internalMutation({
  args: {
    clerkId: v.string(),
    workspaceId: v.string(),
    categoryId: v.string(),
    payload: v.any(),
    attribution: activityAttributionValidator,
  },
  handler: async (ctx, { clerkId, workspaceId, categoryId, payload, attribution }) => {
    const workspace = await requireWorkspaceForApi(ctx, clerkId, workspaceId);
    const body = requireBody(payload);

    const name = parseOptionalString(body['name'], 'name');
    const groupIdRaw = parseOptionalString(body['group_id'], 'group_id');
    const archived = body['archived'];
    if (archived !== undefined && typeof archived !== 'boolean') {
      throw new ApiError(400, 'bad_request', 'archived must be a boolean');
    }

    if (name === undefined && groupIdRaw === undefined && archived === undefined) {
      throw new ApiError(400, 'bad_request', 'Provide at least one of name, group_id, archived');
    }

    await updateCategoryImpl(ctx, {
      workspaceId: workspace.workspace._id,
      categoryId: categoryId as Id<'category'>,
      name: name?.trim(),
      categoryGroupId: groupIdRaw !== undefined ? (groupIdRaw as Id<'categoryGroup'>) : undefined,
      isArchived: archived,
      attribution,
    });

    const category = await ctx.db.get(categoryId as Id<'category'>);
    if (!category) {
      throw new ApiError(500, 'internal_error', 'Failed to read back updated category');
    }

    return {
      minorUnit: workspace.minorUnit,
      body: { category: categoryToApi(category, category.name) },
    };
  },
});

/** DELETE /v1/workspaces/{workspace_id}/categories/{category_id} */
export const deleteCategory = internalMutation({
  args: {
    clerkId: v.string(),
    workspaceId: v.string(),
    categoryId: v.string(),
    moveToCategoryId: v.optional(v.string()),
    attribution: activityAttributionValidator,
  },
  handler: async (ctx, { clerkId, workspaceId, categoryId, moveToCategoryId, attribution }) => {
    const workspace = await requireWorkspaceForApi(ctx, clerkId, workspaceId);

    let newCategoryId: Id<'category'> | undefined;
    if (moveToCategoryId !== undefined) {
      newCategoryId = await validateCategoryForApi(
        ctx,
        workspace.workspace._id,
        moveToCategoryId,
        'move_to_category_id'
      );
    }

    const category = await ctx.db.get(categoryId as Id<'category'>).catch(() => null);
    if (!category || category.isDeleted || category.workspaceId !== workspace.workspace._id) {
      throw new ApiError(404, 'not_found', 'Category not found');
    }

    await deleteCategoriesWithRecategorizationImpl(ctx, {
      workspaceId: workspace.workspace._id,
      categoryIds: [category._id],
      newCategoryId,
      attribution,
    });

    return {
      minorUnit: workspace.minorUnit,
      body: { deleted: true, id: category._id },
    };
  },
});

/** POST /v1/workspaces/{workspace_id}/category_groups */
export const createCategoryGroup = internalMutation({
  args: { clerkId: v.string(), workspaceId: v.string(), payload: v.any() },
  handler: async (ctx, { clerkId, workspaceId, payload }) => {
    const workspace = await requireWorkspaceForApi(ctx, clerkId, workspaceId);
    const body = requireBody(payload);
    const name = parseRequiredString(body['name'], 'name').trim();

    let groupId: Id<'categoryGroup'>;
    try {
      groupId = await createCategoryGroupImpl(ctx, {
        workspaceId: workspace.workspace._id,
        name,
        type: 'expense',
      });
    } catch (error: unknown) {
      rethrowConflict(error);
    }

    const group = await ctx.db.get(groupId);
    if (!group) {
      throw new ApiError(500, 'internal_error', 'Failed to read back created category group');
    }

    return {
      minorUnit: workspace.minorUnit,
      body: {
        category_group: { id: group._id, name: group.name, type: group.type, system: group.isSystemGroup ?? false },
      },
    };
  },
});

/** PATCH /v1/workspaces/{workspace_id}/category_groups/{group_id} */
export const updateCategoryGroup = internalMutation({
  args: { clerkId: v.string(), workspaceId: v.string(), groupId: v.string(), payload: v.any() },
  handler: async (ctx, { clerkId, workspaceId, groupId, payload }) => {
    const workspace = await requireWorkspaceForApi(ctx, clerkId, workspaceId);
    const body = requireBody(payload);
    const name = parseRequiredString(body['name'], 'name').trim();

    await updateCategoryGroupImpl(ctx, {
      workspaceId: workspace.workspace._id,
      categoryGroupId: groupId as Id<'categoryGroup'>,
      name,
    });

    const group = await ctx.db.get(groupId as Id<'categoryGroup'>);
    if (!group) {
      throw new ApiError(500, 'internal_error', 'Failed to read back updated category group');
    }

    return {
      minorUnit: workspace.minorUnit,
      body: {
        category_group: { id: group._id, name: group.name, type: group.type, system: group.isSystemGroup ?? false },
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Budget months
// ---------------------------------------------------------------------------

/** PATCH /v1/workspaces/{workspace_id}/months/{month}/categories/{category_id} */
export const setMonthCategoryAssigned = internalMutation({
  args: {
    clerkId: v.string(),
    workspaceId: v.string(),
    month: v.string(),
    categoryId: v.string(),
    payload: v.any(),
    attribution: activityAttributionValidator,
  },
  handler: async (ctx, { clerkId, workspaceId, month, categoryId, payload, attribution }) => {
    const workspace = await requireWorkspaceForApi(ctx, clerkId, workspaceId);
    const body = requireBody(payload);

    const yearMonth = parseApiMonth(month, 'month');
    const validatedCategoryId = await validateCategoryForApi(ctx, workspace.workspace._id, categoryId, 'category_id');
    const assignedAmount = parseApiAmount(body['assigned'], 'assigned', workspace.minorUnit);

    await ctx.runMutation(internal.categoryBudgets.upsertCategoryBudgetInternal, {
      workspaceId: workspace.workspace._id,
      categoryId: validatedCategoryId,
      yearMonth,
      assignedAmount,
      attribution,
    });

    // Return the category's refreshed month status so callers see the effect
    // (new available amount) without a second request.
    const currentYearMonth = getCurrentYearMonthForTimezone(workspace.workspace.timezone);
    let categoryStatus = null;
    try {
      const status = await getEnvelopeMonthStatus(ctx, workspace.workspace, yearMonth, currentYearMonth);
      for (const group of status.groups) {
        const match = group.categories.find((category) => category.categoryId === validatedCategoryId);
        if (match) {
          categoryStatus = envelopeCategoryToApi(match);
          break;
        }
      }
    } catch {
      // The month may be outside the computable range; the assignment still applied.
    }

    return {
      minorUnit: workspace.minorUnit,
      body: {
        currency: workspace.currency,
        month: formatApiMonth(yearMonth),
        category: categoryStatus,
      },
    };
  },
});
