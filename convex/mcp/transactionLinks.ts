import type { Id } from '../_generated/dataModel';

const DEFAULT_APP_BASE_URL = 'https://app.kualia.com';

function getAppBaseUrl(): string {
  const raw = process.env['KUALIA_APP_URL'];
  if (!raw) return DEFAULT_APP_BASE_URL;
  return raw.replace(/\/+$/, '');
}

export function buildTransactionUrl(workspaceId: Id<'workspace'>, transactionId: Id<'transaction'>): string {
  const shortId = workspaceId.slice(-8);
  return `${getAppBaseUrl()}/${shortId}/transactions/${transactionId}/details`;
}
