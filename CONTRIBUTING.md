# Contributing to `@theokit/sdk`

Thanks for helping build the Theo **Harness**. The essentials are inline below; the exported TypeScript types are the canonical API contract. The code is the documentation.

By taking part you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md). Security problems do **not** go in an issue — see [SECURITY.md](./SECURITY.md).

## Quick start

```bash
nvm use                                   # Node 22.12+
corepack enable && corepack prepare pnpm@9.15.0 --activate
pnpm install
pnpm validate                             # build + typecheck + test + lint + quality gates
```

`pnpm validate` is what CI runs. If it is green locally it is usually green in CI — with one caveat worth knowing: turbo caches test results per package, and a change to a **root** file (`package.json`, the lockfile) does not invalidate that cache. After touching a root dependency, force a real run:

```bash
npx turbo run test --filter='./packages/*' --force
```

## Branch model

The flow is `workspace → develop → main`.

- **All work happens on `workspace`.** Features, fixes, refactors, docs, chores — everything commits there. We do **not** use feature branches by default.
- **`develop` integrates.** It only advances through a `workspace → develop` pull request.
- **`main` is release-only.** It receives release merges (`develop → main` PR + a semver tag) — never direct commits.
- `main` is protected by a ruleset: pull request required, force-push and deletion blocked, and the CI checks must pass before a merge.
- Never use `git checkout` (use `git switch` / `git restore`), `git revert` (write an explicit reversing commit), `git reset --hard` (use `git stash` / `--soft`), or `git push --force` on `main`/`develop`.

## Commit conventions

- Conventional-commit prefixes: `feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `style` / `ci` / `perf` / `build`.
- **No AI co-author trailers** (enforced by a git hook).
- Reference the issue or plan ID when there is one.
- Say *why*, not only *what*. A message that explains the reasoning is the only place that reasoning survives.

## Before you open a PR

- [ ] `pnpm validate` is green locally (or the specific package's `build` + `typecheck` + `test`).
- [ ] **TDD** — the failing test came first; a bug fix ships with its regression test.
- [ ] **Public API changed?** Update the exported types in the same PR — they are the contract.
- [ ] A **changeset** (`pnpm changeset`) if the change is user-visible. Changelogs are generated per package by Changesets under `packages/*/CHANGELOG.md`; there is no root changelog to edit.
- [ ] Lint + format clean (`pnpm check` — Biome).

## Test structure

Structure every test as **Arrange → Act → Assert**, separated by a blank line, no comment markers required:

```ts
it("enters plan mode", () => {
  const tool = createPlanModeTool();

  const result = JSON.parse(tool.handler({ action: "enter" }));

  expect(result.ok).toBe(true);
  expect(result.mode).toBe("plan");
});
```

That is the suite's de-facto style today — measured across all 817 test files, 2.2% carry explicit
`// Arrange` / `// Act` / `// Assert` comments or a `Given/When/Then` test name, but a sampled read
found the same three-part shape present and readable in unmarked files too, just without the labels.
This declares the convention `rules/testing.md` § 3 asks every repo to pick, without demanding a
rewrite: existing files named in `Given/When/Then` style stay as they are — converting them buys
nothing a reader doesn't already have, and the churn isn't worth it. Write new tests as AAA with a
blank line between each part; comment markers are optional and add little once the blank line does
the separating.

## Quality gates

The push is gated locally by `.githooks/pre-push`, and again in CI. Every gate is one tool, and the rule is **fix the code, not the threshold**:

| Gate | Command | What it refuses |
| --- | --- | --- |
| Lint / format | `pnpm check` | Biome findings |
| Types | `pnpm typecheck` | any type error |
| Tests | `pnpm test` | a failing or newly skipped test |
| Dead code | `pnpm quality:dead` + `quality:dead-internal` | unreachable exports, dead private symbols |
| Cycles | `pnpm quality:cycles` | any import cycle (threshold 0) |
| Layering | `pnpm quality:depcruise` | a dependency pointing the wrong way |
| Cluster boundary | `pnpm quality:cross-cluster` | importing an extracted sibling repo |
| File size | `pnpm quality:loc` | a source file over 400 LoC |
| Duplication | `pnpm quality:duplication` | a copied block in `packages/sdk/src` |
| Docs drift | `pnpm quality:capability-map` | a documented import that no longer resolves |
| Dependencies | `pnpm quality:audit` | a known vulnerability in a shipped dependency |
| Bundle size | `pnpm check:bundle` | a package over its `.bundle-budget.json` |

CI adds a Node `22.12` / `22` matrix, CodeQL, dependency review on pull requests, and an OpenSSF Scorecard run.

## Where things live

`theokit-sdk` is a pnpm-workspaces + turbo monorepo of 12 publishable packages (flagship `@theokit/sdk` at `packages/sdk/`). Layout and the contract-vs-implementation split: [`packages/README.md`](./packages/README.md).

## Getting help

Open an issue — the [templates](https://github.com/usetheokit/theokit-sdk/issues/new/choose) ask for the details that make a report actionable. A heads-up before a large change is welcome and usually saves you a rewrite.
