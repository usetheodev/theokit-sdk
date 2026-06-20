# Discovery Plan: M2-1 — Public compaction / context-management API

> **Version 1.1** (discover-edge-cases absorbed: EC-1 shape-mapping + EC-2 no-duplicate-summarizer folded into halt-loop checkpoints) — Investigate how adk-js, crewAI, codex, and opencode implement transcript COMPACTION, conversation CHECKPOINT/markers, and CONTEXT-OVERFLOW detection, to design the `@theokit/sdk/compaction` public surface: `compactTranscript({messages,keepTokens,summarize})` (wrapping/promoting the existing internal `compression-*` algorithm), the checkpoint helpers `buildCheckpoint`/`filterFromLatestCheckpoint`/`CHECKPOINT_MARKER` (which do NOT exist today — designed from scratch), and `isContextOverflowError(err)` (predicate over the `context_too_long` ErrorCode). Output: a blueprint locking signatures + shape mapping + subpath wiring.

**Slug:** `m2-compaction-public-api`
**Owner:** paulo
**Created:** 2026-06-20
**Time budget:** 4h (per-project breakdown in ADR D1)

## Context

Roadmap gap M2-1 (`docs/gap-audit/ROADMAP.md:106`, high severity, Tema B): "Compaction não exposta (algoritmo está `@internal`)". A baseline exploration corrected the premise (anti-rework):

- The compaction-via-LLM algorithm EXISTS internally but as `compression-*`, not `compact*`, and is coupled to the agent loop's `context_too_long` recovery + fraction-based `autoSummarize`: `attemptCompressionIfNeeded` (`packages/sdk/src/internal/runtime/compression/compression-attempt.ts:46`), `compressConversationWindow` (`compression-summarizer.ts:80`), `selectCompressionWindow` (`compression-helpers.ts:27`), `autoSummarize` (`internal/runtime/lifecycle/auto-summarize.ts:46`). There is NO pure `compactTranscript({messages,keepTokens,summarize})` wrapper.
- The checkpoint helpers `buildCheckpoint`/`filterFromLatestCheckpoint`/`CHECKPOINT_MARKER` DO NOT EXIST — they must be designed from scratch.
- `isContextOverflowError` does not exist; only the `context_too_long` `ErrorCode` (`packages/sdk/src/errors.ts:18`) + provider mappers (`internal/error-mappers/anthropic.ts:87`, `openai-compatible.ts:87`).

So M2-1 is genuine design (effort L), not a thin re-export. The four reference projects under `.claude/knowledge-base/reference/` were confirmed (baseline exploration) to hold real material across all three themes — this discovery investigates HOW they solve each, to lock the SDK's public shape. The investigation respects `rules/architecture.md` §2 (DIP: the public compaction module depends on leaf types, not the agent loop) and `rules/no-stubs-no-mocks-no-wired.md` (every promoted symbol must be wired + reachable).

## Objective

Decide the `@theokit/sdk/compaction` public signatures (compactTranscript, checkpoint helpers, isContextOverflowError), the algorithm relationship to the existing internal `compression-*`, the checkpoint-marker representation, and the subpath wiring — backed by ≥ 2 independent reference implementations per design question. Success criteria:

- [ ] All 7 research questions answered with citations to `.claude/knowledge-base/reference/`
- [ ] Cross-cutting comparison table populated for every in-scope reference project
- [ ] Recommendations provide ≥ 1 concrete decision proposal per research question (esp. the checkpoint-marker representation, which is greenfield)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/reference/adk-js/` | `core/src/context/`, `core/src/agents/processors/`, `tests/e2e/context_compaction/` | Has the cleanest compactor abstraction (`BaseContextCompactor` interface + token/truncating impls) + an event-level compaction marker (`isCompactedEvent`/`compactedContent`) — closest analog to `compactTranscript` + checkpoint |
| `.claude/knowledge-base/reference/crewAI/` | `lib/crewai/src/crewai/utilities/`, `utilities/exceptions/`, `state/`, `tests/utilities/` | LLM-summarize algorithm (`summarize_messages`), context-overflow exception + keyword regex, `CheckpointConfig` restore/prune |
| `.claude/knowledge-base/reference/codex/` | `codex-rs/protocol/src/`, `codex-rs/codex-api/src/sse/`, `codex-rs/core/tests/suite/` | First-class `ContextWindowExceeded` error enum + JSON-code matching (best for `isContextOverflowError`); `<token_budget>` window-counter sentinel (checkpoint-marker angle) |
| `.claude/knowledge-base/reference/opencode/` | `packages/ui/src/components/` | Compaction-part MARKER rendering (`CompactionPartDisplay`) — informs the marker representation only |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/reference/*/{node_modules,dist,build,target,.venv}/` | Build artifacts |
| `.claude/knowledge-base/reference/opencode/` backend (no compaction logic found) | Baseline confirmed opencode is display-only; only the UI marker is in scope |
| Any project NOT under `.claude/knowledge-base/reference/` | Cross-Project Rule: never claim a feature without reading its source |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** adk-js: 1.5h, crewAI: 1.5h, codex: 0.75h, opencode: 0.25h.

