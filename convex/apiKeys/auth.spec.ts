import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

import { applyRateLimit, authenticateApiKeyRequestHandler } from './auth';
import { API_RATE_LIMIT_MAX_REQUESTS, API_RATE_LIMIT_WINDOW_MS } from './constants';

const T0 = Date.UTC(2026, 6, 8, 12, 0, 0);

function apiKeyDoc(overrides: Record<string, unknown> = {}): Doc<'apiKey'> {
  return {
    _id: 'apiKey_1',
    _creationTime: T0,
    tokenHash: 'hash_1',
    keyPrefix: 'kualia_a1b2c3d4',
    clerkId: 'clerk_user',
    label: 'CI key',
    scopes: ['read', 'write'],
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  } as unknown as Doc<'apiKey'>;
}

describe('applyRateLimit', () => {
  it('opens a fresh window on first use', () => {
    const result = applyRateLimit(apiKeyDoc(), T0);
    expect(result.limited).toBe(false);
    if (!result.limited) {
      expect(result.patch).toEqual({
        rateLimitWindowStart: T0,
        rateLimitWindowCount: 1,
        lastUsedAt: new Date(T0).toISOString(),
      });
    }
  });

  it('increments the count within an active window without moving the window start', () => {
    const result = applyRateLimit(apiKeyDoc({ rateLimitWindowStart: T0, rateLimitWindowCount: 5 }), T0 + 1000);
    expect(result.limited).toBe(false);
    if (!result.limited) {
      expect(result.patch.rateLimitWindowStart).toBe(T0);
      expect(result.patch.rateLimitWindowCount).toBe(6);
      expect(result.patch.lastUsedAt).toBe(new Date(T0 + 1000).toISOString());
    }
  });

  it('limits once the max is reached within the window and reports retry-after seconds', () => {
    const result = applyRateLimit(
      apiKeyDoc({ rateLimitWindowStart: T0, rateLimitWindowCount: API_RATE_LIMIT_MAX_REQUESTS }),
      T0 + 60_000
    );
    expect(result).toEqual({
      limited: true,
      retryAfterSeconds: (API_RATE_LIMIT_WINDOW_MS - 60_000) / 1000,
    });
  });

  it('floors retry-after at 1 second near the end of the window', () => {
    const result = applyRateLimit(
      apiKeyDoc({ rateLimitWindowStart: T0, rateLimitWindowCount: API_RATE_LIMIT_MAX_REQUESTS }),
      T0 + API_RATE_LIMIT_WINDOW_MS - 1
    );
    expect(result).toEqual({ limited: true, retryAfterSeconds: 1 });
  });

  it('resets the counter once the window has elapsed', () => {
    const now = T0 + API_RATE_LIMIT_WINDOW_MS;
    const result = applyRateLimit(
      apiKeyDoc({ rateLimitWindowStart: T0, rateLimitWindowCount: API_RATE_LIMIT_MAX_REQUESTS }),
      now
    );
    expect(result.limited).toBe(false);
    if (!result.limited) {
      expect(result.patch.rateLimitWindowStart).toBe(now);
      expect(result.patch.rateLimitWindowCount).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// authenticateApiKeyRequestHandler — exercised over a fake DB with fixed time.
// ---------------------------------------------------------------------------

type TableName = 'apiKey' | 'userProfile';
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

  async first(): Promise<FakeRecord | null> {
    return this.records.find((record) => this.filters.every((f) => record[f.field] === f.value)) ?? null;
  }
}

class FakeDb {
  constructor(private readonly recordsByTable: Map<TableName, Map<string, FakeRecord>>) {}

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

  async patch(id: string, updates: Record<string, unknown>): Promise<void> {
    for (const records of this.recordsByTable.values()) {
      const record = records.get(id);
      if (record) {
        Object.assign(record, updates);
        return;
      }
    }
    throw new Error(`Missing fake record: ${id}`);
  }

  record(tableName: TableName, id: string): FakeRecord {
    const record = this.recordsByTable.get(tableName)?.get(id);
    if (!record) throw new Error(`Missing fake record: ${tableName}.${id}`);
    return record;
  }
}

function createCtx(apiKeys: FakeRecord[], userProfiles: FakeRecord[] = []): { ctx: MutationCtx; db: FakeDb } {
  const db = new FakeDb(
    new Map<TableName, Map<string, FakeRecord>>([
      ['apiKey', new Map(apiKeys.map((r) => [r._id, r]))],
      ['userProfile', new Map(userProfiles.map((r) => [r._id, r]))],
    ])
  );
  return { ctx: { db } as unknown as MutationCtx, db };
}

describe('authenticateApiKeyRequestHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects an unknown token hash', async () => {
    const { ctx } = createCtx([]);
    expect(await authenticateApiKeyRequestHandler(ctx, { tokenHash: 'missing' })).toEqual({
      ok: false,
      reason: 'invalid_key',
    });
  });

  it('rejects a revoked key', async () => {
    const { ctx } = createCtx([{ ...apiKeyDoc({ tokenHash: 'hash_revoked', revokedAt: '2026-07-05T00:00:00.000Z' }) }]);
    expect(await authenticateApiKeyRequestHandler(ctx, { tokenHash: 'hash_revoked' })).toEqual({
      ok: false,
      reason: 'invalid_key',
    });
  });

  it('returns rate_limited without mutating the key when the window is exhausted', async () => {
    const { ctx, db } = createCtx([
      {
        ...apiKeyDoc({
          tokenHash: 'hash_busy',
          rateLimitWindowStart: T0,
          rateLimitWindowCount: API_RATE_LIMIT_MAX_REQUESTS,
        }),
      },
    ]);
    vi.setSystemTime(T0 + 1000);

    const result = await authenticateApiKeyRequestHandler(ctx, { tokenHash: 'hash_busy' });
    expect(result).toEqual({
      ok: false,
      reason: 'rate_limited',
      retryAfterSeconds: (API_RATE_LIMIT_WINDOW_MS - 1000) / 1000,
    });
    // The counter must not advance on a rejected (rate-limited) request.
    expect(db.record('apiKey', 'apiKey_1').rateLimitWindowCount).toBe(API_RATE_LIMIT_MAX_REQUESTS);
  });

  it('authenticates a valid key, advances the rate-limit window, and resolves the active workspace', async () => {
    const { ctx, db } = createCtx(
      [{ ...apiKeyDoc({ tokenHash: 'hash_ok', scopes: ['read'] }) }],
      [
        {
          _id: 'userProfile_1',
          clerkId: 'clerk_user',
          activeWorkspaceId: 'workspace_9',
        },
      ]
    );

    const result = await authenticateApiKeyRequestHandler(ctx, { tokenHash: 'hash_ok' });

    expect(result).toEqual({
      ok: true,
      apiKeyId: 'apiKey_1',
      apiKeyLabel: 'CI key',
      apiKeyPrefix: 'kualia_a1b2c3d4',
      clerkId: 'clerk_user',
      scopes: ['read'],
      activeWorkspaceId: 'workspace_9',
    });

    const stored = db.record('apiKey', 'apiKey_1');
    expect(stored.rateLimitWindowStart).toBe(T0);
    expect(stored.rateLimitWindowCount).toBe(1);
    expect(stored.lastUsedAt).toBe(new Date(T0).toISOString());
  });

  it('authenticates when the user has no active workspace', async () => {
    const { ctx } = createCtx([{ ...apiKeyDoc({ tokenHash: 'hash_ok' }) }]);
    const result = await authenticateApiKeyRequestHandler(ctx, { tokenHash: 'hash_ok' });
    expect(result).toMatchObject({ ok: true, activeWorkspaceId: undefined });
  });
});
