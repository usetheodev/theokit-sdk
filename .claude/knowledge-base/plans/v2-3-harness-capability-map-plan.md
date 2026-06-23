---
slug: v2-3-harness-capability-map
milestone_id: V2-3
created_at: 2026-06-23
goal: Ship a navigable docs/harness-capability-map.md covering every harness primitive with a resolvable import + example, and promote the persistence cluster to a stable public @theokit/sdk/persistence subpath, verified by the build + a subpath-export test passing.
---

# V2-3 — Theo Harness Capability Map + persistence subpath promotion

## Goal
Make the harness DISCOVERABLE: ship `docs/harness-capability-map.md` mapping every harness primitive to a RESOLVABLE `import` + signature + 1 example, and promote the consumer-grade persistence cluster to a STABLE public `@theokit/sdk/persistence` subpath — verified by `pnpm build` + a new subpath-export test passing (`pnpm test` green) and every documented `@theokit/sdk/*` import resolving.

## Context
V2-3 closes the discoverability theme (Tema G) the GAP_AUDIT named as the root cause of most gaps: "o ecossistema não está faltando capacidade — está faltando expor, ligar e documentar." The grounded inventory (live import of all 21 SDK subpaths + sdk-tools) is in `knowledge-base/discoveries/blueprints/v2-3-harness-capability-map-blueprint.md`: ~25 of the 53 audited primitives are already PUBLIC, ~10 are OUT-OF-REPO, 3 are runtime-behavior NOT-SHIPPED, and the high-value `internal/persistence` cluster is SEALED behind a semver-exempt internal subpath. V2-3 documents the public surface AND promotes the persistence cluster to a stable path (closing the V2-2 follow-up V2-2E-1/V2-2F-2).

## Baseline Context

### Files that will be touched
| File | LoC today | Last touch | Why it exists |
|---|---|---|---|
| `docs/harness-capability-map.md` | 0 (NEW) | — | the capability map (DoD primary artifact) |
| `packages/sdk/src/persistence.ts` | 0 (NEW) | — | public barrel for the persistence subpath (mirrors `src/retry.ts`) |
| `packages/sdk/tsup.config.ts` | ~70 | SDK 2.0 | build entry map — add `persistence` entry |
| `packages/sdk/package.json` | ~? | ongoing | `exports` map — add `./persistence` |
| `docs.md` | 3300+ | ongoing | canonical public API contract — add a Persistence section |
| `packages/sdk/tests/persistence-subpath.test.ts` | 0 (NEW) | — | subpath-export test (mirrors `retry.test.ts` + `internal-persistence-sub-path-export.test.ts`) |
| `packages/sdk/README.md` | ~? | ongoing | link to the capability map |
| `packages/sdk-tools/README.md` | ~? | ongoing | link to the capability map |
| `.changeset/v2-3-persistence-subpath.md` | 0 (NEW) | — | changeset (`@theokit/sdk` minor) |
| `CHANGELOG.md` (workspace) | ongoing | ongoing | `[Unreleased]` entry |

### Current callers / dependents
- `packages/sdk/src/internal/persistence/index.ts` — `@internal` barrel exporting `appendJsonl`, `readJsonlIds`, `loadJsonl`, `replaceFileAtomic`, `atomicWriteText`, `atomicWriteJson`, `withFileLock`, `openSqliteResilient`, `applyWalWithFallback` (the symbols to re-export from the new stable subpath). The underlying modules: `jsonl.ts`, `atomic-write.ts`, `file-lock.ts`, `sqlite-open.ts`, `sqlite-wal.ts`.
- `tsup.config.ts` already builds `internal/persistence/index` + `retry`/`compaction`/`eval` entries (the pattern to mirror).
- `@theokit/sdk/eval` already publicly exports `loadJsonl` — the new subpath co-locates it with the jsonl write/resume helpers (no conflict; same source).
- Existing `tests/internal-persistence-sub-path-export.test.ts` pins the internal subpath; the new test pins the STABLE public one.

