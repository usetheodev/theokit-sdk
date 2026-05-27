# Plan: Token Budget / Cost Tracker

> **Version 1.1** — Adiciona ao `@usetheo/sdk` token usage observável + estimativa de custo USD + enforcement de budget por window (1h / 1d / 1w / 30d / 365d).
>
> **v1.1 changelog** — Absorveu 9 MUST FIX + 7 SHOULD TEST + 6 DOCUMENT do edge-case review (EC-1..EC-22). Adições principais: (a) `BudgetExceededError.mode` field (EC-1); (b) model alias normalization (Anthropic dot→dash + date-suffix strip, EC-2); (c) provider-aware `include_usage` config (EC-3/EC-4); (d) usage preserved on partial-failure runs (EC-5); (e) ledger GC dentro do mesmo mutex (EC-6); (f) Budget name validation grammar (EC-7); (g) callback try/catch isolation (EC-8); (h) atomic `preflightCheck + charge` mutex section (EC-9). Surface mínimo: (a) `RunResult.usage` (5 buckets: input / output / cacheRead / cacheWrite / reasoning) e `RunResult.cost` em toda Run; (b) `Budget` static facade com modos `audit | warn | block` e stacked windows; (c) `BudgetExceededError extends TheokitAgentError` pre-call. Fecha o gap MISS #1 vs Hermes Agent identificado em 2026-05-27. Fundamenta-se inteiramente em [`token-budget-cost-tracker.md`](../reference/token-budget-cost-tracker.md) (referência com 36 URLs externas + 5 frameworks deep-read). Resultado esperado: usuário consegue ler `run.wait().usage.totalTokens` + `run.wait().cost.amountUsd` após qualquer `agent.send`, e enforcement de budget impede LLM calls que excederiam o cap antes da chamada chegar ao provider.

## Context

### O que existe hoje

- LLM clients (`packages/sdk/src/internal/llm/{anthropic,openai}.ts`) já parseiam `inputTokens` + `outputTokens` do response em `LlmFinish` ([`finish.ts:25-41`](packages/sdk/src/internal/llm/finish.ts)). **Mas:**
  - Apenas 2 buckets (input + output) — sem `cacheRead`, `cacheWrite`, `reasoning` (presentes em Anthropic prompt-caching + OpenAI o-series).
  - Esses tokens **não são propagados ao `RunResult`** ([`types/run.ts:49-66`](packages/sdk/src/types/run.ts) — nenhum field `usage` ou `cost`).
  - Não há agregação multi-step (uma run com 3 LLM calls perde o breakdown).
- Zero primitivo de Budget. Zero pricing data bundled. `Cron` + `Cache` + `Task` existem; `Budget` não.

### Evidência do gap

**Análise SDK vs OpenClaw + Hermes (2026-05-27)** identificou:

> *"**Token budget / cost tracking** — Hermes tem `agent/usage_pricing.py` completo; nós não temos nada. Médio impacto SDK-level (controle de spend é enterprise concern); fix médio (hooks + calculator)."*

Hermes ([`agent/usage_pricing.py`](../../../referencia/hermes-agent/agent/usage_pricing.py)) ship: `CanonicalUsage` 5-bucket, `BillingRoute`, `PricingEntry` per-million, `normalize_usage` para 3 API shapes (Anthropic / OpenAI Chat / OpenAI Responses), 200+ models 2026-05 snapshot, `estimate_usage_cost` em `Decimal`. Mastra ([`cost-guard.ts`](../../../referencia/mastra/packages/core/src/processors/processors/cost-guard.ts), [`token-limiter.ts`](../../../referencia/mastra/packages/core/src/processors/processors/token-limiter.ts)) ship: `CostGuardProcessor` com scope `run|resource|thread` + window `1h..365d` + strategy `block|warn`. Nós não temos nada disso.

**Industry signal:** LiteLLM JSON pricing (2500+ modelos) é source-of-truth de facto; Vercel AI SDK expõe `onFinish({ usage })`; Langfuse/Helicone esperam essa shape para auto-cost reporting.

### Por que NOW

1. ACP + Tasks shipados na semana — gap remanescente #1 da análise vs Hermes/OpenClaw é exatamente token/cost.
2. Hermes 2026-05 snapshot mostra que pricing de Claude Opus 4.7 ($5/$25 per MTok) já é "known stable" — bundle viável.
3. Budget pré-call é pré-requisito para qualquer enterprise concern de spend control; sem ele, telegram-pro real-LLM dogfood não pode reportar custo.
4. Reference doc completo + 12 edge cases catalogados + 36 URLs citadas — base sólida pra plan agora.

## Objective

**Done = `await agent.send(prompt).wait()` retorna `{ usage: TokenUsage, cost: CostBreakdown }` com 5 token buckets corretos para Anthropic+OpenAI+OpenRouter+Ollama; `Budget.create({ scope, limits, mode })` é primitivo público funcional; `BudgetExceededError` é lançado pre-call quando estimativa excederia limit no modo `block`; validate gate exit 0 + real-LLM dogfood PASS via Ollama.**

Goals:

1. `TokenUsage` + `CostBreakdown` + `CostStatus` tipos públicos no namespace `@usetheo/sdk` (re-exportados via `types/index.ts`).
2. `RunResult.usage?` e `RunResult.cost?` opcionais (backward compat absoluto) — populados após stream terminal.
3. `normalizeUsage(rawUsage, { provider, apiMode })` cobre 3 shapes (Anthropic Messages / OpenAI Chat / OpenAI Responses) + edge case `cline#10266` (proxies Anthropic-style top-level).
4. `Budget.create / list / get / delete / snapshot` static facade.
5. Pricing snapshot bundled (LiteLLM JSON copy, gzip ≤ 100 KB) + lazy refresh helper (`scripts/refresh-pricing.mjs`).
6. 3 modos: `audit` (log-only), `warn` (callback + log), `block` (throw `BudgetExceededError` pre-call).
7. UTC-aligned windows: daily reset 00:00 UTC, weekly UTC monday, monthly UTC 1st.
8. Concurrent-safe in-process ledger (mutex-protected singleton, mesmo padrão `withCwdMutex`).
9. Real-LLM dogfood `tools/validate-budget-real-llm.mjs` PASS contra Ollama (mirror do ACP/Tasks).
10. Cobertura via 14 ADRs (D375-D388) commitados em `.claude/knowledge-base/adrs/`.

## ADRs

