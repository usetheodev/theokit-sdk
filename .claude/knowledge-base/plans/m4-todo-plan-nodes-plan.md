---
slug: m4-todo-plan-nodes
milestone_id: M4
created_at: 2026-06-21
goal: Fix the todolist tool to emit a structured items array in its result (latent bug — only items_summary string was emitted) and ship a versioned todoItemsToPlanNodes adapter in @theokit/sdk-tools, measured by tests/todolist.test.ts (regression) + tests/todo-plan-nodes.test.ts passing green.
---

# Plan: M4-5 — todolist structured `items` + `todoItemsToPlanNodes` adapter

> **Version 1.1** (edge-case-plan absorbed: EC-1 adapter projects exactly {id,label,status} folded into T1.2 TDD; EC-2 error-no-items already in T1.1; EC-3 JSON-snapshot documented) — Close roadmap gap M4-5 (latent bug): the `todolist` tool (`@theokit/sdk-tools`) emits only `items_summary` (a formatted STRING) in its result — never the structured `items` array — so a consumer that parses the tool result to render a plan/UI (e.g. theocode's `toTaskPlanNodes`, which reads `parsed.items`) always gets `[]`. M4-5 (1) fixes the tool to ALSO emit `items: TodoItem[]` in every list-bearing result (backward-compatible — `items_summary` preserved), and (2) ships a versioned `todoItemsToPlanNodes(items): PlanNode[]` adapter + `PlanNode` type in `@theokit/sdk-tools` so consumers convert structured items to a stable plan-node shape without hand-rolling it. Bug-fix → a regression test that fails on today's code lands first.

## Goal

> "Fix the todolist tool to emit a structured `items` array (currently only a summary string) and add a versioned `todoItemsToPlanNodes` adapter so consumers render plans without parsing prose, measured by `pnpm --filter @theokit/sdk-tools exec vitest run tests/todolist.test.ts tests/todo-plan-nodes.test.ts` reporting all tests passed."

## Context

Roadmap gap M4-5 (`docs/gap-audit/ROADMAP.md:147`, med sev, size M, Tema A — "bug latente"). In `packages/sdk-tools/src/todolist.ts`, every success path returns `ok({ …, items_summary: formatList() })` (`todolist.ts:87`, `:99`, `:108`, `:120`, `:126`) — `items_summary` is a human-formatted STRING (`formatList`, `:72`). The structured `TodoItem[]` is only reachable via `getItems()` (`:162`), which exists for TESTS and is NOT in the tool result. A consumer that parses `toolResults` to build structured plan nodes (theocode `app/activity-helpers.ts:403` `toTaskPlanNodes`, which checks `parsed.items`) therefore always falls through to `[]` — the latent bug. M4-5 emits `items: TodoItem[]` in the result and ships a versioned `todoItemsToPlanNodes` adapter so the SDK owns the items→plan-node contract. Zero new dependencies.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk-tools/src/todolist.ts` | 175 | (sdk-tools) | in-session task tracking tool | `items_summary` STRING stays in every result (back-compat); `getItems()` unchanged; `TodoItem` shape unchanged; action handlers' messages unchanged |
| `packages/sdk-tools/src/todo-plan-nodes.ts` (NEW) | 0 | — | versioned `todoItemsToPlanNodes` + `PlanNode` | — |
| `packages/sdk-tools/src/index.ts` | ~88 | (barrel) | sdk-tools barrel | additive exports only |
| `packages/sdk-tools/tests/todolist.test.ts` | ~90 | (sdk-tools) | todolist tests | existing assertions stay green; ADD regression for `items` |
| `packages/sdk-tools/tests/todo-plan-nodes.test.ts` (NEW) | 0 | — | adapter tests — RED first | — |
| `CHANGELOG.md` (root) + `.changeset/` (NEW) | — | — | changelog + changeset | additive `Fixed` + `Added` entry |
| `docs.md` | (contract) | — | public API contract | additive note (todolist `items` + adapter) |

### Current callers / dependents

- **Symbol:** `createTodolistTool` (`todolist.ts:53`)
  - Callers (production): barrel (`sdk-tools/src/index.ts:68`). No other prod consumer in this repo.
  - Callers (tests): `tests/todolist.test.ts` (asserts `ok`, `items_summary`, `getItems()`). Adding `items` to the result is additive — existing assertions unaffected.
  - External consumer (the bug's victim): theocode `app/activity-helpers.ts:403` `toTaskPlanNodes` reads `parsed.items` (today absent). M4-5 makes `items` present AND ships `todoItemsToPlanNodes` so theocode can drop its hand-rolled adapter.
- **Symbol:** `TodoItem` (`todolist.ts:15`) — the adapter's input type; unchanged.

### Domain glossary

- **todo item** — `{ id, title, status: pending|in_progress|done, createdAt, completedAt? }` (`TodoItem`).
- **items_summary** — the human-formatted multi-line STRING the tool returns (icons + counts); for the LLM to read.
- **structured items** — the `TodoItem[]` array; for a consumer to render programmatically. The bug: this was never in the result.
- **plan node** — a UI/plan-render shape `{ id, label, status }`; the adapter's output.

### Architecture boundaries affected

Per `rules/architecture.md` §1/§2: `todo-plan-nodes.ts` is a pure leaf module (a synchronous array map). `todolist.ts` change is additive (one extra field in the result JSON). Barrel-exported. No DIP boundary crossed.

## Prior Art & Related Work

- **Baseline investigation (2026-06-21)** — Explore agent traced the exact bug chain: `todolist.ts` `ok(...)` emits only `items_summary` (`:87` et al.) → consumer `toTaskPlanNodes` (`theocode/app/activity-helpers.ts:403`) reads `parsed.items` → always `[]`. Confirmed `getItems()` (`:162`) is test-only and `todoItemsToPlanNodes` does not exist.
- **In-repo precedent** — sibling sdk-tools factories + adapters (`createTodolistTool`, the M4-4 `createSessionArtifactStore`).
- **Consumer prior art (to replace)** — theocode `toTaskPlanNodes` (`app/activity-helpers.ts:403`) hand-rolled `PlanNode` mapping (`{ id, label, status }`); M4-5 ships the SDK-owned version.

## Objective

- [ ] Every list-bearing todolist result includes `items: TodoItem[]` (the structured array) alongside the existing `items_summary` string.
- [ ] `items_summary` + all existing result fields + `getItems()` are unchanged (backward-compatible).
- [ ] `todoItemsToPlanNodes(items: TodoItem[]): PlanNode[]` maps each item to `{ id, label: title, status }`; `PlanNode` is a versioned exported type.
- [ ] Both barrel-exported from `@theokit/sdk-tools`; `docs.md` + CHANGELOG (`Fixed` + `Added`) + changeset.
- [ ] Regression test (fails on today's code) lands first; `tests/todolist.test.ts` + `tests/todo-plan-nodes.test.ts` green; typecheck + Biome clean.

## ADRs

### D1 — Emit `items` ADDITIVELY (keep `items_summary`)
**Decision:** add `items: [...items]` to every success result that already carries `items_summary`; do NOT remove or change `items_summary`.
**Rationale:** `items_summary` is what the LLM reads (human-formatted); structured `items` is what a consumer renders. Both are needed; removing the summary would regress the LLM ergonomics + break existing tests. Additive = zero breakage.
**Alternatives considered:** replace `items_summary` with `items` — rejected (breaks LLM-facing output + existing tests); emit `items` only on `list` — rejected (the bug bites on `add`/`complete` too — a consumer renders after every mutation).

### D2 — Ship the `PlanNode` contract + adapter in the SDK, not the consumer
**Decision:** define `PlanNode` (`{ id, label, status }`) + `todoItemsToPlanNodes` in `@theokit/sdk-tools`; export both.
**Rationale:** the consumer (theocode) hand-rolled this mapping; owning the contract in the SDK is the gap's whole point (a versioned adapter consumers reuse instead of re-deriving). KISS — a pure array map.
**Alternatives considered:** leave the mapping to the consumer — rejected (re-derivation is the gap); a richer PlanNode (children/deps) — rejected (YAGNI; todo items are flat).

### D3 — `PlanNode.status` mirrors `TodoItem.status` (no remap)
**Decision:** `PlanNode.status` is the same union `"pending" | "in_progress" | "done"`; `label` = `title`; `id` passthrough.
**Rationale:** matches theocode's inferred `PlanNode` shape (`{ id, label, status }`) so it is a drop-in replacement; no lossy status remap.
**Alternatives considered:** a different status enum (`todo`/`doing`/`done`) — rejected (gratuitous divergence from the existing item status).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Larger tool result JSON (items array + summary) | Low | todo lists are small (in-session); the array is the same data already summarized; negligible | SDK |
| Consumers might double-render (summary + items) | Low | document that `items_summary` is for the LLM, `items` for programmatic render — pick one | SDK |
| `items` array exposes `createdAt`/`completedAt` timestamps in the result | Low | these are already in `TodoItem` (the public type) and `getItems()`; no new info disclosure | SDK |
| Adapter drift from a future richer PlanNode | Low | versioned type in the SDK; a breaking change to `PlanNode` is a semver event, not a silent edit | SDK |

## Unresolved Questions

(none — every decision is resolved at plan time. Additive `items` (D1), SDK-owned adapter (D2), status passthrough (D3) are locked against the confirmed bug chain + the consumer's existing `PlanNode` shape.)

## Dependencies

M4-5 introduces ZERO new dependencies — a structured-field addition + a pure array map (Rule 9 / KISS).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (none beyond the package itself) | — | — | pure functions in `@theokit/sdk-tools` |

### New — to be introduced

(none)

## Dependency Graph

```
Phase 1 (emit items [bug fix] + todoItemsToPlanNodes) ──▶ Phase 2 (barrel + docs) ──▶ Phase 3 (integration validation)
```

Sequential.

---

## Phase 1: Emit structured `items` (bug fix) + adapter

**Objective:** fix the tool to emit `items` and ship the adapter, regression-first.

### T1.1 — Emit `items: TodoItem[]` in todolist results (bug fix, regression-first)

#### Objective
Every list-bearing result carries the structured array.

#### Why this step (action + reasoning)
1. **What this step does** — adds `items: [...items]` to each `ok(...)` that carries `items_summary` (add/list/status/remove/clear) in `todolist.ts`.
2. **Why it is necessary now** — it is the latent bug: a consumer cannot recover structured items from the result. Per the bug-fix discipline, a regression test asserting `result.items` is an array of `TodoItem` is written FIRST and fails on today's code (which omits `items`).

#### Evidence
`todolist.ts:87` `ok({ id, message, items_summary: formatList() })` — no `items`. Same omission at `:99`/`:108`/`:120`/`:126`. `getItems()` (`:162`) is the only structured access and is test-only. Consumer `theocode/app/activity-helpers.ts:403` reads `parsed.items`.

#### Files to edit
```
packages/sdk-tools/src/todolist.ts — include items: [...items] in each list-bearing ok(...)
packages/sdk-tools/tests/todolist.test.ts — RED regression: result.items is TodoItem[] for add + list + complete
```

#### Deep file dependency analysis
- `ok(...)` already spreads arbitrary data; add a helper or pass `items: [...items]` in each call site. Cleanest: a local `listResult(extra)` that returns `ok({ ...extra, items: [...items], items_summary: formatList() })` and replace the 5 call sites. `items_summary` preserved; `getItems()` untouched.

#### Deep Dives
- Invariant: `items` is a snapshot copy (`[...items]`), not the live array (no external mutation of internal state). Shape = `TodoItem[]`.
- Edge: empty list → `items: []` (and the existing "No tasks" summary). `fail(...)` paths do NOT carry `items` (errors keep their shape).

#### Pseudo-code / Signatures
```pseudocode
function listResult(extra): return ok({ ...extra, items: [...items], items_summary: formatList() })
handleAdd:        return listResult({ id: item.id, message: `Added: ${item.title}` })
handleSetStatus:  return listResult({ message: `${verb}: ${item.title}` })
handleRemove:     return listResult({ message: `Removed: ${removed.title}` })
handleClearCompleted: return listResult({ message: `Cleared ${n} completed items` })
list:             return listResult({})
# Example: JSON.parse(handler({action:"add",title:"x"})).items === [{ id:"todo-1", title:"x", status:"pending", createdAt:… }]
```

#### Tasks
1. Write RED regression tests (result.items present + correct for add/list/complete; fail/error paths carry no items).
2. Add `listResult` helper; replace the 5 call sites.

#### TDD
```
RED:     todolist_add_result_includes_structured_items() — JSON.parse(add).items is TodoItem[] with the new item (FAILS today — no items field)
RED:     todolist_list_result_includes_items() — list result.items reflects all items
RED:     todolist_complete_result_items_reflect_status() — after complete, result.items[0].status === "done"
RED:     todolist_error_result_has_no_items() — missing_title/not_found results carry no items field
GREEN:   Add listResult helper + wire the 5 call sites
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk-tools exec vitest run tests/todolist.test.ts
```

#### Acceptance Criteria
- [ ] Regression + existing tests pass — `pnpm --filter @theokit/sdk-tools exec vitest run tests/todolist.test.ts` reports all tests passed.
- [ ] `items_summary` + `getItems()` behavior unchanged (existing assertions green).
- [ ] Pass: lint — `pnpm --filter @theokit/sdk-tools exec biome check src/todolist.ts` reports 0 warnings.

#### DoD
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/todolist.test.ts` exits 0
- [ ] Zero type errors — `pnpm --filter @theokit/sdk-tools typecheck` exits 0

### T1.2 — `todoItemsToPlanNodes(items)` + `PlanNode` adapter

#### Objective
A versioned items→plan-node adapter.

#### Why this step (action + reasoning)
1. **What this step does** — adds `packages/sdk-tools/src/todo-plan-nodes.ts` exporting `PlanNode` + `todoItemsToPlanNodes(items)` mapping each `TodoItem` to `{ id, label: title, status }`.
2. **Why it is necessary now** — the gap names a "adapter versionado"; with `items` now in the result (T1.1), a consumer needs the SDK-owned converter instead of re-deriving theocode's `toTaskPlanNodes`.

#### Evidence
theocode `toTaskPlanNodes` (`app/activity-helpers.ts:403`) returns `{ id, label, status }` per item — the shape M4-5 owns.

#### Files to edit
```
packages/sdk-tools/src/todo-plan-nodes.ts — NEW: PlanNode + todoItemsToPlanNodes
packages/sdk-tools/tests/todo-plan-nodes.test.ts — NEW: RED tests (map shape, empty, status passthrough)
```

#### Deep file dependency analysis
- Imports `TodoItem` from `./todolist.js`. Pure map; no I/O.

#### Deep Dives
- Data: `PlanNode = { id: string; label: string; status: "pending" | "in_progress" | "done" }`.
- Map: `(item) => ({ id: item.id, label: item.title, status: item.status })`. Empty → `[]`. Order preserved.

#### Pseudo-code / Signatures
```pseudocode
interface PlanNode { id: string; label: string; status: "pending"|"in_progress"|"done" }
function todoItemsToPlanNodes(items: readonly TodoItem[]): PlanNode[]
  return items.map(i => ({ id: i.id, label: i.title, status: i.status }))
# Example: todoItemsToPlanNodes([{id:"todo-1",title:"x",status:"done",createdAt:0}]) === [{id:"todo-1",label:"x",status:"done"}]
```

#### Tasks
1. Write RED tests (shape map; empty→[]; status passthrough for all three states; order preserved).
2. Implement `todo-plan-nodes.ts`.

#### TDD
```
RED:     todoItemsToPlanNodes_maps_id_label_status() — TodoItem → {id, label:title, status}
RED:     todoItemsToPlanNodes_empty_returns_empty() — [] → []
RED:     todoItemsToPlanNodes_preserves_status_and_order() — pending/in_progress/done preserved in input order
RED:     todoItemsToPlanNodes_projects_only_id_label_status() — (EC-1) Object.keys(node) === ["id","label","status"] (no createdAt/completedAt leak)
GREEN:   Implement todo-plan-nodes.ts
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk-tools exec vitest run tests/todo-plan-nodes.test.ts
```

#### Acceptance Criteria
- [ ] All RED tests pass — `pnpm --filter @theokit/sdk-tools exec vitest run tests/todo-plan-nodes.test.ts` reports all tests passed.
- [ ] Pass: lint — `pnpm --filter @theokit/sdk-tools exec biome check src/todo-plan-nodes.ts` reports 0 warnings.
- [ ] Pass: size — `todo-plan-nodes.ts` ≤ 500 lines.

#### DoD
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/todo-plan-nodes.test.ts` exits 0
- [ ] Zero type errors — `pnpm --filter @theokit/sdk-tools typecheck` exits 0

---

## Phase 2: Barrel + docs

**Objective:** export the adapter + types, document, changelog.

### T2.1 — Barrel export + docs/changelog + wiring test

#### Objective
Public exports + docs + an end-to-end wiring test (result.items → todoItemsToPlanNodes).

#### Why this step (action + reasoning)
1. **What this step does** — exports `todoItemsToPlanNodes` + `PlanNode` from the barrel; documents the `items` field + adapter; CHANGELOG (`Fixed` for the bug + `Added` for the adapter) + changeset; adds a wiring test that parses a real tool result's `items` and feeds it through `todoItemsToPlanNodes`.
2. **Why it is necessary now** — closes the loop the bug broke: prove a consumer can go from tool result → structured items → plan nodes, via the public surface.

#### Evidence
sdk-tools barrel `export { ... } from "./module.js"`. The bug chain ended at `parsed.items`; the wiring test exercises exactly that path.

#### Files to edit
```
packages/sdk-tools/src/index.ts — export todoItemsToPlanNodes + PlanNode
packages/sdk-tools/tests/todo-plan-nodes.test.ts — add wiring test (parse tool result.items → todoItemsToPlanNodes via the barrel)
docs.md — document todolist `items` + todoItemsToPlanNodes
CHANGELOG.md (root) — [Unreleased] Fixed (items bug) + Added (adapter)
.changeset/m4-todo-plan-nodes.md — NEW: patch (fix) + minor (adapter) → minor bump @theokit/sdk-tools
```

#### Deep file dependency analysis
- Barrel adds the adapter + type (additive). Wiring test imports from `../src/index.js`, builds a tool, parses an `add` result's `items`, runs `todoItemsToPlanNodes`, asserts plan nodes.

#### Deep Dives
- The wiring test is the regression's end-to-end proof: `JSON.parse(tool.handler({action:"add",title:"x"})).items` → `todoItemsToPlanNodes(items)` → `[{id, label:"x", status:"pending"}]`.

#### Tasks
1. Barrel-export `todoItemsToPlanNodes` + `PlanNode`.
2. Add the wiring test.
3. Document; CHANGELOG (Fixed + Added); changeset (`biome format --write` before commit).

#### TDD
```
RED:     todo_result_items_feed_adapter_via_barrel() — parse add result.items, run todoItemsToPlanNodes (from barrel) → plan nodes
GREEN:   barrel export (this task)
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk-tools exec vitest run tests/todo-plan-nodes.test.ts && pnpm --filter @theokit/sdk-tools build
```

#### Acceptance Criteria
- [ ] Wiring test green — `pnpm --filter @theokit/sdk-tools exec vitest run tests/todo-plan-nodes.test.ts` reports all tests passed.
- [ ] `pnpm --filter @theokit/sdk-tools build` emits dist.
- [ ] `docs.md` documents the field + adapter; CHANGELOG `Fixed` + `Added` entries present `(#M4-5)`.
- [ ] Pass: lint — `pnpm --filter @theokit/sdk-tools exec biome check src/todo-plan-nodes.ts src/todolist.ts` reports 0 warnings.

#### DoD
- [ ] Wiring test green; barrel exports have a real caller
- [ ] Zero type errors — `pnpm --filter @theokit/sdk-tools typecheck` exits 0
- [ ] CHANGELOG + changeset present

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Bug: tool emits only summary string, not structured items | T1.1 | emit `items: TodoItem[]` (D1) |
| 2 | Backward-compat (`items_summary`/`getItems` unchanged) | T1.1 | additive field (D1) |
| 3 | Versioned `todoItemsToPlanNodes` adapter | T1.2 | pure map (D2) |
| 4 | `PlanNode` contract owned by the SDK | T1.2 | exported type (D2/D3) |
| 5 | Barrel export + no orphan | T2.1 | wiring test |
| 6 | Docs + CHANGELOG (Fixed+Added) + changeset | T2.1 | additive |
| 7 | End-to-end: result.items → plan nodes | T2.1 | wiring test |

**Coverage: 7/7 requirements covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/sdk-tools test` green
- [ ] Zero type errors — `pnpm --filter @theokit/sdk-tools typecheck` exits 0
- [ ] Zero lint warnings — `pnpm --filter @theokit/sdk-tools exec biome check` clean
- [ ] File-size budget respected (per `rules/architecture.md`)
- [ ] CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6) — `Fixed` (bug) + `Added` (adapter)
- [ ] Backward compatibility preserved — `items_summary`, `getItems()`, error shapes unchanged (existing tests green)
- [ ] Plan-specific: a regression test that FAILS on today's code (no `items`) was written first and now passes
- [ ] `docs.md` documents the `items` field + adapter
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merge

## Final Phase: Integration Validation (MANDATORY)

**Objective:** validate the bug fix + adapter end-to-end in the built package.

### Execution
```
pnpm --filter @theokit/sdk-tools build
pnpm --filter @theokit/sdk-tools test
pnpm --filter @theokit/sdk-tools typecheck
pnpm --filter @theokit/sdk-tools exec biome check packages/sdk-tools/src packages/sdk-tools/tests
```

### Acceptance Criteria
- [ ] All test suites green
- [ ] Coverage ≥ 90% on changed files (`todolist.ts`, `todo-plan-nodes.ts` — critical paths 100%)
- [ ] Zero type errors / zero lint warnings
- [ ] No regression: full sdk-tools suite passes
- [ ] Bug-fix proof: the regression test (`result.items` present) fails on `git stash` of the fix and passes with it (observed)

### If Validation Fails
1. Separate plan-caused from pre-existing failures.
2. Fix all plan-caused failures.
3. Re-run the chain.
4. Log pre-existing issues in the PR description.
