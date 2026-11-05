import type { ChatMessage, StreamingMessages } from '../../services/ai-chat.service';
import { parseKualiaAttachmentsTag, stripKualiaAttachmentBodyTags, stripKualiaAttachmentsTag } from './attachments-tag';
import { doneLabel, runningLabel } from './tool-labels';
import { stripKualiaContextTag } from './workspace-context-tag';

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  isStreaming?: boolean;
}

export interface ToolCallView {
  toolCallId: string;
  toolName: string;
  state: 'running' | 'success' | 'error';
  /** Friendly past-tense label shown inside the collapsible. */
  doneLabel: string;
  /** Friendly present-progressive label shown on the live status line. */
  runningLabel: string;
}

export interface AttachmentChip {
  filename: string;
  mediaType: string;
}

export interface Turn {
  id: string;
  user: DisplayMessage;
  /** Files the user attached to this turn — surfaced as chips above the user bubble. */
  attachments: AttachmentChip[];
  assistant: DisplayMessage | null;
  isThinking: boolean;
  /** Chronological list of tool calls executed for this turn. */
  toolCalls: ToolCallView[];
  /** The currently-running tool, if any — drives the live status line in place of "Thinking…". */
  currentTool: ToolCallView | null;
  /** Total elapsed seconds spent in tool calls; null while the turn is still in flight or no tools ran. */
  durationSeconds: number | null;
  /** True if any tool call ended in an error state — used to color the collapsible label. */
  hadToolError: boolean;
}

export interface BuildTurnsInput {
  messages: readonly ChatMessage[];
  streamingMessages: StreamingMessages;
  /** Optimistic user-prompt text shown immediately on send, before the persisted message arrives. */
  pendingUserPrompt: string | null;
  /** Files attached to the in-flight optimistic user message. */
  pendingAttachments: readonly AttachmentChip[];
  /** True while a response is generating; promotes the last turn into a thinking/tool state. */
  isStreaming: boolean;
}

interface TurnBuilder extends Turn {
  toolCallsById: Map<string, { entry: ToolCallView; startedAt: number | null; finishedAt: number | null }>;
}

function newBuilder(id: string, user: DisplayMessage, attachments: AttachmentChip[] = []): TurnBuilder {
  return {
    id,
    user,
    attachments,
    assistant: null,
    isThinking: false,
    toolCalls: [],
    currentTool: null,
    durationSeconds: null,
    hadToolError: false,
    toolCallsById: new Map(),
  };
}

/**
 * Group raw chat messages into conversational turns.
 *
 * Each user message starts a new turn, and any assistant text that follows (or the in-flight
 * stream) attaches to that turn. Tool-call/tool-result rows (`kind: 'tool'`) are folded into the
 * surrounding turn's `toolCalls` so they render as a collapsible "Worked for N seconds" header
 * instead of their own bubble. Streaming entries take priority over any matching persisted entry
 * by `toolCallId` so the live stream reflects the freshest state — including pre-persistence
 * "running" calls that haven't materialized as a tool-result row yet.
 */
