import { getIdentity } from '../../lib/identity';
import { ConvexError, v } from 'convex/values';
import { CountryCode, Products } from 'plaid';

import { action } from '../../_generated/server';
import { getSafePlaidErrorDetails, isPlaidRedirectConfigurationError, plaidClient, plaidConfig } from './plaidClient';

/**
 * Create a Plaid Link token for the current user
 * This token is used to initialize Plaid Link in the frontend
 */
export const createLinkToken = action({
  args: { platform: v.optional(v.literal('ios')) },
  returns: v.object({ link_token: v.string(), expiration: v.string() }),
  handler: async (ctx, { platform }) => {
    // Get the current user identity from Clerk
    const identity = await getIdentity(ctx);

    if (!identity) {
      throw new ConvexError('User not authenticated');
    }

    try {
      const linkTokenResponse = await plaidClient.linkTokenCreate({
        client_name: plaidConfig.clientName,
        language: plaidConfig.language,
        country_codes: [CountryCode.Us, CountryCode.Ca],
        products: [Products.Transactions],
        user: {
          client_user_id: identity.subject,
          email_address: identity.email ?? undefined,
        },
        transactions: {
          days_requested: plaidConfig.transactionsDaysRequested,
        },
        webhook: plaidConfig.webhook,
        ...(platform === 'ios' ? { redirect_uri: 'https://kualia.com/plaid/oauth' } : {}),
      });

      return {
        link_token: linkTokenResponse.data.link_token,
        expiration: linkTokenResponse.data.expiration,
      };
    } catch (error: unknown) {
      const needsRedirectRegistration = platform === 'ios' && isPlaidRedirectConfigurationError(error);
      console.error(
        needsRedirectRegistration
          ? 'Plaid iOS OAuth redirect is not configured. Register https://kualia.com/plaid/oauth in the Plaid dashboard.'
          : 'Error creating Plaid link token:',
        getSafePlaidErrorDetails(error)
      );
      if (needsRedirectRegistration) {
        throw new ConvexError(
          'Bank connection setup is incomplete. Please contact Kualia support to enable the iOS return link, then try again.'
        );
      }

      throw new ConvexError('Unable to start a bank connection. Please try again shortly.');
    }
  },
});
