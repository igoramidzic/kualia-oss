import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { mutation } from '../_generated/server';
import { buildActivityContext, recordTransactionActivity } from '../activityLogs/helpers';
import { dateToYearMonth } from '../categoryBudgets/calculations';
import { requireWorkspaceAccess } from '../lib/auth';

import {
  buildTransactionComputedFields,
  createTransferPair,
  isCrossBudgetTransfer,
  isOnBudgetAccountType,
  validateMovements,
} from './helpers';
import { buildSnapshotFromTransaction } from './reconciliation/buildSnapshot';
import { reconcileTransactionSideEffects } from './reconciliation/reconcile';

// ==============================================================
// INTERNAL HELPER FUNCTIONS (used by updateTransaction)
// ==============================================================

/**
 * Internal helper: Update a transfer transaction (updates both sides)
 * Note: Transfers do not support merchants
 */
export async function updateTransferInternal(
  ctx: MutationCtx,
  args: {
    transactionId: Id<'transaction'>;
    fromAccountId?: Id<'bankAccount'>;
    toAccountId?: Id<'bankAccount'>;
    amount?: bigint;
    date?: string;
    // undefined = no change; null = clear; string = set
    notes?: string | null;
    categoryId?: Id<'category'>;
    readyToAssign?: boolean;
    preserveMovementNotes?: boolean;
  }
): Promise<{ success: boolean }> {
  // Normalize notes: null clears (stored as undefined), undefined preserves existing
  const resolveNotes = (existing: string | undefined): string | undefined => {
    if (args.notes === undefined) return existing;
    if (args.notes === null) return undefined;
    return args.notes;
  };
  // Get the transaction
  const transaction = await ctx.db.get(args.transactionId);
  if (!transaction || transaction.isDeleted) {
    throw new ConvexError('Transaction not found');
  }

  // Verify it's a transfer
  if (transaction.type !== 'transfer') {
    throw new ConvexError('Transaction is not a transfer');
  }

  // Verify it has a pair
  if (!transaction.transferPairId) {
    throw new ConvexError('Transfer pair not found');
  }

  // Get the paired transaction
  const pairedTransaction = await ctx.db.get(transaction.transferPairId);
  if (!pairedTransaction || pairedTransaction.isDeleted) {
    throw new ConvexError('Transfer pair not found');
  }

  // Get movements from embedded arrays
  const transactionMovements = transaction.movements ?? [];
  const pairedMovements = pairedTransaction.movements ?? [];

  const transactionAmount = transaction.totalAmount ?? transactionMovements.reduce((sum, m) => sum + m.amount, 0n);

  // Determine which is from/to based on amount signs
  const isFromTransaction = transactionAmount < 0n;
  let fromTransaction = isFromTransaction ? transaction : pairedTransaction;
  let toTransaction = isFromTransaction ? pairedTransaction : transaction;
  let fromMovements = isFromTransaction ? transactionMovements : pairedMovements;
  let toMovements = isFromTransaction ? pairedMovements : transactionMovements;

  // Build "before" snapshots for both sides
  const beforeFromSnapshot = await buildSnapshotFromTransaction(ctx, fromTransaction);
  const beforeToSnapshot = await buildSnapshotFromTransaction(ctx, toTransaction);

  // Get current accounts (may be swapped later if direction reverses)
  let currentFromAccountId = fromTransaction.bankAccountId;
  let currentToAccountId = toTransaction.bankAccountId;

  // Handle amount update with potential direction reversal
  let newAmount: bigint;

  if (args.amount !== undefined) {
    // Check if user is trying to reverse the transfer direction
    // If they're viewing the "from" side (negative) and provide a positive amount,
    // or viewing the "to" side (positive) and provide a negative amount,
    // they want to reverse the direction
    const userProvidedSign = args.amount < 0n ? -1 : 1;
    const currentSign = transactionAmount < 0n ? -1 : 1;

    if (userProvidedSign !== currentSign) {
      // User wants to reverse the direction - swap from/to
      const temp = fromTransaction;
      fromTransaction = toTransaction;
      toTransaction = temp;
      const tempAccountId = currentFromAccountId;
      currentFromAccountId = currentToAccountId;
      currentToAccountId = tempAccountId;
      const tempMovements = fromMovements;
      fromMovements = toMovements;
      toMovements = tempMovements;
    }

    // Use absolute value of the provided amount
    newAmount = args.amount < 0n ? -args.amount : args.amount;
  } else {
    // No amount change, use current amount (as positive number)
    const originalFromAmount = fromMovements.reduce((sum, m) => sum + m.amount, 0n);
    newAmount = originalFromAmount < 0n ? -originalFromAmount : originalFromAmount;
  }

  // Validate new amount is positive
  if (newAmount <= 0n) {
    throw new ConvexError('Transfer amount must be greater than zero');
  }

  // Determine new accounts (taking into account any direction reversal)
  const newFromAccountId = args.fromAccountId ?? currentFromAccountId;
  const newToAccountId = args.toAccountId ?? currentToAccountId;

  // Validate that from and to accounts are different
  if (newFromAccountId === newToAccountId) {
    throw new ConvexError('Cannot transfer to the same account');
  }

  const now = new Date().toISOString();

  // Look up account types for cross-budget detection
  const newFromAccount = await ctx.db.get(newFromAccountId);
  const newToAccount = await ctx.db.get(newToAccountId);
  const fromAccountType = newFromAccount?.accountType;
  const toAccountType = newToAccount?.accountType;
  const isCrossBudget = isCrossBudgetTransfer(fromAccountType, toAccountType);
  const fromIsOnBudget = fromAccountType ? isOnBudgetAccountType(fromAccountType) : false;

  // Determine category for cross-budget transfers
  // If categoryId/readyToAssign provided in args, use those
  // Otherwise preserve existing category from the on-budget side's movement
  let crossBudgetCategoryId = args.categoryId;
  let crossBudgetReadyToAssign = args.readyToAssign ?? false;
  if (isCrossBudget && args.categoryId === undefined && args.readyToAssign === undefined) {
    // Preserve existing category from whichever side is on-budget
    const existingFromMovements = fromTransaction.movements ?? [];
    const existingToMovements = toTransaction.movements ?? [];
    const onBudgetMovements = fromIsOnBudget ? existingFromMovements : existingToMovements;
    if (onBudgetMovements.length > 0) {
      crossBudgetCategoryId = onBudgetMovements[0].categoryId;
      crossBudgetReadyToAssign = onBudgetMovements[0].readyToAssign;
    }
  }

  // Build embedded movements for both transactions
  const fromMovementsInput = [
    {
      categoryId: isCrossBudget && fromIsOnBudget ? crossBudgetCategoryId : undefined,
      readyToAssign: isCrossBudget && fromIsOnBudget ? crossBudgetReadyToAssign : false,
      amount: -newAmount,
      notes: args.preserveMovementNotes ? fromMovements[0]?.notes : undefined,
      sortOrder: 0,
    },
  ];

  const toMovementsInput = [
    {
      categoryId: isCrossBudget && !fromIsOnBudget ? crossBudgetCategoryId : undefined,
      readyToAssign: isCrossBudget && !fromIsOnBudget ? crossBudgetReadyToAssign : false,
      amount: newAmount,
      notes: args.preserveMovementNotes ? toMovements[0]?.notes : undefined,
      sortOrder: 0,
    },
  ];

  const newFromNotes = resolveNotes(fromTransaction.notes);
  const newToNotes = resolveNotes(toTransaction.notes);

  // Build computed fields for both transactions
  const fromComputedFields = await buildTransactionComputedFields(ctx, {
    merchantId: undefined,
    bankAccountId: newFromAccountId,
    transactionType: 'transfer',
    isCrossBudgetOnBudgetSide: isCrossBudget && fromIsOnBudget,
    notes: newFromNotes,
    movements: fromMovementsInput,
  });

  const toComputedFields = await buildTransactionComputedFields(ctx, {
    merchantId: undefined,
    bankAccountId: newToAccountId,
    transactionType: 'transfer',
    isCrossBudgetOnBudgetSide: isCrossBudget && !fromIsOnBudget,
    notes: newToNotes,
    movements: toMovementsInput,
  });

  // Update both transactions (transfers don't have merchants)
  await ctx.db.patch(fromTransaction._id, {
    bankAccountId: newFromAccountId,
    date: args.date ?? fromTransaction.date,
    notes: newFromNotes,
    merchantId: undefined,
    movements: fromComputedFields.movements,
    searchText: fromComputedFields.searchText,
    totalAmount: fromComputedFields.totalAmount,
    hasUncategorized: fromComputedFields.hasUncategorized,
    transferPairBankAccountId: newToAccountId,
    updatedAt: now,
  });

  await ctx.db.patch(toTransaction._id, {
    bankAccountId: newToAccountId,
    date: args.date ?? toTransaction.date,
    notes: newToNotes,
    merchantId: undefined,
    movements: toComputedFields.movements,
    searchText: toComputedFields.searchText,
    totalAmount: toComputedFields.totalAmount,
    hasUncategorized: toComputedFields.hasUncategorized,
    transferPairBankAccountId: newFromAccountId,
    updatedAt: now,
  });

  // Re-read both transactions from DB for accurate "after" snapshots
  const updatedFromTransaction = await ctx.db.get(fromTransaction._id);
  const updatedToTransaction = await ctx.db.get(toTransaction._id);

  if (!updatedFromTransaction || !updatedToTransaction) {
    throw new ConvexError('Failed to read back updated transfer transactions');
  }

  // Build "after" snapshots and reconcile
  const afterFromSnapshot = await buildSnapshotFromTransaction(ctx, updatedFromTransaction);
  const afterToSnapshot = await buildSnapshotFromTransaction(ctx, updatedToTransaction);

  await reconcileTransactionSideEffects(ctx, beforeFromSnapshot, afterFromSnapshot);
  await reconcileTransactionSideEffects(ctx, beforeToSnapshot, afterToSnapshot);

  return { success: true };
}

