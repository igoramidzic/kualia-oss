import { describe, expect, it } from 'vitest';

import { getCurrentYearMonthForTimezone, parseCurrentYearMonth } from '../../../../../convex/lib/dates';
import { serializeBigInts } from '../../../../../convex/lib/serialization';
import { resolveCategoryNameFromBankAccount } from '../../../../../convex/mcp/categoryTools';
import { normalizeScope } from '../../../../../convex/mcp/oauthConfig';
import {
  APP_READ_SCOPE,
  BUDGETS_WRITE_SCOPE,
  listMcpTools,
  MCP_TOOL_GET_ACCOUNT_BALANCES_REPORT,
  MCP_TOOL_GET_CATEGORY_ROLLUP,
  MCP_TOOL_GET_ENVELOPE_MONTH_STATUS,
  MCP_TOOL_GET_INCOME_SUMMARY,
  MCP_TOOL_GET_NET_WORTH_REPORT,
  MCP_TOOL_GET_SPENDING_REPORT,
  MCP_TOOL_LIST_CATEGORY_GROUPS,
  MCP_TOOL_LIST_CATEGORY_TARGETS,
  MCP_TOOL_LIST_RECURRING_TRANSACTIONS,
  MCP_TOOL_LIST_TRANSACTIONS,
  MCP_TOOL_LIST_WORKSPACES,
  MCP_TOOL_RECONCILE_BANK_ACCOUNT,
  MCP_TOOL_SET_CATEGORY_ASSIGNED_AMOUNT,
  resolveMcpAmountMetadata,
} from '../../../../../convex/mcp/tools';

describe('mcp input validation helpers', () => {
  it('parses valid currentYearMonth values', () => {
    expect(parseCurrentYearMonth('202602')).toBe(202602);
    expect(parseCurrentYearMonth(202512)).toBe(202512);
    expect(parseCurrentYearMonth(undefined)).toBeUndefined();
  });

  it('rejects invalid currentYearMonth values', () => {
    expect(() => parseCurrentYearMonth('202613')).toThrowError('currentYearMonth month must be between 01 and 12');
    expect(() => parseCurrentYearMonth('2026-02')).toThrowError('currentYearMonth must be a YYYYMM string');
  });

  it('derives current year-month for a timezone', () => {
    const value = getCurrentYearMonthForTimezone('America/New_York');
    expect(String(value)).toMatch(/^\d{6}$/);
  });

  it('falls back for invalid timezone values', () => {
    const value = getCurrentYearMonthForTimezone('Invalid/Timezone');
    expect(String(value)).toMatch(/^\d{6}$/);
  });
});

describe('mcp serialization helper', () => {
  it('serializes bigint values recursively, preserving sign and very large values as strings', () => {
    const veryLargeAmount = 9007199254740993123456789n;

    const payload = {
      amount: 42n,
      negativeAmount: -1200n,
      veryLargeAmount,
      nested: {
        values: [1n, { cents: 2500n }],
      },
    };

    expect(serializeBigInts(payload)).toEqual({
      amount: '42',
      negativeAmount: '-1200',
      veryLargeAmount: veryLargeAmount.toString(),
      nested: {
        values: ['1', { cents: '2500' }],
      },
    });
  });

  it('formats bigints as fixed-point decimal strings when minorUnit is provided', () => {
    const payload = {
      amount: 5108n,
      negativeAmount: -7118n,
      whole: 20000n,
      lessThanOne: 8n,
      zero: 0n,
      nested: { values: [4250n, { cents: -25n }] },
    };

    expect(serializeBigInts(payload, 2)).toEqual({
      amount: '51.08',
      negativeAmount: '-71.18',
      whole: '200.00',
      lessThanOne: '0.08',
      zero: '0.00',
      nested: { values: ['42.50', { cents: '-0.25' }] },
    });
  });

  it('returns minorUnit=0 currencies as plain integer strings (no decimal point)', () => {
    expect(serializeBigInts({ amount: 12345n }, 0)).toEqual({ amount: '12345' });
  });

  it('handles minorUnit=3 (KWD-style) correctly', () => {
    expect(serializeBigInts({ amount: 1234n }, 3)).toEqual({ amount: '1.234' });
    expect(serializeBigInts({ amount: 50n }, 3)).toEqual({ amount: '0.050' });
  });
});

