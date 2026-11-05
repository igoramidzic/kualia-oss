import { describe, expect, it } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { setBankAccountFavoriteForUser } from '../bankAccounts/favorites';
import { setCategoryFavoriteForUser } from './favorites';

type FavoriteRecord = Record<string, unknown> & { _id: string };
type FavoriteTable = 'categoryFavorite' | 'bankAccountFavorite';

class FakeIndexBuilder {
  readonly filters: Array<{ field: string; value: unknown }> = [];

  eq(field: string, value: unknown): FakeIndexBuilder {
    this.filters.push({ field, value });
    return this;
  }
}

class FakeQuery {
  constructor(
    private readonly records: FavoriteRecord[],
    private readonly filters: Array<{ field: string; value: unknown }> = []
  ) {}

  withIndex(_indexName: string, callback: (builder: FakeIndexBuilder) => FakeIndexBuilder): FakeQuery {
    const builder = new FakeIndexBuilder();
    callback(builder);
    return new FakeQuery(this.records, builder.filters);
  }

  async unique(): Promise<FavoriteRecord | null> {
    const matching = this.records.filter((record) => this.filters.every(({ field, value }) => record[field] === value));
    if (matching.length > 1) throw new Error('Expected a unique favorite');
    return matching[0] ?? null;
  }
}

class FakeDb {
  readonly records: Record<FavoriteTable, FavoriteRecord[]> = {
    categoryFavorite: [],
    bankAccountFavorite: [],
  };

  query(table: FavoriteTable): FakeQuery {
    return new FakeQuery(this.records[table]);
  }

  async insert(table: FavoriteTable, value: Record<string, unknown>): Promise<string> {
    const id = `${table}_${this.records[table].length + 1}`;
    this.records[table].push({ _id: id, ...value });
    return id;
  }

  async patch(id: string, updates: Record<string, unknown>): Promise<void> {
    const record = Object.values(this.records)
      .flat()
      .find((candidate) => candidate._id === id);
    if (!record) throw new Error(`Missing favorite ${id}`);
    Object.assign(record, updates);
  }
}

function createContext(): { ctx: MutationCtx; db: FakeDb } {
  const db = new FakeDb();
  return { ctx: { db } as unknown as MutationCtx, db };
}

describe('favorite persistence', () => {
  it('restores the same category favorite row after unfavoriting', async () => {
    const { ctx, db } = createContext();
    const userProfileId = 'profile_1' as Id<'userProfile'>;
    const workspaceId = 'workspace_1' as Id<'workspace'>;
    const categoryId = 'category_1' as Id<'category'>;

    await setCategoryFavoriteForUser(ctx, userProfileId, workspaceId, categoryId, true);
    await setCategoryFavoriteForUser(ctx, userProfileId, workspaceId, categoryId, false);
    await setCategoryFavoriteForUser(ctx, userProfileId, workspaceId, categoryId, true);

    expect(db.records.categoryFavorite).toHaveLength(1);
    expect(db.records.categoryFavorite[0]).toMatchObject({
      userProfileId,
      workspaceId,
      categoryId,
      isDeleted: false,
      deletedAt: undefined,
    });
  });

  it('does not create a bank account favorite when unfavoriting a missing row', async () => {
    const { ctx, db } = createContext();

    await setBankAccountFavoriteForUser(
      ctx,
      'profile_1' as Id<'userProfile'>,
      'workspace_1' as Id<'workspace'>,
      'bank_account_1' as Id<'bankAccount'>,
      false
    );

    expect(db.records.bankAccountFavorite).toEqual([]);
  });
});
