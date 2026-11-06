import { prepareImport } from '../kualiaImport/prepare';
import { createZipArchive, readExportArchive } from './archive';
import { describe, expect, it } from 'vitest';
import { buildWorkspaceExportCsvFiles, type WorkspaceExportDataset } from './format';

function makeDataset(): WorkspaceExportDataset {
  return {
    workspace: {
      workspaceId: 'workspace_1',
      createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
      name: 'Personal',
      currency: 'USD',
      timezone: 'America/New_York',
      readyToAssign: 5000n,
      expectedMonthlyIncome: 100000n,
      transactionDefaultAccountId: 'account_1',
      transactionDefaultAccountName: 'Checking',
      transactionDefaultPendingStatus: false,
      onboardingCompleted: true,
      isArchived: false,
      updatedAt: null,
    },
    categories: [
      {
        categoryId: 'category_1',
        createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
        name: '+SUM(1)',
        categoryGroupId: 'group_1',
        categoryGroupName: 'Living',
        categoryGroupType: 'expense',
        sortOrder: 100,
        iconName: null,
        isSystemCategory: false,
        isArchived: false,
        categoryType: 'custom',
        bankAccountId: null,
        targetEnabled: false,
        targetType: null,
        targetAmount: null,
        targetFrequency: null,
        targetFrequencyInterval: null,
        targetDayOfWeek: null,
        targetDueDay: null,
        targetFirstDueDate: null,
        targetDate: null,
        targetMonthlyContribution: null,
        targetBalance: null,
        updatedAt: null,
      },
      {
        categoryId: 'category_credit',
        createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
        name: 'Credit Card Payment',
        categoryGroupId: 'group_credit',
        categoryGroupName: 'Credit Cards',
        categoryGroupType: 'credit_card',
        sortOrder: 200,
        iconName: null,
        isSystemCategory: true,
        isArchived: false,
        categoryType: 'credit_card',
        bankAccountId: 'account_credit',
        targetEnabled: false,
        targetType: null,
        targetAmount: null,
        targetFrequency: null,
        targetFrequencyInterval: null,
        targetDayOfWeek: null,
        targetDueDay: null,
        targetFirstDueDate: null,
        targetDate: null,
        targetMonthlyContribution: null,
        targetBalance: null,
        updatedAt: null,
      },
    ],
    plan: [
      {
        categoryId: 'category_1',
        categoryName: 'Groceries',
        categoryGroupId: 'group_1',
        categoryGroupName: 'Living',
        categoryGroupType: 'expense',
        categoryArchived: false,
        categoryType: 'custom',
        bankAccountId: null,
        monthlyAssignedAmounts: { '202608': 50000n },
        snoozedTargetMonths: {},
        monthlySpending: { '202608': { inflowAmount: 1000n, outflowAmount: 2500n } },
        creditMonthlySpending: {},
      },
      {
        categoryId: 'category_credit',
        categoryName: 'Credit Card Payment',
        categoryGroupId: 'group_credit',
        categoryGroupName: 'Credit Cards',
        categoryGroupType: 'credit_card',
        categoryArchived: false,
        categoryType: 'credit_card',
        bankAccountId: 'account_credit',
        monthlyAssignedAmounts: { '202607': 10000n, '202609': 20000n },
        snoozedTargetMonths: {},
        monthlySpending: {},
        creditMonthlySpending: {},
      },
    ],
    bankAccounts: [
      {
        bankAccountId: 'account_1',
        createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
        name: 'Checking',
        accountType: 'banking_checking',
        currentBalance: 250000n,
        pendingBalance: 1000n,
        clearedBalance: 249000n,
        isClosed: false,
        closedAt: null,
        lastReconciledAt: null,
        notes: null,
        updatedAt: null,
      },
      {
        bankAccountId: 'account_credit',
        createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
        name: 'Chase Sapphire',
        accountType: 'credit_credit_card',
        currentBalance: -50000n,
        pendingBalance: null,
        clearedBalance: -50000n,
        isClosed: false,
        closedAt: null,
        lastReconciledAt: null,
        notes: null,
        updatedAt: null,
      },
    ],
    transactions: [
      {
        transactionId: 'transaction_single',
        createdAt: Date.parse('2026-08-17T00:00:00.000Z'),
        date: '2026-08-17',
        accountId: 'account_1',
        accountName: 'Checking',
        merchantId: 'merchant_1',
        merchantName: 'Coffee',
        type: 'regular',
        status: 'cleared',
        reviewStatus: 'reviewed',
        source: 'manual',
        notes: null,
        totalAmount: 500n,
        transferPairId: null,
        transferAccountId: null,
        transferAccountName: null,
        scheduledTransactionId: null,
        updatedAt: null,
        movements: [
          {
            amount: 500n,
            sortOrder: 0,
            categoryId: null,
            categoryName: null,
            categoryGroupId: null,
            categoryGroupName: null,
            readyToAssign: true,
            notes: null,
          },
        ],
      },
      {
        transactionId: 'transaction_split',
        createdAt: Date.parse('2026-08-18T00:00:00.000Z'),
        date: '2026-08-18',
        accountId: 'account_1',
        accountName: 'Checking',
        merchantId: 'merchant_2',
        merchantName: '=HYPERLINK("https://example.com")',
        type: 'regular',
        status: 'pending',
        reviewStatus: 'needs_review',
        source: 'automatic_import',
        notes: 'Two categories',
        totalAmount: -3000n,
        transferPairId: null,
        transferAccountId: null,
        transferAccountName: null,
        scheduledTransactionId: null,
        updatedAt: null,
        movements: [
          {
            amount: -1000n,
            sortOrder: 0,
            categoryId: 'category_1',
            categoryName: 'Food',
            categoryGroupId: 'group_1',
            categoryGroupName: 'Living',
            readyToAssign: false,
            notes: null,
          },
          {
            amount: -2000n,
            sortOrder: 1,
            categoryId: null,
            categoryName: null,
            categoryGroupId: null,
            categoryGroupName: null,
            readyToAssign: false,
            notes: 'Other',
          },
        ],
      },
    ],
  };
}

