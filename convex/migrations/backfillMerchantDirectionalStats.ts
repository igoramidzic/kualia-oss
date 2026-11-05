import { Migrations } from '@convex-dev/migrations';

import { components } from '../_generated/api';
import type { DataModel } from '../_generated/dataModel';
import { internalMutation } from '../_generated/server';
import { dateToYearMonth } from '../categoryBudgets/calculations';
import { isOnBudgetAccountType } from '../transactions/helpers';

const migrations = new Migrations<DataModel>(components.migrations, {
  internalMutation,
  migrationsLocationPrefix: 'migrations/backfillMerchantDirectionalStats:',
});

export interface DirectionalTransaction {
  bankAccountId: string;
  date: string;
  totalAmount: bigint;
}

export interface MonthlyDirectionalStats {
  inflowAmount: bigint;
  outflowAmount: bigint;
  inflowCount: bigint;
  outflowCount: bigint;
}

export function calculateMonthlyDirectionalStats(
  transactions: DirectionalTransaction[],
  accountTypes: Map<string, string>
): Record<string, MonthlyDirectionalStats> {
  const result: Record<string, MonthlyDirectionalStats> = {};

  for (const transaction of transactions) {
    const accountType = accountTypes.get(transaction.bankAccountId);
    if (accountType && !isOnBudgetAccountType(accountType)) {
      continue;
    }

    const yearMonth = dateToYearMonth(transaction.date).toString();
    const current = result[yearMonth] ?? {
      inflowAmount: 0n,
      outflowAmount: 0n,
      inflowCount: 0n,
      outflowCount: 0n,
    };

    if (transaction.totalAmount > 0n) {
      current.inflowAmount += transaction.totalAmount;
      current.inflowCount += 1n;
    } else if (transaction.totalAmount < 0n) {
      current.outflowAmount += -transaction.totalAmount;
      current.outflowCount += 1n;
    }

    result[yearMonth] = current;
  }

  return result;
}

/**
 * Backfill the gross inflow/outflow merchant aggregates used by reports.
 *
 * Keep monthlyDirectionalStats optional until this migration has completed in
 * every deployment. One merchant is processed per batch because each row scans
 * that merchant's transaction history.
 *
 * Dry run:
 * npx convex run migrations/backfillMerchantDirectionalStats:backfill \
 *   '{"dryRun":true}' --prod
 *
 * Apply:
 * npx convex run migrations/backfillMerchantDirectionalStats:backfill --prod
 */
export const backfill = migrations.define({
  table: 'merchant',
  batchSize: 1,
  migrateOne: async (ctx, merchant) => {
    const [transactions, bankAccounts] = await Promise.all([
      ctx.db
        .query('transaction')
        .withIndex('by_workspaceId_merchantId', (q) =>
          q.eq('workspaceId', merchant.workspaceId).eq('merchantId', merchant._id)
        )
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .collect(),
      ctx.db
        .query('bankAccount')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', merchant.workspaceId))
        .collect(),
    ]);
    const accountTypes = new Map(bankAccounts.map((account) => [account._id.toString(), account.accountType]));

    await ctx.db.patch(merchant._id, {
      monthlyDirectionalStats: calculateMonthlyDirectionalStats(transactions, accountTypes),
      updatedAt: new Date().toISOString(),
    });
  },
});
