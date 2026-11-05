import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { internalQuery } from '../_generated/server';
import { dateToYearMonth } from '../categoryBudgets/calculations';
import {
  computeHasMissingPayee,
  computeHasUncategorized,
  isCrossBudgetTransfer,
  isOnBudgetAccountType,
} from '../transactions/helpers';
import type {
  BankAccountBalanceIssue,
  BankAccountPendingClearedIssue,
  CategorySpendingIssue,
  CreditCardTransferMismatchIssue,
  CreditSpendingIssue,
  MerchantStatsIssue,
  MonthlyIncomeActivityIssue,
  MovementTotalIssue,
  RTAIssue,
  StartingBalanceRTAIssue,
  TransactionFlagIssue,
  ValidationIssue,
  ValidationSummary,
  WorkspaceValidationResult,
} from './types';
import { calculateCreditSpending, findCreditSpendingIssues } from './validators/creditSpending';

/**
 * Format cents as dollars for readable output
 */
function formatCents(cents: bigint): string {
  const dollars = Number(cents) / 100;
  return dollars.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/**
 * Format yearMonth (YYYYMM) as readable date
 */
function formatYearMonth(yearMonth: number): string {
  const year = Math.floor(yearMonth / 100);
  const month = yearMonth % 100;
  const date = new Date(year, month - 1);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
}

type Transaction = Doc<'transaction'>;
type Category = Doc<'category'>;
type BankAccount = Doc<'bankAccount'>;
type Merchant = Doc<'merchant'>;
type Workspace = Doc<'workspace'>;
type CategoryBudget = Doc<'categoryBudget'>;

/**
 * Optimized single-pass validation that queries all data once
 * This avoids the 8x data read issue of running separate validator queries
 */
export const validateWorkspaceOptimized = internalQuery({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }): Promise<WorkspaceValidationResult> => {
    const workspace = await ctx.db.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }

    // Fetch all data ONCE
    // Filter out deleted items to ensure validation only considers active data
    const [allTransactions, allCategories, allBankAccounts, allMerchants, allCategoryBudgets] = await Promise.all([
      ctx.db
        .query('transaction')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .collect(),
      ctx.db
        .query('category')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .collect(),
      ctx.db
        .query('bankAccount')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .filter((q) => q.neq(q.field('isDeleted'), true))
        .collect(),
      ctx.db
        .query('merchant')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .filter((q) => q.eq(q.field('isDeleted'), false))
        .collect(),
      ctx.db
        .query('categoryBudget')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .collect(),
    ]);

    // Run all validations with the pre-fetched data
    const categorySpendingIssues = validateCategorySpending(allTransactions, allCategories);
    const creditSpendingIssues = validateCreditSpending(allTransactions, allCategories, allBankAccounts);
    const creditCardTransferMismatchIssues = validateCreditCardTransferMismatch(allTransactions, allCategories);
    const merchantStatsIssues = validateMerchantStats(allTransactions, allMerchants, allBankAccounts);
    const rtaIssues = validateReadyToAssign(allTransactions, workspace, allBankAccounts, allCategoryBudgets);
    const monthlyIncomeIssues = validateMonthlyIncomeActivity(allTransactions, workspace, allBankAccounts);
    const transactionFlagIssues = validateTransactionFlags(allTransactions, allBankAccounts);
    const movementTotalIssues = validateMovementTotals(allTransactions);
    const bankAccountBalanceIssues = validateBankAccountBalances(allTransactions, allBankAccounts);
    const pendingClearedIssues = validateBankAccountPendingClearedBalance(allTransactions, allBankAccounts);
    const startingBalanceRTAIssues = validateStartingBalanceRTA(allTransactions, allBankAccounts);

    const allIssues: ValidationIssue[] = [
      ...categorySpendingIssues,
      ...creditSpendingIssues,
      ...creditCardTransferMismatchIssues,
      ...merchantStatsIssues,
      ...rtaIssues,
      ...monthlyIncomeIssues,
      ...transactionFlagIssues,
      ...movementTotalIssues,
      ...bankAccountBalanceIssues,
      ...pendingClearedIssues,
      ...startingBalanceRTAIssues,
    ];

    const summary: ValidationSummary = {
      categorySpendingIssues: categorySpendingIssues.length,
      creditSpendingIssues: creditSpendingIssues.length,
      creditCardTransferMismatchIssues: creditCardTransferMismatchIssues.length,
      merchantStatsIssues: merchantStatsIssues.length,
      rtaIssues: rtaIssues.length,
      monthlyIncomeIssues: monthlyIncomeIssues.length,
      transactionFlagIssues: transactionFlagIssues.length,
      movementTotalIssues: movementTotalIssues.length,
      transferPairIssues: 0, // Transfer pair validation not implemented in optimized version
      bankAccountBalanceIssues: bankAccountBalanceIssues.length,
      pendingClearedIssues: pendingClearedIssues.length,
      startingBalanceRTAIssues: startingBalanceRTAIssues.length,
      creditCardDebtIssues: 0, // Removed - available and debt don't need to match
      totalIssues: allIssues.length,
    };

    return {
      workspaceId,
      workspaceName: workspace.name ?? 'Unknown',
      isValid: allIssues.length === 0,
      issues: allIssues,
      summary,
      validatedAt: new Date().toISOString(),
    };
  },
});

