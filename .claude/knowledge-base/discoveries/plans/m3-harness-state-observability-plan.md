# Discovery Plan: M3 Harness State & Observability

**Slug:** `m3-harness-state-observability`
**Generated:** 2026-07-03 via `/discover-plan`
**In-scope reference projects:** crewai, mastra, opencode, adk-js (cloned under `.claude/knowledge-base/reference/`)

## Context

Milestone M3 (ecosystem `ROADMAP.md`) corrects resume/state semantics and makes production behavior
visible. Four issues, scoped by the ROADMAP DoD (the contract): **#62** resume no longer lossy +
scoped session state (app:/user:/temp:), **#64** nested spans + metric gap + EventBus error
swallowing, **#66** artifacts decision documented + token undercount fixed, **#67** cross-model cache
correctness + session revert. Depends on M0 + M1 (both RELEASED); M2 released. Prior art is our own
cross-validation sweep at `_issues/{09,11,14,15}-*.md`.

## Research questions (≤ 15)

1. **Q1 (#62)** — How does the SDK's session hydration (`readSessionFile`) drop tool turns, and how should it include tool_call/tool_result so a resumed agent keeps its tool history? *(Corner 4)*
2. **Q2 (#62)** — What minimal scoped-session-state API (app:/user:/temp:) fits the existing session store without a rewrite? *(Corner 4)*
3. **Q3 (#62)** — How does the workflow executor's resume lose accumulated step outputs (executor.ts:370), and how does crewai/mastra restore them? *(Corner 4)*
4. **Q4 (#64)** — How does EventBus swallow handler errors (event-bus.ts:36), and how do crewai/opencode log + surface them? *(Corner 4)*
5. **Q5 (#64)** — How does `startChildSpan` discard its parent (tracer.ts:230), and how does mastra propagate OTel Context so spans nest across awaits? Does the fix stabilize the flaky `agent-send-parent-span` test? *(Corner 4)*
6. **Q6 (#64)** — Which durations/tokens are measured but never emitted as metrics, and how do we emit tool/llm duration histograms + a token counter via the existing `recordHistogram` path? *(Corner 4)*
7. **Q7 (#66)** — How does the SDK silently coerce missing provider usage to 0 (token undercount), and what is the minimal fix that makes the gap observable (WARN + metric) WITHOUT a new tokenizer dependency? *(Corner 4)*
8. **Q8 (#66)** — What is the honest artifacts-scope decision to document (cloud-only fixture stub, local NotSupported, ArtifactService deferred)? *(Corner 4)*
9. **Q9 (#67)** — How does the semantic cache path (`isEligibleForSearch`) ignore modelId, enabling a cross-model false hit, and how do we thread modelId into eligibility? *(Corner 4)*
10. **Q10 (#67)** — How does opencode's session revert work, and how should `truncateSessionTo` rewrite the JSONL atomically (reusing `replaceFileAtomic`) + prune the cache? *(Corner 4)*
11. **Q11 (all)** — Which pieces are stdlib/existing-dep vs need a new dependency? Confirm no new runtime dep (OTel `@opentelemetry/api` context is already a dep). *(Corner 2)*
12. **Q12 (all)** — What test patterns do peers use for span-tree assertions, event-error observation, cross-model cache, workflow resume? *(Corner 1)*

## Coverage Corners

- **Corner 1 — Integration Tests:** peer patterns for span-tree, event-error, cache, resume (Q12).
- **Corner 2 — Dependencies:** OTel context already a dep; no new runtime dep (Q11).
- **Corner 3 — Tools:** OTel test collector, fake timers (Q12).
- **Corner 4 — Techniques:** the concrete fix technique per deliverable (Q1–Q10).

## Acceptance criteria

Every question answered with a citation to a real SDK source path AND to the corresponding
`_issues/*.md` finding. Four corners populated. ≥ 1 ADR per issue. No fabricated citation.
