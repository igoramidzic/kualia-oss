import type { AuthConfig } from 'convex/server';

export default {
  providers: [{ domain: process.env.CONVEX_SITE_URL ?? 'http://127.0.0.1:3211', applicationID: 'convex' }],
} satisfies AuthConfig;