// ============================================================================
// Pure validation functions that operate on pre-fetched data
// ============================================================================

function validateCategorySpending(transactions: Transaction[], categories: Category[]): CategorySpendingIssue[] {
  const issues: CategorySpendingIssue[] = [];

  // Calculate expected spending from transactions
  const calculatedSpending = new Map<string, Map<number, { inflowAmount: bigint; outflowAmount: bigint }>>();

  for (const transaction of transactions) {
    // Skip starting_balance and balance_adjustment (not real spending)
    if (transaction.type === 'starting_balance' || transaction.type === 'balance_adjustment') {
      continue;
    }

    const yearMonth = dateToYearMonth(transaction.date);

    for (const movement of transaction.movements ?? []) {
      if (!movement.categoryId) continue;
      // Note: We DO count movements with creditCardTransfer here because
      // the spending category's monthlySpending IS updated via moveMoneyBetweenCategories

      const categoryId = movement.categoryId.toString();
      if (!calculatedSpending.has(categoryId)) {
        calculatedSpending.set(categoryId, new Map());
      }

      const catSpending = calculatedSpending.get(categoryId)!;
      if (!catSpending.has(yearMonth)) {
        catSpending.set(yearMonth, { inflowAmount: 0n, outflowAmount: 0n });
      }

      const monthData = catSpending.get(yearMonth)!;
      if (movement.amount > 0n) {
        monthData.inflowAmount += movement.amount;
      } else {
        monthData.outflowAmount += -movement.amount;
      }
    }
  }

  // Compare with stored values
  for (const category of categories) {
    if (category.categoryType === 'credit_card') continue;

    const storedSpending = category.monthlySpending ?? {};
    const calcSpending = calculatedSpending.get(category._id.toString());

    // Check stored values
    for (const [yearMonthStr, stored] of Object.entries(storedSpending)) {
      const yearMonth = parseInt(yearMonthStr, 10);
      const calc = calcSpending?.get(yearMonth) ?? { inflowAmount: 0n, outflowAmount: 0n };

      if (stored.inflowAmount !== calc.inflowAmount) {
        issues.push({
          type: 'category_spending_mismatch',
          severity: 'error',
          description: `"${category.name}" ${formatYearMonth(yearMonth)}: Inflow mismatch. Stored: ${formatCents(stored.inflowAmount)}, Expected: ${formatCents(calc.inflowAmount)}`,
          categoryId: category._id,
          categoryName: category.name,
          yearMonth,
          field: 'inflowAmount',
          stored: stored.inflowAmount,
          expected: calc.inflowAmount,
        });
      }

      if (stored.outflowAmount !== calc.outflowAmount) {
        issues.push({
          type: 'category_spending_mismatch',
          severity: 'error',
          description: `"${category.name}" ${formatYearMonth(yearMonth)}: Outflow mismatch. Stored: ${formatCents(stored.outflowAmount)}, Expected: ${formatCents(calc.outflowAmount)}`,
          categoryId: category._id,
          categoryName: category.name,
          yearMonth,
          field: 'outflowAmount',
          stored: stored.outflowAmount,
          expected: calc.outflowAmount,
        });
      }
    }

    // Check for missing entries
    if (calcSpending) {
      for (const [yearMonth, calc] of calcSpending.entries()) {
        const stored = storedSpending[yearMonth.toString()];
        if (!stored && (calc.inflowAmount !== 0n || calc.outflowAmount !== 0n)) {
          // Report as separate inflow/outflow issues
          if (calc.inflowAmount !== 0n) {
            issues.push({
              type: 'category_spending_mismatch',
              severity: 'error',
              description: `"${category.name}" ${formatYearMonth(yearMonth)}: Missing spending record. Expected inflow: ${formatCents(calc.inflowAmount)}`,
              categoryId: category._id,
              categoryName: category.name,
              yearMonth,
              field: 'inflowAmount',
              stored: 0n,
              expected: calc.inflowAmount,
            });
          }
          if (calc.outflowAmount !== 0n) {
            issues.push({
              type: 'category_spending_mismatch',
              severity: 'error',
              description: `"${category.name}" ${formatYearMonth(yearMonth)}: Missing spending record. Expected outflow: ${formatCents(calc.outflowAmount)}`,
              categoryId: category._id,
              categoryName: category.name,
              yearMonth,
              field: 'outflowAmount',
              stored: 0n,
              expected: calc.outflowAmount,
            });
          }
        }
      }
    }
  }

  return issues;
}

