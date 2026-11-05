import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { createBankAccountHandler } from '../bankAccounts/create';
import { updateBankAccountHandler } from '../bankAccounts/update';
import { requireBankLinkAccountAccessForWorkspace } from '../bankLinks/helpers';
import { requireWorkspaceAccess } from '../lib/auth';
import { createBankAccountFromConnectionAccount, linkAccount, resolvePlaidSyncStartDate } from './mutations';

vi.mock('../bankAccounts/create', () => ({ createBankAccountHandler: vi.fn() }));
vi.mock('../bankAccounts/update', () => ({ updateBankAccountHandler: vi.fn() }));
vi.mock('../bankLinks/helpers', () => ({ requireBankLinkAccountAccessForWorkspace: vi.fn() }));
vi.mock('../lib/auth', () => ({ requireWorkspaceAccess: vi.fn() }));

const workspaceId = 'workspace_1' as Id<'workspace'>;
const bankAccountId = 'bank_account_1' as Id<'bankAccount'>;
const connectionAccount = { provider: 'plaid' as const, accountId: 'bank_link_account_1' as Id<'bankLinkAccount'> };

type PlacementArgs = {
  workspaceId: Id<'workspace'>;
  connectionAccount: typeof connectionAccount;
  bankAccountId: Id<'bankAccount'>;
  initialBalanceDate?: string;
};

describe('Plaid account placement', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T16:00:00Z'));
    vi.mocked(requireWorkspaceAccess).mockResolvedValue({ workspaceId } as Awaited<
      ReturnType<typeof requireWorkspaceAccess>
    >);
    vi.mocked(requireBankLinkAccountAccessForWorkspace).mockResolvedValue({
      bankLink: { itemId: 'item_1' },
      bankLinkAccount: { _id: connectionAccount.accountId, name: 'Checking', initialBalance: 12500 },
    } as Awaited<ReturnType<typeof requireBankLinkAccountAccessForWorkspace>>);
    vi.mocked(createBankAccountHandler).mockResolvedValue(bankAccountId);
    vi.mocked(updateBankAccountHandler).mockResolvedValue({ success: true });
  });

  afterEach(() => vi.useRealTimers());

  const db = { get: vi.fn().mockResolvedValue({ timezone: 'America/New_York' }), patch: vi.fn() };

  it.each([
    ['create', createBankAccountFromConnectionAccount, createBankAccountHandler],
    ['link', linkAccount, updateBankAccountHandler],
  ] as const)('starts a sync after %s commits the account placement', async (_name, registered, save) => {
    const handler = (registered as unknown as { _handler: (ctx: MutationCtx, args: PlacementArgs) => Promise<unknown> })
      ._handler;
    const runAfter = vi.fn();
    db.get.mockResolvedValue({ timezone: 'America/New_York' });
    const ctx = { db, scheduler: { runAfter } } as unknown as MutationCtx;

    await handler(ctx, { workspaceId, bankAccountId, connectionAccount, initialBalanceDate: '2026-09-06' });

    expect(save).toHaveBeenCalledOnce();
    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      bankAccountId,
      bankLinkAccountId: connectionAccount.accountId,
      generation: expect.any(String),
    });
    expect(vi.mocked(save).mock.invocationCallOrder[0]).toBeLessThan(runAfter.mock.invocationCallOrder[0]);
  });

  it('does not schedule a sync when saving the account placement fails', async () => {
    vi.mocked(updateBankAccountHandler).mockRejectedValue(new Error('Already linked'));
    const handler = (
      linkAccount as unknown as { _handler: (ctx: MutationCtx, args: PlacementArgs) => Promise<unknown> }
    )._handler;
    const runAfter = vi.fn();

    await expect(
      handler({ db, scheduler: { runAfter } } as unknown as MutationCtx, {
        workspaceId,
        bankAccountId,
        connectionAccount,
        initialBalanceDate: '2026-09-06',
      })
    ).rejects.toThrow('Already linked');
    expect(runAfter).not.toHaveBeenCalled();
  });

  it('accepts the old iOS link signature without a start date and uses the workspace day', async () => {
    vi.setSystemTime(new Date('2026-09-06T02:00:00Z'));
    db.get.mockResolvedValue({ timezone: 'America/New_York' });
    const handler = (
      linkAccount as unknown as { _handler: (ctx: MutationCtx, args: PlacementArgs) => Promise<unknown> }
    )._handler;
    const result = await handler({ db, scheduler: { runAfter: vi.fn() } } as unknown as MutationCtx, {
      workspaceId,
      bankAccountId,
      connectionAccount,
    });

    expect(result).toEqual({ success: true });
    expect(db.patch).toHaveBeenCalledWith(bankAccountId, {
      plaidInitialSync: expect.objectContaining({ startDate: '2026-09-05', preserveBalance: false }),
    });
  });

  it.each(['2026-02-31', '2027-01-01', 'not-a-date'])('rejects invalid or future account start date %s', (date) => {
    expect(() => resolvePlaidSyncStartDate(date, 'America/New_York')).toThrow('valid start date');
  });
});
