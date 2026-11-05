import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { mutation } from '../_generated/server';
import { buildActivityContext, recordBankAccountActivity } from '../activityLogs/helpers';
import { requireBankLinkAccountAccessForWorkspace } from '../bankLinks/helpers';
import { requireWorkspaceAccess } from '../lib/auth';
import { entityIconColorId, visualIdentityMode } from '../lib/entityIdentity';
import { accountType } from '../schema';

/**
 * Get the category prefix from an account type string
 */
function getAccountTypeCategory(type: string): string {
  const underscoreIndex = type.indexOf('_');
  if (underscoreIndex === -1) return type;
  return type.substring(0, underscoreIndex);
}

const updateBankAccountArgs = {
  workspaceId: v.id('workspace'),
  bankAccountId: v.id('bankAccount'),
  name: v.optional(v.string()),
  notes: v.optional(v.string()),
  logoUrl: v.optional(v.union(v.string(), v.null())),
  accountType: v.optional(accountType),
  bankLinkAccountId: v.optional(v.union(v.id('bankLinkAccount'), v.null())),
  financeKitAccountId: v.optional(v.union(v.id('financeKitAccount'), v.null())),
  visualIdentityMode: v.optional(visualIdentityMode),
  iconName: v.optional(v.string()),
  iconColorId: v.optional(entityIconColorId),
};

type UpdateBankAccountArgs = {
  workspaceId: Id<'workspace'>;
  bankAccountId: Id<'bankAccount'>;
  name?: string;
  notes?: string;
  logoUrl?: string | null;
  accountType?: Doc<'bankAccount'>['accountType'];
  bankLinkAccountId?: Id<'bankLinkAccount'> | null;
  financeKitAccountId?: Id<'financeKitAccount'> | null;
  visualIdentityMode?: Doc<'bankAccount'>['visualIdentityMode'];
  iconName?: string;
  iconColorId?: Doc<'bankAccount'>['iconColorId'];
};

