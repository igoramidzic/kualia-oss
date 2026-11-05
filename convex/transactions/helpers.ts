import { ConvexError } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

import { getCategoryIconName } from '../categories/helpers';
import { dateToYearMonth } from '../categoryBudgets/calculations';
import { appendLogoDevToken } from '../lib/logoUtils';

import type { ResolvedMerchant, TransactionMovementWithRelations, TransactionWithRelations } from './types';

// ============================================================================
// EMBEDDED MOVEMENTS HELPERS
// ============================================================================

/**
 * Movement object structure for embedded movements on transactions
 */
export type EmbeddedMovement = {
  categoryId?: Id<'category'>;
  categoryName?: string;
  readyToAssign: boolean;
  amount: bigint;
  notes?: string;
  sortOrder: number;
  creditCardTransfer?: {
    creditCardCategoryId: Id<'category'>;
    spendingCategoryId: Id<'category'>;
  };
};

/**
 * Resolve merchant name with globalMerchant fallback
 * Used for building searchText
 */
export async function resolveMerchantName(
  ctx: MutationCtx | QueryCtx,
  merchantId: Id<'merchant'> | undefined,
  importDetails?: { merchantName?: string; originalStatement?: string }
): Promise<string> {
  if (merchantId) {
    const merchant = await ctx.db.get(merchantId);
    if (merchant) {
      // If merchant has a name, use it
      if (merchant.name) {
        return merchant.name;
      }
      // Otherwise check for global merchant
      if (merchant.globalMerchantId) {
        const globalMerchant = await ctx.db.get(merchant.globalMerchantId);
        if (globalMerchant?.name) {
          return globalMerchant.name;
        }
      }
    }
  }

  // Fallback to import details
  return importDetails?.merchantName ?? importDetails?.originalStatement ?? '';
}

/**
 * Convert a phrase to a searchable token by:
 * 1. Removing all non-alphanumeric characters (apostrophes, hyphens, etc.)
 * 2. Removing all spaces
 * This enables exact phrase matching in Convex full-text search.
 * Note: We must strip the same characters the frontend strips to ensure matching.
 * Example: "McDonald's" -> "mcdonalds", "Dining Out" -> "diningout"
 */
function phraseToSearchToken(phrase: string): string {
  return phrase
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // Remove non-alphanumeric (except spaces)
    .replace(/\s+/g, ''); // Remove all spaces
}

/**
 * Build searchText from merchant name, category names, amount, and transaction type
 * Format: "merchantname category1 category2 ... amount [starting_balance|balance_adjustment|transfer]"
 * Note: Bank account name is excluded to prevent large result sets when searching
 * Multi-word names have spaces removed (e.g., "diningout") for exact phrase matching
 */
export function buildSearchText(
  merchantName: string,
  categoryNames: string[],
  totalAmount: bigint,
  transactionType: 'regular' | 'starting_balance' | 'balance_adjustment' | 'transfer',
  notes?: string
): string {
  const parts: string[] = [];

  if (merchantName) {
    parts.push(phraseToSearchToken(merchantName));
  }

  categoryNames.forEach((name) => {
    if (name) {
      parts.push(phraseToSearchToken(name));
    }
  });

  if (notes) {
    parts.push(phraseToSearchToken(notes));
  }

  // Store amount as integer cents (no decimal) for exact matching
  // e.g., $14.73 is stored as "1473"
  const amountStr = Math.abs(Number(totalAmount)).toString();
  parts.push(amountStr);

  // Add transaction type for starting_balance, balance_adjustment, and transfer
  if (transactionType === 'starting_balance') {
    parts.push('starting_balance');
  } else if (transactionType === 'balance_adjustment') {
    parts.push('balance_adjustment');
  } else if (transactionType === 'transfer') {
    parts.push('transfer');
  }

  return parts.join(' ');
}

/**
 * Calculate total amount from movements
 */
export function calculateTotalAmount(movements: Array<{ amount: bigint }>): bigint {
  if (movements.length === 0) {
    return 0n;
  }
  return movements.reduce((sum, movement) => sum + movement.amount, 0n);
}

/**
 * Check if transaction has uncategorized movements
 * A movement is uncategorized if:
 * - It has no categoryId AND
 * - It's not readyToAssign (which is intentionally uncategorized)
 * Only regular transactions can be considered uncategorized.
 * Cross-budget transfers on the on-budget side also need categorization.
 */
export function computeHasUncategorized(
  movements: Array<{ categoryId?: Id<'category'>; readyToAssign: boolean }>,
  transactionType: 'regular' | 'starting_balance' | 'balance_adjustment' | 'transfer',
  isCrossBudgetOnBudgetSide?: boolean,
  isOffBudgetAccount?: boolean
): boolean {
  // Regular transactions can always be uncategorized
  if (transactionType === 'regular') {
    if (isOffBudgetAccount) return false;
    return movements.some((m) => !m.categoryId && !m.readyToAssign);
  }

  // Cross-budget transfers on the on-budget side need categorization
  if (transactionType === 'transfer' && isCrossBudgetOnBudgetSide) {
    return movements.some((m) => !m.categoryId && !m.readyToAssign);
  }

  return false;
}

/**
 * Check if transaction is missing a payee (merchant)
 * Only regular transactions can be considered as missing a payee
 */
export function computeHasMissingPayee(
  merchantId: Id<'merchant'> | undefined,
  transactionType: 'regular' | 'starting_balance' | 'balance_adjustment' | 'transfer'
): boolean {
  // Only regular transactions can be considered as missing a payee
  if (transactionType !== 'regular') {
    return false;
  }

  return !merchantId;
}

