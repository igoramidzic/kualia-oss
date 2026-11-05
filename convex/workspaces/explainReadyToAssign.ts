import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import { internalQuery } from '../_generated/server';
import {
  calculateBudgetCarryoverChain,
  calculateCreditCardCarryoverChain,
  getNextYearMonth,
  type CreditCardMonthInput,
  type MonthBudgetInput,
} from '../categoryBudgets/calculations';

/**
 * Explain how the Ready-to-Assign (RTA) amount is calculated for a workspace.
 * Internal query for dashboard use - no authentication required.
 *
 * Formula: readyToAssign = netUncategorized - totalBudgetAssignments
 *
 * Accepts workspace ID or userProfile ID.
 */
export const explainReadyToAssign = internalQuery({
  args: {
    workspaceId: v.string(),
  },
  handler: async (ctx, { workspaceId: inputId }) => {
    // Try to get as workspace first
    let workspace = await ctx.db.get(inputId as Id<'workspace'>);

    // Also try looking up by userProfile's activeWorkspaceId
    if (!workspace) {
      const userProfile = await ctx.db.get(inputId as Id<'userProfile'>);
      if (userProfile?.activeWorkspaceId) {
        workspace = await ctx.db.get(userProfile.activeWorkspaceId);
      }
    }

    if (!workspace) {
      throw new ConvexError('Workspace not found. Pass a workspace or userProfile ID.');
    }

    const workspaceId = workspace._id;

    // Get all non-deleted transactions
    const allTransactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Get all bank accounts to check account types (exclude deleted accounts)
    const bankAccounts = await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.neq(q.field('isDeleted'), true))
      .collect();
    const bankAccountMap = new Map(bankAccounts.map((a) => [a._id.toString(), a]));

    // Get all categories for names
    const categories = await ctx.db
      .query('category')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .collect();
    const categoryMap = new Map(categories.map((c) => [c._id.toString(), c]));

    // Track RTA movements by account
    const inflowsByAccount: Record<string, { name: string; type: string; total: bigint; count: number }> = {};
    const outflowsByAccount: Record<string, { name: string; type: string; total: bigint; count: number }> = {};
    const excludedByAccount: Record<string, { name: string; type: string; total: bigint; count: number }> = {};

    let totalInflows = 0n;
    let totalOutflows = 0n;
    let totalExcluded = 0n;

    for (const transaction of allTransactions) {
      const bankAccount = bankAccountMap.get(transaction.bankAccountId.toString());
      if (!bankAccount) continue;

      const accountKey = bankAccount._id.toString();
      // Only banking accounts (checking, savings, cash) contribute to RTA
      // Credit cards, loans, and investments are excluded
      const isExcludedFromRTA =
        bankAccount.accountType.startsWith('credit_') ||
        bankAccount.accountType.startsWith('loan_') ||
        bankAccount.accountType.startsWith('investment_');

      for (const movement of transaction.movements ?? []) {
        if (!movement.readyToAssign) continue;

        if (isExcludedFromRTA) {
          // Track excluded movements
          if (!excludedByAccount[accountKey]) {
            excludedByAccount[accountKey] = {
              name: bankAccount.name,
              type: bankAccount.accountType,
              total: 0n,
              count: 0,
            };
          }
          excludedByAccount[accountKey].total += movement.amount;
          excludedByAccount[accountKey].count++;
          totalExcluded += movement.amount;
        } else if (movement.amount > 0n) {
          // Inflow
          if (!inflowsByAccount[accountKey]) {
            inflowsByAccount[accountKey] = {
              name: bankAccount.name,
              type: bankAccount.accountType,
              total: 0n,
              count: 0,
            };
          }
          inflowsByAccount[accountKey].total += movement.amount;
          inflowsByAccount[accountKey].count++;
          totalInflows += movement.amount;
        } else if (movement.amount < 0n) {
          // Outflow
          if (!outflowsByAccount[accountKey]) {
            outflowsByAccount[accountKey] = {
              name: bankAccount.name,
              type: bankAccount.accountType,
              total: 0n,
              count: 0,
            };
          }
          outflowsByAccount[accountKey].total += movement.amount;
          outflowsByAccount[accountKey].count++;
          totalOutflows += movement.amount;
        }
      }
    }

    const netUncategorized = totalInflows + totalOutflows;

    // Get all category budgets
    const allBudgets = await ctx.db
      .query('categoryBudget')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .collect();

    // Sum budget assignments by category
    const assignmentsByCategory: Record<string, { name: string; total: bigint; monthCount: number }> = {};
    let totalBudgetAssigned = 0n;

    for (const budget of allBudgets) {
      const category = categoryMap.get(budget.categoryId.toString());
      const categoryName = category?.name ?? 'Unknown';
      const monthlyAmounts = budget.monthlyAssignedAmounts ?? {};

      const monthEntries = Object.entries(monthlyAmounts);
      if (monthEntries.length === 0) continue;

      const categoryTotal = monthEntries.reduce((sum, [, amount]) => sum + amount, 0n);

      assignmentsByCategory[budget.categoryId] = {
        name: categoryName,
        total: categoryTotal,
        monthCount: monthEntries.length,
      };
      totalBudgetAssigned += categoryTotal;
    }

    // Calculate expected RTA
    const expectedRTA = netUncategorized - totalBudgetAssigned;
    const storedRTA = workspace.readyToAssign ?? 0n;
    const drift = storedRTA - expectedRTA;

    // ===== BUDGET EQUATION CHECK =====
    // Calculate sum of all category available amounts for the current month
    // Expected relationship: bankingBalance = RTA + sum(categoryAvailable)

    // Determine current month (use today's date)
    const today = new Date();
    const currentYearMonth = today.getFullYear() * 100 + (today.getMonth() + 1);

    // Find earliest month with budget data to start carryover chain
    let earliestBudgetMonth: number | null = null;
    for (const budget of allBudgets) {
      const monthlyAmounts = budget.monthlyAssignedAmounts ?? {};
      for (const yearMonthStr of Object.keys(monthlyAmounts)) {
        const yearMonth = parseInt(yearMonthStr, 10);
        if (earliestBudgetMonth === null || yearMonth < earliestBudgetMonth) {
          earliestBudgetMonth = yearMonth;
        }
      }
    }

    // Also check spending data for earliest month
    for (const category of categories) {
      const monthlySpending = category.monthlySpending ?? {};
      for (const yearMonthStr of Object.keys(monthlySpending)) {
        const yearMonth = parseInt(yearMonthStr, 10);
        if (earliestBudgetMonth === null || yearMonth < earliestBudgetMonth) {
          earliestBudgetMonth = yearMonth;
        }
      }
      // Check credit card spending too
      if (category.categoryType === 'credit_card') {
        const creditMonthlySpending = category.creditMonthlySpending ?? {};
        for (const yearMonthStr of Object.keys(creditMonthlySpending)) {
          const yearMonth = parseInt(yearMonthStr, 10);
          if (earliestBudgetMonth === null || yearMonth < earliestBudgetMonth) {
            earliestBudgetMonth = yearMonth;
          }
        }
      }
    }

    // Default to current month if no data
    const startMonth = earliestBudgetMonth ?? currentYearMonth;

    // Build lookup maps for budget data
    const budgetMap = new Map<string, Map<number, bigint>>();
    for (const budget of allBudgets) {
      const monthlyAmounts = budget.monthlyAssignedAmounts ?? {};
      const categoryBudgetMap = new Map<number, bigint>();
      for (const [yearMonthStr, amount] of Object.entries(monthlyAmounts)) {
        const yearMonth = parseInt(yearMonthStr, 10);
        categoryBudgetMap.set(yearMonth, amount);
      }
      if (categoryBudgetMap.size > 0) {
        budgetMap.set(budget.categoryId.toString(), categoryBudgetMap);
      }
    }

    // Build spending maps from categories
    const spendingMap = new Map<string, Map<number, { inflowAmount: bigint; outflowAmount: bigint }>>();
    const creditSpendingMap = new Map<
      string,
      Map<number, { priorBalance: bigint; spendingAmount: bigint; paymentsAmount: bigint; refundedSpending: bigint }>
    >();

    for (const category of categories) {
      // Regular spending
      const monthlySpending = category.monthlySpending ?? {};
      const categorySpendingMap = new Map<number, { inflowAmount: bigint; outflowAmount: bigint }>();
      for (const [yearMonthStr, spending] of Object.entries(monthlySpending)) {
        const yearMonth = parseInt(yearMonthStr, 10);
        categorySpendingMap.set(yearMonth, spending);
      }
      if (categorySpendingMap.size > 0) {
        spendingMap.set(category._id.toString(), categorySpendingMap);
      }

      // Credit card spending
      if (category.categoryType === 'credit_card') {
        const creditMonthlySpending = category.creditMonthlySpending ?? {};
        const categoryCreditSpendingMap = new Map<
          number,
          { priorBalance: bigint; spendingAmount: bigint; paymentsAmount: bigint; refundedSpending: bigint }
        >();
        for (const [yearMonthStr, spending] of Object.entries(creditMonthlySpending)) {
          const yearMonth = parseInt(yearMonthStr, 10);
          categoryCreditSpendingMap.set(yearMonth, spending);
        }
        if (categoryCreditSpendingMap.size > 0) {
          creditSpendingMap.set(category._id.toString(), categoryCreditSpendingMap);
        }
      }
    }

    // Helper function to calculate category available for current month
    const calculateCategoryAvailable = (category: Doc<'category'>): bigint => {
      const isCreditCard = category.categoryType === 'credit_card';
      const categoryBudgets = budgetMap.get(category._id.toString());

      if (isCreditCard) {
        const categoryCreditSpending = creditSpendingMap.get(category._id.toString());
        const monthInputs: CreditCardMonthInput[] = [];
        let currentMonth = startMonth;

        while (currentMonth <= currentYearMonth) {
          const assignedAmount = categoryBudgets?.get(currentMonth) ?? 0n;
          const spending = categoryCreditSpending?.get(currentMonth);

          monthInputs.push({
            yearMonth: currentMonth,
            assignedAmount,
            priorBalance: spending?.priorBalance ?? 0n,
            spendingAmount: spending?.spendingAmount ?? 0n,
            paymentsAmount: spending?.paymentsAmount ?? 0n,
            refundedSpending: spending?.refundedSpending ?? 0n,
          });

          currentMonth = getNextYearMonth(currentMonth);
        }

        if (monthInputs.length === 0) return 0n;

        const results = calculateCreditCardCarryoverChain(monthInputs, 0n, 0n);
        const lastResult = results[results.length - 1];
        return lastResult?.available ?? 0n;
      } else {
        const categorySpending = spendingMap.get(category._id.toString());
        const monthInputs: MonthBudgetInput[] = [];
        let currentMonth = startMonth;

        while (currentMonth <= currentYearMonth) {
          const assignedAmount = categoryBudgets?.get(currentMonth) ?? 0n;
          const spending = categorySpending?.get(currentMonth);

          monthInputs.push({
            yearMonth: currentMonth,
            assignedAmount,
            inflowAmount: spending?.inflowAmount ?? 0n,
            outflowAmount: spending?.outflowAmount ?? 0n,
          });

          currentMonth = getNextYearMonth(currentMonth);
        }

        if (monthInputs.length === 0) return 0n;

        const results = calculateBudgetCarryoverChain(monthInputs);
        const lastResult = results[results.length - 1];
        return lastResult?.available ?? 0n;
      }
    };

    // Calculate sum of all category available amounts (excluding deleted categories)
    let sumCategoryAvailable = 0n;
    const categoryAvailableBreakdown: { name: string; type: string; available: bigint }[] = [];

    for (const category of categories) {
      if (category.isDeleted) continue;

      const available = calculateCategoryAvailable(category);
      sumCategoryAvailable += available;

      categoryAvailableBreakdown.push({
        name: category.name,
        type: category.categoryType ?? 'regular',
        available,
      });
    }

    // Sort by available (highest first)
    categoryAvailableBreakdown.sort((a, b) => (b.available > a.available ? 1 : -1));

    // ===== END BUDGET EQUATION CHECK (calculation finalized after totalBankingBalance is computed) =====

    // Convert to sorted arrays
    const inflowsSummary = Object.values(inflowsByAccount).sort((a, b) => (b.total > a.total ? 1 : -1));
    const outflowsSummary = Object.values(outflowsByAccount).sort((a, b) => (a.total > b.total ? 1 : -1));
    const excludedSummary = Object.values(excludedByAccount);
    const budgetSummary = Object.values(assignmentsByCategory).sort((a, b) => (b.total > a.total ? 1 : -1));

    // Get bank account balances for context
    const accountBalances = bankAccounts
      .filter((a) => !a.isDeleted)
      .map((a) => ({
        name: a.name,
        type: a.accountType,
        balance: a.currentBalance,
        isClosed: a.isClosed,
      }))
      .sort((a, b) => (b.balance > a.balance ? 1 : -1));

    // Banking accounts (checking, savings, cash) - these contribute to RTA
    const totalBankingBalance = bankAccounts
      .filter((a) => !a.isDeleted && !a.isClosed && a.accountType.startsWith('banking_'))
      .reduce((sum, a) => sum + a.currentBalance, 0n);

    // Investment accounts - tracked for net worth but NOT for RTA
    const totalInvestmentBalance = bankAccounts
      .filter((a) => !a.isDeleted && !a.isClosed && a.accountType.startsWith('investment_'))
      .reduce((sum, a) => sum + a.currentBalance, 0n);

    const totalCreditDebt = bankAccounts
      .filter(
        (a) => !a.isDeleted && !a.isClosed && (a.accountType.startsWith('credit_') || a.accountType.startsWith('loan_'))
      )
      .reduce((sum, a) => sum + a.currentBalance, 0n);

    // Calculate what RTA "should" be if all banking cash was available (excludes investments)
    const missingFromRTA = totalBankingBalance - (totalInflows + totalOutflows);

    // ===== FINALIZE BUDGET EQUATION CHECK =====
    // Calculate the budget equation check now that we have totalBankingBalance
    const rtaPlusCategoryAvailable = storedRTA + sumCategoryAvailable;
    const budgetEquationDiscrepancy = totalBankingBalance - rtaPlusCategoryAvailable;
    const isBudgetEquationBalanced = budgetEquationDiscrepancy === 0n;

    // ===== STARTING BALANCE ANALYSIS =====
    // Check if starting balances were properly recorded as RTA inflows
    const startingBalanceAnalysis: {
      accountName: string;
      accountType: string;
      hasStartingBalanceTx: boolean;
      startingBalanceAmount: bigint;
      hasRTAMovement: boolean;
      rtaAmount: bigint;
      issue: string | null;
    }[] = [];

    // Only analyze banking accounts (checking, savings, cash)
    const bankingAccounts = bankAccounts.filter(
      (a) => !a.isDeleted && !a.isClosed && a.accountType.startsWith('banking_')
    );

    for (const account of bankingAccounts) {
      // Find starting_balance transaction for this account
      const startingBalanceTx = allTransactions.find(
        (t) => t.bankAccountId.toString() === account._id.toString() && t.type === 'starting_balance'
      );

      const hasStartingBalanceTx = !!startingBalanceTx;
      const startingBalanceAmount = startingBalanceTx?.totalAmount ?? 0n;

      // Check if the starting balance transaction has readyToAssign movements
      let hasRTAMovement = false;
      let rtaAmount = 0n;

      if (startingBalanceTx) {
        for (const movement of startingBalanceTx.movements ?? []) {
          if (movement.readyToAssign === true) {
            hasRTAMovement = true;
            rtaAmount += movement.amount;
          }
        }
      }

      // Determine the issue
      let issue: string | null = null;
      if (!hasStartingBalanceTx) {
        issue = 'No starting balance transaction found';
      } else if (!hasRTAMovement) {
        issue = 'Starting balance exists but movement not marked as readyToAssign';
      } else if (rtaAmount !== startingBalanceAmount) {
        issue = `RTA amount (${rtaAmount}) doesn't match starting balance (${startingBalanceAmount})`;
      }

      startingBalanceAnalysis.push({
        accountName: account.name,
        accountType: account.accountType,
        hasStartingBalanceTx,
        startingBalanceAmount,
        hasRTAMovement,
        rtaAmount,
        issue,
      });
    }

    // Calculate total missing RTA from starting balances
    const totalMissingFromStartingBalances = startingBalanceAnalysis.reduce((sum, a) => {
      if (a.issue) {
        return sum + a.startingBalanceAmount - a.rtaAmount;
      }
      return sum;
    }, 0n);

    const startingBalanceIssuesCount = startingBalanceAnalysis.filter((a) => a.issue !== null).length;

    return {
      workspaceId,
      workspaceName: workspace.name,

      // Result
      storedRTA,
      expectedRTA,
      drift,
      isCorrect: drift === 0n,

      // Formula breakdown
      formula: {
        description: 'RTA = Inflows + Outflows - Budget Assigned',
        inflows: totalInflows,
        outflows: totalOutflows,
        netUncategorized,
        budgetAssigned: totalBudgetAssigned,
      },

      // Bank account balances for context
      accountBalances: {
        totalBanking: totalBankingBalance, // Checking, savings, cash - contributes to RTA
        totalInvestments: totalInvestmentBalance, // Tracked for net worth, NOT RTA
        totalCreditDebt,
        netWorth: totalBankingBalance + totalInvestmentBalance + totalCreditDebt,
        missingFromRTA, // Banking cash that exists but wasn't recorded as RTA income
        byAccount: accountBalances,
      },

      // Inflows by account
      inflows: {
        total: totalInflows,
        byAccount: inflowsSummary,
      },

      // Outflows by account
      outflows: {
        total: totalOutflows,
        byAccount: outflowsSummary,
      },

      // Excluded (credit/loan accounts)
      excluded: {
        total: totalExcluded,
        byAccount: excludedSummary,
      },

      // Budget assignments by category
      budgetAssignments: {
        total: totalBudgetAssigned,
        categoryCount: budgetSummary.length,
        byCategory: budgetSummary,
      },

      // Budget equation check: bankingBalance = RTA + sum(categoryAvailable)
      budgetEquation: {
        description: 'bankingBalance should equal RTA + sum(categoryAvailable)',
        bankingBalance: totalBankingBalance,
        storedRTA,
        sumCategoryAvailable,
        rtaPlusCategoryAvailable,
        discrepancy: budgetEquationDiscrepancy, // Positive = missing from RTA/categories, Negative = extra in RTA/categories
        isBalanced: isBudgetEquationBalanced,
        currentYearMonth,
        categoryCount: categoryAvailableBreakdown.length,
        // Show top 10 categories by available amount
        topCategories: categoryAvailableBreakdown.slice(0, 10),
      },

      // Starting balance analysis - check if starting balances were recorded as RTA
      startingBalances: {
        issuesCount: startingBalanceIssuesCount,
        totalMissingFromRTA: totalMissingFromStartingBalances,
        accountsAnalyzed: startingBalanceAnalysis.length,
        // Show accounts with issues first, then all accounts
        accounts: startingBalanceAnalysis.sort((a, b) => {
          if (a.issue && !b.issue) return -1;
          if (!a.issue && b.issue) return 1;
          return 0;
        }),
      },
    };
  },
});
