import { describe, expect, it } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { refreshOauthTokensHandler, revokeOauthConnectionHandler } from './oauthMutations';
import { authenticateOauthAccessTokenHandler } from './oauthQueries';

type FakeRecord = Record<string, unknown> & { _id: string; _creationTime: number };
type FakeTable =
  | 'mcpOauthAuthorizationCode'
  | 'mcpOauthAccessToken'
  | 'mcpOauthRefreshToken'
  | 'mcpOauthConnection'
  | 'mcpOauthClient'
  | 'userProfile';

class FakeIndexBuilder {
  readonly filters: Array<{ field: string; operator: 'eq' | 'gt'; value: unknown }> = [];

  eq(field: string, value: unknown): FakeIndexBuilder {
    this.filters.push({ field, operator: 'eq', value });
    return this;
  }

  gt(field: string, value: unknown): FakeIndexBuilder {
    this.filters.push({ field, operator: 'gt', value });
    return this;
  }
}

class FakeQuery {
  constructor(
    private readonly records: FakeRecord[],
    private readonly filters: Array<{ field: string; operator: 'eq' | 'gt'; value: unknown }> = []
  ) {}

  withIndex(_indexName: string, build: (builder: FakeIndexBuilder) => FakeIndexBuilder): FakeQuery {
    const builder = new FakeIndexBuilder();
    build(builder);
    return new FakeQuery(this.records, builder.filters);
  }

  order(direction: 'asc' | 'desc'): FakeQuery {
    const ordered = [...this.records].sort((left, right) => left._creationTime - right._creationTime);
    return new FakeQuery(direction === 'desc' ? ordered.reverse() : ordered, this.filters);
  }

  async first(): Promise<FakeRecord | null> {
    return this.matching()[0] ?? null;
  }

  async unique(): Promise<FakeRecord | null> {
    const matching = this.matching();
    if (matching.length > 1) {
      throw new Error('Fake query expected a unique result');
    }
    return matching[0] ?? null;
  }

  async collect(): Promise<FakeRecord[]> {
    return this.matching();
  }

  private matching(): FakeRecord[] {
    return this.records.filter((record) =>
      this.filters.every((filter) => {
        const recordValue = record[filter.field];
        if (filter.operator === 'eq') {
          return recordValue === filter.value;
        }

        return typeof recordValue === 'string' && typeof filter.value === 'string' && recordValue > filter.value;
      })
    );
  }
}

class FakeDb {
  private nextId = 1;
  private readonly records = new Map<string, FakeRecord>();

  constructor(seed: FakeRecord[]) {
    for (const record of seed) {
      this.records.set(record._id, record);
    }
  }

  query(table: FakeTable): FakeQuery {
    return new FakeQuery([...this.records.values()].filter((record) => record['_table'] === table));
  }

  async get(id: string): Promise<FakeRecord | null> {
    return this.records.get(id) ?? null;
  }

  async patch(id: string, value: Record<string, unknown>): Promise<void> {
    const record = this.records.get(id);
    if (!record) {
      throw new Error(`Missing fake record ${id}`);
    }
    Object.assign(record, value);
  }

  async insert(table: FakeTable, value: Record<string, unknown>): Promise<string> {
    const id = `${table}_${this.nextId++}`;
    this.records.set(id, {
      _id: id,
      _creationTime: this.nextId,
      _table: table,
      ...value,
    });
    return id;
  }

  record(id: string): FakeRecord {
    const record = this.records.get(id);
    if (!record) {
      throw new Error(`Missing fake record ${id}`);
    }
    return record;
  }
}

const connectionId = 'mcpOauthConnection_1' as Id<'mcpOauthConnection'>;
const authorizationCodeId = 'mcpOauthAuthorizationCode_1' as Id<'mcpOauthAuthorizationCode'>;
const accessTokenId = 'mcpOauthAccessToken_1' as Id<'mcpOauthAccessToken'>;
const refreshTokenId = 'mcpOauthRefreshToken_1' as Id<'mcpOauthRefreshToken'>;
const workspaceId = 'workspace_1' as Id<'workspace'>;

function record(table: FakeTable, id: string, fields: Record<string, unknown>): FakeRecord {
  return { _id: id, _creationTime: 1, _table: table, ...fields };
}

function connection(overrides: Record<string, unknown> = {}): FakeRecord {
  return record('mcpOauthConnection', connectionId, {
    clerkId: 'clerk_user',
    clientId: 'client_claude',
    authorizationVersion: 2,
    scopes: ['app:read', 'transactions:write'],
    connectedAt: '2026-08-01T00:00:00.000Z',
    lastAuthorizedAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  });
}

function accessToken(overrides: Record<string, unknown> = {}): FakeRecord {
  return record('mcpOauthAccessToken', accessTokenId, {
    tokenHash: 'access_hash',
    clerkId: 'clerk_user',
    clientId: 'client_claude',
    connectionId,
    connectionVersion: 2,
    scopes: ['app:read', 'transactions:write'],
    expiresAt: '2099-01-01T00:00:00.000Z',
    createdAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  });
}

