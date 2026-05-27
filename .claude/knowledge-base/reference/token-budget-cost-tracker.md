# Reference: Token Budget / Cost Tracker

**Date:** 2026-05-27
**Depth:** exhaustive
**Frameworks analyzed:** mastra (4906 .ts), hermes-agent (1681 .py), openai-agents-python (773 .py), openclaw (14404 .ts), pi (672 .ts), cookbook (32 .ts)
**TheoKit package affected:** `packages/sdk` (novo `src/budget.ts` + extensão de `src/types/run.ts`) + `packages/cli` (`theokit budget` subcommand, opcional)
**Related references:** nenhum doc preexistente em `.claude/knowledge-base/reference/`. Adjacente: `.claude/knowledge-base/plans/tasks-queued-running-observable-plan.md` (Task registry expõe meta.tokens/cost via spans v0.2).

---

## 1. Problem statement

- **What:** Adicionar à `@usetheo/sdk` um sistema de tracking de **tokens consumidos + custo USD estimado** + **enforcement de budgets** (hard cap / warn / audit). Surface mínimo: (a) `result.usage` em todo `RunResult`, (b) `Budget` static class com windows stacked (per-day/week/month), (c) `BudgetExceededError` no fail-fast antes da chamada LLM, (d) hook/event para observability externa (Langfuse/Sentry/OTel).
- **Current state:** `RunResult` em [`packages/sdk/src/types/run.ts:49-66`](packages/sdk/src/types/run.ts) tem apenas `{ id, status, result?, model?, durationMs?, git?, error? }` — **sem usage, sem cost**. Zero pricing data bundled. Sem primitivo de Budget. A análise SDK vs Hermes (2026-05-27) marcou "Token budget / cost tracking" como gap MISS — Hermes tem `agent/usage_pricing.py` completo; nós não temos nada.
- **Why now:** Identificado nesta semana como gap residual #1 pós-ACP + Tasks. ROI alto para enterprise (controle de spend), esforço pequeno (1-2 dias) por já existirem 4+ reference implementations + LiteLLM pricing JSON como source-of-truth. Token tracking é também pré-requisito para "cost-velocity circuit breaker" + observability stack 2026 (Langfuse/Helicone esperam essa shape).

## 2. Inventário completo de arquivos

Lista exaustiva — gerada por 3 passadas (nome / conteúdo / docs) com keyword `token|cost|usage|budget|pricing|spend`.

### `mastra` — inventário

| File | Category | LOC | Read in full? | Anchored in |
|---|---|---|---|---|
| `packages/core/src/processors/processors/cost-guard.ts` | core | 308 | ✅ | §3.1, §4 (pattern), §7 (algorithm), §8 (async metric flush) |
| `packages/core/src/processors/processors/token-limiter.ts` | core | 413 | ✅ | §3.1, §4 (pattern), §6 (tokenx), §7, §8 (tool overhead) |
| `observability/mastra/src/metrics/pricing-model.ts` | core | ~150 (read first 80) | ✅ (head) | §3.1, §7 (PricingTier match) |
| `observability/mastra/src/metrics/pricing-registry.ts` | support | ~120 (head 50) | ✅ (head) | §3.1, §6 (minified JSON loader) |
| `observability/mastra/src/metrics/pricing-data.jsonl` | doc/data | 5261 lines | sample (head 10) | §7 (data shape), §6 |
| `observability/mastra/src/metrics/usage-metrics.ts` | core | 42 | ✅ | §3.1, §5 (10 meter buckets) |
| `mastracode/src/utils/token-estimator.ts` | support | small | snippet | §6 (`tokenx`) |
| `mastracode/src/tui/commands/cost.ts` | support | 22 | ✅ | §3.1 (CLI surface), §9.3 |
| `packages/core/src/processors/processors/token-accuracy.e2e.test.ts` | test | n/a | seletivo | §8 |
| `packages/core/src/processors/processors/token-limiter.test.ts` | test | n/a | seletivo | §8 |
| `packages/core/src/processors/processors/cost-guard.test.ts` | test | n/a | seletivo | §8 |
| `packages/core/src/agent/__tests__/usage-tracking.test.ts` | test | n/a | seletivo | §8 |
| `packages/memory/src/processors/observational-memory/token-counter.ts` | support | n/a | not read (memory-specific) | (discarded) |
| `packages/memory/src/processors/observational-memory/model-by-input-tokens.ts` | support | n/a | not read | (discarded) |
| `packages/memory/src/memory-usage.test.ts` | test | n/a | not read (memory-specific) | (discarded) |
| `observability/mastra/src/usage.ts` | support | n/a | not read (observability backend specific) | §3.1 (mentioned) |
| `observability/mastra/src/usage.test.ts` | test | n/a | not read | (discarded) |
| `observability/posthog/src/usage.test.ts` | test | n/a | not read (PostHog-specific) | (discarded) |
| `workflows/_test-utils/src/domains/usage.ts` | test | n/a | not read | (discarded) |
| `explorations/longmemeval/USAGE.md` | doc | n/a | not read (exploration-only) | (discarded) |
| `explorations/longmemeval/src/commands/tokens.ts` | support | n/a | not read | (discarded) |
| `packages/core/src/harness/token-usage.test.ts` | test | n/a | not read | (discarded) |
| `packages/cli/src/commands/auth/tokens.ts` | support | n/a | not read (CLI auth tokens, not LLM) | (discarded — wrong "token") |
| `.changeset/client-token-estimate.md` | doc | n/a | not read | (discarded) |

### `hermes-agent` — inventário

