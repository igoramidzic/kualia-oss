# Backend

See the root [README](../README.md) for the complete local setup and integration matrix, and [AGENTS.md](AGENTS.md) for backend development rules.

From the repository root, run `pnpm dev`. This starts an anonymous local deployment on port 3210, serves HTTP actions on 3211, initializes Convex Auth signing keys, sets `SELF_HOSTED=true`, and starts the web app after backend setup. No Convex or Clerk account is needed. The local database lives in ignored `.convex/`; generated private keys live in ignored `.local/`.

`auth.ts` defines email/password auth, `schema.ts` includes Convex Auth tables, and `http.ts` exposes auth discovery endpoints. Domain authorization uses `lib/identity.ts` and `lib/auth.ts`; historical fields named `clerkId` store stable local user IDs.

Generated guidance in `_generated/ai/` and skills under `../.agents/skills/convex*` are retained for coding agents. Refresh using `pnpm exec convex ai-files install` when needed.

## Module status

Most folders here are core budgeting domains. The modules below have historical or hosted-product names; check this list before assuming one is dead or needs an outside service. Only the core rows run without configuration.

| Module | Status | Needs | Without it |
| --- | --- | --- | --- |
| `clerk.ts`, `clerk/queries.ts` | Load-bearing (historical name) | Nothing. Looks up `userProfile` by the local user ID stored in `clerkId`; used by `lib/auth.ts`, YNAB import, notifications, and RevenueCat | Required |
| `ads/types.ts`, `ads/attribution.ts` | Load-bearing cleanup shim | Nothing. `schema.ts` validates the legacy `adAttribution` profile field; onboarding and old clients call `clearAdAttribution` to erase stored click data. No ad data is sent anywhere | Required while the field exists |
| `financeKit/` | Load-bearing for bank connections; client is the archived iOS app | Apple FinanceKit on iOS. `bankConnections/` and `bankLinks/` read its tables | Web never creates FinanceKit connections |
| `revenuecat/` | Optional legacy billing (README "Hosted billing") | RevenueCat credentials and webhook secret, optionally `STRIPE_SECRET_KEY`. Serves `/revenuecat-webhook`, the weekly expired-access Plaid cleanup cron, family/app-access checks, and account-deletion billing cancellation | `SELF_HOSTED=true` grants access; the cron and webhook have nothing to act on |
| `discord.ts`, `discord/`, `lib/discord.ts` | Optional operator notifications | `DISCORD_WEBHOOK_URL` or the channel variables in `lib/discord.ts`. Used by the daily signup report cron, data-integrity validation reports, and some operator alerts | Messages are skipped |
| `notifications/` | Optional mail and push | Loops (`LOOPS_*`) for email, APNs (`APNS_*`) for push | No automated mail or push notifications |
| `logoDev.ts` | Optional logo search | `LOGO_DEV_SECRET_TOKEN`, `LOGO_DEV_PUBLIC_TOKEN` | Upload logos or use bundled icons |
| `bankProviders/` (Plaid, Salt Edge) | Optional bank sync | `PLAID_*` or `SALTEDGE_*` | Manual accounts and file imports |
| `aiChat/`, `llmCategorization/`, `mcp/` | Optional AI features | `OPENROUTER_API_KEY` (and the other AI variables in the root README) | Standard budgeting UI |
| `home/`, `appChangelog/` | Archived iOS client APIs | Nothing server-side; the web app doesn't call them | Unused by web |
| `migrations/` | One-off data migrations | Nothing. Kept so older local databases can still be upgraded | Not run automatically |

Removed as hosted-only dead code (no routes, crons, or callers): the Clerk user webhook and its mutations, `ads/conversions.ts`, `debug/` operator scripts, and the ProductLane SSO action.
