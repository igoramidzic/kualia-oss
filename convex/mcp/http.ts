import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import type { ActivityAttribution } from '../activityLogs/types';
import { sha256Hex } from '../lib/crypto';
import { serializeBigInts } from '../lib/serialization';
import { getMcpWwwAuthenticateHeader } from './oauthHttp';
import { listMcpTools, type McpToolExecutor } from './tools';

interface JsonRpcRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonResponse(payload: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      ...(extraHeaders ?? {}),
    },
  });
}

function jsonRpcErrorResponse(
  id: string | number | null | undefined,
  error: JsonRpcError,
  status = 200,
  extraHeaders?: Record<string, string>
): Response {
  return jsonResponse(
    {
      jsonrpc: '2.0',
      id: id ?? null,
      error,
    },
    status,
    extraHeaders
  );
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization) {
    return null;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }

  return match[1]?.trim() ?? null;
}

interface AuthenticatedMcpRequest {
  tokenId: Id<'mcpOauthAccessToken'>;
  clerkId: string;
  clientId: string;
  clientName: string | undefined;
  scopes: string[];
  activeWorkspaceId: Id<'workspace'> | undefined;
}

export function buildMcpActivityAttribution(
  authContext: Pick<AuthenticatedMcpRequest, 'tokenId' | 'clerkId' | 'clientId' | 'clientName'>
): ActivityAttribution {
  return {
    clerkId: authContext.clerkId,
    source: {
      type: 'mcp',
      oauthAccessTokenId: authContext.tokenId,
      clientId: authContext.clientId,
      ...(authContext.clientName === undefined ? {} : { clientName: authContext.clientName }),
    },
  };
}

async function authenticateMcpRequest(ctx: ActionCtx, request: Request): Promise<AuthenticatedMcpRequest | null> {
  const rawToken = getBearerToken(request);
  if (!rawToken) {
    return null;
  }

  const tokenHash = await sha256Hex(rawToken);
  const oauthTokenContext = await ctx.runQuery(internal.mcp.oauthQueries.authenticateOauthAccessToken, { tokenHash });
  if (oauthTokenContext) {
    return {
      tokenId: oauthTokenContext.tokenId,
      clerkId: oauthTokenContext.clerkId,
      clientId: oauthTokenContext.clientId,
      clientName: oauthTokenContext.clientName,
      scopes: oauthTokenContext.scopes,
      activeWorkspaceId: oauthTokenContext.activeWorkspaceId,
    };
  }

  return null;
}

function parseJsonRpcRequest(payload: unknown): JsonRpcRequest | null {
  if (!isRecord(payload)) {
    return null;
  }

  if (payload['jsonrpc'] !== '2.0') {
    return null;
  }

  const method = payload['method'];
  if (typeof method !== 'string') {
    return null;
  }

  const idValue = payload['id'];
  const validId =
    idValue === undefined || idValue === null || typeof idValue === 'string' || typeof idValue === 'number';

  if (!validId) {
    return null;
  }

  return {
    jsonrpc: '2.0',
    id: idValue as JsonRpcRequest['id'],
    method,
    params: payload['params'],
  };
}

function makeToolSuccessResponse(id: string | number | null | undefined, data: unknown): Response {
  // Format bigint money fields as decimal strings ("51.08") rather than raw minor-units
  // integers ("5108"). The payload itself carries `minorUnit` for the workspace currency
  // (USD=2, JPY=0, KWD=3, etc.), so we read it back off the result instead of plumbing
  // it through. When absent, we leave bigints as plain integer strings rather than guess
  // a default — assuming `minorUnit=2` would silently mis-format JPY or KWD payloads.
  const minorUnit = isRecord(data) && typeof data['minorUnit'] === 'number' ? (data['minorUnit'] as number) : undefined;
  const serializedData = serializeBigInts(data, minorUnit);
  const structuredContent = isRecord(serializedData) ? serializedData : { value: serializedData };
  const text = JSON.stringify(structuredContent);

  return jsonResponse({
    jsonrpc: '2.0',
    id: id ?? null,
    result: {
      content: [
        {
          type: 'text',
          text,
        },
      ],
      structuredContent,
      isError: false,
    },
  });
}

function makeToolErrorResponse(
  id: string | number | null | undefined,
  code: string,
  message: string,
  status = 200,
  extraHeaders?: Record<string, string>
): Response {
  return jsonResponse(
    {
      jsonrpc: '2.0',
      id: id ?? null,
      result: {
        content: [
          {
            type: 'text',
            text: `${code}: ${message}`,
          },
        ],
        structuredContent: {
          error: {
            code,
            message,
          },
        },
        isError: true,
      },
    },
    status,
    extraHeaders
  );
}

