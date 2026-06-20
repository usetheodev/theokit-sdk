# Blueprint: M2-1 — Public compaction / context-management API (`@theokit/sdk/compaction`)

> **Version 1.0** — Synthesizes adk-js context compactors (`BaseContextCompactor` interface + `TokenBasedContextCompactor`/`TruncatingContextCompactor`), crewAI LLM-summarize (`summarize_messages`) + overflow detection (`CONTEXT_LIMIT_ERRORS`), codex first-class `ContextWindowExceeded` error + `<token_budget>` marker, and opencode's `compaction` message-part, against the SDK's EXISTING internal `compression-*` algorithm and `context_too_long` ErrorCode, to lock the `@theokit/sdk/compaction` public contract: `compactTranscript(messages, options)`, `buildCheckpoint`/`filterFromLatestCheckpoint`/`CHECKPOINT_MARKER`, and `isContextOverflowError(err)`.

**Slug:** `m2-compaction-public-api`
**Source plan:** `.claude/knowledge-base/discoveries/plans/m2-compaction-public-api-plan.md`
**Owner:** paulo
**Generated:** 2026-06-20 via discover-execute procedure
**Confidence verdict:** SHIPPABLE (98.8, discover-confidence 2026-06-20)

## Context

Roadmap gap M2-1 (high sev). Baseline (`packages/sdk/src/internal/runtime/compression/`) confirmed: compaction-via-LLM exists internally as `compression-*` (`compression-attempt.ts:46`, `compression-summarizer.ts:80`, `compression-helpers.ts:27`, `lifecycle/auto-summarize.ts:46`) coupled to the loop's `context_too_long` recovery; the `context_too_long` `ErrorCode` exists (`errors.ts:18`) + provider mappers (`error-mappers/anthropic.ts:87`, `openai-compatible.ts:87`). NO `compactTranscript`, NO checkpoint helpers, NO `isContextOverflowError` exist. This blueprint designs the public surface, reusing the internal summarizer (DRY / Rule 9) and the typed ErrorCode (no message-regex).

## Objective

Lock signatures + shape mapping + subpath wiring for the `@theokit/sdk/compaction` surface, each backed by ≥ 2 references (≥ 2 for the greenfield checkpoint design).

---

## Coverage Corner 1 — Integration Tests

### adk-js
`adk-js/tests/e2e/context_compaction/e2e_compaction_vertexai_test.ts:24-26` constructs a `TokenBasedContextCompactor({ tokenThreshold: 50, eventRetentionSize: 2, summarizer })` with an artificially low threshold to force compaction; asserts (`:106-111`) that `isCompactedEvent(e)` filters to the compacted event and `latestCompacted.compactedContent.length > 0` (content preserved across the boundary). The `eventRetentionSize` param pins the last N raw events.

### crewAI
`crewAI/lib/crewai/tests/utilities/test_summarize_integration.py:203,232` sets `llm.context_window_size = 500` (small) to trigger summarization and asserts `messages[0]["role"] == "system"` (system preserved) and `messages[-1]` carries a `<summary>` tag (older turns summarized).

### codex
`codex/codex-rs/core/tests/suite/token_budget.rs:49-96,145-155` asserts the `<token_budget>` marker text per request: `Current context window 0.\nYou have {EFFECTIVE_CONTEXT_WINDOW} tokens left...`, plus threshold crossings (25/50/75%) and the post-compaction increment `Current context window 1` (`:362`).

**SDK TDD seed:** `compactTranscript` keeps the last `keepRecent` messages and summarizes/drops older ones; preserves leading system messages; a tool_call/tool_result pair is never split (pair-safe, like the M1-3 `buildReplayHistory` `call_id` pairing). `filterFromLatestCheckpoint` returns messages after the latest marker. `isContextOverflowError` returns true for a `context_too_long` error, false otherwise.

---

## Coverage Corner 2 — Dependencies

| Project | Token-count source | Tokenizer dep? | Citation |
|---|---|---|---|
| adk-js | provider `usageMetadata.promptTokenCount`, else `Math.ceil(len/4)` | **none** | `adk-js/core/src/context/token_based_context_compactor.ts:145-152` |
| crewAI | `len(text) // 4` heuristic; summarize uses an LLM call (no tokenizer) | **none** | `crewAI/lib/crewai/src/crewai/utilities/agent_utils.py:752-761,920-959` |
| codex | provider-reported counts (SSE usage) | **none** | `codex/codex-rs/core/tests/suite/token_budget.rs:26-28` |

