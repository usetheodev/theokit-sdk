# D109 — Refactor is incremental, not big-bang

**Date:** 2026-05-19
**Status:** Accepted

## Decision

Phase 1 (Plugin contract), Phase 2 (Tool Registry), Phase 3 (Provider
as Plugin) produce NEW modules without modifying existing wiring.

Phase 4 surgically wires them:
- T4.1: `LocalAgent.initialize` calls `pluginManagerCode.initialize(codePlugins)`
- T4.2: `agent-loop/tool-dispatch.ts` invokes `inputs.pluginManager?.runPreToolCallHooks(...)` BEFORE existing file-based hooks
- T4.3: `internal/llm/router.ts` consults `getProviderProfile` + `selectTransport` instead of the switch

Existing collection paths (custom tools merging, anthropic/openai
clients) continue to exist; plugin tools are concatenated onto the
effective catalog without replacing it.

## Rationale

Big-bang swap of every site = high revert blast radius. Incremental
wires let each commit be small and bisect-friendly.

The full Transport ABC refactor (split LlmClient into base + dialect
implementations) is a follow-up — out of scope for this plan.

## Consequences

- **Enables:** atomic revert per phase; CI can run all 4 phase commits
  independently.
- **Constrains:** legacy code paths coexist with new for ≥1 phase. A
  future cleanup ADR can remove them.
