---
slug: m2-compaction-public-api
created_at: 2026-06-20
goal: Ship a @theokit/sdk/compaction subpath with compactTranscript (keep-recent + optional summarize, reusing the internal selectCompressionWindow), the buildCheckpoint/filterFromLatestCheckpoint/CHECKPOINT_MARKER string-sentinel helpers, and isContextOverflowError, measured by tests/compaction.test.ts + tests/compaction-wiring.test.ts passing green.
---

# Plan: M2-1 — Public compaction / context-management API (`@theokit/sdk/compaction`)

> **Version 1.1** (edge-case-plan absorbed: EC-1 empty/only-system + EC-2 marker-last + EC-3 subclass-overflow folded into TDD) — Promote the SDK's compaction capability to a public `@theokit/sdk/compaction` subpath: `compactTranscript(messages, options)` (keep-recent + optional summarize, REUSING the internal `selectCompressionWindow` — no second algorithm), `buildCheckpoint`/`filterFromLatestCheckpoint`/`CHECKPOINT_MARKER` (greenfield string-sentinel helpers), and `isContextOverflowError(err)` (predicate over the typed `context_too_long` code). Closes roadmap gap M2-1 (high sev). Design locked by blueprint `m2-compaction-public-api` (discover-confidence SHIPPABLE 98.8, ADRs D1-D5).

## Goal

> "Give SDK consumers a public compaction/context surface — compact a transcript (keep-recent + optional LLM summarize), mark/filter conversation checkpoints, and detect context-overflow — without reaching into `internal/`, measured by `tests/compaction.test.ts` + `tests/compaction-wiring.test.ts` passing green."

## Context

Roadmap gap M2-1 (`docs/gap-audit/ROADMAP.md:106`, high sev, Tema B). The blueprint (`knowledge-base/discoveries/blueprints/m2-compaction-public-api-blueprint.md`, SHIPPABLE 98.8) studied adk-js compactors, crewAI summarize, codex `<token_budget>` marker + `ContextWindowExceeded`, and opencode's `compaction` part. Two **baseline corrections** to the blueprint's first-draft assumptions (anti-rework, confirmed against real code):

1. **The compaction unit is `CompressibleMessage` (`{role:"user"|"assistant"|"system"; content:string}`), NOT `SDKMessage`.** That is the type the existing internal summarizer operates on (`packages/sdk/src/internal/runtime/compression/compression-summarizer.ts:27`). `compactTranscript` adopts it → zero shape-mapping, clean delegation to `compressConversationWindow`, perfect DRY. Consequence: **tool-pair-safety is N/A** here (CompressibleMessage is flat role+content with no tool_call/tool_result structure — unlike the M1-3 `SDKMessage` case).
2. **`compactTranscript` reuses `selectCompressionWindow` (`compression-helpers.ts:27`), which lives under `internal/runtime/`.** So `src/compaction.ts` reaches `internal/runtime` → its DTS is generated via the **tsc-cycle-exception path** (the `retry`/`concurrency` pattern), NOT the rollup-plugin-dts leaf path that `messages` used.

