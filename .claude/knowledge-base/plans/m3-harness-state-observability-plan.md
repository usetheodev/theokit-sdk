---
slug: m3-harness-state-observability
milestone_id: M3
created_at: 2026-07-03
goal: Close the four M3 state/observability gaps so resume is non-lossy, spans nest, metrics/errors are visible, and cross-model cache is correct — verified by new failing-first tests for tool-turn hydration, scoped state, workflow-resume restore, span-tree nesting, EventBus fail-loud, emitted metrics, usage-undercount WARN, model-scoped cache, and session revert.
---

# Plan: M3 Harness State & Observability

## Goal

Correct resume/state semantics and make production behavior visible so defects #62, #64, #66, #67
are closed: session + workflow resume keep their history, telemetry spans nest under a parent, the
EventBus fails loud, tool/LLM durations + tokens emit as metrics, a silent token undercount becomes
observable, the semantic cache is model-scoped, and a session transcript can be reverted — each
proven by a new failing-first test.

**Metric:** all new RED tests for the 10 deliverables pass GREEN; full `@theokit/sdk` suite stays
green; `pnpm validate` gates pass.

## Baseline Context

### Files that will be touched

| File | LoC | Last sha | Role today |
|---|---|---|---|
| `packages/sdk/src/event-bus.ts` | 53 | `ec35de5` 2026-06-11 | `publish` (`:30-40`) has an empty per-handler `catch {}` — swallows handler errors |
| `packages/sdk/src/internal/telemetry/tracer.ts` | 306 | `73895a5` 2026-06-11 | `startChildSpan` (`:230`) ignores its parent → flat spans; `recordHistogram` present |
| `packages/sdk/src/internal/telemetry/span-names.ts` | 42 | `42a3763` 2026-06-07 | only `MEMORY_RECALL_DURATION_MS` histogram declared |
| `packages/sdk/src/internal/agent-loop/tool-dispatch.ts` | 422 | `01b4edd` 2026-07-02 | tool duration computed (`:278`) but only handed to hooks — no metric |
| `packages/sdk/src/internal/agent-loop/loop-llm-stream.ts` | 243 | `8b411c5` 2026-06-29 | LLM latency/tokens span-attrs only; `?? 0` usage coercion (`:105`) |
| `packages/sdk/src/internal/runtime/session/agent-session-store.ts` | 257 | `25eb64f` 2026-07-02 | `readSessionFile` (`:104-124`) filters to user/assistant only — drops tool turns |
| `packages/sdk/src/internal/runtime/session/agent-session.ts` | — | — | session keying (`sessionKey`) has no scope prefix; calls `readSessionFile` |
| `packages/sdk/src/internal/workflow/executor.ts` | 385 | `8f928dd` 2026-05-25 | resume (`:370`) continues from stepIdx+1 with payload only — accumulated outputs not fed back |
| `packages/sdk-cache/src/internal/store.ts` | 185 | `f67ed6d` 2026-06-08 | `isEligibleForSearch` (`:74-86`) omits modelId → cross-model semantic false hit |

### Current callers / dependents

- `readSessionFile` ← `agent-session.ts` (`hydrateSession`), `agent-session-store.ts`.
- `startChildSpan` ← only `tracer.ts` (never called at a span site — nesting requires context propagation at the `startSpan` call sites in `loop.ts`/`tool-dispatch.ts`/`loop-llm-stream.ts`).
- `semanticSearch` ← `sdk-cache/src/internal/lookup.ts`, `store-json.ts`, `store.ts`.
- `event-bus` `publish` ← EventBus subscribers across the runtime (agent lifecycle events).
- workflow `resume` ← `packages/sdk/src/internal/workflow/` public workflow surface.

### Domain glossary

