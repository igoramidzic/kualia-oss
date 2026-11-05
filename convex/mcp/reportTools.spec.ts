import { describe, expect, it } from 'vitest';
import type { Id } from '../_generated/dataModel';
import { buildMcpActivityAttribution } from './http';
import {
  McpToolError,
  parseCreateBankAccountArgs,
  parseCreateTransactionsArgs,
  parseReconcileBankAccountArgs,
} from './reportTools';

describe('buildMcpActivityAttribution', () => {
  it('snapshots the authenticated OAuth token and client metadata', () => {
    expect(
      buildMcpActivityAttribution({
        tokenId: 'oauth_access_token' as Id<'mcpOauthAccessToken'>,
        clerkId: 'clerk_user',
        clientId: 'mcp_client',
        clientName: 'Claude Desktop',
      })
    ).toEqual({
      clerkId: 'clerk_user',
      source: {
        type: 'mcp',
        oauthAccessTokenId: 'oauth_access_token',
        clientId: 'mcp_client',
        clientName: 'Claude Desktop',
      },
    });
  });

  it('omits a missing client name instead of storing an undefined snapshot', () => {
    const attribution = buildMcpActivityAttribution({
      tokenId: 'oauth_access_token' as Id<'mcpOauthAccessToken'>,
      clerkId: 'clerk_user',
      clientId: 'mcp_client',
      clientName: undefined,
    });

    expect(attribution.source).not.toHaveProperty('clientName');
  });
});

function expectInvalidArguments(fn: () => unknown, expectedMessage: string): void {
  try {
    fn();
    throw new Error('Expected parseCreateTransactionsArgs to throw');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(McpToolError);
    if (error instanceof McpToolError) {
      expect(error.code).toBe('INVALID_ARGUMENT');
      expect(error.message).toBe(expectedMessage);
    }
  }
}

describe('parseCreateTransactionsArgs', () => {
  it('parses a regular split row and preserves uncategorized movements', () => {
    const parsed = parseCreateTransactionsArgs(
      {
        bankAccountId: 'bank_account_default',
        transactions: [
          {
            merchantName: 'Target',
            movements: [
              { amount: '-35.00', categoryId: 'category_groceries' },
              { amount: '-15.00', notes: 'uncategorized remainder' },
            ],
          },
        ],
      },
      2,
      '2026-06-03'
    );

    expect(parsed.defaultBankAccountId).toBe('bank_account_default');
    expect(parsed.rows).toHaveLength(1);
    const row = parsed.rows[0];
    if (row.kind !== 'regular') {
      throw new Error('Expected regular row');
    }

    expect(row.bankAccountId).toBe('bank_account_default');
    expect(row.input).toEqual({
      date: '2026-06-03',
      amount: -5000n,
      merchantName: 'Target',
      notes: undefined,
      movements: [
        {
          amount: -3500n,
          categoryId: 'category_groceries' as Id<'category'>,
          readyToAssign: undefined,
          notes: undefined,
        },
        {
          amount: -1500n,
          categoryId: undefined,
          readyToAssign: undefined,
          notes: 'uncategorized remainder',
        },
      ],
    });
  });

  it('keeps the legacy single-movement shortcut', () => {
    const parsed = parseCreateTransactionsArgs(
      {
        transactions: [
          {
            date: '2026-05-22',
            amount: '-12.34',
            merchantName: 'Coffee Shop',
            bankAccountId: 'bank_account_row',
            categoryId: 'category_dining',
          },
        ],
      },
      2,
      '2026-06-03'
    );

    const row = parsed.rows[0];
    if (row.kind !== 'regular') {
      throw new Error('Expected regular row');
    }

    expect(row.input).toEqual({
      date: '2026-05-22',
      amount: -1234n,
      merchantName: 'Coffee Shop',
      categoryId: 'category_dining' as Id<'category'>,
      notes: undefined,
    });
  });

  it('parses a Ready to Assign single-movement shortcut without a category', () => {
    const parsed = parseCreateTransactionsArgs(
      {
        bankAccountId: 'bank_account_default',
        transactions: [
          {
            date: '2026-06-15',
            amount: '1200.00',
            merchantName: 'Payroll',
            readyToAssign: true,
            notes: 'June paycheck',
          },
        ],
      },
      2,
      '2026-06-03'
    );

    const row = parsed.rows[0];
    if (row.kind !== 'regular') {
      throw new Error('Expected regular row');
    }

    expect(row.input).toEqual({
      date: '2026-06-15',
      amount: 120000n,
      merchantName: 'Payroll',
      categoryId: undefined,
      movements: [
        {
          amount: 120000n,
          readyToAssign: true,
        },
      ],
      notes: 'June paycheck',
    });
  });

  it('rejects ambiguous split rows that also pass shortcut fields', () => {
    expectInvalidArguments(
      () =>
        parseCreateTransactionsArgs(
          {
            bankAccountId: 'bank_account_default',
            transactions: [
              {
                amount: '-50.00',
                merchantName: 'Target',
                movements: [{ amount: '-50.00', categoryId: 'category_groceries' }],
              },
            ],
          },
          2,
          '2026-06-03'
        ),
      'transactions[0] cannot combine `movements` with `amount`, `categoryId`, or `readyToAssign` shortcuts'
    );
  });

  it('rejects single-movement shortcuts that are both categorized and Ready to Assign', () => {
    expectInvalidArguments(
      () =>
        parseCreateTransactionsArgs(
          {
            bankAccountId: 'bank_account_default',
            transactions: [
              {
                amount: '100.00',
                merchantName: 'Paycheck',
                categoryId: 'category_income',
                readyToAssign: true,
              },
            ],
          },
          2,
          '2026-06-03'
        ),
      'transactions[0] cannot have both categoryId and readyToAssign=true'
    );
  });

  it('rejects Ready to Assign on transfer rows', () => {
    expectInvalidArguments(
      () =>
        parseCreateTransactionsArgs(
          {
            transactions: [
              {
                type: 'transfer',
                amount: '100.00',
                fromAccountId: 'bank_account_checking',
                toAccountId: 'bank_account_savings',
                readyToAssign: true,
              },
            ],
          },
          2,
          '2026-06-03'
        ),
      'transactions[0].readyToAssign is not allowed on transfer rows'
    );
  });

  it('rejects movements that are both categorized and Ready to Assign', () => {
    expectInvalidArguments(
      () =>
        parseCreateTransactionsArgs(
          {
            bankAccountId: 'bank_account_default',
            transactions: [
              {
                merchantName: 'Paycheck',
                movements: [{ amount: '100.00', categoryId: 'category_income', readyToAssign: true }],
              },
            ],
          },
          2,
          '2026-06-03'
        ),
      'transactions[0].movements[0] cannot have both categoryId and readyToAssign=true'
    );
  });
});

