# Blueprint — Runtime boundary validation for Agent.batch (cross-val Gap 3, narrowed)

**Date:** 2026-06-15 · Derived from the crewAI cross-validation Gap 3 ("runtime validation at public boundaries thinner than pydantic").

## Finding (DISCOVER — corrects the cross-val finding)
The cross-val Gap 3 overstated the problem. theokit ALREADY validates most public boundaries with hand-rolled pre-flight validators throwing `ConfigurationError`:
- `Agent.create` → `validateAgentOptions` (247 LoC, wired in agent-helpers.ts).
- `Cron.create` → `validateCronExpression` + `validateTimezone` + agent/agentId required.
- `workflow.ts` (24 validation refs), `subscription` (8), `generate/stream-object` (4 each).

The genuine narrow gap is **`Agent.batch` (batch.ts) — 0 dedicated boundary validation**:
1. `concurrency` IS validated, but only incidentally deep inside `runBatch` via `createSemaphore` (async-semaphore.ts:29). Problems:
   - Leaky message: "async-semaphore: permits must be a positive integer" (internal detail, not "concurrency").
   - **Ordering bug**: `wrapBatchAsTask(...)` (batch.ts ~line 52) runs BEFORE `runBatch` — invalid concurrency + `task` set registers a dangling Task, THEN throws.
2. **Prompt items unvalidated**: `normalizeItem` wraps a string/BatchItem with no check — `prompt: ""` or non-string prompt flows silently to `agent.send`.

## Decision (ADR-style)
- **Use the in-repo hand-rolled pre-flight validator pattern**, NOT zod. zod is an OPTIONAL peer dep (ADR D24, lazy-loaded in define-tool only); forcing it into the batch hot path would break that contract and add a hard dep. KISS + consistency with validateAgentOptions/validateCronExpression.
- Add `validateBatchInput(prompts, options)` called at the TOP of `batchImpl`, BEFORE pool building and BEFORE task wrapping, so validation is a true pre-flight with no side effects.

## Coverage corners
- Integration: batchImpl wiring — validator runs before wrapBatchAsTask (no dangling task on invalid input).
- Dependencies: none new (reuses ConfigurationError).
- Tools: n/a.
- Techniques: pre-flight boundary validation; fail-fast (Rule 8).

## References
- `.claude/knowledge-base/reference/crewAI/lib/crewai/src/crewai/agent/core.py` (pydantic boundary validation — inspiration)
- In-repo: `packages/sdk/src/internal/runtime/validate-agent-options.ts` (the pattern to follow)
- In-repo: `packages/sdk/src/internal/runtime/async-semaphore.ts:29` (incidental concurrency check)