describe('mcp tools registry', () => {
  it('exposes account balances, spending, workspaces, grouped categories tools, and assignment write tool', () => {
    const toolNames = listMcpTools().map((tool) => tool.name);

    expect(toolNames).toContain(MCP_TOOL_LIST_WORKSPACES);
    expect(toolNames).toContain(MCP_TOOL_GET_ACCOUNT_BALANCES_REPORT);
    expect(toolNames).toContain(MCP_TOOL_GET_SPENDING_REPORT);
    expect(toolNames).toContain(MCP_TOOL_LIST_CATEGORY_GROUPS);
    expect(toolNames).toContain(MCP_TOOL_GET_ENVELOPE_MONTH_STATUS);
    expect(toolNames).toContain(MCP_TOOL_SET_CATEGORY_ASSIGNED_AMOUNT);
    expect(toolNames).not.toContain(MCP_TOOL_GET_NET_WORTH_REPORT);
  });

  it('exposes transaction, target, recurring, income, and rollup tools', () => {
    const toolNames = listMcpTools().map((tool) => tool.name);

    expect(toolNames).toContain(MCP_TOOL_LIST_TRANSACTIONS);
    expect(toolNames).toContain(MCP_TOOL_LIST_CATEGORY_TARGETS);
    expect(toolNames).toContain(MCP_TOOL_LIST_RECURRING_TRANSACTIONS);
    expect(toolNames).toContain(MCP_TOOL_GET_INCOME_SUMMARY);
    expect(toolNames).toContain(MCP_TOOL_GET_CATEGORY_ROLLUP);
    expect(toolNames).toContain(MCP_TOOL_RECONCILE_BANK_ACCOUNT);
  });

  it('requires explicit balance and date for reconcile bank account tool', () => {
    const reconcileTool = listMcpTools().find((tool) => tool.name === MCP_TOOL_RECONCILE_BANK_ACCOUNT);
    const inputSchema = reconcileTool?.inputSchema as { required?: string[] } | undefined;

    expect(reconcileTool?.annotations.readOnlyHint).toBe(false);
    expect(reconcileTool?.executor).toBe('mutation');
    expect(inputSchema?.required).toContain('bankAccountId');
    expect(inputSchema?.required).toContain('reportedBalance');
    expect(inputSchema?.required).toContain('reconciliationDate');
    expect(reconcileTool?.description).toContain('explicit `reconciliationDate`');
    expect(reconcileTool?.description).toContain('not the adjustment delta');
  });

  it('requires yearMonth for list transactions tool', () => {
    const txnTool = listMcpTools().find((tool) => tool.name === MCP_TOOL_LIST_TRANSACTIONS);
    const inputSchema = txnTool?.inputSchema as { required?: string[] } | undefined;
    expect(inputSchema?.required).toContain('yearMonth');
    expect(txnTool?.annotations.readOnlyHint).toBe(true);
  });

  it('marks all new read tools as readOnlyHint', () => {
    const newToolNames = [
      MCP_TOOL_LIST_TRANSACTIONS,
      MCP_TOOL_LIST_CATEGORY_TARGETS,
      MCP_TOOL_LIST_RECURRING_TRANSACTIONS,
      MCP_TOOL_GET_INCOME_SUMMARY,
      MCP_TOOL_GET_CATEGORY_ROLLUP,
    ];
    const tools = listMcpTools();
    for (const name of newToolNames) {
      const tool = tools.find((t) => t.name === name);
      expect(tool?.annotations.readOnlyHint).toBe(true);
    }
  });

  it('spending report supports yearMonth parameter for single-month view', () => {
    const spendingTool = listMcpTools().find((tool) => tool.name === MCP_TOOL_GET_SPENDING_REPORT);
    const inputSchema = spendingTool?.inputSchema as { properties?: Record<string, unknown> } | undefined;
    expect(inputSchema?.properties?.['yearMonth']).toBeDefined();
  });

  it('describes account balances tool as account balance history with decimal-string encoding', () => {
    const accountBalancesTool = listMcpTools().find((tool) => tool.name === MCP_TOOL_GET_ACCOUNT_BALANCES_REPORT);
    expect(accountBalancesTool?.description).toContain('account balance history');
    expect(accountBalancesTool?.description).toContain('decimal string');
    expect(accountBalancesTool?.description).toContain("amountEncoding='decimal_string'");
  });

  it('requires currentDate for envelope month status tool', () => {
    const envelopeTool = listMcpTools().find((tool) => tool.name === MCP_TOOL_GET_ENVELOPE_MONTH_STATUS);
    const inputSchema = envelopeTool?.inputSchema as { required?: string[] } | undefined;

    expect(inputSchema?.required).toContain('yearMonth');
    expect(inputSchema?.required).toContain('currentDate');
    expect(envelopeTool?.description).toContain('target.remainingToAssign');
    expect(envelopeTool?.description).toContain('target.underfundedAmount');
  });

  it('marks set category assigned amount tool as writable and supports single or bulk updates', () => {
    const setAssignedAmountTool = listMcpTools().find((tool) => tool.name === MCP_TOOL_SET_CATEGORY_ASSIGNED_AMOUNT);
    const inputSchema = setAssignedAmountTool?.inputSchema as
      | {
          properties?: Record<string, unknown>;
          anyOf?: unknown;
          oneOf?: unknown;
          allOf?: unknown;
        }
      | undefined;

    expect(setAssignedAmountTool?.annotations.readOnlyHint).toBe(false);
    // Description must explain both single-mode and bulk-mode usage and the signed-amount semantics,
    // since we can't encode the mutual-exclusion constraint in the schema (Bedrock and Anthropic reject
    // top-level anyOf/oneOf/allOf in tool input_schema).
    expect(setAssignedAmountTool?.description).toMatch(/positive funds.*negative defunds/i);
    expect(setAssignedAmountTool?.description).toMatch(/single mode/i);
    expect(setAssignedAmountTool?.description).toMatch(/bulk mode/i);
    expect(inputSchema?.properties?.['categoryId']).toBeDefined();
    expect(inputSchema?.properties?.['yearMonth']).toBeDefined();
    expect(inputSchema?.properties?.['assignedAmount']).toBeDefined();
    expect(inputSchema?.properties?.['updates']).toBeDefined();
    expect(inputSchema?.anyOf).toBeUndefined();
    expect(inputSchema?.oneOf).toBeUndefined();
    expect(inputSchema?.allOf).toBeUndefined();
  });
});

