---
"@theokit/sdk": minor
---

M5-8 — public `parseModelId` + `humanizeModelName` + `toModelOption` on `@theokit/sdk/models` (plan `m5-model-option`).

- `parseModelId(modelId): { provider, name }` is now public (promoted from `@internal`) — splits the provider prefix from the model name, OpenRouter-routing + tag-suffix aware.
- `humanizeModelName(modelId): string` — a best-effort, deterministic human label: strips the routing/vendor prefix, title-cases the core model segment (known acronyms upper-cased), and appends an OpenRouter `:variant` in parens (`"openrouter/openai/gpt-4o:free"` → `"GPT 4o (free)"`). Not vendor-canonical marketing names.
- `toModelOption(modelId): { value, label, provider }` — a dropdown-ready entry composing the two.

Lets `@theokit/ui` model selectors + the `create-theokit` template stop hand-rolling slug→label. Zero new dependencies.
