import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from '../_generated/server';
import { activityAttributionValidator, type ActivityAttribution } from '../activityLogs/types';
import { createWorkspaceExportForClerk, type WorkspaceExportResult } from '../dataExports';
import { getCurrentDateForTimezone, getCurrentYearMonthForTimezone, parseCurrentYearMonth } from '../lib/dates';
import { parseDecimalToBigIntMinorUnits } from '../lib/serialization';
import { getOrCreateMerchantByName } from '../merchants/helpers';
import type {
  ChatFileImportCreatedMovement,
  ChatFileImportInput,
  ChatFileImportResult,
} from '../transactionImport/processChatFileImport';
import { isOnBudgetAccountType } from '../transactions/helpers';
import {
  getWorkspaceAccessForClerkId,
  listAccessibleWorkspacesForClerkId,
  selectDefaultAccessibleWorkspace,
} from '../workspaces/access';
import { listBankAccountsForMcp, type BankAccountsToolPayload } from './bankAccountTools';
import {
  EnvelopeMonthStatusFilterError,
  filterEnvelopeMonthStatus,
  getEnvelopeMonthStatus,
  parseEnvelopeMonthStatusFilterInput,
  type EnvelopeMonthStatusFilter,
  type EnvelopeMonthStatusPayload,
} from './budgetTools';
import {
  listCategoryGroupsWithCategories,
  listCategoryTargets,
  type CategoryGroupsToolPayload,
  type CategoryTargetsToolPayload,
} from './categoryTools';
import { buildYearMonthRange, getIncomeSummary, type IncomeSummaryToolPayload } from './incomeTools';
import { getMonthlySummary, type MonthlySummaryToolPayload } from './monthlySummaryTools';
import { listRecurringTransactionsForMcp, type RecurringTransactionsToolPayload } from './recurringTools';
import { getCategoryRollup, type CategoryRollupToolPayload } from './rollupTools';
import {
  hasBudgetsWriteScope,
  hasReportsReadScope,
  hasTransactionsWriteScope,
  MCP_TOOL_ARCHIVE_CATEGORIES,
  MCP_TOOL_ARCHIVE_CATEGORY_GROUPS,
  MCP_TOOL_CLOSE_BANK_ACCOUNT,
  MCP_TOOL_CREATE_BANK_ACCOUNT,
  MCP_TOOL_CREATE_CATEGORIES,
  MCP_TOOL_CREATE_CATEGORY_GROUPS,
  MCP_TOOL_CREATE_CATEGORY_TARGET,
  MCP_TOOL_CREATE_TRANSACTIONS,
  MCP_TOOL_DELETE_BANK_ACCOUNT,
  MCP_TOOL_DELETE_CATEGORIES,
  MCP_TOOL_DELETE_CATEGORY_TARGET,
  MCP_TOOL_DELETE_TRANSACTIONS,
  MCP_TOOL_EXPORT_WORKSPACE_DATA,
  MCP_TOOL_GET_ACCOUNT_BALANCES_REPORT,
  MCP_TOOL_GET_CATEGORY_ROLLUP,
  MCP_TOOL_GET_ENVELOPE_MONTH_STATUS,
  MCP_TOOL_GET_INCOME_SUMMARY,
  MCP_TOOL_GET_MONTHLY_SUMMARY,
  MCP_TOOL_GET_NET_WORTH_REPORT,
  MCP_TOOL_GET_SPENDING_REPORT,
  MCP_TOOL_LIST_BANK_ACCOUNTS,
  MCP_TOOL_LIST_CATEGORY_GROUPS,
  MCP_TOOL_LIST_CATEGORY_TARGETS,
  MCP_TOOL_LIST_RECURRING_TRANSACTIONS,
  MCP_TOOL_LIST_TRANSACTIONS,
  MCP_TOOL_LIST_WORKSPACES,
  MCP_TOOL_RECONCILE_BANK_ACCOUNT,
  MCP_TOOL_REORDER_CATEGORIES,
  MCP_TOOL_REORDER_CATEGORY_GROUPS,
  MCP_TOOL_RESTORE_TRANSACTIONS,
  MCP_TOOL_SET_CATEGORY_ASSIGNED_AMOUNT,
  MCP_TOOL_SORT_CATEGORIES,
  MCP_TOOL_SORT_CATEGORY_GROUPS,
  MCP_TOOL_UPDATE_CATEGORIES,
  MCP_TOOL_UPDATE_CATEGORY_GROUPS,
  MCP_TOOL_UPDATE_CATEGORY_TARGET,
  MCP_TOOL_UPDATE_TRANSACTIONS,
  resolveMcpAmountMetadata,
  type McpAmountMetadata,
} from './tools';
import { buildTransactionUrl } from './transactionLinks';
import { listTransactionsForMonth, type TransactionListToolPayload } from './transactionTools';

type McpErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID_ARGUMENT' | 'INTERNAL';

type McpToolFailure = {
  ok: false;
  error: {
    code: McpErrorCode;
    message: string;
  };
};

type McpToolSuccess = {
  ok: true;
  data: unknown;
};

type McpToolResult = McpToolFailure | McpToolSuccess;

type McpReportToolPayload = McpAmountMetadata & {
  workspaceId: Id<'workspace'>;
  currency: string;
  months: unknown[];
  currentMonth: string;
};

type McpSetCategoryAssignedAmountPayload = McpAmountMetadata & {
  workspaceId: Id<'workspace'>;
  categoryId: Id<'category'>;
  yearMonth: number;
  previousAssignedAmount: bigint;
  assignedAmount: bigint;
  readyToAssignDelta: bigint;
  createdBudgetRow: boolean;
};

type McpBulkSetCategoryAssignedAmountUpdate = {
  categoryId: Id<'category'>;
  yearMonth: number;
  previousAssignedAmount: bigint;
  assignedAmount: bigint;
  readyToAssignDelta: bigint;
  createdBudgetRow: boolean;
};

type McpBulkSetCategoryAssignedAmountPayload = McpAmountMetadata & {
  workspaceId: Id<'workspace'>;
  updates: McpBulkSetCategoryAssignedAmountUpdate[];
  totalReadyToAssignDelta: bigint;
};

type McpSetCategoryAssignedAmountToolPayload =
  | McpSetCategoryAssignedAmountPayload
  | McpBulkSetCategoryAssignedAmountPayload;

type ParsedBudgetAssignmentUpdate = {
  categoryId: Id<'category'>;
  yearMonth: number;
  assignedAmount: bigint;
};

type ParsedReconcileBankAccountArgs = {
  bankAccountId: Id<'bankAccount'>;
  reportedBalance: bigint;
  reconciliationDate: string;
};

const LEGACY_MCP_TOOL_GET_NET_WORTH_REPORT = 'kualia.get_net_worth_report';
const LEGACY_MCP_TOOL_GET_SPENDING_REPORT = 'kualia.get_spending_report';
const LEGACY_MCP_TOOL_LIST_WORKSPACES = 'kualia.list_workspaces';

type ReportToolName =
  | typeof MCP_TOOL_GET_ACCOUNT_BALANCES_REPORT
  | typeof MCP_TOOL_GET_NET_WORTH_REPORT
  | typeof MCP_TOOL_GET_SPENDING_REPORT
  | typeof LEGACY_MCP_TOOL_GET_NET_WORTH_REPORT
  | typeof LEGACY_MCP_TOOL_GET_SPENDING_REPORT;

const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;

export class McpToolError extends Error {
  readonly code: McpErrorCode;

  constructor(code: McpErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseToolArguments(rawArguments: string | undefined): Record<string, unknown> {
  if (!rawArguments) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments) as unknown;
  } catch {
    throw new McpToolError('INVALID_ARGUMENT', 'Tool arguments must be valid JSON');
  }

  if (!isRecord(parsed)) {
    throw new McpToolError('INVALID_ARGUMENT', 'Tool arguments must be a JSON object');
  }

  return parsed;
}

function parseWorkspaceId(value: unknown): Id<'workspace'> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new McpToolError('INVALID_ARGUMENT', 'workspaceId must be a string');
  }

  return value as Id<'workspace'>;
}

function parseCategoryId(value: unknown): Id<'category'> {
  if (typeof value !== 'string') {
    throw new McpToolError('INVALID_ARGUMENT', 'categoryId is required and must be a string');
  }

  return value as Id<'category'>;
}

function parseMonthsBack(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new McpToolError('INVALID_ARGUMENT', 'monthsBack must be an integer');
  }

  if (value <= 0) {
    throw new McpToolError('INVALID_ARGUMENT', 'monthsBack must be positive');
  }

  return value;
}

function parseCurrentYearMonthArg(value: unknown): number | undefined {
  try {
    return parseCurrentYearMonth(value);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid currentYearMonth value';
    throw new McpToolError('INVALID_ARGUMENT', message);
  }
}

function parseRequiredYearMonthArg(value: unknown): number {
  const parsed = parseCurrentYearMonthArg(value);
  if (parsed === undefined) {
    throw new McpToolError('INVALID_ARGUMENT', 'yearMonth is required and must be in YYYYMM format');
  }

  return parsed;
}

function parseRequiredCurrentDateArg(value: unknown): number {
  const date = parseRequiredDateArg(value, 'currentDate');
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new McpToolError('INVALID_ARGUMENT', 'currentDate must be in YYYY-MM-DD format');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);

  return year * 100 + month;
}

