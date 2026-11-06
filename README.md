# Kualia

Kualia is an envelope budgeting app. The hosted product has been sunset; this MIT-licensed repository preserves the app for local use and further development. It starts from a source snapshot with fresh Git history. The marketing site, blog, hosted documentation site, release automation, and production configuration are omitted.

## Start here

You need **Node.js 24** and **pnpm 12**. No Convex account, Clerk account, Docker, payment service, or bank connection is required.

```sh
nvm use                       # or install Node 24 with your preferred manager
corepack enable               # if pnpm is not already installed
pnpm install --frozen-lockfile
pnpm dev
```

Open **http://127.0.0.1:4200/signup**, create an account with an email address and a password of at least 8 characters, and complete onboarding. The email is an account identifier; local signup does not send mail or require email verification. Use the same origin consistently so your browser can restore your session.

Turborepo starts the local Convex backend, pushes functions and schema, generates local auth keys, configures password authentication and free self-hosted access, and then starts Angular. First startup needs internet access to download dependencies and the Convex backend binary. Subsequent development keeps your database on disk. Stop both tasks with Ctrl+C.

| Service | Address / storage |
| --- | --- |
| Angular web app | `http://127.0.0.1:4200` |
| Convex client API | `http://127.0.0.1:3210` |
| Convex HTTP actions and auth discovery | `http://127.0.0.1:3211` |
| Local database, uploaded files, deployment metadata | `.convex/` (ignored by Git) |
| Generated signing keys and startup state | `.local/` (ignored by Git) |
| CLI deployment selection | `.env.local` (generated, ignored by Git) |

Keep `.convex/` and `.local/` together when backing up a stopped local instance. They contain private data and credentials. Do not commit or publish them. The dev launcher rejects cloud credentials and non-anonymous deployment selectors instead of using an existing Convex project. If it reports a port conflict, stop the other process using ports 3210, 3211, or 4200. If you see a Node actions error, check `node --version` is 24.x and restart the dev command.

## What works without external services

Email/password accounts, manual accounts and transactions, budget categories and allocations, workspace onboarding, reports, imports/exports, and uploaded logos use local Convex. Choose an icon or upload your own logo through the existing logo picker; **Logo.dev is optional**. The self-hosted setup grants authenticated users app access without RevenueCat or Stripe. Workspace ownership checks still apply.

The optional integration code remains available for people extending the app. An integration's presence in the source does not mean it is configured. Missing API keys mean that feature is unavailable; core manual budgeting remains usable.

## Import an original Kualia budget

1. Sign in to your local Kualia account and open **Workspaces → Import from Kualia**, beside **Import from YNAB**. The same option appears on the workspace welcome screen and under **Settings → Export**.
2. Choose your original Kualia export ZIP (up to 8 MiB). If you already extracted it, select `bank-accounts.csv`, `categories.csv`, `plan.csv`, and `transactions.csv` together from the same export.
3. Review the counts, name the new workspace, and choose the currency used in the original budget. The archive stores amounts as decimals and omits the currency code.
4. Select **Import workspace**. Kualia opens the new workspace once the entire import succeeds. Existing budgets are kept separately.

The import restores account balances, categories and targets, monthly assignments and activity, and transaction history including splits and linked transfers. Accounts become manual accounts. Reconnect bank feeds and recreate recurring schedules, sharing, and workspace preferences separately. The ZIP contains budgeting records only. For a full local instance backup, follow the stopped-instance instructions above.

## Optional services

Backend secrets belong in **Convex environment variables**, not in Angular source or a frontend `.env` file. While `pnpm dev` is running, manage them from the repository root:

```sh
pnpm exec convex env set VARIABLE_NAME value --env-file .env.local
pnpm exec convex env list --env-file .env.local
```

Use your own credentials. Never paste real secrets into documentation, tests, issue reports, or commits. Public browser settings, when needed, live in `web/src/environments/environment.ts` and `environment.prod.ts`; private keys must never go there.