`isContextOverflowError`: `TheokitAgentError` (`errors.ts:143`) carries both `readonly code?: string` (`:146`) and `readonly metadata?: ErrorMetadata` (`:148`); the closed union `KnownAgentRunErrorCode` includes `"context_too_long"` (`:18`). The predicate checks both fields (the error contract documented in `errors.ts:7` prefers `metadata?.code`; the provider mappers set `.code`). The provider mappers already produce the typed code (`internal/error-mappers/anthropic.ts:87`, `openai-compatible.ts:87`), so the predicate just reads it (no message-regex — blueprint ADR D4).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/src/compaction.ts` (NEW) | 0 | — | (the public compaction module) | — |
| `packages/sdk/src/internal/runtime/compression/compression-summarizer.ts` | 107 | `44d550c` | `CompressibleMessage` (:27) + `compressConversationWindow` (:80) + `CompressionFailedError` (@public, :39) | read-only; reuse types/fns, do not modify |
| `packages/sdk/src/internal/runtime/compression/compression-helpers.ts` | (helpers) | — | `selectCompressionWindow<M>(messages, preserveLast=6)` (:27) | read-only; reuse |
| `packages/sdk/src/errors.ts` | 698 | `a531978` | `TheokitAgentError` (:143, `.code?`/`.metadata?`), `KnownAgentRunErrorCode` incl. `context_too_long` (:18) | read-only; predicate reads it |
| `packages/sdk/src/types/messages.ts` | 170 | `478fe5a` | `SDKMessage` union (not the compaction unit) | unchanged |
| `packages/sdk/package.json` | 309 | — | `exports` map | additive `./compaction` block only |
| `packages/sdk/tsup.config.ts` | 67 | — | build entries + DTS strategy | additive `compaction` entry only |
| `packages/sdk/tsconfig.tools-dts.json` | (config) | — | tsc-DTS include list (for entries reaching internal/runtime) | additive `src/compaction.ts` + ensure compression dir included |
| `packages/sdk/scripts/mirror-dts-to-cts.mjs` | (script) | — | `.d.ts`→`.d.cts` mirror | additive `compaction.d.ts` |
| `.dependency-cruiser.cjs` | (config) | — | `no-orphans` rule | additive `compaction.ts` exclusion IF it ends up type-only-imported (it won't — it has value imports from internal/runtime) |
| `packages/sdk/tests/compaction.test.ts` (NEW) | 0 | — | unit tests — RED first | — |
| `packages/sdk/tests/compaction-wiring.test.ts` (NEW) | 0 | — | integration test through the public surface | — |
| `docs.md` | (contract) | — | public API contract | additive `Compaction` section |
| `packages/sdk/CHANGELOG.md` (root) + `.changeset/` (NEW) | — | — | changelog + changeset | additive `[Unreleased]`/changeset entry |

### Current callers / dependents

- **Symbols** `compactTranscript`/`buildCheckpoint`/`filterFromLatestCheckpoint`/`CHECKPOINT_MARKER`/`isContextOverflowError` (NEW) — no callers yet; ship as PUBLIC subpath primitives (consumer-facing, like `@theokit/sdk/messages`/`retry`), wired via integration test + docs (no-orphan public-primitive exception).
- **Reused internal** `selectCompressionWindow` (`compression-helpers.ts:27`), `CompressibleMessage`/`compressConversationWindow`/`CompressionFailedError` (`compression-summarizer.ts:27,80,39`) — imported by `compaction.ts`; existing internal callers (`compression-attempt.ts:22`) unaffected (additive import).
- **Subpath wiring** mirrors the `retry`/`concurrency` subpaths (which also reach `internal/runtime`): tsc-DTS path.

### Domain glossary

- **transcript** — an ordered `CompressibleMessage[]` (conversation turns: role + content string).
- **compaction** — reducing a transcript's size while preserving meaning: keep the last `keepRecent` turns, summarize or drop older ones, always keep leading system turns.
- **checkpoint** — a string-sentinel marker turn inserted into a transcript; "filter from latest checkpoint" returns the turns after the most recent marker.
- **context overflow** — the provider rejected the request because the prompt exceeded the model's context window (`context_too_long` ErrorCode).
- **keep-recent** — the count of trailing turns preserved verbatim during compaction (default 6, matching internal `selectCompressionWindow preserveLast=6`).

### Architecture boundaries affected

Per `rules/architecture.md` §2: `src/compaction.ts` is a public module that REACHES `internal/runtime/compression` (to reuse `selectCompressionWindow` + `CompressibleMessage`) — the same allowed reach the `retry`/`concurrency` subpaths have. It imports `TheokitAgentError` from the public `errors.ts` root. The outward extension is an additive PUBLIC subpath documented in `docs.md`. Because it reaches `internal/runtime`, DTS is via the tsc exception (NOT rollup-plugin-dts), and it is NOT type-only (has value imports), so the dep-cruiser `no-orphans` exclusion that `messages.ts` needed does NOT apply (it has real value edges).

## Prior Art & Related Work

- **Internal blueprint** `knowledge-base/discoveries/blueprints/m2-compaction-public-api-blueprint.md` (ADRs D1-D5) — the locked design source.
- **First-party internal baseline** `packages/sdk/src/internal/runtime/compression/` (`selectCompressionWindow`, `compressConversationWindow`, `CompressibleMessage`) — reused, not reimplemented.
- **Reference** adk-js `TokenBasedContextCompactor`/`TruncatingContextCompactor` (`.claude/knowledge-base/reference/adk-js/core/src/context/`), crewAI `summarize_messages` (`.claude/knowledge-base/reference/crewAI/lib/crewai/src/crewai/utilities/agent_utils.py:920`), codex `ContextWindowExceeded` (`.claude/knowledge-base/reference/codex/codex-rs/protocol/src/error.rs:83`).
- **First-party subpath pattern (reaches internal/runtime)** `packages/sdk/src/retry.ts` + `concurrency.ts` + the 4 wiring files.

## Objective

- [ ] `src/compaction.ts` exports `compactTranscript`, `buildCheckpoint`, `filterFromLatestCheckpoint`, `CHECKPOINT_MARKER`, `isContextOverflowError` + re-exports the `CompressibleMessage` type.
- [ ] `compactTranscript(messages, {keepRecent=6, summarize?})`: keep last `keepRecent` raw (via `selectCompressionWindow`); summarize older via callback if given, else drop older; ALWAYS preserve leading system messages.
- [ ] `CHECKPOINT_MARKER` string sentinel; `buildCheckpoint(label?)` → marker `CompressibleMessage`; `filterFromLatestCheckpoint(messages)` → turns after the latest marker (backward scan).
- [ ] `isContextOverflowError(err)`: true iff `err instanceof TheokitAgentError && (err.code === "context_too_long" || err.metadata?.code === "context_too_long")`.
- [ ] `@theokit/sdk/compaction` subpath wired (tsc-DTS path like retry/concurrency), zero new deps; docs.md + CHANGELOG + changeset.
- [ ] `tests/compaction.test.ts` + `tests/compaction-wiring.test.ts` green; typecheck + Biome + knip + build clean.

## ADRs

### D1 — `compactTranscript` reuses `selectCompressionWindow`; delegates summarization via callback

**Decision:** `compactTranscript(messages: CompressibleMessage[], options?: { keepRecent?: number; summarize?: (older: CompressibleMessage[]) => Promise<CompressibleMessage> }): Promise<CompressibleMessage[]>`. Split via `selectCompressionWindow(messages, keepRecent ?? 6)`; preserve leading system turns; if `summarize` → prepend its single result before the preserved tail; else drop the older window.

**Rationale:** reuses the proven internal split (DRY / Rule 9; blueprint EC-2 no-duplicate-summarizer); adk-js + crewAI both expose keep-recent + summarize-older. Default 6 matches `selectCompressionWindow preserveLast=6`.

**Alternatives considered:** a new window algorithm (rejected — duplicates `selectCompressionWindow`); operating on `SDKMessage` (rejected — `CompressibleMessage` is the real compaction unit, zero mapping); a built-in LLM summarizer (rejected — the callback lets the caller wire the existing `compressConversationWindow`, no second summarizer).

**Consequences:** `compaction.ts` reaches `internal/runtime` → tsc-DTS path (D5). Async return (summarize is async); the no-summarize path resolves synchronously-wrapped.

### D2 — Checkpoint is a string sentinel + backward-scan filter (greenfield)

**Decision:** `CHECKPOINT_MARKER: string` (a sentinel prefix); `buildCheckpoint(label?: string): CompressibleMessage` returns `{role:"system", content: CHECKPOINT_MARKER + (label ?? "")}`; `filterFromLatestCheckpoint(messages: CompressibleMessage[]): CompressibleMessage[]` scans BACKWARD for the latest turn whose content starts with `CHECKPOINT_MARKER` and returns the turns AFTER it (all messages if none).

**Rationale:** codex uses an in-transcript string sentinel; adk-js uses filter-backward-from-latest; opencode confirms a discrete marker. A string sentinel needs no new `SDKMessage`/type variant (KISS). Blueprint D3 (≥ 2 references).

**Alternatives considered:** a new union/type variant (rejected — wire-type for a local concern); crewAI file-based `CheckpointConfig` (rejected — session persistence, different concern).

### D3 — `isContextOverflowError` reads the typed code (both `.code` and `.metadata?.code`)

**Decision:** `isContextOverflowError(err: unknown): boolean` = `err instanceof TheokitAgentError && (err.code === "context_too_long" || err.metadata?.code === "context_too_long")`.

**Rationale:** codex's typed-code detection is robust; the SDK already maps providers→`context_too_long` at the boundary. Checking both fields covers mapper-set `.code` and the ADR-D66-preferred `.metadata?.code`. Blueprint D4.

**Alternatives considered:** message-substring matching (rejected — brittle; crewAI's own fallback; the boundary already did the regex once); `metadata?.code` only (rejected — mappers set `.code`, would miss them).

### D4 — Public surface is plain functions on a dedicated subpath

**Decision:** ship plain functions (not a strategy-object hierarchy) on `@theokit/sdk/compaction`; re-export the `CompressibleMessage` type for consumers.

**Rationale:** KISS vs adk-js's class hierarchy (the agent loop already owns the stateful compactor — YAGNI for a public helper). Matches the SDK's free-function subpath convention (`withRetry`, `mapWithConcurrency`).

**Alternatives considered:** strategy-object API (rejected — over-engineered); barrel-only export (rejected — dedicated subpath keeps the barrel lean).

### D5 — `@theokit/sdk/compaction` on the tsc-DTS path, zero new deps

**Decision:** wire `@theokit/sdk/compaction` → `src/compaction.ts` via package.json exports + tsup entry + `tsconfig.tools-dts.json` include + mirror-dts-to-cts, following the `retry`/`concurrency` pattern (tsc-DTS because the module reaches `internal/runtime`). No new dependency.

**Rationale:** `retry`/`concurrency` already reach `internal/runtime` and use the tsc DTS path to avoid the rollup-plugin-dts cycle; `compaction` does the same. Reuses own types only — zero deps.

**Alternatives considered:** rollup leaf path (rejected — only valid for leaf-type-only modules like `messages`; compaction has value imports from internal/runtime); barrel export (rejected — convention).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `compaction.ts` reaching `internal/runtime` ties the public DTS to the tsc-cycle-exception path — easy to mis-wire (forget tsconfig.tools-dts include → no `.d.ts`) | Medium | T2.1 mirrors `retry`/`concurrency` exactly; Integration Validation runs `pnpm build` + asserts `dist/compaction.d.ts`+`.d.cts` exist + attw | SDK |
| `compactTranscript` async return may surprise callers wanting sync truncation (no-summarize case) | Low | Documented: returns a Promise always (uniform); the no-summarize path is still cheap | SDK |
| `CHECKPOINT_MARKER` sentinel could collide with real message content that happens to start with the marker string | Low | Use an unambiguous sentinel (e.g. a unicode-guarded token unlikely in prose); documented; `buildCheckpoint` is the only sanctioned producer | SDK |

## Unresolved Questions

- (none — every decision resolved at plan time via blueprint ADRs D1-D5 + the two baseline corrections. Whether to also expose `estimateTokens`/`shouldCompact` is explicitly OUT of scope — that is roadmap M2-2, YAGNI here.)

## Dependency Graph

```
Phase 1 (pure helpers + compactTranscript) ──▶ Phase 2 (subpath wiring + docs) ──▶ Final Phase (integration validation: tests + build)
```

Sequential: Phase 2 wires/documents Phase 1; Final validates incl. the tsc-DTS build.

---

## Phase 1: Compaction helpers + `compactTranscript`

### T1.1 — `isContextOverflowError` + checkpoint trio (pure)

#### Objective
Add `isContextOverflowError`, `CHECKPOINT_MARKER`, `buildCheckpoint`, `filterFromLatestCheckpoint` to `src/compaction.ts`.

#### Why this step (action + reasoning)
1. **What** — the leaf-pure helpers: overflow predicate + checkpoint string-sentinel trio.
2. **Why now** — they are independent of the summarizer reuse (pure over `CompressibleMessage` + `TheokitAgentError`), so they land first with full TDD; `compactTranscript` (T1.2) builds in the same file.

#### Evidence
Blueprint D2 + D3. `TheokitAgentError` (`errors.ts:143,146,148`), `context_too_long` (`errors.ts:18`). `CompressibleMessage` (`compression-summarizer.ts:27`). Reference: codex `error.rs:83` + `token_budget.rs` sentinel; adk-js filter-backward (`token_based_context_compactor.ts:41-63`).

#### Files to edit
```
packages/sdk/src/compaction.ts — NEW: isContextOverflowError, CHECKPOINT_MARKER, buildCheckpoint, filterFromLatestCheckpoint
packages/sdk/tests/compaction.test.ts — NEW: RED tests first
```

#### Deep file dependency analysis
- `compaction.ts` imports `TheokitAgentError` from `./errors.js` and the `CompressibleMessage` type from `./internal/runtime/compression/compression-summarizer.js`. No file modified besides the new module + test.

#### Pseudo-code / Signatures
```pseudocode
CHECKPOINT_MARKER = " theokit:checkpoint "   # unambiguous sentinel
buildCheckpoint(label?) -> { role:"system", content: CHECKPOINT_MARKER + (label ?? "") }
filterFromLatestCheckpoint(messages):
  for i from messages.length-1 downto 0:
    if messages[i].content.startsWith(CHECKPOINT_MARKER): return messages.slice(i+1)
  return [...messages]
