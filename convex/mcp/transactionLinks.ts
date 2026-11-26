import type { Id } from '../_generated/dataModel';
import { buildAppUrl } from '../lib/appUrl';

export function buildTransactionUrl(workspaceId: Id<'workspace'>, transactionId: Id<'transaction'>): string {
  const shortId = workspaceId.slice(-8);
  return buildAppUrl(`/${shortId}/transactions/${transactionId}/details`);
}