function parseRequiredDateArg(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new McpToolError('INVALID_ARGUMENT', `${fieldName} is required and must be a YYYY-MM-DD string`);
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new McpToolError('INVALID_ARGUMENT', `${fieldName} must be in YYYY-MM-DD format`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  const isValidDate =
    parsedDate.getUTCFullYear() === year && parsedDate.getUTCMonth() + 1 === month && parsedDate.getUTCDate() === day;

  if (!isValidDate) {
    throw new McpToolError('INVALID_ARGUMENT', `${fieldName} must be a valid calendar date`);
  }

  return value;
}

function parseRequiredAssignedAmountArg(value: unknown, minorUnit: number): bigint {
  if (typeof value !== 'string') {
    throw new McpToolError('INVALID_ARGUMENT', 'assignedAmount is required and must be a string');
  }

  let parsed: bigint;
  try {
    parsed = parseDecimalToBigIntMinorUnits(value, minorUnit);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'assignedAmount must be a valid decimal string';
    throw new McpToolError('INVALID_ARGUMENT', message);
  }

  if (parsed < INT64_MIN || parsed > INT64_MAX) {
    throw new McpToolError('INVALID_ARGUMENT', 'assignedAmount must fit in a signed 64-bit integer');
  }

  return parsed;
}

function parseRequiredReportedBalanceArg(value: unknown, minorUnit: number): bigint {
  if (typeof value !== 'string') {
    throw new McpToolError('INVALID_ARGUMENT', 'reportedBalance is required and must be a string');
  }

  let parsed: bigint;
  try {
    parsed = parseDecimalToBigIntMinorUnits(value, minorUnit);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'reportedBalance must be a valid decimal string';
    throw new McpToolError('INVALID_ARGUMENT', message);
  }

  if (parsed < INT64_MIN || parsed > INT64_MAX) {
    throw new McpToolError('INVALID_ARGUMENT', 'reportedBalance must fit in a signed 64-bit integer');
  }

  return parsed;
}

export function parseReconcileBankAccountArgs(
  args: Record<string, unknown>,
  minorUnit: number
): ParsedReconcileBankAccountArgs {
  const bankAccountIdRaw = args['bankAccountId'];
  if (typeof bankAccountIdRaw !== 'string' || bankAccountIdRaw.length === 0) {
    throw new McpToolError('INVALID_ARGUMENT', 'bankAccountId is required and must be a non-empty string');
  }

  return {
    bankAccountId: bankAccountIdRaw as Id<'bankAccount'>,
    reportedBalance: parseRequiredReportedBalanceArg(args['reportedBalance'], minorUnit),
    reconciliationDate: parseRequiredDateArg(args['reconciliationDate'], 'reconciliationDate'),
  };
}

/** Every account type the MCP create tool accepts — mirrors the `accountType` union in the schema. */
const MCP_BANK_ACCOUNT_TYPES: ReadonlySet<string> = new Set([
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

type ParsedCreateBankAccountArgs = {
  name: string;
  accountType: Doc<'bankAccount'>['accountType'];
  initialBalance?: bigint;
  initialBalanceDate?: string;
};

export function parseCreateBankAccountArgs(
  args: Record<string, unknown>,
  minorUnit: number
): ParsedCreateBankAccountArgs {
  const nameRaw = args['name'];
  if (typeof nameRaw !== 'string' || nameRaw.trim().length === 0) {
    throw new McpToolError('INVALID_ARGUMENT', 'name is required and must be a non-empty string');
  }
  const name = nameRaw.trim();

  const accountTypeRaw = args['accountType'];
  if (typeof accountTypeRaw !== 'string' || !MCP_BANK_ACCOUNT_TYPES.has(accountTypeRaw)) {
    throw new McpToolError(
      'INVALID_ARGUMENT',
      'accountType must be one of the supported account types (e.g. banking_checking, credit_credit_card, investment_brokerage, loan_mortgage)'
    );
  }
  const accountType = accountTypeRaw as Doc<'bankAccount'>['accountType'];

  const initialBalanceRaw = args['initialBalance'];
  const initialBalanceDateRaw = args['initialBalanceDate'];
  const hasInitialBalance = initialBalanceRaw !== undefined && initialBalanceRaw !== null;
  const hasInitialBalanceDate = initialBalanceDateRaw !== undefined && initialBalanceDateRaw !== null;

  if (hasInitialBalance !== hasInitialBalanceDate) {
    throw new McpToolError(
      'INVALID_ARGUMENT',
      'initialBalance and initialBalanceDate must be provided together, or both omitted'
    );
  }

  if (!hasInitialBalance) {
    return { name, accountType };
  }

  return {
    name,
    accountType,
    initialBalance: parseCreateAmount(initialBalanceRaw, 'initialBalance', minorUnit),
    initialBalanceDate: parseRequiredDateArg(initialBalanceDateRaw, 'initialBalanceDate'),
  };
}

function parseBulkUpdatesArg(value: unknown, minorUnit: number): ParsedBudgetAssignmentUpdate[] {
  if (!Array.isArray(value)) {
    throw new McpToolError('INVALID_ARGUMENT', 'updates must be an array');
  }

  if (value.length === 0) {
    throw new McpToolError('INVALID_ARGUMENT', 'updates must contain at least one item');
  }

  const parsedUpdates = value.map((update, index) => {
    if (!isRecord(update)) {
      throw new McpToolError('INVALID_ARGUMENT', `updates[${index}] must be an object`);
    }

    return {
      categoryId: parseCategoryId(update['categoryId']),
      yearMonth: parseRequiredYearMonthArg(update['yearMonth']),
      assignedAmount: parseRequiredAssignedAmountArg(update['assignedAmount'], minorUnit),
    };
  });

  const dedupeKeys = new Set<string>();
  for (const update of parsedUpdates) {
    const key = `${update.categoryId}:${update.yearMonth}`;
    if (dedupeKeys.has(key)) {
      throw new McpToolError(
        'INVALID_ARGUMENT',
        `updates contains duplicate categoryId/yearMonth pairs (${update.categoryId}, ${update.yearMonth})`
      );
    }
    dedupeKeys.add(key);
  }

  return parsedUpdates;
}

function getCurrentYearMonthForWorkspaceTimezone(timezone: string | undefined): number {
  try {
    return getCurrentYearMonthForTimezone(timezone);
  } catch {
    throw new McpToolError('INTERNAL', 'Failed to derive current month for workspace timezone');
  }
}

type McpExecutionCtx = QueryCtx | MutationCtx;

async function resolveWorkspace(
  ctx: McpExecutionCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  requestedWorkspaceId: Id<'workspace'> | undefined
) {
  let targetWorkspaceId = requestedWorkspaceId ?? activeWorkspaceId;

  if (!targetWorkspaceId) {
    const accessibleWorkspaces = await listAccessibleWorkspacesForClerkId(ctx, clerkId);
    targetWorkspaceId = selectDefaultAccessibleWorkspace(accessibleWorkspaces)?.workspace._id;
  }

  if (!targetWorkspaceId) {
    throw new McpToolError('NOT_FOUND', 'No workspace specified and no active workspace is set');
  }

  const access = await getWorkspaceAccessForClerkId(ctx, targetWorkspaceId, clerkId);
  if (!access) {
    const workspace = await ctx.db.get(targetWorkspaceId);
    if (!workspace || workspace.isDeleted) {
      throw new McpToolError('NOT_FOUND', 'Workspace not found');
    }
    throw new McpToolError('FORBIDDEN', 'You do not have access to this workspace');
  }

  const workspace = access.workspace;
  if (workspace.isDeleted) {
    throw new McpToolError('NOT_FOUND', 'Workspace not found');
  }

  if (workspace.isArchived) {
    throw new McpToolError('FORBIDDEN', 'Workspace is archived');
  }

  return workspace;
}

async function listWorkspaces(ctx: QueryCtx, clerkId: string) {
  const workspaces = await listAccessibleWorkspacesForClerkId(ctx, clerkId);
  const accessibleWorkspaces = workspaces.map(({ workspace, role }) => ({
    workspaceId: workspace._id,
    name: workspace.name,
    role,
    isArchived: workspace.isArchived ?? false,
  }));

  if (accessibleWorkspaces.length === 0) {
    throw new McpToolError(
      'NOT_FOUND',
      'No workspaces found for the authenticated account. Re-authenticate using the account that owns your Kualia workspaces.'
    );
  }

  return accessibleWorkspaces;
}

async function validateCategoryForWorkspace(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>,
  categoryId: Id<'category'>
): Promise<void> {
  let category = null;
  try {
    category = await ctx.db.get(categoryId);
  } catch {
    throw new McpToolError('INVALID_ARGUMENT', 'categoryId is invalid');
  }

  if (!category || category.isDeleted) {
    throw new McpToolError('NOT_FOUND', 'Category not found');
  }

  if (!category.isSystemCategory && category.workspaceId !== workspaceId) {
    throw new McpToolError('FORBIDDEN', 'Category not found or does not belong to workspace');
  }
}

async function executeReportTool(
  ctx: QueryCtx,
  toolName: ReportToolName,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined
): Promise<McpReportToolPayload> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const monthsBack = parseMonthsBack(args['monthsBack']);
  const providedCurrentYearMonth = parseCurrentYearMonthArg(args['currentYearMonth']);
  const singleYearMonth = parseCurrentYearMonthArg(args['yearMonth']);

  // For spending report: yearMonth and monthsBack are mutually exclusive
  if (singleYearMonth !== undefined && monthsBack !== undefined) {
    throw new McpToolError('INVALID_ARGUMENT', 'Provide either yearMonth or monthsBack, not both');
  }

  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);
  const currencyCode = workspace.currency ?? 'USD';
  const amountMetadata = resolveMcpAmountMetadata(currencyCode);

  if (
    toolName === MCP_TOOL_GET_ACCOUNT_BALANCES_REPORT ||
    toolName === MCP_TOOL_GET_NET_WORTH_REPORT ||
    toolName === LEGACY_MCP_TOOL_GET_NET_WORTH_REPORT
  ) {
    const currentYearMonth = providedCurrentYearMonth ?? getCurrentYearMonthForWorkspaceTimezone(workspace.timezone);
    const report = await ctx.runQuery(internal.reports.queries.getNetWorthReportInternal, {
      workspaceId: workspace._id,
      monthsBack,
      currentYearMonth: BigInt(currentYearMonth),
    });

    return {
      workspaceId: workspace._id,
      currency: currencyCode,
      ...amountMetadata,
      months: report.months,
      currentMonth: report.currentMonth,
    };
  }

  // Spending report: when yearMonth is provided, scope to that single month
  const effectiveCurrentYearMonth =
    singleYearMonth ?? providedCurrentYearMonth ?? getCurrentYearMonthForWorkspaceTimezone(workspace.timezone);
  const effectiveMonthsBack = singleYearMonth !== undefined ? 1 : monthsBack;

  const report = await ctx.runQuery(internal.reports.queries.getSpendingReportInternal, {
    workspaceId: workspace._id,
    monthsBack: effectiveMonthsBack,
    currentYearMonth: BigInt(effectiveCurrentYearMonth),
    grossDirectional: true,
  });

  return {
    workspaceId: workspace._id,
    currency: currencyCode,
    ...amountMetadata,
    months: report.months,
    currentMonth: report.currentMonth,
  };
}

async function executeListCategoryGroupsTool(
  ctx: QueryCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined
): Promise<CategoryGroupsToolPayload> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);
  return listCategoryGroupsWithCategories(ctx, workspace._id);
}

async function executeEnvelopeMonthStatusTool(
  ctx: QueryCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined
): Promise<EnvelopeMonthStatusPayload> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const yearMonth = parseRequiredYearMonthArg(args['yearMonth']);
  const currentYearMonth = parseRequiredCurrentDateArg(args['currentDate']);
  let filter: EnvelopeMonthStatusFilter | undefined;
  try {
    filter = parseEnvelopeMonthStatusFilterInput(args);
  } catch (error: unknown) {
    if (error instanceof EnvelopeMonthStatusFilterError) {
      throw new McpToolError(error.code, error.message);
    }

    throw error;
  }
  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);

  const status = await getEnvelopeMonthStatus(ctx, workspace, yearMonth, currentYearMonth);
  try {
    return filterEnvelopeMonthStatus(status, filter);
  } catch (error: unknown) {
    if (error instanceof EnvelopeMonthStatusFilterError) {
      throw new McpToolError(error.code, error.message);
    }

    throw error;
  }
}

async function executeListTransactionsTool(
  ctx: QueryCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined
): Promise<TransactionListToolPayload> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const yearMonth = parseRequiredYearMonthArg(args['yearMonth']);
  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);

  const accountId = args['accountId'] !== undefined ? (args['accountId'] as Id<'bankAccount'>) : undefined;
  const categoryId = args['categoryId'] !== undefined ? (args['categoryId'] as Id<'category'>) : undefined;
  const type = args['type'] as string | undefined;
  const limitArg = args['limit'];
  let limit = 500;
  if (limitArg !== undefined) {
    if (typeof limitArg !== 'number' || !Number.isInteger(limitArg) || limitArg < 1 || limitArg > 1000) {
      throw new McpToolError('INVALID_ARGUMENT', 'limit must be an integer between 1 and 1000');
    }
    limit = limitArg;
  }

  return listTransactionsForMonth(ctx, workspace, yearMonth, { accountId, categoryId, type, limit });
}

async function executeListCategoryTargetsTool(
  ctx: QueryCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined
): Promise<CategoryTargetsToolPayload> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);
  return listCategoryTargets(ctx, workspace);
}

async function executeListRecurringTransactionsTool(
  ctx: QueryCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined
): Promise<RecurringTransactionsToolPayload> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const status = args['status'] as 'active' | 'inactive' | undefined;
  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);
  return listRecurringTransactionsForMcp(ctx, workspace, status);
}

async function executeIncomeSummaryTool(
  ctx: QueryCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined
): Promise<IncomeSummaryToolPayload> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const singleYearMonth = parseCurrentYearMonthArg(args['yearMonth']);
  const monthsBack = parseMonthsBack(args['monthsBack']);
  const providedCurrentYearMonth = parseCurrentYearMonthArg(args['currentYearMonth']);

  if (singleYearMonth !== undefined && monthsBack !== undefined) {
    throw new McpToolError('INVALID_ARGUMENT', 'Provide either yearMonth or monthsBack, not both');
  }

  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);

  let yearMonths: number[];
  if (singleYearMonth !== undefined) {
    yearMonths = [singleYearMonth];
  } else {
    const endMonth = providedCurrentYearMonth ?? getCurrentYearMonthForWorkspaceTimezone(workspace.timezone);
    yearMonths = buildYearMonthRange(endMonth, monthsBack ?? 1);
  }

  return getIncomeSummary(ctx, workspace, yearMonths);
}

async function executeMonthlySummaryTool(
  ctx: QueryCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined
): Promise<MonthlySummaryToolPayload> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const singleYearMonth = parseCurrentYearMonthArg(args['yearMonth']);
  const monthsBack = parseMonthsBack(args['monthsBack']);
  const providedCurrentYearMonth = parseCurrentYearMonthArg(args['currentYearMonth']);

  if (singleYearMonth !== undefined && monthsBack !== undefined) {
    throw new McpToolError('INVALID_ARGUMENT', 'Provide either yearMonth or monthsBack, not both');
  }

  if (monthsBack !== undefined && monthsBack > 24) {
    throw new McpToolError('INVALID_ARGUMENT', 'monthsBack must be at most 24');
  }

  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);

  let yearMonths: number[];
  if (singleYearMonth !== undefined) {
    yearMonths = [singleYearMonth];
  } else {
    const endMonth = providedCurrentYearMonth ?? getCurrentYearMonthForWorkspaceTimezone(workspace.timezone);
    yearMonths = buildYearMonthRange(endMonth, monthsBack ?? 6);
  }

  return getMonthlySummary(ctx, workspace, yearMonths);
}

async function executeCategoryRollupTool(
  ctx: QueryCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined
): Promise<CategoryRollupToolPayload> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const monthsBackArg = parseMonthsBack(args['monthsBack']);
  const providedCurrentYearMonth = parseCurrentYearMonthArg(args['currentYearMonth']);
  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);

  let monthsBack = monthsBackArg ?? 6;
  if (monthsBack > 24) {
    throw new McpToolError('INVALID_ARGUMENT', 'monthsBack must be at most 24');
  }

  const endMonth = providedCurrentYearMonth ?? getCurrentYearMonthForWorkspaceTimezone(workspace.timezone);
  const yearMonths = buildYearMonthRange(endMonth, monthsBack);

  return getCategoryRollup(ctx, workspace, yearMonths);
}

async function executeListBankAccountsTool(
  ctx: QueryCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined
): Promise<BankAccountsToolPayload> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const includeClosedRaw = args['includeClosed'];
  if (includeClosedRaw !== undefined && typeof includeClosedRaw !== 'boolean') {
    throw new McpToolError('INVALID_ARGUMENT', 'includeClosed must be a boolean');
  }
  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);
  return listBankAccountsForMcp(ctx, workspace, { includeClosed: includeClosedRaw === true });
}

type ParsedRegularRow = {
  kind: 'regular';
  inputIndex: number;
  bankAccountId: Id<'bankAccount'>;
  input: ChatFileImportInput;
};

type ParsedTransferRow = {
  kind: 'transfer';
  inputIndex: number;
  date: string;
  fromAccountId: Id<'bankAccount'>;
  toAccountId: Id<'bankAccount'>;
  amount: bigint;
  categoryId?: Id<'category'>;
  notes?: string;
};

type ParsedCreateMovement = NonNullable<ChatFileImportInput['movements']>[number];

type ParsedCreateRow = ParsedRegularRow | ParsedTransferRow;

function parseCreateAmount(rawValue: unknown, fieldPath: string, minorUnit: number): bigint {
  if (typeof rawValue !== 'string') {
    throw new McpToolError('INVALID_ARGUMENT', `${fieldPath} must be a decimal string in the workspace currency`);
  }

  let amount: bigint;
  try {
    amount = parseDecimalToBigIntMinorUnits(rawValue, minorUnit);
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? `${fieldPath}: ${error.message}`
        : `${fieldPath} must be a decimal string in the workspace currency`;
    throw new McpToolError('INVALID_ARGUMENT', message);
  }

  if (amount < INT64_MIN || amount > INT64_MAX) {
    throw new McpToolError('INVALID_ARGUMENT', `${fieldPath} overflows 64-bit integer range`);
  }

  return amount;
}