**Rationale:** adk-js + crewAI carry the load-bearing design answers (compaction algorithm + checkpoint + overflow), so they get the deepest dives. codex is authoritative only for the overflow-error pattern + the window-counter marker. opencode is a 15-minute look at the marker-rendering representation.

**Stop condition — per question (mandatory):** when a question's broad search returns empty after 3 query-variant retries, mark it BLOCKED with reason "search exhausted" and continue. Do NOT pad with unrelated hotspots.

**Stop condition — per project (mandatory):** when a project's budget is exhausted with questions pending, mark them BLOCKED with reason "budget exhausted" and advance. If every remaining question is `done` or honestly `blocked`, emit `<promise>BLUEPRINT_BLOCKED</promise>` (never `BLUEPRINT_COMPLETE` from a blocked state).

**Anti-pattern:** NEVER fabricate answers to close a question whose search was exhausted (Unbreakable Rule 3).

**Consequences:** the halt-loop stops per-project at budget; blocked questions surface in the blueprint as next-discovery seed.

### D2 — Investigation depth

**Decision:** Read each cited hotspot end-to-end (the citations are already line-exact from the baseline exploration); use Grep/ast-grep only to find ADJACENT callers/tests not yet cited.

**Rationale:** the baseline already produced verified file:line anchors per theme, so the execute phase is mostly deep-Read at known hotspots + tracing one level of callers — not broad re-discovery. Alternative (broad re-scan) wastes budget re-finding what the baseline found.

**Consequences:** fast, citation-dense blueprint; risk = missing a pattern outside the baseline's anchors (mitigated by one caller-trace hop per question).

### D3 — Checkpoint design is synthesis, not promotion

**Decision:** treat the checkpoint helpers (`buildCheckpoint`/`filterFromLatestCheckpoint`/`CHECKPOINT_MARKER`) as a GREENFIELD design synthesized from the reference marker representations (adk-js `isCompactedEvent`, codex `<token_budget>` counter, opencode compaction-part, crewAI `CheckpointConfig`), NOT as promotion of existing SDK code (none exists).

**Rationale:** the baseline confirmed zero checkpoint infra in the SDK. The blueprint must propose a representation grounded in ≥ 2 references, not invent one unfounded.

