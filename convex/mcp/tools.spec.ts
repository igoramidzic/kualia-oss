import { describe, expect, it } from 'vitest';
import { listMcpTools, MCP_TOOL_CREATE_TRANSACTIONS, MCP_TOOL_EXPORT_WORKSPACE_DATA } from './tools';

function expectProviderCompatibleRequiredFields(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item: unknown, index: number) => {
      expectProviderCompatibleRequiredFields(item, `${path}[${index}]`);
    });
    return;
  }
  if (typeof value !== 'object' || value === null) return;

  const schema = value as Record<string, unknown>;
  if (Array.isArray(schema['required'])) {
    expect(schema['type'], `${path}.type`).toBe('object');
    const properties = schema['properties'] as Record<string, unknown> | undefined;
    for (const field of schema['required'] as unknown[]) {
      expect(typeof field, `${path}.required`).toBe('string');
      expect(Object.keys(properties ?? {}), `${path}.properties`).toContain(field);
    }
  }
  for (const [key, child] of Object.entries(schema)) {
    expectProviderCompatibleRequiredFields(child, `${path}.${key}`);
  }
}

describe('MCP tool provider schemas', () => {
  it.each(listMcpTools())('$name defines required fields on explicit object schemas', (tool) => {
    // Gemini requires each anyOf branch to declare its own type and properties.
    expectProviderCompatibleRequiredFields(tool.inputSchema, tool.name);
  });

  it('requires either a shortcut amount or split movements for transaction creation', () => {
    const tool = listMcpTools().find((candidate) => candidate.name === MCP_TOOL_CREATE_TRANSACTIONS);

    expect(tool?.inputSchema).toMatchObject({
      properties: {
        transactions: {
          items: {
            anyOf: [
              { type: 'object', properties: { amount: { type: 'string' } }, required: ['amount'] },
              {
                type: 'object',
                properties: {
                  movements: {
                    type: 'array',
                    minItems: 1,
                    items: {
                      type: 'object',
                      properties: { amount: { type: 'string' } },
                      required: ['amount'],
                    },
                  },
                },
                required: ['movements'],
              },
            ],
          },
        },
      },
    });
  });
});

describe('MCP workspace data export tool', () => {
  it('is discoverable as a read-only action with an optional workspace id', () => {
    const tool = listMcpTools().find((candidate) => candidate.name === MCP_TOOL_EXPORT_WORKSPACE_DATA);

    expect(tool).toMatchObject({
      name: 'kualia_export_workspace_data',
      executor: 'action',
      annotations: { readOnlyHint: true },
    });
    expect(tool?.inputSchema).toMatchObject({
      type: 'object',
      properties: { workspaceId: { type: 'string' } },
      additionalProperties: false,
    });
  });
});