/**
 * Internal helper: Convert a regular transaction to a transfer transaction
 */
export async function convertToTransferInternal(
  ctx: MutationCtx,
  args: {
    transactionId: Id<'transaction'>;
    toAccountId: Id<'bankAccount'>;
    preserveDirection?: boolean;
  }
): Promise<{ success: boolean; pairedTransactionId: Id<'transaction'> }> {
  // Get the transaction
  const transaction = await ctx.db.get(args.transactionId);
  if (!transaction || transaction.isDeleted) {
    throw new ConvexError('Transaction not found');
  }

  // Cannot convert a transfer to a transfer
  if (transaction.type === 'transfer') {
    throw new ConvexError('Transaction is already a transfer');
  }

  // Prevent transfer to same account
  if (transaction.bankAccountId === args.toAccountId) {
    throw new ConvexError('Cannot transfer to the same account');
  }

  // Build "before" snapshot for the regular transaction
  const beforeSnapshot = await buildSnapshotFromTransaction(ctx, transaction);

  // Reverse old side effects (regular transaction going away)
  await reconcileTransactionSideEffects(ctx, beforeSnapshot, null);

  // Calculate transaction amount from movements (use totalAmount if available)
  const movements = transaction.movements ?? [];
  const transactionAmount = transaction.totalAmount ?? movements.reduce((sum, m) => sum + m.amount, 0n);

  // Convert the transaction amount to positive for the transfer
  const transferAmount = transactionAmount < 0n ? -transactionAmount : transactionAmount;
  const originalSideAmount = args.preserveDirection ? transactionAmount : -transferAmount;

  const now = new Date().toISOString();

  // Determine cross-budget status and preserve category on on-budget side
  const fromAccount = await ctx.db.get(transaction.bankAccountId);
  const toAccount = await ctx.db.get(args.toAccountId);
  const fromAccountType = fromAccount?.accountType;
  const toAccountType = toAccount?.accountType;
  const isCrossBudget = isCrossBudgetTransfer(fromAccountType, toAccountType);
  const fromIsOnBudget = fromAccountType ? isOnBudgetAccountType(fromAccountType) : false;

  // For cross-budget conversions, preserve category from the original transaction on the on-budget side
  const existingCategoryId = movements.length > 0 ? movements[0].categoryId : undefined;
  const existingReadyToAssign = movements.length > 0 ? movements[0].readyToAssign : false;

  // Build embedded movements for both transactions
  const fromMovementsInput = [
    {
      categoryId: isCrossBudget && fromIsOnBudget ? existingCategoryId : undefined,
      readyToAssign: isCrossBudget && fromIsOnBudget ? existingReadyToAssign : false,
      amount: originalSideAmount,
      notes: undefined,
      sortOrder: 0,
    },
  ];

  const toMovementsInput = [
    {
      categoryId: isCrossBudget && !fromIsOnBudget ? existingCategoryId : undefined,
      readyToAssign: isCrossBudget && !fromIsOnBudget ? existingReadyToAssign : false,
      amount: -originalSideAmount,
      notes: undefined,
      sortOrder: 0,
    },
  ];

  // Build computed fields for both transactions
  const fromComputedFields = await buildTransactionComputedFields(ctx, {
    merchantId: undefined,
    bankAccountId: transaction.bankAccountId,
    transactionType: 'transfer',
    isCrossBudgetOnBudgetSide: isCrossBudget && fromIsOnBudget,
    notes: transaction.notes,
    movements: fromMovementsInput,
  });

  const toComputedFields = await buildTransactionComputedFields(ctx, {
    merchantId: undefined,
    bankAccountId: args.toAccountId,
    transactionType: 'transfer',
    isCrossBudgetOnBudgetSide: isCrossBudget && !fromIsOnBudget,
    notes: transaction.notes,
    movements: toMovementsInput,
  });

  // Update the transaction to be a transfer (this becomes the "from" transaction)
  // Clear transfer suggestion if present — user manually converted to transfer
  const clearedSuggestion = transaction.suggestedTransfer
    ? { suggestedTransfer: { ...transaction.suggestedTransfer, status: 'rejected' as const } }
    : {};

  await ctx.db.patch(args.transactionId, {
    type: 'transfer',
    merchantId: undefined,
    reviewStatus: 'reviewed',
    ...clearedSuggestion,
    movements: fromComputedFields.movements,
    searchText: fromComputedFields.searchText,
    totalAmount: fromComputedFields.totalAmount,
    hasUncategorized: fromComputedFields.hasUncategorized,
    hasMissingPayee: fromComputedFields.hasMissingPayee,
    updatedAt: now,
  });

  // Create the paired "to" transaction (transfers don't have merchants)
  const toTransactionId = await ctx.db.insert('transaction', {
    bankAccountId: args.toAccountId,
    type: 'transfer',
    date: transaction.date,
    workspaceId: transaction.workspaceId,
    notes: transaction.notes,
    merchantId: undefined,
    isDeleted: false,
    status: transaction.status,
    source: 'manual',
    reviewStatus: 'reviewed',
    dateYearMonth: dateToYearMonth(transaction.date),
    movements: toComputedFields.movements,
    searchText: toComputedFields.searchText,
    totalAmount: toComputedFields.totalAmount,
    hasUncategorized: toComputedFields.hasUncategorized,
    hasMissingPayee: toComputedFields.hasMissingPayee,
    updatedAt: now,
  });

  // Link them
  await ctx.db.patch(args.transactionId, {
    transferPairId: toTransactionId,
    transferPairBankAccountId: args.toAccountId,
  });
  await ctx.db.patch(toTransactionId, {
    transferPairId: args.transactionId,
    transferPairBankAccountId: transaction.bankAccountId,
  });

  // Mark pending transfer match as user_rejected if one exists
  if (transaction.suggestedTransfer) {
    const pendingMatch = await ctx.db
      .query('pendingTransferMatch')
      .withIndex('by_sourceTransactionId', (q) => q.eq('sourceTransactionId', args.transactionId))
      .first();

    if (pendingMatch) {
      await ctx.db.patch(pendingMatch._id, {
        status: 'user_rejected',
        updatedAt: now,
      });
    }
  }

  // Re-read both transactions from DB for accurate "after" snapshots
  const updatedFromTransaction = await ctx.db.get(args.transactionId);
  const updatedToTransaction = await ctx.db.get(toTransactionId);

  if (!updatedFromTransaction || !updatedToTransaction) {
    throw new ConvexError('Failed to read back transfer transactions');
  }

  // Build "after" snapshots and reconcile new side effects
  const afterFromSnapshot = await buildSnapshotFromTransaction(ctx, updatedFromTransaction);
  const afterToSnapshot = await buildSnapshotFromTransaction(ctx, updatedToTransaction);

  await reconcileTransactionSideEffects(ctx, null, afterFromSnapshot);
  await reconcileTransactionSideEffects(ctx, null, afterToSnapshot);

  return { success: true, pairedTransactionId: toTransactionId };
}

