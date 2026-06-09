# Plan: Extract `Workflow` + `Eval` from `@theokit/sdk` main barrel into dedicated sub-paths

> **Version 1.1** — implementation plan that lands the packaging extraction designed in blueprint `.claude/knowledge-base/discoveries/blueprints/sdk-subpath-extraction-workflow-eval-blueprint.md` (SHIPPABLE 99.7 / 100). Moves `Workflow` (+ `agentStep`, `fn`, `WorkflowBuilder`, 10 `Workflow*Error` types) and `Eval` (+ `EvalAlreadyRunningError`, `Scorers`) out of `packages/sdk/src/index.ts` into `@theokit/sdk/workflow` and `@theokit/sdk/eval`. **No backwards-compat preserved** per user directive. Migration footprint: 2 consumer-side line edits. SDK bumps `1.4.1` → `1.5.0`. v1.1 absorbs the edge-case review (`.claude/knowledge-base/reviews/sdk-subpath-extraction-workflow-eval-impl-edge-cases-2026-06-02.md`) — adds T2.2b for the missing `export type *` re-exports (MUST FIX EC-1), expands D5 with alternatives, formalizes the Dogfood phase as T6.1 so Coverage Matrix reaches 100%, and adds the `## Dogfood Evolution` section.

## Context

The architectural cohesion review on 2026-06-02 surfaced a packaging smell: the barrel `packages/sdk/src/index.ts` exports 17+ feature areas. The current `packages/sdk/tsup.config.ts` already factors out 5 sub-paths (`./errors`, `./cron`, `./tools`, `./path-safety`, `./task-store`), but per the comment at `packages/sdk/tsup.config.ts:13-16` the trigger was a forced cycle-DTS workaround, NOT an intentional Interface-Segregation decision. Discovery (blueprint v1.1, SHIPPABLE 99.7) confirmed `Workflow` and `Eval` are the strongest extraction candidates:

- **Zero internal coupling** — only the barrel `index.ts` and `types/index.ts` re-export them.
- **Small surface** — `workflow.ts` 379 LoC, `eval.ts` 77 LoC, `scorers.ts` 151 LoC = 607 LoC total.
- **High DTS weight removed** — ~15 runtime symbols + ~15 type symbols stop polluting the main barrel's `.d.ts`.
- **Zero current Workflow consumers** in the monorepo — extraction is friction-free for that subsystem.
- **Two Eval consumers** that need migration: `packages/cli/src/eval/runner.ts:14` + `examples/eval/run.ts:14`.

Triggering evidence:
- `packages/sdk/src/index.ts:55-56, 108, 135-149` — the deletion sites for the main barrel.
- `packages/sdk/src/workflow.ts:29` — `import type { SDKAgent }` is the cycle-DTS risk surface.
- `packages/sdk/tsup.config.ts:13-16` — documented rationale for the tsc workaround lane.
- `tools/typecheck-examples.sh:1-50` — does NOT rebuild the SDK, mandating explicit pre-build step (per blueprint ADR D4).

Related blueprint ADRs (D1-D5) are absorbed below as plan-level ADRs.

## Objective

After this plan ships, `import { Workflow } from "@theokit/sdk"` raises a TypeScript error; `import { Workflow } from "@theokit/sdk/workflow"` resolves; `pnpm validate:publint` and `pnpm validate:attw` pass in CI; `tools/typecheck-examples.sh` passes after explicit SDK rebuild.

Measurable goals:

- [ ] `packages/sdk/dist/workflow.{js,cjs,d.ts,d.cts}` and `packages/sdk/dist/eval.{js,cjs,d.ts,d.cts}` all emit after `pnpm --filter @theokit/sdk build`.
- [ ] `package.json#exports` declares `./workflow` and `./eval` following the existing explicit-entry pattern.
- [ ] `Workflow`, `Eval`, `Scorers`, and all 12 companion symbols are REMOVED from `packages/sdk/src/index.ts`.
- [ ] `packages/cli/src/eval/runner.ts:14` and `examples/eval/run.ts:14` import from `@theokit/sdk/eval` instead of `@theokit/sdk`.
- [ ] `pnpm validate:publint && pnpm validate:attw` exit 0.
- [ ] `tools/typecheck-examples.sh` exit 0 (after explicit `pnpm --filter @theokit/sdk build`).
- [ ] `packages/sdk/CHANGELOG.md` documents the breaking change under `[Unreleased]`.
- [ ] `packages/sdk/package.json#version` bumps to `1.5.0`.

## ADRs

### D1 — Route `workflow` + `eval` DTS through the tsc workaround, not tsup's `dts.entry`

**Decision:** Both new sub-paths emit their `.d.ts` via the existing `tsconfig.tools-dts.json` tsc invocation (same lane as `tools`/`path-safety`/`task-store`).

