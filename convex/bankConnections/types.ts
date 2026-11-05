import { v } from 'convex/values';

// Separate advance warnings from health: a connection can still receive updates.
export const bankConnectionReauthorizationValidator = v.object({
  reason: v.union(v.literal('consent_expiring'), v.literal('connection_expiring')),
  requiredBy: v.optional(v.string()),
  providerReason: v.optional(v.string()),
});

export const bankConnectionProviderValidator = v.union(v.literal('plaid'), v.literal('apple_wallet'));

export const plaidConnectionRefValidator = v.object({
  provider: v.literal('plaid'),
  connectionId: v.id('bankLink'),
});

export const appleWalletConnectionRefValidator = v.object({
  provider: v.literal('apple_wallet'),
  connectionId: v.id('financeKitConnection'),
});

export const bankConnectionRefValidator = v.union(plaidConnectionRefValidator, appleWalletConnectionRefValidator);

export const plaidConnectionAccountRefValidator = v.object({
  provider: v.literal('plaid'),
  accountId: v.id('bankLinkAccount'),
});

export const appleWalletConnectionAccountRefValidator = v.object({
  provider: v.literal('apple_wallet'),
  accountId: v.id('financeKitAccount'),
});

export const bankConnectionAccountRefValidator = v.union(
  plaidConnectionAccountRefValidator,
  appleWalletConnectionAccountRefValidator
);
