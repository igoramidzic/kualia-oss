const USERJOT_BASE_URL = 'https://api.userjot.com/v1';
const FEEDBACK_BASE_URL = 'https://feedback.kualia.com';

export type UserjotError =
  | { code: 'not_configured'; message: string }
  | { code: 'unauthorized'; message: string }
  | { code: 'not_found'; message: string }
  | { code: 'forbidden'; message: string }
  | { code: 'validation_error'; message: string; details?: unknown }
  | { code: 'rate_limited'; message: string; retryAfterSeconds?: number }
  | { code: 'network_error'; message: string }
  | { code: 'unknown_error'; message: string; status?: number };

export type UserjotResult<T> = { ok: true; data: T } | { ok: false; error: UserjotError };

interface UserjotRequestInit {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
  idempotencyKey?: string;
}

function readToken(): string | undefined {
  return process.env['USERJOT_API_TOKEN'];
}

function buildUrl(path: string, query?: UserjotRequestInit['query']): string {
  const url = new URL(`${USERJOT_BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, item);
      } else {
        url.searchParams.append(key, value);
      }
    }
  }
  return url.toString();
}

async function parseErrorBody(response: Response): Promise<{ message: string; details?: unknown }> {
  try {
    const body = (await response.json()) as { error?: { message?: string; details?: unknown } };
    return {
      message: body.error?.message ?? response.statusText,
      details: body.error?.details,
    };
  } catch {
    return { message: response.statusText };
  }
}

async function mapError(response: Response): Promise<UserjotError> {
  const { message, details } = await parseErrorBody(response);
  switch (response.status) {
    case 401:
      return { code: 'unauthorized', message };
    case 403:
      return { code: 'forbidden', message };
    case 404:
      return { code: 'not_found', message };
    case 422:
      return { code: 'validation_error', message, details };
    case 429: {
      const header = response.headers.get('Retry-After');
      const retryAfterSeconds = header ? Number.parseInt(header, 10) : undefined;
      return {
        code: 'rate_limited',
        message,
        retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
      };
    }
    default:
      return { code: 'unknown_error', message, status: response.status };
  }
}

async function rawRequest<T>(init: UserjotRequestInit): Promise<UserjotResult<T>> {
  const token = readToken();
  if (!token) {
    console.warn('[aiChat.userjot] http call skipped — USERJOT_API_TOKEN not configured', {
      method: init.method,
      path: init.path,
    });
    return {
      ok: false,
      error: { code: 'not_configured', message: 'USERJOT_API_TOKEN is not configured' },
    };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(buildUrl(init.path, init.query), {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error: unknown) {
    const durationMs = Date.now() - startedAt;
    console.error('[aiChat.userjot] http network error', {
      method: init.method,
      path: init.path,
      durationMs,
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      error: {
        code: 'network_error',
        message: error instanceof Error ? error.message : 'Unknown network error',
      },
    };
  }

  const durationMs = Date.now() - startedAt;
  console.log('[aiChat.userjot] http response', {
    method: init.method,
    path: init.path,
    status: response.status,
    durationMs,
    requestId: response.headers.get('X-Request-Id') ?? undefined,
  });

  if (response.status === 204) {
    return { ok: true, data: undefined as T };
  }

  if (!response.ok) {
    return { ok: false, error: await mapError(response) };
  }

  try {
    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch (error: unknown) {
    console.error('[aiChat.userjot] http response parse failed', {
      method: init.method,
      path: init.path,
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      error: {
        code: 'unknown_error',
        message: error instanceof Error ? error.message : 'Failed to parse response',
      },
    };
  }
}

/**
 * Perform a UserJot API call with a single retry on 429 honoring `Retry-After`
 * (capped at 5 s so we don't tie up the chat turn). Everything else surfaces
 * as a structured error.
 */
export async function userjotRequest<T>(init: UserjotRequestInit): Promise<UserjotResult<T>> {
  const first = await rawRequest<T>(init);
  if (first.ok || first.error.code !== 'rate_limited') return first;

  const wait = Math.min((first.error.retryAfterSeconds ?? 1) * 1000, 5000);
  await new Promise((resolve) => setTimeout(resolve, wait));
  return rawRequest<T>(init);
}

// --- Resource types (subset we actually consume) ---

export interface UserjotBoard {
  id: string;
  name: string;
  slug: string;
  color?: string;
  type: 'public' | 'private';
  order?: number;
}

export type UserjotRequestStatus = 'pending' | 'review' | 'planned' | 'in_progress' | 'completed' | 'closed';

export interface UserjotMember {
  id: string;
  external_id?: string;
  type: 'user' | 'guest' | 'anonymous';
  email?: string;
  first_name?: string;
  last_name?: string;
}

export interface UserjotRequest {
  id: string;
  title: string;
  body: string;
  status: UserjotRequestStatus;
  board: UserjotBoard;
  author: UserjotMember;
  vote_count: number;
  comment_count: number;
  created_at: string;
  updated_at: string;
}

interface ListBoardsResponse {
  boards: UserjotBoard[];
}

interface ListRequestsResponse {
  requests: UserjotRequest[];
  next_cursor?: string;
}

interface RequestResponse {
  request: UserjotRequest;
}

interface MemberResponse {
  member: UserjotMember;
}

// --- Module-scoped board cache ---
// One Convex container reuses the same board list across chat turns; the list
// rarely changes and bumping a stale entry is fine on next container restart.
const BOARD_CACHE_TTL_MS = 5 * 60_000;
let boardsCache: { fetchedAt: number; boards: UserjotBoard[] } | null = null;

export async function listBoards(): Promise<UserjotResult<UserjotBoard[]>> {
  if (boardsCache && Date.now() - boardsCache.fetchedAt < BOARD_CACHE_TTL_MS) {
    return { ok: true, data: boardsCache.boards };
  }
  const result = await userjotRequest<ListBoardsResponse>({ method: 'GET', path: '/boards' });
  if (!result.ok) return result;
  boardsCache = { fetchedAt: Date.now(), boards: result.data.boards };
  return { ok: true, data: result.data.boards };
}

export interface ListAllRequestsParams {
  boardIds?: string[];
  statuses?: UserjotRequestStatus[];
  /** Hard cap on total results; pagination stops here. */
  maxResults?: number;
}

export interface ListAllRequestsResult {
  requests: UserjotRequest[];
  /** True when the maxResults cap was hit and there were more pages available. */
  truncated: boolean;
}

const LIST_ALL_PAGE_SIZE = 100;
const LIST_ALL_DEFAULT_MAX = 300;
const LIST_ALL_HARD_MAX = 500;
const LIST_ALL_CACHE_TTL_MS = 60_000;

/**
 * Module-scoped cache of full-corpus list fetches. We re-fetch when the
 * filter (boards × statuses) differs or the TTL elapses. A 60 s window is
 * tight enough that an in-flight feature request created earlier in the same
 * turn shows up on the next list call, but loose enough that consecutive
 * searches in one chat turn (and across nearby turns) reuse the same data.
 */
const listAllCache = new Map<string, { fetchedAt: number; data: ListAllRequestsResult }>();

function listAllCacheKey(params: ListAllRequestsParams): string {
  return JSON.stringify({
    boardIds: [...(params.boardIds ?? [])].sort(),
    statuses: [...(params.statuses ?? [])].sort(),
    maxResults: params.maxResults ?? LIST_ALL_DEFAULT_MAX,
  });
}

/**
 * Fetch the full request corpus (paginated, capped) for in-memory semantic
 * scanning by the LLM. UserJot's `/requests` keyword search misses requests
 * that don't share tokens with the query (e.g. "desktop app" doesn't match a
 * post titled "Add an electron app"); the workaround is to fetch everything
 * and let the model do the matching. With ~150-200 posts at ~30-50 tokens
 * per row (title-only), the payload is well under the chat tool-result cap.
 *
 * Pagination uses UserJot's opaque cursor with the maximum 100-per-page,
 * stopping when no `next_cursor` is returned or we'd exceed `maxResults`.
 * Sort is `top` (most-voted first) so when the cap *does* truncate, the
 * model still sees the most popular ones.
 */
export async function listAllRequests(
  params: ListAllRequestsParams = {}
): Promise<UserjotResult<ListAllRequestsResult>> {
  const maxResults = Math.min(params.maxResults ?? LIST_ALL_DEFAULT_MAX, LIST_ALL_HARD_MAX);
  const cacheKey = listAllCacheKey({ ...params, maxResults });
  const cached = listAllCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < LIST_ALL_CACHE_TTL_MS) {
    return { ok: true, data: cached.data };
  }

  const requests: UserjotRequest[] = [];
  let cursor: string | undefined;
  let truncated = false;

  while (requests.length < maxResults) {
    const pageLimit = Math.min(LIST_ALL_PAGE_SIZE, maxResults - requests.length);
    const result: UserjotResult<ListRequestsResponse> = await userjotRequest<ListRequestsResponse>({
      method: 'GET',
      path: '/requests',
      query: {
        sort: 'top',
        board_ids: params.boardIds,
        statuses: params.statuses,
        limit: String(pageLimit),
        cursor,
      },
    });
    if (!result.ok) return result;

    requests.push(...result.data.requests);
    if (!result.data.next_cursor || result.data.requests.length === 0) {
      break;
    }
    if (requests.length >= maxResults) {
      truncated = true;
      break;
    }
    cursor = result.data.next_cursor;
  }

  const data: ListAllRequestsResult = { requests, truncated };
  listAllCache.set(cacheKey, { fetchedAt: Date.now(), data });
  return { ok: true, data };
}

export async function getRequest(id: string): Promise<UserjotResult<UserjotRequest>> {
  const result = await userjotRequest<RequestResponse>({ method: 'GET', path: `/requests/${id}` });
  if (!result.ok) return result;
  return { ok: true, data: result.data.request };
}

export interface CreateRequestInput {
  authorExternalId: string;
  boardId: string;
  title: string;
  body: string;
}

export interface SyncMemberInput {
  externalId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

export async function syncMember(input: SyncMemberInput): Promise<UserjotResult<UserjotMember>> {
  const result = await userjotRequest<MemberResponse>({
    method: 'POST',
    path: '/members/sync',
    body: {
      external_id: input.externalId,
      email: input.email,
      first_name: input.firstName,
      last_name: input.lastName,
    },
  });
  if (!result.ok) return result;
  return { ok: true, data: result.data.member };
}

/**
 * Create a request. If the author hasn't been synced yet UserJot returns 404
 * (referenced member not found); in that case sync the member and retry once.
 * The caller is expected to supply best-known email/name for the sync.
 */
export async function createRequest(
  input: CreateRequestInput,
  syncFallback: SyncMemberInput
): Promise<UserjotResult<UserjotRequest>> {
  const body = {
    author: { external_id: input.authorExternalId },
    board_id: input.boardId,
    title: input.title,
    body: input.body,
  };

  const first = await userjotRequest<RequestResponse>({
    method: 'POST',
    path: '/requests',
    body,
  });
  if (first.ok) return { ok: true, data: first.data.request };
  if (first.error.code !== 'not_found') return first;

  const sync = await syncMember(syncFallback);
  if (!sync.ok) return sync;

  const second = await userjotRequest<RequestResponse>({
    method: 'POST',
    path: '/requests',
    body,
  });
  if (!second.ok) return second;
  return { ok: true, data: second.data.request };
}

export interface UpdateRequestInput {
  id: string;
  title?: string;
  body?: string;
}

export async function updateRequest(input: UpdateRequestInput): Promise<UserjotResult<UserjotRequest>> {
  const payload: Record<string, string> = {};
  if (input.title !== undefined) payload['title'] = input.title;
  if (input.body !== undefined) payload['body'] = input.body;
  const result = await userjotRequest<RequestResponse>({
    method: 'PATCH',
    path: `/requests/${input.id}`,
    body: payload,
  });
  if (!result.ok) return result;
  return { ok: true, data: result.data.request };
}

export async function deleteRequest(id: string): Promise<UserjotResult<void>> {
  return userjotRequest<void>({ method: 'DELETE', path: `/requests/${id}` });
}

/**
 * Add a vote on `requestId` from the caller identified by `voterExternalId`
 * (Clerk subject). On a 404 — UserJot's "voter not found" — sync the member
 * once and retry, same pattern as `createRequest`. UserJot's `POST .../votes`
 * is idempotent: voting twice returns 200 without changing the count, so we
 * don't need to read the current vote state before calling.
 */
export async function voteForRequest(
  requestId: string,
  voterExternalId: string,
  syncFallback: SyncMemberInput
): Promise<UserjotResult<{ ok: true }>> {
  const body = { voter: { external_id: voterExternalId } };
  const first = await userjotRequest<{ ok: true }>({
    method: 'POST',
    path: `/requests/${requestId}/votes`,
    body,
  });
  if (first.ok) return first;
  if (first.error.code !== 'not_found') return first;

  const sync = await syncMember(syncFallback);
  if (!sync.ok) return sync;

  return userjotRequest<{ ok: true }>({
    method: 'POST',
    path: `/requests/${requestId}/votes`,
    body,
  });
}

/**
 * Remove the caller's vote from `requestId`. Returns 204 even when the user
 * hadn't voted (idempotent), so callers don't need to check first.
 */
export async function removeVoteForRequest(requestId: string, voterExternalId: string): Promise<UserjotResult<void>> {
  return userjotRequest<void>({
    method: 'DELETE',
    path: `/requests/${requestId}/votes`,
    query: { voter_external_id: voterExternalId },
  });
}

/**
 * UserJot caps post slugs at 60 characters and trims back to the last word
 * boundary (last hyphen). Reverse-engineered from `feedback.kualia.com/sitemap.xml`:
 *
 *   "Automatically create recurring transactions from past spending patterns" (71)
 *     → `automatically-create-recurring-transactions-from-past` (53)
 *   "Would be great if there was a remember me option so I don't…" (109)
 *     → `would-be-great-if-there-was-a-remember-me-option-so-i-don-t` (59)
 *   "Being able to add transaction from inside specific account view" (63)
 *     → `being-able-to-add-transaction-from-inside-specific-account` (58)
 *
 * In every truncated case the slug equals `slugify(title).slice(0, 60)` rolled
 * back to the last hyphen.
 */
const MAX_SLUG_LENGTH = 60;

/**
 * Slugify a request title to match UserJot's public URL convention. Verified
 * against `https://feedback.kualia.com/sitemap.xml` — titles like
 * "View transactions by category" → `view-transactions-by-category`,
 * "Double Reporting?" → `double-reporting`. Long titles are truncated to 60
 * chars at the last word boundary (see `MAX_SLUG_LENGTH`). UserJot may append
 * `-2`, `-3` to disambiguate duplicates; we don't know about those locally,
 * so for titles that collide with an older post the returned URL will land on
 * the older one (acceptable trade-off vs. omitting links entirely).
 */
export function slugifyTitle(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base.length <= MAX_SLUG_LENGTH) return base;
  const truncated = base.slice(0, MAX_SLUG_LENGTH);
  const lastDash = truncated.lastIndexOf('-');
  return lastDash > 0 ? truncated.slice(0, lastDash) : truncated;
}

/**
 * Public URL for a request on feedback.kualia.com. Verified pattern is
 * `/board/p/<title-slug>` (literal `/board/`, not the board's slug — the
 * board's slug only appears on board-listing pages at `/board/{slug}`).
 */
export function postUrl(title: string): string {
  return `${FEEDBACK_BASE_URL}/board/p/${slugifyTitle(title)}`;
}

/**
 * Public URL for a board's listing page on feedback.kualia.com.
 * Verified pattern: `/board/<board_slug>`.
 */
export function boardUrl(boardSlug: string): string {
  return `${FEEDBACK_BASE_URL}/board/${boardSlug}`;
}
