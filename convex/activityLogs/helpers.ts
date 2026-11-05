import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { resolveMerchantName } from '../transactions/helpers';

import type {
  ActivityAttribution,
  ActivityContext,
  ActivityDetails,
  ActivityEntityType,
  ActivityEventType,
  ActivitySource,
  BankAccountActivitySnapshot,
  BankConnectionActivitySnapshot,
  CategoryActivitySnapshot,
  MerchantActivitySnapshot,
  MoneyMovementSnapshot,
  NamedEntitySnapshot,
  TransactionActivitySnapshot,
} from './types';

type ReadCtx = QueryCtx | MutationCtx;
const ACTIVITY_TRANSACTION_MOVEMENT_LIMIT = 200;

export async function buildActivityContextForClerkId(
  ctx: ReadCtx,
  clerkId: string,
  source: ActivitySource
): Promise<ActivityContext> {
  const userProfile = await ctx.db
    .query('userProfile')
    .withIndex('by_clerkId', (q) => q.eq('clerkId', clerkId))
    .first();

  return {
    actor: {
      clerkId,
      userProfileId: userProfile?._id,
      name: userProfile?.name,
      email: userProfile?.email,
    },
    source,
  };
}

export async function buildActivityContext(ctx: ReadCtx, attribution: ActivityAttribution): Promise<ActivityContext> {
  return buildActivityContextForClerkId(ctx, attribution.clerkId, attribution.source);
}

export async function buildActivityContextForUserProfile(
  ctx: ReadCtx,
  userProfileId: Id<'userProfile'>,
  source: ActivitySource
): Promise<ActivityContext | null> {
  const userProfile = await ctx.db.get(userProfileId);
  if (!userProfile) {
    return null;
  }

  return {
    actor: {
      clerkId: userProfile.clerkId,
      userProfileId: userProfile._id,
      name: userProfile.name,
      email: userProfile.email,
    },
    source,
  };
}

export async function buildSystemActivityContextForWorkspace(
  ctx: ReadCtx,
  workspaceId: Id<'workspace'>,
  process: Extract<ActivitySource, { type: 'system' }>['process'],
  preferredUserProfileId?: Id<'userProfile'>
): Promise<ActivityContext> {
  if (preferredUserProfileId) {
    const preferred = await buildActivityContextForUserProfile(ctx, preferredUserProfileId, {
      type: 'system',
      process,
    });
    if (preferred) {
      return preferred;
    }
  }

  const workspace = await ctx.db.get(workspaceId);
  const ownerClerkId = workspace?.ownerClerkId ?? 'system';
  return buildActivityContextForClerkId(ctx, ownerClerkId, { type: 'system', process });
}

export async function getWorkspaceCurrencyCode(ctx: ReadCtx, workspaceId: Id<'workspace'>): Promise<string> {
  const workspace = await ctx.db.get(workspaceId);
  return workspace?.currency ?? 'USD';
}

export async function insertActivityLog(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<'workspace'>;
    context: ActivityContext;
    type: ActivityEventType;
    entityType: ActivityEntityType;
    entityId: string;
    details: ActivityDetails;
    occurredAt?: string;
  }
): Promise<Id<'activityLog'>> {
  return await ctx.db.insert('activityLog', {
    workspaceId: args.workspaceId,
    actor: args.context.actor,
    source: args.context.source,
    type: args.type,
    entityType: args.entityType,
    entityId: args.entityId,
    currencyCode: await getWorkspaceCurrencyCode(ctx, args.workspaceId),
    details: args.details,
    occurredAt: args.occurredAt ?? new Date().toISOString(),
  });
}

export async function recordTransactionActivity(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<'workspace'>;
    context: ActivityContext;
    type: Extract<
      ActivityEventType,
      | 'transaction_created'
      | 'transaction_updated'
      | 'transaction_deleted'
      | 'transaction_restored'
      | 'scheduled_transaction_entered'
    >;
    before?: Doc<'transaction'>;
    after?: Doc<'transaction'>;
  }
): Promise<void> {
  const transaction = args.after ?? args.before;
  if (!transaction) {
    return;
  }

  await insertActivityLog(ctx, {
    workspaceId: args.workspaceId,
    context: args.context,
    type: args.type,
    entityType: 'transaction',
    entityId: transaction._id,
    details: {
      kind: 'transaction',
      before: args.before ? await snapshotTransaction(ctx, args.before) : undefined,
      after: args.after ? await snapshotTransaction(ctx, args.after) : undefined,
    },
  });
}

