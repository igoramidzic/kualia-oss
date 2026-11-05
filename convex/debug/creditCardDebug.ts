import { v } from 'convex/values';

import { internalMutation, internalQuery } from '../_generated/server';

/**
 * Debug query to investigate credit card category data
 * Run with: npx convex run debug/creditCardDebug:debugCreditCard --args '{"workspaceId": "mn734ksr0dp7ejkb8nrgbgnkv57yf1mq"}'
 */
export const debugCreditCard = internalQuery({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }) => {
    const categories = await ctx.db
      .query('category')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('categoryType'), 'credit_card'))
      .collect();

    const results = [];

    for (const cat of categories) {
      const budget = await ctx.db
        .query('categoryBudget')
        .withIndex('by_workspaceId_categoryId', (q) => q.eq('workspaceId', workspaceId).eq('categoryId', cat._id))
        .first();

      // Get linked bank account
      const bankAccount = cat.bankAccountId ? await ctx.db.get(cat.bankAccountId) : null;

      // Calculate totals for easier reading
      let totalAssigned = 0n;
      let totalSpending = 0n;
      let totalPayments = 0n;
      let totalPriorBalance = 0n;
      let totalRefunded = 0n;

      if (budget?.monthlyAssignedAmounts) {
        for (const amount of Object.values(budget.monthlyAssignedAmounts)) {
          totalAssigned += amount;
        }
      }

      if (cat.creditMonthlySpending) {
        for (const spending of Object.values(cat.creditMonthlySpending)) {
          totalSpending += spending.spendingAmount ?? 0n;
          totalPayments += spending.paymentsAmount ?? 0n;
          totalPriorBalance += spending.priorBalance ?? 0n;
          totalRefunded += spending.refundedSpending ?? 0n;
        }
      }

      // Calculate expected available
      // available = assigned + carryover + budgetActivity
      // budgetActivity = spendingAmount - paymentsAmount + refundedSpending
      const budgetActivity = totalSpending - totalPayments + totalRefunded;
      const calculatedAvailable = totalAssigned + budgetActivity;

      results.push({
        categoryName: cat.name,
        categoryId: cat._id,
        bankAccountId: cat.bankAccountId,
        bankAccountName: bankAccount?.name,
        bankAccountBalance: bankAccount?.currentBalance,
        // Totals
        totals: {
          totalAssigned,
          totalSpending,
          totalPayments,
          totalRefunded,
          totalPriorBalance,
          budgetActivity,
          calculatedAvailable,
        },
        // Raw data for detailed inspection
        creditMonthlySpending: cat.creditMonthlySpending,
        monthlyAssignedAmounts: budget?.monthlyAssignedAmounts,
      });
    }

    return results;
  },
});

/**
 * Debug a specific transaction to see its movements
 * Run with: npx convex run debug/creditCardDebug:debugTransaction --args '{"workspaceId": "...", "date": "2025-11-24", "amount": 1000000}'
 */
export const debugTransaction = internalQuery({
  args: {
    workspaceId: v.id('workspace'),
    date: v.string(),
    amount: v.int64(),
  },
  handler: async (ctx, { workspaceId, date, amount }) => {
    const transactions = await ctx.db
      .query('transaction')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    const matching = transactions.filter(
      (tx) => tx.date === date && (tx.totalAmount === amount || tx.movements?.some((m) => m.amount === amount))
    );

    const results = [];
    for (const tx of matching) {
      const bankAccount = await ctx.db.get(tx.bankAccountId);

      // Get category names for movements
      const movementsWithNames = await Promise.all(
        (tx.movements ?? []).map(async (m) => {
          const category = m.categoryId ? await ctx.db.get(m.categoryId) : null;
          const creditCardCategory = m.creditCardTransfer?.creditCardCategoryId
            ? await ctx.db.get(m.creditCardTransfer.creditCardCategoryId)
            : null;
          const spendingCategory = m.creditCardTransfer?.spendingCategoryId
            ? await ctx.db.get(m.creditCardTransfer.spendingCategoryId)
            : null;
          return {
            amount: m.amount,
            categoryId: m.categoryId,
            categoryName: category?.name,
            readyToAssign: m.readyToAssign,
            creditCardTransfer: m.creditCardTransfer
              ? {
                  creditCardCategoryId: m.creditCardTransfer.creditCardCategoryId,
                  creditCardCategoryName: creditCardCategory?.name,
                  spendingCategoryId: m.creditCardTransfer.spendingCategoryId,
                  spendingCategoryName: spendingCategory?.name,
                }
              : undefined,
          };
        })
      );

      results.push({
        transactionId: tx._id,
        date: tx.date,
        type: tx.type,
        totalAmount: tx.totalAmount,
        bankAccountName: bankAccount?.name,
        movements: movementsWithNames,
      });
    }

    return results;
  },
});

/**
 * Find bank account IDs by name pattern
 * Run with: npx convex run debug/creditCardDebug:findBankAccount --args '{"workspaceId": "...", "namePattern": "AMEX"}'
 */
export const findBankAccount = internalQuery({
  args: { workspaceId: v.id('workspace'), namePattern: v.string() },
  handler: async (ctx, { workspaceId, namePattern }) => {
    const accounts = await ctx.db
      .query('bankAccount')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .collect();

    return accounts
      .filter((a) => a.name.toLowerCase().includes(namePattern.toLowerCase()))
      .map((a) => ({
        id: a._id,
        name: a.name,
        type: a.accountType,
        balance: a.currentBalance,
      }));
  },
});

/**
 * Debug query to check transactions on a specific bank account
 * Run with: npx convex run debug/creditCardDebug:debugTransactions --args '{"bankAccountId": "..."}'
 */
