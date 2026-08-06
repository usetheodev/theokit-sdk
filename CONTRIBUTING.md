# Contributing to `@theokit/sdk`

Thanks for helping build the Theo **Harness**. The essentials are inline below; the exported TypeScript types are the canonical API contract (start from the [Harness Capability Map](./docs/harness-capability-map.md)) and the project conventions/toolchain/quality-gates live in [`CLAUDE.md`](./CLAUDE.md). The code is the documentation.

## Quick start

```bash
nvm use                                   # Node 22.12+
corepack enable && corepack prepare pnpm@9.15.0 --activate
pnpm install
pnpm validate                             # build + typecheck + test + lint + quality gates
```

See [`CLAUDE.md` § First-time setup](./CLAUDE.md) for Node/pnpm details.

## Branch model (important)

- **All work happens on `develop`.** Features, fixes, refactors, docs, chores — everything commits to `develop`. We do **not** use feature branches by default.
- **`main` is release-only.** It receives release merges (`develop → main` PR + a semver tag) — never direct commits.
- Never use `git checkout` (use `git switch` / `git restore`), `git revert` (write an explicit reversing commit), `git reset --hard` (use `git stash` / `--soft`), or `git push --force` on `main`/`develop`.

## Commit conventions

- Conventional-commit prefixes: `feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `style`.
- **No `Co-Authored-By` trailer** (enforced by a git hook).
- Reference the plan/task ID when there is one.

## Before you open a PR

- [ ] `pnpm validate` is green locally (or the specific package's `build` + `typecheck` + `test`).
- [ ] **TDD** — the failing test came first; a bug fix ships with its regression test. See [`.claude/rules/testing.md`](./.claude/rules/testing.md).
- [ ] **Public API changed?** Update the exported types + [`docs/harness-capability-map.md`](./docs/harness-capability-map.md) **in the same PR** — this is quality gate G11. See [`CLAUDE.md`](./CLAUDE.md) (locked names + conventions).
- [ ] `CHANGELOG.md` `[Unreleased]` entry added, and a **changeset** (`pnpm changeset`) if the change is user-visible. Releases cut via Changesets (`develop → main` PR + semver tag).
- [ ] Lint + format clean (`pnpm check` — Biome).

## Quality gates

The push is gated by G1–G11 hard gates (lint, typecheck, tests, coverage, dead-code, dependency cycles, layered-architecture, bundle size, docs-drift). One tool per gate; **fix the code, not the threshold.** Details: `.claude/quality-gates.md` (**absent** — verified 2026-08-06; the gates are defined in `.github/workflows/` and the `.claude/rules/` files).

## Where things live

`theokit-sdk` is a pnpm-workspaces + turbo monorepo of 13 publishable packages (flagship `@theokit/sdk` at `packages/sdk/`). Layout + the contract-vs-implementation split: [`packages/README.md`](./packages/README.md) and [`CLAUDE.md`](./CLAUDE.md).

## Getting help

Questions, ideas, or a heads-up before a large change are welcome — open a discussion or reach out via the links in the [README](./README.md).
