import { internalMutation } from '../_generated/server';
import { stripLogoDevToken } from '../lib/logoUtils';

/**
 * Migration: Strip Logo.dev tokens from existing logo URLs
 *
 * This migration removes authentication tokens from logo URLs that were
 * incorrectly saved with the token embedded. Tokens should only be
 * appended at render time.
 *
 * Run each migration multiple times until hasMore returns false.
 * Each run processes up to 500 records.
 */

export const stripLogoTokensFromMerchants = internalMutation({
  handler: async (ctx) => {
    const merchants = await ctx.db
      .query('merchant')
      .filter((q) => q.neq(q.field('logoUrl'), undefined))
      .take(500);

    let updated = 0;
    for (const merchant of merchants) {
      if (merchant.logoUrl && merchant.logoUrl.includes('token=')) {
        await ctx.db.patch(merchant._id, {
          logoUrl: stripLogoDevToken(merchant.logoUrl),
        });
        updated++;
      }
    }

    const hasMore = merchants.length === 500;
    console.log(`Merchants: Updated ${updated}, has more: ${hasMore}`);

    return { updated, hasMore };
  },
});

export const stripLogoTokensFromBankAccounts = internalMutation({
  handler: async (ctx) => {
    const bankAccounts = await ctx.db
      .query('bankAccount')
      .filter((q) => q.neq(q.field('logoUrl'), undefined))
      .take(500);

    let updated = 0;
    for (const account of bankAccounts) {
      if (account.logoUrl && account.logoUrl.includes('token=')) {
        await ctx.db.patch(account._id, {
          logoUrl: stripLogoDevToken(account.logoUrl),
        });
        updated++;
      }
    }

    const hasMore = bankAccounts.length === 500;
    console.log(`Bank accounts: Updated ${updated}, has more: ${hasMore}`);

    return { updated, hasMore };
  },
});

export const stripLogoTokensFromGlobalInstitutions = internalMutation({
  handler: async (ctx) => {
    const institutions = await ctx.db
      .query('globalInstitution')
      .filter((q) => q.neq(q.field('logoUrl'), undefined))
      .take(500);

    let updated = 0;
    for (const institution of institutions) {
      if (institution.logoUrl && institution.logoUrl.includes('token=')) {
        await ctx.db.patch(institution._id, {
          logoUrl: stripLogoDevToken(institution.logoUrl),
        });
        updated++;
      }
    }

    const hasMore = institutions.length === 500;
    console.log(`Global institutions: Updated ${updated}, has more: ${hasMore}`);

    return { updated, hasMore };
  },
});

export const stripLogoTokensFromGlobalMerchants = internalMutation({
  handler: async (ctx) => {
    const merchants = await ctx.db
      .query('globalMerchant')
      .filter((q) => q.neq(q.field('logoUrl'), undefined))
      .take(500);

    let updated = 0;
    for (const merchant of merchants) {
      if (merchant.logoUrl && merchant.logoUrl.includes('token=')) {
        await ctx.db.patch(merchant._id, {
          logoUrl: stripLogoDevToken(merchant.logoUrl),
        });
        updated++;
      }
    }

    const hasMore = merchants.length === 500;
    console.log(`Global merchants: Updated ${updated}, has more: ${hasMore}`);

    return { updated, hasMore };
  },
});

export const stripLogoTokensFromTransactionImportRaw = internalMutation({
  handler: async (ctx) => {
    const imports = await ctx.db
      .query('transactionImportRaw')
      .filter((q) => q.neq(q.field('logoUrl'), undefined))
      .take(500);

    let updated = 0;
    for (const importRecord of imports) {
      if (importRecord.logoUrl && importRecord.logoUrl.includes('token=')) {
        await ctx.db.patch(importRecord._id, {
          logoUrl: stripLogoDevToken(importRecord.logoUrl),
        });
        updated++;
      }
    }

    const hasMore = imports.length === 500;
    console.log(`Transaction import raw: Updated ${updated}, has more: ${hasMore}`);

    return { updated, hasMore };
  },
});
