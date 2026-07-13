# example-providers-models

The model is chosen by the `vendor/model` id you pass to `Agent.create` plus the key.
`@theokit/sdk/models` gives you offline helpers to parse an id and look up capabilities.

Pairs with the docs page **[Providers and models](https://docs.usetheo.dev/theokit/providers-models)**.

## Run

```bash
pnpm install
export OPENROUTER_API_KEY=sk-or-...   # https://openrouter.ai/keys — or put it in .env
pnpm run run
```

## What it shows

- `parseModelId` / `humanizeModelName` / `resolveModelCapabilities` from `@theokit/sdk/models` — offline, no key.
- `model: { id: "openai/gpt-oss-120b:free" }` — the id + key select the provider (OpenRouter routing).
