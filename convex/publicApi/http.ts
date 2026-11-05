import { ConvexError } from 'convex/values';

import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import type { ActivityAttribution } from '../activityLogs/types';
import type { ApiKeyAuthResult } from '../apiKeys/auth';
import { sha256Hex } from '../lib/crypto';
import { serializeBigInts } from '../lib/serialization';

import { isApiErrorData, type ApiErrorName } from './lib';
import { DEFAULT_TRANSACTIONS_PAGE_SIZE, MAX_TRANSACTIONS_PAGE_SIZE } from './reads';

/**
 * Public REST API (https://api.kualia.com/v1).
 *
 * Authentication: `Authorization: Bearer <api key>` where keys are created in
 * the web app under Settings → API Keys. Responses follow a YNAB-style
 * envelope: `{ "data": ... }` on success and
 * `{ "error": { "id", "name", "detail" } }` on failure. All monetary amounts
 * are decimal strings in the workspace currency.
 */

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  return {
    'access-control-allow-origin': origin ?? '*',
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'Content-Type, Authorization',
    'access-control-expose-headers': 'Retry-After, WWW-Authenticate',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

export function handleApiCorsPreflight(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

type InternalResult = { minorUnit: number; body: unknown };

function jsonResponse(request: Request, status: number, payload: unknown, extraHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders(request),
      ...extraHeaders,
    },
  });
}

function dataResponse(request: Request, result: InternalResult, status = 200): Response {
  return jsonResponse(request, status, { data: serializeBigInts(result.body, result.minorUnit) });
}

function errorResponse(
  request: Request,
  status: number,
  name: ApiErrorName,
  detail: string,
  extraHeaders?: Record<string, string>
): Response {
  return jsonResponse(request, status, { error: { id: String(status), name, detail } }, extraHeaders);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

type AuthContext = Extract<ApiKeyAuthResult, { ok: true }>;

type RouteContext = {
  ctx: ActionCtx;
  request: Request;
  auth: AuthContext;
  attribution: ActivityAttribution;
  params: Record<string, string>;
  searchParams: URLSearchParams;
  body: unknown;
};

type Route = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  segments: string[];
  handler: (route: RouteContext) => Promise<Response>;
};

function route(method: Route['method'], pattern: string, handler: Route['handler']): Route {
  return { method, segments: pattern.split('/'), handler };
}

function matchRoute(routes: Route[], method: string, pathSegments: string[]) {
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    if (candidate.segments.length !== pathSegments.length) continue;

    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < candidate.segments.length; i++) {
      const pattern = candidate.segments[i];
      const actual = pathSegments[i];
      if (pattern.startsWith(':')) {
        params[pattern.slice(1)] = decodeURIComponent(actual);
      } else if (pattern !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) return { route: candidate, params };
  }
  return null;
}

function parseLimit(searchParams: URLSearchParams): number {
  const raw = searchParams.get('limit');
  if (raw === null) return DEFAULT_TRANSACTIONS_PAGE_SIZE;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_TRANSACTIONS_PAGE_SIZE) {
    throw new RequestError(400, 'bad_request', `limit must be an integer between 1 and ${MAX_TRANSACTIONS_PAGE_SIZE}`);
  }
  return parsed;
}

/** Error thrown during HTTP-layer parsing, before reaching a Convex function. */
class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly name2: ApiErrorName,
    readonly detail: string
  ) {
    super(detail);
  }
}

const optional = (searchParams: URLSearchParams, key: string) => searchParams.get(key) ?? undefined;

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

