import { jsonSchema, tool, type ToolSet } from 'ai';

import { internal } from '../_generated/api';
import { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import type { ActivityAttribution } from '../activityLogs/types';
import { serializeBigInts } from '../lib/serialization';
import { APP_READ_SCOPE, BUDGETS_WRITE_SCOPE, listMcpTools, TRANSACTIONS_WRITE_SCOPE } from '../mcp/tools';

/**
 * Scopes used for in-app chat. The chat runs as the authenticated Clerk user,
 * so we don't go through OAuth — the executor handlers still scope-check, so we
 * pass the same scope strings the public MCP uses. Includes `budgets:write` (for
 * `kualia_set_category_assigned_amount`) and `transactions:write` (for
 * `kualia_create_transactions` / `kualia_delete_transactions` from a chat file import).
 */
const CHAT_SCOPES = [APP_READ_SCOPE, BUDGETS_WRITE_SCOPE, TRANSACTIONS_WRITE_SCOPE];

/**
 * Hard ceiling on a single tool result returned to the model, in characters.
 * 80K chars ≈ 20K tokens. With multi-step tool use accumulating in context,
 * letting one call return more than this risks blowing past the model's
 * context window (e.g. `kualia_list_transactions` returning 500 rows, or
 * `kualia_get_envelope_month_status` for a workspace with many categories).
 *
 * On overflow we return a structured error rather than truncating silently,
 * so the model is forced to narrow its query (filter by category/account,
 * pass `limit`, pick a single `yearMonth`) instead of chewing through a
 * partial payload.
 */
const MAX_TOOL_RESULT_CHARS = 80_000;

/**
 * Pull the workspace's `minorUnit` off the tool result so we can format bigint money
 * fields as decimal strings. Every money-bearing MCP payload includes it at the top
 * level via `resolveMcpAmountMetadata` (USD=2, JPY=0, KWD=3, etc.). When absent — for
 * tool results that don't carry money (e.g. `kualia_list_workspaces`) — we return
 * `undefined`, which leaves bigints as plain integer strings. Defaulting to 2 here
 * would silently mis-format JPY (¥5108 → "51.08") or KWD; better to skip formatting
 * than to corrupt the value.
 */
function extractMinorUnit(data: unknown): number | undefined {
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    const value = record['minorUnit'];
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
      return value;
    }
  }
  return undefined;
}

/**
 * Build AI SDK tool definitions for the in-app Kualia data tools, sourced from
 * the same `listMcpTools()` registry the public MCP uses. Each tool's `execute`
 * runs the existing `internal.mcp.reportTools.executeMcpTool` query directly —
 * no HTTP, no OAuth handshake.
 *
 * Read and write tools are both exposed. Workspace selection is handled by
 * `resolveWorkspace` (defaults to the user's first workspace); the model can
 * call `kualia_list_workspaces` if the user wants to switch.
 */
export function buildKualiaTools(
  ctx: ActionCtx,
  clerkId: string,
  defaultWorkspaceId: Id<'workspace'> | undefined
): ToolSet {
  const tools: ToolSet = {};

  for (const def of listMcpTools()) {
    tools[def.name] = tool({
      description: def.description,
      inputSchema: jsonSchema(def.inputSchema),
      execute: async (input: unknown) => {
        const rawArguments = input === undefined ? undefined : JSON.stringify(input);
        const args = {
          toolName: def.name,
          clerkId,
          activeWorkspaceId: defaultWorkspaceId,
          scopes: CHAT_SCOPES,
          rawArguments,
        };
        const attribution: ActivityAttribution = {
          clerkId,
          source: { type: 'kualia_ui' },
        };
        const writeArgs = { ...args, attribution };
        let result;
        switch (def.executor) {
          case 'action':
            result = await ctx.runAction(internal.mcp.reportTools.executeMcpActionTool, writeArgs);
            break;
          case 'mutation':
            result = await ctx.runMutation(internal.mcp.reportTools.executeMcpMutationTool, writeArgs);
            break;
          case 'query':
          default:
            result = await ctx.runQuery(internal.mcp.reportTools.executeMcpTool, args);
            break;
        }

        if (!result.ok) {
          return { error: result.error };
        }

        // Format bigints as fixed-point decimal strings ("51.08") rather than raw minor-units
        // integers ("5108"). The response payload itself carries the right `minorUnit` for the
        // workspace currency, so we read it back off the result instead of plumbing it through.
        const minorUnit = extractMinorUnit(result.data);
        const data = serializeBigInts(result.data, minorUnit);
        const serialized = JSON.stringify(data);
        if (serialized.length > MAX_TOOL_RESULT_CHARS) {
          return {
            error: {
              code: 'RESULT_TOO_LARGE',
              message: `The result was ${serialized.length} characters, exceeding the ${MAX_TOOL_RESULT_CHARS} char chat limit. Narrow the request: pass a specific yearMonth, categoryId, categoryName, groupId, groupName, accountId, status, or a smaller monthsBack/limit. If you only need one category or group status, call kualia_get_envelope_month_status with the current month and a category/group filter.`,
            },
          };
        }
        return data;
      },
    });
  }

  return tools;
}
