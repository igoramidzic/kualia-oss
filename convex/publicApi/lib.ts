import { ConvexError } from 'convex/values';

import { getCurrencyDecimals } from '../../packages/shared/src/currency/currency-conversion';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { parseDecimalToBigIntMinorUnits } from '../lib/serialization';
import { getWorkspaceAccessForClerkId, type WorkspaceAccessRole } from '../workspaces/access';

/**
 * Error names follow the public API error contract documented at
 * docs/api/errors: every error response is
 * `{ "error": { "id": "<http status>", "name": "<name>", "detail": "..." } }`.
 */
export type ApiErrorName =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limit_exceeded'
  | 'internal_error';

export type ApiErrorData = {
  publicApiError: true;
  status: number;
  name: ApiErrorName;
  detail: string;
};

/**
 * Structured error thrown by public-API internal functions. Built on
 * ConvexError so `data` survives the runQuery/runMutation boundary back to the
 * HTTP layer, which turns it into the documented JSON error response.
 */
export class ApiError extends ConvexError<ApiErrorData> {
  constructor(status: number, name: ApiErrorName, detail: string) {
    super({ publicApiError: true, status, name, detail });
  }
}

export function isApiErrorData(data: unknown): data is ApiErrorData {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>)['publicApiError'] === true &&
    typeof (data as Record<string, unknown>)['status'] === 'number'
  );
}

export const INT64_MIN = -(2n ** 63n);
export const INT64_MAX = 2n ** 63n - 1n;

export type ApiWorkspaceContext = {
  workspace: Doc<'workspace'>;
  role: WorkspaceAccessRole;
  currency: string;
  minorUnit: number;
};

/**
 * Resolve + authorize a workspace for an API-key caller. Mirrors the MCP
 * `resolveWorkspace` semantics: unknown/deleted → 404, no access → 403,
 * archived → 403.
 */
export async function requireWorkspaceForApi(
  ctx: QueryCtx | MutationCtx,
  clerkId: string,
  rawWorkspaceId: string
): Promise<ApiWorkspaceContext> {
  const workspaceId = rawWorkspaceId as Id<'workspace'>;

  const workspace = await ctx.db.get(workspaceId).catch(() => null);
  if (!workspace || workspace.isDeleted) {
    throw new ApiError(404, 'not_found', 'Workspace not found');
  }

  const access = await getWorkspaceAccessForClerkId(ctx, workspaceId, clerkId);
  if (!access) {
    throw new ApiError(403, 'forbidden', 'You do not have access to this workspace');
  }

  if (workspace.isArchived) {
    throw new ApiError(403, 'forbidden', 'Workspace is archived');
  }

  const currency = (workspace.currency ?? 'USD').toUpperCase();
  return {
    workspace,
    role: access.role,
    currency,
    minorUnit: getCurrencyDecimals(currency),
  };
}

// ---------------------------------------------------------------------------
// Input parsing helpers (raw JSON payload values → validated internal values)
// ---------------------------------------------------------------------------

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function parseApiDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new ApiError(400, 'bad_request', `${field} must be a date string in YYYY-MM-DD format`);
  }
  return value;
}

/** Parse an external month string ("2026-07") into an internal yearMonth number (202607). */
export function parseApiMonth(value: string, field: string): number {
  if (!MONTH_PATTERN.test(value)) {
    throw new ApiError(400, 'bad_request', `${field} must be a month string in YYYY-MM format`);
  }
  return Number(value.replace('-', ''));
}

/** Format an internal yearMonth number (202607) as an external month string ("2026-07"). */
export function formatApiMonth(yearMonth: number): string {
  const raw = String(yearMonth);
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function parseApiAmount(value: unknown, field: string, minorUnit: number): bigint {
  if (typeof value !== 'string') {
    throw new ApiError(
      400,
      'bad_request',
      `${field} must be a decimal string in the workspace currency (e.g. "-12.34")`
    );
  }
  let amount: bigint;
  try {
    amount = parseDecimalToBigIntMinorUnits(value, minorUnit);
  } catch (error: unknown) {
    const detail = error instanceof Error ? `${field}: ${error.message}` : `${field} must be a valid decimal string`;
    throw new ApiError(400, 'bad_request', detail);
  }
  if (amount < INT64_MIN || amount > INT64_MAX) {
    throw new ApiError(400, 'bad_request', `${field} is out of range`);
  }
  return amount;
}

export function parseOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new ApiError(400, 'bad_request', `${field} must be a string`);
  }
  return value;
}