function validateCreditSpending(
  transactions: Transaction[],
  categories: Category[],
  bankAccounts: BankAccount[]
): CreditSpendingIssue[] {
  return findCreditSpendingIssues(categories, calculateCreditSpending(transactions, categories, bankAccounts));
}

function validateCreditCardTransferMismatch(
  transactions: Transaction[],
  categories: Category[]
): CreditCardTransferMismatchIssue[] {
  const issues: CreditCardTransferMismatchIssue[] = [];

  // Get all credit card categories
  const creditCardCategories = categories.filter((c) => c.categoryType === 'credit_card');

  // Build a map from bankAccountId to credit card category
  const bankAccountToCategoryMap = new Map<string, Category>();
  for (const category of creditCardCategories) {
    if (category.bankAccountId) {
      bankAccountToCategoryMap.set(category.bankAccountId.toString(), category);
    }
  }

  // Check each non-transfer transaction
  const nonTransferTransactions = transactions.filter((tx) => tx.type !== 'transfer');

  for (const transaction of nonTransferTransactions) {
    // Get the expected credit card category for this transaction's bank account
    const expectedCategory = bankAccountToCategoryMap.get(transaction.bankAccountId.toString());

    // If this transaction's bank account is not a credit card, skip it
    if (!expectedCategory) continue;

    // Check each movement
    for (let i = 0; i < (transaction.movements ?? []).length; i++) {
      const movement = transaction.movements![i];

      if (!movement.creditCardTransfer) continue;

      // Check if the creditCardTransfer points to the correct category
      if (movement.creditCardTransfer.creditCardCategoryId !== expectedCategory._id) {
        // Find the current category for better error messages
        const currentCategory = creditCardCategories.find(
          (c) => c._id === movement.creditCardTransfer!.creditCardCategoryId
        );

        issues.push({
          type: 'credit_card_transfer_mismatch',
          severity: 'error',
          description: `Transaction movement has wrong credit card category. Current: "${currentCategory?.name ?? 'Unknown'}", Expected: "${expectedCategory.name}" (based on transaction's bank account)`,
          transactionId: transaction._id,
          movementIndex: i,
          currentCreditCardCategoryId: movement.creditCardTransfer.creditCardCategoryId,
          expectedCreditCardCategoryId: expectedCategory._id,
          bankAccountId: transaction.bankAccountId,
        });
      }
    }
  }

  return issues;
}

