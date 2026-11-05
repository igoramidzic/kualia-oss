import type { FunctionArgs, FunctionReturnType } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { api, internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import {
  archiveCategories as registeredArchiveCategories,
  updateCategory as registeredUpdateCategory,
} from '../categories/update';
import { updateWorkspaceReadyToAssign as registeredUpdateReadyToAssign } from '../workspaces/update';
import {
  countOverspentCategoriesForWorkspace,
  listBudgetDataByMonth as registeredListBudgetDataByMonth,
  listBudgetStructure as registeredListBudgetStructure,
} from './queries';
import {
  batchUpdateCategoryBudgets as registeredBatchUpdate,
  upsertCategoryBudget as registeredUpsertCategoryBudget,
} from './update';

// Exercise the registered handlers with the repository's in-memory unit-test context.
// Convex exposes _handler at runtime but removes this internal property from its public declarations.
function testFunction<Args, Result>(registered: unknown) {
  return registered as { _handler: (ctx: MutationCtx, args: Args) => Promise<Result> };
}

const listBudgetStructure = testFunction<
  FunctionArgs<typeof api.categoryBudgets.listBudgetStructure>,
  FunctionReturnType<typeof api.categoryBudgets.listBudgetStructure>
>(registeredListBudgetStructure);
const listBudgetDataByMonth = testFunction<
  FunctionArgs<typeof api.categoryBudgets.listBudgetDataByMonth>,
  FunctionReturnType<typeof api.categoryBudgets.listBudgetDataByMonth>
>(registeredListBudgetDataByMonth);
const upsertCategoryBudget = testFunction<
  FunctionArgs<typeof api.categoryBudgets.upsertCategoryBudget>,
  FunctionReturnType<typeof api.categoryBudgets.upsertCategoryBudget>
>(registeredUpsertCategoryBudget);
const updateWorkspaceReadyToAssign = testFunction<
  FunctionArgs<typeof internal.workspaces.updateWorkspaceReadyToAssign>,
  FunctionReturnType<typeof internal.workspaces.updateWorkspaceReadyToAssign>
>(registeredUpdateReadyToAssign);

const workspaceId = 'workspace-1' as Id<'workspace'>;
const foreignWorkspaceId = 'workspace-2' as Id<'workspace'>;
const groupId = 'group-1' as Id<'categoryGroup'>;
const categoryId = 'category-1' as Id<'category'>;

function group(overrides: Partial<Doc<'categoryGroup'>> = {}): Doc<'categoryGroup'> {
  return {
    _id: groupId,
    _creationTime: 1,
    workspaceId,
    name: 'Everyday',
    type: 'expense',
    sortOrder: 0,
    isDeleted: false,
    ...overrides,
  };
}

function category(overrides: Partial<Doc<'category'>> = {}): Doc<'category'> {
  return {
    _id: categoryId,
    _creationTime: 1,
    workspaceId,
    categoryGroupId: groupId,
    name: 'Groceries',
    sortOrder: 0,
    isDeleted: false,
    ...overrides,
  };
}

type TestRow = Record<string, unknown> & { _id: string };
type Predicate = (row: TestRow) => boolean;
type Field = (row: TestRow) => unknown;

function setup(
  options: {
    signedIn?: boolean;
    activeWorkspaceId?: Id<'workspace'> | null;
    profileDeleted?: boolean;
    workspace?: Partial<Doc<'workspace'>>;
    groups?: Doc<'categoryGroup'>[];
    categories?: Doc<'category'>[];
    budgets?: Doc<'categoryBudget'>[];
  } = {}
) {
  const workspace: Doc<'workspace'> = {
    _id: workspaceId,
    _creationTime: 1,
    name: 'Personal',
    ownerClerkId: 'user-1',
    transactionDefaultPendingStatus: false,
    readyToAssign: 10_000n,
    currency: 'usd',
    timezone: 'America/New_York',
    ...options.workspace,
  };
  const profile: Doc<'userProfile'> = {
    _id: 'profile-1' as Id<'userProfile'>,
    _creationTime: 1,
    clerkId: 'user-1',
    email: 'test@example.com',
    onboardingCompleted: true,
    activeWorkspaceId: options.activeWorkspaceId === null ? undefined : (options.activeWorkspaceId ?? workspaceId),
    isDeleted: options.profileDeleted,
  };
  const tables = new Map<string, TestRow[]>([
    ['workspace', [workspace, { ...workspace, _id: foreignWorkspaceId, ownerClerkId: 'user-2' }]],
    ['userProfile', [profile]],
    ['categoryGroup', options.groups ?? [group()]],
    ['category', options.categories ?? [category()]],
    ['categoryBudget', options.budgets ?? []],
    ['activityLog', []],
  ]);
  const findRecord = (id: string) => [...tables.values()].flat().find((row) => row._id === id) ?? null;
  const query = vi.fn((tableName: string) => {
    const predicates: Predicate[] = [];
    const range = {
      eq: (field: string, value: unknown) => {
        predicates.push((row) => row[field] === value);
        return range;
      },
    };
    const filter = {
      field:
        (name: string): Field =>
        (row) =>
          row[name],
      eq:
        (field: Field, value: unknown): Predicate =>
        (row) =>
          field(row) === value,
      neq:
        (field: Field, value: unknown): Predicate =>
        (row) =>
          field(row) !== value,
      and:
        (...conditions: Predicate[]): Predicate =>
        (row) =>
          conditions.every((condition) => condition(row)),
    };
    const results = () => (tables.get(tableName) ?? []).filter((row) => predicates.every((test) => test(row)));
    const builder = {
      withIndex: (_name: string, build: (q: typeof range) => unknown) => {
        build(range);
        return builder;
      },
      filter: (build: (q: typeof filter) => Predicate) => {
        predicates.push(build(filter));
        return builder;
      },
      collect: async () => results(),
      first: async () => results()[0] ?? null,
    };
    return builder;
  });
  const patch = vi.fn(async (id: string, changes: Record<string, unknown>) => {
    const row = findRecord(id);
    if (!row) throw new Error(`Missing record ${id}`);
    Object.assign(row, changes);
  });
  const insert = vi.fn(async (tableName: string, fields: Record<string, unknown>) => {
    const rows = tables.get(tableName) ?? [];
    const id = `${tableName}-${rows.length + 1}`;
    rows.push({ ...fields, _id: id, _creationTime: 1 });
    tables.set(tableName, rows);
    return id;
  });
  const ctx = {
    auth: { getUserIdentity: async () => (options.signedIn === false ? null : { subject: 'user-1' }) },
    db: { get: async (id: string) => findRecord(id), query, patch, insert },
    runMutation: vi.fn(async (_reference: unknown, args: { workspaceId: Id<'workspace'>; amountDelta: bigint }) =>
      updateWorkspaceReadyToAssign._handler(ctx, args)
    ),
  } as unknown as MutationCtx;

  return { ctx, tables, query, patch, insert, workspace };
}

describe('compact budget page structure', () => {
  it('uses the linked account name for credit card categories and follows account renames', async () => {
    const bankAccountId = 'account-card' as Id<'bankAccount'>;
    const { ctx, tables } = setup({
      groups: [group({ type: 'credit_card' })],
      categories: [category({ name: 'CC', bankAccountId })],
    });
    const account = { _id: bankAccountId, workspaceId, name: 'Chase Sapphire', isDeleted: false };
    tables.set('bankAccount', [account]);
    const result = await listBudgetStructure._handler(ctx, {});
    expect(result.categoryGroups[0].categories[0].name).toBe('Chase Sapphire');
    account.name = 'Travel Card';
    expect((await listBudgetStructure._handler(ctx, {})).categoryGroups[0].categories[0].name).toBe('Travel Card');
    expect(tables.get('category')?.[0].name).toBe('CC');
  });

  it.each(['missing', 'deleted', 'foreign', 'unlinked', 'expense'])(
    'keeps the category name when the account is %s',
    async (scenario) => {
      const bankAccountId = 'account-card' as Id<'bankAccount'>;
      const { ctx, tables } = setup({
        groups: [group({ type: scenario === 'expense' ? 'expense' : 'credit_card' })],
        categories: [
          category({ name: 'Original', bankAccountId: scenario === 'unlinked' ? undefined : bankAccountId }),
        ],
      });
      if (scenario !== 'missing') {
        tables.set('bankAccount', [
          {
            _id: bankAccountId,
            workspaceId: scenario === 'foreign' ? foreignWorkspaceId : workspaceId,
            name: 'Account Name',
            isDeleted: scenario === 'deleted',
          },
        ]);
      }
      expect((await listBudgetStructure._handler(ctx, {})).categoryGroups[0].categories[0].name).toBe('Original');
    }
  );

  it('loads the active workspace, normalizes currency and omits assignment/spending history', async () => {
    const { ctx, query } = setup({
      categories: [
        category({
          iconName: 'ShoppingBasket',
          monthlySpending: { '202609': { inflowAmount: 0n, outflowAmount: 700n } },
          creditMonthlySpending: {},
          transactionCount: 90n,
          target_amount: 5_000n,
        }),
      ],
    });
    const result = await listBudgetStructure._handler(ctx, {});
    expect(result.workspace).toEqual({
      id: workspaceId,
      name: 'Personal',
      currencyCode: 'USD',
      minorUnit: 2,
      timezoneIdentifier: 'America/New_York',
    });
    expect(result.categoryGroups[0].categories[0]).toEqual({
      _id: categoryId,
      _creationTime: 1,
      name: 'Groceries',
      iconName: 'ShoppingBasket',
      type: 'expense',
      updatedAt: undefined,
    });
    expect(query.mock.calls.map(([table]) => table)).not.toContain('categoryBudget');
    expect(query.mock.calls.map(([table]) => table)).not.toContain('transaction');
  });

  it('keeps empty expense groups, filters unavailable categories and sorts groups and categories', async () => {
    const cardGroupId = 'group-card' as Id<'categoryGroup'>;
    const deletedGroupId = 'group-deleted' as Id<'categoryGroup'>;
    const { ctx } = setup({
      groups: [
        group({ name: 'Zulu', sortOrder: 2 }),
        group({ _id: 'group-empty' as Id<'categoryGroup'>, name: 'Alpha', sortOrder: 2 }),
        group({ _id: cardGroupId, type: 'credit_card', sortOrder: 1 }),
        group({ _id: 'group-card-empty' as Id<'categoryGroup'>, type: 'credit_card' }),
        group({ _id: deletedGroupId, isDeleted: true }),
        group({ _id: 'foreign-group' as Id<'categoryGroup'>, workspaceId: foreignWorkspaceId }),
      ],
      categories: [
        category({ _id: 'z' as Id<'category'>, name: 'Zulu', sortOrder: 1 }),
        category({ _id: 'a' as Id<'category'>, name: 'Alpha', sortOrder: 1 }),
        category({ _id: 'first' as Id<'category'>, name: 'First', sortOrder: 0, isArchived: false }),
        category({ _id: 'archived' as Id<'category'>, isArchived: true }),
        category({ _id: 'deleted' as Id<'category'>, isDeleted: true }),
        category({ _id: 'orphaned' as Id<'category'>, categoryGroupId: deletedGroupId }),
        category({ _id: 'foreign' as Id<'category'>, workspaceId: foreignWorkspaceId, isSystemCategory: true }),
        category({ _id: 'card' as Id<'category'>, categoryGroupId: cardGroupId, isSystemCategory: true }),
      ],
    });
    const result = await listBudgetStructure._handler(ctx, { workspaceId });
    expect(result.categoryGroups.map(({ categoryGroup }) => categoryGroup._id)).toEqual([
      cardGroupId,
      'group-empty',
      groupId,
    ]);
    expect(result.categoryGroups[0].categories[0]).toMatchObject({ type: 'credit_card', iconName: 'CreditCard' });
    expect(result.categoryGroups[1].categories).toEqual([]);
    expect(result.categoryGroups[2].categories.map(({ name }) => name)).toEqual(['First', 'Alpha', 'Zulu']);
  });

  it('returns an empty state when no active workspace is selected', async () => {
    const { ctx } = setup({ activeWorkspaceId: null });
    expect(await listBudgetStructure._handler(ctx, {})).toEqual({ workspace: null, categoryGroups: [] });
  });

  it('continues to accept an explicit workspace when none is selected', async () => {
    const { ctx } = setup({ activeWorkspaceId: null, workspace: { currency: 'jpy', timezone: undefined } });
    const result = await listBudgetStructure._handler(ctx, { workspaceId });
    expect(result.workspace).toMatchObject({
      id: workspaceId,
      currencyCode: 'JPY',
      minorUnit: 0,
      timezoneIdentifier: null,
    });
  });

  it('requires authentication and rejects deleted profiles and foreign active workspaces', async () => {
    await expect(listBudgetStructure._handler(setup({ signedIn: false }).ctx, {})).rejects.toThrow(
      'Authentication required'
    );
    await expect(listBudgetStructure._handler(setup({ profileDeleted: true }).ctx, {})).rejects.toThrow(
      'User profile not found'
    );
    await expect(
      listBudgetStructure._handler(setup({ activeWorkspaceId: foreignWorkspaceId }).ctx, {})
    ).rejects.toThrow('Access denied');
    await expect(listBudgetStructure._handler(setup().ctx, { workspaceId: foreignWorkspaceId })).rejects.toThrow(
      'Access denied'
    );
  });
});

describe('budget page assignments', () => {
  const args = { workspaceId, categoryId, yearMonth: 202609n, assignedAmount: 2_000n };

  it('preserves absolute assignment, negative/zero semantics and cumulative ready-to-assign', async () => {
    const { ctx, tables, workspace } = setup();
    expect(await upsertCategoryBudget._handler(ctx, args)).toEqual({
      success: true,
      previousAssignedAmount: 0n,
      assignedAmount: 2_000n,
      readyToAssignDelta: -2_000n,
      createdBudgetRow: true,
    });
    expect(workspace.readyToAssign).toBe(8_000n);

    await upsertCategoryBudget._handler(ctx, { ...args, yearMonth: 202610n, assignedAmount: 1_000n });
    await upsertCategoryBudget._handler(ctx, { ...args, assignedAmount: -500n });
    expect(workspace.readyToAssign).toBe(9_500n);
    expect(tables.get('categoryBudget')?.[0].monthlyAssignedAmounts).toEqual({ '202609': -500n, '202610': 1_000n });

    await upsertCategoryBudget._handler(ctx, { ...args, assignedAmount: 0n });
    expect(workspace.readyToAssign).toBe(9_000n);
    expect(tables.get('categoryBudget')?.[0].monthlyAssignedAmounts).toEqual({ '202610': 1_000n });
    expect(tables.get('activityLog')).toHaveLength(4);
  });

  it('does not subtract twice or log a second movement when saving the same absolute amount', async () => {
    const { ctx, tables, workspace } = setup();
    await upsertCategoryBudget._handler(ctx, args);
    const result = await upsertCategoryBudget._handler(ctx, args);
    expect(result.readyToAssignDelta).toBe(0n);
    expect(workspace.readyToAssign).toBe(8_000n);
    expect(tables.get('activityLog')).toHaveLength(1);
  });

  it.each([
    { workspaceId: foreignWorkspaceId },
    { workspaceId: foreignWorkspaceId, isSystemCategory: true },
    { workspaceId: undefined, isSystemCategory: true },
    { isDeleted: true },
    { isArchived: true },
  ])('rejects inaccessible categories before any writes: %j', async (overrides) => {
    const { ctx, insert, patch } = setup({ categories: [category(overrides)] });
    await expect(upsertCategoryBudget._handler(ctx, args)).rejects.toThrow();
    expect(insert).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it('allows workspace-owned system categories', async () => {
    const { ctx } = setup({ categories: [category({ isSystemCategory: true })] });
    expect(await upsertCategoryBudget._handler(ctx, args)).toMatchObject({ success: true, assignedAmount: 2_000n });
  });

  it.each([0n, 202600n, 202613n, -202609n, 9_223_372_036_854_775_807n])(
    'rejects invalid month %s before writes',
    async (yearMonth) => {
      const { ctx, insert, patch } = setup();
      await expect(upsertCategoryBudget._handler(ctx, { ...args, yearMonth })).rejects.toThrow('YYYYMM');
      expect(insert).not.toHaveBeenCalled();
      expect(patch).not.toHaveBeenCalled();
    }
  );

  it('requires authentication and workspace access for edits', async () => {
    await expect(upsertCategoryBudget._handler(setup({ signedIn: false }).ctx, args)).rejects.toThrow(
      'Authentication required'
    );
    await expect(
      upsertCategoryBudget._handler(setup().ctx, { ...args, workspaceId: foreignWorkspaceId })
    ).rejects.toThrow('Access denied');
  });
});

describe('budget target due dates', () => {
  it.each(['active', 'snoozed', 'archived', 'disabled'] as const)(
    'returns a deadline only for an active target: %s',
    async (state) => {
      const { ctx } = setup({
        categories: [
          category({
            enableTarget: state !== 'disabled',
            isArchived: state === 'archived',
            target_type: 'recurring',
            target_amount: 3_000n,
            target_frequency: 'monthly',
            target_frequencyInterval: 1,
            target_firstDueDate: '2025-01-15',
          }),
        ],
        budgets: [
          {
            _id: 'budget-1' as Id<'categoryBudget'>,
            _creationTime: 1,
            categoryId,
            workspaceId,
            monthlyAssignedAmounts: {},
            updatedAt: '2026-09-01T00:00:00Z',
            snoozedTargetMonths: state === 'snoozed' ? { '202609': true } : undefined,
          },
        ],
      });
      const data = await listBudgetDataByMonth._handler(ctx, { workspaceId, currentYearMonth: 202609n });
      const target = data.months.find((month) => month.yearMonth === 202609)?.budgetData[categoryId]?.target;
      expect(target).toBeDefined();
      expect(target?.dueDate).toBe(state === 'active' ? '2026-09-15' : undefined);
    }
  );
});

describe('navigation overspending calculation', () => {
  it('matches the full budget summary across carryover, archived and credit card categories without reading workspace metadata', async () => {
    const creditId = 'credit-category' as Id<'category'>;
    const archivedId = 'archived-category' as Id<'category'>;
    const deletedId = 'deleted-category' as Id<'category'>;
    const { ctx } = setup({
      categories: [
        category({ monthlySpending: { '202601': { inflowAmount: 0n, outflowAmount: 150n } } }),
        category({
          _id: archivedId,
          isArchived: true,
          monthlySpending: { '202609': { inflowAmount: 0n, outflowAmount: 25n } },
        }),
        category({
          _id: creditId,
          categoryType: 'credit_card',
          creditMonthlySpending: {
            '202601': { priorBalance: -500n, spendingAmount: 100n, paymentsAmount: 0n, refundedSpending: 0n },
            '202609': { priorBalance: 0n, spendingAmount: 0n, paymentsAmount: 150n, refundedSpending: 0n },
          },
        }),
        category({
          _id: deletedId,
          isDeleted: true,
          monthlySpending: { '202609': { inflowAmount: 0n, outflowAmount: 500n } },
        }),
        category({
          _id: 'foreign-category' as Id<'category'>,
          workspaceId: foreignWorkspaceId,
          monthlySpending: { '202609': { inflowAmount: 0n, outflowAmount: 500n } },
        }),
      ],
      budgets: [
        {
          _id: 'budget-1' as Id<'categoryBudget'>,
          _creationTime: 1,
          workspaceId,
          categoryId,
          updatedAt: '2026-01-01T00:00:00Z',
          monthlyAssignedAmounts: { '202601': 100n, '202610': 1000n },
        },
      ],
    });
    const full = await listBudgetDataByMonth._handler(ctx, { workspaceId, currentYearMonth: 202609n });
    const metadataReads = vi.spyOn(ctx.db, 'get');
    const count = await countOverspentCategoriesForWorkspace(ctx, workspaceId, 202609);
    expect(count).toBe(3);
    expect(count).toBe(full.months.find((month) => month.yearMonth === 202609)?.summary.overspentCategoryCount);
    expect(metadataReads).not.toHaveBeenCalled();
  });

  it.each([202601, 202609, 202701])(
    'preserves the full budget range rules with no assignments in %s',
    async (currentMonth) => {
      const { ctx } = setup({
        categories: [
          category({
            monthlySpending: {
              '202501': { inflowAmount: 0n, outflowAmount: 999n },
              '202608': { inflowAmount: 100n, outflowAmount: 0n },
              '202609': { inflowAmount: 0n, outflowAmount: 150n },
              '202612': { inflowAmount: 500n, outflowAmount: 0n },
            },
          }),
        ],
      });
      const full = await listBudgetDataByMonth._handler(ctx, { workspaceId, currentYearMonth: BigInt(currentMonth) });
      expect(await countOverspentCategoriesForWorkspace(ctx, workspaceId, currentMonth)).toBe(
        full.months.find((month) => month.yearMonth === currentMonth)?.summary.overspentCategoryCount
      );
    }
  );
});

const archiveCategories = testFunction<
  FunctionArgs<typeof api.categories.archiveCategories>,
  FunctionReturnType<typeof api.categories.archiveCategories>
>(registeredArchiveCategories);
const updateCategory = testFunction<
  FunctionArgs<typeof api.categories.updateCategory>,
  FunctionReturnType<typeof api.categories.updateCategory>
>(registeredUpdateCategory);
const batchUpdate = testFunction<
  FunctionArgs<typeof api.categoryBudgets.batchUpdateCategoryBudgets>,
  FunctionReturnType<typeof api.categoryBudgets.batchUpdateCategoryBudgets>
>(registeredBatchUpdate);

function archiveBudget(monthlyAssignedAmounts: Record<string, bigint>): Doc<'categoryBudget'> {
  return {
    _id: 'archive-budget' as Id<'categoryBudget'>,
    _creationTime: 1,
    categoryId,
    workspaceId,
    monthlyAssignedAmounts,
    updatedAt: '2026-09-01T00:00:00Z',
  };
}

describe('category archive budget release', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-11T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it.each(['archive', 'update'] as const)(
    'returns unspent carryover and future assignments through %s',
    async (route) => {
      const spending = { '202609': { inflowAmount: 0n, outflowAmount: 4_000n } };
      const { ctx, tables, workspace } = setup({
        categories: [category({ monthlySpending: spending, transactionCount: 1n, target_amount: 12_000n })],
        budgets: [archiveBudget({ '202001': 5_000n, '202609': 10_000n, '202610': 3_000n, '202801': 2_000n })],
      });
      if (route === 'archive') {
        await archiveCategories._handler(ctx, { workspaceId, categoryIds: [categoryId, categoryId], isArchived: true });
      } else {
        await updateCategory._handler(ctx, { workspaceId, categoryId, isArchived: true });
      }
      // 11,000 available now plus 5,000 future assignments; spent funds are not released.
      expect(workspace.readyToAssign).toBe(26_000n);
      expect(tables.get('categoryBudget')?.[0].monthlyAssignedAmounts).toEqual({ '202001': 5_000n, '202609': -1_000n });
      expect(tables.get('category')?.[0]).toMatchObject({
        isArchived: true,
        monthlySpending: spending,
        transactionCount: 1n,
        target_amount: 12_000n,
      });
      expect((await listBudgetStructure._handler(ctx, { workspaceId })).categoryGroups[0].categories).toEqual([]);
      expect(tables.get('activityLog')?.filter((row) => row.type === 'money_moved')).toHaveLength(3);

      await archiveCategories._handler(ctx, { workspaceId, categoryIds: [categoryId], isArchived: true });
      expect(workspace.readyToAssign).toBe(26_000n);
      await archiveCategories._handler(ctx, { workspaceId, categoryIds: [categoryId], isArchived: false });
      expect(workspace.readyToAssign).toBe(26_000n);
      expect((await listBudgetStructure._handler(ctx, { workspaceId })).categoryGroups[0].categories[0]._id).toBe(
        categoryId
      );
      const data = await listBudgetDataByMonth._handler(ctx, { workspaceId, currentYearMonth: 202609n });
      expect(data.months.find((month) => month.yearMonth === 202609)?.budgetData[categoryId]?.available).toBe(0n);
    }
  );

  it('returns category inflows even without a budget row', async () => {
    const { ctx, tables, workspace } = setup({
      categories: [category({ monthlySpending: { '202609': { inflowAmount: 700n, outflowAmount: 200n } } })],
    });
    await archiveCategories._handler(ctx, { workspaceId, categoryIds: [categoryId], isArchived: true });
    expect(workspace.readyToAssign).toBe(10_500n);
    expect(tables.get('categoryBudget')?.[0].monthlyAssignedAmounts).toEqual({ '202609': -500n });
  });

  it('preserves overspending and releases future assignments with their signed deltas', async () => {
    const { ctx, tables, workspace } = setup({
      categories: [category({ monthlySpending: { '202609': { inflowAmount: 0n, outflowAmount: 2_000n } } })],
      budgets: [archiveBudget({ '202609': 1_000n, '202610': 300n, '202611': -100n })],
    });
    await archiveCategories._handler(ctx, { workspaceId, categoryIds: [categoryId], isArchived: true });
    expect(workspace.readyToAssign).toBe(10_200n);
    expect(tables.get('categoryBudget')?.[0].monthlyAssignedAmounts).toEqual({ '202609': 1_000n });
  });

  it('uses the workspace month at a year boundary', async () => {
    vi.setSystemTime(new Date('2027-01-01T01:00:00Z'));
    const { ctx, tables, workspace } = setup({
      categories: [category({ monthlySpending: { '202612': { inflowAmount: 0n, outflowAmount: 400n } } })],
      budgets: [archiveBudget({ '202612': 1_000n, '202701': 2_000n })],
    });
    await archiveCategories._handler(ctx, { workspaceId, categoryIds: [categoryId], isArchived: true });
    expect(workspace.readyToAssign).toBe(12_600n);
    expect(tables.get('categoryBudget')?.[0].monthlyAssignedAmounts).toEqual({ '202612': 400n });
  });

  it.each([
    { workspaceId: foreignWorkspaceId },
    { isDeleted: true },
    { isSystemCategory: true },
    { categoryType: 'credit_card' as const },
  ])('validates the full batch before releasing any money: %j', async (invalid) => {
    const otherId = 'invalid-category' as Id<'category'>;
    const { ctx, patch, workspace } = setup({
      categories: [category(), category({ _id: otherId, ...invalid })],
      budgets: [archiveBudget({ '202609': 1_000n })],
    });
    await expect(
      archiveCategories._handler(ctx, { workspaceId, categoryIds: [categoryId, otherId], isArchived: true })
    ).rejects.toThrow();
    expect(workspace.readyToAssign).toBe(10_000n);
    expect(patch).not.toHaveBeenCalled();
  });

  it('requires workspace access', async () => {
    await expect(
      archiveCategories._handler(setup({ signedIn: false }).ctx, {
        workspaceId,
        categoryIds: [categoryId],
        isArchived: true,
      })
    ).rejects.toThrow('Authentication required');
    await expect(
      archiveCategories._handler(setup().ctx, {
        workspaceId: foreignWorkspaceId,
        categoryIds: [categoryId],
        isArchived: true,
      })
    ).rejects.toThrow();
  });

  it('rejects assignments arriving after an archive, including the batch path', async () => {
    const { ctx, workspace } = setup();
    await archiveCategories._handler(ctx, { workspaceId, categoryIds: [categoryId], isArchived: true });
    await expect(
      upsertCategoryBudget._handler(ctx, { workspaceId, categoryId, yearMonth: 202609n, assignedAmount: 500n })
    ).rejects.toThrow('Archived categories cannot be assigned money');
    await expect(
      batchUpdate._handler(ctx, { workspaceId, yearMonth: 202610, updates: [{ categoryId, assignedAmount: 500n }] })
    ).rejects.toThrow('Archived categories cannot be assigned money');
    expect(workspace.readyToAssign).toBe(10_000n);
  });
});
