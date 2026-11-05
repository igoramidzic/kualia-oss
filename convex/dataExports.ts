import { getIdentity } from './lib/identity';
import { paginationOptsValidator, paginationResultValidator, type PaginationResult } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { getCurrencyDecimals } from '../packages/shared/src/currency/currency-conversion';

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { action, internalMutation, internalQuery, type ActionCtx, type QueryCtx } from './_generated/server';
import { createZipArchive } from './dataExports/archive';
import {
  buildWorkspaceExportCsvFiles,
  type BankAccountExportRecord,
  type CategoryExportRecord,
  type PlanExportRecord,
  type TransactionExportRecord,
  type WorkspaceExportDataset,
  type WorkspaceExportRecord,
} from './dataExports/format';
import { generateOpaqueToken, sha256Hex } from './lib/crypto';
import { batchResolveMerchantNames } from './merchants/helpers';
import { getWorkspaceAccessForClerkId } from './workspaces/access';

const EXPORT_CONTENT_TYPE = 'application/zip';
const EXPORT_EXPIRY_MS = 24 * 60 * 60 * 1000;
const EXPORT_PAGE_SIZE = 100;

const nullableString = v.union(v.string(), v.null());
const nullableNumber = v.union(v.number(), v.null());
const nullableBigInt = v.union(v.int64(), v.null());

const workspaceExportRecordValidator = v.object({
  workspaceId: v.string(),
  createdAt: v.number(),
  name: v.string(),
  currency: v.string(),
  timezone: nullableString,
  readyToAssign: v.int64(),
  expectedMonthlyIncome: nullableBigInt,
  transactionDefaultAccountId: nullableString,
  transactionDefaultAccountName: nullableString,
  transactionDefaultPendingStatus: v.boolean(),
  onboardingCompleted: v.boolean(),
  isArchived: v.boolean(),
  updatedAt: nullableString,
});

const categoryExportRecordValidator = v.object({
  categoryId: v.string(),
  createdAt: v.number(),
  name: v.string(),
  categoryGroupId: v.string(),
  categoryGroupName: nullableString,
  categoryGroupType: v.union(v.literal('expense'), v.literal('credit_card'), v.null()),
  sortOrder: v.number(),
  iconName: nullableString,
  isSystemCategory: v.boolean(),
  isArchived: v.boolean(),
  categoryType: nullableString,
  bankAccountId: nullableString,
  targetEnabled: v.boolean(),
  targetType: nullableString,
  targetAmount: nullableBigInt,
  targetFrequency: nullableString,
  targetFrequencyInterval: nullableNumber,
  targetDayOfWeek: nullableNumber,
  targetDueDay: nullableNumber,
  targetFirstDueDate: nullableString,
  targetDate: nullableString,
  targetMonthlyContribution: nullableBigInt,
  targetBalance: nullableBigInt,
  updatedAt: nullableString,
});

const planExportRecordValidator = v.object({
  categoryId: v.string(),
  categoryName: v.string(),
  categoryGroupId: v.string(),
  categoryGroupName: v.string(),
  categoryGroupType: v.union(v.literal('expense'), v.literal('credit_card')),
  categoryArchived: v.boolean(),
  categoryType: nullableString,
  bankAccountId: nullableString,
  monthlyAssignedAmounts: v.record(v.string(), v.int64()),
  snoozedTargetMonths: v.record(v.string(), v.boolean()),
  monthlySpending: v.record(
    v.string(),
    v.object({
      inflowAmount: v.int64(),
      outflowAmount: v.int64(),
    })
  ),
  creditMonthlySpending: v.record(
    v.string(),
    v.object({
      priorBalance: v.int64(),
      spendingAmount: v.int64(),
      paymentsAmount: v.int64(),
      refundedSpending: v.int64(),
    })
  ),
});

const bankAccountExportRecordValidator = v.object({
  bankAccountId: v.string(),
  createdAt: v.number(),
  name: v.string(),
  accountType: v.string(),
  currentBalance: v.int64(),
  pendingBalance: nullableBigInt,
  clearedBalance: nullableBigInt,
  isClosed: v.boolean(),
  closedAt: nullableString,
  lastReconciledAt: nullableString,
  notes: nullableString,
  updatedAt: nullableString,
});