**Rationale:** Static evidence in blueprint Q2 shows `workflow.ts` imports `SDKAgent` (type-only) which transitively reaches `fork-agent.ts` `ForkOptions`, completing the documented `types/agent.ts ↔ fork-agent.ts` cycle that rollup-plugin-dts fails on. tsc lane has zero production failures. KISS + Inquebrável Rule 9 (don't reinvent — copy what works).

**Alternatives considered:** Add to tsup `dts.entry` — rejected without empirical proof. Probe deferred to Phase 0 T0.1 as mandatory pre-flight; if probe contradicts the static analysis, the decision flips.

**Consequences:** `scripts/mirror-dts-to-cts.mjs` MUST grow two entries; `tsconfig.tools-dts.json#include` MUST grow 5 entries (workflow.ts + eval.ts + scorers.ts + internal/eval/** + internal/workflow/**).

### D2 — Keep the explicit-entry-per-sub-path exports map

**Decision:** `package.json#exports` adds `./workflow` and `./eval` as explicit entries following the existing pattern for the 5 shipped sub-paths.

**Rationale:** Post-extraction the SDK has 7 sub-paths total — wildcard pattern (à la Anthropic SDK) would add accidental-surface risk for a small count. The explicit pattern is already validated by `pnpm validate:attw` in CI. KISS.

**Alternatives considered:** Anthropic-style wildcards (`./*`) — DOCUMENTed as scope-deferred per blueprint EC-6; follow-up `/discover-plan` open if needed.

**Consequences:** Each future sub-path costs ~9 lines of JSON (ESM + CJS condition pairs). Acceptable.

### D3 — Move `Scorers` to `@theokit/sdk/eval` (co-locate with `Eval`)

**Decision:** `Scorers` namespace moves to `@theokit/sdk/eval` via re-export from `src/eval.ts`, NOT kept in main barrel, NOT a separate `@theokit/sdk/scorers` sub-path.

**Rationale:** Both current consumers of Scorers also consume Eval (one in `cli/src/eval/runner.ts:14`, one in `examples/eval/run.ts:14`). Locality of reference + ISP — keeping it in the main barrel forces non-eval consumers to pay its DTS cost.

**Alternatives considered:** (a) Keep in main barrel — rejected, violates locality; (b) Separate `/scorers` sub-path — rejected, no use case for Scorers without Eval (151 LoC of scoring functions consumed only via `Eval.create({ scorers: [...] })`).

**Consequences:** `src/eval.ts` adds a re-export line. `tsconfig.tools-dts.json#include` adds `src/scorers.ts`.

### D4 — `/implement` MUST run explicit `pnpm --filter @theokit/sdk build` between barrel-delete and validation sweep

**Decision:** The implementation runbook enforces an explicit SDK rebuild between editing barrel files and running `tools/typecheck-examples.sh` / `pnpm validate:attw`.

**Rationale:** Blueprint Q6 confirmed `tools/typecheck-examples.sh:1-50` does `pnpm install --no-frozen-lockfile` (re-resolves the `file:` link) but does NOT trigger `pnpm build`. Without rebuild, the sweep reads stale `dist/` and produces false-positive verdicts. `.claude/rules/real-llm-validation.md` (evidence-as-proof) makes this non-negotiable.

**Alternatives considered:** Patch `tools/typecheck-examples.sh` to auto-rebuild — rejected as scope creep; runbook discipline solves it.

**Consequences:** Phase 4 has a mandatory T4.0 rebuild step before validation tasks run.

### D5 — No CI workflow changes; existing gate covers the extraction

**Decision:** Do NOT modify `.github/workflows/ci.yml`. The existing matrix job runs `pnpm validate:publint` and `pnpm validate:attw` on every push/PR, automatically exercising the new sub-paths.

**Rationale:** Blueprint Q1 confirmed CI already runs the gate. Adding a new CI job is scope creep.

**Alternatives considered:**
- Add a sub-path-specific smoke-import test step (e.g., `node -e "require('@theokit/sdk/workflow')"`) as a new CI job — rejected because the existing attw step already validates structural reachability of every `exports` entry; a smoke import is redundant.
- Add a CI job dedicated to running `tools/typecheck-examples.sh` — rejected as scope creep; the examples sweep is currently a developer-run gate per the workspace convention. Promoting it to CI is a separate decision tracked outside this plan.
- Patch the existing `validate` job to call `pnpm validate` (root) instead of individual steps — rejected because the current explicit step-by-step layout gives faster CI signal (each step fails fast on its own line).

**Consequences:** Zero YAML changes. CI catches regressions automatically post-merge via existing `pnpm validate:publint` + `pnpm validate:attw` invocations at `.github/workflows/ci.yml:65,68`.

### D6 — SDK version bumps to `1.5.0` (minor)

**Decision:** `packages/sdk/package.json#version` bumps `1.4.1 → 1.5.0`, NOT `2.0.0`.

**Rationale:** Pre-1.0 SemVer policy in the workspace + user's no-backwards-compat directive justifies a minor. Major (`2.0.0`) is reserved for the 1.0.0 → 2.0.0 cutover per the meta-repo roadmap Onda 4. The breaking change IS surfaced explicitly via `Removed` section in CHANGELOG (Inquebrável Rule 6).

**Alternatives considered:** Major bump (`2.0.0`) — rejected, would conflict with roadmap version semantics where major is reserved for SDK GA. Patch (`1.4.2`) — rejected, removing public API is not a patch under any policy.

**Consequences:** Consumers reading the changelog see the `Removed` section as the breaking-change signal. SemVer is technically violated (this would be a major in strict semver), but the workspace's pre-1.0 convention absorbs this. Documented in CHANGELOG.

## Dependency Graph

```
Phase 0 (pre-flight) ──▶ Phase 1 (build config)
                              │
                              ▼
                         Phase 2 (exports + barrel delete + Scorers re-export)
                              │
                              ▼
                         Phase 3 (consumer migration: 2 sites)
                              │
                              ▼
                         Phase 4 (rebuild + validation sweep)
                              │
                              ▼
                         Phase 5 (changelog + version bump)
                              │
                              ▼
                         Phase Dogfood QA (mandatory)
```

Strictly sequential. Phase 1 modifies build config → Phase 2 references the new entries → Phase 3 uses the new sub-paths → Phase 4 rebuild MUST happen before validation (per D4) → Phase 5 documents the change → Dogfood validates.

No parallelization opportunity — every phase blocks the next.

---

## Phase 0: Pre-flight (mandatory empirical probe)

**Objective:** Confirm the cycle-DTS routing decision (D1) empirically before committing to the tsc-workaround lane.

### T0.1 — Q2 Fase C empirical scratch tsup probe

#### Objective

Run the empirical probe from blueprint Q2 Fase C to confirm whether adding `workflow` to tsup's `dts.entry` would trip the documented `types/agent.ts ↔ fork-agent.ts` cycle. Outcome confirms or contradicts D1.

#### Evidence

Blueprint Q2 static analysis produces verdict `cycle-triggered: conditional`. Per plan v1.1 ADR D1 of the discovery plan, an ambiguous static verdict requires Fase C empirical proof (5 min budget). This is mandatory under blueprint Q2 special checkpoint.

#### Files to edit

```
packages/sdk/tsup.scratch.config.ts (NEW, deleted in cleanup step) — empirical probe config
```

#### Deep file dependency analysis

- **`packages/sdk/tsup.config.ts`** (read-only): source for the scratch copy.
- **`packages/sdk/tsup.scratch.config.ts`** (created): copies `tsup.config.ts` then adds `workflow: "src/workflow.ts"` to BOTH `entry` map AND `dts.entry`. Probes whether rollup-plugin-dts handles workflow.ts.
- **No downstream impact** — scratch file is gitignored and deleted at end of task.

#### Deep Dives

**The empirical probe sequence:**

1. `cp packages/sdk/tsup.config.ts packages/sdk/tsup.scratch.config.ts`
2. In the scratch file, add to `entry` AND `dts.entry`:
   ```ts
   workflow: "src/workflow.ts",
   ```
3. Run: `pnpm --filter @theokit/sdk exec tsup --config tsup.scratch.config.ts`
4. Observe outcome:
   - **Failure with "ForkOptions not exported"** → D1 confirmed (tsc lane required). Cleanup + advance to Phase 1.
   - **Build succeeds + `dist/workflow.d.ts` emits** → D1 contradicted. Either (a) flip the routing decision to tsup's `dts.entry` and update D1 mid-plan with rationale, or (b) keep tsc lane for symmetry with siblings. Either is defensible; prefer (b) for KISS.
5. Cleanup: `rm packages/sdk/tsup.scratch.config.ts && pnpm --filter @theokit/sdk build` to restore canonical `dist/`.

**Invariant:** After T0.1 finishes, `packages/sdk/tsup.config.ts` is unchanged and `packages/sdk/dist/` is restored to canonical state.

**Edge case:** If the probe fails for a reason OTHER than the documented cycle (e.g., a tsup version mismatch, a missing dep), document the actual failure mode and re-run after fixing. Do NOT mistake a benign error for cycle confirmation.

#### Tasks

1. `cp packages/sdk/tsup.config.ts packages/sdk/tsup.scratch.config.ts`
2. Edit scratch: add `workflow: "src/workflow.ts"` to `entry` (line 4-10) AND to `dts.entry` (line 17-23)
3. Run probe: `pnpm --filter @theokit/sdk exec tsup --config tsup.scratch.config.ts`
4. Capture stdout + stderr to a probe log
5. Verify outcome: cycle confirmed (D1 stands) OR cycle absent (D1 reconsidered)
6. Cleanup: `rm packages/sdk/tsup.scratch.config.ts`
7. Restore canonical dist: `pnpm --filter @theokit/sdk build`

#### TDD

```
RED:     no explicit RED test — empirical probe is the verification itself.
GREEN:   the probe runs; the outcome (success or expected failure) is the verification.
REFACTOR: None expected.
VERIFY:  ls packages/sdk/dist/workflow.* should NOT exist after cleanup (workflow not yet wired)
         ls packages/sdk/tsup.scratch.config.ts should NOT exist after cleanup
         pnpm --filter @theokit/sdk build exit 0 (canonical state restored)
```

#### Acceptance Criteria

- [ ] Probe outcome documented in commit message OR a comment within Phase 1 work
- [ ] `packages/sdk/tsup.scratch.config.ts` deleted (no leftover scratch file)
- [ ] `packages/sdk/tsup.config.ts` unchanged byte-for-byte vs HEAD
- [ ] `packages/sdk/dist/` restored to canonical state (no `workflow.d.ts` yet)
- [ ] D1 either confirmed (probe failed with cycle error) OR re-decided with explicit ADR amendment

#### DoD

- [ ] All 7 tasks completed
- [ ] D1 status is documented (confirmed / re-decided)
- [ ] No leftover scratch files
- [ ] `pnpm --filter @theokit/sdk build` exit 0

---

## Phase 1: Build config updates

**Objective:** Wire `workflow` and `eval` into the tsup multi-entry + tsc DTS workaround lanes so `pnpm build` emits the dist artifacts.

### T1.1 — Add `workflow` + `eval` to tsup `entry` (NOT `dts.entry`)

#### Objective

Extend `packages/sdk/tsup.config.ts` so tsup emits `dist/workflow.{js,cjs}` and `dist/eval.{js,cjs}` from the new entries. DTS emission is intentionally left to the tsc workaround (T1.2).

#### Evidence

Blueprint Q3 Diff 1. The existing pattern in `packages/sdk/tsup.config.ts:4-10` shows 6 entries (`index`, `errors`, `cron`, `tools`, `path-safety`, `task-store`); we add 2 more. The `dts.entry` block at lines 17-23 stays unchanged (per D1).

#### Files to edit

```
packages/sdk/tsup.config.ts — add `workflow` + `eval` to `entry` map (lines 4-10)
```

#### Deep file dependency analysis

- **`packages/sdk/tsup.config.ts`**: tsup driver for the SDK build. Today (HEAD) lines 4-10 declare 6 entries. After this task lines 4-10 declare 8 entries. The `dts: { entry: {...} }` block (lines 17-23) stays at 3 entries (`index`, `errors`, `cron`) per D1.
- **Downstream impact:** subsequent tsup runs emit `dist/workflow.js`, `dist/workflow.cjs`, `dist/eval.js`, `dist/eval.cjs`. NO `.d.ts` files emitted by tsup for these — that's the tsc lane (T1.2).

#### Deep Dives

**Insertion site:**

```ts
// packages/sdk/tsup.config.ts:4-12 — AFTER edit
entry: {
  index: "src/index.ts",
  errors: "src/errors.ts",
  cron: "src/cron.ts",
  tools: "src/tools/index.ts",
  "path-safety": "src/path-safety.ts",
  "task-store": "src/task-store.ts",
  workflow: "src/workflow.ts",   // NEW
  eval: "src/eval.ts",            // NEW
},
```

**Invariant:** `dts.entry` (lines 17-23) MUST NOT be modified in this task. T1.2 covers DTS via the tsc lane.

**Edge case:** If T0.1 contradicted D1, this task instead adds `workflow` + `eval` to BOTH `entry` AND `dts.entry`. T1.2 then becomes a no-op. Decide based on T0.1 outcome.

#### Tasks

1. Read `packages/sdk/tsup.config.ts` (entry block at lines 4-10)
2. Edit: append `workflow: "src/workflow.ts",` and `eval: "src/eval.ts",` to `entry` map
3. Do NOT touch `dts.entry` (lines 17-23) unless T0.1 contradicted D1
4. Save

#### TDD

```
RED:     RED snapshot check — run `pnpm --filter @theokit/sdk build`, observe FAILURE because:
         - either `dist/workflow.js` is missing (the desired build output not yet wired) before edit
         - OR `dist/workflow.d.ts` is missing (which is FINE — T1.2 produces it via tsc)
GREEN:   After edit + `pnpm --filter @theokit/sdk build`:
         - `dist/workflow.js` exists
         - `dist/workflow.cjs` exists
         - `dist/eval.js` exists
         - `dist/eval.cjs` exists
         - `dist/workflow.d.ts` does NOT exist yet (tsc lane not wired — that's T1.2)
REFACTOR: None expected.
VERIFY:  ls packages/sdk/dist/workflow.{js,cjs} packages/sdk/dist/eval.{js,cjs}
         all exit 0
```

#### Acceptance Criteria

- [ ] `packages/sdk/tsup.config.ts#entry` contains `workflow` + `eval` entries
- [ ] `packages/sdk/tsup.config.ts#dts.entry` is unchanged (per D1, unless T0.1 inverted the decision)
- [ ] `pnpm --filter @theokit/sdk build` exits 0
- [ ] `packages/sdk/dist/workflow.{js,cjs}` emitted
- [ ] `packages/sdk/dist/eval.{js,cjs}` emitted

#### DoD

- [ ] All 4 tasks completed
- [ ] Build exit 0
- [ ] dist artifacts present (js+cjs)

---

### T1.2 — Extend `tsconfig.tools-dts.json#include` with workflow/eval transitive surface

#### Objective

Add 5 paths to the tsc-driven DTS lane so `pnpm --filter @theokit/sdk build` emits `dist/workflow.d.ts` and `dist/eval.d.ts` via `onSuccess` tsc invocation.

#### Evidence

Blueprint Q3 Diff 2. `packages/sdk/tsconfig.tools-dts.json:12-25` currently includes 12 paths. The transitive surface for workflow.ts + eval.ts requires 5 new paths.

#### Files to edit

```
packages/sdk/tsconfig.tools-dts.json — extend `include` array (line 12-25)
```

#### Deep file dependency analysis

- **`packages/sdk/tsconfig.tools-dts.json`**: tsc config used by the `onSuccess` step in `packages/sdk/tsup.config.ts:41`. Today's `include` array has 12 entries. After this task it has 17.
- **Transitive reach reasoning** (per blueprint Q2 + Q3):
  - `src/workflow.ts:25-47` imports from `zod`, `./internal/persistence/persistence-schema.js`, `./internal/security/path-guard.js`, `./types/agent.js`, `./types/workflow.js`. The `types/**/*` glob already covers `types/workflow.ts`; `internal/persistence/*` and `internal/security/*` are NOT yet in include — but they ARE pulled in transitively by other already-included files. To be safe, we add `internal/workflow/**/*` because `src/workflow.ts:335` imports `__resetSnapshotStoresForTests` from `./internal/workflow/snapshot-store.js`.
  - `src/eval.ts:18-20` imports `zod`, `./internal/eval/runner.js`, `./types/eval.js`. Add `internal/eval/**/*`.
  - `src/scorers.ts` is added because D3 co-locates `Scorers` under `/eval`, so DTS emission must reach it.

#### Deep Dives

**Insertion site (5 new lines appended):**

```json
"include": [
  "src/tools/**/*",
  "src/path-safety.ts",
  "src/task-store.ts",
  "src/internal/task/store.ts",
  "src/internal/persistence/atomic-write.ts",
  "src/errors.ts",
  "src/agent.ts",
  "src/agent-factory.ts",
  "src/agent-builder.ts",
  "src/define-tool.ts",
  "src/types/**/*",
  "src/index.ts",
  "src/workflow.ts",                            // NEW
  "src/eval.ts",                                // NEW
  "src/scorers.ts",                             // NEW (D3)
  "src/internal/eval/**/*",                     // NEW (eval.ts:19 + :77)
  "src/internal/workflow/**/*"                  // NEW (workflow.ts:27, :335)
]
```

**Invariant:** Every existing `include` entry stays. Only appends. JSON validity preserved (trailing commas managed correctly — JSONC tolerates them but standard JSON does not; check the existing file's convention before editing).

**Edge case:** If `src/internal/persistence/persistence-schema.ts` is imported from `src/workflow.ts:27` and NOT covered by any existing include, tsc fails. Mitigation: T1.2 acceptance criterion includes running tsc against the updated config; if tsc reports missing files, add the explicit path.

#### Tasks

1. Read `packages/sdk/tsconfig.tools-dts.json` (lines 12-25)
2. Append 5 new paths to `include`
3. Validate JSON syntax (no broken trailing comma)
4. Run `pnpm --filter @theokit/sdk build` and observe whether `dist/workflow.d.ts` + `dist/eval.d.ts` emit
5. If tsc reports missing transitive paths, append them (loop until clean)
6. Save

#### TDD

```
RED:     Before edit — `pnpm --filter @theokit/sdk build` succeeds but `dist/workflow.d.ts` MISSING
         (tsc lane sees `src/workflow.ts` only after this include update)
GREEN:   After edit + build — `dist/workflow.d.ts` exists, `dist/eval.d.ts` exists
REFACTOR: None expected.
VERIFY:  test -f packages/sdk/dist/workflow.d.ts && test -f packages/sdk/dist/eval.d.ts
         (both exist)
```

#### Acceptance Criteria

- [ ] `packages/sdk/tsconfig.tools-dts.json#include` has 5 new entries
- [ ] `pnpm --filter @theokit/sdk build` exits 0 (tsc step succeeds)
- [ ] `packages/sdk/dist/workflow.d.ts` exists
- [ ] `packages/sdk/dist/eval.d.ts` exists
- [ ] No tsc errors about unresolvable transitive imports
- [ ] **(v1.1, EC-2 SHOULD TEST)** Transitive include loop bounded: if step 5 (append missing transitive paths) iterates more than 4 times OR the `include` array grows by more than 10 entries beyond the original 5 new paths, ESCALATE: reopen D1 with the empirical fan-out data, consider falling back to tsup `dts.entry` instead of the tsc lane. The plan's tsc-lane assumption is invalidated by unbounded transitive surface.

#### DoD

- [ ] All 6 tasks completed
- [ ] tsc step exits 0
- [ ] Both `.d.ts` artifacts present

---

### T1.3 — Extend `mirror-dts-to-cts.mjs` targets to mirror new entries

#### Objective

Add `dist/workflow.d.ts` and `dist/eval.d.ts` to the explicit mirror targets so the script produces `.d.cts` siblings for the CJS condition in the exports map.

#### Evidence

Blueprint Q3 Diff 3. Empirical confirmation in `.claude/knowledge-base/discoveries/blueprints/sdk-subpath-extraction-workflow-eval-blueprint.md` Citation Audit: `packages/sdk/scripts/mirror-dts-to-cts.mjs:32-36` uses an EXPLICIT array (not a `dist/**` glob). Two new sub-paths require two new entries.

#### Files to edit

```
packages/sdk/scripts/mirror-dts-to-cts.mjs — extend `targets` array (line 32-36)
```

#### Deep file dependency analysis

- **`packages/sdk/scripts/mirror-dts-to-cts.mjs`**: post-build mirror invoked from `packages/sdk/tsup.config.ts:41` `onSuccess`. Today targets `tools/`, `path-safety.d.ts`, `task-store.d.ts`. After this task adds `workflow.d.ts` + `eval.d.ts`. Output: `dist/workflow.d.cts` + `dist/eval.d.cts`.
- **Why it matters:** `package.json#exports."./workflow".require.types` points at `dist/workflow.d.cts`. Without the mirror, that path does not exist and `attw` flags "Masquerading as ESM".

#### Deep Dives

**Insertion site:**

```js
// packages/sdk/scripts/mirror-dts-to-cts.mjs:32-38 — AFTER edit
const targets = [
  join(DIST, "tools"),
  join(DIST, "path-safety.d.ts"),
  join(DIST, "task-store.d.ts"),
  join(DIST, "workflow.d.ts"),     // NEW
  join(DIST, "eval.d.ts"),         // NEW
];
```

**Invariant:** Walking semantics preserved. The script branches on `stat.isDirectory()` vs `target.endsWith(".d.ts")` — both new entries hit the second branch (single-file copy, not recursive walk).

**Edge case:** If T1.2 failed to emit `dist/workflow.d.ts`, the script silently skips that target (per the `try/catch` at `mirror-dts-to-cts.mjs:46-51`). The CJS condition resolves to a non-existent file and attw flags it. Acceptance criterion checks `.d.cts` existence explicitly.

#### Tasks

1. Read `packages/sdk/scripts/mirror-dts-to-cts.mjs:32-36`
2. Append two new entries to `targets`
3. Save
4. Re-run `pnpm --filter @theokit/sdk build` (the `onSuccess` step runs the script)
5. Verify `.d.cts` siblings emitted

#### TDD

```
RED:     Before edit — `dist/workflow.d.cts` does NOT exist (only `.d.ts`)
GREEN:   After edit + build — `dist/workflow.d.cts` + `dist/eval.d.cts` exist
REFACTOR: None expected.
VERIFY:  test -f packages/sdk/dist/workflow.d.cts && test -f packages/sdk/dist/eval.d.cts
```

#### Acceptance Criteria

- [ ] `packages/sdk/scripts/mirror-dts-to-cts.mjs#targets` has 5 entries (was 3)
- [ ] `pnpm --filter @theokit/sdk build` exits 0
- [ ] `packages/sdk/dist/workflow.d.cts` exists
- [ ] `packages/sdk/dist/eval.d.cts` exists

#### DoD

- [ ] All 5 tasks completed
- [ ] Both `.d.cts` artifacts present

---

## Phase 2: Exports map + barrel delete + Scorers re-export

**Objective:** Declare the new sub-paths in `package.json` and physically remove the symbols from the main barrel. Re-export `Scorers` from `src/eval.ts` per D3.

### T2.1 — Add `./workflow` + `./eval` to `package.json#exports`

#### Objective

Make `import "@theokit/sdk/workflow"` and `import "@theokit/sdk/eval"` resolvable.

#### Evidence

Blueprint Q3 Diff 4 + D2. Pattern copied from existing entries `./errors`, `./cron`, etc. (`packages/sdk/package.json` exports map).

#### Files to edit

```
packages/sdk/package.json — add two new exports map entries
```

#### Deep file dependency analysis

- **`packages/sdk/package.json#exports`**: declares all public entry points. Each entry has `import.{types,default}` + `require.{types,default}` condition tuples for ESM/CJS interop.
- **Downstream impact:** TypeScript's `moduleResolution: "node16"` and `attw --pack . --ignore-rules no-resolution` validate the map. Without this entry, `import "@theokit/sdk/workflow"` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`.

#### Deep Dives

**Insertion site (after the existing `./task-store` entry, before `./package.json` self-reference):**

```json
"./workflow": {
  "import": {
    "types": "./dist/workflow.d.ts",
    "default": "./dist/workflow.js"
  },
  "require": {
    "types": "./dist/workflow.d.cts",
    "default": "./dist/workflow.cjs"
  }
},
"./eval": {
  "import": {
    "types": "./dist/eval.d.ts",
    "default": "./dist/eval.js"
  },
  "require": {
    "types": "./dist/eval.d.cts",
    "default": "./dist/eval.cjs"
  }
},
```

**Invariant:** JSON validity preserved. Comma at end of `./eval` block only if there's a following entry (`./package.json`); otherwise no trailing comma.

**Edge case:** If `dist/workflow.{js,cjs,d.ts,d.cts}` are missing (T1.x failed), this task LANDS but `attw` will fail in Phase 4. That's the intended catch — exports map honesty is enforced by attw.

#### Tasks

1. Read `packages/sdk/package.json` exports map (find existing `./task-store` block as template)
2. Insert `./workflow` and `./eval` entries
3. Validate JSON via `node -e "require('./packages/sdk/package.json')"`
4. Save

#### TDD

```
RED:     node -e "require('@theokit/sdk/workflow')" (from a probe context) — fails with ERR_PACKAGE_PATH_NOT_EXPORTED before the edit
GREEN:   After edit + build — node -e via the SDK package resolves to `dist/workflow.cjs`
REFACTOR: None expected.
VERIFY:  node -e "const p=require('./packages/sdk/package.json'); console.log(Object.keys(p.exports).filter(k => k === './workflow' || k === './eval'))"
         outputs `[ './workflow', './eval' ]`
```

#### Acceptance Criteria

- [ ] `packages/sdk/package.json` JSON valid
- [ ] `exports` map contains `./workflow` + `./eval` entries
- [ ] Each entry has ESM (`import.types/default`) + CJS (`require.types/default`) conditions

#### DoD

- [ ] All 4 tasks completed
- [ ] JSON valid
- [ ] Map exports verified by grep

---

### T2.2 — Add `Scorers` re-export to `src/eval.ts` (per D3)

#### Objective

`src/eval.ts` becomes the barrel for `@theokit/sdk/eval`. Adding `export { Scorers } from "./scorers.js"` makes Scorers reachable from the new sub-path.

#### Evidence

Blueprint D3 + Q5 Step 2 evidence (`examples/eval/run.ts:14` imports `Scorers` from `@theokit/sdk`). After Phase 2, that import becomes `@theokit/sdk/eval`, so `Scorers` MUST be exported from `src/eval.ts`.

#### Files to edit

```
packages/sdk/src/eval.ts — add `export { Scorers } from "./scorers.js"`
```

#### Deep file dependency analysis

- **`packages/sdk/src/eval.ts`**: currently 77 LoC. Imports zod, `./internal/eval/runner.js`, `./types/eval.js`. Re-exports `EvalAlreadyRunningError` at line 77.
- **After edit:** add a single export line. The natural place is alongside the existing `EvalAlreadyRunningError` re-export at line 77, or as a fresh line near the top.
- **Downstream impact:** `src/scorers.ts` (151 LoC, declares `Scorers` namespace) is now reachable via `@theokit/sdk/eval` even though it lives in a separate file. Per T1.2 the `src/scorers.ts` is in the tsc include, so its DTS reaches `dist/eval.d.ts`.

#### Deep Dives

**Insertion site (after the existing re-export):**

```ts
// packages/sdk/src/eval.ts (near line 77 after EvalAlreadyRunningError re-export)
export { Scorers } from "./scorers.js";
```

**Invariant:** No change to the runtime behavior of `Eval` or `Scorers`. Pure re-export.

**Edge case:** If `Scorers` is later split into individual scorers as named exports (currently a namespace), update the re-export to `export * from "./scorers.js"`. Not in scope here.

#### Tasks

1. Read `packages/sdk/src/eval.ts:75-77`
2. Add `export { Scorers } from "./scorers.js";` after line 77
3. Save

#### TDD

```
RED:     After Phase 3 migration (anticipating), `examples/eval/run.ts:14` imports
         `{ Eval, Scorers, type EvalRun } from "@theokit/sdk/eval"`. Without this re-export,
         tsc reports `Module '"@theokit/sdk/eval"' has no exported member 'Scorers'`.
GREEN:   After edit + rebuild — `import { Scorers } from "@theokit/sdk/eval"` resolves.
REFACTOR: None expected.
VERIFY:  grep -n "export { Scorers }" packages/sdk/src/eval.ts (exits 0)
         After rebuild: grep -n "Scorers" packages/sdk/dist/eval.d.ts (Scorers symbol present)
```

#### Acceptance Criteria

- [ ] `packages/sdk/src/eval.ts` contains `export { Scorers } from "./scorers.js"`
- [ ] After build: `dist/eval.d.ts` exports the Scorers symbol (verified by grep)

#### DoD

- [ ] All 3 tasks completed
- [ ] Build green
- [ ] Symbol present in dist

---

### T2.2b — Add type re-exports to `src/eval.ts` and `src/workflow.ts` (EC-1 MUST FIX from edge-case review)

#### Objective

Ensure `EvalRun`, `Scorer`, `Score`, `EvalOptions`, `EvalAggregate`, `WorkflowDefinition`, `WorkflowStep`, `WorkflowRunOptions`, and every other type alias from `./types/eval.js` + `./types/workflow.js` reaches consumers via the new sub-paths. Without this, T3.1 + T3.2 + T4.4 typecheck fails after T2.3 deletes `types/index.ts:12,25`.

#### Evidence

Empirical confirmation in edge-case review EC-1: `packages/sdk/src/eval.ts:20` imports `EvalOptions, EvalRun, EvalRunOptions` from `./types/eval.js` for internal use only — never re-exports them. `packages/sdk/src/workflow.ts:341-349` re-exports only the 8 `Workflow*Error` runtime classes (named) from `./types/workflow.js`, NOT the type aliases. Currently, type-only consumers (`type EvalRun`, `type WorkflowDefinition`) reach the main barrel only via `packages/sdk/src/types/index.ts:12,25` — which T2.3 deletes. The two existing consumers (`packages/cli/src/eval/runner.ts:14`, `examples/eval/run.ts:14`) both import `type EvalRun` from `@theokit/sdk`; without this re-export, both break post-Phase 3.

#### Files to edit

```
packages/sdk/src/eval.ts — add export type * from "./types/eval.js"
packages/sdk/src/workflow.ts — add export type * from "./types/workflow.js"
```

#### Deep file dependency analysis

- **`packages/sdk/src/eval.ts`**: 77 LoC pre-T2.2. Already imports types at line 20 for internal use; this task adds a single `export type *` line so the sub-path `@theokit/sdk/eval` surfaces the full type API.
- **`packages/sdk/src/workflow.ts`**: 379 LoC. Lines 341-349 already re-export the 8 `Workflow*Error` named runtime symbols. This task adds an `export type *` for the OTHER type aliases (`WorkflowDefinition`, `WorkflowStep`, etc.) co-located.
- **Downstream impact:** the sub-paths become drop-in replacements for the main-barrel imports they replaced. T3.1 + T3.2 + T4.4 typecheck succeeds.

#### Deep Dives

**Insertion site — `packages/sdk/src/eval.ts`** (after the existing `EvalAlreadyRunningError` re-export at line 77, alongside the T2.2 Scorers re-export):

```ts
// packages/sdk/src/eval.ts — after the existing re-exports
export { Scorers } from "./scorers.js";              // from T2.2
export type * from "./types/eval.js";                 // NEW (T2.2b — surfaces EvalRun, Scorer, Score, EvalOptions, EvalAggregate, etc.)
```

**Insertion site — `packages/sdk/src/workflow.ts`** (immediately after the existing named-error re-export block at lines 341-349):

```ts
// packages/sdk/src/workflow.ts — after the existing Workflow*Error re-exports
export type * from "./types/workflow.js";             // NEW (T2.2b — surfaces WorkflowDefinition, WorkflowStep, WorkflowRunOptions, etc.)
```

**Invariant:** `export type *` is type-only — produces zero runtime impact, only DTS surface area. The two new lines compile to nothing in the emitted `.js` / `.cjs`.

**Edge case:** `export type *` requires TypeScript ≥ 5.0; the workspace pins TypeScript `^5.8.0` per `CLAUDE.md` toolchain table, so this is safe. If a future tsconfig downgrades, this line becomes a compile error — that's an honest tripwire, not a hidden defect.

#### Tasks

1. Read `packages/sdk/src/eval.ts:75-77`
2. Append `export type * from "./types/eval.js";` after the `EvalAlreadyRunningError` re-export
3. Read `packages/sdk/src/workflow.ts:341-349`
4. Append `export type * from "./types/workflow.js";` after the closing brace of the named-error re-export block
5. Save both files
6. Run `pnpm --filter @theokit/sdk build` to confirm the new dist `.d.ts` files surface the types
7. Verify via `grep "EvalRun\|WorkflowDefinition" packages/sdk/dist/eval.d.ts packages/sdk/dist/workflow.d.ts` (both symbols should appear)

#### TDD

```
RED:     Before edit + after Phase 3 — pnpm typecheck FAILS:
         "Module '@theokit/sdk/eval' has no exported member 'EvalRun'"
         "Module '@theokit/sdk/eval' has no exported member 'Scorer'"
GREEN:   After edit + T4.0 rebuild — pnpm typecheck exits 0; the types surface in dist .d.ts files
REFACTOR: None expected.
VERIFY:  grep -c "export type \* from" packages/sdk/src/eval.ts == 1
         grep -c "export type \* from" packages/sdk/src/workflow.ts == 1
         After build: grep -c "EvalRun\|Scorer" packages/sdk/dist/eval.d.ts >= 2
```

#### Acceptance Criteria

- [ ] `packages/sdk/src/eval.ts` contains `export type * from "./types/eval.js"`
- [ ] `packages/sdk/src/workflow.ts` contains `export type * from "./types/workflow.js"`
- [ ] After build: `EvalRun` symbol present in `dist/eval.d.ts`
- [ ] After build: `WorkflowDefinition` symbol present in `dist/workflow.d.ts`
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0

#### DoD

- [ ] All 7 tasks completed
- [ ] Both files updated
- [ ] Dist types surface verified by grep

---

### T2.3 — Delete Workflow + Eval + Scorers exports from `index.ts` and `types/index.ts`

#### Objective

Physically remove the symbols from the main barrel so `import { Workflow } from "@theokit/sdk"` fails type-check post-migration. This is THE breaking change.

#### Evidence

Blueprint Q3 Diff 5 + user's explicit no-backwards-compat directive. The exact deletion sites are:
- `packages/sdk/src/index.ts:55-56` (Eval block)
- `packages/sdk/src/index.ts:108` (Scorers line)
- `packages/sdk/src/index.ts:135-149` (Workflow block)
- `packages/sdk/src/types/index.ts:12` (eval type re-export)
- `packages/sdk/src/types/index.ts:25` (workflow type re-export)

#### Files to edit

```
packages/sdk/src/index.ts — delete 3 export blocks
packages/sdk/src/types/index.ts — delete 2 type re-exports
```

#### Deep file dependency analysis

- **`packages/sdk/src/index.ts`**: the main barrel, 149 LoC pre-edit. Three blocks come out (Eval at 55-56, Scorers at 108, Workflow at 135-149). Adjacent comment headers (e.g., `// Eval suite (Adoption Roadmap #2; ADRs D202-D213)`) also delete with the block.
- **`packages/sdk/src/types/index.ts`**: type-barrel. Lines 12 and 25 are `export type * from "./eval.js"` and `export type * from "./workflow.js"`.
- **Downstream impact:** every monorepo file that currently imports `Workflow`, `Eval`, `Scorers`, etc. from `@theokit/sdk` will fail typecheck. Phase 3 migrates the 2 known consumers; any other consumer (none expected, verified by Q5 Step 2) gets an honest tsc error.

#### Deep Dives

**Deletion site 1 — `packages/sdk/src/index.ts:54-56`** (delete the comment + the export):

```ts
// DELETE
// Eval suite (Adoption Roadmap #2; ADRs D202-D213)
export { Eval, EvalAlreadyRunningError } from "./eval.js";
```

**Deletion site 2 — `packages/sdk/src/index.ts:108`** (delete just the line):

```ts
// DELETE
export { Scorers } from "./scorers.js";
```

**Deletion site 3 — `packages/sdk/src/index.ts:134-149`** (delete the comment + entire block):

```ts
// DELETE
// Workflows (Adoption Roadmap #5; ADRs D230-D248)
export {
  agentStep,
  fn,
  Workflow,
  WorkflowAlreadyRunningError,
  WorkflowBuilder,
  WorkflowCompensateNotImplementedError,
  WorkflowDuplicateStepIdError,
  WorkflowMaxIterationsExceededError,
  WorkflowNotSerializableError,
  WorkflowParallelError,
  WorkflowResumeStepNotFoundError,
  WorkflowSnapshotNotFoundError,
} from "./workflow.js";
```

**Deletion sites 4 + 5 — `packages/sdk/src/types/index.ts:12` and `:25`**:

```ts
// DELETE line 12
export type * from "./eval.js";

// DELETE line 25
export type * from "./workflow.js";
```

**Invariant:** After deletion, `packages/sdk/src/index.ts` has NO reference to `./workflow.js`, `./eval.js`, or `./scorers.js`. The barrel is strictly smaller. `types/index.ts` similarly loses two `export type *` lines.

**Edge case:** Some comments in `index.ts` reference Workflow/Eval/Scorers (e.g., the section header `// Eval suite (Adoption Roadmap #2; ADRs D202-D213)`). Comments don't affect runtime; remove them ONLY if they accompany the deleted export. Leave unrelated comments intact.

#### Tasks

1. Read `packages/sdk/src/index.ts` lines 54-56, 108, 134-149
2. **(v1.1, EC-3 SHOULD TEST)** Delete in REVERSE line-number order: first the Workflow block (134-149), then the Scorers line (108), then the Eval block (54-56). Bottom-up deletion preserves line-number accuracy for subsequent edits because earlier lines never shift. Alternative if your editor can re-grep after each Edit: top-down is fine, but you MUST re-locate the next block by content (not by line number) between Edits.
3. Read `packages/sdk/src/types/index.ts:12, :25`
4. Delete the 2 type re-export lines (same reverse-order discipline: line 25 first, then line 12)
5. Verify `grep -nE "Workflow|EvalAlreadyRunningError|Scorers|agentStep" packages/sdk/src/index.ts packages/sdk/src/types/index.ts` returns ONLY comments or unrelated context (no `export ... from "./{workflow,eval,scorers}"`)
6. Save

#### TDD

```
RED:     Before edit — grep -c "from \"./workflow.js\"" packages/sdk/src/index.ts returns ≥ 1
GREEN:   After edit + rebuild — grep returns 0; pnpm --filter @theokit/sdk typecheck exits 0
         (the SDK's own typecheck still passes because no internal SDK file imports Workflow
         from the barrel)
REFACTOR: None expected — the cleanest delete.
VERIFY:  grep -c "from \"./workflow.js\"\\|from \"./eval.js\"\\|from \"./scorers.js\"" packages/sdk/src/index.ts == 0
         grep -c "from \"./eval.js\"\\|from \"./workflow.js\"" packages/sdk/src/types/index.ts == 0
```

#### Acceptance Criteria

- [ ] `packages/sdk/src/index.ts` no longer re-exports `Workflow`, `Eval`, `EvalAlreadyRunningError`, `Scorers`, or any `Workflow*` symbol
- [ ] `packages/sdk/src/types/index.ts` no longer re-exports `./eval.js` or `./workflow.js`
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0 (SDK self-check passes)
- [ ] `pnpm --filter @theokit/sdk build` exits 0

#### DoD

- [ ] All 6 tasks completed
- [ ] Both files cleaned
- [ ] SDK typecheck + build exit 0

---

## Phase 3: Consumer migration (2 import sites)

**Objective:** Update the 2 known consumer sites from `@theokit/sdk` to `@theokit/sdk/eval`.

### T3.1 — Migrate `packages/cli/src/eval/runner.ts:14`

#### Objective

Rewrite the CLI's eval runner import to use the new sub-path.

#### Evidence

Blueprint Q5 Step 2 + Appendix A. Current line at `packages/cli/src/eval/runner.ts:14`:
```ts
import { Eval, type EvalRun, type Scorer as SdkScorer } from "@theokit/sdk";
```

#### Files to edit

```
packages/cli/src/eval/runner.ts — change line 14 import source
```

#### Deep file dependency analysis

- **`packages/cli/src/eval/runner.ts`**: 1 import line affected. The CLI consumes Eval as a runtime path (`@theokit/cli` shells `theokit eval` to this).
- **Downstream impact:** the CLI's `eval` command continues to work. No CLI-public API change.

#### Deep Dives

**Edit site:**

```ts
// BEFORE
import { Eval, type EvalRun, type Scorer as SdkScorer } from "@theokit/sdk";

// AFTER
import { Eval, type EvalRun, type Scorer as SdkScorer } from "@theokit/sdk/eval";
```

**Invariant:** Same named imports. Only the source string changes.

**Edge case:** If the `Scorer` type lives in `src/types/eval.ts` (verified — it's re-exported via `types/index.ts:12` today), the sub-path resolves it via the new `export type * from "./types/eval.js"` that `src/eval.ts` will need to surface. Check during build: if tsc errors "Module has no exported member 'Scorer'", add `export type * from "./types/eval.js"` to `src/eval.ts`.

#### Tasks

1. Read `packages/cli/src/eval/runner.ts:14`
2. Change `@theokit/sdk` to `@theokit/sdk/eval`
3. Save
4. Run `pnpm --filter @theokit/cli typecheck`
5. If tsc reports `Scorer` type missing, return to T2.2 and add `export type * from "./types/eval.js"` to `src/eval.ts`

#### TDD

```
RED:     Before edit + after Phase 2 — `pnpm --filter @theokit/cli typecheck` FAILS
         with "Module '@theokit/sdk' has no exported member 'Eval'" (barrel deletion broke it)
GREEN:   After edit — typecheck exits 0
REFACTOR: None expected.
VERIFY:  pnpm --filter @theokit/cli typecheck exit 0
```

#### Acceptance Criteria

- [ ] `packages/cli/src/eval/runner.ts:14` imports from `@theokit/sdk/eval`
- [ ] `pnpm --filter @theokit/cli typecheck` exits 0
- [ ] No other `@theokit/sdk` Workflow/Eval imports linger in `packages/cli/src/` (verified via grep)

#### DoD

- [ ] All 5 tasks completed
- [ ] CLI typecheck exit 0

---

### T3.2 — Migrate `examples/eval/run.ts:14`

#### Objective

Rewrite the eval example's import to use the new sub-path. Real-LLM example per `.claude/rules/real-llm-validation.md`.

#### Evidence

Blueprint Q5 Step 2 + Appendix A. Current line at `examples/eval/run.ts:14`:
```ts
import { Eval, Scorers, type EvalRun } from "@theokit/sdk";
```

#### Files to edit

```
examples/eval/run.ts — change line 14 import source
```

#### Deep file dependency analysis

- **`examples/eval/run.ts`**: standalone example, real-LLM-validated. Imports Eval + Scorers (both move to `/eval`).
- **Downstream impact:** the example continues to run against OpenRouter/Ollama unchanged. `tools/typecheck-examples.sh` exercises it.

#### Deep Dives

**Edit site:**

```ts
// BEFORE
import { Eval, Scorers, type EvalRun } from "@theokit/sdk";

// AFTER
import { Eval, Scorers, type EvalRun } from "@theokit/sdk/eval";
```

**Invariant:** Same named imports. Only source string changes.

**Edge case:** `EvalRun` is a type alias from `src/types/eval.ts`. Same edge case as T3.1 — ensure `src/eval.ts` re-exports `./types/eval.js` types if tsc complains.

#### Tasks

1. Read `examples/eval/run.ts:14`
2. Change `@theokit/sdk` to `@theokit/sdk/eval`
3. Save

#### TDD

```
RED:     Before edit + after Phase 2 — typecheck or `tools/typecheck-examples.sh` FAILS
         with the same "no exported member" error
GREEN:   After edit + after T4.0 rebuild — example typecheck passes
REFACTOR: None expected.
VERIFY:  cd examples/eval && pnpm install --no-frozen-lockfile && npx tsc --noEmit exit 0
         (or the equivalent run via tools/typecheck-examples.sh)
```

#### Acceptance Criteria

- [ ] `examples/eval/run.ts:14` imports from `@theokit/sdk/eval`
- [ ] Example typecheck exits 0 after pre-build (T4.0)
- [ ] No other `@theokit/sdk` Workflow/Eval imports linger in `examples/` (verified via grep)

#### DoD

- [ ] All 3 tasks completed
- [ ] Example typecheck exit 0

---

## Phase 4: Rebuild + validation sweep

**Objective:** Per D4, explicitly rebuild the SDK before running the validation gates, then exercise `publint`, `attw`, and `tools/typecheck-examples.sh`.

### T4.0 — Explicit SDK rebuild (mandatory pre-validation step per D4)

#### Objective

Force `pnpm --filter @theokit/sdk build` so `dist/` has fresh `workflow.{js,cjs,d.ts,d.cts}` + `eval.{js,cjs,d.ts,d.cts}`. Without this, downstream typecheck reads stale `dist/`.

#### Evidence

Blueprint D4 + Q6 evidence (`tools/typecheck-examples.sh:1-50` does NOT call `pnpm build`).

#### Files to edit

None. This is a command invocation.

#### Deep file dependency analysis

- **`packages/sdk/dist/`** (read-after-write target): Phase 1+2 changes to `tsup.config.ts`, `tsconfig.tools-dts.json`, `mirror-dts-to-cts.mjs`, `index.ts`, `types/index.ts`, and `eval.ts` ONLY take effect after a rebuild.
- **Downstream:** T4.1, T4.2, T4.3 all consume the freshly built `dist/`.

#### Deep Dives

**Command sequence:**

```bash
pnpm --filter @theokit/sdk build
# verify outcome
ls packages/sdk/dist/workflow.{js,cjs,d.ts,d.cts}
ls packages/sdk/dist/eval.{js,cjs,d.ts,d.cts}
```

**Invariant:** After T4.0 finishes, all 8 artifacts exist.

**Edge case:** If T1.x or T2.x left a bug (e.g., a missing tsconfig include), the build fails here. The plan halts at T4.0 — downstream tasks cannot proceed with a broken `dist/`.

#### Tasks

1. Run `pnpm --filter @theokit/sdk build`
2. Verify exit 0
3. Verify 8 artifacts present via `ls`

#### TDD

```
RED:     Before T4.0 — `ls packages/sdk/dist/workflow.d.ts` returns "No such file" because Phase 2
         edits aren't materialized in dist yet
GREEN:   After T4.0 — all 8 artifacts present
REFACTOR: None.
VERIFY:  pnpm --filter @theokit/sdk build && ls packages/sdk/dist/workflow.* packages/sdk/dist/eval.* (all 8 present)
```

#### Acceptance Criteria

- [ ] Build exit 0
- [ ] All 8 dist artifacts present (4 per sub-path × 2 sub-paths)

#### DoD

- [ ] All 3 tasks completed
- [ ] Build green
- [ ] Artifacts verified

---

### T4.1 — `pnpm validate:publint` exit 0

#### Objective

Confirm the exports map is publishable per publint's rules.

#### Evidence

Root `package.json:18`: `"validate:publint": "pnpm --filter=@theokit/sdk exec publint"`. CI invokes this at `.github/workflows/ci.yml:65`.

#### Files to edit

None.

#### Deep file dependency analysis

- publint reads `packages/sdk/package.json` and validates each `exports` entry. The new `./workflow` + `./eval` entries are scrutinized.
- A common publint failure: missing files referenced in `exports`. Phase 1+T4.0 ensures all 8 referenced files exist.

#### Deep Dives

**Common publint warnings:**

- `import` condition before `require` (we follow this convention).
- `types` condition first within each format (we follow this).
- Missing `.d.cts` for CJS condition (mirror script handles this).

**Invariant:** Zero publint warnings on the two new entries.

**Edge case:** If publint reports a warning we cannot fix in this scope (e.g., a pre-existing issue with `./errors`), it's pre-existing and not blocking. Document in commit message.

#### Tasks

1. Run `pnpm validate:publint` from repo root
2. Verify exit 0
3. If warnings appear, classify: caused-by-this-plan vs pre-existing
4. Fix any caused-by-this-plan warnings before proceeding

#### TDD

```
RED:     Without proper exports/mirror setup — publint would flag "Masquerading as ESM" or missing files
GREEN:   After T4.0 + correctly-shaped exports — publint exit 0
REFACTOR: None.
VERIFY:  pnpm validate:publint exit 0
```

#### Acceptance Criteria

- [ ] `pnpm validate:publint` exits 0
- [ ] No new warnings tied to `./workflow` or `./eval`

#### DoD

- [ ] All 4 tasks completed
- [ ] publint clean

---

### T4.2 — `pnpm validate:attw` exit 0

#### Objective

Confirm `Are The Types Wrong` validates the new exports without resolution failures.

#### Evidence

Root `package.json:19`: `"validate:attw": "pnpm --filter=@theokit/sdk exec attw --pack . --ignore-rules no-resolution"`. CI invokes this at `.github/workflows/ci.yml:68`.

#### Files to edit

None.

#### Deep file dependency analysis

- attw resolves every `exports` entry under both `import` and `require` conditions and verifies the `.d.ts`/`.d.cts` files match expected shape (ESM declaration vs CJS declaration).
- The mirror script (T1.3) is specifically to prevent attw's "Masquerading as ESM" flag.

#### Deep Dives

**Invariant:** attw exit 0 means every consumer can resolve `@theokit/sdk/workflow` and `@theokit/sdk/eval` in both `moduleResolution: "node16"` and CJS contexts.

**Edge case:** If `--ignore-rules no-resolution` masks a real bug (rare but possible), use `pnpm --filter @theokit/sdk exec attw --pack . --profile node16` for a fuller check, then only land the fix once that also exits 0.

#### Tasks

1. Run `pnpm validate:attw` from repo root
2. Verify exit 0
3. If failures appear, classify: caused-by-this-plan vs pre-existing
4. Fix caused-by-this-plan failures

#### TDD

```
RED:     Without `.d.cts` mirror — attw flags "Masquerading as ESM" on `./workflow.require.types`
GREEN:   After T1.3 mirror + T4.0 rebuild — attw exit 0
REFACTOR: None.
VERIFY:  pnpm validate:attw exit 0
```

#### Acceptance Criteria

- [ ] `pnpm validate:attw` exits 0
- [ ] No new failures tied to `./workflow` or `./eval`

#### DoD

- [ ] All 4 tasks completed
- [ ] attw clean

---

### T4.3 — `tools/typecheck-examples.sh` exit 0

#### Objective

Confirm every example (including the migrated `examples/eval/run.ts`) typechecks against the freshly built SDK dist.

#### Evidence

Blueprint Q6 + D4. `tools/typecheck-examples.sh` is the example-sweep gate. Per `.claude/rules/real-llm-validation.md`, examples must run; typecheck is the first gate.

#### Files to edit

None.

#### Deep file dependency analysis

- The script iterates every `examples/*/` with a `tsconfig.json`, re-resolves the `file:` link, and runs `npx tsc --noEmit`.
- T4.0 ensured fresh dist. T3.2 migrated `examples/eval/run.ts`.

#### Deep Dives

**Invariant:** All examples pass tsc. The migrated `examples/eval/run.ts` resolves `@theokit/sdk/eval` against the new dist artifacts.

**Edge case:** If an unrelated example breaks due to a pre-existing issue, classify and triage. Only plan-caused breaks block.

#### Tasks

1. Run `tools/typecheck-examples.sh`
2. Verify exit 0 (script exit code = fail count)
3. If failures: open `.claude/knowledge-base/reviews/examples-typecheck-{date}.md` (the script's auto-generated report) and classify
4. Fix any caused-by-this-plan failures

#### TDD

```
RED:     Before T3.2 + T4.0 — examples/eval/run.ts:14 imports from "@theokit/sdk" which no longer
         exports Eval, so tsc fails the example
GREEN:   After T3.2 + T4.0 — example tsc exits 0
REFACTOR: None.
VERIFY:  tools/typecheck-examples.sh exit 0 (fail count == 0)
```

#### Acceptance Criteria

- [ ] `tools/typecheck-examples.sh` exits 0
- [ ] No new failures tied to `examples/eval/run.ts`
- [ ] **(v1.1, EC-6 SHOULD TEST)** Fresh-dist resolution verified — after the sweep, `examples/eval/node_modules/.pnpm/@theokit+sdk@*/node_modules/@theokit/sdk/dist/eval.d.ts` exists AND contains the `Scorers` export (proves pnpm resolved against the just-built dist, not a stale cache). If absent: `rm -rf examples/eval/node_modules examples/eval/pnpm-lock.yaml && tools/typecheck-examples.sh` to force fresh resolution.

#### DoD

- [ ] All 4 tasks completed
- [ ] Example sweep green

---

### T4.4 — Workspace-wide typecheck + biome check

#### Objective

Final belt-and-suspenders check: `pnpm typecheck` + `pnpm check` (biome) across the workspace.

#### Evidence

Root `package.json:16` (`typecheck`) + `:17` (`check: "biome check ."`). CI runs both.

#### Files to edit

None.

#### Tasks

1. Run `pnpm typecheck` from root
2. Run `pnpm check` from root
3. Verify both exit 0

#### TDD

```
RED:     If any consumer package has an undetected import of a removed symbol — typecheck fails
GREEN:   After Phase 3 migrations — typecheck exits 0; biome reports no new lint errors
REFACTOR: None.
VERIFY:  pnpm typecheck && pnpm check (both exit 0)
```

#### Acceptance Criteria

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm check` exits 0
- [ ] No new biome warnings caused by the edits

#### DoD

- [ ] All 3 tasks completed
- [ ] Both gates clean

---

## Phase 5: CHANGELOG + version bump

**Objective:** Document the breaking change in the package CHANGELOG and bump version per D6.

### T5.1 — Update `packages/sdk/CHANGELOG.md` `[Unreleased]` section

#### Objective

Add a `Removed` entry under `[Unreleased]` per Inquebrável Rule 6 (Keep a Changelog format).

#### Evidence

CLAUDE.md inquebrável § 6 mandates: "Every code change updates `CHANGELOG.md` (workspace-level at root; per-package at `packages/<name>/CHANGELOG.md`)." Breaking change MUST appear under `Removed`.

#### Files to edit

```
packages/sdk/CHANGELOG.md — add Removed entries under [Unreleased]
```

#### Deep file dependency analysis

- **`packages/sdk/CHANGELOG.md`**: Keep a Changelog format. Has `[Unreleased]` and version-stamped sections.
- **Downstream impact:** consumers reading the changelog before upgrading see the breaking change.

#### Deep Dives

**Insertion under `[Unreleased]`:**

```markdown
### Removed
- `Workflow`, `WorkflowBuilder`, `WorkflowAlreadyRunningError`, `WorkflowCompensateNotImplementedError`, `WorkflowDuplicateStepIdError`, `WorkflowMaxIterationsExceededError`, `WorkflowNotSerializableError`, `WorkflowParallelError`, `WorkflowResumeStepNotFoundError`, `WorkflowSnapshotNotFoundError`, `agentStep`, `fn` from main barrel `@theokit/sdk`. Import from `@theokit/sdk/workflow` instead. (#sdk-subpath-extraction-workflow-eval)
- `Eval`, `EvalAlreadyRunningError`, `Scorers` from main barrel `@theokit/sdk`. Import from `@theokit/sdk/eval` instead. (#sdk-subpath-extraction-workflow-eval)

### Added
- `@theokit/sdk/workflow` sub-path entry — `import { Workflow, ... } from "@theokit/sdk/workflow"` (#sdk-subpath-extraction-workflow-eval)
- `@theokit/sdk/eval` sub-path entry — `import { Eval, Scorers, ... } from "@theokit/sdk/eval"` (#sdk-subpath-extraction-workflow-eval)
```

**Invariant:** `[Unreleased]` section is present and the new entries DO NOT touch already-released versions.

#### Tasks

1. Read `packages/sdk/CHANGELOG.md` (find `[Unreleased]` section)
2. Add `Removed` + `Added` subsections (or append to existing ones)
3. Reference issue/plan slug per Inquebrável Rule 6 (`(#sdk-subpath-extraction-workflow-eval)`)
4. Save

#### TDD

```
RED:     Before edit — grep -c "Removed" packages/sdk/CHANGELOG.md under [Unreleased] == 0 for this change
GREEN:   After edit — entries present
REFACTOR: None.
VERIFY:  grep -A 5 "## \\[Unreleased\\]" packages/sdk/CHANGELOG.md | grep -E "Workflow|Eval" exit 0
```

#### Acceptance Criteria

- [ ] `[Unreleased]` section has `Removed` and `Added` subsections covering this plan's changes
- [ ] Each entry has a slug reference

#### DoD

- [ ] All 4 tasks completed
- [ ] Changelog updated

---

### T5.2 — Bump `packages/sdk/package.json#version` to `1.5.0`

#### Objective

Bump per D6.

#### Files to edit

```
packages/sdk/package.json — change version: "1.4.1" → "1.5.0"
```

#### Tasks

1. Read `packages/sdk/package.json:3` (version line)
2. Change `"1.4.1"` → `"1.5.0"`
3. Validate JSON: `node -e "require('./packages/sdk/package.json')"`
4. Save

#### TDD

```
RED:     grep '"version": "1.4.1"' packages/sdk/package.json (exit 0 before edit)
GREEN:   grep '"version": "1.5.0"' packages/sdk/package.json (exit 0 after edit)
REFACTOR: None.
VERIFY:  node -e "console.log(require('./packages/sdk/package.json').version)" outputs "1.5.0"
```

#### Acceptance Criteria

- [ ] `packages/sdk/package.json#version === "1.5.0"`
- [ ] JSON valid

#### DoD

- [ ] All 4 tasks completed
- [ ] Version bumped

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Cycle-DTS empirical confirmation (blueprint Q2 Fase C) | T0.1 | Probe + cleanup runbook |
| 2 | tsup multi-entry for workflow/eval (blueprint Q3 Diff 1) | T1.1 | Add 2 entries to `tsup.config.ts#entry` |
| 3 | tsc DTS lane for workflow/eval (blueprint Q3 Diff 2 + D1) | T1.2 | Add 5 paths to `tsconfig.tools-dts.json#include` |
| 4 | `.d.cts` mirror for new entries (blueprint Q3 Diff 3) | T1.3 | Append to `targets` array in `mirror-dts-to-cts.mjs` |
| 5 | `package.json#exports` map (blueprint Q3 Diff 4 + D2) | T2.1 | Add `./workflow` + `./eval` explicit entries |
| 6 | Scorers co-location with Eval (blueprint D3) | T2.2 | Re-export from `src/eval.ts` |
| 7 | Barrel delete: Workflow + Eval + Scorers (blueprint Q3 Diff 5) | T2.3 | Delete 3 blocks in `index.ts` + 2 lines in `types/index.ts` |
| 8 | CLI consumer migration (blueprint Q5 site #1) | T3.1 | Rewrite `packages/cli/src/eval/runner.ts:14` |
| 9 | Example consumer migration (blueprint Q5 site #2) | T3.2 | Rewrite `examples/eval/run.ts:14` |
| 10 | Explicit SDK rebuild before validation (blueprint D4) | T4.0 | Mandatory `pnpm --filter @theokit/sdk build` |
| 11 | publint validation | T4.1 | `pnpm validate:publint` exit 0 |
| 12 | attw validation | T4.2 | `pnpm validate:attw` exit 0 |
| 13 | Examples typecheck sweep | T4.3 | `tools/typecheck-examples.sh` exit 0 |
| 14 | Workspace typecheck + biome | T4.4 | `pnpm typecheck && pnpm check` exit 0 |
| 15 | CHANGELOG breaking-change entry (Inquebrável Rule 6) | T5.1 | `Removed` + `Added` under `[Unreleased]` |
| 16 | SDK version bump (blueprint D6) | T5.2 | `1.4.1` → `1.5.0` |
| 17 | Dogfood QA validation (skill rule + Inquebrável § 11) | T6.1 | `/dogfood full` health ≥ 70 |
| 18 | Type re-exports preserved post barrel-delete (EC-1 MUST FIX) | T2.2b | `export type * from "./types/{eval,workflow}.js"` in `src/eval.ts` + `src/workflow.ts` |

**Coverage: 18/18 gaps covered (100%)**

## Global Definition of Done

- [ ] All 6 implementation phases completed (Phase 0 → Phase 5)
- [ ] `pnpm --filter @theokit/sdk build` exit 0 with 8 new dist artifacts
- [ ] `pnpm validate:publint` exit 0
- [ ] `pnpm validate:attw` exit 0
- [ ] `tools/typecheck-examples.sh` exit 0
- [ ] `pnpm typecheck && pnpm check` exit 0 workspace-wide
- [ ] `packages/sdk/CHANGELOG.md` documents the breaking change under `[Unreleased]`
- [ ] `packages/sdk/package.json#version === "1.5.0"`
- [ ] Plan-specific: zero references to removed symbols from main barrel remain in `packages/*/src/` + `examples/`
- [ ] **Dogfood QA PASS** — `/dogfood full` health score ≥ 70, zero CRITICAL issues caused by this plan
- [ ] **Runtime-metric proof** — N/A for this plan (packaging-only refactor; no new runtime counters added). The runtime-metric gate from `.claude/rules/integration-first.md` does not fire here. Recorded explicitly per skill instructions.

## Dogfood Evolution

> Required section per `/plan-confidence` soft-cap gate. Declares the runtime metric this plan moves and how `/dogfood-validate` will measure it.

- **metric_name**: `sdk_dist_subpath_count`
- **target_value**: 7 (was 5 — `errors`, `cron`, `tools`, `path-safety`, `task-store`; adds `workflow`, `eval`)
- **validation_command**: `node -e "console.log(Object.keys(require('./packages/sdk/package.json').exports).filter(k => k.startsWith('./') && k !== './package.json').length)"`
- **evidence_path**: `packages/sdk/package.json#exports` keys (snapshot before/after in commit diff); secondary evidence: presence of `packages/sdk/dist/{workflow,eval}.{js,cjs,d.ts,d.cts}` after `pnpm --filter @theokit/sdk build`.
- **severity**: blocking

A regression in the metric (sub-path count not increased to 7) means the extraction didn't land — caught immediately by Phase 4 validation. Blocking because the change DOES break consumers that don't migrate (intentional, per user no-backwards-compat directive); the validation gate MUST stop the merge if the metric doesn't move.

The metric is structural (count, not throughput). `/dogfood-validate` runs the command above and compares to target. The richer dogfood (end-to-end real-LLM run) runs in T6.1.

---

## Phase 6: Dogfood QA (MANDATORY)

> Runs AFTER all implementation phases complete. The plan is NOT done until dogfood passes.

### T6.1 — `/dogfood full` health check + manual eval-example real-LLM run

#### Objective

Validate that the post-extraction SDK works end-to-end as a consumer would experience it. For this packaging-only refactor, dogfood specifically confirms:

1. The dogfood-app (`/dogfood-app full`) builds + boots + serves all 24 GET routes successfully with the new SDK version installed.
2. `useAction(actions.saveMemory)` round-trip works (validates `Eval`/`Workflow` aren't accidentally on the agent's critical path).
3. Real-LLM cost still ≤ $0.01 (no inflated retries from broken imports).

#### Evidence

`.claude/rules/real-llm-validation.md` mandates real-LLM execution for any example whose surface includes `agent.send()`. The migrated `examples/eval/run.ts` calls `Eval.create({ ... }).run()` which transitively reaches `agent.send` — qualifies for the real-LLM gate.

Skill rule (`/to-plan` § "Dogfood QA is mandatory") + Inquebrável § 11 (eat your own cooking).

#### Files to edit

None. T6.1 is a validation invocation, not a code edit.

#### Deep file dependency analysis

- `/dogfood full` reads `examples/dogfood-app/` and runs a full Playwright + Chrome DevTools MCP suite per the dogfood skill spec.
- `examples/eval/run.ts` (post-T3.2) is the real-LLM example whose typecheck T4.3 already proved. T6.1 additionally executes it.

#### Deep Dives

**Execution sequence:**

1. `/dogfood full` against `examples/dogfood-app/` — exercises Agent, Memory, useAction.
2. Manual real-LLM run of `examples/eval/`:
   ```bash
   cd examples/eval
   pnpm install
   OPENROUTER_API_KEY=sk-or-... pnpm run run
   ```
   Verify: `EvalRun` JSON printed to stdout, `aggregate.meanScore` present, cost ≤ $0.01.

**Invariant:** Both health checks PASS before T6.1 is marked done.

**Edge case:** If `/dogfood-app full` flags a CRITICAL that's unrelated to this plan (e.g., a pre-existing voice-pipeline bug), document it but do NOT block the plan. Only plan-caused CRITICAL + HIGH block.

#### Tasks

1. Run `/dogfood full`
2. Capture the SHIP-IT verdict + health score from the auto-generated report
3. Run `examples/eval/run.ts` against OpenRouter manually
4. Capture EvalRun output + cost
5. Classify any failures: caused-by-this-plan vs pre-existing
6. Fix caused-by-this-plan CRITICAL + HIGH; pre-existing logged

#### TDD

```
RED:     If consumers were missed in Phase 3 migration, /dogfood full reports CRITICAL on first
         affected route (build failed) OR the manual eval run errors with module-not-found.
GREEN:   /dogfood full PASS with health ≥ 70; examples/eval real-LLM run prints EvalRun JSON
REFACTOR: None.
VERIFY:  Report auto-saved at .claude/knowledge-base/reviews/dogfood-app/{timestamp}/report.md;
         grep "SHIP-IT\|health_score" that report; both indicate pass.
```

#### Acceptance Criteria

- [ ] Health score ≥ 70/100
- [ ] Zero CRITICAL issues introduced by this plan
- [ ] Zero HIGH issues in `examples/eval/`, `packages/cli/src/eval/`, or any code path touching the migrated symbols
- [ ] Manual `examples/eval/run.ts` real-LLM run prints a valid EvalRun JSON
- [ ] Real-LLM cost ≤ $0.01
- [ ] Any pre-existing issues documented in the dogfood report (not caused by this plan)

#### DoD

- [ ] All 6 tasks completed
- [ ] `/dogfood full` report saved
- [ ] Manual eval run captured (output + cost)
- [ ] Plan-caused CRITICAL + HIGH issues fixed

### Execution

Run `/dogfood full`. Always full. No shortcuts.

### Acceptance Criteria (phase-level)

### Execution

Run `/dogfood full`. Always full. No shortcuts.

### Acceptance Criteria

- [ ] Health score ≥ 70/100
- [ ] Zero CRITICAL issues introduced by this plan
- [ ] Zero HIGH issues in `examples/eval/`, `packages/cli/src/eval/`, or any code path touching the migrated symbols
- [ ] Any pre-existing issues documented (not caused by this plan)

### If Dogfood Fails

1. Identify issues caused by this plan vs pre-existing
2. Fix plan-caused CRITICAL + HIGH issues before declaring complete
3. Re-run `/dogfood full` to confirm fixes
4. Pre-existing issues are logged but DO NOT block plan completion

### Limitations honestly stated

`/dogfood full` exercises the dogfood-app workflow which currently consumes `@theokit/sdk` mainly via `Agent` + `Memory`. It does NOT directly exercise `Workflow` (zero current consumers) or `Eval` (CLI-only). The strongest end-to-end evidence for `Eval` post-extraction is `tools/typecheck-examples.sh` PASS at T4.3 + `examples/eval/run.ts` real-LLM run per `.claude/rules/real-llm-validation.md`. If `/dogfood full` PASS but the examples sweep does NOT include `examples/eval/run.ts` real-LLM execution, manually run it once before declaring the plan complete:

```bash
cd examples/eval
pnpm install
OPENROUTER_API_KEY=sk-or-... pnpm run run
# Verify: EvalRun JSON printed to stdout, aggregate.meanScore present
```
