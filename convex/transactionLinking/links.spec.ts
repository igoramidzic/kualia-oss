import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FunctionArgs } from 'convex/server';
import { api, internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { requireWorkspaceAccess } from '../lib/auth';
import { updateLinkedTransactionsFromRawImports } from '../transactionImport/updateLinkedTransactions';
import { reconcileTransactionSideEffects } from '../transactions/reconciliation/reconcile';
import { approveTransactionLink } from './approveLink';
import { unlinkTransaction } from './unlink';

vi.mock('../lib/auth', () => ({ requireWorkspaceAccess: vi.fn() }));
vi.mock('../activityLogs/helpers', () => ({
  buildActivityContext: vi.fn(),
  buildActivityContextForClerkId: vi.fn(),
  buildSystemActivityContextForWorkspace: vi.fn(),
  recordTransactionActivity: vi.fn(),
}));
vi.mock('../transactions/reconciliation/reconcile', () => ({ reconcileTransactionSideEffects: vi.fn() }));

const workspaceId = 'workspace' as Id<'workspace'>;
const transactionId = 'manual' as Id<'transaction'>;
const rawId = 'raw' as Id<'transactionImportRaw'>;
const bankAccountId = 'bank' as Id<'bankAccount'>;
const categoryId = 'category' as Id<'category'>;
const bankMerchantId = 'bankMerchant' as Id<'merchant'>;
type Row = Record<string, unknown>;

function fixture(overrides: Partial<Doc<'transaction'>> = {}) {
  const transaction: Doc<'transaction'> = {
    _id: transactionId,
    _creationTime: 1,
    workspaceId,
    bankAccountId,
    type: 'regular',
    source: 'manual',
    date: '2026-09-30',
    dateYearMonth: 202609,
    totalAmount: -1000n,
    status: 'pending',
    reviewStatus: 'needs_review',
    isDeleted: false,
    movements: [{ amount: -1000n, categoryId, readyToAssign: false, sortOrder: 0 }],
    notes: 'Keep my note',
    searchText: '',
    hasUncategorized: false,
    hasMissingPayee: false,
    linkedRawTransactionId: rawId,
    transactionImportRawId: rawId,
    importDetails: { provider: 'plaid', date: '2026-09-30', amount: -1000n, merchantName: 'Old bank name' },
    ...overrides,
  };
  const rows = new Map<string, Row>([
    [transactionId, transaction],
    [
      rawId,
      {
        _id: rawId,
        workspaceId,
        amount: -1101n,
        date: '2026-10-01',
        pending: false,
        merchantName: 'Bank cafe',
        originalStatement: 'BANK CAFE',
        importStatus: 'inserted',
        plaidAccountId: 'plaid-bank',
      },
    ],
    [bankAccountId, { _id: bankAccountId, workspaceId, accountType: 'banking_checking' }],
    [categoryId, { _id: categoryId, workspaceId, name: 'Food' }],
    [bankMerchantId, { _id: bankMerchantId, workspaceId, name: 'Bank cafe', isDeleted: false }],
  ]);
  const tables = new Map<string, string>([
    [transactionId, 'transaction'],
    [rawId, 'transactionImportRaw'],
    [bankAccountId, 'bankAccount'],
    [categoryId, 'category'],
    [bankMerchantId, 'merchant'],
  ]);
  const insert = vi.fn(async (table: string, fields: Row) => {
    const id = `inserted-${rows.size}`;
    rows.set(id, { ...fields, _id: id, _creationTime: 1 });
    tables.set(id, table);
    return id;
  });
  const ctx = {
    db: {
      get: async (id: string) => structuredClone(rows.get(id) ?? null),
      patch: async (id: string, fields: Row) => rows.set(id, { ...rows.get(id), ...fields }),
      insert,
      query: (table: string) => {
        let candidates = [...rows.entries()].filter(([id]) => tables.get(id) === table).map(([, row]) => row);
        const index = {
          eq: (field: string, value: unknown) => {
            candidates = candidates.filter((row) => row[field] === value);
            return index;
          },
        };
        const query = {
          withIndex: (_name: string, apply: (q: typeof index) => unknown) => {
            apply(index);
            return query;
          },
          first: async () => structuredClone(candidates[0] ?? null),
          async *[Symbol.asyncIterator](): AsyncGenerator<Row> {
            yield* structuredClone(candidates);
          },
        };
        return query;
      },
    },
  } as unknown as MutationCtx;
  return { ctx, rows, insert, entry: () => rows.get(transactionId)! };
}

const approve = (
  approveTransactionLink as unknown as {
    _handler: (
      ctx: MutationCtx,
      args: FunctionArgs<typeof api.transactionLinking.approveTransactionLink>
    ) => Promise<unknown>;
  }
)._handler;
const unlink = (
  unlinkTransaction as unknown as {
    _handler: (
      ctx: MutationCtx,
      args: FunctionArgs<typeof api.transactionLinking.unlinkTransaction>
    ) => Promise<unknown>;
  }
)._handler;
const sync = (
  updateLinkedTransactionsFromRawImports as unknown as {
    _handler: (
      ctx: MutationCtx,
      args: FunctionArgs<
        typeof internal.transactionImport.updateLinkedTransactions.updateLinkedTransactionsFromRawImports
      >
    ) => Promise<unknown>;
  }
)._handler;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireWorkspaceAccess).mockResolvedValue({ workspaceId, user: { subject: 'user' } } as Awaited<
    ReturnType<typeof requireWorkspaceAccess>
  >);
});

