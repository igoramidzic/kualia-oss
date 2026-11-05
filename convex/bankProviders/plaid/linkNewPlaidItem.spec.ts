import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Id } from '../../_generated/dataModel';
import type { ActionCtx } from '../../_generated/server';
import { linkNewPlaidItem } from './linkNewPlaidItem';
import { plaidClient } from './plaidClient';

describe('legacy Plaid exchange compatibility', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps token-exchange request credentials out of adjacent linking logs and errors', async () => {
    const secret = 'fake_adjacent_request_secret_only';
    const error = Object.assign(new Error(`Do not publish ${secret}`), {
      config: { headers: { 'PLAID-SECRET': secret }, data: JSON.stringify({ public_token: 'fake_public_token_only' }) },
      request: { _header: secret },
      response: {
        status: 400,
        data: {
          error_code: 'INVALID_PUBLIC_TOKEN',
          error_type: 'INVALID_INPUT',
          request_id: 'request_test_456',
          error_message: secret,
        },
      },
    });
    vi.spyOn(plaidClient, 'itemPublicTokenExchange').mockRejectedValue(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ isDeleted: false })
      .mockResolvedValueOnce({ ok: true, accessKind: 'owner' })
      .mockResolvedValueOnce({ hasDuplicate: false });
    const ctx = {
      auth: { getUserIdentity: async () => ({ subject: 'clerk_owner' }) },
      runQuery,
    } as unknown as ActionCtx;
    const args = {
      workspaceId: 'workspace_1' as Id<'workspace'>,
      publicToken: 'fake_public_token_only',
      institutionId: 'ins_1',
      institutionName: 'Bank',
      accounts: [],
    };
    const handler = (
      linkNewPlaidItem as unknown as { _handler: (ctx: ActionCtx, input: typeof args) => Promise<unknown> }
    )._handler;

    const surfaced = await handler(ctx, args).catch((caught: unknown) => caught);

    expect(String(surfaced)).toContain('Unable to connect your bank account');
    expect(log).toHaveBeenCalledWith('Error linking Plaid item:', {
      error_code: 'INVALID_PUBLIC_TOKEN',
      error_type: 'INVALID_INPUT',
      request_id: 'request_test_456',
      status: 400,
    });
    const observed = JSON.stringify({ logs: log.mock.calls, surfaced });
    expect(observed).not.toContain(secret);
    expect(observed).not.toContain('fake_public_token_only');
    expect(observed).not.toContain('PLAID-SECRET');
  });

  it.each([undefined, '2026-09-06'])(
    'accepts existing account metadata with initialBalanceDate %s',
    async (initialBalanceDate) => {
      vi.spyOn(plaidClient, 'itemPublicTokenExchange').mockResolvedValue({
        data: { access_token: 'access_test', item_id: 'item_1' },
      } as Awaited<ReturnType<typeof plaidClient.itemPublicTokenExchange>>);
      vi.spyOn(plaidClient, 'accountsGet').mockResolvedValue({
        data: {
          item: { institution_id: 'ins_1' },
          accounts: [
            {
              account_id: 'plaid_account_1',
              name: 'Checking',
              official_name: null,
              mask: '1234',
              type: 'depository',
              subtype: 'checking',
              balances: { current: 100, available: null },
            },
          ],
        },
      } as unknown as Awaited<ReturnType<typeof plaidClient.accountsGet>>);
      vi.spyOn(plaidClient, 'institutionsGetById').mockResolvedValue({
        data: { institution: { institution_id: 'ins_1', name: 'Bank', logo: null, primary_color: null } },
      } as unknown as Awaited<ReturnType<typeof plaidClient.institutionsGetById>>);
      const runQuery = vi
        .fn()
        .mockResolvedValueOnce({ isDeleted: false })
        .mockResolvedValueOnce({ ok: true, accessKind: 'owner' })
        .mockResolvedValueOnce({ hasDuplicate: false });
      const runMutation = vi
        .fn()
        .mockResolvedValueOnce('institution_1')
        .mockResolvedValueOnce({ bankLinkId: 'connection_1', accountIds: ['connection_account_1'] });
      const ctx = {
        auth: { getUserIdentity: async () => ({ subject: 'clerk_owner' }) },
        runQuery,
        runMutation,
      } as unknown as ActionCtx;
      const args = {
        workspaceId: 'workspace_1' as Id<'workspace'>,
        publicToken: 'public_test',
        institutionId: 'ins_1',
        institutionName: 'Bank',
        accounts: [{ id: 'plaid_account_1', name: 'Checking', type: 'depository', subtype: 'checking', mask: '1234' }],
        ...(initialBalanceDate ? { initialBalanceDate } : {}),
      };
      const handler = (
        linkNewPlaidItem as unknown as { _handler: (ctx: ActionCtx, input: typeof args) => Promise<unknown> }
      )._handler;

      expect(await handler(ctx, args)).toEqual({
        success: true,
        bankLinkId: 'connection_1',
        globalInstitutionId: 'institution_1',
        accountsLinked: 1,
        accounts: [{ bankLinkAccountId: 'connection_account_1', name: 'Checking', mask: '1234' }],
      });
      expect(runMutation.mock.calls[1]?.[1]).toMatchObject({
        initialBalanceDate,
        accounts: [{ initialBalance: 10000, plaidAccountId: 'plaid_account_1' }],
      });
    }
  );
});
