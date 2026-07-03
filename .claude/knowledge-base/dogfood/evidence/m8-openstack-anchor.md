---
scenario: open-stack-agent
date: 2026-07-03
operator: paulohenriquevn
outcome: pass
summary: open-stack agent (Harness SDK + Skills tool-use + theo-ui render) runs end-to-end on real OpenRouter; TTFWA ≈1.9s warm
---

# M8 — Open-stack anchor evidence (3 shippable pillars, real LLM)

`OPENROUTER_API_KEY=… node --experimental-strip-types theo-ui/scripts/m8-openstack-anchor.ts`
— 3 runs, all `ANCHOR_OK`:

```json
{ "north_star_time_to_first_working_agent_ms": 1824,
  "pillars": {
    "harness_status": "finished",
    "skills_tool_calls": 1, "skills_tool_status": ["success"],
    "ui_rendered_items": 2,
    "ui_rendered_text": "The current UTC time is 2026-07-03T15:58:14.277Z.",
    "runtime_cloud": "pre-release (contract-only, M7) — not exercised live" } }
```

- **Harness (SDK 2.18.0, local runtime):** `Agent.create()+send()` → `finished` against real OpenRouter (`openai/gpt-4o-mini`). Zero Theo-backend dependency.
- **Skills (extension mechanism):** the agent invoked a real JSON-schema `get_current_time` tool — the same tool-use path the published plugins ride on. Skills↔Harness is separately proven by M6 (10 plugins published, 661 tests green vs SDK 2.18.0).
- **UI (theo-ui):** every `Run.stream()` SDKMessage folded through the exact `agentStreamReducer` `useAgentStream` uses → 2 rendered items (tool-call + assistant message) with real text.
- **Runtime (cloud):** pre-release (contract-only, M7) — documented, not exercised (DoD "M7 optional").

TTFWA over 3 runs: 7142 (cold) / 1966 / 1824 ms → baseline ≈1.9s warm.

Key handling: OPENROUTER_API_KEY loaded per-session from the gitignored `theokit/.env`, scrubbed after; never committed.
