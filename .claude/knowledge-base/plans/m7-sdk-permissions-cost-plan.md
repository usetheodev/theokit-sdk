---
slug: m7-sdk-permissions-cost
milestone_id: M7
created_at: 2026-06-22
goal: Ship PermissionEngine default-deny + a PermissionEngine→plugin exemplar + an honest-null cost formatter so the M7 SDK test suite passes green with zero new runtime deps.
---

# Plan: M7 (SDK slice) — PermissionEngine default-deny + plugin wiring + cost formatter (Tema F)

> **Version 1.0** — The theokit-sdk half of M7 (Tema F): M7-4 adds a `defaultAction` to `PermissionEngine` (currently hard-codes `"allow"`); M7-5 ships `createPermissionPlugin(engine)` wiring the engine into the `definePlugin` `pre_tool_call` veto seam (the engine has zero callers today — ACP hand-rolls its own); M7-6 ships `formatCostUsd(cost)` rendering the already-honest-null cost (`number | undefined` from M1-6) as `"—"` for unknown vs `"$X.XX"`. All internal to `@theokit/sdk` / `@theokit/sdk-budget`, zero new runtime deps.

## Goal

Make the M7 SDK test files (`packages/sdk/tests/permission-engine.test.ts` additions, `packages/sdk/tests/permission-plugin.test.ts`, `packages/sdk-budget/tests/format-cost.test.ts`) pass green: `PermissionEngine` honors a constructor `defaultAction` (default `"allow"`, backward-compatible), `createPermissionPlugin` vetoes a tool the engine denies, and `formatCostUsd(undefined)` returns `"—"` while `formatCostUsd(0)` returns `"$0.00"` — with zero new runtime dependencies.

## Context

