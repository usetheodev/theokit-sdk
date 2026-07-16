---
id: D433
status: Decided
date: 2026-07-15
plan: system-design-audit-fixes
milestone: SE43
---

# D433 — Fold the shared persistence kernel into the existing public `./persistence` barrel (not a new package)

## Context

The 2026-07-15 monorepo system-design audit (`system-design-output/final_report.md § MEDIUM — internal/persistence`) flagged that `@theokit/sdk/internal/persistence` is a **public export named `internal`** — a semantic contradiction. Two published satellites (`@theokit/sdk-cache`, `@theokit/sdk-memory`) plus `@theokit/sdk-tools` import 7 low-level primitives from it (`replaceFileAtomic`, `atomicWriteText`, `atomicWriteJson`, `openSqliteResilient`, `withCwdMutex`, `sanitizeFts5Query`, `PersistenceSchema`), so `sdk` cannot change or remove it without breaking them: it is effectively a public shared kernel, mislabeled `internal`. The repo already ships a sanctioned public `@theokit/sdk/persistence` barrel that already exported 4 of the 7 primitives.

## Decision

Expose the 3 missing primitives (`withCwdMutex`, `sanitizeFts5Query`, `PersistenceSchema`) from the **already-public** `@theokit/sdk/persistence` barrel; migrate the 13 satellite src import sites to it; keep `@theokit/sdk/internal/persistence` as a **deprecated alias** that re-exports its FULL current surface UNCHANGED for one release, then remove at a future major.

## Rationale

`./persistence` already exists and already exported half the kernel. Folding the remaining 3 in is the parsimony-ladder rung-1 answer — a new `@theokit/persistence-kit` package does not need to exist when a public barrel already does. One sanctioned name, zero new packages, zero new publish pipeline, no version-sync burden.

## Alternatives considered

- **Extract a new `@theokit/persistence-kit` package** — REJECTED: adds a package + publish pipeline + version-sync burden for 6-7 primitives that both sides already reach via `sdk`; violates YAGNI/KISS for a maintainability fix.
- **Remove `./internal/persistence` immediately (hard major break)** — REJECTED: breaks external consumers with no migration window. The deprecated-alias path is a non-breaking release; removal is scheduled, not abrupt.
- **Shrink the alias to re-export `./persistence`** — REJECTED (EC-1): `./internal/persistence` exports a SUPERSET (`createExclusive`, `casUpdate`, `appendJsonl`, `getTheokitHome`, `containsCjk`, …) that is NOT on the public barrel; re-exporting only the public subset would silently drop those, breaking external consumers — the exact "silent consumer break" the DoD forbids. The alias keeps its full export list; only a `@deprecated` JSDoc banner is added.

## Consequences

- Enables satellites (and external consumers) to depend on a correctly-named public surface; regression-locked by `tests/persistence-public-surface.test.ts` (public barrel exposes the kernel) + `tests/persistence-deprecated-alias.test.ts` (alias preserves its full superset, EC-1).
- Constrains: the deprecated alias MUST be removed in a tracked future major (a follow-up milestone), not left forever. `docs.md` documents the deprecation.