describe('workspace export CSV formatting', () => {
  it('writes one transaction row per movement and links split rows by transaction id', () => {
    const result = buildWorkspaceExportCsvFiles(makeDataset(), 2);
    const transactions = result.files.find((file) => file.name === 'transactions.csv');

    expect(result.counts.transactionCount).toBe(2);
    expect(result.counts.transactionMovementRowCount).toBe(3);
    expect(transactions?.content.match(/transaction_single/g)).toHaveLength(1);
    expect(transactions?.content.match(/transaction_split/g)).toHaveLength(2);
    expect(transactions?.content).toContain('transaction_single,1,1,false');
    expect(transactions?.content).toContain('transaction_split,1,2,true');
    expect(transactions?.content).toContain('transaction_split,2,2,true');
    expect(transactions?.content).toContain(',-30.00,-10.00,');
    expect(transactions?.content).toContain(',-30.00,-20.00,');

    const [headerLine, ...transactionRows] = transactions?.content.trim().split('\r\n') ?? [];
    const headers = headerLine?.replace('\uFEFF', '').split(',') ?? [];
    const readyToAssignRow = transactionRows.find((row) => row.startsWith('transaction_single,'));
    expect(headers).not.toContain('ready_to_assign');
    expect(readyToAssignRow?.split(',')[headers.indexOf('category_name')]).toBe('Ready to Assign');
  });

  it('uses bank account names for credit cards, sorts plan rows by month, and protects spreadsheet text', () => {
    const result = buildWorkspaceExportCsvFiles(makeDataset(), 2);
    const plan = result.files.find((file) => file.name === 'plan.csv');
    const categories = result.files.find((file) => file.name === 'categories.csv');
    const transactions = result.files.find((file) => file.name === 'transactions.csv');

    expect(result.files.map((file) => file.name)).toEqual([
      'categories.csv',
      'plan.csv',
      'bank-accounts.csv',
      'transactions.csv',
    ]);
    expect(result.counts.planRowCount).toBe(3);
    expect(plan?.content).toContain('202608,group_1,Living,category_1,Groceries,false,500.00,10.00,25.00,-15.00');
    expect(plan?.content).toContain('202607,group_credit,Credit Cards,category_credit,Chase Sapphire');
    expect(categories?.content).toContain('category_credit,Chase Sapphire,group_credit');
    expect(categories?.content).not.toContain('Credit Card Payment');
    expect(categories?.content).toContain("category_1,'+SUM(1),group_1");
    expect(transactions?.content).toContain("'=HYPERLINK(");

    const planMonths = plan?.content
      .trim()
      .split('\r\n')
      .slice(1)
      .map((row) => row.split(',')[0]);
    expect(planMonths).toEqual(['202607', '202608', '202609']);
  });
});