**Conclusion:** all three do token-budget compaction with ZERO tokenizer dependency (provider counts + chars/4 fallback). The SDK ships `@theokit/sdk/compaction` with **zero new deps** (Rule 9 / KISS): a `chars/4` estimate with an optional provider-count override; summarization delegates to the EXISTING internal LLM summarizer via an injected callback (no new summarizer).

---

## Coverage Corner 3 — Tools

### adk-js module/export shape
`adk-js/core/src/context/base_context_compactor.ts:12-29` — `BaseContextCompactor` interface with exactly two methods: `shouldCompact(ctx): boolean | Promise<boolean>` and `compact(ctx): void | Promise<void>`. Concrete strategies: `TokenBasedContextCompactor` (`token_based_context_compactor.ts:13-39`, opts `{tokenThreshold, eventRetentionSize, summarizer}`) and `TruncatingContextCompactor` (`truncating_context_compactor.ts:10-28`, opts `{threshold, preserveLeadingEvents?}`). Strategy-object pattern, minimal interface.

**SDK subpath-wiring decision (Q4 + EC-2):** the SDK ships a PURE FUNCTION `compactTranscript(messages, options)` (not a strategy object — KISS; the agent loop already owns the stateful compactor). Wired as `@theokit/sdk/compaction` via `package.json` exports + `tsup.config.ts` entry + `tsconfig.tools-dts.json` include + `mirror-dts-to-cts.mjs` (same 4-file pattern as `@theokit/sdk/messages`/`path-safety`; confirm at implement time). The `summarize` strategy is an OPTIONAL callback param, not a class hierarchy.

---

## Coverage Corner 4 — Techniques

### Technique 1 — Compaction algorithm (drop vs keep vs summarize)

| Project | Approach | Citation |
|---|---|---|
| adk-js token-based | keep last `eventRetentionSize` raw; summarize older batch into one `CompactedEvent`; **tool-pair-safe** (decrement retainStartIndex if it splits a function_call/response pair) | `adk-js/core/src/context/token_based_context_compactor.ts:84-142` |
| adk-js truncating | keep first `preserveLeadingEvents` + last `threshold`; `splice` out the middle; no summary | `adk-js/core/src/context/truncating_context_compactor.ts:37-50` |
| crewAI | chunk non-system messages at token boundary; LLM-summarize each chunk; reassemble: system verbatim + one `<summary>` message; preserve file attachments | `crewAI/lib/crewai/src/crewai/utilities/agent_utils.py:819-864,920-959` |
| theocode/SDK (internal) | `selectCompressionWindow(messages, preserveLast=6)` + `compressConversationWindow` (LLM) + `assertCompressionReduced(before,after,minPct)` | `packages/sdk/src/internal/runtime/compression/compression-helpers.ts:27,53`, `compression-summarizer.ts:80` |

**Decision (D1/D2):** `compactTranscript(messages, {keepRecent=6, maxTokens?, summarize?})` — keep the last `keepRecent` messages raw; for the older prefix, if `summarize` callback provided → delegate to it (the existing internal summarizer path), else drop-oldest until under `maxTokens` (token-budget truncation). Always preserve leading system messages. Tool-pair-safe (never split call/result — reuse the `call_id` pairing proven in M1-3). Default `keepRecent=6` matches the internal `selectCompressionWindow` `preserveLast=6`.

### Technique 2 — Checkpoint / marker representation (greenfield, D3)

| Project | Representation | Citation |
|---|---|---|
| adk-js | `CompactedEvent { isCompacted:true; startTime; endTime; compactedContent }` flag-field on the event; filter scans BACKWARD for the latest, returns it + raw events after its `endTime` | `adk-js/core/src/context/compacted_event.ts:13-33`, `token_based_context_compactor.ts:41-63` |
| codex | `<token_budget>\nCurrent context window N.\n...\n</token_budget>` STRING SENTINEL in the developer message; extracted via `text.starts_with("<token_budget>")` | `codex/codex-rs/core/tests/suite/token_budget.rs:29-34,145-155` |
| opencode | a message part `{ type: "compaction" }` rendered as a visual divider (no payload) | `opencode/packages/ui/src/components/message-part.tsx:1543-1546` |
| crewAI | `CheckpointConfig {location, on_events, max_checkpoints, restore_from}` — file-based session state, ORTHOGONAL to transcript compaction | `crewAI/lib/crewai/src/crewai/state/checkpoint_config.py:159-233` |

