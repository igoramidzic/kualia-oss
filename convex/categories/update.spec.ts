import { describe, expect, it, vi } from 'vitest';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { moveCategoryToGroupImpl, updateCategoryImpl, updateCategorySortOrderImpl } from './update';

const workspaceId = 'workspace_1' as Id<'workspace'>;
const categoryGroupId = 'credit_cards' as Id<'categoryGroup'>;

function card(id: string, sortOrder: number, overrides: Partial<Doc<'category'>> = {}): Doc<'category'> {
  return {
    _id: id as Id<'category'>,
    _creationTime: 0,
    name: id,
    workspaceId,
    categoryGroupId,
    categoryType: 'credit_card',
    isSystemCategory: true,
    bankAccountId: `${id}_account` as Id<'bankAccount'>,
    isDeleted: false,
    sortOrder,
    ...overrides,
  };
}

function createContext(categories: Doc<'category'>[]) {
  const query = {
    withIndex: vi.fn().mockReturnThis(),
    filter: vi.fn().mockReturnThis(),
    collect: vi.fn(async () => categories.map((category) => ({ ...category }))),
  };
  const db = {
    get: vi.fn(async (id: Id<'category'>) => categories.find((category) => category._id === id) ?? null),
    query: vi.fn(() => query),
    patch: vi.fn(async (id: Id<'category'>, updates: Partial<Doc<'category'>>) => {
      const category = categories.find((candidate) => candidate._id === id);
      if (!category) throw new Error('Category not found');
      Object.assign(category, updates);
    }),
  };
  return { ctx: { db } as unknown as MutationCtx, db };
}

describe('updateCategorySortOrderImpl', () => {
  it.each([
    { position: 0, expected: ['card_3', 'card_1', 'card_2'] },
    { position: 1, expected: ['card_1', 'card_3', 'card_2'] },
    { position: 2, expected: ['card_1', 'card_2', 'card_3'] },
  ])('allows system credit card categories at position $position', async ({ position, expected }) => {
    const categories = [card('card_1', 0), card('card_2', 100), card('card_3', 200)];
    const before = { ...categories[2] };
    const { ctx, db } = createContext(categories);

    await expect(
      updateCategorySortOrderImpl(ctx, { workspaceId, categoryId: categories[2]._id, newPosition: position })
    ).resolves.toEqual({ success: true });

    expect([...categories].sort((a, b) => a.sortOrder - b.sortOrder).map((category) => category._id)).toEqual(expected);
    expect(categories[2]).toEqual({ ...before, sortOrder: expect.any(Number), updatedAt: expect.any(String) });
    expect(db.patch).toHaveBeenCalledExactlyOnceWith(before._id, {
      sortOrder: categories[2].sortOrder,
      updatedAt: expect.any(String),
    });
  });

  it('restructures tightly spaced credit card categories after a move', async () => {
    const categories = [card('card_1', 0), card('card_2', 10), card('card_3', 200)];
    const { ctx } = createContext(categories);

    await updateCategorySortOrderImpl(ctx, { workspaceId, categoryId: categories[2]._id, newPosition: 1 });

    expect(
      [...categories].sort((a, b) => a.sortOrder - b.sortOrder).map(({ _id, sortOrder }) => [_id, sortOrder])
    ).toEqual([
      ['card_1', 0],
      ['card_3', 100],
      ['card_2', 200],
    ]);
  });

  it.each(['owner_investment', 'revenue', 'credit_card_payment', undefined] as const)(
    'still rejects system categories of type %s',
    async (categoryType) => {
      const category = card('system', 0, { categoryType });
      const { ctx, db } = createContext([category]);

      await expect(
        updateCategorySortOrderImpl(ctx, { workspaceId, categoryId: category._id, newPosition: 0 })
      ).rejects.toThrow('Cannot update system categories');
      expect(db.patch).not.toHaveBeenCalled();
    }
  );

  it.each([{ workspaceId: 'workspace_2' as Id<'workspace'> }, { isDeleted: true }])(
    'rejects inaccessible credit card categories: %j',
    async (overrides) => {
      const category = card('card_1', 0, overrides);
      const { ctx, db } = createContext([category]);

      await expect(
        updateCategorySortOrderImpl(ctx, { workspaceId, categoryId: category._id, newPosition: 0 })
      ).rejects.toThrow('Category not found or does not belong to workspace');
      expect(db.patch).not.toHaveBeenCalled();
    }
  );

  it('keeps system credit card editing and cross-group movement protected', async () => {
    const category = card('card_1', 0);
    const { ctx, db } = createContext([category]);

    await expect(
      updateCategoryImpl(ctx, {
        workspaceId,
        categoryId: category._id,
        name: 'Renamed',
        attribution: { clerkId: 'owner', source: { type: 'kualia_ui' } },
      })
    ).rejects.toThrow('Cannot update system categories');
    await expect(
      moveCategoryToGroupImpl(ctx, {
        workspaceId,
        categoryId: category._id,
        targetGroupId: 'expenses' as Id<'categoryGroup'>,
        newPosition: 0,
      })
    ).rejects.toThrow('Cannot move system categories');
    expect(db.patch).not.toHaveBeenCalled();
  });
});
