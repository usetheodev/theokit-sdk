# custom-provider

Register a custom OpenAI-/Anthropic-compatible LLM provider with `Provider.create`
and route to it — no fork required.

```bash
pnpm install
pnpm run                       # registration + routing only (no LLM call)
GROQ_API_KEY=gsk_... pnpm run  # performs a live send through Groq
```

What it shows:

- A `ProviderProfile` is **data only** — declare name, `apiMode` (HTTP dialect),
  auth, base URL, fallback models.
- `Provider.create(profile)` returns a `kind: "model-provider"` plugin (mirrors
  `Tool.create` / `Plugin.create`).
- Pass it to `Agent.create({ plugins: [...] })` and route via the `provider/model`
  id prefix (`groq/llama-3.1-8b-instant`).

See the "Custom providers (`Provider.create`)" section in `docs.md` for the full
`ProviderProfile` field reference and the supported `apiMode` values.
