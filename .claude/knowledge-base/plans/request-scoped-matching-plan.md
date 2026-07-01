# Plan: Request-Scoped Tool-Name Matching for Leaked-Dialect Recovery (R5)

> **Version 1.1** (2026-07-01 — absorbed 1 MUST-FIX + 2 SHOULD-TEST from `.claude/knowledge-base/reviews/request-scoped-matching-edge-cases-plan-2026-07-01.md`: EC-5 residual-strip must preserve gated-out block text; EC-1 gate uses the same trimmed name; EC-2 empty-tools test also asserts the leak stays visible) — Add an optional exact-name allowlist gate to the SDK's leaked-dialect recovery so `OpenAIStreamAccumulator.finish()` only promotes a leaked `<function=NAME>` block when `NAME` is a real tool in the current request's tool set. This replaces the blunt per-route `extractToolCallsFromContent` flag AS THE FALSE-POSITIVE GUARD (the flag stays as the coarse route-enable), fixing the documented "a code assistant printing a literal `<function=` in a fenced code block gets wrongly promoted" concern. Grounded in the `request-scoped-matching` blueprint (SHIPPABLE_WITH_CAVEATS 89.0).

## Goal

> "Enable the SDK's leaked-dialect recovery to reject a leaked `<function=NAME>` block whose `NAME` is not a tool in the current request, measured by the new golden test `test_flag_on_leaked_name_not_in_request_tools_is_not_recovered` asserting `finish.toolCalls` has length 0."

## Context

R5 = recommendation #5 (the decision to add request-scoped matching) of the shipped `.claude/knowledge-base/discoveries/blueprints/tool-calling-robustness-blueprint.md`. Today `extractHermesToolCalls(content, makeId)` (`packages/sdk/src/internal/llm/hermes-tool-extract.ts:56`) recovers ANY `<function=NAME>` block, gated only by the per-route boolean `ProviderProfile.extractToolCallsFromContent` at the recovery site `packages/sdk/src/internal/llm/openai.ts:301`. A code assistant printing a literal `<function=foo>` in a fenced code block on a leaky route (e.g. qwen3-coder) is wrongly promoted to a tool call. The `request-scoped-matching` blueprint locked the fix: openclaw's `@openclaw/tool-call-repair` gates promotion on an OPTIONAL `allowedToolNames` allowlist (`.claude/knowledge-base/references/openclaw/packages/tool-call-repair/src/payload.ts:187-190`) — exact-name `Set.has(name)`, `null` on miss, zero deps. The request's tools are already in scope at the recovery-construction site: `openai.ts:172` builds the accumulator inside `stream(request)` and `request.tools` (`LlmRequest.tools?: LlmTool[]`, each with `name: string`) is read at `openai.ts:370`.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/src/internal/llm/hermes-tool-extract.ts` | 88 | `e357214` (2026-07-01) | Pure recovery of leaked Hermes `<function=NAME>` blocks; reuses `sanitizeToolInput` | `extractHermesToolCalls(content, makeId)` 2-arg call MUST keep working (recover-all when no allowlist) — the existing unit tests call it with 2 args |
| `packages/sdk/src/internal/llm/openai.ts` | 502 | `958a81f` (2026-06-30) | OpenAI-compat client + `OpenAIStreamAccumulator` (finish() runs the opt-in recovery at `:301-317`) | The `extractToolCallsFromContent` route flag + the `toolCalls.length === 0` guard MUST stay; the stderr observability line MUST stay |
| `packages/sdk/tests/internal/llm/hermes-tool-extract.test.ts` | 167 | `e357214` (2026-07-01) | Unit tests for `extractHermesToolCalls` | Existing 2-arg cases stay green (back-compat) |
| `packages/sdk/tests/golden/llm/openai-leaked-dialect-safe-parse.golden.test.ts` | 139 | (per-route opt-in) | End-to-end SSE → accumulator → finish() recovery | Flag-OFF bug-state test stays; flag-ON tests updated to declare the leaked tool in `REQUEST.tools` |