/**
 * Determines if a transaction movement represents a refund for a credit card.
 *
 * A refund is defined as:
 * - Positive amount (money coming back)
 * - NOT in "ready to assign" state (it's categorized)
 * - NOT a transfer transaction (determined by caller context)
 * - Has a creditCardTransfer metadata (money moving to CC category)
 */
export function isRefundMovement(
  movement: {
    amount: bigint;
    readyToAssign: boolean;
    creditCardTransfer?: {
      creditCardCategoryId: Id<'category'>;
      spendingCategoryId: Id<'category'>;
    };
  },
  isTransferTransaction: boolean
): boolean {
  // Must be positive
  if (movement.amount <= 0n) return false;

  // Cannot be ready to assign
  if (movement.readyToAssign) return false;

  // Must not be a transfer
  if (isTransferTransaction) return false;

  // Must have credit card transfer metadata
  if (!movement.creditCardTransfer) return false;

  return true;
}

/**
 * Build embedded movements with category names for a transaction
 * Fetches category names and returns the full embedded movement structure
 */
export async function buildEmbeddedMovements(
  ctx: MutationCtx | QueryCtx,
  movements: Array<{
    categoryId?: Id<'category'>;
    readyToAssign: boolean;
    amount: bigint;
    notes?: string;
    sortOrder: number;
    creditCardTransfer?: {
      creditCardCategoryId: Id<'category'>;
      spendingCategoryId: Id<'category'>;
    };
  }>
): Promise<EmbeddedMovement[]> {
  // Collect all category IDs to fetch
  const categoryIds = new Set<Id<'category'>>();
  movements.forEach((m) => {
    if (m.categoryId) categoryIds.add(m.categoryId);
  });

  // Fetch all categories in parallel
  const categoriesArray = await Promise.all(Array.from(categoryIds).map((id) => ctx.db.get(id)));

  // Build lookup map
  const categoriesMap = new Map<Id<'category'>, Doc<'category'>>();
  categoriesArray.forEach((category) => {
    if (category && !category.isDeleted) {
      categoriesMap.set(category._id, category);
    }
  });

  // Build embedded movements with category names
  return movements.map((m) => {
    const category = m.categoryId ? categoriesMap.get(m.categoryId) : null;
    return {
      categoryId: m.categoryId,
      categoryName: category?.name,
      readyToAssign: m.readyToAssign,
      amount: m.amount,
      notes: m.notes,
      sortOrder: m.sortOrder,
      creditCardTransfer: m.creditCardTransfer,
    };
  });
}

/**
 * Build all computed fields for a transaction
 * Returns: movements array, searchText, totalAmount, hasUncategorized, hasMissingPayee
 */
export async function buildTransactionComputedFields(
  ctx: MutationCtx | QueryCtx,
  args: {
    merchantId?: Id<'merchant'>;
    bankAccountId: Id<'bankAccount'>;
    importDetails?: { merchantName?: string; originalStatement?: string };
    transactionType: 'regular' | 'starting_balance' | 'balance_adjustment' | 'transfer';
    notes?: string;
    isCrossBudgetOnBudgetSide?: boolean;
    movements: Array<{
      categoryId?: Id<'category'>;
      readyToAssign: boolean;
      amount: bigint;
      notes?: string;
      sortOrder: number;
      creditCardTransfer?: {
        creditCardCategoryId: Id<'category'>;
        spendingCategoryId: Id<'category'>;
      };
    }>;
  }
): Promise<{
  movements: EmbeddedMovement[];
  searchText: string;
  totalAmount: bigint;
  hasUncategorized: boolean;
  hasMissingPayee: boolean;
}> {
  // Build embedded movements with category names
  const embeddedMovements = await buildEmbeddedMovements(ctx, args.movements);

  // Get merchant name
  const merchantName = await resolveMerchantName(ctx, args.merchantId, args.importDetails);

  // Extract category names from movements
  const categoryNames = embeddedMovements.map((m) => m.categoryName).filter((n): n is string => !!n);

  // Calculate total amount
  const totalAmount = calculateTotalAmount(embeddedMovements);

  // Build search text (bank account name excluded to prevent large result sets)
  const searchText = buildSearchText(merchantName, categoryNames, totalAmount, args.transactionType, args.notes);

  // Determine if account is off-budget
  const bankAccount = await ctx.db.get(args.bankAccountId);
  const isOffBudgetAccount = bankAccount ? !isOnBudgetAccountType(bankAccount.accountType) : false;

  // Compute hasUncategorized
  const hasUncategorized = computeHasUncategorized(
    embeddedMovements,
    args.transactionType,
    args.isCrossBudgetOnBudgetSide,
    isOffBudgetAccount
  );

  // Compute hasMissingPayee
  const hasMissingPayee = computeHasMissingPayee(args.merchantId, args.transactionType);

  return {
    movements: embeddedMovements,
    searchText,
    totalAmount,
    hasUncategorized,
    hasMissingPayee,
  };
}

// ============================================================================
// ORIGINAL HELPERS (kept for backward compatibility during transition)
// ============================================================================

/**
 * Helper function to check if a bank account is a credit card or loan account
 */
export async function isCreditCardAccount(
  ctx: MutationCtx | QueryCtx,
  bankAccountId: Id<'bankAccount'>
): Promise<boolean> {
  const bankAccount = await ctx.db.get(bankAccountId);
  if (!bankAccount) {
    return false;
  }

  // Check bankAccount.accountType first (new approach)
  if (bankAccount.accountType) {
    return bankAccount.accountType.startsWith('credit_');
  }

  // Fallback to bankLinkAccount.accountType for backward compatibility
  if (bankAccount.bankLinkAccountId) {
    const bankLinkAccount = await ctx.db.get(bankAccount.bankLinkAccountId);
    if (bankLinkAccount) {
      return bankLinkAccount.accountType.startsWith('credit_');
    }
  }

  return false;
}

