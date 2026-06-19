---
"@theokit/sdk": minor
---

Custom LLM providers via the public Plugin protocol (plan `dev-friendly-custom-provider`).

- **Added** `defineProvider(profile, opts?)` — canonical factory (mirrors `defineTool`/`definePlugin`, Inviolable Rule 9) that wraps a data-only `ProviderProfile` into a `kind: "model-provider"` `Plugin`. Register any OpenAI-/Anthropic-compatible endpoint (Groq, Together, Fireworks, DeepInfra, a private gateway) with `Agent.create({ model: { id: "myprov/model" }, plugins: [defineProvider(profile)] })`, routed via the `provider/model` id prefix. Exported from `@theokit/sdk`.
- **Fixed** half-wired `kind: "model-provider"` plugin path: `PluginManager` aggregated provider profiles but nothing registered them, so `getProviderProfile`/`resolveProviderChain` never saw a plugin-contributed provider — a programmatic `model-provider` plugin was silently dropped. The local-agent run now registers plugin-contributed profiles before provider-chain resolution, so custom providers actually route.
- **Docs** new "Custom providers (`defineProvider`)" section in `docs.md` (field reference + `apiMode` table) and a worked `examples/custom-provider/`.
