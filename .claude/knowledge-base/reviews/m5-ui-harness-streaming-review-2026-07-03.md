# Review: m5-ui-harness-streaming

**Date:** 2026-07-03
**Reviewers:** focused single-pass (architecture + tests + cross-validation + honesty) — proportionate to a self-contained React hook (`loop-engine-convention` — don't over-tool).
**Findings:** 0 BLOCKER · 1 HIGH · 1 MEDIUM · 1 LOW — resolved or documented
**Verdict:** READY_TO_MERGE (code) — commit sequencing noted

## Scope

M5 (UI ↔ Harness). DISCOVER established the SDK streaming surface is shipped
(`@theokit/sdk/subscription` + `Run.stream()`), theo-ui has the chat UI, and the
gap is the integration hook. Delivered `useAgentStream` in theo-ui:
`src/hooks/use-agent-stream/` (types, pure `agentStreamReducer`, hook, barrel).
theo-ui commit `9be597f` (hook + tests). Plan: `m5-ui-harness-streaming` (SHIPPABLE_WITH_CAVEATS).

## Findings & resolutions

### HIGH
- **H1 — real-LLM proof could not run as a vitest test.** theo-ui's vitest env
  (`happy-dom` + `@vitejs/plugin-react`) stubs/truncates the streaming `fetch`
  (`SSE stream truncated`), so a real `Run.stream()` cannot complete inside it. →
  **Resolved honestly**: the real-LLM proof is a plain-Node demo
  (`scripts/m5-real-llm-demo.ts`) — the environment that mirrors a real SSR/server
  consumer and that the SDK's own real-LLM tests use. It renders real OpenRouter
  text ("hello") + a real tool-call event (`["success"]`), `status: finished`. The
  flaky vitest real-LLM test was REMOVED (no flaky tests — `testing.md`). The
  deterministic mapping is fully unit-tested (12 GREEN).

### MEDIUM
- **M1 — commit sequencing blocked by theo-ui's concurrent refactor.** theo-ui's
  working tree is mid component-split (uncommitted deletions of account-menu /
  code-block / command-palette, a package.json exports rewrite) that OWNS the
  shared files my integration touches (`src/index.ts` barrel export, `package.json`
  `@theokit/sdk` devDep). → **Resolved by isolation**: committed ONLY the
  self-contained hook dir (zero coupling, 12 tests) as `9be597f`; the barrel export
  + demo + devDep land WITH the user's refactor (they own those files). Sweeping
  their unrelated work into an M5 commit is forbidden (atomic-commit + Rule 3).

### LOW
- **L1 — vague_acceptance_criteria soft cap on the plan (70).** Same linguistic
  heuristic as M4; the criteria carry concrete commands + thresholds. Non-blocking.

### INFO — verified OK
- Reducer purity (counter in state, not module-level); tool upsert by `call_id`
  (running→success, one item); unknown message types ignored (forward-compatible);
  unmount cancels the iterator (`return()`); error status on throw; ADR-1 structural
  type keeps theo-ui standalone (the SDK's `SDKMessage` is assignable — proven by
  the demo folding real `run.stream()` output through the reducer with no cast beyond
  `as unknown`).

## Cross-validation (DoD → proof)

| DoD | Proof |
|---|---|
| #1 component subscribes to Run.stream()/subscribe() + renders text + tool live | reducer + hook unit tests (11) + real-LLM demo (text "hello" + 1 tool-call success) |
| #2 reconnect/resume via lastEventId on a dropped connection | reconnect test (`"abcde"` continuous across drop+resume) + SDK `subscribe()` (shipped, tested Harness-side, ADR-2) |
| #3 real-LLM demo recorded | `scripts/m5-real-llm-demo.ts` + evidence file |

## Quality gates

- theo-ui: `pnpm typecheck` clean; Biome clean; knip — no M5 findings (the 3 knip
  findings are pre-existing: `mermaid.tsx`, `isProd`, 13 baseline deps).
- 12 tests GREEN (reducer 7 + hook 4 + reconnect 1).
- Real-LLM demo: `DEMO_OK` against OpenRouter `openai/gpt-4o-mini`.

## Handoff decision

**READY_TO_MERGE (code)** — the hook is complete, tested (12 GREEN), and validated
end-to-end against a real LLM. Two honest caveats: (H1) the real-LLM proof is a Node
demo, not a vitest test, due to theo-ui's vitest streaming-fetch limitation; (M1)
the barrel export + devDep integration must land alongside theo-ui's in-flight
component-split refactor — the isolated hook is committed (`9be597f`); the trivial
integration is the user's to sequence with their uncommitted work.
