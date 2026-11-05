import type { Id } from '../_generated/dataModel';
import type { DatabaseWriter } from '../_generated/server';

/**
 * Look up an existing global institution by providerInstitutionId and provider.
 * Does NOT create or update institutions - only queries.
 * Returns undefined if not found.
 */
export async function getGlobalInstitution(
  ctx: { db: DatabaseWriter },
  providerInstitutionId: string,
  provider: 'Plaid'
): Promise<Id<'globalInstitution'> | undefined> {
  const existing = await ctx.db
    .query('globalInstitution')
    .withIndex('by_provider_providerInstitutionId', (q) =>
      q.eq('provider', provider).eq('providerInstitutionId', providerInstitutionId)
    )
    .first();

  return existing?._id;
}

export async function getOrCreateGlobalInstitution(
  ctx: { db: DatabaseWriter },
  providerInstitutionId: string,
  provider: 'Plaid',
  fallbackName: string,
  fallbackLogoUrl?: string,
  fallbackPrimaryColor?: string,
  options?: {
    /** If true, don't update existing records - only create if not exists */
    createOnly?: boolean;
    /** If true, don't include logo when creating (useful for migrations where logos are base64) */
    skipLogo?: boolean;
  }
): Promise<Id<'globalInstitution'>> {
  const existing = await ctx.db
    .query('globalInstitution')
    .withIndex('by_provider_providerInstitutionId', (q) =>
      q.eq('provider', provider).eq('providerInstitutionId', providerInstitutionId)
    )
    .first();

  const timestamp = new Date().toISOString();

  if (existing) {
    // If createOnly is true, just return the existing ID without updating
    if (options?.createOnly) {
      return existing._id;
    }

    // Only update fields that have values from the provider
    // This preserves manual updates to fields that aren't provided
    const updates: {
      name: string;
      logoUrl?: string;
      primaryColor?: string;
      updatedAt: string;
    } = {
      name: fallbackName,
      updatedAt: timestamp,
    };

    // Only update logo if provider actually provides one (and skipLogo is not set)
    if (fallbackLogoUrl !== undefined && !options?.skipLogo) {
      updates.logoUrl = fallbackLogoUrl;
    }

    // Only update primary color if provider actually provides one
    if (fallbackPrimaryColor !== undefined) {
      updates.primaryColor = fallbackPrimaryColor;
    }

    await ctx.db.patch(existing._id, updates);
    return existing._id;
  }

  return await ctx.db.insert('globalInstitution', {
    providerInstitutionId,
    provider,
    name: fallbackName,
    logoUrl: options?.skipLogo ? undefined : fallbackLogoUrl,
    primaryColor: fallbackPrimaryColor,
    isVerified: false,
    updatedAt: timestamp,
  });
}