/**
 * Internal helper: Convert a transfer transaction back to a regular transaction
 */
export async function convertFromTransferInternal(
  ctx: MutationCtx,
  args: {
    transactionId: Id<'transaction'>;
  }
): Promise<{ success: boolean }> {
  // Get the transaction
  const transaction = await ctx.db.get(args.transactionId);
  if (!transaction || transaction.isDeleted) {
    throw new ConvexError('Transaction not found');
  }

  // Must be a transfer
  if (transaction.type !== 'transfer') {
    throw new ConvexError('Transaction is not a transfer');
  }

  // Get the paired transaction
  const pairedTransaction = transaction.transferPairId ? await ctx.db.get(transaction.transferPairId) : null;
  if (
    transaction.transferPairId &&
    (!pairedTransaction ||
      pairedTransaction.isDeleted ||
      pairedTransaction.workspaceId !== transaction.workspaceId ||
      pairedTransaction.transferPairId !== transaction._id)
  ) {
    throw new ConvexError('Transfer pair not found');
  }

  // Build "before" snapshots for both sides
  const beforeMainSnapshot = await buildSnapshotFromTransaction(ctx, transaction);
  const beforePairedSnapshot = pairedTransaction ? await buildSnapshotFromTransaction(ctx, pairedTransaction) : null;

  const now = new Date().toISOString();

  // If the paired transaction is an imported transaction, revert it to regular instead of deleting
  if (
    pairedTransaction &&
    (pairedTransaction.transactionImportRawId || pairedTransaction.financeKitTransactionImportId)
  ) {
    // Build movements for the reverted regular transaction
    const pairedAmount =
      pairedTransaction.totalAmount ?? (pairedTransaction.movements ?? []).reduce((sum, m) => sum + m.amount, 0n);
    const pairedMovementsInput = [
      {
        categoryId: undefined,
        readyToAssign: false,
        amount: pairedAmount,
        notes: undefined,
        sortOrder: 0,
      },
    ];

    const pairedComputedFields = await buildTransactionComputedFields(ctx, {
      merchantId: pairedTransaction.merchantId,
      bankAccountId: pairedTransaction.bankAccountId,
      transactionType: 'regular',
      notes: pairedTransaction.notes,
      movements: pairedMovementsInput,
    });

    await ctx.db.patch(pairedTransaction._id, {
      type: 'regular',
      transferPairId: undefined,
      transferPairBankAccountId: undefined,
      movements: pairedComputedFields.movements,
      searchText: pairedComputedFields.searchText,
      totalAmount: pairedComputedFields.totalAmount,
      hasUncategorized: pairedComputedFields.hasUncategorized,
      hasMissingPayee: pairedComputedFields.hasMissingPayee,
      reviewStatus: 'needs_review',
      updatedAt: now,
    });

    const updatedPaired = await ctx.db.get(pairedTransaction._id);
    if (updatedPaired) {
      const afterPairedSnapshot = await buildSnapshotFromTransaction(ctx, updatedPaired);
      await reconcileTransactionSideEffects(ctx, beforePairedSnapshot, afterPairedSnapshot);
    }
  } else if (pairedTransaction) {
    // Soft delete the paired transaction (manually created pair)
    await ctx.db.patch(pairedTransaction._id, {
      isDeleted: true,
      deletedAt: now,
    });

    // Reverse paired transaction side effects
    await reconcileTransactionSideEffects(ctx, beforePairedSnapshot, null);
  }

  // Get current transaction movements from embedded array
  const currentMovements = transaction.movements ?? [];

  // Calculate transaction amount (use totalAmount if available)
  const transactionAmount = transaction.totalAmount ?? currentMovements.reduce((sum, m) => sum + m.amount, 0n);

  // Build embedded movement for the converted regular transaction
  const newMovementsInput = [
    {
      categoryId: undefined,
      readyToAssign: false,
      amount: transactionAmount,
      notes: undefined,
      sortOrder: 0,
    },
  ];

  // Build computed fields for the converted transaction
  const computedFields = await buildTransactionComputedFields(ctx, {
    merchantId: undefined,
    bankAccountId: transaction.bankAccountId,
    transactionType: 'regular',
    notes: transaction.notes,
    movements: newMovementsInput,
  });

  // Convert to regular transaction type with embedded movements
  await ctx.db.patch(args.transactionId, {
    type: 'regular',
    transferPairId: undefined,
    transferPairBankAccountId: undefined,
    movements: computedFields.movements,
    searchText: computedFields.searchText,
    totalAmount: computedFields.totalAmount,
    hasUncategorized: computedFields.hasUncategorized,
    hasMissingPayee: computedFields.hasMissingPayee,
    updatedAt: now,
  });

  // Re-read the main transaction from DB for accurate "after" snapshot
  const updatedMainTransaction = await ctx.db.get(args.transactionId);

  if (!updatedMainTransaction) {
    throw new ConvexError('Failed to read back converted transaction');
  }

  // Build "after" snapshot and reconcile main transaction side effects
  const afterMainSnapshot = await buildSnapshotFromTransaction(ctx, updatedMainTransaction);

  await reconcileTransactionSideEffects(ctx, beforeMainSnapshot, afterMainSnapshot);

  return { success: true };
}