**Decision (D3):** `CHECKPOINT_MARKER` is a string sentinel (codex-style — simplest, no new message type; the SDK's `SDKMessage` union already carries text). `buildCheckpoint(label?)` returns a marker `SDKMessage` (a system/text message whose content begins with `CHECKPOINT_MARKER`). `filterFromLatestCheckpoint(messages)` scans BACKWARD for the latest marker and returns the messages AFTER it (adk-js's filter-backward-from-latest algorithm, applied to the string sentinel). Grounded in ≥ 2 references (codex sentinel + adk-js filter-backward; opencode confirms a discrete marker concept). crewAI's file-based `CheckpointConfig` is explicitly NOT adopted (that's session persistence, a different concern).

### Technique 3 — Context-overflow detection

| Project | Approach | Citation |
|---|---|---|
| codex | first-class `ContextWindowExceeded` enum; detect via JSON `error.code == "context_length_exceeded"` (deterministic typed code) | `codex/codex-rs/protocol/src/error.rs:83`, `codex/codex-rs/codex-api/src/sse/responses.rs:888-909` |
| crewAI | case-insensitive substring match vs `CONTEXT_LIMIT_ERRORS` (8 phrases incl. `"context_length_exceeded"`, `"maximum context length"`, `"too many tokens"`) | `crewAI/lib/crewai/src/crewai/utilities/exceptions/context_window_exceeding_exception.py:4-13,32-44` |

**Decision (D4):** `isContextOverflowError(err): boolean` reads the SDK's OWN typed code — `err instanceof TheokitAgentError && err.metadata?.code === "context_too_long"` (codex's typed-code robustness; the SDK already maps providers→`context_too_long` at `error-mappers/anthropic.ts:87`/`openai-compatible.ts:87`). crewAI's message-regex is explicitly REJECTED (brittle); the SDK's provider mappers already do the regex once at the boundary, so the predicate just reads the resulting typed code.

---

## Cross-cutting Comparison

| Dimension | adk-js | crewAI | codex | opencode | SDK decision |
|---|---|---|---|---|---|
| Compaction surface | strategy object | function | implicit | n/a | **pure fn** `compactTranscript` |
| Keep-recent | `eventRetentionSize` | token chunk | token budget | n/a | `keepRecent=6` |
| Token count | provider/chars-4 | chars/4 | provider | n/a | chars/4 + provider override, **0 deps** |
| Summarize | injected summarizer | LLM call | n/a | n/a | optional `summarize` callback → internal summarizer |
| Tool-pair safety | yes (retainStartIndex) | n/a | n/a | n/a | yes (reuse M1-3 `call_id` pairing) |
| Checkpoint marker | flag-field event | n/a | string sentinel | message-part | **string sentinel** `CHECKPOINT_MARKER` |
| Filter-from-latest | backward scan | n/a | n/a | n/a | adk-js backward-scan over sentinel |
| Overflow detect | n/a | message regex | typed code | n/a | **typed code** `context_too_long` |

## ADRs

### D1 — `compactTranscript` is a pure function delegating summarization to the existing internal path
**Decision:** `compactTranscript(messages: SDKMessage[], options: { keepRecent?: number; maxTokens?: number; summarize?: (older: SDKMessage[]) => Promise<SDKMessage> }): SDKMessage[] | Promise<SDKMessage[]>`. Keep last `keepRecent` (default 6) raw; older prefix → `summarize` callback if given, else drop-oldest to fit `maxTokens`; preserve leading system messages.
**Rationale:** adk-js + crewAI both expose a keep-recent + summarize-older algorithm; a pure fn is KISS vs adk's strategy-object hierarchy (YAGNI — the loop owns the stateful compactor). Delegating to the existing `compressConversationWindow` via callback avoids a second summarizer (DRY / Rule 9; EC-2).
**Alternatives considered:** strategy-object hierarchy (rejected — over-engineered for a public helper); new built-in LLM summarizer (rejected — duplicates the internal one).