const transactionMovementExportRecordValidator = v.object({
  amount: v.int64(),
  sortOrder: v.number(),
  categoryId: nullableString,
  categoryName: nullableString,
  categoryGroupId: nullableString,
  categoryGroupName: nullableString,
  readyToAssign: v.boolean(),
  notes: nullableString,
});

const transactionExportRecordValidator = v.object({
  transactionId: v.string(),
  createdAt: v.number(),
  date: v.string(),
  accountId: v.string(),
  accountName: v.string(),
  merchantId: nullableString,
  merchantName: nullableString,
  type: v.string(),
  status: v.string(),
  reviewStatus: v.string(),
  source: nullableString,
  notes: nullableString,
  totalAmount: v.int64(),
  transferPairId: nullableString,
  transferAccountId: nullableString,
  transferAccountName: nullableString,
  scheduledTransactionId: nullableString,
  updatedAt: nullableString,
  movements: v.array(transactionMovementExportRecordValidator),
});

const workspaceExportCountsValidator = v.object({
  transactionCount: v.number(),
  transactionMovementRowCount: v.number(),
  categoryCount: v.number(),
  planRowCount: v.number(),
  bankAccountCount: v.number(),
});

export const workspaceExportResultValidator = v.object({
  workspaceId: v.id('workspace'),
  downloadUrl: v.string(),
  filename: v.string(),
  expiresAt: v.number(),
  counts: workspaceExportCountsValidator,
});

export type WorkspaceExportResult = {
  workspaceId: Id<'workspace'>;
  downloadUrl: string;
  filename: string;
  expiresAt: number;
  counts: {
    transactionCount: number;
    transactionMovementRowCount: number;
    categoryCount: number;
    planRowCount: number;
    bankAccountCount: number;
  };
};

export const getAuthorizedWorkspaceExportRecord = internalQuery({
  args: {
    workspaceId: v.id('workspace'),
    clerkId: v.string(),
  },
  returns: workspaceExportRecordValidator,
  handler: async (ctx, { workspaceId, clerkId }): Promise<WorkspaceExportRecord> => {
    const access = await getWorkspaceAccessForClerkId(ctx, workspaceId, clerkId);
    if (!access || access.workspace.isDeleted) {
      throw new ConvexError('Access denied: You do not have access to this workspace');
    }
    if (access.workspace.isArchived) {
      throw new ConvexError('Workspace is archived');
    }

    const workspace = access.workspace;
    const defaultAccount = workspace.transactionDefaultAccountId
      ? await ctx.db.get(workspace.transactionDefaultAccountId)
      : null;

    return {
      workspaceId: workspace._id,
      createdAt: workspace._creationTime,
      name: workspace.name,
      currency: workspace.currency?.toUpperCase() ?? 'USD',
      timezone: workspace.timezone ?? null,
      readyToAssign: workspace.readyToAssign ?? 0n,
      expectedMonthlyIncome: workspace.expectedMonthlyIncome ?? null,
      transactionDefaultAccountId: workspace.transactionDefaultAccountId ?? null,
      transactionDefaultAccountName:
        defaultAccount && !defaultAccount.isDeleted && defaultAccount.workspaceId === workspace._id
          ? defaultAccount.name
          : null,
      transactionDefaultPendingStatus: workspace.transactionDefaultPendingStatus,
      onboardingCompleted: workspace.onboardingCompleted ?? false,
      isArchived: workspace.isArchived ?? false,
      updatedAt: workspace.updatedAt ?? null,
    };
  },
});

