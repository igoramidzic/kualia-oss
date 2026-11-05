import { ConvexError, type Infer, v } from 'convex/values';

import { type MutationCtx, mutation } from '../../_generated/server';
import { dateToYearMonth } from '../../categoryBudgets/calculations';
import { requireWorkspaceAccess } from '../../lib/auth';
import { getCurrentDateForTimezone } from '../../lib/dates';
import { isValidIsoDate } from '../../scheduledTransactions/recurrence';
import { getScheduledTransactionType } from '../../scheduledTransactions/types';
import { budgetChangeValidator, captureBudgetBalances, finishBudgetReceipt } from '../budgetReceipt';
import { isOnBudgetAccountType } from '../helpers';
import { updateLinkedScheduledTransaction } from '../update';
import { createRegularTransactionHandler, regularCreationArgs } from './createRegular';
import { createTransferTransactionHandler, transferCreationArgs } from './createTransfer';

const creationReceiptValidator = v.object({
  transactionId: v.optional(v.id('transaction')),
  scheduledTransactionId: v.optional(v.id('scheduledTransaction')),
  budgetChanges: v.array(budgetChangeValidator),
});

const plannedLinkArgs = {
  linkedScheduledTransactionId: v.optional(v.id('scheduledTransaction')),
  linkedScheduledOccurrenceDate: v.optional(v.string()),
};
const regularEditorArgs = regularCreationArgs.extend(plannedLinkArgs);
const transferEditorArgs = transferCreationArgs.extend(plannedLinkArgs);

type EditorCreationArgs =
  | (Infer<typeof regularEditorArgs> & { type: 'regular' })
  | (Infer<typeof transferEditorArgs> & { type: 'transfer' });

/** Capture both balances in the creation transaction, including concurrent-write retries. */
async function createWithBudgetReceipt(ctx: MutationCtx, args: EditorCreationArgs) {
  const { workspaceId } = await requireWorkspaceAccess(ctx, args.workspaceId);
  if (!isValidIsoDate(args.date)) throw new ConvexError('date must be a valid YYYY-MM-DD date');
  const accountIds = args.type === 'regular' ? [args.bankAccountId] : [args.fromAccountId, args.toAccountId];
  const accounts = await Promise.all(accountIds.map((id) => ctx.db.get(id)));
  for (const account of accounts) {
    if (!account || account.isDeleted || account.isClosed || account.workspaceId !== workspaceId) {
      throw new ConvexError('Choose an open account in this workspace');
    }
  }
  const onBudget = accounts.map((account) => account !== null && isOnBudgetAccountType(account.accountType));
  const affectsCategories = args.type === 'regular' ? onBudget[0] : onBudget[0] !== onBudget[1];
  const movements = args.type === 'regular' ? args.movements : [args];
  if (movements.length > 100) throw new ConvexError('Use at most 100 category lines');
  const workspace = await ctx.db.get(workspaceId);
  const isFuture = args.date > getCurrentDateForTimezone(workspace?.timezone);
  if (args.linkedScheduledTransactionId) {
    if (isFuture || (args.recurrence ?? 'once') !== 'once') {
      throw new ConvexError('Choose either an existing planned transaction or a new schedule');
    }
    const planned = await ctx.db.get(args.linkedScheduledTransactionId);
    if (!planned || planned.isDeleted || planned.workspaceId !== workspaceId || planned.status !== 'active') {
      throw new ConvexError('Choose an available planned transaction in this workspace');
    }
    if (
      getScheduledTransactionType(planned) !== args.type ||
      planned.bankAccountId !== (args.type === 'regular' ? args.bankAccountId : args.fromAccountId) ||
      (args.type === 'transfer' && planned.transferToAccountId !== args.toAccountId)
    ) {
      throw new ConvexError('Planned transaction must match the transaction type and accounts');
    }
  }
  const yearMonth = dateToYearMonth(args.date);
  const targets =
    !isFuture && affectsCategories
      ? movements.flatMap((movement) => (movement.categoryId ? [{ categoryId: movement.categoryId, yearMonth }] : []))
      : [];
  const before = await captureBudgetBalances(ctx, workspaceId, targets);
  // Share the existing creation/scheduling bodies, without an extra mutation round trip.
  const { linkedScheduledTransactionId, linkedScheduledOccurrenceDate, ...creationArgs } = args;
  const result =
    creationArgs.type === 'regular'
      ? await createRegularTransactionHandler(ctx, creationArgs)
      : await createTransferTransactionHandler(ctx, creationArgs);
  if (linkedScheduledTransactionId) {
    const transactionId = typeof result === 'string' ? result : result.transactionId;
    const transaction = transactionId ? await ctx.db.get(transactionId) : null;
    if (!transaction) throw new ConvexError('Created transaction not found');
    await updateLinkedScheduledTransaction(
      ctx,
      transaction,
      workspaceId,
      linkedScheduledTransactionId,
      linkedScheduledOccurrenceDate
    );
  }
  const budgetChanges = await finishBudgetReceipt(ctx, workspaceId, before);
  return {
    ...(typeof result === 'string'
      ? { transactionId: result }
      : {
          transactionId: result.transactionId,
          scheduledTransactionId: result.scheduledTransactionId,
        }),
    budgetChanges,
  };
}

export const createTransactionFromEditor = mutation({
  args: regularEditorArgs,
  returns: creationReceiptValidator,
  handler: (ctx, args) => createWithBudgetReceipt(ctx, { ...args, type: 'regular' }),
});

export const createTransferFromEditor = mutation({
  args: transferEditorArgs,
  returns: creationReceiptValidator,
  handler: (ctx, args) => createWithBudgetReceipt(ctx, { ...args, type: 'transfer' }),
});