function authorizationCode(overrides: Record<string, unknown> = {}): FakeRecord {
  return record('mcpOauthAuthorizationCode', authorizationCodeId, {
    codeHash: 'authorization_code_hash',
    clerkId: 'clerk_user',
    clientId: 'client_claude',
    redirectUri: 'https://client.example/callback',
    codeChallenge: 'code_challenge',
    codeChallengeMethod: 'S256',
    scopes: ['app:read'],
    expiresAt: '2099-01-01T00:00:00.000Z',
    createdAt: '2026-08-29T00:00:00.000Z',
    ...overrides,
  });
}

function refreshToken(overrides: Record<string, unknown> = {}): FakeRecord {
  return record('mcpOauthRefreshToken', refreshTokenId, {
    tokenHash: 'refresh_hash',
    clerkId: 'clerk_user',
    clientId: 'client_claude',
    connectionId,
    connectionVersion: 2,
    scopes: ['app:read', 'transactions:write'],
    expiresAt: '2099-01-01T00:00:00.000Z',
    createdAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  });
}

function createContexts(seed: FakeRecord[], subject = 'clerk_user') {
  const db = new FakeDb(seed);
  const auth = { getUserIdentity: async () => ({ subject }) };
  return {
    db,
    queryCtx: { db, auth } as unknown as QueryCtx,
    mutationCtx: { db, auth } as unknown as MutationCtx,
  };
}

describe('OAuth MCP connection lifecycle', () => {
  it('authenticates a token only while its connection version is active', async () => {
    const { queryCtx } = createContexts([
      connection(),
      accessToken(),
      record('mcpOauthClient', 'mcpOauthClient_1', {
        clientId: 'client_claude',
        clientName: 'Claude',
      }),
      record('userProfile', 'userProfile_1', {
        clerkId: 'clerk_user',
        activeWorkspaceId: workspaceId,
      }),
    ]);

    await expect(authenticateOauthAccessTokenHandler(queryCtx, { tokenHash: 'access_hash' })).resolves.toMatchObject({
      tokenId: accessTokenId,
      clientName: 'Claude',
      scopes: ['app:read', 'transactions:write'],
      activeWorkspaceId: workspaceId,
    });

    const stale = createContexts([connection({ authorizationVersion: 3 }), accessToken()]);
    await expect(authenticateOauthAccessTokenHandler(stale.queryCtx, { tokenHash: 'access_hash' })).resolves.toBeNull();
  });

  it('preserves the scopes of each legacy unlinked access token', async () => {
    const { queryCtx } = createContexts([
      connection({
        scopes: ['app:read', 'transactions:write'],
        lastAuthorizedAt: '2026-08-01T00:00:00.000Z',
      }),
      accessToken({
        connectionId: undefined,
        connectionVersion: undefined,
        scopes: ['app:read'],
        createdAt: '2026-08-20T00:00:00.000Z',
      }),
    ]);

    await expect(authenticateOauthAccessTokenHandler(queryCtx, { tokenHash: 'access_hash' })).resolves.toMatchObject({
      scopes: ['app:read'],
    });
  });

  it('revokes the current user connection and immediately blocks its access token', async () => {
    const { db, queryCtx, mutationCtx } = createContexts([connection(), accessToken()]);

    await expect(revokeOauthConnectionHandler(mutationCtx, { clientId: 'client_claude' })).resolves.toEqual({
      success: true,
    });
    expect(typeof db.record(connectionId).revokedAt).toBe('string');
    await expect(authenticateOauthAccessTokenHandler(queryCtx, { tokenHash: 'access_hash' })).resolves.toBeNull();
  });

  it('invalidates pending authorization codes when revoking a connection', async () => {
    const { db, mutationCtx } = createContexts([connection(), authorizationCode()]);

    await expect(revokeOauthConnectionHandler(mutationCtx, { clientId: 'client_claude' })).resolves.toEqual({
      success: true,
    });
    expect(typeof db.record(authorizationCodeId).consumedAt).toBe('string');
  });

  it('blocks refresh-token rotation after the connection is revoked', async () => {
    const { mutationCtx } = createContexts([connection({ revokedAt: '2026-08-29T00:00:00.000Z' }), refreshToken()]);

    await expect(
      refreshOauthTokensHandler(mutationCtx, {
        refreshTokenHash: 'refresh_hash',
        clientId: 'client_claude',
      })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'invalid_grant',
        description: 'MCP connection has been revoked or replaced',
      },
    });
  });

  it('does not revoke a connection owned by another user', async () => {
    const otherConnection = connection({ clerkId: 'clerk_other' });
    const { db, mutationCtx } = createContexts([otherConnection]);

    await expect(revokeOauthConnectionHandler(mutationCtx, { clientId: 'client_claude' })).rejects.toThrow(
      'MCP connection not found'
    );
    expect(db.record(connectionId).revokedAt).toBeUndefined();
  });

  it('uses a revoked connection tombstone to block legacy unlinked tokens', async () => {
    const { queryCtx } = createContexts([
      connection({ revokedAt: '2026-08-29T00:00:00.000Z' }),
      accessToken({ connectionId: undefined, connectionVersion: undefined }),
    ]);

    await expect(authenticateOauthAccessTokenHandler(queryCtx, { tokenHash: 'access_hash' })).resolves.toBeNull();
  });
});
