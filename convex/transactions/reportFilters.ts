import type { Doc, Id } from '../_generated/dataModel';
import type { TransactionFeedLookups } from './feed';

/** Shared identities keep report rows and transaction drilldowns in agreement. */
export function reportMerchantIdentity(transaction: Doc<'transaction'>, lookups: TransactionFeedLookups) {
  const merchant = transaction.merchantId ? lookups.merchants.get(transaction.merchantId) : undefined;
  const global = merchant?.globalMerchantId ? lookups.globalMerchants.get(merchant.globalMerchantId) : undefined;
  const name =
    merchant?.name ??
    global?.name ??
    transaction.importDetails?.merchantName ??
    transaction.plaidMerchantName ??
    'No merchant';
  return { id: merchant?._id ?? `unlinked:${name.trim().toLocaleLowerCase('en-US')}`, name };
}

export function reportMovementGroup(
  movement: Doc<'transaction'>['movements'][number],
  lookups: TransactionFeedLookups,
  groups: ReadonlyMap<Id<'categoryGroup'>, Doc<'categoryGroup'>>
) {
  if (movement.readyToAssign) return { groupId: 'ready-to-assign', groupName: 'Ready to assign' };
  const category = movement.categoryId ? lookups.categories.get(movement.categoryId) : undefined;
  const group = category ? groups.get(category.categoryGroupId) : undefined;
  return group ? { groupId: group._id, groupName: group.name } : { groupId: 'ungrouped', groupName: 'Ungrouped' };
}

export type ReportFlow = 'inflow' | 'outflow';

interface ReportMovement {
  amount: bigint;
  categoryId?: string;
  readyToAssign?: boolean;
}

interface ReportTransaction {
  totalAmount: bigint;
  movements?: ReportMovement[];
}

interface ReportFilter {
  categoryId?: string;
  categoryIdsInGroup?: Set<string> | null;
  isIncome: boolean;
  isUncategorized: boolean;
  merchantId?: string;
}

function amountMatchesFlow(amount: bigint, flow: ReportFlow): boolean {
  return flow === 'inflow' ? amount > 0n : amount < 0n;
}

export function transactionMatchesReportFlow(
  transaction: ReportTransaction,
  flow: ReportFlow | undefined,
  filter: ReportFilter
): boolean {
  if (!flow) {
    return true;
  }

  if (filter.merchantId) {
    return amountMatchesFlow(transaction.totalAmount, flow);
  }

  const movements = transaction.movements ?? [];
  if (filter.isIncome) {
    return movements.some((movement) => movement.readyToAssign === true && amountMatchesFlow(movement.amount, flow));
  }

  if (filter.isUncategorized) {
    return movements.some(
      (movement) => !movement.categoryId && !movement.readyToAssign && amountMatchesFlow(movement.amount, flow)
    );
  }

  if (filter.categoryId) {
    return movements.some(
      (movement) => movement.categoryId === filter.categoryId && amountMatchesFlow(movement.amount, flow)
    );
  }

  if (filter.categoryIdsInGroup) {
    return movements.some(
      (movement) =>
        !!movement.categoryId &&
        filter.categoryIdsInGroup?.has(movement.categoryId) === true &&
        amountMatchesFlow(movement.amount, flow)
    );
  }

  return amountMatchesFlow(transaction.totalAmount, flow);
}