describe('importing an original Kualia workspace export', () => {
  it('reads the ZIP produced by the exporter and reconstructs the budget in exact minor units', () => {
    const dataset = makeDataset();
    dataset.bankAccounts[0].notes = 'Commas, "quotes", and\r\nnewlines';
    dataset.bankAccounts[0].currentBalance = 9007199254740993n;
    const { files } = buildWorkspaceExportCsvFiles(dataset, 3);
    const archive = createZipArchive(files);
    const data = prepareImport(readExportArchive(Uint8Array.from(archive).buffer), 'KWD');
    expect(data.accounts.get('account_1')).toMatchObject({
      currentBalance: 9007199254740993n,
      notes: dataset.bankAccounts[0].notes,
    });
    expect(data.categories.get('category_1')).toMatchObject({
      name: '+SUM(1)',
      assignments: { '202608': 50000n },
      transactionCount: 1n,
    });
    expect(data.groups.get('group_credit')?.type).toBe('credit_card');
    expect(data.readyToAssign).toBe(-79500n);
    expect(data.monthlyIncomeActivity).toEqual({ '202608': { inflowAmount: 500n, outflowAmount: 0n } });
    expect(data.transactions[1].movements.map((m) => m.amount)).toEqual([-1000n, -2000n]);
    expect(data.merchants.get('id/merchant_2')?.name).toBe('=HYPERLINK("https://example.com")');
  });

  it('preserves snoozed targets, credit activity and empty movement lists', () => {
    const dataset = makeDataset();
    dataset.categories[0] = {
      ...dataset.categories[0],
      targetEnabled: true,
      targetType: 'recurring',
      targetFrequency: 'monthly',
      targetAmount: 10000n,
    };
    dataset.plan[0].snoozedTargetMonths = { '202608': true };
    dataset.plan[1].creditMonthlySpending = {
      '202608': { priorBalance: -10000n, spendingAmount: -2000n, paymentsAmount: 3000n, refundedSpending: 100n },
    };
    dataset.transactions[0].movements = [];
    const result = prepareImport(buildWorkspaceExportCsvFiles(dataset, 0).files, 'JPY');
    expect(result.categories.get('category_1')).toMatchObject({
      enableTarget: true,
      target_type: 'recurring',
      target_frequency: 'monthly',
      target_amount: 10000n,
      snoozed: { '202608': true },
    });
    expect(result.categories.get('category_credit')?.creditMonthlySpending?.['202608']).toEqual(
      dataset.plan[1].creditMonthlySpending['202608']
    );
    expect(result.transactions[0]).toMatchObject({ totalAmount: 500n, movements: [] });
  });

  it('accepts four header-only CSV files and rejects a missing or repeated file', () => {
    const dataset = makeDataset();
    const { files } = buildWorkspaceExportCsvFiles(
      { ...dataset, transactions: [], plan: [], categories: [], bankAccounts: [] },
      2
    );
    expect(prepareImport(files, 'USD').transactions).toEqual([]);
    expect(() => prepareImport(files.slice(1), 'USD')).toThrow(/categories.csv/);
    expect(() => prepareImport([...files, files[0]], 'USD')).toThrow(/categories.csv/);
  });

  it('rejects partial splits, unrelated category IDs, and precision mismatches', () => {
    const dataset = makeDataset();
    const { files } = buildWorkspaceExportCsvFiles(dataset, 2);
    const partial = files.map((f) =>
      f.name === 'transactions.csv' ? { ...f, content: f.content.replace(/^transaction_split,2,.*\r\n/m, '') } : f
    );
    expect(() => prepareImport(partial, 'USD')).toThrow(/split/);
    expect(() => prepareImport(files, 'JPY')).toThrow(/fractional/);
    dataset.transactions[1].movements[0].categoryId = 'foreign-category';
    expect(() => prepareImport(buildWorkspaceExportCsvFiles(dataset, 2).files, 'USD')).toThrow(
      /Missing transaction category/
    );
  });
});
