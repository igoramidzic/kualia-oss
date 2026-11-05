import { getIdentity } from '../../lib/identity';
import { ConvexError, v } from 'convex/values';
import { CountryCode } from 'plaid';

import { internal } from '../../_generated/api';
import { action, internalQuery } from '../../_generated/server';
import { getSafePlaidErrorDetails, isPlaidRedirectConfigurationError, plaidClient, plaidConfig } from './plaidClient';

/**
 * Internal query to get bank link with access token
 * Bank links are cross-workspace, so we verify ownership by ownerId
 */
export const getBankLinkForUpdate = internalQuery({
  args: { bankLinkId: v.id('bankLink'), userId: v.string() },
  returns: v.object({ accessToken: v.string() }),
  handler: async (ctx, { bankLinkId, userId }) => {
    const bankLink = await ctx.db.get(bankLinkId);

    if (!bankLink) {
      throw new ConvexError('Bank link not found');
    }

    if (bankLink.ownerId !== userId) {
      throw new ConvexError('Access denied');
    }

    return {
      accessToken: bankLink.accessToken,
    };
  },
});

/**
 * Create a Plaid Link token in update mode for reconnecting a bank link
 * This token is used to re-authenticate an existing bank connection
 */
export const createUpdateLinkToken = action({
  args: { bankLinkId: v.id('bankLink'), platform: v.optional(v.literal('ios')) },
  returns: v.object({ link_token: v.string(), expiration: v.string() }),
  handler: async (ctx, { bankLinkId, platform }) => {
    const identity = await getIdentity(ctx);

    if (!identity) {
      throw new ConvexError('User not authenticated');
    }

    // Get bank link
    const bankLink = await ctx.runQuery(internal.bankProviders.plaid.createUpdateLinkToken.getBankLinkForUpdate, {
      bankLinkId,
      userId: identity.subject,
    });

    if (!bankLink) {
      throw new ConvexError('Bank link not found');
    }

    try {
      const linkTokenResponse = await plaidClient.linkTokenCreate({
        client_name: plaidConfig.clientName,
        language: plaidConfig.language,
        country_codes: [CountryCode.Us, CountryCode.Ca],
        user: {
          client_user_id: identity.subject,
          email_address: identity.email ?? undefined,
        },
        access_token: bankLink.accessToken, // Include access token for update mode
        webhook: plaidConfig.webhook,
        ...(platform === 'ios' ? { redirect_uri: 'https://kualia.com/plaid/oauth' } : {}),
      });

      return {
        link_token: linkTokenResponse.data.link_token,
        expiration: linkTokenResponse.data.expiration,
      };
    } catch (error: unknown) {
      console.error('Error creating Plaid update link token:', getSafePlaidErrorDetails(error));

      if (platform === 'ios' && isPlaidRedirectConfigurationError(error)) {
        throw new ConvexError(
          'Bank connection setup is incomplete. Please contact Kualia support to enable the iOS return link, then try again.'
        );
      }

      throw new ConvexError('Failed to create update link token');
    }
  },
});