- **OTel Context**: the `@opentelemetry/api` `context` that carries the active span across awaits; `context.with(ctx, fn)` runs `fn` with `ctx` active so `trace.getSpan(context.active())` returns the parent.
- **Span nesting**: a child span whose `parentSpanId` equals the parent's `spanId` — reconstructs the causal trace tree.
- **Scoped session state**: an `app:`/`user:`/`temp:` prefix on a session key separating app-durable, user-durable, and ephemeral session data; `temp:` is pruned on dispose.
- **Semantic cache eligibility**: the filter deciding whether a stored cache entry may match a query vector; must include `modelId` so model B never returns model A's response.
- **Token undercount**: provider omitting `usage` on a finish, coerced to `0`, silently under-reporting budget consumption.

### Architecture boundaries affected

`internal/telemetry/` owns OTel context + metric emission; span-creation call sites (loop/tool/llm)
consume it — they must NOT each build their own tracer. `event-bus.ts` is a leaf util; its fail-loud
logging goes to stderr (no new dep). `sdk-cache` is a separate package; the modelId fix stays within
it. Session revert + scoped state live in `internal/runtime/session/`, reusing `replaceFileAtomic` +
`withFileLock` from `internal/persistence/`.

## Prior Art & Related Work

- Blueprint: `.claude/knowledge-base/discoveries/blueprints/m3-harness-state-observability-blueprint.md` (SHIPPABLE 98.3).
- Cross-validation issues: `.claude/knowledge-base/audits/cross-validation/_issues/09-workflow-session-state.md`, `.../11-observability-eventbus.md`, `.../14-coverage-gaps.md`, `.../15-other.md` (peer file:line embedded: mastra `tracing.ts:800`/`metrics.ts:27`/`model.ts:301`, crewai `event_bus.py:359`, opencode `event.ts:451`/`revert.ts:40`).

## ADRs

### D1 — #64: OTel context propagation (nested spans), EventBus fail-loud, emit measured metrics

**Decision:** propagate the parent span's context (`trace.setSpan(context.active(), parent)` + `context.with`) so child spans nest; log + count swallowed EventBus handler errors (EC-2 preserved); add `theokit_tool_call_duration_ms` / `theokit_llm_call_duration_ms` histograms + `theokit_llm_tokens` counter via the existing `recordHistogram` path.
**Rejected alternatives:** (a) leave spans flat — no causal tree; also the likely root of the `agent-send-parent-span` flake. (b) rethrow EventBus handler errors — breaks the other-handlers-still-fire EC-2 contract; log+count is fail-loud without breaking. (c) a full metrics SDK — `recordHistogram` already exists (Rule 9).
**Rule basis:** Rule 8 (fail-loud), Rule 9 (reuse OTel context + recordHistogram), `architecture.md` (telemetry owns context).

### D2 — #67: model-scoped semantic-cache eligibility + transcript-only session revert

**Decision:** thread `modelId` into `semanticSearch` + add `e.modelId !== modelId → false` to `isEligibleForSearch`; add `truncateSessionTo(agentId, index)` (atomic JSONL rewrite via `replaceFileAtomic` + `withFileLock`, cache pruned).
**Rejected alternatives:** (a) rely on the KV key alone — the semantic path bypasses it (the bug). (b) git-backed revert — the transcript needs no git (opencode notes the same). (c) auto cache-breakpoint — a NEW optimization, not #67's theme (YAGNI).
**Rule basis:** correctness, Rule 9 (reuse `replaceFileAtomic`/`withFileLock`), YAGNI.

### D3 — #66: token undercount made observable (no tokenizer dep); artifacts decision documented

**Decision:** on missing provider usage, WARN + increment `theokit_llm_usage_missing`; document artifacts as cloud-only/pre-release with a deferred local `ArtifactService` in `docs.md`.
**Rejected alternatives:** (a) ship a local tokenizer — a heavy new dep for an estimate; DoD "fixed" is met by making the silent gap loud + measurable (Rule 9). (b) build the ArtifactService — DoD says "documented", not "implemented" (YAGNI).
**Rule basis:** YAGNI, Rule 9 (no new dep), Rule 3 (honest documentation).