| File | Category | LOC | Read in full? | Anchored in |
|---|---|---|---|---|
| `agent/usage_pricing.py` | core | 877 | ✅ | §3.2, §4, §5 (3 API shapes), §6 (`Decimal` precision), §7, §8 |
| `agent/account_usage.py` | core | n/a | not read (account aggregation — out of SDK scope) | §3.2 (mentioned) |
| `tools/budget_config.py` | core | 51 | ✅ | §3.2 (different "budget" — char limit for tool persistence; OK to acknowledge but is **not** the cost-budget pattern) |
| `tools/skill_usage.py` | support | n/a | not read (skill-internal) | (discarded) |
| `tests/agent/test_usage_pricing.py` | test | n/a | head 50 | §8 (edge cases: cline#10266) |
| `tests/test_account_usage.py` | test | n/a | not read | (discarded) |
| `tests/hermes_cli/test_tool_token_estimation.py` | test | n/a | not read | (discarded) |
| `tests/hermes_cli/test_tencent_tokenhub_provider.py` | test | n/a | not read (provider-specific) | (discarded) |
| `tests/hermes_cli/test_copilot_token_exchange.py` | test | n/a | not read (OAuth — wrong "token") | (discarded — wrong "token") |
| `tests/hermes_cli/test_placeholder_usage.py` | test | n/a | not read | (discarded) |
| `tests/run_agent/test_context_token_tracking.py` | test | n/a | not read | (discarded) |
| `tests/run_agent/test_iteration_budget_race.py` | test | n/a | not read (iteration budget, not cost) | (discarded — different concept) |
| `tests/run_agent/test_token_persistence_non_cli.py` | test | n/a | not read | (discarded) |
| `tests/agent/test_compressor_image_tokens.py` | test | n/a | not read (compression-internal) | (discarded) |
| `tests/tools/test_skill_usage.py` | test | n/a | not read | (discarded) |
| `tests/tools/test_budget_config.py` | test | n/a | not read (char budget, not cost) | (discarded — different concept) |
| `tests/gateway/test_usage_command.py` | test | n/a | not read | (discarded) |
| `ui-tui/src/domain/usage.ts` | core | n/a | not read (TUI surface — guidance only) | §3.2 (mentioned) |
| `optional-skills/mlops/**/references/*.md` | doc | n/a | not read (mlops skills docs — orthogonal) | (discarded — wrong domain) |
| `skills/software-development/subagent-driven-development/references/context-budget-discipline.md` | doc | n/a | not read | (discarded — different "budget") |

### `openai-agents-python` — inventário

| File | Category | LOC | Read in full? | Anchored in |
|---|---|---|---|---|
| `src/agents/usage.py` | core | 322 | ✅ | §3.3, §4 (pattern), §5 (request_usage_entries), §7 (deserialize_usage flexibility) |
| `docs/usage.md` | doc | n/a | ✅ | §3.3, §4 (hook pattern via RunHooks) |
| `docs/ref/usage.md` | doc | n/a | not read (auto-generated mkdocs ref) | (discarded — duplicate of usage.md) |
| `docs/{ko,ja,zh}/usage.md` | doc | n/a | not read (translated copies) | (discarded — generated) |
| `examples/basic/usage_tracking.py` | support | n/a | not read (example, design implied by usage.md) | §3.3 (mentioned) |
| `tests/test_usage.py` | test | n/a | not read | (discarded) |
| `tests/sandbox/test_token_truncation.py` | test | n/a | not read (sandbox-specific) | (discarded) |
| `src/agents/sandbox/util/token_truncation.py` | support | n/a | not read (sandbox-specific, not cost tracking) | (discarded — different concept) |
| `docs/ref/sandbox/util/token_truncation.md` | doc | n/a | not read | (discarded) |

### `openclaw` — inventário (apenas itens relevantes — extensions/* descartados per CLAUDE.md root rules)

| File | Category | LOC | Read in full? | Anchored in |
|---|---|---|---|---|
| `src/shared/usage-types.ts` | core | 73 | ✅ | §3.4, §5 (multi-dimension aggregation) |
| `src/shared/usage-aggregates.ts` | core | n/a | not read (delegates to types) | §3.4 (referenced) |
| `src/shared/session-usage-timeseries-types.ts` | core | n/a | not read (telemetry shape only) | (discarded — telemetry not core algorithm) |
| `src/utils/usage-format.ts` | support | ~600 | head 100 | §3.4, §9.3 (formatters) |
| `src/plugin-sdk/provider-usage.ts` | core | 26 | ✅ | §3.4 (per-provider plugin surface) |
| `src/test-utils/provider-usage-fetch.ts` | test | n/a | not read (fixture) | (discarded) |
| `src/shared/usage-aggregates.test.ts` | test | n/a | not read | (discarded) |
| `src/utils/usage-format.test.ts` | test | n/a | not read | (discarded) |
| `extensions/github-copilot/usage.ts` | core | n/a | not read (extension/plugin) | (discarded — wrong scope per openclaw boundary rules) |
| `extensions/github-copilot/token.ts` | support | n/a | not read | (discarded — OAuth token, not LLM) |
| `extensions/amazon-bedrock-mantle/bedrock-token-generator.d.ts` | support | n/a | not read | (discarded — auth token) |
| `extensions/google/oauth.token.ts` | support | n/a | not read | (discarded — wrong "token") |
| `scripts/*budget*.mjs` | doc/script | n/a | not read | (discarded — npm pack/perf budgets, not LLM cost) |
| `scripts/cron_usage_report.ts` | support | n/a | not read | (discarded — admin reporting, not SDK) |
| `scripts/debug-claude-usage.ts` | support | n/a | not read (debug-only) | (discarded) |
| `scripts/analyze-plugin-sdk-usage.ts` | support | n/a | not read | (discarded — wrong "usage") |
| `src/gateway/server.shared-token-session-rotation.test.ts` | test | n/a | not read | (discarded — auth token) |
| `src/gateway/server.auth.default-token.suite.ts` | test | n/a | not read | (discarded — auth token) |

### `pi` — inventário

| File | Category | LOC | Read in full? | Anchored in |
|---|---|---|---|---|
| `scripts/cost.ts` | support | 100+ (head 80) | ✅ (head) | §3.5 (file-based cost aggregation from session JSONL) |
| `packages/ai/test/tokens.test.ts` | test | n/a | not read | (discarded — asserts internal AI calls only) |
| `packages/ai/test/total-tokens.test.ts` | test | n/a | not read | (discarded) |
| `packages/web-ui/scripts/count-prompt-tokens.ts` | support | n/a | not read (web-ui script) | (discarded — out of SDK scope) |
| `packages/web-ui/src/utils/auth-token.ts` | support | n/a | not read (auth, not LLM) | (discarded — wrong "token") |
| `packages/coding-agent/test/suite/regressions/3982-message-end-cost-override.test.ts` | test | n/a | not read | (discarded — coding-agent regression specific) |
| `packages/coding-agent/docs/usage.md` | doc | n/a | not read (user-facing CLI usage doc) | (discarded — not SDK cost) |

### `cookbook` — inventário

| File | Category | LOC | Read in full? | Anchored in |
|---|---|---|---|---|
| (none matched keyword) | — | — | — | (cookbook tem 32 .ts mas nenhum bate filename/grep nos tópicos) |

### Arquivos avaliados e descartados (com motivo)

Já listados nas tabelas acima na coluna "Anchored in" como `(discarded — <reason>)`. Resumo de motivos:
- **Wrong "token"**: OAuth/auth tokens, não LLM tokens — semanticamente diferente
- **Wrong "budget"**: char limits para tool result persistence (Hermes `budget_config.py`) ou iteration budgets (`test_iteration_budget_race`), não USD/cost budgets
- **Wrong scope**: openclaw extensions/* (plugin local code per CLAUDE.md boundary rules), pi web-ui (out of SDK scope), Mastra observability backend adapters (PostHog/Mastra-cloud-specific)
- **Translated/generated docs**: ko/ja/zh copies + auto-gen mkdocs ref
- **Generated data**: pricing-data.jsonl 5261 lines lido apenas head 10 para shape

---

## 3. Prior art — deep dive por framework

### 3.1 `mastra` — Cost Guard + Token Limiter + Pricing Registry

#### API pública (resumida)

```ts
// packages/core/src/processors/processors/cost-guard.ts:154-307
export class CostGuardProcessor implements Processor<'cost-guard', CostGuardTripwireMetadata> {
  constructor(options: CostGuardOptions);
  // options: { maxCost, scope?: 'run'|'resource'|'thread', window?: '1h'|'6h'|'24h'|'7d'|'30d'|'365d',
  //            strategy?: 'block'|'warn', message?: string }
  async processInputStep(args: ProcessInputStepArgs): Promise<void>;
  onViolation?: (violation: ProcessorViolation) => void | Promise<void>;
}

// packages/core/src/processors/processors/token-limiter.ts:48-412
export class TokenLimiterProcessor implements Processor<'token-limiter', TokenLimiterTripWireMetadata> {
  constructor(options: number | TokenLimiterOptions);
  // options: { limit, strategy?: 'truncate'|'abort', countMode?: 'cumulative'|'part',
  //            trimMode?: 'best-fit'|'contiguous' }
  async processInputStep(args): Promise<void>;
  async processOutputStream(args): Promise<ChunkType|null>;
  async processOutputResult(args): Promise<MastraDBMessage[]>;
}

// observability/mastra/src/metrics/pricing-model.ts
export class PricingModel { /* id, provider, model, schema, currency, tiers */ }
export class PricingTier {
  matchesUsage(usage: UsageStats): boolean;  // tier predicate
  hasMatchingMeterForUsage(meter: PricingMeter): boolean;
}
```

#### Algoritmo interno (cost-guard, prosa)

1. No `processInputStep` (chamado antes de cada LLM call dentro do agent loop):
   1. Resolve **scope filter** via `requestContext`: `run` → `{traceId}`, `resource` → `{resourceId}`, `thread` → `{threadId}`. ([cost-guard.ts:190-209](packages/core/src/processors/processors/cost-guard.ts))
   2. Para scopes não-`run`, calcula janela temporal `{start: now - WINDOW_MS[window]}`. ([cost-guard.ts:96-103](packages/core/src/processors/processors/cost-guard.ts))
   3. Query **observability storage** com `getMetricAggregate({ name: ['mastra_model_total_input_tokens'], aggregation: 'sum', filters })` + idem para output_tokens — em paralelo `Promise.all`. ([cost-guard.ts:231-242](packages/core/src/processors/processors/cost-guard.ts))
   4. Resultado `{ estimatedCost, costUnit }` vem **pré-multiplicado** pela storage layer (i.e. storage já fez `tokens * rate`).
   5. Se `estimatedCost < maxCost` → return (allow). Se ≥ maxCost: invoca `onViolation` callback (catch errors silenciosamente — guard não pode quebrar) + `strategy === 'warn'` chama `console.warn` + return; `strategy === 'block'` chama `args.abort(message, { retry: false, metadata })` → throws `TripWire`. ([cost-guard.ts:262-306](packages/core/src/processors/processors/cost-guard.ts))

#### Algoritmo interno (token-limiter, prosa)

1. `processInputStep`: ([token-limiter.ts:88-162](packages/core/src/processors/processors/token-limiter.ts))
   1. Conta `systemTokens` (sempre preservados); se `systemTokens + 24 >= limit` → throw TripWire imediatamente (sistema sozinho excede).
   2. `remainingBudget = limit - systemTokens - 24`.
   3. Itera mensagens em **ordem reversa** (mais recentes primeiro), acumulando até `remainingBudget`. `trimMode: 'contiguous'` para no primeiro overflow; `'best-fit'` continua tentando encaixar mensagens menores.
   4. Remove via `messageList.removeByIds(idsToRemove)` quando não couber.
2. `processOutputStream`: ([token-limiter.ts:256-305](packages/core/src/processors/processors/token-limiter.ts))
   1. Por chunk, conta tokens via `countTokensInChunk` (text-delta / object / tool-call / tool-result branches).
   2. `countMode: 'cumulative'` soma desde início; `'part'` reseta a cada chunk.
   3. Se exceder + `strategy === 'abort'` → `abort()` (lança); `'truncate'` → return `null` (drop chunk).
3. `processOutputResult`: ([token-limiter.ts:348-404](packages/core/src/processors/processors/token-limiter.ts))
   1. Trunca text content para caber em `limit - cumulativeTokens` via `sliceByTokens(text, 0, remainingTokens)` do `tokenx`.

#### Estado mantido

- `CostGuardProcessor.maxCost / scope / window / strategy / messageTemplate / observabilityStorage` (todos imutáveis após construct, exceto `observabilityStorage` set em `__registerMastra`).
- `TokenLimiterProcessor.maxTokens / strategy / countMode / trimMode`. Estado **per-stream** vive no `args.state` (passado pelo runtime).
- Constants: `TOKENS_PER_MESSAGE = 3.8`, `TOKENS_PER_CONVERSATION = 24` ([token-limiter.ts:57-58](packages/core/src/processors/processors/token-limiter.ts)).

#### Dependências externas usadas

| Lib | Versão | Para quê | TheoKit pode adotar? |
|---|---|---|---|
| `tokenx` | `^1.3.0` | `estimateTokenCount(text)` + `sliceByTokens(text, 0, N)` — pure-JS 2KB approx (96% accuracy) | **Avaliar** — bom para estimativa pré-call, mas confiar em response.usage para billing |
| `@internal/ai-sdk-v4` | workspace | `CoreMessage` shape | (não aplicável) |

#### Side effects observáveis

- `processInputStep` no `cost-guard.ts` faz query async em observability storage — pode consumir 50-200ms por step.
- `console.warn` em `strategy: 'warn'` — log unconditional.
- `messageList.removeByIds()` no token-limiter **muta** a lista de mensagens da run.

#### TODOs / FIXMEs / HACKs literais

- `cost-guard.ts:112-113`: > *"Cost data is queried from observability storage, which persists metrics asynchronously via buffered exporters. Fast-running agents may exceed the configured limit before metrics are available for query. Treat maxCost as a best-effort threshold, not a hard ceiling."*
- `token-limiter.ts:17-18`: `@deprecated Token counts are now estimated using tokenx (no BPE encoder required). This option is accepted for backwards compatibility but is ignored.` — eles **abandonaram tiktoken** em favor de approximation.

#### Padrão de design

- **Processor chain** — cost guard e token limiter implementam `Processor<id, metadata>` interface, executados como hooks pre/post step pelo Mastra runtime. Comparável aos nossos hooks `pre_user_send`/`pre_tool_call` (D145).
- **Tiered pricing** — `PricingTier.when[]` permite mudança de preço a partir de N tokens de input (ex: Gemini 2.5 Pro cobra mais > 200k tokens). ([pricing-model.ts:1-67](observability/mastra/src/metrics/pricing-model.ts))
- **Minified JSON registry** — keys abreviadas (`it`=input_tokens, `ot`=output_tokens, `icrt`=input_cache_read, `icwt`=input_cache_write, `iat`=input_audio, `oat`=output_audio, `ort`=output_reasoning) para reduzir bundle size de 5261 entradas. ([pricing-registry.ts:1-50](observability/mastra/src/metrics/pricing-registry.ts))
- **10 meter buckets** ([usage-metrics.ts:22-38](observability/mastra/src/metrics/usage-metrics.ts)): input total, output total, input.text, input.cacheRead, input.cacheWrite, input.audio, input.image, output.text, output.reasoning, output.audio, output.image.

### 3.2 `hermes-agent` — Canonical usage + per-million-token pricing

#### API pública

```python
# agent/usage_pricing.py:29-77
@dataclass(frozen=True)
class CanonicalUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    reasoning_tokens: int = 0
    request_count: int = 1
    raw_usage: Optional[dict[str, Any]] = None
    # properties: prompt_tokens (input + cache_read + cache_write), total_tokens

