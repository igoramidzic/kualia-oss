import { describe, expect, it } from 'vitest';
import type { Doc, Id } from '../_generated/dataModel';
import { buildHomeDashboard, HOME_LIMITS, resolveHomeMerchant } from './calculations';

const workspace = {
  _id: 'workspace',
  name: 'Personal',
  currency: 'usd',
  timezone: 'America/New_York',
} as Doc<'workspace'>;
const account = (id = 'checking', balance = 10000n, overrides: Partial<Doc<'bankAccount'>> = {}) =>
  ({
    _id: id as Id<'bankAccount'>,
    workspaceId: workspace._id,
    name: id,
    accountType: 'banking_checking',
    currentBalance: balance,
    isClosed: false,
    isDeleted: false,
    ...overrides,
  }) as Doc<'bankAccount'>;
const schedule = (overrides: Partial<Doc<'scheduledTransaction'>> = {}) =>
  ({
    _id: 'bill' as Id<'scheduledTransaction'>,
    workspaceId: workspace._id,
    bankAccountId: 'checking' as Id<'bankAccount'>,
    status: 'active',
    isDeleted: false,
    recurrence: 'once',
    anchorDate: '2026-09-06',
    nextDate: '2026-09-06',
    movements: [{ amount: -15000n }],
    ...overrides,
  }) as Doc<'scheduledTransaction'>;
const transaction = (overrides: Partial<Doc<'transaction'>> = {}) =>
  ({
    _id: 'purchase' as Id<'transaction'>,
    workspaceId: workspace._id,
    bankAccountId: 'checking' as Id<'bankAccount'>,
    date: '2026-09-04',
    totalAmount: -1200n,
    type: 'regular',
    reviewStatus: 'needs_review',
    hasUncategorized: true,
    isDeleted: false,
    ...overrides,
  }) as Doc<'transaction'>;
function build(overrides: Partial<Parameters<typeof buildHomeDashboard>[0]> = {}) {
  return buildHomeDashboard({
    workspace,
    today: '2026-09-05',
    accounts: [account()],
    schedules: [],
    reviews: [],
    uncategorized: [],
    recent: [],
    merchants: [],
    ...overrides,
  });
}