// ==============================================================
// PUBLIC MUTATIONS (for backward compatibility during migration)
// ==============================================================

/**
 * Create a transfer transaction between two bank accounts
 */
export const createTransfer = mutation({
  args: {
    workspaceId: v.id('workspace'),
    fromAccountId: v.id('bankAccount'),
    toAccountId: v.id('bankAccount'),
    amount: v.int64(), // Positive number
    date: v.string(),
    notes: v.optional(v.string()),
    merchantId: v.optional(v.id('merchant')),
    categoryId: v.optional(v.id('category')),
    readyToAssign: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, args.workspaceId);

    // Create the transfer pair
    const { fromTransactionId, toTransactionId } = await createTransferPair(ctx, {
      ...args,
      workspaceId: verifiedWorkspaceId,
    });

    // Read back both transactions to build snapshots
    const fromTransaction = await ctx.db.get(fromTransactionId);
    const toTransaction = await ctx.db.get(toTransactionId);

    if (!fromTransaction || !toTransaction) {
      throw new ConvexError('Failed to read back transfer transactions');
    }

    // Build snapshots and reconcile side effects for both sides
    const fromSnapshot = await buildSnapshotFromTransaction(ctx, fromTransaction);
    const toSnapshot = await buildSnapshotFromTransaction(ctx, toTransaction);

    await reconcileTransactionSideEffects(ctx, null, fromSnapshot);
    await reconcileTransactionSideEffects(ctx, null, toSnapshot);

    await recordTransactionActivity(ctx, {
      workspaceId: verifiedWorkspaceId,
      context: await buildActivityContext(ctx, {
        clerkId: user.subject,
        source: { type: 'kualia_ui' },
      }),
      type: 'transaction_created',
      after: fromTransaction,
    });

    return { fromTransactionId, toTransactionId };
  },
});

