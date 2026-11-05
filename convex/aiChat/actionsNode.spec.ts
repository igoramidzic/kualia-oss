import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { generateThreadTitle, sendMessageImpl } from './actionsNode';

const mocks = vi.hoisted(() => ({
  models: [] as string[],
  streamText: vi.fn(),
  generateText: vi.fn(),
  generateObject: vi.fn(),
  updateThreadMetadata: vi.fn(),
}));

vi.mock('@convex-dev/agent', () => ({
  Agent: class {
    constructor(_component: unknown, options: { languageModel: { modelId: string } }) {
      mocks.models.push(options.languageModel.modelId);
    }
    streamText = mocks.streamText;
    updateThreadMetadata = mocks.updateThreadMetadata;
    createThread = async () => ({ threadId: 'thread-1' });
  },
  listStreams: async () => [],
}));
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText: mocks.generateText,
  generateObject: mocks.generateObject,
}));
vi.mock('../lib/auth', () => ({ requireAuthAction: async () => ({ subject: 'user-1' }) }));
vi.mock('../lib/posthog', () => ({ getPostHogClient: () => null }));
vi.mock('./mcp', () => ({ getDocsTools: async () => ({}) }));
vi.mock('./kualiaTools', () => ({ buildKualiaTools: () => ({ kualia_create_transactions: {} }) }));

type Attachment = { storageId: Id<'_storage'>; mediaType: string; filename: string };
const send = (
  sendMessageImpl as unknown as {
    _handler: (ctx: ActionCtx, args: { prompt: string; attachments?: Attachment[] }) => Promise<{ threadId: string }>;
  }
)._handler;
const title = (
  generateThreadTitle as unknown as {
    _handler: (ctx: ActionCtx, args: { threadId: string; userId: string; userPrompt: string }) => Promise<void>;
  }
)._handler;

function setup() {
  const ctx = {
    runQuery: vi.fn(async (_ref: unknown, args: Record<string, unknown>) =>
      'storageId' in args ? { userId: 'user-1', size: 20 } : { limitReached: false }
    ),
    runMutation: vi.fn(),
    scheduler: { runAfter: vi.fn() },
    storage: {
      getUrl: async () => 'https://example.com/attachment',
      get: async () => new Blob(['date,amount\n2026-10-03,-10']),
    },
  } as unknown as ActionCtx;
  return ctx;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.models.length = 0;
  mocks.streamText.mockResolvedValue(undefined);
  mocks.generateText.mockResolvedValue({ text: 'Monthly Budget' });
});

describe('chat models', () => {
  it.each([
    'What is envelope budgeting?',
    'Import transactions and reallocate my budget',
    'My groceries category looks off compared to last month',
    'Please file a feature request for biweekly budgets',
  ])('uses Gemini 3.8 Flash with tools for "%s" without classifying the prompt', async (prompt) => {
    await expect(send(setup(), { prompt })).resolves.toEqual({ threadId: 'thread-1' });

    expect(mocks.models).toEqual(['google/gemini-3.8-flash']);
    expect(mocks.streamText).toHaveBeenCalledWith(
      expect.anything(),
      { threadId: 'thread-1', userId: 'user-1' },
      expect.objectContaining({ prompt, tools: { kualia_create_transactions: {} } }),
      { saveStreamDeltas: true }
    );
    expect(mocks.streamText.mock.calls[0]?.[2]).not.toHaveProperty('providerOptions');
    expect(mocks.generateObject).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it.each([
    ['application/pdf', 'statement.pdf', 'file'],
    ['image/png', 'receipt.png', 'image'],
    ['text/csv', 'transactions.csv', 'text'],
  ])('processes %s attachments with Gemini 3.8 Flash', async (mediaType, filename, partType) => {
    await send(setup(), {
      prompt: 'Import this',
      attachments: [{ storageId: 'attachment-1' as Id<'_storage'>, mediaType, filename }],
    });

    expect(mocks.models).toEqual(['google/gemini-3.8-flash']);
    const input: unknown = mocks.streamText.mock.calls[0]?.[2];
    if (partType === 'text') {
      expect(input).toMatchObject({ prompt: expect.stringContaining('2026-10-03,-10') });
    } else {
      expect(input).toMatchObject({
        messages: [{ role: 'user', content: [{ type: 'text' }, { type: partType, mediaType }] }],
      });
    }
    expect(mocks.generateObject).not.toHaveBeenCalled();
  });

  it('generates and saves titles using Gemini 2.5 Flash', async () => {
    const ctx = setup();
    await title(ctx, { threadId: 'thread-1', userId: 'user-1', userPrompt: 'Help with my monthly budget' });

    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({ model: expect.objectContaining({ modelId: 'google/gemini-2.5-flash' }) })
    );
    expect(mocks.updateThreadMetadata).toHaveBeenCalledWith(ctx, {
      threadId: 'thread-1',
      patch: { title: 'Monthly Budget' },
    });
    expect(mocks.streamText).not.toHaveBeenCalled();
  });
});