@dataclass(frozen=True)
class BillingRoute:
    provider: str; model: str; base_url: str; billing_mode: str
    # billing_mode: "subscription_included" | "official_models_api" | "official_docs_snapshot" | "unknown"

@dataclass(frozen=True)
class PricingEntry:
    input_cost_per_million: Optional[Decimal]
    output_cost_per_million: Optional[Decimal]
    cache_read_cost_per_million: Optional[Decimal]
    cache_write_cost_per_million: Optional[Decimal]
    request_cost: Optional[Decimal]
    source: CostSource  # 'provider_cost_api'|'provider_generation_api'|'provider_models_api'|'official_docs_snapshot'|'user_override'|'custom_contract'|'none'
    source_url: Optional[str]
    pricing_version: Optional[str]
    fetched_at: Optional[datetime]

@dataclass(frozen=True)
class CostResult:
    amount_usd: Optional[Decimal]
    status: CostStatus  # 'actual' | 'estimated' | 'included' | 'unknown'
    source: CostSource
    label: str
    fetched_at, pricing_version, notes

# Functions
def resolve_billing_route(model_name, provider=None, base_url=None) -> BillingRoute
def get_pricing_entry(model_name, provider, base_url, api_key) -> Optional[PricingEntry]
def normalize_usage(response_usage, *, provider, api_mode) -> CanonicalUsage  # 3 API shapes
def estimate_usage_cost(model_name, usage, *, provider, base_url, api_key) -> CostResult
def has_known_pricing(model_name, ...) -> bool
def format_token_count_compact(value: int) -> str  # "1.5K", "2M"
def format_duration_compact(seconds: float) -> str  # "1h 30m"
```

#### Algoritmo interno (normalize_usage — handles 3 API shapes)

`agent/usage_pricing.py:672-742`:
1. **Anthropic Messages API** (`mode == "anthropic_messages" or provider == "anthropic"`):
   - `input_tokens = response_usage.input_tokens` (NÃO inclui cache)
   - `cache_read_tokens = response_usage.cache_read_input_tokens`
   - `cache_write_tokens = response_usage.cache_creation_input_tokens`
   - **Anthropic já separa as 4 buckets**.
2. **OpenAI Codex Responses API** (`mode == "codex_responses"`):
   - `input_total = response_usage.input_tokens` (inclui cached)
   - `cache_read_tokens = response_usage.input_tokens_details.cached_tokens`
   - `cache_write_tokens = response_usage.input_tokens_details.cache_creation_tokens`
   - `input_tokens = max(0, input_total - cache_read_tokens - cache_write_tokens)` ← **subtrai** para isolar
3. **OpenAI Chat Completions** (default):
   - `prompt_total = response_usage.prompt_tokens`
   - `cache_read_tokens = response_usage.prompt_tokens_details.cached_tokens` OR top-level `cache_read_input_tokens` (Anthropic-style)
   - `cache_write_tokens = details.cache_write_tokens` OR top-level `cache_creation_input_tokens`
   - **Critical edge case ([usage_pricing.py:710-729](agent/usage_pricing.py))**: alguns proxies OpenAI-compat (OpenRouter, Vercel AI Gateway, Cline) expõem Anthropic-style cache fields no TOP-LEVEL ao roteear modelos Claude — sem fallback, cache writes ficam 0. Port do bugfix `cline/cline#10266`.
4. `reasoning_tokens = response_usage.output_tokens_details.reasoning_tokens` (OpenAI o-series).

#### Algoritmo interno (estimate_usage_cost)

`agent/usage_pricing.py:745-821`:
1. `route = resolve_billing_route(...)`. Se `billing_mode == 'subscription_included'` (Codex CLI / Claude Pro subscription) → return `CostResult(amount=0, status='included')`.
2. `entry = get_pricing_entry(...)` — tenta na ordem: OpenRouter API (lazy) → endpoint `/models` discovery (lazy) → `_OFFICIAL_DOCS_PRICING` static dict (200+ entries hardcoded).
3. Se faltar pricing para qualquer bucket usado → `CostResult(amount=None, status='unknown', notes=('cache-read pricing unavailable for route',))` — **NÃO emite valor errado**.
4. Soma `Decimal(tokens) * Decimal(per_million) / 1_000_000` para cada bucket. Usa **Decimal** (não float) para evitar imprecisão de ponto-flutuante em billing.
5. `route.provider == 'openrouter'` → adiciona nota `"OpenRouter cost is estimated from the models API until reconciled."` (preço real vem do `/generation` endpoint pós-call).

#### Estado mantido

- `_OFFICIAL_DOCS_PRICING: Dict[(str, str), PricingEntry]` — static dict bundled at import time, 200+ models 2026-05 ([usage_pricing.py:85-508](agent/usage_pricing.py)).
- Cache via `fetch_model_metadata()` + `fetch_endpoint_model_metadata(base_url, api_key)` ([usage_pricing.py:9](agent/usage_pricing.py)) — implementação em `agent/model_metadata.py` (not read in detail).

#### Dependências externas usadas

| Lib | Versão | Para quê | TheoKit pode adotar? |
|---|---|---|---|
| Python stdlib `decimal.Decimal` | n/a | Precision-safe arithmetic for USD | Em TS usar string-based decimal lib (`big.js`, `decimal.js`) — **Avaliar**; muitos SDKs aceitam `number` mas perdem precisão em centavos |

#### Side effects observáveis

- Nenhum em `usage_pricing.py` puro. `fetch_model_metadata` (módulo externo) faz HTTP GET para OpenRouter `/models` e cacheia em memória.

#### TODOs / FIXMEs / HACKs literais

- `usage_pricing.py:715-718`: > *"Port of cline/cline#10266 — alguns proxies expõem Anthropic-style cache fields no top-level; sem este fallback, cache writes ficam 0."*

#### Padrão de design

- **Discriminated `CostStatus`** — 4 valores fechados (actual/estimated/included/unknown). Caller branchea explicitamente; "estimated" exibe `~$1.23`, "unknown" exibe `n/a`, "included" exibe `included` (não 0).
- **Per-million pricing convention** — todas as taxas em USD por 1_000_000 tokens (canônico no setor desde 2024).
- **Source provenance** — toda PricingEntry carrega `source` + `source_url` + `pricing_version` + `fetched_at`. Permite UI mostrar "preços de Anthropic 2026-05" vs "estimado pelo OpenRouter API agora".
- **Three-mode normalization** — uma função `normalize_usage(usage, *, provider, api_mode)` cobre todos os providers conhecidos. Não scattera lógica de parsing.

### 3.3 `openai-agents-python` — Aggregated `Usage` + RequestUsage breakdown

#### API pública

