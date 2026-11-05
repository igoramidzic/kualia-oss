import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import * as budgetHelpers from '../categoryBudgets/helpers';
import {
  getFeedDeletionBudgetChanges,
  getFeedDeletionTransactions,
  getTransactionFeedAccountLogos,
  getTransferGroupId,
  toTransactionFeedItem,
  toTransactionFeedItems,
} from './feed';
import { getTransactionFeedLookups } from './queries';

const workspaceId = 'workspace-1' as Id<'workspace'>;
const accountId = 'account-1' as Id<'bankAccount'>;
const pairAccountId = 'account-2' as Id<'bankAccount'>;

function transaction(overrides: Partial<Doc<'transaction'>> = {}): Doc<'transaction'> {
  return {
    _id: 'transaction-1' as Id<'transaction'>,
    _creationTime: 1,
    bankAccountId: accountId,
    date: '2026-09-04',
    isDeleted: false,
    status: 'cleared',
    reviewStatus: 'reviewed',
    type: 'regular',
    workspaceId,
    dateYearMonth: 202609,
    movements: [],
    searchText: '',
    totalAmount: -1_250n,
    hasUncategorized: false,
    hasMissingPayee: false,
    ...overrides,
  };
}

function emptyLookups() {
  return {
    merchants: new Map<Id<'merchant'>, Doc<'merchant'>>(),
    globalMerchants: new Map<Id<'globalMerchant'>, Doc<'globalMerchant'>>(),
    bankAccounts: new Map<Id<'bankAccount'>, Doc<'bankAccount'>>(),
    categories: new Map<Id<'category'>, Doc<'category'>>(),
    accountLogoUrls: new Map<Id<'bankAccount'>, string | null>(),
    transferPairAccountIds: new Map<Id<'transaction'>, Id<'bankAccount'>>(),
  };
}

function bankAccount(id: Id<'bankAccount'>, accountType: Doc<'bankAccount'>['accountType']): Doc<'bankAccount'> {
  return {
    _id: id,
    _creationTime: 1,
    name: id,
    workspaceId,
    accountType,
    currentBalance: 0n,
    isClosed: false,
    isDeleted: false,
  };
}

function mockContext(records: ReadonlyMap<string, unknown>) {
  const get = vi.fn(async (id: string) => records.get(id) ?? null);
  return { get, ctx: { db: { get } } as unknown as QueryCtx };
}