function parseCreateMovement(
  rawMovement: unknown,
  transactionIndex: number,
  movementIndex: number,
  minorUnit: number
): ParsedCreateMovement {
  const fieldPath = `transactions[${transactionIndex}].movements[${movementIndex}]`;
  if (!isRecord(rawMovement)) {
    throw new McpToolError('INVALID_ARGUMENT', `${fieldPath} must be an object`);
  }

  const amount = parseCreateAmount(rawMovement['amount'], `${fieldPath}.amount`, minorUnit);
  if (amount === 0n) {
    throw new McpToolError('INVALID_ARGUMENT', `${fieldPath}.amount cannot be zero`);
  }

  const categoryIdRaw = rawMovement['categoryId'];
  if (categoryIdRaw !== undefined && typeof categoryIdRaw !== 'string') {
    throw new McpToolError('INVALID_ARGUMENT', `${fieldPath}.categoryId must be a string when provided`);
  }

  const readyToAssignRaw = rawMovement['readyToAssign'];
  if (readyToAssignRaw !== undefined && typeof readyToAssignRaw !== 'boolean') {
    throw new McpToolError('INVALID_ARGUMENT', `${fieldPath}.readyToAssign must be a boolean when provided`);
  }
  if (readyToAssignRaw === true && categoryIdRaw !== undefined) {
    throw new McpToolError('INVALID_ARGUMENT', `${fieldPath} cannot have both categoryId and readyToAssign=true`);
  }

  const notesRaw = rawMovement['notes'];
  if (notesRaw !== undefined && typeof notesRaw !== 'string') {
    throw new McpToolError('INVALID_ARGUMENT', `${fieldPath}.notes must be a string when provided`);
  }

  return {
    amount,
    categoryId: categoryIdRaw as Id<'category'> | undefined,
    readyToAssign: readyToAssignRaw,
    notes: notesRaw,
  };
}

/**
 * Parse the `kualia_create_transactions` payload (JSON-decoded). Each row is either a regular
 * transaction (existing semantics: dedup + categorization fallback + needs_review) or a transfer
 * pair. Throws McpToolError on any shape issue so the agent gets a structured failure it can
 * recover from instead of an opaque internal error. Account ownership is verified inside the
 * downstream mutations.
 */
export function parseCreateTransactionsArgs(
  args: Record<string, unknown>,
  minorUnit: number,
  defaultDate: string
): {
  defaultBankAccountId: Id<'bankAccount'> | undefined;
  rows: ParsedCreateRow[];
  forceInsert: boolean;
} {
  const bankAccountIdRaw = args['bankAccountId'];
  if (bankAccountIdRaw !== undefined && (typeof bankAccountIdRaw !== 'string' || bankAccountIdRaw.length === 0)) {
    throw new McpToolError('INVALID_ARGUMENT', 'bankAccountId must be a non-empty string when provided');
  }
  const defaultBankAccountId = (bankAccountIdRaw as Id<'bankAccount'> | undefined) ?? undefined;

  const forceInsertRaw = args['forceInsert'];
  if (forceInsertRaw !== undefined && typeof forceInsertRaw !== 'boolean') {
    throw new McpToolError('INVALID_ARGUMENT', 'forceInsert must be a boolean when provided');
  }
  const forceInsert = forceInsertRaw === true;

  const transactionsRaw = args['transactions'];
  if (!Array.isArray(transactionsRaw)) {
    throw new McpToolError('INVALID_ARGUMENT', 'transactions must be an array');
  }
  if (transactionsRaw.length === 0) {
    throw new McpToolError('INVALID_ARGUMENT', 'transactions must contain at least one item');
  }
  if (transactionsRaw.length > 200) {
    throw new McpToolError('INVALID_ARGUMENT', 'transactions cannot contain more than 200 items per call');
  }

  const rows: ParsedCreateRow[] = transactionsRaw.map((row, index): ParsedCreateRow => {
    if (!isRecord(row)) {
      throw new McpToolError('INVALID_ARGUMENT', `transactions[${index}] must be an object`);
    }
    const dateRaw = row['date'];
    let date: string;
    if (dateRaw === undefined) {
      // Default to today in the workspace timezone — the executor computes this from the resolved
      // workspace doc so we don't accidentally pick UTC.
      date = defaultDate;
    } else if (typeof dateRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
      date = dateRaw;
    } else {
      throw new McpToolError('INVALID_ARGUMENT', `transactions[${index}].date must be in YYYY-MM-DD format`);
    }
    const typeRaw = row['type'];
    if (typeRaw !== undefined && typeRaw !== 'regular' && typeRaw !== 'transfer') {
      throw new McpToolError('INVALID_ARGUMENT', `transactions[${index}].type must be 'regular' or 'transfer'`);
    }
    const rowType: 'regular' | 'transfer' = (typeRaw as 'regular' | 'transfer' | undefined) ?? 'regular';

    const categoryIdRaw = row['categoryId'];
    if (categoryIdRaw !== undefined && typeof categoryIdRaw !== 'string') {
      throw new McpToolError('INVALID_ARGUMENT', `transactions[${index}].categoryId must be a string when provided`);
    }
    const readyToAssignRaw = row['readyToAssign'];
    if (readyToAssignRaw !== undefined && typeof readyToAssignRaw !== 'boolean') {
      throw new McpToolError(
        'INVALID_ARGUMENT',
        `transactions[${index}].readyToAssign must be a boolean when provided`
      );
    }
    if (readyToAssignRaw === true && categoryIdRaw !== undefined) {
      throw new McpToolError(
        'INVALID_ARGUMENT',
        `transactions[${index}] cannot have both categoryId and readyToAssign=true`
      );
    }
    const notesRaw = row['notes'];
    if (notesRaw !== undefined && typeof notesRaw !== 'string') {
      throw new McpToolError('INVALID_ARGUMENT', `transactions[${index}].notes must be a string when provided`);
    }

    if (rowType === 'transfer') {
      if (row['movements'] !== undefined) {
        throw new McpToolError('INVALID_ARGUMENT', `transactions[${index}].movements is not allowed on transfer rows`);
      }
      if (readyToAssignRaw !== undefined) {
        throw new McpToolError(
          'INVALID_ARGUMENT',
          `transactions[${index}].readyToAssign is not allowed on transfer rows`
        );
      }
      const amountBigint = parseCreateAmount(row['amount'], `transactions[${index}].amount`, minorUnit);
      if (amountBigint <= 0n) {
        throw new McpToolError(
          'INVALID_ARGUMENT',
          `transactions[${index}].amount must be positive for a transfer row (the magnitude of the money moved)`
        );
      }
      const fromAccountIdRaw = row['fromAccountId'];
      const toAccountIdRaw = row['toAccountId'];
      if (typeof fromAccountIdRaw !== 'string' || fromAccountIdRaw.length === 0) {
        throw new McpToolError(
          'INVALID_ARGUMENT',
          `transactions[${index}].fromAccountId is required for transfer rows`
        );
      }
      if (typeof toAccountIdRaw !== 'string' || toAccountIdRaw.length === 0) {
        throw new McpToolError('INVALID_ARGUMENT', `transactions[${index}].toAccountId is required for transfer rows`);
      }
      if (fromAccountIdRaw === toAccountIdRaw) {
        throw new McpToolError('INVALID_ARGUMENT', `transactions[${index}].fromAccountId and toAccountId must differ`);
      }
      if (row['merchantName'] !== undefined) {
        throw new McpToolError(
          'INVALID_ARGUMENT',
          `transactions[${index}].merchantName is not allowed on transfer rows (transfers have no merchant)`
        );
      }
      return {
        kind: 'transfer',
        inputIndex: index,
        date,
        fromAccountId: fromAccountIdRaw as Id<'bankAccount'>,
        toAccountId: toAccountIdRaw as Id<'bankAccount'>,
        amount: amountBigint,
        categoryId: categoryIdRaw as Id<'category'> | undefined,
        notes: notesRaw,
      };
    }

    // Regular row.
    const merchantName = row['merchantName'];
    if (typeof merchantName !== 'string' || merchantName.trim().length === 0) {
      throw new McpToolError('INVALID_ARGUMENT', `transactions[${index}].merchantName is required for regular rows`);
    }
    const rowBankAccountIdRaw = row['bankAccountId'];
    if (rowBankAccountIdRaw !== undefined && typeof rowBankAccountIdRaw !== 'string') {
      throw new McpToolError('INVALID_ARGUMENT', `transactions[${index}].bankAccountId must be a string when provided`);
    }
    const effectiveBankAccountId = (rowBankAccountIdRaw as Id<'bankAccount'> | undefined) ?? defaultBankAccountId;
    if (!effectiveBankAccountId) {
      throw new McpToolError(
        'INVALID_ARGUMENT',
        `transactions[${index}] is a regular row but no bankAccountId was provided (either per-row or top-level)`
      );
    }

    const movementsRaw = row['movements'];
    const amountRaw = row['amount'];
    if (
      movementsRaw !== undefined &&
      (amountRaw !== undefined || categoryIdRaw !== undefined || readyToAssignRaw !== undefined)
    ) {
      throw new McpToolError(
        'INVALID_ARGUMENT',
        `transactions[${index}] cannot combine \`movements\` with \`amount\`, \`categoryId\`, or \`readyToAssign\` shortcuts`
      );
    }

    if (movementsRaw !== undefined) {
      if (!Array.isArray(movementsRaw) || movementsRaw.length === 0) {
        throw new McpToolError('INVALID_ARGUMENT', `transactions[${index}].movements must be a non-empty array`);
      }

      const movements = movementsRaw.map((movement, movementIndex) =>
        parseCreateMovement(movement, index, movementIndex, minorUnit)
      );
      const totalAmount = movements.reduce((sum, movement) => sum + movement.amount, 0n);
      if (totalAmount === 0n) {
        throw new McpToolError(
          'INVALID_ARGUMENT',
          `transactions[${index}].movements must sum to a non-zero transaction amount`
        );
      }

      return {
        kind: 'regular',
        inputIndex: index,
        bankAccountId: effectiveBankAccountId,
        input: {
          date,
          amount: totalAmount,
          merchantName: merchantName.trim(),
          notes: notesRaw,
          movements,
        },
      };
    }

    const amountBigint = parseCreateAmount(amountRaw, `transactions[${index}].amount`, minorUnit);
    if (amountBigint === 0n) {
      throw new McpToolError('INVALID_ARGUMENT', `transactions[${index}].amount cannot be zero`);
    }

    return {
      kind: 'regular',
      inputIndex: index,
      bankAccountId: effectiveBankAccountId,
      input: {
        date,
        amount: amountBigint,
        merchantName: merchantName.trim(),
        categoryId: readyToAssignRaw === true ? undefined : (categoryIdRaw as Id<'category'> | undefined),
        movements:
          readyToAssignRaw === true
            ? [
                {
                  amount: amountBigint,
                  readyToAssign: true,
                },
              ]
            : undefined,
        notes: notesRaw,
      },
    };
  });

  return { defaultBankAccountId, rows, forceInsert };
}

type CreatedRegular = {
  kind: 'regular';
  inputIndex: number;
  transactionId: Id<'transaction'>;
  url: string;
  date: string;
  amount: bigint;
  merchantName: string;
  categoryId: Id<'category'> | null;
  movements: ChatFileImportCreatedMovement[];
  movementCount: number;
  matchType: string;
};

type CreatedTransfer = {
  kind: 'transfer';
  inputIndex: number;
  fromTransactionId: Id<'transaction'>;
  toTransactionId: Id<'transaction'>;
  fromUrl: string;
  toUrl: string;
  date: string;
  amount: bigint;
};

type SkippedRegular = {
  kind: 'regular';
  inputIndex: number;
  reason: string;
  matchedTransactionId?: Id<'transaction'>;
  confidence?: number;
};

type FailedRow = {
  inputIndex: number;
  reason: string;
};

type CreateTransactionsPayload = McpAmountMetadata & {
  workspaceId: Id<'workspace'>;
  currency: string;
  created: Array<CreatedRegular | CreatedTransfer>;
  skipped: SkippedRegular[];
  failed: FailedRow[];
};

