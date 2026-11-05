import { getFunctionName } from 'convex/server';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { JWKPublicKey } from 'plaid';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Id } from '../../_generated/dataModel';
import type { ActionCtx, MutationCtx } from '../../_generated/server';
import { plaidClient } from './plaidClient';
import {
  performSync,
  reconcilePendingToClearedTransition,
  resolvePlaidRawImportStatus,
  sha256Hex,
  syncTransactionsWebhook,
  verifyPlaidWebhook,
} from './plaidTransactionSync';

describe('performSync before account placement', () => {
  afterEach(() => vi.restoreAllMocks());

  const handler = (
    performSync as unknown as {
      _handler: (ctx: ActionCtx, args: { itemId: string }) => Promise<null>;
    }
  )._handler;

  it('does not consume the Plaid cursor before an account belongs to a workspace', async () => {
    const sync = vi.spyOn(plaidClient, 'transactionsSync');
    const runMutation = vi.fn().mockResolvedValue({
      _id: 'bank_link_1',
      accessToken: 'access_test',
      nextCursor: undefined,
      isFirstSync: true,
      plaidAccountToWorkspaces: {},
      workspaceIds: [],
      initialSyncAccounts: [],
    });

    await handler({ runMutation } as unknown as ActionCtx, { itemId: 'item_1' });

    expect(sync).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  it('fetches the initial cursor once an account has been placed', async () => {
    const sync = vi.spyOn(plaidClient, 'transactionsSync').mockResolvedValue({
      data: { added: [], modified: [], removed: [], next_cursor: 'cursor_1', has_more: false },
    } as unknown as Awaited<ReturnType<typeof plaidClient.transactionsSync>>);
    const runMutation = vi
      .fn()
      .mockResolvedValue(null)
      .mockResolvedValueOnce({
        _id: 'bank_link_1',
        accessToken: 'access_test',
        nextCursor: undefined,
        isFirstSync: true,
        initialBalanceDate: '2026-09-06',
        plaidAccountToWorkspaces: { plaid_account_1: ['workspace_1'] },
        workspaceIds: ['workspace_1'],
        initialSyncAccounts: [],
      });

    await handler({ runMutation } as unknown as ActionCtx, { itemId: 'item_1' });

    expect(sync).toHaveBeenCalledWith(expect.objectContaining({ access_token: 'access_test', cursor: undefined }));
    expect(runMutation).toHaveBeenCalledTimes(3);
  });
});

let signingKey: CryptoKey;
let verificationKey: JWKPublicKey;

beforeAll(async () => {
  const keyPair = await generateKeyPair('ES256');
  const jwk = await exportJWK(keyPair.publicKey);
  if (!jwk.x || !jwk.y) {
    throw new Error('Generated test key is missing coordinates');
  }

  signingKey = keyPair.privateKey;
  verificationKey = {
    alg: 'ES256',
    crv: 'P-256',
    kid: 'test-key',
    kty: 'EC',
    use: 'sig',
    x: jwk.x,
    y: jwk.y,
    created_at: Math.floor(Date.now() / 1000),
    expired_at: null,
  };
});

async function signWebhook(body: string, issuedAt: number = Math.floor(Date.now() / 1000)): Promise<string> {
  return new SignJWT({ request_body_sha256: await sha256Hex(body) })
    .setProtectedHeader({ alg: 'ES256', kid: verificationKey.kid, typ: 'JWT' })
    .setIssuedAt(issuedAt)
    .sign(signingKey);
}

describe('verifyPlaidWebhook', () => {
  it('does not log credentials when fetching the verification key fails', async () => {
    const secret = 'fake_webhook_lookup_secret_only';
    const failure = Object.assign(new Error(secret), {
      config: { headers: { 'PLAID-SECRET': secret } },
      response: {
        status: 503,
        data: {
          error_code: 'INTERNAL_SERVER_ERROR',
          error_type: 'API_ERROR',
          request_id: 'request_test_789',
          error_message: secret,
        },
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const body = '{"item_id":"item_1"}';
      const signature = await signWebhook(body);

      expect(
        await verifyPlaidWebhook(signature, body, async () => {
          throw failure;
        })
      ).toBe(false);
      expect(warn).toHaveBeenCalledWith('Rejected Plaid webhook verification:', {
        error_code: 'INTERNAL_SERVER_ERROR',
        error_type: 'API_ERROR',
        request_id: 'request_test_789',
        status: 503,
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PLAID-SECRET');
    } finally {
      warn.mockRestore();
    }
  });

  it('accepts a recent signature whose body hash matches', async () => {
    const body = JSON.stringify({ item_id: 'item-1', webhook_type: 'TRANSACTIONS' }, null, 2);
    const signedJwt = await signWebhook(body);

    await expect(verifyPlaidWebhook(signedJwt, body, async () => verificationKey)).resolves.toBe(true);
  });

  it('rejects a missing signature', async () => {
    await expect(verifyPlaidWebhook(null, '{}', async () => verificationKey)).resolves.toBe(false);
  });

  it('rejects a signature when the raw body changes', async () => {
    const signedJwt = await signWebhook('{"item_id":"item-1"}');

    await expect(verifyPlaidWebhook(signedJwt, '{"item_id":"item-2"}', async () => verificationKey)).resolves.toBe(
      false
    );
  });

  it('rejects a signature older than five minutes', async () => {
    const body = '{"item_id":"item-1"}';
    const signedJwt = await signWebhook(body, Math.floor(Date.now() / 1000) - 301);

    await expect(verifyPlaidWebhook(signedJwt, body, async () => verificationKey)).resolves.toBe(false);
  });

  it('rejects an expired verification key', async () => {
    const body = '{"item_id":"item-1"}';
    const signedJwt = await signWebhook(body);

    await expect(
      verifyPlaidWebhook(signedJwt, body, async () => ({
        ...verificationKey,
        expired_at: Math.floor(Date.now() / 1000) - 1,
      }))
    ).resolves.toBe(false);
  });
});

type FakeRawImport = {
  _id: Id<'transactionImportRaw'>;
  importStatus: 'awaiting_insert_job' | 'inserted';
  pending: boolean;
  plaidTransactionId: string;
  workspaceId: Id<'workspace'>;
  [key: string]: unknown;
};

class FakeIndexBuilder {
  plaidTransactionId: string | undefined;

  eq(field: string, value: string): FakeIndexBuilder {
    if (field === 'plaidTransactionId') {
      this.plaidTransactionId = value;
    }
    return this;
  }
}

class FakeQuery implements AsyncIterable<FakeRawImport> {
  constructor(
    private readonly records: FakeRawImport[],
    private readonly plaidTransactionId?: string
  ) {}

  withIndex(_indexName: string, callback: (builder: FakeIndexBuilder) => FakeIndexBuilder): FakeQuery {
    const builder = new FakeIndexBuilder();
    callback(builder);
    return new FakeQuery(this.records, builder.plaidTransactionId);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<FakeRawImport> {
    for (const record of this.records) {
      if (record.plaidTransactionId === this.plaidTransactionId) {
        yield record;
      }
    }
  }
}

class FakeDb {
  constructor(private readonly records: FakeRawImport[]) {}

  query(tableName: string): FakeQuery {
    if (tableName !== 'transactionImportRaw') {
      throw new Error(`Unexpected table: ${tableName}`);
    }
    return new FakeQuery(this.records);
  }

  async patch(id: Id<'transactionImportRaw'>, updates: Record<string, unknown>): Promise<void> {
    const record = this.records.find((candidate) => candidate._id === id);
    if (!record) {
      throw new Error(`Missing raw import: ${id}`);
    }
    Object.assign(record, updates);
  }
}

function rawImport(id: string, workspaceId: string, importStatus: FakeRawImport['importStatus']): FakeRawImport {
  return {
    _id: id as Id<'transactionImportRaw'>,
    importStatus,
    pending: true,
    plaidTransactionId: 'pending-transaction',
    workspaceId: workspaceId as Id<'workspace'>,
  };
}

describe('resolvePlaidRawImportStatus', () => {
  it('keeps an inserted import inserted when Plaid modifies it', () => {
    expect(resolvePlaidRawImportStatus('inserted', 'awaiting_insert_job')).toBe('inserted');
  });

  it('requeues an import that has not been inserted', () => {
    expect(resolvePlaidRawImportStatus('error', 'awaiting_insert_job')).toBe('awaiting_insert_job');
  });
});

describe('reconcilePendingToClearedTransition', () => {
  it('updates every workspace copy and returns every inserted raw import', async () => {
    const records = [
      rawImport('raw-import-1', 'workspace-1', 'inserted'),
      rawImport('raw-import-2', 'workspace-2', 'inserted'),
      rawImport('raw-import-3', 'workspace-3', 'awaiting_insert_job'),
    ];
    const db = new FakeDb(records);
    const ctx = { db } as unknown as MutationCtx;

    const result = await reconcilePendingToClearedTransition(
      ctx,
      'pending-transaction',
      {
        amount: -4321,
        authorizedDate: '2026-07-25',
        date: '2026-07-27',
        logoUrl: null,
        merchantEntityId: null,
        merchantName: 'Coffee Shop',
        originalStatement: 'COFFEE SHOP',
        plaidPersonalFinanceCategory: null,
        plaidTransactionCode: null,
        plaidTransactionId: 'cleared-transaction',
        postedDate: '2026-07-27',
        website: null,
      },
      '2026-07-27T14:00:00.000Z'
    );

    expect(result).toEqual({
      updatedCount: 3,
      updatedInsertedIds: ['raw-import-1', 'raw-import-2'],
    });
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: 'raw-import-1',
          amount: -4321n,
          pending: false,
          plaidTransactionId: 'cleared-transaction',
        }),
        expect.objectContaining({
          _id: 'raw-import-2',
          amount: -4321n,
          pending: false,
          plaidTransactionId: 'cleared-transaction',
        }),
        expect.objectContaining({
          _id: 'raw-import-3',
          amount: -4321n,
          pending: false,
          plaidTransactionId: 'cleared-transaction',
        }),
      ])
    );
  });
});

describe('Plaid reauthorization webhooks', () => {
  afterEach(() => vi.restoreAllMocks());

  async function deliver(fields: Record<string, unknown>) {
    vi.spyOn(plaidClient, 'webhookVerificationKeyGet').mockResolvedValue({
      data: { key: verificationKey },
    } as Awaited<ReturnType<typeof plaidClient.webhookVerificationKeyGet>>);
    const rawBody = JSON.stringify({ item_id: 'item_1', webhook_type: 'ITEM', ...fields });
    const runMutation = vi.fn().mockResolvedValue('webhook_log_1');
    const runAction = vi.fn();
    const response = await syncTransactionsWebhook(
      { runMutation, runAction } as unknown as ActionCtx,
      new Request('https://example.test/plaid', {
        method: 'POST',
        body: rawBody,
        headers: { 'Plaid-Verification': await signWebhook(rawBody) },
      })
    );
    expect(response.status).toBe(200);
    expect(runAction).not.toHaveBeenCalled();
    return runMutation.mock.calls.map(([ref, args]) => ({ name: getFunctionName(ref), args }));
  }

  it.each([
    {
      webhook_code: 'PENDING_EXPIRATION',
      consent_expiration_time: '2026-09-19T08:00:00-04:00',
      expected: 'consent_expiring',
    },
    {
      webhook_code: 'PENDING_DISCONNECT',
      disconnect_time: '2026-09-19T12:00:00Z',
      reason: 'INSTITUTION_TOKEN_EXPIRATION',
      expected: 'connection_expiring',
    },
    {
      webhook_code: 'PENDING_DISCONNECT',
      disconnect_time: '2026-09-19T12:00:00Z',
      reason: 'INSTITUTION_MIGRATION',
      expected: 'connection_expiring',
    },
  ])('preserves $webhook_code as an advance warning ($expected)', async ({ expected, ...payload }) => {
    const calls = await deliver(payload);
    expect(calls).toContainEqual({
      name: 'internal/bankLinks:setBankLinkReauthorization',
      args: {
        itemId: 'item_1',
        reauthorization: {
          reason: expected,
          requiredBy: '2026-09-19T12:00:00.000Z',
          providerReason: payload.reason,
        },
      },
    });
    expect(calls.some(({ name }) => name === 'internal/bankLinks:updateBankLinkStatus')).toBe(false);
  });

  it.each([undefined, null, 123, 'invalid'])('keeps the warning when its deadline is %s', async (deadline) => {
    const calls = await deliver({ webhook_code: 'PENDING_EXPIRATION', consent_expiration_time: deadline });
    expect(calls).toContainEqual({
      name: 'internal/bankLinks:setBankLinkReauthorization',
      args: {
        itemId: 'item_1',
        reauthorization: {
          reason: 'consent_expiring',
          requiredBy: undefined,
          providerReason: undefined,
        },
      },
    });
  });

  it.each([
    { webhook_code: 'ERROR', error: { error_code: 'ITEM_LOGIN_REQUIRED' } },
    { webhook_code: 'USER_PERMISSION_REVOKED' },
  ])('still disconnects on $webhook_code', async (payload) => {
    expect(await deliver(payload)).toContainEqual({
      name: 'internal/bankLinks:updateBankLinkStatus',
      args: { itemId: 'item_1', itemStatus: 'Disconnected' },
    });
  });

  it('does not treat LOGIN_REPAIRED as consent renewal', async () => {
    expect(await deliver({ webhook_code: 'LOGIN_REPAIRED' })).toContainEqual({
      name: 'internal/bankLinks:updateBankLinkStatus',
      args: { itemId: 'item_1', itemStatus: 'Healthy' },
    });
  });
});
