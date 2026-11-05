import { describe, expect, it } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

import { batchResolveMerchantNames, getOrCreateMerchantByName } from './helpers';

const WS = 'workspace_1' as Id<'workspace'>;
const OTHER_WS = 'workspace_2' as Id<'workspace'>;

type TableName = 'merchant' | 'globalMerchant';
type FakeRecord = Record<string, unknown> & { _id: string };
type FakeFilter = { field: string; value: unknown };

class FakeIndexBuilder {
  readonly filters: FakeFilter[] = [];
  eq(field: string, value: unknown): FakeIndexBuilder {
    this.filters.push({ field, value });
    return this;
  }
}

class FakeFilterBuilder {
  readonly filters: FakeFilter[] = [];
  field(fieldName: string): string {
    return fieldName;
  }
  eq(field: string, value: unknown): FakeFilterBuilder {
    this.filters.push({ field, value });
    return this;
  }
}

class FakeQuery {
  private readonly filters: FakeFilter[];
  constructor(
    private readonly records: FakeRecord[],
    filters: FakeFilter[]
  ) {
    this.filters = [...filters];
  }

  filter(cb: (q: FakeFilterBuilder) => FakeFilterBuilder): FakeQuery {
    const builder = new FakeFilterBuilder();
    cb(builder);
    this.filters.push(...builder.filters);
    return this;
  }

  async collect(): Promise<FakeRecord[]> {
    return this.records.filter((record) => this.filters.every((f) => record[f.field] === f.value));
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<FakeRecord> {
    yield* await this.collect();
  }
}

class FakeDb {
  private nextId = 1;

  constructor(private readonly recordsByTable: Map<TableName, Map<string, FakeRecord>>) {}

  async get(id: string): Promise<FakeRecord | null> {
    for (const records of this.recordsByTable.values()) {
      const record = records.get(id);
      if (record) return record;
    }
    return null;
  }

  query(tableName: TableName): {
    withIndex: (indexName: string, cb: (q: FakeIndexBuilder) => FakeIndexBuilder) => FakeQuery;
  } {
    const records = Array.from((this.recordsByTable.get(tableName) ?? new Map()).values());
    return {
      withIndex: (_indexName, cb) => {
        const builder = new FakeIndexBuilder();
        cb(builder);
        return new FakeQuery(records, builder.filters);
      },
    };
  }

  async insert(tableName: TableName, value: Record<string, unknown>): Promise<string> {
    const id = `${tableName}_inserted_${this.nextId++}`;
    this.mapFor(tableName).set(id, { _id: id, _creationTime: 1, ...value });
    return id;
  }

  size(tableName: TableName): number {
    return this.mapFor(tableName).size;
  }

  record(id: string): FakeRecord {
    const record = this.recordsByTable.get('merchant')?.get(id) ?? this.recordsByTable.get('globalMerchant')?.get(id);
    if (!record) throw new Error(`Missing fake record: ${id}`);
    return record;
  }