/**
 * Check if an account type is on-budget (banking or credit)
 */
export function isOnBudgetAccountType(accountType: string): boolean {
  return accountType.startsWith('banking_') || accountType.startsWith('credit_');
}

/**
 * Check if a transfer crosses the budget boundary (one on-budget, one off-budget)
 */
export function isCrossBudgetTransfer(accountTypeA: string | undefined, accountTypeB: string | undefined): boolean {
  if (!accountTypeA || !accountTypeB) return false;
  return isOnBudgetAccountType(accountTypeA) !== isOnBudgetAccountType(accountTypeB);
}

/**
 * Check if a transfer is a credit card payment (transfer between banking and credit accounts)
 * This is a synchronous helper that checks account types directly.
 */
function isCreditCardPaymentTransfer(
  bankAccountType: string | undefined,
  pairedBankAccountType: string | undefined
): boolean {
  if (!bankAccountType || !pairedBankAccountType) return false;

  const isBanking = (type: string) => type.startsWith('banking_');
  const isCredit = (type: string) => type.startsWith('credit_');

  return (
    (isBanking(bankAccountType) && isCredit(pairedBankAccountType)) ||
    (isCredit(bankAccountType) && isBanking(pairedBankAccountType))
  );
}

/**
 * Helper function to check if a bank account is excluded from RTA calculations.
 * Credit cards, loans, and investment accounts don't affect Ready to Assign.
 * Only banking accounts (checking, savings, cash, etc.) contribute to RTA.
 */
export async function isAccountExcludedFromRTA(
  ctx: MutationCtx | QueryCtx,
  bankAccountId: Id<'bankAccount'>
): Promise<boolean> {
  const bankAccount = await ctx.db.get(bankAccountId);
  if (!bankAccount) {
    return true; // If account doesn't exist, exclude from RTA
  }

  // Check bankAccount.accountType first (new approach)
  if (bankAccount.accountType) {
    return (
      bankAccount.accountType.startsWith('credit_') ||
      bankAccount.accountType.startsWith('loan_') ||
      bankAccount.accountType.startsWith('investment_')
    );
  }

  // Fallback to bankLinkAccount.accountType for backward compatibility
  if (bankAccount.bankLinkAccountId) {
    const bankLinkAccount = await ctx.db.get(bankAccount.bankLinkAccountId);
    if (bankLinkAccount) {
      return (
        bankLinkAccount.accountType.startsWith('credit_') ||
        bankLinkAccount.accountType.startsWith('loan_') ||
        bankLinkAccount.accountType.startsWith('investment_')
      );
    }
  }

  return false;
}

/**
 * Helper function to get the credit card category for a bank account
 */
export async function getCreditCardCategoryForAccount(
  ctx: MutationCtx | QueryCtx,
  bankAccountId: Id<'bankAccount'>
): Promise<Id<'category'> | null> {
  const creditCardCategory = await ctx.db
    .query('category')
    .withIndex('by_bankAccountId', (q) => q.eq('bankAccountId', bankAccountId))
    .filter((q) => q.and(q.eq(q.field('categoryType'), 'credit_card'), q.eq(q.field('isDeleted'), false)))
    .first();

  return creditCardCategory?._id ?? null;
}

/**
 * Helper function to resolve merchant with global merchant fallback
 */
async function resolveMerchant(ctx: QueryCtx, merchant: Doc<'merchant'> | null): Promise<ResolvedMerchant | null> {
  if (!merchant) return null;

  if (!merchant.globalMerchantId) {
    // Manually created merchant - use name/logo directly
    return {
      ...merchant,
      name: merchant.name ?? '',
      logoUrl: appendLogoDevToken(merchant.logoUrl),
      visualIdentityMode: merchant.visualIdentityMode ?? 'logo',
      iconName: merchant.iconName,
      iconColorId: merchant.iconColorId,
    };
  }

  const globalMerchant = await ctx.db.get(merchant.globalMerchantId);
  if (!globalMerchant) {
    // Shouldn't happen but handle gracefully
    return {
      ...merchant,
      name: merchant.name ?? '',
      logoUrl: appendLogoDevToken(merchant.logoUrl),
      visualIdentityMode: merchant.visualIdentityMode ?? 'logo',
      iconName: merchant.iconName,
      iconColorId: merchant.iconColorId,
    };
  }

  // Resolve display logo based on three states:
  // - undefined: use global merchant logo
  // - string: use custom logo
  // - null: explicitly no logo
  const resolvedLogoUrl =
    merchant.logoUrl === undefined ? globalMerchant.logoUrl : merchant.logoUrl === null ? undefined : merchant.logoUrl;

  return {
    ...merchant,
    name: merchant.name ?? globalMerchant.name,
    logoUrl: appendLogoDevToken(resolvedLogoUrl),
    visualIdentityMode: merchant.visualIdentityMode ?? 'logo',
    iconName: merchant.iconName,
    iconColorId: merchant.iconColorId,
  };
}

/**
 * Calculate transaction amount from movements
 */
export function calculateTransactionAmount(movements: Array<{ amount: bigint }>): bigint {
  if (movements.length === 0) {
    return 0n;
  }
  return movements.reduce((sum, movement) => sum + movement.amount, 0n);
}

/**
 * Validate that movements sum to transaction amount
 */
export function validateMovements(transactionAmount: bigint, movements: Array<{ amount: bigint }>): void {
  if (movements.length < 1) {
    throw new ConvexError('Transactions must have at least 1 movement');
  }

  const movementsSum = movements.reduce((sum, movement) => sum + movement.amount, 0n);
  if (movementsSum !== transactionAmount) {
    throw new ConvexError(
      `Movement amounts must sum to transaction amount. Expected ${transactionAmount}, got ${movementsSum}`
    );
  }

  // Ensure no movement has zero amount
  if (movements.some((movement) => movement.amount === 0n)) {
    throw new ConvexError('Movement amounts cannot be zero');
  }
}

