---
slug: system-design-audit-fixes
milestone_id: SE43
created_at: 2026-07-15
goal: Remediate the 4 actionable findings from the two 2026-07-15 /loop-system-design audits with zero public-API break.
---

# Plan: System-Design Audit Fixes (SE43)

> **Version 1.1** — (v1.1 absorbs edge-case MUST-FIX EC-1 + EC-2 from `knowledge-base/reviews/system-design-audit-fixes-edge-cases-2026-07-15.md`: the deprecated persistence alias must preserve its FULL current export surface, not shrink to the public subset; and the relocated peer tests must be proven to execute before sdk's satellite devDeps are removed. SHOULD-TEST EC-3/EC-4 folded into T1.1 / T4.x.) Remediate the 4 actionable findings from the two `/loop-system-design` audits run 2026-07-15 (`packages/sdk/src` internals: STRONG 4.55/5, 1 HIGH; `packages/` monorepo: STRONG 4.3/5, 3 MEDIUM). All findings are maintainability/hygiene — nothing is broken today. The plan is sequenced **safest-first** (version ranges → dev-cycle → persistence rename → runtime split) so each phase ships independently behind the enforced quality gates (madge ≤ 3, dependency-cruiser clean, per-file ≤ 400 code-LoC, full suite green), and the one HIGH (runtime blast-radius) lands last, incrementally, one module per commit. Expected outcome: the two audits' remediations are all `[x]` with no public-API regression.

## Goal

> "Enable the `@theokit/*` monorepo to pass both 2026-07-15 system-design audits' remediations so that the 1 HIGH + 3 MEDIUM findings are resolved with zero public-API break, measured by `pnpm -w run validate` staying green AND `turbo run build` emitting no `Circular:` warning."

## Context

Two `/loop-system-design` audits ran 2026-07-15 against `@theokit/sdk@4.1.0`:

- **`packages/sdk/src` internals** — STRONG 4.55/5, one HIGH: `internal/runtime` is a 13,275-LoC / 111-file package (blast radius = the whole runtime touches everything).
- **`packages/` monorepo topology** (`system-design-output/final_report.md`) — STRONG 4.3/5, three MEDIUM: (a) `./internal/persistence` is a public export named `internal`; (b) a dev-only package cycle `sdk ↔ sdk-handoff/sdk-memory`; (c) loose `>=1.7.0` sdk peer-range on 5 satellites while sdk is at 4.1.0.

Nothing is broken — every finding is hygiene a Staff engineer flagged in review. Fixing them now, while the file:line evidence is fresh in `system-design-output/`, prevents the debt from rotting into a future large refactor. Requirements were captured in the completed grill `knowledge-base/grills/system-design-audit-fixes-feature-grill.md` (SE43 DoD).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/package.json` | — | `c529bfd2` (2026-07-15) | sdk manifest; declares exports + devDeps | `exports` map keeps every existing public subpath; remove only the 2 satellite devDeps |
| `packages/sdk/src/persistence.ts` | ~30 | `e640c4c8` (2026-07-15) | Public `./persistence` barrel (SE40) | Every symbol currently exported stays exported |
| `packages/sdk/src/internal/persistence/index.ts` | ~25 | `301d4a30` (2026-06-22) | `./internal/persistence` barrel (shared kernel) | Kept as deprecated alias re-exporting the public barrel for one release |
| `packages/sdk-tools/package.json` | — | `35731e24` (2026-07-15) | sdk-tools manifest | peer-range only widened floor to `>=4.0.0`; no other change |
| `packages/sdk-memory/package.json` | — | `80a54dd5` (2026-07-14) | sdk-memory manifest | peer-range floor `>=4.0.0` |
| `packages/sdk-cache/package.json` | — | `d161c0ae` (2026-07-03) | sdk-cache manifest | peer-range floor `>=4.0.0` |
| `packages/sdk-handoff/package.json` | — | `e75d698f` (2026-06-18) | sdk-handoff manifest | peer-range floor `>=4.0.0` |
| `packages/sdk-budget/package.json` | — | `b5b21114` (2026-06-22) | sdk-budget manifest | peer-range floor `>=4.0.0` |
| `packages/sdk-cache/src/cache.ts` | — | (baseline) | imports persistence primitives | switch import to `@theokit/sdk/persistence` |
| `packages/sdk-cache/src/internal/store-json.ts` | — | (baseline) | imports persistence primitives | switch import to `@theokit/sdk/persistence` |
| `packages/sdk-memory/src/**` (10 files) | — | (baseline) | import persistence primitives | switch import to `@theokit/sdk/persistence` |
| `packages/sdk-tools/src/artifact-store.ts` | — | (baseline) | imports persistence primitives | switch import to `@theokit/sdk/persistence` |
| `packages/sdk/src/internal/runtime/local-agent/**` (17 files, 2826 LoC) | — | `afe6cf98` (2026-07-15) | Local runtime agent | Moves to `internal/local-agent/`; public barrels byte-stable |
| `packages/sdk/src/internal/runtime/cloud/**` (6 files, 1107 LoC) | — | `d039cd63` (2026-07-10) | Cloud runtime agent | Moves to `internal/cloud-agent/`; public barrels byte-stable |
| `packages/sdk/src/internal/runtime/session/**` (3 files, 394 LoC) | — | (baseline) | Runtime session store/types | Moves to `internal/session/`; 0 external importers |
| `ROADMAP.md` | — | (baseline) | Roadmap | Fix SE43 numbering collision (line 1260 deferred note) |
| `packages/sdk/CHANGELOG.md` | — | (baseline) | Per-package changelog | Add `[Unreleased]` entries |
| `packages/sdk/docs.md` | — | (baseline) | Public API contract | Reflect the sanctioned `./persistence` primitives |
| `.claude/knowledge-base/adrs/D433-persistence-public-kernel.md` (NEW) | 0 | — | ADR for the persistence rename | — |

Test files (co-located `*.test.ts` per `rules/testing.md § Test pairing convention`) are created per task in the TDD blocks below and are additionally listed here as `(NEW)` when they do not exist.

### Current callers / dependents

- **Symbol:** `./internal/persistence` export (barrel) — primitives `replaceFileAtomic`, `withCwdMutex`, `openSqliteResilient`, `sanitizeFts5Query`, `PersistenceSchema`, `atomicWriteText`.
  - **Callers (production, cross-package):** `packages/sdk-cache/src/cache.ts`, `packages/sdk-cache/src/internal/store-json.ts`, `packages/sdk-memory/src/{in-memory-provider,index}.ts`, `packages/sdk-memory/src/internal/{categorized-memory,index/index-db,index/index-manager,dreaming/dreaming-diary,dreaming/dreaming-run,store/transcript-store,store/session-summary-writer,store/markdown-store}.ts`, `packages/sdk-tools/src/artifact-store.ts` (13 src sites).
  - **External (other repos):** yes — `@theokit/sdk/internal/persistence` is a declared public export; external consumers may exist. Removal is therefore deferred behind a deprecated alias (one release).
- **Symbol:** `internal/runtime/local-agent/*` — **2** external src importers (outside the dir).
- **Symbol:** `internal/runtime/cloud/*` — **1** external src importer.
- **Symbol:** `internal/runtime/session/*` — **0** external src importers.
- **Symbol:** sdk `devDependencies` `@theokit/sdk-handoff` + `@theokit/sdk-memory` (`packages/sdk/package.json:369-370`) — consumed only by integration tests: `packages/sdk/tests/{peer-parity,memory-class-peer-routing,migrate-peer-routing,internal/memory/sdk-memory-peer-loader}.test.ts`. Production peer loading is by dynamic package-name string (`src/internal/memory/sdk-memory-peer-loader.ts`), NOT a static import — so removing the devDeps does not touch the runtime graph.

### Domain glossary

- **satellite** — a `@theokit/*` package that depends on the `sdk` hub (sdk-memory, sdk-tools, sdk-cache, sdk-handoff, sdk-budget, acp, cli, memory-*).
- **peer loader** — sdk production code (`sdk-memory-peer-loader.ts`) that dynamically `import()`s a memory peer by package-name string at runtime (BYO-memory feature); no static dependency edge.
- **shared kernel** — the low-level persistence primitives (`replaceFileAtomic`, `withCwdMutex`, `openSqliteResilient`, `sanitizeFts5Query`, `PersistenceSchema`, `atomicWriteText`) that both sdk and two published satellites depend on.
- **dev-only cycle** — a cycle that exists only via `devDependencies` (turbo build-ordering warning); the published/runtime graph stays a DAG.
- **blast radius** — the number of modules affected by a change to one module; the audit's HIGH is that `internal/runtime` (111 files) has runtime-wide blast radius.

### Architecture boundaries affected

Per `rules/architecture.md`: this plan does NOT change dependency **direction** (satellites still depend only on the sdk hub; inner layers still import nothing outward). It (a) **narrows** the public export surface of the shared kernel to a sanctioned name (DoD#2), (b) **removes** a dev-only edge (DoD#3), (c) **narrows** peer version floors (DoD#4), and (d) **relocates** three sub-modules within `internal/` to reduce one package's cohesion pressure without crossing any layer (DoD#1 — the moved modules keep the same inward-only import direction). No new outward import is introduced. The public API surface (`Agent`, `Cron`, `Theokit`, `./persistence`, error hierarchy) stays byte-stable.

## Prior Art & Related Work

- **Internal audit reports (the deep research for this milestone):** `system-design-output/final_report.md` (monorepo topology, 3 MEDIUM with file:line) and the `packages/sdk/src` internals audit (STRONG 4.55/5, 1 HIGH). These are cited as the source-of-truth findings per the grill.
- **Grill (requirements):** `knowledge-base/grills/system-design-audit-fixes-feature-grill.md` — Q3 DoD is the contract; Q4 risks feed `## Drawbacks & Risks`.
- **Rules consumed:** `rules/architecture.md` (§ 1 layering, § 2 DIP, § 3 cohesion), `rules/testing.md` (§ 5 pairing convention), `rules/parsimony-ladder.md` (rung 1 "does it need to exist" applied to the persistence-kit decision — we reuse the existing `./persistence` barrel instead of adding a new `@theokit/persistence-kit` package). Repo conventions: madge ≤ 3, dependency-cruiser DIP-clean, changeset discipline.
- **Patterns skills:** none in `skills/*-patterns/` match "system design / monorepo hygiene" (scanned — no keyword overlap). "(none applicable)".
- **Reference projects:** none needed — this is internal restructuring of our own code (per `cycle-discover.md` anti-pattern: do NOT discover prior art for your own symbols).

## Objective

- [ ] DoD#4 — 5 satellite peer-ranges bumped `>=1.7.0` → `>=4.0.0`; `pnpm install` resolves.
- [ ] DoD#3 — sdk `devDependencies` on `sdk-handoff`/`sdk-memory` removed; the 4 peer integration tests relocated; `turbo run build` emits no `Circular:` warning; runtime graph still a DAG (0 cycles).
- [ ] DoD#2 — the 6 shared-kernel primitives are all exported from the sanctioned public `./persistence`; the 13 satellite src import sites switched; `./internal/persistence` kept as a deprecated alias for one release; ADR recorded; docs.md updated.
- [ ] DoD#1 — `local-agent`, `cloud-agent`, `session` promoted to sibling `internal/*` modules with their own barrels; `internal/runtime` shrinks by ~4327 LoC; madge ≤ 3, depcruise clean, per-file ≤ 400 code-LoC, full suite green, NO public-API change.
- [ ] Hygiene — ROADMAP SE43 numbering collision resolved (line 1260 deferred note renumbered).
- [ ] Gates — `pnpm -w run validate` green; CHANGELOG updated; no changeset for internal-only moves except the persistence public-surface change.

## ADRs

### D433 — Fold the shared persistence kernel into the existing public `./persistence` barrel (not a new package)

- **Decision:** Export the 3 missing primitives (`withCwdMutex`, `sanitizeFts5Query`, `PersistenceSchema`) from the already-public `./persistence` barrel; migrate satellites to import from `@theokit/sdk/persistence`; keep `./internal/persistence` as a deprecated alias that re-exports the public barrel for one release, then remove at the next major.
- **Rationale:** `./persistence` already exists and already exports half the primitives (`replaceFileAtomic`, `openSqliteResilient`, `atomicWriteText`). Folding into it is the parsimony-ladder rung-1 answer ("does a new `@theokit/persistence-kit` need to exist? no — a public barrel already does"). One sanctioned name, zero new packages, no new publish pipeline.
- **Alternatives considered:** (a) **Extract `@theokit/persistence-kit`** — rejected: adds a package + publish pipeline + version-sync burden for 6 primitives both sides already reach via sdk; violates YAGNI. (b) **Remove `./internal/persistence` immediately (major bump)** — rejected: breaks external consumers with no migration window; the deprecated-alias path is a non-breaking release.
- **Consequences:** Enables satellites to depend on a correctly-named public surface. Constrains: the deprecated alias must be removed in a tracked follow-up (a new milestone), not left forever.

### D434 — Relocate `local-agent`/`cloud-agent`/`session` to sibling `internal/*` modules, incrementally, one per commit

- **Decision:** `git mv internal/runtime/{local-agent,cloud,session}` → `internal/{local-agent,cloud-agent,session}`, each with its own barrel `index.ts`; fix import paths; one module per commit; the full suite + madge + depcruise run per commit.
- **Rationale:** The audit HIGH is `internal/runtime`'s runtime-wide blast radius. The 3 named modules have 0-2 external importers, so the move is low-risk and tool-verified (madge/depcruise catch any cycle regression at commit time). Incremental commits keep each step revertible.
- **Alternatives considered:** (a) **Leave in place, only add barrels** — rejected: does not reduce the package's file count / cohesion pressure the audit flagged; barrels alone don't shrink blast radius. (b) **Big-bang move all 3 in one commit** — rejected: a single failing gate would force reverting all three; the grill risk#1 mandates incremental.
- **Consequences:** Enables `internal/runtime` to shrink to orchestration. Constrains: import paths across ~3 external importers change (mechanical); public barrels must stay byte-stable (no public-API change is a hard DoD).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| The `internal/runtime` split (DoD#1) risks import-cycle regressions — the exact property the audit praised | High | Split incrementally (one module per commit) behind madge ≤ 3 + dependency-cruiser gates run per commit; each commit keeps the full suite green; public barrels byte-stable | implementer |
| The `./internal/persistence` change (DoD#2) touches a public export consumed by 2 published siblings + possibly external users | Medium | Ship a deprecated alias re-exporting the public barrel for one release (D433); never a silent removal; ADR + changeset + docs.md in the same PR | implementer |
| Relocating the 4 peer integration tests (DoD#3) could drop real coverage if the new home doesn't install the peers | Medium | Move tests to a home that has the peers as devDeps (a neutral test-only package or examples-workspace); assert the 4 tests still run + pass in their new location before removing sdk's devDeps | implementer |
| Widening peer floors to `>=4.0.0` (DoD#4) could surface a satellite that actually still supports old sdk | Low | The 5 satellites import v4-only surfaces (e.g. `./internal/persistence`); the floor was already a lie; `pnpm install` + full satellite suites confirm resolution | implementer |

## Unresolved Questions

- Q1 — Where should the 4 relocated peer integration tests live: a NEW neutral `packages/sdk-peer-integration-tests` (private, test-only) OR the existing `tools/examples-workspace`? (Leaning: a private test-only package keeps them in `turbo test` without polluting examples. `/edge-case-plan` to confirm.)
- Q2 — Does any satellite OTHER than the 5 named (e.g. acp, cli, memory-honcho) import `@theokit/sdk/internal/persistence`? (Baseline grep says no; re-verify at implementation time before flipping the alias.)
- Q3 — Should the deprecated `./internal/persistence` alias removal be filed as its own follow-up milestone now, or tracked in CHANGELOG only? (Leaning: file as SE44+ so the debt is scheduled, per D433 consequence.)

## Dependencies

No new third-party dependencies are introduced by this plan (Rule 9 / parsimony-ladder rung 1–4: every capability reuses code already present).

| Dependency | Version | Kind | New? | Rule-9 justification |
|---|---|---|---|---|
| `@theokit/sdk` | `>=4.0.0` (was `>=1.7.0`) | peerDependency of 5 satellites | tightened floor, not added | existing peer; only the floor literal changes (DoD#4) |
| `@theokit/sdk`, `@theokit/sdk-handoff`, `@theokit/sdk-memory` | `workspace:*` | devDependencies of the NEW `packages/sdk-peer-integration-tests` | new *internal* workspace edges only | reuses existing workspace packages; no registry install (DoD#3) |

- **New third-party packages:** none.
- **CVE surface:** unchanged — no new registry dependency enters the tree. `pnpm install --frozen-lockfile` (Phase 5) proves resolution with no new advisory.
- The new `packages/sdk-peer-integration-tests` is a **private** (`"private": true`), unpublished, test-only workspace member — it never ships to npm.

## Dependency Graph

```
Phase 1 (DoD#4 version ranges) ──▶ Phase 2 (DoD#3 dev-cycle) ──▶ Phase 3 (DoD#2 persistence) ──▶ Phase 4 (DoD#1 runtime split) ──▶ Phase 5 (Integration Validation)
        │ safest, isolated              │ removes devDeps            │ public-surface change          │ the one HIGH, incremental
        └── independently shippable ────┴── each phase = full gate green before the next starts ──────┘
```

All phases are **sequential** (safest-first). No two phases run in parallel — each must leave `pnpm -w run validate` green before the next begins, so a regression is always localized to one phase.

---

## Phase 1: DoD#4 — Tighten satellite peer-ranges

**Objective:** Bump the `@theokit/sdk` peer-range floor on the 5 satellites from `>=1.7.0` to `>=4.0.0`.

### T1.1 — Bump peer-range floors on 5 satellites

#### Objective
Change `peerDependencies["@theokit/sdk"]` from `>=1.7.0` to `>=4.0.0` in sdk-tools, sdk-memory, sdk-cache, sdk-handoff, sdk-budget.

#### Why this step (action + reasoning)
1. **What this step does** — edits the `peerDependencies` block of 5 satellite `package.json` files, floor `1.7.0` → `4.0.0`.
2. **Why it is necessary now** — the satellites import v4-only surfaces (e.g. `./internal/persistence`); the `>=1.7.0` floor is a lie that lets a non-workspace install resolve an incompatible old sdk (`system-design-output/final_report.md § MEDIUM — Loose >=1.7.0`). Doing it first is safest — no code moves, only manifest metadata.

#### Evidence
`system-design-output/final_report.md:56-58`; baseline: all 5 declare `peerDependencies["@theokit/sdk"] = >=1.7.0` (confirmed) while sdk is `4.1.0`.

#### Files to edit
```
packages/sdk-tools/package.json   — peer floor >=1.7.0 → >=4.0.0
packages/sdk-memory/package.json  — peer floor >=1.7.0 → >=4.0.0
packages/sdk-cache/package.json   — peer floor >=1.7.0 → >=4.0.0
packages/sdk-handoff/package.json — peer floor >=1.7.0 → >=4.0.0
packages/sdk-budget/package.json  — peer floor >=1.7.0 → >=4.0.0
packages/sdk/tests/peer-range-floors.test.ts (NEW) — RED: assert no satellite peer-range floor < 4.0.0
```

#### Deep file dependency analysis
Each satellite manifest keeps its `devDependencies["@theokit/sdk"] = workspace:*` (unchanged — that's how the workspace resolves in-repo). Only the published `peerDependencies` floor changes. No source file depends on the range literal except the NEW guard test.

#### Deep Dives
- Invariant: `devDependencies` stays `workspace:*` (else in-repo build breaks).
- Edge case: keep any upper bound if present (baseline shows bare `>=1.7.0`, so result is `>=4.0.0`).

#### TDD
```
RED:     test_peer_range_floors_all_at_least_v4() — reads the 5 satellite package.json, asserts each peerDependencies["@theokit/sdk"] parses to a floor >= 4.0.0 (fails today: floors are 1.7.0)
GREEN:   edit the 5 manifests to >=4.0.0
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk test peer-range-floors
```

#### Concurrency tests

(none — single-threaded) — package.json manifest metadata edits; no runtime code.

#### Acceptance Criteria
- [ ] All 5 satellites declare `peerDependencies["@theokit/sdk"] >= 4.0.0`
- [ ] `pnpm install` resolves cleanly (no peer-range conflict)
- [ ] `pnpm -w run validate` green
- [ ] `pnpm biome check` exit 0 (manifests only; N/A per-file LoC)

#### DoD
- [ ] Guard test green
- [ ] `pnpm install` clean
- [ ] CHANGELOG `[Unreleased]` note added

---

## Phase 2: DoD#3 — Remove the dev-only package cycle

**Objective:** Remove sdk's `devDependencies` on `sdk-handoff`/`sdk-memory` by relocating the 4 peer integration tests; `turbo run build` emits no `Circular:` warning.

### T2.1 — Relocate the 4 peer integration tests to a neutral test-only home

#### Objective
Move `peer-parity`, `memory-class-peer-routing`, `migrate-peer-routing`, `sdk-memory-peer-loader` integration tests out of `packages/sdk/tests/` into a home that legitimately devDepends on the peers, then delete sdk's 2 satellite devDeps.

#### Why this step (action + reasoning)
1. **What this step does** — creates a private test-only package (per Q1 resolution), moves the 4 tests + their fixtures there, removes `@theokit/sdk-handoff` + `@theokit/sdk-memory` from `packages/sdk/package.json` devDependencies.
2. **Why it is necessary now** — those devDeps are the sole cause of the turbo `Circular: sdk-handoff, sdk, sdk-memory` warning (`system-design-output/final_report.md § MEDIUM — Dev-only cycle`). Production peer loading is dynamic-by-string, so removing the devDeps does not touch the runtime graph. Doing it after Phase 1 keeps each change isolated.

#### Evidence
`packages/sdk/package.json:369-370`; the 4 test files import the peer packages (baseline grep); `src/internal/memory/sdk-memory-peer-loader.ts` loads by dynamic string (no static edge).

#### Files to edit
```
packages/sdk-peer-integration-tests/package.json (NEW) — private, test-only; devDeps: sdk + sdk-handoff + sdk-memory
packages/sdk-peer-integration-tests/tsconfig.json (NEW)
packages/sdk-peer-integration-tests/tests/*.test.ts (MOVED, 4 files + fixtures)
packages/sdk/package.json — remove 2 satellite devDependencies (lines 369-370)
pnpm-workspace.yaml — (verify the new package is matched by the members glob)
```

#### Deep file dependency analysis
The 4 tests exercise the BYO-memory peer contract; they need the real peer packages installed. Their new home devDepends on them, so `turbo test` still runs them. `packages/sdk/package.json` loses only the 2 satellite devDeps — its production deps (none `@theokit/*`) and its other devDeps are untouched.

#### Deep Dives
- Invariant: the 4 tests keep asserting the same peer behavior in their new location (behavior-preserving move).
- Edge case: fixtures referenced by relative path must move with the tests; update relative imports.
- Concurrency: (none — single-threaded test relocation).

#### TDD
```
RED:     test_peer_integration_suite_runs_from_new_home() — asserts the relocated package reports >= 4 passing tests before any devDep removal (the 4 relocated tests ARE the regression suite)
GREEN (ordered, EC-2):
   1. create packages/sdk-peer-integration-tests (devDeps: sdk + sdk-handoff + sdk-memory); move the 4 tests + fixtures
   2. ASSERT the new package runs ≥ 4 passing tests — `pnpm --filter @theokit/sdk-peer-integration-tests test` must NOT report "no tests found" (false-green guard, EC-2)
   3. ONLY after step 2 is green: remove the 2 satellite devDeps from packages/sdk/package.json
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk-peer-integration-tests test && pnpm --filter @theokit/sdk test && turbo run build 2>&1 | grep -c 'Circular' | grep -qx 0
```

#### Deep Dives
- **EC-2 invariant (MUST FIX):** the devDep removal (step 3) is gated on step 2's green — a new package with a mis-wired `test` script auto-discovers via the `packages/*` glob but could silently run 0 tests. Removing sdk's devDeps before proving the relocated suite executes would drop the BYO-memory peer regression net with no red signal. The ≥ 4-passing assertion is the gate.

#### Concurrency tests

(none — single-threaded) — behavior-preserving test relocation + manifest edit; no new concurrent code path.

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk-peer-integration-tests test` reports ≥ 4 passing (exit 0)
- [ ] `packages/sdk/package.json` no longer lists `sdk-handoff`/`sdk-memory` in `devDependencies`
- [ ] `turbo run build` emits zero `Circular:` warnings
- [ ] `pnpm quality:cycles` reports 0 new cycles (exit 0)
- [ ] `pnpm -w run validate` green

#### DoD
- [ ] Circular warning gone (grep proof)
- [ ] 4 tests green in new location
- [ ] CHANGELOG `[Unreleased]` note

---

## Phase 3: DoD#2 — Sanction the persistence public surface

**Objective:** Export the 6 shared-kernel primitives from the public `./persistence`; migrate the 13 satellite src import sites; keep `./internal/persistence` as a deprecated alias for one release.

### T3.1 — Export the 3 missing primitives from `./persistence` + ADR

#### Objective
Add `withCwdMutex`, `sanitizeFts5Query`, `PersistenceSchema` to the public `./persistence` barrel (the other 3 are already there); write ADR D433.

#### Why this step (action + reasoning)
1. **What this step does** — extends `packages/sdk/src/persistence.ts` to re-export the 3 primitives satellites need that are currently only on `./internal/persistence`; records D433.
2. **Why it is necessary now** — `./persistence` already exports `replaceFileAtomic`/`openSqliteResilient`/`atomicWriteText`; adding the missing 3 makes the sanctioned name complete so satellites can stop importing `internal` (`system-design-output/final_report.md § MEDIUM — internal/persistence`). Must precede the migration (T3.2).

#### Evidence
Baseline: `./persistence` MISSING `withCwdMutex`, `sanitizeFts5Query`, `PersistenceSchema` (grep proof); `./internal/persistence/index.ts` exports all 6.

#### Files to edit
```
packages/sdk/src/persistence.ts — add re-exports of withCwdMutex, sanitizeFts5Query (+ containsCjk sibling), PersistenceSchema
packages/sdk/docs.md — document the sanctioned persistence primitives
.claude/knowledge-base/adrs/D433-persistence-public-kernel.md (NEW)
packages/sdk/tests/persistence-public-surface.test.ts (NEW) — RED: import all 6 from @theokit/sdk/persistence
```

#### Deep file dependency analysis
`persistence.ts` re-exports from `./internal/persistence/*` files (already the pattern). Adding 3 more re-export lines. `docs.md` is the public contract — must reflect the new sanctioned exports (CLAUDE.md checklist). No behavior change; pure surface addition.

#### TDD
```
RED:     test_persistence_public_barrel_exports_all_six() — imports { replaceFileAtomic, withCwdMutex, openSqliteResilient, sanitizeFts5Query, PersistenceSchema, atomicWriteText } from the built ./persistence entry; asserts each is defined (fails today for 3)
GREEN:   add the 3 re-exports
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk test persistence-public-surface
```

#### Concurrency tests

(none — single-threaded) — pure re-export surface addition; no runtime behavior change.

#### Acceptance Criteria
- [ ] All 6 primitives importable from `@theokit/sdk/persistence`
- [ ] `docs.md` updated
- [ ] `D433` section contains ≥ 1 `Alternatives considered` entry (grep exit 0)
- [ ] `pnpm -w run validate` green (incl. publint/attw on the new surface)

#### DoD
- [ ] Public-surface test green
- [ ] docs.md + ADR committed
- [ ] CHANGELOG `[Unreleased] § Added`

### T3.2 — Migrate 13 satellite src imports + deprecate `./internal/persistence`

#### Objective
Switch the 13 satellite src import sites to `@theokit/sdk/persistence`; convert `./internal/persistence/index.ts` into a deprecated alias re-exporting the public barrel.

#### Why this step (action + reasoning)
1. **What this step does** — rewrites the import specifier in 13 files (sdk-cache 2, sdk-memory 10, sdk-tools 1) from `@theokit/sdk/internal/persistence` to `@theokit/sdk/persistence`; marks `./internal/persistence` `@deprecated` and makes it re-export the public barrel.
2. **Why it is necessary now** — completes the rename so no satellite depends on an `internal`-named public export; the deprecated alias keeps external consumers working for one release (D433). Must follow T3.1 (the public surface must exist first).

#### Evidence
Baseline: 13 real src import sites of `@theokit/sdk/internal/persistence` (enumerated in `## Baseline Context § Current callers`).

#### Files to edit
```
packages/sdk-cache/src/{cache,internal/store-json}.ts — import from @theokit/sdk/persistence
packages/sdk-memory/src/{in-memory-provider,index}.ts + src/internal/{categorized-memory,index/index-db,index/index-manager,dreaming/dreaming-diary,dreaming/dreaming-run,store/transcript-store,store/session-summary-writer,store/markdown-store}.ts — import from @theokit/sdk/persistence
packages/sdk-tools/src/artifact-store.ts — import from @theokit/sdk/persistence
packages/sdk/src/internal/persistence/index.ts — add @deprecated JSDoc banner ONLY; keep the FULL current export list unchanged (EC-1)
packages/sdk/tests/persistence-deprecated-alias.test.ts (NEW) — RED: alias still exports its FULL current surface (back-compat)
```

#### Deep file dependency analysis
Each satellite src file changes only the import specifier (same symbol names: the 7 they use — `atomicWriteJson`, `atomicWriteText`, `openSqliteResilient`, `PersistenceSchema`, `replaceFileAtomic`, `sanitizeFts5Query`, `withCwdMutex` — all now on the public barrel after T3.1). The alias file (`internal/persistence/index.ts`) keeps ALL its current exports intact so external consumers who import internal-only symbols (`appendJsonl`, `loadJsonl`, `readJsonlIds`, `createExclusive`, `casUpdate`, `getTheokitHome`, `getProfilesRoot`, `displayTheokitHome`, `containsCjk`) do NOT break — it is merely marked deprecated, NOT shrunk to the public subset (EC-1).

#### Deep Dives
- **EC-1 invariant (MUST FIX):** `./internal/persistence` currently exports a **superset** of `./persistence`. The alias MUST preserve the full superset — it is NOT `export * from "../../persistence.js"` (that would silently drop `appendJsonl`/`createExclusive`/`casUpdate`/`getTheokitHome`/etc., breaking external consumers = the "silent consumer break" the DoD forbids). Correct approach: leave the export list byte-identical, add only an `@deprecated` JSDoc banner + a `@see ./persistence` pointer.

#### TDD
```
RED:     test_deprecated_alias_preserves_full_surface() — snapshots the set of symbols exported by @theokit/sdk/internal/persistence BEFORE the change; asserts the alias still exports every one of them AFTER (back-compat guard, EC-1)
RED:     test_no_satellite_src_imports_internal_persistence() — greps satellite src (non-test); asserts 0 hits of "@theokit/sdk/internal/persistence"
GREEN:   rewrite the 13 satellite imports to @theokit/sdk/persistence; add @deprecated banner to internal/persistence/index.ts WITHOUT removing any export
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk-cache --filter @theokit/sdk-memory --filter @theokit/sdk-tools test && pnpm --filter @theokit/sdk test persistence-deprecated-alias
```

#### Concurrency tests

(none — single-threaded) — import-specifier rewrites + @deprecated banner; the withCwdMutex/withFileLock primitives are re-exported unmodified, their own race tests unchanged.

#### Acceptance Criteria
- [ ] 0 satellite src files import `@theokit/sdk/internal/persistence`
- [ ] `./internal/persistence` alias still exports all 6 (external back-compat)
- [ ] `pnpm --filter @theokit/sdk-cache --filter @theokit/sdk-memory --filter @theokit/sdk-tools test` exit 0
- [ ] `pnpm -w run validate` green
- [ ] `pnpm quality:loc` exit 0 (every changed file ≤ 400 code-LoC)

#### DoD
- [ ] Both guard tests green
- [ ] Alias marked `@deprecated` with the removal-milestone note
- [ ] CHANGELOG `[Unreleased] § Changed` (deprecation) + a changeset for the sdk public-surface change

---

## Phase 4: DoD#1 — Reduce `internal/runtime` blast-radius (the HIGH)

**Objective:** Promote `local-agent`, `cloud-agent`, `session` to sibling `internal/*` modules with their own barrels, one module per commit, shrinking `internal/runtime` by ~4327 LoC with no public-API change.

### T4.1 — Promote `session` → `internal/session` (0 external importers, lowest risk)

#### Objective
`git mv internal/runtime/session` → `internal/session`; add barrel; fix intra-runtime import paths.

#### Why this step (action + reasoning)
1. **What this step does** — moves the 3-file / 394-LoC `session` module out of `runtime/`, adds `internal/session/index.ts`, updates the import paths that referenced `runtime/session`.
2. **Why it is necessary now** — `session` has **0** external src importers (baseline) — the safest first move to prove the split mechanics + gates before touching higher-blast modules. Cites D434.

#### Evidence
Baseline: `runtime/session` = 0 external importers; 3 files (`agent-session-store`, `agent-session`, `session-types`).

#### Files to edit
```
packages/sdk/src/internal/session/** (MOVED from internal/runtime/session/**)
packages/sdk/src/internal/session/index.ts (NEW barrel)
(import-path fixups in intra-runtime referrers — enumerated at implement time via grep)
```

#### Deep file dependency analysis
Moves 3 files; the only referrers are within `runtime/` (0 external). Each referrer's import specifier updates from `../session/...` to `../../session/...` (or the barrel). No symbol renamed.

#### TDD
```
RED:     test_session_relocated_no_cycle_regression() — run BEFORE (baseline) and AFTER the move; asserts madge cycles <= 3 and depcruise clean
GREEN:   git mv; add barrel; fix import paths
REFACTOR: route intra-runtime importers through the new barrel
VERIFY:  pnpm --filter @theokit/sdk exec -- true && pnpm quality:cycles && pnpm quality:depcruise && pnpm --filter @theokit/sdk test
```

#### Concurrency tests

(none — single-threaded) — file relocation only; no shared-state semantics change.

#### Acceptance Criteria
- [ ] `internal/runtime/session` no longer exists; `internal/session` does with a barrel
- [ ] `pnpm quality:cycles` reports ≤ 3 cycles (exit 0); `pnpm quality:depcruise` exits 0
- [ ] `pnpm --filter @theokit/sdk test` exit 0; `pnpm quality:loc` exit 0 (every file ≤ 400)
- [ ] `diff` of built `dist/*.d.ts` public barrels returns exit 0 (byte-identical)

#### DoD
- [ ] Move committed atomically (one commit)
- [ ] Gates green post-move

### T4.2 — Promote `cloud` → `internal/cloud-agent` (1 external importer)

#### Objective
`git mv internal/runtime/cloud` → `internal/cloud-agent`; add barrel; fix the 1 external + intra-runtime import paths.

#### Why this step (action + reasoning)
1. **What this step does** — moves the 6-file / 1107-LoC `cloud` module, adds `internal/cloud-agent/index.ts`, updates the 1 external importer + intra-runtime referrers.
2. **Why it is necessary now** — second-lowest blast radius (1 external importer). Cites D434; follows T4.1's proven mechanics.

#### Evidence
Baseline: `runtime/cloud` = 1 external importer; 6 files, 1107 LoC; biggest `cloud-agent.ts` (357 LoC, under budget).

#### Files to edit
```
packages/sdk/src/internal/cloud-agent/** (MOVED from internal/runtime/cloud/**)
packages/sdk/src/internal/cloud-agent/index.ts (NEW barrel)
(1 external importer + intra-runtime referrers — enumerated at implement time)
```

#### Deep file dependency analysis
Moves 6 files; 1 external src importer updates its specifier; public barrel that re-exports the cloud agent surface (if any) stays byte-stable.

#### TDD
```
RED:     test_cloud_agent_relocated_no_cycle_regression() — before+after; asserts madge cycles <= 3, depcruise clean
GREEN:   git mv; barrel; fix the 1 external + intra importers
REFACTOR: route through barrel
VERIFY:  pnpm quality:cycles && pnpm quality:depcruise && pnpm --filter @theokit/sdk test
```

#### Concurrency tests

(none — single-threaded) — file relocation only.

#### Acceptance Criteria
- [ ] `internal/cloud-agent` exists with barrel; `runtime/cloud` gone
- [ ] `pnpm quality:cycles` ≤ 3 (exit 0); `pnpm quality:depcruise` exit 0; `pnpm --filter @theokit/sdk test` exit 0
- [ ] `diff` of built `dist/*.d.ts` public barrels returns exit 0 (byte-identical)

#### DoD
- [ ] One atomic commit; gates green

### T4.3 — Promote `local-agent` → `internal/local-agent` (2 external importers)

#### Objective
`git mv internal/runtime/local-agent` → `internal/local-agent`; add barrel; fix the 2 external + intra-runtime import paths.

#### Why this step (action + reasoning)
1. **What this step does** — moves the 17-file / 2826-LoC `local-agent` module, adds `internal/local-agent/index.ts`, updates the 2 external importers + intra-runtime referrers.
2. **Why it is necessary now** — highest blast radius of the three (2 external importers, largest LoC); done LAST when the mechanics are proven twice. Cites D434 + grill risk#1.

#### Evidence
Baseline: `runtime/local-agent` = 2 external importers; 17 files, 2826 LoC; biggest `local-agent.ts` (534 raw / <400 code-LoC — already gate-green).

#### Files to edit
```
packages/sdk/src/internal/local-agent/** (MOVED from internal/runtime/local-agent/**)
packages/sdk/src/internal/local-agent/index.ts (NEW barrel)
(2 external importers + intra-runtime referrers — enumerated at implement time)
```

#### Deep file dependency analysis
Moves 17 files; 2 external src importers update specifiers. The local runtime is on the primary tested path (SE40/SE41), so the full suite (incl. native-transcript integration tests) is the strongest regression signal.

#### TDD
```
RED:     test_local_agent_relocated_no_cycle_regression() — before+after; asserts madge cycles <= 3, depcruise clean
GREEN:   git mv; barrel; fix the 2 external + intra importers
REFACTOR: route through barrel; confirm internal/runtime shrank by ~4327 LoC total across T4.1-T4.3
VERIFY:  pnpm quality:cycles && pnpm quality:depcruise && pnpm --filter @theokit/sdk test
```

#### Concurrency tests

(none — single-threaded) — file relocation only; local-agent's own concurrency behavior is unchanged and covered by its existing integration tests.

#### Acceptance Criteria
- [ ] `internal/local-agent` exists with barrel; `runtime/local-agent` gone
- [ ] `internal/runtime` shrank by ~4327 LoC across the 3 moves (`find internal/runtime -name '*.ts' | wc -l` drops by 26 files)
- [ ] `pnpm quality:cycles` ≤ 3 (exit 0); `pnpm quality:depcruise` exit 0; `pnpm --filter @theokit/sdk test` exit 0 (incl. native-transcript integration tests)
- [ ] `diff` of built `dist/*.d.ts` public barrels returns exit 0 (byte-identical)

#### DoD
- [ ] One atomic commit; gates green
- [ ] CHANGELOG `[Unreleased] § Changed` (internal restructuring, no public-API change)

### T4.4 — Fix the ROADMAP SE43 numbering collision

#### Objective
Resolve the collision where line 1260 reserves "SE43 — migration importer" while line 1315 is the formal `### SE43` this milestone.

#### Why this step (action + reasoning)
1. **What this step does** — renumbers the deferred prose note (line ~1260) from "SE43 — migration importer" to the next free ID so "SE43" unambiguously means this milestone.
2. **Why it is necessary now** — the collision was introduced by `/roadmap-feature` this session (ecosystem finding); fixing it inside the SE43 cycle keeps roadmap traceability honest before the release flips the SE43 checkbox.

#### Evidence
`ROADMAP.md:1260` (deferred note) vs `ROADMAP.md:1315` (formal `### SE43 — [ ]`).

#### Files to edit
```
ROADMAP.md — renumber the deferred "SE43 — migration importer" prose note
```

#### TDD
```
RED:     test_roadmap_se43_single_formal_milestone() — asserts `grep -c "SE43 — migration importer" ROADMAP.md` returns 0 (doc hygiene guard)
GREEN:   renumber the deferred note
REFACTOR: None
VERIFY:  grep -c "SE43 — migration importer" ROADMAP.md  # expect 0 after fix
```

#### Concurrency tests

(none — single-threaded) — documentation edit.

#### Acceptance Criteria
- [ ] `grep -c "SE43 — migration importer" ROADMAP.md` returns 0
- [ ] The formal `### SE43` block is the sole SE43

#### DoD
- [ ] Grep proof; CHANGELOG note not required (roadmap-internal)

---

## Phase 5: Integration Validation (MANDATORY)

**Objective:** Prove the 4 remediations hold together in the full workload, not just per-phase.

### Execution
```
pnpm -w run validate            # typecheck + biome + cycles + depcruise + dead + loc + duplication + bundle + publint + attw + full vitest
turbo run build 2>&1 | grep -c 'Circular'   # expect 0
pnpm install --frozen-lockfile  # peer-ranges resolve
```

### Acceptance Criteria
- [ ] `pnpm -w run validate` fully green
- [ ] `turbo run build` emits 0 `Circular:` warnings
- [ ] `pnpm quality:cycles` reports ≤ 3 cycles (exit 0); `pnpm quality:depcruise` exits 0
- [ ] `pnpm --filter @theokit/sdk-peer-integration-tests test` exit 0 with ≥ 4 tests
- [ ] All 6 persistence primitives importable from `@theokit/sdk/persistence`; deprecated alias still works
- [ ] `internal/runtime` reduced by ~4327 LoC; the 3 modules live under `internal/{local-agent,cloud-agent,session}`
- [ ] Zero public-API change (diff of `dist/*.d.ts` public barrels byte-stable, except the 3 added `./persistence` exports)
- [ ] real-LLM smoke (OpenRouter, per `rules/real-llm-validation.md`): one `agent.send()` example still runs end-to-end after the runtime split (proves the relocation didn't break the local runtime path)

### If Validation Fails
1. Localize the failure to the phase that introduced it (phases are sequential + gate-green, so it's the last one).
2. Fix plan-caused failures before declaring complete; re-run the chain.
3. Pre-existing issues logged in the PR, not blocking.

---

## Coverage Matrix

| # | Gap / Requirement (grill DoD) | Task(s) | Resolution |
|---|---|---|---|
| 1 | [HIGH] `internal/runtime` blast-radius reduced | T4.1, T4.2, T4.3 | 3 modules promoted to sibling `internal/*`, incremental, gate-verified |
| 2 | [MEDIUM] `./internal/persistence` no longer public-`internal` | T3.1, T3.2 | primitives sanctioned on `./persistence`; alias deprecated 1 release |
| 3 | [MEDIUM] dev-only package cycle removed | T2.1 | 4 peer tests relocated; sdk satellite devDeps removed; 0 Circular |
| 4 | [MEDIUM] satellite sdk version ranges tightened | T1.1 | 5 peer floors `>=1.7.0` → `>=4.0.0` |
| 5 | Evidence + gates (docs/CHANGELOG/ADR/full gate) | T3.1, all phases, Phase 5 | docs.md + D433 + CHANGELOG + `pnpm -w run validate` |
| 6 | Hygiene: ROADMAP SE43 collision (ecosystem finding) | T4.4 | deferred note renumbered |

**Coverage: 6/6 requirements covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm -w run validate` green
- [ ] Zero type errors — `pnpm typecheck` (in validate)
- [ ] Zero lint warnings — `biome` (in validate)
- [ ] File-size budget respected — `pnpm quality:loc` (≤ 400 code-LoC/file)
- [ ] CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6)
- [ ] Backward compatibility preserved — public API byte-stable except the 3 added `./persistence` exports; `./internal/persistence` alias intact
- [ ] Plan-specific: `turbo run build` 0 Circular; madge ≤ 3; depcruise clean; 5 peer floors ≥ 4.0.0; runtime shrank ~4327 LoC
- [ ] Changeset added for the sdk public-surface change (T3.1/T3.2); internal-only moves need none
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merged

## Failure scenarios (when I/O external)

```
(none — no external I/O touched; this is internal restructuring + manifest metadata. The real-LLM smoke in Phase 5 is a wiring proof, not a new external dependency.)
```
