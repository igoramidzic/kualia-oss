import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { getPreviousYearMonth, yearMonthToString } from '../categoryBudgets/calculations';

import { resolveMcpAmountMetadata, type McpAmountMetadata } from './tools';

type IncomeMonthEntry = {
  yearMonth: number;
  yearMonthString: string;
  inflowAmount: bigint;
  outflowAmount: bigint;
  netIncome: bigint;
};

export type IncomeSummaryToolPayload = McpAmountMetadata & {
  workspaceId: Id<'workspace'>;
  currency: string;
  expectedMonthlyIncome: bigint | null;
  months: IncomeMonthEntry[];
  totals: {
    totalInflow: bigint;
    totalOutflow: bigint;
    totalNetIncome: bigint;
  };
};

/**
 * Build an array of yearMonth values going backwards from endYearMonth for count months.
 */
function buildYearMonthRange(endYearMonth: number, count: number): number[] {
  const result: number[] = [];
  let ym = endYearMonth;
  for (let i = 0; i < count; i++) {
    result.push(ym);
    ym = getPreviousYearMonth(ym);
  }
  // Return in chronological order (oldest first)
  result.reverse();
  return result;
}

export async function getIncomeSummary(
  ctx: QueryCtx,
  workspace: Doc<'workspace'>,
  yearMonths: number[]
): Promise<IncomeSummaryToolPayload> {
  const currencyCode = workspace.currency ?? 'USD';
  const amountMetadata = resolveMcpAmountMetadata(currencyCode);

  const incomeActivity = workspace.monthlyIncomeActivity ?? {};

  let totalInflow = 0n;
  let totalOutflow = 0n;

  const months: IncomeMonthEntry[] = yearMonths.map((ym) => {
    const ymKey = ym.toString();
    const entry = incomeActivity[ymKey];
    const inflowAmount = entry?.inflowAmount ?? 0n;
    const outflowAmount = entry?.outflowAmount ?? 0n;
    const netIncome = inflowAmount - outflowAmount;

    totalInflow += inflowAmount;
    totalOutflow += outflowAmount;

    return {
      yearMonth: ym,
      yearMonthString: yearMonthToString(ym),
      inflowAmount,
      outflowAmount,
      netIncome,
    };
  });

  return {
    workspaceId: workspace._id,
    currency: currencyCode,
    ...amountMetadata,
    expectedMonthlyIncome: workspace.expectedMonthlyIncome ?? null,
    months,
    totals: {
      totalInflow,
      totalOutflow,
      totalNetIncome: totalInflow - totalOutflow,
    },
  };
}

export { buildYearMonthRange };
