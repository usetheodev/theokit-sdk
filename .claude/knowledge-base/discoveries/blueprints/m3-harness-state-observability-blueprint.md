# Blueprint: M3 Harness State & Observability — Fix Approaches

> **Version 1.0** — Synthesizes how the SDK should close the four M3 state/observability gaps (#62 resume non-lossy + scoped session state, #64 nested spans + metric gap + EventBus error swallowing, #66 artifacts decision documented + token undercount observable, #67 cross-model cache correctness + session revert), informed by our cross-validation sweep against 4 SOTA peers (crewai, mastra, opencode, adk-js) and the current SDK source. Decides the concrete, minimal technique per deliverable and the test strategy. Scope is the ROADMAP M3 DoD — larger adjacent findings (workflow router/cycles, a full ArtifactService, auto cache-breakpoint policy, subagent runtime depth guard) are explicitly deferred with rationale.

**Slug:** `m3-harness-state-observability`
**Source plan:** `.claude/knowledge-base/discoveries/plans/m3-harness-state-observability-plan.md`
**Owner:** paulohenriquevn
**Generated:** 2026-07-03 via `/discover-execute`
**Confidence verdict:** SHIPPABLE (updated by `/discover-confidence`)

## Context

The cross-validation sweep filed four state/observability issue groups at
`.claude/knowledge-base/audits/cross-validation/_issues/09-workflow-session-state.md`,
`.../11-observability-eventbus.md`, `.../14-coverage-gaps.md`, `.../15-other.md`. M0/M1/M2 are
RELEASED; M3 makes resume/state correct and production behavior visible. Most deliverables are
**wiring an already-present capability correctly** (OTel context propagation, the `recordHistogram`
path, `replaceFileAtomic`) or a **narrow correctness fix** (a dropped filter clause, a missing
eligibility check) — not new machinery (KISS + Rule 9). A notable bonus: fixing span nesting (#64)
directly targets the root cause of the flaky `agent-send-parent-span` telemetry test.

## Objective

Let the reader decide the exact minimal technique + test approach for each of the 10 in-scope M3
deliverables, and what to defer.

---

## Coverage Corner 1 — Integration Tests

### mastra — span-tree + metric assertions

- **Pattern**: mastra propagates OTel Context so child spans nest (`packages/core/src/observability/types/tracing.ts:800`, per `_issues/11` finding 3) and emits dedicated histograms (`.../types/metrics.ts:27`, finding 4). Test shape: an in-process OTel collector asserts `child.parentSpanId === parent.spanContext().spanId` for `llm.call`/`tool.call` under `agent.send`; a metric reader asserts `theokit_tool_call_duration_ms` recorded ≥ 1 point. The SDK already has an OTel test collector (`tests/telemetry/helpers/otel-test-collector.ts`) — the span-tree assertion is a new use of it, and it is the same collector whose flakiness the nesting fix should reduce.

### crewai / opencode — observed event errors + workflow resume

- **Pattern**: crewai's event bus logs a swallowed handler error with event key + handler identity (`lib/crewai/src/crewai/events/event_bus.py:359`, per `_issues/11` finding 2); opencode logs with eventID/type (`packages/core/src/event.ts:451`, finding 5). Test: a throwing subscriber → assert a stderr/log line (spy) + an error counter increment, other subscribers still fire. crewai's flow persistence restores accumulated state on resume (`lib/crewai/src/crewai/flow/persistence/sqlite.py:24`, `_issues/09` finding 2). Test: a 3-step workflow suspended at step 2 resumes with step-1's output available, not only the resume payload.

### opencode — session revert

- **Pattern**: opencode truncates a session transcript back to a chosen point (`packages/opencode/src/session/revert.ts:40`, `_issues/15` finding 2). Test: append 4 turns, `truncateSessionTo(id, 2)` → `getMessages` returns the first 2, file rewritten atomically, cache pruned.

---

## Coverage Corner 2 — Dependencies

### Stdlib + already-installed are sufficient (Q11)

| Need | Source | Already present? | Citation |
|---|---|---|---|
| OTel Context propagation | `@opentelemetry/api` `context`/`trace` | YES — already a dep (tracer uses it) | `packages/sdk/src/internal/telemetry/tracer.ts` |
| Metric emission | `recordHistogram` on `TelemetryHandle` | YES — built, used only by memory recall | `tracer.ts` + `active-memory.ts` |
| Atomic transcript rewrite | `replaceFileAtomic` | YES — used by compaction | `packages/sdk/src/internal/persistence/atomic-write.ts` |
| Cross-process lock | `withFileLock` | YES (M2 #63) | `packages/sdk/src/internal/persistence/file-lock.ts` |
| Token undercount signal | WARN + `recordHistogram`/counter | stdlib + existing | n/a |

**Conclusion:** M3 introduces **zero new runtime dependencies**. Token undercount is made *observable*
(WARN + metric), NOT fixed with a new tokenizer dependency — a local tokenizer is deferred (a heavy
dep for an estimate; the honest minimal fix is to stop silently zeroing and surface the gap).

---

## Coverage Corner 3 — Tools

### OTel test collector + fake timers (Q12)

- **Build/test**: `pnpm --filter @theokit/sdk test` (Vitest). Span-tree tests use the existing `tests/telemetry/helpers/otel-test-collector.ts`; metric tests read via an in-memory metric exporter or the collector. Event-error tests spy on `process.stderr.write`.
- **Flake note**: the `agent-send-parent-span` test's intermittent "No span named agent.send" is consistent with the flat-span / lost-context defect (#64 finding 3) — the collector occasionally races on the un-nested, context-detached spans. The nesting fix (context.with) is expected to reduce it. Verify by running the test under load after the fix.
- **CI**: existing GitHub Actions run `pnpm validate`. No new tool.

---

## Coverage Corner 4 — Techniques

### T1 — #62 session resume non-lossy + scoped session state

- **Non-lossy hydration** (`packages/sdk/src/internal/runtime/session/agent-session-store.ts:104-124` `readSessionFile`): the read filters to `user`/`assistant` only, dropping `tool_call`/`tool_result` from the rebuilt context. Widen the filter (and the in-memory `SessionMessage` type) to carry tool turns so a resumed agent keeps its tool history — mirroring what `buildReplayHistory` already preserves (`replay-history.ts`). Backward-compatible: legacy user/assistant lines still load.
- **Scoped session state** (app:/user:/temp:): add a thin scoped-key layer — `scopedSessionKey(scope, agentId)` prefixing the session id with `app:`/`user:`/`temp:` so a consumer can keep app-durable vs user-durable vs ephemeral session data separated; `temp:` scope is pruned on dispose. Minimal public surface, additive.
- **Test**: persist a turn with a tool_call+tool_result → resume → assert the hydrated context includes the tool turns; scoped keys isolate app/user/temp; temp cleared on dispose.
- **Evidence**: `_issues/09` (session read filter; crewai `sqlite.py:24`).

### T2 — #62 workflow resume non-lossy

- **Restore accumulated outputs** (`packages/sdk/src/internal/workflow/executor.ts:370`): resume currently continues from `stepIdx+1` with ONLY the caller `payload` (or `snapshot.accumulatedInput`) as input — prior per-step outputs are "preserved for observability" but not fed back. Restore the snapshot's accumulated step outputs into the resumed context so a step after the suspend sees earlier results.
- **Deferred (documented limitation):** workflow router/cycles (finding 1 — a NEW DAG feature, not "resume lossy") and suspend-inside-parallel/foreach (findings 3/4 — nested-suspend edge cases). Document these as known limitations in `docs.md` rather than expanding M3 into a workflow-engine rewrite (YAGNI).
- **Test**: a 3-step workflow with a suspend at step 2 → resume → step 3 sees step 1's output.
- **Evidence**: `_issues/09` finding 2 (crewai `sqlite.py:24`, mastra).

### T3 — #64 EventBus stops swallowing handler errors

- **Log + count** (`packages/sdk/src/event-bus.ts:30-40` `publish`): the per-handler `catch {}` is empty. Log the swallowed error with the event key + handler identity to stderr (fail-loud per `error-handling.md`) and increment an error counter/metric, WITHOUT breaking the other-handlers-still-fire contract (EC-2 preserved).
- **Test**: a throwing subscriber → assert a stderr line naming the event + the error, other subscribers still fire, counter incremented. (negative case — proves fail-loud.)
- **Evidence**: `_issues/11` findings 2+5 (crewai `event_bus.py:359`, opencode `event.ts:451`).

### T4 — #64 nested spans (OTel context propagation)

- **Propagate parent** (`packages/sdk/src/internal/telemetry/tracer.ts:230`): `startChildSpan: (_parent, name, attrs) => startNewSpan(name, attrs)` ignores the parent. Capture the parent's context via `trace.setSpan(context.active(), parent)` and start the child within it (`tracer.startSpan(name, {}, ctx)`), and wrap the agent loop in `context.with(ctx, ...)` so context survives awaits. Result: `llm.call`/`tool.call`/`memory.recall` nest under `agent.send`.
- **Bonus**: expected to reduce the `agent-send-parent-span` flake (spans no longer detached siblings racing the collector).
- **Test**: assert `child.parentSpanId === parentSpan.spanContext().spanId` for a tool call under agent.send (span-tree). Re-run `agent-send-parent-span` under load post-fix.
- **Evidence**: `_issues/11` finding 3 (mastra `tracing.ts:800`).

### T5 — #64 metric histograms (close the wiring-triad pillar-c gap)

- **Emit measured values** (`packages/sdk/src/internal/telemetry/span-names.ts:38` + call sites): tool duration is computed (`tool-dispatch.ts:278`) but only handed to hooks; LLM latency/tokens are span-attributes only. Add `theokit_tool_call_duration_ms`, `theokit_llm_call_duration_ms` histograms + a `theokit_llm_tokens` counter to `HISTOGRAM_NAMES`/`COUNTER_NAMES` and emit via the existing `recordHistogram` path where the values are already measured.
- **Test**: an in-memory metric reader asserts each histogram/counter records ≥ 1 point after a send with a tool call.
- **Evidence**: `_issues/11` finding 4 (mastra `metrics.ts:27`).

### T6 — #66 token undercount observable + artifacts decision documented

- **Undercount observable** (`packages/sdk/src/internal/agent-loop/loop-llm-stream.ts:105` + `usage-accumulator.ts:32`): the `?? 0` coercion hides "provider omitted usage" as "0 tokens". When a finish carries `undefined` input/output tokens, emit a WARN + a `theokit_llm_usage_missing` counter so budget undercount is observable rather than silent. No tokenizer dependency (deferred — a local estimate is a heavier YAGNI; the ROADMAP DoD's "fixed" is satisfied by making the silent gap loud + measurable).
- **Artifacts decision documented** (`docs.md`): state plainly that artifacts are a cloud-only, pre-release surface (fixture stub on `CloudAgent`; `LocalAgent` throws `NotSupportedError`); a first-class local `ArtifactService` (adk-js-style versioned/namespaced) is deferred, and the reason. This is the DoD ("artifacts decision documented"), not a service build.
- **Test**: a finish with missing usage → WARN emitted + counter incremented (spy); a finish with usage → no WARN.
- **Evidence**: `_issues/14` findings 1+2 (mastra `model.ts:301`, adk-js `base_artifact_service.ts:105`).

### T7 — #67 cross-model semantic cache correctness + session revert

- **Model-scoped eligibility** (`packages/sdk-cache/src/internal/store.ts:74` `isEligibleForSearch` + `semanticSearch`): the composite KV key includes `modelId` (`key.ts:22`) but the semantic path filters only on embedderId/namespace/dim/expiry — two models sharing an embedder can return each other's cached response. Thread `modelId` into `semanticSearch` + add `e.modelId !== modelId → false` to `isEligibleForSearch` (store `modelId` on `CacheEntry`, or parse from the key). Gate with an explicit cross-model flag if a consumer wants the old behavior.
- **Session revert** (`packages/sdk/src/internal/runtime/session/`): add `truncateSessionTo(agentId, messageIndex)` rewriting the JSONL atomically (reuse `replaceFileAtomic` + `withFileLock`) and pruning the in-memory cache — a transcript-only "undo last turn(s)". Defer git file-restore (a separate optional snapshot primitive).
- **Deferred (documented):** auto prompt-cache breakpoint (finding 3 — a NEW cache-policy feature, not "cross-model correctness" or "revert"; YAGNI).
- **Test**: two models sharing an embedder → model B query does NOT return model A's semantic hit; `truncateSessionTo` truncates + persists atomically + prunes cache.
- **Evidence**: `_issues/15` findings 1+2 (mastra `inmemory.ts:1`, opencode `revert.ts:40`).

---

## Cross-cutting Comparison

| Deliverable | New machinery? | Reused primitive | Public API change | Notes |
|---|---|---|---|---|
| #62 non-lossy hydration | no (widen filter) | SessionMessage roles | minor (tool turns in context) | back-compat |
| #62 scoped state | small (key layer) | session store | additive (scope param) | temp pruned on dispose |
| #62 workflow resume | no (restore snapshot) | executor snapshot | none | nested-suspend deferred |
| #64 EventBus log | no | stderr + counter | none | EC-2 preserved |
| #64 nested spans | no (context.with) | `@opentelemetry/api` | none | targets the flake |
| #64 metrics | small (histogram names) | `recordHistogram` | new metric names (additive) | pillar-c |
| #66 undercount | no (WARN+counter) | recordHistogram | new metric (additive) | no tokenizer dep |
| #66 artifacts doc | no | — | docs only | decision, not service |
| #67 cache modelId | no (filter clause) | CacheEntry | none (correctness) | cross-model flag opt |
| #67 session revert | small | replaceFileAtomic/withFileLock | additive method | transcript-only |

---

## ADRs

### D1 — #62: non-lossy session hydration + scoped state; workflow resume restores accumulated outputs; defer router/cycles + nested-suspend

**Decision:** widen `readSessionFile` to include tool turns; add `app:/user:/temp:` scoped session keys; restore the workflow snapshot's accumulated outputs on resume. Defer workflow router/cycles + suspend-in-parallel/foreach as documented limitations.
**Rejected alternatives:** (a) full workflow state-machine rewrite (router + join + nested-suspend) — a large NEW DAG feature beyond "resume no longer lossy" (YAGNI); document the limitation instead. (b) keep the user/assistant-only filter and document lossy resume — rejected; the ROADMAP DoD says resume "no longer lossy". (c) a heavyweight scoped-state store — the thin key-prefix layer is KISS.
**Rule basis:** ROADMAP scope (YAGNI), Rule 9 (reuse replay-history role handling), `no-stubs-no-mocks-no-wired`.

### D2 — #64: OTel context propagation for nested spans; EventBus fail-loud; emit measured metrics

**Decision:** `startChildSpan` starts the child within `trace.setSpan(context.active(), parent)` and the loop runs in `context.with(...)`; EventBus logs + counts swallowed handler errors; add tool/llm duration histograms + token counter via `recordHistogram`.
**Rejected alternatives:** (a) leave spans flat — a trace backend cannot reconstruct causality; also the likely root of the telemetry flake. (b) rethrow handler errors from EventBus — breaks the other-handlers-still-fire contract (EC-2); log+count is the fail-loud-without-breaking middle. (c) a full metrics SDK — the existing `recordHistogram` path suffices.
**Rule basis:** Rule 8 (fail-loud), Rule 9 (reuse OTel context + recordHistogram), mastra prior art.

### D3 — #66: token undercount made observable (no tokenizer dep); artifacts decision documented

**Decision:** on missing provider usage, WARN + increment `theokit_llm_usage_missing`; document artifacts as cloud-only/pre-release with a deferred local `ArtifactService`.
**Rejected alternatives:** (a) ship a local tokenizer estimate (gpt-tokenizer / tiktoken) — a heavy new dependency for an approximation; the DoD "fixed" is met by making the silent undercount loud + measurable (Rule 9 / no-new-dep). (b) build the ArtifactService now — the ROADMAP DoD says "documented", not "implemented" (YAGNI).
**Rule basis:** YAGNI, Rule 9 (no new dep), Rule 3 (honest documentation of a deferred surface).

### D4 — #67: model-scoped semantic-cache eligibility; transcript-only session revert; defer cache-breakpoint

**Decision:** add `modelId` to `isEligibleForSearch`/`semanticSearch`; add `truncateSessionTo` (atomic JSONL rewrite + cache prune). Defer auto prompt-cache breakpoint.
**Rejected alternatives:** (a) rely on the KV key alone — the semantic path bypasses it (the actual bug). (b) git-backed session revert — the transcript half needs no git; `replaceFileAtomic` suffices (opencode notes the same). (c) auto cache-breakpoint policy — a NEW optimization, not #67's correctness/revert theme (YAGNI).
**Rule basis:** correctness (cross-model false hit), Rule 9 (reuse replaceFileAtomic/withFileLock), YAGNI.

## Recommendations for the project

1. Order: #64 first (nested spans may stabilize the telemetry flake early + unblock confident metric tests) → #67 (self-contained correctness) → #66 (small) → #62 (session + workflow, do last — touches the session store + executor).
2. Fix span nesting BEFORE adding the span-tree test, and re-run `agent-send-parent-span` under load to confirm the flake reduction (turns a known flake into a validated fix).
3. Every new public surface (scoped-state, `truncateSessionTo`, new metric names, non-lossy hydration, artifacts decision) lands in `docs.md` + a Changeset in the same slice. `#62` scoped-state is the one flagged public-API change (ROADMAP top-risk).
4. Keep deferred items (router/cycles, ArtifactService, cache-breakpoint, subagent runtime depth guard) documented as known limitations — honest scope, not silent omission.

## Blocked questions (if any)

(none — every question answered with a verified SDK path + cross-validation finding.)

## Halt-loop progress (audit trail)

12/12 research questions answered from the cross-validation `_issues/*.md` + verified SDK source. Four corners populated. 4 ADRs. Zero fabricated citations.

## Related

- Discovery plan: `.claude/knowledge-base/discoveries/plans/m3-harness-state-observability-plan.md`
- Cross-validation issues: `.claude/knowledge-base/audits/cross-validation/_issues/09-workflow-session-state.md`, `.../11-observability-eventbus.md`, `.../14-coverage-gaps.md`, `.../15-other.md`
- ROADMAP: `theokit-sdk/ROADMAP.md` M3 (owns) + ecosystem `theokit-tools/ROADMAP.md` M3
