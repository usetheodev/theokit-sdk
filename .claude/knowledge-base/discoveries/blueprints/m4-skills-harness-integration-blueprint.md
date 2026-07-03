# Blueprint: M4 Skills ↔ Harness Integration — Real State & Version-Skew Defects

> **Version 1.0** — DISCOVER findings for M4 (Skills `theokit` runs a real agent on Harness `@theokit/sdk`). The ROADMAP premise ("the agent layer... does not yet exist") is **STALE**: the integration already exists and is production-wired. The real M4 work is a **version-skew fix** — the seam is BROKEN against the current SDK, reproduced with a live OpenRouter key.

**Slug:** `m4-skills-harness-integration`
**Generated:** 2026-07-03 via cross-repo deep research
**Repos:** `theokit-tools/theokit` (Skills) + `theokit-tools/theokit-sdk` (Harness)

## Finding 1 — The integration ALREADY EXISTS (ROADMAP premise stale)

- `theokit/package.json:50` — `@theokit/sdk` is a devDependency (`^2.9.0`).
- `theokit/packages/agents/src/bridge/sdk-adapter.ts:439-604` — `createSdkAgentStream()` dynamically imports `@theokit/sdk` and calls `Agent.getOrCreate()` (`:547`) + `agent.send(message, { onDelta })` (`:569`).
- `theokit/packages/http/src/app.ts:328-333` — auto-wires agents → HTTP via the SDK adapter.
- `theokit/fixtures/template-default/server/routes/chat.ts:30-69` — a documented example route invoking `agent.send()`.
- `theokit/packages/agents/tests/smoke/sdk-real-llm.test.ts` — an existing real-LLM smoke test.

**DoD status by existing code:** #2 (import path real — grep-proven) ✅; #3 (documented example) ✅; #1 (route invokes against real LLM + evidence) — code exists, but the seam is BROKEN (below), so fresh evidence FAILS.

## Finding 2 — The seam is BROKEN against the current SDK (version-skew, reproduced with a live key)

Ran the real-LLM smoke test with a live `OPENROUTER_API_KEY` against the installed `@theokit/sdk@2.13.0` (pin `^2.9.0` resolved to 2.13.0; the local dev SDK is 2.17.0, unpublished). **Two defects:**

### Defect A — dual-zod crash on tool-schema conversion
- **Symptom:** `TypeError: Cannot read properties of undefined (reading 'def')` at `zod@4.4.3 v4/core/to-json-schema.js:33` ← `@theokit/sdk@2.13.0 internal/zod/to-json-schema.ts:35` ← `defineTool` ← `sdk-adapter.ts:422`.
- **Root cause (hypothesis):** the tool's Zod schema is built with theokit's `zod@4.4.3` and passed to the SDK's `defineTool`, which calls the SDK's `toJsonSchema` → `z.toJSONSchema`. When the SDK resolves a DIFFERENT zod instance/version than the one that constructed the schema, zod's internal `.def` accessor reads `undefined` — the classic dual-zod-instance problem. theokit pins `zod ^4.4.3`; the SDK peer is `^3.25 || ^4`.
- **Fix direction:** align the zod instance the bridge uses with the SDK's (single zod), OR have the bridge pass a JSON schema to `defineTool` instead of a raw Zod schema (bypass the SDK-side `toJSONSchema`), OR pin-align zod across the boundary. Needs a decision + test.

### Defect B — the LLM is never actually called (silent empty run)
- **Symptom:** a plain "say hello" run emits `EVENT TYPES: done` only — zero `text_delta`, zero `error`. The `done` payload is `{"result":"","usage":{inputTokens:0,outputTokens:0,totalTokens:0,…},"durationMs":165,"cost":0}`.
- **Root cause (SHARPENED by the `done` payload):** `usage` all-zero + `cost: 0` + `durationMs: 165` (far too fast for a real OpenRouter round-trip) prove the SDK **never called the LLM** — it short-circuited to an empty run. This is NOT an onDelta-translation bug; it is **provider/model routing**: the SDK@2.13.0 did not route `model: "openai/gpt-4o-mini"` + a `sk-or-v1-…` OpenRouter key to the OpenRouter provider (likely needs an explicit `openrouter` provider / `baseUrl`, or the bridge's `buildModelSelection` output isn't resolvable by the current SDK). The bridge passes `apiKey` + `model` to `Agent.getOrCreate`; the SDK's provider auto-detection either doesn't recognize the OpenRouter key or the model id, and no-ops instead of erroring.
- **Fix direction:** determine how the current SDK expects an OpenRouter key + model to be configured (provider hint / baseUrl / model-id form), and update `buildModelSelection` / the `Agent.getOrCreate` options in `sdk-adapter.ts` so the real call happens. Verify: the run's `done.usage.outputTokens > 0` + ≥1 `text_delta`. NOTE — a silent 0-usage empty run is itself an SDK honesty gap (it should error, not no-op) worth a follow-up issue against the SDK.

## Finding 3 — real-LLM evidence requires a key (provided by operator)

The operator provided a live `OPENROUTER_API_KEY`, stored in `theokit/.env` (gitignored — `.env`/`.env.*` are ignored; the raw secret is NEVER written to a committed file or evidence). It is loaded per-session via `export OPENROUTER_API_KEY=$(grep … .env)`. Evidence files record model + response + status, never the key.

## M4 implement plan (the real work)

1. **Fix Defect A** (dual-zod): align zod across the bridge↔SDK boundary (single instance / JSON-schema passthrough). Test: the tool smoke test builds a tool schema + `defineTool` without throwing.
2. **Fix Defect B** (onDelta): update the bridge's delta sink to the current SDK `onDelta`/stream contract. Test: the "say hello" real-LLM smoke test yields ≥1 `text_delta` + `done`.
3. **Close version skew:** bump theokit's `@theokit/sdk` pin to the current published version (or workspace-link the local build) and make the integration green against it.
4. **Record real-LLM evidence** per `real-llm-validation.md`: model, response text, status — for both the text run and the tool run.
5. Confirm the documented example (fixture) works end-to-end.

## Honest scope note

The integration is real (no re-work needed to "build" it). The M4 fix is a **cross-repo debugging task in `theokit`'s bridge** against the current SDK's tool-schema + streaming contracts — substantial and quality-sensitive (the operator's bar: FAANG-level, no workarounds, 100% functional evidence). It should be executed with adequate budget, not rushed.

## Related

- Cross-project rule: "No invented integration" — this blueprint is grep-backed, not aspirational.
- `real-llm-validation.md` — the evidence contract for the fix.
- ROADMAP: `theokit-tools/ROADMAP.md` M4 (premise stale — update after the fix).
