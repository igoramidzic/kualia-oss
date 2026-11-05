import type { Auth, UserIdentity } from 'convex/server';

// Convex Auth subjects contain userId|sessionId. Ownership must remain stable
// across sessions. Existing schema fields named clerkId now store this user ID.
export async function getIdentity(ctx: { auth: Auth }): Promise<UserIdentity | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return { ...identity, subject: identity.subject.split('|')[0] };
}