isContextOverflowError(err):
  return err instanceof TheokitAgentError && (err.code === "context_too_long" || err.metadata?.code === "context_too_long")
```

#### TDD
```
RED: test_isContextOverflowError_true_on_code() — TheokitAgentError {code:"context_too_long"} → true
RED: test_isContextOverflowError_true_on_metadata_code() — {metadata:{code:"context_too_long"}} → true
RED: test_isContextOverflowError_false_other_code() — {code:"rate_limited"} → false
RED: test_isContextOverflowError_false_non_error() — plain Error / string / undefined → false
RED: test_buildCheckpoint_starts_with_marker() — buildCheckpoint("x").content startsWith CHECKPOINT_MARKER
RED: test_filterFromLatestCheckpoint_returns_after_latest() — [a,cp,b,cp,c] → [c]
RED: test_filterFromLatestCheckpoint_no_marker_returns_all() — [a,b] → [a,b]
RED: test_filterFromLatestCheckpoint_does_not_mutate() — input array unchanged
RED: test_filterFromLatestCheckpoint_marker_last_returns_empty() — [a,cp] → [] (edge-case EC-2)
RED: test_isContextOverflowError_true_on_subclass() — a TheokitAgentError SUBCLASS w/ code:"context_too_long" → true (edge-case EC-3)
GREEN: implement the four symbols in src/compaction.ts
REFACTOR: Biome complexity ≤ 10
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/compaction.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/compaction.test.ts -t "isContextOverflowError|Checkpoint"` reports 10/10 tests passed
- [ ] `test_isContextOverflowError_true_on_metadata_code` passes (ADR D3 dual-field)
- [ ] `test_filterFromLatestCheckpoint_returns_after_latest` passes (ADR D2 backward scan)
- [ ] `pnpm --filter @theokit/sdk exec biome check packages/sdk/src/compaction.ts` reports 0 errors

#### DoD
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/compaction.test.ts` green for these tests
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0

