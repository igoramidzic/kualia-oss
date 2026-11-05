import { jsonSchema, tool, type ToolSet } from 'ai';

import {
  createRequest,
  deleteRequest,
  getRequest,
  listAllRequests,
  listBoards,
  postUrl,
  removeVoteForRequest,
  updateRequest,
  voteForRequest,
  type UserjotError,
  type UserjotRequest,
  type UserjotRequestStatus,
} from './userjotClient';

const TOOL_LIST_BOARDS = 'kualia_feedback_list_boards';
const TOOL_LIST_REQUESTS = 'kualia_feedback_list_requests';
const TOOL_CREATE = 'kualia_feedback_create';
const TOOL_UPDATE = 'kualia_feedback_update';
const TOOL_DELETE = 'kualia_feedback_delete';
const TOOL_VOTE = 'kualia_feedback_vote';
const TOOL_UNVOTE = 'kualia_feedback_unvote';

interface AuthContext {
  clerkId: string;
  email: string | undefined;
  threadId: string;
}

function errorPayload(error: UserjotError): { error: UserjotError } {
  return { error };
}

function logToolCall(toolName: string, auth: AuthContext, input: unknown): number {
  const startedAt = Date.now();
  console.log('[aiChat.userjot] tool call', {
    tool: toolName,
    threadId: auth.threadId,
    clerkId: auth.clerkId,
    input,
  });
  return startedAt;
}

function logToolResult(
  toolName: string,
  auth: AuthContext,
  startedAt: number,
  outcome: { ok: true; summary: Record<string, unknown> } | { ok: false; error: UserjotError }
): void {
  const durationMs = Date.now() - startedAt;
  if (outcome.ok) {
    console.log('[aiChat.userjot] tool result', {
      tool: toolName,
      threadId: auth.threadId,
      durationMs,
      ok: true,
      ...outcome.summary,
    });
  } else {
    console.warn('[aiChat.userjot] tool result', {
      tool: toolName,
      threadId: auth.threadId,
      durationMs,
      ok: false,
      errorCode: outcome.error.code,
      errorMessage: outcome.error.message,
    });
  }
}

/**
 * Strip URL primitives from request summaries so the model can't fabricate post URLs.
 * UserJot's API doesn't expose a public per-post URL or a request slug, and giving
 * the model `board.id`/`board.slug` alongside a `boardUrl` field was prompting it
 * to invent links like `https://feedback.kualia.com/board/<board_id>`. The model
 * only needs the board *name* to reference the post to the user; URL construction
 * happens (if at all) in the prompt where it can be controlled.
 */
function summarizeRequest(req: UserjotRequest): Record<string, unknown> {
  return {
    id: req.id,
    title: req.title,
    body: req.body,
    status: req.status,
    boardName: req.board.name,
    url: postUrl(req.title),
    voteCount: req.vote_count,
    commentCount: req.comment_count,
    createdAt: req.created_at,
    updatedAt: req.updated_at,
    authorExternalId: req.author.external_id,
  };
}

/**
 * Compact shape for the full-corpus list scan. Title-only (no body, no URL)
 * keeps the payload small enough to dump ~200 rows into a single tool result
 * (~30 tokens per row → ~6 k tokens). The model uses these to semantically
 * scan for similar posts; if it picks one to act on, it can grab the body or
 * URL via `kualia_feedback_get` (or just reference the post by title).
 */
function summarizeRequestForList(req: UserjotRequest): Record<string, unknown> {
  return {
    id: req.id,
    title: req.title,
    status: req.status,
    boardName: req.board.name,
    // `url` is the only correct way to link to this post. Without it in the
    // payload, prior models invented links like `/<board_name>/<title-slug>`
    // (missing `/p/`, using board name instead of slug). The token cost vs.
    // not having it is small — ~50 chars per row, ~2-3 k tokens per call.
    url: postUrl(req.title),
    voteCount: req.vote_count,
    createdAt: req.created_at,
  };
}

