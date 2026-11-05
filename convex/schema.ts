import { authTables } from '@convex-dev/auth/server';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import {
  activityActorValidator,
  activityDetailsValidator,
  activityEntityTypeValidator,
  activityEventTypeValidator,
  activitySourceValidator,
} from './activityLogs/types';
import { storedAdAttribution } from './ads/types';
import { bankConnectionReauthorizationValidator } from './bankConnections/types';
import { entityIconColorId, visualIdentityMode } from './lib/entityIdentity';
import { checkInValidator } from './userProfiles/types';

// Account type enum
export const accountType = v.union(
  v.literal('banking_checking'),
  v.literal('banking_savings'),
  v.literal('banking_cash'),
  v.literal('banking_cash_management'),
  v.literal('banking_money_market'),
  v.literal('banking_cd'),
  v.literal('banking_other'),
  v.literal('credit_credit_card'),
  v.literal('credit_line_of_credit'),
  v.literal('credit_other'),
  v.literal('investment_brokerage'),
  v.literal('investment_401k'),
  v.literal('investment_ira'),
  v.literal('investment_keogh'),
  v.literal('investment_roth_ira'),
  v.literal('investment_roth_401k'),
  v.literal('investment_hsa'),
  v.literal('investment_sep_ira'),
  v.literal('investment_simple_ira'),
  v.literal('investment_529_plan'),
  v.literal('investment_403b'),
  v.literal('investment_other'),
  v.literal('loan_auto'),
  v.literal('loan_business'),
  v.literal('loan_commercial'),
  v.literal('loan_construction'),
  v.literal('loan_home_equity'),
  v.literal('loan_mortgage'),
  v.literal('loan_student'),
  v.literal('loan_other')
);

