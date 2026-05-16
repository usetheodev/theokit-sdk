# Provider inspector

Prints two complementary views:

- **`Theokit.providers.list()`** — the global catalog. Every provider
  known to the platform with `name`, `displayName`, `capabilities[]`,
  `isAvailable`, and a `setupSchema` (JSON Schema describing required
  env vars / config). Use this to discover what's available.
- **`agent.providers.routes()`** — per-agent resolved routes. Given the
  agent's `providers.routes` config + its model + active plugins, this
  tells you which provider is doing what for THIS agent and **why**
  (`reason` field).

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## Required env

- `THEOKIT_API_KEY` — the catalog call (`Theokit.providers.list()`)
  authenticates with this. A `theo_test_*` value serves the bundled
  fixture catalog offline. With a real key + `THEOKIT_API_BASE_URL` it
  hits `/v1/providers` against Theo PaaS.
- One of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OPENROUTER_API_KEY` —
  used by `agent.providers.routes()` to render the resolved chat route.

## `reason` field reference

| Value | When emitted |
| --- | --- |
| `explicit-model-provider` | The model id pins the provider (e.g. `claude-…` → `anthropic`) |
| `explicit-route` | Your `providers.routes` config picked it (no plugin involvement) |
| `first-available-plugin-provider` | A plugin contributed this provider and was first in the chain |

## Output sample

```
=== Global catalog (Theokit.providers.list) ===

- anthropic (Anthropic)
    capabilities: chat
    available:    true
- openai (OpenAI)
    capabilities: chat
    available:    true
...

=== Per-agent routes (agent.providers.routes) ===

- capability=chat  provider=anthropic
    reason: explicit-route
```