### T1.2 — `compactTranscript` (reuse `selectCompressionWindow`)

#### Objective
Add `compactTranscript` + re-export `CompressibleMessage` in `src/compaction.ts`.

#### Why this step (action + reasoning)
1. **What** — the keep-recent + optional-summarize compaction fn, reusing the internal split.
2. **Why now** — it depends on T1.1's module existing; it is the meatiest symbol and the one that introduces the `internal/runtime` reach (driving the D5 DTS path).

#### Evidence
Blueprint D1. `selectCompressionWindow` (`compression-helpers.ts:27`), `CompressibleMessage` (`compression-summarizer.ts:27`). Reference: adk-js keep-recent (`token_based_context_compactor.ts:84-142`), crewAI system-preservation (`agent_utils.py:920-959`).

#### Files to edit
```
packages/sdk/src/compaction.ts — add compactTranscript + re-export CompressibleMessage
packages/sdk/tests/compaction.test.ts — add RED tests for compactTranscript
```

#### Deep file dependency analysis
- `compaction.ts` adds `import { selectCompressionWindow } from "./internal/runtime/compression/compression-helpers.js"` + `export type { CompressibleMessage }`. This is the value import that puts compaction on the tsc-DTS path (D5). No internal file modified.

#### Pseudo-code / Signatures
```pseudocode
async compactTranscript(messages, options?):
  keepRecent = options?.keepRecent ?? 6
  system = messages.filter(m => m.role === "system" && !content.startsWith(CHECKPOINT_MARKER))  # leading system preserved
  nonSystem = messages.filter(m => m.role !== "system")
  {toCompress, toPreserve} = selectCompressionWindow(nonSystem, keepRecent)
  if toCompress.length === 0: return [...messages]
  if options?.summarize:
    summary = await options.summarize(toCompress)
    return [...system, summary, ...toPreserve]
  return [...system, ...toPreserve]   # drop older without summary
```
(Exact system-preservation semantics finalized at GREEN — preserve system turns in original order.)

