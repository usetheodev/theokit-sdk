# D194 — `commander@12` for CLI subcommand routing

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`@usetheo/cli` uses `commander@^12` for argv parsing + subcommand
dispatch + `--help` / `--version` generation. Each subcommand
(`init`, `dev`, `inspect`, `eval`) registers via
`.command(name).action(handler)`. Top-level `program.exitOverride()`
converts commander's internal throw-on-exit pattern to our exit code
contract (0/1/2).

## Rationale

- **Battle-tested**: 38M weekly downloads, zero runtime deps, supports
  nested subcommands.
- **Mastra precedent** — same library.
- **Existing two SDK bins (`theokit-migrate-*`) use a hand-rolled argv
  parser** — works for single-purpose tools but doesn't scale to 4+
  subcommands with shared flags + auto-help.

Alternatives rejected:

- **`yargs`** — heavier API surface, more boilerplate.
- **`clipanion`** — TypeScript-first but smaller adoption.
- **Hand-rolled** — 3-day effort for what commander gives in 1h; not
  worth the divergence from sibling SDKs.

## Consequences

- Enables: standard `--help` / `--version`, subcommand composition.
- Constrains: one runtime dep (~50KB after tree-shake). Acceptable.