```python
# src/agents/usage.py:60-77
@dataclass
class RequestUsage:
    input_tokens: int
    output_tokens: int
    total_tokens: int
    input_tokens_details: InputTokensDetails  # cached_tokens
    output_tokens_details: OutputTokensDetails  # reasoning_tokens

# src/agents/usage.py:102-216
@dataclass
class Usage:
    requests: int = 0
    input_tokens: int = 0
    input_tokens_details: InputTokensDetails
    output_tokens: int = 0
    output_tokens_details: OutputTokensDetails
    total_tokens: int = 0
    request_usage_entries: list[RequestUsage]  # per-request breakdown
    def add(self, other: Usage) -> None: ...

# Helpers
def serialize_usage(usage) -> dict; def deserialize_usage(data) -> Usage
def model_usage_to_span_usage(usage) -> dict       # for OTel spans
def turn_usage_to_span_data(usage) -> dict          # per-turn aggregate
def task_usage_to_span_data(usage) -> dict          # per-task aggregate
```

#### Algoritmo interno (Usage.add)

`src/agents/usage.py:157-215`:
1. Aggregate top-level: `requests += other.requests`, `input/output/total_tokens += other.*`.
2. Aggregate nested details (null-safe via guards — porque OpenAI SDK pode usar `model_construct` que bypass Pydantic e deixa `None`).
3. **`request_usage_entries` automatic merge**:
   - Se `other.request_usage_entries` já existe → extend (preserva nested details).
   - Senão se `other.requests == 1 and other.total_tokens > 0` → sintetiza um RequestUsage entry a partir dos top-level fields.
   - Garante que a breakdown per-request sempre cresce em proporção a `requests`, mesmo quando o caller só agregou top-level.

#### Estado mantido

- Pura data dataclass — `Usage` é serializable + agregável; sem singletons globais.
- Surface única: `result.context_wrapper.usage` (via `RunContextWrapper`) ou hook `RunHooks.on_agent_end(ctx, agent, output)` lê `ctx.usage`. ([docs/usage.md](docs/usage.md))

#### Dependências externas usadas

| Lib | Versão | Para quê | TheoKit pode adotar? |
|---|---|---|---|
| `openai` SDK | n/a | `CompletionTokensDetails`, `PromptTokensDetails`, `InputTokensDetails`, `OutputTokensDetails` types | **Não** — nosso SDK é multi-provider; copiamos a shape mas não a dependência |
| `pydantic` | n/a | `BeforeValidator`, `TypeAdapter` for serialization | (não aplicável em TS, usamos Zod já adotado) |

#### Side effects observáveis

- Nenhum. Pure data.

#### TODOs / FIXMEs / HACKs literais

- `usage.py:142-156`: > *"Some providers don't populate optional token detail fields, and the OpenAI SDK's generated code can bypass Pydantic validation (e.g., via model_construct), allowing None values. We normalize these to 0 to prevent TypeErrors."* — guard against null cached_tokens / reasoning_tokens.

#### Padrão de design

- **Aggregated singleton per run** — `usage` cresce monotônicamente durante a run; após `Runner.run(...).await` retorna a soma total + per-request breakdown.
- **`request_usage_entries`** — keep BOTH aggregate AND per-request — caller decide ([docs/usage.md](docs/usage.md)): *"For a run that makes 3 API calls with 100K, 150K, and 80K input tokens each, the aggregated input_tokens would be 330K, but request_usage_entries would preserve the [100K, 150K, 80K] breakdown, which could be helpful for detailed cost calculation or context window management."*
- **Sessions don't aggregate** — *"sessions preserve conversation context between runs, the usage metrics returned by each Runner.run() call represent only that particular execution."*
- **Hook surface** — `RunHooks.on_agent_end` recebe `ctx.usage` para logging lifecycle.

### 3.4 `openclaw` — Multi-dimensional aggregation (provider × model × channel × agent)

#### API pública

```ts
// src/shared/usage-types.ts:13-72
export type SessionUsageEntry = {
  key: string; label?: string; sessionId?: string;
  scope?: "instance" | "family";
  ... // origin metadata, model/provider override
  usage: SessionCostSummary | null;
};

export type SessionsUsageAggregates = {
  messages: SessionMessageCounts;
  tools: SessionToolUsage;
  byModel: SessionModelUsage[];
  byProvider: SessionModelUsage[];
  byAgent: Array<{ agentId; totals: CostUsageSummary["totals"] }>;
  byChannel: Array<{ channel; totals: CostUsageSummary["totals"] }>;
  daily: Array<{ date; tokens; cost; messages; toolCalls; errors }>;
  ...
};

// src/plugin-sdk/provider-usage.ts:1-26
export {
  fetchClaudeUsage, fetchCodexUsage, fetchGeminiUsage,
  fetchMinimaxUsage, fetchZaiUsage,
} from "../infra/provider-usage.fetch.js";
// Each fetches provider's own usage endpoint (Claude /usage, etc) — RECONCILED billing
```

#### Estado mantido

- `SessionCostSummary` and `SessionsUsageResult` são pure data structures persistidos por sessão. Aggregation feita por `usage-aggregates.ts` (não lido — confiamos no shape inferido pelos types).

#### Padrão de design

- **Multi-dimensional aggregation** — by model, by provider, by agent, by channel, by date. Permite enterprise dashboards: "qual canal consome mais? qual agente? qual modelo?".
- **Per-provider usage fetch** — `fetchClaudeUsage` etc bate na **Anthropic Console API** (não no LLM API) para pegar **billing real** ("actual" vs nosso "estimated"). Reconciliação posterior.
- **Format helpers** — `formatTokenCount(value)` (`"1.5k"`, `"2.3m"`) e `formatUsd(value)` (`"$0.0042"` ou `"$1.23"` baseado em magnitude) — UX-level utilities. ([usage-format.ts:67-99](src/utils/usage-format.ts))

### 3.5 `pi` — File-based session-log cost aggregation

#### API pública

`scripts/cost.ts` é um **CLI script standalone**, não API SDK. Lê arquivos `~/.pi/agent/sessions/<encoded-dir>/<timestamp>_<uuid>.jsonl`, parseia eventos com `cost` em metadata, agrega por dia × provider.

#### Padrão de design

- **Session-log as source-of-truth** — todo evento LLM grava `{ provider, model, input_tokens, output_tokens, cache_read, cache_write, cost }` em JSONL append-only.
- **Posterior aggregation** — relatório CLI separado lê o log e produz `DayCost { total, input, output, cacheRead, cacheWrite, requests }`. Não há "Budget" runtime — apenas observação histórica.

## 4. Convergent patterns (todos concordam)

1. **4-bucket token counting** — `input | output | cache_read | cache_write`. Adotado por: Mastra ([usage-metrics.ts:22-30](observability/mastra/src/metrics/usage-metrics.ts)), Hermes ([usage_pricing.py:30-37](agent/usage_pricing.py)), OpenClaw ([usage-format.ts:50-56](src/utils/usage-format.ts)), Anthropic API contract ([prompt-caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)). **TheoKit deve adotar** + adicionar 5º bucket `reasoning_tokens` (OpenAI o-series, present em mastra 10-buckets + Hermes + openai-agents-python).
2. **Per-million-tokens pricing convention** — Hermes (`input_cost_per_million: Decimal`), LiteLLM JSON (`input_cost_per_token` × 1_000_000), OpenRouter API (USD per token but tooling multiplica × 1M). **TheoKit deve adotar** `input_cost_per_million_usd: number` em interface pública.
3. **Discriminated cost status** — Hermes 4 valores (`actual | estimated | included | unknown`). OpenClaw via "source" field. **TheoKit deve adotar** — chamar `"estimated"` (do snapshot bundled) vs `"actual"` (lido de `/generation` ou provider billing API).
4. **Pricing source provenance** — Hermes (`source + source_url + pricing_version + fetched_at`), Mastra (`schema: "model_pricing/v1"`). **TheoKit deve adotar** — UI mostra "Anthropic docs 2026-05" vs "estimated via OpenRouter".
5. **Tiered pricing for context-length-dependent models** — Mastra (`PricingTier.when[]` predicate). Gemini 2.5 Pro cobra mais > 200k tokens (real Gemini pricing). **TheoKit deve adotar** — interface array de tiers com predicate `when`.
6. **Aggregated + per-request breakdown** — OpenAI Agents Python (`Usage.request_usage_entries`). Hermes via `CanonicalUsage.request_count`. **TheoKit deve adotar** — `result.usage` é aggregate; lista per-request opcional via `result.usage.requests[]`.
7. **Hook surface for budget violations** — Mastra `CostGuardProcessor.onViolation` callback; LiteLLM/Bifrost layered enforcement; Vercel `onFinish({ usage })`. **TheoKit deve adotar** — `Budget.create({ onWarn, onExceed })`.

## 5. Divergent patterns (trade-off real)

1. **Where the budget check happens**:
   - Mastra: **pre-step** (`processInputStep`) — antes de cada LLM call dentro do agent loop, query observability storage (lento mas exato). [cost-guard.ts:262](packages/core/src/processors/processors/cost-guard.ts)
   - LiteLLM/Bifrost: **gateway-level** (HTTP proxy) — antes do request sair do processo.
   - Mastra **documenta limitação**: *"Fast-running agents may exceed the configured limit before metrics are available for query"* ([cost-guard.ts:110-113](packages/core/src/processors/processors/cost-guard.ts)).
   - **TheoKit choice:** **in-process pre-call** (hook `pre_user_send` + check) + opt-in async storage (futuro). Documenta best-effort.

