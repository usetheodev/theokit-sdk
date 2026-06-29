---
'@theokit/sdk': patch
---

Add `SendOptions.toolChoice` (`"auto" | "none" | "required"`), forwarded to the OpenAI/OpenRouter `tool_choice` request field. `"none"` forces a text answer even when the agent has tools registered — this lets an agent loop force a closing summary at its step ceiling (a cached agent's tools cannot be un-registered, so the gate must be applied per-send, not at agent creation). `tool_choice` is emitted only alongside a non-empty `tools` array. Additive and backward-compatible (absent ⇒ provider default).