export const listCategoriesExportPage = internalQuery({
  args: {
    workspaceId: v.id('workspace'),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(categoryExportRecordValidator),
  handler: async (ctx, { workspaceId, paginationOpts }) => {
    const result = await ctx.db
      .query('category')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .order('asc')
      .paginate(paginationOpts);
    const activeCategories = result.page.filter((category) => !category.isDeleted);
    const groupIds = new Set(activeCategories.map((category) => category.categoryGroupId));
    const groups = await Promise.all([...groupIds].map((groupId) => ctx.db.get(groupId)));
    const groupMap = new Map(
      groups
        .filter((group): group is Doc<'categoryGroup'> => group !== null && group.workspaceId === workspaceId)
        .map((group) => [group._id, group])
    );

    return {
      ...result,
      page: activeCategories.map(
        (category): CategoryExportRecord => ({
          categoryId: category._id,
          createdAt: category._creationTime,
          name: category.name,
          categoryGroupId: category.categoryGroupId,
          categoryGroupName: groupMap.get(category.categoryGroupId)?.name ?? null,
          categoryGroupType: groupMap.get(category.categoryGroupId)?.type ?? null,
          sortOrder: category.sortOrder,
          iconName: category.iconName ?? null,
          isSystemCategory: category.isSystemCategory ?? false,
          isArchived: category.isArchived ?? false,
          categoryType: category.categoryType ?? null,
          bankAccountId: category.bankAccountId ?? null,
          targetEnabled: category.enableTarget ?? false,
          targetType: category.target_type ?? null,
          targetAmount: category.target_amount ?? null,
          targetFrequency: category.target_frequency ?? null,
          targetFrequencyInterval: category.target_frequencyInterval ?? null,
          targetDayOfWeek: category.target_dayOfWeek ?? null,
          targetDueDay: category.target_dueDay ?? null,
          targetFirstDueDate: category.target_firstDueDate ?? null,
          targetDate: category.target_targetDate ?? null,
          targetMonthlyContribution: category.target_monthlyContribution ?? null,
          targetBalance: category.target_targetBalance ?? null,
          updatedAt: category.updatedAt ?? null,
        })
      ),
    };
  },
});

export const listPlanExportPage = internalQuery({
  args: {
    workspaceId: v.id('workspace'),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(planExportRecordValidator),
  handler: async (ctx, { workspaceId, paginationOpts }) => {
    const result = await ctx.db
      .query('category')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .order('asc')
      .paginate(paginationOpts);
    const categories = result.page.filter((category) => !category.isDeleted);
    const budgets = await Promise.all(
      categories.map((category) =>
        ctx.db
          .query('categoryBudget')
          .withIndex('by_workspaceId_categoryId', (q) =>
            q.eq('workspaceId', workspaceId).eq('categoryId', category._id)
          )
          .unique()
      )
    );
    const budgetMap = new Map(
      budgets
        .filter((budget): budget is Doc<'categoryBudget'> => budget !== null)
        .map((budget) => [budget.categoryId, budget])
    );
    const groupIds = new Set(categories.map((category) => category.categoryGroupId));
    const groups = await Promise.all([...groupIds].map((groupId) => ctx.db.get(groupId)));
    const groupMap = new Map(
      groups
        .filter((group): group is Doc<'categoryGroup'> => group !== null && group.workspaceId === workspaceId)
        .map((group) => [group._id, group])
    );

    return {
      ...result,
      page: categories.flatMap((category): PlanExportRecord[] => {
        const group = groupMap.get(category.categoryGroupId);
        if (!group || group.isDeleted) {
          return [];
        }
        const budget = budgetMap.get(category._id);

        return [
          {
            categoryId: category._id,
            categoryName: category.name,
            categoryGroupId: group._id,
            categoryGroupName: group.name,
            categoryGroupType: group.type,
            categoryArchived: category.isArchived ?? false,
            categoryType: category.categoryType ?? null,
            bankAccountId: category.bankAccountId ?? null,
            monthlyAssignedAmounts: budget?.monthlyAssignedAmounts ?? {},
            snoozedTargetMonths: budget?.snoozedTargetMonths ?? {},
            monthlySpending: category.monthlySpending ?? {},
            creditMonthlySpending: category.creditMonthlySpending ?? {},
          },
        ];
      }),
    };
  },
});

export const listBankAccountsExportPage = internalQuery({
  args: {
    workspaceId: v.id('workspace'),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(bankAccountExportRecordValidator),
  handler: async (ctx, { workspaceId, paginationOpts }) => {
    const result = await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .order('asc')
      .paginate(paginationOpts);

    return {
      ...result,
      page: result.page
        .filter((account) => !account.isDeleted)
        .map(
          (account): BankAccountExportRecord => ({
            bankAccountId: account._id,
            createdAt: account._creationTime,
            name: account.name,
            accountType: account.accountType,
            currentBalance: account.currentBalance,
            pendingBalance: account.pendingBalance ?? null,
            clearedBalance: account.clearedBalance ?? null,
            isClosed: account.isClosed,
            closedAt: account.closedAt ?? null,
            lastReconciledAt: account.lastReconciledAt ?? null,
            notes: account.notes ?? null,
            updatedAt: account.updatedAt ?? null,
          })
        ),
    };
  },
});

async function getBankAccountMap(
  ctx: QueryCtx,
  workspaceId: Id<'workspace'>,
  accountIds: Set<Id<'bankAccount'>>
): Promise<Map<string, Doc<'bankAccount'>>> {
  const accounts = await Promise.all([...accountIds].map((accountId) => ctx.db.get(accountId)));
  return new Map(
    accounts
      .filter((account): account is Doc<'bankAccount'> => account !== null && account.workspaceId === workspaceId)
      .map((account) => [account._id, account])
  );
}

export const listTransactionsExportPage = internalQuery({
  args: {
    workspaceId: v.id('workspace'),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(transactionExportRecordValidator),
  handler: async (ctx, { workspaceId, paginationOpts }) => {
    const result = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .order('asc')
      .paginate(paginationOpts);
    const transactions = result.page.filter((transaction) => !transaction.isDeleted);

    const accountIds = new Set<Id<'bankAccount'>>();
    const categoryIds = new Set<Id<'category'>>();
    const merchantIds = new Set<string>();
    for (const transaction of transactions) {
      accountIds.add(transaction.bankAccountId);
      if (transaction.transferPairBankAccountId) {
        accountIds.add(transaction.transferPairBankAccountId);
      }
      if (transaction.merchantId) {
        merchantIds.add(transaction.merchantId);
      }
      for (const movement of transaction.movements) {
        if (movement.categoryId) {
          categoryIds.add(movement.categoryId);
        }
      }
    }

    const [accountMap, categories, merchants] = await Promise.all([
      getBankAccountMap(ctx, workspaceId, accountIds),
      Promise.all([...categoryIds].map((categoryId) => ctx.db.get(categoryId))),
      Promise.all([...merchantIds].map((merchantId) => ctx.db.get(merchantId as Id<'merchant'>))),
    ]);
    const categoryMap = new Map(
      categories
        .filter((category): category is Doc<'category'> => category !== null && category.workspaceId === workspaceId)
        .map((category) => [category._id, category])
    );
    const validMerchantIds = new Set<string>(
      merchants
        .filter((merchant): merchant is Doc<'merchant'> => merchant !== null && merchant.workspaceId === workspaceId)
        .map((merchant) => merchant._id)
    );
    const merchantNames = await batchResolveMerchantNames(ctx, validMerchantIds);
    const groupIds = new Set([...categoryMap.values()].map((category) => category.categoryGroupId));
    const groups = await Promise.all([...groupIds].map((groupId) => ctx.db.get(groupId)));
    const groupMap = new Map(
      groups
        .filter((group): group is Doc<'categoryGroup'> => group !== null && group.workspaceId === workspaceId)
        .map((group) => [group._id, group])
    );

    return {
      ...result,
      page: transactions.map((transaction): TransactionExportRecord => {
        const account = accountMap.get(transaction.bankAccountId);
        const transferAccount = transaction.transferPairBankAccountId
          ? accountMap.get(transaction.transferPairBankAccountId)
          : null;

        return {
          transactionId: transaction._id,
          createdAt: transaction._creationTime,
          date: transaction.date,
          accountId: transaction.bankAccountId,
          accountName: account?.name ?? 'Unknown account',
          merchantId: transaction.merchantId ?? null,
          merchantName:
            (transaction.merchantId ? merchantNames.get(transaction.merchantId) : null) ??
            transaction.importDetails?.merchantName ??
            transaction.plaidMerchantName ??
            null,
          type: transaction.type,
          status: transaction.status,
          reviewStatus: transaction.reviewStatus,
          source: transaction.source ?? null,
          notes: transaction.notes ?? null,
          totalAmount: transaction.totalAmount,
          transferPairId: transaction.transferPairId ?? null,
          transferAccountId: transaction.transferPairBankAccountId ?? null,
          transferAccountName: transferAccount?.name ?? null,
          scheduledTransactionId: transaction.scheduledTransactionId ?? null,
          updatedAt: transaction.updatedAt ?? null,
          movements: transaction.movements.map((movement) => {
            const category = movement.categoryId ? categoryMap.get(movement.categoryId) : null;
            const group = category ? groupMap.get(category.categoryGroupId) : null;
            return {
              amount: movement.amount,
              sortOrder: movement.sortOrder,
              categoryId: movement.categoryId ?? null,
              categoryName: category?.name ?? movement.categoryName ?? null,
              categoryGroupId: group?._id ?? null,
              categoryGroupName: group?.name ?? null,
              readyToAssign: movement.readyToAssign,
              notes: movement.notes ?? null,
            };
          }),
        };
      }),
    };
  },
});

export const registerWorkspaceExport = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    requestedByClerkId: v.string(),
    source: v.union(v.literal('web'), v.literal('mcp')),
    storageId: v.id('_storage'),
    tokenHash: v.string(),
    filename: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
  },
  returns: v.id('dataExport'),
  handler: async (ctx, args) => {
    const dataExportId = await ctx.db.insert('dataExport', {
      ...args,
      contentType: EXPORT_CONTENT_TYPE,
      isDeleted: false,
    });
    await ctx.scheduler.runAt(args.expiresAt, internal.dataExports.cleanupWorkspaceExport, { dataExportId });
    return dataExportId;
  },
});

export const cleanupWorkspaceExport = internalMutation({
  args: {
    dataExportId: v.id('dataExport'),
  },
  returns: v.null(),
  handler: async (ctx, { dataExportId }) => {
    const dataExport = await ctx.db.get(dataExportId);
    if (!dataExport || dataExport.isDeleted) {
      return null;
    }
    if (dataExport.expiresAt > Date.now()) {
      await ctx.scheduler.runAt(dataExport.expiresAt, internal.dataExports.cleanupWorkspaceExport, { dataExportId });
      return null;
    }

    await ctx.storage.delete(dataExport.storageId);
    await ctx.db.patch(dataExportId, {
      isDeleted: true,
      deletedAt: new Date().toISOString(),
    });
    return null;
  },
});

export const getWorkspaceExportDownload = internalQuery({
  args: {
    tokenHash: v.string(),
  },
  returns: v.union(
    v.object({
      status: v.literal('available'),
      storageId: v.id('_storage'),
      filename: v.string(),
      contentType: v.string(),
    }),
    v.object({ status: v.literal('expired') }),
    v.object({ status: v.literal('not_found') })
  ),
  handler: async (ctx, { tokenHash }) => {
    const dataExport = await ctx.db
      .query('dataExport')
      .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
      .unique();
    if (!dataExport || dataExport.isDeleted) {
      return { status: 'not_found' as const };
    }
    if (dataExport.expiresAt <= Date.now()) {
      return { status: 'expired' as const };
    }
    return {
      status: 'available' as const,
      storageId: dataExport.storageId,
      filename: dataExport.filename,
      contentType: dataExport.contentType,
    };
  },
});

async function collectExportPages<T>(loadPage: (cursor: string | null) => Promise<PaginationResult<T>>): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;

  while (true) {
    const result = await loadPage(cursor);
    items.push(...result.page);
    if (result.isDone) {
      return items;
    }
    if (result.continueCursor === cursor) {
      throw new Error('Export pagination did not advance');
    }
    cursor = result.continueCursor;
  }
}

