# D86 — `internal/tool-dispatch/` is the new home for repair + strip-think + dispatch

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D87, D89, D96, plan `agent-core-loop-completion-plan.md`

## Decision

A new directory `packages/sdk/src/internal/tool-dispatch/` hosts:

- `repair-middleware.ts` — `repairToolCall`, `coerceArgsToSchema` (D87)
- `strip-think.ts` — `stripThinkBlocks` (D96)
- `dispatch.ts` — `dispatchToolWithRepair` validate-then-execute wrapper (D89)
- `index.ts` — barrel

Existing `internal/agent-loop/tool-dispatch.ts` keeps its current
`dispatchTools` orchestration but now imports the repair module.

## Rationale

`agent-loop/tool-dispatch.ts` had grown to 244 lines and conflated three
responsibilities (event lifecycle + execute + result render). Putting
repair, strip-think, and validate-then-execute in their own minimal modules
under `tool-dispatch/`:

- Keeps each module under 200 lines.
- Enables isolated unit tests + property tests.
- Decouples repair from event/run-state coupling (repair is pure; agent-
  loop wires it).

## Consequences

- **Enables:** granular coverage; future repair extensions (Hermes follow-up
  failure modes) ship without touching the loop.
- **Constrains:** caller (`agent-loop/tool-dispatch.ts`) needs to import
  from two paths. Acceptable in exchange for clarity.
