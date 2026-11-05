import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { extractBearerToken, validateWidgetToken } from './helpers';

/**
 * POST /widget/budget-pulse
 * Workspace and date are authoritative server values; no request body is needed.
 * Token authorization and budget reads share one query transaction.
 */
export async function handleBudgetPulse(ctx: ActionCtx, request: Request): Promise<Response> {
  const token = extractBearerToken(request);
  if (!token) return errorResponse('Missing or invalid Authorization header', 401);

  const snapshot = await ctx.runQuery(internal.widgets.queries.getBudgetPulseForWidget, { token, now: Date.now() });
  if (!snapshot) return errorResponse('Invalid or revoked token', 401);
  const response = jsonResponse(snapshot);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

/**
 * Helper to get current year-month as YYYYMM number.
 */
function getCurrentYearMonth(): number {
  const now = new Date();
  return now.getFullYear() * 100 + (now.getMonth() + 1);
}

/**
 * Parse a client-provided local date string (YYYY-MM-DD) into a YYYYMM number.
 * Falls back to server time if the date is missing or invalid.
 */
function getYearMonthFromLocalDate(localDate?: string): number {
  if (localDate) {
    const match = localDate.match(/^(\d{4})-(\d{2})-\d{2}$/);
    if (match) {
      const year = parseInt(match[1]!, 10);
      const month = parseInt(match[2]!, 10);
      if (month >= 1 && month <= 12) {
        return year * 100 + month;
      }
    }
  }
  return getCurrentYearMonth();
}

/**
 * Helper to create a JSON error response.
 */
function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Helper to create a JSON success response.
 * Handles bigint serialization by converting to number.
 */
function jsonResponse(data: unknown): Response {
  return new Response(
    JSON.stringify(data, (_key, value) => (typeof value === 'bigint' ? Number(value) : value)),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

/**
 * POST /widget/top-spending
 * Returns the top 3 spending categories for the current month.
 *
 * Request body: { localDate?: string }
 * Response: { categories: [{ name, amount }], totalSpending, currencyCode, month }
 */
export async function handleTopSpending(ctx: ActionCtx, request: Request): Promise<Response> {
  const token = extractBearerToken(request);
  if (!token) {
    return errorResponse('Missing or invalid Authorization header', 401);
  }

  const auth = await validateWidgetToken(ctx, token);
  if (!auth) {
    return errorResponse('Invalid or revoked token', 401);
  }

  let body: { localDate?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const workspaceId = auth.workspaceId as Id<'workspace'>;
  const currentYearMonth = getYearMonthFromLocalDate(body.localDate);

  // Fetch workspace for currency
  const workspace = await ctx.runQuery(internal.workspaces.getByWorkspaceId, { workspaceId });
  const currencyCode = workspace?.currency ?? 'USD';

  // Fetch spending report (only current month) using the existing internal query
  const report = await ctx.runQuery(internal.reports.queries.getSpendingReportInternal, {
    workspaceId,
    monthsBack: 1,
    currentYearMonth: BigInt(currentYearMonth),
    grossDirectional: true,
  });

  // Find current month data
  const currentMonthData = report.months.find((m) => m.yearMonth === report.currentMonth);

  if (!currentMonthData) {
    return jsonResponse({
      categories: [],
      totalSpending: 0,
      currencyCode,
      month: report.currentMonth,
    });
  }

  // Get top 6 spending categories sorted by gross outflow (descending).
  const topCategories = [...currentMonthData.categorySpending.items]
    .sort((a, b) => Number(b.outflowAmount) - Number(a.outflowAmount))
    .slice(0, 6)
    .map((cat) => ({
      name: cat.categoryName,
      amount: Number(cat.outflowAmount),
    }));

  return jsonResponse({
    categories: topCategories,
    totalSpending: Number(currentMonthData.categorySpending.total),
    currencyCode,
    month: report.currentMonth,
  });
}

/**
 * POST /widget/category-available
 * Returns the available amounts for one or more categories.
 *
 * Request body: { categoryIds: string[], localDate?: string }
 * Response: { categories: [{ categoryName, available, assigned, activity, hasUnmetTarget }], currencyCode, month }
 */
export async function handleCategoryAvailable(ctx: ActionCtx, request: Request): Promise<Response> {
  const token = extractBearerToken(request);
  if (!token) {
    return errorResponse('Missing or invalid Authorization header', 401);
  }

  const auth = await validateWidgetToken(ctx, token);
  if (!auth) {
    return errorResponse('Invalid or revoked token', 401);
  }

  let body: { categoryIds?: string[]; localDate?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const workspaceId = auth.workspaceId as Id<'workspace'>;
  const currentYearMonth = getYearMonthFromLocalDate(body.localDate);

  // Fetch workspace for currency
  const workspace = await ctx.runQuery(internal.workspaces.getByWorkspaceId, { workspaceId });
  const currencyCode = workspace?.currency ?? 'USD';

  let categories: unknown[];

  if (body.categoryIds && body.categoryIds.length > 0) {
    // Fetch specific categories
    const results = await ctx.runQuery(internal.widgets.internalQueries.getCategoriesAvailableForWidget, {
      workspaceId,
      categoryIds: body.categoryIds as Id<'category'>[],
      currentYearMonth: BigInt(currentYearMonth),
    });
    categories = results.filter((r: unknown) => r !== null);
  } else {
    // No categories specified — return top 4 by available amount
    const results = await ctx.runQuery(internal.widgets.internalQueries.getTopCategoriesAvailableForWidget, {
      workspaceId,
      currentYearMonth: BigInt(currentYearMonth),
      limit: 4,
    });
    categories = results;
  }

  const monthStr = `${Math.floor(currentYearMonth / 100)}-${String(currentYearMonth % 100).padStart(2, '0')}`;

  return jsonResponse({
    categories,
    currencyCode,
    month: monthStr,
  });
}

/**
 * POST /widget/upcoming-transactions
 * Returns the next upcoming/overdue recurring transactions.
 *
 * Request body: { localDate?: string, expensesOnly?: boolean }
 * Response: { transactions: [{ merchantName, amount, isIncome, dueDate, isOverdue }], currencyCode }
 */
export async function handleUpcomingTransactions(ctx: ActionCtx, request: Request): Promise<Response> {
  const token = extractBearerToken(request);
  if (!token) {
    return errorResponse('Missing or invalid Authorization header', 401);
  }

  const auth = await validateWidgetToken(ctx, token);
  if (!auth) {
    return errorResponse('Invalid or revoked token', 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return errorResponse('Invalid JSON body', 400);
  }
  const localDate = 'localDate' in body ? body.localDate : undefined;
  const expensesOnly = 'expensesOnly' in body ? body.expensesOnly : undefined;
  if (
    (localDate !== undefined && typeof localDate !== 'string') ||
    (expensesOnly !== undefined && typeof expensesOnly !== 'boolean')
  ) {
    return errorResponse('Invalid widget options', 400);
  }

  const workspaceId = auth.workspaceId as Id<'workspace'>;

  // Fetch workspace for currency
  const workspace = await ctx.runQuery(internal.workspaces.getByWorkspaceId, { workspaceId });
  const currencyCode = workspace?.currency ?? 'USD';

  // Use client local date if provided and valid, otherwise fall back to server UTC
  const today =
    localDate && /^\d{4}-\d{2}-\d{2}$/.test(localDate) ? localDate : new Date().toISOString().split('T')[0]!;

  // Fetch upcoming recurring transactions using our internal query
  const transactions = await ctx.runQuery(internal.widgets.internalQueries.getUpcomingRecurringForWidget, {
    workspaceId,
    today,
    expensesOnly,
  });

  return jsonResponse({
    transactions,
    currencyCode,
  });
}

/**
 * POST /widget/account-balances
 * Returns bank account balances grouped by type category.
 *
 * Request body: { accountIds?: string[] }
 * Response: { groups: [{ category, accounts: [{ accountId, name, accountType, balance }], subtotal }], totalAssets, totalLiabilities, netWorth, currencyCode }
 */
export async function handleAccountBalances(ctx: ActionCtx, request: Request): Promise<Response> {
  const token = extractBearerToken(request);
  if (!token) {
    return errorResponse('Missing or invalid Authorization header', 401);
  }

  const auth = await validateWidgetToken(ctx, token);
  if (!auth) {
    return errorResponse('Invalid or revoked token', 401);
  }

  let body: { accountIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const workspaceId = auth.workspaceId as Id<'workspace'>;

  // Fetch workspace for currency
  const workspace = await ctx.runQuery(internal.workspaces.getByWorkspaceId, { workspaceId });
  const currencyCode = workspace?.currency ?? 'USD';

  const result = await ctx.runQuery(internal.widgets.internalQueries.getAccountBalancesForWidget, {
    workspaceId,
    accountIds: body.accountIds as Id<'bankAccount'>[] | undefined,
  });

  return jsonResponse({
    ...result,
    currencyCode,
  });
}

/**
 * POST /widget/net-worth
 * Returns monthly net worth data for chart display.
 *
 * Request body: { monthsBack?: number }
 * Response: { months: [{ yearMonth, netWorth, totalAssets, totalLiabilities }], currentNetWorth, currencyCode }
 */
export async function handleNetWorthHistory(ctx: ActionCtx, request: Request): Promise<Response> {
  const token = extractBearerToken(request);
  if (!token) {
    return errorResponse('Missing or invalid Authorization header', 401);
  }

  const auth = await validateWidgetToken(ctx, token);
  if (!auth) {
    return errorResponse('Invalid or revoked token', 401);
  }

  let body: { monthsBack?: number; localDate?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const workspaceId = auth.workspaceId as Id<'workspace'>;

  // Fetch workspace for currency
  const workspace = await ctx.runQuery(internal.workspaces.getByWorkspaceId, { workspaceId });
  const currencyCode = workspace?.currency ?? 'USD';

  const currentYearMonth = getYearMonthFromLocalDate(body.localDate);

  const result = await ctx.runQuery(internal.widgets.internalQueries.getNetWorthHistoryForWidget, {
    workspaceId,
    currentYearMonth: BigInt(currentYearMonth),
    monthsBack: body.monthsBack ?? 6,
  });

  return jsonResponse({
    ...result,
    currencyCode,
  });
}
