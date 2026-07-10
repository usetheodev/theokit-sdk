---
"@theokit/sdk": minor
---

**SE8 — model bare-string shorthand.**

Every public model-accepting surface — `AgentOptions.model`, `SendOptions.model`, `AgentBuilder.model()`, and `GenerateObjectOptions.model` / `structuringModel` / `StreamObjectOptions.model` — now accepts a bare-string model id (`model: "openai/gpt-4o-mini"`) in addition to the `{ id }` object, matching every peer SDK's `"provider/model"` shorthand. Additive + fully backward-compatible: the object form (and `{ id, params }` for tuning) is unchanged.

- A bare string is normalized to `{ id }` at ONE boundary seam (`normalizeModel`), so all downstream code keeps seeing a `ModelSelection`. The id still parses a `provider/` prefix for routing.
- Use the object form when you need `params` (reasoning/temperature tuning): `model: { id: "...", params: [...] }`.
- An empty / whitespace-only string throws a typed `ConfigurationError` (`code: "invalid_model_selection"`).

From the DX comparison against OpenAI Agents / LangChain `create_agent` / Vercel AI SDK `ToolLoopAgent` / Mastra (all take a bare string). Grounded in ROADMAP SE8.
