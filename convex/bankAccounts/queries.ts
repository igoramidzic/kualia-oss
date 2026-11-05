import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { internalQuery, query } from '../_generated/server';
import { requireWorkspaceAccess } from '../lib/auth';
import { appendLogoDevToken, getAppleWalletLogoUrl } from '../lib/logoUtils';
import { getFavoriteBankAccountIds } from './favorites';
import { applySavedOrdering } from './helpers';

function getConnectionAccountRef(account: Doc<'bankAccount'>) {
  if (account.bankLinkAccountId) {
    return {
      provider: 'plaid' as const,
      accountId: account.bankLinkAccountId,
    };
  }

  if (account.financeKitAccountId) {
    return {
      provider: 'apple_wallet' as const,
      accountId: account.financeKitAccountId,
    };
  }

  return null;
}

async function getFinanceKitAccountData(
  ctx: QueryCtx,
  account: Doc<'bankAccount'>,
  verifiedWorkspaceId: Id<'workspace'>
) {
  if (!account.financeKitAccountId) {
    return null;
  }

  const financeKitAccount = await ctx.db.get(account.financeKitAccountId);
  if (!financeKitAccount || financeKitAccount.workspaceId !== verifiedWorkspaceId || financeKitAccount.isDeleted) {
    return null;
  }

  const financeKitConnection = await ctx.db.get(financeKitAccount.connectionId);
  if (
    !financeKitConnection ||
    financeKitConnection.workspaceId !== verifiedWorkspaceId ||
    financeKitConnection.isDeleted
  ) {
    return null;
  }

  return {
    _id: financeKitAccount._id,
    accountKind: financeKitAccount.accountKind,
    accountType: financeKitAccount.accountType,
    displayName: financeKitAccount.displayName,
    institutionName: financeKitAccount.institutionName ?? null,
    accountDescription: financeKitAccount.accountDescription ?? null,
    currencyCode: financeKitAccount.currencyCode,
    latestBalanceAsOfDate: financeKitAccount.latestBalanceAsOfDate ?? null,
    hasCompletedInitialSync: financeKitAccount.hasCompletedInitialSync,
    connection: {
      _id: financeKitConnection._id,
      deviceId: financeKitConnection.deviceId,
      status: financeKitConnection.status,
      syncStartDate: financeKitConnection.syncStartDate,
      lastSyncedAt: financeKitConnection.lastSyncedAt ?? null,
      ownerClerkId: financeKitConnection.ownerClerkId,
    },
  };
}

export function getBankAccountLogoFields(
  account: Pick<Doc<'bankAccount'>, 'logoUrl'>,
  globalInstitution: Pick<Doc<'globalInstitution'>, 'logoUrl'> | null,
  hasFinanceKitAccount: boolean
) {
  const defaultInstitutionLogoUrl =
    globalInstitution?.logoUrl ?? (hasFinanceKitAccount ? getAppleWalletLogoUrl() : null);
  const institutionLogoUrl = appendLogoDevToken(defaultInstitutionLogoUrl);
  const resolvedLogoUrl =
    account.logoUrl !== undefined ? appendLogoDevToken(account.logoUrl ?? undefined) : institutionLogoUrl;

  return {
    resolvedLogoUrl,
    institutionLogoUrl,
  };
}

export function getFirstBalanceYearMonth(account: Pick<Doc<'bankAccount'>, 'monthlyBalances'>): string | null {
  const firstMonth = Object.keys(account.monthlyBalances ?? {})
    .filter((key) => /^\d{4}(?:0[1-9]|1[0-2])$/.test(key) && Number(key.slice(0, 4)) > 0)
    .sort()[0];
  return firstMonth ? `${firstMonth.slice(0, 4)}-${firstMonth.slice(4)}` : null;
}

/**
 * Get all bank accounts for a workspace
 */
