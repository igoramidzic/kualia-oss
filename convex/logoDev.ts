import { v } from 'convex/values';

import { action } from './_generated/server';

interface LogoDevSearchResult {
  name: string;
  domain: string;
}

interface LogoSearchResult {
  name: string;
  domain: string;
  logoUrl: string;
}

export const searchLogos = action({
  args: {
    query: v.string(),
  },
  handler: async (_ctx, args) => {
    const { query } = args;

    if (!query.trim()) {
      return [];
    }

    const apiUrl = 'https://api.logo.dev/search';
    const secretToken = process.env['LOGO_DEV_SECRET_TOKEN'] ?? '';
    const publicToken = process.env['LOGO_DEV_PUBLIC_TOKEN'] ?? '';

    if (!secretToken) {
      console.error('LOGO_DEV_SECRET_TOKEN is not configured');
      return [];
    }

    if (!publicToken) {
      console.error('LOGO_DEV_PUBLIC_TOKEN is not configured');
      return [];
    }

    try {
      const response = await fetch(`${apiUrl}?q=${encodeURIComponent(query)}`, {
        headers: {
          Authorization: `Bearer ${secretToken}`,
        },
      });

      if (!response.ok) {
        console.error('Logo.dev API error:', response.statusText);
        return [];
      }

      const data: unknown = await response.json();
      const apiResults: LogoDevSearchResult[] = Array.isArray(data) ? (data as LogoDevSearchResult[]) : [];

      // Add logoUrl to each result with token for display
      // Token will be stripped when saving to database
      const results: LogoSearchResult[] = apiResults.map((result) => ({
        ...result,
        logoUrl: `https://img.logo.dev/${result.domain}?token=${publicToken}`,
      }));

      return results;
    } catch (error) {
      console.error('Failed to search logos:', error);
      return [];
    }
  },
});
