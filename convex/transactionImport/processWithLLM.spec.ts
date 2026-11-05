import { describe, expect, it, vi } from 'vitest';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx, MutationCtx } from '../_generated/server';
import { buildMerchantCategorizationInput, type MerchantInput } from '../llmCategorization/helpers';
import { normalizePlaidComparisonInput } from '../llmCategorization/comparison';
import { processTransactionImportsWithLLM, scanMerchantsNeedingCategorization } from './processWithLLM';

type Row = Record<string, unknown>;
const workspaceId = 'workspace' as Id<'workspace'>;
class Index {
  filters: Array<[string, unknown]> = [];
  eq(field: string, value: unknown): this {
    this.filters.push([field, value]);
    return this;
  }
}
class Query {
  constructor(private rows: Row[]) {}
  withIndex(_name: string, apply: (index: Index) => Index): this {
    const index = apply(new Index());
    this.rows = this.rows.filter((row) => index.filters.every(([key, value]) => row[key] === value));
    return this;
  }
  async take(limit: number): Promise<Row[]> {
    return this.rows.slice(0, limit);
  }
  async first(): Promise<Row | null> {
    return this.rows[0] ?? null;
  }
}
const scan = (
  scanMerchantsNeedingCategorization as unknown as {
    _handler: (ctx: MutationCtx, args: { workspaceId: Id<'workspace'> }) => Promise<MerchantInput[]>;
  }
)._handler;
function raw(overrides: Row = {}): Row {
  return {
    workspaceId,
    importStatus: 'awaiting_insert_job',
    merchantName: 'Mobile Provider',
    originalStatement: 'MOBILE PLAN MONTHLY',
    amount: -3000n,
    plaidCategory: ['Food and Drink', 'Restaurants'],
    plaidPersonalFinanceCategory: {
      primary: 'RENT_AND_UTILITIES',
      detailed: 'RENT_AND_UTILITIES_TELEPHONE',
      confidence: 'HIGH',
    },
    ...overrides,
  };
}

describe('Jev import inputs', () => {
  it('matches the approved expense inputs, skips inflows, and scopes pending rows', async () => {
    const data: Record<string, Row[]> = {
      transactionImportRaw: [
        raw(),
        raw({ amount: -4000n }),
        raw({ amount: 3000n }),
        raw({ workspaceId: 'other' }),
        raw({ importStatus: 'inserted' }),
      ],
      merchant: [],
      orgMerchantCategoryMapping: [],
    };
    const ctx = {
      db: {
        get: async () => ({ _id: workspaceId, isDeleted: false }),
        query: (table: string) => new Query(data[table] ?? []),
      },
    } as unknown as MutationCtx;
    const merchants = await scan(ctx, { workspaceId });
    expect(merchants).toHaveLength(1);
    expect(merchants[0]).toEqual(
      normalizePlaidComparisonInput(
        {
          merchant_name: 'Mobile Provider',
          name: 'MOBILE PLAN MONTHLY',
          amount: 30,
          category: ['Food and Drink', 'Restaurants'],
          personal_finance_category: {
            primary: 'RENT_AND_UTILITIES',
            detailed: 'RENT_AND_UTILITIES_TELEPHONE',
            confidence_level: 'HIGH',
          },
        },
        'plaid_v2'
      )
    );
    expect(merchants[0].amountDirection).toBe('negative');
    expect(JSON.stringify(merchants)).not.toContain('"amount":');
  });
  it('keeps existing mappings and user suggestions ahead of Jev calls', async () => {
    const data: Record<string, Row[]> = {
      transactionImportRaw: [raw(), raw({ merchantName: 'Favorite Cafe' }), raw({ merchantName: 'New Shop' })],
      merchant: [{ workspaceId, name: 'Favorite Cafe', isDeleted: false, suggestedCategoryIds: ['dining'] }],
      orgMerchantCategoryMapping: [
        {
          workspaceId,
          merchantName: 'mobile provider',
          amountDirection: 'negative',
          categoryId: 'phone',
          source: 'manual',
        },
      ],
    };
    const ctx = {
      db: { get: async () => ({ _id: workspaceId }), query: (table: string) => new Query(data[table] ?? []) },
    } as unknown as MutationCtx;
    expect((await scan(ctx, { workspaceId })).map((merchant) => merchant.merchantName)).toEqual(['new shop']);
  });
  it('retains statement fallback and usable legacy hints when PFC is missing', () => {
    expect(
      buildMerchantCategorizationInput({
        merchantName: ' ',
        originalStatement: 'MTA NYCT PAYGO',
        amountDirection: 'negative',
        plaidCategory: ['Travel'],
      })
    ).toMatchObject({
      merchantName: 'mta nyct paygo',
      plaidCategory: ['Travel'],
      transactionContext: { statementName: 'MTA NYCT PAYGO', bankHintSource: 'legacy_category' },
    });
  });
  it('continues importing when categorization fails', async () => {
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce([{ merchantName: 'shop', amountDirection: 'negative' }])
      .mockResolvedValueOnce({ processedCount: 0, errorCount: 0, timestamp: '2026-09-21T00:00:00Z' });
    const runAction = vi.fn().mockRejectedValue(new Error('Jev unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handler = (
      processTransactionImportsWithLLM as unknown as {
        _handler: (ctx: ActionCtx, args: { workspaceId: Id<'workspace'> }) => Promise<{ processedCount: number }>;
      }
    )._handler;
    try {
      expect((await handler({ runMutation, runAction } as unknown as ActionCtx, { workspaceId })).processedCount).toBe(
        0
      );
      expect(runMutation).toHaveBeenCalledTimes(2);
    } finally {
      log.mockRestore();
    }
  });
});
