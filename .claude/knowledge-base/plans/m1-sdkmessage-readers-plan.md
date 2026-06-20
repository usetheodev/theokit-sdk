---
slug: m1-sdkmessage-readers
created_at: 2026-06-20
goal: Ship a @theokit/sdk/messages subpath with pure readers over SDKMessage (assistantText, extractToolUses) plus a cost reader preserving amountUsd as number|undefined, measured by tests/messages-readers.test.ts + tests/messages-readers-wiring.test.ts passing green.
---

# Plan: M1-5 — `SDKMessage` readers on a `@theokit/sdk/messages` subpath

> **Version 1.1** (edge-case-plan absorbed: EC-1 empty-content-array + EC-2 ordered-join regression locks folded into T1.1 TDD) — A consumer reading the `SDKMessage` stream has no public readers and hand-rolls a wire-event mapper (`theocode/server/lib/sdk-mappers.ts`). This plan promotes those readers onto the SDK's own types as a `@theokit/sdk/messages` subpath: `assistantText(msg)`, `extractToolUses(msg)`, and `costAmountUsd(cost)` preserving `amountUsd: number | undefined` (repo ADR `D377-cost-status-closed-enum.md` — never 0). Closes roadmap gap M1-5. Design locked by blueprint `m1-sdkmessage-readers` (discover-confidence SHIPPABLE 98.8).

## Goal

> "Enable agent/server builders to read assistant text, tool uses, and honest cost from an `SDKMessage`/`CostBreakdown` without hand-rolling a wire-event mapper, measured by `tests/messages-readers.test.ts` + `tests/messages-readers-wiring.test.ts` passing green."

## Context