export const listBankAccounts = query({
  args: {
    workspaceId: v.id('workspace'),
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, { workspaceId, includeDeleted = false }) => {
    const { user, workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);
    const favoriteBankAccountIds = await getFavoriteBankAccountIds(ctx, verifiedWorkspaceId, user.subject);

    // Fetch workspace to get ordering configuration
    const workspace = await ctx.db.get(verifiedWorkspaceId);

    const bankAccounts = await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .filter((q) => {
        return includeDeleted ? true : q.eq(q.field('isDeleted'), false);
      })
      .collect();

    // Enrich with bank link information if available
    const enrichedAccounts = await Promise.all(
      bankAccounts.map(async (account) => {
        let bankLinkAccount: Doc<'bankLinkAccount'> | null = null;
        let bankLink: Doc<'bankLink'> | null = null;
        let globalInstitution: Doc<'globalInstitution'> | null = null;

        if (account.bankLinkAccountId) {
          // Find the bank link account by its ID
          bankLinkAccount = await ctx.db.get(account.bankLinkAccountId);
          if (bankLinkAccount) {
            bankLink = await ctx.db.get(bankLinkAccount.bankLinkId);
            // Handle both new (globalInstitutionId) and legacy records
            if (bankLink?.globalInstitutionId) {
              globalInstitution = await ctx.db.get(bankLink.globalInstitutionId);
            }
          }
        }

        const bankLinkAccountData =
          bankLinkAccount && bankLink && globalInstitution
            ? {
                _id: bankLinkAccount._id,
                name: bankLinkAccount.name,
                accountType: bankLinkAccount.accountType,
                currentBalance: bankLinkAccount.currentBalance,
                availableBalance: bankLinkAccount.availableBalance,
                accountNumberMask: bankLinkAccount.accountNumberMask,
                officialName: bankLinkAccount.officialName,
                bankLink: {
                  _id: bankLink._id,
                  // Return as "institution" for frontend
                  institution: {
                    _id: globalInstitution._id,
                    name: globalInstitution.name,
                    logoUrl: appendLogoDevToken(globalInstitution.logoUrl),
                    primaryColor: globalInstitution.primaryColor,
                    updatedAt: globalInstitution.updatedAt,
                  },
                  itemStatus: bankLink.itemStatus,
                  lastSyncedAt: bankLink.lastSyncedAt,
                },
              }
            : null;

        const financeKitAccountData = await getFinanceKitAccountData(ctx, account, verifiedWorkspaceId);

        // Compute logo URLs:
        // - logoUrl: raw custom logo (for state detection on client)
        // - resolvedLogoUrl: the logo to display (custom > institution > undefined)
        // - institutionLogoUrl: the institution logo (for "reset to default" option)
        const { institutionLogoUrl, resolvedLogoUrl } = getBankAccountLogoFields(
          account,
          globalInstitution,
          financeKitAccountData !== null
        );

        const bankAccountData = {
          _id: account._id,
          name: account.name,
          notes: account.notes,
          logoUrl: account.logoUrl, // Raw custom logo (for state detection)
          resolvedLogoUrl, // The logo to display
          institutionLogoUrl, // Institution logo (for reset option)
          visualIdentityMode: account.visualIdentityMode ?? 'logo',
          iconName: account.iconName,
          iconColorId: account.iconColorId,
          workspaceId: account.workspaceId,
          connectionAccount: getConnectionAccountRef(account),
          bankLinkAccountId: account.bankLinkAccountId,
          financeKitAccountId: account.financeKitAccountId,
          accountType: account.accountType,
          currentBalance: account.currentBalance,
          pendingBalance: account.pendingBalance,
          clearedBalance: account.clearedBalance,
          firstBalanceYearMonth: getFirstBalanceYearMonth(account),
          isDeleted: account.isDeleted,
          isClosed: account.isClosed,
          closedAt: account.closedAt,
          updatedAt: account.updatedAt,
          deletedAt: account.deletedAt,
          createdAt: account._creationTime ? new Date(account._creationTime).toISOString() : account.updatedAt,
          bankLinkAccount: bankLinkAccountData,
          financeKitAccount: financeKitAccountData,
          isFavorite: favoriteBankAccountIds.has(account._id),
        };

        return bankAccountData;
      })
    );

    // Apply workspace ordering if available
    if (workspace?.bankAccountOrdering) {
      return applySavedOrdering(enrichedAccounts, workspace.bankAccountOrdering);
    }

    // Default: sort by updatedAt (newest first)
    return enrichedAccounts.sort((a, b) => {
      const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return dateB - dateA;
    });
  },
});

/**
 * Get a specific bank account by ID
 */