function validateMerchantStats(
  transactions: Transaction[],
  merchants: Merchant[],
  bankAccounts: BankAccount[]
): MerchantStatsIssue[] {
  const issues: MerchantStatsIssue[] = [];

  // Build bank account type map to identify off-budget accounts
  const bankAccountTypeMap = new Map(bankAccounts.map((a) => [a._id, a.accountType]));

  // Calculate expected stats from transactions
  const calculatedStats = new Map<
    string,
    Map<
      string,
      {
        transactionCount: bigint;
        totalAmount: bigint;
        inflowAmount: bigint;
        outflowAmount: bigint;
        inflowCount: bigint;
        outflowCount: bigint;
      }
    >
  >();

  for (const transaction of transactions) {
    if (!transaction.merchantId) continue;

    // Skip off-budget transactions (loans, investments) — they don't count as merchant spending
    const accountType = bankAccountTypeMap.get(transaction.bankAccountId);
    if (accountType && !isOnBudgetAccountType(accountType)) continue;

    const merchantId = transaction.merchantId.toString();
    const yearMonth = dateToYearMonth(transaction.date).toString();
    const amount = transaction.totalAmount ?? transaction.movements?.reduce((sum, m) => sum + m.amount, 0n) ?? 0n;

    if (!calculatedStats.has(merchantId)) {
      calculatedStats.set(merchantId, new Map());
    }

    const merchantStats = calculatedStats.get(merchantId)!;
    if (!merchantStats.has(yearMonth)) {
      merchantStats.set(yearMonth, {
        transactionCount: 0n,
        totalAmount: 0n,
        inflowAmount: 0n,
        outflowAmount: 0n,
        inflowCount: 0n,
        outflowCount: 0n,
      });
    }

    const stats = merchantStats.get(yearMonth)!;
    stats.transactionCount += 1n;
    stats.totalAmount += amount;
    if (amount > 0n) {
      stats.inflowAmount += amount;
      stats.inflowCount += 1n;
    } else if (amount < 0n) {
      stats.outflowAmount += -amount;
      stats.outflowCount += 1n;
    }
  }

  // Compare with stored values
  for (const merchant of merchants) {
    const storedStats = merchant.monthlyStats ?? {};
    const storedDirectionalStats = merchant.monthlyDirectionalStats ?? {};
    const calcStats = calculatedStats.get(merchant._id.toString());
    const merchantName = merchant.name ?? 'Unknown';
    const yearMonths = new Set([
      ...Object.keys(storedStats),
      ...Object.keys(storedDirectionalStats),
      ...(calcStats?.keys() ?? []),
    ]);

    for (const yearMonthStr of yearMonths) {
      const stored = storedStats[yearMonthStr] ?? { transactionCount: 0n, totalAmount: 0n };
      const storedDirectional = storedDirectionalStats[yearMonthStr] ?? {
        inflowAmount: 0n,
        outflowAmount: 0n,
        inflowCount: 0n,
        outflowCount: 0n,
      };
      const calc = calcStats?.get(yearMonthStr) ?? {
        transactionCount: 0n,
        totalAmount: 0n,
        inflowAmount: 0n,
        outflowAmount: 0n,
        inflowCount: 0n,
        outflowCount: 0n,
      };
      const yearMonth = parseInt(yearMonthStr, 10);

      const values = {
        transactionCount: { stored: stored.transactionCount, expected: calc.transactionCount },
        totalAmount: { stored: stored.totalAmount, expected: calc.totalAmount },
        inflowAmount: { stored: storedDirectional.inflowAmount, expected: calc.inflowAmount },
        outflowAmount: { stored: storedDirectional.outflowAmount, expected: calc.outflowAmount },
        inflowCount: { stored: storedDirectional.inflowCount, expected: calc.inflowCount },
        outflowCount: { stored: storedDirectional.outflowCount, expected: calc.outflowCount },
      };

      for (const [field, value] of Object.entries(values) as [
        MerchantStatsIssue['field'],
        { stored: bigint; expected: bigint },
      ][]) {
        if (value.stored !== value.expected) {
          issues.push({
            type: 'merchant_stats_mismatch',
            severity: 'warning',
            description: `Merchant "${merchantName}" ${formatYearMonth(yearMonth)}: ${field} mismatch. Stored: ${value.stored}, Expected: ${value.expected}`,
            merchantId: merchant._id,
            merchantName,
            yearMonth,
            field,
            stored: value.stored,
            expected: value.expected,
          });
        }
      }
    }
  }

  return issues;
}

