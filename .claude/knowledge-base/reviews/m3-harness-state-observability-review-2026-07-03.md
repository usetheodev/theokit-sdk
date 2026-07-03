# Review: m3-harness-state-observability

**Date:** 2026-07-03
**Reviewers (spawned agents):** 1 comprehensive (architecture + wiring + tests + correctness + honesty)
**Findings:** 0 BLOCKER · 1 HIGH · 4 MEDIUM · 2 LOW — all remediated or documented
**Verdict:** READY_TO_MERGE

## Scope

M3 Harness state & observability — 4 issues, 10 deliverables, all TDD-first:
- **#64** — nested spans (OTel context propagation), EventBus fail-loud, tool/LLM/token metrics.
- **#66** — token undercount observable (WARN + metric), artifacts scope decision documented.
- **#67** — cross-model semantic-cache correctness, session revert (`truncateConversation`).
- **#62** — non-lossy session hydration (tool turns), scoped session state (app:/user:/temp:), non-lossy workflow resume.

## Findings & resolutions (remediated in `67e07eb`)

### HIGH
- **H1 — span-nesting shipped without an end-to-end wiring test.** The unit test only exercised the tracer mechanism, not the production threading (`ctx.sendSpan` → `llm.call`/`tool.call`). → Added `span-nesting-e2e.test.ts`: drives `runAgentLoop` with a mock LLM + a tool call + a real `createTelemetry` handle + the OTel collector, asserting `llm.call.parentSpanId === agent.send.spanId` AND `tool.call.parentSpanId === agent.send.spanId`. Deleting any threading line now fails a test.

### MEDIUM
- **M2 — non-lossy hydration only wired for the FS adapter.** `readPersistedForCache`'s non-FS branch still filtered to user/assistant. → Now folds tool turns for non-FS/custom/in-memory adapters too (`foldStoredToSession` helper) — parity with `readSessionFile`.
- **M3 — workflow router/cycles + nested-suspend resume deferral undocumented.** → docs.md now states resume of router/cycle workflows and suspend-in-parallel/branch/foreach is deferred.
- **M4 — `temp` auto-prune-on-dispose not implemented.** Delivered a manual `deleteScope`. → docs.md now states pruning is explicit and auto-prune-on-dispose is deferred (honest, not a silent drop).
- **M5 — `initialStepResults` leaked onto the public `WorkflowRunOptions`.** A consumer could inject fabricated prior step outputs into a fresh run. → Moved to an internal seam (cast at the `resumeWorkflow` boundary); removed from the public type.

### LOW
- **L1 — in-memory session cache not pruned by revert.** `truncateSessionTo` rewrites the JSONL; the module-level `sessions` Map is not pruned (staleness bounded by re-hydration; the documented revert surface is the adapter, which has no per-turn cache). Accepted as a documented low-impact limitation; follow-up candidate.
- **L2 — scope docstring inconsistencies (`temp:` vs `temp__`).** → Corrected `conversation-storage.ts` + `session-scope.ts` docstrings to the `__` separator.

### INFO — verified OK (by the reviewer)
Cross-model cache (modelId excludes other-model without breaking same-model, regression tested); `startChildSpan` undefined/NOOP-parent → safe root fallback via explicit `trace.setSpanContext` (works without a ContextManager); EventBus EC-2 preserved after log+count; hydration folding leaves legacy user/assistant unchanged + doesn't corrupt message shape; metrics + usage-undercount emitted through the real loop; session revert atomic under `withFileLock`; deferrals (ArtifactService, mid-call tool_use reconstruction, auto cache-breakpoint) honestly documented.

## Cross-validation (deliverable → commit → test)
| Deliverable | Commit | Test | Covered |
|---|---|---|---|
| #64 nested spans | 4af68fc/67e07eb | span-nesting + span-nesting-e2e | yes (mechanism + e2e) |
| #64 EventBus fail-loud | 4af68fc | event-bus-faillouder | yes |
| #64 metrics | b4cc298 | metrics-emitted | yes |
| #66 token undercount | b4cc298 | metrics-emitted (usage-missing) | yes |
| #66 artifacts decision | 81ae33a | docs.md (documented decision) | yes |
| #67 cross-model cache | 08539f0 | store.test (exclude + same-model) | yes |
| #67 session revert | 08539f0 | conversation-storage-batch (truncate) | yes |
| #62 non-lossy hydration | 3eca862/67e07eb | resume-tool-turns (+ non-FS parity fix) | yes |
| #62 scoped state | 81ae33a | scoped-session-state | yes |
| #62 workflow resume | 3eca862 | resume-restores-outputs | yes |

## Quality gates
- Full `@theokit/sdk` suite green (3198+ passed / 0 failed / 0 errors on the M3 validation run) + `@theokit/sdk-cache` 65 passed.
- typecheck clean; Biome clean (446 files); knip clean (0 orphans); loc ≤400 (all); cycles ≤3; depcruise clean; no stubs/mocks/TODO in M3 production files.
- 4 changesets (m3-62/64/66/67, minor); docs.md updated (nested spans, metrics, EventBus, non-lossy resume, scoped state, truncateConversation, artifacts decision).

## Handoff decision
**READY_TO_MERGE** — 0 unresolved BLOCKER/HIGH (H1 closed with an e2e test); every MEDIUM fixed or honestly documented; every declared deliverable has a revert-detecting test; the flagship span-nesting fix also targets the pre-existing `agent-send-parent-span` telemetry flake (green on the validation run). Open the `develop → main` release PR (`/release`).
