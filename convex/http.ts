import { httpRouter } from 'convex/server';
import { auth } from './auth';

import { httpAction } from './_generated/server';
import { syncTransactionsWebhook } from './bankProviders/plaid/plaidTransactionSync';
import { handleWorkspaceExportDownload } from './dataExports';
import { handleCorsPreflight, withCors } from './mcp/cors';
import { handleMcpDelete, handleMcpGet, handleMcpPost } from './mcp/http';
import {
  handleOAuthAuthorizationServerMetadataGet,
  handleOAuthAuthorizeGet,
  handleOAuthProtectedResourceMetadataGet,
  handleOAuthRegisterPost,
  handleOAuthRevokePost,
  handleOAuthTokenPost,
} from './mcp/oauthHttp';
import { handleApiCorsPreflight, handleApiRequest } from './publicApi/http';
import { handleRevenueCatWebhook } from './revenuecat/webhooks/subscriptionWebhook';
import {
  handleAccountBalances,
  handleBudgetPulse,
  handleCategoryAvailable,
  handleNetWorthHistory,
  handleTopSpending,
  handleUpcomingTransactions,
} from './widgets/http';

const http = httpRouter();
auth.addHttpRoutes(http);

http.route({
  path: '/exports/download',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    return handleWorkspaceExportDownload(ctx, request);
  }),
});

/**
 * Webhook endpoint for Plaid transaction sync
 * This handles transaction sync events from Plaid
 */
http.route({
  path: '/plaid-transaction-sync',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    return syncTransactionsWebhook(ctx, request);
  }),
});

/**
 * Webhook endpoint for RevenueCat subscription events
 * This handles subscription lifecycle events from RevenueCat
 */
http.route({
  path: '/revenuecat-webhook',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    return handleRevenueCatWebhook(ctx, request);
  }),
});

/**
 * MCP endpoint for Claude-compatible Streamable HTTP transport.
 *
 * Browser-based clients (claude.ai web) send a CORS preflight before POSTing,
 * so we register an OPTIONS handler and attach CORS headers to every response.
 */
http.route({
  path: '/mcp',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    return withCors(await handleMcpPost(ctx, request), request);
  }),
});

http.route({
  path: '/mcp',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    return withCors(await handleMcpGet(ctx, request), request);
  }),
});

http.route({
  path: '/mcp',
  method: 'DELETE',
  handler: httpAction(async (ctx, request) => {
    return withCors(await handleMcpDelete(ctx, request), request);
  }),
});

http.route({
  path: '/mcp',
  method: 'OPTIONS',
  handler: httpAction(async (_ctx, request) => {
    return handleCorsPreflight(request);
  }),
});

http.route({
  path: '/.well-known/oauth-protected-resource',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    return withCors(await handleOAuthProtectedResourceMetadataGet(ctx, request), request);
  }),
});

http.route({
  path: '/.well-known/oauth-protected-resource',
  method: 'OPTIONS',
  handler: httpAction(async (_ctx, request) => {
    return handleCorsPreflight(request);
  }),
});

http.route({
  path: '/.well-known/oauth-protected-resource/mcp',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    return withCors(await handleOAuthProtectedResourceMetadataGet(ctx, request), request);
  }),
});

http.route({
  path: '/.well-known/oauth-protected-resource/mcp',
  method: 'OPTIONS',
  handler: httpAction(async (_ctx, request) => {
    return handleCorsPreflight(request);
  }),
});

http.route({
  path: '/.well-known/oauth-authorization-server',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    return withCors(await handleOAuthAuthorizationServerMetadataGet(ctx, request), request);
  }),
});

http.route({
  path: '/.well-known/oauth-authorization-server',
  method: 'OPTIONS',
  handler: httpAction(async (_ctx, request) => {
    return handleCorsPreflight(request);
  }),
});

http.route({
  path: '/oauth/authorize',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    return handleOAuthAuthorizeGet(ctx, request);
  }),
});

http.route({
  path: '/oauth/token',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    return withCors(await handleOAuthTokenPost(ctx, request), request);
  }),
});

http.route({
  path: '/oauth/token',
  method: 'OPTIONS',
  handler: httpAction(async (_ctx, request) => {
    return handleCorsPreflight(request);
  }),
});

http.route({
  path: '/oauth/register',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    return withCors(await handleOAuthRegisterPost(ctx, request), request);
  }),
});

http.route({
  path: '/oauth/register',
  method: 'OPTIONS',
  handler: httpAction(async (_ctx, request) => {
    return handleCorsPreflight(request);
  }),
});

http.route({
  path: '/oauth/revoke',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    return withCors(await handleOAuthRevokePost(ctx, request), request);
  }),
});

http.route({
  path: '/oauth/revoke',
  method: 'OPTIONS',
  handler: httpAction(async (_ctx, request) => {
    return handleCorsPreflight(request);
  }),
});

/**
 * Public REST API (v1), authenticated with personal API keys created in the
 * web app under Settings → API Keys. Routing/dispatch lives in publicApi/http.
 */
for (const method of ['GET', 'POST', 'PATCH', 'DELETE'] as const) {
  http.route({
    pathPrefix: '/v1/',
    method,
    handler: httpAction(async (ctx, request) => {
      return handleApiRequest(ctx, request);
    }),
  });
}

http.route({
  pathPrefix: '/v1/',
  method: 'OPTIONS',
  handler: httpAction(async (_ctx, request) => {
    return handleApiCorsPreflight(request);
  }),
});

/**
 * Widget data endpoints for iOS widget extension
 * Authenticated via custom widget tokens (not Clerk JWT)
 */
http.route({
  path: '/widget/budget-pulse',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    return handleBudgetPulse(ctx, request);
  }),
});

http.route({
  path: '/widget/top-spending',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    return handleTopSpending(ctx, request);
  }),
});

http.route({
  path: '/widget/category-available',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    return handleCategoryAvailable(ctx, request);
  }),
});

http.route({
  path: '/widget/upcoming-transactions',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    return handleUpcomingTransactions(ctx, request);
  }),
});

http.route({
  path: '/widget/account-balances',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    return handleAccountBalances(ctx, request);
  }),
});

http.route({
  path: '/widget/net-worth',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    return handleNetWorthHistory(ctx, request);
  }),
});

export default http;