export const getBankAccount = query({
  args: {
    workspaceId: v.id('workspace'),
    bankAccountId: v.id('bankAccount'),
  },
  handler: async (ctx, { workspaceId, bankAccountId }) => {
    const { user, workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);
    const favoriteBankAccountIds = await getFavoriteBankAccountIds(ctx, verifiedWorkspaceId, user.subject);

    const bankAccount = await ctx.db.get(bankAccountId);
    if (!bankAccount || bankAccount.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Bank account not found or does not belong to workspace');
    }

    // Enrich with bank link information if available
    let bankLink: Awaited<ReturnType<typeof ctx.db.get<'bankLink'>>> = null;
    let bankLinkAccount: Awaited<ReturnType<typeof ctx.db.get<'bankLinkAccount'>>> = null;
    let globalInstitution: Doc<'globalInstitution'> | null = null;
    if (bankAccount.bankLinkAccountId) {
      bankLinkAccount = await ctx.db.get(bankAccount.bankLinkAccountId);

      if (bankLinkAccount) {
        bankLink = await ctx.db.get(bankLinkAccount.bankLinkId);
        if (bankLink?.globalInstitutionId) {
          globalInstitution = await ctx.db.get(bankLink.globalInstitutionId);
        }
      }
    }

    const financeKitAccountData = await getFinanceKitAccountData(ctx, bankAccount, verifiedWorkspaceId);
    const { institutionLogoUrl, resolvedLogoUrl } = getBankAccountLogoFields(
      bankAccount,
      globalInstitution,
      financeKitAccountData !== null
    );

    return {
      _id: bankAccount._id,
      name: bankAccount.name,
      workspaceId: bankAccount.workspaceId,
      logoUrl: bankAccount.logoUrl,
      resolvedLogoUrl,
      institutionLogoUrl,
      connectionAccount: getConnectionAccountRef(bankAccount),
      visualIdentityMode: bankAccount.visualIdentityMode ?? 'logo',
      iconName: bankAccount.iconName,
      iconColorId: bankAccount.iconColorId,
      bankLinkAccountId: bankAccount.bankLinkAccountId,
      financeKitAccountId: bankAccount.financeKitAccountId,
      currentBalance: bankAccount.currentBalance,
      pendingBalance: bankAccount.pendingBalance,
      clearedBalance: bankAccount.clearedBalance,
      firstBalanceYearMonth: getFirstBalanceYearMonth(bankAccount),
      isDeleted: bankAccount.isDeleted,
      isClosed: bankAccount.isClosed,
      closedAt: bankAccount.closedAt,
      updatedAt: bankAccount.updatedAt,
      deletedAt: bankAccount.deletedAt,
      bankLink: bankLink
        ? {
            _id: bankLink._id,
            globalInstitutionId: bankLink.globalInstitutionId,
            itemStatus: bankLink.itemStatus,
            lastSyncedAt: bankLink.lastSyncedAt,
          }
        : null,
      bankLinkAccount: bankLinkAccount
        ? {
            _id: bankLinkAccount._id,
            accountType: bankLinkAccount.accountType,
            currentBalance: bankLinkAccount.currentBalance,
            availableBalance: bankLinkAccount.availableBalance,
            accountNumberMask: bankLinkAccount.accountNumberMask,
            officialName: bankLinkAccount.officialName,
          }
        : null,
      financeKitAccount: financeKitAccountData,
      isFavorite: favoriteBankAccountIds.has(bankAccount._id),
    };
  },
});

/**
 * Get a specific bank account by short ID (last 8 characters)
 */
