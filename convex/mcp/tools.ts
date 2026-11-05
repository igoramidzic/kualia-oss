import { getCurrencyDecimals } from '../../packages/shared/src/currency/currency-conversion';

export const APP_READ_SCOPE = 'app:read' as const;
export const LEGACY_REPORTS_READ_SCOPE = 'reports:read' as const;
// Deprecated alias retained for backward compatibility with existing imports.
export const REPORTS_READ_SCOPE = APP_READ_SCOPE;
export const BUDGETS_WRITE_SCOPE = 'budgets:write' as const;
export const TRANSACTIONS_WRITE_SCOPE = 'transactions:write' as const;
export const MCP_TOOL_LIST_WORKSPACES = 'kualia_list_workspaces' as const;
export const MCP_TOOL_EXPORT_WORKSPACE_DATA = 'kualia_export_workspace_data' as const;
export const MCP_TOOL_GET_ACCOUNT_BALANCES_REPORT = 'kualia_get_account_balances_report' as const;
// Deprecated alias retained for backward compatibility with existing clients.
export const MCP_TOOL_GET_NET_WORTH_REPORT = 'kualia_get_net_worth_report' as const;
export const MCP_TOOL_GET_SPENDING_REPORT = 'kualia_get_spending_report' as const;
export const MCP_TOOL_LIST_CATEGORY_GROUPS = 'kualia_list_category_groups' as const;
export const MCP_TOOL_GET_ENVELOPE_MONTH_STATUS = 'kualia_get_envelope_month_status' as const;
export const MCP_TOOL_SET_CATEGORY_ASSIGNED_AMOUNT = 'kualia_set_category_assigned_amount' as const;
export const MCP_TOOL_LIST_TRANSACTIONS = 'kualia_list_transactions' as const;
export const MCP_TOOL_LIST_CATEGORY_TARGETS = 'kualia_list_category_targets' as const;
export const MCP_TOOL_LIST_RECURRING_TRANSACTIONS = 'kualia_list_recurring_transactions' as const;
export const MCP_TOOL_GET_INCOME_SUMMARY = 'kualia_get_income_summary' as const;
export const MCP_TOOL_GET_CATEGORY_ROLLUP = 'kualia_get_category_rollup' as const;
export const MCP_TOOL_GET_MONTHLY_SUMMARY = 'kualia_get_monthly_summary' as const;
export const MCP_TOOL_LIST_BANK_ACCOUNTS = 'kualia_list_bank_accounts' as const;
export const MCP_TOOL_CREATE_BANK_ACCOUNT = 'kualia_create_bank_account' as const;
export const MCP_TOOL_CLOSE_BANK_ACCOUNT = 'kualia_close_bank_account' as const;
export const MCP_TOOL_DELETE_BANK_ACCOUNT = 'kualia_delete_bank_account' as const;
export const MCP_TOOL_RECONCILE_BANK_ACCOUNT = 'kualia_reconcile_bank_account' as const;
export const MCP_TOOL_CREATE_TRANSACTIONS = 'kualia_create_transactions' as const;
export const MCP_TOOL_UPDATE_TRANSACTIONS = 'kualia_update_transactions' as const;
export const MCP_TOOL_DELETE_TRANSACTIONS = 'kualia_delete_transactions' as const;
export const MCP_TOOL_RESTORE_TRANSACTIONS = 'kualia_restore_transactions' as const;
export const MCP_TOOL_CREATE_CATEGORIES = 'kualia_create_categories' as const;
export const MCP_TOOL_UPDATE_CATEGORIES = 'kualia_update_categories' as const;
export const MCP_TOOL_ARCHIVE_CATEGORIES = 'kualia_archive_categories' as const;
export const MCP_TOOL_DELETE_CATEGORIES = 'kualia_delete_categories' as const;
export const MCP_TOOL_REORDER_CATEGORIES = 'kualia_reorder_categories' as const;
export const MCP_TOOL_SORT_CATEGORIES = 'kualia_sort_categories' as const;
export const MCP_TOOL_CREATE_CATEGORY_GROUPS = 'kualia_create_category_groups' as const;
export const MCP_TOOL_UPDATE_CATEGORY_GROUPS = 'kualia_update_category_groups' as const;
export const MCP_TOOL_ARCHIVE_CATEGORY_GROUPS = 'kualia_archive_category_groups' as const;
export const MCP_TOOL_REORDER_CATEGORY_GROUPS = 'kualia_reorder_category_groups' as const;
export const MCP_TOOL_SORT_CATEGORY_GROUPS = 'kualia_sort_category_groups' as const;
export const MCP_TOOL_CREATE_CATEGORY_TARGET = 'kualia_create_category_target' as const;
export const MCP_TOOL_UPDATE_CATEGORY_TARGET = 'kualia_update_category_target' as const;
export const MCP_TOOL_DELETE_CATEGORY_TARGET = 'kualia_delete_category_target' as const;

/**
 * Backend dispatch kind. Drives both the MCP HTTP route and the in-app chat tool router:
 * 'query' → ctx.runQuery, 'mutation' → ctx.runMutation, 'action' → ctx.runAction.
 * Action-backed tools can call other actions (needed for LLM categorization fallback).
 */
export type McpToolExecutor = 'query' | 'mutation' | 'action';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
  };
  executor: McpToolExecutor;
}

export type McpAmountMetadata = {
  currencyCode: string;
  minorUnit: number;
  amountEncoding: 'decimal_string';
};

export function resolveMcpAmountMetadata(currencyCode: string | undefined): McpAmountMetadata {
  const normalizedCurrencyCode = currencyCode?.toUpperCase() ?? 'USD';

  return {
    currencyCode: normalizedCurrencyCode,
    minorUnit: getCurrencyDecimals(normalizedCurrencyCode),
    amountEncoding: 'decimal_string',
  };
}

const CREATE_TRANSACTION_AMOUNT_SCHEMA = {
  type: 'string',
  pattern: '^-?\\d+(\\.\\d+)?$',
  description:
    'Required for single-movement regular rows and all transfer rows. Decimal string in the workspace currency, with at most `minorUnit` fractional digits. REGULAR: signed (negative for outflows/purchases, positive for inflows/deposits), cannot be 0. TRANSFER: positive only — the magnitude of the money moved from `fromAccountId` to `toAccountId`. Do not combine with `movements`.',
};

const CREATE_TRANSACTION_MOVEMENTS_SCHEMA = {
  type: 'array',
  minItems: 1,
  description:
    'Optional full movement array for regular split transactions. Use this instead of top-level `amount`/`categoryId`/`readyToAssign`. Each movement amount is signed; the movement amounts are summed to derive the transaction total and the total cannot be 0. A movement can have categoryId, readyToAssign=true, or neither. Neither means Uncategorized and is allowed even when other movements are categorized.',
  items: {
    type: 'object',
    properties: {
      amount: {
        type: 'string',
        pattern: '^-?\\d+(\\.\\d+)?$',
        description:
          'Required signed decimal string in the workspace currency. Cannot be 0. Split movement amounts should sum to the intended transaction total.',
      },
      categoryId: {
        type: 'string',
        description:
          'Optional category id from kualia_list_category_groups. Omit to leave this movement Uncategorized unless readyToAssign is true.',
      },
      readyToAssign: {
        type: 'boolean',
        description:
          'Optional. Set true for an income/Ready-to-Assign movement. Do not combine with categoryId on the same movement.',
      },
      notes: {
        type: 'string',
        description: 'Optional per-movement note.',
      },
    },
    required: ['amount'],
    additionalProperties: false,
  },
};