describe('bank match approval and rejection', () => {
  it('applies current bank amount/date to movements and reconciles the ledger once', async () => {
    const { ctx, entry, insert } = fixture();
    await approve(ctx, { workspaceId, transactionId, resolutions: { useImportAmount: true, useImportDate: true } });
    expect(entry()).toMatchObject({
      totalAmount: -1101n,
      date: '2026-10-01',
      dateYearMonth: 202610,
      movements: [{ amount: -1101n, categoryId }],
      status: 'cleared',
      reviewStatus: 'reviewed',
      notes: 'Keep my note',
    });
    expect(entry().searchText).toContain('1101');
    expect(reconcileTransactionSideEffects).toHaveBeenCalledExactlyOnceWith(
      ctx,
      expect.objectContaining({ totalAmount: -1000n, date: '2026-09-30', status: 'pending' }),
      expect.objectContaining({
        totalAmount: -1101n,
        date: '2026-10-01',
        status: 'cleared',
        movements: [expect.objectContaining({ amount: -1101n, categoryId })],
      })
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it('preserves chosen manual values and reconciled status', async () => {
    const { ctx, entry } = fixture({ status: 'reconciled' });
    await approve(ctx, { workspaceId, transactionId, resolutions: { useImportAmount: false, useImportDate: false } });
    expect(entry()).toMatchObject({
      totalAmount: -1000n,
      date: '2026-09-30',
      status: 'reconciled',
      reviewStatus: 'reviewed',
    });
  });

  it('scales split movements with an exact remainder and preserves their categories', async () => {
    const { ctx, entry } = fixture({
      movements: [
        { amount: -600n, categoryId, readyToAssign: false, sortOrder: 0 },
        { amount: -400n, readyToAssign: true, sortOrder: 1 },
      ],
    });
    await approve(ctx, { workspaceId, transactionId, resolutions: { useImportAmount: true } });
    expect(entry().movements).toMatchObject([
      { amount: -660n, categoryId },
      { amount: -441n, readyToAssign: true },
    ]);
    expect(entry().totalAmount).toBe(-1101n);
  });

  it.each(['manual', 'scheduled'] as const)(
    'unlinks a %s entry without losing its plan or counting it twice',
    async (source) => {
      const scheduledTransactionId = 'plan' as Id<'scheduledTransaction'>;
      const { ctx, entry, rows, insert } = fixture({ source, scheduledTransactionId });
      await unlink(ctx, { workspaceId, transactionId });
      expect(entry()).toMatchObject({
        source,
        scheduledTransactionId,
        totalAmount: -1000n,
        reviewStatus: 'reviewed',
        notes: 'Keep my note',
        rejectedLinkIds: [rawId],
      });
      expect(entry().linkedRawTransactionId).toBeUndefined();
      expect(entry().transactionImportRawId).toBeUndefined();
      expect(entry().importDetails).toBeUndefined();
      expect(entry().searchText).not.toContain('oldbankname');
      const imported = [...rows.values()].find((row) => row.source === 'automatic_import');
      expect(imported).toMatchObject({
        totalAmount: -1101n,
        date: '2026-10-01',
        status: 'cleared',
        reviewStatus: 'needs_review',
        transactionImportRawId: rawId,
        hasUncategorized: true,
        hasMissingPayee: false,
        merchantId: bankMerchantId,
      });
      expect(imported?.scheduledTransactionId).toBeUndefined();
      expect(imported?.notes).toBeUndefined();
      expect(reconcileTransactionSideEffects).toHaveBeenCalledExactlyOnceWith(
        ctx,
        null,
        expect.objectContaining({ totalAmount: -1101n, status: 'cleared' })
      );
      await expect(unlink(ctx, { workspaceId, transactionId })).rejects.toThrow('no linked import');
      expect(insert).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['approve', 'unlink'] as const)('resolves the bank merchant and global logo on %s', async (action) => {
    const manualMerchantId = 'manualMerchant' as Id<'merchant'>;
    const { ctx, rows, entry, insert } = fixture({ merchantId: manualMerchantId });
    rows.set(manualMerchantId, { _id: manualMerchantId, workspaceId, name: 'Different shop', isDeleted: false });
    rows.set(bankMerchantId, {
      _id: bankMerchantId,
      workspaceId,
      globalMerchantId: 'globalBankMerchant',
      isDeleted: false,
    });
    rows.set('globalBankMerchant', {
      _id: 'globalBankMerchant',
      name: 'BANK CAFE',
      logoUrl: 'https://example.com/cafe.png',
    });

    if (action === 'approve') {
      await approve(ctx, { workspaceId, transactionId, resolutions: { useImportMerchant: true } });
      expect(entry().merchantId).toBe(bankMerchantId);
      expect(insert).not.toHaveBeenCalled();
    } else {
      await unlink(ctx, { workspaceId, transactionId });
      expect(entry().merchantId).toBe(manualMerchantId);
      expect(insert).toHaveBeenCalledExactlyOnceWith(
        'transaction',
        expect.objectContaining({ merchantId: bankMerchantId, hasMissingPayee: false })
      );
    }
    expect(rows.get(bankMerchantId)?.globalMerchantId).toBe('globalBankMerchant');
    expect(rows.get('globalBankMerchant')?.logoUrl).toBe('https://example.com/cafe.png');
  });

  it('uses the bank logo when rejection needs a new merchant', async () => {
    const { ctx, rows, insert } = fixture();
    rows.set(rawId, { ...rows.get(rawId), merchantName: 'New bank cafe', logoUrl: 'https://example.com/new.png' });
    await unlink(ctx, { workspaceId, transactionId });
    const merchant = [...rows.values()].find((row) => row.name === 'New bank cafe');
    expect(merchant?.logoUrl).toBe('https://example.com/new.png');
    expect(insert).toHaveBeenCalledWith(
      'transaction',
      expect.objectContaining({ merchantId: merchant?._id, hasMissingPayee: false })
    );
  });

  it('keeps an unidentified bank merchant empty rather than copying the rejected manual merchant', async () => {
    const { ctx, rows, insert } = fixture({ merchantId: bankMerchantId });
    rows.set(rawId, { ...rows.get(rawId), merchantName: undefined, originalStatement: undefined });
    await unlink(ctx, { workspaceId, transactionId });
    expect(insert).toHaveBeenCalledExactlyOnceWith(
      'transaction',
      expect.objectContaining({ merchantId: undefined, hasMissingPayee: true })
    );
  });

  it.each(['approve', 'unlink'] as const)('rejects cross-workspace %s and foreign raw imports', async (action) => {
    const handler = action === 'approve' ? approve : unlink;
    const { ctx, rows } = fixture({ workspaceId: 'foreign' as Id<'workspace'> });
    await expect(handler(ctx, { workspaceId, transactionId })).rejects.toThrow('Access denied');
    rows.set(transactionId, { ...rows.get(transactionId), workspaceId });
    rows.set(rawId, { ...rows.get(rawId), workspaceId: 'foreign' });
    await expect(handler(ctx, { workspaceId, transactionId })).rejects.toThrow('Raw transaction not found');
    expect(reconcileTransactionSideEffects).not.toHaveBeenCalled();
  });

  it('refreshes posted bank details on an approved manual match without overwriting user choices', async () => {
    const { ctx, entry } = fixture({ reviewStatus: 'reviewed', source: 'scheduled' });
    await sync(ctx, { rawImportIds: [rawId] });
    expect(entry()).toMatchObject({
      totalAmount: -1000n,
      date: '2026-09-30',
      source: 'scheduled',
      status: 'cleared',
      reviewStatus: 'needs_review',
      importDetails: { amount: -1101n, date: '2026-10-01', merchantName: 'Bank cafe' },
    });
    expect(reconcileTransactionSideEffects).toHaveBeenCalledOnce();
  });
});
