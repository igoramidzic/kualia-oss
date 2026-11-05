import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction, internalMutation } from '../_generated/server';

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const ALLOWED_STORAGE_HOST_SUFFIXES = ['.convex.cloud', '.convex.site'] as const;

export function validateGlobalInstitutionLogoTransferUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  const isAllowedHost = ALLOWED_STORAGE_HOST_SUFFIXES.some((suffix) => url.hostname.endsWith(suffix));

  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    !isAllowedHost ||
    !url.pathname.startsWith('/api/storage/')
  ) {
    throw new Error('Logo transfer URL must be an HTTPS Convex storage URL');
  }

  return url;
}

async function readBoundedImageBlob(response: Response): Promise<Blob> {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (!contentType?.startsWith('image/')) {
    throw new Error('Logo transfer response is not an image');
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (!Number.isFinite(parsedLength) || parsedLength < 0 || parsedLength > MAX_LOGO_BYTES) {
      throw new Error('Logo transfer response exceeds the size limit');
    }
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_LOGO_BYTES) {
      throw new Error('Logo transfer response exceeds the size limit');
    }
    return new Blob([bytes], { type: contentType });
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > MAX_LOGO_BYTES) {
      await reader.cancel();
      throw new Error('Logo transfer response exceeds the size limit');
    }

    const chunk = new Uint8Array(value.byteLength);
    chunk.set(value);
    chunks.push(chunk);
  }

  return new Blob(chunks, { type: contentType });
}

/**
 * Bulk import global institutions from JSON data.
 * Use this from the Convex dashboard to sync institutions from dev to prod.
 *
 * Example usage from dashboard:
 * 1. Export from dev: Copy the globalInstitution table data
 * 2. In prod dashboard, run this mutation with the JSON array
 *
 * Accepts the raw table export format (ignores _id and _creationTime)
 */
export const bulkImportGlobalInstitutions = internalMutation({
  args: {
    institutions: v.array(
      v.object({
        _id: v.optional(v.string()), // Ignored - for compatibility with table export
        _creationTime: v.optional(v.number()), // Ignored - for compatibility with table export
        providerInstitutionId: v.string(),
        provider: v.literal('Plaid'),
        name: v.string(),
        logoUrl: v.optional(v.string()),
        primaryColor: v.optional(v.string()),
        isVerified: v.optional(v.boolean()),
        updatedAt: v.optional(v.string()), // Ignored - we'll set a fresh timestamp
      })
    ),
  },
  handler: async (ctx, { institutions }) => {
    const timestamp = new Date().toISOString();
    let created = 0;
    let updated = 0;

    for (const institution of institutions) {
      const existing = await ctx.db
        .query('globalInstitution')
        .withIndex('by_provider_providerInstitutionId', (q) =>
          q.eq('provider', institution.provider).eq('providerInstitutionId', institution.providerInstitutionId)
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          name: institution.name,
          logoUrl: institution.logoUrl,
          primaryColor: institution.primaryColor,
          isVerified: institution.isVerified ?? existing.isVerified,
          updatedAt: timestamp,
        });
        updated++;
      } else {
        await ctx.db.insert('globalInstitution', {
          providerInstitutionId: institution.providerInstitutionId,
          provider: institution.provider,
          name: institution.name,
          logoUrl: institution.logoUrl,
          primaryColor: institution.primaryColor,
          isVerified: institution.isVerified ?? false,
          updatedAt: timestamp,
        });
        created++;
      }
    }

    return { created, updated, total: institutions.length };
  },
});

/**
 * Bulk import global institutions with logo transfer.
 * Fetches logos from dev storage URLs and re-uploads to prod storage.
 *
 * Usage from Convex dashboard Functions tab:
 * 1. Export globalInstitution table from dev as JSON
 * 2. Run this action in prod with the JSON array
 */
