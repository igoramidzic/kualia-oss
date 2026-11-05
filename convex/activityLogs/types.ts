import { type Infer, v } from 'convex/values';

import { entityIconColorId, visualIdentityMode } from '../lib/entityIdentity';

export const activityEventTypeValidator = v.union(
  v.literal('transaction_created'),
  v.literal('transaction_updated'),
  v.literal('transaction_deleted'),
  v.literal('transaction_restored'),
  v.literal('scheduled_transaction_entered'),
  v.literal('bank_account_created'),
  v.literal('bank_account_updated'),
  v.literal('bank_account_closed'),
  v.literal('bank_account_reopened'),
  v.literal('bank_account_deleted'),
  v.literal('bank_account_restored'),
  v.literal('category_created'),
  v.literal('category_updated'),
  v.literal('category_archived'),
  v.literal('category_unarchived'),
  v.literal('category_deleted'),
  v.literal('category_restored'),
  v.literal('merchant_created'),
  v.literal('merchant_updated'),
  v.literal('merchant_deleted'),
  v.literal('merchant_merged'),
  v.literal('money_moved'),
  v.literal('bank_connection_added'),
  v.literal('bank_connection_disconnected')
);

export type ActivityEventType = Infer<typeof activityEventTypeValidator>;

export const activityEntityTypeValidator = v.union(
  v.literal('transaction'),
  v.literal('bank_account'),
  v.literal('category'),
  v.literal('merchant'),
  v.literal('budget_assignment'),
  v.literal('bank_connection')
);

export type ActivityEntityType = Infer<typeof activityEntityTypeValidator>;

export const activityActorValidator = v.object({
  clerkId: v.string(),
  userProfileId: v.optional(v.id('userProfile')),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
});

export type ActivityActor = Infer<typeof activityActorValidator>;

export const activitySourceValidator = v.union(
  v.object({
    type: v.literal('kualia_ui'),
  }),
  v.object({
    type: v.literal('public_api'),
    apiKeyId: v.id('apiKey'),
    apiKeyLabel: v.string(),
    apiKeyPrefix: v.string(),
  }),
  v.object({
    type: v.literal('mcp'),
    oauthAccessTokenId: v.optional(v.id('mcpOauthAccessToken')),
    clientId: v.optional(v.string()),
    clientName: v.optional(v.string()),
  }),
  v.object({
    type: v.literal('system'),
    process: v.union(
      v.literal('scheduled_transaction'),
      v.literal('bank_import'),
      v.literal('financekit_sync'),
      v.literal('system')
    ),
  })
);

export type ActivitySource = Infer<typeof activitySourceValidator>;

export const activityAttributionValidator = v.object({
  clerkId: v.string(),
  source: activitySourceValidator,
});

export type ActivityAttribution = Infer<typeof activityAttributionValidator>;

const namedEntitySnapshotValidator = v.object({
  id: v.string(),
  name: v.string(),
});

export type NamedEntitySnapshot = Infer<typeof namedEntitySnapshotValidator>;

export const transactionSnapshotValidator = v.object({
  id: v.id('transaction'),
  type: v.union(
    v.literal('regular'),
    v.literal('starting_balance'),
    v.literal('balance_adjustment'),
    v.literal('transfer')
  ),
  date: v.string(),
  amount: v.int64(),
  account: namedEntitySnapshotValidator,
  transferAccount: v.optional(namedEntitySnapshotValidator),
  merchant: v.optional(namedEntitySnapshotValidator),
  movements: v.array(
    v.object({
      amount: v.int64(),
      category: v.optional(namedEntitySnapshotValidator),
      readyToAssign: v.boolean(),
      notes: v.optional(v.string()),
    })
  ),
  movementCount: v.number(),
  movementsTruncated: v.boolean(),
  notes: v.optional(v.string()),
  status: v.union(v.literal('pending'), v.literal('cleared'), v.literal('reconciled')),
  reviewStatus: v.union(v.literal('reviewed'), v.literal('needs_review')),
  scheduledTransactionId: v.optional(v.id('scheduledTransaction')),
});

export type TransactionActivitySnapshot = Infer<typeof transactionSnapshotValidator>;