export function buildTurns(input: BuildTurnsInput): Turn[] {
  const builders: TurnBuilder[] = [];
  let current: TurnBuilder | null = null;

  for (const m of input.messages) {
    if (m.kind === 'tool') {
      if (!current) continue;
      for (const call of m.toolCalls ?? []) {
        current.toolCallsById.set(call.toolCallId, {
          entry: {
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            state: call.state,
            doneLabel: doneLabel(call.toolName, call.itemCount),
            runningLabel: runningLabel(call.toolName, call.itemCount),
          },
          startedAt: call.startedAt ?? null,
          finishedAt: call.finishedAt ?? null,
        });
      }
      continue;
    }

    const role = m.message?.role;
    if (role !== 'user' && role !== 'assistant') continue;
    const rawText = m.text ?? '';
    // Strip the `<kualia-context>` and `<kualia-attachments>` tags the service prepends to user
    // messages — metadata for the agent and the chips, not user-typed content for the bubble.
    const attachments = role === 'user' ? (parseKualiaAttachmentsTag(rawText) ?? []) : [];
    const text =
      role === 'user'
        ? stripKualiaAttachmentBodyTags(stripKualiaAttachmentsTag(stripKualiaContextTag(rawText))).trim()
        : rawText;
    if (!text && !m.error && attachments.length === 0) continue;

    if (role === 'user') {
      current = newBuilder(m._id, { id: m._id, role: 'user', text: m.error ? `Error: ${m.error}` : text }, attachments);
      builders.push(current);
    } else if (current) {
      current.assistant = { id: m._id, role: 'assistant', text: m.error ? `Error: ${m.error}` : text };
    } else {
      // Assistant message with no preceding user message (rare — leading welcome). Render it
      // as a turnless assistant block by giving it a synthetic empty user slot.
      const synthetic = newBuilder(m._id, { id: `${m._id}-u`, role: 'user', text: '' });
      synthetic.assistant = { id: m._id, role: 'assistant', text: m.error ? `Error: ${m.error}` : text };
      builders.push(synthetic);
    }
  }

  // Splice in the live-streaming assistant text + tool calls on the last turn.
  const lastBuilder: TurnBuilder | undefined = builders[builders.length - 1];
  for (const stream of input.streamingMessages) {
    if (lastBuilder) {
      for (const call of stream.toolCalls ?? []) {
        lastBuilder.toolCallsById.set(call.toolCallId, {
          entry: {
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            state: call.state,
            doneLabel: doneLabel(call.toolName, call.itemCount),
            runningLabel: runningLabel(call.toolName, call.itemCount),
          },
          startedAt: lastBuilder.toolCallsById.get(call.toolCallId)?.startedAt ?? null,
          finishedAt: lastBuilder.toolCallsById.get(call.toolCallId)?.finishedAt ?? null,
        });
      }
    }
    if (!stream.text) continue;
    if (lastBuilder && lastBuilder.assistant?.text !== stream.text) {
      lastBuilder.assistant = {
        id: `stream-${stream.streamId}`,
        role: 'assistant',
        text: stream.text,
        isStreaming: true,
      };
    }
  }

  // Optimistic user message: shown immediately on send, before the persisted message arrives.
  if (input.pendingUserPrompt) {
    const last = builders[builders.length - 1];
    const alreadyShown = last?.user.text.trim() === input.pendingUserPrompt && !last.assistant;
    if (!alreadyShown) {
      builders.push(
        newBuilder('optimistic', { id: 'optimistic', role: 'user', text: input.pendingUserPrompt }, [
          ...input.pendingAttachments,
        ])
      );
      builders[builders.length - 1].isThinking = true;
    }
  }

  // Mark the last turn as "thinking" if a response is in flight and no assistant text is present.
  const lastTurn = builders[builders.length - 1];
  if (lastTurn && input.isStreaming && !lastTurn.assistant) {
    lastTurn.isThinking = true;
  }

  return builders.map((b) => finalizeTurn(b));
}

function finalizeTurn(b: TurnBuilder): Turn {
  const entries = Array.from(b.toolCallsById.values());
  const toolCalls = entries.map((e) => e.entry);
  const hadToolError = toolCalls.some((c) => c.state === 'error');

  // currentTool: the latest still-running call. Surfaced regardless of whether the assistant
  // bubble is already showing — the model often streams a chatty preamble (e.g. "Let me grab
  // that…") before invoking a tool, which sets `assistant` non-null and would otherwise hide
  // the live status indicator entirely. `running.length > 0` is the only meaningful gate.
  const running = entries.filter((e) => e.entry.state === 'running');
  const currentTool = running.length > 0 ? running[running.length - 1].entry : null;

  // durationSeconds: derived from earliest start to latest finish across this turn's tools.
  // Only show once the assistant text is final (not streaming) and at least one tool ran.
  let durationSeconds: number | null = null;
  const turnSettled = b.assistant !== null && !b.assistant.isStreaming && toolCalls.length > 0;
  if (turnSettled) {
    const starts = entries.map((e) => e.startedAt).filter((v): v is number => v !== null);
    const ends = entries.map((e) => e.finishedAt).filter((v): v is number => v !== null);
    if (starts.length > 0 && ends.length > 0) {
      const elapsedMs = Math.max(...ends) - Math.min(...starts);
      durationSeconds = Math.max(1, Math.round(elapsedMs / 1000));
    }
  }

  return {
    id: b.id,
    user: b.user,
    attachments: b.attachments,
    assistant: b.assistant,
    isThinking: b.isThinking,
    toolCalls,
    currentTool,
    durationSeconds,
    hadToolError,
  };
}
