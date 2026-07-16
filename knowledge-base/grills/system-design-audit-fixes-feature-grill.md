---
slug: system-design-audit-fixes
milestone_id: SE43
generated_by: roadmap-feature
date: 2026-07-15
status: completed
source: derived from the two /loop-system-design audits run this session (sdk/src + monorepo). Findings are the grill answers.
---

# Feature grill — System Design Audit fixes (SE43)

## Q1 — What is this feature and why now?

Consolidate the **actionable findings from the two system-design audits** run this session into one
remediation milestone: the `packages/sdk/src` internals audit (STRONG 4.55/5, 1 HIGH) and the
`packages/` monorepo audit (STRONG 4.3/5, 3 MEDIUM). Nothing is broken today — every finding is a
**maintainability / hygiene** item that a Staff engineer flagged. **Why now:** the audits just ran and
the findings are captured with file:line evidence in `system-design-output/`; fixing them while the
context is fresh prevents the debt from rotting into a future refactor. Note: ID is **SE43**, not SE42
(SE42 is reserved for extended-thinking `--continue` / thinking-signature capture, provider-blocked, #122).

out_of_scope_overlap_false_positive: none — the findings are internal package/module hygiene; the
roadmap's "Explicitly out of scope" section is about NOT adopting Anthropic-SDK features. No overlap.

## Q2 — Dependencies (must be `[x]` before start)

- **SE41** ([x]) — the findings are about the post-SE41 codebase (the audits ran on `@theokit/sdk@4.1.0`).
  No other milestone is a hard dependency.

## Q3 — Definition of done (verifiable — the 4 audit findings)

1. **[HIGH — sdk/src audit] `internal/runtime` blast-radius reduced.** The 13,275-LOC / 111-file
   `internal/runtime` package is decomposed: `local-agent`, `cloud-agent`, and `session` are promoted to
   sibling `internal/*` packages (or clearly separated sub-modules with their own barrels), so the
   runtime package shrinks to orchestration. Verified: `dependency-cruiser` stays clean, `madge` cycles
   ≤ 3, per-file ≤ 400 LOC, full suite green, no public-API change.
2. **[MEDIUM — monorepo] `./internal/persistence` no longer a public export named `internal`.** The
   shared persistence primitives (`replaceFileAtomic`, `withCwdMutex`, `openSqliteResilient`,
   `sanitizeFts5Query`, `PersistenceSchema`, `atomicWriteText`) are exposed under a sanctioned public
   name (fold into `./persistence`, or a new `@theokit/persistence-kit` package). The old
   `./internal/persistence` export is either removed (major bump) OR kept as a deprecated alias for one
   release. `sdk-cache` + `sdk-memory` import the new path. No consumer breakage without a documented major.
3. **[MEDIUM — monorepo] Dev-only package cycle removed.** `@theokit/sdk` no longer lists
   `sdk-handoff`/`sdk-memory` as `devDependencies`; the sdk↔satellite integration tests move to a
   neutral test-only package or the examples workspace. Verified: `turbo` no longer warns
   "Circular: sdk-handoff, sdk, sdk-memory"; the runtime graph stays a clean DAG.
4. **[MEDIUM — monorepo] Satellite sdk version ranges tightened.** The 5 satellites declaring
   `@theokit/sdk: >=1.7.0` (sdk-tools/-memory/-cache/-handoff/-budget) are bumped to `>=4.0.0` (or `^4`),
   matching the v4-only surfaces they import. Verified: `pnpm install` resolves; no accidental old-sdk
   resolution possible outside the workspace.
5. **Evidence + gates:** docs.md/CHANGELOG updated for any public-surface change; ADR for the
   persistence-kit extraction (if taken); full quality gate (typecheck/biome/cycles/knip/depcruise) green;
   the two audit reports referenced as the source of truth.

## Q4 — Top 2 new risks

1. **`internal/runtime` split is the risky item (blast radius is the whole runtime).** Moving
   local-agent/cloud-agent/session risks import-cycle regressions (the exact thing the audit praised).
   Mitigation: do it behind the enforced gates (madge/depcruise run per commit); split incrementally
   (one sub-package at a time), each with the full suite green; keep public barrels stable.
2. **The `./internal/persistence` rename is a BREAKING export change** (consumed by 2 published siblings
   and possibly external users). Mitigation: ship a deprecated alias for one release (old path re-exports
   the new) OR gate the removal behind a v5 major with a codemod, per the repo's changeset discipline —
   never a silent break.
