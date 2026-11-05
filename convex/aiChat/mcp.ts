import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import type { ToolSet } from 'ai';

const DEFAULT_DOCS_MCP_URL = 'https://docs.kualia.com/mcp';

interface DocsMcp {
  client: MCPClient;
  tools: ToolSet;
}

/**
 * Module-scoped lazy init for the docs MCP. We cache the connected client and
 * its tool schema so we pay the HTTP setup cost once per Convex container,
 * not once per chat message.
 *
 * If init fails, we drop the cached promise so the next request retries.
 */
let docsMcpPromise: Promise<DocsMcp> | null = null;

async function initDocsMcp(): Promise<DocsMcp> {
  const url = process.env['KUALIA_DOCS_MCP_URL'] ?? DEFAULT_DOCS_MCP_URL;

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
 * Returns the docs MCP tool set, or undefined if the server is unreachable.
 *
 * The chat agent merges these into the broader tool set passed to the LLM. The
 * client and tools are cached at module scope and reused across action
 * invocations on the same Convex container.
 */
export async function getDocsTools(): Promise<ToolSet | undefined> {
  docsMcpPromise ??= initDocsMcp();

  try {
    const { tools } = await docsMcpPromise;
    return tools;
  } catch (error) {
    console.error('Failed to initialize docs MCP client; continuing without docs tools', error);
    docsMcpPromise = null;
    return undefined;
  }
}
