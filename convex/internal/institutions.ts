import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { getOrCreateGlobalInstitution } from '../globalInstitutions';

/**
 * Get or create a global institution and return its ID
 */
export const upsertInstitution = internalMutation({
  args: {
    providerInstitutionId: v.string(),
    provider: v.literal('Plaid'),
    name: v.string(),
    logoUrl: v.optional(v.string()),
    primaryColor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Get or create global institution and return its ID
    return await getOrCreateGlobalInstitution(
      ctx,
      args.providerInstitutionId,
      args.provider,
      args.name,
      args.logoUrl,
      args.primaryColor
    );
  },
});
