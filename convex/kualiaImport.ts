import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id, Doc } from './_generated/dataModel';
import { action } from './_generated/server';
import { requireAuthAction } from './lib/auth';
import { prepareImport, referenced } from './kualiaImport/prepare';
import {
  buildSearchText,
  computeHasUncategorized,
  computeHasMissingPayee,
  isCrossBudgetTransfer,
  isOnBudgetAccountType,
} from './transactions/helpers';

async function insertBatches<Row, LocalId>(rows: Map<string, Row>, insert: (batch: Row[]) => Promise<LocalId[]>) {
  const ids = new Map<string, LocalId>();
  const entries = Array.from(rows);
  for (let i = 0; i < entries.length; i += 32) {
    const batch = entries.slice(i, i + 32);
    const localIds = await insert(batch.map(([, row]) => row));
    batch.forEach(([key], index) => ids.set(key, localIds[index]));
  }
  return ids;
}

export const restore = action({
  args: {
    files: v.array(v.object({ name: v.string(), content: v.string() })),
    name: v.string(),
    currency: v.string(),
    requestId: v.string(),
  },
  returns: v.id('workspace'),
  handler: async (ctx, args): Promise<Id<'workspace'>> => {
    await requireAuthAction(ctx);
    const name = args.name.trim();
    if (!name || name.length > 26) throw new ConvexError('Enter a workspace name of up to 26 characters.');
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(args.requestId)) throw new ConvexError('Invalid import request.');
    let data: ReturnType<typeof prepareImport>;
    try {
      data = prepareImport(args.files, args.currency);
    } catch (error: unknown) {
      throw new ConvexError(error instanceof Error ? error.message : 'Invalid Kualia export.');
    }
    const write = internal.kualiaImport.write;
    const { workspaceId, completed } = await ctx.runMutation(write.begin, {
      name,
      currency: args.currency,
      requestId: args.requestId,
      readyToAssign: data.readyToAssign,
      monthlyIncomeActivity: data.monthlyIncomeActivity,
    });
    if (completed) return workspaceId;
    try {
      const accounts = await insertBatches(data.accounts, (rows) =>
        ctx.runMutation(write.accounts, { workspaceId, rows })
      );
      const groups = await insertBatches(data.groups, (rows) => ctx.runMutation(write.groups, { workspaceId, rows }));
      const categories = await insertBatches(data.categories, (batch) =>
        ctx.runMutation(write.categories, {
          workspaceId,
          rows: batch.map(({ groupKey, accountKey, assignments, snoozed, ...category }) => ({
            category: {
              ...category,
              categoryGroupId: referenced(groups, groupKey, 'group'),
              bankAccountId: accountKey ? referenced(accounts, accountKey, 'account') : undefined,
            },
            budget: { monthlyAssignedAmounts: assignments, snoozedTargetMonths: snoozed },
          })),
        })
      );
      const merchants = await insertBatches(data.merchants, (rows) =>
        ctx.runMutation(write.merchants, { workspaceId, rows })
      );
      const transactions = await insertBatches(new Map(data.transactions.map((t) => [t.key, t])), (batch) =>
        ctx.runMutation(write.transactions, {
          workspaceId,
          rows: batch.map((t) => {
            const merchantId = t.merchantKey ? referenced(merchants, t.merchantKey, 'merchant') : undefined;
            const accountType = referenced(data.accounts, t.accountKey, 'account').accountType;
            const transferType = data.accounts.get(t.transferAccountKey)?.accountType;
            const creditKey = data.creditCategories.get(t.accountKey);
            const creditCardCategoryId = creditKey && t.type !== 'transfer' ? categories.get(creditKey) : undefined;
            const movements: Doc<'transaction'>['movements'] = t.movements.map(({ categoryKey, ...m }) => {
              const categoryId = categoryKey ? referenced(categories, categoryKey, 'category') : undefined;
              return {
                ...m,
                categoryId,
                creditCardTransfer:
                  creditCardCategoryId && categoryId
                    ? { creditCardCategoryId, spendingCategoryId: categoryId }
                    : undefined,
              };
            });
            return {
              bankAccountId: referenced(accounts, t.accountKey, 'account'),
              transferPairBankAccountId: t.transferAccountKey
                ? referenced(accounts, t.transferAccountKey, 'transfer account')
                : undefined,
              merchantId,
              type: t.type,
              source: t.source,
              date: t.date,
              importedCreatedAt: t.importedCreatedAt,
              dateYearMonth: t.dateYearMonth,
              status: t.status,
              reviewStatus: t.reviewStatus,
              notes: t.notes,
              updatedAt: t.updatedAt,
              totalAmount: t.totalAmount,
              isDeleted: false,
              movements,
              hasUncategorized: computeHasUncategorized(
                movements,
                t.type,
                isOnBudgetAccountType(accountType) && isCrossBudgetTransfer(accountType, transferType),
                !isOnBudgetAccountType(accountType)
              ),
              hasMissingPayee: computeHasMissingPayee(merchantId, t.type),
              searchText: buildSearchText(
                t.merchantName,
                movements.map((m) => m.categoryName ?? ''),
                t.totalAmount,
                t.type,
                t.notes
              ),
            };
          }),
        })
      );
      const links = data.transactions
        .filter((t) => t.transferKey)
        .map((t) => ({
          id: referenced(transactions, t.key, 'transaction'),
          pair: referenced(transactions, t.transferKey, 'transfer'),
        }));
      for (let i = 0; i < links.length; i += 100) await ctx.runMutation(write.link, { pairs: links.slice(i, i + 100) });
      await ctx.runMutation(write.finish, { workspaceId });
      return workspaceId;
    } catch (error: unknown) {
      await ctx.runMutation(write.discard, { workspaceId });
      throw error;
    }
  },
});
