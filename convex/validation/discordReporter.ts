import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';

/**
 * Send validation report to Discord
 */
export const sendReport = internalAction({
  args: {
    runId: v.string(),
    startedAt: v.string(),
    completedAt: v.string(),
    totalWorkspacesProcessed: v.number(),
    workspacesWithIssues: v.array(
      v.object({
        workspaceId: v.id('workspace'),
        workspaceName: v.string(),
        issueCount: v.number(),
        issueTypes: v.array(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const { runId, completedAt, totalWorkspacesProcessed, workspacesWithIssues } = args;

    const hasIssues = workspacesWithIssues.length > 0;
    const totalIssues = workspacesWithIssues.reduce((sum, w) => sum + w.issueCount, 0);

    const statusText = hasIssues
      ? `Found ${totalIssues} issues in ${workspacesWithIssues.length} workspaces`
      : 'All workspaces passed validation';

    let description = `${statusText}\n${totalWorkspacesProcessed} workspaces processed\nCompleted: ${formatDate(completedAt)}`;

    if (hasIssues) {
      const displayWorkspaces = workspacesWithIssues.slice(0, 5);
      for (const workspace of displayWorkspaces) {
        const issueTypesFormatted = workspace.issueTypes.map((t) => formatIssueType(t)).join(', ');
        description += `\n• ${workspace.workspaceName}: ${workspace.issueCount} issues (${issueTypesFormatted})`;
      }
      if (workspacesWithIssues.length > 5) {
        description += `\n...and ${workspacesWithIssues.length - 5} more`;
      }
    }

    try {
      await ctx.runAction(internal.discord.sendDiscordNotification, {
        channel: 'data-integrity',
        title: 'Data Integrity Validation',
        description,
        emoji: hasIssues ? '⚠️' : '✅',
        metadata: {
          runId: runId.slice(0, 8),
          totalWorkspaces: String(totalWorkspacesProcessed),
          totalIssues: String(totalIssues),
          workspacesWithIssues: String(workspacesWithIssues.length),
        },
      });
      console.log(`[Validation] Report sent for run ${runId}`);
    } catch (error) {
      console.error('[Validation] Failed to send report:', error);
    }
  },
});

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function formatIssueType(type: string): string {
  const typeMap: Record<string, string> = {
    category_spending_mismatch: 'Category Spending',
    credit_spending_mismatch: 'Credit Card Spending',
    merchant_stats_mismatch: 'Merchant Stats',
    ready_to_assign_mismatch: 'Ready to Assign',
    monthly_income_activity_mismatch: 'Monthly Income',
    transaction_flag_incorrect: 'Transaction Flags',
    movement_total_mismatch: 'Movement Totals',
    transfer_pair_issue: 'Transfer Pairs',
    bank_account_balance_mismatch: 'Bank Balances',
  };

  return typeMap[type] ?? type;
}