2. **Tokenizer abstraction**:
   - Mastra: `tokenx` (~96% accuracy, 2KB) — abandonou tiktoken. [tokenx GitHub](https://github.com/johannschopplich/tokenx)
   - OpenAI Agents Python: confia 100% em `response.usage`, sem pre-call estimation. [docs/usage.md](docs/usage.md)
   - Hermes: usa Anthropic's `count_tokens` endpoint para Claude, fallback heurístico (não lido em detalhe).
   - **TheoKit choice:** **trust response.usage for billing** (canônico); opt-in pre-call estimation via `gpt-tokenizer` peer dep para "vou caber em N tokens?" checks. Anthropic — usar API token-counting endpoint, NUNCA local-count (`@anthropic-ai/tokenizer` está stale desde 2023).

3. **Budget scope hierarchy**:
   - Mastra: `run | resource | thread` (3 níveis, em runtime context).
   - LiteLLM: `Customer → Team → VirtualKey → Provider` (4 níveis).
   - Hermes: `tool_overrides → registry → default` (per-tool, char-based).
   - **TheoKit choice:** `agent | call | process` (3 níveis, alinhados com our IDs). Multi-tenant deixa para Theo PaaS.

4. **Cache token billing math**:
   - Anthropic real ratios (2026): write-5min = 1.25× base, write-1h = 2× base, read = 0.1× base ([Anthropic prompt-caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).
   - Hermes hardcoda `cache_read_cost_per_million=$0.50` e `cache_write_cost_per_million=$6.25` para Opus 4.5 (= base × 0.1 e base × 1.25 — assume default 5min TTL). ([usage_pricing.py:96-97](agent/usage_pricing.py))
   - Mastra deixa `input_cache_read` + `input_cache_write` como meters separados na PricingTier — interface aceita ambos.
   - **TheoKit choice:** seguir Mastra — 4 fields explícitas (`input/output/cacheRead/cacheWrite`) e usuário configura ratio se default não bate. Default: cache_read = base × 0.1, cache_write_5m = base × 1.25.

5. **Enforcement strategy**:
   - Mastra: `'block' | 'warn'` (2 modos).
   - LiteLLM/Bifrost: 80/95/100% tiered alerts + circuit breaker on velocity spikes.
   - **TheoKit choice:** start with `'audit' | 'warn' | 'block'` (3 modos, audit é log-only). Tiered alerts ficam para v0.2.

## 6. Dependency inventory — bibliotecas comuns

| Lib | Frameworks que usam | Função | TheoKit decision |
|---|---|---|---|
| **`gpt-tokenizer`** (npm 3.4.0, ~50KB, fastest small-text, [niieani/gpt-tokenizer](https://github.com/niieani/gpt-tokenizer)) | (none of refs, but is the 2026 winner per [PkgPulse 2026 benchmark](https://www.pkgpulse.com/guides/gpt-tokenizer-vs-js-tiktoken-vs-xenova-transformers-llm-2026)) | Pre-call token estimation for OpenAI/o200k models | **Adotar** como **optional peer dep** (`peerDependenciesMeta.optional: true`). Caller que não precisa estimar não paga. |
| **`tokenx`** (npm 1.3.0, ~2KB, 96% accuracy, [johannschopplich/tokenx](https://github.com/johannschopplich/tokenx)) | mastra | Lightweight approximation when bundle size critical | **Avaliar** — tradeoff: 96% accuracy ok para checks "vou caber?", ruim para billing. |
| **`@anthropic-ai/tokenizer`** (npm 0.0.4, last 2023, [npm page](https://www.npmjs.com/package/@anthropic-ai/tokenizer)) | (none) | (stale; README: *"no longer accurate as of Claude 3"*) | **Não adotar**. Para Claude usar `POST /v1/messages/count_tokens` (Anthropic API) lazy. |
| **LiteLLM `model_prices_and_context_window.json`** ([raw URL](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)) | (de facto industry standard) | 2500+ models pricing JSON with `input_cost_per_token`, `output_cost_per_token`, `cache_read_input_token_cost`, `context_window`, `source` | **Adotar** — bundle snapshot + optional refresh from raw URL with TTL (default 24h). |
| **Decimal precision lib** (TS) | Hermes Python uses `Decimal` | USD math without float drift | **Avaliar** — start with `number` × 1e9 normalization; upgrade to `decimal.js` if precision issues. |
| **`big.js`** (~6KB) | (alternative) | Arbitrary-precision decimal | (alternative se decimal.js for grande) |

**Convergent dependencies (2+ frameworks):** nenhuma específica desta área — pricing data é repetido em cada lib (Mastra bundled JSONL, Hermes Python dict). **Implicação:** ninguém ainda padronizou a fonte; LiteLLM JSON é o single source-of-truth de facto pela cobertura (2500+ models).

## 7. Algorithms / data structures não-óbvios

### 7.1 Tier-matching predicate (Mastra)

`PricingTier.matchesUsage(usage)` ([pricing-model.ts:20-25](observability/mastra/src/metrics/pricing-model.ts)) avalia array de predicados `when[]` contra `UsageStats`. Operadores: `gt | gte | lt | lte | eq | neq`. Field disponível em 2026: apenas `total_input_tokens` (extensível). Complexidade: O(tiers × conditions) — geralmente ≤ 3 tiers, ≤ 2 conditions → desprezível.

### 7.2 Token bucket conversion under cache (Hermes 3-mode normalize)

`normalize_usage` ([usage_pricing.py:672-742](agent/usage_pricing.py)) é a única forma robusta de unificar Anthropic vs OpenAI Chat vs OpenAI Responses APIs:
- Anthropic: `input_tokens` **NÃO** inclui cache. Soma é `input + cache_read + cache_write`.
- OpenAI Chat Completions: `prompt_tokens` **inclui** cache. Subtração necessária: `input = prompt - cache_read - cache_write`.
- OpenAI Responses (Codex): mesma subtração via `input_tokens_details`.
- **Critical edge case**: alguns proxies (OpenRouter, Vercel AI Gateway, Cline) misturam shapes ao roteear Claude → caller deve checar **AMBOS** locais (details + top-level) com fallback.

### 7.3 Sliding-window-aligned ledger (LiteLLM convention)

Budgets stacked com **calendar-aligned reset** (UTC midnight para daily, UTC monday para weekly), **não** request-relative 24h. Razão: usuário espera "1 USD por dia" significar "USD desde meia-noite UTC", não "USD na última janela de 24h móvel". ([LiteLLM budgets docs](https://docs.litellm.ai/docs/proxy/users))

### 7.4 Minified pricing JSONL keys (Mastra)

Bundle de 5261 entries usa keys 2-char (`it/ot/icrt/icwt/iat/oat/ort`) para reduzir tamanho. Sample: `{"i":"...","p":"302ai","m":"chatgpt-4o-latest","s":{"v":"model_pricing/v1","d":{"u":"USD","t":[{"r":{"it":{"c":5e-6},"ot":{"c":1.5e-5}}}]}}}`. ([pricing-data.jsonl head 10](observability/mastra/src/metrics/pricing-data.jsonl)) Notação `5e-6 = $5/MTok` cabe 8 char vs `0.000005` (8 char) ou `5_000_000` (per-billion) — gain real só em scientific. Para TheoKit, **bundle o JSON cru com `pricing.input/output/cacheRead/cacheWrite` plain** (mais legível, gzip resolve tamanho).

## 8. Edge cases conhecidos (com fonte)

| Edge case | Como manifesta | Onde foi corrigido / source | Como devemos prevenir |
|---|---|---|---|
| **OpenAI-compat proxies expõem cache fields no top-level (não em details)** quando roteiam Claude | `cache_creation_input_tokens=0` indevidamente; usuário vê "caching não funciona" | `cline/cline#10266` → portado em Hermes [usage_pricing.py:710-729](agent/usage_pricing.py) | Em `normalizeUsage()` checar AMBOS `prompt_tokens_details.cache_*` E `response_usage.cache_*_input_tokens` top-level |
| **Tiktoken sub-conta tokens de function-calling / tool calls** (5k local vs 21k API real) | Budget enforcement antes da call usa estimate baixo → cap excedido na realidade | [tiktoken issue #474](https://github.com/openai/tiktoken/issues/474), [OpenAI forum thread](https://community.openai.com/t/discrepancy-in-token-counts-between-tiktoken-and-api-usage-for-o4-mini-gpt-4o-mini/1271170) | Para pre-call estimation, adicionar overhead constants: `func_init=7, prop_init=3, prop_key=3, enum_init=-3, enum_item=3, func_end=12` ([OpenAI cookbook](https://developers.openai.com/cookbook/examples/how_to_count_tokens_with_tiktoken)) |
| **Streaming usage só válido no chunk terminal** (`finish_reason !== null`) | Compat providers (DeepSeek) emitem `usage:null` em chunks intermediários | [DeepSeek issue #3076 — router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI/issues/3076), [OpenAI cookbook](https://cookbook.openai.com/examples/how_to_stream_completions) | Acumular usage só após `finish_reason !== null && chunk.usage != null` |
| **Reasoning tokens contam como output** (billing rate de output) mas não aparecem no `result.result` text | Usuário paga sem ver | OpenAI o-series; [Vercel AI Gateway advanced docs](https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/advanced) | Track `output_tokens_details.reasoning_tokens` separadamente; somar em `outputTokens` total mas expor em `usage.outputDetails.reasoning` |
| **Anthropic default TTL silenciosamente caiu de 1h → 5min em março/2026** | Cache hit rate ~0 sem mudança de código; cost inflation 20-32% | [GitHub anthropics/claude-code#46829](https://github.com/anthropics/claude-code/issues/46829), [DEV.to writeup](https://dev.to/whoffagents/anthropic-silently-dropped-prompt-cache-ttl-from-1-hour-to-5-minutes-16ao) | Explicit declarar `ttl: "1h"` em `cache_control` blocks; report cache hit rate como métrica |
| **Anthropic prompt cache requires byte-identical prefix** — reordenar tools array ou inserir timestamp invalida | Cache misses unexpected; usuário paga full rate | [Anthropic prompt-caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) | Bundle tools/system em ordem determinística antes de cache; documentar invariante |
| **Anthropic `@anthropic-ai/tokenizer` está stale desde 2023** | Local-count Claude tokens dá número errado por >20% | [npm page README](https://www.npmjs.com/package/@anthropic-ai/tokenizer) (Anthropic admite) | **NUNCA local-count Claude.** Para pre-call use `POST /v1/messages/count_tokens` endpoint; senão confie em response.usage |
| **OpenAI streaming sem `stream_options.include_usage: true` não envia usage chunk** | `result.usage` chega `undefined` mid-stream e final | [OpenAI Cookbook streaming](https://cookbook.openai.com/examples/how_to_stream_completions) | SDK default deve incluir `stream_options: { include_usage: true }` em todos os streaming requests OpenAI-compat |
| **Mastra cost guard é best-effort** — observability flush é async + bufferizado | Fast loops podem exceder cap antes do storage refletir | [cost-guard.ts:110-113](packages/core/src/processors/processors/cost-guard.ts) doc comment | Para hard cap, manter shared in-memory ledger (mutex-protected) + sync update no on_response; storage só para histórico |
| **Vision/image/audio tokens not countable client-side** | Multi-modal requests subestimam | [OpenAI Token Counting guide](https://developers.openai.com/api/docs/guides/token-counting) | Para multimodal, skip pre-call estimation; trust `usage.input_tokens_details.{image, audio}` post-call |
| **OpenRouter pricing é "estimated until reconciled"** — preço pode mudar entre estimate e reconciliação via `/generation` endpoint | Estimate ≠ billed | Hermes documenta in [usage_pricing.py:810-811](agent/usage_pricing.py): *"OpenRouter cost is estimated from the models API until reconciled"* | Para `provider: openrouter`, marcar `cost.status: "estimated"` SEMPRE; lazy reconcile via `GET /api/v1/generation/{id}` opcional |
| **Calendar boundaries** — daily budget reset deve ser UTC midnight, não 24h móvel | Usuário espera "1 USD por dia" = "desde meia-noite UTC" | [LiteLLM budgets docs](https://docs.litellm.ai/docs/proxy/users) | Reset window aligned to calendar (start: `new Date().setUTCHours(0,0,0,0)`) |

## 9. Implementation Guide

### 9.1 Arquitetura proposta

```
┌────────────────────────────────────────────────────────┐
│  user code: const agent = await Agent.create({...})    │
│             const run = await agent.send(prompt)        │
│             console.log(run.wait().usage, .cost)        │
└─────────────────┬──────────────────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────────────────┐
│  packages/sdk/src/agent.ts (existing)                   │
│  -> LocalAgent.send() emits run.stream()                │
└─────────────────┬──────────────────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────────────────┐
│  packages/sdk/src/internal/runtime/run-impl.ts (existing)│
│  -> consumes LLM stream                                  │
│  -> NEW: extracts usage from terminal chunk (after      │
│     finish_reason !== null && chunk.usage != null)      │
│  -> NEW: calls Budget.charge(usage, model)              │
│  -> writes result.usage + result.cost                   │
└─────────────────┬──────────────────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────────────────┐
│  packages/sdk/src/budget.ts (NEW — static facade)       │
│  -> Budget.create({ scope, limits, onWarn, onExceed })   │
│  -> Budget.charge(usage, model) — mutex-protected ledger │
│  -> Budget.preflightCheck(estimatedTokens) — pre-call    │
└─────────────────┬──────────────────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────────────────┐
│  packages/sdk/src/internal/budget/                       │
│   pricing-registry.ts  ← bundle LiteLLM JSON snapshot   │
│   normalize-usage.ts   ← 3 API shapes (Anthropic /      │
│                          OpenAI Chat / OpenAI Responses)│
│   compute-cost.ts      ← (input + output + cacheR/W +   │
│                          reasoning) × per-million rates │
│   ledger.ts            ← in-process shared singleton     │
│                          mutex-protected accumulation   │
│   calendar-window.ts   ← UTC-aligned daily/weekly/monthly│
└────────────────────────────────────────────────────────┘
```

### 9.2 Files to create

```
packages/sdk/src/budget.ts                              ← public Budget static facade
packages/sdk/src/types/usage.ts                         ← TokenUsage + CostBreakdown + CostStatus types
packages/sdk/src/types/budget.ts                        ← BudgetOptions + BudgetScope + BudgetWindow + BudgetExceededError shape
packages/sdk/src/internal/budget/pricing-registry.ts    ← bundle LiteLLM JSON + lazy refresh
packages/sdk/src/internal/budget/pricing-data.json      ← bundled snapshot (gzipped to ~80KB)
packages/sdk/src/internal/budget/normalize-usage.ts     ← parse provider-shaped usage → CanonicalUsage
packages/sdk/src/internal/budget/compute-cost.ts        ← canonical usage × pricing entry → CostResult
packages/sdk/src/internal/budget/ledger.ts              ← in-process shared ledger (singleton + mutex)
packages/sdk/src/internal/budget/calendar-window.ts     ← UTC-aligned window math
packages/sdk/src/internal/budget/format.ts              ← formatUsd, formatTokenCount (helpers)
packages/sdk/src/internal/runtime/run-impl.ts           ← MODIFY: hook usage extraction at stream end
packages/sdk/src/types/run.ts                           ← MODIFY: RunResult.usage + RunResult.cost
packages/sdk/src/errors.ts                              ← ADD: BudgetExceededError extends TheokitAgentError

packages/sdk/tests/types/usage.test.ts                   ← types + normalize unit tests
packages/sdk/tests/internal/budget/pricing-registry.test.ts
packages/sdk/tests/internal/budget/normalize-usage.test.ts ← 3 API shapes coverage
packages/sdk/tests/internal/budget/compute-cost.test.ts ← 5-bucket math + tiered pricing
packages/sdk/tests/internal/budget/ledger.test.ts       ← concurrency + calendar reset
packages/sdk/tests/budget-facade.test.ts                ← Budget.create / preflightCheck / charge
packages/sdk/tests/integration/budget-real-llm.test.ts  ← env-gated Ollama
tools/validate-budget-real-llm.mjs                       ← real-LLM dogfood mirror of validate-tasks-real-llm
```

### 9.3 Public API surface (TypeScript)

```ts
// packages/sdk/src/types/usage.ts
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly reasoningTokens?: number;
  readonly totalTokens: number;
  /** per-request breakdown, like openai-agents-python request_usage_entries */
  readonly requests?: readonly TokenUsage[];
}

export type CostStatus = "actual" | "estimated" | "included" | "unknown";

export interface CostBreakdown {
  readonly amountUsd: number | undefined;
  readonly status: CostStatus;
  readonly currency: "USD";
  readonly source: "openrouter_api" | "litellm_snapshot" | "user_override" | "subscription_included" | "unknown";
  readonly pricingVersion: string | undefined;
  readonly notes?: readonly string[];
  /** per-bucket detail for caller-side analytics */
  readonly detail?: {
    readonly input?: number;
    readonly output?: number;
    readonly cacheRead?: number;
    readonly cacheWrite?: number;
    readonly reasoning?: number;
  };
}

// packages/sdk/src/types/run.ts MODIFY RunResult:
export interface RunResult {
  // ... existing fields
  /** Token usage observed for this run. Always present on `status: "finished"`. */
  readonly usage?: TokenUsage;
  /** Estimated/actual USD cost. status field tells caller how to trust it. */
  readonly cost?: CostBreakdown;
}

// packages/sdk/src/types/budget.ts
export type BudgetScope = "agent" | "call" | "process";
export type BudgetWindow = "1h" | "1d" | "1w" | "30d" | "365d";
export type BudgetMode = "audit" | "warn" | "block";

export interface BudgetLimit {
  readonly window: BudgetWindow;
  readonly limitUsd: number;
}

export interface BudgetOptions {
  readonly name: string;
  readonly scope: BudgetScope;
  readonly limits: ReadonlyArray<BudgetLimit>;  // stacked
  readonly mode?: BudgetMode;                    // default "warn"
  readonly onThreshold?: (event: BudgetThresholdEvent) => void | Promise<void>;
  readonly onExceed?: (event: BudgetExceedEvent) => void | Promise<void>;
}

export interface BudgetThresholdEvent {
  readonly budgetName: string;
  readonly window: BudgetWindow;
  readonly threshold: 0.8 | 0.95;
  readonly spentUsd: number;
  readonly limitUsd: number;
}

export interface BudgetExceedEvent {
  readonly budgetName: string;
  readonly window: BudgetWindow;
  readonly spentUsd: number;
  readonly limitUsd: number;
  readonly mode: BudgetMode;
}

// packages/sdk/src/budget.ts
export class Budget {
  private constructor() { throw new Error("Budget is static; do not instantiate"); }

  static create(options: BudgetOptions): BudgetHandle;
  static list(): readonly BudgetHandle[];
  static get(name: string): BudgetHandle | undefined;
  static delete(name: string): boolean;
  /** Diagnostic: cumulative spend snapshot per active window. */
  static snapshot(): readonly BudgetSnapshot[];
}

export interface BudgetHandle {
  readonly name: string;
  readonly mode: BudgetMode;
  readonly limits: ReadonlyArray<BudgetLimit>;
  spentIn(window: BudgetWindow): number;
  remainingIn(window: BudgetWindow): number;
}

// packages/sdk/src/errors.ts
export class BudgetExceededError extends TheokitAgentError {
  override readonly name: string = "BudgetExceededError";
  readonly budgetName: string;
  readonly window: BudgetWindow;
  readonly spentUsd: number;
  readonly limitUsd: number;
  constructor(args: { budgetName; window; spentUsd; limitUsd; cause? });
}
```

### 9.4 Dependências a adotar

| Package | Version | Justification |
|---|---|---|
| `gpt-tokenizer` | `^3.4.0` | **Optional peer dep** — pre-call token estimation only (`Budget.preflightCheck`). Caller que não usa não paga (50KB bundle savings). [npm](https://www.npmjs.com/package/gpt-tokenizer) |
| (NO `tiktoken` WASM) | — | Exceeds Cloudflare Workers 1MB limit; gpt-tokenizer wins benchmarks for small text. [PkgPulse 2026](https://www.pkgpulse.com/guides/gpt-tokenizer-vs-js-tiktoken-vs-xenova-transformers-llm-2026) |
| (NO `@anthropic-ai/tokenizer`) | — | Stale since 2023, Anthropic admits inaccuracy. [README](https://www.npmjs.com/package/@anthropic-ai/tokenizer) |
| (NO `decimal.js` for v1) | — | Start with `number` × 1e9 normalization in cents; upgrade if precision issues arise in dogfood |
| **Bundled pricing JSON** | LiteLLM snapshot 2026-05 | Update via `scripts/refresh-pricing.mjs` (manual, monthly). Snapshot in repo at `packages/sdk/src/internal/budget/pricing-data.json`. |

### 9.5 Test strategy

- **Unit tests:**
  - `tests/types/usage.test.ts` (~10 cenários) — TokenUsage shape, CostStatus closed enum, BudgetWindow validation.
  - `tests/internal/budget/normalize-usage.test.ts` (~15 cenários) — Anthropic 4-bucket, OpenAI Chat with cached_tokens, OpenAI Chat with top-level Anthropic-style fields (cline#10266 regression), OpenAI Responses (Codex), Vercel AI Gateway hybrid, reasoning tokens, null/undefined fields, OpenRouter route ambiguity.
  - `tests/internal/budget/compute-cost.test.ts` (~12 cenários) — 5-bucket math, tiered pricing predicate match, subscription_included → $0, unknown route → status="unknown" not status="estimated"=0, Decimal precision sanity (1.234567 × 1e6 / 1e6 round-trip).
  - `tests/internal/budget/ledger.test.ts` (~10 cenários) — concurrent charges (mutex-protected), UTC midnight reset, daily+weekly stacked limits, audit mode (no throw), warn mode (callback fires + no throw), block mode (throw before charge if would exceed), pre-aborted scenario.
  - `tests/internal/budget/calendar-window.test.ts` (~6 cenários) — UTC midnight detection, weekly UTC monday, monthly start-of-month, DST edge case (none in UTC), leap year.
  - `tests/budget-facade.test.ts` (~8 cenários) — Budget.create + duplicate name, Budget.list, Budget.delete idempotent, Budget.get unknown returns undefined, preflightCheck without gpt-tokenizer (graceful return undefined).
- **Integration tests:**
  - `tests/integration/budget-real-llm.test.ts` env-gated — `agent.send` resolve with `result.usage.totalTokens > 0` and `result.cost.status === "estimated"` for Ollama route.
- **Real-LLM dogfood:**
  - `tools/validate-budget-real-llm.mjs` (mirror of `validate-tasks-real-llm.mjs`) — runs against Ollama qwen2.5:3b OR OpenRouter free model. Asserts: result.usage non-zero, result.cost.status in {"estimated", "included"}, Budget.snapshot reflects charge.

### 9.6 Phases of rollout

1. **Phase 1 — types + pricing snapshot + normalize-usage** (target: 15 unit tests green; no API surface yet)
   - `types/usage.ts`, `types/budget.ts`, bundle pricing JSON, normalize-usage from 3 shapes.
   - No changes to public Agent API yet.
2. **Phase 2 — `RunResult.usage` + `RunResult.cost`** (target: integration test against Ollama PASS)
   - Wire stream-end hook in `run-impl.ts`.
   - Stream parser respects `finish_reason !== null` gate.
   - Backwards compat: `usage`/`cost` optional (caller who doesn't read sees no change).
3. **Phase 3 — `Budget` static facade + ledger + UTC-aligned windows** (target: full unit + integration tests green)
   - `Budget.create / list / get / delete / snapshot`.
   - Ledger: in-process singleton, mutex-protected.
   - 3 modes: audit/warn/block.
   - `BudgetExceededError` thrown **before** LLM call (preflightCheck).
4. **Phase 4 — Real-LLM dogfood + docs + cookbook** (target: dogfood PASS + concept page in theo-opendocs)
   - `tools/validate-budget-real-llm.mjs`.
   - Concept page `theo-opendocs/content/theokit-sdk/concepts/budget.mdx`.
   - Cookbook recipe `examples/budget/run.ts`.
   - Update CLAUDE.md roadmap entry: gap fechado.

### 9.7 Acceptance criteria

- [ ] `result.usage` populated on every `status: "finished"` Run against OpenAI/Anthropic/OpenRouter/Ollama models — verified via integration test
- [ ] `result.cost.status === "estimated"` for snapshot-priced models; `"unknown"` for unsnapshot'd; `"included"` for Codex CLI subscription routes
- [ ] cache_read + cache_write tokens correctly attributed for Anthropic AND for OpenAI-compat proxies emitting top-level Anthropic-style fields (cline#10266 regression test)
- [ ] Streaming requests gate on `finish_reason !== null && chunk.usage != null` (DeepSeek regression test)
- [ ] `Budget.create({ mode: 'block' })` throws `BudgetExceededError` BEFORE the LLM call when limit would be exceeded (pre-flight estimation via `gpt-tokenizer`)
- [ ] `Budget.create({ mode: 'audit' })` never throws, only logs to stderr
- [ ] UTC-aligned reset: daily limit resets at UTC midnight, weekly at UTC monday 00:00, monthly at UTC 1st
- [ ] Concurrent `agent.send` calls share ledger via in-process mutex (no race in 100-call burst test)
- [ ] `pnpm validate` exit 0 (biome / build / typecheck / 1700+ vitest / publint / attw / knip / loc / cycles / duplication)
- [ ] Real-LLM dogfood PASS via `tools/validate-budget-real-llm.mjs`
- [ ] Concept page + cookbook recipe shipped
- [ ] CHANGELOG entries in `packages/sdk/CHANGELOG.md` + workspace CHANGELOG.md
- [ ] No new peer dep required for default operation (`gpt-tokenizer` is opt-in)
- [ ] Pricing snapshot file size after gzip ≤ 100 KB
- [ ] Pass: complexity ≤ 10 per function; size ≤ 400 LoC per file (G8 gate)

### 9.8 Risks + mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Pricing JSON drifts from real provider rates within weeks | high | Bundle snapshot + ship `scripts/refresh-pricing.mjs` documented to be run monthly via cron-like cadence; expose `source: "litellm_snapshot"` + `pricingVersion` for callers to know freshness |
| Anthropic cache TTL silently changes again (like 1h→5min March 2026) | med | Hardcode TTL multipliers but document them as configurable per-model in `Budget.configure({ pricingOverrides })`; report cache hit rate as metric so drift is observable |
| Concurrent ledger races under high load | med | In-process mutex (existing pattern from `withCwdMutex`); document single-process invariant like JsonFileTaskStore |
| Pre-call token estimation underestimates tool-call workloads (tiktoken #474) | med | Add `gpt-tokenizer` opt-in + apply OpenAI cookbook overhead constants for function-calling pre-flight; document `Budget.preflightCheck` as best-effort |
| OpenAI-compat providers don't include `usage` chunk unless `include_usage: true` set | high | SDK default ALL OpenAI-compat streaming requests to `stream_options: { include_usage: true }` |
| Reasoning tokens (o-series) billed but invisible | med | Always include `reasoning_tokens` in `outputTokens` total; expose breakdown in `usage.outputDetails` for transparency |
| `decimal.js` precision drift if we use `number` | low (for v1) | Document: "USD costs in `number` with up to 4 decimal places of precision. For accounting-grade precision, post-process via your own decimal lib." Upgrade path if dogfood shows real drift |
| Cloud agents can't share in-process ledger | high but expected | Mirror D370 (Tasks): `CloudAgent.send({ budget })` throws `UnsupportedBudgetOperationError`; cloud budget goes via Theo PaaS surface when GA |

## 10. Open questions

1. **Decimal precision policy** — `number` (float) suficiente para v1 ou shipar `decimal.js` desde já? Hermes usa Python Decimal; convergent industry pattern em TS é mixed. **Default proposto:** `number` × 1e6 (microcent precision), upgrade path documented.

2. **Pricing snapshot refresh cadence** — manual via `scripts/refresh-pricing.mjs` (monthly) é suficiente, OU shipar lazy refresh on first `agent.send` se snapshot é > 30d? Tradeoff: lazy = HTTP latency no first call; manual = staleness risk.

3. **Pre-call estimation accuracy for tool-calling** — invest in OpenAI cookbook overhead constants port (Hermes does this implicitly via API), OR document `Budget.preflightCheck` como best-effort e direcionar a `mode: 'audit'` para primeiros runs?

4. **Cache TTL handling** — Anthropic suporta 5min + 1h via `cache_control.ttl`. Devemos:
   - (a) Bundle both rates (5min × 1.25 base + 1h × 2 base) e infer based on request → cost UI mostra ambos?
   - (b) Single default (5min) e callers documentam se usam 1h?
   - **Tendência:** (a) explicit é melhor para enterprise audit.

5. **OpenRouter `/generation` reconciliation** — implementar lazy fetch para `cost.status: "actual"` upgrade após N segundos? Custo: 1 HTTP extra per send. Benefício: cost preciso vs estimate. **Tendência:** opt-in via `Budget.configure({ reconcileOpenRouter: true })`.

6. **Tiered pricing in v1** — Gemini 2.5 Pro tem rate change > 200k input tokens. Vale shipar `PricingTier` ou flat-rate é suficiente para 95% dos casos?

## 11. Referências citadas (índice reverso)

### `mastra`

#### Core
- `packages/core/src/processors/processors/cost-guard.ts:1-308` — CostGuardProcessor full implementation; §3.1, §4 (pattern), §7, §8 (best-effort warning)
- `packages/core/src/processors/processors/token-limiter.ts:1-413` — TokenLimiterProcessor (input + output stream + output result); §3.1, §4, §6, §8
- `observability/mastra/src/metrics/pricing-model.ts:1-80` (head) — PricingTier predicate match; §3.1, §7
- `observability/mastra/src/metrics/usage-metrics.ts:1-42` — 10 token meter buckets; §3.1, §4
- `observability/mastra/src/metrics/pricing-data.jsonl` head 10 — minified JSONL format sample; §7

#### Support
- `observability/mastra/src/metrics/pricing-registry.ts:1-50` (head) — minified JSON loader; §6
- `mastracode/src/utils/token-estimator.ts:1-16` (snippet) — uses tokenx; §6
- `mastracode/src/tui/commands/cost.ts:1-22` — CLI display format; §3.1, §9.3

#### Test (read seletivo)
- `packages/core/src/processors/processors/token-limiter.test.ts` — referenced in §8 (token limiter edge cases)
- `packages/core/src/processors/processors/cost-guard.test.ts` — referenced in §8 (cost guard scope behavior)
- `packages/core/src/agent/__tests__/usage-tracking.test.ts` — referenced in §8 (usage propagation)

### `hermes-agent`

#### Core
- `agent/usage_pricing.py:1-877` — full implementation; §3.2, §4, §5, §6, §7, §8
  - `:29-77` — CanonicalUsage + BillingRoute + PricingEntry + CostResult dataclasses; §3.2, §4
  - `:85-508` — _OFFICIAL_DOCS_PRICING static dict (200+ entries 2026); §3.2, §6
  - `:527-553` — resolve_billing_route — provider/base_url → BillingRoute; §3.2
  - `:672-742` — normalize_usage (3 API shapes); §3.2, §7.2, §8 (cline#10266)
  - `:745-821` — estimate_usage_cost (per-million math); §3.2
  - `:843-877` — format_duration_compact + format_token_count_compact helpers; §9.3
- `tools/budget_config.py:1-51` — char-budget for tool persistence (NOT cost budget); §3.2 (acknowledged as different concept)

#### Test (read seletivo)
- `tests/agent/test_usage_pricing.py:1-50` (head) — Anthropic + OpenAI normalize regression tests; §8 (cline#10266 source)

### `openai-agents-python`

#### Core
- `src/agents/usage.py:1-322` — full implementation; §3.3, §4, §5, §7
  - `:60-77` — RequestUsage dataclass; §3.3
  - `:102-216` — Usage dataclass + add() aggregator; §3.3, §4
  - `:138-156` — null-guard post-init (model_construct safety); §3.3
  - `:218-322` — serialize/deserialize + span helpers; §3.3

#### Doc
- `docs/usage.md:1-100` — design rationale + RunHooks pattern + Sessions semantics; §3.3, §4

### `openclaw`

#### Core
- `src/shared/usage-types.ts:1-73` — SessionUsageEntry + SessionsUsageAggregates; §3.4, §5 (multi-dim)
- `src/plugin-sdk/provider-usage.ts:1-26` — per-provider usage fetch surface (Claude, Codex, Gemini, MiniMax, Z.AI); §3.4

#### Support
- `src/utils/usage-format.ts:1-100` (head) — formatTokenCount + formatUsd + ModelCostConfig types; §3.4, §9.3

### `pi`

#### Support
- `scripts/cost.ts:1-80` (head) — file-based session log aggregation CLI; §3.5

### URLs externas (web research, todas citadas em §1, §6, §8)

#### Tokenizers (npm)
- [`tiktoken` on npm](https://www.npmjs.com/package/tiktoken) — official WASM
- [`js-tiktoken` on npm](https://www.npmjs.com/package/js-tiktoken) — pure-JS, 3M+ weekly DL
- [`gpt-tokenizer` on GitHub](https://github.com/niieani/gpt-tokenizer) / [npm](https://www.npmjs.com/package/gpt-tokenizer) — recommended for theokit
- [`@anthropic-ai/tokenizer` on npm](https://www.npmjs.com/package/@anthropic-ai/tokenizer) — stale, do not use
- [`tokenx` on GitHub](https://github.com/johannschopplich/tokenx) / [npm](https://www.npmjs.com/package/tokenx) — 96% approximation, 2KB
- [PkgPulse 2026 tokenizer benchmark](https://www.pkgpulse.com/guides/gpt-tokenizer-vs-js-tiktoken-vs-xenova-transformers-llm-2026)
- [transitive-bullshit/compare-tokenizers](https://github.com/transitive-bullshit/compare-tokenizers) — head-to-head benchmark suite

#### Pricing data sources
- [LiteLLM `model_prices_and_context_window.json` raw](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json) — 2500+ models
- [LiteLLM auto-sync from GitHub docs](https://docs.litellm.ai/docs/proxy/sync_models_github)
- [OpenRouter Models API guide](https://openrouter.ai/docs/guides/overview/models)
- [OpenRouter Pricing page](https://openrouter.ai/pricing)
- [Anthropic API Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Finout — Anthropic API Pricing 2026 reference](https://www.finout.io/blog/anthropic-api-pricing)
- [OpenAI Token Counting guide](https://developers.openai.com/api/docs/guides/token-counting)
- [tokencost PyPI](https://pypi.org/project/tokencost/0.1.1/) — Python only

#### SDK API patterns
- [Vercel AI SDK record token usage example](https://sdk.vercel.ai/examples/node/streaming-structured-data/token-usage)
- [Vercel AI Gateway advanced — reasoning tokens](https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/advanced)
- [LangChain cost tracking docs](https://docs.langchain.com/langsmith/cost-tracking)
- [Langfuse token & cost tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking)
- [Helicone cost tracking cookbook](https://docs.helicone.ai/guides/cookbooks/cost-tracking)
- [LiteLLM budgets/rate-limits docs](https://docs.litellm.ai/docs/proxy/users)

#### Edge cases — sources
- [Anthropic prompt-caching official docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — 4 token bucket reference
- [tiktoken issue #474 — function-call token mismatch](https://github.com/openai/tiktoken/issues/474)
- [OpenAI forum — o4-mini/gpt-4o-mini token gap](https://community.openai.com/t/discrepancy-in-token-counts-between-tiktoken-and-api-usage-for-o4-mini-gpt-4o-mini/1271170)
- [OpenAI Cookbook — streaming completions](https://cookbook.openai.com/examples/how_to_stream_completions)
- [DeepSeek `usage:null` streaming issue](https://github.com/router-for-me/CLIProxyAPI/issues/3076)
- [GitHub anthropics/claude-code#46829 — TTL silently regressed](https://github.com/anthropics/claude-code/issues/46829)
- [DEV.to — Anthropic dropped 1h→5min March 2026](https://dev.to/whoffagents/anthropic-silently-dropped-prompt-cache-ttl-from-1-hour-to-5-minutes-16ao)

#### Enforcement patterns
- [TrueFoundry — rate-limiting agentic AI](https://www.truefoundry.com/blog/rate-limiting-ai-agents-preventing-llm-api-exhaustion)
- [TrueFoundry — LLM cost attribution agentic CI/CD](https://www.truefoundry.com/blog/llm-cost-attribution-agentic-cicd)
- [Hivenet — LLM rate limiting & quotas](https://www.hivenet.com/post/llm-rate-limiting-quotas)
- [Solvo — rate-limit math 2am](https://dev.to/solvohq/your-llm-cost-estimate-is-fine-your-rate-limit-math-is-what-pages-you-at-2am-53ne)
- [LLMCap — streaming hard cap](https://www.llmcap.io/)