function makeUnauthenticatedResponse(request: Request, id: string | number | null | undefined): Response {
  return jsonRpcErrorResponse(
    id,
    {
      code: -32001,
      message: 'UNAUTHENTICATED',
    },
    401,
    {
      'www-authenticate': getMcpWwwAuthenticateHeader(request),
    }
  );
}

async function touchTokenLastUsed(ctx: ActionCtx, authContext: AuthenticatedMcpRequest): Promise<void> {
  await ctx.runMutation(internal.mcp.oauthMutations.touchOauthAccessTokenLastUsed, {
    tokenId: authContext.tokenId,
  });
}

export async function handleMcpPost(ctx: ActionCtx, request: Request): Promise<Response> {
  let requestPayload: unknown;
  try {
    requestPayload = (await request.json()) as unknown;
  } catch {
    return jsonRpcErrorResponse(
      null,
      {
        code: -32700,
        message: 'Parse error',
      },
      400
    );
  }

  const rpcRequest = parseJsonRpcRequest(requestPayload);
  if (!rpcRequest) {
    return jsonRpcErrorResponse(
      null,
      {
        code: -32600,
        message: 'Invalid Request',
      },
      400
    );
  }

  const { id, method } = rpcRequest;

  switch (method) {
    case 'initialize': {
      return jsonResponse({
        jsonrpc: '2.0',
        id: id ?? null,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
          serverInfo: {
            name: 'kualia-mcp',
            version: '1.0.0',
          },
        },
      });
    }

    case 'notifications/initialized': {
      if (id === undefined || id === null) {
        return new Response(null, { status: 202 });
      }

      return jsonResponse({
        jsonrpc: '2.0',
        id,
        result: {},
      });
    }

    case 'ping': {
      return jsonResponse({
        jsonrpc: '2.0',
        id: id ?? null,
        result: {},
      });
    }

    case 'tools/list': {
      const authContext = await authenticateMcpRequest(ctx, request);
      if (!authContext) {
        return makeUnauthenticatedResponse(request, id);
      }

      await touchTokenLastUsed(ctx, authContext);

      return jsonResponse({
        jsonrpc: '2.0',
        id: id ?? null,
        result: {
          tools: listMcpTools(),
        },
      });
    }

    case 'tools/call': {
      const authContext = await authenticateMcpRequest(ctx, request);
      if (!authContext) {
        return makeUnauthenticatedResponse(request, id);
      }

      await touchTokenLastUsed(ctx, authContext);

      if (!isRecord(rpcRequest.params)) {
        return makeToolErrorResponse(id, 'INVALID_ARGUMENT', 'tools/call params must be an object');
      }

      const toolName = rpcRequest.params['name'];
      if (typeof toolName !== 'string') {
        return makeToolErrorResponse(id, 'INVALID_ARGUMENT', 'tools/call requires a string name');
      }

      let rawArguments: string | undefined;
      try {
        if (rpcRequest.params['arguments'] !== undefined) {
          rawArguments = JSON.stringify(rpcRequest.params['arguments']);
        }
      } catch {
        return makeToolErrorResponse(id, 'INVALID_ARGUMENT', 'Tool arguments must be JSON-serializable');
      }

      // Look up the tool's executor kind from the registry so MCP HTTP and the in-app chat
      // dispatch identically. Falls back to 'query' for resilience against an unrecognized name
      // — the executor itself will then return INVALID_ARGUMENT.
      const toolDef = listMcpTools().find((t) => t.name === toolName);
      const executor: McpToolExecutor = toolDef?.executor ?? 'query';
      const dispatchArgs = {
        toolName,
        clerkId: authContext.clerkId,
        activeWorkspaceId: authContext.activeWorkspaceId,
        scopes: authContext.scopes,
        rawArguments,
      };
      const writeDispatchArgs = {
        ...dispatchArgs,
        attribution: buildMcpActivityAttribution(authContext),
      };
      const result =
        executor === 'action'
          ? await ctx.runAction(internal.mcp.reportTools.executeMcpActionTool, writeDispatchArgs)
          : executor === 'mutation'
            ? await ctx.runMutation(internal.mcp.reportTools.executeMcpMutationTool, writeDispatchArgs)
            : await ctx.runQuery(internal.mcp.reportTools.executeMcpTool, dispatchArgs);

      if (!result.ok) {
        return makeToolErrorResponse(id, result.error.code, result.error.message);
      }

      return makeToolSuccessResponse(id, result.data);
    }

    default:
      return jsonRpcErrorResponse(id, {
        code: -32601,
        message: `Method not found: ${method}`,
      });
  }
}

export async function handleMcpGet(_ctx: ActionCtx, _request: Request): Promise<Response> {
  return new Response(null, {
    status: 405,
    headers: { allow: 'POST, DELETE' },
  });
}

export async function handleMcpDelete(_ctx: ActionCtx, _request: Request): Promise<Response> {
  return new Response(null, { status: 204 });
}
