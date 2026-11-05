import { Password } from '@convex-dev/auth/providers/Password';
import { convexAuth } from '@convex-dev/auth/server';
import { v } from 'convex/values';
import { query } from './_generated/server';
import { getIdentity } from './lib/identity';

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const email = typeof params['email'] === 'string' ? params['email'].trim().toLowerCase() : '';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
        return { email };
      },
      validatePasswordRequirements(password) {
        if (password.length < 12) throw new Error('Use at least 12 characters for your password.');
      },
    }),
  ],
  jwt: {
    customClaims: async (ctx, { userId }) => {
      const user = await ctx.db.get(userId);
      return { email: user?.email, given_name: user?.name };
    },
  },
});

export const getCurrentUser = query({
  args: {},
  returns: v.union(v.null(), v.object({ id: v.string(), email: v.string(), name: v.union(v.string(), v.null()) })),
  handler: async (ctx) => {
    const identity = await getIdentity(ctx);
    return identity ? { id: identity.subject, email: identity.email ?? '', name: identity.givenName ?? null } : null;
  },
});