| ID | Decisão | Rationale | Consequência |
|---|---|---|---|
| **D375** | `Budget` é static class com private constructor; namespace público (`Budget.create/list/get/delete/snapshot`) | Mirror exato de `Agent`/`Cron`/`Workflow`/`Eval`/`Task` (D361). Consistência da API surface | Caller usa `import { Budget } from "@usetheo/sdk"`; sem instanciação |
| **D376** | `TokenUsage` shape com 5 buckets fechados: `inputTokens / outputTokens / cacheReadTokens? / cacheWriteTokens? / reasoningTokens?` + `totalTokens` derivado | Convergent pattern (Mastra 10-bucket / Hermes 5 / OpenAI Agents 4): 5 cobre 100% dos providers conhecidos 2026 (Anthropic prompt-caching + OpenAI o-series). 10-bucket é tradeoff de noise vs. signal | Audio/image/text breakdown ficam para v0.2; multi-modal apps ainda recebem total correto |
| **D377** | `CostBreakdown.status` é closed enum `actual | estimated | included | unknown` (mirror Hermes) | Caller branchea explicitamente — `"estimated"` exibe `~$1.23`, `"unknown"` exibe `n/a` (NÃO $0), `"included"` exibe `included`. Mostrar 0 sem pricing data é mentira | `unknown` é resposta válida e visível; UI tem que tratar |
| **D378** | Per-million-tokens USD canônico em `PricingEntry.{input,output,cacheRead,cacheWrite,reasoning}CostPerMillion: number` | Convenção universal pós-2024 (Hermes Decimal, OpenRouter normaliza × 1M, LiteLLM divides para ler `*_cost_per_token`). Mais legível que `*_per_token`-style fracções | API surface usa números entre $0.01 e $100 em vez de `5e-6` |
| **D379** | Pricing snapshot **bundled** em JSON cru (LiteLLM source-of-truth) + helper `scripts/refresh-pricing.mjs` para refresh manual mensal | Lazy fetch on first call introduz latência inesperada; bundled fica sempre online. Manual cron é simples e auditável (vs. auto-update que poderia atualizar para preço errado) | Snapshot pode ficar stale entre releases; mitigation: ship `pricingVersion` field + concept page diz "para preços ao vivo via OpenRouter routes" |
| **D380** | `gpt-tokenizer` é **optional peer dep** (apenas para `Budget.preflightCheck`) | Pre-call estimation precisa de tokenizer; bundle de 50 KB caro para callers que não usam Budget. Optional peer permite tree-shake | `Budget.preflightCheck()` retorna `undefined` graciosamente se peer ausente (mode `block` cai pra `warn` com aviso) |
| **D381** | Claude tokens **NUNCA local-count**; cliente Anthropic confia em `response.usage`, ou usa `POST /v1/messages/count_tokens` lazy | `@anthropic-ai/tokenizer@0.0.4` é stale desde 2023; Anthropic admite no README inaccuracy | Pre-call budget check para Claude usa lower-bound (chars/4) ou skip; documenta best-effort |
| **D382** | `BudgetWindow` é closed enum: `1h | 1d | 1w | 30d | 365d`; reset alinhado a UTC calendar (UTC midnight, UTC monday, UTC 1st of month) | LiteLLM convention; usuário espera "1 USD por dia" = "desde meia-noite UTC" não "última janela móvel" | DST irrelevante (UTC); leap year cobertos por `Date.UTC` math |
| **D383** | 3 modos: `audit` (log + count, no throw), `warn` (callback + log, no throw), `block` (throw `BudgetExceededError` BEFORE LLM call) | Audit-mode rollout é load-bearing operationally (referência: [TrueFoundry rate-limiting](https://www.truefoundry.com/blog/rate-limiting-ai-agents-preventing-llm-api-exhaustion) "Skipping audit mode is how you wake up to an angry team whose pipelines all failed at 03:00") | Default é `warn` (não `audit` — porque caller que cria Budget explicitamente já decidiu querer enforcement) |
| **D384** | Stacked limits permitidos: array `[{ window: '1d', limitUsd: 1 }, { window: '30d', limitUsd: 20 }]`; ANY limit exceeded = fail | LiteLLM/Bifrost convention (daily AND monthly composto). Usuário típico quer "$1/day E $20/month" | Performance: O(limits) check por preflight; tipicamente ≤ 3 |
| **D385** | In-process shared ledger (singleton mutex-protected via `withCwdMutex(`budget-ledger`)`); persistence **deferred to v0.2** | Concurrent `agent.send` calls do mesmo processo precisam compartilhar contador; persistence cross-restart traz JsonFile + corruption + lock + escopo cresce | v1 zera ao restart; v0.2 adiciona JsonFile (mesmo padrão de `JsonFileTaskStore`) |
| **D386** | `BudgetExceededError extends TheokitAgentError`; `code: "budget_exceeded"`; metadata `{ budgetName, window, spentUsd, limitUsd, mode }` | Mesma régua de D133 (`CredentialPoolExhaustedError`), D366 (`InvalidTaskIdError`). Caller pega tipado | `isRetryable: false` (cap não desaparece em retry) |
| **D387** | `RunResult.usage?` e `RunResult.cost?` são **opcionais** — backward compat absoluto. EC-5 update: populated em qualquer status onde ≥1 LLM call completou (incluindo partial-error). | Callers que ignoram ficam idênticos a v1.1. Billing/ledger não perde dados de partial-failure runs. | `undefined` apenas quando ZERO LLM calls aconteceram (e.g., abort pre-send) |
| **D388** | `CloudAgent.send` rejeita `{ budget }` com `UnsupportedBudgetOperationError` (mesma régua de D370 Tasks, D169 Personality) | Cloud é local-only em v1; Theo PaaS GA tratará | Caller cloud-gating recebe erro tipado; v1.x estende quando PaaS expõe budget API |

## Dependency Graph

```
Phase 0 ──▶ Phase 1 ──▶ Phase 2 ──▶ Phase 3 ──▶ Phase 4 ──▶ Phase 5 ──▶ Phase 6
(ADRs)      (types)     (pricing    (normalize  (LLM         (Budget     (CLI +
            errors      snapshot     usage 3    clients      facade +    docs +
            Zod)        + computer)  shapes)    propagate    ledger +    real-LLM
                                                usage to     enforcement) dogfood)
                                                RunResult)
```

Phases 0-3 podem rodar mais ou menos em paralelo (não há dependência forte de tipos vs snapshot). Phase 4 (wiring no `run-impl`) **depende** de Phase 3 (normalize). Phase 5 (Budget facade) **depende** de Phase 4 (precisa de cost para charge). Phase 6 (docs + dogfood) é gate final.

---

## Phase 0: Inventory + ADRs

**Objective:** Committar os 14 ADRs (D375-D388) com rationale + atualizar `CLAUDE.md` ADR table.

### T0.1 — Commit ADRs D375-D388

#### Objective
Materializar as 14 decisões da tabela ADRs acima em arquivos `D{N}-{slug}.md` em `.claude/knowledge-base/adrs/`.

#### Evidence
Padrão do repo: planos com 10+ ADRs (Tasks D361-D374, ACP D349-D360) sempre commit ADR files antes de Phase 1.

#### Files to edit
```
.claude/knowledge-base/adrs/D375-budget-static-class.md (NEW)
.claude/knowledge-base/adrs/D376-token-usage-5-bucket-enum.md (NEW)
.claude/knowledge-base/adrs/D377-cost-status-closed-enum.md (NEW)
.claude/knowledge-base/adrs/D378-per-million-pricing-canonical.md (NEW)
.claude/knowledge-base/adrs/D379-pricing-snapshot-bundled.md (NEW)
.claude/knowledge-base/adrs/D380-gpt-tokenizer-optional-peer.md (NEW)
.claude/knowledge-base/adrs/D381-claude-no-local-count.md (NEW)
.claude/knowledge-base/adrs/D382-budget-window-utc-aligned.md (NEW)
.claude/knowledge-base/adrs/D383-three-modes-audit-warn-block.md (NEW)
.claude/knowledge-base/adrs/D384-stacked-budget-limits.md (NEW)
.claude/knowledge-base/adrs/D385-in-process-ledger-mutex.md (NEW)
.claude/knowledge-base/adrs/D386-budget-exceeded-error.md (NEW)
.claude/knowledge-base/adrs/D387-runresult-usage-cost-optional.md (NEW)
.claude/knowledge-base/adrs/D388-budget-cloud-unsupported.md (NEW)
CLAUDE.md (MODIFY) — append 14 rows to ADR table
```

#### Deep file dependency analysis
ADRs são markdown free-standing. CLAUDE.md table é o índice; sempre append no final pra preservar histórico.

#### Deep Dives
N/A — docs only.

#### Tasks
1. Criar 14 arquivos seguindo template D349-D360.
2. Append 14 linhas em `CLAUDE.md` na tabela ADR.
3. Commit `docs(adr): D375-D388 — Token budget + cost tracker`.

#### TDD
```
N/A — ADRs são docs-only.
```

#### Acceptance Criteria
- [ ] 14 ADR files commitados
- [ ] `grep -c "^| D37[5-9]\|^| D38[0-8]" CLAUDE.md` retorna 14
- [ ] Commit isolado

#### DoD
- [ ] `git log --oneline -1` mostra commit dos ADRs

---

## Phase 1: Public types + errors

**Objective:** Materializar tipos públicos (`TokenUsage`, `CostBreakdown`, `BudgetOptions`, `BudgetWindow`) + 2 errors em `errors.ts`.

### T1.1 — Public type contract

#### Objective
Single source dos tipos públicos consumidos por todo o budget system.

#### Files to edit
```
packages/sdk/src/types/usage.ts (NEW) — TokenUsage + CostStatus + CostBreakdown
packages/sdk/src/types/budget.ts (NEW) — BudgetOptions + BudgetScope + BudgetWindow + BudgetMode + BudgetLimit + BudgetThresholdEvent + BudgetExceedEvent + BudgetHandle + BudgetSnapshot
packages/sdk/src/types/run.ts (MODIFY) — RunResult adds optional usage + cost
packages/sdk/src/types/index.ts (MODIFY) — re-export usage + budget
packages/sdk/src/errors.ts (MODIFY) — adicionar BudgetExceededError + UnsupportedBudgetOperationError
packages/sdk/src/index.ts (MODIFY) — export Budget (after Phase 5)
```

#### Deep file dependency analysis
- `types/usage.ts`: novo. Zero downstream inicial. Será consumido por LLM clients (Phase 4) + Budget facade (Phase 5).
- `types/budget.ts`: novo. Mesmo padrão.
- `types/run.ts`: file atual tem `RunResult` ([linha 49-66](packages/sdk/src/types/run.ts)). Modificação aditiva — `usage?: TokenUsage; cost?: CostBreakdown;` opcionais. Backward compat preserved.
- `types/index.ts`: barrel atual tem 22 re-exports. Adicionar `export type * from "./usage.js"` + `export type * from "./budget.js"`.
- `errors.ts`: adicionar 2 classes após `UnsupportedTaskOperationError` (D370 pattern). Estender `ErrorCode` literal union com `"budget_exceeded"` + `"budget_op_unsupported"`.

#### Deep Dives

**TokenUsage shape (D376):**
```ts
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly reasoningTokens?: number;
  readonly totalTokens: number;
  /** Per-request breakdown (mirror openai-agents-python request_usage_entries). */
  readonly requests?: ReadonlyArray<Omit<TokenUsage, "requests">>;
}
```

**CostBreakdown shape (D377):**
```ts
export type CostStatus = "actual" | "estimated" | "included" | "unknown";
export type CostSource = "openrouter_api" | "litellm_snapshot" | "user_override" | "subscription_included" | "unknown";

export interface CostBreakdown {
  readonly amountUsd: number | undefined;
  readonly status: CostStatus;
  readonly currency: "USD";
  readonly source: CostSource;
  readonly pricingVersion: string | undefined;
  readonly notes?: ReadonlyArray<string>;
  readonly detail?: {
    readonly input?: number;
    readonly output?: number;
    readonly cacheRead?: number;
    readonly cacheWrite?: number;
    readonly reasoning?: number;
  };
}
```

**BudgetWindow (D382) + BudgetOptions (D384):**
```ts
export type BudgetScope = "agent" | "call" | "process";
export type BudgetWindow = "1h" | "1d" | "1w" | "30d" | "365d";
export type BudgetMode = "audit" | "warn" | "block";

export interface BudgetLimit { readonly window: BudgetWindow; readonly limitUsd: number; }

export interface BudgetOptions {
  readonly name: string;
  readonly scope: BudgetScope;
  readonly limits: ReadonlyArray<BudgetLimit>;
  readonly mode?: BudgetMode;  // default "warn" per D383
  readonly onThreshold?: (event: BudgetThresholdEvent) => void | Promise<void>;
  readonly onExceed?: (event: BudgetExceedEvent) => void | Promise<void>;
}

export interface BudgetThresholdEvent { /* at 80% + 95% */ }
export interface BudgetExceedEvent { /* mode + spent + limit */ }
export interface BudgetHandle {
  readonly name: string;
  readonly mode: BudgetMode;
  readonly limits: ReadonlyArray<BudgetLimit>;
  spentIn(window: BudgetWindow): number;
  remainingIn(window: BudgetWindow): number;
}
export interface BudgetSnapshot { readonly name; readonly window; readonly spentUsd; readonly limitUsd; }
```

**Errors (D386, D388):**
```ts
export class BudgetExceededError extends TheokitAgentError {
  override readonly name = "BudgetExceededError";
  readonly budgetName: string;
  readonly window: BudgetWindow;
  readonly spentUsd: number;
  readonly limitUsd: number;
  readonly mode: BudgetMode; // EC-1 — caller branches on mode in logging/Sentry context
  constructor(args: { budgetName; window; spentUsd; limitUsd; mode; cause? });
}

export class UnsupportedBudgetOperationError extends TheokitAgentError {
  override readonly name = "UnsupportedBudgetOperationError";
  constructor(operation: string);
}
```

#### Tasks
1. Criar `types/usage.ts` com TokenUsage + CostStatus + CostBreakdown + CostSource.
2. Criar `types/budget.ts` com BudgetOptions + BudgetWindow + BudgetMode + BudgetLimit + events + BudgetHandle + BudgetSnapshot.
3. Modificar `types/run.ts` para adicionar `usage?: TokenUsage; cost?: CostBreakdown;` em RunResult.
4. Modificar `types/index.ts` adicionando 2 re-exports.
5. Modificar `errors.ts` adicionando 2 error classes.
6. Modificar `index.ts` (apenas re-exports de errors agora; Budget facade vem em Phase 5).
7. `pnpm -F @usetheo/sdk run typecheck` verde.

#### TDD
```
RED: test_token_usage_5_bucket_enum_satisfies_compile — TokenUsage with all 5 fields
RED: test_total_tokens_derived_from_buckets — totalTokens consistent
RED: test_cost_status_closed_enum_exhaustive_switch — 4 values
RED: test_budget_window_closed_enum — 5 values
RED: test_budget_mode_closed_enum — 3 values audit/warn/block
RED: test_runresult_usage_cost_optional — RunResult sem usage continua válido
RED: test_budget_exceeded_error_code — code === "budget_exceeded"
RED: test_budget_exceeded_error_has_mode_field — EC-1, asserts err.mode === "block"
RED: test_unsupported_budget_op_error_code — code === "budget_op_unsupported"
RED: test_token_usage_total_equals_input_plus_output — EC-10 consistency invariant
GREEN: implementar types + errors
REFACTOR: None expected
VERIFY: pnpm -F @usetheo/sdk run typecheck && pnpm -F @usetheo/sdk exec vitest run tests/types/usage.test.ts tests/types/budget.test.ts
```

#### Acceptance Criteria
- [ ] `import { TokenUsage, CostBreakdown, BudgetOptions, BudgetWindow, BudgetExceededError } from "@usetheo/sdk"` resolve
- [ ] 8 RED tests GREEN
- [ ] `RunResult.usage?` é opcional (existing RunResult callers continuam compilando)
- [ ] BudgetExceededError + UnsupportedBudgetOperationError extendem TheokitAgentError
- [ ] Pass: complexity ≤ 10 / size ≤ 200 LoC por file / coverage ≥ 90%

#### DoD
- [ ] `pnpm -F @usetheo/sdk run typecheck` exit 0
- [ ] biome zero warnings em new files

---

## Phase 2: Pricing snapshot + computer

**Objective:** Bundle LiteLLM pricing data (gzip ≤ 100 KB) + função `computeCost(usage, route)` que retorna `CostBreakdown`.

### T2.1 — Pricing snapshot loader

#### Objective
Carregar LiteLLM JSON snapshot lazy, expor `getPricingEntry({ provider, model, baseUrl? })`.

#### Files to edit
```
packages/sdk/src/internal/budget/pricing-data.json (NEW) — LiteLLM snapshot
packages/sdk/src/internal/budget/pricing-registry.ts (NEW) — loader + cache
packages/sdk/src/internal/budget/pricing-types.ts (NEW) — internal types
scripts/refresh-pricing.mjs (NEW) — refresh helper (manual cron)
packages/sdk/tsup.config.ts (MODIFY) — copy pricing-data.json to dist
```

#### Deep file dependency analysis
- `pricing-data.json`: 2500+ models, ~700KB raw, ~100KB gzipped. Bundle in package; not lazy-loaded by network.
- `pricing-registry.ts`: lazy `require()` para o JSON (não eager — economy de boot time), normaliza para `PricingEntry` shape.
- `scripts/refresh-pricing.mjs`: fetcha `https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`, normaliza, escreve em `pricing-data.json`, atualiza `pricingVersion` field.
- `tsup.config.ts`: copy JSON to dist so consumers get it via `import.meta.url`.

#### Deep Dives

**Pricing normalization** (LiteLLM raw shape → internal):
```
LiteLLM raw: {
  "claude-opus-4-7": { "input_cost_per_token": 0.000005, "output_cost_per_token": 0.000025, "cache_read_input_token_cost": 5e-7, "litellm_provider": "anthropic", "max_tokens": 200000 },
  ...
}

Internal PricingEntry: {
  provider: "anthropic", model: "claude-opus-4-7",
  inputCostPerMillion: 5.0, outputCostPerMillion: 25.0,
  cacheReadCostPerMillion: 0.5, cacheWriteCostPerMillion: undefined,
  source: "litellm_snapshot", pricingVersion: "litellm-2026-05"
}
```

**Caching**: Map<`${provider}/${model}`, PricingEntry> lazy-built no first call.

**Edge cases (EC-2 — MUST FIX, alias resolution mandatório):**
- **Date-suffix strip** (`gpt-4o-2024-08-06` → `gpt-4o`; `claude-opus-4-7-20250507` → `claude-opus-4-7`): regex `-\d{8}$` fallback após lookup direto. Sem isso, todo usuário passando version-pinned model id recebe `status: "unknown"` — quebra majoritário (Anthropic recomenda passar versioned).
- **Anthropic dot→dash** (`claude-opus-4.7` → `claude-opus-4-7`): regex `(\d+)\.(\d+)` → `$1-$2`, mirror Hermes `_normalize_anthropic_model_name` ([usage_pricing.py:556-570](../../../referencia/hermes-agent/agent/usage_pricing.py)).
- **OpenRouter prefix** (`openrouter/anthropic/claude-...`): strip leading `openrouter/`. Edge variants: `openrouter/free/llama-3.2-3b-instruct:free` (EC-11), `openrouter/google/gemini-2.0-flash` — após strip, lookup pelo resto.
- **Lookup precedence**: direct → date-strip → dot-normalize → openrouter-strip → undefined. Documentar ordem no JSDoc.

#### Tasks
1. Criar `scripts/refresh-pricing.mjs` que fetcha LiteLLM raw + normaliza + escreve `pricing-data.json` + estampa `pricingVersion`.
2. Executar uma vez para criar snapshot inicial.
3. Criar `pricing-registry.ts` com `getPricingEntry({ provider, model })` + alias/normalization fallback.
4. Wire tsup para copy JSON.
5. Unit tests cobrindo: lookup direct, alias fallback (Anthropic dot→dash), OpenRouter prefix strip, unknown returns undefined.

#### TDD
```
RED: test_pricing_lookup_direct_anthropic — claude-opus-4-7 → known entry
RED: test_pricing_lookup_anthropic_dot_notation_normalize — claude-opus-4.7 → same (EC-2)
RED: test_pricing_lookup_date_suffix_strip — claude-opus-4-7-20250507 → claude-opus-4-7 (EC-2)
RED: test_pricing_lookup_gpt_date_suffix_strip — gpt-4o-2024-08-06 → gpt-4o (EC-2)
RED: test_pricing_lookup_openrouter_anthropic_prefix_strip — openrouter/anthropic/claude-... → anthropic/claude-... (EC-11)
RED: test_pricing_lookup_openrouter_free_models — openrouter/free/llama-3.2-3b-instruct:free resolves (EC-11)
RED: test_pricing_lookup_openrouter_google_prefix — openrouter/google/gemini-2.0-flash resolves (EC-11)
RED: test_pricing_lookup_unknown_returns_undefined
RED: test_pricing_data_json_loads_lazy — first call triggers require
RED: test_pricing_version_field_present_in_snapshot
GREEN: implementar pricing-registry + scripts/refresh
REFACTOR: extract normalize helpers if complexity > 10
VERIFY: pnpm -F @usetheo/sdk exec vitest run tests/internal/budget/pricing-registry.test.ts
```

#### Acceptance Criteria
- [ ] 10 RED tests GREEN (6 originais + 4 alias normalization EC-2/EC-11)
- [ ] `pricing-data.json` after gzip ≤ 100 KB
- [ ] `pricingVersion` field present (e.g. "litellm-2026-05")
- [ ] `getPricingEntry({ provider: "anthropic", model: "claude-opus-4-7" })` retorna entry com inputCostPerMillion=5 + outputCostPerMillion=25
- [ ] Date-suffix + dot-notation aliases resolvem corretamente (EC-2)
- [ ] OpenRouter prefix variants (anthropic/google/free) resolvem (EC-11)
- [ ] `scripts/refresh-pricing.mjs` JSDoc documenta: "Network failure → exit 1; bundled snapshot continua válido" (EC-17 DOCUMENT)
- [ ] Pass: complexity ≤ 10 / size ≤ 250 LoC

#### DoD
- [ ] 10 tests passing
- [ ] `scripts/refresh-pricing.mjs` runnable standalone, exits 0

### T2.2 — Compute cost

#### Objective
Função `computeCost({ usage, provider, model, baseUrl? }) → CostBreakdown` que aplica per-million math sobre 5 buckets.

#### Files to edit
```
packages/sdk/src/internal/budget/compute-cost.ts (NEW)
packages/sdk/src/internal/budget/compute-cost.test.ts (NEW)
```

#### Deep file dependency analysis
- `compute-cost.ts` depende de `pricing-registry.ts` (T2.1) + tipos `types/usage.ts` (T1.1).

#### Deep Dives

**Cost math (mirror Hermes `estimate_usage_cost`):**
```ts
function computeCost(args: {
  usage: TokenUsage;
  provider: string;
  model: string;
  baseUrl?: string;
}): CostBreakdown {
  // 1. Resolve billing route (subscription_included → return $0 "included")
  // 2. Get pricing entry; if undefined → return { status: "unknown", amountUsd: undefined }
  // 3. For each bucket with tokens > 0, check pricing field exists; if missing → "unknown" + note
  // 4. Sum: (input × inputPerMillion + output × outputPerMillion + ...) / 1_000_000
  // 5. Return { amountUsd, status: "estimated", source, pricingVersion, detail: { input, output, ... } }
}
```

**Precision (per D376 v1):** usar `number` × `1e6` normalization. Acumular em "microcents" interno, dividir só no display:
```ts
const microcents = Math.round(usage.inputTokens * entry.inputCostPerMillion * 1e6 / 1e6);
const amountUsd = microcents / 1e6;
```
Documentar limitação no JSDoc: "número possui ~7 decimals de precisão; para accounting-grade use post-process decimal lib".

#### Tasks
1. Criar `compute-cost.ts` com função `computeCost(args)` + helpers privados.
2. Cobrir 5 buckets + missing pricing detection + subscription_included shortcut.
3. Unit tests cobrindo edge cases.

#### TDD
```
RED: test_compute_cost_known_anthropic_5_buckets — claude-opus-4-7 com cacheRead + cacheWrite
RED: test_compute_cost_subscription_included_returns_zero — Codex CLI route
RED: test_compute_cost_unknown_route_returns_unknown_status
RED: test_compute_cost_partial_pricing_missing_returns_unknown_with_note — cache fields used but pricing missing for cache
RED: test_compute_cost_openrouter_marks_estimated_until_reconciled
RED: test_compute_cost_zero_usage_returns_zero_amount_estimated_status
RED: test_compute_cost_reasoning_tokens_billed_at_output_rate
RED: test_compute_cost_no_float_drift_in_common_cases — EC-12: 15.0 USD/MTok × 10M tokens === $150.00 exact (não $149.999...)
RED: test_compute_cost_treats_negative_pricing_as_invalid — EC-13: entry corrupta com inputCostPerMillion: -1 → status="unknown" + note
RED: test_compute_cost_reasoning_falls_back_to_output_rate — EC-14: reasoningCostPerMillion undefined mas outputCostPerMillion defined → soma reasoning em output
GREEN: implementar computeCost
REFACTOR: None expected
VERIFY: pnpm -F @usetheo/sdk exec vitest run tests/internal/budget/compute-cost.test.ts
```

#### Acceptance Criteria
- [ ] 10 RED tests GREEN (7 originais + 3 SHOULD TEST EC-12/EC-13/EC-14)
- [ ] 5-bucket math correct
- [ ] `status: "unknown"` quando pricing missing — NÃO retorna 0 falso
- [ ] Negative pricing entries clamp to `status: "unknown"` + note (EC-13)
- [ ] Reasoning tokens fall back to output rate when reasoningCostPerMillion undefined (EC-14)
- [ ] Common-case money math precision verified (EC-12)
- [ ] `detail: { input, output, ... }` populated when amountUsd present
- [ ] Pass: complexity ≤ 10 / size ≤ 200 LoC

#### DoD
- [ ] 10 tests passing

---

## Phase 3: Normalize usage (3 API shapes)

**Objective:** `normalizeUsage(rawUsage, { provider, apiMode })` cobre Anthropic Messages / OpenAI Chat / OpenAI Responses + edge cases (`cline#10266`, null guards).

### T3.1 — Normalize usage function

#### Objective
Port do Hermes `normalize_usage` ([usage_pricing.py:672-742](../../../referencia/hermes-agent/agent/usage_pricing.py)) para TS, com 3 shapes + Anthropic-style top-level fallback.

#### Files to edit
```
packages/sdk/src/internal/budget/normalize-usage.ts (NEW)
packages/sdk/src/internal/budget/normalize-usage.test.ts (NEW)
```

#### Deep file dependency analysis
- `normalize-usage.ts` é stateless — pure function. Consome `LlmFinish` shape de cada provider.

#### Deep Dives

**3 modes** ([reference doc §7.2](../reference/token-budget-cost-tracker.md#72-token-bucket-conversion-under-cache-hermes-3-mode-normalize)):

```ts
type ApiMode = "anthropic_messages" | "openai_chat_completions" | "openai_responses";

function normalizeUsage(raw: unknown, opts: { provider: string; apiMode?: ApiMode }): TokenUsage {
  const mode = opts.apiMode ?? inferMode(opts.provider);

  if (mode === "anthropic_messages") {
    // 4 buckets explícitas no shape Anthropic
    // input_tokens NÃO inclui cache; soma direta
    return {
      inputTokens: int(raw.input_tokens),
      outputTokens: int(raw.output_tokens),
      cacheReadTokens: int(raw.cache_read_input_tokens),
      cacheWriteTokens: int(raw.cache_creation_input_tokens),
      reasoningTokens: undefined, // Anthropic não expõe
      totalTokens: /* soma */,
    };
  }

  if (mode === "openai_responses") {
    const inputTotal = int(raw.input_tokens);
    const cacheRead = int(raw.input_tokens_details?.cached_tokens);
    const cacheWrite = int(raw.input_tokens_details?.cache_creation_tokens);
    const input = Math.max(0, inputTotal - cacheRead - cacheWrite);
    return { inputTokens: input, outputTokens: int(raw.output_tokens), cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, reasoningTokens: int(raw.output_tokens_details?.reasoning_tokens), totalTokens: /* soma */ };
  }

  // openai_chat_completions (default)
  const promptTotal = int(raw.prompt_tokens);
  const cacheRead = int(raw.prompt_tokens_details?.cached_tokens) || int(raw.cache_read_input_tokens); // top-level fallback (cline#10266)
  const cacheWrite = int(raw.prompt_tokens_details?.cache_write_tokens) || int(raw.cache_creation_input_tokens); // idem
  const input = Math.max(0, promptTotal - cacheRead - cacheWrite);
  return { inputTokens: input, outputTokens: int(raw.completion_tokens), cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, reasoningTokens: int(raw.completion_tokens_details?.reasoning_tokens), totalTokens: /* soma */ };
}
```

**Edge cases:**
- `raw === null | undefined` → return TokenUsage com todos 0.
- Provider unknown → fallback to `openai_chat_completions` (most common compat shape).
- `Math.max(0, ...)` protects against floor (alguns proxies enviam negative quando bug).

#### Tasks
1. Implementar `normalizeUsage` com 3 branches.
2. Helper `inferMode(provider)` — anthropic → anthropic_messages, openai/* → openai_chat_completions, codex → openai_responses.
3. Helper `int(value)` para null-safe coercion.
4. Unit tests cobrindo cada shape + edge cases.

#### TDD
```
RED: test_normalize_anthropic_4_buckets_separated
RED: test_normalize_openai_chat_subtracts_cached_from_prompt
RED: test_normalize_openai_responses_codex_separates_cached_and_creation
RED: test_normalize_openai_chat_top_level_anthropic_cache_fields_cline_10266 — proxies expõem cache_creation_input_tokens top-level
RED: test_normalize_openai_chat_reasoning_tokens_from_completion_details
RED: test_normalize_null_usage_returns_zero_buckets
RED: test_normalize_negative_input_clamped_to_zero
RED: test_normalize_total_tokens_derived_correctly
RED: test_infer_mode_from_provider_anthropic
RED: test_infer_mode_from_provider_openai
RED: test_infer_mode_from_provider_unknown_falls_back_to_openai_chat
GREEN: implementar normalize + inferMode
REFACTOR: extract 3 branches into private helpers if complexity > 10
VERIFY: pnpm -F @usetheo/sdk exec vitest run tests/internal/budget/normalize-usage.test.ts
```

#### Acceptance Criteria
- [ ] 11 RED tests GREEN
- [ ] Anthropic 4-bucket: input + output + cacheRead + cacheWrite separated
- [ ] OpenAI Chat: cline#10266 regression — top-level cache fields detected
- [ ] OpenAI Responses (Codex): subtraction math correct
- [ ] Null/negative inputs handled gracefully
- [ ] Pass: complexity ≤ 10 / size ≤ 250 LoC

#### DoD
- [ ] 11 tests passing
- [ ] Comment cita `cline/cline#10266` no test EC

---

## Phase 4: Wire LLM clients + propagate to RunResult

**Objective:** Coletar usage de cada step + agregar em multi-step run + popular `RunResult.usage` + `RunResult.cost`.

### T4.1 — Extend LlmFinish with 5 buckets

#### Objective
`LlmFinish` no `packages/sdk/src/internal/llm/types.ts` expor todos 5 buckets (cacheRead, cacheWrite, reasoning) — não só input + output.

#### Files to edit
```
packages/sdk/src/internal/llm/types.ts (MODIFY) — LlmFinish adds cacheRead/cacheWrite/reasoning
packages/sdk/src/internal/llm/finish.ts (MODIFY) — makeLlmFinish accepts 5 buckets
packages/sdk/src/internal/llm/anthropic.ts (MODIFY) — parse cache_read_input_tokens + cache_creation_input_tokens
packages/sdk/src/internal/llm/anthropic-shared.ts (MODIFY) — idem
packages/sdk/src/internal/llm/openai.ts (MODIFY) — parse prompt_tokens_details.cached_tokens + completion_tokens_details.reasoning_tokens; gate on finish_reason !== null
packages/sdk/src/internal/llm/openrouter.ts (if exists) — passthrough
packages/sdk/src/internal/llm/ollama.ts (if exists) — populate input/output only
```

#### Deep file dependency analysis
Current state: `LlmFinish` has only `inputTokens?` + `outputTokens?`. Anthropic + OpenAI clients already parse usage; need to extend to all 5 buckets.

#### Deep Dives

**Anthropic API response** (per [reference doc §8 / Anthropic docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)):
```json
{ "usage": { "input_tokens": 2048, "cache_read_input_tokens": 1800, "cache_creation_input_tokens": 248, "output_tokens": 503 } }
```

**OpenAI Chat Completions API response with cache:**
```json
{ "usage": { "prompt_tokens": 3000, "completion_tokens": 700, "prompt_tokens_details": { "cached_tokens": 1800 }, "completion_tokens_details": { "reasoning_tokens": 100 } } }
```

**Critical: gate on `finish_reason !== null && chunk.usage != null`** (edge case from reference doc §8 — DeepSeek emite `usage:null` em intermediários).

**EC-3 (MUST FIX) — `stream_options.include_usage` é OpenAI-compat-only:**
- Anthropic API NÃO aceita `stream_options.include_usage`; enviar causaria HTTP 400 ou ignore silent.
- Gate na injeção: `if (apiMode === "openai_chat_completions" || apiMode === "openai_responses") { ... }`. Anthropic client jamais recebe esse campo.

**EC-4 (MUST FIX) — respeitar opt-out explícito do caller:**
- Caller que passa `{ stream_options: { include_usage: false } }` quer desligar usage report (e.g., economizar bytes). SDK NÃO deve override.
- Merge correto: `include_usage: user.stream_options?.include_usage ?? true`. Set default true só quando undefined.

#### Tasks
1. Extend `LlmFinish` interface with optional `cacheReadTokens`, `cacheWriteTokens`, `reasoningTokens`.
2. Modify `makeLlmFinish` factory to accept all 5.
3. Anthropic clients: parse all 4 token fields.
4. OpenAI client: parse `prompt_tokens_details.cached_tokens` + `completion_tokens_details.reasoning_tokens`; gate on terminal chunk.
5. Default OpenAI streaming to `stream_options: { include_usage: true }` (D387 acceptance).
6. Unit tests per provider.

#### TDD
```
RED: test_anthropic_parses_4_buckets_from_usage
RED: test_openai_parses_cached_tokens_from_prompt_details
RED: test_openai_parses_reasoning_tokens_from_completion_details
RED: test_openai_streaming_gates_on_finish_reason_terminal
RED: test_openai_streaming_default_include_usage_true
RED: test_anthropic_client_never_sends_stream_options_include_usage — EC-3 provider-aware gate
RED: test_openai_user_explicit_include_usage_false_respected — EC-4 opt-out merge
RED: test_llm_finish_5_bucket_round_trip
GREEN: extend types + clients
REFACTOR: extract usage-parser helpers if duplicated
VERIFY: pnpm -F @usetheo/sdk exec vitest run tests/internal/llm/
```

#### Acceptance Criteria
- [ ] 6 RED tests GREEN
- [ ] `LlmFinish` carries all 5 buckets
- [ ] No regression in existing LLM client tests
- [ ] OpenAI streaming defaults `include_usage: true`
- [ ] Pass: existing 1700+ tests continuam verdes

#### DoD
- [ ] 6 tests + existing LLM tests passing

### T4.2 — Aggregate usage in run-impl + populate RunResult

#### Objective
`run-impl.ts` agrega `LlmFinish.{usage fields}` ao longo de N steps + popula `RunResult.usage` + chama `computeCost` + popula `RunResult.cost`.

#### Files to edit
```
packages/sdk/src/internal/runtime/run-impl.ts (MODIFY) — accumulator + final fill
packages/sdk/src/internal/runtime/usage-accumulator.ts (NEW) — aggregator class (extract for testability)
packages/sdk/tests/integration/run-result-usage.test.ts (NEW)
```

#### Deep file dependency analysis
- `run-impl.ts`: arquivo provavelmente grande; mantenho LoC sob 400 via extraction (`usage-accumulator.ts`).
- `usage-accumulator.ts`: classe `UsageAccumulator` com `add(stepUsage)` + `result(): TokenUsage` + `requests[]` (mirror openai-agents-python).

#### Deep Dives

**UsageAccumulator pattern (mirror openai-agents-python `Usage.add`):**
```ts
export class UsageAccumulator {
  private input = 0, output = 0, cacheRead = 0, cacheWrite = 0, reasoning = 0;
  private requests: TokenUsage[] = [];

  add(step: { inputTokens?; outputTokens?; cacheReadTokens?; ... }): void {
    this.input += step.inputTokens ?? 0;
    this.output += step.outputTokens ?? 0;
    this.cacheRead += step.cacheReadTokens ?? 0;
    this.cacheWrite += step.cacheWriteTokens ?? 0;
    this.reasoning += step.reasoningTokens ?? 0;
    this.requests.push({
      inputTokens: step.inputTokens ?? 0,
      outputTokens: step.outputTokens ?? 0,
      cacheReadTokens: step.cacheReadTokens,
      cacheWriteTokens: step.cacheWriteTokens,
      reasoningTokens: step.reasoningTokens,
      totalTokens: (step.inputTokens ?? 0) + (step.outputTokens ?? 0),
    });
  }

  toTokenUsage(): TokenUsage {
    return {
      inputTokens: this.input, outputTokens: this.output,
      cacheReadTokens: this.cacheRead > 0 ? this.cacheRead : undefined,
      cacheWriteTokens: this.cacheWrite > 0 ? this.cacheWrite : undefined,
      reasoningTokens: this.reasoning > 0 ? this.reasoning : undefined,
      totalTokens: this.input + this.output,
      requests: this.requests.length > 1 ? this.requests : undefined,
    };
  }
}
```

**Wiring in run-impl:**
- Já existe `LlmFinish` flow. Após cada step: `accumulator.add(finishUsage)`.
- Na transição para terminal `RunResult`: chamar `accumulator.toTokenUsage()` → `result.usage = ...`.
- Chamar `computeCost({ usage, provider: agent.model.provider, model: agent.model.id })` → `result.cost = ...`.

**EC-5 (MUST FIX) — preservar usage em partial failure:**
- D387 original dizia `usage = undefined` em status `error`/`cancelled`. **Inverso**: tokens já incurridos em steps prévios precisam ser surfaced (billing audit + ledger charge).
- Regra correta: `result.usage` populated em **todo** status onde algum step LLM completou (`finished | error | cancelled`); `requests[]` reflete breakdown parcial. `result.cost.amountUsd` reflete o que foi cobrado até ali; `status: "estimated"`.
- Apenas quando ZERO LLM calls aconteceram (e.g., abort antes de qualquer send), `usage` fica undefined.

#### Tasks
1. Criar `usage-accumulator.ts` com classe + unit tests.
2. Modificar `run-impl.ts` para accumular per-step + popular `result.usage`/`result.cost` no fim.
3. Integration test contra fixture (theo_test_*) verificando que `usage` é populated.

#### TDD
```
RED: test_usage_accumulator_aggregates_3_steps
RED: test_usage_accumulator_omits_undefined_buckets_when_zero
RED: test_usage_accumulator_requests_array_when_multi_step
RED: test_usage_accumulator_requests_undefined_when_single_step
RED: test_run_result_usage_populated_after_finished
RED: test_run_result_cost_populated_when_pricing_known
RED: test_run_result_cost_status_unknown_when_pricing_missing
RED: test_run_result_usage_populated_on_partial_error — EC-5: steps 1-2 sucedem + step 3 erro → usage reflete steps 1-2
RED: test_run_result_usage_populated_on_cancelled_mid_stream — EC-5: cancel após step 1 finished → usage reflete step 1
RED: test_run_result_usage_undefined_only_when_zero_llm_calls — EC-5: abort antes de qualquer send
GREEN: implementar accumulator + wire run-impl
REFACTOR: None expected (extract was preventive)
VERIFY: pnpm -F @usetheo/sdk exec vitest run tests/internal/runtime/usage-accumulator.test.ts tests/integration/run-result-usage.test.ts
```

#### Acceptance Criteria
- [ ] 8 RED tests GREEN
- [ ] `result.usage.totalTokens > 0` em fixture run
- [ ] `result.cost.status` matches pricing snapshot coverage
- [ ] `result.usage` undefined em error/cancelled status (D387)
- [ ] Backward compat: existing 1700+ tests sem regressão
- [ ] Pass: complexity ≤ 10 / size ≤ 250 LoC accumulator

#### DoD
- [ ] 8 tests + existing runtime tests passing
- [ ] `pnpm validate` exit 0

---

## Phase 5: Budget facade + ledger + enforcement

**Objective:** `Budget.create / list / get / delete / snapshot` static facade + in-process ledger mutex-protected + 3 modes (audit/warn/block).

### T5.1 — Budget ledger (in-process)

#### Objective
Singleton mutex-protected ledger: charge(name, amountUsd) + spentIn(window) + reset on window boundary.

#### Files to edit
```
packages/sdk/src/internal/budget/ledger.ts (NEW)
packages/sdk/src/internal/budget/calendar-window.ts (NEW)
packages/sdk/src/internal/budget/ledger.test.ts (NEW)
packages/sdk/src/internal/budget/calendar-window.test.ts (NEW)
```

#### Deep file dependency analysis
- `calendar-window.ts`: helpers UTC-aligned (start/end of day/week/month).
- `ledger.ts`: singleton com `Map<budgetName, ChargeLog[]>`; concurrent access via `withCwdMutex('budget-ledger')` (pattern existente).

#### Deep Dives

**UTC alignment:**
```ts
function startOfDayUTC(now: Date = new Date()): Date { /* set to 00:00:00.000 UTC */ }
function startOfWeekUTC(now: Date = new Date()): Date { /* set to Monday 00:00 UTC */ }
function startOfMonthUTC(now: Date = new Date()): Date { /* set to 1st 00:00 UTC */ }
function windowStart(window: BudgetWindow, now?: Date): Date {
  switch (window) {
    case "1h": return new Date(now - 60*60*1000);
    case "1d": return startOfDayUTC(now);
    case "1w": return startOfWeekUTC(now);
    case "30d": return new Date(now - 30*24*60*60*1000);
    case "365d": return new Date(now - 365*24*60*60*1000);
  }
}
```

**Ledger:**
```ts
interface ChargeLog { timestamp: number; amountUsd: number; }
class Ledger {
  private logs = new Map<string, ChargeLog[]>();
  async charge(budgetName: string, amountUsd: number): Promise<void> { /* mutex */ }
  spentIn(budgetName: string, window: BudgetWindow): number {
    const since = windowStart(window).getTime();
    return (this.logs.get(budgetName) ?? []).filter(l => l.timestamp >= since).reduce((s, l) => s + l.amountUsd, 0);
  }
  __reset(): void { /* tests */ }
}
```

**EC-6 (MUST FIX) — GC dentro do MESMO mutex de charge:**
- GC iterando/filtrando o array de logs enquanto outro `charge()` adiciona = race condition → charges perdidos OU array corruption.
- Invariante: TODA operação que muta `logs` (charge + GC eviction + reset) acontece DENTRO de `withCwdMutex('budget-ledger')`. GC threshold check pode ser fora; eviction execution dentro.
- Implementação: GC trigger = "logs.length > 10_000 OR now - lastGc > 5min" — check fora do mutex; eviction dentro.

**EC-15 (SHOULD TEST) — calendar boundary com call em vôo:**
- Call começa 23:59:59 UTC, charge() chamado 00:00:01 UTC do dia seguinte.
- Atribuir ao dia da call-start (snapshot timestamp no preflight) ou ao dia do charge?
- Decisão: **timestamp do charge()** — alinha com industry pattern (LiteLLM). User espera "spend hoje" = "calls que terminaram hoje". Documentar.

#### Tasks
1. Criar `calendar-window.ts` com 4 helpers UTC-aligned.
2. Criar `ledger.ts` com singleton + mutex.
3. Unit tests cobrindo concurrency + UTC boundaries.

#### TDD
```
RED: test_start_of_day_utc_midnight
RED: test_start_of_week_utc_monday
RED: test_start_of_month_utc_first
RED: test_window_start_1h_relative
RED: test_window_start_1d_aligned_utc_midnight
RED: test_ledger_charge_accumulates
RED: test_ledger_spent_in_filters_by_window
RED: test_ledger_concurrent_charges_no_race — 100 concurrent
RED: test_ledger_gc_drops_older_than_365d
RED: test_ledger_gc_runs_under_same_mutex_no_charge_race — EC-6: GC + concurrent charge no corruption
RED: test_ledger_charge_uses_call_timestamp_for_window_attribution — EC-15 calendar boundary
RED: test_ledger_reset_clears_all_budgets
GREEN: implementar both
REFACTOR: None expected
VERIFY: pnpm -F @usetheo/sdk exec vitest run tests/internal/budget/ledger.test.ts tests/internal/budget/calendar-window.test.ts
```

#### Acceptance Criteria
- [ ] 10 RED tests GREEN
- [ ] Concurrent 100-call burst no race
- [ ] UTC alignment correct (DST irrelevante)
- [ ] Pass: complexity ≤ 10

#### DoD
- [ ] 10 tests passing

### T5.2 — Budget facade + enforcement

#### Objective
Public `Budget.create({ scope, limits, mode, onThreshold, onExceed })` + ligar charge no run-impl post-cost.

#### Files to edit
```
packages/sdk/src/budget.ts (NEW)
packages/sdk/src/internal/budget/registry.ts (NEW) — Budget instances registry (singleton Map)
packages/sdk/src/internal/budget/enforcement.ts (NEW) — preflightCheck + chargeAndCheckThresholds
packages/sdk/src/internal/runtime/run-impl.ts (MODIFY) — call Budget.chargeAndCheck after computeCost
packages/sdk/src/index.ts (MODIFY) — export Budget
packages/sdk/tests/budget-facade.test.ts (NEW)
packages/sdk/tests/integration/budget-enforcement.test.ts (NEW)
```

#### Deep file dependency analysis
- `budget.ts`: thin facade, mirror `Task` class (D361 pattern).
- `enforcement.ts`: `preflightCheck` + `chargeAndCheckThresholds` invocados pelo run-impl.
- `run-impl.ts` (MODIFY de novo): após `computeCost`, chamar `chargeAndCheckThresholds(allBudgets, cost.amountUsd, model)` + se mode `block` e estouraria → `throw BudgetExceededError` ANTES do LLM call (preflightCheck).

#### Deep Dives

**preflightCheck (D380 + D381):**
```ts
async function preflightCheck(budgets: BudgetHandle[], estimatedUsd: number): Promise<void> {
  for (const b of budgets.filter(b => b.mode === "block")) {
    for (const lim of b.limits) {
      const spent = ledger.spentIn(b.name, lim.window);
      if (spent + estimatedUsd > lim.limitUsd) {
        throw new BudgetExceededError({
          budgetName: b.name, window: lim.window, spentUsd: spent, limitUsd: lim.limitUsd,
        });
      }
    }
  }
}
```

**Pre-call estimation source:**
- Lazy load `gpt-tokenizer` peer (D380). Se ausente → return `undefined` (no preflight; charge after the fact).
- Estimate input tokens from prompt; output ~ inputTokens (conservative); apply pricing.

**chargeAndCheckThresholds (post-call):**
```ts
async function chargeAndCheckThresholds(budgets, cost): Promise<void> {
  if (cost.amountUsd === undefined) return; // unknown — can't charge
  for (const b of budgets) {
    await ledger.charge(b.name, cost.amountUsd);
    for (const lim of b.limits) {
      const spent = ledger.spentIn(b.name, lim.window);
      const ratio = spent / lim.limitUsd;
      if (ratio >= 1) await invokeExceedCallback(b, lim, spent);
      else if (ratio >= 0.95) await invokeThresholdCallback(b, lim, spent, 0.95);
      else if (ratio >= 0.80) await invokeThresholdCallback(b, lim, spent, 0.80);
    }
  }
}
```

**Modes (D383):**
- `audit`: nunca throw, sempre charge, log apenas em exceed.
- `warn`: charge + onThreshold callback at 80%/95% + onExceed callback at 100%; console.warn; no throw.
- `block`: preflightCheck pode throw BEFORE LLM call; charge + callbacks após.

**EC-7 (MUST FIX) — name validation:**
- `Budget.create({ name })` valida: non-empty + grammar `^[a-z0-9][a-z0-9_-]*$` (mirror D368 task IDs). Caller passando `""`, `undefined`, ou `"foo/bar"` recebe `ConfigurationError({ code: "invalid_budget_name" })`. Evita key corruption no registry e issues em CLI futura.

**EC-8 (MUST FIX) — callback isolation:**
- `onThreshold` / `onExceed` callbacks rodam em `try { await cb(...) } catch (err) { process.stderr.write("[budget] callback threw: " + msg) }` — mirror Mastra cost-guard pattern ([cost-guard.ts:277-291](../../../referencia/mastra/packages/core/src/processors/processors/cost-guard.ts)). Single bug em Sentry-call NÃO derruba o agente.

**EC-9 (MUST FIX) — atomic preflightCheck + charge:**
- Sem mutex, race: 10 concurrent sends com cap=$5 cada estima $0.1; cada um lê `spent=$0` e passa preflight; total real $1 mas se cada chamasse 50× ainda passaria.
- Solução: a janela `preflightCheck (read spent) → provisional reserve (add to ledger) → LLM call → final settle (replace reserve with actual)` está toda dentro de **uma única** região protegida via `withCwdMutex('budget-${name}')`.
- Trade-off: serializa sends contra o **mesmo budget** (não contra budgets distintos). Para budgets `process`-scoped (shared global), isso reduz throughput em high-concurrency — documentar limitação.

**EC-18 (DOCUMENT) — zero limit kill switch:**
- `Budget.create({ mode: 'block', limits: [{ window: '1d', limitUsd: 0 }] })` bloqueia QUALQUER send. UX intencional ("emergency stop"). Concept page documenta.

**EC-19 (DOCUMENT) — empty limits[] = informational tracking:**
- `Budget.create({ limits: [] })` registra spend + chama callbacks mas nunca enforce. Hermes permite. Concept page: "Empty limits = registry-only mode; thresholds/onExceed nunca disparam (mas snapshot/charge funcionam)."

**EC-20 (DOCUMENT) — Budget.delete durante in-flight:**
- Race entre `delete(name)` e `charge(name)` em paralelo. Charge no budget deletado vira no-op silencioso + stderr warn 1×. Edge raro mas previsível. Concept page documenta.

#### Tasks
1. Criar `registry.ts` (Map<name, options + handle>).
2. Criar `enforcement.ts` com preflightCheck + chargeAndCheckThresholds.
3. Criar `budget.ts` facade pública.
4. Modificar `run-impl.ts` para invocar enforcement.
5. Wire SendOptions opcional `budget?: string | BudgetHandle` (caller pode amarrar Budget ao send).
6. Unit tests cobrindo facade + 3 modes.
7. Integration test cobrindo cycle completo: create → send → charge → cap.

#### TDD
```
RED: test_budget_facade_static_class_constructor_throws
RED: test_budget_create_returns_handle
RED: test_budget_create_duplicate_name_throws_configuration_error — EC-16 surface caller bug
RED: test_budget_create_empty_name_throws_configuration_error — EC-7 name validation
RED: test_budget_create_invalid_grammar_throws_configuration_error — EC-7 name validation
RED: test_budget_list_returns_active
RED: test_budget_get_unknown_returns_undefined
RED: test_budget_delete_idempotent
RED: test_budget_delete_in_flight_charge_becomes_silent_noop — EC-20
RED: test_budget_snapshot_returns_spent_per_window
RED: test_audit_mode_never_throws_only_logs
RED: test_warn_mode_invokes_onthreshold_at_80
RED: test_warn_mode_invokes_onthreshold_at_95
RED: test_warn_mode_invokes_onexceed_at_100_no_throw
RED: test_block_mode_preflight_throws_budget_exceeded_error
RED: test_block_mode_block_before_llm_call_no_charge
RED: test_block_mode_under_limit_passes
RED: test_block_mode_without_gpt_tokenizer_degrades_to_post_call_enforce — EC-21
RED: test_stacked_limits_any_exceeded_blocks
RED: test_budget_charge_persists_across_calls_same_process
RED: test_calendar_reset_clears_window_spend
RED: test_onthreshold_callback_throw_does_not_break_run — EC-8 isolation
RED: test_onexceed_callback_throw_does_not_mask_budget_exceeded_error — EC-8 isolation
RED: test_concurrent_100_sends_block_mode_cap_respected — EC-9 atomic check+charge
RED: test_empty_limits_array_charges_but_never_enforces — EC-19
RED: test_zero_limit_block_mode_blocks_all_sends — EC-18 kill switch
GREEN: implementar registry + enforcement + facade + run-impl wire
REFACTOR: extract threshold-callback dispatch if duplicated
VERIFY: pnpm -F @usetheo/sdk exec vitest run tests/budget-facade.test.ts tests/integration/budget-enforcement.test.ts
```

#### Acceptance Criteria
- [ ] 25 RED tests GREEN (17 originais + 8 edge cases EC-7/EC-8/EC-9/EC-16/EC-18/EC-19/EC-20/EC-21)
- [ ] BudgetExceededError thrown ONLY in `block` mode and ONLY when limit would be exceeded
- [ ] `audit` mode never throws
- [ ] `warn` mode calls callbacks at 80/95/100 thresholds
- [ ] Stacked limits: ANY exceeded blocks
- [ ] Name grammar enforced + duplicate create throws (EC-7, EC-16)
- [ ] Callbacks try/catch isolated — caller bug não derruba agente (EC-8)
- [ ] Concurrent 100-burst em block mode respeita cap (EC-9 atomic mutex)
- [ ] Block mode sem gpt-tokenizer degrada para post-call enforce com stderr warn (EC-21)
- [ ] Empty limits + zero limit casos documentados + tested (EC-18/EC-19)
- [ ] Budget.delete during in-flight charge é silent no-op (EC-20)
- [ ] CloudAgent rejects with UnsupportedBudgetOperationError (D388)
- [ ] Pass: complexity ≤ 10 per function / size ≤ 300 LoC budget.ts

#### DoD
- [ ] 25 tests passing
- [ ] `import { Budget } from "@usetheo/sdk"` exposed via barrel
- [ ] Backward compat: full 1700+ tests verde

---

## Phase 6: CLI inspector + docs + dogfood

**Objective:** `theokit budget` CLI subcommand (optional, opt-in) + concept page + cookbook recipe + real-LLM dogfood.

### T6.1 — CLI verb

#### Objective
`theokit budget list / inspect <name>` lê snapshot do registry e mostra.

**NOTE:** CLI cross-process aqui é **less critical** que Tasks porque budget é in-process. CLI seria mais útil pra visualizar histórico — defer JsonFile persistence for v0.2 (D385).

#### Files to edit
```
packages/cli/src/commands/budget.ts (NEW)
packages/cli/src/main.ts (MODIFY) — register subcommand
packages/cli/tests/commands/budget.test.ts (NEW)
packages/cli/CHANGELOG.md (MODIFY)
```

**Scope cut v1:** CLI apenas para in-process introspection (precisa do mesmo processo do bot rodando); cross-process via JsonFile diferido pra v0.2 (mesma régua de Tasks → SQLite v0.2).

#### Tasks
1. Adicionar `budget` subcommand com `list`/`inspect`/`snapshot`.
2. Tests cobrindo no-active-budget + 1 active.

#### TDD
```
RED: test_cli_budget_list_no_active_budgets_prints_empty
RED: test_cli_budget_inspect_unknown_exits_4
RED: test_cli_budget_snapshot_json_format
GREEN: implement
VERIFY: pnpm -F @usetheo/cli exec vitest run tests/commands/budget.test.ts
```

#### Acceptance Criteria
- [ ] 3 RED tests GREEN
- [ ] `theokit budget --help` lista subcomandos
- [ ] Exit codes consistent com `theokit tasks`

#### DoD
- [ ] 3 tests passing

### T6.2 — Concept page + cookbook

#### Files to edit
```
theo-opendocs/content/theokit-sdk/concepts/budget.mdx (NEW)
examples/budget/package.json (NEW)
examples/budget/run.ts (NEW)
examples/budget/README.md (NEW)
packages/sdk/CHANGELOG.md (MODIFY)
CHANGELOG.md (MODIFY)
```

#### Tasks
1. Concept page cobrindo lifecycle + 3 modes + stacked windows + CloudAgent rejection + sections para:
   - EC-18: "Emergency stop via `limits: [{ window: '1d', limitUsd: 0 }]` + mode `block`"
   - EC-19: "Informational tracking via `limits: []` (callbacks never fire)"
   - EC-20: "Budget.delete during in-flight: charges become silent no-op"
   - EC-21: "Para `mode: 'block'` rigoroso pre-call, instale `gpt-tokenizer@^3.4.0` como peer"
   - EC-22: "Pricing snapshot staleness — `pricingVersion` field exposes; OpenRouter routes consulted lazy"
2. Cookbook recipe runável offline (deterministic computeCost demo).
3. Update changelogs.

#### Acceptance Criteria
- [ ] Concept page ≥ 400 palavras com code samples
- [ ] Concept page documenta 5 edge cases (EC-18 zero-limit, EC-19 empty-limits, EC-20 delete-race, EC-21 gpt-tokenizer optional, EC-22 staleness)
- [ ] Cookbook runável standalone via `node examples/budget/run.ts`
- [ ] Changelog entries presentes

#### DoD
- [ ] `pnpm --filter @theo/opendocs run types:check` verde

### T6.3 — Real-LLM dogfood

#### Objective
`tools/validate-budget-real-llm.mjs` mirror do ACP/Tasks dogfood — usa Ollama qwen2.5:3b.

#### Files to edit
```
tools/validate-budget-real-llm.mjs (NEW)
knip.json (MODIFY) — add to ignore
.claude/knowledge-base/reviews/budget-dogfood-{YYYY-MM-DD}.md (NEW)
```

#### Deep Dives

3 scenarios mirror tasks:
1. **`agent.send` returns populated `result.usage`** with 5 buckets (Anthropic shape se rota) OR 2 buckets (Ollama shape).
2. **`computeCost` returns status="unknown"** for Ollama (snapshot doesn't have qwen pricing).
3. **`Budget.create({ mode: 'audit' })` + send 3 calls** → `Budget.snapshot()` reflete cumulative spent (even if `unknown` — count tokens).

#### Tasks
1. Criar dogfood script.
2. Rodar contra Ollama + capturar output.
3. Gerar report markdown.

#### Acceptance Criteria
- [ ] `tools/validate-budget-real-llm.mjs` exits 0 with PASS
- [ ] Real LLM observed em ≥ 1 send
- [ ] Report committed

#### DoD
- [ ] Dogfood PASS report committed

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `RunResult.usage` populated end-to-end | T4.1, T4.2 | LLM clients parse 5 buckets; UsageAccumulator agrega; run-impl popula |
| 2 | `RunResult.cost` populated com status correto | T2.1, T2.2, T4.2 | Pricing snapshot + computeCost + wire em run-impl |
| 3 | 5 token buckets (D376) | T1.1 (types), T3.1 (normalize), T4.1 (LLM clients) | Convergent shape across 3 frameworks |
| 4 | 3-mode budget enforcement | T5.2 | audit/warn/block branches |
| 5 | UTC-aligned windows | T5.1 | calendar-window helpers |
| 6 | In-process ledger concurrent-safe | T5.1 | withCwdMutex pattern |
| 7 | BudgetExceededError pre-call | T5.2 | preflightCheck throws before LLM |
| 8 | Stacked limits | T5.2 | ANY-fail loop |
| 9 | Pricing snapshot LiteLLM (D379) | T2.1 | JSON bundled + refresh script |
| 10 | normalize 3 API shapes (D387 cline regression) | T3.1 | normalize-usage function |
| 11 | Anthropic prompt-caching tokens | T3.1, T4.1 | parses cache_read + cache_creation |
| 12 | OpenAI reasoning tokens | T3.1, T4.1 | completion_tokens_details parsing |
| 13 | Streaming finish_reason gate | T4.1 | DeepSeek regression |
| 14 | gpt-tokenizer optional peer | T5.2 | preflightCheck lazy require |
| 15 | Claude no local count | T1.1 (errors), T5.2 (preflight skip) | docs + skip preflight |
| 16 | CloudAgent rejection (D388) | T5.2 | UnsupportedBudgetOperationError |
| 17 | CLI introspection | T6.1 | `theokit budget` verb |
| 18 | Concept page + cookbook | T6.2 | theo-opendocs + examples/budget |
| 19 | Real-LLM dogfood | T6.3 | validate-budget-real-llm.mjs |
| 20 | 14 ADRs commit | T0.1 | D375-D388 |
| 21 | BudgetExceededError mode field (EC-1) | T1.1 | added to constructor + readonly |
| 22 | Model alias normalization (EC-2) | T2.1 | date-suffix + dot-dash + openrouter prefix |
| 23 | Provider-aware include_usage (EC-3) | T4.1 | gated on apiMode |
| 24 | User opt-out merge (EC-4) | T4.1 | `?? true` merge |
| 25 | Usage on partial error (EC-5) | T4.2 | populated when ≥1 LLM call completed |
| 26 | Ledger GC under same mutex (EC-6) | T5.1 | withCwdMutex envelopes GC + charge |
| 27 | Budget name grammar (EC-7) | T5.2 | regex validation + ConfigurationError |
| 28 | Callback isolation (EC-8) | T5.2 | try/catch + stderr log |
| 29 | Atomic preflight+charge (EC-9) | T5.2 | per-budget mutex |
| 30 | TokenUsage total consistency (EC-10) | T1.1 | SHOULD TEST |
| 31 | OpenRouter prefix variants (EC-11) | T2.1 | 3 sub-tests free/google/anthropic |
| 32 | Money precision (EC-12/13/14) | T2.2 | 3 SHOULD TESTs |
| 33 | Calendar boundary timing (EC-15) | T5.1 | charge() timestamp attribution |
| 34 | Duplicate create throws (EC-16) | T5.2 | ConfigurationError (vs Task semantics) |
| 35 | EC-17/EC-18/EC-19/EC-20/EC-21/EC-22 documentation | T2.1/T5.2/T6.2 | concept page + JSDoc notes |

**Coverage: 35/35 (100%) — 20 originais + 15 absorvidos via EC-1..EC-22**

## Global Definition of Done

- [ ] All 7 phases (0-6) completed
- [ ] 14 ADRs (D375-D388) commited
- [ ] All RED tests (~100 across phases — 75 originais + ~25 absorvidos via EC-1..EC-22) now GREEN
- [ ] All 22 edge cases (EC-1..EC-22) absorvidos OR documentados no plano
- [ ] Zero biome/publint/attw warnings em `@usetheo/sdk` + `@usetheo/cli`
- [ ] Zero regressions: `pnpm validate` exit 0
- [ ] `RunResult.usage` + `RunResult.cost` opcionais (backward compat absoluto preservado)
- [ ] `Budget` namespace exposto via `@usetheo/sdk` barrel
- [ ] `BudgetExceededError` + `UnsupportedBudgetOperationError` exposto
- [ ] Pricing snapshot ≤ 100 KB gzipped, `pricingVersion` field present
- [ ] `gpt-tokenizer` é optional peer dep (caller sem ele recebe `Budget.preflightCheck()` graceful undefined)
- [ ] CHANGELOG entries: workspace + packages/sdk + packages/cli
- [ ] Concept page + cookbook recipe em `theo-opendocs`
- [ ] **Dogfood QA PASS** — `tools/validate-budget-real-llm.mjs` retorna PASS contra Ollama (mirror ACP/Tasks)
- [ ] **Runtime-metric proof** — `result.usage.totalTokens > 0` observado em workload real (Ollama) E ledger reflete spend após N sends

## Final Phase: Dogfood QA (MANDATORY)

> Real-LLM dogfood via Ollama (qwen2.5:3b) é o gate canônico — mesmo padrão que fechou ACP e Tasks.

### Execution

```bash
node tools/validate-budget-real-llm.mjs
```

Adicional: rodar `tools/validate-tasks-real-llm.mjs` para confirmar zero regressão.

### Acceptance Criteria

- [ ] Budget dogfood retorna PASS (3 scenarios green)
- [ ] Tasks dogfood ainda PASS (zero regressão)
- [ ] `pnpm validate` exit 0
- [ ] Zero CRITICAL/HIGH issues introduzidos

### If Dogfood Fails

1. Identify which issues are caused by this plan vs pre-existing.
2. Fix all plan-caused CRITICAL and HIGH before declaring done.
3. Re-run dogfood + validate.
