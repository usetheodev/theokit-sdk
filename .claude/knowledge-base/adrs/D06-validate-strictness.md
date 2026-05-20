---
id: D6
status: Decided
date: 2026-05-16
plan: sdk-v1-ga-completion
---

# D6 — `pnpm validate` is strict on both `publint` and `attw`

## Context
`pnpm validate` chains: `check + typecheck + build + test + publint + attw + quality`. Strictness on the `publint`/`attw` steps was undefined — they ran but the failure-mode for warnings was implicit.

## Decision
`pnpm validate` fails if EITHER `publint` reports a problem OR `attw` reports any non-🟢 finding. No warning-only mode.

## Rationale
Both tools catch real publish-breakers (missing types, ESM/CJS dual-export bugs, package.json `exports` mismatches). A "warnings OK" mode invites warnings to become errors post-publish — when fixing them is much more expensive.

## Consequences
- A new `attw` finding on a new entry point blocks publish until fixed.
- Contributors adding new files under `packages/sdk/src/` must validate locally before pushing.
- CI workflow (`.github/workflows/ci.yml`) runs both as separate steps so failures are visually distinct.

## Alternatives Considered
- **publint-strict, attw-advisory** — rejected; attw findings have caused real bugs before (verified in OSS ecosystem).
- **Both advisory** — rejected; defeats the purpose of running them.
