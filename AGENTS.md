# Agent guide — Kualia open source

Read `README.md` first for setup, architecture, optional services, and the archived iOS limitations. Use the most specific guide: `web/AGENTS.md`, `convex/AGENTS.md`, or `iOS/AGENTS.md`.

The `AGENTS.md` files are the single source of truth. Each directory's `CLAUDE.md` only imports its sibling `AGENTS.md` for Claude Code, and `.claude/skills` is a relative symlink to `.agents/skills`; edit the `AGENTS.md` files, not the wrappers.

## Scope and defaults

Kualia is a local-first envelope budgeting app. The web client is Angular 21; Convex provides the database, reactive queries, mutations, actions, file storage, and password authentication. This is a pnpm/Turborepo workspace with root-managed dependencies and existing `web/` and `convex/` source paths. iOS is archived and is not wired to the new auth system. Marketing sites and production release infrastructure are intentionally excluded.

Use Node 24 and pnpm 12; `pnpm install` rejects other Node versions through `devEngines.runtime` in the root `package.json`. `pnpm install --frozen-lockfile`, then `pnpm dev`, starts anonymous local Convex and Angular. No cloud account, Docker, Clerk, Logo.dev, Plaid, or payment provider is required for core budgeting. Read the optional-services table in README before enabling an integration. Custom logo uploads use Convex storage and need no Logo.dev account.

For UI review or bug reproduction, `pnpm seed` (while `pnpm dev` runs) loads a synthetic demo budget and prints its local login (`demo@example.test` / `kualia-demo-budget`). Its data comes from `scripts/seed-data.mjs` and is imported through `kualiaImport.restore`; keep the generator in sync with schema or import changes, and keep it local-only via `assertLocalDeployment`.

## Before changing code

1. Locate the feature's page/service, backend barrel file and domain folder, schema tables, and neighboring tests.
2. Follow existing patterns and reuse components. Keep changes small and explicit.
3. For backend work, read `convex/_generated/ai/guidelines.md` first, then the relevant generated `.agents/skills/convex*/SKILL.md`. Keep these files; refresh using `pnpm exec convex ai-files install` only when needed and review the changes. Claude Code finds the same skills through the `.claude/skills` symlink.
4. Inspect actual schema and access helpers. Historical generated guides may describe orgId; this app's financial data is scoped by workspaceId. The code and this guide take precedence over stale generic examples.

## Authentication and ownership

- Local email/password auth is configured in `convex/auth.ts`, `auth.config.ts`, `http.ts`, and `schema.ts` (`authTables`).
- `web/src/app/services/local-auth.service.ts` handles login, session storage, token rotation, and logout. `ConvexService` attaches tokens to subscriptions.
- Use `getIdentity` from `convex/lib/identity.ts`, or higher-level `requireAuth` / `requireUserProfile` / `requireWorkspaceAccess` helpers. It converts Convex Auth's userId|sessionId subject to the stable user ID.
- Existing `clerkId` / `ownerClerkId` fields contain local user IDs. Do not infer Clerk is needed from these names or rename these fields casually.
- Check authorization before reading or mutating financial data. Derive users from validated identities, never caller-supplied user IDs. Scope reads with workspace indexes; verify ownership of referenced documents.
- `SELF_HOSTED=true` removes the subscription requirement; it does not remove authentication or workspace access checks.

## Engineering rules

- Never introduce `any`; use precise types or `unknown`. Type catch blocks as `unknown`.
- Prefer `??` for defaults. Follow standalone Angular, signals, OnPush, native template control flow, and existing design tokens.
- Use object-form Convex functions with argument and return validators for new functions. Keep server-only operations internal. Use indexes and bounded reads.
- Financial amounts use the existing bigint/currency helpers; do not introduce floating-point money arithmetic.
- Preserve soft-delete, ISO timestamp, and activity-log patterns.
- Add/update tests for behavior changes. Do not turn off failing tests to hide a regression.
- Icons live in `web/src/app/icons/`: use `kualia*` exports, `<kualia-icon>`, and `kualiaIcons` / `KualiaIconName`. The artwork is Lucide (`LICENSE-LUCIDE`); preserve license notices and the saved catalog names (`KualiaIconName` keys and `legacyIconNames`).

## Validation

CI (`.github/workflows/ci.yml`) runs `pnpm check` on every pull request and push to `main`. Before a commit run `pnpm lint`, `pnpm format`, `pnpm typecheck`, `pnpm build`, `pnpm test:ci`, and `pnpm scan:secrets`. `pnpm check` runs the same list in one command (it uses `format:check`, so run `pnpm format` first to apply fixes). Scoped guides defer to this list rather than keeping their own.

With `pnpm dev` running, `pnpm smoke` runs `scripts/smoke-local.mjs` against the local database: password rejection, token refresh/logout, cross-user isolation, and an export/import round trip. Run it after auth, access, or export changes. After backend changes verify the running local `pnpm dev` pushes successfully and refresh generated types. Verify auth changes with separate users and sessions, including unauthorized access attempts. Use synthetic data only.

Do not run iOS simulators unless explicitly requested for the current task. Archived iOS changes use source review and build-only validation when applicable.

## Deployment and secret boundaries

- The default dev scripts target only anonymous local Convex. Never silently switch to the old product or any cloud deployment.
- Never copy `.env`, `.convex`, `.local`, signing material, production data exports, logs, or Git history into a release. Do not print credentials while debugging.
- Backend secrets go into the target Convex environment. Angular environments are public build inputs.
- `.convex/` stores private local data; `.local/auth-keys.json` stores generated private signing material. Both are ignored. Stop the backend before backing them up.
- Optional integrations require the user's own credentials and configuration. Keep them disabled by default and update README when their setup changes.
- Never hard-code or fall back to the retired hosted domains (`kualia.com`, `app.kualia.com`, `docs.kualia.com`, `api.kualia.com`). Build backend links with `convex/lib/appUrl.ts` (`KUALIA_APP_URL`, default `http://127.0.0.1:4200`), and use app-relative links in the web client. Integrations that call external servers, such as the docs MCP (`KUALIA_DOCS_MCP_URL`) and the Plaid redirect (`PLAID_REDIRECT_URI`), stay off unless configured.
- Email verification/recovery and public hosting are separate work; do not claim production readiness from a local smoke test.

## Documentation upkeep

When changing startup, workspace structure, auth, required environment variables, or integration behavior, update README and the relevant guide in the same change. Document which service is required, which feature needs it, where configuration belongs, and what users can do without it. Prefer updating existing documentation rather than creating overlapping guides. Preserve the generated Convex skill files separately from project-specific instructions.