/**
 * Update a transfer transaction (updates both sides)
 */
export const updateTransfer = mutation({
  args: {
    transactionId: v.id('transaction'), // Either side of the transfer
    workspaceId: v.id('workspace'),
    fromAccountId: v.optional(v.id('bankAccount')),
    toAccountId: v.optional(v.id('bankAccount')),
    amount: v.optional(v.int64()), // Positive number
    date: v.optional(v.string()),
    notes: v.optional(v.string()),
    merchantId: v.optional(v.id('merchant')),
    categoryId: v.optional(v.id('category')),
    readyToAssign: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, args.workspaceId);

    // Get the transaction
    const transaction = await ctx.db.get(args.transactionId);
    if (!transaction || transaction.isDeleted) {
      throw new ConvexError('Transaction not found');
    }

    // Verify workspace access
    if (transaction.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Access denied to workspace');
    }

    // Verify it's a transfer
    if (transaction.type !== 'transfer') {
      throw new ConvexError('Transaction is not a transfer');
    }

    // Verify it has a pair
    if (!transaction.transferPairId) {
      throw new ConvexError('Transfer pair not found');
    }

    // Get the paired transaction
    const pairedTransaction = await ctx.db.get(transaction.transferPairId);
    if (!pairedTransaction || pairedTransaction.isDeleted) {
      throw new ConvexError('Transfer pair not found');
    }

    // Get movements from embedded arrays
    const transactionMovements = transaction.movements ?? [];
    const pairedMovements = pairedTransaction.movements ?? [];

    const transactionAmount = transaction.totalAmount ?? transactionMovements.reduce((sum, m) => sum + m.amount, 0n);

    // Determine which is from/to based on amount signs
    const isFromTransaction = transactionAmount < 0n;
    const fromTransaction = isFromTransaction ? transaction : pairedTransaction;
    const toTransaction = isFromTransaction ? pairedTransaction : transaction;
    const fromMovements = isFromTransaction ? transactionMovements : pairedMovements;

    // Build "before" snapshots for both sides
    const beforeFromSnapshot = await buildSnapshotFromTransaction(ctx, fromTransaction);
    const beforeToSnapshot = await buildSnapshotFromTransaction(ctx, toTransaction);

    // Get current accounts
    const currentFromAccountId = fromTransaction.bankAccountId;
    const currentToAccountId = toTransaction.bankAccountId;

    // Determine new accounts
    const newFromAccountId = args.fromAccountId ?? currentFromAccountId;
    const newToAccountId = args.toAccountId ?? currentToAccountId;

    // Validate that from and to accounts are different
    if (newFromAccountId === newToAccountId) {
      throw new ConvexError('Cannot transfer to the same account');
    }

    // Get current amount (as positive number) from movements
    const fromAmount = fromMovements.reduce((sum, m) => sum + m.amount, 0n);
    const currentAmount = fromAmount < 0n ? -fromAmount : fromAmount;

    // Determine new amount
    const newAmount = args.amount ?? currentAmount;

    // Validate new amount is positive
    if (newAmount <= 0n) {
      throw new ConvexError('Transfer amount must be positive');
    }

    const now = new Date().toISOString();

    // Look up account types for cross-budget detection
    const newFromAccount = await ctx.db.get(newFromAccountId);
    const newToAccount = await ctx.db.get(newToAccountId);
    const fromAccountType = newFromAccount?.accountType;
    const toAccountType = newToAccount?.accountType;
    const isCrossBudget = isCrossBudgetTransfer(fromAccountType, toAccountType);
    const fromIsOnBudget = fromAccountType ? isOnBudgetAccountType(fromAccountType) : false;

    // Determine category for cross-budget transfers
    let crossBudgetCategoryId = args.categoryId;
    let crossBudgetReadyToAssign = args.readyToAssign ?? false;
    if (isCrossBudget && args.categoryId === undefined && args.readyToAssign === undefined) {
      // Preserve existing category from the on-budget side
      const existingFromMovements = fromTransaction.movements ?? [];
      const existingToMovements = toTransaction.movements ?? [];
      const onBudgetMovements = fromIsOnBudget ? existingFromMovements : existingToMovements;
      if (onBudgetMovements.length > 0) {
        crossBudgetCategoryId = onBudgetMovements[0].categoryId;
        crossBudgetReadyToAssign = onBudgetMovements[0].readyToAssign;
      }
    }

    // Build embedded movements for both transactions
    const fromMovementsInput = [
      {
        categoryId: isCrossBudget && fromIsOnBudget ? crossBudgetCategoryId : undefined,
        readyToAssign: isCrossBudget && fromIsOnBudget ? crossBudgetReadyToAssign : false,
        amount: -newAmount,
        notes: undefined,
        sortOrder: 0,
      },
    ];

    const toMovementsInput = [
      {
        categoryId: isCrossBudget && !fromIsOnBudget ? crossBudgetCategoryId : undefined,
        readyToAssign: isCrossBudget && !fromIsOnBudget ? crossBudgetReadyToAssign : false,
        amount: newAmount,
        notes: undefined,
        sortOrder: 0,
      },
    ];

    // Build computed fields for both transactions
    const fromComputedFields = await buildTransactionComputedFields(ctx, {
      merchantId: undefined,
      bankAccountId: newFromAccountId,
      transactionType: 'transfer',
      isCrossBudgetOnBudgetSide: isCrossBudget && fromIsOnBudget,
      notes: args.notes !== undefined ? args.notes : fromTransaction.notes,
      movements: fromMovementsInput,
    });

    const toComputedFields = await buildTransactionComputedFields(ctx, {
      merchantId: undefined,
      bankAccountId: newToAccountId,
      transactionType: 'transfer',
      isCrossBudgetOnBudgetSide: isCrossBudget && !fromIsOnBudget,
      notes: args.notes !== undefined ? args.notes : toTransaction.notes,
      movements: toMovementsInput,
    });

    // Update both transactions (transfers don't have merchants)
    await ctx.db.patch(fromTransaction._id, {
      bankAccountId: newFromAccountId,
      date: args.date ?? fromTransaction.date,
      notes: args.notes !== undefined ? args.notes : fromTransaction.notes,
      merchantId: undefined,
      movements: fromComputedFields.movements,
      searchText: fromComputedFields.searchText,
      totalAmount: fromComputedFields.totalAmount,
      hasUncategorized: fromComputedFields.hasUncategorized,
      transferPairBankAccountId: newToAccountId,
      updatedAt: now,
    });

    await ctx.db.patch(toTransaction._id, {
      bankAccountId: newToAccountId,
      date: args.date ?? toTransaction.date,
      notes: args.notes !== undefined ? args.notes : toTransaction.notes,
      merchantId: undefined,
      movements: toComputedFields.movements,
      searchText: toComputedFields.searchText,
      totalAmount: toComputedFields.totalAmount,
      hasUncategorized: toComputedFields.hasUncategorized,
      transferPairBankAccountId: newFromAccountId,
      updatedAt: now,
    });

    // Re-read both transactions from DB for accurate "after" snapshots
    const updatedFromTransaction = await ctx.db.get(fromTransaction._id);
    const updatedToTransaction = await ctx.db.get(toTransaction._id);

    if (!updatedFromTransaction || !updatedToTransaction) {
      throw new ConvexError('Failed to read back updated transfer transactions');
    }

    // Build "after" snapshots and reconcile
    const afterFromSnapshot = await buildSnapshotFromTransaction(ctx, updatedFromTransaction);
    const afterToSnapshot = await buildSnapshotFromTransaction(ctx, updatedToTransaction);

    await reconcileTransactionSideEffects(ctx, beforeFromSnapshot, afterFromSnapshot);
    await reconcileTransactionSideEffects(ctx, beforeToSnapshot, afterToSnapshot);

    const updatedSelectedTransaction = await ctx.db.get(args.transactionId);
    if (updatedSelectedTransaction) {
      await recordTransactionActivity(ctx, {
        workspaceId: verifiedWorkspaceId,
        context: await buildActivityContext(ctx, {
          clerkId: user.subject,
          source: { type: 'kualia_ui' },
        }),
        type: 'transaction_updated',
        before: transaction,
        after: updatedSelectedTransaction,
      });
    }

    return { success: true };
  },
});