  private mapFor(tableName: TableName): Map<string, FakeRecord> {
    const map = this.recordsByTable.get(tableName);
    if (!map) throw new Error(`Unknown table: ${tableName}`);
    return map;
  }
}

function createDb(merchants: FakeRecord[] = [], globalMerchants: FakeRecord[] = []): FakeDb {
  return new FakeDb(
    new Map<TableName, Map<string, FakeRecord>>([
      ['merchant', new Map(merchants.map((r) => [r._id, r]))],
      ['globalMerchant', new Map(globalMerchants.map((r) => [r._id, r]))],
    ])
  );
}

function merchant(id: string, overrides: Partial<FakeRecord> = {}): FakeRecord {
  return {
    _id: id,
    workspaceId: WS,
    name: 'Merchant',
    isDeleted: false,
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('getOrCreateMerchantByName', () => {
  it('returns an existing active merchant on a case-insensitive name match', async () => {
    const db = createDb([merchant('merchant_1', { name: 'Starbucks' })]);
    const ctx = { db } as unknown as MutationCtx;

    expect(await getOrCreateMerchantByName(ctx, WS, 'starbucks')).toBe('merchant_1');
    expect(await getOrCreateMerchantByName(ctx, WS, '  Starbucks  ')).toBe('merchant_1');
    // No new rows were created.
    expect(db.size('merchant')).toBe(1);
  });

  it('creates a new trimmed merchant when nothing matches', async () => {
    const db = createDb();
    const ctx = { db } as unknown as MutationCtx;

    const id = await getOrCreateMerchantByName(ctx, WS, '  Target  ');

    expect(db.record(id)).toMatchObject({ name: 'Target', workspaceId: WS, isDeleted: false });
    expect(typeof db.record(id).updatedAt).toBe('string');
  });

  it('ignores soft-deleted merchants and creates a fresh one', async () => {
    const db = createDb([merchant('merchant_deleted', { name: 'Old Shop', isDeleted: true })]);
    const ctx = { db } as unknown as MutationCtx;

    const id = await getOrCreateMerchantByName(ctx, WS, 'Old Shop');

    expect(id).not.toBe('merchant_deleted');
    expect(db.size('merchant')).toBe(2);
  });

  it('does not match merchants from another workspace', async () => {
    const db = createDb([merchant('merchant_other', { name: 'Costco', workspaceId: OTHER_WS })]);
    const ctx = { db } as unknown as MutationCtx;

    const id = await getOrCreateMerchantByName(ctx, WS, 'Costco');

    expect(id).not.toBe('merchant_other');
    expect(db.record(id).workspaceId).toBe(WS);
  });

  it('reuses a global-backed merchant case-insensitively and preserves its logo', async () => {
    const db = createDb(
      [merchant('merchant_1', { name: undefined, globalMerchantId: 'global_1' })],
      [{ _id: 'global_1', name: "McDonald's", logoUrl: 'https://example.com/mcdonalds.png' }]
    );
    const ctx = { db } as unknown as MutationCtx;

    expect(await getOrCreateMerchantByName(ctx, WS, "  MCDONALD'S  ", 'https://example.com/bank.png')).toBe(
      'merchant_1'
    );
    expect(db.size('merchant')).toBe(1);
    expect(db.record('merchant_1').logoUrl).toBeUndefined();
    expect(db.record('global_1').logoUrl).toBe('https://example.com/mcdonalds.png');
  });

  it('matches a local override instead of the inherited global name', async () => {
    const db = createDb(
      [merchant('merchant_1', { name: 'My cafe', globalMerchantId: 'global_1' })],
      [{ _id: 'global_1', name: 'Cafe' }]
    );
    const ctx = { db } as unknown as MutationCtx;

    expect(await getOrCreateMerchantByName(ctx, WS, 'MY CAFE')).toBe('merchant_1');
    expect(await getOrCreateMerchantByName(ctx, WS, 'Cafe')).not.toBe('merchant_1');
  });

  it('preserves an existing local logo and saves a supplied logo for a new merchant', async () => {
    const db = createDb([merchant('merchant_1', { name: 'Cafe', logoUrl: 'https://example.com/local.png' })]);
    const ctx = { db } as unknown as MutationCtx;

    expect(await getOrCreateMerchantByName(ctx, WS, 'Cafe', 'https://example.com/bank.png')).toBe('merchant_1');
    expect(db.record('merchant_1').logoUrl).toBe('https://example.com/local.png');
    const createdId = await getOrCreateMerchantByName(ctx, WS, 'New cafe', 'https://example.com/bank.png');
    expect(db.record(createdId).logoUrl).toBe('https://example.com/bank.png');
  });
});

describe('batchResolveMerchantNames', () => {
  it('returns an empty map for an empty id set without touching the db', async () => {
    const db = createDb();
    const ctx = { db } as unknown as QueryCtx;
    expect(await batchResolveMerchantNames(ctx, new Set())).toEqual(new Map());
  });

  it('uses the merchant name when present', async () => {
    const db = createDb([merchant('merchant_1', { name: 'Starbucks' })]);
    const ctx = { db } as unknown as QueryCtx;

    const names = await batchResolveMerchantNames(ctx, new Set(['merchant_1']));
    expect(names.get('merchant_1')).toBe('Starbucks');
  });

  it('falls back to the linked global merchant name when the local name is missing', async () => {
    const db = createDb(
      [merchant('merchant_2', { name: undefined, globalMerchantId: 'globalMerchant_1' })],
      [{ _id: 'globalMerchant_1', name: 'Amazon' }]
    );
    const ctx = { db } as unknown as QueryCtx;

    const names = await batchResolveMerchantNames(ctx, new Set(['merchant_2']));
    expect(names.get('merchant_2')).toBe('Amazon');
  });

  it('omits merchants that have neither a name nor a resolvable global merchant', async () => {
    const db = createDb(
      [
        merchant('merchant_no_name', { name: undefined }),
        merchant('merchant_dangling_global', { name: undefined, globalMerchantId: 'globalMerchant_missing' }),
      ],
      []
    );
    const ctx = { db } as unknown as QueryCtx;

    const names = await batchResolveMerchantNames(ctx, new Set(['merchant_no_name', 'merchant_dangling_global']));
    expect(names.has('merchant_no_name')).toBe(false);
    expect(names.has('merchant_dangling_global')).toBe(false);
  });

  it('skips ids with no matching merchant and resolves a mixed batch', async () => {
    const db = createDb(
      [
        merchant('merchant_1', { name: 'Starbucks' }),
        merchant('merchant_2', { name: undefined, globalMerchantId: 'globalMerchant_1' }),
      ],
      [{ _id: 'globalMerchant_1', name: 'Amazon' }]
    );
    const ctx = { db } as unknown as QueryCtx;

    const names = await batchResolveMerchantNames(ctx, new Set(['merchant_1', 'merchant_2', 'merchant_missing']));
    expect(names).toEqual(
      new Map([
        ['merchant_1', 'Starbucks'],
        ['merchant_2', 'Amazon'],
      ])
    );
  });
});
