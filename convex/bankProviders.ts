// Re-export Plaid provider functions directly (flat API structure)
export { createLinkToken } from './bankProviders/plaid/createLinkToken';
export { createUpdateLinkToken } from './bankProviders/plaid/createUpdateLinkToken';
export { disconnectPlaidItem } from './bankProviders/plaid/disconnectPlaidItem';
export { exchangePublicToken } from './bankProviders/plaid/exchangePublicToken';
export { handleUpdateModeSuccess } from './bankProviders/plaid/handleUpdateModeSuccess';
export { linkNewPlaidItem } from './bankProviders/plaid/linkNewPlaidItem';
export { plaidClient, plaidConfig } from './bankProviders/plaid/plaidClient';
export { performSync, syncTransactions, syncTransactionsWebhook } from './bankProviders/plaid/plaidTransactionSync';
