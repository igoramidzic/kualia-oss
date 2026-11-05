import { describe, expect, it } from 'vitest';
import type { ChatMessage, StreamingMessages } from '../../services/ai-chat.service';
import { buildTurns } from './build-turns';

function message(overrides: Record<string, unknown>): ChatMessage {
  return {
    _id: 'message-1',
    _creationTime: 1,
    order: 0,
    stepOrder: 0,
    text: '',
    kind: 'text',
    toolCalls: [],
    message: { role: 'user' },
    ...overrides,
  } as unknown as ChatMessage;
}

describe('buildTurns', () => {
  it('keeps the last turn in thinking state while a textless stream is active', () => {
    const turns = buildTurns({
      messages: [message({ text: 'Show my budget' })],
      streamingMessages: [
        {
          streamId: 'stream-1',
          order: 1,
          stepOrder: 0,
          status: 'streaming',
          text: '',
          toolCalls: [],
        },
      ] as unknown as StreamingMessages,
      pendingUserPrompt: null,
      pendingAttachments: [],
      isStreaming: true,
    });

    expect(turns).toHaveLength(1);
    expect(turns[0]?.assistant).toBeNull();
    expect(turns[0]?.isThinking).toBe(true);
  });

  it('surfaces the current tool label from a textless stream', () => {
    const turns = buildTurns({
      messages: [message({ text: 'Check groceries' })],
      streamingMessages: [
        {
          streamId: 'stream-1',
          order: 1,
          stepOrder: 0,
          status: 'streaming',
          text: '',
          toolCalls: [
            {
              toolCallId: 'tool-1',
              toolName: 'kualia_get_envelope_month_status',
              state: 'running',
            },
          ],
        },
      ] as unknown as StreamingMessages,
      pendingUserPrompt: null,
      pendingAttachments: [],
      isStreaming: true,
    });

    expect(turns[0]?.isThinking).toBe(true);
    expect(turns[0]?.currentTool?.runningLabel).toBe('Checking envelope status');
  });
});
