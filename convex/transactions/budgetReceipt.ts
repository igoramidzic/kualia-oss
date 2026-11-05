import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { dateToYearMonth } from '../categoryBudgets/calculations';
import { getCalculatedBudgetForMonth } from '../categoryBudgets/helpers';
import { isValidIsoDate } from '../scheduledTransactions/recurrence';

export const budgetChangeValidator = v.object({
  categoryId: v.optional(v.id('category')),
  yearMonth: v.optional(v.number()),
  name: v.string(),
  before: v.int64(),
  after: v.int64(),
});

export type BudgetTarget = { categoryId: Id<'category'>; yearMonth: number };
type CategoryBalance = BudgetTarget & { name: string; before: bigint };
export type BudgetChange = {
  categoryId?: Id<'category'>;
  yearMonth?: number;
  name: string;
  before: bigint;
  after: bigint;
};
type BudgetSnapshot = { categories: CategoryBalance[]; readyToAssign: bigint };

/** Both reads use the same mutation context as the financial write. */
export async function captureBudgetBalances(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>,
  targets: BudgetTarget[]
): Promise<BudgetSnapshot> {
  const unique = new Map(targets.map((target) => [`${target.categoryId}:${target.yearMonth}`, target]));
  if (unique.size > 200) throw new ConvexError('Too many category changes for budget feedback');
  const categories: CategoryBalance[] = [];
  for (const target of unique.values()) {
    const category = await ctx.db.get(target.categoryId);
    if (!category) continue;
    if (category.workspaceId !== workspaceId) throw new ConvexError('Category not found in this workspace');
    const budget = await getCalculatedBudgetForMonth(ctx, workspaceId, target.categoryId, target.yearMonth);
    categories.push({ ...target, name: category.name, before: budget.available });
  }
  const workspace = await ctx.db.get(workspaceId);
  return { categories, readyToAssign: workspace?.readyToAssign ?? 0n };
}

export async function finishBudgetReceipt(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>,
  before: BudgetSnapshot
): Promise<BudgetChange[]> {
  const changes: BudgetChange[] = [];
  for (const previous of before.categories) {
    const budget = await getCalculatedBudgetForMonth(ctx, workspaceId, previous.categoryId, previous.yearMonth);
    if (budget.available !== previous.before) changes.push({ ...previous, after: budget.available });
  }
  const workspace = await ctx.db.get(workspaceId);
  const after = workspace?.readyToAssign ?? 0n;
  if (after !== before.readyToAssign) changes.push({ name: 'Ready to Assign', before: before.readyToAssign, after });
  return changes;
}

/** Include both transfer sides and both old/new categories and months before an edit. */
export async function transactionBudgetTargets(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>,
  transactionIds: Id<'transaction'>[],
  updates: { date?: string; categoryId?: Id<'category'>; movements?: Array<{ categoryId?: Id<'category'> }> } = {}
): Promise<BudgetTarget[]> {
  if (updates.date !== undefined && !isValidIsoDate(updates.date))
    throw new ConvexError('Choose a valid transaction date');
  if (transactionIds.length > 100) throw new ConvexError('Use at most 100 transactions for budget feedback');
  const targets: BudgetTarget[] = [];
  const visited = new Set<Id<'transaction'>>();
  const pending = [...transactionIds];
  for (let index = 0; index < pending.length; index++) {
    const id = pending[index];
    if (visited.has(id)) continue;
    visited.add(id);
    const transaction = await ctx.db.get(id);
    if (!transaction) continue;
    if (transaction.workspaceId !== workspaceId) throw new ConvexError('Transaction not found in this workspace');
    // Follow only the original entries' pairs, rather than an unbounded chain.
    if (index < transactionIds.length && transaction.transferPairId) pending.push(transaction.transferPairId);
    const months = new Set([dateToYearMonth(transaction.date), dateToYearMonth(updates.date ?? transaction.date)]);
    const categories = new Set([
      ...transaction.movements.map((movement) => movement.categoryId),
      ...(updates.movements ?? []).map((movement) => movement.categoryId),
      updates.categoryId,
    ]);
    for (const categoryId of categories) {
      if (!categoryId) continue;
      for (const yearMonth of months) targets.push({ categoryId, yearMonth });
    }
  }
  return targets;
}
