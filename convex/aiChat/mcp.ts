import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import type { ToolSet } from 'ai';

export const KUALIA_DOCS_MCP_URL_ENV_VAR = 'KUALIA_DOCS_MCP_URL';

interface DocsMcp {
  client: MCPClient;
  tools: ToolSet;
}

/**
 * Returns the configured docs MCP endpoint, or null when docs tools are
 * disabled. There is deliberately no default: the hosted docs site is retired,
 * and tools from an MCP server are fed straight to the AI agent, so only a
 * server the operator explicitly configured may supply them.
 */
export function getDocsMcpUrl(raw: string | undefined = process.env[KUALIA_DOCS_MCP_URL_ENV_VAR]): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch (error: unknown) {
    void error;
    console.error(`${KUALIA_DOCS_MCP_URL_ENV_VAR} is not a valid http(s) URL; docs tools are disabled`);
    return null;
  }
}

/**
 * Origin of the configured docs site, used to tell the agent how to turn
 * relative doc paths into links. Null when docs tools are disabled.
 */
export function getDocsBaseUrl(raw?: string): string | null {
  const url = getDocsMcpUrl(raw);
  return url ? new URL(url).origin : null;
}

/**
 * Module-scoped lazy init for the docs MCP. We cache the connected client and
 * its tool schema so we pay the HTTP setup cost once per Convex container,
 * not once per chat message.
 *
 * If init fails, we drop the cached promise so the next request retries.
 */
let docsMcp: { url: string; promise: Promise<DocsMcp> } | null = null;

async function initDocsMcp(url: string): Promise<DocsMcp> {
  const client = await createMCPClient({
    transport: { type: 'http', url },
    clientName: 'kualia-chat',
    onUncaughtError: (error) => {
      console.error('Docs MCP client error', error);
    },
  });

  const tools = (await client.tools()) as ToolSet;
  return { client, tools };
}

/**
 * Returns the docs MCP tool set, or undefined when `KUALIA_DOCS_MCP_URL` is
 * unset (no client is created and no network call is made) or the server is
 * unreachable.
 *
 * The chat agent merges these into the broader tool set passed to the LLM. The
 * client and tools are cached at module scope and reused across action
 * invocations on the same Convex container.
 */
export async function getDocsTools(): Promise<ToolSet | undefined> {
  const url = getDocsMcpUrl();
  if (!url) return undefined;

  if (docsMcp?.url !== url) {
    docsMcp = { url, promise: initDocsMcp(url) };
  }
  const current = docsMcp;

  try {
    const { tools } = await current.promise;
    return tools;
  } catch (error: unknown) {
    console.error('Failed to initialize docs MCP client; continuing without docs tools', error);
    if (docsMcp === current) docsMcp = null;
    return undefined;
  }
}
