import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Id } from '../../_generated/dataModel';
import type { ActionCtx } from '../../_generated/server';
import { createLinkToken } from './createLinkToken';
import { createUpdateLinkToken } from './createUpdateLinkToken';
import { getSafePlaidErrorDetails, plaidClient } from './plaidClient';

const handler = (
  createLinkToken as unknown as {
    _handler: (ctx: ActionCtx, args: { platform?: 'ios' }) => Promise<{ link_token: string; expiration: string }>;
  }
)._handler;

describe('createLinkToken', () => {
  afterEach(() => vi.restoreAllMocks());

  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: 'clerk_owner', email: 'owner@example.test' }) },
  } as unknown as ActionCtx;

  it.each([undefined, 'ios'] as const)('creates a token for platform %s', async (platform) => {
    const create = vi.spyOn(plaidClient, 'linkTokenCreate').mockResolvedValue({
      data: { link_token: 'link_test', expiration: '2026-09-06T12:00:00Z' },
    } as Awaited<ReturnType<typeof plaidClient.linkTokenCreate>>);

    expect(await handler(ctx, platform === undefined ? {} : { platform })).toEqual({
      link_token: 'link_test',
      expiration: '2026-09-06T12:00:00Z',
    });
    const request = create.mock.calls[0]?.[0];
    expect(request?.redirect_uri).toBe(platform === 'ios' ? 'https://kualia.com/plaid/oauth' : undefined);
    expect(request?.user?.client_user_id).toBe('clerk_owner');
  });

  it('does not contact Plaid for an unauthenticated client', async () => {
    const create = vi.spyOn(plaidClient, 'linkTokenCreate');
    const unauthenticated = { auth: { getUserIdentity: async () => null } } as unknown as ActionCtx;

    await expect(handler(unauthenticated, { platform: 'ios' })).rejects.toThrow('User not authenticated');
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    'OAuth redirect URI must be configured in the developer dashboard.',
    'redirect_uri is not registered in the developer dashboard.',
  ])('sanitizes an OAuth configuration failure: %s', async (providerMessage) => {
    const secret = 'fake_secret_for_security_test_only';
    const clientId = 'fake_client_id_for_security_test_only';
    const email = 'private-person@security-test.invalid';
    const rawError = Object.assign(new Error(`Hostile failure: ${secret} ${clientId} ${email}`), {
      config: {
        headers: { 'PLAID-SECRET': secret, 'PLAID-CLIENT-ID': clientId },
        data: JSON.stringify({ user: { email_address: email }, secret }),
      },
      request: { _header: `PLAID-SECRET: ${secret}` },
      response: {
        status: 400,
        headers: { authorization: secret },
        data: {
          error_code: 'INVALID_FIELD',
          error_type: 'INVALID_REQUEST',
          request_id: 'request_test_123',
          error_message: `${providerMessage} ${secret} ${email}`,
        },
      },
    });
    vi.spyOn(plaidClient, 'linkTokenCreate').mockRejectedValue(rawError);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const surfaced = await handler(ctx, { platform: 'ios' }).catch((error: unknown) => error);

    expect(surfaced).toBeInstanceOf(ConvexError);
    expect(String(surfaced)).toContain('contact Kualia support');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Register https://kualia.com/plaid/oauth'), {
      error_code: 'INVALID_FIELD',
      error_type: 'INVALID_REQUEST',
      request_id: 'request_test_123',
      status: 400,
    });
    const observable = JSON.stringify({ logs: log.mock.calls, surfaced });
    for (const sensitive of [
      secret,
      clientId,
      email,
      'Hostile failure',
      'PLAID-SECRET',
      'email_address',
      providerMessage,
    ]) {
      expect(observable).not.toContain(sensitive);
    }
  });

  it('does not expose arbitrary errors to old clients', async () => {
    const secret = 'fake_transport_secret_never_log';
    vi.spyOn(plaidClient, 'linkTokenCreate').mockRejectedValue(new Error(secret));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const surfaced = await handler(ctx, {}).catch((error: unknown) => error);

    expect(String(surfaced)).toContain('Unable to start a bank connection');
    expect(log).toHaveBeenCalledWith('Error creating Plaid link token:', {});
    expect(JSON.stringify({ logs: log.mock.calls, surfaced })).not.toContain(secret);
  });

  it('omits malformed metadata instead of logging provider bodies', () => {
    expect(
      getSafePlaidErrorDetails({
        response: {
          status: 900,
          data: {
            error_code: 'INVALID_FIELD\nprivate_payload',
            error_type: { secret: 'private_payload' },
            request_id: 'contains private payload',
            error_message: 'private_payload',
          },
        },
      })
    ).toEqual({});
    expect(getSafePlaidErrorDetails(null)).toEqual({});
  });
});

describe('createUpdateLinkToken', () => {
  afterEach(() => vi.restoreAllMocks());
  const bankLinkId = 'bank_link_test' as Id<'bankLink'>;
  const updateHandler = (
    createUpdateLinkToken as unknown as {
      _handler: (
        ctx: ActionCtx,
        args: { bankLinkId: Id<'bankLink'>; platform?: 'ios' }
      ) => Promise<{ link_token: string; expiration: string }>;
    }
  )._handler;
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: 'clerk_owner' }) },
    runQuery: vi.fn(async () => ({ accessToken: 'existing-item-token' })),
  } as unknown as ActionCtx;

  it.each([undefined, 'ios'] as const)('preserves update mode and sets the return link for %s', async (platform) => {
    const create = vi.spyOn(plaidClient, 'linkTokenCreate').mockResolvedValue({
      data: { link_token: 'update_test', expiration: '2026-09-07T12:00:00Z' },
    } as Awaited<ReturnType<typeof plaidClient.linkTokenCreate>>);
    await updateHandler(ctx, { bankLinkId, ...(platform ? { platform } : {}) });
    const request = create.mock.calls[0]?.[0];
    expect(request?.access_token).toBe('existing-item-token');
    expect(request?.redirect_uri).toBe(platform === 'ios' ? 'https://kualia.com/plaid/oauth' : undefined);
    expect(request?.products).toBeUndefined();
    expect(ctx.runQuery).toHaveBeenCalledWith(expect.anything(), { bankLinkId, userId: 'clerk_owner' });
  });

  it('never contacts Plaid when unauthenticated or ownership verification fails', async () => {
    const create = vi.spyOn(plaidClient, 'linkTokenCreate');
    await expect(
      updateHandler(
        {
          auth: { getUserIdentity: async () => null },
        } as unknown as ActionCtx,
        { bankLinkId, platform: 'ios' }
      )
    ).rejects.toThrow('User not authenticated');
    await expect(
      updateHandler(
        {
          ...ctx,
          runQuery: async () => {
            throw new ConvexError('Access denied');
          },
        } as unknown as ActionCtx,
        { bankLinkId, platform: 'ios' }
      )
    ).rejects.toThrow('Access denied');
    expect(create).not.toHaveBeenCalled();
  });

  it('surfaces iOS return-link configuration errors without exposing provider payloads', async () => {
    vi.spyOn(plaidClient, 'linkTokenCreate').mockRejectedValue({
      response: {
        status: 400,
        data: {
          error_code: 'INVALID_FIELD',
          error_message: 'redirect_uri is not registered. private_token',
        },
      },
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = await updateHandler(ctx, { bankLinkId, platform: 'ios' }).catch((value: unknown) => value);
    expect(String(error)).toContain('contact Kualia support');
    expect(JSON.stringify({ error, logs: log.mock.calls })).not.toContain('private_token');
  });
});
