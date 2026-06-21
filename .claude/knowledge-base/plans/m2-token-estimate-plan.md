---
slug: m2-token-estimate
created_at: 2026-06-21
goal: Add pure pre-call helpers estimateTokens(text) (chars/4, no tokenizer) + shouldCompact({estimated,contextWindow,buffer}) to the @theokit/sdk/compaction subpath, measured by tests/compaction.test.ts + tests/compaction-wiring.test.ts passing green.
---

# Plan: M2-2 — Token estimate + shouldCompact (pre-call decision)

> **Version 1.1** (edge-case-plan absorbed: EC-1 non-empty-min-one folded into T1.1 TDD) — Add two pure, zero-dep pre-call helpers to the EXISTING `@theokit/sdk/compaction` subpath: `estimateTokens(text: string): number` (a cheap `chars/4` approximation — no tokenizer) and `shouldCompact({ estimated, contextWindow, buffer }): boolean` (decide BEFORE sending whether to compact, leaving a safety `buffer` of headroom). Siblings of the M2-1 `compactTranscript`/`isContextOverflowError` helpers already in `src/compaction.ts`. The subpath wiring (package.json exports, tsup entry, tsc-dts, mirror-dts) already exists — M2-2 only augments the barrel file. Closes roadmap gap M2-2 (Tema B).

## Goal

> "Ship `estimateTokens(text)` + `shouldCompact({estimated,contextWindow,buffer})` on the `@theokit/sdk/compaction` subpath — pure, no tokenizer — measured by `tests/compaction.test.ts` + `tests/compaction-wiring.test.ts` passing green."

## Context