### D4 — #62: non-lossy session hydration + scoped state + workflow-resume restore; defer router/cycles + nested-suspend

**Decision:** widen `readSessionFile` to include tool turns; add `app:/user:/temp:` scoped session keys; restore the workflow snapshot's accumulated outputs on resume. Defer workflow router/cycles + suspend-in-parallel/foreach as documented limitations.
**Rejected alternatives:** (a) full workflow DAG rewrite — beyond "resume no longer lossy" (YAGNI). (b) keep user/assistant-only + document lossy — DoD says "no longer lossy". (c) heavyweight scoped-state store — the key-prefix layer is KISS.
**Rule basis:** ROADMAP scope (YAGNI), Rule 9, `no-stubs-no-mocks-no-wired`.

## Dependency Graph

Phases 1–4 are independent (distinct files) and may run in any order; Phase 5 (integration
validation) depends on all. Recommended order 1(#64)→2(#67)→3(#66)→4(#62)→5 — #64 first because the
span-nesting fix targets the pre-existing telemetry flake early.

## Phase 1 — #64: nested spans + EventBus fail-loud + metrics

### T1.1 — OTel context propagation so child spans nest
#### Why this step
Action: capture the parent context and start child spans within it; wrap the loop in `context.with`.
Reasoning: `startChildSpan` ignores its parent and span sites use flat `startSpan`, so every span is a
root sibling — a backend cannot reconstruct causality, and the detached spans are the likely root of
the `agent-send-parent-span` flake (`_issues/11` finding 3) — ADR D1.
#### Files to edit
- `packages/sdk/src/internal/telemetry/tracer.ts` (real `startChildSpan` via context), span-creation sites in `packages/sdk/src/internal/agent-loop/loop.ts` / `tool-dispatch.ts` / `loop-llm-stream.ts` (nest children under the run span).
#### TDD
- RED `test_child_span_nests_under_parent`: a tool.call span emitted during agent.send has `parentSpanId === agentSend.spanId` (via the OTel test collector).
- RED `test_agent_send_span_stable_under_repeat`: run the send path N times; `agent.send` span is present every time (guards the flake root).
#### Concurrency tests
Context propagation across `await` is the concern: `context.with` must keep the parent active across the loop's async boundaries. Assert nesting holds when a tool call `await`s. cancellation propagation of the run signal is unaffected. Deterministic via the in-process collector.
#### Acceptance criteria
Child spans (`tool.call`, `llm.call`, `memory.recall`) nest under `agent.send`; the collector sees `agent.send` on every repeat.
#### DoD
`pnpm --filter @theokit/sdk test tests/telemetry/**` green; typecheck clean; changeset added.

### T1.2 — EventBus stops swallowing handler errors
#### Why this step
Action: log the swallowed error + increment an error counter in `publish`'s catch. Reasoning: the
empty `catch {}` violates fail-loud (`_issues/11` findings 2+5) — ADR D1.
#### Files to edit
- `packages/sdk/src/event-bus.ts`
#### TDD
- RED `test_eventbus_logs_swallowed_handler_error`: a throwing subscriber → stderr line naming the event + error (spy); other subscribers still fire (EC-2 preserved).
#### Concurrency tests
(none — single-threaded).
#### Acceptance criteria
A throwing handler is logged (event key + message) + counted; sibling handlers still fire.
#### DoD
`pnpm --filter @theokit/sdk test tests/**/event-bus*` green; typecheck clean.

### T1.3 — Emit tool/LLM duration + token metrics
#### Why this step
Action: add histogram/counter names + emit via `recordHistogram` where durations/tokens are measured.
Reasoning: values are measured but never emitted — wiring-triad pillar-c gap (`_issues/11` finding 4) — ADR D1.
#### Files to edit
- `packages/sdk/src/internal/telemetry/span-names.ts` (new metric names), `tool-dispatch.ts` (emit tool duration), `loop-llm-stream.ts` (emit llm duration + tokens)
#### TDD
- RED `test_tool_call_duration_metric_emitted`: an in-memory metric reader records ≥ 1 point for `theokit_tool_call_duration_ms` after a tool call.
- RED `test_llm_metrics_emitted`: `theokit_llm_call_duration_ms` + `theokit_llm_tokens` record after a send.
#### Concurrency tests
(none — single-threaded).
#### Acceptance criteria
Each new histogram/counter records ≥ 1 point on the exercised path; no LoC-budget regression (extract if tool-dispatch/loop-llm-stream would exceed 400 SLOC).
#### DoD
`pnpm --filter @theokit/sdk test tests/**/telemetry* tests/**/metric*` green; typecheck clean; loc gate green.

## Phase 2 — #67: cross-model cache + session revert

### T2.1 — Model-scoped semantic-cache eligibility
#### Why this step
Action: thread `modelId` into `semanticSearch`/`isEligibleForSearch`. Reasoning: the semantic path
filters on embedderId/namespace/dim/expiry but NOT modelId, so model B can return model A's response
(`_issues/15` finding 1) — ADR D2.
#### Files to edit
- `packages/sdk-cache/src/internal/store.ts` (+ `store-json.ts`, `lookup.ts` call sites; `CacheEntry` carries modelId or parses it from the key)
#### TDD
- RED `test_semantic_search_excludes_other_model`: two entries, same embedder+namespace, different modelId → a query for model B does NOT return model A's entry.
- RED `test_semantic_search_matches_same_model`: same modelId still matches (regression).
#### Concurrency tests
(none — single-threaded).
#### Acceptance criteria
Semantic hit requires modelId equality; same-model hits preserved.
#### DoD
`pnpm --filter @theokit/sdk-cache test` green; typecheck clean.

### T2.2 — Session transcript revert (truncateSessionTo)
#### Why this step
Action: add `truncateSessionTo(agentId, index)` rewriting the JSONL atomically + pruning the cache.
Reasoning: only clearSession (all) + compaction (oldest) exist — no "undo to turn N" (`_issues/15`
finding 2) — ADR D2.
#### Files to edit
- `packages/sdk/src/internal/runtime/session/agent-session-store.ts` (+ `agent-session.ts` cache prune; public surface on the session adapter/Agent)
#### TDD
- RED `test_truncate_session_to_keeps_prefix`: append 4 turns, `truncateSessionTo(id, 2)` → read returns first 2, file rewritten (atomic), cache pruned.
- RED `test_truncate_session_out_of_range_is_safe`: index ≥ length → no-op; index 0 → empties transcript. (edge/negative)
#### Concurrency tests
Rewrite happens under `withFileLock` (reused from M2 #63) so a concurrent append cannot tear the truncated file — atomic-counter invariant on the resulting line count. race condition between truncate and append is serialized by the lock.
#### Acceptance criteria
Truncation keeps the prefix, persists atomically, prunes the cache; out-of-range is safe.
#### DoD
`pnpm --filter @theokit/sdk test tests/**/session* tests/**/truncate*` green; typecheck clean.

## Phase 3 — #66: token undercount observable + artifacts doc

### T3.1 — Token undercount observable (WARN + metric)
#### Why this step
Action: on missing provider usage, WARN + increment `theokit_llm_usage_missing` instead of silently
coercing to 0. Reasoning: `?? 0` hides provider silence as 0 tokens → silent budget undercount
(`_issues/14` finding 2) — ADR D3.
#### Files to edit
- `packages/sdk/src/internal/agent-loop/loop-llm-stream.ts` (detect undefined usage → WARN + counter), `span-names.ts` (counter name)
#### TDD
- RED `test_missing_usage_emits_warn_and_counter`: a finish with `inputTokens/outputTokens === undefined` → WARN (stderr spy) + counter incremented.
- RED `test_present_usage_no_warn`: usage present → no WARN, tokens counted normally. (regression)
#### Concurrency tests
(none — single-threaded).
#### Acceptance criteria
Missing usage is loud + measurable; present usage unaffected. No new dependency (no tokenizer).
#### DoD
`pnpm --filter @theokit/sdk test tests/**/usage* tests/**/budget*` green; typecheck clean.

### T3.2 — Artifacts scope decision documented
#### Why this step
Action: document the artifacts decision in `docs.md`. Reasoning: the ROADMAP DoD is "artifacts
decision documented" — artifacts are cloud-only fixture stub today; local throws NotSupported; a
first-class ArtifactService is deferred (`_issues/14` finding 1) — ADR D3.
#### Files to edit
- `docs.md` (artifacts section: cloud-only/pre-release, local NotSupported, ArtifactService deferred + why)
#### TDD
- (docs-only) verification: `grep` asserts `docs.md` states the artifacts scope decision + the deferral rationale.
#### Concurrency tests
(none — single-threaded).
#### Acceptance criteria
`docs.md` documents: artifacts are cloud-only/pre-release; local throws NotSupported; local ArtifactService deferred with reason.
#### DoD
public-copy lint passes; the artifacts decision is present in `docs.md`.

## Phase 4 — #62: non-lossy resume + scoped state

### T4.1 — Non-lossy session hydration (include tool turns)
#### Why this step
Action: widen `readSessionFile` to carry tool_call/tool_result turns into the rebuilt context.
Reasoning: the user/assistant-only filter drops tool history on resume (`_issues/09`, `agent-session-store.ts:104`) — ADR D4.
#### Files to edit
- `packages/sdk/src/internal/runtime/session/agent-session-store.ts` (`readSessionFile` + `SessionMessage` role), `agent-session.ts` (hydrate path), `session-types.ts` (role widening)
#### TDD
- RED `test_resume_includes_tool_turns`: persist user+assistant+tool_call+tool_result → `readSessionFile` returns all 4 in order (was: 2).
- RED `test_legacy_user_assistant_still_loads`: legacy 2-role JSONL still hydrates. (regression/back-compat)
#### Concurrency tests
(none — single-threaded).
#### Acceptance criteria
Hydration includes tool turns; legacy files unaffected.
#### DoD
`pnpm --filter @theokit/sdk test tests/**/session* tests/**/resume*` green; typecheck clean.

### T4.2 — Scoped session state (app:/user:/temp:)
#### Why this step
Action: add scoped session keys (`app:`/`user:`/`temp:` prefix) with `temp:` pruned on dispose.
Reasoning: no scoped state exists; ROADMAP DoD requires it — ADR D4. **Public API change → docs.md + Changeset.**
#### Files to edit
- `packages/sdk/src/internal/runtime/session/agent-session.ts` (scoped keying), public surface + type, `docs.md`
#### TDD
- RED `test_scoped_state_isolated_per_scope`: same agentId, `app:`/`user:`/`temp:` scopes keep separate transcripts.
- RED `test_temp_scope_pruned_on_dispose`: `temp:` scope cleared on dispose; `app:`/`user:` persist. (negative/lifecycle)
#### Concurrency tests
(none — single-threaded).
#### Acceptance criteria
Scopes isolate state; temp pruned on dispose; documented in docs.md.
#### DoD
`pnpm --filter @theokit/sdk test tests/**/scope*` green; typecheck clean; docs.md updated.

### T4.3 — Workflow resume restores accumulated outputs
#### Why this step
Action: feed the snapshot's accumulated step outputs into the resumed context. Reasoning: resume
continues from stepIdx+1 with payload only — prior outputs lost (`executor.ts:370`, `_issues/09`
finding 2) — ADR D4.
#### Files to edit
- `packages/sdk/src/internal/workflow/executor.ts` (restore accumulated outputs on resume)
#### TDD
- RED `test_workflow_resume_sees_prior_step_output`: 3-step workflow suspended at step 2 → resume → step 3 sees step 1's output (was: only payload).
#### Concurrency tests
(none — single-threaded).
#### Acceptance criteria
A resumed step sees prior step outputs; router/cycles + nested-suspend documented as deferred limitations.
#### DoD
`pnpm --filter @theokit/sdk test tests/**/workflow*` green; typecheck clean; loc gate green (executor near budget — extract if needed).

## Failure scenarios

| External dependency | Failure mode | Test reproduces | Expected behavior |
|---|---|---|---|
| LLM provider | omits `usage` on finish | mock finish with undefined tokens | WARN + `theokit_llm_usage_missing` counter (not silent 0) |
| EventBus subscriber | handler throws | throwing subscriber | logged + counted; siblings still fire |
| Telemetry backend | span context lost across await | tool call awaits mid-send | child still nests under parent |
| Semantic cache | two models, one embedder | model B query vs model A entry | no cross-model hit |
| Filesystem (transcript) | truncate races an append | concurrent truncate + append | `withFileLock` serializes; no torn file |

## Coverage Matrix

| Requirement (ROADMAP M3 DoD) | Task(s) |
|---|---|
| #64 nested spans (not flat) | T1.1 |
| #64 EventBus stops swallowing errors | T1.2 |
| #64 metric gap closed | T1.3 |
| #67 cross-model cache correctness | T2.1 |
| #67 session revert | T2.2 |
| #66 token undercount fixed (observable) | T3.1 |
| #66 artifacts decision documented | T3.2 |
| #62 resume no longer lossy (session tool turns) | T4.1 |
| #62 scoped session state (app:/user:/temp:) | T4.2 |
| #62 workflow resume no longer lossy | T4.3 |

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Scoped-state is a public-API change (ROADMAP top-risk) | MEDIUM | additive surface; docs.md + Changeset; back-compat default scope | paulohenriquevn |
| Span-nesting may need an OTel context refactor across the loop (ROADMAP top-risk) | MEDIUM | reuse `@opentelemetry/api` `context.with` (already a dep); scope to span sites; span-tree test | paulohenriquevn |
| `tool-dispatch.ts` (422) / `executor.ts` (385) near/over the 400 SLOC budget | MEDIUM | minimal additions; extract a helper if a change pushes SLOC over (G8 gate) | paulohenriquevn |
| Widening `SessionMessage` roles could break in-memory consumers | LOW | back-compat: legacy loads unchanged; regression test | paulohenriquevn |
| Non-lossy hydration changes replayed context shape | LOW | mirror `buildReplayHistory`'s existing tool-turn handling; golden test | paulohenriquevn |

## Unresolved Questions

(none — every decision is resolved at plan time; ADR D4 explicitly scopes router/cycles, nested-suspend, ArtifactService, and cache-breakpoint OUT with rationale.)

## Global DoD

- Every task's RED test written first and passing GREEN.
- Full `@theokit/sdk` suite green; `pnpm typecheck` clean; Biome clean; knip clean; loc gate green.
- New public surface (scoped state, `truncateSessionTo`, non-lossy hydration, new metric names, artifacts decision) documented in `docs.md`.
- Changesets added (minor) per issue.
- No new runtime dependency.
- No file exceeds the 400 SLOC budget after edits.

## Final Phase: Integration Validation

- `pnpm --filter @theokit/sdk test` (full suite) green.
- `pnpm validate` (build/typecheck/test/knip/publint/attw/loc/depcruise/cycles/duplication/bundle) green.
- Failure-scenarios pass: missing-usage WARN, EventBus-error log, span nesting, cross-model cache, truncate-under-lock.
- Re-run `agent-send-parent-span` under load post-#64 to confirm the span-nesting fix reduces the flake.
- `/code-quality m3-harness-state-observability` → PASS/PASS_WITH_CAVEATS.
