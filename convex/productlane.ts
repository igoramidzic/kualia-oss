import { getIdentity } from './lib/identity';
import { SignJWT } from 'jose';

import { action } from './_generated/server';

/**
 * Generate ProductLane SSO URL for the authenticated user
 * Returns the SSO URL that the client should redirect to
 */
export const getSsoUrl = action({
  args: {},
  handler: async (ctx): Promise<string> => {
    const identity = await getIdentity(ctx);

    if (!identity) {
      throw new Error('Unauthorized');
    }

    const email = identity.email ?? '';
    const name = identity.name ?? identity.email ?? 'User';
    const imageUrl = identity.pictureUrl ?? '';

    const ssoSecret = process.env['PRODUCTLANE_SSO_SECRET'];
    if (!ssoSecret) {
      throw new Error('SSO not configured');
    }

    const portalUrl = process.env['PRODUCTLANE_PORTAL_URL'];
    if (!portalUrl) {
      throw new Error('ProductLane portal URL not configured');
    }

    const secret = new TextEncoder().encode(ssoSecret);
    const token = await new SignJWT({
      email,
      name,
      imageUrl,
      tokenValidity: 15,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .sign(secret);

    return `${portalUrl}/api/portal/sso?token=${token}`;
  },
});