describe('mcp oauth scopes', () => {
  it('defaults to app:read when scope is omitted', () => {
    expect(normalizeScope(undefined)).toEqual([APP_READ_SCOPE]);
  });

  it('accepts budgets:write and app:read + budgets:write', () => {
    expect(normalizeScope(BUDGETS_WRITE_SCOPE)).toEqual([BUDGETS_WRITE_SCOPE]);
    expect(normalizeScope(`${APP_READ_SCOPE} ${BUDGETS_WRITE_SCOPE}`)).toEqual([APP_READ_SCOPE, BUDGETS_WRITE_SCOPE]);
  });

  it('maps legacy reports:read to app:read and rejects unsupported scopes', () => {
    expect(normalizeScope('reports:read')).toEqual([APP_READ_SCOPE]);
    expect(() => normalizeScope('unknown:scope')).toThrowError('Unsupported scope: unknown:scope');
  });
});

describe('mcp amount metadata', () => {
  it('returns expected metadata for 2-decimal, 0-decimal, and 3-decimal currencies', () => {
    expect(resolveMcpAmountMetadata('USD')).toEqual({
      currencyCode: 'USD',
      minorUnit: 2,
      amountEncoding: 'decimal_string',
    });

    expect(resolveMcpAmountMetadata('JPY')).toEqual({
      currencyCode: 'JPY',
      minorUnit: 0,
      amountEncoding: 'decimal_string',
    });

    expect(resolveMcpAmountMetadata('KWD')).toEqual({
      currencyCode: 'KWD',
      minorUnit: 3,
      amountEncoding: 'decimal_string',
    });
  });

  it('normalizes currency code case and uses 2-decimal fallback for unknown currencies', () => {
    expect(resolveMcpAmountMetadata('usd')).toEqual({
      currencyCode: 'USD',
      minorUnit: 2,
      amountEncoding: 'decimal_string',
    });

    expect(resolveMcpAmountMetadata('ZZZ')).toEqual({
      currencyCode: 'ZZZ',
      minorUnit: 2,
      amountEncoding: 'decimal_string',
    });
  });
});

describe('mcp category tools', () => {
  it('uses linked bank account name for credit card categories', () => {
    const bankAccountNamesById = new Map<string, string>([['bankAccount_1', 'Amex Gold']]);

    expect(
      resolveCategoryNameFromBankAccount('Old Card Name', 'credit_card', 'bankAccount_1', bankAccountNamesById)
    ).toBe('Amex Gold');
  });

  it('keeps category name when not a credit card category or account is missing', () => {
    const bankAccountNamesById = new Map<string, string>([['bankAccount_1', 'Amex Gold']]);

    expect(resolveCategoryNameFromBankAccount('Groceries', 'custom', undefined, bankAccountNamesById)).toBe(
      'Groceries'
    );
    expect(
      resolveCategoryNameFromBankAccount('Card Category', 'credit_card', 'bankAccount_2', bankAccountNamesById)
    ).toBe('Card Category');
  });
});