Every file in any `#### Files to edit` block appears here.

### Current callers / dependents

- **Symbol:** `extractHermesToolCalls(content, makeId)` in `packages/sdk/src/internal/llm/hermes-tool-extract.ts:56`
- **Callers (production):** `packages/sdk/src/internal/llm/openai.ts:302` (inside `OpenAIStreamAccumulator.finish()`)
- **Callers (tests):** `packages/sdk/tests/internal/llm/hermes-tool-extract.test.ts`
- **External (public API consumed by other repos):** no — `extractHermesToolCalls` is `@internal`; `hermes-tool-extract.ts:13` states "OPT-IN only". No new public export; `extractToolCallsFromContent` is an internal `ProviderProfile` field.
- **Symbol:** `OpenAIStreamAccumulator` (class) in `packages/sdk/src/internal/llm/openai.ts:205` — constructed only at `openai.ts:172` inside `stream()`.

### Domain glossary

- **Leaked dialect** — a model emitting a tool call as literal text (`<function=NAME><parameter=KEY>VALUE</parameter></function>`) instead of native structured `tool_calls`.
- **Recovery** — parsing that leaked text back into a real `LlmToolCallPart` so the agent loop can dispatch it (`extractHermesToolCalls`).
- **Request-scoped / allowlist gate** — only recover a leaked block whose tool name is in the current request's declared tool set (`request.tools`).
- **`extractToolCallsFromContent`** — the per-provider-route boolean (`ProviderProfile`) that enables recovery for a route known to leak.

### Architecture boundaries affected

`rules/architecture.md` DIP: the recovery module (`hermes-tool-extract.ts`, infra/llm) stays PURE — it receives the allowlist as data, it does NOT reach into request/transport. The caller (`openai.ts` client) derives the allowlist from `request.tools` and injects it downward (infra ← request data). No new cross-layer import. No new public contract (`docs.md` unchanged — recovery is internal + automatic).

## Prior Art & Related Work

- **Internal blueprint** — `.claude/knowledge-base/discoveries/blueprints/request-scoped-matching-blueprint.md §"Coverage Corner 4 — Techniques"` (the optional exact-name Set gate + keep-the-route-flag decision).
- **Reference project** — openclaw `@openclaw/tool-call-repair`: the non-streaming gate `const allowedToolNames = options?.allowedToolNames ? new Set(...) : undefined; if (allowedToolNames && !allowedToolNames.has(opening.name)) return null;` (`.claude/knowledge-base/references/openclaw/packages/tool-call-repair/src/payload.ts:187-190`); the false-positive test `allowedToolNames:["read"]` on a `write` leak → `toBeNull()` (`.claude/knowledge-base/references/openclaw/src/plugin-sdk/tool-payload.test.ts:243-251`); zero-deps `Set` (`.claude/knowledge-base/references/openclaw/packages/tool-call-repair/package.json`).
- **Umbrella blueprint** — `.claude/knowledge-base/discoveries/blueprints/tool-calling-robustness-blueprint.md §"Recommendations"` (item 5).
- No `*-patterns` skill exists for this topic (none in `skills/*-patterns/`).

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (none new) | — | npm | R5 uses only the platform `Set<string>` — no library. Reuses the already-present `sanitizeToolInput` (`hermes-tool-extract.ts:34`) unchanged. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | The request-scoped gate is exact `Set.has(name)` — a spec-adjacent one-liner the platform provides (openclaw ships the same with zero deps, `tool-call-repair/package.json`). Adding a dep would violate parsimony (Rule 9 / KISS). | — |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | — | — |

## Objective