export const getBankAccountByShortId = query({
  args: {
    workspaceId: v.id('workspace'),
    shortId: v.string(),
  },
  handler: async (ctx, { workspaceId, shortId }) => {
    const { user, workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);
    const favoriteBankAccountIds = await getFavoriteBankAccountIds(ctx, verifiedWorkspaceId, user.subject);

    // Get all bank accounts for the organization
    const bankAccounts = await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Find bank account matching the short ID
    const bankAccount = bankAccounts.find((ba) => ba._id.slice(-8) === shortId);

    if (!bankAccount) {
      return null;
    }

    // Enrich with bank link information if available
    let bankLinkAccount: Doc<'bankLinkAccount'> | null = null;
    let bankLink: Doc<'bankLink'> | null = null;
    let globalInstitution: Doc<'globalInstitution'> | null = null;

    if (bankAccount.bankLinkAccountId) {
      bankLinkAccount = await ctx.db.get(bankAccount.bankLinkAccountId);
      if (bankLinkAccount) {
        bankLink = await ctx.db.get(bankLinkAccount.bankLinkId);
        // Handle both new (globalInstitutionId) and legacy records
        if (bankLink?.globalInstitutionId) {
          globalInstitution = await ctx.db.get(bankLink.globalInstitutionId);
        }
      }
    }

    const bankLinkAccountData =
      bankLinkAccount && bankLink && globalInstitution
        ? {
            _id: bankLinkAccount._id,
            name: bankLinkAccount.name,
            accountType: bankLinkAccount.accountType,
            currentBalance: bankLinkAccount.currentBalance,
            availableBalance: bankLinkAccount.availableBalance,
            accountNumberMask: bankLinkAccount.accountNumberMask,
            officialName: bankLinkAccount.officialName,
            bankLink: {
              _id: bankLink._id,
              // Return as "institution" for frontend
              institution: {
                _id: globalInstitution._id,
                name: globalInstitution.name,
                logoUrl: appendLogoDevToken(globalInstitution.logoUrl),
                primaryColor: globalInstitution.primaryColor,
                updatedAt: globalInstitution.updatedAt,
              },
              itemStatus: bankLink.itemStatus,
              lastSyncedAt: bankLink.lastSyncedAt,
            },
          }
        : null;

    const financeKitAccountData = await getFinanceKitAccountData(ctx, bankAccount, verifiedWorkspaceId);
    const { institutionLogoUrl, resolvedLogoUrl } = getBankAccountLogoFields(
      bankAccount,
      globalInstitution,
      financeKitAccountData !== null
    );

    return {
      _id: bankAccount._id,
      name: bankAccount.name,
      notes: bankAccount.notes,
      logoUrl: bankAccount.logoUrl,
      resolvedLogoUrl,
      institutionLogoUrl,
      visualIdentityMode: bankAccount.visualIdentityMode ?? 'logo',
      iconName: bankAccount.iconName,
      iconColorId: bankAccount.iconColorId,
      workspaceId: bankAccount.workspaceId,
      connectionAccount: getConnectionAccountRef(bankAccount),
      bankLinkAccountId: bankAccount.bankLinkAccountId,
      financeKitAccountId: bankAccount.financeKitAccountId,
      accountType: bankAccount.accountType,
      currentBalance: bankAccount.currentBalance,
      pendingBalance: bankAccount.pendingBalance,
      clearedBalance: bankAccount.clearedBalance,
      firstBalanceYearMonth: getFirstBalanceYearMonth(bankAccount),
      isDeleted: bankAccount.isDeleted,
      isClosed: bankAccount.isClosed,
      closedAt: bankAccount.closedAt,
      updatedAt: bankAccount.updatedAt,
      deletedAt: bankAccount.deletedAt,
      createdAt: bankAccount._creationTime ? new Date(bankAccount._creationTime).toISOString() : bankAccount.updatedAt,
      bankLinkAccount: bankLinkAccountData,
      financeKitAccount: financeKitAccountData,
      isFavorite: favoriteBankAccountIds.has(bankAccount._id),
    };
  },
});

/**
 * Get bank accounts with balances for workspace overview
 */
export const getBankAccountSummary = query({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { workspaceId }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    const bankAccounts = await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    const accountSummaries = await Promise.all(
      bankAccounts.map(async (account) => {
        // Get transaction count
        const transactions = await ctx.db
          .query('transaction')
          .withIndex('by_workspaceId_bankAccountId_isDeleted', (q) =>
            q.eq('workspaceId', verifiedWorkspaceId).eq('bankAccountId', account._id).eq('isDeleted', false)
          )
          .collect();

        // Get linked balance if available (for comparison/debugging)
        let linkedBalance: number | null = null;
        if (account.bankLinkAccountId) {
          const bankLinkAccount = await ctx.db.get(account.bankLinkAccountId);

          if (bankLinkAccount) {
            linkedBalance = bankLinkAccount.currentBalance ?? null;
          }
        }

        return {
          _id: account._id,
          name: account.name,
          calculatedBalance: account.currentBalance,
          linkedBalance,
          transactionCount: transactions.length,
          isLinked: !!account.bankLinkAccountId || !!account.financeKitAccountId,
        };
      })
    );

    const totalCalculatedBalance = accountSummaries.reduce((sum, account) => sum + account.calculatedBalance, 0n);

    const totalLinkedBalance = accountSummaries.reduce((sum, account) => sum + (account.linkedBalance ?? 0), 0);

    return {
      accounts: accountSummaries,
      totalCalculatedBalance,
      totalLinkedBalance,
      accountCount: accountSummaries.length,
    };
  },
});