function buildExportFilename(workspaceName: string, now: number): string {
  const workspaceSlug =
    workspaceName
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'workspace';
  const timestamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  return `kualia-${workspaceSlug}-${timestamp}.zip`;
}

function getExportDownloadUrl(rawToken: string): string {
  const siteUrl = process.env['CONVEX_SITE_URL'];
  if (!siteUrl) {
    throw new Error('CONVEX_SITE_URL is not configured');
  }
  const url = new URL('/exports/download', siteUrl);
  url.searchParams.set('token', rawToken);
  return url.toString();
}

export async function createWorkspaceExportForClerk(
  ctx: ActionCtx,
  args: {
    workspaceId: Id<'workspace'>;
    clerkId: string;
    source: 'web' | 'mcp';
  }
): Promise<WorkspaceExportResult> {
  const workspace: WorkspaceExportRecord = await ctx.runQuery(internal.dataExports.getAuthorizedWorkspaceExportRecord, {
    workspaceId: args.workspaceId,
    clerkId: args.clerkId,
  });
  const paginationOpts = (cursor: string | null) => ({ numItems: EXPORT_PAGE_SIZE, cursor });

  const [categories, plan, bankAccounts, transactions] = await Promise.all([
    collectExportPages<CategoryExportRecord>((cursor) =>
      ctx.runQuery(internal.dataExports.listCategoriesExportPage, {
        workspaceId: args.workspaceId,
        paginationOpts: paginationOpts(cursor),
      })
    ),
    collectExportPages<PlanExportRecord>((cursor) =>
      ctx.runQuery(internal.dataExports.listPlanExportPage, {
        workspaceId: args.workspaceId,
        paginationOpts: paginationOpts(cursor),
      })
    ),
    collectExportPages<BankAccountExportRecord>((cursor) =>
      ctx.runQuery(internal.dataExports.listBankAccountsExportPage, {
        workspaceId: args.workspaceId,
        paginationOpts: paginationOpts(cursor),
      })
    ),
    collectExportPages<TransactionExportRecord>((cursor) =>
      ctx.runQuery(internal.dataExports.listTransactionsExportPage, {
        workspaceId: args.workspaceId,
        paginationOpts: paginationOpts(cursor),
      })
    ),
  ]);

  const dataset: WorkspaceExportDataset = {
    workspace,
    categories,
    plan,
    bankAccounts,
    transactions,
  };
  const minorUnit = getCurrencyDecimals(workspace.currency);
  const { files, counts } = buildWorkspaceExportCsvFiles(dataset, minorUnit);
  const now = Date.now();
  const archive = createZipArchive(files, new Date(now));
  const archiveBuffer = new ArrayBuffer(archive.byteLength);
  new Uint8Array(archiveBuffer).set(archive);
  const filename = buildExportFilename(workspace.name, now);
  const expiresAt = now + EXPORT_EXPIRY_MS;
  const rawToken = generateOpaqueToken('kualia_export_');
  const downloadUrl = getExportDownloadUrl(rawToken);
  const tokenHash = await sha256Hex(rawToken);
  const storageId = await ctx.storage.store(new Blob([archiveBuffer], { type: EXPORT_CONTENT_TYPE }));

  try {
    await ctx.runMutation(internal.dataExports.registerWorkspaceExport, {
      workspaceId: args.workspaceId,
      requestedByClerkId: args.clerkId,
      source: args.source,
      storageId,
      tokenHash,
      filename,
      createdAt: now,
      expiresAt,
    });
  } catch (error: unknown) {
    await ctx.storage.delete(storageId);
    throw error;
  }

  return {
    workspaceId: args.workspaceId,
    downloadUrl,
    filename,
    expiresAt,
    counts,
  };
}