Roadmap gap M2-2 (`docs/gap-audit/ROADMAP.md:109`, low sev, size M, Tema B). Greenfield (confirmed): no `estimateTokens`/`shouldCompact`/token-estimation pre-call helper anywhere in `packages/sdk/src`. M2-1 shipped the `@theokit/sdk/compaction` subpath (`packages/sdk/src/compaction.ts`) with `compactTranscript`/`buildCheckpoint`/`filterFromLatestCheckpoint`/`isContextOverflowError`/`CHECKPOINT_MARKER` — the subpath is already wired (package.json `exports["./compaction"]`, `tsup.config.ts:11`, `tsconfig.tools-dts.json:15`, `scripts/mirror-dts-to-cts.mjs:34`). M2-2 adds the two pre-call helpers to that same file; no wiring change needed. `shouldCompact` takes `contextWindow` as a PARAM (decoupled from the per-model catalog M2-4 promotes). Respects `rules/architecture.md` + `rules/no-stubs-no-mocks-no-wired.md`. Zero new deps.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/src/compaction.ts` | 96 | (M2-1) | `@theokit/sdk/compaction` public barrel | additive exports only; keep M2-1 helpers intact |
| `packages/sdk/tests/compaction.test.ts` | (exists) | — | compaction unit tests | additive cases |
| `packages/sdk/tests/compaction-wiring.test.ts` | (exists) | — | subpath import test | add the 2 new symbols to the import assertion |
| `docs.md` | (contract) | — | public API contract | additive note in the compaction section |
| `CHANGELOG.md` (root) + `packages/sdk/CHANGELOG.md` + `.changeset/` (NEW) | — | — | changelogs + changeset | additive Added entry |

### Current callers / dependents

- **NEW** `estimateTokens`/`shouldCompact` — exported from `src/compaction.ts` (the `@theokit/sdk/compaction` subpath). Consumers call them pre-`agent.send` to decide compaction. Exercised in `compaction.test.ts` (unit) + `compaction-wiring.test.ts` (subpath import) → no orphan. Siblings of the M2-1 helpers (same LEGO-piece precedent).
- **No internal SDK caller** — these are consumer-facing pre-call helpers (the consumer owns the send loop); same shape as M2-1's `compactTranscript`.

### Domain glossary

- **estimateTokens** — a tokenizer-free approximation of token count via `ceil(text.length / 4)` (the common ~4-chars-per-token heuristic).
- **shouldCompact** — a pure decision: given an `estimated` token count, the model's `contextWindow`, and a reserved `buffer` of headroom, return whether compaction should run before the next call.

### Architecture boundaries affected

Per `rules/architecture.md`: both helpers are pure domain logic (no I/O) added to the existing `compaction.ts` barrel. No new subpath, no DIP boundary crossed.

## Prior Art & Related Work

- **In-repo** M2-1 `compaction.ts` (`packages/sdk/src/compaction.ts:1-96`) — the sibling helpers + the subpath this augments; `compaction-wiring.test.ts` (the import-assertion pattern). The per-model `contextWindow` source exists internally (`packages/sdk/src/internal/llm/model-capabilities.ts` `maxContextTokens`) and is promoted publicly by M2-4 — M2-2 stays decoupled by taking `contextWindow` as a param.
- (none external — pure helpers; `cycle-discover` not applicable.)

## Objective

- [ ] `compaction.ts` exports `estimateTokens(text: string): number` + `shouldCompact(input: { estimated: number; contextWindow: number; buffer: number }): boolean`.
- [ ] `estimateTokens` = `ceil(text.length / 4)`; `""` → 0; never negative.
- [ ] `shouldCompact` returns true when `estimated >= contextWindow - buffer` (the estimate leaves less than `buffer` headroom); a `buffer >= contextWindow` (non-positive threshold) → always true.
- [ ] M2-1 helpers unchanged; zero new deps; subpath import test updated.
- [ ] docs.md + CHANGELOG (root + package) + changeset.
- [ ] `tests/compaction.test.ts` + `tests/compaction-wiring.test.ts` green; typecheck + Biome clean; build emits the subpath dts.

## ADRs

### D1 — `estimateTokens` = chars/4 (tokenizer-free)
**Decision:** `estimateTokens(text) = Math.ceil(text.length / 4)`; an empty string → 0.
**Rationale:** the roadmap scopes a cheap pre-call estimate with NO tokenizer dependency (KISS / Rule 9 — no `tiktoken`/`gpt-tokenizer` dep); `~4 chars/token` is the standard heuristic, good enough for a "should I compact?" gate.
**Alternatives considered:** a real tokenizer (rejected — heavy dep + per-model variance, overkill for a pre-call gate); chars/3.5 etc. (rejected — chars/4 is the conventional, documented approximation).

### D2 — `shouldCompact` is a pure threshold over caller-supplied numbers
**Decision:** `shouldCompact({estimated, contextWindow, buffer}) = estimated >= contextWindow - buffer`. `contextWindow - buffer <= 0` → always true (degenerate but safe).
**Rationale:** keeps the decision pure + decoupled from the per-model catalog (M2-4); the consumer passes the window (from M2-4's `resolveModelCapabilities` once public, or any source). `buffer` is reserved output/headroom tokens.
**Alternatives considered:** read the window internally (rejected — couples M2-2 to M2-4; the param keeps it independent); `>` instead of `>=` (rejected — at exactly the threshold, compacting is the safe choice).

### D3 — Live in the existing compaction subpath (no new wiring)
**Decision:** add both to `src/compaction.ts`; the `@theokit/sdk/compaction` subpath is already wired.
**Rationale:** siblings of `compactTranscript`/`isContextOverflowError`; same prompt-budget concern; no package.json/tsup/tsconfig/mirror change needed.
**Alternatives considered:** a new `@theokit/sdk/tokens` subpath (rejected — over-scope; they belong with compaction).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `chars/4` is approximate — under/over-estimates vs a real tokenizer | Low | documented as a heuristic gate (D1); the `buffer` param absorbs the slack; a consumer needing exactness uses their own tokenizer | SDK |
| `shouldCompact` trusts caller numbers (no validation) | Low | pure predicate; negative/odd inputs produce a defined boolean (documented); not the helper's job to validate the window | SDK |
| Exported helpers with no in-SDK runtime caller (consumer-facing) | Low | LEGO-piece precedent (M2-1 `compactTranscript`); exercised in unit + wiring tests | SDK |

## Unresolved Questions

- (none — every decision is resolved at plan time: the estimate formula, the threshold, and the placement are fixed. A real-tokenizer mode is explicitly out of scope — YAGNI.)

## Dependency Graph

```
Phase 1 (estimateTokens + shouldCompact + tests) ──▶ Phase 2 (docs + changeset + CHANGELOG + wiring-test) ──▶ Final Phase (integration validation)
```

---

## Phase 1: The pre-call helpers

### T1.1 — `estimateTokens` + `shouldCompact` in `compaction.ts`

#### Objective
Add the two pure helpers to the existing compaction barrel.

#### Why this step (action + reasoning)
1. **What** — `estimateTokens` (chars/4) + `shouldCompact` (threshold over caller numbers), both pure.
2. **Why now** — they are the whole feature; fully unit-testable with no I/O; the threshold boundary is the load-bearing correctness surface.

#### Evidence
Blueprint-less (internal pure helpers). M2-1 `compaction.ts:1-96` (sibling shape). `model-capabilities.ts` `maxContextTokens` (the window source, kept external via the param).

#### Files to edit
```
packages/sdk/src/compaction.ts — add estimateTokens + shouldCompact (+ option type)
packages/sdk/tests/compaction.test.ts — RED tests first
```

#### Deep file dependency analysis
- `compaction.ts` adds two self-contained functions; no new import. M2-1 helpers untouched.

#### Pseudo-code / Signatures
```pseudocode
export function estimateTokens(text: string): number
  return Math.ceil(text.length / 4)   // "" → 0
