# Agents Guide - Kualia Web

Scope: applies to files under `web/`.
Parent guide: `../AGENTS.md`.

If guidance conflicts, follow the most specific guide for the code you are editing.

## Stack

- Angular 21.x (zoneless, standalone)
- Vite + Analog
- Spartan NG (Brain/Helm)
- Tailwind CSS v4
- Signals + Convex queries/mutations
- Vitest + Angular Testing Utilities

## Non-Negotiable Rules

1. Do not use `any`; use concrete types or `unknown`.
2. Prefer `??` over `||` for defaults.
3. Type catch blocks as `unknown`.
4. Do not add NgModules.
5. Do not set `standalone: true` in component decorators.
6. Always use `ChangeDetectionStrategy.OnPush`.
7. Add/update tests for behavior changes.

## Angular Patterns

- Use `signal()` for local state and `computed()` for derived values.
- Do not use signal `mutate()`; use `set()`/`update()`.
- Use `input()` and `output()` for component APIs.
- Prefer `inject()` over constructor DI.
- Use native control flow (`@if`, `@for`, `@switch`).
- Keep templates simple and move complex logic to TS.
- Use direct `class`/`style` bindings, not `ngClass`/`ngStyle`.
- Keep authenticated workspace routes under `/:workspaceShortId/*`; account settings use `/settings/*`.

## Styling

- Use Tailwind utilities and existing design tokens.
- Keep shared/global styling in `web/src/styles.css`.
- Avoid inline styles unless there is a clear one-off need.

## Testing

- Place tests next to source files as `*.spec.ts`.
- Use Arrange-Act-Assert structure.
- Mock dependencies with `vi.fn()` / `vi.mock()`.
- Cover both happy paths and edge/error paths.

## Validation Commands

Run from repo root before commit:

1. `pnpm lint`
2. `pnpm format`
3. `pnpm build`
4. `pnpm test:ci`
