import { v } from 'convex/values';

import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { internalMutation, internalQuery } from '../../_generated/server';

/**
 * Issue type for mismatched creditCardTransfer data
 */
export interface CreditCardTransferMismatchIssue {
  type: 'credit_card_transfer_mismatch';
  severity: 'error';
  description: string;
  transactionId: Id<'transaction'>;
  movementIndex: number;
  currentCreditCardCategoryId: Id<'category'>;
  expectedCreditCardCategoryId: Id<'category'>;
  bankAccountId: Id<'bankAccount'>;
}

/**
 * Issue type for missing creditCardTransfer data
 */
export interface MissingCreditCardTransferIssue {
  type: 'missing_credit_card_transfer';
  severity: 'error';
  description: string;
  transactionId: Id<'transaction'>;
  movementIndex: number;
  categoryId: Id<'category'>;
  expectedCreditCardCategoryId: Id<'category'>;
  bankAccountId: Id<'bankAccount'>;
}

export type CreditCardTransferIssue = CreditCardTransferMismatchIssue | MissingCreditCardTransferIssue;

async function fetchCreditCardCategories(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<'workspace'>
): Promise<Doc<'category'>[]> {
  return ctx.db
    .query('category')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
    .filter((q) => q.and(q.eq(q.field('categoryType'), 'credit_card'), q.eq(q.field('isDeleted'), false)))
    .collect();
}

function buildBankAccountToCategoryMap(categories: Doc<'category'>[]): Map<Id<'bankAccount'>, Id<'category'>> {
  const map = new Map<Id<'bankAccount'>, Id<'category'>>();
  for (const category of categories) {
    if (category.bankAccountId) {
      map.set(category.bankAccountId, category._id);
    }
  }
  return map;
}

async function fetchNonTransferTransactions(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<'workspace'>
): Promise<Doc<'transaction'>[]> {
  return ctx.db
    .query('transaction')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
    .filter((q) => q.and(q.eq(q.field('isDeleted'), false), q.neq(q.field('type'), 'transfer')))
    .collect();
}

/**
 * Validate that creditCardTransfer.creditCardCategoryId matches the category
 * linked to the transaction's bank account.
 */
export const validate = internalQuery({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }): Promise<CreditCardTransferIssue[]> => {
    const issues: CreditCardTransferIssue[] = [];

    const creditCardCategories = await fetchCreditCardCategories(ctx, workspaceId);
    const bankAccountToCategoryMap = buildBankAccountToCategoryMap(creditCardCategories);
    const allTransactions = await fetchNonTransferTransactions(ctx, workspaceId);

    // Build category name lookup for error messages
    const categoryNameMap = new Map(creditCardCategories.map((c) => [c._id, c.name]));
    const getCategoryName = (id: Id<'category'>) => categoryNameMap.get(id) ?? 'Unknown';

    for (const transaction of allTransactions) {
      const expectedCreditCardCategoryId = bankAccountToCategoryMap.get(transaction.bankAccountId);
      if (!expectedCreditCardCategoryId) continue;

      const movements = transaction.movements ?? [];
      for (let i = 0; i < movements.length; i++) {
        const movement = movements[i];

        if (!movement.creditCardTransfer) {
          if (movement.categoryId) {
            issues.push({
              type: 'missing_credit_card_transfer',
              severity: 'error',
              description: `Transaction movement on credit card "${getCategoryName(expectedCreditCardCategoryId)}" has categoryId but is missing creditCardTransfer metadata`,
              transactionId: transaction._id,
              movementIndex: i,
              categoryId: movement.categoryId,
              expectedCreditCardCategoryId,
              bankAccountId: transaction.bankAccountId,
            });
          }
          continue;
        }

        if (movement.creditCardTransfer.creditCardCategoryId !== expectedCreditCardCategoryId) {
          issues.push({
            type: 'credit_card_transfer_mismatch',
            severity: 'error',
            description: `Transaction movement has wrong credit card category. Current: "${getCategoryName(movement.creditCardTransfer.creditCardCategoryId)}", Expected: "${getCategoryName(expectedCreditCardCategoryId)}" (based on transaction's bank account)`,
            transactionId: transaction._id,
            movementIndex: i,
            currentCreditCardCategoryId: movement.creditCardTransfer.creditCardCategoryId,
            expectedCreditCardCategoryId,
            bankAccountId: transaction.bankAccountId,
          });
        }
      }
    }

    return issues;
  },
});

/**
 * Fix creditCardTransfer mismatches by updating the creditCardCategoryId
 * to match the category linked to the transaction's bank account.
 * Must run BEFORE creditSpending fix.
 */
export const fix = internalMutation({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }) => {
    let fixed = 0;
    const errors: string[] = [];

    const creditCardCategories = await fetchCreditCardCategories(ctx, workspaceId);
    const bankAccountToCategoryMap = buildBankAccountToCategoryMap(creditCardCategories);
    const allTransactions = await fetchNonTransferTransactions(ctx, workspaceId);

    for (const transaction of allTransactions) {
      const expectedCreditCardCategoryId = bankAccountToCategoryMap.get(transaction.bankAccountId);
      if (!expectedCreditCardCategoryId) continue;

      let needsUpdate = false;
      const updatedMovements = (transaction.movements ?? []).map((movement) => {
        if (!movement.creditCardTransfer) {
          if (movement.categoryId) {
            needsUpdate = true;
            return {
              ...movement,
              creditCardTransfer: {
                creditCardCategoryId: expectedCreditCardCategoryId,
                spendingCategoryId: movement.categoryId,
              },
            };
          }
          return movement;
        }

        if (movement.creditCardTransfer.creditCardCategoryId !== expectedCreditCardCategoryId) {
          needsUpdate = true;
          return {
            ...movement,
            creditCardTransfer: {
              ...movement.creditCardTransfer,
              creditCardCategoryId: expectedCreditCardCategoryId,
            },
          };
        }

        return movement;
      });

      if (needsUpdate) {
        try {
          await ctx.db.patch(transaction._id, {
            movements: updatedMovements,
            updatedAt: new Date().toISOString(),
          });
          fixed++;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`Failed to fix transaction ${transaction._id}: ${message}`);
        }
      }
    }

    return { fixed, errors };
  },
});
