# Contributing to Kualia

Thanks for helping. This guide only covers how to contribute. The [README](README.md) has setup, architecture, and optional services.

## Get set up

Follow [README → Start here](README.md#start-here). You need Node.js 24 (`.nvmrc`) and pnpm 12 (the `packageManager` field). `pnpm install` refuses other Node versions. Core budgeting runs entirely on local Convex, with no cloud accounts or secrets.

## Read the guides

- [`AGENTS.md`](AGENTS.md) covers repository-wide engineering rules: auth and workspace ownership, money handling, validation, and secret boundaries. They apply to human contributors too.
- Then read the guide for the area you are changing: [`web/AGENTS.md`](web/AGENTS.md), [`convex/AGENTS.md`](convex/AGENTS.md), or [`iOS/AGENTS.md`](iOS/AGENTS.md) (archived).
- For backend work, also read `convex/_generated/ai/guidelines.md` and the relevant `.agents/skills/convex*/SKILL.md`.

## Before opening a pull request

```sh
pnpm format   # apply formatting fixes
pnpm check    # format:check, lint, typecheck, build, test:ci, scan:secrets
```

CI runs `pnpm check` on every pull request. After auth, access, or export changes, also run `pnpm smoke` while `pnpm dev` is running. To review UI changes or reproduce a bug with realistic data, run `pnpm seed` while `pnpm dev` is running; it loads a synthetic demo budget and prints its local login. See [README → Development and checks](README.md#development-and-checks).

Keep changes small and follow the existing patterns. Add or update tests for behavior changes, and use synthetic data only. If you change startup, auth, environment variables, or integrations, update README and the relevant guide in the same pull request. The pull request template has the full checklist.