async function executeCreateTransactionsTool(
  ctx: ActionCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined,
  attribution: ActivityAttribution
): Promise<CreateTransactionsPayload> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);

  // Workspace + ownership are verified through an internal query so the action stays serverless.
  // Resolve before parsing transaction amounts so we know how many fractional digits the
  // currency supports (e.g. USD=2, JPY=0, KWD=3).
  const ownership = await ctx.runQuery(internal.workspaces.resolveWorkspaceForChatTool, {
    clerkId,
    activeWorkspaceId,
    requestedWorkspaceId,
  });
  if (!ownership.ok) {
    throw new McpToolError(ownership.code, ownership.message);
  }

  const amountMetadata = resolveMcpAmountMetadata(ownership.currency);
  const todayInWorkspaceTimezone = getCurrentDateForTimezone(ownership.timezone);
  const { rows, forceInsert } = parseCreateTransactionsArgs(args, amountMetadata.minorUnit, todayInWorkspaceTimezone);

  const created: Array<CreatedRegular | CreatedTransfer> = [];
  const skipped: SkippedRegular[] = [];
  const failed: FailedRow[] = [];

  // Group regular rows by bank account so we can preserve the existing batched import semantics
  // (one matchingCache + one balance update per account).
  const regularRowsByAccount = new Map<Id<'bankAccount'>, ParsedRegularRow[]>();
  const transferRows: ParsedTransferRow[] = [];
  for (const row of rows) {
    if (row.kind === 'regular') {
      const bucket = regularRowsByAccount.get(row.bankAccountId) ?? [];
      bucket.push(row);
      regularRowsByAccount.set(row.bankAccountId, bucket);
    } else {
      transferRows.push(row);
    }
  }

  for (const [bankAccountId, rowsForAccount] of regularRowsByAccount) {
    const result: ChatFileImportResult = await ctx.runAction(
      internal.transactionImport.processChatFileImport.processChatFileImport,
      {
        workspaceId: ownership.workspaceId,
        bankAccountId,
        transactions: rowsForAccount.map((r) => r.input),
        forceInsert,
        attribution,
      }
    );

    // Translate the per-batch indices back into the original `transactions[]` indices.
    const mapBatchIndex = (batchIndex: number): number => rowsForAccount[batchIndex].inputIndex;

    for (const row of result.created) {
      created.push({
        kind: 'regular',
        inputIndex: mapBatchIndex(row.inputIndex),
        transactionId: row.transactionId,
        url: buildTransactionUrl(ownership.workspaceId, row.transactionId),
        date: row.date,
        amount: row.amount,
        merchantName: row.merchantName,
        categoryId: row.categoryId,
        movements: row.movements,
        movementCount: row.movements.length,
        matchType: row.matchType,
      });
    }
    for (const row of result.skipped) {
      skipped.push({
        kind: 'regular',
        inputIndex: mapBatchIndex(row.inputIndex),
        reason: row.reason,
        matchedTransactionId: row.matchedTransactionId,
        confidence: row.confidence,
      });
    }
    for (const row of result.failed) {
      failed.push({ inputIndex: mapBatchIndex(row.inputIndex), reason: row.reason });
    }
  }

  for (const transfer of transferRows) {
    try {
      const result = await ctx.runMutation(internal.transactions.createTransferForMcp, {
        workspaceId: ownership.workspaceId,
        fromAccountId: transfer.fromAccountId,
        toAccountId: transfer.toAccountId,
        amount: transfer.amount,
        date: transfer.date,
        notes: transfer.notes,
        categoryId: transfer.categoryId,
        attribution,
      });
      created.push({
        kind: 'transfer',
        inputIndex: transfer.inputIndex,
        fromTransactionId: result.fromTransactionId,
        toTransactionId: result.toTransactionId,
        fromUrl: buildTransactionUrl(ownership.workspaceId, result.fromTransactionId),
        toUrl: buildTransactionUrl(ownership.workspaceId, result.toTransactionId),
        date: transfer.date,
        amount: transfer.amount,
      });
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : 'Unknown error creating transfer';
      failed.push({ inputIndex: transfer.inputIndex, reason });
    }
  }

  // Sort merged outputs back into input order so the agent can pair with its source rows.
  created.sort((a, b) => a.inputIndex - b.inputIndex);
  skipped.sort((a, b) => a.inputIndex - b.inputIndex);
  failed.sort((a, b) => a.inputIndex - b.inputIndex);

  return {
    workspaceId: ownership.workspaceId,
    currency: ownership.currency,
    ...amountMetadata,
    created,
    skipped,
    failed,
  };
}

async function executeExportWorkspaceDataTool(
  ctx: ActionCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined
): Promise<WorkspaceExportResult> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const ownership = await ctx.runQuery(internal.workspaces.resolveWorkspaceForChatTool, {
    clerkId,
    activeWorkspaceId,
    requestedWorkspaceId,
  });
  if (!ownership.ok) {
    throw new McpToolError(ownership.code, ownership.message);
  }

  return createWorkspaceExportForClerk(ctx, {
    workspaceId: ownership.workspaceId,
    clerkId,
    source: 'mcp',
  });
}

type UpdateTransactionsPayload = McpAmountMetadata & {
  workspaceId: Id<'workspace'>;
  currency: string;
  updated: Array<{ transactionId: Id<'transaction'>; url: string }>;
  notFound: string[];
  failed: Array<{ transactionId: string; message: string }>;
};

/**
 * Parse and run `kualia_update_transactions`. Resolves the `merchantName` shortcut to a real
 * merchant id (lookup-or-create) and expands the `categoryId`/`amount` shortcut into a full
 * single-movement `movements` array. The downstream mutation re-validates ownership per row.
 */
async function executeUpdateTransactionsTool(
  ctx: MutationCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined,
  attribution: ActivityAttribution
): Promise<UpdateTransactionsPayload> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);
  const amountMetadata = resolveMcpAmountMetadata(workspace.currency);
  const minorUnit = amountMetadata.minorUnit;

  const updatesRaw = args['updates'];
  if (!Array.isArray(updatesRaw)) {
    throw new McpToolError('INVALID_ARGUMENT', 'updates must be an array');
  }
  if (updatesRaw.length === 0) {
    throw new McpToolError('INVALID_ARGUMENT', 'updates must contain at least one item');
  }
  if (updatesRaw.length > 200) {
    throw new McpToolError('INVALID_ARGUMENT', 'updates cannot contain more than 200 items per call');
  }

  type PreparedUpdate = {
    transactionId: string;
    type?: 'regular' | 'transfer' | 'starting_balance' | 'balance_adjustment';
    date?: string;
    merchantId?: Id<'merchant'> | null;
    notes?: string | null;
    bankAccountId?: Id<'bankAccount'>;
    movements?: Array<{
      amount: bigint;
      categoryId?: Id<'category'>;
      readyToAssign?: boolean;
      notes?: string;
    }>;
    fromAccountId?: Id<'bankAccount'>;
    toAccountId?: Id<'bankAccount'>;
    status?: 'pending' | 'cleared';
    reviewStatus?: 'reviewed' | 'needs_review';
  };

  const prepared: PreparedUpdate[] = [];
  const preparedFailed: Array<{ transactionId: string; message: string }> = [];

  for (let i = 0; i < updatesRaw.length; i++) {
    const row = updatesRaw[i];
    if (!isRecord(row)) {
      throw new McpToolError('INVALID_ARGUMENT', `updates[${i}] must be an object`);
    }
    const transactionIdRaw = row['transactionId'];
    if (typeof transactionIdRaw !== 'string' || transactionIdRaw.length === 0) {
      throw new McpToolError('INVALID_ARGUMENT', `updates[${i}].transactionId is required`);
    }

    try {
      const update: PreparedUpdate = { transactionId: transactionIdRaw };

      if (row['type'] !== undefined) {
        if (row['type'] !== 'regular' && row['type'] !== 'transfer') {
          throw new McpToolError('INVALID_ARGUMENT', `updates[${i}].type must be 'regular' or 'transfer'`);
        }
        update.type = row['type'] as 'regular' | 'transfer';
      }

      if (row['date'] !== undefined) {
        if (typeof row['date'] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row['date'])) {
          throw new McpToolError('INVALID_ARGUMENT', `updates[${i}].date must be in YYYY-MM-DD format`);
        }
        update.date = row['date'];
      }

      if (row['notes'] !== undefined) {
        if (row['notes'] === null || typeof row['notes'] === 'string') {
          update.notes = row['notes'];
        } else {
          throw new McpToolError('INVALID_ARGUMENT', `updates[${i}].notes must be a string or null`);
        }
      }

      if (row['status'] !== undefined) {
        if (row['status'] !== 'pending' && row['status'] !== 'cleared') {
          throw new McpToolError('INVALID_ARGUMENT', `updates[${i}].status must be 'pending' or 'cleared'`);
        }
        update.status = row['status'] as 'pending' | 'cleared';
      }

      if (row['reviewStatus'] !== undefined) {
        if (row['reviewStatus'] !== 'reviewed' && row['reviewStatus'] !== 'needs_review') {
          throw new McpToolError('INVALID_ARGUMENT', `updates[${i}].reviewStatus must be 'reviewed' or 'needs_review'`);
        }
        update.reviewStatus = row['reviewStatus'] as 'reviewed' | 'needs_review';
      }

      if (row['bankAccountId'] !== undefined) {
        if (typeof row['bankAccountId'] !== 'string') {
          throw new McpToolError('INVALID_ARGUMENT', `updates[${i}].bankAccountId must be a string`);
        }
        update.bankAccountId = row['bankAccountId'] as Id<'bankAccount'>;
      }

      if (row['fromAccountId'] !== undefined) {
        if (typeof row['fromAccountId'] !== 'string') {
          throw new McpToolError('INVALID_ARGUMENT', `updates[${i}].fromAccountId must be a string`);
        }
        update.fromAccountId = row['fromAccountId'] as Id<'bankAccount'>;
      }

      if (row['toAccountId'] !== undefined) {
        if (typeof row['toAccountId'] !== 'string') {
          throw new McpToolError('INVALID_ARGUMENT', `updates[${i}].toAccountId must be a string`);
        }
        update.toAccountId = row['toAccountId'] as Id<'bankAccount'>;
      }

      // movements / amount / categoryId shortcuts.
      const movementsRaw = row['movements'];
      const amountRaw = row['amount'];
      const categoryIdRaw = row['categoryId'];

      if (movementsRaw !== undefined && (amountRaw !== undefined || categoryIdRaw !== undefined)) {
        throw new McpToolError(
          'INVALID_ARGUMENT',
          `updates[${i}] cannot combine \`movements\` with \`amount\` or \`categoryId\` shortcuts`
        );
      }

      if (movementsRaw !== undefined) {
        if (!Array.isArray(movementsRaw) || movementsRaw.length === 0) {
          throw new McpToolError('INVALID_ARGUMENT', `updates[${i}].movements must be a non-empty array`);
        }
        update.movements = movementsRaw.map((m, j) => {
          if (!isRecord(m)) {
            throw new McpToolError('INVALID_ARGUMENT', `updates[${i}].movements[${j}] must be an object`);
          }
          if (typeof m['amount'] !== 'string') {
            throw new McpToolError(
              'INVALID_ARGUMENT',
              `updates[${i}].movements[${j}].amount must be a signed decimal string`
            );
          }
          let mAmount: bigint;
          try {
            mAmount = parseDecimalToBigIntMinorUnits(m['amount'], minorUnit);
          } catch (error: unknown) {
            const message =
              error instanceof Error
                ? `updates[${i}].movements[${j}].amount: ${error.message}`
                : `updates[${i}].movements[${j}].amount must be a signed decimal string`;
            throw new McpToolError('INVALID_ARGUMENT', message);
          }
          if (mAmount < INT64_MIN || mAmount > INT64_MAX) {
            throw new McpToolError(
              'INVALID_ARGUMENT',
              `updates[${i}].movements[${j}].amount overflows 64-bit integer range`
            );
          }
          if (m['categoryId'] !== undefined && typeof m['categoryId'] !== 'string') {
            throw new McpToolError('INVALID_ARGUMENT', `updates[${i}].movements[${j}].categoryId must be a string`);
          }
          if (m['notes'] !== undefined && typeof m['notes'] !== 'string') {
            throw new McpToolError('INVALID_ARGUMENT', `updates[${i}].movements[${j}].notes must be a string`);
          }
          return {
            amount: mAmount,
            categoryId: m['categoryId'] as Id<'category'> | undefined,
            notes: m['notes'] as string | undefined,
          };
        });
      } else if (amountRaw !== undefined || categoryIdRaw !== undefined) {
        // Build a single-movement override using the existing transaction's other side.
        const existing = await ctx.db.get(transactionIdRaw as Id<'transaction'>).catch(() => null);
        if (!existing || existing.isDeleted || existing.workspaceId !== workspace._id) {
          throw new McpToolError(
            'NOT_FOUND',
            `updates[${i}] references a transaction that was not found in this workspace`
          );
        }
        const existingMovements = existing.movements ?? [];
        if (existingMovements.length > 1) {
          throw new McpToolError(
            'INVALID_ARGUMENT',
            `updates[${i}] uses the categoryId/amount shortcut but the transaction has ${existingMovements.length} movements — pass a full \`movements\` array instead`
          );
        }
        let newAmount = existingMovements[0]?.amount ?? 0n;
        if (amountRaw !== undefined) {
          if (typeof amountRaw !== 'string') {
            throw new McpToolError('INVALID_ARGUMENT', `updates[${i}].amount must be a signed decimal string`);
          }
          try {
            newAmount = parseDecimalToBigIntMinorUnits(amountRaw, minorUnit);
          } catch (error: unknown) {
            const message =
              error instanceof Error
                ? `updates[${i}].amount: ${error.message}`
                : `updates[${i}].amount must be a signed decimal string`;
            throw new McpToolError('INVALID_ARGUMENT', message);
          }
          if (newAmount === 0n) {
            throw new McpToolError('INVALID_ARGUMENT', `updates[${i}].amount cannot be zero`);
          }
          if (newAmount < INT64_MIN || newAmount > INT64_MAX) {
            throw new McpToolError('INVALID_ARGUMENT', `updates[${i}].amount overflows 64-bit integer range`);
          }
        }
        let newCategoryId: Id<'category'> | undefined = existingMovements[0]?.categoryId ?? undefined;
        if (categoryIdRaw !== undefined) {
          if (typeof categoryIdRaw !== 'string') {
            throw new McpToolError('INVALID_ARGUMENT', `updates[${i}].categoryId must be a string`);
          }
          newCategoryId = categoryIdRaw as Id<'category'>;
        }
        update.movements = [
          {
            amount: newAmount,
            categoryId: newCategoryId,
            readyToAssign: existingMovements[0]?.readyToAssign ?? false,
            notes: existingMovements[0]?.notes,
          },
        ];
      }

      // Resolve merchantName → merchantId (lookup-or-create). null clears the merchant.
      if (row['merchantName'] !== undefined) {
        if (row['merchantName'] === null) {
          update.merchantId = null;
        } else if (typeof row['merchantName'] === 'string') {
          const trimmed = row['merchantName'].trim();
          if (trimmed.length === 0) {
            update.merchantId = null;
          } else {
            update.merchantId = await getOrCreateMerchantByName(ctx, workspace._id, trimmed);
          }
        } else {
          throw new McpToolError('INVALID_ARGUMENT', `updates[${i}].merchantName must be a string or null`);
        }
      }

      prepared.push(update);
    } catch (error: unknown) {
      if (error instanceof McpToolError && error.code !== 'NOT_FOUND') {
        // Validation errors abort the whole batch (matches single-mode behavior).
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      preparedFailed.push({ transactionId: transactionIdRaw, message });
    }
  }

  const result = await ctx.runMutation(internal.transactions.updateTransactionsForMcp, {
    workspaceId: workspace._id,
    updates: prepared,
    attribution,
  });

  return {
    workspaceId: workspace._id,
    currency: workspace.currency ?? 'USD',
    ...amountMetadata,
    updated: result.updated.map((transactionId) => ({
      transactionId,
      url: buildTransactionUrl(workspace._id, transactionId),
    })),
    notFound: result.notFound,
    failed: [...preparedFailed, ...result.failed],
  };
}