describe('transaction feed mapping', () => {
  it.each([
    ['banking_checking', 'credit_credit_card', -500n, true],
    ['credit_credit_card', 'banking_checking', 500n, true],
    ['banking_savings', 'credit_line_of_credit', -500n, true],
    ['credit_credit_card', 'banking_checking', -500n, false],
    ['banking_checking', 'credit_credit_card', 500n, false],
    ['credit_credit_card', 'credit_credit_card', -500n, false],
    ['banking_checking', 'banking_savings', -500n, false],
    ['banking_checking', 'credit_credit_card', 0n, false],
  ] as const)('detects a payment for %s → %s with amount %s', (ownType, pairType, amount, expected) => {
    const lookups = emptyLookups();
    lookups.bankAccounts.set(accountId, bankAccount(accountId, ownType));
    lookups.bankAccounts.set(pairAccountId, bankAccount(pairAccountId, pairType));
    const item = toTransactionFeedItem(
      transaction({ type: 'transfer', transferPairBankAccountId: pairAccountId, totalAmount: amount }),
      lookups
    );
    expect(item.isCreditCardPayment).toBe(expected);
    expect(item.bankAccountType).toBe(ownType);
    expect(item.transferPairAccountType).toBe(pairType);
    expect(item.amount).toBe(amount);
    expect(item.categoryNames).toEqual([]);
  });

  it('does not infer payments from merchant names or absent account metadata', () => {
    const item = toTransactionFeedItem(
      transaction({ type: 'transfer', transferPairBankAccountId: pairAccountId }),
      emptyLookups()
    );
    expect(item.isCreditCardPayment).toBe(false);
    expect(item.bankAccountType).toBeNull();
    expect(item.transferPairAccountLogoUrl).toBeNull();
  });

  it('keeps real category allocations for cross-budget transfers', () => {
    const lookups = emptyLookups();
    lookups.bankAccounts.set(accountId, bankAccount(accountId, 'banking_checking'));
    lookups.bankAccounts.set(pairAccountId, bankAccount(pairAccountId, 'investment_brokerage'));
    const item = toTransactionFeedItem(
      transaction({
        type: 'transfer',
        transferPairBankAccountId: pairAccountId,
        movements: [{ amount: -1250n, readyToAssign: false, categoryName: 'Investing', sortOrder: 0 }],
      }),
      lookups
    );
    expect(item.categoryNames).toEqual(['Investing']);
    expect(item.isCreditCardPayment).toBe(false);
  });

  it('resolves shared institution logos in batches and respects account overrides and icon mode', async () => {
    const linked = {
      ...bankAccount(accountId, 'banking_checking'),
      bankLinkAccountId: 'link-account' as Id<'bankLinkAccount'>,
    };
    const card = { ...bankAccount(pairAccountId, 'credit_credit_card'), bankLinkAccountId: linked.bankLinkAccountId };
    const custom = {
      ...bankAccount('custom' as Id<'bankAccount'>, 'banking_checking'),
      logoUrl: 'https://example.com/custom.png',
    };
    const removed = { ...linked, _id: 'removed' as Id<'bankAccount'>, logoUrl: null };
    const iconOnly = { ...linked, _id: 'icon' as Id<'bankAccount'>, visualIdentityMode: 'icon' as const };
    const { ctx, get } = mockContext(
      new Map<string, unknown>([
        ['link-account', { _id: 'link-account', bankLinkId: 'link' }],
        ['link', { _id: 'link', globalInstitutionId: 'institution', accessToken: 'must-not-leak' }],
        ['institution', { _id: 'institution', logoUrl: 'https://example.com/bank.png' }],
      ])
    );
    const accounts = new Map([linked, card, custom, removed, iconOnly].map((account) => [account._id, account]));
    const logos = await getTransactionFeedAccountLogos(ctx, accounts);
    expect(logos.get(accountId)).toBe('https://example.com/bank.png');
    expect(logos.get(pairAccountId)).toBe('https://example.com/bank.png');
    expect(logos.get(custom._id)).toBe('https://example.com/custom.png');
    expect(logos.get(removed._id)).toBeNull();
    expect(logos.get(iconOnly._id)).toBeNull();
    expect(get.mock.calls.map(([id]) => id)).toEqual(['link-account', 'link', 'institution']);
    const lookups = { ...emptyLookups(), bankAccounts: accounts, accountLogoUrls: logos };
    const item = toTransactionFeedItem(
      transaction({ type: 'transfer', transferPairBankAccountId: pairAccountId }),
      lookups
    );
    expect(item.bankAccountLogoUrl).toBe('https://example.com/bank.png');
    expect(item.transferPairAccountLogoUrl).toBe('https://example.com/bank.png');
    expect(item).not.toHaveProperty('accessToken');
  });

  it('resolves legacy counterpart account IDs without exposing another workspace', async () => {
    const first = transaction({ type: 'transfer', transferPairId: 'pair' as Id<'transaction'> });
    const paired = transaction({
      _id: 'pair' as Id<'transaction'>,
      type: 'transfer',
      transferPairId: first._id,
      bankAccountId: pairAccountId,
    });
    const records = new Map<string, unknown>([
      [accountId, bankAccount(accountId, 'banking_checking')],
      [pairAccountId, bankAccount(pairAccountId, 'credit_credit_card')],
      ['pair', paired],
    ]);
    const { ctx } = mockContext(records);
    const lookups = await getTransactionFeedLookups(ctx, workspaceId, [first]);
    expect(toTransactionFeedItem(first, lookups)).toMatchObject({
      transferPairAccountName: pairAccountId,
      isCreditCardPayment: true,
    });
    records.set('pair', { ...paired, workspaceId: 'foreign-workspace' });
    const privateLookups = await getTransactionFeedLookups(ctx, workspaceId, [first]);
    expect(toTransactionFeedItem(first, privateLookups).transferPairAccountName).toBeNull();
    records.set(pairAccountId, {
      ...bankAccount(pairAccountId, 'credit_credit_card'),
      workspaceId: 'foreign-workspace',
    });
    const denormalized = transaction({ type: 'transfer', transferPairBankAccountId: pairAccountId });
    const denormalizedLookups = await getTransactionFeedLookups(ctx, workspaceId, [denormalized]);
    expect(toTransactionFeedItem(denormalized, denormalizedLookups).transferPairAccountType).toBeNull();
  });

  it('skips bank logo lookups for regular transactions and reuses transfer sides already on the page', async () => {
    const ownAccount = {
      ...bankAccount(accountId, 'banking_checking'),
      bankLinkAccountId: 'link-account' as Id<'bankLinkAccount'>,
    };
    const records = new Map<string, unknown>([
      [accountId, ownAccount],
      [pairAccountId, bankAccount(pairAccountId, 'credit_credit_card')],
    ]);
    const { ctx, get } = mockContext(records);
    await getTransactionFeedLookups(ctx, workspaceId, [transaction()]);
    expect(get.mock.calls.map(([id]) => id)).toEqual([accountId]);

    get.mockClear();
    const outgoing = transaction({ type: 'transfer', transferPairId: 'pair' as Id<'transaction'> });
    const incoming = transaction({
      _id: 'pair' as Id<'transaction'>,
      type: 'transfer',
      transferPairId: outgoing._id,
      bankAccountId: pairAccountId,
      totalAmount: 1250n,
    });
    const lookups = await getTransactionFeedLookups(ctx, workspaceId, [outgoing, incoming]);
    expect(get).not.toHaveBeenCalledWith(outgoing._id);
    expect(get).not.toHaveBeenCalledWith(incoming._id);
    expect(toTransactionFeedItem(outgoing, lookups).isCreditCardPayment).toBe(true);
    expect(toTransactionFeedItem(incoming, lookups).isCreditCardPayment).toBe(true);
  });
  it('gives both physical transfer sides the same stable group ID', () => {
    const firstId = 'transaction-a' as Id<'transaction'>;
    const secondId = 'transaction-b' as Id<'transaction'>;
    const first = transaction({ _id: firstId, type: 'transfer', transferPairId: secondId });
    const second = transaction({ _id: secondId, type: 'transfer', transferPairId: firstId });

    expect(getTransferGroupId(first)).toBe(firstId);
    expect(getTransferGroupId(second)).toBe(firstId);
    const feedItems = toTransactionFeedItems([first, second], emptyLookups());
    expect(feedItems).toHaveLength(2);
    expect(feedItems.every((item) => item.categoryNames.length === 0)).toBe(true);
  });

  it('uses the transaction ID as the stable group for an unpaired transfer', () => {
    const item = transaction({ type: 'transfer' });

    expect(getTransferGroupId(item)).toBe(item._id);
    expect(getTransferGroupId(transaction())).toBeNull();
  });

  it('resolves merchant overrides, global fallback, account names, and category labels', () => {
    const merchantId = 'merchant-1' as Id<'merchant'>;
    const globalMerchantId = 'global-merchant-1' as Id<'globalMerchant'>;
    const categoryId = 'category-1' as Id<'category'>;
    const merchant = {
      _id: merchantId,
      _creationTime: 1,
      globalMerchantId,
      visualIdentityMode: 'icon',
      iconName: 'coffee',
      iconColorId: 'amber',
      workspaceId,
      isDeleted: false,
    } as Doc<'merchant'>;
    const globalMerchant = {
      _id: globalMerchantId,
      _creationTime: 1,
      name: 'Coffee House',
      logoUrl: 'https://example.com/coffee.png',
      isVerified: true,
      updatedAt: '2026-09-04',
    } as Doc<'globalMerchant'>;
    const account = {
      _id: accountId,
      _creationTime: 1,
      name: 'Daily spending',
      accountType: 'banking_checking',
      workspaceId,
      isDeleted: false,
    } as Doc<'bankAccount'>;
    const pairAccount = {
      ...account,
      _id: pairAccountId,
      name: 'Savings',
    } as Doc<'bankAccount'>;
    const category = {
      _id: categoryId,
      _creationTime: 1,
      name: 'Coffee',
      workspaceId,
      isDeleted: false,
    } as Doc<'category'>;
    const lookups = {
      ...emptyLookups(),
      merchants: new Map([[merchantId, merchant]]),
      globalMerchants: new Map([[globalMerchantId, globalMerchant]]),
      bankAccounts: new Map([
        [accountId, account],
        [pairAccountId, pairAccount],
      ]),
      categories: new Map([[categoryId, category]]),
    };
    const item = toTransactionFeedItem(
      transaction({
        merchantId,
        transferPairBankAccountId: pairAccountId,
        movements: [
          { categoryId, categoryName: 'Old Coffee Name', readyToAssign: false, amount: -500n, sortOrder: 0 },
          { categoryId, categoryName: 'Old Coffee Name', readyToAssign: false, amount: -500n, sortOrder: 1 },
          { readyToAssign: true, amount: -250n, sortOrder: 2 },
        ],
      }),
      lookups
    );

    expect(item).toMatchObject({
      merchantName: 'Coffee House',
      merchantLogoUrl: 'https://example.com/coffee.png',
      merchantVisualIdentityMode: 'icon',
      merchantIconName: 'coffee',
      merchantIconColorId: 'amber',
      bankAccountName: 'Daily spending',
      transferPairAccountName: 'Savings',
      categoryNames: ['Coffee', 'Ready to Assign'],
    });
  });

  it('falls back to imported and denormalized display names without related documents', () => {
    const missingCategoryId = 'missing-category' as Id<'category'>;
    const item = toTransactionFeedItem(
      transaction({
        importDetails: {
          provider: 'plaid',
          merchantName: 'Corner Store',
          date: '2026-09-04',
          amount: -1_250n,
        },
        movements: [
          {
            categoryId: missingCategoryId,
            categoryName: 'Archived category',
            readyToAssign: false,
            amount: -1_000n,
            sortOrder: 0,
          },
          { readyToAssign: false, amount: -250n, sortOrder: 1 },
        ],
        hasUncategorized: true,
      }),
      emptyLookups()
    );

    expect(item.merchantName).toBe('Corner Store');
    expect(item.merchantLogoUrl).toBeNull();
    expect(item.merchantVisualIdentityMode).toBeNull();
    expect(item.categoryNames).toEqual(['Archived category', 'Uncategorized']);
  });
});

