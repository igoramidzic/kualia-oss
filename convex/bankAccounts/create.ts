import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { internalMutation, mutation } from '../_generated/server';
import { buildActivityContext, recordBankAccountActivity, recordCategoryActivity } from '../activityLogs/helpers';
import { activityAttributionValidator, type ActivityAttribution, type ActivityContext } from '../activityLogs/types';
import { requireBankLinkAccountAccessForWorkspace } from '../bankLinks/helpers';
import { getOrCreateCreditCardCategoryGroup } from '../categoryGroups';
import { getFinanceKitAccountSyncStartDate, getFinanceKitLedgerBalance } from '../financeKit/helpers';
import { requireWorkspaceAccess } from '../lib/auth';
import { entityIconColorId, visualIdentityMode } from '../lib/entityIdentity';
import { accountType } from '../schema';
import { addAccountToOrdering } from '../workspaces/bankAccountOrdering';
import { createOrUpdateStartingBalanceTransaction } from './helpers';

const SORT_ORDER_GAP = 100; // Gap between items (0, 100, 200, 300...)

/**
 * Check if an account type is supported for linking
 * Currently only banking and credit account types are supported
 */
function isAccountTypeSupportedForLinking(type: string | undefined): boolean {
  if (!type) return false;
  return type.startsWith('banking_') || type.startsWith('credit_');
}

const createBankAccountArgs = {
  workspaceId: v.id('workspace'),
  name: v.string(),
  bankLinkAccountId: v.optional(v.id('bankLinkAccount')),
  financeKitAccountId: v.optional(v.id('financeKitAccount')),
  accountType: v.optional(accountType),
  initialBalance: v.optional(v.int64()),
  initialBalanceDate: v.optional(v.string()), // ISO date string (YYYY-MM-DD)
  visualIdentityMode: v.optional(visualIdentityMode),
  iconName: v.optional(v.string()),
  iconColorId: v.optional(entityIconColorId),
};

type CreateBankAccountArgs = {
  workspaceId: Id<'workspace'>;
  name: string;
  bankLinkAccountId?: Id<'bankLinkAccount'>;
  financeKitAccountId?: Id<'financeKitAccount'>;
  accountType?: Doc<'bankAccount'>['accountType'];
  initialBalance?: bigint;
  initialBalanceDate?: string;
  visualIdentityMode?: Doc<'bankAccount'>['visualIdentityMode'];
  iconName?: string;
  iconColorId?: Doc<'bankAccount'>['iconColorId'];
};

type CreateBankAccountForWorkspaceArgs = CreateBankAccountArgs & {
  attribution: ActivityAttribution;
};

/**
 * Shared create implementation. Assumes `workspaceId` has already been resolved
 * and authorized by the caller. Behind the public `createBankAccount` mutation
 * (UI) and the `createBankAccountForMcp` internal mutation (MCP/chat).
 */