/**
 * Build AI SDK tool definitions for managing UserJot feature requests on behalf of
 * the authenticated chat user. These tools are intentionally NOT registered with
 * the public MCP server in `convex/mcp/tools.ts` — they live only in the in-app
 * chat tool set so external MCP clients can't file posts or scrape feedback
 * through our API token.
 *
 * Tools:
 * - `kualia_feedback_list_boards`: list available boards so the model can route by intent.
 * - `kualia_feedback_search`: find existing requests by free-text query, sorted by votes.
 * - `kualia_feedback_create`: file a new request attributed to the current user
 *   (Clerk subject as `external_id`); auto-syncs the member on 404.
 * - `kualia_feedback_update`: edit title/body of an existing request, gated on author match.
 * - `kualia_feedback_delete`: delete a request, gated on author match.
 */
export function buildUserjotTools(auth: AuthContext): ToolSet {
  return {
    [TOOL_LIST_BOARDS]: tool({
      description:
        'List feedback boards on UserJot. Call this once before creating or searching to know which board IDs exist and pick the right one by intent (e.g. "Ideas" for feature requests, "Bugs" for bug reports). Returns board id, name, slug, and type.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {},
        additionalProperties: false,
      }),
      execute: async () => {
        const startedAt = logToolCall(TOOL_LIST_BOARDS, auth, {});
        const result = await listBoards();
        if (!result.ok) {
          logToolResult(TOOL_LIST_BOARDS, auth, startedAt, { ok: false, error: result.error });
          return errorPayload(result.error);
        }
        logToolResult(TOOL_LIST_BOARDS, auth, startedAt, {
          ok: true,
          summary: { boardCount: result.data.length },
        });
        return {
          boards: result.data.map((b) => ({
            id: b.id,
            name: b.name,
            slug: b.slug,
            type: b.type,
          })),
        };
      },
    }),

    [TOOL_LIST_REQUESTS]: tool({
      description:
        'List existing UserJot feedback requests (sorted by vote count) so you can semantically scan for a similar post before creating a new one. Returns up to ~300 rows. Each row is `{id, title, status, boardName, url, voteCount, createdAt}` — no body. Scan the titles for anything topically similar to the user\'s request, even if the wording differs (e.g. user says "desktop app for Mac" → an existing post titled "Add an electron app for windows/mac/linux" is a match). If you find a match, tell the user about it (use status to say whether it\'s on the roadmap, in progress, or already shipped) and link to it using the row\'s `url` field verbatim — DO NOT construct a URL yourself from id, title, board name, or anything else. STOP — do not create a duplicate. If nothing matches, proceed to `kualia_feedback_create`. Use `boardIds` to scope to one board, `statuses` to filter (default: all). When `truncated: true` is returned, the cap was hit and older/less-voted posts are not shown — narrow with `statuses` or `boardIds` if you suspect the match might be there.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          boardIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional. Restrict results to these board IDs.',
          },
          statuses: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['pending', 'review', 'planned', 'in_progress', 'completed', 'closed'],
            },
            description: 'Optional. Restrict results to these statuses.',
          },
        },
        additionalProperties: false,
      }),
      execute: async (input) => {
        const args = input as {
          boardIds?: string[];
          statuses?: UserjotRequestStatus[];
        };
        const startedAt = logToolCall(TOOL_LIST_REQUESTS, auth, args);
        const result = await listAllRequests({
          boardIds: args.boardIds,
          statuses: args.statuses,
        });
        if (!result.ok) {
          logToolResult(TOOL_LIST_REQUESTS, auth, startedAt, { ok: false, error: result.error });
          return errorPayload(result.error);
        }
        logToolResult(TOOL_LIST_REQUESTS, auth, startedAt, {
          ok: true,
          summary: { totalCount: result.data.requests.length, truncated: result.data.truncated },
        });
        return {
          requests: result.data.requests.map(summarizeRequestForList),
          truncated: result.data.truncated,
        };
      },
    }),

    [TOOL_CREATE]: tool({
      description:
        'File a new feedback request on UserJot, attributed to the current user. Use ONLY after `kualia_feedback_search` returns no close match. Pick the right board with `kualia_feedback_list_boards` first. Write a concise, specific title (max 255 chars) and a clear body describing the feature gap or bug (max 20000 chars). Do NOT include the user’s account balances, transaction amounts, account names, or other private data — feedback posts are publicly visible. Returns the created request including a `url` to the post on feedback.kualia.com — use that `url` verbatim when linking; do not construct your own.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          boardId: {
            type: 'string',
            description: 'Target board id from kualia_feedback_list_boards.',
            minLength: 1,
          },
          title: {
            type: 'string',
            description: 'Short title summarizing the request. 1-255 characters.',
            minLength: 1,
            maxLength: 255,
          },
          body: {
            type: 'string',
            description: 'Detailed description of the request. 1-20000 characters.',
            minLength: 1,
            maxLength: 20000,
          },
        },
        required: ['boardId', 'title', 'body'],
        additionalProperties: false,
      }),
      execute: async (input) => {
        const args = input as { boardId: string; title: string; body: string };
        const startedAt = logToolCall(TOOL_CREATE, auth, {
          boardId: args.boardId,
          title: args.title,
          bodyLength: args.body.length,
        });
        const result = await createRequest(
          {
            authorExternalId: auth.clerkId,
            boardId: args.boardId,
            title: args.title,
            body: args.body,
          },
          {
            externalId: auth.clerkId,
            email: auth.email,
          }
        );
        if (!result.ok) {
          logToolResult(TOOL_CREATE, auth, startedAt, { ok: false, error: result.error });
          return errorPayload(result.error);
        }
        logToolResult(TOOL_CREATE, auth, startedAt, {
          ok: true,
          summary: { requestId: result.data.id, boardSlug: result.data.board.slug },
        });
        return { request: summarizeRequest(result.data) };
      },
    }),

    [TOOL_UPDATE]: tool({
      description:
        'Update the title and/or body of a UserJot request that the current user created. Use this only when the user explicitly asks to revise a post they just filed. Returns an `unauthorized` error if the request was filed by someone else.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'UserJot request id (e.g. "req_xxx") returned by create or search.',
            minLength: 1,
          },
          title: {
            type: 'string',
            minLength: 1,
            maxLength: 255,
            description: 'New title. Omit to keep the existing one.',
          },
          body: {
            type: 'string',
            minLength: 1,
            maxLength: 20000,
            description: 'New body. Omit to keep the existing one.',
          },
        },
        required: ['id'],
        additionalProperties: false,
        minProperties: 2,
      }),
      execute: async (input) => {
        const args = input as { id: string; title?: string; body?: string };
        const startedAt = logToolCall(TOOL_UPDATE, auth, {
          id: args.id,
          titleChanged: args.title !== undefined,
          bodyChanged: args.body !== undefined,
        });
        if (args.title === undefined && args.body === undefined) {
          const error: UserjotError = {
            code: 'validation_error',
            message: 'Provide a new title and/or body to update.',
          };
          logToolResult(TOOL_UPDATE, auth, startedAt, { ok: false, error });
          return errorPayload(error);
        }
        const existing = await getRequest(args.id);
        if (!existing.ok) {
          logToolResult(TOOL_UPDATE, auth, startedAt, { ok: false, error: existing.error });
          return errorPayload(existing.error);
        }
        if (existing.data.author.external_id !== auth.clerkId) {
          const error: UserjotError = {
            code: 'forbidden',
            message: 'This request was filed by another user and can only be edited by its author.',
          };
          logToolResult(TOOL_UPDATE, auth, startedAt, { ok: false, error });
          return errorPayload(error);
        }
        const result = await updateRequest({ id: args.id, title: args.title, body: args.body });
        if (!result.ok) {
          logToolResult(TOOL_UPDATE, auth, startedAt, { ok: false, error: result.error });
          return errorPayload(result.error);
        }
        logToolResult(TOOL_UPDATE, auth, startedAt, {
          ok: true,
          summary: { requestId: result.data.id },
        });
        return { request: summarizeRequest(result.data) };
      },
    }),

    [TOOL_DELETE]: tool({
      description:
        'Delete a UserJot request that the current user created. Use this only when the user explicitly asks to retract a post they just filed. Returns an `unauthorized` error if the request was filed by someone else.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'UserJot request id to delete.',
            minLength: 1,
          },
        },
        required: ['id'],
        additionalProperties: false,
      }),
      execute: async (input) => {
        const args = input as { id: string };
        const startedAt = logToolCall(TOOL_DELETE, auth, args);
        const existing = await getRequest(args.id);
        if (!existing.ok) {
          logToolResult(TOOL_DELETE, auth, startedAt, { ok: false, error: existing.error });
          return errorPayload(existing.error);
        }
        if (existing.data.author.external_id !== auth.clerkId) {
          const error: UserjotError = {
            code: 'forbidden',
            message: 'This request was filed by another user and can only be deleted by its author.',
          };
          logToolResult(TOOL_DELETE, auth, startedAt, { ok: false, error });
          return errorPayload(error);
        }
        const result = await deleteRequest(args.id);
        if (!result.ok) {
          logToolResult(TOOL_DELETE, auth, startedAt, { ok: false, error: result.error });
          return errorPayload(result.error);
        }
        logToolResult(TOOL_DELETE, auth, startedAt, {
          ok: true,
          summary: { requestId: args.id },
        });
        return { deleted: true, id: args.id };
      },
    }),

    [TOOL_VOTE]: tool({
      description:
        "Cast the current user's upvote on a UserJot request. Use this in two situations: (1) immediately after `kualia_feedback_create` succeeds — the user just filed it, they obviously want it, so register their vote without asking; (2) when `kualia_feedback_list_requests` surfaces an existing post that matches what the user wants, ONLY AFTER they explicitly agree to vote on it. Voting is idempotent — calling twice doesn't double the count. Returns `{ ok: true }` on success.",
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'UserJot request id to upvote (e.g. "req_xxx").',
            minLength: 1,
          },
        },
        required: ['id'],
        additionalProperties: false,
      }),
      execute: async (input) => {
        const args = input as { id: string };
        const startedAt = logToolCall(TOOL_VOTE, auth, args);
        const result = await voteForRequest(args.id, auth.clerkId, {
          externalId: auth.clerkId,
          email: auth.email,
        });
        if (!result.ok) {
          logToolResult(TOOL_VOTE, auth, startedAt, { ok: false, error: result.error });
          return errorPayload(result.error);
        }
        logToolResult(TOOL_VOTE, auth, startedAt, {
          ok: true,
          summary: { requestId: args.id, voted: true },
        });
        return { ok: true, id: args.id, voted: true };
      },
    }),

    [TOOL_UNVOTE]: tool({
      description:
        "Remove the current user's upvote from a UserJot request. Use this only when the user explicitly asks to retract their vote on a post. Idempotent — succeeds whether or not a vote was previously cast.",
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'UserJot request id to remove the vote from.',
            minLength: 1,
          },
        },
        required: ['id'],
        additionalProperties: false,
      }),
      execute: async (input) => {
        const args = input as { id: string };
        const startedAt = logToolCall(TOOL_UNVOTE, auth, args);
        const result = await removeVoteForRequest(args.id, auth.clerkId);
        if (!result.ok) {
          logToolResult(TOOL_UNVOTE, auth, startedAt, { ok: false, error: result.error });
          return errorPayload(result.error);
        }
        logToolResult(TOOL_UNVOTE, auth, startedAt, {
          ok: true,
          summary: { requestId: args.id, voted: false },
        });
        return { ok: true, id: args.id, voted: false };
      },
    }),
  };
}
