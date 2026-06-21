---
slug: m3-command-policy
created_at: 2026-06-21
goal: Add a composable command-policy layer (CommandPolicy type + denyCatastrophicCommands + commandDenialReason + isCommandAllowed) to sdk-tools that composes the M3-2 catastrophicShellReason with deny-wins semantics, measured by tests/command-policy.test.ts passing green.
---

# Plan: M3-6 — Catastrophic shell at the agents/permission layer

> **Version 1.1** (edge-case-plan absorbed: EC-1 first-deny-wins-both-orders folded into T1.1 TDD) — Close roadmap gap M3-6: ship a small, pure, zero-dep composable command-policy layer in `@theokit/sdk-tools` — `type CommandPolicy = (command: string) => string | null` + `denyCatastrophicCommands(): CommandPolicy` (composing the shipped M3-2 `catastrophicShellReason`, NOT duplicating it) + `commandDenialReason(command, policies): string | null` (first deny reason, deny-wins) + `isCommandAllowed(command, policies): boolean` — framework-agnostic so a consumer wires it at their permission layer (e.g. an ACP `pre_tool_call` hook). No `@theokit/agents` package (it does not exist; KISS). Design locked by blueprint `m3-command-policy` (discover-confidence SHIPPABLE 100, five ADRs covering policy-type/compose-not-duplicate/empty-allows-all/pure-predicate/placement).

## Goal

> "Ship `CommandPolicy` + `denyCatastrophicCommands()` + `commandDenialReason()` + `isCommandAllowed()` in `@theokit/sdk-tools` — composing M3-2 with deny-wins — measured by `tests/command-policy.test.ts` passing green."

## Context

Roadmap gap M3-6 (`docs/gap-audit/ROADMAP.md:128`, low sev, size S, Tema C, deps M3-2 ✅). Greenfield (confirmed): `@theokit/agents` does NOT exist; no `isCommandAllowed`/`denyCatastrophicCommands`/`CommandPolicy`. M3-2 shipped `catastrophicShellReason(cmd): string | null` (`packages/sdk-tools/src/internal/shell-guard.ts:188`). The existing permission concept is ACP's `pre_tool_call` veto (`packages/acp/src/permission-plugin.ts`). M3-6 composes M3-2 into a pure policy layer (deny-wins, reason-or-null), wired by the consumer — no new package, no deny-list duplication. Respects `rules/architecture.md` §2 + `rules/no-stubs-no-mocks-no-wired.md`. Zero new deps.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk-tools/src/internal/command-policy.ts` (NEW) | 0 | — | (the policy layer) | — |
| `packages/sdk-tools/src/index.ts` | 70 | 682c9e7 | sdk-tools barrel | additive exports only |
| `packages/sdk-tools/tests/command-policy.test.ts` (NEW) | 0 | — | unit tests — RED first | — |
| `docs.md` | (contract) | — | public API contract | additive command-policy note |
| `CHANGELOG.md` (root) + `.changeset/` (NEW) | — | — | changelog + changeset | additive Added entry |

### Current callers / dependents

- **NEW** `CommandPolicy`/`denyCatastrophicCommands`/`commandDenialReason`/`isCommandAllowed` — barrel-exported reusable predicates. A consumer calls them at their permission layer (e.g. a `pre_tool_call` hook). Exercised through the barrel + against `catastrophicShellReason` in tests → no orphan. Consistent with the `tool-guidance`/`tool-aci` LEGO-piece precedent.
- **`catastrophicShellReason`** (M3-2, `packages/sdk-tools/src/internal/shell-guard.ts`) — the composed primitive (same package).

### Domain glossary

- **CommandPolicy** — a pure predicate `(command) => string | null` returning a deny REASON or null (this policy allows).
- **deny-wins** — across a policy array, the first policy returning a reason denies; if none do, the command is allowed.
- **compose-not-duplicate** — `denyCatastrophicCommands` calls `catastrophicShellReason`; it does NOT re-implement the deny-list (Rule 9).

### Architecture boundaries affected

Per `rules/architecture.md` §2: `command-policy.ts` is pure domain logic (no I/O) in sdk-tools `internal/`, barrel-exported, composing the same-package `catastrophicShellReason`. No DIP boundary crossed; no coupling to `@theokit/sdk` or `acp`.

## Prior Art & Related Work

- **Internal blueprint** `knowledge-base/discoveries/blueprints/m3-command-policy-blueprint.md` (five ADRs).
- **In-repo precedent** M3-2 `catastrophicShellReason` (`packages/sdk-tools/src/internal/shell-guard.ts:188`); the sibling composable wrappers (`tool-guidance.ts`, `tool-aci.ts`); ACP `pre_tool_call` veto (`packages/acp/src/permission-plugin.ts`).
- **Reference precedent** codex `command_safety/is_dangerous_command.rs` + `is_safe_command.rs` (`.claude/knowledge-base/reference/codex/codex-rs/shell-command/src/command_safety/is_dangerous_command.rs`); opencode `permission/schema.ts` allow/deny/ask (`.claude/knowledge-base/reference/opencode/packages/core/src/permission/schema.ts`).

