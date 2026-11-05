# Backend

See the root [README](../README.md) for the complete local setup and integration matrix, and [AGENTS.md](AGENTS.md) for backend development rules.

From the repository root, run `pnpm dev`. This starts an anonymous local deployment on port 3210, serves HTTP actions on 3211, initializes Convex Auth signing keys, sets `SELF_HOSTED=true`, and starts the web app after backend setup. No Convex or Clerk account is needed. The local database lives in ignored `.convex/`; generated private keys live in ignored `.local/`.

`auth.ts` defines email/password auth, `schema.ts` includes Convex Auth tables, and `http.ts` exposes auth discovery endpoints. Domain authorization uses `lib/identity.ts` and `lib/auth.ts`; historical fields named `clerkId` store stable local user IDs.

Generated guidance in `_generated/ai/` and skills under `../.agents/skills/convex*` are retained for coding agents. Refresh using `pnpm exec convex ai-files install` when needed.