function validateReadyToAssign(
  transactions: Transaction[],
  workspace: Workspace,
  bankAccounts: BankAccount[],
  categoryBudgets: CategoryBudget[]
): RTAIssue[] {
  const issues: RTAIssue[] = [];

  // Build bank account map to check account types
  const bankAccountMap = new Map(bankAccounts.map((a) => [a._id.toString(), a]));

  // Calculate total income from RTA movements
  // Only banking accounts (checking, savings, cash) contribute to RTA
  let totalIncome = 0n;
  let uncategorizedInflows = 0n;
  let uncategorizedOutflows = 0n;

  for (const transaction of transactions) {
    // Get the bank account for this transaction
    const bankAccount = bankAccountMap.get(transaction.bankAccountId.toString());
    if (!bankAccount) continue;

    // Skip credit card, loan, and investment accounts
    const isExcludedFromRTA =
      bankAccount.accountType?.startsWith('credit_') ||
      bankAccount.accountType?.startsWith('loan_') ||
      bankAccount.accountType?.startsWith('investment_');
    if (isExcludedFromRTA) continue;

    for (const movement of transaction.movements ?? []) {
      if (movement.readyToAssign) {
        totalIncome += movement.amount;
        if (movement.amount > 0n) {
          uncategorizedInflows += movement.amount;
        } else {
          uncategorizedOutflows += -movement.amount;
        }
      }
    }
  }

  // Calculate total assigned from category budgets
  let totalAssigned = 0n;
  for (const budget of categoryBudgets) {
    const monthlyAmounts = budget.monthlyAssignedAmounts ?? {};
    for (const amount of Object.values(monthlyAmounts)) {
      totalAssigned += amount;
    }
  }

  // RTA = totalIncome - totalAssigned
  const calculatedRTA = totalIncome - totalAssigned;
  const storedRTA = workspace.readyToAssign ?? 0n;

  if (storedRTA !== calculatedRTA) {
    issues.push({
      type: 'ready_to_assign_mismatch',
      severity: 'error',
      description: `Ready to Assign mismatch. Stored: ${formatCents(storedRTA)}, Expected: ${formatCents(calculatedRTA)} (diff: ${formatCents(storedRTA - calculatedRTA)})`,
      stored: storedRTA,
      expected: calculatedRTA,
      breakdown: {
        uncategorizedInflows,
        uncategorizedOutflows,
        budgetAssignments: totalAssigned,
        netUncategorized: uncategorizedInflows - uncategorizedOutflows,
      },
    });
  }

  return issues;
}

