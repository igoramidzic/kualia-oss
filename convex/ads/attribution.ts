import { ConvexError, v } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import { internalMutation, internalQuery, type MutationCtx, mutation } from '../_generated/server';
import { requireUserProfile } from '../lib/auth';
import { sha256Hex } from '../lib/crypto';
import { adAttributionInput, adConsentRevocation, storedAdAttribution } from './types';

/** Retire stored click data; old clients may never re-enable advertising measurement. */
export async function clearAdAttribution(ctx: MutationCtx, profile: Doc<'userProfile'>): Promise<null> {
  if (profile.adAttribution || profile.adConsentRevocationKey) {
    await ctx.db.patch(profile._id, { adAttribution: undefined, adConsentRevocationKey: undefined });
  }
  return null;
}

// Account-level consent exists before a workspace; use the authenticated profile rather than an org argument.
export const sync = mutation({
  args: { attribution: adAttributionInput },
  returns: v.union(adConsentRevocation, v.null()),
  handler: async (ctx) => {
    const { userProfile } = await requireUserProfile(ctx);
    return await clearAdAttribution(ctx, userProfile);
  },
});

// The marketing site has no Clerk session. Authenticate this one-way operation
// with the capability issued to the account's signed-in clients instead.
export const revoke = mutation({
  args: adConsentRevocation.fields,
  returns: v.null(),
  handler: async (ctx, { profileId, token }) => {
    const profile = await ctx.db.get(profileId);
    if (!profile?.adConsentRevocationKey) return null;
    if (token.length !== 64 || token !== (await sha256Hex(`revoke-ad-consent:${profile.adConsentRevocationKey}`))) {
      throw new ConvexError('Invalid ad consent revocation token');
    }
    if (!profile.isDeleted) await clearAdAttribution(ctx, profile);
    return null;
  },
});

export const get = internalQuery({
  args: { profileId: v.id('userProfile') },
  returns: v.union(storedAdAttribution, v.null()),
  handler: async () => null,
});

export const expire = internalMutation({
  // Optional to keep already-scheduled OpenAI expiry jobs compatible.
  args: { profileId: v.id('userProfile'), clickedAt: v.string(), platform: v.optional(v.literal('facebook')) },
  returns: v.null(),
  handler: async (ctx, { profileId }) => {
    const profile = await ctx.db.get(profileId);
    if (profile) await clearAdAttribution(ctx, profile);
    return null;
  },
});