The gap audit (Tema F / M7) flags three SDK-side items. M7-4: `PermissionEngine.evaluate` hard-returns `"allow"` when no rule matches (`packages/sdk/src/permission-engine.ts:31`) — no default-deny knob. M7-5: `PermissionEngine` has zero production callers (ACP's `packages/acp/src/permission-plugin.ts:91` hand-rolls a parallel veto and never uses the engine) — it brushes `rules/no-stubs-no-mocks-no-wired.md` (exported-but-unwired). M7-6: the honest-null cost chain shipped in M1-6 (`computeUsdCost(): number | undefined` at `packages/sdk-budget/src/usd-pricing.ts:53`; `getTotalUsd(): number | undefined` at `usd-budget-tracker.ts:86`) but there is no render helper that turns `undefined` into `"—"` vs a dishonest `"$0"`. The ROADMAP's `UsageRecord`/`UsageResult`/`costKnown` names do not exist; the real surface is `BudgetTotal.costUsd?` + `getTotalUsd()` — this plan reconciles to the real names.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC | Why it exists | Invariant to preserve |
|---|---|---|---|
| `packages/sdk/src/permission-engine.ts` | 34 | `PermissionEngine` + `PermissionAction`/`PermissionRule` | `evaluate` first-match semantics unchanged; default stays `"allow"` unless `defaultAction` given (backward-compat) |
| `packages/sdk/src/index.ts` | n/a | public barrel (`PermissionEngine` exported `:155`) | existing exports unchanged; ADD `PermissionAction`/`PermissionRule` types + `createPermissionPlugin` |
| `packages/sdk/src/permission-plugin.ts` (NEW) | 0 | `createPermissionPlugin` exemplar | — |
| `packages/sdk/src/internal/plugins/types.ts` | n/a | `definePlugin` + `PreToolCallDecision` (`pre_tool_call` ctx = `{name,args}`) | reused, not modified |
| `packages/sdk-budget/src/format-cost.ts` (NEW) | 0 | `formatCostUsd` render helper | — |
| `packages/sdk-budget/src/index.ts` | n/a | sdk-budget barrel | existing exports unchanged; ADD `formatCostUsd` |
| `packages/sdk/tests/permission-engine.test.ts` | n/a | existing engine tests | extended with default-deny cases |
| `packages/sdk/tests/permission-plugin.test.ts` (NEW) | 0 | exemplar tests | — |
| `packages/sdk-budget/tests/format-cost.test.ts` (NEW) | 0 | formatter tests | — |

### Current callers / dependents

- `PermissionEngine` (`permission-engine.ts:17`) — exported `index.ts:155`; **zero production callers** (only its own test). M7-5 gives it a real caller via `createPermissionPlugin`.
- `definePlugin` (`internal/plugins/types.ts:143`) — `pre_tool_call` hook ctx is `{ name: string; args: Record<string,unknown> }`; veto via `{ block: true, message }` (`PreToolCallDecision`). ACP exemplar at `packages/acp/src/permission-plugin.ts:91` (parallel impl — NOT the engine).
- `computeUsdCost`/`getTotalUsd` (`@theokit/sdk-budget`) — return `number | undefined`; consumed by `createUsdBudgetTracker`. `formatCostUsd` is a new pure leaf over that contract.
- External: `@theokit/sdk` + `@theokit/sdk-budget` are published; all additions are ADDITIVE (new optional ctor arg + new exports). theokit-sdk never imports the principal `theokit` (constraint holds).

### Domain glossary

- **default-deny** — when no permission rule matches, deny instead of allow (opt-in via `defaultAction: "deny"`).
- **veto seam** — `definePlugin` `pre_tool_call` returning `{block:true,message}` to stop a tool call.
- **honest-null cost** — cost is `number | undefined`; `undefined` means "unknown pricing", never a dishonest `$0` (M1-6 — the cost-honesty contract).

### Architecture boundaries affected

- `rules/architecture.md` § 3 (minimal surface): additive public exports only. `rules/no-stubs-no-mocks-no-wired.md`: M7-5 wires the previously-orphan `PermissionEngine` to a real caller.

## Prior Art & Related Work

- **In-repo exemplar** — `packages/acp/src/permission-plugin.ts:91` shows the `definePlugin`/`pre_tool_call` veto pattern (but hand-rolls mode logic; M7-5 wires the SDK's own `PermissionEngine` instead).
- **M1-6 honest-null cost** — `packages/sdk-budget/src/usd-pricing.ts:53` (`computeUsdCost(): number | undefined`) + `usd-budget-tracker.ts:86` (`getTotalUsd(): number | undefined`) — the contract `formatCostUsd` renders.

## ADRs

### D1 — `defaultAction` as an optional constructor field (default `"allow"`)
**Decision:** add `defaultAction: PermissionAction = "allow"` to the `PermissionEngine` constructor; `evaluate` returns `this.defaultAction` when no rule matches. Export `PermissionAction`/`PermissionRule` types from the barrel. **Rationale:** `rules/architecture.md` minimal-surface; backward-compatible (default preserves today's `"allow"`). KISS — one field. **Alternatives rejected:** a separate `setDefault()` method (mutable, more surface); a new `PermissionEngineV2` (YAGNI).

### D2 — `createPermissionPlugin(engine, opts?)` wires the engine into the `pre_tool_call` veto
**Decision:** ship `createPermissionPlugin(engine, opts?)` returning a `definePlugin({kind:"general", register})` that, on `pre_tool_call`, reads `ctx.name`, calls `engine.evaluate(name)`, and maps `"deny"`→`{block:true,message}`, `"ask"`→`opts.onAsk?.(name) ?? {block:true,message:"requires approval"}`, `"allow"`→`undefined`. **Rationale:** gives `PermissionEngine` a real caller (`rules/no-stubs-no-mocks-no-wired.md`); reuses the shipped veto seam (Rule 9). **Alternatives rejected:** auto-installing the engine in the agent loop (too magical; YAGNI); leaving the engine orphan (violates no-unwired).

### D3 — `formatCostUsd(cost)` is a pure leaf in `@theokit/sdk-budget`
**Decision:** `formatCostUsd(cost: number | undefined, opts?: { unknown?: string; currency?: string }): string` — `undefined`→`"—"` (configurable), `number`→`"$X.XX"`. **Rationale:** the cost types live in sdk-budget; DRY/SRP — render is separate from compute; composes M1-6's honest-null. **Alternatives rejected:** a stateful `CostMeter` class (YAGNI — a pure formatter suffices); rendering `$0` for unknown (dishonest — violates the cost-honesty contract).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Adding `defaultAction` changes the constructor signature | Low | Optional param with default `"allow"` — existing `new PermissionEngine(rules)` calls unaffected; regression test asserts default behavior unchanged | SDK |
| `createPermissionPlugin`'s `"ask"`→block default may surprise (no interactive prompt in the SDK) | Low | Documented; `opts.onAsk` lets consumers supply a resolver; default fail-closed (block) is the safe choice | SDK |
| `formatCostUsd` locale/precision assumptions (always `$`, 2dp) | Low | `opts.currency`/`opts.unknown` override; default `$`+2dp matches common display; documented | SDK |

## Unresolved Questions

- Q1 — Should `createPermissionPlugin` auto-register on an agent? (Plan resolves: no — return the plugin; the consumer registers it, matching the ACP pattern. YAGNI.)
- Q2 — (none further — D1-D3 resolve the rest.)

## Failure scenarios

(none — no external I/O touched. PermissionEngine + formatter are pure; the plugin rides the in-process veto seam.)

## Dependency Graph

```
T1 (M7-4 defaultAction) ──▶ T2 (M7-5 plugin, uses engine) ──┐
T3 (M7-6 formatCostUsd, independent) ───────────────────────┼─▶ T4 (Integration Validation)
```
T2 depends on T1 (the plugin maps `evaluate` incl. the default); T3 is independent; T4 wires them.

## Dependencies

### Existing — use as-is
| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (internal) `definePlugin` / `pre_tool_call` seam | n/a | n/a | M7-5 veto (`internal/plugins/types.ts`) |
| (internal) `computeUsdCost`/`getTotalUsd` | n/a | n/a | M7-6 renders their `number\|undefined` |

### New — to be introduced
| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | M7 SDK slice adds ZERO new runtime deps — pure TS over existing internals | — |

## Phase 1: M7-4 — PermissionEngine default-deny

### T1.1 — `defaultAction` constructor option + export types

#### Objective
Add `defaultAction: PermissionAction = "allow"` to `PermissionEngine`; `evaluate` returns it on no-match. Export `PermissionAction`/`PermissionRule`.

#### Why this step (action + reasoning)
1. **What** — extend the constructor with an optional `defaultAction`; replace the literal `return "allow"` with `return this.defaultAction`; export the two types from the barrel.
2. **Why now** — smallest M7 SDK gap; D1; unblocks T2 (the plugin honors the default).

#### Evidence
`packages/sdk/src/permission-engine.ts:31` (`return "allow"`), `:17` (constructor), `index.ts:155` (only the class exported).

#### Files to edit
```
packages/sdk/src/permission-engine.ts — defaultAction option + evaluate change
packages/sdk/src/index.ts — export PermissionAction, PermissionRule (types)
packages/sdk/tests/permission-engine.test.ts — RED tests first
```

#### TDD
```
RED: evaluate_returns_default_action_when_no_rule_matches() — new PermissionEngine([], {defaultAction:"deny"}).evaluate("x") === "deny"
RED: evaluate_defaults_to_allow_when_no_option() — new PermissionEngine([]).evaluate("x") === "allow" (backward-compat)
RED: first_match_still_wins_over_default() — a matching deny rule beats defaultAction:"allow"
GREEN: implement defaultAction
REFACTOR: none expected
VERIFY: pnpm --filter @theokit/sdk test -- permission-engine
```

#### Concurrency tests
(none — pure synchronous evaluation)

#### Acceptance Criteria
- [ ] All 3 RED tests pass; `new PermissionEngine(rules)` (no options) unchanged.
- [ ] `PermissionAction`/`PermissionRule` importable from `@theokit/sdk`.
- [ ] Lint clean; biome cognitive complexity ≤ 10.

#### DoD
- [ ] `pnpm --filter @theokit/sdk test -- permission-engine` green; typecheck clean; changeset added.

## Phase 2: M7-5 — PermissionEngine → plugin exemplar

### T2.1 — `createPermissionPlugin(engine, opts?)`

#### Objective
Wire `PermissionEngine` into a `definePlugin` `pre_tool_call` veto: `evaluate(name)` → block on `"deny"`, `onAsk`/block on `"ask"`, pass on `"allow"`.

#### Why this step (action + reasoning)
1. **What** — new `packages/sdk/src/permission-plugin.ts` exporting `createPermissionPlugin`; export from the barrel.
2. **Why now** — gives `PermissionEngine` a real caller (D2; `rules/no-stubs-no-mocks-no-wired.md`); depends on T1.

#### Evidence
`packages/sdk/src/internal/plugins/types.ts:143` (`definePlugin`), `:40` (`PreToolCallDecision`); `pre_tool_call` ctx `{name,args}` per `packages/acp/src/permission-plugin.ts:91`.

#### Files to edit
```
packages/sdk/src/permission-plugin.ts — NEW: createPermissionPlugin
packages/sdk/src/index.ts — export createPermissionPlugin
packages/sdk/tests/permission-plugin.test.ts — RED tests first
```

#### TDD
```
RED: plugin_blocks_tool_the_engine_denies() — engine denies "shell"; register plugin; pre_tool_call({name:"shell"}) -> {block:true}
RED: plugin_allows_tool_the_engine_allows() — pre_tool_call({name:"read"}) -> undefined
RED: plugin_blocks_ask_by_default_and_honors_onAsk() — "ask" -> default block; with onAsk returning undefined -> pass
GREEN: implement createPermissionPlugin
REFACTOR: none expected
VERIFY: pnpm --filter @theokit/sdk test -- permission-plugin
```

#### Concurrency tests
(none — the hook handler is invoked per tool call by the loop; no shared mutable state added)

#### Acceptance Criteria
- [ ] All 3 RED tests pass.
- [ ] `createPermissionPlugin` returns a valid `definePlugin` (kind general); `PermissionEngine` now has a real caller.
- [ ] Lint clean; complexity ≤ 10.

#### DoD
- [ ] `pnpm --filter @theokit/sdk test -- permission-plugin` green; typecheck clean; changeset added.

## Phase 3: M7-6 — honest-null cost formatter

### T3.1 — `formatCostUsd(cost, opts?)`

#### Objective
Render `number | undefined` cost: `undefined`→`"—"`, `number`→`"$X.XX"`; composing M1-6's honest-null.

#### Why this step (action + reasoning)
1. **What** — new `packages/sdk-budget/src/format-cost.ts` exporting `formatCostUsd`; export from the sdk-budget barrel.
2. **Why now** — the missing render piece of M7-6 (honest-null compute already shipped in M1-6); D3.

#### Evidence
`packages/sdk-budget/src/usd-pricing.ts:53` (`computeUsdCost(): number | undefined`), `usd-budget-tracker.ts:86` (`getTotalUsd(): number | undefined`).

#### Files to edit
```
packages/sdk-budget/src/format-cost.ts — NEW: formatCostUsd
packages/sdk-budget/src/index.ts — export formatCostUsd
packages/sdk-budget/tests/format-cost.test.ts — RED tests first
```

#### TDD
```
RED: formatCostUsd_unknown_renders_dash() — formatCostUsd(undefined) === "—"
RED: formatCostUsd_zero_renders_dollar_zero() — formatCostUsd(0) === "$0.00" (real known-zero, not unknown)
RED: formatCostUsd_number_renders_two_dp() — formatCostUsd(1.5) === "$1.50"
RED: formatCostUsd_honors_custom_unknown_marker() — formatCostUsd(undefined,{unknown:"n/a"}) === "n/a"
GREEN: implement formatCostUsd
REFACTOR: none expected
VERIFY: pnpm --filter @theokit/sdk-budget test -- format-cost
```

#### Concurrency tests
(none — pure function)

#### Acceptance Criteria
- [ ] All 4 RED tests pass; `undefined`→marker (honest, not `$0`); `0`→`$0.00`.
- [ ] `formatCostUsd` importable from `@theokit/sdk-budget`.
- [ ] Lint clean; complexity ≤ 10.

#### DoD
- [ ] `pnpm --filter @theokit/sdk-budget test -- format-cost` green; typecheck clean; changeset added.

## Phase 4: Integration Validation

### T4.1 — Cross-package integration

#### Objective
One test composes the slice: a `PermissionEngine({defaultAction:"deny"})` + `createPermissionPlugin` blocks an unlisted tool, and `formatCostUsd(getTotalUsd-style undefined)` renders `"—"`.

#### Files to edit
```
packages/sdk/tests/m7-sdk-permissions-cost.test.ts — NEW integration test
```

#### TDD
```
RED→GREEN: default-deny engine + plugin blocks an unlisted tool; allowed rule passes; formatCostUsd(undefined)==="—", formatCostUsd(2.5)==="$2.50"
VERIFY: pnpm --filter @theokit/sdk test -- m7-sdk && pnpm --filter @theokit/sdk-budget test -- format-cost && pnpm --filter @theokit/sdk typecheck
```

#### Concurrency tests
(none)

#### Acceptance Criteria
- [ ] Integration green; typecheck + lint clean; zero new runtime deps.

#### DoD
- [ ] Full chain green; changesets present; `/code-quality` ∉ {FAIL_HARD, INVALID}.

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | M7-4 default-deny | T1.1 | `defaultAction` ctor option + exported types |
| 2 | M7-5 PermissionEngine→plugin wiring | T2.1 | `createPermissionPlugin` veto exemplar (engine gets a real caller) |
| 3 | M7-6 honest-null cost render | T3.1 | `formatCostUsd` (`—` for unknown) |
| 4 | Integration | T4.1 | cross-package compose |

**Coverage: 4/4 (100%)**

## Global Definition of Done

- All task DoDs met; M7 SDK suite green; typecheck + biome clean (complexity ≤ 10); coverage ≥ 90% on changed files.
- Zero new runtime dependencies; additive public surface only.
- Changesets present (`@theokit/sdk` minor, `@theokit/sdk-budget` minor); `/code-quality` ∉ {FAIL_HARD, INVALID}; `/review` READY_TO_MERGE.
- theokit-sdk never imports the principal `theokit` (constraint preserved).