- [ ] `extractHermesToolCalls` accepts an optional `allowedToolNames?: ReadonlySet<string>`; when present, a recovered block whose name is NOT in the set is dropped; when absent (undefined), recover-all (back-compat) is preserved.
- [ ] `OpenAIStreamAccumulator` builds `new Set(request.tools?.map(t => t.name) ?? [])` at `stream()` and threads it to `finish()`'s recovery — so an empty tool set recovers nothing.
- [ ] The `extractToolCallsFromContent` route flag remains the coarse enable; the allowlist is the within-route correctness gate (both orthogonal).
- [ ] Regression tests: name-in-set → recovered; name-not-in-set → NOT recovered; empty-tools → NOT recovered; absent-allowlist (2-arg call) → recover-all.

## ADRs

### D1 — Optional exact-name `ReadonlySet<string>` gate on `extractHermesToolCalls`

**Decision:** add a 3rd optional parameter `allowedToolNames?: ReadonlySet<string>`. When defined, drop any recovered block whose `name` is not in the set (exact, case-sensitive). When `undefined`, recover every block (current behavior).

**Rationale:** mirrors openclaw's proven gate 1:1 (`payload.ts:190`); `ReadonlySet` gives O(1) exact membership with zero deps (`rules/parsimony-ladder` Rung 2/4, Unbreakable Rule 9); `undefined → recover-all` keeps the existing 2-arg unit-test callers green (back-compat, `rules/architecture.md` — don't break `@internal` callers needlessly).