describe('Home briefing', () => {
  it('returns a valid empty workspace without invented insights', () => {
    const result = build({ accounts: [] });
    expect(result.accounts).toEqual([]);
    expect(result.upcomingCount).toBe(0);
    expect(result.spending).toBeNull();
    expect(result.isPartial).toBe(false);
  });
  it('projects each account separately and does not replay registered spending', () => {
    const result = build({
      accounts: [account(), account('savings', 100000n)],
      schedules: [schedule()],
      recent: [transaction()],
    });
    expect(result.accounts[0].lowestBalance).toBe('-5000');
    expect(result.accounts[1].lowestBalance).toBe('100000');
    expect(result.accounts[0].points[0].amount).toBe('10000');
  });
  it('checks debit-first shortfalls when a paycheck arrives the same day', () => {
    const result = build({
      schedules: [schedule(), schedule({ _id: 'pay' as Id<'scheduledTransaction'>, movements: [{ amount: 30000n }] })],
    });
    expect(result.accounts[0].lowestBalance).toBe('-5000');
    expect(result.accounts[0].points.slice(-1)[0]?.amount).toBe('25000');
  });
  it('moves transfers between accounts without inflating income or spending', () => {
    const result = build({
      accounts: [account(), account('savings', 0n)],
      schedules: [
        schedule({
          transactionType: 'transfer',
          transferToAccountId: 'savings' as Id<'bankAccount'>,
          movements: [{ amount: 7000n }],
        }),
      ],
    });
    expect(result.accounts.find((a) => a.id === 'checking')?.points.slice(-1)[0]?.amount).toBe('3000');
    expect(result.accounts.find((a) => a.id === 'savings')?.points.slice(-1)[0]?.amount).toBe('7000');
    expect(result.incoming).toBe('0');
    expect(result.outgoing).toBe('0');
  });
  it('uses the next unentered occurrence and only the latest overdue date', () => {
    const result = build({
      schedules: [schedule({ recurrence: 'daily', nextDate: '2026-09-01', anchorDate: '2026-09-01' })],
    });
    expect(result.overdue.map((o) => o.date)).toEqual(['2026-09-04']);
    expect(result.upcomingCount).toBe(8);
    expect(result.outgoing).toBe('120000');
  });
  it('does not fabricate forecasts for paused, completed, deleted, closed, or liability accounts', () => {
    const result = build({
      accounts: [
        account(),
        account('credit', -3000n, { accountType: 'credit_credit_card' }),
        account('closed', 100n, { isClosed: true }),
      ],
      schedules: [schedule({ status: 'paused' }), schedule({ status: 'completed' }), schedule({ isDeleted: true })],
    });
    expect(result.accounts.map((a) => a.id)).toEqual(['checking']);
    expect(result.upcomingCount).toBe(0);
  });
  it('rejects foreign workspace rows defensively and counts overlapping issues separately', () => {
    const foreign = transaction({ workspaceId: 'other' as Id<'workspace'> });
    const result = build({
      reviews: [transaction(), foreign],
      uncategorized: [transaction(), foreign],
      schedules: [schedule({ workspaceId: 'other' as Id<'workspace'> })],
    });
    expect(result.reviews.count).toBe(1);
    expect(result.uncategorized.count).toBe(1);
    expect(result.upcomingCount).toBe(0);
  });
  it('hides forecasts for truncated or invalid schedules instead of reporting safe balances', () => {
    expect(build({ schedules: Array.from({ length: HOME_LIMITS.schedules + 1 }, () => schedule()) }).accounts).toEqual(
      []
    );
    expect(build({ schedules: [schedule({ nextDate: 'bad' })] }).isPartial).toBe(true);
    expect(build({ schedules: [schedule({ recurrence: 'daily', nextDate: '2000-01-01' })] }).isPartial).toBe(true);
    expect(build({ schedules: [schedule({ transactionType: 'transfer' })] }).isPartial).toBe(true);
  });
  it('labels capped counts and suppresses capped spending comparisons', () => {
    const rows = Array.from({ length: HOME_LIMITS.attention + 1 }, () => transaction());
    expect(build({ reviews: rows }).reviews).toMatchObject({ count: 500, hasMore: true });
    expect(
      build({ recent: Array.from({ length: HOME_LIMITS.spending + 1 }, () => transaction()) }).spending
    ).toBeNull();
  });
  it('compares completed weeks, excluding today, refunds, transfers and adjustments', () => {
    const result = build({
      recent: [
        transaction(),
        transaction({ date: '2026-08-25', totalAmount: -2000n }),
        transaction({ date: '2026-09-05' }),
        transaction({ totalAmount: 300n }),
        transaction({ type: 'transfer' }),
        transaction({ type: 'balance_adjustment' }),
      ],
    });
    expect(result.spending).toMatchObject({ current: '1200', previous: '2000' });
  });
  it('preserves amounts beyond JS safe integers and workspace currency precision', () => {
    const result = build({
      workspace: { ...workspace, currency: 'jpy' },
      accounts: [account('checking', 9007199254740993n)],
    });
    expect(result.workspace.minorUnit).toBe(0);
    expect(result.accounts[0].currentBalance).toBe('9007199254740993');
  });
  it('preserves month-end anchors', () => {
    const result = build({
      today: '2026-02-27',
      schedules: [schedule({ recurrence: 'monthly', anchorDate: '2026-01-31', nextDate: '2026-02-28' })],
    });
    expect(result.upcoming.map((o) => o.date)).toEqual(['2026-02-28']);
  });
});

describe('scheduled merchant logos', () => {
  const merchant = { _id: 'merchant', workspaceId: workspace._id, isDeleted: false } as Doc<'merchant'>;
  const global = { name: 'Spotify', logoUrl: 'https://example.com/spotify.png' } as Doc<'globalMerchant'>;
  it('inherits global names and logos while honoring custom, removed, and icon identities', () => {
    expect(resolveHomeMerchant(merchant, global)).toMatchObject({ name: 'Spotify', logoUrl: global.logoUrl });
    expect(resolveHomeMerchant({ ...merchant, logoUrl: 'https://example.com/custom.png' }, global).logoUrl).toBe(
      'https://example.com/custom.png'
    );
    expect(resolveHomeMerchant({ ...merchant, logoUrl: null }, global).logoUrl).toBeNull();
    expect(resolveHomeMerchant({ ...merchant, visualIdentityMode: 'icon' }, global).logoUrl).toBeNull();
  });
  it('includes the resolved logo with scheduled occurrences', () => {
    const result = build({
      merchants: [resolveHomeMerchant(merchant, global)],
      schedules: [schedule({ merchantId: merchant._id })],
    });
    expect(result.upcoming[0]).toMatchObject({ name: 'Spotify', logoUrl: global.logoUrl });
  });
});