function validateMonthlyIncomeActivity(
  transactions: Transaction[],
  workspace: Workspace,
  bankAccounts: BankAccount[]
): MonthlyIncomeActivityIssue[] {
  const issues: MonthlyIncomeActivityIssue[] = [];

  // Build bank account map to check account types
  const bankAccountMap = new Map(bankAccounts.map((a) => [a._id.toString(), a]));

  // Calculate monthly income activity from RTA movements
  // Exclude:
  // - starting_balance and balance_adjustment transactions (not actual income)
  // - credit card, loan, and investment accounts (only banking accounts affect income tracking)
  const calculatedActivity = new Map<string, { inflowAmount: bigint; outflowAmount: bigint }>();

  for (const transaction of transactions) {
    // Skip non-income transaction types
    if (transaction.type === 'starting_balance' || transaction.type === 'balance_adjustment') {
      continue;
    }

    // Get the bank account for this transaction
    const bankAccount = bankAccountMap.get(transaction.bankAccountId.toString());
    if (!bankAccount) continue;

    // Skip credit card, loan, and investment accounts
    const isExcludedFromRTA =
      bankAccount.accountType?.startsWith('credit_') ||
      bankAccount.accountType?.startsWith('loan_') ||
      bankAccount.accountType?.startsWith('investment_');
    if (isExcludedFromRTA) continue;

    const yearMonth = dateToYearMonth(transaction.date).toString();

    for (const movement of transaction.movements ?? []) {
      if (!movement.readyToAssign) continue;

      if (!calculatedActivity.has(yearMonth)) {
        calculatedActivity.set(yearMonth, { inflowAmount: 0n, outflowAmount: 0n });
      }

      const monthData = calculatedActivity.get(yearMonth)!;
      if (movement.amount > 0n) {
        monthData.inflowAmount += movement.amount;
      } else {
        monthData.outflowAmount += -movement.amount;
      }
    }
  }

  const storedActivity = workspace.monthlyIncomeActivity ?? {};

  // Compare stored vs calculated
  for (const [yearMonth, stored] of Object.entries(storedActivity)) {
    const calc = calculatedActivity.get(yearMonth) ?? { inflowAmount: 0n, outflowAmount: 0n };

    if (stored.inflowAmount !== calc.inflowAmount) {
      issues.push({
        type: 'monthly_income_activity_mismatch',
        severity: 'error',
        description: `${formatYearMonth(parseInt(yearMonth))}: Income inflow mismatch. Stored: ${formatCents(stored.inflowAmount)}, Expected: ${formatCents(calc.inflowAmount)}`,
        yearMonth,
        field: 'inflowAmount',
        stored: stored.inflowAmount,
        expected: calc.inflowAmount,
      });
    }

    if (stored.outflowAmount !== calc.outflowAmount) {
      issues.push({
        type: 'monthly_income_activity_mismatch',
        severity: 'error',
        description: `${formatYearMonth(parseInt(yearMonth))}: Income outflow mismatch. Stored: ${formatCents(stored.outflowAmount)}, Expected: ${formatCents(calc.outflowAmount)}`,
        yearMonth,
        field: 'outflowAmount',
        stored: stored.outflowAmount,
        expected: calc.outflowAmount,
      });
    }
  }

  return issues;
}

function validateTransactionFlags(transactions: Transaction[], bankAccounts: BankAccount[]): TransactionFlagIssue[] {
  const issues: TransactionFlagIssue[] = [];

  // Build a map of bank account types for cross-budget detection
  const bankAccountTypeMap = new Map<string, string>();
  for (const account of bankAccounts) {
    bankAccountTypeMap.set(account._id, account.accountType);
  }

  for (const transaction of transactions) {
    const movements = transaction.movements ?? [];

    // Determine cross-budget on-budget side for transfers
    let isCrossBudgetOnBudgetSide: boolean | undefined;
    if (transaction.type === 'transfer' && transaction.transferPairBankAccountId) {
      const accountType = bankAccountTypeMap.get(transaction.bankAccountId);
      const pairAccountType = bankAccountTypeMap.get(transaction.transferPairBankAccountId);
      if (accountType && pairAccountType && isCrossBudgetTransfer(accountType, pairAccountType)) {
        isCrossBudgetOnBudgetSide = isOnBudgetAccountType(accountType);
      }
    }

    // Determine if account is off-budget
    const txAccountType = bankAccountTypeMap.get(transaction.bankAccountId);
    const isOffBudgetAccount = txAccountType ? !isOnBudgetAccountType(txAccountType) : false;

    const expectedHasUncategorized = computeHasUncategorized(
      movements,
      transaction.type,
      isCrossBudgetOnBudgetSide,
      isOffBudgetAccount
    );
    const expectedHasMissingPayee = computeHasMissingPayee(transaction.merchantId, transaction.type);

    if (transaction.hasUncategorized !== expectedHasUncategorized) {
      issues.push({
        type: 'transaction_flag_incorrect',
        severity: 'warning',
        description: `Transaction ${transaction._id}: hasUncategorized flag incorrect. Stored: ${transaction.hasUncategorized}, Expected: ${expectedHasUncategorized}`,
        transactionId: transaction._id,
        flag: 'hasUncategorized',
        stored: transaction.hasUncategorized,
        expected: expectedHasUncategorized,
      });
    }

    if (transaction.hasMissingPayee !== expectedHasMissingPayee) {
      issues.push({
        type: 'transaction_flag_incorrect',
        severity: 'warning',
        description: `Transaction ${transaction._id}: hasMissingPayee flag incorrect. Stored: ${transaction.hasMissingPayee}, Expected: ${expectedHasMissingPayee}`,
        transactionId: transaction._id,
        flag: 'hasMissingPayee',
        stored: transaction.hasMissingPayee,
        expected: expectedHasMissingPayee,
      });
    }
  }

  return issues;
}