export const debugTransactions = internalQuery({
  args: { bankAccountId: v.id('bankAccount') },
  handler: async (ctx, { bankAccountId }) => {
    const bankAccount = await ctx.db.get(bankAccountId);

    const transactions = await ctx.db
      .query('transaction')
      .withIndex('by_bankAccountId', (q) => q.eq('bankAccountId', bankAccountId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Group by month and calculate totals
    const byMonth: Record<
      string,
      {
        spending: bigint;
        payments: bigint;
        refunds: bigint;
        other: bigint;
        count: number;
        transactions: { date: string; amount: bigint; type: string }[];
      }
    > = {};

    for (const tx of transactions) {
      const yearMonth = tx.date.slice(0, 7).replace('-', '');
      if (!byMonth[yearMonth]) {
        byMonth[yearMonth] = { spending: 0n, payments: 0n, refunds: 0n, other: 0n, count: 0, transactions: [] };
      }

      const amount = tx.totalAmount ?? tx.movements?.reduce((sum, m) => sum + m.amount, 0n) ?? 0n;
      const month = byMonth[yearMonth];
      month.count++;

      month.transactions.push({
        date: tx.date,
        amount,
        type: tx.type ?? 'regular',
      });

      if (tx.type === 'transfer' && amount > 0) {
        // Payment to the card
        month.payments += amount;
      } else if (amount > 0) {
        // Positive amount = refund or credit
        month.refunds += amount;
      } else {
        // Negative amount = spending
        month.spending += -amount;
      }
    }

    // Calculate running balance
    let runningBalance = 0n;
    const summary = Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => {
        const netChange = -data.spending + data.payments + data.refunds + (data.other !== 0n ? data.other : 0n);
        runningBalance += netChange;
        return {
          month,
          ...data,
          netChange,
          runningBalance,
        };
      });

    return {
      accountName: bankAccount?.name,
      currentBalance: bankAccount?.currentBalance,
      transactionCount: transactions.length,
      byMonth: summary,
    };
  },
});

/**
 * Investigate a credit card balance discrepancy and show the fix needed
 * Run with: npx convex run debug/creditCardDebug:investigateBalanceDiscrepancy --args '{"bankAccountId": "j579n0e4xs0b4yx0gxdn6283v17yc1tx"}'
 */
export const investigateBalanceDiscrepancy = internalQuery({
  args: { bankAccountId: v.id('bankAccount') },
  handler: async (ctx, { bankAccountId }) => {
    const bankAccount = await ctx.db.get(bankAccountId);
    if (!bankAccount) {
      return { error: 'Bank account not found' };
    }

    // Get all transactions for this account
    const transactions = await ctx.db
      .query('transaction')
      .withIndex('by_bankAccountId', (q) => q.eq('bankAccountId', bankAccountId))
      .filter((q) => q.eq(q.field('isDeleted'), false))
      .collect();

    // Calculate sum of all transactions
    let calculatedBalance = 0n;
    const transactionDetails: Array<{
      id: string;
      date: string;
      type: string;
      amount: bigint;
      runningBalance: bigint;
    }> = [];

    // Sort by date
    const sortedTransactions = transactions.sort((a, b) => a.date.localeCompare(b.date));

    for (const tx of sortedTransactions) {
      const txAmount = tx.totalAmount ?? tx.movements?.reduce((sum, m) => sum + m.amount, 0n) ?? 0n;
      calculatedBalance += txAmount;
      transactionDetails.push({
        id: tx._id,
        date: tx.date,
        type: tx.type ?? 'regular',
        amount: txAmount,
        runningBalance: calculatedBalance,
      });
    }

    const storedBalance = bankAccount.currentBalance ?? 0n;
    const discrepancy = storedBalance - calculatedBalance;

    // For credit cards, balance should typically be negative (debt)
    // If stored balance is positive but calculated is also positive, something is wrong
    const analysis = {
      accountName: bankAccount.name,
      accountType: bankAccount.accountType,
      storedBalance,
      calculatedFromTransactions: calculatedBalance,
      discrepancy,
      transactionCount: transactions.length,
      // Show last 20 transactions for context
      recentTransactions: transactionDetails.slice(-20),
      // Recommendation
      recommendation:
        discrepancy !== 0n
          ? `Create a balance adjustment of ${discrepancy} to fix the discrepancy`
          : 'Balances match - no fix needed',
    };

    // Check if the issue is that the balance should be negative (credit card debt)
    if (storedBalance > 0n && bankAccount.accountType?.startsWith('credit_')) {
      analysis.recommendation =
        `WARNING: Credit card has positive balance (${storedBalance}). This suggests the balance was corrupted. ` +
        analysis.recommendation;
    }

    return analysis;
  },
});

/**
 * Fix a credit card balance by setting it to the correct value
 * CAUTION: Only run this after investigating with investigateBalanceDiscrepancy
 * Run with: npx convex run debug/creditCardDebug:fixBankAccountBalance --args '{"bankAccountId": "...", "correctBalance": -182500}'
 */
export const fixBankAccountBalance = internalMutation({
  args: {
    bankAccountId: v.id('bankAccount'),
    correctBalance: v.int64(),
  },
  handler: async (ctx, { bankAccountId, correctBalance }) => {
    const bankAccount = await ctx.db.get(bankAccountId);
    if (!bankAccount) {
      return { error: 'Bank account not found' };
    }

    const previousBalance = bankAccount.currentBalance ?? 0n;

    await ctx.db.patch(bankAccountId, {
      currentBalance: correctBalance,
    });

    return {
      success: true,
      accountName: bankAccount.name,
      previousBalance,
      newBalance: correctBalance,
      change: correctBalance - previousBalance,
    };
  },
});