export function parseRequiredString(value: unknown, field: string): string {
  const parsed = parseOptionalString(value, field);
  if (parsed === undefined || parsed.trim().length === 0) {
    throw new ApiError(400, 'bad_request', `${field} is required`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Resource mappers (internal docs → external snake_case API resources).
// Money stays bigint here; the HTTP layer serializes every bigint to a decimal
// string via serializeBigInts(minorUnit).
// ---------------------------------------------------------------------------

export function bankAccountToApi(account: Doc<'bankAccount'>, isOnBudget: boolean) {
  return {
    id: account._id,
    name: account.name,
    type: account.accountType,
    on_budget: isOnBudget,
    balance: account.currentBalance,
    cleared_balance: account.clearedBalance ?? null,
    pending_balance: account.pendingBalance ?? null,
    closed: account.isClosed,
    notes: account.notes ?? null,
    linked: account.bankLinkAccountId !== undefined || account.financeKitAccountId !== undefined,
    last_reconciled_at: account.lastReconciledAt ?? null,
    created_at: new Date(account._creationTime).toISOString(),
    updated_at: account.updatedAt,
  };
}

export function merchantToApi(merchant: Doc<'merchant'>, resolvedName: string | null) {
  return {
    id: merchant._id,
    name: resolvedName,
    created_at: new Date(merchant._creationTime).toISOString(),
    updated_at: merchant.updatedAt,
  };
}

export function categoryToApi(category: Doc<'category'>, resolvedName: string) {
  return {
    id: category._id,
    name: resolvedName,
    group_id: category.categoryGroupId,
    archived: category.isArchived ?? false,
    system: category.isSystemCategory ?? false,
    category_type: category.categoryType ?? 'custom',
  };
}

export function transactionToApi(
  transaction: Doc<'transaction'>,
  context: {
    merchantName: string | null;
    accountName: string | null;
  }
) {
  const movements = transaction.movements;
  const single = movements.length === 1 ? movements[0] : undefined;

  return {
    id: transaction._id,
    date: transaction.date,
    amount: transaction.totalAmount,
    account_id: transaction.bankAccountId,
    account_name: context.accountName,
    merchant_id: transaction.merchantId ?? null,
    merchant_name: context.merchantName,
    category_id: single ? (single.categoryId ?? null) : null,
    category_name: single ? (single.categoryName ?? null) : null,
    ready_to_assign: single ? single.readyToAssign : false,
    notes: transaction.notes ?? null,
    status: transaction.status,
    review_status: transaction.reviewStatus,
    type: transaction.type,
    transfer_account_id: transaction.transferPairBankAccountId ?? null,
    splits:
      movements.length > 1
        ? movements.map((movement) => ({
            amount: movement.amount,
            category_id: movement.categoryId ?? null,
            category_name: movement.categoryName ?? null,
            ready_to_assign: movement.readyToAssign,
            notes: movement.notes ?? null,
          }))
        : null,
    deleted: transaction.isDeleted,
    created_at: new Date(transaction._creationTime).toISOString(),
    updated_at: transaction.updatedAt,
  };
}

/**
 * Batch-map transactions to API shapes, resolving merchant + account names.
 */
export async function transactionsToApi(
  ctx: QueryCtx | MutationCtx,
  transactions: Doc<'transaction'>[],
  batchResolveMerchantNames: (ctx: QueryCtx | MutationCtx, ids: Set<string>) => Promise<Map<string, string>>
) {
  const merchantIds = new Set<string>();
  const accountIds = new Set<string>();
  for (const transaction of transactions) {
    if (transaction.merchantId) merchantIds.add(transaction.merchantId);
    accountIds.add(transaction.bankAccountId);
  }

  const [merchantNames, accountDocs] = await Promise.all([
    batchResolveMerchantNames(ctx, merchantIds),
    Promise.all([...accountIds].map((id) => ctx.db.get(id as Id<'bankAccount'>))),
  ]);

  const accountNames = new Map<string, string>();
  for (const account of accountDocs) {
    if (account) accountNames.set(account._id, account.name);
  }

  return transactions.map((transaction) =>
    transactionToApi(transaction, {
      merchantName: transaction.merchantId ? (merchantNames.get(transaction.merchantId) ?? null) : null,
      accountName: accountNames.get(transaction.bankAccountId) ?? null,
    })
  );
}