#### TDD
```
RED: test_compactTranscript_keeps_last_keepRecent() — 10 msgs, keepRecent 3 → last 3 preserved verbatim
RED: test_compactTranscript_preserves_system() — leading system msg present in output
RED: test_compactTranscript_summarize_prepends_summary() — summarize callback result appears before the recent tail
RED: test_compactTranscript_no_summarize_drops_older() — without callback, older window dropped, recent kept
RED: test_compactTranscript_shorter_than_keepRecent_noop() — <= keepRecent msgs → returned unchanged
RED: test_compactTranscript_does_not_mutate_input() — input array unchanged
RED: test_compactTranscript_default_keepRecent_6() — default keeps last 6
RED: test_compactTranscript_empty_returns_empty() — [] → [] (edge-case EC-1)
RED: test_compactTranscript_only_system_unchanged() — all-system transcript → returned unchanged (edge-case EC-1)
GREEN: implement compactTranscript reusing selectCompressionWindow
REFACTOR: Biome complexity ≤ 10; extract a helper if needed
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/compaction.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/compaction.test.ts` reports 19/19 tests passed (10 from T1.1 + 9 here)
- [ ] `test_compactTranscript_summarize_prepends_summary` passes (ADR D1 delegation)
- [ ] `test_compactTranscript_preserves_system` passes (system never dropped)
- [ ] `grep -c "selectCompressionWindow" packages/sdk/src/compaction.ts` returns ≥ 1 (reuse, not reimplement — DRY)
- [ ] `pnpm --filter @theokit/sdk exec biome check packages/sdk/src/compaction.ts` reports 0 errors
- [ ] `wc -l packages/sdk/src/compaction.ts` returns ≤ 120 (budget 500)

