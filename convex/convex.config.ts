import agent from '@convex-dev/agent/convex.config';
import migrations from '@convex-dev/migrations/convex.config.js';
import { defineApp } from 'convex/server';
import { v } from 'convex/values';

const app = defineApp({
  env: {
    TYPESAFE_API_KEY: v.optional(v.string()),
    OPENAI_CONVERSIONS_API_KEY: v.optional(v.string()),
    // Meta Events Manager dataset (pixel) ID and Conversions API access token.
    META_PIXEL_ID: v.optional(v.string()),
    META_CONVERSIONS_ACCESS_TOKEN: v.optional(v.string()),
  },
});
app.use(agent);
app.use(migrations);

export default app;