**Alternatives considered:** (a) `Iterable<string>` param built to a Set inside (openclaw's shape) — rejected, the caller already holds a natural place to build the Set once (`stream()`), and a ready `ReadonlySet` keeps the pure fn allocation-free; (b) prefix matching — rejected, prefix is a streaming-buffer concern (blueprint Q2), our `finish()` is non-streaming; (c) case-insensitive — rejected, openclaw's name gate is case-sensitive and our tool-name regex is case-significant.

**Consequences:** one optional arg; the pure module stays total and dependency-free; existing 2-arg tests unaffected.

### D2 — Build the allowlist Set once in `stream()`, thread through the accumulator (empty set = recover nothing)

**Decision:** `OpenAIStreamAccumulator` gains a `readonly #allowedToolNames: ReadonlySet<string>` field set at construction (`stream()` passes `new Set(request.tools?.map(t => t.name) ?? [])`); `finish()` passes it to `extractHermesToolCalls`. A request with zero tools yields an empty set → recovers nothing.

**Rationale:** the injection seam already exists (`openai.ts:172` builds the accumulator inside `stream(request)`); mirrors openclaw's caller-builds-the-Set pattern (`provider-stream-shared.ts:91`). Empty-set-recovers-nothing is the safe default (a request declaring no tools has nothing legitimate to recover) — blueprint D2 consequence.

**Alternatives considered:** pass `request.tools` array and build the Set in `finish()` — rejected, needless per-finish allocation and leaks request shape into the pure module; make no-tools fall back to recover-all — rejected, re-introduces the false-positive for tool-less requests.

**Consequences:** the accumulator ALWAYS passes a Set (never undefined) on the production path; the `undefined → recover-all` branch of D1 is exercised only by direct unit-test callers.

### D3 — Keep `extractToolCallsFromContent` route flag as the coarse enable; allowlist is the within-route gate

**Decision:** request-scoped matching COMPLEMENTS, does not delete, the route flag. The flag gates whether recovery is attempted at all (per-route); the allowlist gates what is accepted (per-request).

**Rationale:** the flag is per-route metadata (most routes never leak → zero recovery cost); the allowlist is per-request correctness. Two cheap orthogonal gates (blueprint D2). "Replace the blunt flag" (blueprint rec #5) means replace it AS THE FALSE-POSITIVE GUARD — its role narrows to route-enablement.

**Alternatives considered:** drop the flag, recover always gated only by the allowlist — rejected, non-leaky routes would pay a per-finish tool-set build for no benefit and widen the recovery surface across all providers.

**Consequences:** the flag-OFF test (bug state preserved) stays valid; flag-ON tests now also require the leaked name to be a declared tool.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Existing flag-ON golden tests feed a leaked `shell_exec` while `REQUEST` declares no tools → they would now recover nothing and break | Medium | T2.1 updates `REQUEST` to declare `tools:[{name:"shell_exec", …}]` (semantically correct — a real tool leaked); the full suite is the gate | plan |
| A genuinely leaked call for a tool that the model KNOWS but the request under-declared would be dropped | Low | This is the intended safety trade-off; the model should only call declared tools; documented in CHANGELOG | plan |
| `openai.ts` is already 502 LoC (over the 500 soft budget) | Low | The change is ~6 lines (1 field + 1 ctor arg + 1 Set build + thread); no new function; note the pre-existing overage, do not expand further | plan |

## Unresolved Questions

- Q1 — Should tool-name matching be trimmed/normalized before membership? Resolved at plan time: NO — openclaw matches raw exact (`payload.ts:190`); our tool names come from `request.tools[].name` (already validated by the custom-tool regex) and the leaked name is parsed verbatim; a mismatch means a genuinely different name. (none further — every decision is resolved at plan time)

## Dependency Graph

```
Phase 1 ──▶ T1.1 (pure gate) ──▶ T2.1 (wire + integration) ──▶ Phase 2 (Integration Validation)
```

T2.1 depends on T1.1 (the gate must exist before it can be threaded). Sequential.

---

## Phase 1: Request-scoped gate

**Objective:** add the optional exact-name allowlist to the pure recovery, then thread the request's tool-name Set through the accumulator.

### T1.1 — Add `allowedToolNames` exact-name gate to `extractHermesToolCalls` (pure)

#### Objective
Gate recovered blocks on an optional `ReadonlySet<string>` of allowed tool names; drop blocks whose name is not in the set; absent set → recover-all.

#### Why this step (action + reasoning)

**What this step does** — adds a 3rd optional parameter `allowedToolNames?: ReadonlySet<string>` to `extractHermesToolCalls` and, for each parsed `<function=NAME>` block, keeps it only when the set is `undefined` OR `allowedToolNames.has(name)`.

**Why it is necessary now** — this is the load-bearing false-positive guard (blueprint §"Techniques", ADR D1). Doing it in the pure module FIRST (before wiring) means it is fully unit-testable in isolation with no transport, honoring `rules/architecture.md` DIP; the wiring (T2.1) then just supplies the set.

#### Evidence
`hermes-tool-extract.ts:56` current signature `extractHermesToolCalls(content, makeId): HermesExtractResult`; openclaw's analogous gate `payload.ts:187-190` (`!allowedToolNames.has(opening.name) → return null`); false-positive test precedent `tool-payload.test.ts:243-251`.

#### Files to edit
```
packages/sdk/src/internal/llm/hermes-tool-extract.ts — add `allowedToolNames?: ReadonlySet<string>` param; skip blocks whose name is not in the set
packages/sdk/tests/internal/llm/hermes-tool-extract.test.ts — RED tests first (gate cases + back-compat)
```

#### Deep file dependency analysis
- `hermes-tool-extract.ts` (Baseline row 1) — today `extractHermesToolCalls` loops the content and recovers every `<function=NAME>` block. This task adds the name filter inside that loop. Downstream caller `openai.ts:302` (Baseline callers) passes 2 args today; it keeps compiling because the new param is optional (undefined → recover-all) until T2.1 supplies it.
- `hermes-tool-extract.test.ts` — existing 2-arg cases must stay green (they pass `undefined` → recover-all).

#### Deep Dives
- **Signature:** `extractHermesToolCalls(content: string, makeId: () => string, allowedToolNames?: ReadonlySet<string>): HermesExtractResult`.
- **Gate:** the block `name` is ALREADY trimmed today (`hermes-tool-extract.ts:59` `(block[1] ?? "").trim()`; the regex `HERMES_BLOCK` at `:39` captures `[^>\s]+`), so the gate reuses that same `name` variable — no separate trim needed (EC-1). Keep a block iff `allowedToolNames === undefined || allowedToolNames.has(name)`.
- **EC-5 (MUST FIX) — residualText must strip ONLY recovered blocks:** today `:68` does `content.replace(HERMES_BLOCK, "")` which strips EVERY matched block. Pre-R5 that was correct (all matched = all recovered). With the gate, a gated-out block is matched-but-not-recovered; the blanket replace would DELETE its text (silent loss of the model's real output, e.g. a `<function=example>` in a code fence emitted alongside a real recovered call). Fix: replace with a callback that re-applies the SAME gate so only promoted blocks are stripped, gated-out blocks stay visible.
- **Invariant preserved:** the 2-arg call recovers all AND strips all (Baseline invariant, back-compat — the callback's `allowedToolNames === undefined` branch strips every block, identical to today).
- **Edge cases:** empty set → every block dropped, ALL block text stays visible (recover nothing); name with different case → dropped (case-sensitive); absent → recover-all + strip-all (unchanged).

#### Pseudo-code / Signatures
```pseudocode
function extractHermesToolCalls(content, makeId, allowedToolNames?):
  isPromoted(name) = name.length > 0 and (allowedToolNames === undefined or allowedToolNames.has(name))
  for each <function=NAME>…</tool_call> block in content:
    name = trim(NAME)
    if not isPromoted(name): continue          -- drop: do NOT promote
    recover block -> toolCall(name, params)
  # EC-5: strip ONLY promoted blocks; gated-out blocks stay visible
  residualText = toolCalls.empty ? content
               : content.replace(HERMES_BLOCK, (full, rawName) =>
                   isPromoted(trim(rawName)) ? "" : full).trim()
  return { toolCalls, residualText }

# Example — one recovered + one gated-out in the same content
input:  content="<function=write>…</tool_call> see <function=example>…</tool_call>", allowed=Set{"write"}
output: { toolCalls:[{name:"write",…}], residualText:"see <function=example>…</tool_call>" }  # example stays visible
```

#### Tasks
1. Extract a local `isPromoted(name)` predicate: `name.length > 0 && (allowedToolNames === undefined || allowedToolNames.has(name))`.
2. Add the optional `allowedToolNames?: ReadonlySet<string>` parameter to `extractHermesToolCalls`.
3. In the block loop, `continue` when `!isPromoted(name)` (the name is already trimmed at `:59`).
4. **EC-5:** change the residual computation (`:68`) to strip ONLY promoted blocks — `content.replace(HERMES_BLOCK, (full, rawName) => isPromoted((rawName ?? "").trim()) ? "" : full).trim()` — so gated-out blocks stay visible.
5. Update the JSDoc to document the gate, the absent→recover-all semantics, and the case-sensitive matching (EC-3).

#### TDD
```
RED:  test_gate_recovers_block_when_name_in_allowlist() — allowed=Set{"shell_exec"}, one <function=shell_exec> block → toolCalls length 1
RED:  test_gate_drops_block_when_name_not_in_allowlist() — allowed=Set{"read"}, <function=write> block → toolCalls length 0, residual contains "<function=write"
RED:  test_gate_empty_allowlist_recovers_nothing() — allowed=new Set() → toolCalls length 0
RED:  test_absent_allowlist_recovers_all_backcompat() — 2-arg call, <function=write> → toolCalls length 1 (unchanged)
RED:  test_gate_mixed_blocks_keeps_only_allowed() — two blocks (write, read), allowed=Set{"read"} → only read recovered
RED:  test_gate_residual_preserves_gated_out_block_text (EC-5) — content has a recovered <function=write> AND a gated-out <function=example>, allowed=Set{"write"} → toolCalls length 1 (write), residualText STILL contains "<function=example" (not stripped)
RED:  test_gate_uses_same_trimmed_name_for_match_and_call (EC-1) — leaked "<function= write >" (incidental spaces), allowed=Set{"write"} → recovered, toolCalls[0].name === "write" (gate matched the trimmed name that becomes the call name)
GREEN: implement isPromoted + the loop filter + the residual callback
REFACTOR: None expected (one predicate reused in loop + residual)
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/internal/llm/hermes-tool-extract.test.ts
```

#### Concurrency tests

(none — single-threaded)

`extractHermesToolCalls` is a pure function over its arguments; no shared state.

#### Acceptance Criteria
- [ ] All 7 RED tests (incl. `test_gate_residual_preserves_gated_out_block_text`, `test_gate_uses_same_trimmed_name_for_match_and_call`) pass GREEN via `vitest run tests/internal/llm/hermes-tool-extract.test.ts`
- [ ] The pre-existing `hermes-tool-extract.test.ts` 2-arg cases remain green in the same run (back-compat, exit 0)
- [ ] `pnpm --filter @theokit/sdk exec biome check src/internal/llm/hermes-tool-extract.ts` reports 0 diagnostics
- [ ] `wc -l src/internal/llm/hermes-tool-extract.ts` returns ≤ 500 (currently 88 → ~102)
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0

#### DoD
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/internal/llm/hermes-tool-extract.test.ts` exits 0 with all 7 cases green
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0 (zero `tsc` errors)
- [ ] `pnpm --filter @theokit/sdk exec biome check src/internal/llm/hermes-tool-extract.ts` reports 0 diagnostics
- [ ] `wc -l src/internal/llm/hermes-tool-extract.ts` returns < 500 (currently 88 → ~102)
- [ ] `grep -c "request-scoped" CHANGELOG.md` returns ≥ 1 under the `[Unreleased]` section

### T2.1 — Thread the request's tool-name Set through `OpenAIStreamAccumulator` into `finish()`

#### Objective
Build `new Set(request.tools?.map(t => t.name) ?? [])` in `stream()`, store it on the accumulator, and pass it to `extractHermesToolCalls` in `finish()` so recovery is request-scoped end-to-end.

#### Why this step (action + reasoning)

**What this step does** — adds a `readonly #allowedToolNames: ReadonlySet<string>` field to `OpenAIStreamAccumulator` (set via the constructor), builds the Set from `request.tools` at the construction site `stream()` (`openai.ts:172`), and threads it into the `extractHermesToolCalls(...)` call at `openai.ts:302`. Updates the golden test `REQUEST` to declare the leaked tool + adds the gate integration tests.

**Why it is necessary now** — the gate from T1.1 is inert until fed the real request tool set (ADR D2). The construction site already has `request` in scope (Baseline: `openai.ts:172` inside `stream(request)`; `request.tools` read at `:370`), so this is the minimal wiring with no new plumbing.

#### Evidence
`openai.ts:172` `new OpenAIStreamAccumulator(extractFromContent, providerId)` inside `stream(request)`; `openai.ts:301-317` the recovery site; `openai.ts:370` `request.tools` already read; `LlmTool.name: string` (`types.ts:11`); golden `REQUEST` has no `tools` today (`openai-leaked-dialect-safe-parse.golden.test.ts:47-50`) — so flag-ON tests must gain `REQUEST.tools`.

#### Files to edit
```
packages/sdk/src/internal/llm/openai.ts — add #allowedToolNames ctor arg/field; build the Set at stream():172; pass it to extractHermesToolCalls at finish():302
packages/sdk/tests/golden/llm/openai-leaked-dialect-safe-parse.golden.test.ts — RED: update REQUEST to declare tools; add gate tests
```

#### Deep file dependency analysis
- `openai.ts` (Baseline row 2) — `OpenAIStreamAccumulator` constructed only at `:172`. Adding a 3rd constructor arg (`allowedToolNames: ReadonlySet<string>`) touches exactly that one construction site. `finish()` at `:302` passes it as the 3rd arg to `extractHermesToolCalls` (now consumed after T1.1). Invariant preserved: the `extractFromContent && toolCalls.length === 0` guard + stderr line stay.
- Golden test — `REQUEST` (`:47`) gains `tools`; flag-ON assertions unchanged (the recovered name IS now declared); new negative tests added.

#### Deep Dives
- **Field:** `private readonly allowedToolNames: ReadonlySet<string>` (constructor param after `providerId`).
- **Build site:** `openai.ts:172` → `new OpenAIStreamAccumulator(this.options.extractToolCallsFromContent ?? false, providerId, new Set(request.tools?.map((t) => t.name) ?? []))`.
- **Recovery site:** `openai.ts:302` → `extractHermesToolCalls(this.text, makeId, this.allowedToolNames)`.
- **Invariant:** empty request tools → empty Set → no recovery (ADR D2 safe default).
- **Edge cases:** request with tools that don't include the leaked name → not recovered; request with the leaked name → recovered (existing behavior preserved once REQUEST declares it).

#### Tasks
1. Add `allowedToolNames: ReadonlySet<string>` as the 3rd constructor parameter + `readonly` field on `OpenAIStreamAccumulator`.
2. At `stream()` (`:172`), build `new Set(request.tools?.map((t) => t.name) ?? [])` and pass it.
3. At `finish()` (`:302`), pass `this.allowedToolNames` as the 3rd arg to `extractHermesToolCalls`.
4. Update the golden `REQUEST` to declare `tools: [{ name: "shell_exec", description: "...", inputSchema: { type: "object" } }]`.
5. Add negative + edge golden tests.

#### TDD
```
RED:  test_flag_on_leaked_name_in_request_tools_is_recovered() — REQUEST.tools=[shell_exec], leaked <function=shell_exec> → finish.toolCalls length 1 (the updated existing behavior)
RED:  test_flag_on_leaked_name_not_in_request_tools_is_not_recovered() — REQUEST.tools=[other_tool], leaked <function=shell_exec> → finish.toolCalls length 0, text still contains "<function="
RED:  test_flag_on_empty_request_tools_recovers_nothing() — REQUEST.tools=[] (or absent), leaked <function=shell_exec> → finish.toolCalls length 0 AND finish.text still contains "<function=" (EC-2: the leak stays visible for debugging, not silently deleted)
GREEN: implement the Set build + threading
REFACTOR: None expected
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/golden/llm/openai-leaked-dialect-safe-parse.golden.test.ts
```

#### Concurrency tests

(none — single-threaded)

`OpenAIStreamAccumulator` is instantiated per `stream()` call; `#allowedToolNames` is set once at construction and only read in `finish()`. No shared mutable state across concurrent streams.

#### Acceptance Criteria
- [ ] The 3 golden RED tests (incl. `test_flag_on_leaked_name_not_in_request_tools_is_not_recovered`) pass GREEN via `vitest run tests/golden/llm/openai-leaked-dialect-safe-parse.golden.test.ts`
- [ ] The flag-OFF golden test and the updated flag-ON tests all pass in the same run (exit 0)
- [ ] `pnpm --filter @theokit/sdk exec biome check src/internal/llm/openai.ts tests/golden/llm/openai-leaked-dialect-safe-parse.golden.test.ts` reports 0 diagnostics
- [ ] `git diff --stat src/internal/llm/openai.ts` shows ≤ 8 net added lines (no new function)
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0

#### DoD
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/golden/llm/openai-leaked-dialect-safe-parse.golden.test.ts` exits 0
- [ ] `pnpm --filter @theokit/sdk test` exits 0 (full suite — no other test regressed by the request-scoping)
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0 AND `pnpm --filter @theokit/sdk exec biome check src/internal/llm/openai.ts` reports 0 diagnostics
- [ ] `grep -c "request-scoped" CHANGELOG.md` returns ≥ 1 under `[Unreleased]` (behavior change: recovery now request-scoped)

---

## Coverage Matrix

| # | Gap / Requirement (blueprint rec) | Task(s) | Resolution |
|---|---|---|---|
| 1 | rec #1 — optional exact-name Set allowlist on `extractHermesToolCalls`; absent = recover-all | T1.1 | 3rd optional param + loop-level gate + 5 unit tests |
| 2 | rec #2 — build the Set from `request.tools`, thread through the accumulator | T2.1 | Set built at `stream()`, `#allowedToolNames` field, passed in `finish()` |
| 3 | rec #3 — keep `extractToolCallsFromContent` route flag as coarse enable | T2.1 (ADR D3) | flag + `toolCalls.length===0` guard untouched; allowlist is the within-route gate |
| 4 | rec #4 — regression tests (in-set / out-of-set / empty / absent) | T1.1 + T2.1 | 5 unit + 3 golden tests |

**Coverage: 4/4 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] `pnpm --filter @theokit/sdk test` exits 0 (all suites green)
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0 (zero type errors)
- [ ] `pnpm --filter @theokit/sdk exec biome check` reports 0 diagnostics on changed files
- [ ] `wc -l src/internal/llm/hermes-tool-extract.ts` < 500 AND `git diff --stat src/internal/llm/openai.ts` shows ≤ 8 net added lines (pre-existing 502 not expanded materially)
- [ ] `grep -c "request-scoped" CHANGELOG.md` returns ≥ 1 under `[Unreleased]` (Unbreakable Rule 6)
- [ ] Backward compatibility proven by `test_absent_allowlist_recovers_all_backcompat` passing; no public API change (`grep -c "doomLoop\|allowedToolNames" docs.md` returns 0 — recovery is internal + automatic)
- [ ] `pnpm validate` exits 0 (knip finds no orphan export; depcruise reports 0 new cross-layer violation)
- [ ] Plan archived after `/review` READY_TO_MERGE + merge

## Failure scenarios (when I/O external)

The change is PURE gating over already-received stream content — it adds NO new external I/O. `openai.ts` is an HTTP client, but the request-scoped filter runs in `finish()` after the SSE stream is fully consumed; existing stream/transport failure modes (5xx, connection reset, in-stream error chunk at `openai.ts:188`) are untouched. The one relevant behavioral scenario is exercised as a unit/golden test, not a chaos test:

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| OpenAI-compat SSE stream (existing) | model leaks a `<function=NAME>` for a tool NOT in the request | golden test: mock SSE with a leaked block + `REQUEST.tools` without that name | `finish.toolCalls` length 0, block stays as visible text, `stopReason` stays `end_turn` |

No new external dependency; no chaos pass required beyond the golden gate tests above.

## Final Phase: Integration Validation (MANDATORY)

**Objective:** validate the request-scoped gate works end-to-end and no existing test regresses.

### Execution
```
pnpm --filter @theokit/sdk exec vitest run tests/internal/llm/hermes-tool-extract.test.ts tests/golden/llm/openai-leaked-dialect-safe-parse.golden.test.ts
pnpm --filter @theokit/sdk test        # full suite — catch any test relying on unscoped recovery
pnpm --filter @theokit/sdk typecheck
pnpm --filter @theokit/sdk exec biome check
pnpm validate                          # Tier-1: + knip + depcruise + publint + attw + bundle
```

### Acceptance Criteria
- [ ] All test suites green (unit + golden + full suite)
- [ ] Coverage ≥ 90% on the two changed source files (critical path: the gate branch 100%)
- [ ] Zero type errors, zero lint warnings
- [ ] `pnpm validate` green (knip no orphan, depcruise no new violation)
- [ ] Failure scenario row exercised (leaked-name-not-in-tools → not recovered)

### If Validation Fails
1. Identify plan-caused vs pre-existing failures (a test feeding a leaked name with no `REQUEST.tools` and expecting recovery is plan-caused → update its fixture to declare the tool).
2. Fix all plan-caused failures.
3. Re-run the chain.
4. Pre-existing issues logged, not blocking.