async function executeDeleteTransactionsTool(
  ctx: MutationCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined,
  attribution: ActivityAttribution
): Promise<{
  workspaceId: Id<'workspace'>;
  deleted: Id<'transaction'>[];
  notFound: string[];
}> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const idsRaw = args['transactionIds'];
  if (!Array.isArray(idsRaw)) {
    throw new McpToolError('INVALID_ARGUMENT', 'transactionIds must be an array');
  }
  if (idsRaw.length === 0) {
    throw new McpToolError('INVALID_ARGUMENT', 'transactionIds must contain at least one id');
  }
  if (idsRaw.length > 200) {
    throw new McpToolError('INVALID_ARGUMENT', 'transactionIds cannot contain more than 200 ids per call');
  }
  const transactionIds: string[] = [];
  for (let i = 0; i < idsRaw.length; i++) {
    const id = idsRaw[i];
    if (typeof id !== 'string' || id.length === 0) {
      throw new McpToolError('INVALID_ARGUMENT', `transactionIds[${i}] must be a string`);
    }
    transactionIds.push(id);
  }

  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);

  const result = await ctx.runMutation(internal.transactions.softDeleteTransactionsForMcp, {
    workspaceId: workspace._id,
    transactionIds,
    attribution,
  });

  return {
    workspaceId: workspace._id,
    deleted: result.deleted,
    notFound: result.notFound,
  };
}

async function executeRestoreTransactionsTool(
  ctx: MutationCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined,
  attribution: ActivityAttribution
): Promise<{
  workspaceId: Id<'workspace'>;
  restored: Id<'transaction'>[];
  notFound: string[];
}> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const idsRaw = args['transactionIds'];
  if (!Array.isArray(idsRaw)) {
    throw new McpToolError('INVALID_ARGUMENT', 'transactionIds must be an array');
  }
  if (idsRaw.length === 0) {
    throw new McpToolError('INVALID_ARGUMENT', 'transactionIds must contain at least one id');
  }
  if (idsRaw.length > 200) {
    throw new McpToolError('INVALID_ARGUMENT', 'transactionIds cannot contain more than 200 ids per call');
  }
  const transactionIds: string[] = [];
  for (let i = 0; i < idsRaw.length; i++) {
    const id = idsRaw[i];
    if (typeof id !== 'string' || id.length === 0) {
      throw new McpToolError('INVALID_ARGUMENT', `transactionIds[${i}] must be a string`);
    }
    transactionIds.push(id);
  }

  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);

  const result = await ctx.runMutation(internal.transactions.restoreTransactionsForMcp, {
    workspaceId: workspace._id,
    transactionIds,
    attribution,
  });

  return {
    workspaceId: workspace._id,
    restored: result.restored,
    notFound: result.notFound,
  };
}

async function executeReconcileBankAccountTool(
  ctx: MutationCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined,
  attribution: ActivityAttribution
): Promise<
  McpAmountMetadata & {
    workspaceId: Id<'workspace'>;
    currency: string;
    bankAccountId: Id<'bankAccount'>;
    reconciliationDate: string;
    reportedBalance: bigint;
    clearedBalanceBefore: bigint;
    balanceAdjustmentAmount: bigint;
    adjustmentCreated: boolean;
    balanceAdjustmentTransactionId: Id<'transaction'> | null;
    balanceAdjustmentTransactionUrl: string | null;
    reconciledTransactionCount: number;
    reconciledAt: string;
  }
> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);
  const amountMetadata = resolveMcpAmountMetadata(workspace.currency);
  const parsed = parseReconcileBankAccountArgs(args, amountMetadata.minorUnit);

  const result = await ctx.runMutation(internal.bankAccounts.reconcileBankAccountForMcp, {
    workspaceId: workspace._id,
    bankAccountId: parsed.bankAccountId,
    reportedBalance: parsed.reportedBalance,
    reconciliationDate: parsed.reconciliationDate,
    attribution,
  });

  return {
    workspaceId: workspace._id,
    currency: workspace.currency ?? 'USD',
    ...amountMetadata,
    bankAccountId: parsed.bankAccountId,
    reconciliationDate: parsed.reconciliationDate,
    reportedBalance: result.reportedBalance,
    clearedBalanceBefore: result.clearedBalanceBefore,
    balanceAdjustmentAmount: result.balanceAdjustmentAmount,
    adjustmentCreated: result.adjustmentCreated,
    balanceAdjustmentTransactionId: result.balanceAdjustmentTransactionId,
    balanceAdjustmentTransactionUrl:
      result.balanceAdjustmentTransactionId === null
        ? null
        : buildTransactionUrl(workspace._id, result.balanceAdjustmentTransactionId),
    reconciledTransactionCount: result.reconciledTransactionCount,
    reconciledAt: result.reconciledAt,
  };
}

async function executeCreateBankAccountTool(
  ctx: MutationCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined,
  attribution: ActivityAttribution
): Promise<Record<string, unknown>> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);
  const amountMetadata = resolveMcpAmountMetadata(workspace.currency);
  const parsed = parseCreateBankAccountArgs(args, amountMetadata.minorUnit);

  const bankAccountId = await ctx.runMutation(internal.bankAccounts.createBankAccountForMcp, {
    workspaceId: workspace._id,
    name: parsed.name,
    accountType: parsed.accountType,
    initialBalance: parsed.initialBalance,
    initialBalanceDate: parsed.initialBalanceDate,
    attribution,
  });

  const account = await ctx.db.get(bankAccountId);

  return {
    workspaceId: workspace._id,
    currency: workspace.currency ?? 'USD',
    ...amountMetadata,
    bankAccountId,
    name: account?.name ?? parsed.name,
    accountType: parsed.accountType,
    isOnBudget: isOnBudgetAccountType(parsed.accountType),
    currentBalance: account?.currentBalance ?? 0n,
    isClosed: account?.isClosed ?? false,
  };
}

async function executeCloseBankAccountTool(
  ctx: MutationCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined,
  attribution: ActivityAttribution
): Promise<Record<string, unknown>> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);

  const bankAccountIdRaw = args['bankAccountId'];
  if (typeof bankAccountIdRaw !== 'string' || bankAccountIdRaw.length === 0) {
    throw new McpToolError('INVALID_ARGUMENT', 'bankAccountId must be a non-empty string');
  }
  const bankAccountId = bankAccountIdRaw as Id<'bankAccount'>;

  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);

  await ctx.runMutation(internal.bankAccounts.closeBankAccountForMcp, {
    workspaceId: workspace._id,
    bankAccountId,
    attribution,
  });

  const account = await ctx.db.get(bankAccountId);

  return {
    workspaceId: workspace._id,
    bankAccountId,
    isClosed: account?.isClosed ?? true,
    closedAt: account?.closedAt ?? null,
  };
}

async function executeDeleteBankAccountTool(
  ctx: MutationCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined,
  attribution: ActivityAttribution
): Promise<Record<string, unknown>> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);

  const bankAccountIdRaw = args['bankAccountId'];
  if (typeof bankAccountIdRaw !== 'string' || bankAccountIdRaw.length === 0) {
    throw new McpToolError('INVALID_ARGUMENT', 'bankAccountId must be a non-empty string');
  }
  const bankAccountId = bankAccountIdRaw as Id<'bankAccount'>;

  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);

  // Validate the account exists in this workspace and has no transactions before
  // attempting the delete, so the agent gets an actionable message (close instead
  // of delete) rather than a generic mutation failure.
  const account = await ctx.db.get(bankAccountId);
  if (!account || account.workspaceId !== workspace._id || account.isDeleted) {
    throw new McpToolError('NOT_FOUND', 'Bank account not found or does not belong to workspace');
  }

  const existingTransaction = await ctx.db
    .query('transaction')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspace._id))
    .filter((q) => q.and(q.eq(q.field('bankAccountId'), bankAccountId), q.eq(q.field('isDeleted'), false)))
    .first();

  if (existingTransaction) {
    throw new McpToolError(
      'INVALID_ARGUMENT',
      'Cannot delete a bank account that has transactions. Close it instead with kualia_close_bank_account to preserve history.'
    );
  }

  await ctx.runMutation(internal.bankAccounts.deleteBankAccountForMcp, {
    workspaceId: workspace._id,
    bankAccountId,
    attribution,
  });

  return {
    workspaceId: workspace._id,
    bankAccountId,
    deleted: true,
  };
}

async function executeSetCategoryAssignedAmountTool(
  ctx: MutationCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined,
  attribution: ActivityAttribution
): Promise<McpSetCategoryAssignedAmountToolPayload> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);

  const includesSingleModeFields =
    args['categoryId'] !== undefined || args['yearMonth'] !== undefined || args['assignedAmount'] !== undefined;
  const includesBulkModeField = args['updates'] !== undefined;

  if (includesSingleModeFields && includesBulkModeField) {
    throw new McpToolError(
      'INVALID_ARGUMENT',
      'Provide either categoryId/yearMonth/assignedAmount for single mode or updates for bulk mode, not both'
    );
  }

  const workspaceMinorUnit = resolveMcpAmountMetadata(workspace.currency).minorUnit;

  if (includesBulkModeField) {
    const updates = parseBulkUpdatesArg(args['updates'], workspaceMinorUnit);
    for (const update of updates) {
      await validateCategoryForWorkspace(ctx, workspace._id, update.categoryId);
    }

    const upsertResult = await ctx.runMutation(internal.categoryBudgets.upsertCategoryBudgetsInternal, {
      workspaceId: workspace._id,
      updates,
      attribution,
    });

    const amountMetadata = resolveMcpAmountMetadata(workspace.currency);

    return {
      workspaceId: workspace._id,
      updates: upsertResult.updates,
      totalReadyToAssignDelta: upsertResult.totalReadyToAssignDelta,
      ...amountMetadata,
    };
  }

  const categoryId = parseCategoryId(args['categoryId']);
  const yearMonth = parseRequiredYearMonthArg(args['yearMonth']);
  const assignedAmount = parseRequiredAssignedAmountArg(args['assignedAmount'], workspaceMinorUnit);
  await validateCategoryForWorkspace(ctx, workspace._id, categoryId);

  const upsertResult = await ctx.runMutation(internal.categoryBudgets.upsertCategoryBudgetInternal, {
    workspaceId: workspace._id,
    categoryId,
    yearMonth,
    assignedAmount,
    attribution,
  });

  const amountMetadata = resolveMcpAmountMetadata(workspace.currency);

  return {
    workspaceId: workspace._id,
    categoryId,
    yearMonth,
    previousAssignedAmount: upsertResult.previousAssignedAmount,
    assignedAmount: upsertResult.assignedAmount,
    readyToAssignDelta: upsertResult.readyToAssignDelta,
    createdBudgetRow: upsertResult.createdBudgetRow,
    ...amountMetadata,
  };
}

// ============================================================================
// Category / Category Group / Category Target write tools
// ============================================================================

type McpFailure = { inputIndex: number; code: string; message: string };

function classifyMutationError(error: unknown): { code: string; message: string } {
  if (error instanceof McpToolError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: 'INVALID_ARGUMENT', message: error.message };
  }
  return { code: 'INTERNAL', message: 'Unknown error' };
}

function parseStringField(value: unknown, field: string, index: number): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new McpToolError('INVALID_ARGUMENT', `${field} is required at index ${index} and must be a non-empty string`);
  }
  return value;
}

function parseOptionalString(value: unknown, field: string, index: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new McpToolError('INVALID_ARGUMENT', `${field} at index ${index} must be a string`);
  }
  return value;
}

function parseRequiredInteger(value: unknown, field: string, min?: number, max?: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new McpToolError('INVALID_ARGUMENT', `${field} must be an integer`);
  }
  if (min !== undefined && value < min) {
    throw new McpToolError('INVALID_ARGUMENT', `${field} must be >= ${min}`);
  }
  if (max !== undefined && value > max) {
    throw new McpToolError('INVALID_ARGUMENT', `${field} must be <= ${max}`);
  }
  return value;
}

function parseOptionalInteger(value: unknown, field: string, min?: number, max?: number): number | undefined {
  if (value === undefined) return undefined;
  return parseRequiredInteger(value, field, min, max);
}

function parseOptionalIntegerNullable(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new McpToolError('INVALID_ARGUMENT', `${field} must be an integer or null`);
  }
  return value;
}

function parseRequiredDecimalAmount(value: unknown, field: string, minorUnit: number): number {
  if (typeof value !== 'string') {
    throw new McpToolError('INVALID_ARGUMENT', `${field} is required and must be a decimal string`);
  }
  try {
    const minorUnits = parseDecimalToBigIntMinorUnits(value, minorUnit);
    if (minorUnits < BigInt(Number.MIN_SAFE_INTEGER) || minorUnits > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`${field} exceeds safe numeric range`);
    }
    return Number(minorUnits);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : `${field} must be a valid decimal string`;
    throw new McpToolError('INVALID_ARGUMENT', message);
  }
}

function parseOptionalDecimalAmount(value: unknown, field: string, minorUnit: number): number | undefined {
  if (value === undefined) return undefined;
  return parseRequiredDecimalAmount(value, field, minorUnit);
}

function parseOptionalDecimalAmountNullable(
  value: unknown,
  field: string,
  minorUnit: number
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return parseRequiredDecimalAmount(value, field, minorUnit);
}