/**
 * Get all archived (soft-deleted) bank accounts for a workspace
 */
export const listArchivedBankAccounts = query({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { workspaceId }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    const bankAccounts = await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', verifiedWorkspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), true))
      .collect();

    // Sort by deletion date (newest first)
    return bankAccounts.sort((a, b) => {
      if (!a.deletedAt && !b.deletedAt) return 0;
      if (!a.deletedAt) return 1;
      if (!b.deletedAt) return -1;
      return new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime();
    });
  },
});

/**
 * Debug function to verify balance calculations across ALL workspaces
 * Calculates the sum of all transactions for each bank account and compares with stored currentBalance
 * No authentication required - can be called from Convex dashboard
 */
/**
 * Check if a bank account has any non-deleted transactions
 */
export const hasTransactions = query({
  args: {
    workspaceId: v.id('workspace'),
    bankAccountId: v.id('bankAccount'),
  },
  handler: async (ctx, { workspaceId, bankAccountId }) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, workspaceId);

    const transaction = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId_bankAccountId_isDeleted', (q) =>
        q.eq('workspaceId', verifiedWorkspaceId).eq('bankAccountId', bankAccountId).eq('isDeleted', false)
      )
      .first();

    return transaction !== null;
  },
});

export const verifyBankAccountBalances = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Get ALL bank accounts (no org filtering)
    const bankAccounts = await ctx.db
      .query('bankAccount')
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    const results: Array<{
      bankAccountId: Id<'bankAccount'>;
      bankAccountName: string;
      workspaceId: Id<'workspace'>;
      storedBalance: bigint;
      calculatedBalance: bigint;
      difference: bigint;
      balanceMatches: boolean;
      transactionCount: number;
    }> = [];
    let totalAccountsChecked = 0;
    let accountsWithMismatch = 0;

    console.log(`=== Verifying ${bankAccounts.length} bank accounts ===`);

    for (const account of bankAccounts) {
      totalAccountsChecked++;

      // Get all non-deleted transactions for this account
      const transactions = await ctx.db
        .query('transaction')
        .withIndex('by_workspaceId_bankAccountId_isDeleted', (q) =>
          q.eq('workspaceId', account.workspaceId).eq('bankAccountId', account._id).eq('isDeleted', false)
        )
        .collect();

      // Calculate sum of all transactions from embedded movements
      const calculatedBalance = transactions.reduce(
        (sum, t) => sum + (t.totalAmount ?? t.movements?.reduce((s, m) => s + m.amount, 0n) ?? 0n),
        0n
      );

      // Compare with stored balance
      const storedBalance = account.currentBalance;
      const balanceMatches = calculatedBalance === storedBalance;

      if (!balanceMatches) {
        accountsWithMismatch++;
      }

      const result = {
        bankAccountId: account._id,
        bankAccountName: account.name,
        workspaceId: account.workspaceId,
        storedBalance,
        calculatedBalance,
        difference: calculatedBalance - storedBalance,
        balanceMatches,
        transactionCount: transactions.length,
      };

      results.push(result);

      // Log to console for debugging
      const status = balanceMatches ? '✓' : '✗ MISMATCH';
      console.log(`\n[${status}] Bank Account: ${account.name} (${account._id})`);
      console.log(`  Workspace ID: ${account.workspaceId}`);
      console.log(`  Stored Balance: ${storedBalance}`);
      console.log(`  Calculated Balance: ${calculatedBalance}`);
      console.log(`  Difference: ${calculatedBalance - storedBalance}`);
      console.log(`  Transaction Count: ${transactions.length}`);
    }

    const summary = {
      totalAccountsChecked,
      accountsWithMismatch,
      allBalancesMatch: accountsWithMismatch === 0,
    };

    console.log(`\n=== SUMMARY ===`);
    console.log(`Total Accounts Checked: ${totalAccountsChecked}`);
    console.log(`Accounts with Mismatch: ${accountsWithMismatch}`);
    console.log(`All Balances Match: ${summary.allBalancesMatch ? '✓ YES' : '✗ NO'}`);

    return {
      summary,
      results,
    };
  },
});
