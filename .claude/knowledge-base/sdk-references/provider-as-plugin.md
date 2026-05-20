# Provider as Plugin

> LLM providers (OpenAI, Anthropic, Gemini, OpenRouter, Bedrock,
> custom) são **dados declarativos** (`ProviderProfile` interface), não
> code branches no router. Adicionar provider = ship um plugin com
> profile. Hermes levou 4 releases para chegar nessa shape (PR #14424 →
> PR #20324, v0.13). Combinado com **Transport ABC**: profile declara
> `api_mode`, transport faz a conversion HTTP. 22 providers in-tree
> hoje, zero code branches no agent loop.

## Quando aplicar

Aplique quando o SDK suporta múltiplos LLM providers:

- Theokit v1.2 hardcoda OpenAI/Anthropic/Gemini/OpenRouter — candidatos
  óbvios à migração
- Adicionar Bedrock, Cohere, Mistral, AzureFoundry sem PR contra core
- User custom providers (self-hosted, private inference)

## Por que importa

V1.2 do Theokit-SDK tem hardcoded providers em `internal/providers/`.
Adicionar Mistral requer:

1. Novo arquivo `mistral.ts`
2. Switch case em algum router
3. Validation que aceita "mistral" como provider name
4. Tests que importam mistral
5. PR contra core

Provider-as-plugin reduz isso para:

1. NPM publish `@theokit/provider-mistral`
2. User instala
3. Funciona

## Pattern canonical (Python — Hermes)

```python
# providers/base.py:21
@dataclass
class ProviderProfile:
    # Identity
    name: str
    api_mode: str = "chat_completions"  # → selects transport
    aliases: tuple = ()
    
    # Metadata
    display_name: str = ""
    description: str = ""
    signup_url: str = ""
    
    # Auth & endpoints
    env_vars: tuple = ()
    base_url: str = ""
    models_url: str = ""
    auth_type: str = "api_key"  # api_key | oauth_device_code | oauth_external | aws_sdk
    supports_health_check: bool = True
    
    # Model catalog (only tool-calling-capable models)
    fallback_models: tuple = ()
    hostname: str = ""  # for URL→provider reverse-mapping
    
    # Request quirks
    extra_headers: dict = ()
    body_overrides: dict = ()
    # ...
```

```python
# Em plugins/model-providers/anthropic/__init__.py
from providers import register_provider, ProviderProfile

ANTHROPIC = ProviderProfile(
    name="anthropic",
    api_mode="anthropic_messages",
    env_vars=("ANTHROPIC_API_KEY",),
    base_url="https://api.anthropic.com",
    models_url="https://api.anthropic.com/v1/models",
    auth_type="api_key",
    fallback_models=(
        "claude-opus-4-7",
        "claude-sonnet-4-6",
        "claude-haiku-4-5-20251001",
    ),
    hostname="api.anthropic.com",
)

register_provider(ANTHROPIC)
```

## TypeScript equivalent

```typescript
// packages/sdk/src/types/provider.ts
export interface ProviderProfile {
  // Identity
  name: string;
  apiMode: ApiMode; // "chat_completions" | "anthropic_messages" | "responses_api" | "bedrock"
  aliases?: string[];
  
  // Metadata
  displayName?: string;
  description?: string;
  signupUrl?: string;
  
  // Auth
  envVars: string[]; // e.g., ["ANTHROPIC_API_KEY"]
  authType: "api_key" | "oauth_device_code" | "oauth_external" | "aws_sdk";
  
  // Endpoints
  baseUrl: string;
  modelsUrl?: string;
  hostname?: string; // for URL→provider reverse-mapping
  
  // Catalog
  fallbackModels: string[];
  
  // Request quirks (optional)
  extraHeaders?: Record<string, string>;
  bodyOverrides?: Record<string, unknown>;
}

// Plugin definition:
export interface ProviderPlugin {
  name: string;
  version: string;
  kind: "model-provider";
  profile: ProviderProfile;
}

// User code:
// packages/provider-anthropic/src/index.ts
import type { ProviderPlugin } from "@usetheo/sdk";

export const anthropicProvider: ProviderPlugin = {
  name: "anthropic",
  version: "1.0.0",
  kind: "model-provider",
  profile: {
    name: "anthropic",
    apiMode: "anthropic_messages",
    envVars: ["ANTHROPIC_API_KEY"],
    authType: "api_key",
    baseUrl: "https://api.anthropic.com",
    modelsUrl: "https://api.anthropic.com/v1/models",
    hostname: "api.anthropic.com",
    fallbackModels: [
      "claude-opus-4-7",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
    ],
  },
};
```

## Transport ABC (orthogonal)

Provider declara `apiMode`. Transport executa o request:

```typescript
// packages/sdk/src/internal/transports/types.ts
export interface Transport {
  apiMode: ApiMode;
  chat(
    messages: SDKMessage[],
    tools: ToolEntry[],
    config: ModelConfig,
  ): Promise<Response>;
  stream(
    messages: SDKMessage[],
    tools: ToolEntry[],
    config: ModelConfig,
  ): AsyncIterable<StreamEvent>;
}

// 4 transports core ship:
// internal/transports/chat-completions.ts — OpenAI-compatible
// internal/transports/anthropic.ts — Anthropic Messages
// internal/transports/responses-api.ts — OpenAI Responses (Codex)
// internal/transports/bedrock.ts — AWS Bedrock Converse

// Wiring:
function selectTransport(apiMode: ApiMode): Transport {
  switch (apiMode) {
    case "chat_completions": return new ChatCompletionsTransport();
    case "anthropic_messages": return new AnthropicTransport();
    case "responses_api": return new ResponsesApiTransport();
    case "bedrock": return new BedrockTransport();
    default:
      throw new ConfigurationError(`Unknown apiMode: ${apiMode}`);
  }
}
```

Novo provider que usa OpenAI-compatible API (Mistral, DeepSeek, Together):
profile com `apiMode: "chat_completions"`. Zero code novo no SDK.

Novo provider com dialect próprio (Codex, Bedrock): profile + new
Transport. Transport pode shipar como package separado se third-party:
`@theokit/transport-cohere`.

## Discovery pattern (lazy)

Hermes faz lazy discovery: scan `~/.hermes/plugins/model-providers/` apenas
quando `get_provider_profile()` é chamado. TypeScript pode usar mesmo
pattern via dynamic imports:

```typescript
// packages/sdk/src/internal/providers/registry.ts
const REGISTRY = new Map<string, ProviderProfile>();
const ALIASES = new Map<string, string>();
let discovered = false;

export function registerProvider(profile: ProviderProfile): void {
  REGISTRY.set(profile.name, profile);
  for (const alias of profile.aliases ?? []) {
    ALIASES.set(alias, profile.name);
  }
}

export async function getProviderProfile(name: string): Promise<ProviderProfile> {
  if (!discovered) {
    await discoverProviders();
    discovered = true;
  }
  const canonical = ALIASES.get(name) ?? name;
  const profile = REGISTRY.get(canonical);
  if (profile === undefined) {
    throw new ConfigurationError(
      `Unknown provider: "${name}". Available: ${Array.from(REGISTRY.keys()).join(", ")}`,
    );
  }
  return profile;
}

async function discoverProviders(): Promise<void> {
  // 1. Built-in providers (eager registered no module init)
  // Já no REGISTRY.
  
  // 2. User plugins via package.json
  // Scan ~/.theokit/plugins/model-providers/*/package.json
  // Lazy import via createRequire
  
  const userPluginsDir = join(getTheokitHome(), "plugins", "model-providers");
  if (!existsSync(userPluginsDir)) return;
  
  for (const entry of await readdir(userPluginsDir)) {
    const pkg = join(userPluginsDir, entry, "package.json");
    if (!existsSync(pkg)) continue;
    
    try {
      const plugin = await import(join(userPluginsDir, entry));
      if (plugin.default?.profile !== undefined) {
        registerProvider(plugin.default.profile);
      }
    } catch (err) {
      logger.warn(`Failed to load provider plugin "${entry}": ${err}`);
    }
  }
}
```

## Architectural decisions

### AD-1: Last-writer-wins para override

User instala plugin `@third-party/provider-anthropic` que sobrescreve
o built-in. Plugin registra DEPOIS do built-in (porque lazy discovery
roda after eager built-ins) → user version vence.

**Conflict surfacing**: log WARNING quando override acontece, com
caminhos dos dois plugins. User PRECISA notar que está usando custom:

```typescript
export function registerProvider(profile: ProviderProfile): void {
  if (REGISTRY.has(profile.name)) {
    logger.warn(
      `[theokit] Provider "${profile.name}" overridden by user plugin.`,
    );
  }
  REGISTRY.set(profile.name, profile);
  // ...
}
```

### AD-2: Lazy discovery, idempotent

Discovery roda 1 vez por processo. Subsequent calls são cache hit.
Sync. Sem race conditions porque providers são DADOS, não state.

### AD-3: ProviderProfile é interface (data), não ABC

V1.3 plan original tinha "ProviderPlugin é ABC". Mudou para interface
data-only. Razão: 90% dos providers só diferem em URL + env_vars +
fallback_models. ABC força new class por provider — overkill.

```typescript
// CERTO: data interface
const myProvider: ProviderProfile = { name: "...", apiMode: "...", ... };

// ERRADO (que evitamos):
class MyProvider extends ProviderBase {
  // 90% boilerplate
}
```

### AD-4: Migração v1.2 → v1.3 invisível

V1.2 caller:

```typescript
const agent = await Agent.create({ provider: "anthropic", apiKey: "..." });
```

V1.3: mesma surface, mas internamente `provider: "anthropic"` resolve
via `getProviderProfile("anthropic")` e usa profile + transport.

Sem breaking changes públicos.

## Failure modes prevenidos

1. **Adicionar provider requer fork**: zero code novo em core para 90%
   dos casos.
2. **Code branches no router crescem em N providers**: pattern data-driven
   é O(1) discovery + O(1) lookup.
3. **URL hardcoded no router**: profile centraliza base_url etc.
4. **Multiple-env-var resolution duplicado**: profile lista env_vars,
   resolver verifica todas (`OPENAI_API_KEY` ou `OPENAI_KEY`?).

## Failure modes NÃO prevenidos

- **Provider mente sobre fallback_models**: claim "supports tool_calling"
  mas crasha. Defesa: integration test contra provider real (real-LLM
  validation rule).

- **Dialect novo sem transport**: profile com `apiMode: "weird-new-thing"`
  e transport inexistente. Validation no register_provider deve checar
  apiMode contra lista de transports conhecidos.

- **Provider drift**: profile correto hoje, provider muda dialect amanhã.
  Defesa: contract test recorrente, monitorar deprecation announcements.

## Como testar

```typescript
it("registers and discovers a custom provider", async () => {
  const myProfile: ProviderProfile = {
    name: "test-provider",
    apiMode: "chat_completions",
    envVars: ["TEST_API_KEY"],
    authType: "api_key",
    baseUrl: "https://api.example.com",
    fallbackModels: ["test-model"],
  };
  
  registerProvider(myProfile);
  const found = await getProviderProfile("test-provider");
  expect(found).toEqual(myProfile);
});

it("alias resolves to canonical", async () => {
  registerProvider({
    name: "openrouter",
    aliases: ["or", "openrouter.ai"],
    apiMode: "chat_completions",
    envVars: ["OPENROUTER_API_KEY"],
    authType: "api_key",
    baseUrl: "https://openrouter.ai/api/v1",
    fallbackModels: ["..."],
  });
  
  expect((await getProviderProfile("or")).name).toBe("openrouter");
});

it("override logs warning", async () => {
  const warnSpy = vi.spyOn(console, "warn");
  registerProvider({ name: "dup", apiMode: "chat_completions", ... });
  registerProvider({ name: "dup", apiMode: "chat_completions", ... });
  expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/overridden by user plugin/));
});
```

## Onde wirar no SDK

`packages/sdk/src/internal/providers/`:

- `registry.ts` — `registerProvider`, `getProviderProfile`, `listProviders`
- `builtin/` — OpenAI, Anthropic, Gemini, OpenRouter (migrados do hardcoded v1.2)
- `discovery.ts` — lazy scan `~/.theokit/plugins/model-providers/`
- `internal/transports/` — Transport ABC + 4 transports core
- Public: `packages/sdk/src/index.ts` re-exports `ProviderProfile`, `defineProvider`

## Referências cruzadas

- [plugin-contract-design.md](./plugin-contract-design.md) — provider plugins são kind="model-provider"
- [tool-call-failure-recovery.md](./tool-call-failure-recovery.md) — provider-specific quirks
- [error-context-surfacing.md](./error-context-surfacing.md) — erros mencionam provider+endpoint

## Citações primárias

- `referencia/hermes-agent/providers/base.py:21` — `ProviderProfile` Python
- `referencia/hermes-agent/providers/__init__.py` — register/discover
- `referencia/hermes-agent/plugins/model-providers/anthropic/__init__.py` — exemplo
- `.claude/knowledge-base/hermes-deep-dive/07-provider-plugins.md:46-100` — entry points
- PR #14424 (v0.11 original) → PR #20324 (v0.13 salvage)