const MCP_TOOLS: ReadonlyArray<McpToolDefinition> = [
  {
    name: MCP_TOOL_LIST_WORKSPACES,
    description: 'List workspaces the authenticated user can access.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
    },
    executor: 'query',
  },
  {
    name: MCP_TOOL_EXPORT_WORKSPACE_DATA,
    description:
      'Create a downloadable ZIP export for a workspace. The archive contains CSV files for categories and targets, monthly plan data, bank accounts, and transactions. Credit-card category rows use the linked bank account name. Plan rows are ordered by year_month. Transactions use one row per movement: non-split transactions have one row, while split transactions repeat the transaction fields and share transaction_id with movement_index and movement_count columns. Ready-to-Assign movements use Ready to Assign as the category name. Returns a downloadUrl that expires after 24 hours.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
    },
    executor: 'action',
  },
  {
    name: MCP_TOOL_GET_ACCOUNT_BALANCES_REPORT,
    description:
      "Get account balance history report data for a workspace. Monetary values are decimal strings in the workspace currency, with the number of fractional digits given by `minorUnit` (USD=2 → '51.08' is 51.08; JPY=0 → '5108' is 5108; KWD=3 → '5.108' is 5.108); negative values keep their sign ('-200.00'). Response includes currency, currencyCode, minorUnit, and amountEncoding='decimal_string'. Read amounts as the value written — do NOT scale by 100 (or any other factor). In user-facing responses, format with the workspace's `currencyCode` (e.g. '$51.08' for USD, '¥5108' for JPY).",
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        monthsBack: {
          type: 'integer',
          minimum: 1,
          description: 'Optional number of months to return (must be positive).',
        },
        currentYearMonth: {
          type: 'string',
          pattern: '^[0-9]{6}$',
          description: 'Optional month in YYYYMM format. Defaults to current month in workspace timezone.',
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
    },
    executor: 'query',
  },
  {
    name: MCP_TOOL_GET_SPENDING_REPORT,
    description:
      "Get spending report data for a workspace. The categorySpending/groupSpending/merchantSpending sections contain gross outflows, while categoryIncome/groupIncome/merchantIncome contain gross inflows; an entity with activity in both directions appears in both sections, and netActivity remains available as metadata. Monetary values are decimal strings in the workspace currency, with the number of fractional digits given by `minorUnit` (USD=2 → '51.08' is 51.08; JPY=0 → '5108' is 5108; KWD=3 → '5.108' is 5.108); response includes currency, currencyCode, minorUnit, and amountEncoding='decimal_string'. Read amounts as the value written — do NOT scale by 100 (or any other factor). Use yearMonth for a single-month view (much smaller payload) or monthsBack for a range.",
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        yearMonth: {
          type: 'string',
          pattern: '^[0-9]{6}$',
          description:
            'Optional single month in YYYYMM format. Returns data for just this month. Cannot be used with monthsBack.',
        },
        monthsBack: {
          type: 'integer',
          minimum: 1,
          description: 'Optional number of months to return (must be positive). Cannot be used with yearMonth.',
        },
        currentYearMonth: {
          type: 'string',
          pattern: '^[0-9]{6}$',
          description:
            'Optional anchor month in YYYYMM format for monthsBack range. Defaults to current month in workspace timezone. Ignored when yearMonth is provided.',
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
    },
    executor: 'query',
  },
  {
    name: MCP_TOOL_LIST_CATEGORY_GROUPS,
    description: 'List category groups with nested categories for a workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
    },
    executor: 'query',
  },
  {
    name: MCP_TOOL_GET_ENVELOPE_MONTH_STATUS,
    description:
      "Get one month of envelope/category budget status. Omit filters for the full month, or pass exactly one of categoryId, categoryName, groupId, or groupName to return only that category/group. Name filters are exact after trimming and case-folding; use ids to disambiguate duplicate names. For assignment decisions, use target.remainingToAssign (primary) and target.underfundedAmount (shortfall signal). target.assignmentNeeded is the month's total requirement before subtracting what is already assigned. Do not infer assignment from long-horizon goal totals. Monetary values are decimal strings in the workspace currency, with the number of fractional digits given by `minorUnit` (USD=2 → '51.08' is 51.08; JPY=0 → '5108' is 5108; KWD=3 → '5.108' is 5.108); response includes currency, currencyCode, minorUnit, and amountEncoding='decimal_string'. Read amounts as the value written — do NOT scale by 100 (or any other factor). In user-facing responses, format with the workspace's `currencyCode` (e.g. '$51.08' for USD, '¥5108' for JPY).",
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        yearMonth: {
          type: 'string',
          pattern: '^[0-9]{6}$',
          description: 'Required month in YYYYMM format (for example, 202602).',
        },
        currentDate: {
          type: 'string',
          pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
          description: 'Required real-world current date in YYYY-MM-DD format from the user locale.',
        },
        categoryId: {
          type: 'string',
          description:
            'Optional category id filter. Pass at most one of categoryId, categoryName, groupId, or groupName.',
        },
        categoryName: {
          type: 'string',
          description:
            'Optional exact category name filter, matched after trimming and case-folding. Pass at most one filter.',
        },
        groupId: {
          type: 'string',
          description:
            'Optional category group id filter. Pass at most one of categoryId, categoryName, groupId, or groupName.',
        },
        groupName: {
          type: 'string',
          description:
            'Optional exact category group name filter, matched after trimming and case-folding. Pass at most one filter.',
        },
      },
      required: ['yearMonth', 'currentDate'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
    },
    executor: 'query',
  },
  {
    name: MCP_TOOL_SET_CATEGORY_ASSIGNED_AMOUNT,
    description:
      "Set the absolute assigned amount for one or more category-month pairs. This OVERWRITES the existing assignment — it is NOT a delta/increment. If the user says 'add 50 to a category that already has 100 assigned', pass assignedAmount='150' (the new total), not '50'. To move money between categories, you must compute and pass each destination's new total (current + delta) and each source's new total (current − delta). If you don't already know the current assignedAmount for a category-month from a recent kualia_get_envelope_month_status response, fetch it first — never assume it is zero. Call in single mode by passing categoryId + yearMonth + assignedAmount, OR in bulk mode by passing updates (an array of those triples). Do not mix modes — provide either the three single-mode fields or updates, never both. assignedAmount is a signed decimal string in the workspace currency, with at most `minorUnit` fractional digits (USD=2 → '200', '200.00', '51.08', '-25' are all valid; JPY=0 → only whole-number strings like '5108' are valid; KWD=3 → up to three fractional digits like '5.108'). Positive funds the category, negative defunds it / pulls money back to Ready to Assign.",
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        categoryId: {
          type: 'string',
          description: 'Single mode: category id from kualia_list_category_groups. Required when not using updates.',
        },
        yearMonth: {
          type: 'string',
          pattern: '^[0-9]{6}$',
          description: 'Single mode: month in YYYYMM format. Required when not using updates.',
        },
        assignedAmount: {
          type: 'string',
          pattern: '^-?\\d+(\\.\\d+)?$',
          description:
            "Single mode: the new absolute assigned amount as a signed decimal string in the workspace currency, with at most `minorUnit` fractional digits (USD=2 → '200', '200.00', '51.08', '-25'; JPY=0 → '5108'; KWD=3 → '5.108'). REPLACES the existing assignment — it is not a delta. To increase or decrease the assignment, read the current assignedAmount and pass current + delta. Required when not using updates. Positive funds the category, negative defunds it.",
        },
        updates: {
          type: 'array',
          minItems: 1,
          description:
            'Bulk mode: array of category-month assignments to apply. Use this OR the single-mode fields, not both.',
          items: {
            type: 'object',
            properties: {
              categoryId: {
                type: 'string',
                description: 'Required category id from kualia_list_category_groups.',
              },
              yearMonth: {
                type: 'string',
                pattern: '^[0-9]{6}$',
                description: 'Required month in YYYYMM format.',
              },
              assignedAmount: {
                type: 'string',
                pattern: '^-?\\d+(\\.\\d+)?$',
                description:
                  "The new absolute assigned amount for this category-month as a signed decimal string in the workspace currency, with at most `minorUnit` fractional digits (USD=2 → '200', '200.00', '51.08', '-25'; JPY=0 → '5108'; KWD=3 → '5.108'). REPLACES the existing assignment — it is not a delta. To add or subtract from the current assignment, pass current + delta (read the current value first if you don't know it).",
              },
            },
            required: ['categoryId', 'yearMonth', 'assignedAmount'],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
    },
    executor: 'mutation',
  },
  {
    name: MCP_TOOL_LIST_TRANSACTIONS,
    description:
      "List transactions for a single month. Each split transaction becomes multiple rows (one per movement). Monetary values are decimal strings in the workspace currency, with the number of fractional digits given by `minorUnit` (USD=2 → '51.08' is 51.08; JPY=0 → '5108' is 5108; KWD=3 → '5.108' is 5.108); response includes currency, currencyCode, minorUnit, and amountEncoding='decimal_string'. Read amounts as the value written — do NOT scale by 100 (or any other factor). In user-facing responses, format currency naturally. Each row includes a `url` pointing to that transaction's page in the web app — use it when linking the user to a specific transaction.",
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        yearMonth: {
          type: 'string',
          pattern: '^[0-9]{6}$',
          description: 'Required month in YYYYMM format (for example, 202604).',
        },
        accountId: {
          type: 'string',
          description: 'Optional bank account id to filter by.',
        },
        categoryId: {
          type: 'string',
          description: 'Optional category id to filter by (matches any movement).',
        },
        type: {
          type: 'string',
          enum: ['regular', 'transfer', 'starting_balance', 'balance_adjustment'],
          description: 'Optional transaction type filter.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 1000,
          description: 'Optional max number of rows to return (default 500, max 1000).',
        },
      },
      required: ['yearMonth'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
    },
    executor: 'query',
  },
  {
    name: MCP_TOOL_LIST_CATEGORY_TARGETS,
    description:
      "List category target definitions (goals and funding rules) for all categories that have targets enabled. Monetary values are decimal strings in the workspace currency, with the number of fractional digits given by `minorUnit` (USD=2 → '51.08' is 51.08; JPY=0 → '5108' is 5108; KWD=3 → '5.108' is 5.108); response includes currency, currencyCode, minorUnit, and amountEncoding='decimal_string'. Read amounts as the value written — do NOT scale by 100 (or any other factor).",
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
    },
    executor: 'query',
  },
  {
    name: MCP_TOOL_LIST_RECURRING_TRANSACTIONS,
    description:
      "List recurring transaction templates (subscriptions, bills, recurring income) with merchant names, expected amounts, and calculated next due dates. Monetary values are decimal strings in the workspace currency, with the number of fractional digits given by `minorUnit` (USD=2 → '51.08' is 51.08; JPY=0 → '5108' is 5108; KWD=3 → '5.108' is 5.108); response includes currency, currencyCode, minorUnit, and amountEncoding='decimal_string'. Read amounts as the value written — do NOT scale by 100 (or any other factor).",
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        status: {
          type: 'string',
          enum: ['active', 'inactive'],
          description: 'Optional status filter. Defaults to active.',
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
    },
    executor: 'query',
  },
  {
    name: MCP_TOOL_GET_INCOME_SUMMARY,
    description:
      "Get income/inflow summary for a month or range of months. Uses pre-aggregated workspace data (no transaction scanning). Monetary values are decimal strings in the workspace currency, with the number of fractional digits given by `minorUnit` (USD=2 → '51.08' is 51.08; JPY=0 → '5108' is 5108; KWD=3 → '5.108' is 5.108); response includes currency, currencyCode, minorUnit, and amountEncoding='decimal_string'. Read amounts as the value written — do NOT scale by 100 (or any other factor).",
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        yearMonth: {
          type: 'string',
          pattern: '^[0-9]{6}$',
          description: 'Optional single month in YYYYMM format. Cannot be used with monthsBack.',
        },
        monthsBack: {
          type: 'integer',
          minimum: 1,
          description: 'Optional number of months to return (default 1). Cannot be used with yearMonth.',
        },
        currentYearMonth: {
          type: 'string',
          pattern: '^[0-9]{6}$',
          description: 'Optional anchor month in YYYYMM format for monthsBack range. Defaults to current month.',
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
    },
    executor: 'query',
  },
  {
    name: MCP_TOOL_GET_CATEGORY_ROLLUP,
    description:
      "Get multi-month category rollup showing total assigned, total inflow, and total outflow per category. Uses pre-aggregated data (no transaction scanning). Monetary values are decimal strings in the workspace currency, with the number of fractional digits given by `minorUnit` (USD=2 → '51.08' is 51.08; JPY=0 → '5108' is 5108; KWD=3 → '5.108' is 5.108); response includes currency, currencyCode, minorUnit, and amountEncoding='decimal_string'. Read amounts as the value written — do NOT scale by 100 (or any other factor).",
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        monthsBack: {
          type: 'integer',
          minimum: 1,
          maximum: 24,
          description: 'Optional number of months to roll up (default 6, max 24).',
        },
        currentYearMonth: {
          type: 'string',
          pattern: '^[0-9]{6}$',
          description: 'Optional anchor month in YYYYMM format. Defaults to current month.',
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
    },
    executor: 'query',
  },
  {
    name: MCP_TOOL_GET_MONTHLY_SUMMARY,
    description:
      "Get a clean per-month income / spending / savings summary, with per-category and per-category-group spending breakdowns. Use this for ANY question about how much the user spent, how much they saved, savings rate, or category-level spend totals — DO NOT compute these yourself from kualia_get_spending_report or kualia_get_income_summary, whose broader activity fields can include credit-card and loan transfer mechanics. 'spending' here is gross outflow on real expense categories only (excludes credit-card, credit-card-payment, loan-payment, and income-side categories), plus uncategorized outflow — matching what users see as 'spending' in the app. 'income' is gross inflow into Ready to Assign for the month. 'savings' is income − spending. 'savingsRate' is a percent (0–100) rounded to one decimal. Monetary values are decimal strings in the workspace currency, with the number of fractional digits given by `minorUnit` (USD=2 → '51.08' is 51.08; JPY=0 → '5108' is 5108; KWD=3 → '5.108' is 5.108); response includes currency, currencyCode, minorUnit, and amountEncoding='decimal_string'. Read amounts as the value written — do NOT scale by 100 (or any other factor). In user-facing responses, format currency naturally.",
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        yearMonth: {
          type: 'string',
          pattern: '^[0-9]{6}$',
          description: 'Optional single month in YYYYMM format. Cannot be used with monthsBack.',
        },
        monthsBack: {
          type: 'integer',
          minimum: 1,
          maximum: 24,
          description: 'Optional number of months to return (default 6, max 24). Cannot be used with yearMonth.',
        },
        currentYearMonth: {
          type: 'string',
          pattern: '^[0-9]{6}$',
          description:
            'Optional anchor month in YYYYMM format for the monthsBack range. Defaults to current month in workspace timezone. Ignored when yearMonth is provided.',
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
    },
    executor: 'query',
  },
  {
    name: MCP_TOOL_LIST_BANK_ACCOUNTS,
    description:
      "List bank accounts in a workspace. Returns each account's id, display name, accountType (e.g. banking_checking, credit_credit_card), isOnBudget flag, currency, currentBalance, and isClosed flag. `isOnBudget` is true for `banking_*` and `credit_*` accounts — they are part of the envelope budget, so their inflows hit Ready-to-Assign and their outflows draw from category envelopes. `isOnBudget` is false for `investment_*` and `loan_*` accounts — they are tracked for net-worth purposes only and do not interact with the budget. Use this to decide whether a transfer crosses the budget boundary: when one side is on-budget and the other off-budget, a category is recommended on the on-budget side (see kualia_create_transactions). Monetary values are decimal strings in the workspace currency, with the number of fractional digits given by `minorUnit` (USD=2 → '51.08' is 51.08; JPY=0 → '5108' is 5108; KWD=3 → '5.108' is 5.108); negative values keep their sign. Response includes currency, currencyCode, minorUnit, and amountEncoding='decimal_string'. Read amounts as the value written — do NOT scale by 100 (or any other factor). Use this before calling kualia_create_transactions so the user can pick which account to import into.",
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        includeClosed: {
          type: 'boolean',
          description: 'Optional. When true, also returns closed accounts. Defaults to false.',
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
    },
    executor: 'query',
  },
  {
    name: MCP_TOOL_RECONCILE_BANK_ACCOUNT,
    description:
      "Reconcile a bank account to a bank-statement balance, matching the app's manual reconcile flow. Requires the explicit `reconciliationDate`; do not omit it or invent one when the user has not supplied or confirmed the date. The server compares `reportedBalance` against the account's cleared balance, creates a `balance_adjustment` transaction dated `reconciliationDate` only when the difference is non-zero, marks reviewed + cleared transactions as reconciled, and records the reconciliation timestamp. `reportedBalance` is the final bank-statement balance, not the adjustment delta. Monetary values are decimal strings in the workspace currency with at most `minorUnit` fractional digits (USD=2 → '51.08'; JPY=0 → '5108'; KWD=3 → '5.108'); negative values keep their sign.",
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        bankAccountId: {
          type: 'string',
          description: 'Required bank account id from kualia_list_bank_accounts.',
        },
        reportedBalance: {
          type: 'string',
          pattern: '^-?\\d+(\\.\\d+)?$',
          description:
            "Required final balance from the bank statement as a decimal string in the workspace currency. This is not the adjustment delta; the server computes the balance adjustment amount from the account's current cleared balance.",
        },
        reconciliationDate: {
          type: 'string',
          pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
          description:
            'Required statement/reconciliation date in YYYY-MM-DD. This exact date is used for the balance adjustment transaction when one is created.',
        },
      },
      required: ['bankAccountId', 'reportedBalance', 'reconciliationDate'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
    },
    executor: 'mutation',
  },
  {
    name: MCP_TOOL_CREATE_BANK_ACCOUNT,
    description:
      "Create a new manual bank account in the workspace and return its id plus display fields. This creates a manual (unlinked) account only — it never connects to Plaid or Apple Wallet. Provide a `name` and an `accountType` from the supported enum. `accountType` prefixes determine budget behavior: `banking_*` and `credit_*` are on-budget (part of the envelope budget); `investment_*` and `loan_*` are off-budget (net-worth tracking only). Creating a `credit_*` account also auto-creates its linked credit-card payment category. Optionally set an opening balance with `initialBalance` (a signed decimal string in the workspace currency — e.g. '1500.00', or negative like '-500.00' for a credit-card balance owed) together with `initialBalanceDate` (YYYY-MM-DD); if you pass one you must pass both, and a starting-balance transaction is created on that date. Monetary values are decimal strings with at most `minorUnit` fractional digits (USD=2 → '1500.00'; JPY=0 → '1500'; KWD=3 → '1.500').",
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        name: {
          type: 'string',
          description: 'Required display name for the account.',
        },
        accountType: {
          type: 'string',
          enum: [
            'banking_checking',
            'banking_savings',
            'banking_cash',
            'banking_cash_management',
            'banking_money_market',
            'banking_cd',
            'banking_other',
            'credit_credit_card',
            'credit_line_of_credit',
            'credit_other',
            'investment_brokerage',
            'investment_401k',
            'investment_ira',
            'investment_keogh',
            'investment_roth_ira',
            'investment_roth_401k',
            'investment_hsa',
            'investment_sep_ira',
            'investment_simple_ira',
            'investment_529_plan',
            'investment_403b',
            'investment_other',
            'loan_auto',
            'loan_business',
            'loan_commercial',
            'loan_construction',
            'loan_home_equity',
            'loan_mortgage',
            'loan_student',
            'loan_other',
          ],
          description:
            'Required account type. `banking_*`/`credit_*` are on-budget; `investment_*`/`loan_*` are off-budget.',
        },
        initialBalance: {
          type: 'string',
          pattern: '^-?\\d+(\\.\\d+)?$',
          description:
            'Optional opening balance as a signed decimal string in the workspace currency. Requires `initialBalanceDate`. Defaults to 0 when omitted.',
        },
        initialBalanceDate: {
          type: 'string',
          pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
          description: 'Opening-balance date in YYYY-MM-DD. Required when `initialBalance` is provided.',
        },
      },
      required: ['name', 'accountType'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
    },
    executor: 'mutation',
  },
  {
    name: MCP_TOOL_CLOSE_BANK_ACCOUNT,
    description:
      'Close a bank account (non-destructive). Closing reconciles the account (marks reviewed + cleared transactions as reconciled), sets it to closed, and disconnects any external link, while keeping all transactions intact for history. Use this instead of delete when the account has transactions you want to keep. A closed account can be reopened later in the app. Pass the `bankAccountId` from kualia_list_bank_accounts.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        bankAccountId: {
          type: 'string',
          description: 'Required bank account id from kualia_list_bank_accounts.',
        },
      },
      required: ['bankAccountId'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
    },
    executor: 'mutation',
  },
  {
    name: MCP_TOOL_DELETE_BANK_ACCOUNT,
    description:
      'Delete a bank account. This only succeeds when the account has NO non-deleted transactions — if any transactions exist, the tool refuses with an error and you should close the account instead (kualia_close_bank_account), which preserves history. Deleting also removes the auto-created credit-card category for a credit account. Pass the `bankAccountId` from kualia_list_bank_accounts.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        bankAccountId: {
          type: 'string',
          description: 'Required bank account id from kualia_list_bank_accounts.',
        },
      },
      required: ['bankAccountId'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
    },
    executor: 'mutation',
  },
  {
    name: MCP_TOOL_CREATE_TRANSACTIONS,
    description:
      "Create one or more transactions in a single call. Each row in `transactions` is either a regular transaction or a transfer; pick the shape based on the row's `type` field (defaults to 'regular'). Returns three arrays: `created` (with `kind: 'regular' | 'transfer'` per row plus the inserted id(s), inputIndex, and a `url` for regular rows or `fromUrl`/`toUrl` for transfer rows — use these when linking the user to a specific transaction), `skipped` (only regular rows can be deduped — each carries `reason` and `matchedTransactionId`), and `failed` (validation errors keyed by inputIndex). Monetary amounts are decimal strings in the workspace currency with at most `minorUnit` fractional digits (USD=2 → '-51.08' or '200'; JPY=0 → '-5108'; KWD=3 → '-5.108').\n\nREGULAR rows (`type: 'regular'`, default): require `merchantName`; `date` is optional and defaults to today in the workspace timezone. For a single-movement row, pass `amount` (signed — negative for outflows/purchases, positive for inflows/deposits, cannot be 0) and optional `categoryId`; for income that should go directly to Ready to Assign, pass `readyToAssign: true` instead of `categoryId`. When both `categoryId` and `readyToAssign` are omitted on the shortcut form, the server applies user rules → history → LLM categorization. For a split / multi-category row, pass `movements` instead of `amount`/`categoryId`/`readyToAssign`; each movement needs a signed `amount` and can include `categoryId`, `readyToAssign: true`, or neither. A movement with neither `categoryId` nor `readyToAssign` is intentionally Uncategorized, and a split may mix categorized, Ready-to-Assign, and Uncategorized movements. Explicit `movements` are persisted as provided and are not auto-categorized. The row's `bankAccountId` defaults to the top-level `bankAccountId`. Regular rows are flagged `needs_review` and are deduped against existing transactions on the same bank account; pass top-level `forceInsert: true` to bypass dedup after user confirmation.\n\nTRANSFER rows (`type: 'transfer'`): require `fromAccountId`, `toAccountId` (must differ), and a POSITIVE `amount` representing the money moved; `date` is optional and defaults to today in the workspace timezone. Do NOT pass `merchantName` or `movements` (transfers have no merchant and are created as a linked pair). Transfers are not deduped and are inserted as `reviewed`. Optional `notes`. Optional `categoryId` — see rules below. The server creates the linked pair automatically; the `created` entry returns both `fromTransactionId` and `toTransactionId`.\n\nACCOUNT-TYPE RULES (use kualia_list_bank_accounts to check `isOnBudget`):\n• ON-BUDGET accounts: `banking_*` and `credit_*` — they are part of the envelope budget.\n• OFF-BUDGET accounts: `investment_*` and `loan_*` — tracked for net worth only; do not interact with the budget.\n\nCATEGORY RULES FOR TRANSFERS:\n• On-budget ↔ on-budget (e.g. checking → savings): OMIT `categoryId`. The transfer has no category on either side.\n• Off-budget ↔ off-budget (e.g. brokerage → 401k): OMIT `categoryId`. No category on either side.\n• CROSS-BUDGET (one on-budget, one off-budget — e.g. checking → brokerage): `categoryId` is RECOMMENDED. The server places it on the on-budget side's movement automatically. If you omit `categoryId` for a cross-budget transfer, the on-budget side will be Uncategorized and will appear in the user's needs-categorization queue.",
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        bankAccountId: {
          type: 'string',
          description:
            "Default bank account id for any `type: 'regular'` rows that don't specify their own. Required when the batch contains at least one regular row.",
        },
        forceInsert: {
          type: 'boolean',
          description:
            'Optional. When true, bypass duplicate detection and insert every regular row as-is. Has no effect on transfer rows (which are never deduped). Use this only after the user has confirmed they want to re-import rows the server previously flagged as duplicates.',
        },
        transactions: {
          type: 'array',
          minItems: 1,
          maxItems: 200,
          description: 'List of transactions to create (max 200 per call). Mix regular and transfer rows freely.',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['regular', 'transfer'],
                description: "Optional. Defaults to 'regular'. Use 'transfer' for movement between two accounts.",
              },
              date: {
                type: 'string',
                pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
                description:
                  'Optional transaction date in YYYY-MM-DD. If omitted, defaults to today in the workspace\'s timezone — use this whenever the user says "today" or doesn\'t specify a date. Do NOT guess the date yourself; let the server resolve it so the timezone is right.',
              },
              amount: CREATE_TRANSACTION_AMOUNT_SCHEMA,
              merchantName: {
                type: 'string',
                description:
                  'Required for regular rows; the merchant or payee name as it should display. MUST be omitted for transfer rows (transfers have no merchant).',
              },
              bankAccountId: {
                type: 'string',
                description:
                  'Optional override for regular rows; if omitted, falls back to the top-level `bankAccountId`. Ignored for transfer rows.',
              },
              fromAccountId: {
                type: 'string',
                description:
                  'Required for transfer rows: the account the money leaves. Must differ from `toAccountId`. Ignored for regular rows.',
              },
              toAccountId: {
                type: 'string',
                description:
                  'Required for transfer rows: the account the money arrives in. Must differ from `fromAccountId`. Ignored for regular rows.',
              },
              categoryId: {
                type: 'string',
                description:
                  'Optional. REGULAR shortcut: a category id from kualia_list_category_groups; omit to let the server pick via rules → history → LLM. Do not combine with `movements`. TRANSFER: omit for on-budget↔on-budget and off-budget↔off-budget transfers (no category applies). For CROSS-BUDGET transfers (one on-budget, one off-budget) a categoryId is RECOMMENDED — the server places it on the on-budget side. Omitting it on a cross-budget transfer leaves the on-budget side Uncategorized.',
              },
              readyToAssign: {
                type: 'boolean',
                description:
                  'Optional REGULAR shortcut. Set true for income that should go directly to Ready to Assign. Do not combine with `categoryId` or `movements`; the created movement will have no category.',
              },
              movements: CREATE_TRANSACTION_MOVEMENTS_SCHEMA,
              notes: {
                type: 'string',
                description: 'Optional free-form note for the transaction.',
              },
            },
            // Gemini requires each branch to define its own object type and required properties.
            anyOf: [
              {
                type: 'object',
                properties: { amount: CREATE_TRANSACTION_AMOUNT_SCHEMA },
                required: ['amount'],
              },
              {
                type: 'object',
                properties: { movements: CREATE_TRANSACTION_MOVEMENTS_SCHEMA },
                required: ['movements'],
              },
            ],
            additionalProperties: false,
          },
        },
      },
      required: ['transactions'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
    },
    executor: 'action',
  },
  {
    name: MCP_TOOL_UPDATE_TRANSACTIONS,
    description:
      "Update one or more existing transactions in a single call. Pass an `updates` array; each entry must include `transactionId` plus any fields you want to change. Omitted fields are left unchanged. The server applies all side effects (envelope balances, Ready-to-Assign, account balance, merchant suggestions) the same way the in-app editor does. Per-row failures do not abort the batch. Returns `updated` (an array of `{ transactionId, url }` for each transaction that was patched — use the url when linking the user to a specific transaction), `notFound` (ids that don't exist, are deleted, or don't belong to the workspace), and `failed` (rows that errored mid-update, each with `message`).\n\nFIELDS:\n• `date` (YYYY-MM-DD).\n• `amount` (REGULAR only, shortcut): when present, rewrites the single movement's amount. Signed decimal in workspace currency with at most `minorUnit` fractional digits. Cannot be 0. Reject the row if you pass both `amount` and `movements`.\n• `categoryId` (REGULAR only, shortcut): rewrites the single movement's category. Reject the row if you pass both `categoryId` and `movements`.\n• `movements`: full replacement of the movement array for split / multi-category transactions. Each entry needs `amount` (signed decimal) and optional `categoryId` + `notes`.\n• `merchantName`: REGULAR only. Lookup-or-create a merchant by name; pass null to clear. Ignored on transfer rows (transfers have no merchant).\n• `notes`: pass a string to set, null to clear.\n• `bankAccountId`: move a REGULAR transaction to a different account.\n• `fromAccountId` / `toAccountId`: TRANSFER only. Change one or both sides of the pair. The server reverses direction if you pass the amount with the opposite sign.\n• `status`: 'pending' or 'cleared'. Reconciled transactions cannot be re-set via this tool.\n• `reviewStatus`: 'reviewed' or 'needs_review'.\n• `type`: 'regular' or 'transfer' to convert. Converting to transfer requires `toAccountId`. Converting from transfer back to regular drops the paired side (or reverts it to regular if it was an imported counterpart).\n\nTRANSFER CATEGORY RULES are the same as for `kualia_create_transactions`: cross-budget transfers (one on-budget, one off-budget) accept a `categoryId` that the server places on the on-budget side; pure on-budget↔on-budget and off-budget↔off-budget transfers do not use a category. Check `isOnBudget` via kualia_list_bank_accounts before deciding.",
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        updates: {
          type: 'array',
          minItems: 1,
          maxItems: 200,
          description: 'List of transactions to update (max 200 per call).',
          items: {
            type: 'object',
            properties: {
              transactionId: {
                type: 'string',
                description: 'Required transaction id (from kualia_list_transactions).',
              },
              type: {
                type: 'string',
                enum: ['regular', 'transfer'],
                description: 'Optional. Convert the transaction type. Converting to transfer requires `toAccountId`.',
              },
              date: {
                type: 'string',
                pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
                description: 'Optional new transaction date in YYYY-MM-DD.',
              },
              amount: {
                type: 'string',
                pattern: '^-?\\d+(\\.\\d+)?$',
                description:
                  "Optional shortcut for single-movement transactions: signed decimal string in workspace currency (cannot be 0). Rewrites that movement's amount. Do not combine with `movements`.",
              },
              merchantName: {
                type: ['string', 'null'],
                description:
                  'Optional. New merchant name (lookup-or-create). Pass null to clear. Ignored for transfer rows.',
              },
              notes: {
                type: ['string', 'null'],
                description: 'Optional. Pass null to clear, a string to set.',
              },
              categoryId: {
                type: 'string',
                description:
                  "Optional shortcut for single-movement transactions: rewrites that movement's categoryId. Do not combine with `movements`. For cross-budget transfers, the server places this on the on-budget side automatically.",
              },
              movements: {
                type: 'array',
                minItems: 1,
                description:
                  'Optional full override of the movement array. Use for splits / multi-category. Each entry: amount (signed decimal) + optional categoryId + optional notes.',
                items: {
                  type: 'object',
                  properties: {
                    amount: {
                      type: 'string',
                      pattern: '^-?\\d+(\\.\\d+)?$',
                      description: 'Signed decimal string in the workspace currency.',
                    },
                    categoryId: {
                      type: 'string',
                      description: 'Optional category id from kualia_list_category_groups.',
                    },
                    notes: {
                      type: 'string',
                      description: 'Optional per-movement note.',
                    },
                  },
                  required: ['amount'],
                  additionalProperties: false,
                },
              },
              bankAccountId: {
                type: 'string',
                description: 'Optional. Move a regular transaction to a different account.',
              },
              fromAccountId: {
                type: 'string',
                description: 'Optional. For transfer transactions, change the source account.',
              },
              toAccountId: {
                type: 'string',
                description:
                  'Optional. For transfer transactions, change the destination account. Required when converting a regular transaction to a transfer via `type: "transfer"`.',
              },
              status: {
                type: 'string',
                enum: ['pending', 'cleared'],
                description: 'Optional status update.',
              },
              reviewStatus: {
                type: 'string',
                enum: ['reviewed', 'needs_review'],
                description: 'Optional review-status update.',
              },
            },
            required: ['transactionId'],
            additionalProperties: false,
          },
        },
      },
      required: ['updates'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
    },
    executor: 'mutation',
  },
  {
    name: MCP_TOOL_DELETE_TRANSACTIONS,
    description:
      'Soft-delete one or more transactions by id. Reverses balance and budget side effects. For transfers, the paired transaction is also deleted. Returns the ids that were deleted and the ids that were not found (or already deleted) so the caller can confirm.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        transactionIds: {
          type: 'array',
          minItems: 1,
          maxItems: 200,
          description: 'Transaction ids to delete (max 200 per call).',
          items: {
            type: 'string',
          },
        },
      },
      required: ['transactionIds'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
    },
    executor: 'mutation',
  },
  {
    name: MCP_TOOL_RESTORE_TRANSACTIONS,
    description:
      'Restore one or more soft-deleted transactions by id (undelete). Re-applies balance and budget side effects. For transfers, the paired transaction is also restored. Returns the ids that were restored and the ids that were not found (or were not deleted to begin with) so the caller can confirm.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        transactionIds: {
          type: 'array',
          minItems: 1,
          maxItems: 200,
          description: 'Transaction ids to restore (max 200 per call).',
          items: {
            type: 'string',
          },
        },
      },
      required: ['transactionIds'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
    },
    executor: 'mutation',
  },
  {
    name: MCP_TOOL_CREATE_CATEGORIES,
    description:
      'Create one or more categories (envelopes) in a workspace. Each row needs a name and an existing categoryGroupId (from kualia_list_category_groups). Returns `created` (per-row { inputIndex, categoryId, name }) and `failed` (per-row { inputIndex, code, message }). One bad row does not abort the batch — duplicate names, unknown group ids, or system-group conflicts come back as per-row failures.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        categories: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          description: 'List of categories to create (max 50 per call).',
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Category display name. Must be unique within the workspace.',
              },
              categoryGroupId: {
                type: 'string',
                description: 'Required category group id from kualia_list_category_groups.',
              },
              iconName: {
                type: 'string',
                description: "Optional icon name (matches the web app's icon set).",
              },
            },
            required: ['name', 'categoryGroupId'],
            additionalProperties: false,
          },
        },
      },
      required: ['categories'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
    },
    executor: 'mutation',
  },
  {
    name: MCP_TOOL_UPDATE_CATEGORIES,
    description:
      "Update one or more existing categories. Pass `updates` — each entry must include `categoryId` plus any fields to change. Omitted fields are left unchanged. Use kualia_archive_categories for archive/unarchive and kualia_reorder_categories for sort changes — those are not exposed here. Returns `updated` (ids that were patched), `notFound` (ids that don't exist or don't belong to the workspace), and `failed` (per-row errors).",
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        updates: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          description: 'List of category updates (max 50 per call).',
          items: {
            type: 'object',
            properties: {
              categoryId: {
                type: 'string',
                description: 'Required category id from kualia_list_category_groups.',
              },
              name: {
                type: 'string',
                description: 'Optional new name. Must be unique within the workspace.',
              },
              categoryGroupId: {
                type: 'string',
                description:
                  'Optional new category group id. For arbitrary reordering across groups use kualia_reorder_categories instead — it places multiple categories at specific positions in one call.',
              },
              iconName: {
                type: 'string',
                description: 'Optional new icon name.',
              },
            },
            required: ['categoryId'],
            additionalProperties: false,
          },
        },
      },
      required: ['updates'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
    },
    executor: 'mutation',
  },
  {
    name: MCP_TOOL_ARCHIVE_CATEGORIES,
    description:
      'Archive OR unarchive (restore) categories in bulk — this is the tool for both directions. Set `isArchived: true` to archive the given `categoryIds`, or `isArchived: false` to unarchive/restore them. Archived categories hide from the active envelope list but keep their history, so to unarchive: call `kualia_list_category_groups` (it returns archived categories too, each flagged `isArchived: true`), collect the ids you want back, then call this with `isArchived: false`. Rejects system and credit-card categories. The mutation is all-or-nothing per call — if any id fails validation, none are patched.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        categoryIds: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          description: 'Category ids to archive or unarchive (max 50 per call).',
          items: { type: 'string' },
        },
        isArchived: {
          type: 'boolean',
          description: 'Set true to archive the categories, false to unarchive/restore them.',
        },
      },
      required: ['categoryIds', 'isArchived'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
    },
    executor: 'mutation',
  },
  {
    name: MCP_TOOL_DELETE_CATEGORIES,
    description:
      'Delete categories in bulk, optionally moving their transactions to another category first. If any target category has transactions assigned, `newCategoryId` is required — the tool will refuse the delete otherwise (it never silently drops transactions). When `newCategoryId` is provided, all matching transaction movements are re-categorized to that category before the originals are soft-deleted; assigned budget funds are released back to Ready-to-Assign. Rejects system and credit-card categories. `newCategoryId` cannot be one of the categories being deleted. For very large deletions (>500 affected transactions) the work is processed asynchronously in the background and the response reports `isAsync: true`.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        categoryIds: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          description: 'Category ids to delete (max 50 per call).',
          items: { type: 'string' },
        },
        newCategoryId: {
          type: 'string',
          description:
            'Optional category id to move all transactions from the deleted categories into. Required if any category being deleted has transactions assigned. Must not be one of `categoryIds`.',
        },
      },
      required: ['categoryIds'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
    },
    executor: 'mutation',
  },
  {
    name: MCP_TOOL_REORDER_CATEGORIES,
    description:
      "Bulk-reorder categories in one call. Pass `groups`: an array where each entry is `{ categoryGroupId, orderedCategoryIds: [...] }` listing the desired top-to-bottom order of categories within that group. Use this for any rearrangement — alphabetizing a group, reordering a few categories, or moving categories across groups — instead of calling a single-item reorder per move.\n\nSEMANTICS:\n• Within each listed group, the categories in `orderedCategoryIds` are placed at positions 0, 1, 2, ... in that order.\n• Any category in `orderedCategoryIds` whose current group differs is MOVED into the listed group (cross-group move) at its position.\n• Categories that already live in a listed group but are NOT in its `orderedCategoryIds` keep their relative order and are appended after the listed ones.\n• Groups not present in the `groups` array are left untouched.\n• A categoryId may appear in at most one group's `orderedCategoryIds` per call.\n\nRejects system, credit-card-into-non-credit-card, non-credit-card-into-credit-card, and archived categories. The mutation is all-or-nothing — if any validation fails, no rows are patched. Returns `{ workspaceId, updatedCount }`.",
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        groups: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          description: 'List of per-group orderings to apply. Each entry rewrites the order of one group.',
          items: {
            type: 'object',
            properties: {
              categoryGroupId: {
                type: 'string',
                description: 'Required category group id.',
              },
              orderedCategoryIds: {
                type: 'array',
                minItems: 1,
                description:
                  'Top-to-bottom order of categories in this group. Categories whose current group differs are moved into this group.',
                items: { type: 'string' },
              },
            },
            required: ['categoryGroupId', 'orderedCategoryIds'],
            additionalProperties: false,
          },
        },
      },
      required: ['groups'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
    },
    executor: 'mutation',
  },
  {
    name: MCP_TOOL_SORT_CATEGORIES,
    description:
      "Server-side sort of categories within one group (or every group when `categoryGroupId` is omitted). USE THIS instead of `kualia_reorder_categories` whenever the user asks for a known sort order — alphabetical, by target due date, by creation time. The server reads the categories, computes the order, and renumbers in one mutation, so the LLM never has to enumerate ids.\n\nSORT MODES:\n• `name_asc` / `name_desc` — alphabetical by name (case-insensitive).\n• `target_due_date_asc` / `target_due_date_desc` — by the category target's due date (`targetDate` for one_time and maintain_balance, `firstDueDate` for recurring / recurring_rollover). Categories with no target (or no associated date) sort to the bottom regardless of direction; ties break alphabetically.\n• `created_asc` / `created_desc` — by creation time.\n\nSystem and archived categories are left in place. Returns `{ workspaceId, sortedGroupCount, updatedCount }`.",
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        categoryGroupId: {
          type: 'string',
          description:
            'Optional. When provided, only sorts within this group. Omit to sort every group in the workspace.',
        },
        sortBy: {
          type: 'string',
          enum: ['name_asc', 'name_desc', 'target_due_date_asc', 'target_due_date_desc', 'created_asc', 'created_desc'],
          description: 'How to order the categories.',
        },
      },
      required: ['sortBy'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
    },
    executor: 'mutation',
  },
  {
    name: MCP_TOOL_CREATE_CATEGORY_GROUPS,
    description:
      "Create one or more category groups. Each row needs `name` and `type` ('expense' for regular envelope groups; 'credit_card' is reserved — only one credit-card group per workspace, and it's normally created automatically when a credit card account is linked). Returns `created` (per-row { inputIndex, categoryGroupId, name }) and `failed` (per-row errors — duplicate names, second credit-card group, etc.).",
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        groups: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          description: 'List of category groups to create (max 10 per call).',
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Group display name. Must be unique within the workspace.',
              },
              type: {
                type: 'string',
                enum: ['expense', 'credit_card'],
                description: "Group type. Use 'expense' for normal envelope groups.",
              },
            },
            required: ['name', 'type'],
            additionalProperties: false,
          },
        },
      },
      required: ['groups'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
    },
    executor: 'mutation',
  },
  {
    name: MCP_TOOL_UPDATE_CATEGORY_GROUPS,
    description:
      "Update one or more category groups. Pass `updates` — each entry must include `categoryGroupId`. Only the `name` and `type` ('expense') fields are mutable. Credit-card groups cannot change type. Type can only change if the group has no categories. Returns `updated`, `notFound`, and `failed`.",
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        updates: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          description: 'List of category group updates (max 10 per call).',
          items: {
            type: 'object',
            properties: {
              categoryGroupId: {
                type: 'string',
                description: 'Required category group id.',
              },
              name: {
                type: 'string',
                description: 'Optional new name.',
              },
              type: {
                type: 'string',
                enum: ['expense'],
                description:
                  "Optional. Only 'expense' is accepted — credit_card groups cannot be converted and expense groups can only be reaffirmed as expense.",
              },
            },
            required: ['categoryGroupId'],
            additionalProperties: false,
          },
        },
      },
      required: ['updates'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
    },
    executor: 'mutation',
  },
  {
    name: MCP_TOOL_ARCHIVE_CATEGORY_GROUPS,
    description:
      'Archive (soft-delete) or unarchive (restore) category groups in bulk. Pass `categoryGroupIds` plus `isArchived: true` to archive, `false` to unarchive. Archiving a group is only allowed when the group contains no non-deleted categories — archive or move its categories first. Credit-card groups cannot be archived. Returns per-row `archived` / `restored` and per-row `failed` entries with a reason.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        categoryGroupIds: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          description: 'Category group ids to archive or unarchive (max 10 per call).',
          items: { type: 'string' },
        },
        isArchived: {
          type: 'boolean',
          description: 'true to archive (soft-delete), false to unarchive (restore).',
        },
      },
      required: ['categoryGroupIds', 'isArchived'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
    },
    executor: 'mutation',
  },
  {
    name: MCP_TOOL_REORDER_CATEGORY_GROUPS,
    description:
      'Bulk-reorder category groups in one call. Pass `orderedCategoryGroupIds`: the desired top-to-bottom order of groups in the workspace. Use this for any group reordering instead of calling a single-item reorder per move.\n\nSEMANTICS:\n• Listed groups are placed at positions 0, 1, 2, ... in the order given.\n• Any non-deleted groups not in the list keep their relative order and are appended after the listed ones.\n• Each id may appear at most once.\n\nReturns `{ workspaceId, updatedCount }`.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        orderedCategoryGroupIds: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          description: 'Top-to-bottom order of category groups in the workspace.',
          items: { type: 'string' },
        },
      },
      required: ['orderedCategoryGroupIds'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
    },
    executor: 'mutation',
  },
  {
    name: MCP_TOOL_SORT_CATEGORY_GROUPS,
    description:
      "Server-side sort of the workspace's category groups. USE THIS instead of `kualia_reorder_category_groups` whenever the user asks for a known sort order (alphabetical or by creation time). The server reads the groups, computes the order, and renumbers in one mutation, so the LLM never has to enumerate ids.\n\nSORT MODES:\n• `name_asc` / `name_desc` — alphabetical by name (case-insensitive).\n• `created_asc` / `created_desc` — by creation time.\n\nReturns `{ workspaceId, updatedCount }`.",
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        sortBy: {
          type: 'string',
          enum: ['name_asc', 'name_desc', 'created_asc', 'created_desc'],
          description: 'How to order the groups.',
        },
      },
      required: ['sortBy'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
    },
    executor: 'mutation',
  },
  {
    name: MCP_TOOL_CREATE_CATEGORY_TARGET,
    description:
      "Create a monthly target / funding goal on a category that does NOT already have one. (Use kualia_update_category_target to modify an existing target; use kualia_delete_category_target to disable one.) Monetary amounts (`amount`, `monthlyContribution`, `targetBalance`) are decimal strings in the workspace currency with at most `minorUnit` fractional digits (USD=2 → '200' or '200.00'; JPY=0 → '5108'; KWD=3 → '5.108'). Target types:\n• `recurring` — fund this amount every `frequency` (e.g. $200 monthly). Requires `frequency` + `frequencyInterval`. Optional `firstDueDate` (defaults to the 1st of the current month).\n• `recurring_rollover` — like recurring, but unspent funds carry over. Same fields as recurring.\n• `maintain_balance` — keep a running balance (e.g. $1000 emergency fund). Requires `monthlyContribution`. `amount` is the target balance.\n• `one_time` — save up to `targetDate` (must be in the future). Requires `targetDate`. No frequency.\nCredit-card categories cannot have targets.",
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        categoryId: {
          type: 'string',
          description: 'Required category id (must not already have a target).',
        },
        targetType: {
          type: 'string',
          enum: ['recurring', 'recurring_rollover', 'maintain_balance', 'one_time'],
          description: 'Required target type.',
        },
        amount: {
          type: 'string',
          pattern: '^-?\\d+(\\.\\d+)?$',
          description:
            'Required decimal string in workspace currency. For recurring/recurring_rollover: amount per occurrence. For maintain_balance: target balance. For one_time: total goal.',
        },
        frequency: {
          type: 'string',
          enum: ['daily', 'weekly', 'monthly', 'yearly'],
          description: 'Required for recurring / recurring_rollover / maintain_balance targets.',
        },
        frequencyInterval: {
          type: 'integer',
          minimum: 1,
          description: "Required for non-one_time targets. e.g. 2 with frequency='weekly' means every 2 weeks.",
        },
        dayOfWeek: {
          type: 'integer',
          minimum: 0,
          maximum: 6,
          description: 'Required when frequency is weekly. 0=Sunday … 6=Saturday.',
        },
        dueDay: {
          type: 'integer',
          description: 'Optional. 1–31 for a specific day of the month, or -1 for the last day. Informational only.',
        },
        firstDueDate: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description:
            'Optional ISO date (YYYY-MM-DD). For recurring / recurring_rollover, defaults to the first day of the current month.',
        },
        targetDate: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description: 'Required for one_time targets. Must be in the future.',
        },
        monthlyContribution: {
          type: 'string',
          pattern: '^-?\\d+(\\.\\d+)?$',
          description: 'Required for maintain_balance targets. Decimal string in workspace currency.',
        },
        targetBalance: {
          type: 'string',
          pattern: '^-?\\d+(\\.\\d+)?$',
          description: 'Optional decimal string in workspace currency (synonym of amount for maintain_balance).',
        },
      },
      required: ['categoryId', 'targetType', 'amount'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
    },
    executor: 'mutation',
  },
  {
    name: MCP_TOOL_UPDATE_CATEGORY_TARGET,
    description:
      'Update an existing category target. The category must already have a target (use kualia_create_category_target otherwise). All fields are optional except `categoryId`. Nullable fields (`monthlyContribution`, `targetBalance`, `targetDate`, `dayOfWeek`, `dueDay`) accept `null` to clear. Monetary fields use decimal strings in the workspace currency (see kualia_create_category_target).',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        categoryId: {
          type: 'string',
          description: 'Required category id (must already have a target).',
        },
        targetType: {
          type: 'string',
          enum: ['recurring', 'recurring_rollover', 'maintain_balance', 'one_time'],
        },
        amount: {
          type: 'string',
          pattern: '^-?\\d+(\\.\\d+)?$',
          description: 'Decimal string in workspace currency.',
        },
        frequency: {
          type: 'string',
          enum: ['daily', 'weekly', 'monthly', 'yearly'],
        },
        frequencyInterval: {
          type: 'integer',
          minimum: 1,
        },
        dayOfWeek: {
          type: ['integer', 'null'],
          description: '0–6 (Sunday–Saturday), or null to clear.',
        },
        dueDay: {
          type: ['integer', 'null'],
          description: '1–31 or -1 (last day of month), or null to clear.',
        },
        firstDueDate: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        },
        targetDate: {
          type: ['string', 'null'],
          description: 'ISO date string or null to clear.',
        },
        monthlyContribution: {
          type: ['string', 'null'],
          pattern: '^-?\\d+(\\.\\d+)?$',
          description: 'Decimal string in workspace currency, or null to clear.',
        },
        targetBalance: {
          type: ['string', 'null'],
          pattern: '^-?\\d+(\\.\\d+)?$',
          description: 'Decimal string in workspace currency, or null to clear.',
        },
      },
      required: ['categoryId'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
    },
    executor: 'mutation',
  },
  {
    name: MCP_TOOL_DELETE_CATEGORY_TARGET,
    description:
      'Disable the target on a category. Preserves the underlying settings so the user can re-enable later via kualia_create_category_target. Idempotent — calling on a category without an active target succeeds with no effect.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Optional workspace id. Defaults to the user active workspace.',
        },
        categoryId: {
          type: 'string',
          description: 'Required category id.',
        },
      },
      required: ['categoryId'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
    },
    executor: 'mutation',
  },
];

export function listMcpTools(): ReadonlyArray<McpToolDefinition> {
  return MCP_TOOLS;
}

export function hasReportsReadScope(scopes: string[]): boolean {
  return scopes.includes(APP_READ_SCOPE) || scopes.includes(LEGACY_REPORTS_READ_SCOPE);
}

export function hasBudgetsWriteScope(scopes: string[]): boolean {
  return scopes.includes(BUDGETS_WRITE_SCOPE);
}

export function hasTransactionsWriteScope(scopes: string[]): boolean {
  return scopes.includes(TRANSACTIONS_WRITE_SCOPE);
}
