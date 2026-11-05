import type { FunctionArgs, FunctionReturnType } from 'convex/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { api } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

import { APPLE_WALLET_LOGO_URL } from '../lib/logoUtils';
import { getBankAccount, getBankAccountByShortId, getBankAccountLogoFields, getFirstBalanceYearMonth } from './queries';

describe('getFirstBalanceYearMonth', () => {
  it('has no historical month for a new account without balance activity', () => {
    expect(getFirstBalanceYearMonth({})).toBeNull();
    expect(getFirstBalanceYearMonth({ monthlyBalances: {} })).toBeNull();
  });

  it('uses the earliest recorded month, including backdated or zero-net activity', () => {
    expect(getFirstBalanceYearMonth({ monthlyBalances: { '202609': 100n, '202401': 0n, '202508': 30n } })).toBe(
      '2024-01'
    );
  });

  it('ignores malformed or impossible legacy month keys', () => {
    expect(
      getFirstBalanceYearMonth({
        monthlyBalances: { '000001': 1n, '202500': 1n, '202513': 1n, '2025-01': 1n, '20251': 1n, '202609': 1n },
      })
    ).toBe('2026-09');
  });
});

describe('getBankAccountLogoFields', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the Apple Wallet logo as the default for FinanceKit accounts', () => {
    const logoFields = getBankAccountLogoFields({}, null, true);

    expect(logoFields).toEqual({
      institutionLogoUrl: APPLE_WALLET_LOGO_URL,
      resolvedLogoUrl: APPLE_WALLET_LOGO_URL,
    });
  });

  it('lets custom account logos override the Apple Wallet default', () => {
    const logoFields = getBankAccountLogoFields({ logoUrl: 'https://cdn.example.com/custom.png' }, null, true);

    expect(logoFields).toEqual({
      institutionLogoUrl: APPLE_WALLET_LOGO_URL,
      resolvedLogoUrl: 'https://cdn.example.com/custom.png',
    });
  });

  it('preserves explicit logo removal while keeping the Apple Wallet reset option', () => {
    const logoFields = getBankAccountLogoFields({ logoUrl: null }, null, true);

    expect(logoFields).toEqual({
      institutionLogoUrl: APPLE_WALLET_LOGO_URL,
      resolvedLogoUrl: undefined,
    });
  });
});

vi.mock('../lib/auth', () => ({
  requireWorkspaceAccess: vi.fn(async (_ctx: unknown, workspaceId: Id<'workspace'>) => ({
    user: { subject: 'test-user' },
    workspaceId,
  })),
}));
vi.mock('./favorites', () => ({ getFavoriteBankAccountIds: vi.fn(async () => new Set()) }));

describe('account detail balance history', () => {
  it.each([
    { monthlyBalances: undefined, expected: null },
    { monthlyBalances: { '202609': 100n, '202401': 0n }, expected: '2024-01' },
  ])('includes the first balance month in both detail queries: $expected', async ({ monthlyBalances, expected }) => {
    const workspaceId = 'workspace' as Id<'workspace'>;
    const account: Doc<'bankAccount'> = {
      _id: 'account-12345678' as Id<'bankAccount'>,
      _creationTime: 1,
      workspaceId,
      name: 'Checking',
      accountType: 'banking_checking',
      currentBalance: 100n,
      isClosed: false,
      isDeleted: false,
      monthlyBalances,
    };
    const query = {
      withIndex: vi.fn().mockReturnThis(),
      filter: vi.fn().mockReturnThis(),
      collect: vi.fn(async () => [account]),
    };
    const ctx = { db: { get: vi.fn(async () => account), query: vi.fn(() => query) } } as unknown as QueryCtx;
    const byId = (
      getBankAccount as unknown as {
        _handler: (
          ctx: QueryCtx,
          args: FunctionArgs<typeof api.bankAccounts.getBankAccount>
        ) => Promise<FunctionReturnType<typeof api.bankAccounts.getBankAccount>>;
      }
    )._handler;
    const byShortId = (
      getBankAccountByShortId as unknown as {
        _handler: (
          ctx: QueryCtx,
          args: FunctionArgs<typeof api.bankAccounts.getBankAccountByShortId>
        ) => Promise<FunctionReturnType<typeof api.bankAccounts.getBankAccountByShortId>>;
      }
    )._handler;
    expect(await byId(ctx, { workspaceId, bankAccountId: account._id })).toHaveProperty(
      'firstBalanceYearMonth',
      expected
    );
    expect(await byShortId(ctx, { workspaceId, shortId: '12345678' })).toHaveProperty(
      'firstBalanceYearMonth',
      expected
    );
  });
});