### Domain glossary
- **capability map** — a single navigable doc listing every harness primitive with its import-path + signature + example, so a builder discovers a primitive without reading source.
- **subpath / barrel** — a package `exports` entry (e.g. `@theokit/sdk/persistence`) backed by a `src/<name>.ts` re-export module + a tsup build entry.
- **semver-exempt internal subpath** — `@theokit/sdk/internal/*`, intentionally importable but documented as may-break (no semver guarantee). The new `@theokit/sdk/persistence` is the opposite: semver-PROTECTED, documented in docs.md.
- **OUT-OF-REPO primitive** — a GAP_AUDIT primitive whose target package lives in a sibling repo (`@theokit/ui`, `theokit`, `@theokit/orm`, ...).

### Architecture boundaries affected
Per `rules/architecture.md` (public-surface discipline) + the SDK CLAUDE.md "docs.md is the source of truth for the public API": adding `@theokit/sdk/persistence` is a PUBLIC API change → docs.md + README + CHANGELOG + a test MUST land in the same change. The new barrel only RE-EXPORTS existing internal implementations (no new logic), keeping dependency direction intact (public barrel → internal impl). No new runtime dependency.

## Prior Art & Related Work
- `src/retry.ts` / `src/compaction.ts` — the exact pattern for a subpath that re-exports from `internal/runtime` (thin barrel + tsup entry + DTS-via-tsc note).
- `tests/internal-persistence-sub-path-export.test.ts` — the subpath-export smoke-test pattern.
- V2-2 findings V2-2E-1 / V2-2F-2 (`theocode/.claude/knowledge-base/implementations/`) — the consumer-side evidence that motivated promoting the persistence cluster.
- The grounded inventory blueprint (this slug).

## ADRs

### D1 — Promote the persistence cluster to a STABLE public `@theokit/sdk/persistence` subpath
**Decision:** Add `src/persistence.ts` re-exporting `appendJsonl`, `readJsonlIds`, `loadJsonl`, `replaceFileAtomic`, `atomicWriteText`, `atomicWriteJson`, `withFileLock`, `openSqliteResilient`, `applyWalWithFallback` (+ their option types) from the existing internal modules; wire the tsup entry + package.json `./persistence` export + docs.md section + a subpath test + changeset.
**Rationale (cites `rules/architecture.md` public-surface discipline + Unbreakable Rule 9 + the SDK CLAUDE.md docs.md-source-of-truth):** these helpers are consumer-grade (jsonl persist/resume, atomic write, resilient sqlite) and several were extracted FROM a consumer (theocode `referencia:` cited). Re-exporting from internal (no new logic) gives a semver-protected path so consumers stop coupling to `internal/`. Mirrors the proven `retry`/`compaction` subpath pattern.
**Alternatives rejected:** (a) Tell consumers to import from `@theokit/sdk/internal/persistence` — rejected: that path is documented semver-exempt; coupling a consumer's crash-resume/atomic-write to it is fragile (the exact V2-2E-1/V2-2F-2 finding). (b) Add the helpers to the existing `@theokit/sdk/eval` barrel — rejected: atomic-write/file-lock/sqlite are not eval-specific; a dedicated `persistence` subpath is the cohesive home (and `loadJsonl` is co-located, not moved).

### D2 — Capability map grounded in the REAL export surface, with honest status for non-public primitives
**Decision:** `docs/harness-capability-map.md` documents each PUBLIC primitive with a resolvable import + signature + 1 example; OUT-OF-REPO primitives get a one-line pointer to their repo; NOT-SHIPPED behavior gaps (nextIteration enforcement, runToCompletion, hook-stop) are recorded honestly as "not a standalone export" with the related public pieces linked.
**Rationale (cites Unbreakable Rule 3 honesty + `rules/architecture.md`):** the map's value is that every documented import RESOLVES (a third party trusts it). Grounding it in the live inventory (not the GAP_AUDIT snapshot) prevents documenting primitives that don't exist; honest status for the gaps avoids over-claiming.
**Alternatives rejected:** (a) Document all 53 GAP_AUDIT rows verbatim from the snapshot — rejected: ~10 are out-of-repo and 3 aren't public symbols; documenting them as `@theokit/sdk` imports would fabricate resolvable paths (a plan-confidence-style fabricated citation). (b) Omit the non-public ones silently — rejected: the map must be complete + honest about what's NOT there.