## Objective

- [ ] `command-policy.ts` exports `CommandPolicy`, `denyCatastrophicCommands()`, `commandDenialReason(command, policies)`, `isCommandAllowed(command, policies)`.
- [ ] `denyCatastrophicCommands()` returns a policy that calls `catastrophicShellReason` (composition, NOT duplication).
- [ ] `commandDenialReason` returns the first policy's non-null reason (deny-wins); null if none deny.
- [ ] `isCommandAllowed` = `commandDenialReason(...) === null`; an empty policy array allows everything.
- [ ] Zero new deps; barrel exports; docs.md + CHANGELOG + changeset.
- [ ] `tests/command-policy.test.ts` green; typecheck + Biome clean; build emits dist.

## ADRs

### D1 — `CommandPolicy` = reason-or-null; deny-wins composition
**Decision:** `type CommandPolicy = (command: string) => string | null`; `commandDenialReason` returns the first non-null; `isCommandAllowed` = that === null.
**Rationale:** mirrors the M3-2 reason-or-null idiom (the reason powers messaging); deny-wins matches codex's dangerous-check short-circuit.
**Alternatives considered:** boolean policy (rejected — loses reason); effect enum allow/deny/ask (rejected — over-scope; ask is a runtime/ACP concern).

### D2 — `denyCatastrophicCommands()` composes M3-2, never duplicates
**Decision:** `denyCatastrophicCommands() = (cmd) => catastrophicShellReason(cmd)`.
**Rationale:** single source of the deny-list (Rule 9); the policy reason IS the M3-2 reason.
**Alternatives considered:** re-implement the patterns (rejected — duplication/drift).

### D3 — empty policy list allows everything
**Decision:** `isCommandAllowed(cmd, [])` true; `commandDenialReason(cmd, [])` null.
**Rationale:** no policies = no denial (sane default); iteration over [] yields null naturally (EC-1).
**Alternatives considered:** default-deny on empty (rejected — surprising).

### D4 — pure predicate; no new package; plugin glue documented, not shipped
**Decision:** the policy lives in `sdk-tools/internal/command-policy.ts`, framework-agnostic; the ACP `pre_tool_call` wiring is a documented consumer pattern.
**Rationale:** `@theokit/agents` does not exist; a new package for a low/size-S task violates KISS; a pure predicate composes anywhere.
**Alternatives considered:** create `@theokit/agents` (rejected — over-scope); ship an ACP plugin (rejected — couples sdk-tools to acp; YAGNI).

