import { describe, expect, it } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { sha256Hex } from '../lib/crypto';

import { API_KEY_DISPLAY_PREFIX_LENGTH, API_KEY_PREFIX, MAX_ACTIVE_API_KEYS } from './constants';
import { createApiKeyHandler, revokeApiKeyHandler } from './mutations';

const CLERK_ID = 'clerk_user';

type FakeRecord = Record<string, unknown> & { _id: string };
type FakeFilter = { field: string; value: unknown };

class FakeIndexBuilder {
  readonly filters: FakeFilter[] = [];
  eq(field: string, value: unknown): FakeIndexBuilder {
    this.filters.push({ field, value });
    return this;
  }
}

class FakeQuery {
  constructor(
    private readonly records: FakeRecord[],
    private readonly filters: FakeFilter[]
  ) {}

  async collect(): Promise<FakeRecord[]> {
    return this.records.filter((record) => this.filters.every((f) => record[f.field] === f.value));
  }
}

class FakeDb {
  private nextId = 1;

  constructor(private readonly apiKeys: Map<string, FakeRecord>) {}

  query(_tableName: 'apiKey'): {
    withIndex: (indexName: string, cb: (q: FakeIndexBuilder) => FakeIndexBuilder) => FakeQuery;
  } {
    const records = Array.from(this.apiKeys.values());
    return {
      withIndex: (_indexName, cb) => {
        const builder = new FakeIndexBuilder();
        cb(builder);
        return new FakeQuery(records, builder.filters);
      },
    };
  }

  async get(id: string): Promise<FakeRecord | null> {
    return this.apiKeys.get(id) ?? null;
  }

  async insert(tableName: 'apiKey', value: Record<string, unknown>): Promise<string> {
    const id = `${tableName}_${this.nextId++}`;
    this.apiKeys.set(id, { _id: id, _creationTime: 1, ...value });
    return id;
  }

  async patch(id: string, updates: Record<string, unknown>): Promise<void> {
    const record = this.apiKeys.get(id);
    if (!record) throw new Error(`Missing fake record: ${id}`);
    Object.assign(record, updates);
  }

  record(id: string): FakeRecord {
    const record = this.apiKeys.get(id);
    if (!record) throw new Error(`Missing fake record: ${id}`);
    return record;
  }
}

function createCtx(apiKeys: FakeRecord[] = [], subject: string | null = CLERK_ID): { ctx: MutationCtx; db: FakeDb } {
  const db = new FakeDb(new Map(apiKeys.map((r) => [r._id, r])));
  const ctx = {
    auth: { getUserIdentity: async () => (subject === null ? null : { subject }) },
    db,
  } as unknown as MutationCtx;
  return { ctx, db };
}

function activeKey(id: string, clerkId = CLERK_ID): FakeRecord {
  return {
    _id: id,
    clerkId,
    tokenHash: `hash_${id}`,
    scopes: ['read', 'write'],
    createdAt: '2026-07-01T00:00:00.000Z',
  };
}

describe('createApiKeyHandler', () => {
  it('rejects an empty or whitespace-only label', async () => {
    const { ctx } = createCtx();
    await expect(createApiKeyHandler(ctx, { label: '' })).rejects.toThrow('Key name is required');
    await expect(createApiKeyHandler(ctx, { label: '   ' })).rejects.toThrow('Key name is required');
  });

  it('rejects a label longer than the maximum', async () => {
    const { ctx } = createCtx();
    await expect(createApiKeyHandler(ctx, { label: 'x'.repeat(61) })).rejects.toThrow(
      'Key name cannot exceed 60 characters'
    );
  });

  it('rejects creation once the active-key limit is reached', async () => {
    const keys = Array.from({ length: MAX_ACTIVE_API_KEYS }, (_, i) => activeKey(`apiKey_existing_${i}`));
    const { ctx } = createCtx(keys);
    await expect(createApiKeyHandler(ctx, { label: 'One too many' })).rejects.toThrow(
      `You can have at most ${MAX_ACTIVE_API_KEYS} active API keys. Revoke one to continue.`
    );
  });

  it('does not count revoked keys toward the active-key limit', async () => {
    const revoked = Array.from({ length: 5 }, (_, i) => ({
      ...activeKey(`apiKey_revoked_${i}`),
      revokedAt: '2026-07-02T00:00:00.000Z',
    }));
    const active = Array.from({ length: MAX_ACTIVE_API_KEYS - 1 }, (_, i) => activeKey(`apiKey_active_${i}`));
    const { ctx } = createCtx([...revoked, ...active]);
    await expect(createApiKeyHandler(ctx, { label: 'Still allowed' })).resolves.toMatchObject({
      label: 'Still allowed',
    });
  });

  it('creates a read+write key, returning the raw value once and storing only its hash', async () => {
    const { ctx, db } = createCtx();

    const result = await createApiKeyHandler(ctx, { label: '  My integration  ' });

    expect(result.key).toMatch(new RegExp(`^${API_KEY_PREFIX}[0-9a-f]{64}$`));
    expect(result.keyPrefix).toBe(result.key.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH));
    expect(result.label).toBe('My integration');
    expect(result.scopes).toEqual(['read', 'write']);

    const stored = db.record(result.apiKeyId);
    expect(stored.tokenHash).toBe(await sha256Hex(result.key));
    expect(stored.keyPrefix).toBe(result.keyPrefix);
    expect(stored.clerkId).toBe(CLERK_ID);
    expect(stored.label).toBe('My integration');
    expect(stored.scopes).toEqual(['read', 'write']);
    // The raw key is never persisted.
    expect(stored).not.toHaveProperty('key');
    expect(Object.values(stored)).not.toContain(result.key);
  });

  it('creates a read-only key when readOnly is set', async () => {
    const { ctx, db } = createCtx();
    const result = await createApiKeyHandler(ctx, { label: 'Reporting', readOnly: true });
    expect(result.scopes).toEqual(['read']);
    expect(db.record(result.apiKeyId).scopes).toEqual(['read']);
  });
});

describe('revokeApiKeyHandler', () => {
  it('throws when the key does not exist', async () => {
    const { ctx } = createCtx();
    await expect(revokeApiKeyHandler(ctx, { apiKeyId: 'apiKey_missing' as Id<'apiKey'> })).rejects.toThrow(
      'API key not found'
    );
  });

  it('throws when the key belongs to another user', async () => {
    const { ctx } = createCtx([activeKey('apiKey_other', 'clerk_someone_else')]);
    await expect(revokeApiKeyHandler(ctx, { apiKeyId: 'apiKey_other' as Id<'apiKey'> })).rejects.toThrow(
      'API key not found'
    );
  });

  it('revokes an active key', async () => {
    const { ctx, db } = createCtx([activeKey('apiKey_live')]);
    const result = await revokeApiKeyHandler(ctx, { apiKeyId: 'apiKey_live' as Id<'apiKey'> });
    expect(result).toEqual({ success: true });
    expect(typeof db.record('apiKey_live').revokedAt).toBe('string');
  });

  it('is idempotent for an already-revoked key and does not overwrite the original timestamp', async () => {
    const original = '2026-07-02T00:00:00.000Z';
    const { ctx, db } = createCtx([{ ...activeKey('apiKey_dead'), revokedAt: original }]);
    const result = await revokeApiKeyHandler(ctx, { apiKeyId: 'apiKey_dead' as Id<'apiKey'> });
    expect(result).toEqual({ success: true });
    expect(db.record('apiKey_dead').revokedAt).toBe(original);
  });
});
