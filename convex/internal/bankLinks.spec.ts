import { type FunctionArgs, getFunctionName } from 'convex/server';
import { describe, expect, it, vi } from 'vitest';

import type { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { ActionCtx, MutationCtx } from '../_generated/server';
import { handleUpdateModeSuccess } from '../bankProviders/plaid/handleUpdateModeSuccess';
import { setBankLinkReauthorization, updateBankLinkStatus } from './bankLinks';

type WarningArgs = FunctionArgs<typeof internal.internal.bankLinks.setBankLinkReauthorization>;
type StatusArgs = FunctionArgs<typeof internal.internal.bankLinks.updateBankLinkStatus>;
const warn = (
  setBankLinkReauthorization as unknown as {
    _handler: (ctx: MutationCtx, args: WarningArgs) => Promise<null>;
  }
)._handler;
const updateStatus = (
  updateBankLinkStatus as unknown as {
    _handler: (ctx: MutationCtx, args: StatusArgs) => Promise<null>;
  }
)._handler;
const repair = (
  handleUpdateModeSuccess as unknown as {
    _handler: (ctx: ActionCtx, args: { bankLinkId: Id<'bankLink'> }) => Promise<{ success: boolean }>;
  }
)._handler;
const warning: WarningArgs = {
  itemId: 'item_1',
  reauthorization: { reason: 'consent_expiring', requiredBy: '2026-09-19T12:00:00.000Z' },
};

function fixture(status: Doc<'bankLink'>['itemStatus'] = 'Healthy', isDeleted = false) {
  const bank = {
    _id: 'bank_1' as Id<'bankLink'>,
    itemId: 'item_1',
    ownerId: 'owner',
    itemStatus: status,
    isDeleted,
    reauthorization: undefined as Doc<'bankLink'>['reauthorization'],
  };
  const patch = vi.fn(async (id: Id<'bankLink'>, fields: Partial<Doc<'bankLink'>>) => {
    expect(id).toBe(bank._id);
    Object.assign(bank, fields);
  });
  const bounds = { eq: vi.fn() };
  const ctx = {
    db: {
      query: (table: string) => {
        expect(table).toBe('bankLink');
        return {
          withIndex: (index: string, build: (q: typeof bounds) => unknown) => {
            expect(index).toBe('by_itemId');
            build(bounds);
            expect(bounds.eq).toHaveBeenLastCalledWith('itemId', bank.itemId);
            return { first: async () => bank };
          },
        };
      },
      patch,
    },
    scheduler: { runAfter: vi.fn() },
  } as unknown as MutationCtx;
  return { bank, ctx, patch };
}

describe('bank reauthorization lifecycle', () => {
  it.each(['Healthy', 'Pending', 'Error'] as const)('preserves %s health while storing a warning', async (status) => {
    const { bank, ctx } = fixture(status);
    await warn(ctx, warning);
    expect(bank.itemStatus).toBe(status);
    expect(bank.reauthorization).toEqual(warning.reauthorization);
  });

  it('keeps an unrelated expiration warning after login repair or a healthy status update', async () => {
    const { bank, ctx } = fixture();
    await warn(ctx, warning);
    await updateStatus(ctx, { itemId: bank.itemId, itemStatus: 'Healthy' });
    expect(bank.reauthorization).toEqual(warning.reauthorization);
  });

  it('clears the warning on successful update mode and schedules sync of the existing item', async () => {
    const { bank, ctx } = fixture();
    await warn(ctx, warning);
    const runAfter = vi.fn();
    const runMutation = vi.fn(async (ref, args: StatusArgs) => {
      expect(getFunctionName(ref)).toBe('internal/bankLinks:updateBankLinkStatus');
      return updateStatus(ctx, args);
    });
    const actionCtx = {
      auth: { getUserIdentity: async () => ({ subject: 'owner' }) },
      runQuery: vi.fn().mockResolvedValue({ itemId: bank.itemId }),
      runMutation,
      scheduler: { runAfter },
    } as unknown as ActionCtx;
    expect(await repair(actionCtx, { bankLinkId: bank._id })).toEqual({ success: true });
    expect(bank.itemStatus).toBe('Healthy');
    expect(bank.reauthorization).toBeUndefined();
    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), { itemId: bank.itemId });
  });

  it('clears the advance warning on disconnection and ignores a late pending warning', async () => {
    const { bank, ctx, patch } = fixture();
    await warn(ctx, warning);
    await updateStatus(ctx, { itemId: bank.itemId, itemStatus: 'Disconnected' });
    expect(bank.reauthorization).toBeUndefined();
    patch.mockClear();
    await warn(ctx, warning);
    expect(patch).not.toHaveBeenCalled();
    expect(bank.itemStatus).toBe('Disconnected');
  });

  it('never updates a deleted bank link', async () => {
    const { ctx, patch } = fixture('Healthy', true);
    await warn(ctx, warning);
    await updateStatus(ctx, { itemId: 'item_1', itemStatus: 'Healthy', clearReauthorization: true });
    expect(patch).not.toHaveBeenCalled();
  });

  it('does not clear the warning if update mode authorization fails', async () => {
    const { bank, ctx } = fixture();
    await warn(ctx, warning);
    const runMutation = vi.fn();
    const actionCtx = {
      auth: { getUserIdentity: async () => ({ subject: 'other' }) },
      runQuery: vi.fn().mockRejectedValue(new Error('Access denied')),
      runMutation,
    } as unknown as ActionCtx;
    await expect(repair(actionCtx, { bankLinkId: bank._id })).rejects.toThrow('Access denied');
    expect(runMutation).not.toHaveBeenCalled();
    expect(bank.reauthorization).toEqual(warning.reauthorization);
  });
});