export const generateWorkspaceExport = action({
  args: {
    workspaceId: v.id('workspace'),
  },
  returns: workspaceExportResultValidator,
  handler: async (ctx, { workspaceId }): Promise<WorkspaceExportResult> => {
    const identity = await getIdentity(ctx);
    if (!identity) {
      throw new ConvexError('Authentication required');
    }
    return createWorkspaceExportForClerk(ctx, {
      workspaceId,
      clerkId: identity.subject,
      source: 'web',
    });
  },
});

export async function handleWorkspaceExportDownload(ctx: ActionCtx, request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token');
  if (!token) {
    return new Response('Missing export token', { status: 400 });
  }

  const tokenHash = await sha256Hex(token);
  const exportDownload = await ctx.runQuery(internal.dataExports.getWorkspaceExportDownload, { tokenHash });
  if (exportDownload.status === 'not_found') {
    return new Response('Export not found', { status: 404 });
  }
  if (exportDownload.status === 'expired') {
    return new Response('Export link has expired', { status: 410 });
  }

  const blob = await ctx.storage.get(exportDownload.storageId);
  if (!blob) {
    return new Response('Export file is no longer available', { status: 404 });
  }

  return new Response(blob, {
    status: 200,
    headers: {
      'content-type': exportDownload.contentType,
      'content-disposition': `attachment; filename="${exportDownload.filename}"`,
      'content-length': String(blob.size),
      'cache-control': 'private, no-store, max-age=0',
      'x-content-type-options': 'nosniff',
    },
  });
}