#### DoD
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/compaction.test.ts` 19/19 green
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0
- [ ] `pnpm --filter @theokit/sdk exec biome check` clean on changed files

---

## Phase 2: Wire the `@theokit/sdk/compaction` subpath + docs

### T2.1 — Wire subpath (tsc-DTS) + integration test + docs + changeset

#### Objective
Expose `@theokit/sdk/compaction` (4 wiring files, tsc-DTS path) + integration test + docs.md + changeset + CHANGELOG.

#### Why this step (action + reasoning)
1. **What** — wires the subpath like `retry`/`concurrency` (tsc-DTS), proves it via an integration test, documents + records.
2. **Why now** — per `no-stubs-no-mocks-no-wired.md` the helpers need a reachable consumer surface; per CLAUDE.md docs.md reflects the public-surface change in the same change.

#### Evidence
`retry`/`concurrency` subpath wiring (reach internal/runtime → tsc DTS): `package.json` exports, `tsup.config.ts` entry, `tsconfig.tools-dts.json` include, `scripts/mirror-dts-to-cts.mjs`. `no-stubs-no-mocks-no-wired.md` public-primitive exception.

#### Files to edit
```
packages/sdk/package.json — add "./compaction" exports block (mirror "./retry")
packages/sdk/tsup.config.ts — add "compaction": "src/compaction.ts" to entry
packages/sdk/tsconfig.tools-dts.json — add "src/compaction.ts" to include (compression dir already covered)
packages/sdk/scripts/mirror-dts-to-cts.mjs — add compaction.d.ts to targets
packages/sdk/tests/compaction-wiring.test.ts — NEW: integration test importing the public surface
docs.md — NEW "Compaction (@theokit/sdk/compaction)" section
packages/sdk/CHANGELOG.md (root) — [Unreleased] § Added entry
.changeset/m2-compaction-public-api.md — NEW minor changeset
```

#### Deep file dependency analysis
- 4 config files: additive entries mirroring `retry`. `compaction-wiring.test.ts` imports the 5 symbols from `../src/compaction.js`, exercises `compactTranscript` (with a fake summarize), `buildCheckpoint`/`filterFromLatestCheckpoint` round-trip, and `isContextOverflowError` on a real `TheokitAgentError` — end-to-end. docs.md additive.

#### TDD
```
RED: test_compaction_symbols_importable_and_work() — import all 5 from ../src/compaction.js; round-trip realistic transcript + checkpoint + overflow error
RED: test_subpath_declared_in_package_json() — package.json exports has "./compaction"
GREEN: wire 4 files + docs + changeset + CHANGELOG
REFACTOR: config consistency vs retry/concurrency
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/compaction-wiring.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/compaction-wiring.test.ts` reports 2/2 tests passed
- [ ] `node -e "process.exit(require('./packages/sdk/package.json').exports['./compaction']?1:0)"` ... `node -e "process.exit(require('./packages/sdk/package.json').exports['./compaction'] ? 0 : 1)"` exits 0 (subpath declared)
- [ ] `grep -c "compaction" packages/sdk/tsup.config.ts` returns ≥ 1 AND `grep -c "src/compaction.ts" packages/sdk/tsconfig.tools-dts.json` returns ≥ 1
- [ ] `grep -c "compaction.d.ts" packages/sdk/scripts/mirror-dts-to-cts.mjs` returns ≥ 1
- [ ] `grep -c "@theokit/sdk/compaction" docs.md` returns ≥ 1 AND `ls .changeset/m2-compaction-public-api.md` exists AND `grep -c "compactTranscript" packages/sdk/CHANGELOG.md` ≥ 1
- [ ] `pnpm --filter @theokit/sdk exec biome check` clean on changed files

#### DoD
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/compaction-wiring.test.ts` green
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0
- [ ] `pnpm --filter @theokit/sdk build` succeeds; `dist/compaction.d.ts` + `dist/compaction.d.cts` exist (tsc-DTS path)
- [ ] docs.md section + changeset + CHANGELOG entry present

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | No public `compactTranscript` (M2-1) | T1.2 | keep-recent + summarize, reuses `selectCompressionWindow` (D1) |
| 2 | No checkpoint helpers (greenfield) | T1.1 | string-sentinel `CHECKPOINT_MARKER` + build/filter (D2) |
| 3 | No `isContextOverflowError` | T1.1 | typed-code predicate, dual-field (D3) |
| 4 | No `./compaction` subpath | T2.1 | tsc-DTS subpath like retry/concurrency (D5) |
| 5 | Zero new deps | T1.2 | reuse internal types/fns only (D5) |
| 6 | Document + record + prove the public surface | T2.1 | docs.md + changeset + CHANGELOG + integration test |

