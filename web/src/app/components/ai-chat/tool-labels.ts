/**
 * User-facing labels for tools the chat agent can invoke. The chat panel renders these in two
 * spots: while a tool is running (present-progressive, used as the live status line in place of
 * "Thinking…") and inside the post-turn collapsible (past-tense, used in the tool list).
 *
 * Slugs are kept in sync by hand with the MCP tool registry in `convex/mcp/tools.ts`. Unknown
 * slugs fall back to a derived label so we never show a raw slug like `kualia_list_transactions`
 * to the user.
 *
 * Batch tools (create/update/delete/restore transactions) accept an optional item count and
 * switch to a singular label when count === 1. Other tools ignore the count.
 */

interface ToolLabelPair {
  running: string;
  done: string;
}

interface BatchToolLabels {
  /** Plural ("Creating transactions") used when count is missing, 0, or > 1. */
  plural: ToolLabelPair;
  /** Singular ("Creating transaction") used only when count === 1. */
  singular: ToolLabelPair;
}

const TOOL_LABELS: Readonly<Record<string, ToolLabelPair>> = {
  kualia_list_workspaces: { running: 'Looking up workspaces', done: 'Looked up workspaces' },
  kualia_get_account_balances_report: {
    running: 'Fetching account balances',
    done: 'Fetched account balances',
  },
  kualia_get_net_worth_report: { running: 'Fetching net worth', done: 'Fetched net worth' },
  kualia_get_spending_report: { running: 'Fetching spending report', done: 'Fetched spending report' },
  kualia_list_category_groups: { running: 'Loading categories', done: 'Loaded categories' },
  kualia_get_envelope_month_status: {
    running: 'Checking envelope status',
    done: 'Checked envelope status',
  },
  kualia_set_category_assigned_amount: {
    running: 'Updating envelope amount',
    done: 'Updated envelope amount',
  },
  kualia_list_transactions: { running: 'Fetching transactions', done: 'Fetched transactions' },
  kualia_list_category_targets: { running: 'Loading category targets', done: 'Loaded category targets' },
  kualia_list_recurring_transactions: {
    running: 'Fetching recurring transactions',
    done: 'Fetched recurring transactions',
  },
  kualia_get_income_summary: { running: 'Fetching income summary', done: 'Fetched income summary' },
  kualia_get_category_rollup: { running: 'Fetching category rollup', done: 'Fetched category rollup' },
  kualia_list_bank_accounts: { running: 'Reading accounts', done: 'Read accounts' },
  kualia_create_bank_account: { running: 'Creating account', done: 'Created account' },
  kualia_close_bank_account: { running: 'Closing account', done: 'Closed account' },
  kualia_delete_bank_account: { running: 'Deleting account', done: 'Deleted account' },
  kualia_reconcile_bank_account: { running: 'Reconciling account', done: 'Reconciled account' },
  kualia_reorder_categories: { running: 'Reordering categories', done: 'Reordered categories' },
  kualia_reorder_category_groups: { running: 'Reordering groups', done: 'Reordered groups' },
  kualia_sort_categories: { running: 'Sorting categories', done: 'Sorted categories' },
  kualia_sort_category_groups: { running: 'Sorting groups', done: 'Sorted groups' },
};

const BATCH_TOOL_LABELS: Readonly<Record<string, BatchToolLabels>> = {
  kualia_create_transactions: {
    plural: { running: 'Creating transactions', done: 'Created transactions' },
    singular: { running: 'Creating transaction', done: 'Created transaction' },
  },
  kualia_delete_transactions: {
    plural: { running: 'Deleting transactions', done: 'Deleted transactions' },
    singular: { running: 'Deleting transaction', done: 'Deleted transaction' },
  },
  kualia_restore_transactions: {
    plural: { running: 'Restoring transactions', done: 'Restored transactions' },
    singular: { running: 'Restoring transaction', done: 'Restored transaction' },
  },
  kualia_update_transactions: {
    plural: { running: 'Updating transactions', done: 'Updated transactions' },
    singular: { running: 'Updating transaction', done: 'Updated transaction' },
  },
};

function deriveFallback(slug: string): ToolLabelPair {
  // Strip a known prefix (kualia_ or otherwise), kebab/snake → spaces, title-case the first word.
  const stripped = slug
    .replace(/^kualia_/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!stripped) return { running: 'Working', done: 'Worked' };
  const titled = stripped.charAt(0).toUpperCase() + stripped.slice(1);
  return { running: titled, done: titled };
}

function lookup(slug: string, itemCount: number | undefined): ToolLabelPair {
  const batch = BATCH_TOOL_LABELS[slug];
  if (batch) {
    return itemCount === 1 ? batch.singular : batch.plural;
  }
  return TOOL_LABELS[slug] ?? deriveFallback(slug);
}

/** Present-progressive label shown next to the shimmer while a tool is in flight. */
export function runningLabel(slug: string, itemCount?: number): string {
  return lookup(slug, itemCount).running;
}

/** Past-tense label shown inside the "Worked for N seconds" collapsible. */
export function doneLabel(slug: string, itemCount?: number): string {
  return lookup(slug, itemCount).done;
}