### D3 — Scope the promotion to the persistence cluster only (YAGNI on plugins/observability)
**Decision:** Promote `internal/persistence` consumer-grade helpers only; do NOT promote `internal/plugins` / `internal/observability` / `internal/security` redaction.
**Rationale (cites YAGNI + KISS):** the persistence cluster is the one with consumer demand (V2-2 findings) + theocode lineage. Plugins (3rd-party authoring) and observability (`*ForTests`) have no surfaced consumer need; promoting them is speculative surface.
**Alternatives rejected:** (a) Promote all internals — rejected: speculative public surface the SDK must then maintain under semver (YAGNI). (b) Promote `internal/security` redaction now — rejected: no consumer demand surfaced; noted as a future candidate in the map.

## Dependency Graph
- Phase 1 (persistence subpath) — no blockers; must precede the map (the map documents the new subpath).
- Phase 2 (capability map + README links) — depends on Phase 1 (links the new `@theokit/sdk/persistence`).
- Phase 3 (Integration Validation) — depends on Phases 1 + 2.

## Phases

### Phase 1 — Promote the persistence cluster to `@theokit/sdk/persistence`

#### Task T1.1 — Public barrel + tsup entry + exports + docs.md

##### Why this step
**Action:** Create `packages/sdk/src/persistence.ts` re-exporting the consumer-grade persistence helpers (+ option types) from the internal modules; add `persistence: "src/persistence.ts"` to `tsup.config.ts` entry; add `./persistence` to `package.json` `exports` (mirror `./retry` shape); add a "Persistence helpers" section to `docs.md`.
**Reasoning:** mirrors the sealed-internal-friendly `retry`/`compaction` subpath pattern (Baseline Context prior-art); gives a semver-protected public path (D1) so consumers stop coupling to `internal/persistence`.

##### Files to edit
- `packages/sdk/src/persistence.ts` (NEW, < 60 LoC — re-exports only; budget < 500 per `rules/architecture.md`)
- `packages/sdk/tsup.config.ts`, `packages/sdk/package.json`, `docs.md`

##### Deep file dependency analysis
The barrel re-exports from `./internal/persistence/jsonl.js`, `./internal/persistence/atomic-write.js`, `./internal/persistence/file-lock.js`, `./internal/persistence/sqlite-open.js`, `./internal/persistence/sqlite-wal.js` (the same modules `internal/persistence/index.ts` aggregates). No new logic. tsup builds it as a sibling entry (DTS via tsc like retry/concurrency — reaches internal/). `@theokit/sdk/eval`'s `loadJsonl` and the new subpath's `loadJsonl` resolve to the SAME source symbol (no duplication).

##### TDD
- RED→GREEN: NEW `packages/sdk/tests/persistence-subpath.test.ts` (mirrors `retry.test.ts` + the internal-subpath test): imports each promoted symbol from `../src/persistence.js`, asserts each is a function/class, and exercises ONE behavior round-trip (e.g. `appendJsonl` then `readJsonlIds` resume on a temp file; `replaceFileAtomic` writes + reads back). This pins the public contract.

##### Concurrency tests
(none — single-threaded)

##### Acceptance criteria
- `grep -c "from \"./internal/persistence/" packages/sdk/src/persistence.ts` ≥ `1` (re-export barrel present).
- `node -e "const p=require('./packages/sdk/package.json'); process.exit(p.exports['./persistence']?0:1)"; echo $?` → `0`.
- `grep -c "persistence:" packages/sdk/tsup.config.ts` ≥ `1`.

##### DoD
- `pnpm --filter @theokit/sdk build 2>&1 | tail -3` succeeds (the `./persistence` dist files exist).
- `node -e "import('@theokit/sdk/persistence').then(m=>process.exit(['appendJsonl','readJsonlIds','replaceFileAtomic','withFileLock','openSqliteResilient'].every(k=>k in m)?0:1))"; echo $?` → `0` (run from `packages/sdk` after build).

#### Task T1.2 — Subpath-export test + changeset + CHANGELOG

