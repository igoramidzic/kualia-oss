import { v } from 'convex/values';

import { internalQuery, query } from '../_generated/server';
import { requireWorkspaceAccess } from '../lib/auth';
import { appendLogoDevToken } from '../lib/logoUtils';

/**
 * Export all global institutions for data transfer.
 * Run this from the Convex dashboard Functions tab to get JSON for import.
 */
export const exportGlobalInstitutions = internalQuery({
  args: {},
  handler: async (ctx) => {
    const institutions = await ctx.db.query('globalInstitution').collect();

    // Return only the fields needed for import (exclude _id and _creationTime)
    return institutions.map((inst) => ({
      providerInstitutionId: inst.providerInstitutionId,
      provider: inst.provider,
      name: inst.name,
      logoUrl: inst.logoUrl,
      primaryColor: inst.primaryColor,
      isVerified: inst.isVerified,
    }));
  },
});

export const getGlobalInstitutionByProviderId = query({
  args: {
    workspaceId: v.id('workspace'),
    providerInstitutionId: v.string(),
    provider: v.optional(v.literal('Plaid')),
  },
  handler: async (ctx, { workspaceId, providerInstitutionId, provider }) => {
    // Require authentication even for global data
    await requireWorkspaceAccess(ctx, workspaceId);

    let institution;
    if (provider) {
      institution = await ctx.db
        .query('globalInstitution')
        .withIndex('by_provider_providerInstitutionId', (q) =>
          q.eq('provider', provider).eq('providerInstitutionId', providerInstitutionId)
        )
        .first();
    } else {
      institution = await ctx.db
        .query('globalInstitution')
        .withIndex('by_providerInstitutionId', (q) => q.eq('providerInstitutionId', providerInstitutionId))
        .first();
    }

    if (!institution) return null;

    return {
      ...institution,
      logoUrl: appendLogoDevToken(institution.logoUrl),
    };
  },
});

export const getGlobalInstitutionById = query({
  args: {
    workspaceId: v.id('workspace'),
    id: v.id('globalInstitution'),
  },
  handler: async (ctx, { workspaceId, id }) => {
    // Require authentication even for global data
    await requireWorkspaceAccess(ctx, workspaceId);

    const institution = await ctx.db.get(id);
    if (!institution) return null;

    return {
      ...institution,
      logoUrl: appendLogoDevToken(institution.logoUrl),
    };
  },
});

export const listGlobalInstitutions = query({
  args: {
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { workspaceId }) => {
    // Require authentication even for global data
    await requireWorkspaceAccess(ctx, workspaceId);

    const institutions = await ctx.db.query('globalInstitution').collect();

    return institutions.map((institution) => ({
      ...institution,
      logoUrl: appendLogoDevToken(institution.logoUrl),
    }));
  },
});
