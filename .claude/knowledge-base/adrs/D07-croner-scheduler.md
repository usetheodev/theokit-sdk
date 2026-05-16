---
id: D7
status: Decided
date: 2026-05-16
plan: sdk-v1-ga-completion
---

# D7 — `croner` is the locked cron scheduler library

## Context
The in-process cron scheduler at `packages/sdk/src/internal/cron/scheduler.ts` uses `croner`. Open Decision in CLAUDE.md asked whether to swap to `node-cron` (simpler, no timezone) or `cron` (mature, larger).

## Decision
`croner` stays. No swap to `node-cron` or `cron`.

## Rationale
- **Zero deps** — `croner` is dependency-free; `cron` pulls `luxon`; `node-cron` pulls nothing but lacks correct timezone handling around DST boundaries.
- **TS-native** — first-class types.
- **DST + timezone correctness** — verified via `croner`'s test suite; `node-cron` documented as DST-unsafe.
- **Bundle size** — smallest of the three (~6 KB minified).

## Consequences
- Documented as a locked choice. Future replacement requires an ADR superseding D7.
- `package.json` keeps `croner` as a direct dep.

## Alternatives Considered
- **`node-cron`** — rejected; DST-unsafe per its docs.
- **`cron`** — rejected; pulls `luxon` transitive dep.
- **Hand-rolled** — rejected; cron expression parsing is non-trivial (`L`/`W`/`#` extensions).