##### Why this step
**Action:** Add `tests/persistence-subpath.test.ts` (per T1.1 TDD); add `.changeset/v2-3-persistence-subpath.md` (`@theokit/sdk` minor); add the workspace `CHANGELOG.md [Unreleased]` entry.
**Reasoning:** the SDK CLAUDE.md checklist requires a test + changeset + CHANGELOG for any public-surface change (Unbreakable Rule 6 + the locked toolchain's changesets).

##### Files to edit
- `packages/sdk/tests/persistence-subpath.test.ts` (NEW), `.changeset/v2-3-persistence-subpath.md` (NEW), `CHANGELOG.md`

##### Deep file dependency analysis
The test imports from `../src/persistence.js` (source, like `retry.test.ts`). The changeset frontmatter is `"@theokit/sdk": minor` (additive public surface). No production caller depends on the test/changeset.

##### TDD
- The test IS the RED→GREEN artifact from T1.1; here it is committed + run green.

##### Concurrency tests
(none — single-threaded)

##### Acceptance criteria
- `pnpm --filter @theokit/sdk test 2>&1 | grep -E "persistence-subpath"` shows the test passing (or the suite total passes including it).
- `ls .changeset/v2-3-persistence-subpath.md` exists with `@theokit/sdk` minor frontmatter.

##### DoD
- `pnpm --filter @theokit/sdk test 2>&1 | tail -3` → suite green.
- `CHANGELOG.md [Unreleased]` has the persistence-subpath entry.

### Phase 2 — Capability Map doc + README links

#### Task T2.1 — Write `docs/harness-capability-map.md`

##### Why this step
**Action:** Write the map grounded in the inventory: themed sections (agent runtime, context/compaction, tools+security, eval+sandbox, persistence, models, concurrency/retry, skills/project, messages, subagents), each PUBLIC primitive with `import { X } from '@theokit/sdk/<subpath>'` + signature + 1-line example; an OUT-OF-REPO section (UI/client/orm/memory/budget/agents with repo pointers); a "behavior wired, not a standalone export" note for the 3 NOT-SHIPPED gaps.
**Reasoning:** the primary DoD artifact (D2); a third party must find `compactTranscript`/`buildRepoMap`/`isTransientError` without reading source.

##### Files to edit
- `docs/harness-capability-map.md` (NEW)

##### Deep file dependency analysis
Every documented `@theokit/sdk/*` import must resolve against the real export surface (the inventory). The `@theokit/sdk/persistence` entries depend on Phase 1 having shipped the subpath. sdk-tools entries reference the single `.` entry.

##### TDD
- Verification is mechanical (Phase 3 T3.1): a script greps every `import { ... } from '@theokit/sdk...'` / `@theokit/sdk-tools` line in the map and confirms each symbol resolves via `node` import. No unit test (doc artifact); the resolve-check IS the test.

##### Concurrency tests
(none — single-threaded)

##### Acceptance criteria
- `grep -c "import { " docs/harness-capability-map.md` ≥ `25` (the public primitives covered).
- The map contains sections for: agent-runtime, compaction, tools+security, eval+sandbox, persistence, models, concurrency/retry, skills/project, messages, subagents, OUT-OF-REPO.

##### DoD
- Every `@theokit/sdk*` import line in the map resolves (Phase 3 T3.1 script exits 0).

#### Task T2.2 — Link the map from package READMEs

##### Why this step
**Action:** Add a link to `docs/harness-capability-map.md` from `packages/sdk/README.md` and `packages/sdk-tools/README.md`.
**Reasoning:** the DoD requires the map be "linkado do README de cada pacote" so it is reachable from the package front door.

##### Files to edit
- `packages/sdk/README.md`, `packages/sdk-tools/README.md`

##### Deep file dependency analysis
The READMEs are public-facing; the link is a relative path to `docs/harness-capability-map.md` (verify the relative path resolves from each README's location).

##### TDD
- Phase 3 link-resolve check confirms the relative path target exists.

##### Concurrency tests
(none — single-threaded)

##### Acceptance criteria
- `grep -c "harness-capability-map" packages/sdk/README.md` ≥ `1` and `grep -c "harness-capability-map" packages/sdk-tools/README.md` ≥ `1`.

##### DoD
- The relative link target resolves from each README (Phase 3 T3.1).

### Phase 3 — Integration Validation (eat your own cooking)

#### Task T3.1 — Build + test + resolve-check + lint

##### Why this step
**Action:** Run `pnpm --filter @theokit/sdk build` + `pnpm --filter @theokit/sdk test` + `pnpm --filter @theokit/sdk typecheck` + biome lint; run a resolve-check that imports every `@theokit/sdk*` symbol cited in the capability map (exits non-zero on any unresolved); verify the README links resolve.
**Reasoning:** the plan is not complete until the new subpath builds + the test passes + EVERY documented import resolves (the map's credibility) + the READMEs link.

##### Files to edit
- (none — validation phase)

##### TDD
(integration phase — runs the suites + the resolve-check)

##### Concurrency tests
(none — single-threaded)

##### Acceptance criteria
- `pnpm --filter @theokit/sdk build 2>&1 | tail -1` succeeds; `pnpm --filter @theokit/sdk test 2>&1 | tail -3` green; `pnpm --filter @theokit/sdk typecheck 2>&1 | tail -1` clean.
- The capability-map resolve-check (extract every `import {...} from '@theokit/sdk*'`, import each, assert symbol present) exits `0`.
- README link targets resolve.

##### DoD
- Build + test + typecheck + lint all green; resolve-check exits 0; both READMEs link the map.

## Coverage Matrix
| # | Requirement (blueprint / ROADMAP-v2 §V2-3) | Task(s) | Resolution |
|---|---|---|---|
| 1 | Promote persistence cluster to a stable public subpath | T1.1 | `@theokit/sdk/persistence` barrel + tsup + exports + docs.md |
| 2 | Subpath is tested + changeset + CHANGELOG (SDK ceremony) | T1.2 | subpath-export test + changeset + CHANGELOG |
| 3 | Capability map covers every primitive (import+sig+example) | T2.1 | `docs/harness-capability-map.md` grounded in the inventory |
| 4 | Honest status for OUT-OF-REPO + NOT-SHIPPED primitives | T2.1 | repo pointers + "wired, not a standalone export" notes |
| 5 | Map linked from each package README | T2.2 | sdk + sdk-tools READMEs link the map |
| 6 | Full-chain green + every documented import resolves | T3.1 | build/test/typecheck/lint + resolve-check + link-check |

**Coverage: 6/6 (100%)** — OUT-OF-REPO + NOT-SHIPPED primitives are documented (status), not deleted; they are not adoptable SDK exports (D2).

## Drawbacks & Risks
| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| A documented import drifts/breaks → map loses trust | Medium | T3.1 resolve-check imports EVERY cited symbol; runs in the validation phase (could be promoted to CI later) | implementer |
| New public subpath increases the semver-protected surface to maintain | Low | Re-export only (no new logic); scoped to the consumer-grade cluster (D3 YAGNI on plugins/observability) | framework owner |
| docs.md (3300+ lines) edit conflicts / wrong section | Low | Add a self-contained "Persistence helpers" section near Eval; no edits to existing sections | implementer |
| `loadJsonl` documented in two subpaths (eval + persistence) confuses | Low | Same source symbol; the map notes both homes with one canonical example | implementer |

## Unresolved Questions
(none — every decision is resolved at plan time; promoting `internal/security` redaction + `internal/plugins` is explicitly deferred (D3), not open.)

## Global DoD
- `pnpm --filter @theokit/sdk build` + `test` + `typecheck` all green; biome lint clean.
- `@theokit/sdk/persistence` resolves and exports the documented cluster; subpath test passes; changeset + CHANGELOG present.
- `docs/harness-capability-map.md` exists, covers the public primitives (≥ 25 resolvable imports) + OUT-OF-REPO + NOT-SHIPPED sections, and is linked from both package READMEs.
- The capability-map resolve-check exits 0 (every documented `@theokit/sdk*` import resolves).
- File-size budget respected (`src/persistence.ts` < 500 LoC); quality gates green.
- Code-quality verdict ∈ {PASS, PASS_WITH_CAVEATS}.

## Final Phase: Integration Validation
Covered by Phase 3 / T3.1 — build + test + typecheck + lint + the resolve-check + link-check must all pass before READY_TO_MERGE.

## Failure scenarios
(none — no new external I/O; the persistence helpers' fs/sqlite seams are the existing internal implementations, already tested under `internal/persistence`; the new barrel only re-exports them.)