export async function updateBankAccountHandler(
  ctx: MutationCtx,
  args: UpdateBankAccountArgs
): Promise<{ success: true }> {
  const {
    workspaceId,
    bankAccountId,
    name,
    notes,
    logoUrl,
    accountType: newAccountType,
    bankLinkAccountId,
    financeKitAccountId,
    visualIdentityMode: nextMode,
    iconName,
    iconColorId,
  } = args;
  const { workspaceId: verifiedWorkspaceId, user } = await requireWorkspaceAccess(ctx, workspaceId);

  // Validate name is not empty if provided
  if (name !== undefined && name.trim() === '') {
    throw new ConvexError('Account name cannot be empty');
  }

  const bankAccount = await ctx.db.get(bankAccountId);
  if (!bankAccount || bankAccount.workspaceId !== verifiedWorkspaceId || bankAccount.isDeleted) {
    throw new ConvexError('Bank account not found or does not belong to workspace');
  }

  // Validate account type change is within same category
  if (newAccountType !== undefined) {
    const currentCategory = getAccountTypeCategory(bankAccount.accountType);
    const newCategory = getAccountTypeCategory(newAccountType);
    if (currentCategory !== newCategory) {
      throw new ConvexError('Cannot change account type to a different category');
    }
  }

  const now = new Date().toISOString();
  const updates: Partial<typeof bankAccount> = {
    updatedAt: now,
  };

  if (name !== undefined) updates.name = name;
  if (notes !== undefined) updates.notes = notes;
  if (newAccountType !== undefined) updates.accountType = newAccountType;
  if (nextMode !== undefined) updates.visualIdentityMode = nextMode;
  if (iconName !== undefined) updates.iconName = iconName;
  if (iconColorId !== undefined) updates.iconColorId = iconColorId;

  // Handle logoUrl update
  // 'UNSET' = reset to institution logo (undefined), null = explicitly no logo, string = custom logo
  if ('logoUrl' in args) {
    // If logo is changing, mark any previous uploads as orphaned for cleanup
    if (logoUrl !== bankAccount.logoUrl) {
      await ctx.runMutation(internal.storage.logoUpload.markLogoOrphaned, {
        entityType: 'bankAccount',
        entityId: bankAccountId,
        newLogoUrl: logoUrl,
      });
    }

    if (logoUrl === 'UNSET') {
      updates.logoUrl = undefined;
    } else {
      updates.logoUrl = logoUrl;
    }

    updates.visualIdentityMode = 'logo';
  }

  // Handle linking/unlinking bank-link account
  if ('bankLinkAccountId' in args) {
    if (bankLinkAccountId !== null && bankLinkAccountId !== undefined) {
      // LINKING: Validate the bank-link account
      if (bankAccount.isClosed) {
        throw new ConvexError('Reopen this account before connecting a bank');
      }

      // 1. Prevent direct replacement - require explicit unlink first
      if (bankAccount.bankLinkAccountId !== undefined || bankAccount.financeKitAccountId !== undefined) {
        throw new ConvexError('Bank account is already linked. Unlink first before linking to a different account');
      }

      // 2. Verify bank-link account exists
      const bankLinkAccount = await ctx.db.get(bankLinkAccountId);
      if (!bankLinkAccount || bankLinkAccount.isDeleted) {
        throw new ConvexError('Bank link account not found or does not belong to you');
      }

      // 3. Verify this workspace can use the bank-link account.
      await requireBankLinkAccountAccessForWorkspace(ctx, verifiedWorkspaceId, bankLinkAccountId);

      const currentCategory = getAccountTypeCategory(newAccountType ?? bankAccount.accountType);
      const connectionCategory = getAccountTypeCategory(bankLinkAccount.accountType);
      if (connectionCategory !== 'banking' && connectionCategory !== 'credit') {
        throw new ConvexError('Only banking and credit accounts can be linked');
      }
      if (currentCategory !== connectionCategory) {
        throw new ConvexError('Cannot link account to a different account category');
      }

      // 4. Check for duplicate link (one-to-one constraint)
      const linkedAccounts = ctx.db
        .query('bankAccount')
        .withIndex('by_bankLinkAccountId', (q) => q.eq('bankLinkAccountId', bankLinkAccountId));

      for await (const existingAccount of linkedAccounts) {
        if (existingAccount.workspaceId === verifiedWorkspaceId && !existingAccount.isDeleted) {
          throw new ConvexError('Bank link account is already connected to another bank account');
        }
      }

      updates.bankLinkAccountId = bankLinkAccountId;
      updates.plaidInitialSync = undefined;
    } else {
      // UNLINKING: Set to undefined
      updates.bankLinkAccountId = undefined;
      updates.plaidInitialSync = undefined;
    }
  }

  // Handle linking/unlinking FinanceKit account
  if ('financeKitAccountId' in args) {
    if (financeKitAccountId !== null && financeKitAccountId !== undefined) {
      // LINKING: Validate the FinanceKit account.
      if (bankAccount.bankLinkAccountId !== undefined || bankAccount.financeKitAccountId !== undefined) {
        throw new ConvexError('Bank account is already linked. Unlink first before linking to a different account');
      }

      const financeKitAccount = await ctx.db.get(financeKitAccountId);
      if (!financeKitAccount || financeKitAccount.workspaceId !== verifiedWorkspaceId || financeKitAccount.isDeleted) {
        throw new ConvexError('Apple Wallet account not found or does not belong to workspace');
      }

      const financeKitConnection = await ctx.db.get(financeKitAccount.connectionId);
      if (!financeKitConnection || financeKitConnection.isDeleted || financeKitConnection.status !== 'active') {
        throw new ConvexError('Apple Wallet connection is not active');
      }

      const currentCategory = getAccountTypeCategory(bankAccount.accountType);
      const financeKitCategory = getAccountTypeCategory(financeKitAccount.accountType);
      if (currentCategory !== financeKitCategory) {
        throw new ConvexError('Cannot link account to a different account category');
      }

      const existingAccount = await ctx.db
        .query('bankAccount')
        .withIndex('by_financeKitAccountId', (q) => q.eq('financeKitAccountId', financeKitAccountId))
        .first();
      if (existingAccount && !existingAccount.isDeleted) {
        throw new ConvexError('Apple Wallet account is already connected to another bank account');
      }

      if (financeKitAccount.bankAccountId) {
        const existingLinkedBankAccount = await ctx.db.get(financeKitAccount.bankAccountId);
        if (existingLinkedBankAccount && !existingLinkedBankAccount.isDeleted) {
          throw new ConvexError('Apple Wallet account is already connected to another bank account');
        }
      }

      updates.financeKitAccountId = financeKitAccountId;
      await ctx.db.patch(financeKitAccount._id, {
        bankAccountId,
        updatedAt: now,
      });
    } else {
      // UNLINKING: Clear both sides of the FinanceKit link.
      if (bankAccount.financeKitAccountId) {
        const financeKitAccount = await ctx.db.get(bankAccount.financeKitAccountId);
        if (financeKitAccount) {
          await ctx.db.patch(financeKitAccount._id, {
            bankAccountId: undefined,
            updatedAt: now,
          });
        }
      }

      updates.financeKitAccountId = undefined;
    }
  }

  await ctx.db.patch(bankAccountId, updates);

  // Propagate name change to transaction searchText if name was updated
  if (name !== undefined && name !== bankAccount.name) {
    await ctx.runMutation(internal.internal.propagateNameChanges.propagateBankAccountNameChange, {
      bankAccountId,
      workspaceId: verifiedWorkspaceId,
      newBankAccountName: name,
    });
  }

  const updatedBankAccount = await ctx.db.get(bankAccountId);
  if (updatedBankAccount) {
    await recordBankAccountActivity(ctx, {
      workspaceId: verifiedWorkspaceId,
      context: await buildActivityContext(ctx, {
        clerkId: user.subject,
        source: { type: 'kualia_ui' },
      }),
      type: 'bank_account_updated',
      before: bankAccount,
      after: updatedBankAccount,
    });
  }

  return { success: true };
}

/**
 * Update a bank account
 */
export const updateBankAccount = mutation({
  args: updateBankAccountArgs,
  returns: v.object({ success: v.literal(true) }),
  handler: updateBankAccountHandler,
});
