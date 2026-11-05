import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

type SafePlaidErrorDetails = {
  error_code?: string;
  error_type?: string;
  request_id?: string;
  status?: number;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function getPlaidErrorResponse(error: unknown) {
  const response = asRecord(asRecord(error)?.['response']);
  return { response, data: asRecord(response?.['data']) };
}

// Axios errors contain the full authenticated request, including Plaid secrets.
// Only these bounded provider diagnostic fields are safe to send to logs.
export function getSafePlaidErrorDetails(error: unknown): SafePlaidErrorDetails {
  const { response, data } = getPlaidErrorResponse(error);
  const details: SafePlaidErrorDetails = {};
  for (const key of ['error_code', 'error_type'] as const) {
    const value = data?.[key];
    if (typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(value)) details[key] = value;
  }
  const requestId = data?.['request_id'];
  if (typeof requestId === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(requestId)) details.request_id = requestId;
  const status = response?.['status'];
  if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) details.status = status;
  return details;
}

export function isPlaidRedirectConfigurationError(error: unknown): boolean {
  const { data } = getPlaidErrorResponse(error);
  return (
    data?.['error_code'] === 'INVALID_FIELD' &&
    typeof data['error_message'] === 'string' &&
    /redirect[_\s]+uri/i.test(data['error_message'])
  );
}

// Initialize Plaid client configuration
const configuration = new Configuration({
  basePath: PlaidEnvironments[process.env['PLAID_ENV'] ?? 'sandbox'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env['PLAID_CLIENT_ID'],
      'PLAID-SECRET': process.env['PLAID_SECRET'],
    },
  },
});

// Export configured Plaid client
export const plaidClient = new PlaidApi(configuration);

// Export common Plaid configuration
export const plaidConfig = {
  clientName: 'Kualia',
  language: 'en' as const,
  webhook: process.env['PLAID_TRANSACTIONS_WEBHOOK'],
  transactionsDaysRequested: 3, // 3 days of transaction history for faster initial sync
};
