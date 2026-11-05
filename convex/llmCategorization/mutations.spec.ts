import { describe, expect, it, vi } from 'vitest';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { type MappingResult, storeMappings } from './mutations';

const workspaceId = 'workspace' as Id<'workspace'>;
const categoryId = 'category' as Id<'category'>;
type Row = Record<string, unknown>;
class Index {
  filters: Array<[string, unknown]> = [];
  eq(field: string, value: unknown): this {
    this.filters.push([field, value]);
    return this;
  }
}
const handler = (
  storeMappings as unknown as {
    _handler: (
      ctx: MutationCtx,
      args: { workspaceId: Id<'workspace'>; source?: 'llm' | 'typesafe'; results: MappingResult[] }
    ) => Promise<null>;
  }
)._handler;
function context(existing: Row | null = null, categoryOverrides: Row = {}) {
  const docs = new Map<string, Row>([
    [workspaceId, { _id: workspaceId, isDeleted: false }],
    [
      categoryId,
      {
        _id: categoryId,
        workspaceId,
        categoryGroupId: 'group',
        isDeleted: false,
        isArchived: false,
        ...categoryOverrides,
      },
    ],
    ['group', { _id: 'group', workspaceId, type: 'expense', isDeleted: false }],
  ]);
  const insert = vi.fn(async () => 'new-mapping');
  const patch = vi.fn();
  const query = () => ({
    withIndex: (_name: string, apply: (index: Index) => Index) => {
      const index = apply(new Index());
      return {
        first: async () =>
          existing && index.filters.every(([field, value]) => existing[field] === value) ? existing : null,
      };
    },
  });
  return {
    ctx: { db: { get: async (id: string) => docs.get(id) ?? null, query, insert, patch } } as unknown as MutationCtx,
    insert,
    patch,
    docs,
  };
}
const result: MappingResult = {
  merchantName: 'shop',
  amountDirection: 'negative',
  categoryId,
  confidence: 0.2,
  model: 'jev-1.13.0',
  modelConfidence: 0.8,
  usedFallback: true,
  failed: false,
};

describe('store automated merchant mappings', () => {
  it('records Jev provenance without inflating fallback probability', async () => {
    const { ctx, insert } = context();
    await handler(ctx, { workspaceId, source: 'typesafe', results: [result] });
    expect(insert).toHaveBeenCalledWith(
      'orgMerchantCategoryMapping',
      expect.objectContaining({
        categoryId,
        source: 'typesafe',
        confidence: 0.2,
        modelConfidence: 0.8,
        usedFallback: true,
        model: 'jev-1.13.0',
        amountDirection: 'negative',
        categorizationFailed: false,
      })
    );
  });
  it.each(['manual', 'llm', 'typesafe'])(
    'preserves a successful %s choice that appeared while inference was running',
    async (source) => {
      const { ctx, insert, patch } = context({
        _id: 'mapping',
        workspaceId,
        merchantName: 'shop',
        amountDirection: 'negative',
        source,
        categoryId,
      });
      await handler(ctx, { workspaceId, source: 'typesafe', results: [result] });
      expect(insert).not.toHaveBeenCalled();
      expect(patch).not.toHaveBeenCalled();
    }
  );
  it('allows a new Jev result to replace a previously failed attempt', async () => {
    const { ctx, patch } = context({
      _id: 'mapping',
      workspaceId,
      merchantName: 'shop',
      amountDirection: 'negative',
      source: 'llm',
      categorizationFailed: true,
    });
    await handler(ctx, { workspaceId, source: 'typesafe', results: [result] });
    expect(patch).toHaveBeenCalledWith(
      'mapping',
      expect.objectContaining({ categoryId, source: 'typesafe', categorizationFailed: false })
    );
  });
  it.each([{ workspaceId: 'foreign' }, { isDeleted: true }, { isArchived: true }])(
    'ignores categories that became invalid during inference: %j',
    async (override) => {
      const { ctx, insert, patch } = context(null, override);
      await handler(ctx, { workspaceId, source: 'typesafe', results: [result] });
      expect(insert).not.toHaveBeenCalled();
      expect(patch).not.toHaveBeenCalled();
    }
  );
  it('does not write into a deleted workspace', async () => {
    const { ctx, docs, insert } = context();
    docs.set(workspaceId, { isDeleted: true });
    await expect(handler(ctx, { workspaceId, source: 'typesafe', results: [result] })).rejects.toThrow(
      'Workspace not found'
    );
    expect(insert).not.toHaveBeenCalled();
  });
});