async function executeCreateCategoriesTool(
  ctx: MutationCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined,
  attribution: ActivityAttribution
): Promise<{
  workspaceId: Id<'workspace'>;
  created: { inputIndex: number; categoryId: Id<'category'>; name: string }[];
  failed: McpFailure[];
}> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const categoriesRaw = args['categories'];
  if (!Array.isArray(categoriesRaw) || categoriesRaw.length === 0) {
    throw new McpToolError('INVALID_ARGUMENT', 'categories must be a non-empty array');
  }
  if (categoriesRaw.length > 50) {
    throw new McpToolError('INVALID_ARGUMENT', 'categories cannot contain more than 50 items per call');
  }

  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);

  const created: { inputIndex: number; categoryId: Id<'category'>; name: string }[] = [];
  const failed: McpFailure[] = [];

  for (let i = 0; i < categoriesRaw.length; i++) {
    const row = categoriesRaw[i];
    try {
      if (!isRecord(row)) {
        throw new McpToolError('INVALID_ARGUMENT', `categories[${i}] must be an object`);
      }
      const name = parseStringField(row['name'], `categories[${i}].name`, i);
      const categoryGroupIdRaw = parseStringField(row['categoryGroupId'], `categories[${i}].categoryGroupId`, i);
      const iconName = parseOptionalString(row['iconName'], 'iconName', i);

      const categoryId = await ctx.runMutation(internal.categories.createCategoryForMcp, {
        workspaceId: workspace._id,
        name,
        categoryGroupId: categoryGroupIdRaw as Id<'categoryGroup'>,
        attribution,
      });

      if (iconName !== undefined) {
        await ctx.runMutation(internal.categories.updateCategoryForMcp, {
          workspaceId: workspace._id,
          categoryId,
          iconName,
          attribution,
        });
      }

      created.push({ inputIndex: i, categoryId, name });
    } catch (error: unknown) {
      const { code, message } = classifyMutationError(error);
      failed.push({ inputIndex: i, code, message });
    }
  }

  return { workspaceId: workspace._id, created, failed };
}

async function executeUpdateCategoriesTool(
  ctx: MutationCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined,
  attribution: ActivityAttribution
): Promise<{
  workspaceId: Id<'workspace'>;
  updated: { inputIndex: number; categoryId: Id<'category'> }[];
  failed: McpFailure[];
}> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const updatesRaw = args['updates'];
  if (!Array.isArray(updatesRaw) || updatesRaw.length === 0) {
    throw new McpToolError('INVALID_ARGUMENT', 'updates must be a non-empty array');
  }
  if (updatesRaw.length > 50) {
    throw new McpToolError('INVALID_ARGUMENT', 'updates cannot contain more than 50 items per call');
  }

  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);

  const updated: { inputIndex: number; categoryId: Id<'category'> }[] = [];
  const failed: McpFailure[] = [];

  for (let i = 0; i < updatesRaw.length; i++) {
    const row = updatesRaw[i];
    try {
      if (!isRecord(row)) {
        throw new McpToolError('INVALID_ARGUMENT', `updates[${i}] must be an object`);
      }
      const categoryId = parseStringField(row['categoryId'], `updates[${i}].categoryId`, i) as Id<'category'>;
      const name = parseOptionalString(row['name'], 'name', i);
      const categoryGroupIdRaw = parseOptionalString(row['categoryGroupId'], 'categoryGroupId', i);
      const iconName = parseOptionalString(row['iconName'], 'iconName', i);

      await ctx.runMutation(internal.categories.updateCategoryForMcp, {
        workspaceId: workspace._id,
        categoryId,
        name,
        categoryGroupId: categoryGroupIdRaw === undefined ? undefined : (categoryGroupIdRaw as Id<'categoryGroup'>),
        iconName,
        attribution,
      });
      updated.push({ inputIndex: i, categoryId });
    } catch (error: unknown) {
      const { code, message } = classifyMutationError(error);
      failed.push({ inputIndex: i, code, message });
    }
  }

  return { workspaceId: workspace._id, updated, failed };
}

async function executeArchiveCategoriesTool(
  ctx: MutationCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined,
  attribution: ActivityAttribution
): Promise<{ workspaceId: Id<'workspace'>; updatedCount: number; isArchived: boolean }> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const isArchived = args['isArchived'];
  if (typeof isArchived !== 'boolean') {
    throw new McpToolError('INVALID_ARGUMENT', 'isArchived must be a boolean');
  }
  const idsRaw = args['categoryIds'];
  if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
    throw new McpToolError('INVALID_ARGUMENT', 'categoryIds must be a non-empty array');
  }
  if (idsRaw.length > 50) {
    throw new McpToolError('INVALID_ARGUMENT', 'categoryIds cannot contain more than 50 items per call');
  }
  const categoryIds: Id<'category'>[] = [];
  for (let i = 0; i < idsRaw.length; i++) {
    const id = idsRaw[i];
    if (typeof id !== 'string' || id.length === 0) {
      throw new McpToolError('INVALID_ARGUMENT', `categoryIds[${i}] must be a non-empty string`);
    }
    categoryIds.push(id as Id<'category'>);
  }

  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);

  const result = await ctx.runMutation(internal.categories.archiveCategoriesForMcp, {
    workspaceId: workspace._id,
    categoryIds,
    isArchived,
    attribution,
  });

  return { workspaceId: workspace._id, updatedCount: result.updatedCount, isArchived };
}

async function executeDeleteCategoriesTool(
  ctx: MutationCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined,
  attribution: ActivityAttribution
): Promise<Record<string, unknown>> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);

  const idsRaw = args['categoryIds'];
  if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
    throw new McpToolError('INVALID_ARGUMENT', 'categoryIds must be a non-empty array');
  }
  if (idsRaw.length > 50) {
    throw new McpToolError('INVALID_ARGUMENT', 'categoryIds cannot contain more than 50 items per call');
  }
  const categoryIds: Id<'category'>[] = [];
  for (let i = 0; i < idsRaw.length; i++) {
    const id = idsRaw[i];
    if (typeof id !== 'string' || id.length === 0) {
      throw new McpToolError('INVALID_ARGUMENT', `categoryIds[${i}] must be a non-empty string`);
    }
    categoryIds.push(id as Id<'category'>);
  }

  let newCategoryId: Id<'category'> | undefined;
  const newCategoryIdRaw = args['newCategoryId'];
  if (newCategoryIdRaw !== undefined && newCategoryIdRaw !== null) {
    if (typeof newCategoryIdRaw !== 'string' || newCategoryIdRaw.length === 0) {
      throw new McpToolError('INVALID_ARGUMENT', 'newCategoryId must be a non-empty string');
    }
    newCategoryId = newCategoryIdRaw as Id<'category'>;
  }

  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);

  const result = await ctx.runMutation(internal.categories.deleteCategoriesForMcp, {
    workspaceId: workspace._id,
    categoryIds,
    newCategoryId,
    attribution,
  });

  return { workspaceId: workspace._id, ...result };
}

async function executeReorderCategoriesTool(
  ctx: MutationCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined
): Promise<{ workspaceId: Id<'workspace'>; updatedCount: number }> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const groupsRaw = args['groups'];
  if (!Array.isArray(groupsRaw) || groupsRaw.length === 0) {
    throw new McpToolError('INVALID_ARGUMENT', 'groups must be a non-empty array');
  }
  if (groupsRaw.length > 50) {
    throw new McpToolError('INVALID_ARGUMENT', 'groups cannot contain more than 50 entries per call');
  }

  const groups: { categoryGroupId: Id<'categoryGroup'>; orderedCategoryIds: Id<'category'>[] }[] = [];
  for (let i = 0; i < groupsRaw.length; i++) {
    const row = groupsRaw[i];
    if (!isRecord(row)) {
      throw new McpToolError('INVALID_ARGUMENT', `groups[${i}] must be an object`);
    }
    const categoryGroupId = parseStringField(
      row['categoryGroupId'],
      `groups[${i}].categoryGroupId`,
      i
    ) as Id<'categoryGroup'>;
    const orderedRaw = row['orderedCategoryIds'];
    if (!Array.isArray(orderedRaw) || orderedRaw.length === 0) {
      throw new McpToolError('INVALID_ARGUMENT', `groups[${i}].orderedCategoryIds must be a non-empty array`);
    }
    const orderedCategoryIds: Id<'category'>[] = [];
    for (let j = 0; j < orderedRaw.length; j++) {
      const id = orderedRaw[j];
      if (typeof id !== 'string' || id.length === 0) {
        throw new McpToolError('INVALID_ARGUMENT', `groups[${i}].orderedCategoryIds[${j}] must be a non-empty string`);
      }
      orderedCategoryIds.push(id as Id<'category'>);
    }
    groups.push({ categoryGroupId, orderedCategoryIds });
  }

  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);

  const result = await ctx.runMutation(internal.categories.bulkReorderCategoriesForMcp, {
    workspaceId: workspace._id,
    groups,
  });

  return { workspaceId: workspace._id, updatedCount: result.updatedCount };
}

type CategorySortMode =
  | 'name_asc'
  | 'name_desc'
  | 'target_due_date_asc'
  | 'target_due_date_desc'
  | 'created_asc'
  | 'created_desc';

function parseCategorySortMode(value: unknown): CategorySortMode {
  if (
    value === 'name_asc' ||
    value === 'name_desc' ||
    value === 'target_due_date_asc' ||
    value === 'target_due_date_desc' ||
    value === 'created_asc' ||
    value === 'created_desc'
  ) {
    return value;
  }
  throw new McpToolError(
    'INVALID_ARGUMENT',
    "sortBy must be one of 'name_asc', 'name_desc', 'target_due_date_asc', 'target_due_date_desc', 'created_asc', 'created_desc'"
  );
}

async function executeSortCategoriesTool(
  ctx: MutationCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined
): Promise<{ workspaceId: Id<'workspace'>; sortedGroupCount: number; updatedCount: number }> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const sortBy = parseCategorySortMode(args['sortBy']);
  const categoryGroupIdRaw = parseOptionalString(args['categoryGroupId'], 'categoryGroupId', 0);

  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);

  const result = await ctx.runMutation(internal.categories.sortCategoriesForMcp, {
    workspaceId: workspace._id,
    categoryGroupId: categoryGroupIdRaw,
    sortBy,
  });

  return {
    workspaceId: workspace._id,
    sortedGroupCount: result.sortedGroupCount,
    updatedCount: result.updatedCount,
  };
}

type CategoryGroupSortMode = 'name_asc' | 'name_desc' | 'created_asc' | 'created_desc';

function parseCategoryGroupSortMode(value: unknown): CategoryGroupSortMode {
  if (value === 'name_asc' || value === 'name_desc' || value === 'created_asc' || value === 'created_desc') {
    return value;
  }
  throw new McpToolError(
    'INVALID_ARGUMENT',
    "sortBy must be one of 'name_asc', 'name_desc', 'created_asc', 'created_desc'"
  );
}

async function executeSortCategoryGroupsTool(
  ctx: MutationCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined
): Promise<{ workspaceId: Id<'workspace'>; updatedCount: number }> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const sortBy = parseCategoryGroupSortMode(args['sortBy']);

  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);

  const result = await ctx.runMutation(internal.categoryGroups.sortCategoryGroupsForMcp, {
    workspaceId: workspace._id,
    sortBy,
  });

  return { workspaceId: workspace._id, updatedCount: result.updatedCount };
}

async function executeCreateCategoryGroupsTool(
  ctx: MutationCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined
): Promise<{
  workspaceId: Id<'workspace'>;
  created: { inputIndex: number; categoryGroupId: Id<'categoryGroup'>; name: string }[];
  failed: McpFailure[];
}> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const groupsRaw = args['groups'];
  if (!Array.isArray(groupsRaw) || groupsRaw.length === 0) {
    throw new McpToolError('INVALID_ARGUMENT', 'groups must be a non-empty array');
  }
  if (groupsRaw.length > 10) {
    throw new McpToolError('INVALID_ARGUMENT', 'groups cannot contain more than 10 items per call');
  }

  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);

  const created: { inputIndex: number; categoryGroupId: Id<'categoryGroup'>; name: string }[] = [];
  const failed: McpFailure[] = [];

  for (let i = 0; i < groupsRaw.length; i++) {
    const row = groupsRaw[i];
    try {
      if (!isRecord(row)) {
        throw new McpToolError('INVALID_ARGUMENT', `groups[${i}] must be an object`);
      }
      const name = parseStringField(row['name'], `groups[${i}].name`, i);
      const typeRaw = row['type'];
      if (typeRaw !== 'expense' && typeRaw !== 'credit_card') {
        throw new McpToolError('INVALID_ARGUMENT', `groups[${i}].type must be 'expense' or 'credit_card'`);
      }
      const categoryGroupId = await ctx.runMutation(internal.categoryGroups.createCategoryGroupForMcp, {
        workspaceId: workspace._id,
        name,
        type: typeRaw,
      });
      created.push({ inputIndex: i, categoryGroupId, name });
    } catch (error: unknown) {
      const { code, message } = classifyMutationError(error);
      failed.push({ inputIndex: i, code, message });
    }
  }

  return { workspaceId: workspace._id, created, failed };
}