describe('parseReconcileBankAccountArgs', () => {
  it('parses a reconciliation request with an explicit date and reported balance', () => {
    const parsed = parseReconcileBankAccountArgs(
      {
        bankAccountId: 'bank_account_checking',
        reportedBalance: '1234.56',
        reconciliationDate: '2026-06-03',
      },
      2
    );

    expect(parsed).toEqual({
      bankAccountId: 'bank_account_checking' as Id<'bankAccount'>,
      reportedBalance: 123456n,
      reconciliationDate: '2026-06-03',
    });
  });

  it('requires reconciliationDate instead of defaulting it', () => {
    expectInvalidArguments(
      () =>
        parseReconcileBankAccountArgs(
          {
            bankAccountId: 'bank_account_checking',
            reportedBalance: '1234.56',
          },
          2
        ),
      'reconciliationDate is required and must be a YYYY-MM-DD string'
    );
  });

  it('rejects impossible reconciliation dates', () => {
    expectInvalidArguments(
      () =>
        parseReconcileBankAccountArgs(
          {
            bankAccountId: 'bank_account_checking',
            reportedBalance: '1234.56',
            reconciliationDate: '2026-02-30',
          },
          2
        ),
      'reconciliationDate must be a valid calendar date'
    );
  });

  it('rejects reported balances with too many fractional digits', () => {
    expectInvalidArguments(
      () =>
        parseReconcileBankAccountArgs(
          {
            bankAccountId: 'bank_account_checking',
            reportedBalance: '1234.567',
            reconciliationDate: '2026-06-03',
          },
          2
        ),
      'Amount has more fractional digits than the currency supports (max 2): 1234.567'
    );
  });
});

describe('parseCreateBankAccountArgs', () => {
  it('parses a minimal manual account without an opening balance', () => {
    const parsed = parseCreateBankAccountArgs({ name: '  Everyday Checking  ', accountType: 'banking_checking' }, 2);

    expect(parsed).toEqual({
      name: 'Everyday Checking',
      accountType: 'banking_checking',
    });
  });

  it('parses an opening balance and date together', () => {
    const parsed = parseCreateBankAccountArgs(
      {
        name: 'Amex',
        accountType: 'credit_credit_card',
        initialBalance: '-500.00',
        initialBalanceDate: '2026-06-01',
      },
      2
    );

    expect(parsed).toEqual({
      name: 'Amex',
      accountType: 'credit_credit_card',
      initialBalance: -50000n,
      initialBalanceDate: '2026-06-01',
    });
  });

  it('rejects a missing or blank name', () => {
    expectInvalidArguments(
      () => parseCreateBankAccountArgs({ name: '   ', accountType: 'banking_savings' }, 2),
      'name is required and must be a non-empty string'
    );
  });

  it('rejects an unsupported account type', () => {
    expectInvalidArguments(
      () => parseCreateBankAccountArgs({ name: 'Vault', accountType: 'crypto_wallet' }, 2),
      'accountType must be one of the supported account types (e.g. banking_checking, credit_credit_card, investment_brokerage, loan_mortgage)'
    );
  });

  it('rejects an opening balance without a date', () => {
    expectInvalidArguments(
      () => parseCreateBankAccountArgs({ name: 'Vault', accountType: 'banking_savings', initialBalance: '100.00' }, 2),
      'initialBalance and initialBalanceDate must be provided together, or both omitted'
    );
  });

  it('rejects an opening-balance date without a balance', () => {
    expectInvalidArguments(
      () =>
        parseCreateBankAccountArgs(
          { name: 'Vault', accountType: 'banking_savings', initialBalanceDate: '2026-06-01' },
          2
        ),
      'initialBalance and initialBalanceDate must be provided together, or both omitted'
    );
  });

  it('rejects an opening balance with too many fractional digits', () => {
    expectInvalidArguments(
      () =>
        parseCreateBankAccountArgs(
          {
            name: 'Vault',
            accountType: 'banking_savings',
            initialBalance: '100.005',
            initialBalanceDate: '2026-06-01',
          },
          2
        ),
      'initialBalance: Amount has more fractional digits than the currency supports (max 2): 100.005'
    );
  });

  it('rejects an invalid opening-balance date', () => {
    expectInvalidArguments(
      () =>
        parseCreateBankAccountArgs(
          {
            name: 'Vault',
            accountType: 'banking_savings',
            initialBalance: '100.00',
            initialBalanceDate: '2026-02-30',
          },
          2
        ),
      'initialBalanceDate must be a valid calendar date'
    );
  });
});