/**
 * Convert a regular transaction to a transfer transaction
 */
export const convertToTransfer = mutation({
  args: {
    transactionId: v.id('transaction'),
    workspaceId: v.id('workspace'),
    toAccountId: v.id('bankAccount'), // The destination account for the transfer
  },
  handler: async (ctx, args) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, args.workspaceId);

    // Get the transaction
    const transaction = await ctx.db.get(args.transactionId);
    if (!transaction || transaction.isDeleted) {
      throw new ConvexError('Transaction not found');
    }

    // Verify workspace access
    if (transaction.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Access denied to workspace');
    }

    // Cannot convert a transfer to a transfer
    if (transaction.type === 'transfer') {
      throw new ConvexError('Transaction is already a transfer');
    }

    // Prevent transfer to same account
    if (transaction.bankAccountId === args.toAccountId) {
      throw new ConvexError('Cannot transfer to the same account');
    }

    // Build "before" snapshot for the regular transaction
    const beforeSnapshot = await buildSnapshotFromTransaction(ctx, transaction);

    // Reverse old side effects (regular transaction going away)
    await reconcileTransactionSideEffects(ctx, beforeSnapshot, null);

    // Calculate transaction amount from movements (use totalAmount if available)
    const movements = transaction.movements ?? [];
    const transactionAmount = transaction.totalAmount ?? movements.reduce((sum, m) => sum + m.amount, 0n);

    // Convert the transaction amount to positive for the transfer
    const transferAmount = transactionAmount < 0n ? -transactionAmount : transactionAmount;

    const now = new Date().toISOString();

    // Determine cross-budget status and preserve category on on-budget side
    const fromAccount = await ctx.db.get(transaction.bankAccountId);
    const toAccount = await ctx.db.get(args.toAccountId);
    const fromAccountType = fromAccount?.accountType;
    const toAccountType = toAccount?.accountType;
    const isCrossBudget = isCrossBudgetTransfer(fromAccountType, toAccountType);
    const fromIsOnBudget = fromAccountType ? isOnBudgetAccountType(fromAccountType) : false;

    // For cross-budget conversions, preserve category from the original transaction on the on-budget side
    const existingCategoryId = movements.length > 0 ? movements[0].categoryId : undefined;
    const existingReadyToAssign = movements.length > 0 ? movements[0].readyToAssign : false;

    // Build embedded movements for both transactions
    const fromMovementsInput = [
      {
        categoryId: isCrossBudget && fromIsOnBudget ? existingCategoryId : undefined,
        readyToAssign: isCrossBudget && fromIsOnBudget ? existingReadyToAssign : false,
        amount: -transferAmount,
        notes: undefined,
        sortOrder: 0,
      },
    ];

    const toMovementsInput = [
      {
        categoryId: isCrossBudget && !fromIsOnBudget ? existingCategoryId : undefined,
        readyToAssign: isCrossBudget && !fromIsOnBudget ? existingReadyToAssign : false,
        amount: transferAmount,
        notes: undefined,
        sortOrder: 0,
      },
    ];

    // Build computed fields for both transactions
    const fromComputedFields = await buildTransactionComputedFields(ctx, {
      merchantId: undefined,
      bankAccountId: transaction.bankAccountId,
      transactionType: 'transfer',
      isCrossBudgetOnBudgetSide: isCrossBudget && fromIsOnBudget,
      notes: transaction.notes,
      movements: fromMovementsInput,
    });

    const toComputedFields = await buildTransactionComputedFields(ctx, {
      merchantId: undefined,
      bankAccountId: args.toAccountId,
      transactionType: 'transfer',
      isCrossBudgetOnBudgetSide: isCrossBudget && !fromIsOnBudget,
      notes: transaction.notes,
      movements: toMovementsInput,
    });

    // Update the transaction to be a transfer (this becomes the "from" transaction)
    // Clear transfer suggestion if present — user manually converted to transfer
    const clearedSuggestion = transaction.suggestedTransfer
      ? { suggestedTransfer: { ...transaction.suggestedTransfer, status: 'rejected' as const } }
      : {};

    await ctx.db.patch(args.transactionId, {
      type: 'transfer',
      merchantId: undefined,
      reviewStatus: 'reviewed',
      ...clearedSuggestion,
      movements: fromComputedFields.movements,
      searchText: fromComputedFields.searchText,
      totalAmount: fromComputedFields.totalAmount,
      hasUncategorized: fromComputedFields.hasUncategorized,
      hasMissingPayee: fromComputedFields.hasMissingPayee,
      updatedAt: now,
    });

    // Create the paired "to" transaction (transfers don't have merchants)
    const toTransactionId = await ctx.db.insert('transaction', {
      bankAccountId: args.toAccountId,
      type: 'transfer',
      date: transaction.date,
      workspaceId: verifiedWorkspaceId,
      notes: transaction.notes,
      merchantId: undefined,
      status: transaction.status,
      isDeleted: false,
      source: 'manual',
      reviewStatus: 'reviewed',
      dateYearMonth: dateToYearMonth(transaction.date),
      movements: toComputedFields.movements,
      searchText: toComputedFields.searchText,
      totalAmount: toComputedFields.totalAmount,
      hasUncategorized: toComputedFields.hasUncategorized,
      hasMissingPayee: toComputedFields.hasMissingPayee,
      updatedAt: now,
    });

    // Link them
    await ctx.db.patch(args.transactionId, {
      transferPairId: toTransactionId,
      transferPairBankAccountId: args.toAccountId,
    });
    await ctx.db.patch(toTransactionId, {
      transferPairId: args.transactionId,
      transferPairBankAccountId: transaction.bankAccountId,
    });

    // Mark pending transfer match as user_rejected if one exists
    if (transaction.suggestedTransfer) {
      const pendingMatch = await ctx.db
        .query('pendingTransferMatch')
        .withIndex('by_sourceTransactionId', (q) => q.eq('sourceTransactionId', args.transactionId))
        .first();

      if (pendingMatch) {
        await ctx.db.patch(pendingMatch._id, {
          status: 'user_rejected',
          updatedAt: now,
        });
      }
    }

    // Re-read both transactions from DB for accurate "after" snapshots
    const updatedFromTransaction = await ctx.db.get(args.transactionId);
    const updatedToTransaction = await ctx.db.get(toTransactionId);

    if (!updatedFromTransaction || !updatedToTransaction) {
      throw new ConvexError('Failed to read back transfer transactions');
    }

    // Build "after" snapshots and reconcile new side effects
    const afterFromSnapshot = await buildSnapshotFromTransaction(ctx, updatedFromTransaction);
    const afterToSnapshot = await buildSnapshotFromTransaction(ctx, updatedToTransaction);

    await reconcileTransactionSideEffects(ctx, null, afterFromSnapshot);
    await reconcileTransactionSideEffects(ctx, null, afterToSnapshot);

    await recordTransactionActivity(ctx, {
      workspaceId: verifiedWorkspaceId,
      context: await buildActivityContext(ctx, {
        clerkId: user.subject,
        source: { type: 'kualia_ui' },
      }),
      type: 'transaction_updated',
      before: transaction,
      after: updatedFromTransaction,
    });

    return { success: true, pairedTransactionId: toTransactionId };
  },
});