/**
 * Helper function to populate transaction movements from embedded array
 */
async function populateTransactionMovements(
  ctx: QueryCtx,
  transaction: Doc<'transaction'>
): Promise<TransactionMovementWithRelations[]> {
  const movements = transaction.movements ?? [];

  // Sort by sortOrder
  const sortedMovements = [...movements].sort((a, b) => a.sortOrder - b.sortOrder);

  // Populate category for each movement
  const populatedMovements = await Promise.all(
    sortedMovements.map(async (movement) => {
      const categoryDoc = movement.categoryId ? await ctx.db.get(movement.categoryId) : null;
      const category: Doc<'category'> | null = categoryDoc?.isDeleted ? null : categoryDoc;

      // Enrich category with iconName (hardcode CreditCard for credit card categories)
      let enrichedCategory = category;
      if (category) {
        const categoryGroup = await ctx.db.get(category.categoryGroupId);
        const groupType = categoryGroup?.type;
        enrichedCategory = {
          ...category,
          iconName: getCategoryIconName(category, groupType),
        };
      }

      // Exclude categoryName from response - clients should use category.name instead
      // categoryName is kept in DB for searchText rebuilding but not exposed to clients
      const { categoryName: _, ...movementWithoutCategoryName } = movement;
      return {
        ...movementWithoutCategoryName,
        category: enrichedCategory,
      };
    })
  );

  return populatedMovements;
}

/**
 * Batch populate multiple transactions efficiently to avoid N+1 queries
 * Optimized to reduce round trips by batching parallel fetches together
 * Reduces from ~10 sequential round trips to ~4 by grouping independent fetches
 */
