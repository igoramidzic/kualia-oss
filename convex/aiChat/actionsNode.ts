'use node';

import { Agent, listStreams, type UsageHandler } from '@convex-dev/agent';
import { withTracing } from '@posthog/ai/vercel';
import { generateText, stepCountIs, type ToolSet } from 'ai';
import { ConvexError, v } from 'convex/values';

import { components, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalAction, type ActionCtx } from '../_generated/server';
import { requireAuthAction } from '../lib/auth';
import { getPostHogClient } from '../lib/posthog';
import { chatAgent, chatModel, chatModelId, titleModel } from './agent';
import { buildKualiaTools } from './kualiaTools';
import { getDocsTools } from './mcp';
import { buildSystemPrompt, SYSTEM_PROMPT } from './prompts';
import { parseKualiaContextTag, stripKualiaContextTag, type WorkspaceContext } from './workspaceContextTag';

// Derive the model type from the concrete OpenRouter model so we don't have
// to name `@ai-sdk/provider`'s `LanguageModelV3` directly (it's a transitive
// dep, not a direct one). `withTracing` preserves its input type, so wrapped
// models stay assignable to `Agent`'s `languageModel` config.
type ChatModel = typeof chatModel;

/**
 * Cap on tool-calling steps per turn. Each step's tool result accumulates in
 * the model's context, so keep this tight to bound runaway cost.
 */
const STEP_CAP = 5;

/**
 * Heartbeat watchdog. Aborts the model call if either:
 *   - The model never produces a first chunk within `FIRST_CHUNK_MS`, or
 *   - The model goes silent for `IDLE_MS` after producing any chunk.
 *
 * The agent component has its own 10-min `lastHeartbeat`-based timeout, but
 * that only arms once `streams.create` runs — which is called from
 * `DeltaStreamer.addParts` inside the chunk loop. If the model never produces
 * a first chunk (e.g. processing a PDF with 30+ tools causes a long initial
 * pause), no `streamingMessages` row ever lands and the heartbeat timeout is
 * never scheduled, so without this watchdog the action runs the full Convex
 * 600 s before being killed.
 *
 * Per-tool-call worst case is ~20-40 s in practice; an idle window beyond
 * 60 s with `STEP_CAP = 5` outstanding steps is almost certainly a hang.
 */
const FIRST_CHUNK_TIMEOUT_MS = 2 * 60_000;
const IDLE_TIMEOUT_MS = 2 * 60_000;

/**
 * Wrap an OpenRouter language model with PostHog's Vercel-AI-SDK middleware so every
 * call emits a `$ai_generation` event into PostHog LLM Analytics. Returns the raw model
 * untouched when PostHog isn't configured or we have no user to attribute the spend to.
 *
 * `posthogTraceId = threadId` groups every step of a single conversation (
 * title gen, each tool-calling round of the main reply) into one trace in the Traces view.
 */
function traceModel(
  model: ChatModel,
  opts: { userId: string; threadId?: string; properties?: Record<string, unknown> }
): ChatModel {
  const ph = getPostHogClient();
  if (!ph) return model;
  return withTracing(model, ph, {
    posthogDistinctId: opts.userId,
    posthogTraceId: opts.threadId,
    posthogProperties: { feature: 'ai_chat', ...(opts.properties ?? {}) },
    posthogProviderOverride: 'openrouter',
  });
}

/**
 * Build a chat `Agent` whose language model is wrapped with PostHog tracing. Used in
 * place of the module-level `chatAgent` for the LLM-invoking path so
 * `$ai_generation` events fire with the right distinct id and trace id.
 *
 * Constructing the `Agent` per-request is fine — it's a thin config object over the
 * shared `components.agent`, so threads/messages remain interchangeable with the
 * non-traced agents that mutations.ts/queries.ts use for metadata operations.
 */