/**
 * Convert a transfer transaction back to a regular transaction
 */
export const convertFromTransfer = mutation({
  args: {
    transactionId: v.id('transaction'), // The transaction to keep as regular
    workspaceId: v.id('workspace'),
    movements: v.optional(
      v.array(
        v.object({
          amount: v.int64(),
          notes: v.optional(v.string()),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, args.workspaceId);

    // Get the transaction
    const transaction = await ctx.db.get(args.transactionId);
    if (!transaction || transaction.isDeleted) {
      throw new ConvexError('Transaction not found');
    }

    // Verify workspace access
    if (transaction.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Access denied to workspace');
    }

    // Must be a transfer
    if (transaction.type !== 'transfer') {
      throw new ConvexError('Transaction is not a transfer');
    }

    // Get the paired transaction
    if (!transaction.transferPairId) {
      throw new ConvexError('Transfer pair not found');
    }

    const pairedTransaction = await ctx.db.get(transaction.transferPairId);
    if (!pairedTransaction) {
      throw new ConvexError('Transfer pair not found');
    }

    // Build "before" snapshots for both sides
    const beforeMainSnapshot = await buildSnapshotFromTransaction(ctx, transaction);
    const beforePairedSnapshot = await buildSnapshotFromTransaction(ctx, pairedTransaction);

    // Soft delete the paired transaction
    await ctx.db.patch(pairedTransaction._id, {
      isDeleted: true,
      deletedAt: new Date().toISOString(),
    });

    // Reverse paired transaction side effects
    await reconcileTransactionSideEffects(ctx, beforePairedSnapshot, null);

    // Get current transaction movements from embedded array
    const currentMovements = transaction.movements ?? [];

    // Calculate transaction amount (use totalAmount if available)
    const transactionAmount = transaction.totalAmount ?? currentMovements.reduce((sum, m) => sum + m.amount, 0n);

    const now = new Date().toISOString();

    // Create new movements (default to uncategorized)
    const inputMovements = args.movements || [
      {
        amount: transactionAmount,
        notes: undefined,
      },
    ];

    // Validate movements
    validateMovements(transactionAmount, inputMovements);

    // Build embedded movements array
    const newMovementsInput = inputMovements.map((m, i) => ({
      categoryId: undefined,
      readyToAssign: false,
      amount: m.amount,
      notes: m.notes,
      sortOrder: i,
    }));

    // Build computed fields for the converted transaction
    const computedFields = await buildTransactionComputedFields(ctx, {
      merchantId: undefined,
      bankAccountId: transaction.bankAccountId,
      transactionType: 'regular',
      notes: transaction.notes,
      movements: newMovementsInput,
    });

    // Convert to regular transaction type with embedded movements
    await ctx.db.patch(args.transactionId, {
      type: 'regular',
      transferPairId: undefined,
      transferPairBankAccountId: undefined,
      movements: computedFields.movements,
      searchText: computedFields.searchText,
      totalAmount: computedFields.totalAmount,
      hasUncategorized: computedFields.hasUncategorized,
      hasMissingPayee: computedFields.hasMissingPayee,
      updatedAt: now,
    });

    // Re-read the main transaction from DB for accurate "after" snapshot
    const updatedMainTransaction = await ctx.db.get(args.transactionId);

    if (!updatedMainTransaction) {
      throw new ConvexError('Failed to read back converted transaction');
    }

    // Build "after" snapshot and reconcile main transaction side effects
    const afterMainSnapshot = await buildSnapshotFromTransaction(ctx, updatedMainTransaction);

    await reconcileTransactionSideEffects(ctx, beforeMainSnapshot, afterMainSnapshot);

    await recordTransactionActivity(ctx, {
      workspaceId: verifiedWorkspaceId,
      context: await buildActivityContext(ctx, {
        clerkId: user.subject,
        source: { type: 'kualia_ui' },
      }),
      type: 'transaction_updated',
      before: transaction,
      after: updatedMainTransaction,
    });

    return { success: true };
  },
});