describe('recorded schedule provenance', () => {
  it('preserves an actual schedule link for regular entries and both transfer directions', () => {
    const scheduledTransactionId = 'plan' as Id<'scheduledTransaction'>;
    for (const type of ['regular', 'transfer'] as const) {
      for (const totalAmount of [-100n, 100n]) {
        const item = toTransactionFeedItem(transaction({ type, totalAmount, scheduledTransactionId }), emptyLookups());
        expect(item.scheduledTransactionId).toBe(scheduledTransactionId);
      }
    }
  });

  it('does not infer plan provenance from an unlinked scheduled source', () => {
    expect(
      toTransactionFeedItem(transaction({ source: 'scheduled' }), emptyLookups()).scheduledTransactionId
    ).toBeNull();
    expect(toTransactionFeedItem(transaction(), emptyLookups()).scheduledTransactionId).toBeNull();
  });
});

describe('preloaded deletion budget feedback', () => {
  afterEach(() => vi.restoreAllMocks());
  const categoryId = 'dining' as Id<'category'>;
  const workspace = { _id: workspaceId, readyToAssign: 10_000n } as Doc<'workspace'>;
  function setup() {
    const lookups = emptyLookups();
    lookups.bankAccounts.set(accountId, bankAccount(accountId, 'banking_checking'));
    lookups.categories.set(categoryId, {
      _id: categoryId,
      name: 'Dining',
      workspaceId,
      categoryType: 'custom',
      isDeleted: false,
    } as Doc<'category'>);
    const read = vi
      .spyOn(budgetHelpers, 'getCalculatedBudgetForMonth')
      .mockImplementation(async (_ctx, _workspace, _category, yearMonth) => ({
        yearMonth,
        available: 2_000n,
        assignedAmount: 2_000n,
        spentAmount: 0n,
        carryover: 0n,
      }));
    return { lookups, read, ...mockContext(new Map()) };
  }

  it('preloads exact split category and RTA effects and shares reads across rows', async () => {
    const { ctx, lookups, read } = setup();
    const first = transaction({
      movements: [
        { categoryId, amount: -500n, readyToAssign: false, sortOrder: 0 },
        { categoryId, amount: -750n, readyToAssign: false, sortOrder: 1 },
        { amount: 300n, readyToAssign: true, sortOrder: 2 },
      ],
    });
    const second = transaction({
      _id: 'second' as Id<'transaction'>,
      movements: [{ categoryId, amount: 100n, readyToAssign: false, sortOrder: 0 }],
    });
    const previews = await getFeedDeletionBudgetChanges(ctx, workspace, [first, second], lookups);
    expect(previews.get(first._id)).toEqual([
      { categoryId, yearMonth: 202609, name: 'Dining', before: 2_000n, after: 3_250n },
      { name: 'Ready to Assign', before: 10_000n, after: 9_700n },
    ]);
    expect(previews.get(second._id)?.[0].after).toBe(1_900n);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('starts independent budget reads together and preserves split receipt ordering', async () => {
    const { ctx, lookups, read } = setup();
    const otherCategoryId = 'transport' as Id<'category'>;
    lookups.categories.set(otherCategoryId, {
      ...lookups.categories.get(categoryId)!,
      _id: otherCategoryId,
      name: 'Transport',
    });
    let releaseDining!: () => void;
    const blockedDining = new Promise<void>((resolve) => {
      releaseDining = resolve;
    });
    read.mockImplementation(async (_ctx, _workspace, category, yearMonth) => {
      if (category === categoryId) await blockedDining;
      return { yearMonth, available: 2_000n, assignedAmount: 2_000n, spentAmount: 0n, carryover: 0n };
    });
    const row = transaction({
      movements: [
        { categoryId, amount: -100n, readyToAssign: false, sortOrder: 0 },
        { categoryId: otherCategoryId, amount: -300n, readyToAssign: false, sortOrder: 1 },
        { categoryId, amount: -200n, readyToAssign: false, sortOrder: 2 },
        { readyToAssign: true, amount: 100n, sortOrder: 3 },
      ],
    });
    const pending = getFeedDeletionBudgetChanges(ctx, workspace, [row], lookups);
    try {
      await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    } finally {
      releaseDining();
    }
    expect((await pending).get(row._id)).toEqual([
      { categoryId, yearMonth: 202609, name: 'Dining', before: 2_000n, after: 2_300n },
      { categoryId: otherCategoryId, yearMonth: 202609, name: 'Transport', before: 2_000n, after: 2_300n },
      { name: 'Ready to Assign', before: 10_000n, after: 9_900n },
    ]);
  });

  it('combines transfer category changes across months after concurrent budget reads', async () => {
    const { ctx, lookups, read } = setup();
    const outgoing = transaction({
      type: 'transfer',
      transferPairId: 'pair' as Id<'transaction'>,
      date: '2026-08-31',
      movements: [{ categoryId, amount: -500n, readyToAssign: false, sortOrder: 0 }],
    });
    const incoming = transaction({
      _id: 'pair' as Id<'transaction'>,
      type: 'transfer',
      transferPairId: outgoing._id,
      date: '2026-09-01',
      movements: [{ categoryId, amount: 300n, readyToAssign: false, sortOrder: 0 }],
    });
    const previews = await getFeedDeletionBudgetChanges(ctx, workspace, [outgoing, incoming], lookups);
    expect(read).toHaveBeenCalledTimes(2);
    expect(previews.get(getTransferGroupId(outgoing)!)).toEqual([
      { categoryId, yearMonth: 202608, name: 'Dining', before: 2_000n, after: 2_500n },
      { categoryId, yearMonth: 202609, name: 'Dining', before: 2_000n, after: 2_200n },
    ]);
  });

  it.each(['credit_credit_card', 'loan_auto', 'investment_brokerage'] as const)(
    'does not invent RTA changes for %s',
    async (accountType) => {
      const { ctx, lookups } = setup();
      lookups.bankAccounts.set(accountId, bankAccount(accountId, accountType));
      const row = transaction({ movements: [{ amount: 100n, readyToAssign: true, sortOrder: 0 }] });
      expect((await getFeedDeletionBudgetChanges(ctx, workspace, [row], lookups)).get(row._id)).toEqual([]);
    }
  );

  it('includes a transfer counterpart outside the page and cancels same-budget RTA effects', async () => {
    const { lookups } = setup();
    lookups.bankAccounts.set(pairAccountId, bankAccount(pairAccountId, 'banking_savings'));
    const first = transaction({
      type: 'transfer',
      transferPairId: 'pair' as Id<'transaction'>,
      movements: [{ amount: -100n, readyToAssign: true, sortOrder: 0 }],
    });
    const pair = transaction({
      _id: 'pair' as Id<'transaction'>,
      type: 'transfer',
      transferPairId: first._id,
      bankAccountId: pairAccountId,
      movements: [{ amount: 100n, readyToAssign: true, sortOrder: 0 }],
    });
    const { ctx } = mockContext(new Map([[pair._id, pair]]));
    const rows = await getFeedDeletionTransactions(ctx, workspaceId, [first]);
    expect(rows).toEqual([first, pair]);
    expect((await getFeedDeletionBudgetChanges(ctx, workspace, rows, lookups)).get(getTransferGroupId(first)!)).toEqual(
      []
    );
    const foreign = mockContext(new Map([[pair._id, { ...pair, workspaceId: 'foreign' }]]));
    expect(await getFeedDeletionTransactions(foreign.ctx, workspaceId, [first])).toEqual([first]);
  });

  it('previews credit spending but not a credit starting balance and rejects foreign categories', async () => {
    const { ctx, lookups } = setup();
    lookups.bankAccounts.set(accountId, bankAccount(accountId, 'credit_credit_card'));
    const row = transaction({ movements: [{ categoryId, amount: -100n, readyToAssign: false, sortOrder: 0 }] });
    expect((await getFeedDeletionBudgetChanges(ctx, workspace, [row], lookups)).get(row._id)?.[0].after).toBe(2_100n);
    expect(
      (await getFeedDeletionBudgetChanges(ctx, workspace, [{ ...row, type: 'starting_balance' }], lookups)).get(row._id)
    ).toEqual([]);
    lookups.categories.set(categoryId, {
      ...lookups.categories.get(categoryId)!,
      workspaceId: 'foreign' as Id<'workspace'>,
    });
    expect((await getFeedDeletionBudgetChanges(ctx, workspace, [row], lookups)).get(row._id)).toEqual([]);
  });
});

describe('transfer suggestions in the feed', () => {
  it.each([69, 70, 95])('preselects only an available account with sufficient confidence: %s', (confidence) => {
    const lookups = emptyLookups();
    lookups.bankAccounts.set(pairAccountId, bankAccount(pairAccountId, 'banking_savings'));
    const item = toTransactionFeedItem(
      transaction({
        reviewStatus: 'needs_review',
        suggestedTransfer: {
          status: 'pending',
          transferConfidence: 90,
          accountConfidence: confidence,
          suggestedCounterpartAccountId: pairAccountId,
          detectionReason: 'Bank transfer',
        },
      }),
      lookups
    );
    expect(item.suggestedTransfer?.status).toBe('pending');
    expect(item.suggestedTransfer?.suggestedCounterpartAccountId).toBe(confidence >= 70 ? pairAccountId : undefined);
  });
  it.each(['closed', 'missing', 'rejected', 'reviewed'])(
    'does not offer unsafe or resolved suggestions: %s',
    (kind) => {
      const lookups = emptyLookups();
      if (kind !== 'missing')
        lookups.bankAccounts.set(pairAccountId, {
          ...bankAccount(pairAccountId, 'banking_savings'),
          isClosed: kind === 'closed',
        });
      const item = toTransactionFeedItem(
        transaction({
          reviewStatus: kind === 'reviewed' ? 'reviewed' : 'needs_review',
          suggestedTransfer: {
            status: kind === 'rejected' ? 'rejected' : 'pending',
            transferConfidence: 90,
            accountConfidence: 95,
            suggestedCounterpartAccountId: pairAccountId,
            detectionReason: 'Bank transfer',
          },
        }),
        lookups
      );
      expect(item.suggestedTransfer?.suggestedCounterpartAccountId).toBeUndefined();
      if (kind === 'rejected' || kind === 'reviewed') expect(item.suggestedTransfer).toBeUndefined();
    }
  );
});