export async function createBankAccountForWorkspace(
  ctx: MutationCtx,
  {
    workspaceId: verifiedWorkspaceId,
    name,
    bankLinkAccountId,
    financeKitAccountId,
    accountType,
    initialBalance,
    initialBalanceDate,
    visualIdentityMode,
    iconName,
    iconColorId,
    attribution,
  }: CreateBankAccountForWorkspaceArgs
): Promise<Id<'bankAccount'>> {
  if (bankLinkAccountId !== undefined && financeKitAccountId !== undefined) {
    throw new ConvexError('Bank account can only be linked to one external account');
  }

  // Validate: if initialBalance is provided, initialBalanceDate must also be provided
  if (initialBalance !== undefined && !initialBalanceDate) {
    throw new ConvexError('initialBalanceDate is required when initialBalance is provided');
  }

  // Check if bank link account ID is already used
  if (bankLinkAccountId) {
    const existingAccount = await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .filter((q) => q.and(q.eq(q.field('bankLinkAccountId'), bankLinkAccountId), q.eq(q.field('isDeleted'), false)))
      .first();

    if (existingAccount) {
      throw new ConvexError('Bank link account is already connected to another bank account');
    }
  }

  let financeKitAccount: Doc<'financeKitAccount'> | null = null;
  let financeKitConnection: Doc<'financeKitConnection'> | null = null;

  if (financeKitAccountId) {
    const existingAccount = await ctx.db
      .query('bankAccount')
      .withIndex('by_financeKitAccountId', (q) => q.eq('financeKitAccountId', financeKitAccountId))
      .take(10);

    if (existingAccount.some((account) => !account.isDeleted)) {
      throw new ConvexError('Apple Wallet account is already connected to another bank account');
    }

    financeKitAccount = await ctx.db.get(financeKitAccountId);
    if (!financeKitAccount || financeKitAccount.workspaceId !== verifiedWorkspaceId || financeKitAccount.isDeleted) {
      throw new ConvexError('Apple Wallet account not found or does not belong to workspace');
    }

    financeKitConnection = await ctx.db.get(financeKitAccount.connectionId);
    if (
      !financeKitConnection ||
      financeKitConnection.workspaceId !== verifiedWorkspaceId ||
      financeKitConnection.isDeleted ||
      financeKitConnection.status !== 'active'
    ) {
      throw new ConvexError('Apple Wallet connection is not active');
    }

    if (financeKitAccount.bankAccountId) {
      const existingLinkedBankAccount = await ctx.db.get(financeKitAccount.bankAccountId);
      if (existingLinkedBankAccount && !existingLinkedBankAccount.isDeleted) {
        throw new ConvexError('Apple Wallet account is already connected to another bank account');
      }
    }
  }

  // Determine accountType: use provided accountType, or copy from bankLinkAccount if available
  let finalAccountType: Doc<'bankAccount'>['accountType'];
  if (bankLinkAccountId) {
    const { bankLinkAccount } = await requireBankLinkAccountAccessForWorkspace(
      ctx,
      verifiedWorkspaceId,
      bankLinkAccountId
    );
    // Validate account type is supported for linking
    if (!isAccountTypeSupportedForLinking(bankLinkAccount.accountType)) {
      throw new ConvexError(
        `Account type "${bankLinkAccount.accountType}" is not yet supported for linking. Only banking and credit accounts can be linked.`
      );
    }
    finalAccountType = bankLinkAccount.accountType;
  } else if (financeKitAccount) {
    if (!isAccountTypeSupportedForLinking(financeKitAccount.accountType)) {
      throw new ConvexError(
        `Account type "${financeKitAccount.accountType}" is not yet supported for linking. Only banking and credit accounts can be linked.`
      );
    }
    finalAccountType = financeKitAccount.accountType;
  } else if (accountType) {
    finalAccountType = accountType;
  } else {
    throw new ConvexError('accountType is required when an external account is not provided');
  }

  // TypeScript assertion: finalAccountType is guaranteed to be set at this point
  if (!finalAccountType) {
    throw new ConvexError('accountType must be set');
  }

  const financeKitInitialBalance = financeKitAccount
    ? getFinanceKitLedgerBalance(
        {
          available: financeKitAccount.latestAvailableBalance,
          booked: financeKitAccount.latestBookedBalance,
          current: financeKitAccount.latestCurrentBalance,
        },
        financeKitAccount.accountKind,
        initialBalance ?? 0n
      )
    : null;
  const finalInitialBalance = financeKitInitialBalance ?? initialBalance ?? 0n;
  const activityContext = await buildActivityContext(ctx, attribution);

  const bankAccountId = await ctx.db.insert('bankAccount', {
    name,
    workspaceId: verifiedWorkspaceId,
    bankLinkAccountId,
    financeKitAccountId,
    accountType: finalAccountType,
    visualIdentityMode,
    iconName,
    iconColorId,
    currentBalance: finalInitialBalance,
    pendingBalance: financeKitAccountId ? 0n : undefined,
    clearedBalance: financeKitAccountId ? 0n : undefined,
    isClosed: false,
    isDeleted: false,
    updatedAt: new Date().toISOString(),
  });

  if (financeKitAccount) {
    await ctx.db.patch(financeKitAccount._id, {
      bankAccountId,
      updatedAt: new Date().toISOString(),
    });
  }

  // Add the new account to the workspace's ordering
  await addAccountToOrdering(ctx, verifiedWorkspaceId, bankAccountId, finalAccountType);

  // Auto-create credit card category if this is a credit card account
  if (finalAccountType?.startsWith('credit_')) {
    // Get or create the workspace-specific credit card category group
    const creditCardGroupId = await getOrCreateCreditCardCategoryGroup(ctx, verifiedWorkspaceId);

    // Check if category already exists for this bank account
    const existingCategory = await ctx.db
      .query('category')
      .withIndex('by_bankAccountId', (q) => q.eq('bankAccountId', bankAccountId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .first();

    if (!existingCategory) {
      // Get all categories in the credit card group to calculate sortOrder
      const existingCategories = await ctx.db
        .query('category')
        .withIndex('by_categoryGroupId_sortOrder', (q) => q.eq('categoryGroupId', creditCardGroupId))
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .collect();

      const nextSortOrder =
        existingCategories.length > 0 ? Math.max(...existingCategories.map((c) => c.sortOrder)) + SORT_ORDER_GAP : 0;

      // Create the credit card category
      const categoryId = await ctx.db.insert('category', {
        name,
        workspaceId: verifiedWorkspaceId,
        categoryGroupId: creditCardGroupId,
        sortOrder: nextSortOrder,
        categoryType: 'credit_card',
        isSystemCategory: true,
        bankAccountId: bankAccountId,
        isDeleted: false,
        updatedAt: new Date().toISOString(),
      });
      const category = await ctx.db.get(categoryId);
      if (category) {
        await recordCategoryActivity(ctx, {
          workspaceId: verifiedWorkspaceId,
          context: activityContext,
          type: 'category_created',
          after: category,
        });
      }
    }
  }

  // Create starting balance transaction if initialBalance and initialBalanceDate are provided
  if (financeKitAccount && financeKitConnection) {
    await createOrUpdateStartingBalanceTransaction(ctx, {
      bankAccountId,
      workspaceId: verifiedWorkspaceId,
      amount: finalInitialBalance,
      date: getFinanceKitAccountSyncStartDate(financeKitAccount, financeKitConnection.syncStartDate),
      source: 'automatic_import',
    });
  } else if (initialBalance !== undefined && initialBalanceDate) {
    await createOrUpdateStartingBalanceTransaction(ctx, {
      bankAccountId,
      workspaceId: verifiedWorkspaceId,
      amount: initialBalance,
      date: initialBalanceDate,
      source: 'manual',
    });
  }

  const bankAccount = await ctx.db.get(bankAccountId);
  if (bankAccount) {
    await recordBankAccountActivity(ctx, {
      workspaceId: verifiedWorkspaceId,
      context: activityContext,
      type: 'bank_account_created',
      after: bankAccount,
    });
  }

  return bankAccountId;
}

export async function createBankAccountHandler(
  ctx: MutationCtx,
  args: CreateBankAccountArgs
): Promise<Id<'bankAccount'>> {
  const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, args.workspaceId);
  return createBankAccountForWorkspace(ctx, {
    ...args,
    workspaceId: verifiedWorkspaceId,
    attribution: { clerkId: user.subject, source: { type: 'kualia_ui' } },
  });
}

/**
 * Create a manual bank account
 */
export const createBankAccount = mutation({
  args: createBankAccountArgs,
  handler: createBankAccountHandler,
});

/**
 * Internal mutation called from MCP tool dispatch. Trusts workspaceId (already
 * resolved and authorized by the MCP handler). Restricted to manual accounts:
 * external links (bankLinkAccountId/financeKitAccountId) are never accepted here.
 */
export const createBankAccountForMcp = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    name: v.string(),
    accountType,
    initialBalance: v.optional(v.int64()),
    initialBalanceDate: v.optional(v.string()),
    attribution: activityAttributionValidator,
  },
  handler: (ctx, { workspaceId, name, accountType, initialBalance, initialBalanceDate, attribution }) =>
    createBankAccountForWorkspace(ctx, {
      workspaceId,
      name,
      accountType,
      initialBalance,
      initialBalanceDate,
      attribution,
    }),
});

