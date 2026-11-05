export interface ReportSectionAmounts {
  inflow: bigint;
  outflow: bigint;
}

/**
 * Preserve the released net-based report contract by default. Updated clients
 * opt into gross directional amounts so the same entity can appear in both
 * sections.
 */
export function getReportSectionAmounts(
  inflowAmount: bigint,
  outflowAmount: bigint,
  grossDirectional = false
): ReportSectionAmounts {
  if (grossDirectional) {
    return {
      inflow: inflowAmount,
      outflow: outflowAmount,
    };
  }

  const netAmount = inflowAmount - outflowAmount;
  return {
    inflow: netAmount > 0n ? netAmount : 0n,
    outflow: netAmount < 0n ? -netAmount : 0n,
  };
}