export async function recordBankAccountActivity(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<'workspace'>;
    context: ActivityContext;
    type: Extract<
      ActivityEventType,
      | 'bank_account_created'
      | 'bank_account_updated'
      | 'bank_account_closed'
      | 'bank_account_reopened'
      | 'bank_account_deleted'
      | 'bank_account_restored'
    >;
    before?: Doc<'bankAccount'>;
    after?: Doc<'bankAccount'>;
  }
): Promise<void> {
  const bankAccount = args.after ?? args.before;
  if (!bankAccount) {
    return;
  }

  await insertActivityLog(ctx, {
    workspaceId: args.workspaceId,
    context: args.context,
    type: args.type,
    entityType: 'bank_account',
    entityId: bankAccount._id,
    details: {
      kind: 'bank_account',
      before: args.before ? snapshotBankAccount(args.before) : undefined,
      after: args.after ? snapshotBankAccount(args.after) : undefined,
    },
  });
}

export async function recordCategoryActivity(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<'workspace'>;
    context: ActivityContext;
    type: Extract<
      ActivityEventType,
      | 'category_created'
      | 'category_updated'
      | 'category_archived'
      | 'category_unarchived'
      | 'category_deleted'
      | 'category_restored'
    >;
    before?: Doc<'category'>;
    after?: Doc<'category'>;
  }
): Promise<void> {
  const category = args.after ?? args.before;
  if (!category) {
    return;
  }

  await insertActivityLog(ctx, {
    workspaceId: args.workspaceId,
    context: args.context,
    type: args.type,
    entityType: 'category',
    entityId: category._id,
    details: {
      kind: 'category',
      before: args.before ? await snapshotCategory(ctx, args.before) : undefined,
      after: args.after ? await snapshotCategory(ctx, args.after) : undefined,
    },
  });
}

export async function recordMerchantActivity(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<'workspace'>;
    context: ActivityContext;
    type: Extract<ActivityEventType, 'merchant_created' | 'merchant_updated' | 'merchant_deleted' | 'merchant_merged'>;
    before?: Doc<'merchant'>;
    after?: Doc<'merchant'>;
    mergeTarget?: Doc<'merchant'>;
    movedTransactionCount?: number;
    updatedRecurringTransactionCount?: number;
  }
): Promise<void> {
  const merchant = args.after ?? args.before;
  if (!merchant) {
    return;
  }

  await insertActivityLog(ctx, {
    workspaceId: args.workspaceId,
    context: args.context,
    type: args.type,
    entityType: 'merchant',
    entityId: merchant._id,
    details: {
      kind: 'merchant',
      before: args.before ? await snapshotMerchant(ctx, args.before) : undefined,
      after: args.after ? await snapshotMerchant(ctx, args.after) : undefined,
      mergeTarget: args.mergeTarget ? await snapshotMerchant(ctx, args.mergeTarget) : undefined,
      movedTransactionCount: args.movedTransactionCount,
      updatedRecurringTransactionCount: args.updatedRecurringTransactionCount,
    },
  });
}

export async function recordBankConnectionActivity(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<'workspace'>;
    context: ActivityContext;
    type: 'bank_connection_added' | 'bank_connection_disconnected';
    connection: BankConnectionActivitySnapshot;
  }
): Promise<void> {
  await insertActivityLog(ctx, {
    workspaceId: args.workspaceId,
    context: args.context,
    type: args.type,
    entityType: 'bank_connection',
    entityId: args.connection.id,
    details: {
      kind: 'bank_connection',
      connection: args.connection,
    },
  });
}

function namedEntity(id: string, name: string): NamedEntitySnapshot {
  return { id, name };
}

export async function snapshotTransaction(
  ctx: ReadCtx,
  transaction: Doc<'transaction'>
): Promise<TransactionActivitySnapshot> {
  const [bankAccount, merchantName, transferAccount] = await Promise.all([
    ctx.db.get(transaction.bankAccountId),
    transaction.merchantId
      ? resolveMerchantName(ctx, transaction.merchantId, transaction.importDetails)
      : Promise.resolve(''),
    transaction.transferPairBankAccountId ? ctx.db.get(transaction.transferPairBankAccountId) : Promise.resolve(null),
  ]);

  return {
    id: transaction._id,
    type: transaction.type,
    date: transaction.date,
    amount: transaction.totalAmount,
    account: namedEntity(transaction.bankAccountId, bankAccount?.name ?? 'Deleted account'),
    transferAccount: transferAccount
      ? namedEntity(transferAccount._id, transferAccount.name)
      : transaction.transferPairBankAccountId
        ? namedEntity(transaction.transferPairBankAccountId, 'Deleted account')
        : undefined,
    merchant: transaction.merchantId ? namedEntity(transaction.merchantId, merchantName || 'Deleted payee') : undefined,
    movements: transaction.movements.slice(0, ACTIVITY_TRANSACTION_MOVEMENT_LIMIT).map((movement) => ({
      amount: movement.amount,
      category: movement.categoryId
        ? namedEntity(movement.categoryId, movement.categoryName ?? 'Deleted category')
        : undefined,
      readyToAssign: movement.readyToAssign,
      notes: movement.notes,
    })),
    movementCount: transaction.movements.length,
    movementsTruncated: transaction.movements.length > ACTIVITY_TRANSACTION_MOVEMENT_LIMIT,
    notes: transaction.notes,
    status: transaction.status,
    reviewStatus: transaction.reviewStatus,
    scheduledTransactionId: transaction.scheduledTransactionId,
  };
}

