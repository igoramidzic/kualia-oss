import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createMCPClient: vi.fn(),
  tools: vi.fn(),
}));

vi.mock('@ai-sdk/mcp', () => ({ createMCPClient: mocks.createMCPClient }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.tools.mockResolvedValue({ docs_search: {} });
  mocks.createMCPClient.mockResolvedValue({ tools: mocks.tools });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function loadMcp() {
  return await import('./mcp');
}

describe('docs MCP configuration', () => {
  it.each(['', '   '])('is disabled when KUALIA_DOCS_MCP_URL is %j', async (configured) => {
    vi.stubEnv('KUALIA_DOCS_MCP_URL', configured);
    const { getDocsMcpUrl, getDocsBaseUrl, getDocsTools } = await loadMcp();

    expect(getDocsMcpUrl()).toBeNull();
    expect(getDocsBaseUrl()).toBeNull();
    await expect(getDocsTools()).resolves.toBeUndefined();
    expect(mocks.createMCPClient).not.toHaveBeenCalled();
  });

  it('has no hosted default', async () => {
    const { getDocsMcpUrl } = await loadMcp();
    expect(getDocsMcpUrl(undefined)).toBeNull();
  });

  it.each(['not a url', 'file:///etc/passwd'])('is disabled for an invalid URL %j', async (configured) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('KUALIA_DOCS_MCP_URL', configured);
    const { getDocsTools } = await loadMcp();

    await expect(getDocsTools()).resolves.toBeUndefined();
    expect(mocks.createMCPClient).not.toHaveBeenCalled();
  });

  it('connects only to the configured server and caches the client', async () => {
    vi.stubEnv('KUALIA_DOCS_MCP_URL', 'https://docs.example.test/mcp');
    const { getDocsBaseUrl, getDocsTools } = await loadMcp();

    await expect(getDocsTools()).resolves.toEqual({ docs_search: {} });
    await expect(getDocsTools()).resolves.toEqual({ docs_search: {} });
    expect(mocks.createMCPClient).toHaveBeenCalledTimes(1);
    expect(mocks.createMCPClient).toHaveBeenCalledWith(
      expect.objectContaining({ transport: { type: 'http', url: 'https://docs.example.test/mcp' } })
    );
    expect(getDocsBaseUrl()).toBe('https://docs.example.test');
  });

  it('continues without docs tools and retries after a connection failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('KUALIA_DOCS_MCP_URL', 'https://docs.example.test/mcp');
    mocks.createMCPClient.mockRejectedValueOnce(new Error('unreachable'));
    const { getDocsTools } = await loadMcp();

    await expect(getDocsTools()).resolves.toBeUndefined();
    await expect(getDocsTools()).resolves.toEqual({ docs_search: {} });
    expect(mocks.createMCPClient).toHaveBeenCalledTimes(2);
  });
});
