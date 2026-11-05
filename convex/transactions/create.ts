import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { mutation } from '../_generated/server';
import { buildActivityContext, recordTransactionActivity } from '../activityLogs/helpers';
import { updateBankAccountBalance } from '../bankAccounts';
import { dateToYearMonth } from '../categoryBudgets/calculations';
import { requireWorkspaceAccess } from '../lib/auth';
import { updateRTAForMovementCreate } from '../transactionMovement/helpers';

import {
  buildTransactionComputedFields,
  createTransferPair,
  getCreditCardCategoryForAccount,
  isAccountExcludedFromRTA,
  isCreditCardAccount,
  isRefundMovement,
  validateMovements,
} from './helpers';

/**
 * Create a transaction (supports regular, transfer, starting_balance, and balance_adjustment types)
 *
 * @deprecated Use type-specific mutations instead:
 * - createRegularTransaction for regular transactions
 * - createTransferTransaction for transfers
 * - createStartingBalanceTransaction for starting balance
 * - createBalanceAdjustmentTransaction for balance adjustments
 *
 * This mutation is kept for backward compatibility and will be removed in a future version.
 */
export const createTransaction = mutation({
  args: {
    workspaceId: v.id('workspace'),
    type: v.union(
      v.literal('regular'),
      v.literal('transfer'),
      v.literal('starting_balance'),
      v.literal('balance_adjustment')
    ),
    date: v.string(),
    merchantId: v.optional(v.id('merchant')),
    notes: v.optional(v.string()),
    // Regular/starting_balance/balance_adjustment fields
    bankAccountId: v.optional(v.id('bankAccount')),
    movements: v.array(
      v.object({
        amount: v.int64(),
        categoryId: v.optional(v.id('category')),
        readyToAssign: v.optional(v.boolean()),
        notes: v.optional(v.string()),
      })
    ),
    // Transfer-specific fields
    fromAccountId: v.optional(v.id('bankAccount')),
    toAccountId: v.optional(v.id('bankAccount')),
    // Status field (pending or cleared) - defaults to cleared for backward compatibility
    status: v.optional(v.union(v.literal('pending'), v.literal('cleared'))),
  },
  handler: async (ctx, transactionData) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, transactionData.workspaceId);

    // Branch based on transaction type
    if (transactionData.type === 'transfer') {
      // Validate transfer-specific fields
      if (!transactionData.fromAccountId || !transactionData.toAccountId) {
        throw new ConvexError('Transfer requires fromAccountId and toAccountId');
      }

      // Calculate amount from movements (transfers should have a single movement)
      const transferAmount = transactionData.movements.reduce((sum, m) => sum + m.amount, 0n);

      // Validate amount is positive for transfers
      if (transferAmount <= 0n) {
        throw new ConvexError('Transfer amount must be positive');
      }

      // Create the transfer pair and movements (transfers don't have merchants)
      // Note: createTransferPair creates its own movements, so we ignore the provided movements
      const { fromTransactionId } = await createTransferPair(ctx, {
        fromAccountId: transactionData.fromAccountId,
        toAccountId: transactionData.toAccountId,
        amount: transferAmount,
        date: transactionData.date,
        workspaceId: verifiedWorkspaceId,
        notes: transactionData.notes,
      });

      // Update bank account balances (with date for balance history tracking)
      const transferStatus = transactionData.status ?? 'cleared';
      await updateBankAccountBalance(
        ctx,
        transactionData.fromAccountId,
        -transferAmount,
        transactionData.date,
        transferStatus
      );
      await updateBankAccountBalance(
        ctx,
        transactionData.toAccountId,
        transferAmount,
        transactionData.date,
        transferStatus
      );

      const createdTransfer = await ctx.db.get(fromTransactionId);
      if (createdTransfer) {
        await recordTransactionActivity(ctx, {
          workspaceId: verifiedWorkspaceId,
          context: await buildActivityContext(ctx, {
            clerkId: user.subject,
            source: { type: 'kualia_ui' },
          }),
          type: 'transaction_created',
          after: createdTransfer,
        });
      }

      return fromTransactionId;
    } else {
      // Regular, starting_balance, or balance_adjustment transaction

      // Validate regular transaction fields
      if (!transactionData.bankAccountId) {
        throw new ConvexError('Regular transaction requires bankAccountId');
      }

      // Get the bank account to check workspace access
      const bankAccount = await ctx.db.get(transactionData.bankAccountId);
      if (!bankAccount || bankAccount.isDeleted) {
        throw new ConvexError('Bank account not found');
      }

      // Check if bank account belongs to the workspace
      if (bankAccount.workspaceId !== verifiedWorkspaceId) {
        throw new ConvexError('Access denied to workspace');
      }

      // Check if this is a credit card transaction
      const usesCreditCard = await isCreditCardAccount(ctx, transactionData.bankAccountId);

      // Movements are required - calculate amount from movements
      const movements = transactionData.movements;
      const transactionAmount = movements.reduce((sum, m) => sum + m.amount, 0n);

      // Validate movements
      validateMovements(transactionAmount, movements);

      // Build embedded movements with credit card transfer info
      const creditCardCategoryId = usesCreditCard
        ? await getCreditCardCategoryForAccount(ctx, transactionData.bankAccountId)
        : null;

      const embeddedMovementsInput: Array<{
        categoryId?: Id<'category'>;
        readyToAssign: boolean;
        amount: bigint;
        notes?: string;
        sortOrder: number;
        creditCardTransfer?: {
          creditCardCategoryId: Id<'category'>;
          spendingCategoryId: Id<'category'>;
        };
      }> = [];

      for (let i = 0; i < movements.length; i++) {
        const movement = movements[i];
        const readyToAssign = movement.readyToAssign ?? false;
        let creditCardTransfer:
          | {
              creditCardCategoryId: Id<'category'>;
              spendingCategoryId: Id<'category'>;
            }
          | undefined = undefined;

        // Handle credit card transfer for this movement
        if (usesCreditCard && movement.categoryId && creditCardCategoryId) {
          // Create creditCardTransfer object for refund detection
          const tempCreditCardTransfer = {
            creditCardCategoryId,
            spendingCategoryId: movement.categoryId,
          };

          // Detect if this is a refund transaction
          // Note: This code path is for non-transfer transactions
          const isRefund = isRefundMovement(
            {
              amount: movement.amount,
              readyToAssign,
              creditCardTransfer: tempCreditCardTransfer,
            },
            false // Not a transfer transaction
          );

          await ctx.runMutation(internal.categoryBudgets.moveMoneyBetweenCategories, {
            workspaceId: verifiedWorkspaceId,
            fromCategoryId: movement.categoryId,
            toCategoryId: creditCardCategoryId,
            amount: movement.amount,
            transactionDate: transactionData.date,
            isRefund, // Pass refund flag
          });

          creditCardTransfer = tempCreditCardTransfer;
        }

        embeddedMovementsInput.push({
          categoryId: movement.categoryId,
          readyToAssign,
          amount: movement.amount,
          notes: movement.notes,
          sortOrder: i,
          creditCardTransfer,
        });

        // Update budgets for this movement
        if (movement.categoryId && !usesCreditCard) {
          // Update category spending if categorized and NOT a credit card transaction
          // (credit card transactions are handled by moveMoneyBetweenCategories)
          await ctx.runMutation(internal.categoryBudgets.updateCategorySpendingForTransaction, {
            workspaceId: verifiedWorkspaceId,
            categoryId: movement.categoryId,
            transactionDate: transactionData.date,
            amountDelta: movement.amount,
            transactionCountDelta: 1n, // Increment transaction count for this category
          });
        }

        // Update readyToAssign if movement is ready to assign (centralized helper handles the logic)
        // But only for banking accounts - credit cards, loans, and investments don't affect RTA
        const isExcludedFromRTA = await isAccountExcludedFromRTA(ctx, transactionData.bankAccountId);

        if (!isExcludedFromRTA) {
          await updateRTAForMovementCreate(
            ctx,
            verifiedWorkspaceId,
            transactionData.date,
            movement.amount,
            readyToAssign,
            transactionData.type
          );
        }
      }

      // Build computed fields (movements with category names, searchText, totalAmount, hasUncategorized)
      const computedFields = await buildTransactionComputedFields(ctx, {
        merchantId: transactionData.merchantId,
        bankAccountId: transactionData.bankAccountId,
        transactionType: transactionData.type,
        movements: embeddedMovementsInput,
        notes: transactionData.notes,
      });

      // Create the transaction with embedded movements
      const transactionId = await ctx.db.insert('transaction', {
        bankAccountId: transactionData.bankAccountId,
        date: transactionData.date,
        merchantId: transactionData.merchantId,
        notes: transactionData.notes,
        status: transactionData.status ?? 'cleared',
        type: transactionData.type,
        isDeleted: false,
        source: 'manual',
        reviewStatus: 'reviewed',
        updatedAt: new Date().toISOString(),
        workspaceId: verifiedWorkspaceId,
        dateYearMonth: dateToYearMonth(transactionData.date),
        // Embedded movements and computed fields
        movements: computedFields.movements,
        searchText: computedFields.searchText,
        totalAmount: computedFields.totalAmount,
        hasUncategorized: computedFields.hasUncategorized,
        hasMissingPayee: computedFields.hasMissingPayee,
      });

      // Update bank account balance (with date for balance history tracking)
      await updateBankAccountBalance(
        ctx,
        transactionData.bankAccountId,
        transactionAmount,
        transactionData.date,
        transactionData.status ?? 'cleared'
      );

      const createdTransaction = await ctx.db.get(transactionId);
      if (createdTransaction) {
        await recordTransactionActivity(ctx, {
          workspaceId: verifiedWorkspaceId,
          context: await buildActivityContext(ctx, {
            clerkId: user.subject,
            source: { type: 'kualia_ui' },
          }),
          type: 'transaction_created',
          after: createdTransaction,
        });
      }

      return transactionId;
    }
  },
});