Roadmap gap M1-5 (#34, `gap-audit/THEOKIT_GAP_AUDIT.md:80,123`): no public `SDKMessage` readers exist. First-party proof: `theocode/server/lib/sdk-mappers.ts:17-99` hand-rolls `assistantText` (concat assistant text blocks), `costToDomain` (preserve `amountUsd ?? null`, NEVER 0 — repo ADR `D377-cost-status-closed-enum.md`), etc. The SDK owns the types — `SDKMessage` (`packages/sdk/src/types/messages.ts:161`), `SDKAssistantMessage.content: Array<TextBlock|ToolUseBlock>` (`:58-66`), `ToolUseBlock` (`:19`), `CostBreakdown.amountUsd: number | undefined` (`packages/sdk/src/types/usage.ts`) — but `assistantText` exists only as a fixture builder, `extractToolUses` is absent, and there is no `./messages` subpath.

Discovery (`knowledge-base/discoveries/blueprints/m1-sdkmessage-readers-blueprint.md`, SHIPPABLE 98.8) compared ADK-JS `getFunctionCalls`/content extractors and CrewAI usage-metrics against the first-party mappers, locking the reader signatures, the cost-honesty contract, and the shape mapping (SDK discriminated `block.type` not ADK genai `parts`). **Baseline correction to the blueprint's EC-3 inference:** the SDK generates non-core subpath DTS via `tsc` (`tsconfig.tools-dts.json` + `onSuccess` + `mirror-dts-to-cts.mjs`), NOT the rollup-plugin-dts `dts.entry` block (which only lists core entries). `./messages` follows the `path-safety` pattern exactly (tsc DTS + cts mirror), so the readers' DTS never trips the rollup cycle regardless of leaf-type-only deps.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/src/messages.ts` (NEW) | 0 | — | (the public readers module) | — |
| `packages/sdk/src/types/messages.ts` | 170 | `478fe5a` | `SDKMessage` union + `TextBlock`/`ToolUseBlock`/`SDKAssistantMessage` | read-only; types unchanged |
| `packages/sdk/src/types/usage.ts` | 70 | `b70747b` | `CostBreakdown.amountUsd: number|undefined` + `TokenUsage` | read-only; types unchanged |
| `packages/sdk/package.json` | 309 | `a888444` | workspace pkg w/ `exports` map (`./retry`, `./path-safety`, …) | additive `./messages` export block only |
| `packages/sdk/tsup.config.ts` | 67 | `e3daef9` | build entries + DTS strategy (tsc for non-core subpaths) | additive `messages` entry only |
| `packages/sdk/tsconfig.tools-dts.json` | (config) | — | tsc DTS `include` list for non-core subpaths | additive `src/messages.ts` include only |
| `packages/sdk/scripts/mirror-dts-to-cts.mjs` | (script) | — | mirrors `.d.ts`→`.d.cts` for the CJS condition | additive `messages.d.ts` entry only |
| `packages/sdk/tests/messages-readers.test.ts` (NEW) | 0 | — | unit tests — RED first | — |
| `packages/sdk/tests/messages-readers-wiring.test.ts` (NEW) | 0 | — | integration test through the public surface | — |
| `docs.md` | (contract) | — | public API contract | additive `Message readers` section |
| `packages/sdk/CHANGELOG.md` (root) + `.changeset/` (NEW) | — | — | changelog + changeset | additive `[Unreleased]`/changeset entry |

### Current callers / dependents

- **Symbol:** `assistantText`/`extractToolUses`/`costAmountUsd` (NEW) — no callers yet; ship as PUBLIC subpath primitives (consumer-facing, like M0 `withRetry`/the `path-safety` subpath), wired via an integration test + docs example per the no-orphan public-primitive exception.
- **Symbol:** `SDKMessage`/`ToolUseBlock`/`CostBreakdown`/`TextBlock` — read-only inputs; not modified. Exported via `types/index.ts` (`export type * from "./messages.js"` `:16`; `"./usage.js"` `:23`).
- **Subpath wiring:** mirrors the `path-safety` subpath (`package.json` exports + tsup entry + `tsconfig.tools-dts.json` include + `mirror-dts-to-cts.mjs`).

### Domain glossary

- **SDKMessage reader** — a pure function that extracts a value (text / tool uses) from an `SDKMessage` without I/O.
- **assistant text** — the concatenated text of an assistant message's `TextBlock`s.
- **tool use** — a `ToolUseBlock` (`type:"tool_use"`) inside an assistant message's content (distinct from the `SDKToolUseMessage` lifecycle event).
- **cost honesty** — `CostBreakdown.amountUsd` is `number | undefined`; `undefined` means "cost unknown", distinct from a real `$0` (repo ADR `D377-cost-status-closed-enum.md`) — a reader must never coerce `undefined` to 0.
- **subpath** — a secondary package entry point (e.g. `@theokit/sdk/messages`) declared in `package.json` `exports`.

### Architecture boundaries affected

Per `rules/architecture.md` §2: `src/messages.ts` is a PURE reader module depending ONLY on leaf types (`types/messages.ts`, `types/usage.ts`) — no I/O, no `internal/runtime`. The only outward extension is an additive PUBLIC subpath (a contract extension documented in `docs.md`), wired identically to the existing `path-safety` subpath.

## Prior Art & Related Work

- **Internal blueprint** `knowledge-base/discoveries/blueprints/m1-sdkmessage-readers-blueprint.md` (ADRs D1-D4) — the locked design source.
- **First-party baseline** `theocode/server/lib/sdk-mappers.ts:17-99` — the proven hand-roll (`assistantText`, `costToDomain` never-0).
- **Reference** ADK-JS `getFunctionCalls` (`.claude/knowledge-base/reference/adk-js/core/src/events/event.ts:108`) + content text path (`content_processor_utils.ts:204`).
- **Reference** CrewAI `UsageMetrics` (`.claude/knowledge-base/reference/crewAI/lib/crewai/src/crewai/types/usage_metrics.py:32`).
- **First-party subpath pattern** `packages/sdk/src/path-safety.ts` + `package.json` exports + `tsup.config.ts` + `tsconfig.tools-dts.json` + `scripts/mirror-dts-to-cts.mjs`.

## Objective

- [ ] `src/messages.ts` exports `assistantText(msg)`, `extractToolUses(msg)`, `costAmountUsd(cost)` — pure, leaf-type-only.
- [ ] `assistantText`: concat assistant `TextBlock` text; `""` for non-assistant / no text.
- [ ] `extractToolUses`: the assistant message's `ToolUseBlock`s; `[]` for non-assistant.
- [ ] `costAmountUsd`: returns `cost?.amountUsd` (`number | undefined`) — never coerced to 0.
- [ ] `@theokit/sdk/messages` subpath wired (package.json exports + tsup entry + tsc-DTS include + cts mirror), like `path-safety`.
- [ ] Zero new dependencies; docs.md section + CHANGELOG + changeset.
- [ ] `tests/messages-readers.test.ts` + `tests/messages-readers-wiring.test.ts` green; typecheck + Biome + knip + build clean.

## ADRs

### D1 — Reader signatures over the SDK's own types

**Decision:** `assistantText(msg: SDKMessage): string`; `extractToolUses(msg: SDKMessage): ToolUseBlock[]`; `costAmountUsd(cost: CostBreakdown | undefined): number | undefined`. Pure free functions in `src/messages.ts`.

**Rationale:** promotes `sdk-mappers.ts:17-23,56` onto the SDK's native types (Rule 9); mirrors ADK's free-function readers (`event.ts:108`). Blueprint ADR D1.

**Alternatives considered:** methods on a message wrapper class (rejected — `SDKMessage` is a data union, KISS); a generic `readMessage(msg, kind)` (rejected — loses type-narrowing, less ergonomic).

**Consequences:** consumers stop hand-rolling; readers are trivially unit-testable.

### D2 — Shape mapping: SDK discriminated blocks, not ADK genai parts

**Decision:** filter `block.type === "text"` / `block.type === "tool_use"` over `SDKAssistantMessage.content`. `extractToolUses` reads the assistant message's `ToolUseBlock`s (returns `[]` for non-assistant); the `SDKToolUseMessage` lifecycle event is OUT of scope.

**Rationale:** the SDK content is a discriminated union (`messages.ts:9-25`); the discriminant is the type-safe filter. Blueprint ADRs D2 + EC-1/EC-2.

**Alternatives considered:** duck-type on `.text`/`.input` presence (rejected — loses narrowing, fragile); read the `tool_call` event too (rejected — different stream, scope creep).

**Consequences:** type-safe readers; thinking content (separate `SDKThinkingMessage`) naturally excluded.

### D3 — Cost reader preserves `amountUsd: number | undefined` (never 0)

**Decision:** `costAmountUsd(cost)` returns `cost?.amountUsd` verbatim — `undefined` = unknown; a real 0 (`included` routes) preserved. NEVER `?? 0`.

**Rationale:** repo ADR `D377-cost-status-closed-enum.md` + `sdk-mappers.costToDomain` (`:56`) — conflating unknown cost with $0 is a financial-honesty bug. Blueprint ADR D3.

**Alternatives considered:** `amountUsd ?? 0` (rejected — the exact dishonesty `D377-cost-status-closed-enum.md` forbids); return `null` (rejected — the SDK type is `number | undefined`; preserve it verbatim rather than translate to null).

**Consequences:** honest cost downstream; a consumer distinguishes unknown from free.

### D4 — Subpath wired on the tsc-DTS path (like `path-safety`), zero new deps

**Decision:** wire `@theokit/sdk/messages` → `src/messages.ts` via `package.json` exports + tsup `entry` + add `src/messages.ts` to `tsconfig.tools-dts.json` `include` + add `messages.d.ts` to `mirror-dts-to-cts.mjs`. No main-barrel export. No new dependency.

**Rationale:** the SDK generates non-core subpath DTS via `tsc` (`tsup.config.ts` `dts.entry` lists only core; `onSuccess` runs tsc + cts mirror). `path-safety` (a thin leaf re-export) uses this path — `./messages` follows it exactly (baseline correction to blueprint EC-3, which guessed rollup-plugin-dts). Readers use the SDK's own types — zero deps (Q5/D4).

**Alternatives considered:** add to the rollup `dts.entry` block (rejected — inconsistent with every other subpath; risks the `types/agent.ts↔fork-agent.ts` cycle); main-barrel export (rejected — a dedicated subpath keeps the barrel lean, matches M0/path-safety convention).

**Consequences:** `attw`/`publint` clean (cts mirror); consistent with the established subpath convention.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Subpath wiring spans 4 config files — easy to miss one (e.g. forget the cts mirror → attw "masquerading" warning) | Medium | T2.1 checklist mirrors `path-safety` exactly; Integration Validation runs `pnpm build` + (if available) attw/publint to catch a missed file | SDK |
| `costAmountUsd` returning `undefined` may surprise a caller expecting a number | Low | Documented (repo ADR `D377-cost-status-closed-enum.md` honesty): `undefined` = unknown, never 0; the type signature `number | undefined` forces the caller to handle it | SDK |
| A future `./messages` collision with the internal `types/messages.ts` name | Low | The subpath source is `src/messages.ts` (public readers), distinct from `src/types/messages.ts` (type defs) — no import collision; documented in the glossary | SDK |

## Unresolved Questions

- (none — every decision is resolved at plan time via blueprint ADRs D1-D4 + the baseline DTS-path correction. Whether to also ship a `tokenTotal(usage)` reader is deferred — YAGNI; `costAmountUsd` is the honesty-critical one, and `TokenUsage` is already a public type consumers read directly.)

## Dependency Graph

```
Phase 1 (readers) ──▶ Phase 2 (subpath wiring + docs + changelog) ──▶ Final Phase (integration validation: tests + build)
```

Sequential: Phase 2 wires + documents Phase 1; Final validates both incl. the build.

---

## Phase 1: Pure `SDKMessage` readers

**Objective:** implement the three pure readers with full TDD.

### T1.1 — Implement `assistantText` + `extractToolUses` + `costAmountUsd`

#### Objective
Create `src/messages.ts` with the three pure readers over `SDKMessage`/`CostBreakdown`.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — introduces the reader module: `assistantText` (concat assistant text blocks), `extractToolUses` (assistant tool_use blocks), `costAmountUsd` (honest cost).

2. **Why it is necessary now** — it is the core deliverable; the subpath wiring (Phase 2) has nothing to export without it. The signatures are fully specified by ADRs D1-D3 and mirror the proven `sdk-mappers.ts`, so it is written test-first.

#### Evidence
Blueprint ADRs D1-D3. First-party `theocode/server/lib/sdk-mappers.ts:17-23,56`. Input types: `SDKMessage`/`SDKAssistantMessage`/`TextBlock`/`ToolUseBlock` (`packages/sdk/src/types/messages.ts:9-66,161`), `CostBreakdown` (`packages/sdk/src/types/usage.ts`). Reference `getFunctionCalls` (`.claude/knowledge-base/reference/adk-js/core/src/events/event.ts:108`).

#### Files to edit
```
packages/sdk/src/messages.ts — NEW: assistantText, extractToolUses, costAmountUsd
packages/sdk/tests/messages-readers.test.ts — NEW: RED tests first (TDD)
```

#### Deep file dependency analysis
- `messages.ts` (NEW) — imports `SDKMessage`/`SDKAssistantMessage`/`TextBlock`/`ToolUseBlock` from `./types/messages.js`, `CostBreakdown` from `./types/usage.js`. No other file changes in this task. No downstream caller yet (wired in Phase 2).
- Leaf-type-only imports — no `internal/runtime` reach (invariant for the DTS path, D4).

#### Deep Dives
- **`assistantText(msg)`**: if `msg.type !== "assistant"` → `""`; else `msg.message.content.filter(b => b.type === "text").map(b => b.text).join("")`.
- **`extractToolUses(msg)`**: if `msg.type !== "assistant"` → `[]`; else `msg.message.content.filter((b): b is ToolUseBlock => b.type === "tool_use")`.
- **`costAmountUsd(cost)`**: `return cost?.amountUsd;` (i.e. `number | undefined`; NEVER `?? 0`).
- **Invariants**: pure (no mutation of inputs, no I/O); deterministic; non-assistant → ""/[]; `costAmountUsd(undefined)` → `undefined`; a defined 0 preserved.
- **Edge cases**: assistant with mixed text+tool_use blocks (text concat ignores tool_use; extractToolUses ignores text); empty content array → ""/[]; `cost` present with `amountUsd: 0` → returns 0 (not undefined); `cost` present with `amountUsd: undefined` → undefined.

#### Pseudo-code / Signatures
```pseudocode
function assistantText(msg: SDKMessage): string
  if msg.type != "assistant": return ""
  return msg.message.content.filter(b => b.type=="text").map(b => b.text).join("")

function extractToolUses(msg: SDKMessage): ToolUseBlock[]
  if msg.type != "assistant": return []
  return msg.message.content.filter(b => b.type=="tool_use")

function costAmountUsd(cost: CostBreakdown | undefined): number | undefined
  return cost?.amountUsd   # never ?? 0

# Example
assistantText(assistant([{type:"text",text:"hi"},{type:"tool_use",...}])) == "hi"
extractToolUses(same).length == 1
costAmountUsd({amountUsd: undefined, ...}) === undefined   # unknown, not 0
costAmountUsd({amountUsd: 0, ...}) === 0                    # real free, preserved
```

#### Tasks
1. Write RED tests in `tests/messages-readers.test.ts`.
2. Implement `assistantText`.
3. Implement `extractToolUses`.
4. Implement `costAmountUsd`.
5. REFACTOR for Biome cognitive-complexity ≤ 10 (each reader is tiny).

#### TDD
```
RED: test_assistantText_concatenates_text_blocks() — assistant w/ text blocks → joined string
RED: test_assistantText_empty_for_non_assistant() — system/tool_call/user → ""
RED: test_assistantText_ignores_tool_use_blocks() — mixed text+tool_use → only text
RED: test_extractToolUses_returns_tool_use_blocks() — assistant w/ tool_use → [block]
RED: test_extractToolUses_empty_for_non_assistant() — non-assistant → []
RED: test_costAmountUsd_preserves_undefined_never_zero() — {amountUsd: undefined} → undefined
RED: test_costAmountUsd_preserves_real_zero() — {amountUsd: 0} → 0
RED: test_costAmountUsd_undefined_cost_returns_undefined() — costAmountUsd(undefined) → undefined
RED: test_readers_do_not_mutate_inputs() — input message/cost unchanged after call
RED: test_assistantText_empty_content_array_returns_empty_string() — assistant w/ content:[] → "" (edge-case EC-1)
RED: test_extractToolUses_empty_content_array_returns_empty() — assistant w/ content:[] → [] (edge-case EC-1)
RED: test_assistantText_joins_multiple_text_blocks_in_order() — [{text:"a"},{tool_use},{text:"b"}] → "ab" (edge-case EC-2)
GREEN: implement src/messages.ts
REFACTOR: None expected (tiny pure fns); complexity <= 10
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/messages-readers.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/messages-readers.test.ts` reports 12/12 tests passed
- [ ] `test_costAmountUsd_preserves_undefined_never_zero` passes (repo ADR `D377-cost-status-closed-enum.md` honesty)
- [ ] `test_assistantText_ignores_tool_use_blocks` passes (D2 discriminant filter)
- [ ] `grep -c "?? 0" packages/sdk/src/messages.ts` returns 0 (cost never coerced)
- [ ] `pnpm --filter @theokit/sdk exec biome check packages/sdk/src/messages.ts` reports 0 errors (complexity ≤ 10)
- [ ] `wc -l packages/sdk/src/messages.ts` returns ≤ 80 (budget 500)

#### DoD
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/messages-readers.test.ts` green
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0
- [ ] `pnpm --filter @theokit/sdk exec biome check` clean on changed files

---

## Phase 2: Wire the `@theokit/sdk/messages` subpath + docs

**Objective:** expose the readers as a public subpath (like `path-safety`), document + record, with a real integration test.

### T2.1 — Wire subpath + integration test + docs + changeset

#### Objective
Add the `./messages` export (package.json + tsup entry + tsc-DTS include + cts mirror), an integration test through the public surface, a docs.md section, and a changeset + CHANGELOG entry.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — wires the subpath across the 4 config files (mirroring `path-safety`), proves it with an integration test, documents it, and records the change.

2. **Why it is necessary now** — per `no-stubs-no-mocks-no-wired.md`, the readers need a reachable consumer surface; per CLAUDE.md, `docs.md` reflects any public-surface change in the same change. The subpath IS the consumer surface (D4).

#### Evidence
`path-safety` subpath wiring: `package.json` exports (`:51`), `tsup.config.ts` entry (`:9`), `tsconfig.tools-dts.json` include, `scripts/mirror-dts-to-cts.mjs` (`:32`). `no-stubs-no-mocks-no-wired.md` public-primitive exception. docs.md hooks/subpath sections.

#### Files to edit
```
packages/sdk/package.json — add "./messages" exports block (mirror "./path-safety")
packages/sdk/tsup.config.ts — add "messages": "src/messages.ts" to entry
packages/sdk/tsconfig.tools-dts.json — add "src/messages.ts" to include
packages/sdk/scripts/mirror-dts-to-cts.mjs — add messages.d.ts to the mirror list
packages/sdk/tests/messages-readers-wiring.test.ts — NEW: integration test importing the readers
docs.md — NEW "Message readers (@theokit/sdk/messages)" section
packages/sdk/CHANGELOG.md (root) — [Unreleased] § Added entry
.changeset/m1-sdkmessage-readers.md — NEW: minor changeset
```

#### Deep file dependency analysis
- `package.json`/`tsup.config.ts`/`tsconfig.tools-dts.json`/`mirror-dts-to-cts.mjs` — additive subpath entries mirroring `path-safety`; no existing entry changed.
- `messages-readers-wiring.test.ts` (NEW) — imports the readers from `../src/messages.js` and exercises a realistic `SDKAssistantMessage` (text + tool_use) + a `CostBreakdown` end-to-end (the boundary a consumer hits).
- `docs.md` — additive section; no existing contract changed.

#### Deep Dives
- **Integration test**: build a realistic `SDKAssistantMessage` (text + tool_use blocks) + a `CostBreakdown`; assert `assistantText` returns the text, `extractToolUses` returns the tool_use block, `costAmountUsd` preserves the amount; inputs unmutated. Imports from `../src/messages.js` (repo convention to avoid stale dist).
- **Subpath presence check**: assert `package.json` declares `./messages` (grep oracle in AC) — the build/attw at Integration Validation proves it resolves.
- **Invariant**: the public export names + signatures are the contract — documented in `docs.md`.

#### Tasks
1. Add the `./messages` exports block in package.json (mirror `./path-safety`).
2. Add `"messages": "src/messages.ts"` to tsup `entry`.
3. Add `"src/messages.ts"` to `tsconfig.tools-dts.json` include + `messages.d.ts` to `mirror-dts-to-cts.mjs`.
4. Write integration test `messages-readers-wiring.test.ts`.
5. Add docs.md section + `.changeset/m1-sdkmessage-readers.md` (minor) + CHANGELOG `[Unreleased] § Added`.

#### TDD
```
RED: test_readers_importable_and_work_on_realistic_message() — import { assistantText, extractToolUses, costAmountUsd } from "../src/messages.js"; realistic SDKAssistantMessage → correct text + tool uses + cost
RED: test_subpath_declared_in_package_json() — package.json exports has "./messages" (read package.json, assert key present)
GREEN: wire the subpath (package.json + tsup + tsconfig.tools-dts + mirror) + write docs/changeset/CHANGELOG
REFACTOR: None expected
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/messages-readers-wiring.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/messages-readers-wiring.test.ts` reports 2/2 tests passed
- [ ] `node -e "process.exit(require('./packages/sdk/package.json').exports['./messages'] ? 0 : 1)"` exits 0 (subpath declared)
- [ ] `grep -c "messages" packages/sdk/tsup.config.ts` returns ≥ 1 AND `grep -c "src/messages.ts" packages/sdk/tsconfig.tools-dts.json` returns ≥ 1 (entry + DTS wired)
- [ ] `grep -c "messages.d.ts" packages/sdk/scripts/mirror-dts-to-cts.mjs` returns ≥ 1 (cts mirror wired)
- [ ] `grep -c "@theokit/sdk/messages" docs.md` returns ≥ 1 AND `ls .changeset/m1-sdkmessage-readers.md` exists AND `grep -c "assistantText" packages/sdk/CHANGELOG.md` ≥ 1
- [ ] `pnpm --filter @theokit/sdk exec biome check` clean on changed files

#### DoD
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/messages-readers-wiring.test.ts` green
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0
- [ ] `pnpm --filter @theokit/sdk build` succeeds (subpath DTS + cts emitted)
- [ ] docs.md section + changeset + CHANGELOG entry present

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | No public `assistantText` reader (M1-5) | T1.1 | `assistantText` over `SDKMessage` (D1/D2) |
| 2 | No `extractToolUses` reader | T1.1 | `extractToolUses` over assistant `ToolUseBlock`s (D2) |
| 3 | Honest cost reader (`amountUsd` never 0) | T1.1 | `costAmountUsd` preserves `number|undefined` (D3) |
| 4 | No `./messages` subpath | T2.1 | subpath wired like `path-safety` (D4) |
| 5 | Zero new deps | T1.1 | SDK's own types only (D4) |
| 6 | Document + record + prove the public surface | T2.1 | docs.md + changeset + CHANGELOG + integration test |

**Coverage: 6/6 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/sdk exec vitest run` green
- [ ] Zero type errors — `pnpm --filter @theokit/sdk typecheck`
- [ ] Zero lint warnings — `pnpm --filter @theokit/sdk exec biome check`
- [ ] Dead-code clean — `pnpm quality:dead` (knip)
- [ ] Build clean — `pnpm --filter @theokit/sdk build` (subpath DTS + cts emitted; no attw/publint regression)
- [ ] File-size budget respected (`messages.ts` ≤ 500, target ≤ 80)
- [ ] CHANGELOG.md updated under `[Unreleased]` + changeset added (Unbreakable Rule 6)
- [ ] Backward compatibility preserved (additive subpath + docs only)
- [ ] `docs.md` reflects the new `@theokit/sdk/messages` surface (source-of-truth rule)
- [ ] Plan-specific: `costAmountUsd` never coerces `undefined`→0 (asserted); `extractToolUses` reads assistant `ToolUseBlock`s only; readers pure (inputs unmutated)
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merge

## Dependencies

M1-5 introduces ZERO new dependencies — pure readers over the SDK's own types (Rule 9 / KISS).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (internal) `SDKMessage`/`ToolUseBlock`/`CostBreakdown` types | n/a (in-repo `types/`) | npm/TS | reader I/O types — reused |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | A provider-types dep (like ADK's `@google/genai`) was evaluated + rejected — the SDK defines its own `SDKMessage`/`ToolUseBlock`/`CostBreakdown`, so no external content types are needed. | n/a — no new dep |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Failure scenarios

