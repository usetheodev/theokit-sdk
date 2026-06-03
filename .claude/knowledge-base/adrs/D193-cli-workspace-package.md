# D193 — `@theokit/cli` ships as a separate workspace package

**Date:** 2026-05-22
**Status:** Accepted

## Decision

The `theokit` CLI lives in a NEW workspace package `@theokit/cli` under
`packages/cli/` — not embedded in `@theokit/sdk`. The SDK declares no
CLI dependency; consumers who only `import` the library don't pull
`commander`, `@clack/prompts`, or `tsx` into their tree.

## Rationale

- **SDK is a library; CLI is an executable.** Mixing concerns inflates
  SDK install size for non-CLI users and forces the SDK to ship CLI
  deps as runtime requirements.
- **Mastra precedent** — `mastra` CLI as `packages/cli` separate from
  `@mastra/core` (verified at `referencia/mastra/packages/cli/`).
- **Independent versioning** — CLI can ship patch fixes without bumping
  SDK semver (e.g., template tweaks, scaffolder bugs).
- **Tree-shaking discipline** — SDK barrel stays minimal; cli surface
  area grows as CLI grows without affecting library consumers.

Alternatives rejected:

- **Embed `theokit` bin in `@theokit/sdk/bin/`** (existing pattern for
  `theokit-migrate-memory`). Would force `commander` + `@clack/prompts`
  into SDK runtime deps, ballooning the SDK install for every consumer.

## Consequences

- Enables: independent CLI semver, smaller SDK install, clean tree-shake.
- Constrains: CLI declares `@theokit/sdk` as a regular dep (not peer),
  so `init` templates pin to a known-good version. Each CLI release
  semver-pins one SDK version; major bumps coordinated.
