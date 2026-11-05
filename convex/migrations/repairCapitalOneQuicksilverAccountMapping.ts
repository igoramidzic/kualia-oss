import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { internalMutation } from '../_generated/server';

const TARGET_CLERK_ID = 'user_3BDAskaW5erdahMQPpATGcCSV6x';
const ACTIVE_CAPITAL_ONE_LINK_ID = 'j97echat2vpewxdqtnd2zrrwvd838fde' as Id<'bankLink'>;
const STALE_QUICKSILVER_LINK_ID = 'j97ajwdcpcnb4d5tp7rzzyqy8186zerj' as Id<'bankLink'>;
const QUICKSILVER_LINK_ACCOUNT_ID = 'jd7d9hh0xzask54pgqd8xt7kn186ymdb' as Id<'bankLinkAccount'>;
const OLD_QUICKSILVER_PLAID_ACCOUNT_ID = 'kX8RrMarznSvE1MnnL3DTdRjjYp5x5fEvdnd6';
const NEW_QUICKSILVER_PLAID_ACCOUNT_ID = 'BrOkQd7P36TBQapVawJnFX5x3jgBqPFvZ7Mdg';
const EXPECTED_ACCOUNT_MASK = '6454';
const MAX_LINKED_BANK_ACCOUNTS = 10;

export type MappingState = 'needs_repair' | 'repaired' | 'unexpected';

export function determineMappingState(bankLinkId: Id<'bankLink'>, plaidAccountId: string): MappingState {
  if (bankLinkId === STALE_QUICKSILVER_LINK_ID && plaidAccountId === OLD_QUICKSILVER_PLAID_ACCOUNT_ID) {
    return 'needs_repair';
  }
  if (bankLinkId === ACTIVE_CAPITAL_ONE_LINK_ID && plaidAccountId === NEW_QUICKSILVER_PLAID_ACCOUNT_ID) {
    return 'repaired';
  }
  return 'unexpected';
}

/**
 * Targeted, idempotent production repair for Quicksilver ending in 6454.
 *
 * This mutation changes only the bankLinkId and plaidAccountId on the existing
 * bankLinkAccount. It does not replay, create, update, or process transactions.
 *
 * Dry run:
 * npx convex run migrations/repairCapitalOneQuicksilverAccountMapping:run '{"dryRun":true}' --prod
 *
 * Apply:
 * npx convex run migrations/repairCapitalOneQuicksilverAccountMapping:run '{"dryRun":false}' --prod
 *
 * Run the dry run again after apply. It should report
 * mappingStateAfter=repaired and transactionWrites=0.
 */
export const run = internalMutation({
  args: { dryRun: v.boolean() },
  handler: async (ctx, { dryRun }) => {
    const profile = await ctx.db
      .query('userProfile')
      .withIndex('by_clerkId', (query) => query.eq('clerkId', TARGET_CLERK_ID))
      .first();
    if (!profile || profile.isDeleted) {
      throw new ConvexError('Target user profile is missing or deleted');
    }

    const [activeLink, staleLink, linkAccount] = await Promise.all([
      ctx.db.get(ACTIVE_CAPITAL_ONE_LINK_ID),
      ctx.db.get(STALE_QUICKSILVER_LINK_ID),
      ctx.db.get(QUICKSILVER_LINK_ACCOUNT_ID),
    ]);
    if (!activeLink || !staleLink || !linkAccount) {
      throw new ConvexError('One or more expected Capital One repair records are missing');
    }
    if (activeLink.ownerId !== TARGET_CLERK_ID || staleLink.ownerId !== TARGET_CLERK_ID) {
      throw new ConvexError('Capital One bank-link ownership no longer matches the target user');
    }
    if (activeLink.globalInstitutionId !== staleLink.globalInstitutionId) {
      throw new ConvexError('Expected both bank links to belong to the same institution');
    }

    const institution = await ctx.db.get(activeLink.globalInstitutionId);
    if (institution?.name !== 'Capital One') {
      throw new ConvexError('Expected the active bank link to belong to Capital One');
    }
    if (linkAccount.accountNumberMask !== EXPECTED_ACCOUNT_MASK || linkAccount.officialName !== 'Quicksilver') {
      throw new ConvexError('Expected Quicksilver account ending in 6454');
    }

    const mappingStateBefore = determineMappingState(linkAccount.bankLinkId, linkAccount.plaidAccountId);
    if (mappingStateBefore === 'unexpected') {
      throw new ConvexError('Quicksilver mapping is in an unexpected state');
    }

    const conflictingMapping = await ctx.db
      .query('bankLinkAccount')
      .withIndex('by_plaidAccountId', (query) => query.eq('plaidAccountId', NEW_QUICKSILVER_PLAID_ACCOUNT_ID))
      .first();
    if (conflictingMapping && conflictingMapping._id !== QUICKSILVER_LINK_ACCOUNT_ID) {
      throw new ConvexError('The replacement Plaid account ID is already mapped to another bank-link account');
    }

    const linkedBankAccounts = await ctx.db
      .query('bankAccount')
      .withIndex('by_bankLinkAccountId', (query) => query.eq('bankLinkAccountId', QUICKSILVER_LINK_ACCOUNT_ID))
      .filter((query) => query.eq(query.field('isDeleted'), false))
      .take(MAX_LINKED_BANK_ACCOUNTS + 1);
    if (linkedBankAccounts.length === 0 || linkedBankAccounts.length > MAX_LINKED_BANK_ACCOUNTS) {
      throw new ConvexError('Expected a small, non-empty set of linked Quicksilver bank accounts');
    }

    const linkedWorkspaces = await Promise.all(
      linkedBankAccounts.map(async (bankAccount) => {
        const workspace = await ctx.db.get(bankAccount.workspaceId);
        if (!workspace || workspace.isDeleted || workspace.ownerClerkId !== TARGET_CLERK_ID) {
          throw new ConvexError('A linked workspace is missing, deleted, or owned by another user');
        }
        return {
          bankAccountId: bankAccount._id,
          bankAccountName: bankAccount.name,
          workspaceId: workspace._id,
          workspaceName: workspace.name,
        };
      })
    );

    const mappingUpdated = !dryRun && mappingStateBefore === 'needs_repair';
    if (mappingUpdated) {
      const now = new Date().toISOString();
      await ctx.db.patch(QUICKSILVER_LINK_ACCOUNT_ID, {
        bankLinkId: ACTIVE_CAPITAL_ONE_LINK_ID,
        plaidAccountId: NEW_QUICKSILVER_PLAID_ACCOUNT_ID,
        lastUpdated: now,
        updatedAt: now,
      });
    }

    return {
      mode: dryRun ? ('dry_run' as const) : ('apply' as const),
      mappingStateBefore,
      mappingStateAfter: mappingUpdated ? ('repaired' as const) : mappingStateBefore,
      mappingUpdated,
      transactionWrites: 0,
      currentMapping: {
        bankLinkAccountId: QUICKSILVER_LINK_ACCOUNT_ID,
        bankLinkId: linkAccount.bankLinkId,
        plaidAccountId: linkAccount.plaidAccountId,
      },
      targetMapping: {
        bankLinkAccountId: QUICKSILVER_LINK_ACCOUNT_ID,
        bankLinkId: ACTIVE_CAPITAL_ONE_LINK_ID,
        plaidAccountId: NEW_QUICKSILVER_PLAID_ACCOUNT_ID,
      },
      linkedWorkspaces,
      staleBankLinkLeftInPlace: true,
    };
  },
});
