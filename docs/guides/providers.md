# Providers and routing

The SDK can route each model capability (`chat`, `web_search`, `image`, `embedding`) to a specific provider, with optional fallback. This lets you keep your codebase provider-agnostic while still controlling which provider serves which capability per agent.

## Declaring routes

```typescript
import { Agent } from "@usetheo/sdk";

const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "anthropic:claude-3-7-sonnet" },
  local: { cwd: process.cwd(), settingSources: ["plugins"] },
  plugins: { enabled: ["search-provider"] },
  providers: {
    routes: [
      { capability: "chat", provider: "anthropic" },
      { capability: "web_search", provider: "fixture-search" },
    ],
    fallback: ["openrouter", "nous"],
  },
});
```

| Field | Description |
| --- | --- |
| `routes` | Explicit `{ capability → provider }` map. First match wins per capability. |
| `fallback` | Provider names tried in order when no route matches a capability, or the routed provider is unavailable. |

Providers are sourced from:

1. The model selection (`model: "anthropic:..."` implies `anthropic` for `chat`).
2. Routes you declare here.
3. Plugins enabled via `plugins.enabled`.
4. The platform catalog (see `Theokit.providers.list()` below).

## Inspecting resolved routes

```typescript
const routes = await agent.providers.routes();
for (const route of routes) {
  console.log(`${route.capability} → ${route.provider} (${route.reason})`);
}
```

`reason` is a stable identifier explaining the routing decision. Common values:

| Reason | Meaning |
| --- | --- |
| `"explicit-model-provider"` | The provider was implied by `model.id`. |
| `"explicit-route"` | Matched an entry in `providers.routes`. |
| `"first-available-plugin-provider"` | Resolved from `plugins.enabled`. |
| `"fallback"` | Used after the primary route was unavailable. |

The output is **public and secret-free** by design — API keys, headers, and tokens never appear here.

## Listing the catalog

```typescript
import { Theokit } from "@usetheo/sdk";

const providers = await Theokit.providers.list({ apiKey: process.env.THEOKIT_API_KEY });

for (const provider of providers) {
  console.log(`${provider.displayName} (${provider.name})`);
  console.log(`  Capabilities: ${provider.capabilities.join(", ")}`);
  console.log(`  Available: ${provider.isAvailable}`);
}
```

`setupSchema` is a JSON Schema describing the environment variables or config fields needed to enable the provider. Use it to drive UI for "connect provider" flows.

## Plugins as providers

Plugins (loaded via `local.settingSources: ["plugins"]` and `plugins.enabled`) can register additional providers. Provider names are scoped to the plugin — e.g. `fixture-search`, `internal-rag` — and surface alongside platform providers in `Theokit.providers.list()`.

## Type reference

```typescript
type ProviderCapability = "chat" | "web_search" | "image" | "embedding";

interface ProviderRoute {
  capability: ProviderCapability;
  provider: string;
  model?: string;
}

interface ProviderRoutingSettings {
  routes: ProviderRoute[];
  fallback?: string[];
}

interface PluginsSettings {
  enabled?: string[];
}

interface ResolvedProviderRoute {
  capability: string;
  provider: string;
  model?: string;
  reason: string;
}

interface SDKProvidersManager {
  routes(): Promise<ResolvedProviderRoute[]>;
}

interface SDKProvider {
  name: string;
  displayName: string;
  capabilities: string[];
  isAvailable: boolean;
  setupSchema: object;
}
```

## Next

- [Context manager](./context-manager.md) — system-prompt context alongside routing
- [MCP servers](./mcp-servers.md) — different from providers; MCP is tool transport, providers serve model capabilities