### D5 — Placement internal/ + barrel export
**Decision:** `packages/sdk-tools/src/internal/command-policy.ts`; barrel-export the four symbols.
**Rationale:** sibling of `shell-guard.ts`; internal/ for logic, barrel for reuse.
**Alternatives considered:** in `@theokit/sdk` core (rejected — composes sdk-tools' shell-guard).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| The policy is only as strong as `catastrophicShellReason` (heuristic, bypassable) | Low | documented — a heuristic gate, not a sandbox (inherits M3-2 honesty, EC-2) | SDK |
| The policy is not auto-wired into any runtime (consumer must call it) | Low | documented consumer pattern (ACP `pre_tool_call`); pure predicate composes anywhere (D4) | SDK |
| Exported predicates with no in-SDK runtime caller (consumer-facing) | Low | barrel-exported LEGO pieces (like `tool-guidance`/`tool-aci`); exercised in tests; `no-stubs` §3 scoped to `packages/sdk/src` | SDK |

## Unresolved Questions

- (none — every decision resolved at plan time via the blueprint's five ADRs. A `@theokit/agents` package, an ACP plugin, and a generic ruleset engine are explicitly deferred — YAGNI here.)

## Dependency Graph

```
Phase 1 (CommandPolicy + denyCatastrophicCommands + commandDenialReason + isCommandAllowed + tests) ──▶ Phase 2 (barrel export + docs + changeset + CHANGELOG) ──▶ Final Phase (integration validation)
```

---

## Phase 1: The command-policy layer

### T1.1 — `command-policy.ts`

#### Objective
Create `internal/command-policy.ts` with the policy type + the three functions composing M3-2.

#### Why this step (action + reasoning)
1. **What** — `CommandPolicy` + `denyCatastrophicCommands` (composes `catastrophicShellReason`) + `commandDenialReason` (deny-wins) + `isCommandAllowed`.
2. **Why now** — it is the whole feature; pure + fully unit-testable; the deny-wins + empty-list semantics are the load-bearing correctness surface.

#### Evidence
Blueprint D1-D4 + Technique 1/2. M3-2 `shell-guard.ts:188` (`catastrophicShellReason`). codex `is_dangerous_command.rs`. The sibling composable functions (`tool-guidance.ts`/`tool-aci.ts`).

#### Files to edit
```
packages/sdk-tools/src/internal/command-policy.ts — NEW: CommandPolicy, denyCatastrophicCommands, commandDenialReason, isCommandAllowed
packages/sdk-tools/tests/command-policy.test.ts — NEW: RED tests first
```

#### Deep file dependency analysis
- `command-policy.ts` imports `catastrophicShellReason` from `./shell-guard.js` (same package, internal). No other file changes this task.

#### Pseudo-code / Signatures
```pseudocode
import { catastrophicShellReason } from "./shell-guard.js"
type CommandPolicy = (command: string) => string | null
function denyCatastrophicCommands(): CommandPolicy
  return (command) => catastrophicShellReason(command)
function commandDenialReason(command, policies): string | null
  for p of policies: r = p(command); if (r !== null) return r
  return null
function isCommandAllowed(command, policies): boolean
  return commandDenialReason(command, policies) === null
```

#### TDD
```
RED: test_deny_catastrophic_denies_rm_rf_root() — denyCatastrophicCommands()("rm -rf /") !== null
RED: test_deny_catastrophic_allows_safe() — denyCatastrophicCommands()("ls -la") === null
RED: test_deny_reason_matches_m3_2() — denyCatastrophicCommands()("rm -rf /") === catastrophicShellReason("rm -rf /") (composition, no dup)
RED: test_is_command_allowed_true_for_safe() — isCommandAllowed("ls", [denyCatastrophicCommands()]) === true
RED: test_is_command_allowed_false_for_catastrophic() — isCommandAllowed("rm -rf /", [denyCatastrophicCommands()]) === false
RED: test_command_denial_reason_returns_reason() — commandDenialReason("rm -rf /", [denyCatastrophicCommands()]) is a string
RED: test_first_deny_wins() — two policies (one allows, one denies) → commandDenialReason returns the denier's reason; order: a custom deny-all policy first wins over a later one
RED: test_first_deny_wins_both_orders() — [denyAll,allowAll]→denyAll reason; [allowAll,denyCatastrophic] on "rm -rf /"→denyCatastrophic reason (iteration continues past an allower) (edge EC-1)
RED: test_empty_policy_list_allows_all() — isCommandAllowed("rm -rf /", []) === true AND commandDenialReason("rm -rf /", []) === null (edge EC-1)
GREEN: implement command-policy.ts
REFACTOR: Biome complexity ≤ 10
VERIFY: pnpm --filter @theokit/sdk-tools exec vitest run tests/command-policy.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/command-policy.test.ts` reports 9/9 tests passed
- [ ] `test_deny_reason_matches_m3_2` passes (composition, not duplication, D2)
- [ ] `test_first_deny_wins` passes (deny-wins, D1)
- [ ] `test_empty_policy_list_allows_all` passes (empty allows all, D3)
- [ ] `pnpm --filter @theokit/sdk-tools exec biome check packages/sdk-tools/src/internal/command-policy.ts` reports 0 errors

#### DoD
- [ ] those tests green; `pnpm --filter @theokit/sdk-tools typecheck` exits 0

---

## Phase 2: Export + document

### T2.1 — Barrel export + docs + changeset + CHANGELOG

#### Objective
Export the four symbols from the barrel; add docs.md note, changeset, CHANGELOG entry; barrel re-export test.

#### Why this step (action + reasoning)
1. **What** — add exports to `index.ts`; document; changeset + CHANGELOG.
2. **Why now** — per `no-stubs-no-mocks-no-wired.md` the policy needs a reachable surface; per CLAUDE.md docs.md reflects the public surface change.

#### Evidence
`index.ts` barrel. Blueprint D5. The `tool-guidance`/`tool-aci` export precedent.

#### Files to edit
```
packages/sdk-tools/src/index.ts — export CommandPolicy, denyCatastrophicCommands, commandDenialReason, isCommandAllowed
packages/sdk-tools/tests/command-policy.test.ts — barrel re-export test
docs.md — command-policy note (+ the documented pre_tool_call consumer pattern)
CHANGELOG.md (root) — [Unreleased] § Added entry
.changeset/m3-command-policy.md — NEW minor changeset
```

#### Deep file dependency analysis
- `index.ts` additive exports from `./internal/command-policy.js`. Barrel test imports from `../src/index.js`.

#### TDD
```
RED: test_command_policy_symbols_exported() — import { denyCatastrophicCommands, isCommandAllowed, commandDenialReason } from barrel → defined
GREEN: add barrel exports + docs + changeset + CHANGELOG
REFACTOR: none (additive)
VERIFY: pnpm --filter @theokit/sdk-tools exec vitest run tests/command-policy.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/command-policy.test.ts` reports all tests passed (9 + 1 barrel)
- [ ] `test_command_policy_symbols_exported` passes (barrel)
- [ ] `grep -c "denyCatastrophicCommands\|isCommandAllowed" docs.md` returns ≥ 1 AND `ls .changeset/m3-command-policy.md` exists AND `grep -c "denyCatastrophicCommands\|isCommandAllowed" CHANGELOG.md` ≥ 1
- [ ] `pnpm --filter @theokit/sdk-tools exec biome check` clean on changed files

#### DoD
- [ ] tests green; typecheck exit 0; `pnpm --filter @theokit/sdk-tools build` succeeds; docs/changeset/CHANGELOG present

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | No command-permission policy (M3-6) | T1.1 | `CommandPolicy` + `commandDenialReason`/`isCommandAllowed` (D1) |
| 2 | Catastrophic at the agents layer | T1.1 | `denyCatastrophicCommands()` composing M3-2 (D2) |
| 3 | Compose, not duplicate (Rule 9) | T1.1 | calls `catastrophicShellReason` (D2) |
| 4 | deny-wins composition | T1.1 | first non-null reason wins (D1) |
| 5 | empty list allows all | T1.1 | iteration over [] → null (D3) |
| 6 | no new package, pure predicate | T1.1 | framework-agnostic in sdk-tools (D4) |
| 7 | zero new deps | T1.1 | compose M3-2 + Array ops (D2/Rule 9) |
| 8 | Document + record + export | T2.1 | barrel + docs.md + changeset + CHANGELOG + barrel test |

**Coverage: 8/8 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/sdk-tools exec vitest run` green
- [ ] Zero type errors — `pnpm --filter @theokit/sdk-tools typecheck`
- [ ] Zero lint warnings — `pnpm --filter @theokit/sdk-tools exec biome check`
- [ ] Dead-code gate — `pnpm quality:dead` (knip) exits 0 (NOTE: sdk-tools is not a knip workspace, so this does not prove these exports are wired; orphan-safety is the test suite exercising the policies + the `tool-guidance`/`tool-aci` LEGO precedent; `no-stubs` §3 is scoped to `packages/sdk/src`)
- [ ] Build clean — `pnpm --filter @theokit/sdk-tools build`
- [ ] File-size budget respected (`command-policy.ts` ≤ 500, target ≤ 80)
- [ ] CHANGELOG.md updated under `[Unreleased]` + changeset added (Unbreakable Rule 6)
- [ ] `docs.md` reflects the command-policy layer + the documented consumer wiring pattern
- [ ] Plan-specific: composes M3-2 (reason matches, no dup); deny-wins; empty list allows all; pure predicate (no new package); zero new deps
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merge

## Dependencies

M3-6 introduces ZERO new dependencies — composes the M3-2 `catastrophicShellReason` + `Array.prototype` ops (Rule 9 / KISS).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (in-repo) `catastrophicShellReason` (M3-2) | workspace | npm/TS | the composed catastrophic deny-list (same package) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | A policy/rules-engine lib was considered + rejected: deny-wins over an array is `Array.find`; a generic engine is over-scope for a command-string policy. | n/a — in-house |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Failure scenarios

All four functions are pure (no I/O) and never throw: `denyCatastrophicCommands` delegates to `catastrophicShellReason` (itself never-throw); `commandDenialReason`/`isCommandAllowed` are array iterations. There is no runtime failure mode that propagates an exception.

## Final Phase: Integration Validation (MANDATORY)

### Execution
```
pnpm --filter @theokit/sdk-tools exec vitest run tests/command-policy.test.ts
pnpm --filter @theokit/sdk-tools exec vitest run        # full sdk-tools suite — no regression
pnpm --filter @theokit/sdk-tools typecheck
pnpm --filter @theokit/sdk-tools exec biome check
pnpm quality:dead
pnpm --filter @theokit/sdk-tools build
```

### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/command-policy.test.ts` reports 10 tests passed (0 failed)
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run` exits 0 with 0 failed tests (full suite, no regression)
- [ ] `pnpm --filter @theokit/sdk-tools typecheck` exits 0 (0 type errors) and `pnpm --filter @theokit/sdk-tools exec biome check` reports 0 warnings
- [ ] `pnpm quality:dead` exits 0
- [ ] `pnpm --filter @theokit/sdk-tools build` succeeds (dist emitted)
- [ ] Runtime-metric proof — N/A (pure predicates; observable via the deny reason / allow boolean)

### If Validation Fails
1. Identify plan-caused vs pre-existing failures. 2. Fix all plan-caused. 3. Re-run. 4. Log pre-existing in the PR.