/**
 * Helper function to create a single bank account from a bank link account
 * Used internally by the batch creation mutation
 */
async function createSingleBankAccountFromBankLink(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<'workspace'>;
    bankLinkAccount: Doc<'bankLinkAccount'>;
    initialBalanceDate: string;
    activityContext: ActivityContext;
  }
): Promise<Id<'bankAccount'>> {
  const { workspaceId, bankLinkAccount, initialBalanceDate } = args;
  const accountType = bankLinkAccount.accountType;

  // Create the bank account
  // Note: bankLinkAccount.initialBalance is already stored in cents from Plaid
  const bankAccountId = await ctx.db.insert('bankAccount', {
    name: bankLinkAccount.name,
    workspaceId,
    bankLinkAccountId: bankLinkAccount._id,
    accountType,
    currentBalance: BigInt(bankLinkAccount.initialBalance ?? 0),
    isClosed: false,
    isDeleted: false,
    updatedAt: new Date().toISOString(),
  });

  // Add the new account to the workspace's ordering
  if (accountType) {
    await addAccountToOrdering(ctx, workspaceId, bankAccountId, accountType);
  }

  // Auto-create credit card category if this is a credit card account
  if (accountType?.startsWith('credit_')) {
    const creditCardGroupId = await getOrCreateCreditCardCategoryGroup(ctx, workspaceId);

    // Check if category already exists for this bank account
    const existingCategory = await ctx.db
      .query('category')
      .withIndex('by_bankAccountId', (q) => q.eq('bankAccountId', bankAccountId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .first();

    if (!existingCategory) {
      // Get all categories in the credit card group to calculate sortOrder
      const existingCategories = await ctx.db
        .query('category')
        .withIndex('by_categoryGroupId_sortOrder', (q) => q.eq('categoryGroupId', creditCardGroupId))
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .collect();

      const nextSortOrder =
        existingCategories.length > 0 ? Math.max(...existingCategories.map((c) => c.sortOrder)) + SORT_ORDER_GAP : 0;

      // Create the credit card category
      const categoryId = await ctx.db.insert('category', {
        name: bankLinkAccount.name,
        workspaceId,
        categoryGroupId: creditCardGroupId,
        sortOrder: nextSortOrder,
        categoryType: 'credit_card',
        isSystemCategory: true,
        bankAccountId: bankAccountId,
        isDeleted: false,
        updatedAt: new Date().toISOString(),
      });
      const category = await ctx.db.get(categoryId);
      if (category) {
        await recordCategoryActivity(ctx, {
          workspaceId,
          context: args.activityContext,
          type: 'category_created',
          after: category,
        });
      }
    }
  }

  // Create starting balance transaction
  // Note: bankLinkAccount.initialBalance is already stored in cents from Plaid
  const initialBalance = BigInt(bankLinkAccount.initialBalance ?? 0);
  await createOrUpdateStartingBalanceTransaction(ctx, {
    bankAccountId,
    workspaceId,
    amount: initialBalance,
    date: initialBalanceDate,
    source: 'manual',
  });

  return bankAccountId;
}

/**
 * Create multiple bank accounts from bank link accounts in a single atomic transaction
 * All accounts are created or none if any validation fails
 */
export const createBankAccountsFromBankLinkAccounts = mutation({
  args: {
    workspaceId: v.id('workspace'),
    bankLinkAccountIds: v.array(v.id('bankLinkAccount')),
    initialBalanceDate: v.string(), // ISO date string (YYYY-MM-DD)
  },
  handler: async (ctx, { workspaceId, bankLinkAccountIds, initialBalanceDate }) => {
    const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);

    if (bankLinkAccountIds.length === 0) {
      throw new ConvexError('At least one bank link account ID is required');
    }

    // Phase 1: Validate all bank link accounts exist and are not already linked
    const bankLinkAccounts: Doc<'bankLinkAccount'>[] = [];

    for (const bankLinkAccountId of bankLinkAccountIds) {
      // Check if bank link account exists
      const { bankLinkAccount } = await requireBankLinkAccountAccessForWorkspace(
        ctx,
        verifiedWorkspaceId,
        bankLinkAccountId
      );

      // Check if this bank link account is already linked to a bank account in this workspace
      const existingBankAccount = await ctx.db
        .query('bankAccount')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
        .filter((q) => q.and(q.eq(q.field('bankLinkAccountId'), bankLinkAccountId), q.eq(q.field('isDeleted'), false)))
        .first();

      if (existingBankAccount) {
        throw new ConvexError(
          `Bank link account "${bankLinkAccount.name}" is already connected to another bank account`
        );
      }

      // Check if the account type is supported for linking (banking/credit only)
      if (!isAccountTypeSupportedForLinking(bankLinkAccount.accountType)) {
        throw new ConvexError(
          `Account type "${bankLinkAccount.accountType}" is not yet supported for linking. Only banking and credit accounts can be linked.`
        );
      }

      bankLinkAccounts.push(bankLinkAccount);
    }

    // Phase 2: Create all bank accounts (only executed if all validations pass)
    const createdBankAccountIds: Id<'bankAccount'>[] = [];
    const context = await buildActivityContext(ctx, {
      clerkId: user.subject,
      source: { type: 'kualia_ui' },
    });

    for (const bankLinkAccount of bankLinkAccounts) {
      const bankAccountId = await createSingleBankAccountFromBankLink(ctx, {
        workspaceId: verifiedWorkspaceId,
        bankLinkAccount,
        initialBalanceDate,
        activityContext: context,
      });
      createdBankAccountIds.push(bankAccountId);
    }

    for (const bankAccountId of createdBankAccountIds) {
      const bankAccount = await ctx.db.get(bankAccountId);
      if (bankAccount) {
        await recordBankAccountActivity(ctx, {
          workspaceId: verifiedWorkspaceId,
          context,
          type: 'bank_account_created',
          after: bankAccount,
        });
      }
    }

    return createdBankAccountIds;
  },
});