export function snapshotBankAccount(bankAccount: Doc<'bankAccount'>): BankAccountActivitySnapshot {
  let connection: BankAccountActivitySnapshot['connection'];
  if (bankAccount.bankLinkAccountId) {
    connection = {
      provider: 'plaid',
      externalAccountId: bankAccount.bankLinkAccountId,
    };
  } else if (bankAccount.financeKitAccountId) {
    connection = {
      provider: 'apple_wallet',
      externalAccountId: bankAccount.financeKitAccountId,
    };
  }

  return {
    id: bankAccount._id,
    name: bankAccount.name,
    accountType: bankAccount.accountType,
    currentBalance: bankAccount.currentBalance,
    isClosed: bankAccount.isClosed,
    notes: bankAccount.notes,
    logoUrl: bankAccount.logoUrl,
    visualIdentityMode: bankAccount.visualIdentityMode,
    iconName: bankAccount.iconName,
    iconColorId: bankAccount.iconColorId,
    connection,
  };
}

export async function snapshotCategory(ctx: ReadCtx, category: Doc<'category'>): Promise<CategoryActivitySnapshot> {
  const group = await ctx.db.get(category.categoryGroupId);
  return {
    id: category._id,
    name: category.name,
    group: group ? namedEntity(group._id, group.name) : undefined,
    isArchived: category.isArchived ?? false,
    categoryType: category.categoryType,
    iconName: category.iconName,
    sortOrder: category.sortOrder,
    target: {
      enabled: category.enableTarget ?? false,
      type: category.target_type,
      amount: category.target_amount,
      frequency: category.target_frequency,
      frequencyInterval: category.target_frequencyInterval,
      dayOfWeek: category.target_dayOfWeek,
      dueDay: category.target_dueDay,
      firstDueDate: category.target_firstDueDate,
      targetDate: category.target_targetDate,
      monthlyContribution: category.target_monthlyContribution,
      targetBalance: category.target_targetBalance,
    },
  };
}

export async function snapshotMerchant(ctx: ReadCtx, merchant: Doc<'merchant'>): Promise<MerchantActivitySnapshot> {
  const globalMerchant = merchant.globalMerchantId ? await ctx.db.get(merchant.globalMerchantId) : null;

  return {
    id: merchant._id,
    name: merchant.name ?? globalMerchant?.name ?? 'Unknown merchant',
    logoUrl: merchant.logoUrl,
    visualIdentityMode: merchant.visualIdentityMode,
    iconName: merchant.iconName,
    iconColorId: merchant.iconColorId,
    isDeleted: merchant.isDeleted,
  };
}

export function buildAssignmentMoneyMovements(
  changes: Array<{
    category: NamedEntitySnapshot;
    previousAssignedAmount: bigint;
    assignedAmount: bigint;
  }>
): MoneyMovementSnapshot[] {
  const actualChanges = changes
    .map((change) => ({ ...change, delta: change.assignedAmount - change.previousAssignedAmount }))
    .filter((change) => change.delta !== 0n);

  if (
    actualChanges.length === 2 &&
    actualChanges[0].delta === -actualChanges[1].delta &&
    actualChanges[0].delta !== 0n
  ) {
    const from = actualChanges[0].delta < 0n ? actualChanges[0] : actualChanges[1];
    const to = actualChanges[0].delta > 0n ? actualChanges[0] : actualChanges[1];
    return [
      {
        amount: to.delta,
        from: { type: 'category', category: from.category },
        to: { type: 'category', category: to.category },
        fromAssignedAmount: from.previousAssignedAmount,
        toAssignedAmount: to.previousAssignedAmount,
      },
    ];
  }

  return actualChanges.map((change) =>
    change.delta > 0n
      ? {
          amount: change.delta,
          from: { type: 'ready_to_assign' as const },
          to: { type: 'category' as const, category: change.category },
          toAssignedAmount: change.previousAssignedAmount,
        }
      : {
          amount: -change.delta,
          from: { type: 'category' as const, category: change.category },
          to: { type: 'ready_to_assign' as const },
          fromAssignedAmount: change.previousAssignedAmount,
        }
  );
}