| Feature | Services / configuration | Without it |
| --- | --- | --- |
| Authentication | Convex Auth; `JWT_PRIVATE_KEY`, `JWKS`, and `SITE_URL` are generated/configured by `pnpm dev` | No hosted identity provider needed |
| App access | `SELF_HOSTED=true` is set by the local launcher | This is the default free local mode |
| Logo search | Logo.dev: `LOGO_DEV_SECRET_TOKEN` and `LOGO_DEV_PUBLIC_TOKEN`; browser `logoDev.token` for direct image URLs | Upload images or use the bundled icons |
| Bank sync | Plaid: `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, `PLAID_TRANSACTIONS_WEBHOOK` | Manual accounts, file imports, and manual transactions |
| Alternate bank provider | Salt Edge: `SALTEDGE_APP_ID`, `SALTEDGE_SECRET`, `SALTEDGE_PRIVATE_KEY`, `SALTEDGE_ENV` | No Salt Edge connections |
| AI assistant | OpenRouter: `OPENROUTER_API_KEY`; optional `KUALIA_DOCS_MCP_URL`; some features use `TYPESAFE_API_KEY` | Standard budgeting UI remains available |
| Email / family invitation delivery | Loops: `LOOPS_API_KEY`, `LOOPS_FAMILY_INVITE_TRANSACTIONAL_ID` | Local password signup works; automated mail is unavailable |
| Push notifications | Apple APNs: `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` | No native push notifications |
| Analytics / errors | PostHog backend `POSTHOG_API_KEY`, `POSTHOG_API_HOST`; frontend PostHog/Sentry settings | Tracking is disabled by default |
| Operator notifications | `DISCORD_WEBHOOK_URL` or channel-specific Discord webhook variables in `convex/lib/discord.ts` | No Discord reports |
| Hosted billing (legacy) | RevenueCat credentials and webhook secret, optionally `STRIPE_SECRET_KEY` | Not needed for self-hosted budgeting; enabling billing is a separate integration project |

External webhooks cannot reach localhost directly. Bank sync, mail, push, billing, feedback, AI, and telemetry integrations are not validated by the default local setup. Inspect the corresponding backend module before enabling them. Any legacy public-site links in optional features need replacing with your own URLs. Set `KUALIA_APP_URL` to your web origin when enabling generated links.

## Repository map

```text
web/                  @kualia/web — Angular client, UI, routes, services, tests
convex/               @kualia/backend — schema, auth, domain functions, HTTP routes
packages/shared/      @kualia/shared — currency, dates, shared domain helpers
public/               web assets and fonts (font licenses retained)
scripts/              local startup, safety checks, and validation scripts
iOS/                  archived SwiftUI client (see below)
.agents/skills/convex* generated Convex skills retained for coding agents
```

Root `angular.json`, `tsconfig*.json`, and `vite.config.ts` configure the existing Angular source layout and shared test suite. Dependencies are managed at the root; the web, backend, and shared workspace manifests expose the Turborepo task graph. `turbo.json` coordinates long-running dev tasks and build/typecheck dependencies.

### How a request flows

1. `web/src/app/pages/login/` calls `LocalAuthService` to sign in through Convex Auth's password provider.
2. `convex/auth.ts` manages password accounts, sessions, and JWT claims. `auth.config.ts` trusts this deployment's auth endpoints; `http.ts` registers them.
3. `ConvexService` supplies the token to Convex's reactive client. Route guards bootstrap a profile and select a workspace.
4. Domain functions under `convex/` validate inputs, call `lib/auth.ts`, check workspace access, and read/write indexed documents.
5. Convex subscriptions update Angular signals; no separate REST server or SQL database is required for the main UI.

Convex Auth's JWT subject includes both user and session IDs. `convex/lib/identity.ts` normalizes it to a stable user ID. Historical schema fields named `clerkId` and `ownerClerkId` now store that local user ID; they do **not** require Clerk. Never use the session-specific raw subject as a workspace owner. The old Clerk webhook route and web SDK are removed; some archived/internal naming remains for compatibility.

### Where to change a feature

| Change | Start with |
| --- | --- |
| Pages, navigation, route guards | `web/src/app/app.routes.ts`, `routes/`, `guards/`, `pages/` |
| Budget and transaction behavior | `convex/categoryBudgets/`, `convex/transactions/`, `convex/bankAccounts/` |
| Data ownership and sharing | `convex/lib/auth.ts`, `convex/workspaces/access.ts`, `convex/familyGroups/` |
| Database schema | `convex/schema.ts`; keep generated API types in sync |
| Local startup or ports | `scripts/dev-backend.mjs`, `local-ready.mjs`, `dev-web.mjs`, web environments |
| Uploaded / searched logos | `web/src/app/services/logo-*`, `convex/storage/`, `convex/logoDev.ts` |
| Icons | Existing `nucleo*` exports now contain Lucide artwork; `LICENSE-LUCIDE` applies |

## Development and checks

```sh
pnpm dev
pnpm lint
pnpm format
pnpm typecheck
pnpm build
pnpm test:ci
pnpm scan:secrets
node scripts/smoke-local.mjs   # optional integration check while pnpm dev is running
```

The smoke test creates synthetic accounts and a workspace in the ignored local database; it checks password rejection, token refresh/logout, cross-user isolation, ownership after a new login, and an export/import round trip.

`pnpm build` produces `web/dist/`. It does not deploy anything. `pnpm scan:secrets` scans Git-tracked source and checks for sensitive/generated paths; install Gitleaks for the additional full pattern scan (`gitleaks dir . --redact`, or scan a clean export to avoid private local state).

Agents should read `AGENTS.md`, then the scoped guide in `web/`, `convex/`, or `iOS/`. For backend changes also read `convex/_generated/ai/guidelines.md` and the relevant `.agents/skills/convex*/SKILL.md`. The generated files can be refreshed with `pnpm exec convex ai-files install`; review its diff and keep project-specific guidance in `AGENTS.md` rather than overwriting generated skills. Ordinary development must remain local unless explicitly asked to configure a different deployment.

## Archived iOS app

`iOS/` is retained as historical SwiftUI source. Its previous Clerk/RevenueCat login and subscription integration has **not** been ported to the local password flow. Service keys, signing team settings, App Store release scripts/metadata, and proprietary icon artwork have been removed or replaced. It is not started by `pnpm dev` and is not a supported local client yet. Port its auth provider and configure your own bundle IDs and signing before using it. No simulator validation was performed for this archive.

## Running beyond your own machine

The included command is a development setup, not a production deployment recipe. Passwords are hashed by Convex Auth; session tokens are stored in the browser and refreshed with rotation. Email verification and password recovery are not configured. Before exposing an instance to other people, configure HTTPS, backups, registration policy, verification/recovery, and the intended deployment's auth keys and URLs. Retired hosted Kualia credentials and endpoints must not be reused.

## License

Kualia source is MIT licensed. Lucide artwork has its own ISC/Feather notices in `LICENSE-LUCIDE`; fonts retain their bundled OFL notices. Third-party trademarks and provider logos remain the property of their respective owners.