async function executeUpdateCategoryGroupsTool(
  ctx: MutationCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined
): Promise<{
  workspaceId: Id<'workspace'>;
  updated: { inputIndex: number; categoryGroupId: Id<'categoryGroup'> }[];
  failed: McpFailure[];
}> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const updatesRaw = args['updates'];
  if (!Array.isArray(updatesRaw) || updatesRaw.length === 0) {
    throw new McpToolError('INVALID_ARGUMENT', 'updates must be a non-empty array');
  }
  if (updatesRaw.length > 10) {
    throw new McpToolError('INVALID_ARGUMENT', 'updates cannot contain more than 10 items per call');
  }

  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);

  const updated: { inputIndex: number; categoryGroupId: Id<'categoryGroup'> }[] = [];
  const failed: McpFailure[] = [];

  for (let i = 0; i < updatesRaw.length; i++) {
    const row = updatesRaw[i];
    try {
      if (!isRecord(row)) {
        throw new McpToolError('INVALID_ARGUMENT', `updates[${i}] must be an object`);
      }
      const categoryGroupId = parseStringField(
        row['categoryGroupId'],
        `updates[${i}].categoryGroupId`,
        i
      ) as Id<'categoryGroup'>;
      const name = parseOptionalString(row['name'], 'name', i);
      const typeRaw = row['type'];
      let type: 'expense' | undefined;
      if (typeRaw !== undefined) {
        if (typeRaw !== 'expense') {
          throw new McpToolError('INVALID_ARGUMENT', `updates[${i}].type must be 'expense'`);
        }
        type = 'expense';
      }
      await ctx.runMutation(internal.categoryGroups.updateCategoryGroupForMcp, {
        workspaceId: workspace._id,
        categoryGroupId,
        name,
        type,
      });
      updated.push({ inputIndex: i, categoryGroupId });
    } catch (error: unknown) {
      const { code, message } = classifyMutationError(error);
      failed.push({ inputIndex: i, code, message });
    }
  }

  return { workspaceId: workspace._id, updated, failed };
}

async function executeArchiveCategoryGroupsTool(
  ctx: MutationCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined
): Promise<{
  workspaceId: Id<'workspace'>;
  archived: Id<'categoryGroup'>[];
  restored: Id<'categoryGroup'>[];
  failed: McpFailure[];
  isArchived: boolean;
}> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const isArchived = args['isArchived'];
  if (typeof isArchived !== 'boolean') {
    throw new McpToolError('INVALID_ARGUMENT', 'isArchived must be a boolean');
  }
  const idsRaw = args['categoryGroupIds'];
  if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
    throw new McpToolError('INVALID_ARGUMENT', 'categoryGroupIds must be a non-empty array');
  }
  if (idsRaw.length > 10) {
    throw new McpToolError('INVALID_ARGUMENT', 'categoryGroupIds cannot contain more than 10 items per call');
  }

  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);

  const archived: Id<'categoryGroup'>[] = [];
  const restored: Id<'categoryGroup'>[] = [];
  const failed: McpFailure[] = [];

  for (let i = 0; i < idsRaw.length; i++) {
    const idRaw = idsRaw[i];
    try {
      if (typeof idRaw !== 'string' || idRaw.length === 0) {
        throw new McpToolError('INVALID_ARGUMENT', `categoryGroupIds[${i}] must be a non-empty string`);
      }
      const categoryGroupId = idRaw as Id<'categoryGroup'>;
      if (isArchived) {
        await ctx.runMutation(internal.categoryGroups.deleteCategoryGroupForMcp, {
          workspaceId: workspace._id,
          categoryGroupId,
        });
        archived.push(categoryGroupId);
      } else {
        await ctx.runMutation(internal.categoryGroups.restoreCategoryGroupForMcp, {
          workspaceId: workspace._id,
          categoryGroupId,
        });
        restored.push(categoryGroupId);
      }
    } catch (error: unknown) {
      const { code, message } = classifyMutationError(error);
      failed.push({ inputIndex: i, code, message });
    }
  }

  return { workspaceId: workspace._id, archived, restored, failed, isArchived };
}

async function executeReorderCategoryGroupsTool(
  ctx: MutationCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined
): Promise<{ workspaceId: Id<'workspace'>; updatedCount: number }> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const idsRaw = args['orderedCategoryGroupIds'];
  if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
    throw new McpToolError('INVALID_ARGUMENT', 'orderedCategoryGroupIds must be a non-empty array');
  }
  if (idsRaw.length > 50) {
    throw new McpToolError('INVALID_ARGUMENT', 'orderedCategoryGroupIds cannot contain more than 50 entries per call');
  }
  const orderedCategoryGroupIds: Id<'categoryGroup'>[] = [];
  for (let i = 0; i < idsRaw.length; i++) {
    const id = idsRaw[i];
    if (typeof id !== 'string' || id.length === 0) {
      throw new McpToolError('INVALID_ARGUMENT', `orderedCategoryGroupIds[${i}] must be a non-empty string`);
    }
    orderedCategoryGroupIds.push(id as Id<'categoryGroup'>);
  }

  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);

  const result = await ctx.runMutation(internal.categoryGroups.bulkReorderCategoryGroupsForMcp, {
    workspaceId: workspace._id,
    orderedCategoryGroupIds,
  });

  return { workspaceId: workspace._id, updatedCount: result.updatedCount };
}

type TargetType = 'recurring' | 'recurring_rollover' | 'maintain_balance' | 'one_time';
type TargetFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

function parseTargetType(value: unknown): TargetType {
  if (value === 'recurring' || value === 'recurring_rollover' || value === 'maintain_balance' || value === 'one_time') {
    return value;
  }
  throw new McpToolError(
    'INVALID_ARGUMENT',
    "targetType must be one of 'recurring', 'recurring_rollover', 'maintain_balance', 'one_time'"
  );
}

function parseOptionalTargetType(value: unknown): TargetType | undefined {
  if (value === undefined) return undefined;
  return parseTargetType(value);
}

function parseOptionalFrequency(value: unknown): TargetFrequency | undefined {
  if (value === undefined) return undefined;
  if (value === 'daily' || value === 'weekly' || value === 'monthly' || value === 'yearly') {
    return value;
  }
  throw new McpToolError('INVALID_ARGUMENT', "frequency must be one of 'daily', 'weekly', 'monthly', 'yearly'");
}

function parseIsoDate(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new McpToolError('INVALID_ARGUMENT', `${field} must be a YYYY-MM-DD string`);
  }
  return value;
}

function parseIsoDateNullable(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return parseIsoDate(value, field);
}

async function executeCreateCategoryTargetTool(
  ctx: MutationCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined,
  attribution: ActivityAttribution
): Promise<{ workspaceId: Id<'workspace'>; categoryId: Id<'category'> } & McpAmountMetadata> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);
  const minorUnit = resolveMcpAmountMetadata(workspace.currency).minorUnit;

  const categoryId = parseCategoryId(args['categoryId']);
  const targetType = parseTargetType(args['targetType']);
  const amount = parseRequiredDecimalAmount(args['amount'], 'amount', minorUnit);
  const frequency = parseOptionalFrequency(args['frequency']);
  const frequencyInterval = parseOptionalInteger(args['frequencyInterval'], 'frequencyInterval', 1);
  const dayOfWeek = parseOptionalInteger(args['dayOfWeek'], 'dayOfWeek', 0, 6);
  const dueDay = parseOptionalInteger(args['dueDay'], 'dueDay');
  const firstDueDate = parseIsoDate(args['firstDueDate'], 'firstDueDate');
  const targetDate = parseIsoDate(args['targetDate'], 'targetDate');
  const monthlyContribution = parseOptionalDecimalAmount(args['monthlyContribution'], 'monthlyContribution', minorUnit);
  const targetBalance = parseOptionalDecimalAmount(args['targetBalance'], 'targetBalance', minorUnit);

  await validateCategoryForWorkspace(ctx, workspace._id, categoryId);

  await ctx.runMutation(internal.categoryTargets.createCategoryTargetForMcp, {
    workspaceId: workspace._id,
    categoryId,
    targetType,
    amount,
    frequency,
    frequencyInterval,
    dayOfWeek,
    dueDay,
    firstDueDate,
    targetDate,
    monthlyContribution,
    targetBalance,
    attribution,
  });

  return { workspaceId: workspace._id, categoryId, ...resolveMcpAmountMetadata(workspace.currency) };
}

async function executeUpdateCategoryTargetTool(
  ctx: MutationCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined,
  attribution: ActivityAttribution
): Promise<{ workspaceId: Id<'workspace'>; categoryId: Id<'category'> } & McpAmountMetadata> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);
  const minorUnit = resolveMcpAmountMetadata(workspace.currency).minorUnit;

  const categoryId = parseCategoryId(args['categoryId']);
  const targetType = parseOptionalTargetType(args['targetType']);
  const amount = parseOptionalDecimalAmount(args['amount'], 'amount', minorUnit);
  const frequency = parseOptionalFrequency(args['frequency']);
  const frequencyInterval = parseOptionalInteger(args['frequencyInterval'], 'frequencyInterval', 1);
  const dayOfWeek = parseOptionalIntegerNullable(args['dayOfWeek'], 'dayOfWeek');
  const dueDay = parseOptionalIntegerNullable(args['dueDay'], 'dueDay');
  const firstDueDate = parseIsoDate(args['firstDueDate'], 'firstDueDate');
  const targetDate = parseIsoDateNullable(args['targetDate'], 'targetDate');
  const monthlyContribution = parseOptionalDecimalAmountNullable(
    args['monthlyContribution'],
    'monthlyContribution',
    minorUnit
  );
  const targetBalance = parseOptionalDecimalAmountNullable(args['targetBalance'], 'targetBalance', minorUnit);

  await validateCategoryForWorkspace(ctx, workspace._id, categoryId);

  await ctx.runMutation(internal.categoryTargets.updateCategoryTargetForMcp, {
    workspaceId: workspace._id,
    categoryId,
    targetType,
    amount,
    frequency,
    frequencyInterval,
    dayOfWeek,
    dueDay,
    firstDueDate,
    targetDate,
    monthlyContribution,
    targetBalance,
    attribution,
  });

  return { workspaceId: workspace._id, categoryId, ...resolveMcpAmountMetadata(workspace.currency) };
}

async function executeDeleteCategoryTargetTool(
  ctx: MutationCtx,
  clerkId: string,
  activeWorkspaceId: Id<'workspace'> | undefined,
  rawArguments: string | undefined,
  attribution: ActivityAttribution
): Promise<{ workspaceId: Id<'workspace'>; categoryId: Id<'category'> }> {
  const args = parseToolArguments(rawArguments);
  const requestedWorkspaceId = parseWorkspaceId(args['workspaceId']);
  const categoryId = parseCategoryId(args['categoryId']);
  const workspace = await resolveWorkspace(ctx, clerkId, activeWorkspaceId, requestedWorkspaceId);

  await validateCategoryForWorkspace(ctx, workspace._id, categoryId);

  await ctx.runMutation(internal.categoryTargets.deleteCategoryTargetForMcp, {
    workspaceId: workspace._id,
    categoryId,
    attribution,
  });

  return { workspaceId: workspace._id, categoryId };
}

export const executeMcpTool = internalQuery({
  args: {
    toolName: v.string(),
    clerkId: v.string(),
    activeWorkspaceId: v.optional(v.id('workspace')),
    scopes: v.array(v.string()),
    rawArguments: v.optional(v.string()),
  },
  handler: async (ctx, { toolName, clerkId, activeWorkspaceId, scopes, rawArguments }): Promise<McpToolResult> => {
    if (!hasReportsReadScope(scopes)) {
      return {
        ok: false as const,
        error: {
          code: 'FORBIDDEN' as const,
          message: 'Token is missing app:read scope',
        },
      };
    }

    try {
      switch (toolName) {
        case MCP_TOOL_LIST_WORKSPACES:
        case LEGACY_MCP_TOOL_LIST_WORKSPACES: {
          const workspaces = await listWorkspaces(ctx, clerkId);
          return {
            ok: true as const,
            data: { workspaces },
          };
        }
        case MCP_TOOL_LIST_CATEGORY_GROUPS: {
          const data = await executeListCategoryGroupsTool(ctx, clerkId, activeWorkspaceId, rawArguments);
          return {
            ok: true as const,
            data,
          };
        }
        case MCP_TOOL_GET_ENVELOPE_MONTH_STATUS: {
          const data = await executeEnvelopeMonthStatusTool(ctx, clerkId, activeWorkspaceId, rawArguments);
          return {
            ok: true as const,
            data,
          };
        }
        case MCP_TOOL_GET_ACCOUNT_BALANCES_REPORT:
        case MCP_TOOL_GET_NET_WORTH_REPORT:
        case MCP_TOOL_GET_SPENDING_REPORT:
        case LEGACY_MCP_TOOL_GET_NET_WORTH_REPORT:
        case LEGACY_MCP_TOOL_GET_SPENDING_REPORT: {
          const data = await executeReportTool(ctx, toolName, clerkId, activeWorkspaceId, rawArguments);
          return {
            ok: true as const,
            data,
          };
        }
        case MCP_TOOL_LIST_TRANSACTIONS: {
          const data = await executeListTransactionsTool(ctx, clerkId, activeWorkspaceId, rawArguments);
          return {
            ok: true as const,
            data,
          };
        }
        case MCP_TOOL_LIST_CATEGORY_TARGETS: {
          const data = await executeListCategoryTargetsTool(ctx, clerkId, activeWorkspaceId, rawArguments);
          return {
            ok: true as const,
            data,
          };
        }
        case MCP_TOOL_LIST_RECURRING_TRANSACTIONS: {
          const data = await executeListRecurringTransactionsTool(ctx, clerkId, activeWorkspaceId, rawArguments);
          return {
            ok: true as const,
            data,
          };
        }
        case MCP_TOOL_GET_INCOME_SUMMARY: {
          const data = await executeIncomeSummaryTool(ctx, clerkId, activeWorkspaceId, rawArguments);
          return {
            ok: true as const,
            data,
          };
        }
        case MCP_TOOL_GET_CATEGORY_ROLLUP: {
          const data = await executeCategoryRollupTool(ctx, clerkId, activeWorkspaceId, rawArguments);
          return {
            ok: true as const,
            data,
          };
        }
        case MCP_TOOL_GET_MONTHLY_SUMMARY: {
          const data = await executeMonthlySummaryTool(ctx, clerkId, activeWorkspaceId, rawArguments);
          return {
            ok: true as const,
            data,
          };
        }
        case MCP_TOOL_LIST_BANK_ACCOUNTS: {
          const data = await executeListBankAccountsTool(ctx, clerkId, activeWorkspaceId, rawArguments);
          return {
            ok: true as const,
            data,
          };
        }
        default:
          return {
            ok: false as const,
            error: {
              code: 'INVALID_ARGUMENT' as const,
              message: `Unknown tool: ${toolName}`,
            },
          };
      }
    } catch (error: unknown) {
      if (error instanceof McpToolError) {
        return {
          ok: false as const,
          error: {
            code: error.code,
            message: error.message,
          },
        };
      }

      console.error('MCP tool execution failed', error);
      return {
        ok: false as const,
        error: {
          code: 'INTERNAL' as const,
          message: 'Unexpected server error',
        },
      };
    }
  },
});

