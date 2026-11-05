import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { dateToYearMonth } from '../categoryBudgets/calculations';

// Transaction types that should not affect monthlyIncomeActivity (for reports)
// These are balance corrections, not real income/expenses
type TransactionType = 'regular' | 'starting_balance' | 'balance_adjustment' | 'transfer';

/**
 * Centralized helper to update workspace readyToAssign and monthlyIncomeActivity when transaction movements change
 *
 * This function ensures RTA and monthly income activity are correctly updated whenever movements are created, updated, or deleted.
 * Only movements with readyToAssign === true (income movements) affect RTA and monthly income activity.
 *
 * - readyToAssign: Cumulative value (total income - total assigned)
 * - monthlyIncomeActivity: Per-month tracking with inflow/outflow separation for reporting purposes
 *   Note: starting_balance and balance_adjustment transactions are excluded from monthly income activity
 *   as they are balance corrections, not real income/expenses.
 *
 * For monthlyIncomeActivity:
 * - Positive transaction amounts (income) go to inflowAmount
 * - Negative transaction amounts (expenses from RTA) go to outflowAmount
 * - Reversals correctly subtract from the appropriate bucket
 *
 * Usage scenarios:
 * - Creating a new movement: pass newAmount, newReadyToAssign, and transactionDate
 * - Updating a movement: pass oldAmount, oldReadyToAssign, newAmount, newReadyToAssign, and transactionDate
 * - Deleting a movement: pass oldAmount, oldReadyToAssign, and transactionDate
 *
 * @param ctx - Mutation context
 * @param args - Movement change details
 */
export async function updateRTAForMovementChange(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<'workspace'>;
    transactionDate: string; // ISO date string (YYYY-MM-DD)
    transactionType?: TransactionType; // Transaction type to determine if monthly income should be updated
    // Old movement state (for update/delete scenarios)
    oldAmount?: bigint;
    oldReadyToAssign?: boolean;
    // New movement state (for create/update scenarios)
    newAmount?: bigint;
    newReadyToAssign?: boolean;
  }
) {
  const { workspaceId, transactionDate, transactionType, oldAmount, oldReadyToAssign, newAmount, newReadyToAssign } =
    args;

  // Determine if old movement was ready to assign
  const oldWasReadyToAssign = oldAmount !== undefined && oldReadyToAssign === true;

  // Determine if new movement is ready to assign
  const newIsReadyToAssign = newAmount !== undefined && newReadyToAssign === true;

  // Calculate the income delta (affects RTA - cumulative value)
  let incomeDelta = 0n;

  if (oldWasReadyToAssign && newIsReadyToAssign) {
    // Both old and new are ready to assign - update by the difference
    incomeDelta = newAmount! - oldAmount!;
  } else if (oldWasReadyToAssign && !newIsReadyToAssign) {
    // Movement was ready to assign, now not - decrease by old amount
    incomeDelta = -oldAmount!;
  } else if (!oldWasReadyToAssign && newIsReadyToAssign) {
    // Movement was not ready to assign, now is - increase by new amount
    incomeDelta = newAmount!;
  } else {
    // Both are not ready to assign or neither exists - no change
    incomeDelta = 0n;
  }

  // Calculate separate inflow and outflow deltas for monthly income activity
  // This properly handles reversals by subtracting from the correct bucket
  let inflowDelta = 0n;
  let outflowDelta = 0n;

  // Handle old movement being removed (reversal)
  if (oldWasReadyToAssign) {
    if (oldAmount! > 0n) {
      // Old positive amount was inflow - reverse it (subtract from inflow)
      inflowDelta -= oldAmount!;
    } else if (oldAmount! < 0n) {
      // Old negative amount was outflow - reverse it (subtract from outflow)
      // outflowAmount stores positive values, so we subtract the absolute value
      outflowDelta -= -oldAmount!;
    }
  }

  // Handle new movement being added
  if (newIsReadyToAssign) {
    if (newAmount! > 0n) {
      // New positive amount is inflow
      inflowDelta += newAmount!;
    } else if (newAmount! < 0n) {
      // New negative amount is outflow (store as positive)
      outflowDelta += -newAmount!;
    }
  }

  // Only update if there's a change
  if (incomeDelta !== 0n || inflowDelta !== 0n || outflowDelta !== 0n) {
    const yearMonth = dateToYearMonth(transactionDate);

    // Update cumulative readyToAssign (uses single delta)
    if (incomeDelta !== 0n) {
      await ctx.runMutation(internal.workspaces.updateWorkspaceReadyToAssign, {
        workspaceId,
        amountDelta: incomeDelta,
      });
    }

    // Update monthly income tracking for reports (uses separate inflow/outflow deltas)
    // Skip for starting_balance and balance_adjustment transactions as they are not real income/expenses
    const shouldUpdateMonthlyIncome =
      transactionType !== 'starting_balance' && transactionType !== 'balance_adjustment';

    if (shouldUpdateMonthlyIncome && (inflowDelta !== 0n || outflowDelta !== 0n)) {
      await ctx.runMutation(internal.workspaces.updateWorkspaceMonthlyIncome, {
        workspaceId,
        inflowDelta,
        outflowDelta,
        yearMonth,
      });
    }
  }
}

/**
 * Helper to update RTA when creating a new transaction movement
 *
 * @param ctx - Mutation context
 * @param workspaceId - Workspace ID
 * @param transactionDate - ISO date string (YYYY-MM-DD)
 * @param amount - Movement amount
 * @param readyToAssign - Whether movement is ready to assign (true) or not (false)
 * @param transactionType - Transaction type to determine if monthly income should be updated
 */
export async function updateRTAForMovementCreate(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>,
  transactionDate: string,
  amount: bigint,
  readyToAssign: boolean,
  transactionType?: TransactionType
) {
  await updateRTAForMovementChange(ctx, {
    workspaceId,
    transactionDate,
    transactionType,
    newAmount: amount,
    newReadyToAssign: readyToAssign,
  });
}

/**
 * Helper to update RTA when deleting a transaction movement
 *
 * @param ctx - Mutation context
 * @param workspaceId - Workspace ID
 * @param transactionDate - ISO date string (YYYY-MM-DD)
 * @param amount - Movement amount being deleted
 * @param readyToAssign - Whether movement was ready to assign
 * @param transactionType - Transaction type to determine if monthly income should be updated
 */
export async function updateRTAForMovementDelete(
  ctx: MutationCtx,
  workspaceId: Id<'workspace'>,
  transactionDate: string,
  amount: bigint,
  readyToAssign: boolean,
  transactionType?: TransactionType
) {
  await updateRTAForMovementChange(ctx, {
    workspaceId,
    transactionDate,
    transactionType,
    oldAmount: amount,
    oldReadyToAssign: readyToAssign,
  });
}