function buildTracedAgent(
  ctx: ActionCtx,
  rawModel: ChatModel,
  opts: { userId: string; threadId: string; agentName: string; workspaceId?: string }
) {
  const tracedModel = traceModel(rawModel, {
    userId: opts.userId,
    threadId: opts.threadId,
    properties: { agent_name: opts.agentName, workspace_id: opts.workspaceId },
  });
  // Keep `incrementMonthlyUsage` wired so the per-user billing cap still tracks every
  // step. We drop the legacy `recordChatUsage` schedule that the module-level agents
  // carry — `$ai_generation` from `withTracing` is the strict replacement for that.
  const usageHandler: UsageHandler = (_handlerCtx, args) => {
    if (!args.userId) return;
    const usage = args.usage;
    void ctx.scheduler.runAfter(0, internal.aiChat.usage.incrementMonthlyUsage, {
      userId: args.userId,
      model: args.model,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cachedInputTokens: usage.cachedInputTokens ?? 0,
    });
  };
  return new Agent(components.agent, {
    name: opts.agentName,
    languageModel: tracedModel,
    instructions: SYSTEM_PROMPT,
    usageHandler,
  });
}

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const ATTACHMENT_CLEANUP_DELAY_MS = 24 * 60 * 60 * 1000;
/** Cap on bytes UTF-8-decoded into the prompt for non-image, non-PDF attachments. */
const MAX_INLINED_TEXT_BYTES = 256 * 1024;

const TITLE_PROMPT = `You generate short titles for chat threads in a personal-finance app called Kualia.

You will receive the user's first message. Reply with a 2-4 word title in Title Case that names the topic. No quotes, no trailing punctuation, no emoji, no leading "Re:" or "About". Always produce a real title — never refuse, never reply "New Chat", never apologize. If the user message is a vague greeting ("hi", "hey", "thanks"), pick a plausible Kualia-relevant placeholder like "Quick Hello" or "Quick Thanks".

Examples:
- "What is the app about?" → "Kualia App Overview"
- "How do I create a category?" → "Creating Categories"
- "Why is my Available negative?" → "Negative Available Balance"
- "thanks" → "Quick Thanks"`;

const USER_PROMPT_CHAR_LIMIT = 1500;

/** Cap on history pages walked when locating the first user message of a thread. */
const HISTORY_FETCH_LIMIT = 200;

/**
 * Strip the `<kualia-context>` and `<kualia-attachments>` metadata tags off the user's first
 * message before feeding it to the title model — those tags carry workspace + filename metadata,
 * not user-typed content, and pollute the title.
 */
function cleanPromptForTitle(prompt: string): string {
  const withoutContext = stripKualiaContextTag(prompt);
  const withoutAttachments = withoutContext.replace(/^<kualia-attachments>[\s\S]*?<\/kualia-attachments>\s*\n*/u, '');
  const trimmed = withoutAttachments.trim();
  return trimmed.length > USER_PROMPT_CHAR_LIMIT ? `${trimmed.slice(0, USER_PROMPT_CHAR_LIMIT)}…` : trimmed;
}

function sanitizeTitle(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ').slice(0, 4).join(' ');
  return words.length > 0 ? words : 'New Chat';
}

/** Pull the user-typed text out of an agent message doc — handles both string and parts shapes. */
function readUserMessageText(message: { content: unknown } | null | undefined): string | null {
  if (!message) return null;
  const content = (message as { content: unknown }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    let out = '';
    for (const part of content) {
      if (typeof part === 'object' && part !== null) {
        const text = (part as Record<string, unknown>)['text'];
        if (typeof text === 'string') out += text;
      }
    }
    return out;
  }
  return null;
}

/**
 * Find the oldest user message in a thread and parse its `<kualia-context>` tag,
 * returning the workspace pinned at thread creation. Used on follow-up turns where
 * the new `prompt` doesn't carry the tag — the first message is the source of truth.
 */
async function readWorkspaceContextFromHistory(
  ctx: Parameters<typeof chatAgent.listMessages>[0],
  threadId: string
): Promise<WorkspaceContext | null> {
  const result = await chatAgent.listMessages(ctx, {
    threadId,
    paginationOpts: { numItems: HISTORY_FETCH_LIMIT, cursor: null },
    excludeToolMessages: true,
  });
  const sorted = [...result.page].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.stepOrder - b.stepOrder;
  });
  for (const m of sorted) {
    const role = (m.message as { role?: string } | undefined)?.role;
    if (role !== 'user') continue;
    const text = readUserMessageText(m.message as { content: unknown } | null | undefined);
    if (!text) continue;
    return parseKualiaContextTag(text);
  }
  return null;
}

