# `examples/tool-hooks-tracking` — Production-Readiness #4

Demonstrates `onToolStart` / `onToolEnd` / `onToolError` callbacks for cost tracking, audit log, latency telemetry.

## Run

```bash
# Fixture mode (no tool dispatch fires):
pnpm run

# Real LLM (the only path that actually exercises tool hooks):
OPENROUTER_API_KEY=sk-or-... pnpm run
```

## What it shows

1. Register `onToolStart` / `onToolEnd` / `onToolError` in `AgentOptions`
2. LLM invokes the tool → start hook fires → handler runs → end hook fires
3. Hooks receive `callId` (same value across start/end pair — correlate in logs)
4. `durationMs` measured from start to end (or error) hook fire
5. Hook listener errors are SWALLOWED (D317) — a crashing logger cannot kill the agent

## Use for production

```ts
onToolStart: ({ toolName, callId, conversationId }) => {
  metrics.recordToolStart({ toolName, callId, conversationId });
},
onToolEnd: ({ toolName, callId, durationMs, result }) => {
  metrics.recordToolEnd({ toolName, callId, durationMs });
},
onToolError: ({ toolName, callId, durationMs, error }) => {
  alerts.notify({ toolName, error: error.message });
},
```

See `docs.md` "Tool lifecycle hooks" section for the full contract.
