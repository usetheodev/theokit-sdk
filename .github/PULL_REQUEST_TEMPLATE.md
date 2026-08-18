<!-- See CONTRIBUTING.md. Work happens on `develop`; `main` is release-only. -->

## What & why

<!-- One or two sentences: what this changes and the motivation. Link any plan/task/issue. -->

## Checklist

- [ ] `pnpm validate` green locally (or the touched package's `build` + `typecheck` + `test`)
- [ ] Test added **first** (TDD); a bug fix ships with its regression test
- [ ] Public API changed? Exported types updated in this PR
- [ ] `CHANGELOG.md` `[Unreleased]` entry added; changeset added if user-visible (`pnpm changeset`)
- [ ] Lint + format clean (`pnpm check` — Biome)
- [ ] No `Co-Authored-By` trailer; commits follow the conventional-commit prefixes

## Notes for the reviewer

<!-- Anything non-obvious: trade-offs, follow-ups, areas that want a closer look. -->