export const bankAccountSnapshotValidator = v.object({
  id: v.id('bankAccount'),
  name: v.string(),
  accountType: v.string(),
  currentBalance: v.int64(),
  isClosed: v.boolean(),
  notes: v.optional(v.string()),
  logoUrl: v.optional(v.union(v.string(), v.null())),
  visualIdentityMode: v.optional(visualIdentityMode),
  iconName: v.optional(v.string()),
  iconColorId: v.optional(entityIconColorId),
  connection: v.optional(
    v.object({
      provider: v.union(v.literal('plaid'), v.literal('apple_wallet')),
      externalAccountId: v.string(),
    })
  ),
});

export type BankAccountActivitySnapshot = Infer<typeof bankAccountSnapshotValidator>;

export const categorySnapshotValidator = v.object({
  id: v.id('category'),
  name: v.string(),
  group: v.optional(namedEntitySnapshotValidator),
  isArchived: v.boolean(),
  categoryType: v.optional(v.string()),
  iconName: v.optional(v.string()),
  sortOrder: v.number(),
  target: v.object({
    enabled: v.boolean(),
    type: v.optional(
      v.union(
        v.literal('recurring'),
        v.literal('recurring_rollover'),
        v.literal('maintain_balance'),
        v.literal('one_time')
      )
    ),
    amount: v.optional(v.int64()),
    frequency: v.optional(v.union(v.literal('daily'), v.literal('weekly'), v.literal('monthly'), v.literal('yearly'))),
    frequencyInterval: v.optional(v.number()),
    dayOfWeek: v.optional(v.number()),
    dueDay: v.optional(v.number()),
    firstDueDate: v.optional(v.string()),
    targetDate: v.optional(v.string()),
    monthlyContribution: v.optional(v.int64()),
    targetBalance: v.optional(v.int64()),
  }),
});

export type CategoryActivitySnapshot = Infer<typeof categorySnapshotValidator>;

export const merchantSnapshotValidator = v.object({
  id: v.id('merchant'),
  name: v.string(),
  logoUrl: v.optional(v.union(v.string(), v.null())),
  visualIdentityMode: v.optional(visualIdentityMode),
  iconName: v.optional(v.string()),
  iconColorId: v.optional(entityIconColorId),
  isDeleted: v.boolean(),
});

export type MerchantActivitySnapshot = Infer<typeof merchantSnapshotValidator>;

export const moneyLocationValidator = v.union(
  v.object({
    type: v.literal('ready_to_assign'),
  }),
  v.object({
    type: v.literal('category'),
    category: namedEntitySnapshotValidator,
  })
);

export type MoneyLocation = Infer<typeof moneyLocationValidator>;

export const moneyMovementSnapshotValidator = v.object({
  amount: v.int64(),
  from: moneyLocationValidator,
  to: moneyLocationValidator,
  fromAssignedAmount: v.optional(v.int64()),
  toAssignedAmount: v.optional(v.int64()),
});

export type MoneyMovementSnapshot = Infer<typeof moneyMovementSnapshotValidator>;

export const bankConnectionSnapshotValidator = v.object({
  id: v.string(),
  provider: v.union(v.literal('plaid'), v.literal('apple_wallet')),
  institutionName: v.string(),
  accountNames: v.array(v.string()),
});

export type BankConnectionActivitySnapshot = Infer<typeof bankConnectionSnapshotValidator>;

export const activityDetailsValidator = v.union(
  v.object({
    kind: v.literal('transaction'),
    before: v.optional(transactionSnapshotValidator),
    after: v.optional(transactionSnapshotValidator),
  }),
  v.object({
    kind: v.literal('bank_account'),
    before: v.optional(bankAccountSnapshotValidator),
    after: v.optional(bankAccountSnapshotValidator),
  }),
  v.object({
    kind: v.literal('category'),
    before: v.optional(categorySnapshotValidator),
    after: v.optional(categorySnapshotValidator),
  }),
  v.object({
    kind: v.literal('merchant'),
    before: v.optional(merchantSnapshotValidator),
    after: v.optional(merchantSnapshotValidator),
    mergeTarget: v.optional(merchantSnapshotValidator),
    movedTransactionCount: v.optional(v.number()),
    updatedRecurringTransactionCount: v.optional(v.number()),
  }),
  v.object({
    kind: v.literal('money_movement'),
    yearMonth: v.number(),
    movements: v.array(moneyMovementSnapshotValidator),
  }),
  v.object({
    kind: v.literal('bank_connection'),
    connection: bankConnectionSnapshotValidator,
  })
);

export type ActivityDetails = Infer<typeof activityDetailsValidator>;

export type ActivityContext = {
  actor: ActivityActor;
  source: ActivitySource;
};
