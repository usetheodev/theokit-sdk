---
scenario: m4-skills-harness-integration
date: 2026-07-03
operator: paulohenriquevn
outcome: pass
summary: theokit bridge + SDK both drive a real OpenRouter LLM after the provider-routing fix
---

# M4 — Real-LLM validation evidence (provider-routing apiKey fix)

Per `.claude/rules/real-llm-validation.md`. Provider: **OpenRouter** (key via
`theokit/.env`, never persisted here). Model: `openai/gpt-4o-mini`.

## 1. SDK direct (raw `Agent.create()+send()` → dist build)

Command: `node` against `packages/sdk/dist/index.js` with `OPENROUTER_API_KEY` set.

```json
{ "status": "finished", "result": "PONG",
  "usage": { "inputTokens": 64, "outputTokens": 3, "totalTokens": 67 },
  "model": { "id": "openai/gpt-4o-mini" } }
```

`outputTokens: 3` proves the LLM was actually called (before the fix: `status: "error"`, 0 events, swallowed `ConfigurationError: No provider client could be resolved (primary=openai)`).

## 2. SDK own real-LLM suite (src)

`OPENROUTER_API_KEY=… npx vitest run tests/integration/real-llm/openrouter-stream.test.ts openrouter-tools.test.ts openrouter-structured.test.ts` → **3 passed** (was 1 failed `expected 0 to be greater than or equal to 1`).

## 3. Skills↔Harness seam (DoD #1) — theokit bridge → real LLM

The `@theokit/agents` bridge (`createSdkAgentStream` → `Agent.getOrCreate()` +
`agent.send()`), running against the fixed SDK (packed + installed into theokit)
with a live OpenRouter key:

`npx vitest run tests/smoke/sdk-real-llm.test.ts -t "text_delta and one done"` →

```
✓ SDK Real LLM Smoke > should return at least one text_delta and one done event  7275ms
  Test Files 1 passed | Tests 1 passed
```

7.3s wall-clock = a real OpenRouter round-trip through the bridge. This satisfies
M4 DoD #1 (a theokit route/handler invokes `Agent.create()+agent.send()` against a
real LLM, evidence recorded). DoD #2 (real import) and #3 (documented example) were
already met by existing code (grep-proven in the DISCOVER blueprint).

## Known separate defect (filed, not a Harness bug)

The bridge's **tool** path crashes on JSON-schema tool inputs because it routes all
compiled tools through the SDK's Zod-only `defineTool`. This is a `@theokit/agents`
bridge bug (the SDK is correct — it also accepts raw JSON-schema `CustomTool`s),
filed as **usetheodev/theokit#61**. It is independent of the provider-routing fix
and outside M4 DoD #1 (which covers the chat/text seam, validated above).

## Key handling

`OPENROUTER_API_KEY` is loaded per-session from the gitignored `theokit/.env`
(`export OPENROUTER_API_KEY=$(grep … .env | cut -d= -f2-)`). The raw key is never
written to any committed file, evidence record, or issue body.
