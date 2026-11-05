# Kualia backend

Follow `../AGENTS.md` and read `_generated/ai/guidelines.md` before editing. Consult the applicable generated Convex skill under `../.agents/skills/`.

This backend uses Convex Auth passwords and workspace-scoped finance data. Use `lib/identity.ts` to normalize user IDs; do not use a raw session-specific JWT subject. `clerkId` names are historical schema compatibility fields. Use `lib/auth.ts` access helpers and `workspaces/access.ts` for ownership checks. Require authentication before public queries/actions/mutations and verify access to every referenced workspace/entity. Internal/webhook operations use their own validated authorization boundary.

Use workspace indexes, `v.id` references, bounded reads, existing soft-delete conventions, and ISO timestamps. Re-export domain APIs from their existing barrel files. Keep external I/O in actions; keep internal functions internal. Add tests for changed behavior and negative authorization cases.

`pnpm dev` targets anonymous local Convex. Never use cloud credentials to verify local work. Run root quality checks and confirm the local backend pushes successfully. Do not hand-edit `_generated/api.ts`; regenerate after adding/removing modules. Keep generated guidance and skills in source control.