export async function populateTransactionsBatch(
  ctx: QueryCtx,
  transactions: Array<Doc<'transaction'>>
): Promise<TransactionWithRelations[]> {
  if (transactions.length === 0) {
    return [];
  }

  // === STEP 1: Collect all direct IDs from transactions ===
  const bankAccountIds = new Set<Id<'bankAccount'>>();
  const merchantIds = new Set<Id<'merchant'>>();
  const transferPairIds = new Set<Id<'transaction'>>();

  transactions.forEach((t) => {
    bankAccountIds.add(t.bankAccountId);
    if (t.merchantId) merchantIds.add(t.merchantId);
    if (t.transferPairId) transferPairIds.add(t.transferPairId);
  });

  // === ROUND TRIP 1: Fetch ALL level-1 entities in PARALLEL ===
  const [bankAccountsArray, merchantsArray, pairedTransactionsArray] = await Promise.all([
    // Fetch bank accounts
    Promise.all(Array.from(bankAccountIds).map((id) => ctx.db.get(id))),

    // Fetch merchants
    Promise.all(Array.from(merchantIds).map((id) => ctx.db.get(id))),

    // Fetch paired transactions for transfers
    Promise.all(Array.from(transferPairIds).map((id) => ctx.db.get(id))),
  ]);

  // Convert arrays to maps for quick lookup
  const bankAccountsMap = new Map<Id<'bankAccount'>, Doc<'bankAccount'>>();
  bankAccountsArray.forEach((account) => {
    if (account) bankAccountsMap.set(account._id, account);
  });

  const merchantsMap = new Map<Id<'merchant'>, Doc<'merchant'>>();
  merchantsArray.forEach((merchant) => {
    if (merchant) merchantsMap.set(merchant._id, merchant);
  });

  const pairedTransactionsMap = new Map<Id<'transaction'>, Doc<'transaction'>>();
  pairedTransactionsArray.forEach((transaction) => {
    if (transaction && !transaction.isDeleted) {
      pairedTransactionsMap.set(transaction._id, transaction);
    }
  });

  // === STEP 2: Collect level-2 IDs from level-1 results ===
  const bankLinkAccountIds = new Set<Id<'bankLinkAccount'>>();
  bankAccountsMap.forEach((account) => {
    if (account.bankLinkAccountId) {
      bankLinkAccountIds.add(account.bankLinkAccountId);
    }
  });

  const globalMerchantIds = new Set<Id<'globalMerchant'>>();
  merchantsMap.forEach((merchant) => {
    if (merchant.globalMerchantId) {
      globalMerchantIds.add(merchant.globalMerchantId);
    }
  });

  // Collect category IDs from embedded movements
  const categoryIds = new Set<Id<'category'>>();
  transactions.forEach((t) => {
    (t.movements ?? []).forEach((m) => {
      if (m.categoryId) categoryIds.add(m.categoryId);
    });
  });

  const pairedBankAccountIds = new Set<Id<'bankAccount'>>();
  pairedTransactionsMap.forEach((t) => {
    pairedBankAccountIds.add(t.bankAccountId);
  });

  // === ROUND TRIP 2: Fetch ALL level-2 entities in PARALLEL ===
  const [bankLinkAccountsArray, globalMerchantsArray, categoriesArray, pairedBankAccountsArray] = await Promise.all([
    // Fetch bank link accounts
    Promise.all(Array.from(bankLinkAccountIds).map((id) => ctx.db.get(id))),

    // Fetch global merchants
    Promise.all(Array.from(globalMerchantIds).map((id) => ctx.db.get(id))),

    // Fetch categories
    Promise.all(Array.from(categoryIds).map((id) => ctx.db.get(id))),

    // Fetch paired bank accounts
    Promise.all(Array.from(pairedBankAccountIds).map((id) => ctx.db.get(id))),
  ]);

  // Convert level-2 arrays to maps
  const bankLinkAccountsMap = new Map<Id<'bankLinkAccount'>, Doc<'bankLinkAccount'>>();
  bankLinkAccountsArray.forEach((account) => {
    if (account) bankLinkAccountsMap.set(account._id, account);
  });

  const globalMerchantsMap = new Map<Id<'globalMerchant'>, Doc<'globalMerchant'>>();
  globalMerchantsArray.forEach((globalMerchant) => {
    if (globalMerchant) globalMerchantsMap.set(globalMerchant._id, globalMerchant);
  });

  const categoriesMap = new Map<Id<'category'>, Doc<'category'>>();
  categoriesArray.forEach((category) => {
    if (category && !category.isDeleted) {
      categoriesMap.set(category._id, category);
    }
  });

  const pairedBankAccountsMap = new Map<Id<'bankAccount'>, Doc<'bankAccount'>>();
  pairedBankAccountsArray.forEach((account) => {
    if (account) pairedBankAccountsMap.set(account._id, account);
  });

  // === STEP 3: Collect level-3 IDs from level-2 results ===
  const bankLinkIds = new Set<Id<'bankLink'>>();
  bankLinkAccountsMap.forEach((account) => {
    if (account.bankLinkId) {
      bankLinkIds.add(account.bankLinkId);
    }
  });

  const categoryGroupIds = new Set<Id<'categoryGroup'>>();
  categoriesMap.forEach((category) => {
    categoryGroupIds.add(category.categoryGroupId);
  });

  // === ROUND TRIP 3: Fetch ALL level-3 entities in PARALLEL ===
  const [bankLinksArray, categoryGroupsArray] = await Promise.all([
    // Fetch bank links
    Promise.all(Array.from(bankLinkIds).map((id) => ctx.db.get(id))),

    // Fetch category groups
    Promise.all(Array.from(categoryGroupIds).map((id) => ctx.db.get(id))),
  ]);

  // Convert level-3 arrays to maps
  const bankLinksMap = new Map<Id<'bankLink'>, Doc<'bankLink'>>();
  bankLinksArray.forEach((link) => {
    if (link) bankLinksMap.set(link._id, link);
  });

  const categoryGroupsMap = new Map<Id<'categoryGroup'>, Doc<'categoryGroup'>>();
  categoryGroupsArray.forEach((group) => {
    if (group) categoryGroupsMap.set(group._id, group);
  });

  // === STEP 4: Collect level-4 IDs from level-3 results ===
  const globalInstitutionIds = new Set<Id<'globalInstitution'>>();
  bankLinksMap.forEach((link) => {
    if (link.globalInstitutionId) {
      globalInstitutionIds.add(link.globalInstitutionId);
    }
  });

  // === ROUND TRIP 4: Fetch ALL level-4 entities ===
  const globalInstitutionsArray = await Promise.all(Array.from(globalInstitutionIds).map((id) => ctx.db.get(id)));

  // Convert level-4 array to map
  const globalInstitutionsMap = new Map<Id<'globalInstitution'>, Doc<'globalInstitution'>>();
  globalInstitutionsArray.forEach((institution) => {
    if (institution) globalInstitutionsMap.set(institution._id, institution);
  });

  // === STEP 5: Assemble final results using all cached data ===
  return transactions.map((transaction) => {
    const bankAccount = bankAccountsMap.get(transaction.bankAccountId);
    const bankLinkAccount = bankAccount?.bankLinkAccountId
      ? (bankLinkAccountsMap.get(bankAccount.bankLinkAccountId) ?? null)
      : null;
    const bankLink = bankLinkAccount?.bankLinkId ? (bankLinksMap.get(bankLinkAccount.bankLinkId) ?? null) : null;
    const globalInstitution = bankLink?.globalInstitutionId
      ? (globalInstitutionsMap.get(bankLink.globalInstitutionId) ?? null)
      : null;

    const merchantDoc = transaction.merchantId ? merchantsMap.get(transaction.merchantId) : null;
    const merchant = merchantDoc ? resolveMerchantSync(merchantDoc, globalMerchantsMap) : null;

    const merchantName =
      merchant?.name ?? transaction.importDetails?.merchantName ?? transaction.importDetails?.originalStatement ?? null;
    const merchantLogo = merchant?.logoUrl ?? null;
    const merchantVisualIdentityMode = merchant?.visualIdentityMode ?? null;
    const merchantIconName = merchant?.iconName ?? null;
    const merchantIconColorId = merchant?.iconColorId ?? null;

    // Use embedded movements from transaction
    const movements = [...(transaction.movements ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
    const populatedMovements = movements.map((movement) => {
      const categoryDoc = movement.categoryId ? categoriesMap.get(movement.categoryId) : null;
      const category = categoryDoc || null;

      let enrichedCategory = category;
      if (category) {
        const categoryGroup = categoryGroupsMap.get(category.categoryGroupId);
        const groupType = categoryGroup?.type;
        enrichedCategory = {
          ...category,
          iconName: getCategoryIconName(category, groupType),
        };
      }

      // Exclude categoryName from response - clients should use category.name instead
      // categoryName is kept in DB for searchText rebuilding but not exposed to clients
      const { categoryName: _, ...movementWithoutCategoryName } = movement;
      return {
        ...movementWithoutCategoryName,
        category: enrichedCategory,
      };
    });

    const amount = calculateTransactionAmount(populatedMovements);

    let transferPairAccountName: string | null = null;
    let transferPairAccountVisualIdentityMode: 'logo' | 'icon' | null = null;
    let transferPairAccountIconName: string | null = null;
    let transferPairAccountIconColorId: string | null = null;
    let isCreditCardPayment = false;
    let crossBudgetTransfer = false;
    if (transaction.type === 'transfer' && transaction.transferPairId) {
      const pairedTransaction = pairedTransactionsMap.get(transaction.transferPairId);
      if (pairedTransaction) {
        const pairedBankAccount = pairedBankAccountsMap.get(pairedTransaction.bankAccountId);
        transferPairAccountName = pairedBankAccount?.name ?? null;
        transferPairAccountVisualIdentityMode = pairedBankAccount?.visualIdentityMode ?? 'logo';
        transferPairAccountIconName = pairedBankAccount?.iconName ?? null;
        transferPairAccountIconColorId = pairedBankAccount?.iconColorId ?? null;
        // Check if this is a credit card payment transfer
        isCreditCardPayment = isCreditCardPaymentTransfer(bankAccount?.accountType, pairedBankAccount?.accountType);
        // Check if this is a cross-budget transfer
        crossBudgetTransfer = isCrossBudgetTransfer(bankAccount?.accountType, pairedBankAccount?.accountType);
      }
    }

    return {
      ...transaction,
      bankAccount: bankAccount
        ? {
            ...bankAccount,
            bankLinkAccount: bankLinkAccount
              ? {
                  ...bankLinkAccount,
                  bankLink,
                }
              : null,
            institution: globalInstitution
              ? {
                  ...globalInstitution,
                  logoUrl: appendLogoDevToken(globalInstitution.logoUrl),
                }
              : null,
          }
        : null,
      merchant,
      merchantName,
      merchantLogo,
      merchantVisualIdentityMode,
      merchantIconName,
      merchantIconColorId,
      movements: populatedMovements,
      transferPairAccountName,
      transferPairAccountVisualIdentityMode,
      transferPairAccountIconName,
      transferPairAccountIconColorId,
      amount,
      isCreditCardPayment,
      isCrossBudgetTransfer: crossBudgetTransfer,
    };
  });
}

/**
 * Synchronous version of resolveMerchant for use in batch processing
 */
function resolveMerchantSync(
  merchant: Doc<'merchant'>,
  globalMerchantsMap: Map<Id<'globalMerchant'>, Doc<'globalMerchant'>>
): ResolvedMerchant | null {
  if (!merchant.globalMerchantId) {
    // Manually created merchant - use name/logo directly
    return {
      ...merchant,
      name: merchant.name ?? '',
      logoUrl: appendLogoDevToken(merchant.logoUrl),
      visualIdentityMode: merchant.visualIdentityMode ?? 'logo',
      iconName: merchant.iconName,
      iconColorId: merchant.iconColorId,
    };
  }

  const globalMerchant = globalMerchantsMap.get(merchant.globalMerchantId);
  if (!globalMerchant) {
    // Shouldn't happen but handle gracefully
    return {
      ...merchant,
      name: merchant.name ?? '',
      logoUrl: appendLogoDevToken(merchant.logoUrl),
      visualIdentityMode: merchant.visualIdentityMode ?? 'logo',
      iconName: merchant.iconName,
      iconColorId: merchant.iconColorId,
    };
  }

  // Resolve display logo based on three states:
  // - undefined: use global merchant logo
  // - string: use custom logo
  // - null: explicitly no logo
  const resolvedLogoUrl =
    merchant.logoUrl === undefined ? globalMerchant.logoUrl : merchant.logoUrl === null ? undefined : merchant.logoUrl;

  return {
    ...merchant,
    name: merchant.name ?? globalMerchant.name,
    logoUrl: appendLogoDevToken(resolvedLogoUrl),
    visualIdentityMode: merchant.visualIdentityMode ?? 'logo',
    iconName: merchant.iconName,
    iconColorId: merchant.iconColorId,
  };
}

/**
 * Helper function to populate a transaction with all relations
 */
export async function populateTransaction(
  ctx: QueryCtx,
  transaction: Doc<'transaction'>
): Promise<TransactionWithRelations> {
  // Get bank account
  const bankAccount = await ctx.db.get(transaction.bankAccountId);

  // Get bank link account if exists
  let bankLinkAccount: Doc<'bankLinkAccount'> | null = null;
  let bankLink: Doc<'bankLink'> | null = null;
  let globalInstitution: Doc<'globalInstitution'> | null = null;

  if (bankAccount?.bankLinkAccountId) {
    bankLinkAccount = await ctx.db.get(bankAccount.bankLinkAccountId);

    // Get bank link if bankLinkAccount exists
    if (bankLinkAccount?.bankLinkId) {
      bankLink = await ctx.db.get(bankLinkAccount.bankLinkId);

      // Get global institution through bankLink if it has a globalInstitutionId
      // Handle both new (globalInstitutionId) and legacy records
      if (bankLink?.globalInstitutionId) {
        globalInstitution = await ctx.db.get(bankLink.globalInstitutionId);
      }
    }
  }

  // Get merchant if exists and resolve overrides
  const merchantDoc = transaction.merchantId ? await ctx.db.get(transaction.merchantId) : null;
  const merchant = await resolveMerchant(ctx, merchantDoc);

  // Compute merchantName and merchantLogo - prefer merchant, fallback to importDetails
  const merchantName =
    merchant?.name ?? transaction.importDetails?.merchantName ?? transaction.importDetails?.originalStatement ?? null;
  const merchantLogo = merchant?.logoUrl ?? null;
  const merchantVisualIdentityMode = merchant?.visualIdentityMode ?? null;
  const merchantIconName = merchant?.iconName ?? null;
  const merchantIconColorId = merchant?.iconColorId ?? null;

  // Load movements from embedded array
  const movements = await populateTransactionMovements(ctx, transaction);

  // Note: If no movements exist, this indicates a data integrity issue.
  // We cannot create movements in a query context (only mutations can insert).
  // This should not happen in production, but if it does, the transaction
  // will be returned with an empty movements array.

  // Calculate transaction amount from movements
  const amount = calculateTransactionAmount(movements);

  // Get paired transaction's bank account name for transfers
  let transferPairAccountName: string | null = null;
  let transferPairAccountVisualIdentityMode: 'logo' | 'icon' | null = null;
  let transferPairAccountIconName: string | null = null;
  let transferPairAccountIconColorId: string | null = null;
  let isCreditCardPayment = false;
  let crossBudgetTransfer = false;
  if (transaction.type === 'transfer' && transaction.transferPairId) {
    const pairedTransaction = await ctx.db.get(transaction.transferPairId);
    if (pairedTransaction && !pairedTransaction.isDeleted) {
      const pairedBankAccount = await ctx.db.get(pairedTransaction.bankAccountId);
      transferPairAccountName = pairedBankAccount?.name ?? null;
      transferPairAccountVisualIdentityMode = pairedBankAccount?.visualIdentityMode ?? 'logo';
      transferPairAccountIconName = pairedBankAccount?.iconName ?? null;
      transferPairAccountIconColorId = pairedBankAccount?.iconColorId ?? null;
      // Check if this is a credit card payment transfer
      isCreditCardPayment = isCreditCardPaymentTransfer(bankAccount?.accountType, pairedBankAccount?.accountType);
      // Check if this is a cross-budget transfer
      crossBudgetTransfer = isCrossBudgetTransfer(bankAccount?.accountType, pairedBankAccount?.accountType);
    }
  }

  return {
    ...transaction,
    bankAccount: bankAccount
      ? {
          ...bankAccount,
          bankLinkAccount: bankLinkAccount
            ? {
                ...bankLinkAccount,
                bankLink,
              }
            : null,
          // Return as "institution" for frontend
          institution: globalInstitution
            ? {
                ...globalInstitution,
                logoUrl: appendLogoDevToken(globalInstitution.logoUrl),
              }
            : null,
        }
      : null,
    merchant,
    merchantName,
    merchantLogo,
    merchantVisualIdentityMode,
    merchantIconName,
    merchantIconColorId,
    movements,
    transferPairAccountName,
    transferPairAccountVisualIdentityMode,
    transferPairAccountIconName,
    transferPairAccountIconColorId,
    amount,
    isCreditCardPayment,
    isCrossBudgetTransfer: crossBudgetTransfer,
  };
}

/**
 * Validate that both accounts exist and belong to the same workspace
 */
export async function validateTransferAccounts(
  ctx: MutationCtx,
  fromAccountId: Id<'bankAccount'>,
  toAccountId: Id<'bankAccount'>,
  workspaceId: Id<'workspace'>
): Promise<void> {
  // Prevent transfer to same account
  if (fromAccountId === toAccountId) {
    throw new ConvexError('Cannot transfer to the same account');
  }

  // Validate from account
  const fromAccount = await ctx.db.get(fromAccountId);
  if (!fromAccount) {
    throw new ConvexError('Source account not found');
  }
  if (fromAccount.isDeleted) {
    throw new ConvexError('Source account has been deleted');
  }
  if (fromAccount.workspaceId !== workspaceId) {
    throw new ConvexError('Source account does not belong to this workspace');
  }

  // Validate to account
  const toAccount = await ctx.db.get(toAccountId);
  if (!toAccount) {
    throw new ConvexError('Destination account not found');
  }
  if (toAccount.isDeleted) {
    throw new ConvexError('Destination account has been deleted');
  }
  if (toAccount.workspaceId !== workspaceId) {
    throw new ConvexError('Destination account does not belong to this workspace');
  }
}

/**
 * Create a transfer pair: two linked transactions (one debit, one credit)
 * Returns the IDs of both created transactions
 * Note: Transfers do not support merchants
 */
export async function createTransferPair(
  ctx: MutationCtx,
  args: {
    fromAccountId: Id<'bankAccount'>;
    toAccountId: Id<'bankAccount'>;
    amount: bigint; // Positive number representing money transferred
    date: string;
    workspaceId: Id<'workspace'>;
    notes?: string;
    status?: 'pending' | 'cleared';
    categoryId?: Id<'category'>;
    readyToAssign?: boolean;
    // Defaults to 'reviewed' for the in-app create paths. Agent-driven paths (MCP / in-app chat)
    // pass 'needs_review' so the user sees the transfer in the review queue before it's final.
    reviewStatus?: 'reviewed' | 'needs_review';
    source?: Doc<'transaction'>['source'];
    scheduledTransactionId?: Id<'scheduledTransaction'>;
  }
): Promise<{
  fromTransactionId: Id<'transaction'>;
  toTransactionId: Id<'transaction'>;
}> {
  const { fromAccountId, toAccountId, amount, date, workspaceId, notes, status = 'cleared' } = args;
  const reviewStatus = args.reviewStatus ?? 'reviewed';
  const source = args.source ?? 'manual';

  // Validate amount is positive
  if (amount <= 0n) {
    throw new ConvexError('Transfer amount must be positive');
  }

  // Validate accounts
  await validateTransferAccounts(ctx, fromAccountId, toAccountId, workspaceId);

  // Look up account types to determine cross-budget status
  const fromAccount = await ctx.db.get(fromAccountId);
  const toAccount = await ctx.db.get(toAccountId);
  const fromAccountType = fromAccount?.accountType;
  const toAccountType = toAccount?.accountType;
  const isCrossBudget = isCrossBudgetTransfer(fromAccountType, toAccountType);

  // For cross-budget transfers, assign category only to the on-budget side
  const fromIsOnBudget = fromAccountType ? isOnBudgetAccountType(fromAccountType) : false;
  const crossBudgetCategoryId = args.categoryId;
  const crossBudgetReadyToAssign = args.readyToAssign ?? false;

  const now = new Date().toISOString();

  // Build embedded movements for both transactions
  const fromMovementsInput = [
    {
      categoryId: isCrossBudget && fromIsOnBudget ? crossBudgetCategoryId : undefined,
      readyToAssign: isCrossBudget && fromIsOnBudget ? crossBudgetReadyToAssign : false,
      amount: -amount,
      notes: undefined,
      sortOrder: 0,
    },
  ];

  const toMovementsInput = [
    {
      categoryId: isCrossBudget && !fromIsOnBudget ? crossBudgetCategoryId : undefined,
      readyToAssign: isCrossBudget && !fromIsOnBudget ? crossBudgetReadyToAssign : false,
      amount: amount,
      notes: undefined,
      sortOrder: 0,
    },
  ];

  // Build computed fields for both transactions
  const fromComputedFields = await buildTransactionComputedFields(ctx, {
    merchantId: undefined,
    bankAccountId: fromAccountId,
    transactionType: 'transfer',
    isCrossBudgetOnBudgetSide: isCrossBudget && fromIsOnBudget,
    movements: fromMovementsInput,
    notes,
  });

  const toComputedFields = await buildTransactionComputedFields(ctx, {
    merchantId: undefined,
    bankAccountId: toAccountId,
    transactionType: 'transfer',
    isCrossBudgetOnBudgetSide: isCrossBudget && !fromIsOnBudget,
    movements: toMovementsInput,
    notes,
  });

  // Create transaction on source account (negative amount)
  // Note: Transfers don't have merchants
  const fromTransactionId = await ctx.db.insert('transaction', {
    bankAccountId: fromAccountId,
    type: 'transfer',
    date,
    workspaceId,
    notes,
    merchantId: undefined,
    isDeleted: false,
    status,
    source,
    reviewStatus,
    scheduledTransactionId: args.scheduledTransactionId,
    dateYearMonth: dateToYearMonth(date),
    movements: fromComputedFields.movements,
    searchText: fromComputedFields.searchText,
    totalAmount: fromComputedFields.totalAmount,
    hasUncategorized: fromComputedFields.hasUncategorized,
    hasMissingPayee: fromComputedFields.hasMissingPayee,
    updatedAt: now,
  });

  // Create transaction on destination account (positive amount)
  // Note: Transfers don't have merchants
  const toTransactionId = await ctx.db.insert('transaction', {
    bankAccountId: toAccountId,
    type: 'transfer',
    date,
    workspaceId,
    notes,
    merchantId: undefined,
    isDeleted: false,
    status,
    source,
    reviewStatus,
    scheduledTransactionId: args.scheduledTransactionId,
    dateYearMonth: dateToYearMonth(date),
    movements: toComputedFields.movements,
    searchText: toComputedFields.searchText,
    totalAmount: toComputedFields.totalAmount,
    hasUncategorized: toComputedFields.hasUncategorized,
    hasMissingPayee: toComputedFields.hasMissingPayee,
    updatedAt: now,
  });

  // Link them together
  await ctx.db.patch(fromTransactionId, {
    transferPairId: toTransactionId,
    transferPairBankAccountId: toAccountId,
  });
  await ctx.db.patch(toTransactionId, {
    transferPairId: fromTransactionId,
    transferPairBankAccountId: fromAccountId,
  });

  // Note: CC payment side effects (creditCategorySpending) are handled by
  // reconcileTransactionSideEffects in the calling mutation, not here.

  return { fromTransactionId, toTransactionId };
}

// ============================================================================
// TRANSACTION PATCH HELPERS
// ============================================================================

/**
 * Helper to patch a transaction's movements with automatic searchText rebuilding.
 *
 * Use this helper whenever you need to update movements on a transaction.
 * It ensures that:
 * - categoryName is populated for each movement
 * - searchText is rebuilt with current merchant name and category names
 * - totalAmount, hasUncategorized, hasMissingPayee are recalculated
 *
 * This prevents bugs where searchText gets out of sync with the actual
 * category assignments (e.g., when recategorizing transactions during
 * category deletion).
 *
 * @param ctx - Mutation context
 * @param transactionId - ID of the transaction to update
 * @param transaction - Current transaction document (for reading existing fields)
 * @param newMovementsInput - New movements array (categoryId, amount, etc.)
 * @param options - Optional overrides for merchantId
 */
export async function patchTransactionMovements(
  ctx: MutationCtx,
  transactionId: Id<'transaction'>,
  transaction: Doc<'transaction'>,
  newMovementsInput: Array<{
    categoryId?: Id<'category'>;
    readyToAssign: boolean;
    amount: bigint;
    notes?: string;
    sortOrder: number;
    creditCardTransfer?: {
      creditCardCategoryId: Id<'category'>;
      spendingCategoryId: Id<'category'>;
    };
  }>,
  options?: {
    merchantId?: Id<'merchant'>;
  }
): Promise<void> {
  // Build computed fields (movements with categoryName, searchText, etc.)
  const computedFields = await buildTransactionComputedFields(ctx, {
    merchantId: options?.merchantId ?? transaction.merchantId,
    bankAccountId: transaction.bankAccountId,
    importDetails: transaction.importDetails,
    transactionType: transaction.type,
    movements: newMovementsInput,
    notes: transaction.notes,
  });

  // Patch the transaction with all computed fields
  await ctx.db.patch(transactionId, {
    movements: computedFields.movements,
    searchText: computedFields.searchText,
    totalAmount: computedFields.totalAmount,
    hasUncategorized: computedFields.hasUncategorized,
    hasMissingPayee: computedFields.hasMissingPayee,
    updatedAt: new Date().toISOString(),
  });
}