function validateMovementTotals(transactions: Transaction[]): MovementTotalIssue[] {
  const issues: MovementTotalIssue[] = [];

  for (const transaction of transactions) {
    const movements = transaction.movements ?? [];
    const calculatedSum = movements.reduce((sum, m) => sum + m.amount, 0n);
    const storedTotal = transaction.totalAmount ?? 0n;

    if (storedTotal !== calculatedSum) {
      issues.push({
        type: 'movement_total_mismatch',
        severity: 'error',
        description: `Transaction ${transaction._id}: totalAmount mismatch. Stored: ${formatCents(storedTotal)}, Calculated: ${formatCents(calculatedSum)}`,
        transactionId: transaction._id,
        storedTotal,
        calculatedSum,
      });
    }
  }

  return issues;
}

function validateBankAccountBalances(
  transactions: Transaction[],
  bankAccounts: BankAccount[]
): BankAccountBalanceIssue[] {
  const issues: BankAccountBalanceIssue[] = [];

  // Calculate expected balances and transaction counts from transactions
  const calculatedBalances = new Map<string, { balance: bigint; count: number }>();

  for (const transaction of transactions) {
    const accountId = transaction.bankAccountId.toString();
    const amount = transaction.totalAmount ?? transaction.movements?.reduce((sum, m) => sum + m.amount, 0n) ?? 0n;

    const current = calculatedBalances.get(accountId) ?? { balance: 0n, count: 0 };
    calculatedBalances.set(accountId, {
      balance: current.balance + amount,
      count: current.count + 1,
    });
  }

  // Compare with stored values
  for (const account of bankAccounts) {
    const stored = account.currentBalance ?? 0n;
    const calculated = calculatedBalances.get(account._id.toString()) ?? { balance: 0n, count: 0 };

    if (stored !== calculated.balance) {
      issues.push({
        type: 'bank_account_balance_mismatch',
        severity: 'error',
        description: `Account "${account.name}": Balance mismatch. Stored: ${formatCents(stored)}, Expected: ${formatCents(calculated.balance)} (diff: ${formatCents(stored - calculated.balance)})`,
        bankAccountId: account._id,
        accountName: account.name,
        stored,
        expected: calculated.balance,
        transactionCount: calculated.count,
      });
    }
  }

  return issues;
}

