# 07 — Provider Plugins (`ProviderProfile` ABC)

> Hermes' inference providers are pluggable as of v0.13 PR #20324 (salvage
> of #14424). Each provider is a `ProviderProfile` dataclass in
> `plugins/model-providers/<name>/__init__.py` that calls
> `providers.register_provider(ProviderProfile(...))` at module load. The
> `providers.__init__._discover_providers()` function is a **lazy, separate
> discovery system** from the general PluginManager (scanned on first
> `get_provider_profile()` call). User plugins override bundled ones
> last-writer-wins. Twenty-two providers ship in-tree today
> (`plugins/model-providers/` directories). Paired with the v0.11 Transport
> ABC (`agent/transports/`, 4 files) that owns HTTP transport + format
> conversion. In TypeScript: `ProviderPlugin` interface + `definePlugin`
> registration; we migrate hardcoded OpenAI/Anthropic/Gemini/OpenRouter to
> plugins in the same v1.3 release.

## What problem this domain solves

Pre-v0.13, Hermes had a router (`call_llm`) with hardcoded branches for each provider (OpenAI, Anthropic, Gemini, OpenRouter, …). Each provider added a new branch in the router. Adding a community provider (Arcee, GMI, Step Plan) required a PR against core.

The v0.13 move: **inference providers are plugins**. Drop a directory into `plugins/model-providers/<name>/` with an `__init__.py` that calls `register_provider(ProviderProfile(...))`. The profile is *declarative*: it lists the auth mechanism, base URL, env vars, fallback models, the dialect quirks the transport has to handle. No code branches in core.

