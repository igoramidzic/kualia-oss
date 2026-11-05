import { SignJWT } from 'jose';

import { query, type QueryCtx } from '../_generated/server';
import { requireAuth } from '../lib/auth';
import { normalizeProfileName } from '../userProfiles/helpers';

interface UserJotIdentity {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
}

interface UserJotAuthContext {
  projectId: string;
  secretKey: string;
  user: UserJotIdentity;
}

async function getUserJotAuthContext(ctx: QueryCtx): Promise<UserJotAuthContext | null> {
  const identity = await requireAuth(ctx);

  const userProfile = await ctx.db
    .query('userProfile')
    .withIndex('by_clerkId', (q) => q.eq('clerkId', identity.subject))
    .first();

  if (!userProfile) {
    return null;
  }

  const projectId = process.env['USERJOT_PROJECT_ID'];
  if (!projectId) {
    throw new Error('USERJOT_PROJECT_ID is not configured');
  }

  const secretKey = process.env['USERJOT_SECRET_KEY'];
  if (!secretKey) {
    throw new Error('USERJOT_SECRET_KEY is not configured');
  }

  const email = typeof identity.email === 'string' ? identity.email : undefined;

  return {
    projectId,
    secretKey,
    user: {
      id: identity.subject,
      email,
      // userProfile.name intentionally stores only the user's first name.
      firstName: normalizeProfileName(userProfile.name),
      lastName: typeof identity.familyName === 'string' ? identity.familyName : undefined,
      avatar: typeof identity.pictureUrl === 'string' ? identity.pictureUrl : undefined,
    },
  };
}

export async function createUserJotIdentityToken(
  user: UserJotIdentity,
  projectId: string,
  secretKey: string,
  issuedAt: number = Math.floor(Date.now() / 1000)
): Promise<string> {
  const secret = new TextEncoder().encode(secretKey);

  return await new SignJWT({
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    avatar: user.avatar,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuer(projectId)
    .setAudience('userjot')
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 60 * 60)
    .sign(secret);
}

/** Generate a short-lived signed identity token for UserJot Widget v3. */
export const generateIdentityToken = query({
  args: {},
  handler: async (ctx) => {
    const authContext = await getUserJotAuthContext(ctx);
    if (!authContext) {
      return null;
    }

    const token = await createUserJotIdentityToken(authContext.user, authContext.projectId, authContext.secretKey);

    return { token };
  },
});

/**
 * Generate the legacy Widget v2 token and links.
 *
 * @deprecated Retained temporarily so the currently deployed v2 web client
 * remains compatible while the v3 client rolls out independently.
 */
export const generateSignature = query({
  args: {},
  handler: async (ctx) => {
    const authContext = await getUserJotAuthContext(ctx);
    if (!authContext) {
      return null;
    }

    const encoder = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(authContext.secretKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(authContext.user.id));
    const signature = Array.from(new Uint8Array(signatureBuffer), (byte) => byte.toString(16).padStart(2, '0')).join(
      ''
    );
    const payload = {
      id: authContext.projectId,
      user: {
        id: authContext.user.id,
        email: authContext.user.email,
        firstName: authContext.user.firstName,
        signature,
      },
    };
    const utf8Bytes = encoder.encode(JSON.stringify(payload));
    const binaryString = Array.from(utf8Bytes, (byte) => String.fromCharCode(byte)).join('');
    const token = btoa(binaryString);
    const baseUrl = 'https://feedback.kualia.com';
    const tokenParam = `?clientToken=${token}`;
    const latestChangelog = await ctx.db.query('appChangelog').withIndex('by_version').order('desc').first();
    const versionedChangelogUrl = latestChangelog?.changelogUrl
      ? `${latestChangelog.changelogUrl}${latestChangelog.changelogUrl.includes('?') ? '&' : '?'}clientToken=${token}`
      : null;

    return {
      token,
      featureRequestsUrl: `${baseUrl}${tokenParam}`,
      changelogUrl: `${baseUrl}/updates${tokenParam}`,
      versionedChangelogUrl,
    };
  },
});