**Consequences:** Q6 carries extra weight; its recommendation is a from-scratch design proposal, which `/discover-confidence` + the downstream `/to-plan` ADRs will scrutinize.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad map) | Fase B (deep Read at hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How do adk-js + crewAI test compaction triggered at the context-window boundary (keep-recent N / small window)? | tests | adk-js, crewAI | Glob `tests/e2e/context_compaction/*.ts` + `tests/utilities/test_summarize_integration.py` | Read `adk-js/.../e2e_compaction_vertexai_test.ts:24-111` (eventRetentionSize) + `crewAI/.../test_summarize_integration.py:196-230` (small context_window_size) | Table: test → trigger mechanism → what is preserved/asserted, with `reference/...:line` per row |
| Q2 | How does codex test token-budget / context-window transitions + the post-compaction marker? | tests | codex | Grep `token_budget` in `codex-rs/core/tests/suite/` | Read `codex/codex-rs/core/tests/suite/token_budget.rs:83-145,362-364` | Description of the `<token_budget>` window-counter assertions + the "Current context window N" boundary marker + citations |
| Q3 | What dependencies do these compactors pull in — tokenizer lib vs provider-token-based? (SDK target: zero new deps) | deps | adk-js, crewAI | Grep imports in `adk-js/core/src/context/*.ts` + `crewAI/.../agent_utils.py`; read `package.json`/`pyproject.toml` for tokenizer deps | Read the compactor headers for token-counting source (lib import vs provider usage field) | Per-project dep list for compaction + verdict on whether token estimation needs a lib (informs SDK zero-dep decision) |
| Q4 | How is the compactor module structured + exported in adk-js (interface + impls)? | tools | adk-js | Read `core/src/context/base_context_compactor.ts:1-29` + sibling impl files | Read `base_context_compactor.ts` (interface), `token_based_context_compactor.ts`, `truncating_context_compactor.ts`, `context_compactor_request_processor.ts` | Module/export shape (interface + strategy impls) to inform the `./compaction` subpath surface + whether `compactTranscript` is a fn or a strategy object |
| Q5 | COMPACTION ALGORITHM: how do adk-js (token-based vs truncating) and crewAI (LLM-summarize) decide what to drop vs summarize, and what is preserved (system msgs, recent N)? | techniques | adk-js, crewAI | Read the `compact()`/`shouldCompact()` bodies + `summarize_messages` | Read `adk-js/.../token_based_context_compactor.ts` + `truncating_context_compactor.ts` `compact()`; `crewAI/.../agent_utils.py:926` `summarize_messages` + `:699-735` handler | Side-by-side algorithm table (trigger, what-dropped, what-preserved, summarize-vs-truncate) → maps to `compactTranscript({messages,keepTokens,summarize})` signature decision |
| Q6 | CHECKPOINT/MARKER: how is a compaction checkpoint/marker represented so history can be filtered "from the latest checkpoint forward"? | techniques | adk-js, codex, opencode, crewAI | Read marker sites: adk `isCompactedEvent`/`compactedContent`; codex `<token_budget>` counter; opencode compaction-part; crewAI `CheckpointConfig` | Read `adk-js/.../e2e_compaction_vertexai_test.ts:106-111`; `codex/.../token_budget.rs:83-88,362-364`; `opencode/.../message-part.tsx:1531-1545`; `crewAI/.../state/checkpoint_config.py` | Comparison of marker representations (event-field vs string-sentinel vs config-object) → from-scratch proposal for `CHECKPOINT_MARKER` + `buildCheckpoint`/`filterFromLatestCheckpoint` (D3) |
| Q7 | CONTEXT-OVERFLOW DETECTION: how do codex (first-class enum + JSON code) and crewAI (exception + keyword regex) detect context-too-long? | techniques | codex, crewAI | Read `codex-rs/protocol/src/error.rs:83` + `codex-api/src/sse/responses.rs:888-909`; `crewAI/.../context_window_exceeding_exception.py` | Read both detection sites end-to-end | Detection-mechanism comparison (typed code vs message regex) → `isContextOverflowError(err)` predicate design (favor the typed `context_too_long` ErrorCode the SDK already has, like codex; avoid crewAI's message-regex brittleness) |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q1, Q2 | Covered |
| Dependencies | Q3 | Covered |
| Tools | Q4 | Covered |
| Techniques | Q5, Q6, Q7 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | every `.claude/knowledge-base/reference/{project}/{path}` cited for Qx exists | mark Qx BLOCKED "path not found", continue |
| After answering Qx | the Qx blueprint section has ≥ 1 `reference/...:line` citation | re-iterate Qx (1 retry max) |
| Q6 design gate | the `CHECKPOINT_MARKER`/`buildCheckpoint` proposal cites ≥ 2 reference representations | refuse to close Q6 until 2 references are cited (D3) |
| EC-1 shape mapping (Q5/Q6) | the blueprint maps borrowed algorithm/marker onto the SDK's OWN `SDKMessage`/`CompressibleMessage` types, NOT adk `Event` / crewAI dicts | re-iterate; add a shape-mapping ADR before closing Q5/Q6 |
| EC-2 no-duplicate-summarizer (Q4/Q5) | `compactTranscript` explicitly states wrap-vs-new vs the existing internal `compression-*`; does NOT ship a second summarizer | re-iterate; record the delegation decision as an ADR (DRY / Rule 9) |
| Q7 design gate | the `isContextOverflowError` proposal references the SDK's own `context_too_long` ErrorCode AND ≥ 1 reference | re-iterate Q7 |
| Per-project budget | project budget not exhausted | mark remaining Qx BLOCKED "budget exhausted", advance |
| Before promising complete | all 4 corners have populated sections + ≥ 1 ADR | refuse promise, continue |

## Acceptance Criteria

- [ ] All 7 research questions answered OR explicitly marked BLOCKED with reason
- [ ] Every citation resolves to a real path under `.claude/knowledge-base/reference/`
- [ ] Cross-cutting comparison table populated (adk-js / crewAI / codex / opencode)
- [ ] The blueprint proposes concrete signatures for `compactTranscript`, the 3 checkpoint symbols, and `isContextOverflowError`, each backed by ≥ 1 reference (≥ 2 for the greenfield checkpoint design, D3)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## Global Definition of Done

- [ ] `/discover-confidence` scores the resulting blueprint ≥ SHIPPABLE_WITH_CAVEATS (per `rules/discover-blueprint-golden-rule.md`)
- [ ] No fabricated citations (every `reference/...` path resolves via `Path.exists()`)
- [ ] All 4 coverage corners populated in the blueprint
- [ ] Blueprint includes an ADRs section with ≥ 1 ADR per design question (compactTranscript shape, checkpoint representation, overflow predicate, subpath wiring)