(none — no external I/O. The readers are pure in-memory transforms over already-materialized `SDKMessage`/`CostBreakdown` values: no HTTP/DB/queue/socket/filesystem. Resilience-under-failure does not apply.)

## Final Phase: Integration Validation (MANDATORY)

**Objective:** validate the readers + the subpath wiring work, including the build (DTS + cts emission).

### Execution
```
pnpm --filter @theokit/sdk exec vitest run tests/messages-readers.test.ts tests/messages-readers-wiring.test.ts
pnpm --filter @theokit/sdk exec vitest run        # full suite — no regression
pnpm --filter @theokit/sdk typecheck
pnpm --filter @theokit/sdk exec biome check
pnpm quality:dead
pnpm --filter @theokit/sdk build                  # subpath DTS + cts emitted
```

### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/messages-readers.test.ts tests/messages-readers-wiring.test.ts` reports 14/14 tests passed
- [ ] `pnpm --filter @theokit/sdk exec vitest run` reports 0 failed (full SDK suite — no regression)
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0 AND `pnpm --filter @theokit/sdk exec biome check` reports 0 errors
- [ ] `pnpm quality:dead` reports 0 unused exports for `src/messages.ts` (knip — subpath exports not orphan)
- [ ] `pnpm --filter @theokit/sdk build` succeeds; `ls dist/messages.d.ts dist/messages.d.cts` both exist (exit 0)
- [ ] Runtime-metric proof — N/A: `grep -c "metric" Global-DoD` shows 0 metric targets declared (pure readers, consistent with the M0/path-safety primitives)

### If Validation Fails
1. Identify plan-caused vs pre-existing failures.
2. Fix all plan-caused failures.
3. Re-run the chain.
4. Log pre-existing issues in the PR description; they do not block.