function validateBankAccountPendingClearedBalance(
  transactions: Transaction[],
  bankAccounts: BankAccount[]
): BankAccountPendingClearedIssue[] {
  const issues: BankAccountPendingClearedIssue[] = [];

  // Calculate expected pending and cleared balances from transactions
  const calculatedBalances = new Map<string, { pending: bigint; cleared: bigint }>();

  for (const transaction of transactions) {
    const accountId = transaction.bankAccountId.toString();
    const amount = transaction.totalAmount ?? transaction.movements?.reduce((sum, m) => sum + m.amount, 0n) ?? 0n;

    const current = calculatedBalances.get(accountId) ?? { pending: 0n, cleared: 0n };
    if (transaction.status === 'pending') {
      current.pending += amount;
    } else {
      // 'cleared' and 'reconciled' both count as cleared
      current.cleared += amount;
    }
    calculatedBalances.set(accountId, current);
  }

  for (const account of bankAccounts) {
    const storedPending = account.pendingBalance ?? 0n;
    const storedCleared = account.clearedBalance ?? 0n;
    const storedTotal = account.currentBalance ?? 0n;

    // Check 1: Invariant - currentBalance === pendingBalance + clearedBalance
    if (storedTotal !== storedPending + storedCleared) {
      issues.push({
        type: 'bank_account_pending_cleared_mismatch',
        severity: 'error',
        description: `Account "${account.name}": Invariant violated. Total ${formatCents(storedTotal)} !== Pending ${formatCents(storedPending)} + Cleared ${formatCents(storedCleared)} (sum: ${formatCents(storedPending + storedCleared)})`,
        bankAccountId: account._id,
        accountName: account.name,
        field: 'invariant',
        stored: storedTotal,
        expected: storedPending + storedCleared,
      });
    }

    const calculated = calculatedBalances.get(account._id.toString()) ?? { pending: 0n, cleared: 0n };

    // Check 2: pendingBalance matches sum of pending transactions
    if (storedPending !== calculated.pending) {
      issues.push({
        type: 'bank_account_pending_cleared_mismatch',
        severity: 'error',
        description: `Account "${account.name}": Pending balance mismatch. Stored: ${formatCents(storedPending)}, Expected: ${formatCents(calculated.pending)} (diff: ${formatCents(storedPending - calculated.pending)})`,
        bankAccountId: account._id,
        accountName: account.name,
        field: 'pendingBalance',
        stored: storedPending,
        expected: calculated.pending,
      });
    }

    // Check 3: clearedBalance matches sum of cleared/reconciled transactions
    if (storedCleared !== calculated.cleared) {
      issues.push({
        type: 'bank_account_pending_cleared_mismatch',
        severity: 'error',
        description: `Account "${account.name}": Cleared balance mismatch. Stored: ${formatCents(storedCleared)}, Expected: ${formatCents(calculated.cleared)} (diff: ${formatCents(storedCleared - calculated.cleared)})`,
        bankAccountId: account._id,
        accountName: account.name,
        field: 'clearedBalance',
        stored: storedCleared,
        expected: calculated.cleared,
      });
    }
  }

  return issues;
}

function validateStartingBalanceRTA(
  transactions: Transaction[],
  bankAccounts: BankAccount[]
): StartingBalanceRTAIssue[] {
  const issues: StartingBalanceRTAIssue[] = [];

  // Filter to only banking accounts (checking, savings, cash)
  const bankingAccounts = bankAccounts.filter(
    (a) => !a.isDeleted && !a.isClosed && a.accountType.startsWith('banking_')
  );

  for (const account of bankingAccounts) {
    // Find starting_balance transaction for this account
    const startingBalanceTx = transactions.find(
      (t) => t.bankAccountId.toString() === account._id.toString() && t.type === 'starting_balance'
    );

    if (!startingBalanceTx) continue;

    // Check if movements have readyToAssign: true
    const movements = startingBalanceTx.movements ?? [];
    let hasMissingRTA = false;
    let missingAmount = 0n;

    for (const movement of movements) {
      if (movement.readyToAssign !== true) {
        hasMissingRTA = true;
        missingAmount += movement.amount;
      }
    }

    if (hasMissingRTA) {
      issues.push({
        type: 'starting_balance_rta_missing',
        severity: 'error',
        description: `Starting balance for "${account.name}" not marked as readyToAssign. Missing: ${formatCents(missingAmount)}`,
        accountId: account._id,
        accountName: account.name,
        transactionId: startingBalanceTx._id,
        missingAmount,
      });
    }
  }

  return issues;
}