A second concern: **HTTP transport vs format conversion**. OpenAI / Anthropic / AWS Bedrock all have different request shapes. Even within OpenAI, `chat_completions` and the new `responses` API differ. The v0.11 refactor (PR #13347 by @kshitijk4poor + Teknium) extracted these into `agent/transports/`: `AnthropicTransport`, `ChatCompletionsTransport`, `ResponsesApiTransport`, `BedrockTransport`. Each transport owns its format conversion. The `ProviderProfile.api_mode` field selects the transport at runtime.

These two refactors compose: a provider plugin declares `api_mode = "anthropic_messages"`, the agent picks `AnthropicTransport`, the transport handles all the dialect work. Adding a new provider with no new dialect: ship the profile only. Adding a new provider with a new dialect: ship the profile + a new transport.

## Hermes file layout

| Path | Role |
|---|---|
| `providers/base.py` (166 LoC) | `ProviderProfile` base dataclass. |
| `providers/__init__.py` (191 LoC) | `register_provider`, `get_provider_profile`, `list_providers`, `_discover_providers`. |
| `plugins/model-providers/<name>/__init__.py` × 22 dirs | Each provider's profile. Loads on demand. |
| `plugins/model-providers/<name>/plugin.yaml` | Plugin manifest (`kind: model-provider`). |
| `agent/transports/base.py` | Transport ABC. |
| `agent/transports/chat_completions.py` | OpenAI-compatible. |
| `agent/transports/anthropic.py` | Anthropic Messages API. |
| `agent/transports/codex.py` + `codex_app_server.py` + `codex_app_server_session.py` + `codex_event_projector.py` | OpenAI Responses API (Codex). |
| `agent/transports/bedrock.py` | AWS Bedrock Converse API. |
| `agent/transports/types.py` | Shared types. |
| `tests/providers/test_plugin_discovery.py` | Discovery system tests. |
| `tests/providers/test_provider_profiles.py` | Profile contract tests. |

Twenty-two bundled providers (per `ls plugins/model-providers/`): `ai-gateway`, `alibaba`, `alibaba-coding-plan`, `anthropic`, `arcee`, `azure-foundry`, `bedrock`, `copilot`, `copilot-acp`, `custom`, `deepseek`, `gemini`, `gmi`, `huggingface`, `kilocode`, `kimi-coding`, `minimax`, `nous`, `novita`, `nvidia`, plus a handful more (cut off in the listing).

## Canonical entry point

```python
# providers/base.py:21
@dataclass
class ProviderProfile:
    """Base provider profile — subclass or instantiate with overrides."""

    # ── Identity ─────────────────────────────────────────────
    name: str
    api_mode: str = "chat_completions"  # → selects transport
    aliases: tuple = ()

    # ── Human-readable metadata ───────────────────────────────
    display_name: str = ""
    description: str = ""
    signup_url: str = ""

    # ── Auth & endpoints ─────────────────────────────────────
    env_vars: tuple = ()
    base_url: str = ""
    models_url: str = ""
    auth_type: str = "api_key"  # api_key | oauth_device_code | oauth_external | copilot | aws_sdk
    supports_health_check: bool = True

    # ── Model catalog ─────────────────────────────────────────
    fallback_models: tuple = ()  # only tool-calling-capable models
    hostname: str = ""           # for URL→provider reverse-mapping

    # ...plus many more fields (request quirks, auth quirks, etc.)
```

Plus the discovery + registration entry:

```python
# providers/__init__.py
def register_provider(profile: ProviderProfile) -> None: ...
def get_provider_profile(name: str) -> Optional[ProviderProfile]: ...
def list_providers() -> List[str]: ...
def _discover_providers() -> None: ...  # lazy, scans plugins/model-providers/
```

And the transport ABC:

```python
# agent/transports/base.py
class Transport(ABC):
    """Format conversion + HTTP transport for one API mode."""

    @abstractmethod
    def chat(self, messages, tools, model_config) -> Response: ...
    @abstractmethod
    def stream(self, messages, tools, model_config) -> Iterator[StreamEvent]: ...
```

## Happy path: agent makes a call against the Anthropic plugin

```
[Agent startup, model="anthropic/claude-opus-4-7"]
  └─ call_llm("anthropic/claude-opus-4-7", messages, tools)
       └─ providers.get_provider_profile("anthropic")
            └─ providers/__init__.py
            └─ _discover_providers() — first-call only, lazy
                 └─ Scans <repo>/plugins/model-providers/anthropic/__init__.py
                 └─ Imports → calls register_provider(AnthropicProfile(...))
                 └─ Scans $HERMES_HOME/plugins/model-providers/anthropic/__init__.py
                      └─ If exists, also imports → register_provider() last-writer-wins
                 └─ Scans <repo>/providers/<name>.py (legacy back-compat)
            └─ Returns the registered profile
       └─ Profile fields:
              name="anthropic"
              api_mode="anthropic_messages"
              base_url="https://api.anthropic.com"
              auth_type="api_key"
              env_vars=("ANTHROPIC_API_KEY", "ANTHROPIC_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN")
              fallback_models=("claude-opus-4-7", "claude-sonnet-4-6", ...)

  └─ Transport selector: api_mode="anthropic_messages" → AnthropicTransport
       └─ agent/transports/anthropic.py

  └─ AnthropicTransport.chat(messages, tools, model_config={
            "model": "claude-opus-4-7",
            "base_url": "https://api.anthropic.com",
            "api_key": <resolved from env_vars chain>,
            ...
       })
       └─ Convert OpenAI-shape messages to Anthropic-shape (system/user/assistant/tool)
       └─ Convert tools to Anthropic format
       └─ POST https://api.anthropic.com/v1/messages
       └─ Parse response, convert back to OpenAI-shape
       └─ Return Response{content, tool_calls, finish_reason, usage}
```

## Architectural decisions

### AD-1: ProviderProfile is a declarative dataclass — no methods on it

- **Decision**: `ProviderProfile` declares *what* the provider is (auth, endpoint, dialect quirks). It doesn't *do* anything — no client construction, no credential rotation, no streaming logic. Per `providers/base.py:6-9`:

  ```
  Provider profiles are DECLARATIVE — they describe the provider's behavior.
  They do NOT own client construction, credential rotation, or streaming.
  Those stay on AIAgent.
  ```

- **Rationale**: A dataclass is trivial to add a new instance of (one file). A method-rich class would force every provider to reimplement boilerplate.

- **TypeScript translation**: `ProviderProfile` is a TypeScript interface — pure data. Methods like `fetchModels()` are *optional* methods that providers can override (Anthropic does, per `plugins/model-providers/anthropic/__init__.py:13-32`).

### AD-2: Lazy discovery — scanned on first call, not on import

- **Decision**: `_discover_providers()` is called lazily on the first `get_provider_profile()` or `list_providers()` call, *not* on import time. Per AGENTS.md:530-533:

  > `providers/__init__.py._discover_providers()` is a **lazy, separate
  > discovery system** — scanned on first `get_provider_profile()` or
  > `list_providers()` call, NOT by the general PluginManager.

- **Rationale**: Provider discovery imports many plugin `__init__.py` files. Doing it eagerly at startup adds noticeable cold-start latency. Lazy scan: pay the cost only if you use the feature.

- **TypeScript translation**: Same lazy-init pattern. First `ProviderRegistry.get(name)` triggers discovery; subsequent calls hit the cache.

### AD-3: Three-tier scan order with last-writer-wins

- **Decision**: Scan order (lowest → highest precedence):

  1. Bundled: `<repo>/plugins/model-providers/<name>/`
  2. User: `$HERMES_HOME/plugins/model-providers/<name>/`
  3. Legacy: `<repo>/providers/<name>.py` (back-compat)

  User plugins override bundled ones. Per AGENTS.md:534-540.

- **Rationale**: Users who want to swap out a built-in provider's behavior (custom endpoint, new aliases) can drop a same-named plugin into their HERMES_HOME without forking. The same name in `$HERMES_HOME` wins.

- **TypeScript translation**: `~/.theokit/plugins/model-providers/<name>/` user plugins override bundled. Scan order identical.

### AD-4: Discovery is separate from the general PluginManager

- **Decision**: The general `PluginManager` (`hermes_cli/plugins.py`) records `kind: model-provider` manifests but does NOT import them. Importing them would double-instantiate `ProviderProfile`. Per AGENTS.md:541-549.

- **Rationale**: Both discovery systems exist for different concerns. PluginManager handles general lifecycle hooks (pre/post tool call, session start/end). Provider discovery handles inference routing. Mixing them caused the double-registration bug pre-v0.13.

- **TypeScript translation**: Single plugin registry for our SDK — but providers and general plugins have different *kinds*. The registry imports general plugins eagerly (small surface) but defers provider plugins until requested.

### AD-5: `api_mode` selects the transport at runtime

- **Decision**: Each profile sets `api_mode` (default `"chat_completions"`). The agent uses that to select one of 4 transports: `chat_completions`, `anthropic_messages`, `codex_responses` (OpenAI Responses API for Codex), `bedrock_converse`.

- **Evidence**: `providers/base.py:30` (`api_mode: str = "chat_completions"`). Transport implementations at `agent/transports/*.py`.

- **Rationale**: Decoupling dialect from provider. Multiple providers may speak `anthropic_messages` (Anthropic direct, MiniMax's Anthropic-compat endpoint, AWS Bedrock's Anthropic-on-Bedrock). One transport handles all of them.

- **TypeScript translation**: Same enum. `apiMode: "chat_completions" | "anthropic_messages" | "openai_responses" | "bedrock_converse"`. Transport ABC + 4 implementations.

### AD-6: Auth types are an enumeration, not a free-form callback

- **Decision**: `auth_type` is one of: `api_key`, `oauth_device_code`, `oauth_external`, `copilot`, `aws_sdk`. Each is wired to a specific credential-resolution path.

- **Evidence**: `providers/base.py:34` documents the enum.

- **Rationale**: OAuth flows (device-code vs PKCE vs external token) and AWS's SDK-managed credentials are all different shapes. Enumerating them up front lets the credential-resolution code branch cleanly.

- **TypeScript translation**: `authType: "api_key" | "oauth_device_code" | "oauth_external" | "copilot" | "aws_sdk"`. Each maps to a credential resolver in `packages/sdk/src/internal/auth/`.

### AD-7: Curated `fallback_models` — tool-calling capable only

- **Decision**: `fallback_models` is shown in the `/model` picker when the live `/models` fetch fails. ONLY agentic tool-calling-capable models appear here.

- **Evidence**: `providers/base.py:47-49`:

  ```python
  # fallback_models: curated list shown in /model picker when live fetch fails.
  # Only agentic models that support tool calling should appear here.
  fallback_models: tuple = ()
  ```

- **Rationale**: Listing every model the provider serves overwhelms the user with embedding-only / image-only / non-agentic models. Curated lists keep the picker actionable.

- **TypeScript translation**: `fallbackModels: string[]`. Same curation discipline.

### AD-8: Hostname for reverse-mapping URLs → providers

- **Decision**: Each profile sets `hostname` (e.g. `"api.openai.com"`). When a config has `base_url: "https://api.openai.com/v1"` without an explicit `provider`, the reverse-lookup finds the matching profile by hostname.

- **Evidence**: `providers/base.py:51` (`hostname: str = ""`).

- **Rationale**: Users frequently override `base_url` without setting `provider`. Reverse-mapping lets the agent infer the right provider profile (and thus auth_type, api_mode) from the URL.

- **TypeScript translation**: `hostname: string`. Same reverse-mapping.

### AD-9: `OMIT_TEMPERATURE` sentinel for providers that reject the field

- **Decision**: Some providers (Kimi: server-managed temperature) reject the `temperature` parameter outright. The profile sets `default_temperature = OMIT_TEMPERATURE` (a sentinel) and the transport drops the field.

- **Evidence**: `providers/base.py:18`:

  ```python
  OMIT_TEMPERATURE = object()
  ```

- **Rationale**: Defaulting to `temperature=0` works for most providers but breaks Kimi. Optional-ness needs three values, not two: present-and-zero, present-and-non-zero, absent. A sentinel encodes the third.

- **TypeScript translation**: Use `undefined` to mean "omit". TypeScript doesn't need a sentinel because `undefined` already carries the "absent" semantic.

### AD-10: `supports_health_check` opt-out for `hermes doctor`

- **Decision**: Providers without a public `/models` endpoint set `supports_health_check = False`. `hermes doctor` skips the probe.

- **Evidence**: `providers/base.py:35`.

- **Rationale**: Some auth modes (Copilot, AWS Bedrock) don't expose a `/models` GET endpoint compatible with the doctor's probe. Without an opt-out, doctor reports false negatives.

- **TypeScript translation**: `supportsHealthCheck?: boolean` (default true).

### AD-11: Custom `fetch_models` per provider when needed

- **Decision**: Providers can override `fetch_models()` if the default `GET {base_url}/models` doesn't work. Example: Anthropic uses `x-api-key` header and `anthropic-version`, not Bearer auth.

- **Evidence**: `plugins/model-providers/anthropic/__init__.py:13-32`.

- **Rationale**: Most providers conform to OpenAI's `/models` shape. The minority that don't (Anthropic, AWS Bedrock, Copilot OAuth) override one method instead of forcing the generic helper to grow ten special cases.

- **TypeScript translation**: `fetchModels?(opts): Promise<string[] | null>`. Optional method.

### AD-12: Transport-per-dialect, not transport-per-provider

- **Decision**: 4 transports cover 22+ providers because most providers share a dialect (OpenAI chat_completions). New providers usually don't need a new transport.

- **Evidence**: `agent/transports/` has only 4 implementation files (`chat_completions.py`, `anthropic.py`, `codex.py`/`codex_app_server.py`, `bedrock.py`). Each handles many providers.

- **Rationale**: The unit of reuse is the dialect, not the provider. AWS Bedrock serves Anthropic, Mistral, Cohere, Meta models — one transport (`BedrockTransport`) handles them all because they all use the Converse API.

- **TypeScript translation**: 4 transport implementations under `packages/sdk/src/internal/transports/`. Adding a new provider with a new dialect = a new transport file.

## Data structures

### Persisted

None directly — provider configuration lives in `~/.hermes/config.yaml` and `~/.hermes/.env`. The plugin directory itself (`plugins/model-providers/<name>/__init__.py` and `plugin.yaml`) is the persisted form of a registered provider.

`plugin.yaml` example (minimal):

```yaml
name: anthropic
kind: model-provider
version: "1.0"
```

### In-memory

- Module-level `_PROVIDERS: Dict[str, ProviderProfile]` registry in `providers/__init__.py`.
- Module-level `_DISCOVERED: bool` flag — first call triggers scan, subsequent are no-ops.
- Per-call cache in `AIAgent`: `_provider_profile: Optional[ProviderProfile]` resolved at init.

### Concurrency model

- `register_provider` is called at module load — single-threaded.
- `_discover_providers` uses a `threading.Lock` to guard against concurrent scans during multi-threaded gateway startup.

## Failure modes Hermes already fixed

1. **Hardcoded `litellm` provider router** — replaced with `call_llm` centralized router in v0.2 PR #1003. Pre-fix, every provider was inline branches.
2. **Plugin discovery imports core files** — PR #5295 (v0.8) "Plugin CLI registration system — plugins register their own CLI subcommands without touching main.py" removed 95 lines of hardcoded honcho argparse from `main.py`. Established the "plugins MUST NOT modify core files" rule.
3. **General PluginManager double-instantiates `ProviderProfile`** — fixed by separating the two discovery systems (AGENTS.md:541-549).
4. **Auto-coerce plugins missing `kind:` via heuristic** — `register_provider` + `ProviderProfile` in `__init__.py` source text triggers auto-classification (AGENTS.md:546-549).
5. **Stale OAuth credentials block OpenRouter** — v0.8 PR #5746 fixed.
6. **`provider` config overridden by `model.provider`** — v0.7 PR #4329 separated the layers.
7. **Custom endpoint setup wizard overwrites config** — v0.7 PR #4180 fixed.
8. **Aux client doesn't honor named custom provider** — v0.8 PR #5978 fixed.
9. **GPT-5 family context lengths wrong in fallback** — v0.11 PR #9309 fixed.
10. **Anthropic token leaked to third-party `anthropic_messages` providers** — v0.4 PR #2389 fixed.
11. **Anthropic fallback inherits non-Anthropic `base_url`** — v0.4 PR #2388 fixed.
12. **`auxiliary_is_nous` never resets** — v0.4 PR #1713 fixed.

## TypeScript API proposal

### Public surface

```typescript
// src/index.ts
export type { ProviderProfile, ProviderPlugin, ApiMode, AuthType } from "./providers/types";
export { defineProvider, ProviderRegistry } from "./providers/registry";
export type { Transport, TransportOptions } from "./transports/types";

// src/providers/types.ts
export type ApiMode =
  | "chat_completions"
  | "anthropic_messages"
  | "openai_responses"
  | "bedrock_converse";

export type AuthType =
  | "api_key"
  | "oauth_device_code"
  | "oauth_external"
  | "copilot"
  | "aws_sdk";

export interface ProviderProfile {
  // Identity
  name: string;
  apiMode?: ApiMode;             // default "chat_completions"
  aliases?: string[];

  // Display
  displayName?: string;
  description?: string;
  signupUrl?: string;

  // Auth & endpoints
  envVars?: string[];
  baseUrl?: string;
  modelsUrl?: string;
  authType?: AuthType;           // default "api_key"
  supportsHealthCheck?: boolean; // default true

  // Catalog
  fallbackModels?: string[];
  hostname?: string;

  // Per-provider quirks
  defaultAuxModel?: string;
  omitTemperature?: boolean;
  defaultTemperature?: number;
  defaultMaxTokens?: number;

  // Custom hooks
  fetchModels?(opts: { apiKey?: string; timeoutMs?: number }): Promise<string[] | null>;
}

export interface ProviderPlugin {
  kind: "model-provider";
  profile: ProviderProfile;
}

export function defineProvider(profile: ProviderProfile): ProviderPlugin {
  return { kind: "model-provider", profile };
}

// src/providers/registry.ts
export class ProviderRegistry {
  static register(plugin: ProviderPlugin): void;
  static get(name: string): ProviderProfile | undefined;
  static list(): string[];
  /** Lazy discovery on first call. */
  private static discover(): Promise<void>;
}
```

### Migration of hardcoded providers

We migrate the four hardcoded v1.2 providers into plugins as part of v1.3:

```typescript
// src/providers/builtin/openai.ts
import { defineProvider } from "../registry";

export const openaiProfile = defineProvider({
  name: "openai",
  apiMode: "chat_completions",
  envVars: ["OPENAI_API_KEY"],
  baseUrl: "https://api.openai.com/v1",
  authType: "api_key",
  hostname: "api.openai.com",
  fallbackModels: ["gpt-5-5", "gpt-5-4", "gpt-4-1", …],
});

// src/providers/builtin/anthropic.ts
export const anthropicProfile = defineProvider({
  name: "anthropic",
  apiMode: "anthropic_messages",
  envVars: ["ANTHROPIC_API_KEY", "ANTHROPIC_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"],
  baseUrl: "https://api.anthropic.com",
  authType: "api_key",
  hostname: "api.anthropic.com",
  fallbackModels: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"],
  fetchModels: async ({ apiKey }) => {
    // Anthropic uses x-api-key header
    if (!apiKey) return null;
    const r = await fetch("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data.data?.map((m: any) => m.id) ?? null;
  },
});

// And similar for gemini, openrouter.
```

### Internal module layout

```
packages/sdk/src/internal/providers/
├── types.ts                      # ProviderProfile, ProviderPlugin, ApiMode, AuthType
├── registry.ts                   # ProviderRegistry with lazy discovery
├── discovery.ts                  # _discover_providers equivalent (filesystem scan)
├── builtin/                      # The 4 hardcoded → plugin migrations
│   ├── openai.ts
│   ├── anthropic.ts
│   ├── gemini.ts
│   └── openrouter.ts
└── third-party/                  # Examples for community plugins
    └── README.md

packages/sdk/src/internal/transports/
├── base.ts                       # Transport ABC
├── types.ts                      # Common shapes
├── chat-completions.ts           # OpenAI-compatible
├── anthropic.ts                  # Anthropic Messages API
├── openai-responses.ts           # OpenAI Responses API
└── bedrock.ts                    # AWS Bedrock Converse
```

### Optional peer dependencies

| Dep | Why | When required |
|---|---|---|
| `@aws-sdk/client-bedrock-runtime` | Bedrock Converse API | Only if `bedrock` provider used |
| OpenAI/Anthropic/Google SDKs | Optional convenience | We expose `fetch`-based transports first; SDKs as opt-in |

### Migration impact on v1.2 users

- **Backward-compatible**: Yes if user passed model strings (`"openai/gpt-5-5"`, `"anthropic/claude-opus-4-7"`). The migration is invisible.
- **Breaking signature changes**: None.
- **For users who currently configure providers via `Agent.create({ provider: "openai", apiKey: "..." })`**: same API, but now backed by the plugin registry. No code changes needed.

## Test strategy

Port Hermes' `tests/providers/`:

- `test_plugin_discovery.py` — discovery system: bundled-only, user-override, double-registration, missing plugin
- `test_provider_profiles.py` — profile contract: name uniqueness, alias resolution, fallback_models validation

**Unit tests**:
- Discovery: scan order (bundled vs user-override), last-writer-wins, missing entry, malformed plugin.yaml.
- `defineProvider`: all field validations.
- `ProviderRegistry.get`: alias resolution.

**Integration tests**:
- Set up a fake plugin in a temp dir, point `THEOKIT_HOME` at it, call `ProviderRegistry.get`, assert override wins over bundled.

**Real-LLM tests**:
- For each of openai/anthropic/gemini/openrouter migrated builtin, fire a real call, assert correct transport selected and response received.

## Open questions

- **Plugin packaging**: do users ship as npm packages (`@my/theokit-provider-acme`) or filesystem drops in `~/.theokit/plugins/`? Recommend both. npm for distribution, filesystem for local dev.
- **`copilot` and `copilot-acp` auth modes**: very specific to GitHub Copilot's OAuth flow. Do we support these in v1.3 or defer?
- **`aws_sdk` auth**: requires `@aws-sdk/credential-providers`. Heavy. Make it a peer dep with lazy import.
- **Backwards compatibility for v1.2 hardcoded `provider: "openai"` etc.**: the API shouldn't change but the internal routing does. Need migration tests.

## References

- `referencia/hermes-agent/providers/base.py:1-166`
- `referencia/hermes-agent/providers/__init__.py:1-191`
- `referencia/hermes-agent/plugins/model-providers/anthropic/__init__.py`
- `referencia/hermes-agent/agent/transports/base.py`
- `referencia/hermes-agent/agent/transports/*.py`
- AGENTS.md:527-549 — Model-provider plugins section
- RELEASE_v0.11.0.md PR #13347 — Transport ABC by @kshitijk4poor + Teknium
- RELEASE_v0.13.0.md PR #20324 — `ProviderProfile` ABC + `plugins/model-providers/` (salvage of #14424)
- Theokit ADRs:
  - D24 — `defineTool` schema source = Zod — analogous pattern; provider plugins follow the same `define*` shape
  - D32 — `@usetheo/react` as separate package — informs our split: providers stay in core for v1.3, ship adapter packages later if needed
