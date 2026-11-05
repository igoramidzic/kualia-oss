import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { isOnBudgetAccountType } from '../transactions/helpers';

import { resolveMcpAmountMetadata, type McpAmountMetadata } from './tools';

type BankAccountEntry = {
  bankAccountId: Id<'bankAccount'>;
  name: string;
  accountType: Doc<'bankAccount'>['accountType'];
  isOnBudget: boolean;
  currentBalance: bigint;
  isClosed: boolean;
  isLinked: boolean;
};

export type BankAccountsToolPayload = McpAmountMetadata & {
  workspaceId: Id<'workspace'>;
  currency: string;
  accounts: BankAccountEntry[];
};

/**
 * Read all bank accounts for the workspace, optionally including closed accounts. Sorted by
 * (open before closed, then alphabetical name) so the agent surfaces the most likely picks first.
 */
export async function listBankAccountsForMcp(
  ctx: QueryCtx,
  workspace: Doc<'workspace'>,
  options: { includeClosed: boolean }
): Promise<BankAccountsToolPayload> {
  const accounts = await ctx.db
    .query('bankAccount')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspace._id))
    .collect();

  const filtered = accounts.filter((a) => {
    if (a.isDeleted) return false;
    if (!options.includeClosed && a.isClosed) return false;
    return true;
  });

  filtered.sort((a, b) => {
    if (a.isClosed !== b.isClosed) return a.isClosed ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  const currencyCode = workspace.currency ?? 'USD';
  const amountMetadata = resolveMcpAmountMetadata(currencyCode);

  return {
    workspaceId: workspace._id,
    currency: currencyCode,
    ...amountMetadata,
    accounts: filtered.map((account) => ({
      bankAccountId: account._id,
      name: account.name,
      accountType: account.accountType,
      isOnBudget: isOnBudgetAccountType(account.accountType),
      currentBalance: account.currentBalance,
      isClosed: account.isClosed,
      isLinked: account.bankLinkAccountId !== undefined,
    })),
  };
}