export default defineSchema({
  ...authTables,
  // Application tables
  activityLog: defineTable({
    workspaceId: v.id('workspace'),
    actor: activityActorValidator,
    source: activitySourceValidator,
    type: activityEventTypeValidator,
    entityType: activityEntityTypeValidator,
    entityId: v.string(),
    currencyCode: v.string(),
    details: activityDetailsValidator,
    occurredAt: v.string(),
  })
    .index('by_workspaceId_and_occurredAt', ['workspaceId', 'occurredAt'])
    .index('by_workspaceId_and_type_and_occurredAt', ['workspaceId', 'type', 'occurredAt']),

  bankAccount: defineTable({
    name: v.string(),
    notes: v.optional(v.string()),
    // logoUrl can be: undefined (use institution), string (custom override), or null (explicitly no logo)
    logoUrl: v.optional(v.union(v.string(), v.null())),
    visualIdentityMode: v.optional(visualIdentityMode),
    iconName: v.optional(v.string()),
    iconColorId: v.optional(entityIconColorId),
    workspaceId: v.id('workspace'),
    bankLinkAccountId: v.optional(v.id('bankLinkAccount')),
    plaidInitialSync: v.optional(
      v.object({
        bankLinkAccountId: v.id('bankLinkAccount'),
        startDate: v.string(),
        status: v.union(v.literal('pending'), v.literal('complete')),
        preserveBalance: v.boolean(),
        generation: v.string(),
      })
    ),
    financeKitAccountId: v.optional(v.id('financeKitAccount')),
    accountType: accountType,
    currentBalance: v.int64(),
    // Pending and cleared balance tracking
    // currentBalance = pendingBalance + clearedBalance
    // pending transactions → pendingBalance
    // cleared/reconciled transactions → clearedBalance
    pendingBalance: v.optional(v.int64()),
    clearedBalance: v.optional(v.int64()),
    // Monthly balance snapshots for net worth reporting
    // Map of yearMonth (string, e.g., "202512") -> end-of-month balance in cents
    monthlyBalances: v.optional(v.record(v.string(), v.int64())),
    isClosed: v.boolean(),
    closedAt: v.optional(v.string()),
    lastReconciledAt: v.optional(v.string()),
    updatedAt: v.optional(v.string()),
    deletedAt: v.optional(v.string()),
    isDeleted: v.boolean(),
  })
    .index('by_workspaceId', ['workspaceId'])
    .index('by_bankLinkAccountId', ['bankLinkAccountId'])
    .index('by_financeKitAccountId', ['financeKitAccountId'])
    .index('by_workspaceId_isClosed', ['workspaceId', 'isClosed']),

  bankAccountFavorite: defineTable({
    workspaceId: v.id('workspace'),
    userProfileId: v.id('userProfile'),
    bankAccountId: v.id('bankAccount'),
    updatedAt: v.string(),
    deletedAt: v.optional(v.string()),
    isDeleted: v.boolean(),
  })
    .index('by_workspaceId', ['workspaceId'])
    .index('by_userProfileId_and_bankAccountId', ['userProfileId', 'bankAccountId'])
    .index('by_userProfileId_and_workspaceId_and_isDeleted', ['userProfileId', 'workspaceId', 'isDeleted']),

  bankLink: defineTable({
    accessToken: v.string(),
    globalInstitutionId: v.id('globalInstitution'),
    itemId: v.string(),
    itemStatus: v.union(v.literal('Healthy'), v.literal('Error'), v.literal('Pending'), v.literal('Disconnected')),
    reauthorization: v.optional(bankConnectionReauthorizationValidator),
    lastSyncedAt: v.optional(v.string()),
    nextCursor: v.optional(v.string()),
    ownerId: v.string(),
    provider: v.optional(v.literal('plaid')),
    updatedAt: v.optional(v.string()),
    deletedAt: v.optional(v.string()),
    isDeleted: v.optional(v.boolean()),
    providerDisconnectedAt: v.optional(v.string()),
    hasCompletedFirstSync: v.optional(v.boolean()),
    createdAt: v.optional(v.string()),
    initialBalanceDate: v.optional(v.string()), // Date when accounts were linked (YYYY-MM-DD)
    webhookMigrationStatus: v.optional(
      v.union(
        v.literal('not_needed'), // New bank link, created natively in Convex
        v.literal('pending'), // Migrated from Supabase, awaiting webhook update
        v.literal('completed'), // Webhook successfully updated to Convex
        v.literal('failed') // Webhook update failed
      )
    ),
  })
    .index('by_ownerId', ['ownerId'])
    .index('by_itemId', ['itemId']),

  bankLinkAccount: defineTable({
    accountNumberMask: v.optional(v.string()),
    accountType: accountType,
    availableBalance: v.optional(v.number()),
    bankLinkId: v.id('bankLink'),
    // Legacy field - kept for backward compatibility
    currentBalance: v.optional(v.number()),
    initialBalance: v.optional(v.number()), // Initial balance captured during linking, never changes
    lastUpdated: v.optional(v.string()),
    name: v.string(),
    officialName: v.optional(v.string()),
    plaidAccountId: v.string(),
    updatedAt: v.string(),
    deletedAt: v.optional(v.string()),
    isDeleted: v.optional(v.boolean()),
  })
    .index('by_bankLinkId', ['bankLinkId'])
    .index('by_plaidAccountId', ['plaidAccountId']),

  // Plaid webhook and sync audit log
  // Stores every webhook received and the full sync response from Plaid
  plaidWebhookLog: defineTable({
    // Webhook metadata
    itemId: v.string(), // Plaid item_id
    webhookType: v.string(), // TRANSACTIONS, ITEM, etc.
    webhookCode: v.string(), // SYNC_UPDATES_AVAILABLE, DEFAULT_UPDATE, ERROR, etc.
    rawPayload: v.string(), // Full webhook payload as JSON string

    // Sync response (populated after calling Plaid transactionsSync)
    syncResponse: v.optional(
      v.object({
        // Full transaction objects from Plaid (stored as JSON strings for flexibility)
        addedTransactions: v.array(v.string()), // Each element is a JSON-stringified Plaid Transaction
        modifiedTransactions: v.array(v.string()), // Each element is a JSON-stringified Plaid Transaction
        removedTransactionIds: v.array(v.string()), // Plaid transaction_ids that were removed

        // Cursor information
        initialCursor: v.optional(v.string()), // Cursor at start of sync
        finalCursor: v.optional(v.string()), // Cursor after sync complete

        // Summary counts
        addedCount: v.number(),
        modifiedCount: v.number(),
        removedCount: v.number(),
      })
    ),

    // Processing status
    status: v.union(
      v.literal('received'), // Webhook received, not yet processed
      v.literal('syncing'), // Currently calling Plaid API
      v.literal('completed'), // Sync completed successfully
      v.literal('skipped'), // Skipped (e.g., ITEM webhook that just updates status)
      v.literal('error') // Error during processing
    ),
    errorMessage: v.optional(v.string()),

    // Bank link reference (populated after lookup)
    bankLinkId: v.optional(v.id('bankLink')),

    // Timestamps
    receivedAt: v.string(), // When webhook was received
    syncStartedAt: v.optional(v.string()), // When Plaid API call started
    syncCompletedAt: v.optional(v.string()), // When sync finished
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index('by_itemId', ['itemId'])
    .index('by_bankLinkId', ['bankLinkId'])
    .index('by_status', ['status'])
    .index('by_itemId_receivedAt', ['itemId', 'receivedAt']),

  category: defineTable({
    name: v.string(),
    workspaceId: v.optional(v.id('workspace')),
    isSystemCategory: v.optional(v.boolean()),
    categoryGroupId: v.id('categoryGroup'),
    sortOrder: v.number(),
    iconName: v.optional(v.string()),
    updatedAt: v.optional(v.string()),
    deletedAt: v.optional(v.string()),
    isDeleted: v.boolean(),
    isArchived: v.optional(v.boolean()),
    // Category type for special handling (optional for backward compatibility)
    categoryType: v.optional(
      v.union(
        v.literal('custom'),
        v.literal('owner_investment'),
        v.literal('revenue'),
        v.literal('credit_card_payment'),
        v.literal('credit_card')
      )
    ),
    // Link credit card categories to their bank accounts
    bankAccountId: v.optional(v.id('bankAccount')),

    // Enable target tracking
    enableTarget: v.optional(v.boolean()),

    // Category spending tracking (moved from categorySpending table)
    // Map of yearMonth (string) -> { inflowAmount, outflowAmount }
    // Keys are yearMonth strings (e.g., "202511" for November 2025)
    monthlySpending: v.optional(
      v.record(
        v.string(),
        v.object({
          inflowAmount: v.int64(), // All positive transactions (money added to category)
          outflowAmount: v.int64(), // All positive transactions (money spent from category, stored as positive)
        })
      )
    ),
    transactionCount: v.optional(v.int64()), // Total count of transactions with this category

    // Credit card spending tracking (moved from creditCategorySpending table)
    // Map of yearMonth (string) -> { priorBalance, spendingAmount, paymentsAmount, refundedSpending }
    // Keys are yearMonth strings (e.g., "202511" for November 2025)
    // Only used for credit card categories (categoryType === 'credit_card')
    creditMonthlySpending: v.optional(
      v.record(
        v.string(),
        v.object({
          priorBalance: v.int64(), // Starting balance (only non-zero in account creation month)
          spendingAmount: v.int64(), // New charges (negative values) in cents
          paymentsAmount: v.int64(), // Payments made (positive values) in cents
          refundedSpending: v.int64(), // Refunds (positive values) in cents
        })
      )
    ),

    // Target fields (moved from categoryTarget table for performance and simplicity)
    target_type: v.optional(
      v.union(
        v.literal('recurring'),
        v.literal('recurring_rollover'),
        v.literal('maintain_balance'),
        v.literal('one_time')
      )
    ),
    target_amount: v.optional(v.int64()), // In cents - for recurring: amount per occurrence, for maintain_balance: target balance
    target_frequency: v.optional(
      v.union(v.literal('daily'), v.literal('weekly'), v.literal('monthly'), v.literal('yearly'))
    ),
    target_frequencyInterval: v.optional(v.number()), // e.g., 2 for "every 2 weeks", 3 for "every 3 months"
    target_dayOfWeek: v.optional(v.number()), // 0-6 (Sunday-Saturday), required if frequency='weekly'
    target_dueDay: v.optional(v.number()), // 1-31, null for end of month (informational only)
    target_firstDueDate: v.optional(v.string()), // ISO date (YYYY-MM-DD) - when the first occurrence is due
    target_targetDate: v.optional(v.string()), // ISO date, for maintain_balance - informational goal date
    target_monthlyContribution: v.optional(v.int64()), // In cents, for maintain_balance
    target_targetBalance: v.optional(v.int64()), // In cents, for maintain_balance - same as amount but more semantic
  })
    .index('by_workspaceId', ['workspaceId'])
    .index('by_workspaceId_categoryGroupId', ['workspaceId', 'categoryGroupId'])
    .index('by_categoryGroupId_sortOrder', ['categoryGroupId', 'sortOrder'])
    .index('by_isSystemCategory', ['isSystemCategory'])
    .index('by_bankAccountId', ['bankAccountId'])
    .index('by_bankAccountId_isDeleted_deletedAt', ['bankAccountId', 'isDeleted', 'deletedAt']),

  categoryFavorite: defineTable({
    workspaceId: v.id('workspace'),
    userProfileId: v.id('userProfile'),
    categoryId: v.id('category'),
    updatedAt: v.string(),
    deletedAt: v.optional(v.string()),
    isDeleted: v.boolean(),
  })
    .index('by_workspaceId', ['workspaceId'])
    .index('by_userProfileId_and_categoryId', ['userProfileId', 'categoryId'])
    .index('by_userProfileId_and_workspaceId_and_isDeleted', ['userProfileId', 'workspaceId', 'isDeleted']),

  categoryBudget: defineTable({
    categoryId: v.id('category'),
    workspaceId: v.id('workspace'),
    monthlyAssignedAmounts: v.record(v.string(), v.int64()), // { "202511": 10000n, "202512": 5000n }
    snoozedTargetMonths: v.optional(v.record(v.string(), v.boolean())), // { "202602": true } - months where target is snoozed
    updatedAt: v.string(),
  })
    .index('by_workspaceId', ['workspaceId'])
    .index('by_categoryId', ['categoryId'])
    .index('by_workspaceId_categoryId', ['workspaceId', 'categoryId']),

  categoryGroup: defineTable({
    name: v.string(),
    type: v.union(v.literal('expense'), v.literal('credit_card')),
    workspaceId: v.id('workspace'),
    isSystemGroup: v.optional(v.boolean()),
    sortOrder: v.number(),
    updatedAt: v.optional(v.string()),
    deletedAt: v.optional(v.string()),
    isDeleted: v.boolean(),
  })
    .index('by_workspaceId', ['workspaceId'])
    .index('by_workspaceId_type', ['workspaceId', 'type'])
    .index('by_workspaceId_sortOrder', ['workspaceId', 'sortOrder'])
    .index('by_isSystemGroup', ['isSystemGroup']),

  globalInstitution: defineTable({
    providerInstitutionId: v.string(),
    provider: v.literal('Plaid'),
    name: v.string(),
    logoUrl: v.optional(v.string()),
    primaryColor: v.optional(v.string()),
    isVerified: v.boolean(),
    updatedAt: v.string(),
  })
    .index('by_providerInstitutionId', ['providerInstitutionId'])
    .index('by_provider_providerInstitutionId', ['provider', 'providerInstitutionId']),

  globalMerchant: defineTable({
    name: v.string(),
    logoUrl: v.optional(v.string()),
    isVerified: v.boolean(),
    updatedAt: v.string(),
  }).index('by_name', ['name']),

  merchant: defineTable({
    // Global reference
    globalMerchantId: v.optional(v.id('globalMerchant')),

    // Merchant properties (overrides or values for manually created merchants)
    name: v.optional(v.string()),
    // logoUrl can be: undefined (use global), string (custom override), or null (explicitly no logo)
    logoUrl: v.optional(v.union(v.string(), v.null())),
    visualIdentityMode: v.optional(visualIdentityMode),
    iconName: v.optional(v.string()),
    iconColorId: v.optional(entityIconColorId),

    // Monthly transaction statistics (updated incrementally)
    // Map of yearMonth (string, e.g., "202512") -> { totalAmount, transactionCount }
    monthlyStats: v.optional(
      v.record(
        v.string(),
        v.object({
          totalAmount: v.int64(), // Total spending amount in cents
          transactionCount: v.int64(), // Number of transactions
        })
      )
    ),
    // Gross directional merchant activity used by inflow/outflow reports.
    // Optional during the online backfill from the legacy net-only monthlyStats field.
    monthlyDirectionalStats: v.optional(
      v.record(
        v.string(),
        v.object({
          inflowAmount: v.int64(),
          outflowAmount: v.int64(),
          inflowCount: v.int64(),
          outflowCount: v.int64(),
        })
      )
    ),

    // Suggestion fields - computed from transaction history
    // Array of up to 3 category IDs, most recent first
    suggestedCategoryIds: v.optional(v.array(v.id('category'))),
    // Single most recently used account
    suggestedBankAccountId: v.optional(v.id('bankAccount')),

    // Metadata
    workspaceId: v.id('workspace'),
    updatedAt: v.string(),
    deletedAt: v.optional(v.string()),
    isDeleted: v.boolean(),
  })
    .index('by_workspaceId', ['workspaceId'])
    .index('by_workspaceId_globalMerchantId', ['workspaceId', 'globalMerchantId'])
    .index('by_workspaceId_name', ['workspaceId', 'name']),

  // Future-dated transactions waiting to be entered into the register. Rows here do NOT
  // affect balances/budgets; on the due date (or via "enter now") they are materialized
  // into the `transaction` table and, if recurring, advanced to the next occurrence.
  scheduledTransaction: defineTable({
    workspaceId: v.id('workspace'),
    // New rows set transactionType. Optional keeps old local rows queryable during the
    // transition; missing means `regular`.
    transactionType: v.optional(v.union(v.literal('regular'), v.literal('transfer'))),
    // Regular: account the transaction enters. Transfer: source/from account.
    bankAccountId: v.id('bankAccount'),
    // Transfer destination account. Only set when transactionType is `transfer`.
    transferToAccountId: v.optional(v.id('bankAccount')),
    merchantId: v.optional(v.id('merchant')),
    notes: v.optional(v.string()),
    // Status the entered transaction will receive (scheduled entries default to pending,
    // matching the YNAB convention that not-yet-posted transactions enter uncleared)
    entryStatus: v.union(v.literal('pending'), v.literal('cleared')),
    // How occurrences reach the register. Missing means `auto`.
    // - auto: the cron enters the transaction on its due date
    // - manual: nothing is entered automatically; the occurrence shows as due/overdue
    //   until the user enters or skips it (avoids wrong-date auto-entries for bills that
    //   post a couple of days late, and is the mode migrated recurring templates get)
    entryMode: v.optional(v.union(v.literal('auto'), v.literal('manual'))),
    // Raw movement inputs; computed fields (searchText, category names, ...) are built at entry time
    movements: v.array(
      v.object({
        amount: v.int64(),
        categoryId: v.optional(v.id('category')),
        readyToAssign: v.optional(v.boolean()),
        notes: v.optional(v.string()),
      })
    ),
    recurrence: v.union(
      v.literal('once'),
      v.literal('daily'),
      v.literal('weekly'),
      v.literal('every_other_week'),
      v.literal('every_three_weeks'),
      v.literal('every_four_weeks'),
      v.literal('twice_a_month'),
      v.literal('monthly'),
      v.literal('every_other_month'),
      v.literal('quarterly'),
      v.literal('every_four_months'),
      v.literal('twice_a_year'),
      v.literal('yearly'),
      v.literal('every_other_year')
    ),
    // First occurrence as the user set it; keeps monthly/yearly occurrences pinned to the
    // original day (e.g. anchor Jan 31 -> Feb 28 -> Mar 31) and pairs twice_a_month days
    anchorDate: v.string(),
    // Next due date (YYYY-MM-DD, workspace-timezone calendar date)
    nextDate: v.string(),
    // Additive occurrence tracking: the forward cursor is independent of reopened bills.
    nextUnprocessedDate: v.optional(v.string()),
    // Switching auto-entry on does not manufacture the outstanding manual backlog.
    automaticEntryStartDate: v.optional(v.string()),
    scheduleRevision: v.optional(v.number()),
    // Epoch ms when the cron should auto-enter nextDate (7am in the workspace timezone).
    // Only set while an auto-mode schedule is active; unset for manual mode, paused, and
    // completed so those rows fall out of the by_nextRunAt range scan.
    nextRunAt: v.optional(v.number()),
    status: v.union(v.literal('active'), v.literal('paused'), v.literal('completed')),
    executionCount: v.number(),
    lastEnteredAt: v.optional(v.string()),
    lastEnteredTransactionId: v.optional(v.id('transaction')),
    // Due-date push reminders
    reminderEnabled: v.optional(v.boolean()),
    reminderOffset: v.optional(
      v.union(
        v.literal('on_due_date'),
        v.literal('1_day_before'),
        v.literal('2_days_before'),
        v.literal('1_week_before'),
        v.literal('1_month_before')
      )
    ),
    // Epoch ms of the next reminder (9am workspace-local); unset when reminders are off
    // or the schedule is not active
    nextReminderAt: v.optional(v.number()),
    createdBy: v.optional(v.id('userProfile')),
    updatedAt: v.string(),
    deletedAt: v.optional(v.string()),
    isDeleted: v.boolean(),
  })
    .index('by_workspaceId_isDeleted', ['workspaceId', 'isDeleted'])
    .index('by_workspaceId_merchantId_isDeleted', ['workspaceId', 'merchantId', 'isDeleted'])
    .index('by_nextRunAt', ['nextRunAt'])
    .index('by_nextReminderAt', ['nextReminderAt']),

  // Explicit skip history survives advancing or completing its parent schedule.
  scheduledTransactionOccurrence: defineTable({
    workspaceId: v.id('workspace'),
    scheduledTransactionId: v.id('scheduledTransaction'),
    scheduleRevision: v.number(),
    occurrenceDate: v.string(),
    status: v.union(v.literal('pending'), v.literal('paid'), v.literal('skipped')),
    transactionId: v.optional(v.id('transaction')),
    expectedAmount: v.int64(),
    isTransfer: v.boolean(),
    // A deliberate deletion/unlink must not be undone by the automatic entry cron.
    manualOnly: v.optional(v.boolean()),
    updatedAt: v.string(),
  })
    .index('by_schedule_revision_date', ['scheduledTransactionId', 'scheduleRevision', 'occurrenceDate'])
    .index('by_schedule_revision_status_date', [
      'scheduledTransactionId',
      'scheduleRevision',
      'status',
      'occurrenceDate',
    ])
    .index('by_workspaceId', ['workspaceId']),

  scheduledTransactionSkip: defineTable({
    workspaceId: v.id('workspace'),
    scheduledTransactionId: v.id('scheduledTransaction'),
    scheduleRevision: v.optional(v.number()),
    occurrenceDate: v.string(),
    expectedAmount: v.int64(),
    isTransfer: v.boolean(),
    updatedAt: v.string(),
    isDeleted: v.boolean(),
  }).index('by_workspaceId_and_occurrenceDate', ['workspaceId', 'occurrenceDate']),

  orgMerchantCategoryMapping: defineTable({
    merchantName: v.string(),
    categoryId: v.optional(v.id('category')), // Optional to support abstained/failed categorizations
    workspaceId: v.id('workspace'),
    source: v.union(v.literal('llm'), v.literal('typesafe'), v.literal('manual')),
    model: v.optional(v.string()),
    modelConfidence: v.optional(v.number()),
    usedFallback: v.optional(v.boolean()),
    // For TypeSafe mappings, confidence is the selected category's absolute probability.
    confidence: v.optional(v.number()),
    timesApplied: v.number(),
    timesOverridden: v.number(),
    updatedAt: v.string(),
    categorizationFailed: v.optional(v.boolean()),
    failureReason: v.optional(v.string()),
    amountDirection: v.optional(v.union(v.literal('positive'), v.literal('negative'))),
  })
    .index('by_workspaceId', ['workspaceId'])
    .index('by_workspaceId_merchantName', ['workspaceId', 'merchantName'])
    .index('by_workspaceId_merchantName_amountDirection', ['workspaceId', 'merchantName', 'amountDirection'])
    .searchIndex('search_merchantName_by_workspace', {
      searchField: 'merchantName',
      filterFields: ['workspaceId'],
    }),

  transaction: defineTable({
    bankAccountId: v.id('bankAccount'),
    date: v.string(),
    deletedAt: v.optional(v.string()),
    importDetails: v.optional(
      v.object({
        provider: v.union(v.literal('plaid'), v.literal('financekit')),
        originalStatement: v.optional(v.string()),
        merchantName: v.optional(v.string()),
        date: v.string(),
        postedDate: v.optional(v.string()),
        amount: v.int64(),
        authorizedDate: v.optional(v.string()),
      })
    ),
    isDeleted: v.boolean(),
    merchantId: v.optional(v.id('merchant')),
    notes: v.optional(v.string()),
    status: v.union(v.literal('pending'), v.literal('cleared'), v.literal('reconciled')),
    // Deprecated - use importDetails.merchantName instead
    plaidMerchantName: v.optional(v.string()),
    reviewStatus: v.union(v.literal('reviewed'), v.literal('needs_review')),
    scheduledTransactionId: v.optional(v.id('scheduledTransaction')),
    scheduledOccurrenceDate: v.optional(v.string()),
    scheduledOccurrenceRevision: v.optional(v.number()),
    // Provenance survives unlinking an entry from its planned occurrence.
    originScheduledTransactionId: v.optional(v.id('scheduledTransaction')),
    // Short-lived, server-captured rollback state for an explicit "Record now" action.
    scheduledEntryUndo: v.optional(
      v.object({
        nextDate: v.string(),
        executionCount: v.number(),
        lastEnteredAt: v.optional(v.string()),
        lastEnteredTransactionId: v.optional(v.id('transaction')),
        scheduleUpdatedAt: v.string(),
        transactionUpdatedAt: v.optional(v.string()),
        pairUpdatedAt: v.optional(v.string()),
        expiresAt: v.number(),
      })
    ),
    source: v.optional(
      v.union(v.literal('manual'), v.literal('automatic_import'), v.literal('chat_import'), v.literal('scheduled'))
    ),
    // Deterministic dedup key for chat-imported rows. Computed from
    // (date, signed amount, standardized merchant). Used by the chat-import
    // pipeline to skip rows the user has already imported via the same flow.
    // See `buildImportFingerprint` in convex/lib/transactionFingerprint.ts.
    importFingerprint: v.optional(v.string()),
    transactionImportRawId: v.optional(v.id('transactionImportRaw')),
    financeKitTransactionImportId: v.optional(v.id('financeKitTransactionImport')),
    type: v.union(
      v.literal('regular'),
      v.literal('starting_balance'),
      v.literal('balance_adjustment'),
      v.literal('transfer')
    ),
    // Link to paired transaction for transfers
    transferPairId: v.optional(v.id('transaction')),
    // Bank account ID of the paired transaction (denormalized for UI queries)
    transferPairBankAccountId: v.optional(v.id('bankAccount')),
    updatedAt: v.optional(v.string()),
    workspaceId: v.id('workspace'),
    // Year and month derived from transaction date (YYYYMM format, e.g., 202512 for December 2025)
    // Used for efficient month-based queries with category filtering
    dateYearMonth: v.number(),
    // Track money movement to credit card categories
    creditCardTransfer: v.optional(
      v.object({
        creditCardCategoryId: v.id('category'),
        spendingCategoryId: v.id('category'),
      })
    ),

    // EMBEDDED MOVEMENTS (replaces transactionMovement table)
    movements: v.array(
      v.object({
        categoryId: v.optional(v.id('category')),
        categoryName: v.optional(v.string()), // Denormalized for search
        readyToAssign: v.boolean(),
        amount: v.int64(), // Movement amount in cents (signed)
        notes: v.optional(v.string()),
        sortOrder: v.number(),
        creditCardTransfer: v.optional(
          v.object({
            creditCardCategoryId: v.id('category'),
            spendingCategoryId: v.id('category'),
          })
        ),
      })
    ),

    // DENORMALIZED SEARCH FIELD
    // Concatenates: merchantName + all categoryNames + amount (in cents)
    // Example: "starbucks groceries coffee 4599"
    searchText: v.string(),

    // COMPUTED FIELDS
    totalAmount: v.int64(), // Sum of movement amounts

    // Original amount when user approved, set when Plaid updates amount on reviewed transaction
    // Used to show strikethrough UI (original → new amount) when transaction flips back to needs_review
    originalApprovedAmount: v.optional(v.int64()),

    // True if any movement has no categoryId and is not readyToAssign (and not a transfer)
    hasUncategorized: v.boolean(),

    // True if this is a regular transaction without a merchant (payee)
    hasMissingPayee: v.boolean(),

    // TRANSACTION LINKING FIELDS (NEW APPROACH)
    // When an import matches a manual transaction, we UPDATE the manual transaction with these fields
    // instead of creating a duplicate imported transaction
    linkedRawTransactionId: v.optional(v.id('transactionImportRaw')), // Points to the raw import data
    linkedAt: v.optional(v.number()), // Timestamp when link was established
    linkConfidence: v.optional(v.number()), // 0-100 confidence score
    linkReason: v.optional(v.string()), // Human-readable match reason
    rejectedLinkIds: v.optional(v.array(v.id('transactionImportRaw'))), // Raw imports user rejected as matches (on manual txn)

    // LEGACY LINKING FIELDS (deprecated - kept for backwards compatibility)
    // Used to detect when imported transactions match manually-entered ones
    suggestedLinkId: v.optional(v.id('transaction')), // ID of manual transaction this might match
    suggestedLinkConfidence: v.optional(v.number()), // Confidence score 0-100
    suggestedLinkReason: v.optional(v.string()), // Human-readable reason for match
    linkedFromTransactionId: v.optional(v.id('transaction')), // Set on manual txn when deleted via link approval
    legacyRejectedLinkIds: v.optional(v.array(v.id('transaction'))), // Legacy: manual txns rejected as matches (on imported txn)

    // TRANSFER DETECTION FIELDS
    // When system detects a transaction is likely a transfer between accounts
    suggestedTransfer: v.optional(
      v.object({
        transferConfidence: v.number(), // 0-100: How confident we are this is a transfer
        accountConfidence: v.optional(v.number()), // 0-100: How confident we are about the destination account
        suggestedCounterpartAccountId: v.optional(v.id('bankAccount')), // Suggested destination account
        matchedTransactionId: v.optional(v.id('transaction')), // If counterpart already imported and linked
        detectionReason: v.string(), // Human-readable reason for detection
        status: v.union(
          v.literal('pending'), // Single side, awaiting user decision
          v.literal('linked_pending_approval'), // Both sides linked, awaiting approval
          v.literal('approved'), // User approved
          v.literal('approved_no_destination'), // Approved but destination unknown
          v.literal('rejected'), // User said not a transfer
          v.literal('cascade_approved') // Auto-approved when paired side was approved
        ),
      })
    ),
  })
    .index('by_workspaceId', ['workspaceId'])
    .index('by_bankAccountId', ['bankAccountId'])
    .index('by_workspaceId_merchantId', ['workspaceId', 'merchantId'])
    .index('by_workspaceId_bankAccountId_isDeleted', ['workspaceId', 'bankAccountId', 'isDeleted'])
    .index('by_workspaceId_bankAccountId_isDeleted_date', ['workspaceId', 'bankAccountId', 'isDeleted', 'date'])
    .index('by_workspaceId_bankAccountId_date_isDeleted', ['workspaceId', 'bankAccountId', 'date', 'isDeleted'])
    .index('by_workspaceId_date_isDeleted', ['workspaceId', 'date', 'isDeleted'])
    .index('by_workspaceId_isDeleted_date', ['workspaceId', 'isDeleted', 'date'])
    .index('by_workspaceId_status_isDeleted', ['workspaceId', 'status', 'isDeleted'])
    .index('by_workspaceId_status_isDeleted_date', ['workspaceId', 'status', 'isDeleted', 'date'])
    .index('by_workspaceId_hasUncategorized_isDeleted', ['workspaceId', 'hasUncategorized', 'isDeleted'])
    .index('by_workspaceId_hasMissingPayee_isDeleted', ['workspaceId', 'hasMissingPayee', 'isDeleted'])
    .index('by_workspaceId_reviewStatus_isDeleted', ['workspaceId', 'reviewStatus', 'isDeleted'])
    .index('by_transactionImportRawId', ['transactionImportRawId'])
    .index('by_financeKitTransactionImportId', ['financeKitTransactionImportId'])
    .index('by_workspaceId_dateYearMonth_isDeleted', ['workspaceId', 'dateYearMonth', 'isDeleted'])
    .index('by_workspaceId_linkedRawTransactionId', ['workspaceId', 'linkedRawTransactionId'])
    .index('by_scheduledTransactionId', ['scheduledTransactionId'])
    .index('by_schedule_occurrence', ['scheduledTransactionId', 'scheduledOccurrenceDate'])
    .index('by_workspaceId_type_isDeleted', ['workspaceId', 'type', 'isDeleted'])
    .index('by_workspaceId_bankAccountId_importFingerprint', ['workspaceId', 'bankAccountId', 'importFingerprint'])
    // Full-text search index for server-side filtering
    .searchIndex('search_transactions', {
      searchField: 'searchText',
      filterFields: ['workspaceId', 'isDeleted', 'hasUncategorized', 'hasMissingPayee', 'status', 'reviewStatus'],
    }),

  transactionImportRaw: defineTable({
    amount: v.int64(),
    authorizedDate: v.optional(v.string()),
    // Deprecated Plaid reconciliation fields retained for the round-one
    // cleanup migration. Remove these validators only after that migration
    // completes in every deployment.
    authorizedDatetime: v.optional(v.string()),
    date: v.string(),
    errorMessage: v.optional(v.string()),
    importStatus: v.union(
      v.literal('awaiting_insert_job'),
      v.literal('processing'),
      v.literal('inserted'),
      v.literal('error'),
      v.literal('blocked_before_first_day')
    ),
    logoUrl: v.optional(v.string()),
    merchantEntityId: v.optional(v.string()),
    merchantName: v.optional(v.string()),
    originalDescription: v.optional(v.string()),
    originalStatement: v.optional(v.string()),
    pending: v.boolean(),
    pendingReconciliationFingerprint: v.optional(v.string()),
    pendingTransactionId: v.optional(v.string()),
    plaidAccountId: v.string(),
    plaidCategory: v.array(v.string()),
    plaidTransactionId: v.string(),
    postedDate: v.optional(v.string()),
    processedAt: v.optional(v.string()),
    isoCurrencyCode: v.optional(v.string()),
    unofficialCurrencyCode: v.optional(v.string()),
    paymentChannel: v.optional(v.string()),
    paymentReferenceNumber: v.optional(v.string()),
    storeNumber: v.optional(v.string()),
    reconciliationMethod: v.optional(
      v.union(v.literal('plaid_pending_transaction_id'), v.literal('strict_fingerprint'))
    ),
    reconciledAt: v.optional(v.string()),
    updatedAt: v.string(),
    website: v.optional(v.string()),
    workspaceId: v.id('workspace'),
    // Transfer detection fields from Plaid
    plaidTransactionCode: v.optional(v.string()), // "transfer", "credit", "debit", etc.
    plaidPersonalFinanceCategory: v.optional(
      v.object({
        primary: v.string(), // e.g., "TRANSFER_IN", "CREDIT_CARD_PAYMENT"
        detailed: v.string(), // e.g., "TRANSFER_IN_ACCOUNT_TRANSFER"
        confidence: v.optional(v.string()), // "VERY_HIGH", "HIGH", etc.
      })
    ),
  })
    .index('by_workspaceId', ['workspaceId'])
    .index('by_plaidTransactionId', ['plaidTransactionId'])
    .index('by_workspaceId_importStatus', ['workspaceId', 'importStatus'])
    .index('by_workspaceId_plaidTransactionId', ['workspaceId', 'plaidTransactionId']),

  financeKitConnection: defineTable({
    workspaceId: v.id('workspace'),
    ownerClerkId: v.string(),
    deviceId: v.string(),
    status: v.union(v.literal('active'), v.literal('disconnected')),
    syncStartDate: v.string(),
    lastSyncedAt: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
    deletedAt: v.optional(v.string()),
    isDeleted: v.boolean(),
  })
    .index('by_workspaceId', ['workspaceId'])
    .index('by_ownerClerkId_and_isDeleted', ['ownerClerkId', 'isDeleted'])
    .index('by_workspaceId_isDeleted', ['workspaceId', 'isDeleted'])
    .index('by_workspaceId_deviceId_isDeleted', ['workspaceId', 'deviceId', 'isDeleted'])
    .index('by_workspaceId_ownerClerkId_isDeleted', ['workspaceId', 'ownerClerkId', 'isDeleted'])
    .index('by_workspaceId_ownerClerkId_deviceId_isDeleted', ['workspaceId', 'ownerClerkId', 'deviceId', 'isDeleted']),

  financeKitSyncToken: defineTable({
    workspaceId: v.id('workspace'),
    ownerClerkId: v.string(),
    deviceId: v.string(),
    token: v.string(),
    createdAt: v.string(),
    refreshedAt: v.string(),
    lastUsedAt: v.optional(v.string()),
    revokedAt: v.optional(v.string()),
    isRevoked: v.boolean(),
  })
    .index('by_token', ['token'])
    .index('by_ownerClerkId', ['ownerClerkId'])
    .index('by_workspaceId_ownerClerkId_deviceId_isRevoked', ['workspaceId', 'ownerClerkId', 'deviceId', 'isRevoked']),

  financeKitAccount: defineTable({
    workspaceId: v.id('workspace'),
    connectionId: v.id('financeKitConnection'),
    syncStartDate: v.optional(v.string()),
    externalAccountId: v.string(),
    accountKind: v.union(v.literal('asset'), v.literal('liability')),
    rawAccountType: v.optional(v.string()),
    accountType: accountType,
    displayName: v.string(),
    institutionName: v.optional(v.string()),
    accountDescription: v.optional(v.string()),
    openingDate: v.optional(v.string()),
    currencyCode: v.string(),
    latestAvailableBalance: v.optional(v.int64()),
    latestBookedBalance: v.optional(v.int64()),
    latestCurrentBalance: v.optional(v.int64()),
    latestBalanceAsOfDate: v.optional(v.string()),
    accountHistoryToken: v.optional(v.string()),
    balanceHistoryToken: v.optional(v.string()),
    transactionHistoryToken: v.optional(v.string()),
    hasCompletedInitialSync: v.boolean(),
    bankAccountId: v.optional(v.id('bankAccount')),
    createdAt: v.string(),
    updatedAt: v.string(),
    deletedAt: v.optional(v.string()),
    isDeleted: v.boolean(),
  })
    .index('by_workspaceId', ['workspaceId'])
    .index('by_workspaceId_isDeleted', ['workspaceId', 'isDeleted'])
    .index('by_connectionId', ['connectionId'])
    .index('by_connectionId_isDeleted', ['connectionId', 'isDeleted'])
    .index('by_workspaceId_externalAccountId', ['workspaceId', 'externalAccountId'])
    .index('by_workspaceId_externalAccountId_isDeleted', ['workspaceId', 'externalAccountId', 'isDeleted'])
    .index('by_workspaceId_bankAccountId', ['workspaceId', 'bankAccountId']),

  financeKitTransactionImport: defineTable({
    workspaceId: v.id('workspace'),
    connectionId: v.id('financeKitConnection'),
    financeKitAccountId: v.id('financeKitAccount'),
    bankAccountId: v.optional(v.id('bankAccount')),
    externalAccountId: v.string(),
    externalTransactionId: v.string(),
    amount: v.int64(),
    currencyCode: v.string(),
    date: v.string(),
    postedDate: v.optional(v.string()),
    originalStatement: v.optional(v.string()),
    merchantName: v.optional(v.string()),
    transactionDescription: v.optional(v.string()),
    rawStatus: v.string(),
    rawTransactionType: v.optional(v.string()),
    rawCreditDebitIndicator: v.union(v.literal('credit'), v.literal('debit')),
    merchantCategoryCode: v.optional(v.string()),
    foreignCurrencyAmount: v.optional(v.int64()),
    foreignCurrencyCode: v.optional(v.string()),
    foreignCurrencyExchangeRate: v.optional(v.string()),
    transactionId: v.optional(v.id('transaction')),
    importStatus: v.union(
      v.literal('inserted'),
      v.literal('updated'),
      v.literal('deleted'),
      v.literal('ignored_before_sync_start'),
      v.literal('ignored_rejected'),
      v.literal('error')
    ),
    errorMessage: v.optional(v.string()),
    processedAt: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
    deletedAt: v.optional(v.string()),
    isDeleted: v.boolean(),
  })
    .index('by_workspaceId', ['workspaceId'])
    .index('by_financeKitAccountId', ['financeKitAccountId'])
    .index('by_workspaceId_importStatus', ['workspaceId', 'importStatus'])
    .index('by_workspaceId_financeKitAccountId_externalTransactionId', [
      'workspaceId',
      'financeKitAccountId',
      'externalTransactionId',
    ])
    .index('by_transactionId', ['transactionId']),

  // Track potential transfer pairs before both sides are imported
  // When one side of a transfer is detected, we create a record here to match the counterpart
  pendingTransferMatch: defineTable({
    workspaceId: v.id('workspace'),
    sourceTransactionId: v.id('transaction'),
    sourceBankAccountId: v.id('bankAccount'),
    expectedAmount: v.int64(), // Opposite sign of source transaction
    expectedDateMin: v.string(), // date - 3 days
    expectedDateMax: v.string(), // date + 3 days
    suggestedCounterpartAccountId: v.optional(v.id('bankAccount')),
    transferConfidence: v.number(), // 0-100
    accountConfidence: v.optional(v.number()), // 0-100, undefined if no account suggestion
    detectionReason: v.string(),
    status: v.union(
      v.literal('awaiting_counterpart'), // Waiting for other side to be imported
      v.literal('matched'), // Counterpart found and linked
      v.literal('user_approved'), // User approved with destination
      v.literal('user_approved_no_destination'), // User approved without destination
      v.literal('user_rejected'), // User rejected transfer suggestion
      v.literal('expired') // Expired after 30 days without match
    ),
    matchedTransactionId: v.optional(v.id('transaction')),
    matchedAt: v.optional(v.string()),
    createdAt: v.string(),
    expiresAt: v.string(), // Auto-expire after 30 days
    updatedAt: v.string(),
    isDeleted: v.boolean(),
  })
    .index('by_workspaceId', ['workspaceId'])
    .index('by_sourceTransactionId', ['sourceTransactionId'])
    .index('by_workspaceId_status', ['workspaceId', 'status'])
    .index('by_workspaceId_expectedAmount_status', ['workspaceId', 'expectedAmount', 'status']),

  userProfile: defineTable({
    adAttribution: v.optional(storedAdAttribution),
    // Private seed for a capability that can only withdraw ad consent.
    adConsentRevocationKey: v.optional(v.string()),
    // One write per active day, shared by every signed-in client. No historical backfill.
    checkIn: v.optional(checkInValidator),
    name: v.optional(v.string()),
    clerkId: v.string(),
    email: v.string(),
    updatedAt: v.optional(v.string()),
    activeWorkspaceId: v.optional(v.id('workspace')),
    familyInviteEmailQuotaWindowStartedAt: v.optional(v.string()),
    familyInviteEmailSendsInWindow: v.optional(v.number()),
    apnsDeviceToken: v.optional(v.string()),
    notificationsEnabled: v.optional(v.boolean()),
    // Granular notification preferences
    notificationPreferences: v.optional(
      v.object({
        // New transaction notifications (from bank sync)
        newTransactionsEnabled: v.boolean(),
        // Reminder notifications (scheduled locally on device)
        remindersEnabled: v.boolean(),
        // Frequency: gentle (1-2/day), aggressive (4-5/day), relentless (6-10/day)
        reminderFrequency: v.optional(v.union(v.literal('gentle'), v.literal('aggressive'), v.literal('relentless'))),
      })
    ),
    onboardingCompleted: v.boolean(),
    referralSource: v.optional(v.string()),
    // @deprecated - kept for backward compatibility with older iOS clients
    isV1User: v.optional(v.boolean()),
    // @deprecated - kept for backward compatibility with existing data
    migrationStatus: v.optional(v.string()),
    isDeleted: v.optional(v.boolean()),
    deletedAt: v.optional(v.string()),
    lastDeletedAt: v.optional(v.string()),
    lastReactivatedAt: v.optional(v.string()),
    deletionCount: v.optional(v.number()),
    // Legacy marker for identities that were fully deleted from Clerk.
    clerkDeletedAt: v.optional(v.string()),
    clerkMarkedDeletedAt: v.optional(v.string()),
    clerkSessionsRevokedAt: v.optional(v.string()),
    // Legacy marker for contacts deleted from Loops before unsubscribe retention.
    loopsRemovedAt: v.optional(v.string()),
    loopsUnsubscribedAt: v.optional(v.string()),
    externalCleanupLastAttemptAt: v.optional(v.string()),
    externalCleanupCompletedAt: v.optional(v.string()),
    externalCleanupError: v.optional(v.string()),
    purgeStartedAt: v.optional(v.string()),
    purgeCompletedAt: v.optional(v.string()),
  })
    .index('by_clerkId', ['clerkId'])
    .index('by_isDeleted_and_deletedAt', ['isDeleted', 'deletedAt'])
    .index('by_isDeleted_and_purgeCompletedAt_and_deletedAt', ['isDeleted', 'purgeCompletedAt', 'deletedAt']),

  accountDeletionBillingCleanup: defineTable({
    clerkId: v.string(),
    email: v.string(),
    status: v.union(v.literal('pending'), v.literal('confirmed')),
    attemptCount: v.number(),
    nextAttemptAt: v.optional(v.number()),
    lastAttemptAt: v.optional(v.string()),
    confirmedAt: v.optional(v.string()),
    lastError: v.optional(v.string()),
    alertSentAt: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index('by_clerkId', ['clerkId'])
    .index('by_status_and_nextAttemptAt', ['status', 'nextAttemptAt']),

  subscription: defineTable({
    // User reference (RevenueCat app_user_id = Clerk user ID)
    clerkId: v.string(),

    // RevenueCat identifiers
    revenueCatSubscriberId: v.string(),
    originalTransactionId: v.optional(v.string()),

    // Product information
    productId: v.string(),
    entitlementIds: v.array(v.string()),

    // Subscription type
    subscriptionType: v.union(v.literal('trial'), v.literal('monthly'), v.literal('yearly'), v.literal('lifetime')),

    // Subscription status
    status: v.union(
      v.literal('active'),
      v.literal('trialing'),
      v.literal('canceled'),
      v.literal('expired'),
      v.literal('billing_issue'),
      v.literal('paused')
    ),

    // Period information
    periodType: v.optional(
      v.union(
        v.literal('TRIAL'),
        v.literal('INTRO'),
        v.literal('NORMAL'),
        v.literal('PROMOTIONAL'),
        v.literal('PREPAID')
      )
    ),

    // Billing details
    price: v.optional(v.number()), // Amount in cents
    currency: v.optional(v.string()), // USD, EUR, etc.

    // Dates (ISO string format)
    purchasedAt: v.optional(v.string()),
    expiresAt: v.optional(v.union(v.string(), v.null())), // null for lifetime or when not yet determined
    canceledAt: v.optional(v.union(v.string(), v.null())),

    // Store information
    store: v.optional(
      v.union(v.literal('app_store'), v.literal('play_store'), v.literal('stripe'), v.literal('promotional'))
    ),

    // Event tracking
    lastEventType: v.optional(v.string()),
    lastEventTimestamp: v.optional(v.string()),
    lastEventId: v.optional(v.string()),

    // Timestamps
    createdAt: v.string(),
    updatedAt: v.string(),
    isDeleted: v.boolean(),
  })
    .index('by_clerkId', ['clerkId'])
    .index('by_revenueCatSubscriberId', ['revenueCatSubscriberId'])
    .index('by_clerkId_status', ['clerkId', 'status'])
    .index('by_clerkId_isDeleted', ['clerkId', 'isDeleted'])
    .index('by_status_isDeleted', ['status', 'isDeleted']),

  revenueCatCustomerAlias: defineTable({
    clerkId: v.string(),
    customerId: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
    isDeleted: v.boolean(),
  })
    .index('by_clerkId_and_customerId', ['clerkId', 'customerId'])
    .index('by_clerkId_and_isDeleted', ['clerkId', 'isDeleted']),

  mcpToken: defineTable({
    tokenHash: v.string(), // SHA-256 hash of raw token value
    clerkId: v.string(),
    label: v.string(),
    scopes: v.array(v.string()),
    lastUsedAt: v.optional(v.string()),
    expiresAt: v.optional(v.string()),
    revokedAt: v.optional(v.string()),
    createdAt: v.string(),
  })
    .index('by_tokenHash', ['tokenHash'])
    .index('by_clerkId', ['clerkId'])
    .index('by_clerkId_revokedAt', ['clerkId', 'revokedAt']),

  mcpOauthAuthorizationCode: defineTable({
    codeHash: v.string(), // SHA-256 hash of raw authorization code
    clerkId: v.string(),
    clientId: v.string(),
    redirectUri: v.string(),
    codeChallenge: v.string(),
    codeChallengeMethod: v.literal('S256'),
    scopes: v.array(v.string()),
    resource: v.optional(v.string()),
    expiresAt: v.string(),
    consumedAt: v.optional(v.string()),
    createdAt: v.string(),
  })
    .index('by_codeHash', ['codeHash'])
    .index('by_clerkId', ['clerkId'])
    .index('by_clerkId_and_clientId_and_consumedAt_and_expiresAt', ['clerkId', 'clientId', 'consumedAt', 'expiresAt']),

  mcpOauthAccessToken: defineTable({
    tokenHash: v.string(), // SHA-256 hash of raw access token
    clerkId: v.string(),
    clientId: v.string(),
    connectionId: v.optional(v.id('mcpOauthConnection')),
    connectionVersion: v.optional(v.number()),
    scopes: v.array(v.string()),
    resource: v.optional(v.string()),
    expiresAt: v.string(),
    revokedAt: v.optional(v.string()),
    lastUsedAt: v.optional(v.string()),
    createdAt: v.string(),
  })
    .index('by_tokenHash', ['tokenHash'])
    .index('by_clerkId', ['clerkId'])
    .index('by_clerkId_and_clientId', ['clerkId', 'clientId'])
    .index('by_clerkId_revokedAt', ['clerkId', 'revokedAt']),

  mcpOauthRefreshToken: defineTable({
    tokenHash: v.string(), // SHA-256 hash of raw refresh token
    clerkId: v.string(),
    clientId: v.string(),
    connectionId: v.optional(v.id('mcpOauthConnection')),
    connectionVersion: v.optional(v.number()),
    scopes: v.array(v.string()),
    resource: v.optional(v.string()),
    expiresAt: v.string(),
    revokedAt: v.optional(v.string()),
    lastUsedAt: v.optional(v.string()),
    createdAt: v.string(),
  })
    .index('by_tokenHash', ['tokenHash'])
    .index('by_clerkId', ['clerkId'])
    .index('by_clerkId_and_clientId', ['clerkId', 'clientId'])
    .index('by_clerkId_revokedAt', ['clerkId', 'revokedAt']),

  apiKey: defineTable({
    tokenHash: v.string(), // SHA-256 hash of the raw key — the raw value is shown once and never stored
    keyPrefix: v.string(), // First characters of the raw key, kept for display (e.g. "kualia_a1b2c3…")
    clerkId: v.string(),
    label: v.string(),
    scopes: v.array(v.union(v.literal('read'), v.literal('write'))),
    lastUsedAt: v.optional(v.string()),
    revokedAt: v.optional(v.string()),
    createdAt: v.string(),
    // Fixed-window rate limiting state (see publicApi/): window start in ms epoch + requests served
    rateLimitWindowStart: v.optional(v.number()),
    rateLimitWindowCount: v.optional(v.number()),
  })
    .index('by_tokenHash', ['tokenHash'])
    .index('by_clerkId', ['clerkId']),

  mcpOauthClient: defineTable({
    clientId: v.string(),
    redirectUris: v.array(v.string()),
    grantTypes: v.array(v.string()),
    responseTypes: v.array(v.string()),
    tokenEndpointAuthMethod: v.string(),
    clientName: v.optional(v.string()),
    clientUri: v.optional(v.string()),
    createdAt: v.string(),
  }).index('by_clientId', ['clientId']),

  mcpOauthConnection: defineTable({
    clerkId: v.string(),
    clientId: v.string(),
    authorizationVersion: v.number(),
    scopes: v.array(v.string()),
    resource: v.optional(v.string()),
    connectedAt: v.string(),
    lastAuthorizedAt: v.string(),
    lastUsedAt: v.optional(v.string()),
    revokedAt: v.optional(v.string()),
  })
    .index('by_clerkId', ['clerkId'])
    .index('by_clerkId_and_clientId', ['clerkId', 'clientId'])
    .index('by_clerkId_and_revokedAt', ['clerkId', 'revokedAt']),

  workspace: defineTable({
    name: v.string(),
    ownerClerkId: v.string(),
    // Cumulative ready-to-assign amount (total income - total assigned)
    readyToAssign: v.optional(v.int64()), // Amount in cents
    // Legacy: Monthly income amounts (deprecated, kept for existing data)
    monthlyIncome: v.optional(v.record(v.string(), v.int64())),
    // Monthly income activity tracking (inflow and outflow separately for reports)
    // Map of yearMonth string -> { inflowAmount, outflowAmount }
    monthlyIncomeActivity: v.optional(
      v.record(
        v.string(),
        v.object({
          inflowAmount: v.int64(), // Positive RTA movements (income)
          outflowAmount: v.int64(), // Negative RTA movements (stored as positive)
        })
      )
    ),
    // Supabase migration fields
    currency: v.optional(v.string()),
    isDeleted: v.optional(v.boolean()),
    deletedAt: v.optional(v.string()),
    // Transaction defaults
    transactionDefaultAccountId: v.optional(v.id('bankAccount')), // Default account for new transactions
    transactionDefaultPendingStatus: v.boolean(), // Default pending status for new transactions (false = cleared)
    // Workspace settings
    timezone: v.optional(v.string()),
    expectedMonthlyIncome: v.optional(v.int64()), // Amount in cents
    // Bank account ordering configuration
    bankAccountOrdering: v.optional(
      v.object({
        groupOrder: v.array(v.string()),
        accountOrderByGroup: v.record(v.string(), v.array(v.id('bankAccount'))),
      })
    ),
    updatedAt: v.optional(v.string()),
    // Workspace onboarding (income, targets, etc.) - true when setup is complete
    onboardingCompleted: v.optional(v.boolean()),
    // Archive status - archived workspaces don't sync or send notifications
    isArchived: v.optional(v.boolean()),
    archivedAt: v.optional(v.string()),
  }).index('by_ownerClerkId_isDeleted', ['ownerClerkId', 'isDeleted']),

  familyGroup: defineTable({
    name: v.string(),
    ownerUserProfileId: v.id('userProfile'),
    ownerClerkId: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
    isDeleted: v.boolean(),
    deletedAt: v.optional(v.string()),
  })
    .index('by_ownerClerkId_isDeleted', ['ownerClerkId', 'isDeleted'])
    .index('by_ownerUserProfileId_isDeleted', ['ownerUserProfileId', 'isDeleted']),

  familyGroupMember: defineTable({
    familyGroupId: v.id('familyGroup'),
    userProfileId: v.id('userProfile'),
    clerkId: v.string(),
    role: v.union(v.literal('owner'), v.literal('member')),
    joinedAt: v.string(),
    updatedAt: v.string(),
    isDeleted: v.boolean(),
    deletedAt: v.optional(v.string()),
  })
    .index('by_familyGroupId_isDeleted', ['familyGroupId', 'isDeleted'])
    .index('by_clerkId_isDeleted', ['clerkId', 'isDeleted'])
    .index('by_familyGroupId_clerkId', ['familyGroupId', 'clerkId'])
    .index('by_familyGroupId_clerkId_isDeleted', ['familyGroupId', 'clerkId', 'isDeleted'])
    .index('by_userProfileId_isDeleted', ['userProfileId', 'isDeleted']),

  familyGroupInvite: defineTable({
    familyGroupId: v.id('familyGroup'),
    invitedEmail: v.string(),
    invitedName: v.string(),
    invitedByUserProfileId: v.id('userProfile'),
    invitedByClerkId: v.string(),
    invitedByName: v.string(),
    invitedByEmail: v.string(),
    inviteToken: v.string(),
    status: v.union(
      v.literal('sending'),
      v.literal('pending'),
      v.literal('accepted'),
      v.literal('revoked'),
      v.literal('expired'),
      v.literal('send_failed')
    ),
    sendCount: v.number(),
    createdAt: v.string(),
    updatedAt: v.string(),
    lastSentAt: v.string(),
    lastSendError: v.optional(v.string()),
    lastSendFailedAt: v.optional(v.string()),
    expiresAt: v.string(),
    isDeleted: v.boolean(),
    deletedAt: v.optional(v.string()),
  })
    .index('by_familyGroupId_status_isDeleted', ['familyGroupId', 'status', 'isDeleted'])
    .index('by_familyGroupId_invitedEmail_status_isDeleted', ['familyGroupId', 'invitedEmail', 'status', 'isDeleted'])
    .index('by_invitedByUserProfileId', ['invitedByUserProfileId'])
    .index('by_inviteToken', ['inviteToken'])
    .index('by_invitedEmail_status_isDeleted', ['invitedEmail', 'status', 'isDeleted']),

  systemStatus: defineTable({
    key: v.literal('global'),
    maintenanceMode: v.boolean(),
    maintenanceMessage: v.optional(v.string()),
    minIosVersion: v.optional(v.string()),
    iosUpdateMessage: v.optional(v.string()),
    updatedAt: v.string(),
  }).index('by_key', ['key']),

  ynabImportStatus: defineTable({
    userId: v.id('userProfile'),
    workspaceId: v.optional(v.id('workspace')),
    status: v.union(
      v.literal('pending'),
      v.literal('parsing'),
      v.literal('importing'),
      v.literal('completed'),
      v.literal('failed')
    ),
    errorMessage: v.optional(v.string()),
    progress: v.optional(
      v.object({
        currentStep: v.string(),
        accountsTotal: v.number(),
        accountsImported: v.number(),
        categoriesTotal: v.number(),
        categoriesImported: v.number(),
        transactionsTotal: v.number(),
        transactionsImported: v.number(),
      })
    ),
    createdAt: v.string(),
    updatedAt: v.string(),
  }).index('by_userId', ['userId']),

  appChangelog: defineTable({
    version: v.string(),
    changelogUrl: v.string(),
  }).index('by_version', ['version']),

  transactionRule: defineTable({
    name: v.string(),
    workspaceId: v.id('workspace'),
    isActive: v.boolean(),
    priority: v.number(),

    conditions: v.object({
      originalStatement: v.optional(
        v.array(
          v.object({
            matchType: v.union(v.literal('contains'), v.literal('exactlyMatches')),
            value: v.string(),
          })
        )
      ),

      merchantName: v.optional(
        v.array(
          v.object({
            matchType: v.union(v.literal('contains'), v.literal('exactlyMatches')),
            value: v.string(),
          })
        )
      ),

      amount: v.optional(
        v.array(
          v.object({
            operator: v.union(
              v.literal('equals'),
              v.literal('lessThan'),
              v.literal('greaterThan'),
              v.literal('between')
            ),
            value: v.int64(),
            valueTo: v.optional(v.int64()),
          })
        )
      ),

      bankAccountId: v.optional(v.array(v.id('bankAccount'))),
    }),

    actions: v.object({
      setMerchantId: v.optional(v.id('merchant')),
      setCategoryId: v.optional(v.id('category')),
    }),

    usageCount: v.optional(v.number()),
    lastUsedAt: v.optional(v.string()),

    createdAt: v.string(),
    updatedAt: v.string(),
    isDeleted: v.boolean(),
    deletedAt: v.optional(v.string()),
  }).index('by_workspaceId', ['workspaceId']),

  // Track uploaded files for logo storage
  // Enables orphan cleanup to prevent storage bloat
  uploadedFile: defineTable({
    storageId: v.id('_storage'),
    workspaceId: v.id('workspace'),
    entityType: v.union(v.literal('merchant'), v.literal('bankAccount')),
    entityId: v.union(v.id('merchant'), v.id('bankAccount')),
    mimeType: v.string(),
    fileSize: v.number(),
    createdAt: v.number(),
    isOrphaned: v.boolean(),
    orphanedAt: v.optional(v.number()),
  })
    .index('by_workspaceId', ['workspaceId'])
    .index('by_storageId', ['storageId'])
    .index('by_entityType_entityId', ['entityType', 'entityId'])
    .index('by_isOrphaned_orphanedAt', ['isOrphaned', 'orphanedAt']),

  // Short-lived workspace export archives. Download links use a hashed bearer token and
  // expire automatically; the archive itself is removed from storage by the scheduled cleanup.
  dataExport: defineTable({
    workspaceId: v.id('workspace'),
    requestedByClerkId: v.string(),
    source: v.union(v.literal('web'), v.literal('mcp')),
    storageId: v.id('_storage'),
    tokenHash: v.string(),
    filename: v.string(),
    contentType: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    isDeleted: v.boolean(),
    deletedAt: v.optional(v.string()),
  })
    .index('by_tokenHash', ['tokenHash'])
    .index('by_workspaceId', ['workspaceId'])
    .index('by_expiresAt', ['expiresAt']),

  // APNs JWT token cache (avoids TooManyProviderTokenUpdates rate limiting)
  apnsTokenCache: defineTable({
    jwt: v.string(),
    expiresAt: v.number(),
  }),

  // Widget authentication tokens for iOS widget extension
  // Long-lived tokens that allow the widget to fetch data via HTTP endpoints
  // without requiring a Clerk session (which expires and can't run in extensions)
  widgetToken: defineTable({
    workspaceId: v.id('workspace'),
    clerkId: v.string(),
    token: v.string(),
    createdAt: v.string(),
    lastUsedAt: v.optional(v.string()),
    isRevoked: v.boolean(),
  })
    .index('by_token', ['token'])
    .index('by_workspaceId', ['workspaceId'])
    .index('by_clerkId', ['clerkId'])
    .index('by_clerkId_workspaceId', ['clerkId', 'workspaceId'])
    .index('by_clerkId_isRevoked_workspaceId', ['clerkId', 'isRevoked', 'workspaceId']),

  // Ownership + size metadata for AI chat attachments. Created by `recordChatAttachment`
  // immediately after the client uploads a blob to `_storage`. `sendMessage` looks up the row
  // by storageId and rejects the request unless `userId` matches the caller — without this
  // an authenticated user could feed any storageId in the deployment to the agent and have
  // it inlined into the model's context. `consumedAt` is reserved for a future orphan-cleanup
  // janitor that distinguishes uploads which were never sent from ones still inside the 24h
  // post-send retention window.
  chatAttachment: defineTable({
    storageId: v.id('_storage'),
    userId: v.string(),
    mediaType: v.string(),
    size: v.number(),
    filename: v.string(),
    createdAt: v.number(),
    consumedAt: v.optional(v.number()),
  })
    .index('by_storageId', ['storageId'])
    .index('by_userId_createdAt', ['userId', 'createdAt']),

  // Per-user, per-calendar-month rollup of AI chat token usage and cost.
  // Incremented in place from the chat agent's usageHandler; gates the
  // hardcoded $10/month spend limit enforced in `aiChat/usage.ts`.
  // Scoped by Clerk user id (matches the agent component's `userId`), not orgId.
  aiChatUsage: defineTable({
    userId: v.string(),
    yearMonth: v.string(), // 'YYYY-MM' UTC
    costUsd: v.number(),
    inputTokens: v.number(),
    cachedInputTokens: v.number(),
    outputTokens: v.number(),
    stepCount: v.number(),
    updatedAt: v.string(),
  })
    .index('by_userId_yearMonth', ['userId', 'yearMonth'])
    .index('by_yearMonth', ['yearMonth']),

  // Per-user, per-thread read-state tracking for the AI chat. A thread is "unread" when
  // `lastAssistantAt > (lastReadAt ?? 0)` — drives the primary-colored dot on the bottom-bar tab.
  // Rows are upserted lazily: created on the first assistant turn or the first time the user opens
  // the thread, whichever happens first. Scoped by Clerk user id (matches the agent component's
  // `userId`), not orgId, since chat threads themselves are per-user.
  aiChatThreadReadState: defineTable({
    userId: v.string(),
    threadId: v.string(),
    workspaceId: v.optional(v.id('workspace')),
    lastAssistantAt: v.optional(v.number()),
    lastReadAt: v.optional(v.number()),
  })
    .index('by_userId_threadId', ['userId', 'threadId'])
    .index('by_userId', ['userId']),
});