export interface ShouldCompactInput { estimated: number; contextWindow: number; buffer: number }
export function shouldCompact(input: ShouldCompactInput): boolean
  return input.estimated >= input.contextWindow - input.buffer
```

#### TDD
```
RED: test_estimate_tokens_chars_over_4() — estimateTokens("12345678") === 2; estimateTokens("123") === 1 (ceil)
RED: test_estimate_tokens_empty_is_zero() — estimateTokens("") === 0
RED: test_estimate_tokens_nonempty_min_one() — estimateTokens(" ") === 1 AND estimateTokens("ab") === 1 (ceil → any non-empty text is ≥ 1, edge EC-1)
RED: test_should_compact_true_at_threshold() — shouldCompact({estimated:9000,contextWindow:10000,buffer:1000}) === true (9000 >= 10000-1000)
RED: test_should_compact_false_with_headroom() — shouldCompact({estimated:5000,contextWindow:10000,buffer:1000}) === false
RED: test_should_compact_true_over_window() — shouldCompact({estimated:11000,contextWindow:10000,buffer:1000}) === true
RED: test_should_compact_buffer_ge_window_always_true() — shouldCompact({estimated:0,contextWindow:1000,buffer:1000}) === true (threshold 0; 0>=0)
GREEN: implement the two helpers
REFACTOR: Biome complexity ≤ 10
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/compaction.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/compaction.test.ts` reports all tests passed (existing + 6 new)
- [ ] `test_estimate_tokens_empty_is_zero` passes (D1 edge)
- [ ] `test_should_compact_true_at_threshold` + `test_should_compact_false_with_headroom` pass (D2 threshold)
- [ ] `test_should_compact_buffer_ge_window_always_true` passes (D2 degenerate)
- [ ] `pnpm --filter @theokit/sdk exec biome check packages/sdk/src/compaction.ts` reports 0 errors

#### DoD
- [ ] those tests green; `pnpm --filter @theokit/sdk typecheck` exits 0

---

## Phase 2: Document + wire-test

### T2.1 — Subpath import test + docs + changeset + CHANGELOG

#### Objective
Assert the two symbols are importable from the subpath; document; changeset + CHANGELOG (root + package).

#### Why this step (action + reasoning)
1. **What** — extend `compaction-wiring.test.ts` to import the 2 new symbols; add docs.md note + changeset + both CHANGELOG entries.
2. **Why now** — the subpath surface must be proven reachable (per `no-stubs-no-mocks-no-wired.md`); docs.md reflects the public-surface addition.

#### Evidence
`compaction-wiring.test.ts` (import-assertion pattern); docs.md compaction section; M2-1 changeset precedent.

#### Files to edit
```
packages/sdk/tests/compaction-wiring.test.ts — add estimateTokens + shouldCompact to the import + typeof asserts
docs.md — note the 2 pre-call helpers in the compaction section
CHANGELOG.md (root) + packages/sdk/CHANGELOG.md — [Unreleased] § Added
.changeset/m2-token-estimate.md — NEW minor changeset (@theokit/sdk)
```

#### Deep file dependency analysis
- `compaction-wiring.test.ts` imports from `../src/compaction.js` (source during test). Doc-only otherwise.

#### TDD
```
RED: extend the wiring test — import { estimateTokens, shouldCompact } from "../src/compaction.js"; expect both typeof "function"
GREEN: add the symbols (already added in T1.1) + docs + changeset + CHANGELOG
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/compaction-wiring.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/compaction-wiring.test.ts` reports all tests passed
- [ ] `grep -c "estimateTokens\|shouldCompact" docs.md` returns ≥ 1 AND `ls .changeset/m2-token-estimate.md` exists AND `grep -c "estimateTokens\|shouldCompact" CHANGELOG.md` ≥ 1
- [ ] `pnpm --filter @theokit/sdk exec biome check` clean on changed files

#### DoD
- [ ] tests green; typecheck exit 0; `pnpm --filter @theokit/sdk build` succeeds; docs/changeset/CHANGELOG present

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | No token estimate (M2-2) | T1.1 | `estimateTokens` chars/4 (D1) |
| 2 | No pre-call compaction decision | T1.1 | `shouldCompact` threshold (D2) |
| 3 | No tokenizer dep | T1.1 | pure arithmetic (D1/Rule 9) |
| 4 | decoupled from per-model catalog | T1.1 | `contextWindow` is a param (D2) |
| 5 | empty/degenerate inputs defined | T1.1 | `""`→0; buffer≥window→true (D1/D2) |
| 6 | lives in compaction subpath | T1.1 | added to `compaction.ts` (D3) |
| 7 | zero new deps | T1.1 | arithmetic only |
| 8 | Document + record + wire-test | T2.1 | subpath import test + docs + changeset + CHANGELOG |

**Coverage: 8/8 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/sdk exec vitest run tests/compaction.test.ts tests/compaction-wiring.test.ts` green
- [ ] Zero type errors — `pnpm --filter @theokit/sdk typecheck`
- [ ] Zero lint warnings — `pnpm --filter @theokit/sdk exec biome check`
- [ ] Dead-code gate — `pnpm quality:dead` (knip) exits 0
- [ ] Build clean — `pnpm --filter @theokit/sdk build` (the `./compaction` subpath dts emitted)
- [ ] File-size budget respected (`compaction.ts` ≤ 400)
- [ ] CHANGELOG.md updated under `[Unreleased]` + changeset added (Unbreakable Rule 6)
- [ ] `docs.md` reflects the 2 pre-call helpers
- [ ] Plan-specific: chars/4 estimate; threshold `estimated >= contextWindow - buffer`; empty/degenerate defined; decoupled via the param; zero new deps
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merge