**Coverage: 6/6 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/sdk exec vitest run` green
- [ ] Zero type errors — `pnpm --filter @theokit/sdk typecheck`
- [ ] Zero lint warnings — `pnpm --filter @theokit/sdk exec biome check`
- [ ] Dead-code clean — `pnpm quality:dead` (knip)
- [ ] Build clean — `pnpm --filter @theokit/sdk build` (compaction DTS + cts via tsc path; no attw/publint regression)
- [ ] Dep-cruiser clean — `pnpm run quality:depcruise` (compaction.ts has value edges → not orphan; no exclusion needed)
- [ ] File-size budget respected (`compaction.ts` ≤ 500, target ≤ 120)
- [ ] CHANGELOG.md updated under `[Unreleased]` + changeset added (Unbreakable Rule 6)
- [ ] Backward compatibility preserved (additive subpath + docs only)
- [ ] `docs.md` reflects the new `@theokit/sdk/compaction` surface (source-of-truth rule)
- [ ] Plan-specific: `compactTranscript` reuses `selectCompressionWindow` (no duplicate algorithm); system messages never dropped; `isContextOverflowError` reads typed code (no message-regex); checkpoint round-trips
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merge

## Dependencies

M2-1 introduces ZERO new dependencies — reuses the SDK's own internal compression helpers + error types (Rule 9 / KISS).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (internal) `selectCompressionWindow`/`CompressibleMessage`/`TheokitAgentError` | n/a (in-repo) | npm/TS | compaction reuses the internal split + error type |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | A tokenizer dep (e.g. `tiktoken`/`gpt-tokenizer`) was evaluated + rejected — adk-js + crewAI both prove chars/4 + provider counts suffice; M2-1 does not need precise token counts (keep-recent by message count + optional summarize). | n/a — no new dep |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Failure scenarios

(The summarize callback may throw — e.g. the internal `compressConversationWindow` raises `CompressionFailedError` on an LLM failure. `compactTranscript` does NOT catch it: the error propagates to the caller, who decides fallback (consistent with the internal compression path's WARN + original-conversation failure-mode behavior). Documented in docs.md. No other I/O — checkpoint/overflow helpers are pure.)

## Final Phase: Integration Validation (MANDATORY)

### Execution
```
pnpm --filter @theokit/sdk exec vitest run tests/compaction.test.ts tests/compaction-wiring.test.ts
pnpm --filter @theokit/sdk exec vitest run        # full suite — no regression
pnpm --filter @theokit/sdk typecheck
pnpm --filter @theokit/sdk exec biome check
pnpm quality:dead
pnpm run quality:depcruise
pnpm --filter @theokit/sdk build                  # compaction DTS + cts via tsc path
```

### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/compaction.test.ts tests/compaction-wiring.test.ts` reports 21/21 tests passed
- [ ] `pnpm --filter @theokit/sdk exec vitest run` reports 0 failed (full SDK suite — no regression)
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0 AND `pnpm --filter @theokit/sdk exec biome check` reports 0 errors
- [ ] `pnpm quality:dead` reports 0 unused exports AND `pnpm run quality:depcruise` reports 0 violations for `src/compaction.ts`
- [ ] `pnpm --filter @theokit/sdk build` succeeds; `ls dist/compaction.d.ts dist/compaction.d.cts` both exist (exit 0); attw resolves `@theokit/sdk/compaction` 🟢
- [ ] Runtime-metric proof — N/A: `grep -c "metric" Global-DoD` shows 0 metric targets declared (pure helpers, consistent with the M0/retry/messages primitives)

### If Validation Fails
1. Identify plan-caused vs pre-existing failures.
2. Fix all plan-caused failures.
3. Re-run the chain.
4. Log pre-existing issues in the PR description; they do not block.