/**
 * Implementation of `sendMessage` that performs LLM streaming. Lives in a `'use node'`
 * module because `@posthog/ai`'s tracing middleware requires `posthog-node`, which the
 * Convex V8 isolate can't bundle. The public `sendMessage` in `actions.ts` is a thin
 * wrapper that delegates here via `ctx.runAction` — keeping the V8 barrel re-export
 * (`convex/aiChat.ts → sendMessage`) free of any Node-only transitive dependencies.
 */
export const sendMessageImpl = internalAction({
  args: {
    threadId: v.optional(v.string()),
    prompt: v.string(),
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.id('_storage'),
          mediaType: v.string(),
          filename: v.string(),
        })
      )
    ),
  },
  handler: async (ctx, { threadId: providedThreadId, prompt, attachments }): Promise<{ threadId: string }> => {
    const identity = await requireAuthAction(ctx);

    // Hard fail-safe: refuse new turns once this user has crossed the monthly
    // spend cap. The client UI should already have hidden the input, but a
    // direct dashboard / API call would otherwise bypass the gate.
    const [usage, globalUsage] = await Promise.all([
      ctx.runQuery(internal.aiChat.usage.getMonthlyUsageInternal, { userId: identity.subject }),
      ctx.runQuery(internal.aiChat.usage.getGlobalMonthlyUsageInternal, {}),
    ]);
    if (usage.limitReached) {
      throw new ConvexError('Monthly AI chat usage limit reached. Resets on the 1st.');
    }
    // Global circuit breaker — every user is blocked until the next month if
    // aggregate spend crosses the cap. Not surfaced cleanly in the UI; the
    // generic "Message failed" toast is fine for a case we don't expect to hit.
    if (globalUsage.limitReached) {
      throw new ConvexError('AI chat is temporarily unavailable due to high usage. Please try again next month.');
    }

    let threadId: string;
    let hasTitle: boolean;
    if (providedThreadId) {
      const metadataBefore = await chatAgent.getThreadMetadata(ctx, { threadId: providedThreadId });
      if (metadataBefore.userId !== identity.subject) {
        throw new ConvexError('Chat thread not found');
      }
      threadId = providedThreadId;
      hasTitle = typeof metadataBefore.title === 'string' && metadataBefore.title.length > 0;
    } else {
      const created = await chatAgent.createThread(ctx, { userId: identity.subject });
      threadId = created.threadId;
      hasTitle = false;
    }

    // Kick off title generation in parallel with the agent stream — the title model only needs
    // the user prompt, so there's no reason to block on the assistant reply finishing. Fired via
    // the scheduler so the Convex runtime owns the lifecycle (a fire-and-forget Promise here would
    // be killed when this action returns).
    if (!hasTitle) {
      await ctx.scheduler.runAfter(0, internal.aiChat.actionsNode.generateThreadTitle, {
        threadId,
        userId: identity.subject,
        userPrompt: prompt,
      });
    }

    let workspaceContext = parseKualiaContextTag(prompt);
    if (!workspaceContext && providedThreadId) {
      workspaceContext = await readWorkspaceContextFromHistory(ctx, threadId);
    }

    // Pull the workspace's timezone fresh on every turn (rather than baking it
    // into the `<kualia-context>` tag) so prompts always reflect the user's
    // current setting — keeps "today" aligned with their wall clock if they
    // change zones mid-thread.
    let workspaceTimezone: string | undefined;
    if (workspaceContext) {
      const workspaceDoc = await ctx.runQuery(internal.workspaces.getByWorkspaceId, {
        workspaceId: workspaceContext.workspaceId as Id<'workspace'>,
      });
      workspaceTimezone = workspaceDoc?.timezone;
    }

    const docsTools = await getDocsTools();
    const kualiaTools = buildKualiaTools(
      ctx,
      identity.subject,
      workspaceContext?.workspaceId as Id<'workspace'> | undefined
    );
    const tools: ToolSet = { ...(docsTools ?? {}), ...kualiaTools };
    const hasTools = Object.keys(tools).length > 0;

    const agent = buildTracedAgent(ctx, chatModel, {
      userId: identity.subject,
      threadId,
      agentName: 'Kualia Assistant',
      workspaceId: workspaceContext?.workspaceId,
    });
    const system = buildSystemPrompt(new Date(), workspaceContext, workspaceTimezone);

    // Wire an abortSignal to streamText so a stop request can interrupt the model
    // mid-flight — even between text deltas (e.g. while a tool call is running),
    // when the agent component's own addDelta-based abort path is dormant. We poll
    // the agent component's stream table for an "aborted" status and trip the
    // controller as soon as we see one.
    const abortController = new AbortController();
    let pollingActive = true;
    // Snapshot streams already in 'aborted' status for this thread. Without this
    // baseline, any historical abort (user-stopped a prior turn, watchdog trip,
    // abortStuckStreams cron) leaves a row that the poll below would re-match on
    // every subsequent send — tripping the controller within ~400 ms and killing
    // the new turn before its first delta. Only NEW aborted streamIds should count.
    const preExistingAbortedStreamIds = new Set<string>();
    try {
      const existing = await listStreams(ctx, components.agent, {
        threadId,
        includeStatuses: ['aborted'],
      });
      for (const s of existing) preExistingAbortedStreamIds.add(s.streamId);
    } catch (error) {
      console.warn('[aiChat.sendMessage] failed to snapshot pre-existing aborted streams', {
        threadId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const pollForAbort = async (): Promise<void> => {
      while (pollingActive) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (!pollingActive) return;
        try {
          const aborted = await listStreams(ctx, components.agent, {
            threadId,
            includeStatuses: ['aborted'],
          });
          const fresh = aborted.find((s) => !preExistingAbortedStreamIds.has(s.streamId));
          if (fresh) {
            console.log('[aiChat.sendMessage] abort signal tripped from poll', {
              threadId,
              streamId: fresh.streamId,
            });
            abortController.abort('user-stopped');
            return;
          }
        } catch (error) {
          // Best-effort — keep polling on transient query failures.
          console.warn('[aiChat.sendMessage] pollForAbort listStreams failed', {
            threadId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };
    const pollPromise = pollForAbort();

    // Image and PDF attachments are passed to the AI SDK as URL refs (Convex storage URLs the
    // model fetches at request time). We deliberately avoid base64-encoding them inline — the
    // agent component persists the user message verbatim, and base64 of even a few MB of images
    // overflows Convex's 1 MiB document size limit. URLs persist as ~100 bytes each.
    //
    // Non-image, non-PDF files (text/csv, text/plain, …) are still UTF-8-decoded and wrapped in
    // a `<kualia-attachment-body>` tag inside the prompt — the chat panel strips that tag before
    // rendering so the user only sees the chip and their own typed prompt while the model gets
    // the full file contents. Capped at MAX_INLINED_TEXT_BYTES per file so a 10 MB CSV can't
    // amplify into millions of tokens.
    type AttachmentPart =
      | { type: 'file'; data: URL; mediaType: string; filename: string }
      | { type: 'image'; image: URL; mediaType: string };
    let attachmentParts: AttachmentPart[] = [];
    let inlinedTextBodies = '';
    if (attachments && attachments.length > 0) {
      let totalBytes = 0;
      const loadedParts: AttachmentPart[] = [];
      const inlinedBlocks: string[] = [];
      for (const attachment of attachments) {
        // Verify the caller owns this storageId. Without this check, any authenticated user
        // who learns another user's storageId could feed it to the agent and have its
        // contents inlined into the model's context (and reflected back in the reply).
        const meta = await ctx.runQuery(internal.storage.chatAttachmentUpload.getChatAttachmentByStorageId, {
          storageId: attachment.storageId,
        });
        if (!meta || meta.userId !== identity.subject) {
          throw new ConvexError(`Attachment not found: ${attachment.filename}`);
        }
        totalBytes += meta.size;
        if (totalBytes > MAX_ATTACHMENT_BYTES) {
          throw new ConvexError('Attachments exceed the 15 MB combined size limit.');
        }
        if (attachment.mediaType.startsWith('image/') || attachment.mediaType === 'application/pdf') {
          const url = await ctx.storage.getUrl(attachment.storageId);
          if (!url) {
            throw new ConvexError(`Attachment not found: ${attachment.filename}`);
          }
          if (attachment.mediaType.startsWith('image/')) {
            loadedParts.push({ type: 'image', image: new URL(url), mediaType: attachment.mediaType });
          } else {
            loadedParts.push({
              type: 'file',
              data: new URL(url),
              mediaType: attachment.mediaType,
              filename: attachment.filename,
            });
          }
        } else {
          if (meta.size > MAX_INLINED_TEXT_BYTES) {
            throw new ConvexError(`${attachment.filename} exceeds the 256 KB inlined-text size limit.`);
          }
          const blob = await ctx.storage.get(attachment.storageId);
          if (!blob) {
            throw new ConvexError(`Attachment not found: ${attachment.filename}`);
          }
          const buffer = await blob.arrayBuffer();
          const decoded = new TextDecoder('utf-8').decode(buffer);
          // Encode filename + mediaType as element attributes so the agent knows the source and
          // the frontend's regex can strip the wrapper without trying to parse JSON metadata.
          const escapedFilename = attachment.filename.replace(/"/g, '&quot;').replace(/</g, '&lt;');
          const escapedMediaType = attachment.mediaType.replace(/"/g, '&quot;').replace(/</g, '&lt;');
          inlinedBlocks.push(
            `<kualia-attachment-body filename="${escapedFilename}" mediaType="${escapedMediaType}">\n${decoded}\n</kualia-attachment-body>`
          );
        }
      }
      attachmentParts = loadedParts;
      inlinedTextBodies = inlinedBlocks.length > 0 ? `\n\n${inlinedBlocks.join('\n\n')}` : '';
    }
    // Append the body blocks AFTER the user-typed text so the `<kualia-context>` and
    // `<kualia-attachments>` metadata tags stay anchored to position 0 of the persisted message
    // (the frontend's stripKualiaContextTag is anchored with ^). The model reads the whole
    // message either way.
    const promptWithAttachmentBodies = `${prompt}${inlinedTextBodies}`;

    const streamStartedAt = Date.now();
    console.log('[aiChat.sendMessage] streamText starting', {
      threadId,
      modelId: chatModelId,
      userId: identity.subject,
      hasAttachments: attachmentParts.length > 0,
      attachmentSummary: attachments?.map((a) => ({ mediaType: a.mediaType, filename: a.filename })) ?? [],
      inlinedTextBytes: inlinedTextBodies.length,
      toolCount: Object.keys(tools).length,
      promptChars: promptWithAttachmentBodies.length,
    });

    // Heartbeat watchdog: armed with FIRST_CHUNK_TIMEOUT_MS initially, then
    // reset to IDLE_TIMEOUT_MS each time the model emits a chunk (see `onChunk`
    // passed into streamText below). Idle window beyond 60 s with STEP_CAP=5
    // outstanding steps is almost certainly a hang.
    let lastChunkAt = streamStartedAt;
    let chunkCount = 0;
    const fireWatchdog = (reason: 'first-chunk-timeout' | 'idle-timeout'): void => {
      if (abortController.signal.aborted) return;
      console.warn('[aiChat.sendMessage] watchdog tripped', {
        threadId,
        reason,
        elapsedMs: Date.now() - streamStartedAt,
        msSinceLastChunk: Date.now() - lastChunkAt,
        chunkCount,
      });
      abortController.abort(reason);
    };
    let watchdog = setTimeout(() => fireWatchdog('first-chunk-timeout'), FIRST_CHUNK_TIMEOUT_MS);
    const resetWatchdog = (): void => {
      clearTimeout(watchdog);
      lastChunkAt = Date.now();
      chunkCount += 1;
      watchdog = setTimeout(() => fireWatchdog('idle-timeout'), IDLE_TIMEOUT_MS);
    };

    try {
      const promptOrMessages =
        attachmentParts.length > 0
          ? {
              messages: [
                {
                  role: 'user' as const,
                  content: [
                    ...(promptWithAttachmentBodies.length > 0
                      ? [{ type: 'text' as const, text: promptWithAttachmentBodies }]
                      : []),
                    ...attachmentParts,
                  ],
                },
              ],
            }
          : { prompt: promptWithAttachmentBodies };
      await agent.streamText(
        ctx,
        { threadId, userId: identity.subject },
        {
          ...promptOrMessages,
          system,
          abortSignal: abortController.signal,
          // Reset the watchdog on every chunk the model emits — text deltas,
          // reasoning, tool-call boundaries, tool results. The AI SDK forwards
          // this option through `@convex-dev/agent`'s `streamText` wrapper.
          onChunk: resetWatchdog,
          ...(hasTools ? { tools, stopWhen: stepCountIs(STEP_CAP) } : {}),
        },
        { saveStreamDeltas: true }
      );
      console.log('[aiChat.sendMessage] streamText finished', {
        threadId,
        durationMs: Date.now() - streamStartedAt,
      });
    } catch (error: unknown) {
      console.error('[aiChat.sendMessage] streamText threw', {
        threadId,
        durationMs: Date.now() - streamStartedAt,
        aborted: abortController.signal.aborted,
        abortReason: abortController.signal.reason,
        error:
          error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
      });
      if (!abortController.signal.aborted) {
        throw error;
      }
    } finally {
      clearTimeout(watchdog);
      pollingActive = false;
      await pollPromise.catch(() => undefined);
      console.log('[aiChat.sendMessage] poll loop stopped', {
        threadId,
        totalDurationMs: Date.now() - streamStartedAt,
      });
      if (attachments && attachments.length > 0) {
        for (const attachment of attachments) {
          await ctx.scheduler.runAfter(
            ATTACHMENT_CLEANUP_DELAY_MS,
            internal.storage.chatAttachmentUpload.deleteChatAttachment,
            { storageId: attachment.storageId }
          );
        }
      }
    }

    // Mark this thread "unread" for the user — the bottom-bar tab paints a primary-colored dot
    // when `lastAssistantAt > lastReadAt`. Stamped after streamText resolves (success or abort)
    // since even a partial assistant turn is something the user should see. The web client clears
    // the dot via `markThreadRead` when the user opens the thread.
    await ctx.runMutation(internal.aiChat.mutations._markThreadAssistantPosted, {
      userId: identity.subject,
      threadId,
    });

    return { threadId };
  },
});

/**
 * Generate and persist a thread title from the user's first message. Scheduled by `sendMessageImpl`
 * the moment we determine a thread has no title yet, so it runs in parallel with the agent
 * stream rather than after — by the time the user sees the assistant reply, the bottom-bar /
 * history sidebar has usually already updated. Errors are logged and swallowed so a flaky title
 * call never affects the user-facing chat.
 */
export const generateThreadTitle = internalAction({
  args: {
    threadId: v.string(),
    userId: v.string(),
    userPrompt: v.string(),
  },
  handler: async (ctx, { threadId, userId, userPrompt }): Promise<void> => {
    const cleaned = cleanPromptForTitle(userPrompt);
    if (cleaned.length === 0) return;
    try {
      // Titles are short and don't need tool use. Keep them on Gemini 2.5
      // Flash independently of the model selected for the main reply.
      const tracedTitleModel = traceModel(titleModel, {
        userId,
        threadId,
        properties: { agent_name: 'title' },
      });
      const result = await generateText({
        model: tracedTitleModel,
        system: TITLE_PROMPT,
        prompt: cleaned,
      });
      const title = sanitizeTitle(result.text);
      await chatAgent.updateThreadMetadata(ctx, { threadId, patch: { title } });
    } catch (error: unknown) {
      console.error('Failed to generate chat title', error);
    }
  },
});