## Dependencies

M2-2 introduces ZERO new dependencies — pure arithmetic (Rule 9 / KISS); no tokenizer.

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (none beyond the package itself) | — | — | pure functions in `@theokit/sdk` |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | A tokenizer lib (`tiktoken`/`gpt-tokenizer`) was considered + rejected: a pre-call "should I compact?" gate needs a cheap chars/4 estimate, not exact per-model tokenization. | n/a |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Failure scenarios

Both helpers are pure (no I/O) and total (defined for every numeric/string input) — they cannot throw. `estimateTokens` of a huge string returns a large number (no overflow concern at JS number range for realistic text); `shouldCompact` returns a defined boolean for any numbers.

## Final Phase: Integration Validation (MANDATORY)

### Execution
```
pnpm --filter @theokit/sdk exec vitest run tests/compaction.test.ts tests/compaction-wiring.test.ts
pnpm --filter @theokit/sdk exec vitest run        # full sdk suite — no regression
pnpm --filter @theokit/sdk typecheck
pnpm --filter @theokit/sdk exec biome check
pnpm quality:dead
pnpm --filter @theokit/sdk build
```

### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/compaction.test.ts tests/compaction-wiring.test.ts` reports 0 failed
- [ ] `pnpm --filter @theokit/sdk exec vitest run` exits 0 with 0 failed tests (full suite, no regression)
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0 and `pnpm --filter @theokit/sdk exec biome check` reports 0 warnings
- [ ] `pnpm quality:dead` exits 0
- [ ] `pnpm --filter @theokit/sdk build` succeeds (the `./compaction` subpath dts emitted)
- [ ] Runtime-metric proof — N/A (pure functions; observable via the returned estimate/boolean)

### If Validation Fails
1. Identify plan-caused vs pre-existing failures. 2. Fix all plan-caused. 3. Re-run. 4. Log pre-existing in the PR.