export const bulkImportWithLogoTransfer = internalAction({
  args: {
    institutions: v.array(
      v.object({
        _id: v.optional(v.string()),
        _creationTime: v.optional(v.number()),
        providerInstitutionId: v.string(),
        provider: v.literal('Plaid'),
        name: v.string(),
        logoUrl: v.optional(v.string()),
        primaryColor: v.optional(v.string()),
        isVerified: v.optional(v.boolean()),
        updatedAt: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, { institutions }) => {
    let created = 0;
    let updated = 0;
    let logosTransferred = 0;
    let logosFailed = 0;

    for (const institution of institutions) {
      let newLogoUrl = institution.logoUrl;

      // If there's a logo URL from dev storage, transfer it
      if (institution.logoUrl && institution.logoUrl.includes('/api/storage/')) {
        try {
          const logoUrl = validateGlobalInstitutionLogoTransferUrl(institution.logoUrl);
          const response = await fetch(logoUrl, { redirect: 'error' });
          if (response.ok) {
            const blob = await readBoundedImageBlob(response);

            // Upload to prod storage
            const storageId = await ctx.storage.store(blob);
            newLogoUrl = (await ctx.storage.getUrl(storageId)) ?? undefined;
            logosTransferred++;
          } else {
            console.error(`Failed to fetch logo for ${institution.name}: ${response.status}`);
            logosFailed++;
            newLogoUrl = undefined; // Don't use broken URL
          }
        } catch (error) {
          console.error(`Error transferring logo for ${institution.name}:`, error);
          logosFailed++;
          newLogoUrl = undefined;
        }
      }

      // Upsert the institution with the new logo URL
      const result = await ctx.runMutation(internal.globalInstitutions.mutations.upsertGlobalInstitution, {
        providerInstitutionId: institution.providerInstitutionId,
        provider: institution.provider,
        name: institution.name,
        logoUrl: newLogoUrl,
        primaryColor: institution.primaryColor,
        isVerified: institution.isVerified,
      });

      if (result.isNew) {
        created++;
      } else {
        updated++;
      }
    }

    return {
      created,
      updated,
      total: institutions.length,
      logosTransferred,
      logosFailed,
    };
  },
});

export const upsertGlobalInstitution = internalMutation({
  args: {
    providerInstitutionId: v.string(),
    provider: v.literal('Plaid'),
    name: v.string(),
    logoUrl: v.optional(v.string()),
    primaryColor: v.optional(v.string()),
    isVerified: v.optional(v.boolean()),
  },
  handler: async (ctx, { providerInstitutionId, provider, name, logoUrl, primaryColor, isVerified }) => {
    const existing = await ctx.db
      .query('globalInstitution')
      .withIndex('by_provider_providerInstitutionId', (q) =>
        q.eq('provider', provider).eq('providerInstitutionId', providerInstitutionId)
      )
      .first();

    const timestamp = new Date().toISOString();

    if (existing) {
      // Only update fields that have values from the provider
      // This preserves manual updates to fields that aren't provided
      const updates: {
        name: string;
        logoUrl?: string;
        primaryColor?: string;
        updatedAt: string;
      } = {
        name,
        updatedAt: timestamp,
      };

      // Only update logo if provider actually provides one
      if (logoUrl !== undefined) {
        updates.logoUrl = logoUrl;
      }

      // Only update primary color if provider actually provides one
      if (primaryColor !== undefined) {
        updates.primaryColor = primaryColor;
      }

      const verifiedUpdate = isVerified === undefined ? {} : { isVerified };

      await ctx.db.patch(existing._id, { ...updates, ...verifiedUpdate });
      return { id: existing._id, isNew: false };
    }

    const id = await ctx.db.insert('globalInstitution', {
      providerInstitutionId,
      provider,
      name,
      logoUrl,
      primaryColor,
      isVerified: isVerified ?? false,
      updatedAt: timestamp,
    });

    return { id, isNew: true };
  },
});
