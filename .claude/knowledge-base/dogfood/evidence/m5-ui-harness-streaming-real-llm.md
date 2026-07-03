---
scenario: m5-ui-harness-streaming
date: 2026-07-03
operator: paulohenriquevn
outcome: pass
summary: theo-ui useAgentStream renders a real OpenRouter Run.stream() — live text + tool events
---

# M5 — Real-LLM validation evidence (UI ↔ Harness streaming)

Per `.claude/rules/real-llm-validation.md`. Provider: **OpenRouter** (key via
`theokit/.env`, never persisted here). Model: `openai/gpt-4o-mini`. Code lands in
the `theo-ui` repo (a `useAgentStream` hook); `@theokit/sdk` is a devDep only.

## Deterministic unit tests (12 GREEN, no LLM)

`theo-ui/src/hooks/use-agent-stream/`: reducer (7) + hook (4) + reconnect (1).
- reducer: text accumulation, tool upsert-by-call_id (running→success), error→failed, unknown-type ignore, done finalize.
- hook: renders streamed text, surfaces tool events, error status on throw, cancels iterator on unmount.
- reconnect (DoD #2): a stream that drops mid-flight and resumes from `lastEventId` renders every delta exactly once (`"abcde"`, no dup/loss).

## Real-LLM demo (DoD #1 + #3)

`OPENROUTER_API_KEY=… node --experimental-strip-types theo-ui/scripts/m5-real-llm-demo.ts` —
runs a REAL `Agent.create()` → `Run.stream()` and folds every `SDKMessage` through
the exact `agentStreamReducer` the hook uses:

```
=== M5 real-LLM demo — TEXT ===
events: system,user,assistant | status: finished
rendered message item text: "hello"
=== M5 real-LLM demo — TOOL ===
events: system,user,tool_call,tool_call,assistant | status: finished
tool-call items: 1 ["success"]

DEMO_OK
```

- **TEXT (DoD #1 text):** a real assistant turn rendered into a message item ("hello").
- **TOOL (DoD #1 tool):** the LLM called `get_current_time` (raw JSON-schema CustomTool); the two `tool_call` frames (running + completed) upserted into ONE tool-call item with status `success`.
- `status: finished` on both = real OpenRouter round-trips (not fixture).

## Why the real-LLM proof is a Node demo, not a vitest test

theo-ui's vitest env (`happy-dom` + `@vitejs/plugin-react`) stubs/truncates the
streaming `fetch` (`SSE stream truncated (no finish_reason / [DONE])`), so a real
`Run.stream()` cannot complete inside it — an environment limitation, NOT a hook
bug (the SDK's own real-LLM streaming tests pass in the SDK's plain-node vitest;
this demo runs in plain Node, which mirrors a real SSR/server consumer). The
deterministic mapping is unit-tested; the demo proves it on real model output.

## Key handling

`OPENROUTER_API_KEY` loaded per-session from the gitignored `theokit/.env`. The raw
key is never written to any committed file, evidence record, or issue body.

## Cross-repo note

DoD #2 reconnect delegates to the SDK `subscribe()` (opaque `lastEventId`, shipped
+ tested Harness-side). The theo-ui `@theokit/sdk` devDep is a pre-publish relative
link (`file:../theokit-sdk/packages/sdk`) — pins to a published version once the M4
SDK release lands.