export const executeMcpMutationTool = internalMutation({
  args: {
    toolName: v.string(),
    clerkId: v.string(),
    activeWorkspaceId: v.optional(v.id('workspace')),
    scopes: v.array(v.string()),
    rawArguments: v.optional(v.string()),
    attribution: activityAttributionValidator,
  },
  handler: async (
    ctx,
    { toolName, clerkId, activeWorkspaceId, scopes, rawArguments, attribution }
  ): Promise<McpToolResult> => {
    try {
      switch (toolName) {
        case MCP_TOOL_SET_CATEGORY_ASSIGNED_AMOUNT: {
          if (!hasBudgetsWriteScope(scopes)) {
            return {
              ok: false as const,
              error: { code: 'FORBIDDEN' as const, message: 'Token is missing budgets:write scope' },
            };
          }
          const data = await executeSetCategoryAssignedAmountTool(
            ctx,
            clerkId,
            activeWorkspaceId,
            rawArguments,
            attribution
          );
          return { ok: true as const, data };
        }
        case MCP_TOOL_DELETE_TRANSACTIONS: {
          if (!hasTransactionsWriteScope(scopes)) {
            return {
              ok: false as const,
              error: { code: 'FORBIDDEN' as const, message: 'Token is missing transactions:write scope' },
            };
          }
          const data = await executeDeleteTransactionsTool(ctx, clerkId, activeWorkspaceId, rawArguments, attribution);
          return { ok: true as const, data };
        }
        case MCP_TOOL_UPDATE_TRANSACTIONS: {
          if (!hasTransactionsWriteScope(scopes)) {
            return {
              ok: false as const,
              error: { code: 'FORBIDDEN' as const, message: 'Token is missing transactions:write scope' },
            };
          }
          const data = await executeUpdateTransactionsTool(ctx, clerkId, activeWorkspaceId, rawArguments, attribution);
          return { ok: true as const, data };
        }
        case MCP_TOOL_RESTORE_TRANSACTIONS: {
          if (!hasTransactionsWriteScope(scopes)) {
            return {
              ok: false as const,
              error: { code: 'FORBIDDEN' as const, message: 'Token is missing transactions:write scope' },
            };
          }
          const data = await executeRestoreTransactionsTool(ctx, clerkId, activeWorkspaceId, rawArguments, attribution);
          return { ok: true as const, data };
        }
        case MCP_TOOL_RECONCILE_BANK_ACCOUNT: {
          if (!hasTransactionsWriteScope(scopes)) {
            return {
              ok: false as const,
              error: { code: 'FORBIDDEN' as const, message: 'Token is missing transactions:write scope' },
            };
          }
          const data = await executeReconcileBankAccountTool(
            ctx,
            clerkId,
            activeWorkspaceId,
            rawArguments,
            attribution
          );
          return { ok: true as const, data };
        }
        case MCP_TOOL_CREATE_BANK_ACCOUNT: {
          if (!hasTransactionsWriteScope(scopes)) {
            return {
              ok: false as const,
              error: { code: 'FORBIDDEN' as const, message: 'Token is missing transactions:write scope' },
            };
          }
          const data = await executeCreateBankAccountTool(ctx, clerkId, activeWorkspaceId, rawArguments, attribution);
          return { ok: true as const, data };
        }
        case MCP_TOOL_CLOSE_BANK_ACCOUNT: {
          if (!hasTransactionsWriteScope(scopes)) {
            return {
              ok: false as const,
              error: { code: 'FORBIDDEN' as const, message: 'Token is missing transactions:write scope' },
            };
          }
          const data = await executeCloseBankAccountTool(ctx, clerkId, activeWorkspaceId, rawArguments, attribution);
          return { ok: true as const, data };
        }
        case MCP_TOOL_DELETE_BANK_ACCOUNT: {
          if (!hasTransactionsWriteScope(scopes)) {
            return {
              ok: false as const,
              error: { code: 'FORBIDDEN' as const, message: 'Token is missing transactions:write scope' },
            };
          }
          const data = await executeDeleteBankAccountTool(ctx, clerkId, activeWorkspaceId, rawArguments, attribution);
          return { ok: true as const, data };
        }
        case MCP_TOOL_CREATE_CATEGORIES: {
          if (!hasBudgetsWriteScope(scopes)) {
            return {
              ok: false as const,
              error: { code: 'FORBIDDEN' as const, message: 'Token is missing budgets:write scope' },
            };
          }
          const data = await executeCreateCategoriesTool(ctx, clerkId, activeWorkspaceId, rawArguments, attribution);
          return { ok: true as const, data };
        }
        case MCP_TOOL_UPDATE_CATEGORIES: {
          if (!hasBudgetsWriteScope(scopes)) {
            return {
              ok: false as const,
              error: { code: 'FORBIDDEN' as const, message: 'Token is missing budgets:write scope' },
            };
          }
          const data = await executeUpdateCategoriesTool(ctx, clerkId, activeWorkspaceId, rawArguments, attribution);
          return { ok: true as const, data };
        }
        case MCP_TOOL_ARCHIVE_CATEGORIES: {
          if (!hasBudgetsWriteScope(scopes)) {
            return {
              ok: false as const,
              error: { code: 'FORBIDDEN' as const, message: 'Token is missing budgets:write scope' },
            };
          }
          const data = await executeArchiveCategoriesTool(ctx, clerkId, activeWorkspaceId, rawArguments, attribution);
          return { ok: true as const, data };
        }
        case MCP_TOOL_DELETE_CATEGORIES: {
          if (!hasBudgetsWriteScope(scopes)) {
            return {
              ok: false as const,
              error: { code: 'FORBIDDEN' as const, message: 'Token is missing budgets:write scope' },
            };
          }
          const data = await executeDeleteCategoriesTool(ctx, clerkId, activeWorkspaceId, rawArguments, attribution);
          return { ok: true as const, data };
        }
        case MCP_TOOL_REORDER_CATEGORIES: {
          if (!hasBudgetsWriteScope(scopes)) {
            return {
              ok: false as const,
              error: { code: 'FORBIDDEN' as const, message: 'Token is missing budgets:write scope' },
            };
          }
          const data = await executeReorderCategoriesTool(ctx, clerkId, activeWorkspaceId, rawArguments);
          return { ok: true as const, data };
        }
        case MCP_TOOL_SORT_CATEGORIES: {
          if (!hasBudgetsWriteScope(scopes)) {
            return {
              ok: false as const,
              error: { code: 'FORBIDDEN' as const, message: 'Token is missing budgets:write scope' },
            };
          }
          const data = await executeSortCategoriesTool(ctx, clerkId, activeWorkspaceId, rawArguments);
          return { ok: true as const, data };
        }
        case MCP_TOOL_CREATE_CATEGORY_GROUPS: {
          if (!hasBudgetsWriteScope(scopes)) {
            return {
              ok: false as const,
              error: { code: 'FORBIDDEN' as const, message: 'Token is missing budgets:write scope' },
            };
          }
          const data = await executeCreateCategoryGroupsTool(ctx, clerkId, activeWorkspaceId, rawArguments);
          return { ok: true as const, data };
        }
        case MCP_TOOL_UPDATE_CATEGORY_GROUPS: {
          if (!hasBudgetsWriteScope(scopes)) {
            return {
              ok: false as const,
              error: { code: 'FORBIDDEN' as const, message: 'Token is missing budgets:write scope' },
            };
          }
          const data = await executeUpdateCategoryGroupsTool(ctx, clerkId, activeWorkspaceId, rawArguments);
          return { ok: true as const, data };
        }
        case MCP_TOOL_ARCHIVE_CATEGORY_GROUPS: {
          if (!hasBudgetsWriteScope(scopes)) {
            return {
              ok: false as const,
              error: { code: 'FORBIDDEN' as const, message: 'Token is missing budgets:write scope' },
            };
          }
          const data = await executeArchiveCategoryGroupsTool(ctx, clerkId, activeWorkspaceId, rawArguments);
          return { ok: true as const, data };
        }
        case MCP_TOOL_REORDER_CATEGORY_GROUPS: {
          if (!hasBudgetsWriteScope(scopes)) {
            return {
              ok: false as const,
              error: { code: 'FORBIDDEN' as const, message: 'Token is missing budgets:write scope' },
            };
          }
          const data = await executeReorderCategoryGroupsTool(ctx, clerkId, activeWorkspaceId, rawArguments);
          return { ok: true as const, data };
        }
        case MCP_TOOL_SORT_CATEGORY_GROUPS: {
          if (!hasBudgetsWriteScope(scopes)) {
            return {
              ok: false as const,
              error: { code: 'FORBIDDEN' as const, message: 'Token is missing budgets:write scope' },
            };
          }
          const data = await executeSortCategoryGroupsTool(ctx, clerkId, activeWorkspaceId, rawArguments);
          return { ok: true as const, data };
        }
        case MCP_TOOL_CREATE_CATEGORY_TARGET: {
          if (!hasBudgetsWriteScope(scopes)) {
            return {
              ok: false as const,
              error: { code: 'FORBIDDEN' as const, message: 'Token is missing budgets:write scope' },
            };
          }
          const data = await executeCreateCategoryTargetTool(
            ctx,
            clerkId,
            activeWorkspaceId,
            rawArguments,
            attribution
          );
          return { ok: true as const, data };
        }
        case MCP_TOOL_UPDATE_CATEGORY_TARGET: {
          if (!hasBudgetsWriteScope(scopes)) {
            return {
              ok: false as const,
              error: { code: 'FORBIDDEN' as const, message: 'Token is missing budgets:write scope' },
            };
          }
          const data = await executeUpdateCategoryTargetTool(
            ctx,
            clerkId,
            activeWorkspaceId,
            rawArguments,
            attribution
          );
          return { ok: true as const, data };
        }
        case MCP_TOOL_DELETE_CATEGORY_TARGET: {
          if (!hasBudgetsWriteScope(scopes)) {
            return {
              ok: false as const,
              error: { code: 'FORBIDDEN' as const, message: 'Token is missing budgets:write scope' },
            };
          }
          const data = await executeDeleteCategoryTargetTool(
            ctx,
            clerkId,
            activeWorkspaceId,
            rawArguments,
            attribution
          );
          return { ok: true as const, data };
        }
        default:
          return {
            ok: false as const,
            error: { code: 'INVALID_ARGUMENT' as const, message: `Unknown tool: ${toolName}` },
          };
      }
    } catch (error: unknown) {
      if (error instanceof McpToolError) {
        return {
          ok: false as const,
          error: {
            code: error.code,
            message: error.message,
          },
        };
      }

      if (error instanceof Error) {
        if (
          error.message.includes('Workspace not found') ||
          error.message.includes('Category not found') ||
          error.message.includes('Bank account not found')
        ) {
          return {
            ok: false as const,
            error: {
              code: 'NOT_FOUND' as const,
              message: error.message,
            },
          };
        }

        if (
          error.message.includes('Access denied') ||
          error.message.includes('does not belong to workspace') ||
          error.message.includes('Workspace is archived')
        ) {
          return {
            ok: false as const,
            error: {
              code: 'FORBIDDEN' as const,
              message: error.message,
            },
          };
        }
      }

      console.error('MCP mutation tool execution failed', error);
      return {
        ok: false as const,
        error: {
          code: 'INTERNAL' as const,
          message: 'Unexpected server error',
        },
      };
    }
  },
});

/**
 * Executor for action-backed tools. These tools need storage/network access or can call other
 * actions, so they use a different runtime than query/mutation tools.
 */
export const executeMcpActionTool = internalAction({
  args: {
    toolName: v.string(),
    clerkId: v.string(),
    activeWorkspaceId: v.optional(v.id('workspace')),
    scopes: v.array(v.string()),
    rawArguments: v.optional(v.string()),
    attribution: activityAttributionValidator,
  },
  handler: async (
    ctx,
    { toolName, clerkId, activeWorkspaceId, scopes, rawArguments, attribution }
  ): Promise<McpToolResult> => {
    try {
      switch (toolName) {
        case MCP_TOOL_EXPORT_WORKSPACE_DATA: {
          if (!hasReportsReadScope(scopes)) {
            return {
              ok: false as const,
              error: { code: 'FORBIDDEN' as const, message: 'Token is missing app:read scope' },
            };
          }
          const data = await executeExportWorkspaceDataTool(ctx, clerkId, activeWorkspaceId, rawArguments);
          return { ok: true as const, data };
        }
        case MCP_TOOL_CREATE_TRANSACTIONS: {
          if (!hasTransactionsWriteScope(scopes)) {
            return {
              ok: false as const,
              error: { code: 'FORBIDDEN' as const, message: 'Token is missing transactions:write scope' },
            };
          }
          const data = await executeCreateTransactionsTool(ctx, clerkId, activeWorkspaceId, rawArguments, attribution);
          return { ok: true as const, data };
        }
        default:
          return {
            ok: false as const,
            error: { code: 'INVALID_ARGUMENT' as const, message: `Unknown tool: ${toolName}` },
          };
      }
    } catch (error: unknown) {
      if (error instanceof McpToolError) {
        return {
          ok: false as const,
          error: {
            code: error.code,
            message: error.message,
          },
        };
      }
      console.error('MCP action tool execution failed', error);
      return {
        ok: false as const,
        error: {
          code: 'INTERNAL' as const,
          message: 'Unexpected server error',
        },
      };
    }
  },
});