### D2 — Keep-recent + tool-pair safety + system preservation
**Decision:** never split a tool_call/tool_result pair (reuse the M1-3 `call_id` pairing); always retain leading system messages; default `keepRecent=6` (matches internal `selectCompressionWindow preserveLast=6`).
**Rationale:** adk-js's retainStartIndex decrement + crewAI's system-preservation are both load-bearing correctness rules; the SDK already proved pair-safe dropping in `buildReplayHistory`.
**Alternatives considered:** naive slice (rejected — splits tool pairs, corrupts the transcript).

### D3 — `CHECKPOINT_MARKER` string sentinel + backward-scan filter (greenfield)
**Decision:** `CHECKPOINT_MARKER` = a string sentinel; `buildCheckpoint(label?)` returns a marker `SDKMessage`; `filterFromLatestCheckpoint(messages)` scans backward for the latest marker, returns messages after it.
**Rationale:** codex uses a string sentinel in-transcript; adk-js uses filter-backward-from-latest; opencode confirms a discrete marker. A string sentinel needs no new `SDKMessage` variant (KISS). ≥ 2 references (D3 gate satisfied).
**Alternatives considered:** new `SDKCheckpointMessage` union variant (rejected — adds a wire type for a local concern); crewAI file-based `CheckpointConfig` (rejected — session persistence, not transcript compaction).

### D4 — `isContextOverflowError` reads the typed `context_too_long` code, not message regex
**Decision:** `isContextOverflowError(err): boolean` = `err instanceof TheokitAgentError && err.metadata?.code === "context_too_long"`.
**Rationale:** codex's typed-code detection is robust; the SDK already maps providers→`context_too_long` at the boundary, so the predicate reads the typed result (no brittle regex, unlike crewAI's 8-phrase list).
**Alternatives considered:** message-substring matching (rejected — brittle, the boundary already did this once).

### D5 — `@theokit/sdk/compaction` subpath, zero new deps
**Decision:** wire `@theokit/sdk/compaction` → `src/compaction.ts` (or `src/compaction/index.ts`) via the 4-file pattern (package.json exports + tsup entry + tsconfig.tools-dts include + mirror-dts-to-cts), like `@theokit/sdk/messages`. Zero new deps.
**Rationale:** established pattern (M1-5); the readers/helpers depend only on `SDKMessage`/`CompressibleMessage`/`TheokitAgentError` (own types) + the internal summarizer via callback.
**Alternatives considered:** barrel-only export (rejected — a dedicated subpath keeps the barrel lean, matches convention).

## Recommendations for the project

One concrete decision proposal per research question, for the downstream `/to-plan`:

- **Q1/Q2 (tests):** ship unit tests that force compaction at a tiny `maxTokens` and assert (a) the last `keepRecent` messages are preserved verbatim, (b) leading system messages survive, (c) a tool_call/tool_result pair is never split, (d) `filterFromLatestCheckpoint` returns exactly the post-marker slice. Mirror adk-js's `eventRetentionSize` boundary test + crewAI's system-preservation assertion.
- **Q3 (deps):** implement token estimation as `chars/4` with an optional provider-count override; **introduce ZERO new dependencies** (both adk-js and crewAI prove this is sufficient).
- **Q4 (tools):** expose `compactTranscript` as a **pure function** (not a strategy-object hierarchy), wired on the `@theokit/sdk/compaction` subpath (4-file pattern). Keep the surface minimal: `compactTranscript`, `buildCheckpoint`, `filterFromLatestCheckpoint`, `CHECKPOINT_MARKER`, `isContextOverflowError`.
- **Q5 (algorithm):** `compactTranscript(messages, {keepRecent=6, maxTokens?, summarize?})` — keep-recent + delegate older-prefix summarization to the EXISTING internal `compressConversationWindow` via the `summarize` callback (no second summarizer; DRY/Rule 9); drop-oldest fallback when no callback.
- **Q6 (checkpoint):** adopt the **string-sentinel** `CHECKPOINT_MARKER` + backward-scan `filterFromLatestCheckpoint` (codex sentinel + adk-js filter-backward); do NOT add a new `SDKMessage` union variant; do NOT adopt crewAI's file-based `CheckpointConfig` (different concern).
- **Q7 (overflow):** `isContextOverflowError(err)` reads the typed `context_too_long` code (`err instanceof TheokitAgentError && err.metadata?.code === "context_too_long"`); do NOT use crewAI-style message-regex (the provider mappers already produce the typed code at the boundary).

## Blocked questions (if any)

(none — all 7 research questions answered with verified citations.)
