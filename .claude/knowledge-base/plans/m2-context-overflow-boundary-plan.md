---
slug: m2-context-overflow-boundary
created_at: 2026-06-21
goal: Fix registerLoopError to prefer cause.metadata?.code so the canonical context_too_long code (not the provider-prefixed anthropic_context_too_long) reaches RunResult.error.code, measured by tests/internal/agent-loop/loop-error-code.test.ts passing green.
---

# Plan: M2-3 — `context_too_long` reaches the boundary

> **Version 1.1** (edge-case-plan absorbed: EC-1 openai-compatible contract case folded into T1.1 TDD) — Fix the code-at-boundary bug in `registerLoopError` (`packages/sdk/src/internal/agent-loop/loop-llm-stream.ts:137-149`): it derives the loop error code from `cause.code` ONLY, but the provider error mappers build the typed error with a PROVIDER-PREFIXED top-level code (`anthropic_context_too_long` / `${providerId}_context_too_long`) and the CANONICAL code on `metadata.code` (`context_too_long`). So `RunResult.error.code` surfaces the prefixed `anthropic_context_too_long` instead of the canonical `context_too_long`, and a consumer checking `result.error.code === "context_too_long"` misses it. Fix: prefer `cause.metadata?.code` over `cause.code` (the roadmap's exact prescription). Add a contract test proving a 400 context-overflow (via the real `mapAnthropicError`) surfaces the canonical `context_too_long` at the loop boundary. Closes roadmap gap M2-3 (Tema B) — the last M2 item.

## Goal

> "Make `registerLoopError` prefer `cause.metadata?.code` so the canonical `context_too_long` (not `anthropic_context_too_long`) reaches `RunResult.error.code` — measured by `tests/internal/agent-loop/loop-error-code.test.ts` passing green."

## Context

Roadmap gap M2-3 (`docs/gap-audit/ROADMAP.md:110`, med sev, size M, dep M1-5 ✅). The error mappers (`anthropic.ts:60-64`, `openai-compatible.ts:57`) build a 400 context-overflow as `new ConfigurationError(msg, { code: \`${provider}_${code}\`, metadata })` — top-level `.code` = `anthropic_context_too_long` (PREFIXED), `metadata.code` = `context_too_long` (CANONICAL, via `buildErrorMetadata({code})`). `TheokitAgentError` stores both (`errors.ts:146,162`). `registerLoopError` (`loop-llm-stream.ts:146-148`) reads `(cause).code` ONLY → `ctx.error.code = "anthropic_context_too_long"` → copied to `errorDetail.code` (`real-local-run.ts:386`) → `RunResult.error.code = "anthropic_context_too_long"`. A consumer reading `result.error.code === "context_too_long"` (or M2-1's `isContextOverflowError` on the plain `RunErrorDetail`, which is not a `TheokitAgentError`) MISSES it. `isContextOverflowError` already checks BOTH `err.code` and `err.metadata?.code`, so the THROWN error works; the BOUNDARY object (`RunResult.error`) carries only the prefixed code. The roadmap fix: "Prefer `cause.metadata?.code`". This is a BUG FIX (regression test first). The dedicated SDKMessage `{type:"error"}` stream event remains a Phase-2 item (already marked so in `real-local-run.ts:399`), out of M2-3 scope. Respects `rules/architecture.md` + `rules/no-stubs-no-mocks-no-wired.md`. Zero new deps.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/src/internal/agent-loop/loop-llm-stream.ts` | ~155 | — | `registerLoopError` (set-once loop error capture) | keep set-once (first error wins); keep message derivation; only change code derivation |
| `packages/sdk/tests/internal/agent-loop/loop-error-code.test.ts` (NEW) | 0 | — | unit + contract tests — RED first | — |
| `packages/sdk/CHANGELOG.md` + `CHANGELOG.md` (root) + `.changeset/` (NEW) | — | — | changelogs + changeset | additive Fixed entry |

### Current callers / dependents

- **`registerLoopError`** (`@internal`, exported for tests) — called from the loop's LLM-stream catch (`loop-llm-stream.ts:125`). It sets `ctx.error` (`{message, code?, cause}`), which becomes `output.error` (`loop.ts:129`) → `errorDetail` (`real-local-run.ts:382-388`) → `RunResult.error`. The fix changes only the `code` value (canonical instead of prefixed); the shape is unchanged.
- **Provider mappers** (`anthropic.ts`/`openai-compatible.ts`/…) — read-only; they already set `metadata.code` to the canonical code. The fix consumes that.
- **`isContextOverflowError`** (M2-1, `compaction.ts`) — already checks both code paths on a `TheokitAgentError`; this fix makes the canonical code also reach the plain `RunErrorDetail.code` at the boundary.

### Domain glossary

- **canonical code** — the clean `ErrorCode` (`context_too_long`) on `metadata.code`, provider-independent.
- **prefixed code** — the provider-namespaced top-level `.code` (`anthropic_context_too_long`) the mappers set for telemetry/disambiguation.
- **boundary** — `RunResult.error` (a plain `RunErrorDetail` object), what a consumer reads after a run.

### Architecture boundaries affected

`registerLoopError` is pure-ish internal loop logic (no I/O). The fix is a one-function change in code derivation. No DIP boundary crossed; no public type change (`RunErrorDetail.code` already exists).

## Prior Art & Related Work

- **In-repo** the provider mappers (`anthropic.ts`/`openai-compatible.ts`) that set `metadata.code` canonically; `errors.ts` (`TheokitAgentError.code`/`.metadata`); M2-1's `isContextOverflowError` (the consumer-facing detector that motivated the canonical-code contract); the boundary copy in `real-local-run.ts:382-388`.
- (none external — internal bug fix; `cycle-discover` not applicable.)

## Objective

- [ ] `registerLoopError` derives the loop error code preferring `cause.metadata?.code` over `cause.code`.
- [ ] For a 400 context-overflow (via the real `mapAnthropicError`), `ctx.error.code === "context_too_long"` (canonical), not `anthropic_context_too_long`.
- [ ] When there is no `metadata.code`, the top-level `cause.code` is still used (no regression); neither → no code (message+cause only).
- [ ] Set-once invariant preserved (first error wins); message derivation unchanged.
- [ ] Zero new deps; changeset + CHANGELOG (root + package).
- [ ] `tests/internal/agent-loop/loop-error-code.test.ts` green; typecheck + Biome clean; build emits dist.

## ADRs

### D1 — Prefer `cause.metadata?.code` over `cause.code` for the loop error code
**Decision:** `code = (string metadata.code) ?? (string cause.code) ?? undefined`. The canonical `metadata.code` wins; the prefixed top-level `.code` is the fallback.
**Rationale:** the roadmap's exact prescription; the mappers put the CANONICAL `ErrorCode` on `metadata.code` and a PROVIDER-PREFIXED string on top-level `.code` — the boundary should report the canonical one so `result.error.code === "context_too_long"` and `isContextOverflowError` work for every provider.
**Alternatives considered:** strip the provider prefix from `.code` (rejected — brittle string surgery; `metadata.code` already holds the clean value); fix each mapper to set `.code` canonically (rejected — the prefix is intentional for telemetry/disambiguation; one consumer-side fix covers all mappers — Rule 9).

### D2 — Preserve the set-once invariant + message derivation
**Decision:** keep `if (ctx.error !== undefined) return` (first error wins) and the existing `message` derivation; only the `code` line changes.
**Rationale:** the set-once invariant (ADR D3/EC-3-A) is load-bearing; the fix must be surgical.
**Alternatives considered:** none — narrowing the change is the whole point.

### D3 — The dedicated stream `{type:"error"}` event is out of scope (Phase 2)
**Decision:** M2-3 fixes the code-at-boundary (`RunResult.error.code`); it does NOT add a new `SDKMessage` `{type:"error"}` stream-event variant (already deferred in `real-local-run.ts:399`).
**Rationale:** the consumer-facing boundary (`RunResult.error.code` + `isContextOverflowError` on a thrown error) is what M2-3's bug is about; adding a new public discriminated-union variant is a larger, separate change touching every `SDKMessage` consumer. `RunErrorDetail.code` already exists — the gap was the code VALUE, now fixed.
**Alternatives considered:** add `SDKErrorMessage` now (rejected — out of the med/M scope; a separate Phase-2 item with its own exhaustiveness impact on consumers).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Behavior change: `RunResult.error.code` now reports `context_too_long` instead of `anthropic_context_too_long` | Medium | this IS the fix (the canonical code is the documented contract); the provider-prefixed form remains on the thrown `TheokitAgentError.code` + `metadata` for telemetry; changeset documents the boundary-code change | SDK |
| A consumer relying on the prefixed boundary code | Low | unlikely (the prefixed form was the bug); the canonical code is the intended `ErrorCode` contract; documented | SDK |
| The `{type:"error"}` stream event still absent | Low | out of scope (D3); the boundary + `isContextOverflowError` cover detection; Phase-2 item tracked in-code | SDK |

## Unresolved Questions

- (none — every decision is resolved at plan time: prefer `metadata.code`, preserve set-once, defer the stream event. The dedicated `{type:"error"}` SDKMessage variant is explicitly deferred to Phase 2 — YAGNI for the boundary-code fix.)

## Dependency Graph

```
Phase 1 (registerLoopError prefer metadata.code + unit/contract tests) ──▶ Phase 2 (changeset + CHANGELOG) ──▶ Final Phase (integration validation)
```

---

## Phase 1: Fix the code-at-boundary (bug fix — regression test first)

### T1.1 — `registerLoopError` prefers `metadata.code` + tests

#### Objective
Derive the loop error code preferring the canonical `cause.metadata?.code`.

#### Why this step (action + reasoning)
1. **What** — change the `code` derivation in `registerLoopError` to read `metadata.code` first, then top-level `code`.
2. **Why now** — this IS the bug; a regression test feeding the REAL `mapAnthropicError` (400 context body) must show the canonical code surfacing (RED before, GREEN after).

#### Evidence
`loop-llm-stream.ts:146-148` (the `cause.code`-only derivation). `anthropic.ts:60-64` + `openai-compatible.ts:57` (prefixed `.code`, canonical `metadata.code`). `errors.ts:146,162` (both fields stored). `buildErrorMetadata` (`shared.ts:62`) sets the canonical `metadata.code`.

#### Files to edit
```
packages/sdk/src/internal/agent-loop/loop-llm-stream.ts — prefer cause.metadata?.code in registerLoopError
packages/sdk/tests/internal/agent-loop/loop-error-code.test.ts — RED tests first (unit + 400-contract)
```

#### Deep file dependency analysis
- `registerLoopError` is exported `@internal`; the test imports it + `mapAnthropicError` + a `LoopContext` stub. Single-function change; no other file edited.

#### Pseudo-code / Signatures
```pseudocode
// in registerLoopError, replace the code derivation:
const meta = (cause as { metadata?: { code?: unknown } } | null | undefined)?.metadata;
const metaCode = typeof meta?.code === "string" ? meta.code : undefined;
const rawCode = (cause as { code?: unknown } | null | undefined)?.code;
const directCode = typeof rawCode === "string" ? rawCode : undefined;
const code = metaCode ?? directCode;   // prefer canonical metadata.code
ctx.error = code !== undefined ? { message, code, cause } : { message, cause };
```

#### TDD
```
RED: test_prefers_metadata_code_over_prefixed_top_level() — registerLoopError(ctx, error with code="anthropic_context_too_long" + metadata.code="context_too_long") → ctx.error.code === "context_too_long"
RED: test_400_context_overflow_surfaces_canonical_code() — CONTRACT: registerLoopError(ctx, mapAnthropicError({status:400, body:{error:{message:"prompt is too long: 250000 tokens > context length"}}, headers:{}, endpoint:"..."})) → ctx.error.code === "context_too_long" (the real mapper → loop boundary)
RED: test_falls_back_to_top_level_code_when_no_metadata() — error with code="budget", no metadata → ctx.error.code === "budget"
RED: test_no_code_when_neither_present() — plain Error("boom") → ctx.error.code === undefined (ctx.error = {message,cause})
RED: test_400_context_overflow_openai_compatible_surfaces_canonical() — registerLoopError(ctx, mapOpenAiCompatibleError(400 context body)) → ctx.error.code === "context_too_long" (provider-agnostic, edge EC-1)
RED: test_non_string_metadata_code_falls_back() — metadata.code = 123 (non-string), top-level code="x" → ctx.error.code === "x"
RED: test_set_once_first_error_wins() — register twice → ctx.error stays the first (invariant preserved)
GREEN: apply the metadata-code-preferring derivation
REFACTOR: Biome complexity ≤ 10
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/internal/agent-loop/loop-error-code.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/internal/agent-loop/loop-error-code.test.ts` reports 7/7 tests passed
- [ ] `test_400_context_overflow_surfaces_canonical_code` passes (the contract test, D1)
- [ ] `test_prefers_metadata_code_over_prefixed_top_level` passes (the headline fix)
- [ ] `test_falls_back_to_top_level_code_when_no_metadata` + `test_set_once_first_error_wins` pass (no regression)
- [ ] `pnpm --filter @theokit/sdk exec biome check src/internal/agent-loop/loop-llm-stream.ts` reports 0 errors

#### DoD
- [ ] those tests green; `pnpm --filter @theokit/sdk typecheck` exits 0

---

## Phase 2: Record the change

### T2.1 — Changeset + CHANGELOG (root + package)

#### Objective
Document the boundary-code fix + the behavior change (canonical instead of prefixed).

#### Why this step (action + reasoning)
1. **What** — changeset + root CHANGELOG `[Unreleased] § Fixed` + package CHANGELOG entry.
2. **Why now** — Unbreakable Rule 6; the `RunResult.error.code` value change must be visible to consumers.

#### Evidence
`packages/sdk/CHANGELOG.md` + root `CHANGELOG.md` `[Unreleased]`; the M2-2/M2-4 changeset precedent.

#### Files to edit
```
.changeset/m2-context-overflow-boundary.md — NEW (@theokit/sdk: patch — a bug fix; boundary-code value change)
CHANGELOG.md (root) — [Unreleased] § Fixed entry
packages/sdk/CHANGELOG.md — [Unreleased] § Fixed entry
```

#### Deep file dependency analysis
- Documentation-only; no code dependency. Changeset is `patch` (a bug fix that corrects the surfaced code value; no API shape change).

#### TDD
```
(doc-only — verified by oracle greps)
GREEN: add changeset + both CHANGELOG entries
VERIFY: ls .changeset/m2-context-overflow-boundary.md && grep -c "context_too_long\|metadata" CHANGELOG.md packages/sdk/CHANGELOG.md
```

#### Acceptance Criteria
- [ ] `ls .changeset/m2-context-overflow-boundary.md` exists
- [ ] `grep -c "context_too_long" CHANGELOG.md` ≥ 1 (root § Fixed)
- [ ] `grep -c "context_too_long" packages/sdk/CHANGELOG.md` ≥ 1

#### DoD
- [ ] changeset + both CHANGELOG entries present; `pnpm --filter @theokit/sdk build` succeeds

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | context_too_long lost at boundary (M2-3) | T1.1 | prefer `metadata.code` in registerLoopError (D1) |
| 2 | canonical code surfaces (not prefixed) | T1.1 | `metadata.code` wins (D1) |
| 3 | top-level code fallback preserved | T1.1 | `metaCode ?? directCode` (D1) |
| 4 | set-once invariant preserved | T1.1 | unchanged guard (D2) |
| 5 | 400→context_too_long contract test | T1.1 | real `mapAnthropicError` → registerLoopError test (D1) |
| 6 | stream `{type:"error"}` event | — | DEFERRED Phase 2 (D3) |
| 7 | zero new deps | T1.1 | pure edit (Rule 9) |
| 8 | Document the boundary-code change | T2.1 | changeset + root + package CHANGELOG |

**Coverage: 7/8 gaps resolved + 1 explicitly deferred (the stream event, D3) = 100% of in-scope.**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/sdk exec vitest run` green
- [ ] Zero type errors — `pnpm --filter @theokit/sdk typecheck`
- [ ] Zero lint warnings — `pnpm --filter @theokit/sdk exec biome check`
- [ ] Dead-code gate — `pnpm quality:dead` (knip) exits 0
- [ ] Build clean — `pnpm --filter @theokit/sdk build`
- [ ] File-size budget respected (`loop-llm-stream.ts` ≤ 400)
- [ ] CHANGELOG.md updated under `[Unreleased]` + changeset added (Unbreakable Rule 6)
- [ ] Plan-specific: canonical `context_too_long` surfaces at the boundary for a 400 overflow; top-level fallback preserved; set-once intact; the stream `{type:"error"}` event explicitly deferred; zero new deps
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merge

## Dependencies

M2-3 introduces ZERO new dependencies — a one-function code-derivation fix (Rule 9 / KISS).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (none beyond the package itself) | — | — | internal loop fix in `@theokit/sdk`; the test uses the existing `mapAnthropicError` |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | A one-line derivation change needs no library. | n/a |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Failure scenarios

`registerLoopError` remains synchronous, non-throwing, and set-once. The fix only changes which string the `code` field takes (canonical vs prefixed). A `cause` with no `metadata` and no `code` still produces `{message, cause}` (no code) — unchanged. No new runtime failure mode.

## Final Phase: Integration Validation (MANDATORY)

### Execution
```
pnpm --filter @theokit/sdk exec vitest run tests/internal/agent-loop/loop-error-code.test.ts
pnpm --filter @theokit/sdk exec vitest run        # full sdk suite — no regression
pnpm --filter @theokit/sdk typecheck
pnpm --filter @theokit/sdk exec biome check
pnpm quality:dead
pnpm --filter @theokit/sdk build
```

### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/internal/agent-loop/loop-error-code.test.ts` reports 7 tests passed (0 failed)
- [ ] `pnpm --filter @theokit/sdk exec vitest run` exits 0 with 0 failed tests (full suite, no regression — incl. any existing loop/error tests)
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0 and `pnpm --filter @theokit/sdk exec biome check` reports 0 warnings
- [ ] `pnpm quality:dead` exits 0
- [ ] `pnpm --filter @theokit/sdk build` succeeds (dist emitted)
- [ ] Runtime-metric proof — N/A (pure error-derivation fix; observable via `RunResult.error.code === "context_too_long"`)

### If Validation Fails
1. Identify plan-caused vs pre-existing failures. 2. Fix all plan-caused. 3. Re-run. 4. Log pre-existing in the PR.