const ROUTES: Route[] = [
  route('GET', 'user', async ({ ctx, request, auth }) => {
    const result = await ctx.runQuery(internal.publicApi.reads.getUser, { clerkId: auth.clerkId });
    return dataResponse(request, result);
  }),

  route('GET', 'workspaces', async ({ ctx, request, auth }) => {
    const result = await ctx.runQuery(internal.publicApi.reads.listWorkspaces, { clerkId: auth.clerkId });
    return dataResponse(request, result);
  }),

  route('GET', 'workspaces/:workspaceId', async ({ ctx, request, auth, params }) => {
    const result = await ctx.runQuery(internal.publicApi.reads.getWorkspace, {
      clerkId: auth.clerkId,
      workspaceId: params['workspaceId'],
    });
    return dataResponse(request, result);
  }),

  // --- Accounts ---

  route('GET', 'workspaces/:workspaceId/accounts', async ({ ctx, request, auth, params, searchParams }) => {
    const result = await ctx.runQuery(internal.publicApi.reads.listAccounts, {
      clerkId: auth.clerkId,
      workspaceId: params['workspaceId'],
      includeClosed: searchParams.get('include_closed') === 'true',
    });
    return dataResponse(request, result);
  }),

  route('POST', 'workspaces/:workspaceId/accounts', async ({ ctx, request, auth, attribution, params, body }) => {
    const result = await ctx.runMutation(internal.publicApi.writes.createAccount, {
      clerkId: auth.clerkId,
      workspaceId: params['workspaceId'],
      payload: body,
      attribution,
    });
    return dataResponse(request, result, 201);
  }),

  route('GET', 'workspaces/:workspaceId/accounts/:accountId', async ({ ctx, request, auth, params }) => {
    const result = await ctx.runQuery(internal.publicApi.reads.getAccount, {
      clerkId: auth.clerkId,
      workspaceId: params['workspaceId'],
      accountId: params['accountId'],
    });
    return dataResponse(request, result);
  }),

  route(
    'PATCH',
    'workspaces/:workspaceId/accounts/:accountId',
    async ({ ctx, request, auth, attribution, params, body }) => {
      const result = await ctx.runMutation(internal.publicApi.writes.updateAccount, {
        clerkId: auth.clerkId,
        workspaceId: params['workspaceId'],
        accountId: params['accountId'],
        payload: body,
        attribution,
      });
      return dataResponse(request, result);
    }
  ),

  route(
    'DELETE',
    'workspaces/:workspaceId/accounts/:accountId',
    async ({ ctx, request, auth, attribution, params }) => {
      const result = await ctx.runMutation(internal.publicApi.writes.deleteAccount, {
        clerkId: auth.clerkId,
        workspaceId: params['workspaceId'],
        accountId: params['accountId'],
        attribution,
      });
      return dataResponse(request, result);
    }
  ),

  // --- Transactions ---

  route('GET', 'workspaces/:workspaceId/transactions', async ({ ctx, request, auth, params, searchParams }) => {
    const result = await ctx.runQuery(internal.publicApi.reads.listTransactions, {
      clerkId: auth.clerkId,
      workspaceId: params['workspaceId'],
      sinceDate: optional(searchParams, 'since_date'),
      untilDate: optional(searchParams, 'until_date'),
      accountId: optional(searchParams, 'account_id'),
      categoryId: optional(searchParams, 'category_id'),
      status: optional(searchParams, 'status'),
      reviewStatus: optional(searchParams, 'review_status'),
      limit: parseLimit(searchParams),
      cursor: optional(searchParams, 'cursor'),
    });
    return dataResponse(request, result);
  }),

  route('POST', 'workspaces/:workspaceId/transactions', async ({ ctx, request, auth, attribution, params, body }) => {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new RequestError(400, 'bad_request', 'Request body must be a JSON object');
    }
    const record = body as Record<string, unknown>;
    const single = record['transaction'];
    const bulk = record['transactions'];
    if ((single === undefined) === (bulk === undefined)) {
      throw new RequestError(400, 'bad_request', "Provide either 'transaction' (object) or 'transactions' (array)");
    }
    if (bulk !== undefined && !Array.isArray(bulk)) {
      throw new RequestError(400, 'bad_request', "'transactions' must be an array");
    }
    const rows = bulk !== undefined ? bulk : [single];

    const result = await ctx.runAction(internal.publicApi.writes.createTransactionsWithCategorization, {
      clerkId: auth.clerkId,
      workspaceId: params['workspaceId'],
      rows,
      attribution,
    });

    if (single !== undefined) {
      const resultBody = result.body as { currency: string; transactions: unknown[] };
      return dataResponse(
        request,
        {
          minorUnit: result.minorUnit,
          body: { currency: resultBody.currency, transaction: resultBody.transactions[0] ?? null },
        },
        201
      );
    }
    return dataResponse(request, result, 201);
  }),

  route('GET', 'workspaces/:workspaceId/transactions/:transactionId', async ({ ctx, request, auth, params }) => {
    const result = await ctx.runQuery(internal.publicApi.reads.getTransaction, {
      clerkId: auth.clerkId,
      workspaceId: params['workspaceId'],
      transactionId: params['transactionId'],
    });
    return dataResponse(request, result);
  }),

  route(
    'PATCH',
    'workspaces/:workspaceId/transactions/:transactionId',
    async ({ ctx, request, auth, attribution, params, body }) => {
      const result = await ctx.runMutation(internal.publicApi.writes.updateTransaction, {
        clerkId: auth.clerkId,
        workspaceId: params['workspaceId'],
        transactionId: params['transactionId'],
        payload: body,
        attribution,
      });
      return dataResponse(request, result);
    }
  ),

  route(
    'DELETE',
    'workspaces/:workspaceId/transactions/:transactionId',
    async ({ ctx, request, auth, attribution, params }) => {
      const result = await ctx.runMutation(internal.publicApi.writes.deleteTransaction, {
        clerkId: auth.clerkId,
        workspaceId: params['workspaceId'],
        transactionId: params['transactionId'],
        attribution,
      });
      return dataResponse(request, result);
    }
  ),

  route(
    'POST',
    'workspaces/:workspaceId/transactions/:transactionId/restore',
    async ({ ctx, request, auth, attribution, params }) => {
      const result = await ctx.runMutation(internal.publicApi.writes.restoreTransaction, {
        clerkId: auth.clerkId,
        workspaceId: params['workspaceId'],
        transactionId: params['transactionId'],
        attribution,
      });
      return dataResponse(request, result);
    }
  ),

  // --- Merchants ---

  route('GET', 'workspaces/:workspaceId/merchants', async ({ ctx, request, auth, params }) => {
    const result = await ctx.runQuery(internal.publicApi.reads.listMerchants, {
      clerkId: auth.clerkId,
      workspaceId: params['workspaceId'],
    });
    return dataResponse(request, result);
  }),

  route('POST', 'workspaces/:workspaceId/merchants', async ({ ctx, request, auth, attribution, params, body }) => {
    const result = await ctx.runMutation(internal.publicApi.writes.createMerchant, {
      clerkId: auth.clerkId,
      workspaceId: params['workspaceId'],
      payload: body,
      attribution,
    });
    return dataResponse(request, result, 201);
  }),

  route('GET', 'workspaces/:workspaceId/merchants/:merchantId', async ({ ctx, request, auth, params }) => {
    const result = await ctx.runQuery(internal.publicApi.reads.getMerchant, {
      clerkId: auth.clerkId,
      workspaceId: params['workspaceId'],
      merchantId: params['merchantId'],
    });
    return dataResponse(request, result);
  }),

  route(
    'PATCH',
    'workspaces/:workspaceId/merchants/:merchantId',
    async ({ ctx, request, auth, attribution, params, body }) => {
      const result = await ctx.runMutation(internal.publicApi.writes.updateMerchant, {
        clerkId: auth.clerkId,
        workspaceId: params['workspaceId'],
        merchantId: params['merchantId'],
        payload: body,
        attribution,
      });
      return dataResponse(request, result);
    }
  ),

  route(
    'DELETE',
    'workspaces/:workspaceId/merchants/:merchantId',
    async ({ ctx, request, auth, attribution, params, searchParams }) => {
      const result = await ctx.runMutation(internal.publicApi.writes.deleteMerchant, {
        clerkId: auth.clerkId,
        workspaceId: params['workspaceId'],
        merchantId: params['merchantId'],
        moveToMerchantId: optional(searchParams, 'move_to_merchant_id'),
        attribution,
      });
      return dataResponse(request, result);
    }
  ),

  // --- Categories ---

  route('GET', 'workspaces/:workspaceId/categories', async ({ ctx, request, auth, params }) => {
    const result = await ctx.runQuery(internal.publicApi.reads.listCategories, {
      clerkId: auth.clerkId,
      workspaceId: params['workspaceId'],
    });
    return dataResponse(request, result);
  }),

  route('POST', 'workspaces/:workspaceId/categories', async ({ ctx, request, auth, attribution, params, body }) => {
    const result = await ctx.runMutation(internal.publicApi.writes.createCategory, {
      clerkId: auth.clerkId,
      workspaceId: params['workspaceId'],
      payload: body,
      attribution,
    });
    return dataResponse(request, result, 201);
  }),

  route('GET', 'workspaces/:workspaceId/categories/:categoryId', async ({ ctx, request, auth, params }) => {
    const result = await ctx.runQuery(internal.publicApi.reads.getCategory, {
      clerkId: auth.clerkId,
      workspaceId: params['workspaceId'],
      categoryId: params['categoryId'],
    });
    return dataResponse(request, result);
  }),

  route(
    'PATCH',
    'workspaces/:workspaceId/categories/:categoryId',
    async ({ ctx, request, auth, attribution, params, body }) => {
      const result = await ctx.runMutation(internal.publicApi.writes.updateCategory, {
        clerkId: auth.clerkId,
        workspaceId: params['workspaceId'],
        categoryId: params['categoryId'],
        payload: body,
        attribution,
      });
      return dataResponse(request, result);
    }
  ),

  route(
    'DELETE',
    'workspaces/:workspaceId/categories/:categoryId',
    async ({ ctx, request, auth, attribution, params, searchParams }) => {
      const result = await ctx.runMutation(internal.publicApi.writes.deleteCategory, {
        clerkId: auth.clerkId,
        workspaceId: params['workspaceId'],
        categoryId: params['categoryId'],
        moveToCategoryId: optional(searchParams, 'move_to_category_id'),
        attribution,
      });
      return dataResponse(request, result);
    }
  ),

  // --- Category groups ---

  route('GET', 'workspaces/:workspaceId/category_groups', async ({ ctx, request, auth, params }) => {
    const result = await ctx.runQuery(internal.publicApi.reads.listCategoryGroups, {
      clerkId: auth.clerkId,
      workspaceId: params['workspaceId'],
    });
    return dataResponse(request, result);
  }),

  route('POST', 'workspaces/:workspaceId/category_groups', async ({ ctx, request, auth, params, body }) => {
    const result = await ctx.runMutation(internal.publicApi.writes.createCategoryGroup, {
      clerkId: auth.clerkId,
      workspaceId: params['workspaceId'],
      payload: body,
    });
    return dataResponse(request, result, 201);
  }),

  route('PATCH', 'workspaces/:workspaceId/category_groups/:groupId', async ({ ctx, request, auth, params, body }) => {
    const result = await ctx.runMutation(internal.publicApi.writes.updateCategoryGroup, {
      clerkId: auth.clerkId,
      workspaceId: params['workspaceId'],
      groupId: params['groupId'],
      payload: body,
    });
    return dataResponse(request, result);
  }),

  // --- Budget months ---

  route('GET', 'workspaces/:workspaceId/months/:month', async ({ ctx, request, auth, params }) => {
    const result = await ctx.runQuery(internal.publicApi.reads.getMonth, {
      clerkId: auth.clerkId,
      workspaceId: params['workspaceId'],
      month: params['month'],
    });
    return dataResponse(request, result);
  }),

  route(
    'PATCH',
    'workspaces/:workspaceId/months/:month/categories/:categoryId',
    async ({ ctx, request, auth, attribution, params, body }) => {
      const result = await ctx.runMutation(internal.publicApi.writes.setMonthCategoryAssigned, {
        clerkId: auth.clerkId,
        workspaceId: params['workspaceId'],
        month: params['month'],
        categoryId: params['categoryId'],
        payload: body,
        attribution,
      });
      return dataResponse(request, result);
    }
  ),
];

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function handleApiRequest(ctx: ActionCtx, request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (!url.pathname.startsWith('/v1/')) {
      return errorResponse(request, 404, 'not_found', 'Unknown endpoint');
    }
    const pathSegments = url.pathname
      .slice('/v1/'.length)
      .split('/')
      .filter((segment) => segment.length > 0);

    const match = matchRoute(ROUTES, method, pathSegments);
    if (!match) {
      return errorResponse(request, 404, 'not_found', `No ${method} endpoint at /v1/${pathSegments.join('/')}`);
    }

    // --- Authenticate ---
    const authorization = request.headers.get('authorization');
    if (!authorization || !authorization.toLowerCase().startsWith('bearer ')) {
      return errorResponse(
        request,
        401,
        'unauthorized',
        'Missing API key. Send it as: Authorization: Bearer <key>. Create keys in the Kualia app under Settings → API Keys.',
        { 'www-authenticate': 'Bearer realm="Kualia API"' }
      );
    }

    const rawKey = authorization.slice('bearer '.length).trim();
    const tokenHash = await sha256Hex(rawKey);
    const auth = await ctx.runMutation(internal.apiKeys.auth.authenticateApiKeyRequest, { tokenHash });

    if (!auth.ok) {
      if (auth.reason === 'rate_limited') {
        return errorResponse(
          request,
          429,
          'rate_limit_exceeded',
          'Rate limit exceeded. The limit is 200 requests per hour per API key.',
          { 'retry-after': String(auth.retryAfterSeconds) }
        );
      }
      return errorResponse(request, 401, 'unauthorized', 'Invalid or revoked API key', {
        'www-authenticate': 'Bearer realm="Kualia API"',
      });
    }

    // --- Authorize scope ---
    const requiredScope = method === 'GET' ? 'read' : 'write';
    if (!auth.scopes.includes(requiredScope)) {
      return errorResponse(request, 403, 'forbidden', 'This API key is read-only and cannot perform writes');
    }

    const attribution: ActivityAttribution = {
      clerkId: auth.clerkId,
      source: {
        type: 'public_api',
        apiKeyId: auth.apiKeyId,
        apiKeyLabel: auth.apiKeyLabel,
        apiKeyPrefix: auth.apiKeyPrefix,
      },
    };

    // --- Parse body ---
    let body: unknown;
    if (method === 'POST' || method === 'PATCH') {
      const rawBody = await request.text();
      if (rawBody.length > 0) {
        try {
          body = JSON.parse(rawBody);
        } catch {
          return errorResponse(request, 400, 'bad_request', 'Request body must be valid JSON');
        }
      }
    }

    return await match.route.handler({
      ctx,
      request,
      auth,
      attribution,
      params: match.params,
      searchParams: url.searchParams,
      body,
    });
  } catch (error: unknown) {
    if (error instanceof RequestError) {
      return errorResponse(request, error.status, error.name2, error.detail);
    }
    if (error instanceof ConvexError) {
      if (isApiErrorData(error.data)) {
        return errorResponse(request, error.data.status, error.data.name, error.data.detail);
      }
      if (typeof error.data === 'string') {
        return errorResponse(request, 400, 'bad_request', error.data);
      }
    }
    console.error('Public API request failed:', error);
    return errorResponse(request, 500, 'internal_error', 'An unexpected error occurred');
  }
}
