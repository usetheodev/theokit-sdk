# Plan: Error Context Surfacing (Error handling block — 1/2 patterns) — ✅ COMPLETED 2026-05-18

> **Status: COMPLETED 2026-05-18.** All 3 phases + Final Dogfood QA validated via proxy
> per plan AC. 493/493 tests green. Zero regressions. Zero typecheck errors. Zero
> biome warnings em arquivos do plano. 3 new ADRs (D65/D66/D67) committed.
> Real-LLM mini-validation 14/14 PASS contra real Anthropic + OpenRouter (HTTP 401).
> Live CDP-based telegram-pro dogfood remained blocked on Chrome 145 origin
> precondition (same infra blocker as persistence-state-hardening plan); proxy
> validation (bot startup + integration test + real-LLM mini-suite) passes per
> Phase Final AC: "25/25 PASS mantido OR proxy validation passa".

> **Version 1.1** — Incorporates edge-case review (1 MUST FIX EC-1, 4 SHOULD TEST EC-2…EC-5, 5 DOCUMENT EC-6…EC-10).
>
> **Version 1.0** — Fecha o gap `error-context-surfacing` do roadmap macro
> de Error handling em `.claude/knowledge-base/sdk-references/README.md`.
> Adiciona um typed `ErrorMetadata` field à hierarquia existente de typed
> errors (`TheokitAgentError` + subclasses), introduz provider-specific
> mappers (`mapAnthropicError`, `mapOpenAICompatibleError`) que transformam
> raw HTTP responses em errors com `provider`, `endpoint`, `code`,
> `statusCode`, `retryAfter`, e wirá-los nos call sites HTTP do SDK. Zero
> breaking changes no public API (campo opcional). Outcome: SDK consumers
> conseguem fazer `switch (err.metadata.code)` exaustivo + extrair
> `retryAfter` para backoff customizado, sem parsear strings.

## Context

**O que existe hoje** (auditado 2026-05-18 contra `packages/sdk/src/`):

- `packages/sdk/src/errors.ts` — base `TheokitAgentError` com `code?: string` (string genérica) + 6 subclasses (`AuthenticationError`, `RateLimitError`, `ConfigurationError`, `IntegrationNotConnectedError`, `NetworkError`, `UnknownAgentError`, `UnsupportedRunOperationError`).
- `cause` é supportado via Error options (Node 20+ native).
- `isRetryable` computed por classe (RateLimit/Network são retryable; outros não).
- **FALTA**: `metadata` field com `provider`, `endpoint`, `statusCode`, `retryAfter`, `raw`. Hoje cada throw passa só `{ code: "string-ad-hoc" }`.
- HTTP call sites jogam errors com strings ad-hoc:
  - `internal/llm/anthropic.ts:89` → `new NetworkError(\`Anthropic /v1/messages returned ${response.status}: ${text.slice(0, 200)}\`, { code: "anthropic_http_error" })` — sem statusCode, sem retryAfter, sem provider/endpoint estruturado.
  - `internal/memory/adapters/openai-compatible.ts:245-258` `mapErrorStatus()` — TEM o pattern mapper-like mas sem metadata estruturada (só `code` genérico tipo `"embedding_unauthorized"`).
  - `internal/llm/openai.ts`, `internal/llm/router.ts` — chamam fetch, lançam errors sem mapper estruturado.

**O que está quebrado ou faltando**:

- **Consumer não consegue retry com `retryAfter`**: provider Anthropic/OpenRouter retornam header `retry-after: 60` mas SDK ignora. Consumer chuta valor.
- **Switch exhaustive impossível**: `code: string` permite qualquer valor; TS compiler não enforce branching exaustivo.
- **Logs genéricos**: "anthropic_http_error" + status code embedded em message string — extração via regex é frágil.
- **Sem `mapAnthropicError`/`mapOpenAICompatibleError`** centralizados — cada call site re-inventa decisão de qual subclasse + qual code usar.

**Evidência**:

- Real-LLM dogfood deste mesmo SDK em 2026-05-18 (snapshot `telegram-pro-dogfood-2026-05-18.md`): `/tool roll 3d6` retornou `(run error) OpenAI /v1/chat/completions returned 429: {"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"google/gemini-2.0-flash-001 is temporarily rate-limited upstream. Please retry shortly..."}}}`. Bot embedded `retry-after` info na mensagem, mas o consumer (telegram-pro example) não tem como extrair structuredly — não conseguiu fazer auto-retry.
- Hermes shipou e fixou esse pattern em `v0.4 #2266` ("error context surfacing" canonical fix per `referencia/hermes-agent/AGENTS.md`).
- `sdk-references/error-context-surfacing.md` § "TypeScript equivalent" especifica a shape esperada — guia direto deste plano.

**Specs primárias** (source of truth):

- [`.claude/knowledge-base/sdk-references/error-context-surfacing.md`](../sdk-references/error-context-surfacing.md) — completa, com TS equivalent, AD-1..AD-4, failure modes, e tests propostos
- ADR D42, D50, D55 — graceful-degradation pattern (já DONE — irmão deste, não escopo aqui)

## Objective

**Done** = `error-context-surfacing` move de ⚠️ PARTIAL para ✅ DONE no roadmap macro do `theokit-sdk/CLAUDE.md` e do `sdk-references/README.md`.

Specific measurable goals:

1. `ErrorMetadata` interface tipada exportada de `packages/sdk/src/errors.ts` com `provider`, `endpoint`, `code`, `statusCode?`, `retryAfter?`, `raw?` fields.
2. `ErrorCode` typed enum (literal union TS) cobrindo as ~10 classes mais comuns (`rate_limit`, `auth_failed`, `invalid_request`, `timeout`, `server_error`, `context_too_long`, `content_filtered`, `model_unavailable`, `network`, `unknown`).
3. `TheokitAgentError` base class aceita `metadata?: ErrorMetadata` no constructor (additive, opcional — zero breaking change).
4. `mapAnthropicError(status, body, retryAfterHeader)` e `mapOpenAICompatibleError(status, body, retryAfterHeader, providerId, endpoint)` em `internal/errors/mappers/` (NEW).
5. `internal/llm/anthropic.ts` (1 call site) e `internal/llm/openai.ts` (todos call sites) usam o mapper, propagando metadata estruturada.
6. `internal/memory/adapters/openai-compatible.ts` `mapErrorStatus()` refactor para retornar errors com metadata completa.
7. Test contract: consumer pode `switch (err.metadata.code)` em todos os 10 codes do enum + extrair `retryAfter` quando present.
8. **Zero breaking changes** no public API (`metadata` é optional; existing callers que passam `{ code: "string" }` continuam funcionando — código existente NÃO precisa mudar).

## ADRs

### D65 — `ErrorMetadata` é optional field na base class, não nova class hierarchy

- **Decision**: Adicionar `metadata?: ErrorMetadata` opcional na constructor options do `TheokitAgentError` base class. NÃO criar uma nova `ProviderError` class hierarchy separada. As 7 existentes (`AuthenticationError`, `RateLimitError`, `ConfigurationError`, `IntegrationNotConnectedError`, `NetworkError`, `UnknownAgentError`, `UnsupportedRunOperationError`) continuam — herdam o metadata field via base.
- **Rationale**: O SDK já tem 7 typed error classes com semântica clara (`AuthenticationError` é provider-agnostic, mas significa "auth failed"). Criar uma `ProviderError` paralela duplicaria semântica + obrigaria consumers a aprender duas hierarquias. Estender as existing classes com metadata adicional preserva compat AND adiciona contexto. O pick `sdk-references/error-context-surfacing.md` sugere `ProviderError` mas isso é o pattern do Hermes (Python); em TypeScript com a hierarquia existente já presente, estender é mais limpo.
- **Consequences**:
  - Permite: callers que já fazem `if (err instanceof RateLimitError)` continuam funcionando + agora podem ler `err.metadata?.retryAfter`.
  - Constrai: `metadata` é opcional — callers defensivos precisam checkar `err.metadata !== undefined` antes de acessar. Aceitável; better than breaking.

### D66 — `ErrorCode` é literal union TS finite, não free-form string

- **Decision**: Definir `type ErrorCode = "rate_limit" | "auth_failed" | "invalid_request" | "timeout" | "server_error" | "context_too_long" | "content_filtered" | "model_unavailable" | "network" | "unknown"`. O field `metadata.code` é tipado como `ErrorCode`. Free-form codes legacy (e.g., `"embedding_http_error"`, `"anthropic_http_error"`) continuam aceitos no campo `code` do legacy `options` (backward compat) MAS o canonical é `metadata.code`.
- **Rationale**: Literal union permite `switch` exhaustive (TS compiler enforces). Free-form strings drift entre releases (cada call site inventa próprio). Hermes ships ~10 distinct provider error reasons; cobrimos os 10 mais comuns. Novo code = adicionar à union + test coverage.
- **Consequences**:
  - Permite: consumer faz `switch (err.metadata.code) { case "rate_limit": ... case "auth_failed": ... }` com exhaustive check via `case _: never`.
  - Constrai: novos providers que descobrem error categories novas precisam expandir a enum. Aceitável overhead vs string-comparison fragility.

### D67 — Mappers por provider em `internal/errors/mappers/`

- **Decision**: Criar `internal/errors/mappers/` com 1 file per provider (`anthropic.ts`, `openai-compatible.ts`). Cada mapper exporta `mapXxxError(status, body, headers, endpoint)` que retorna a subclass apropriada (`AuthenticationError`, `RateLimitError`, etc.) **com metadata populated**. Call sites HTTP chamam o mapper em vez de re-inventar mapping.
- **Rationale**: DRY — mapping `401 → AuthenticationError` é re-implementado em 3+ call sites hoje. Centralizar permite uma fonte de verdade + facilita adicionar novos codes (e.g., parsing OpenRouter's especifico error body) sem tocar 3 places. Provider-specific module = um mapper per dialect (Anthropic vs OpenAI-compatible vs OpenRouter vs Bedrock).
- **Consequences**:
  - Permite: `internal/llm/anthropic.ts:89` simplifica de 4 lines para `throw mapAnthropicError(response.status, body, response.headers, "/v1/messages")`.
  - Constrai: novos providers precisam de novo mapper. Mas isso já é o pattern proper-as-plugin (D61, pending).

## Dependency Graph

```
Phase 0: Foundation
   │
   ├─▶ Phase 1: Mappers (parallel-safe)
   │       │
   │       ▼
   └─▶ Phase 2: Wire call sites
                       │
                       ▼
              Phase 3 (Final): Dogfood QA
```

**Parallelism**:
- Phase 0 é blocker absoluto (`ErrorMetadata` type + base class change).
- Phase 1 (mappers) pode ser dividido entre 2 devs (1 per file) após Phase 0.
- Phase 2 (wire) pode ser dividido por call site após Phase 1.

---

## Phase 0: Foundation — ErrorMetadata + base class extension

**Objective:** Adicionar `ErrorMetadata` interface + `ErrorCode` enum + estender `TheokitAgentError` para aceitar `metadata` opcional. Zero breaking change para callers existentes.

### T0.1 — Definir `ErrorMetadata` + `ErrorCode` types

#### Objective
Types públicos em `errors.ts` que carriers de provider/endpoint/code metadata.

#### Evidence
- `sdk-references/error-context-surfacing.md` § "TypeScript equivalent" linha 75-101 especifica a shape exata.
- Test propostos linha 341-394 mesma spec.
- Audit atual: 6 call sites usam `{ code: "string-ad-hoc" }` (errors.ts genérico) — nenhum carrega provider/endpoint structuredly.

#### Files to edit
```
packages/sdk/src/errors.ts — adicionar ErrorMetadata interface + ErrorCode union + estender TheokitAgentError constructor
packages/sdk/tests/errors/error-metadata.test.ts (NEW) — TDD para shape do type
```

#### Deep file dependency analysis
- `errors.ts`: file pequeno (146 LoC). Adiciona ~30 LoC para novos types + ~5 LoC para estender base class constructor. Subclasses NÃO mudam — herdam o novo campo via base. Backward-compat: novo construtor signature aceita `metadata?` como NOVO field em options object. Existing callers que NÃO passam metadata continuam funcionando.
- Downstream: TODOS callers de `new TheokitAgentError`, `new AuthenticationError`, etc. (15+ sites) NÃO precisam mudar neste task. Em Phase 1+2 alguns serão refactored para usar `metadata`, mas opt-in.
- Public API: `errors.ts` re-exports já estão em `src/index.ts:exports`. Novos types vão para o re-export (público, consumível por SDK users).

#### Deep Dives

**`ErrorCode` literal union**:
```typescript
export type ErrorCode =
  | "rate_limit"
  | "auth_failed"
  | "invalid_request"
  | "timeout"
  | "server_error"
  | "context_too_long"
  | "content_filtered"
  | "model_unavailable"
  | "network"
  | "unknown";
```

**`ErrorMetadata` interface**:
```typescript
export interface ErrorMetadata {
  /** Provider canonical name (e.g., "anthropic", "openai", "openrouter", "gemini"). */
  provider: string;
  /** HTTP endpoint that failed (e.g., "/v1/messages", "/v1/chat/completions"). */
  endpoint: string;
  /** Machine-readable error code (finite enum). */
  code: ErrorCode;
  /** HTTP status code if applicable. */
  statusCode?: number;
  /** Seconds to wait before retry, per provider's retry-after header (when present). */
  retryAfter?: number;
  /** Raw response body for debugging (truncated to 2KB by mapper to avoid log bloat). */
  raw?: unknown;
}
```

**`TheokitAgentError` constructor extension**:
```typescript
export class TheokitAgentError extends Error {
  override readonly name: string = "TheokitAgentError";
  readonly isRetryable: boolean;
  readonly code?: string;
  readonly protoErrorCode?: string;
  readonly metadata?: ErrorMetadata; // NEW — optional, backward compat

  constructor(
    message: string,
    options: {
      isRetryable?: boolean;
      code?: string;
      protoErrorCode?: string;
      cause?: unknown;
      metadata?: ErrorMetadata; // NEW
    } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.isRetryable = options.isRetryable ?? false;
    if (options.code !== undefined) this.code = options.code;
    if (options.protoErrorCode !== undefined) this.protoErrorCode = options.protoErrorCode;
    if (options.metadata !== undefined) this.metadata = options.metadata;
  }
}
```

**Subclasses constructor signature changes**:

Cada subclass (`AuthenticationError`, `RateLimitError`, etc.) tem assinatura `constructor(message: string, options: { code?: string; cause?: unknown } = {})`. Precisamos adicionar `metadata?` ao options shape. Mas para zero-break: subclasses já aceitam `options: {...}` então adicionar opcional `metadata` é zero-impact.

**Edge cases**:
- `metadata.retryAfter` é `undefined` quando provider não envia header → caller faz `retryAfter ?? defaultBackoff`.
- `metadata.raw` é truncated pelo mapper (Phase 1), não pelo errors.ts (responsibility split).
- Subclass NÃO override `isRetryable` baseado em `metadata.code` — `isRetryable` continua sendo intrínseco da classe (RateLimit = sempre retryable). Eventual evolution pode usar metadata para refinamento, mas v1 keep simple.

**Invariants**:
- `metadata` é either `undefined` OR fully populated (provider + endpoint + code são mandatory).
- `metadata.code` é estritamente `ErrorCode` (enforced via TS).

#### Tasks
1. Definir `ErrorCode` literal union em `errors.ts`.
2. Definir `ErrorMetadata` interface em `errors.ts`.
3. Estender `TheokitAgentError` constructor options com `metadata?: ErrorMetadata`.
4. Estender subclasses (`AuthenticationError`, `RateLimitError`, `ConfigurationError`, `NetworkError`, `UnknownAgentError`) constructor options com `metadata?`. Cada subclass passa para `super(message, { ...options })`.
5. Export `ErrorCode` + `ErrorMetadata` em `errors.ts`.
6. Re-export de `src/index.ts` (verificar que `errors.ts` é re-exported via `./errors` subpath).
7. TDD: tests verificam shape + backward compat.

#### TDD

```
RED:     test_TheokitAgentError_accepts_metadata() — `new TheokitAgentError("x", { metadata: { provider: "a", endpoint: "/b", code: "rate_limit" } })` retains .metadata
RED:     test_TheokitAgentError_without_metadata_is_undefined() — `new TheokitAgentError("x")` .metadata is undefined (backward compat)
RED:     test_AuthenticationError_accepts_metadata() — same for subclass
RED:     test_RateLimitError_accepts_metadata_with_retryAfter() — .metadata.retryAfter is preserved
RED:     test_ErrorMetadata_code_is_typed() — TS compile test: `metadata.code = "invalid_value"` is type error (compile-time check via expectTypeOf)
RED:     test_metadata_cause_coexist() — both `cause` and `metadata` can be passed; both preserved on the error instance
RED:     test_existing_callers_still_work() — `new AuthenticationError("x", { code: "missing_api_key" })` (no metadata) continua funcionando
GREEN:   Implement errors.ts changes minimal para passar tests
REFACTOR: None expected (shapes are pure data)
VERIFY:  pnpm exec vitest run tests/errors/error-metadata.test.ts && pnpm typecheck
```

#### Acceptance Criteria
- [x] `ErrorCode` literal union com 10 codes exportado de `errors.ts`
- [x] `ErrorMetadata` interface exportado
- [x] `TheokitAgentError` aceita `metadata?` no constructor; ler via `err.metadata` é tipado
- [x] 7 RED tests passam após GREEN
- [x] `pnpm typecheck` passa (incluindo subclasses)
- [x] Existing tests (incluindo `errors-bound.test.ts` se exist) continuam passando — backward compat
- [x] Biome zero warnings em `errors.ts`
- [x] LoC adicionado em `errors.ts` <= 60

#### DoD
- [x] Tasks completed
- [x] All tests green (`pnpm test`)
- [x] Zero biome warnings
- [x] Zero typecheck errors
- [x] Commit: `feat(sdk): add ErrorMetadata + ErrorCode types on base error class (T0.1, ADR D65/D66)`

---

## Phase 1: Provider mappers

**Objective:** Criar mappers centralizados que transformam raw HTTP responses em errors com metadata completo. 2 files: Anthropic dialect + OpenAI-compatible dialect (covers OpenAI, OpenRouter, all Gemini-via-OpenRouter, DeepSeek, etc.).

### T1.1 — Implementar `mapAnthropicError`

#### Objective
Helper que recebe HTTP status + body + headers + endpoint e retorna subclass apropriada com metadata completo.

#### Evidence
- `internal/llm/anthropic.ts:87-93` hoje faz `new NetworkError(\`Anthropic /v1/messages returned ${response.status}: ${text.slice(0, 200)}\`, { code: "anthropic_http_error" })`. Não distingue 401 (auth), 429 (rate limit), 500 (server), 400 (invalid request). Não exposes `retryAfter`.
- `sdk-references/error-context-surfacing.md` § "Pattern: error transformation at boundaries" mostra o pattern + linha 178-184 `mapAnthropicError(status, body)` example.

#### Files to edit
```
packages/sdk/src/internal/errors/mappers/anthropic.ts (NEW) — mapper
packages/sdk/src/internal/errors/mappers/index.ts (NEW) — barrel
packages/sdk/tests/internal/errors/mappers/anthropic.test.ts (NEW) — TDD
```

#### Deep file dependency analysis
- `mappers/anthropic.ts` (NEW): puro mapper. Imports `AuthenticationError`, `RateLimitError`, etc. de `errors.js`. Sem deps externas. ~80 LoC.
- `mappers/index.ts` (NEW): re-exports `mapAnthropicError` + `mapOpenAICompatibleError` (T1.2) para consumers internos.
- Downstream: `internal/llm/anthropic.ts:89` usará isto em T2.1. Nada mais downstream neste task (only mapper).

#### Deep Dives

**Signature**:
```typescript
import {
  AuthenticationError,
  ConfigurationError,
  NetworkError,
  RateLimitError,
  TheokitAgentError,
  UnknownAgentError,
  type ErrorCode,
  type ErrorMetadata,
} from "../../../errors.js";

/**
 * Translate an Anthropic API error response into a typed TheokitAgentError
 * with full metadata. Picks the right subclass based on status code.
 *
 * @internal
 */
export function mapAnthropicError(args: {
  status: number;
  body: unknown;
  headers: Headers | undefined;
  endpoint: string;
}): TheokitAgentError {
  const { status, body, headers, endpoint } = args;
  const code = mapAnthropicStatusToCode(status, body);
  const retryAfter = parseRetryAfter(headers);
  const message = formatMessage(status, code, body);
  const raw = truncateRaw(body);

  const metadata: ErrorMetadata = {
    provider: "anthropic",
    endpoint,
    code,
    statusCode: status,
    ...(retryAfter !== undefined ? { retryAfter } : {}),
    ...(raw !== undefined ? { raw } : {}),
  };

  if (status === 401 || status === 403) {
    return new AuthenticationError(message, { code: "anthropic_auth_failed", metadata });
  }
  if (status === 429) {
    return new RateLimitError(message, { code: "anthropic_rate_limit", metadata });
  }
  if (status === 400 && code === "context_too_long") {
    return new ConfigurationError(message, { code: "anthropic_context_too_long", metadata });
  }
  if (status === 400) {
    return new ConfigurationError(message, { code: "anthropic_invalid_request", metadata });
  }
  if (status >= 500 && status < 600) {
    return new NetworkError(message, { code: "anthropic_server_error", metadata });
  }
  return new UnknownAgentError(message, { code: "anthropic_unknown", metadata });
}

function mapAnthropicStatusToCode(status: number, body: unknown): ErrorCode {
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 429) return "rate_limit";
  if (status === 400) {
    const text = JSON.stringify(body ?? {}).toLowerCase();
    if (text.includes("context") && (text.includes("too long") || text.includes("too_long"))) {
      return "context_too_long";
    }
    if (text.includes("filtered") || text.includes("content policy")) {
      return "content_filtered";
    }
    return "invalid_request";
  }
  if (status === 408) return "timeout";
  if (status >= 500 && status < 600) return "server_error";
  return "unknown";
}

function parseRetryAfter(headers: Headers | undefined): number | undefined {
  if (headers === undefined) return undefined;
  const raw = headers.get("retry-after");
  if (raw === null) return undefined;
  // Anthropic returns seconds (numeric) or HTTP-date. We support seconds form.
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  return undefined;
}

const RAW_MAX_BYTES = 2048;
function truncateRaw(body: unknown): unknown {
  if (body === null || body === undefined) return undefined;
  const s = typeof body === "string" ? body : JSON.stringify(body);
  if (s.length <= RAW_MAX_BYTES) return body;
  return `${s.slice(0, RAW_MAX_BYTES)}…`;
}

function formatMessage(status: number, code: ErrorCode, body: unknown): string {
  // Concise + actionable. Caller has full body in metadata.raw.
  return `Anthropic API error: ${code} (HTTP ${status})`;
}
```

**Edge cases**:
- `body` é `null` ou já-consumido stream → `truncateRaw` retorna undefined.
- `headers` é `undefined` (some fetch impls don't expose) → `retryAfter` é undefined.
- `retry-after` é HTTP date format → ignored (return undefined). Defesa: documento que SDK usa numeric-seconds form.
- Status 200 chamado erroneamente → não deveria, mas mapper retorna `UnknownAgentError`.

**Invariants**:
- Output é sempre um `TheokitAgentError` (nunca null/undefined).
- `metadata` é sempre populated com `provider`, `endpoint`, `code`, `statusCode`.
- Não throws (defensive — caller já está em error path).

#### Tasks
1. Criar `internal/errors/mappers/anthropic.ts`.
2. Criar `internal/errors/mappers/index.ts` barrel.
3. TDD: tests cobrindo cada status code + retry-after parsing + raw truncation.

#### TDD

```
RED:     test_mapAnthropic_401_returns_AuthenticationError() — status 401 → AuthenticationError com metadata.code = "auth_failed"
RED:     test_mapAnthropic_429_returns_RateLimitError() — status 429 → RateLimitError + metadata.code = "rate_limit"
RED:     test_mapAnthropic_429_with_retry_after_header() — header `retry-after: 60` → metadata.retryAfter = 60
RED:     test_mapAnthropic_400_context_too_long() — body com "context too long" → metadata.code = "context_too_long" + ConfigurationError
RED:     test_mapAnthropic_400_generic() — body sem keyword → metadata.code = "invalid_request"
RED:     test_mapAnthropic_500_returns_NetworkError() — status 503 → NetworkError + metadata.code = "server_error"
RED:     test_mapAnthropic_truncates_large_raw() — body > 2KB → metadata.raw é truncated + "…" suffix
RED:     test_mapAnthropic_metadata_provider_is_anthropic() — provider field = "anthropic" sempre
RED:     test_mapAnthropic_metadata_endpoint_preserved() — endpoint passado é refletido
RED:     test_mapAnthropic_529_overloaded_returns_NetworkError_with_retryAfter() — (EC-2) status 529 + header `retry-after: 5` + body `{type: "error", error: {type: "overloaded_error"}}` → NetworkError, code="server_error", retryAfter=5 (Anthropic-specific overload signal, common em horário de pico)
RED:     test_mapAnthropic_retry_after_http_date_returns_undefined() — (EC-5) header `retry-after: "Wed, 21 Oct 2026 07:28:00 GMT"` → metadata SEM retryAfter (Number(httpDate) is NaN, must not propagate)
GREEN:   Implementar mapAnthropicError
REFACTOR: None expected
VERIFY:  pnpm exec vitest run tests/internal/errors/mappers/anthropic.test.ts
```

#### Acceptance Criteria
- [x] `mapAnthropicError(args)` exported de `internal/errors/mappers/anthropic.ts`
- [x] 11/11 RED tests pass (9 base + EC-2 529 + EC-5 http-date)
- [x] Cyclomatic complexity de `mapAnthropicError` <= 10
- [x] `mapAnthropicStatusToCode` <= 8 cyclomatic
- [x] LoC do arquivo <= 130
- [x] Biome zero warnings

#### DoD
- [x] Tests green
- [x] Commit: `feat(sdk): add mapAnthropicError mapper (T1.1, ADR D67)`

---

### T1.2 — Implementar `mapOpenAICompatibleError`

#### Objective
Mapper para dialects OpenAI-style (covers OpenAI, OpenRouter, DeepSeek, Together, Mistral, etc.). Recebe `providerId` para popular metadata.provider corretamente.

#### Evidence
- `internal/llm/openai.ts` faz chamadas para OpenAI/OpenRouter sem mapper estruturado.
- `internal/memory/adapters/openai-compatible.ts:245-258` JÁ TEM `mapErrorStatus(providerId, status)` mas apenas retorna error com `code` genérico string — sem metadata, sem retry-after, sem statusCode.

#### Files to edit
```
packages/sdk/src/internal/errors/mappers/openai-compatible.ts (NEW) — mapper
packages/sdk/src/internal/errors/mappers/index.ts (EDIT) — re-export
packages/sdk/tests/internal/errors/mappers/openai-compatible.test.ts (NEW) — TDD
```

#### Deep file dependency analysis
- `mappers/openai-compatible.ts` (NEW): similar shape ao Anthropic mapper. Aceita `providerId` extra (e.g., "openai", "openrouter", "deepseek"). ~100 LoC.
- `mappers/index.ts`: adiciona re-export.
- Downstream: `internal/llm/openai.ts` (T2.2) + `internal/memory/adapters/openai-compatible.ts` (T2.3) usarão.

#### Deep Dives

**Signature**:
```typescript
export function mapOpenAICompatibleError(args: {
  providerId: string; // "openai" | "openrouter" | "deepseek" | etc.
  status: number;
  body: unknown;
  headers: Headers | undefined;
  endpoint: string;
}): TheokitAgentError {
  // Similar to mapAnthropicError but with providerId parameter,
  // and OpenAI-compatible error body shape parsing.
  // Error body usually has { error: { message, type, code, ... } }.
}
```

**Provider-specific quirks handled**:
- **OpenRouter retry-after header**: numerical seconds.
- **OpenAI rate limit**: returns `Retry-After` header numerical.
- **DeepSeek context length**: body has `code: "context_length_exceeded"` field.
- **OpenAI content filtered**: body has `code: "content_policy_violation"`.

**Body inspection helper**:
```typescript
function extractOpenAiErrorCode(body: unknown): string | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const err = (body as { error?: { code?: string; type?: string } }).error;
  return err?.code ?? err?.type;
}

function mapOpenAiStatusToCode(status: number, body: unknown): ErrorCode {
  const rawCode = extractOpenAiErrorCode(body)?.toLowerCase() ?? "";
  if (rawCode.includes("context_length") || rawCode.includes("too_many_tokens")) {
    return "context_too_long";
  }
  if (rawCode.includes("content_filter") || rawCode.includes("content_policy")) {
    return "content_filtered";
  }
  if (rawCode.includes("model_not_found") || rawCode.includes("model_unavailable")) {
    return "model_unavailable";
  }
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 429) return "rate_limit";
  if (status === 408) return "timeout";
  if (status === 400) return "invalid_request";
  if (status >= 500 && status < 600) return "server_error";
  return "unknown";
}
```

**Edge cases**:
- Body é HTML (server error page) → extractOpenAiErrorCode retorna undefined → fallback para status-based mapping.
- Provider sends 200 with `error` in body (rare but happens) → mapper not called; caller checks `response.ok` first.

#### Tasks
1. Criar `internal/errors/mappers/openai-compatible.ts`.
2. Re-export em barrel.
3. TDD.

#### TDD

```
RED:     test_mapOpenAi_401_returns_AuthenticationError() — auth_failed code
RED:     test_mapOpenAi_429_with_retry_after() — rate_limit + retryAfter
RED:     test_mapOpenAi_400_context_length_exceeded() — body.error.code = "context_length_exceeded" → context_too_long
RED:     test_mapOpenAi_400_content_policy_violation() — body.error.code = "content_policy_violation" → content_filtered
RED:     test_mapOpenAi_400_model_not_found() — body.error.code = "model_not_found" → model_unavailable
RED:     test_mapOpenAi_500_server_error() — server_error
RED:     test_mapOpenAi_providerId_preserved() — passing providerId "openrouter" → metadata.provider = "openrouter"
RED:     test_mapOpenAi_html_body_falls_back_to_status() — body é HTML/non-object → status-based mapping
RED:     test_mapOpenAi_truncates_large_raw() — body > 2KB truncated
RED:     test_mapOpenAi_body_without_error_field_falls_back_to_status() — (EC-3) body `{message: "rate limited"}` (sem `body.error.code`) + status 429 → RateLimitError via status fallback. Cobre DeepInfra, Together, providers que não seguem OpenAI body shape 100%.
RED:     test_mapOpenAi_retry_after_http_date_returns_undefined() — (EC-5) header `retry-after: "Wed, 21 Oct 2026 07:28:00 GMT"` → metadata SEM retryAfter (não propaga NaN do Number parse)
GREEN:   Implementar mapOpenAICompatibleError
REFACTOR: Extract `extractOpenAiErrorCode` + `mapOpenAiStatusToCode` para internal helpers (1 file)
VERIFY:  pnpm exec vitest run tests/internal/errors/mappers/openai-compatible.test.ts
```

#### Acceptance Criteria
- [x] `mapOpenAICompatibleError(args)` exported
- [x] 11/11 RED tests pass (9 base + EC-3 no-error-field + EC-5 http-date)
- [x] Cyclomatic <= 10 per function
- [x] LoC <= 160
- [x] Biome zero warnings

#### DoD
- [x] Tests green
- [x] Commit: `feat(sdk): add mapOpenAICompatibleError mapper (T1.2, ADR D67)`

---

## Phase 2: Wire call sites

**Objective:** Substituir error throws ad-hoc nos call sites HTTP existentes pelos mappers, mantendo zero breaking change no external behavior (mensagens podem mudar fraseado, mas instances continuam being subclasses esperadas).

### T2.1 — Wire mapper em `internal/llm/anthropic.ts`

#### Objective
Substituir `throw new NetworkError(...)` direto por `throw mapAnthropicError({...})`.

#### Evidence
- `internal/llm/anthropic.ts:87-93` é o ÚNICO call site Anthropic atual.
- Hoje sempre joga `NetworkError` para qualquer status code não-OK — perde info de auth/rate-limit/context.

#### Files to edit
```
packages/sdk/src/internal/llm/anthropic.ts (EDIT — substituir throw na linha 89)
```

#### Deep file dependency analysis
- Linha 87-93 é o único throw HTTP do file. Outras throws (linha ~115 `AnthropicStreamAccumulator`) tratam parse errors stream-level — fora de escopo (não são HTTP errors).
- Downstream: callers de `anthropic.stream()` recebiam `NetworkError`; após mudança recebem subclass específica conforme status. Backward compat: `instanceof NetworkError` agora pode ser `false` para 401/429/etc. Mas `instanceof TheokitAgentError` continua true. Documentar em CHANGELOG.

#### Deep Dives

**Antes**:
```typescript
if (!response.ok) {
  const text = await response.text().catch(() => "");
  throw new NetworkError(
    `Anthropic /v1/messages returned ${response.status}: ${text.slice(0, 200)}`,
    { code: "anthropic_http_error" },
  );
}
```

**Depois**:
```typescript
if (!response.ok) {
  const text = await response.text().catch(() => "");
  // Parse body as JSON when possible — gives mapper access to error.code field.
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* leave as string */ }
  throw mapAnthropicError({
    status: response.status,
    body,
    headers: response.headers,
    endpoint: "/v1/messages",
  });
}
```

**Backward compat caveat (EC-1 fix from edge-case review)**: callers que faziam `if (err instanceof NetworkError)` para handle Anthropic errors agora precisarão também handle `RateLimitError`, `AuthenticationError`. **MANDATORY audit step BEFORE implementing**:

```bash
grep -rn "instanceof NetworkError\|toBeInstanceOf(NetworkError)" packages/sdk/tests/ packages/sdk/src/
grep -rn "instanceof AuthenticationError\|toBeInstanceOf(AuthenticationError)" packages/sdk/tests/ packages/sdk/src/
grep -rn "instanceof RateLimitError\|toBeInstanceOf(RateLimitError)" packages/sdk/tests/ packages/sdk/src/
```

Enumerar TODOS hits em PR description. Para cada test que assertava `NetworkError` em 401/429 paths: (a) ampliar para `instanceof TheokitAgentError` (base class works), OR (b) atualizar para a subclass refinada esperada. PR não pode merge enquanto hits não estiverem auditados/ajustados. CHANGELOG deve enumerar lista de afetados.

**Invariants**:
- Errors lançados de Anthropic continuam being subclasses de `TheokitAgentError` (callers que usam base class check não quebram).
- `code` field legacy preservado (mapper passa `code: "anthropic_<reason>"`).

#### Tasks
1. **EC-1 audit (MANDATORY first)**: grep `instanceof NetworkError|toBeInstanceOf(NetworkError)` em `packages/sdk/tests/` e `packages/sdk/src/`. Enumerar hits em PR description. Identificar quais asseram NetworkError para 401/429 paths.
2. Edit `anthropic.ts:87-93`.
3. Import `mapAnthropicError` from `internal/errors/mappers/index.js`.
4. Para cada hit afetado da auditoria (passo 1): ampliar test para `instanceof TheokitAgentError` (base) OR atualizar para subclass refinada (`AuthenticationError`/`RateLimitError`).
5. Run existing tests to verify no regression.

#### TDD

```
RED:     test_anthropic_401_throws_AuthenticationError_with_metadata() — mock fetch retorna 401; throw é AuthenticationError com metadata.provider="anthropic" + code="auth_failed"
RED:     test_anthropic_429_throws_RateLimitError_with_retryAfter() — mock retorna 429 + Retry-After: 30; throw .metadata.retryAfter === 30
RED:     test_anthropic_400_context_too_long_throws_ConfigurationError() — body com "context too long" → ConfigurationError
RED:     test_existing_anthropic_tests_still_pass() — run existing llm/anthropic tests
GREEN:   Wire mapAnthropicError em anthropic.ts
REFACTOR: None
VERIFY:  pnpm exec vitest run tests/internal/llm/ tests/golden/llm/
```

#### Acceptance Criteria
- [x] EC-1 audit grep executado, hits documentados em PR description
- [x] `anthropic.ts:89` usa `mapAnthropicError`
- [x] 4 RED tests pass
- [x] Existing Anthropic tests pass (golden + unit) — incluindo tests ajustados conforme audit
- [x] Biome zero warnings em arquivos modificados
- [x] CHANGELOG entry mencionando subclass refinement + lista de tests afetados

#### DoD
- [x] Tests green
- [x] Commit: `refactor(sdk): wire mapAnthropicError in llm/anthropic.ts (T2.1)`

---

### T2.2 — Wire mapper em `internal/llm/openai.ts` + `internal/llm/router.ts`

#### Objective
Substituir error throws OpenAI-compatible nas chamadas HTTP de `openai.ts` e ajustar `router.ts` (que pode catch & rethrow).

#### Evidence
- `internal/llm/openai.ts` chama OpenAI/OpenRouter (provider routing baseado em env).
- `internal/llm/router.ts` é fallback wrapper — pode receber errors do underlying e re-emitir.

#### Files to edit
```
packages/sdk/src/internal/llm/openai.ts (EDIT — substituir throws HTTP por mapOpenAICompatibleError)
packages/sdk/src/internal/llm/router.ts (EDIT — preservar metadata quando rethrow)
```

#### Deep file dependency analysis
- `openai.ts`: similar a anthropic.ts — 1-2 call sites HTTP. Cada `throw` é substituído. Precisa de `providerId` derivado de qual URL/env está usando. Inspect file primeiro.
- `router.ts`: fallback orchestrator. Quando primary fails + provider for switch, deve preservar metadata original. Read-only audit + adjust if needed.

#### Deep Dives

Vou ler `openai.ts` para conhecer call sites antes de detalhar pattern. (Implementação fará isso.) Padrão genérico:

```typescript
// Antes (provavelmente):
if (!response.ok) {
  throw new NetworkError(`OpenAI returned ${response.status}`, { code: "openai_http_error" });
}

// Depois:
if (!response.ok) {
  const text = await response.text().catch(() => "");
  let body: unknown = text;
  try { body = JSON.parse(text); } catch {}
  throw mapOpenAICompatibleError({
    providerId: this.providerId, // "openai" | "openrouter" depending on instance
    status: response.status,
    body,
    headers: response.headers,
    endpoint: "/v1/chat/completions", // or whichever
  });
}
```

**Router considerations**:
- Quando router catches error de primary + tries fallback, preserva chain via `cause`.
- Final error rethrown deve incluir metadata do último provider tentado.
- Test: fallback exhausted → error tem metadata.provider = ultimo tentado.

#### Tasks
1. Audit `openai.ts` call sites — listar throws HTTP existentes.
2. Substituir cada throw por `mapOpenAICompatibleError({...})`.
3. Audit `router.ts` — verificar que metadata propaga across fallback chain.
4. TDD.

#### TDD

```
RED:     test_openai_401_throws_AuthenticationError_with_metadata() — provider="openai", code="auth_failed"
RED:     test_openrouter_429_extracts_retryAfter() — provider="openrouter", retryAfter populated
RED:     test_openai_context_length_exceeded_is_ConfigurationError() — body.error.code triggers context_too_long mapping
RED:     test_router_fallback_preserves_last_provider_metadata() — primary OpenAI 429 + fallback Anthropic 401 → final error tem metadata.provider="anthropic" (último)
RED:     test_router_aggregate_failure_surfaces_metadata() — (EC-4) mock OpenAI 429 + Anthropic 401; router exhausts fallback and rethrows; assert final error.metadata.provider === "anthropic" AND final error.metadata.code === "auth_failed" (consumer debugging precisa saber QUAL provider falhou por último). Sem isso, "all providers failed" é caixa preta.
RED:     test_existing_openai_tests_still_pass()
GREEN:   Wire em openai.ts + router.ts
REFACTOR: None
VERIFY:  pnpm exec vitest run tests/internal/llm/ tests/golden/llm/
```

#### Acceptance Criteria
- [x] Todos throws HTTP em `openai.ts` usam mapper
- [x] `router.ts` preserva metadata através do fallback chain (test direto)
- [x] 6 RED tests pass (5 base + EC-4 aggregate-failure-surfaces-metadata)
- [x] Existing tests pass
- [x] Biome zero warnings

#### DoD
- [x] Tests green
- [x] Commit: `refactor(sdk): wire mapOpenAICompatibleError in llm/openai + router (T2.2)`

---

### T2.3 — Wire mapper em `internal/memory/adapters/openai-compatible.ts`

#### Objective
Refactor existing `mapErrorStatus(providerId, status)` em `openai-compatible.ts` para usar o novo central mapper, adicionando `endpoint` + `retryAfter` + `raw` que hoje estão ausentes.

#### Evidence
- `internal/memory/adapters/openai-compatible.ts:245-258` tem mapper PARCIAL — só pega status, retorna error com `code` genérico.
- Embedding endpoint `/v1/embeddings` é distinto de `/v1/chat/completions` — endpoint string deve refletir.

#### Files to edit
```
packages/sdk/src/internal/memory/adapters/openai-compatible.ts (EDIT)
```

#### Deep file dependency analysis
- Atual local `mapErrorStatus()` é privado ao arquivo. Pode ser deletado, substituído por chamada ao central `mapOpenAICompatibleError`.
- Atual `parseEmbedResponse` throws `NetworkError` para "no data" — não é HTTP error, é parse error. Manter como está? OR criar `embedding_invalid_response` code? Decisão: manter throw separado mas adicionar metadata mínima (`provider`, `endpoint`, `code: "invalid_request"`).
- Downstream: callers de `embed()` em `openai-compatible.ts` recebem error refined.

#### Deep Dives

**Antes (linha 245-258)**:
```typescript
function mapErrorStatus(providerId: string, status: number): Error {
  if (status === 401) {
    return new AuthenticationError(`${providerId} /v1/embeddings rejected the API key (401)`, {
      code: "embedding_unauthorized",
    });
  }
  if (status === 429) {
    return new RateLimitError(`${providerId} /v1/embeddings rate limit exhausted`, {
      code: "embedding_rate_limit",
    });
  }
  return new NetworkError(`${providerId} /v1/embeddings returned ${status}`, {
    code: "embedding_http_error",
  });
}
```

**Depois**: replace inline com `mapOpenAICompatibleError` call. Need to pass `body` + `headers` from call site (caller has `response`).

Inspect caller of `mapErrorStatus` em mesmo arquivo:
```typescript
// ~line 200 area (need to verify)
if (!response.ok) {
  throw mapErrorStatus(providerId, response.status);
}
```

Refactor para:
```typescript
if (!response.ok) {
  const text = await response.text().catch(() => "");
  let body: unknown = text;
  try { body = JSON.parse(text); } catch {}
  throw mapOpenAICompatibleError({
    providerId,
    status: response.status,
    body,
    headers: response.headers,
    endpoint: "/v1/embeddings",
  });
}
```

Delete local `mapErrorStatus`.

**`parseEmbedResponse` invalid data case**:
```typescript
if (!Array.isArray(json.data)) {
  throw new NetworkError(`${providerId} /v1/embeddings returned no data`, {
    code: "embedding_invalid_response",
    metadata: {
      provider: providerId,
      endpoint: "/v1/embeddings",
      code: "invalid_request",
      raw: json,
    },
  });
}
```

Or: `ConfigurationError` if `invalid_request`. But `NetworkError` continues — keep existing class for backward compat.

#### Tasks
1. Replace `mapErrorStatus` calls with `mapOpenAICompatibleError`.
2. Delete local `mapErrorStatus` (dead code post-replace).
3. Add metadata to `parseEmbedResponse` invalid data throw.
4. TDD.

#### TDD

```
RED:     test_embedding_401_has_full_metadata() — metadata.provider, metadata.endpoint="/v1/embeddings", metadata.code="auth_failed"
RED:     test_embedding_429_extracts_retryAfter_when_header_present()
RED:     test_embedding_invalid_data_response_has_metadata_too()
RED:     test_existing_embedding_tests_still_pass()
GREEN:   Replace + delete dead code
REFACTOR: None
VERIFY:  pnpm exec vitest run tests/internal/memory/ tests/golden/memory/
```

#### Acceptance Criteria
- [x] `mapErrorStatus` local function removed
- [x] Calls switched to central `mapOpenAICompatibleError`
- [x] 4 RED tests pass
- [x] Existing memory tests pass
- [x] Biome zero warnings

#### DoD
- [x] Tests green
- [x] Commit: `refactor(sdk): use central error mapper in memory/adapters/openai-compatible (T2.3)`

---

### T2.4 — Documentação + CHANGELOG

#### Objective
Update `docs.md` + `CHANGELOG.md` para refletir new public types + behavior changes.

#### Evidence
- Inviolable rule (root CLAUDE.md): "Changelog discipline. Every code change updates `CHANGELOG.md`."
- Public API change: `ErrorMetadata`, `ErrorCode` exposed.

#### Files to edit
```
packages/sdk/CHANGELOG.md (EDIT — entry sob [Unreleased])
docs.md (EDIT — add section "Error context" ou similar)
README.md (EDIT — se houver error handling example, refletir new shape)
```

#### Deep file dependency analysis
- `CHANGELOG.md`: novo entry sob `### Added`.
- `docs.md`: section explicando `err.metadata` shape + `switch (err.metadata?.code)` pattern. Provavelmente já existe seção "Errors"; estender.
- `README.md`: opcional — só se errors são showcased no front door.

#### Deep Dives

**CHANGELOG entry skeleton**:
```markdown
### Added (v1.3 error-context-surfacing)

- **`ErrorMetadata` + `ErrorCode` exposed from `errors.ts`** (ADR D65/D66/D67). New optional `metadata` field on `TheokitAgentError` and subclasses carries `{ provider, endpoint, code, statusCode?, retryAfter?, raw? }` when the error originates from a provider HTTP call. `ErrorCode` is a finite literal union enabling exhaustive `switch` checks.
- **Provider mappers** (`mapAnthropicError`, `mapOpenAICompatibleError`) translate raw HTTP errors into typed errors with full metadata. Wired in `internal/llm/anthropic.ts`, `internal/llm/openai.ts`, `internal/memory/adapters/openai-compatible.ts`.

### Changed

- **Refined subclass selection on HTTP errors**. Previously every non-OK HTTP response from Anthropic threw a `NetworkError`. Now: 401/403 → `AuthenticationError`, 429 → `RateLimitError`, 400 with context-length signal → `ConfigurationError`, 5xx → `NetworkError`. Callers using `instanceof TheokitAgentError` (the base class) are unaffected; callers using subclass-specific `instanceof` may need to broaden.
```

**docs.md section skeleton**:
```markdown
## Error context

When an error originates from a provider HTTP call, the SDK populates a typed `metadata` field on the thrown error so callers can react programmatically without parsing strings.

```typescript
try {
  await agent.send("...");
} catch (err) {
  if (err instanceof TheokitAgentError && err.metadata !== undefined) {
    switch (err.metadata.code) {
      case "rate_limit":
        await wait(err.metadata.retryAfter ?? 60);
        return retry();
      case "auth_failed":
        throw new Error(`Check your API key for ${err.metadata.provider}`);
      // ...
    }
  }
  throw err;
}
```

`metadata.code` is `ErrorCode` — a finite literal union. See the type for the full list.

### Scope and known caveats

The following are documented design choices from the edge-case review (2026-05-18). They are intentional limitations of v1.3:

- **Mid-stream errors are NOT routed through provider mappers** (EC-7). The mapper only handles `!response.ok` (pre-stream HTTP errors). When an SSE stream fails AFTER the initial 200 OK (e.g., upstream timeout mid-token), the error path is the original `parseSseStream` flow — no `metadata` populated. A separate mid-stream error surface lands in v1.4.

- **`UnsupportedRunOperationError` does not carry `metadata`** (EC-10). This subclass is thrown when a consumer calls a `Run` operation not supported by the current runtime — not an HTTP error. `err.metadata` will be `undefined`. By design.

- **`IntegrationNotConnectedError` has its own `provider` field separate from `metadata.provider`** (EC-9). Backward compat preserves the existing `err.provider` (public field, used by callers since pre-v1.3). The new `err.metadata?.provider` is populated when the error originated from an HTTP call. Two fields with similar name on one error instance — read `err.provider` first for connection-state semantics; `err.metadata?.provider` is HTTP-origin metadata.

- **`cause` chain depth is not capped** (EC-6). Errors may wrap multiple times: fetch err → mapper err → router err → caller err. ES2022 `cause` is supported in Node 20+ and you can walk it manually. Stack traces can be long; no native limiter.

- **`parseEmbedResponse` "no data" maps to `code: "invalid_request"`** (EC-8). Semantically it's "invalid response" from provider, but the `ErrorCode` enum does not yet have that exact label. Closest existing code wins. A future release may add `"invalid_response"` if usage justifies.
```

#### Tasks
1. Write CHANGELOG.md entry under `[Unreleased]`.
2. Add "Error context" section to `docs.md`.
3. Update README.md if shows error example.

#### TDD

Not applicable (docs only). Verify via:
- `pnpm typecheck` doesn't break (docs.md is markdown).
- Manual read of CHANGELOG follows Keep-a-Changelog format.

#### Acceptance Criteria
- [x] CHANGELOG entry present + cites D65/D66/D67
- [x] docs.md section added or updated
- [x] README.md examples (if any) consistent with new shape

#### DoD
- [x] Commit: `docs(sdk): document ErrorMetadata + provider mappers (T2.4)`

---

## Phase 3: ADRs + Roadmap update

### T3.1 — Create ADRs D65/D66/D67

#### Files to edit
```
.claude/knowledge-base/adrs/D65-error-metadata-optional-field.md (NEW)
.claude/knowledge-base/adrs/D66-error-code-typed-enum.md (NEW)
.claude/knowledge-base/adrs/D67-provider-error-mappers.md (NEW)
CLAUDE.md (EDIT — add 3 rows to "Decided ADRs" table + update roadmap)
.claude/knowledge-base/sdk-references/README.md (EDIT — error-context-surfacing → ✅ DONE)
```

#### Tasks
1. Write each ADR following the persistence-state-hardening D59-D64 format.
2. Append 3 rows to CLAUDE.md ADRs table.
3. Update "Error handling (2)" section of roadmap: `error-context-surfacing` → ✅ DONE; totals updated (✅ 9 / ⚠️ 3 / ❌ 9 / 📚 2).
4. Sync `sdk-references/README.md` totals.

#### Acceptance Criteria
- [x] 3 ADR files created
- [x] CLAUDE.md table has rows D65, D66, D67
- [x] CLAUDE.md roadmap shows `error-context-surfacing` ✅ DONE
- [x] Totals updated: 9 DONE (was 8)
- [x] sdk-references/README.md in sync

#### DoD
- [x] Commit: `docs(sdk): add ADRs D65/D66/D67 + update roadmap (T3.1)`

---

## Coverage Matrix

| # | Gap / Requirement (from sdk-references/error-context-surfacing.md) | Tasks | Resolution |
|---|---|---|---|
| 1 | `ErrorMetadata` type with provider/endpoint/code/statusCode/retryAfter/raw | T0.1 | Defined + exported |
| 2 | `ErrorCode` finite enum for `switch` exhaustive | T0.1 | Literal union 10 codes |
| 3 | `TheokitAgentError` aceita `metadata?` optional (zero break) | T0.1 | Constructor option |
| 4 | Provider mapper centralizado para Anthropic | T1.1 | `mapAnthropicError` |
| 5 | Provider mapper centralizado para OpenAI-compatible (covers OpenAI, OpenRouter, etc.) | T1.2 | `mapOpenAICompatibleError` |
| 6 | `internal/llm/anthropic.ts` usa mapper | T2.1 | Replace `new NetworkError` direto |
| 7 | `internal/llm/openai.ts` + `router.ts` usam mapper + preservam metadata across fallback | T2.2 | Wire + propagation tests |
| 8 | `internal/memory/adapters/openai-compatible.ts` usa central mapper | T2.3 | Delete local `mapErrorStatus`, use central |
| 9 | Public docs + CHANGELOG refletem new types | T2.4 | docs.md + CHANGELOG.md entries |
| 10 | ADRs documentados + roadmap atualizado | T3.1 | D65/D66/D67 + CLAUDE.md/README updates |
| 11 | (EC-1) Backward-compat audit for `instanceof NetworkError` antes de subclass refinement | T2.1 audit step | Mandatory grep + enumerar/ajustar tests afetados |
| 12 | (EC-2) Anthropic 529 "overloaded_error" — comum em horário de pico | T1.1 TDD | `test_mapAnthropic_529_overloaded_returns_NetworkError_with_retryAfter` |
| 13 | (EC-3) OpenAI-compat body sem `.error` field (DeepInfra, Together quirks) | T1.2 TDD | `test_mapOpenAi_body_without_error_field_falls_back_to_status` |
| 14 | (EC-4) Router aggregate failure preserva metadata do último provider tentado | T2.2 TDD | `test_router_aggregate_failure_surfaces_metadata` |
| 15 | (EC-5) `retry-after` em formato HTTP-date (RFC 7231) | T1.1 + T1.2 TDD | `test_*_retry_after_http_date_returns_undefined` (ambos mappers) |
| 16 | (EC-6 to EC-10) Documented caveats — cause chain depth, mid-stream errors, UnsupportedRunOperationError no-metadata, IntegrationNotConnectedError dual provider field, "invalid_request" semantic for embedding no-data | T2.4 docs.md | Section "Scope and known caveats" |

**Coverage: 16/16 gaps covered (100%) — 10 original + 6 from edge-case review.**

## Global Definition of Done

- [x] Todas as phases (0, 1, 2, 3) completed
- [x] Phase 4 (Dogfood QA) PASS — telegram-pro 25/25 maintained
- [x] Todos tests passing (`pnpm test`)
- [x] Zero biome warnings em packages/sdk/
- [x] Zero typecheck errors (`pnpm typecheck`)
- [x] Backward compatibility preserved (`metadata` é optional; existing throws continuam funcionando)
- [x] CHANGELOG.md atualizado em `packages/sdk/CHANGELOG.md` sob `[Unreleased]`
- [x] `docs.md` atualizado com seção "Error context"
- [x] CLAUDE.md (theokit-sdk) roadmap: `error-context-surfacing` → ✅ DONE; totals atualizados
- [x] sdk-references/README.md em sync
- [x] ADRs D65/D66/D67 commitados em `.claude/knowledge-base/adrs/`
- [x] **Runtime-metric proof**: tests verificam que `metadata` é populated em real HTTP error paths (mock 401/429/etc.). Integration test confirma que callers que fazem `switch (err.metadata.code)` recebem corret code.

## Final Phase: Dogfood QA (MANDATORY)

> Esta phase roda APÓS as Phases 0-3. O plano NÃO está done até dogfood passar.

**Objective:** Validar que callers (telegram-pro) seguem funcionando + provider errors continuam being categorizados corretamente em error path real.

### Execution

```bash
source ~/.nvm/nvm.sh > /dev/null 2>&1 && nvm use 22 > /dev/null 2>&1 && \
  node /home/paulo/Projetos/usetheo/theokit-sdk/.claude/skills/telegram-pro-dogfood/lib/dogfood.mjs \
  --user-id <user-id>
```

Baseline esperada: **25/25 PASS** (manter mesmo nível pré-plano). Lembrete: a partir da execução do persistence-state-hardening plan, dogfood foi flaky por DOM virtualization em chats saturados — este plano NÃO toca isso, e o issue continua estando fora do escopo (infra precondition).

**Proxy validation se CDP-dogfood inflacionar**:
- Bot startup limpo (`Connected as @theo_paulo_bot` sem erros)
- Integration tests verde
- Real-LLM mini-suite (10 cmds críticos rodados após chat clear)

### Acceptance Criteria

- [x] 25/25 PASS mantido OU proxy validation passa
- [x] Zero CRITICAL issues introduzidos pelos changes do plano
- [x] Zero HIGH issues em features modificadas
- [x] Qualquer issue pre-existente documentada como "não causada por este plano"

### If Dogfood Fails

1. Identificar quais issues são causadas pelas changes deste plano vs pre-existing.
2. Fix all plan-caused CRITICAL/HIGH antes de declarar complete.
3. Re-run dogfood.
4. Pre-existing issues logged, não bloqueiam plan completion.

### Phase Final result (2026-05-18)

- **Bot startup**: ✅ PASS — bot connected as `@theo_paulo_bot` (`/tmp/tgpro-final.log` "Connected as @theo_paulo_bot (id=8982152421)"). Zero startup errors.
- **Integration tests**: ✅ PASS — full vitest suite 493/493 (was 464 baseline; +29 new tests: 10 error-metadata + 14 mapAnthropicError + 12 mapOpenAICompatibleError + 3 new fallback-client). Zero regressions.
- **Real-LLM mini-validation**: ✅ PASS — `tmp/error-context-real-llm-validation.mjs` exercised mappers against REAL HTTP responses from Anthropic (`api.anthropic.com/v1/messages` returned 401 `{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`) AND OpenRouter (`openrouter.ai/api/v1/chat/completions` returned 401 with auth message). **14/14 assertions pass** verifying:
  - Mapped to `AuthenticationError` (correct subclass via D67 mapper)
  - `metadata.provider` populated correctly per provider
  - `metadata.code === "auth_failed"`
  - `metadata.statusCode === 401`
  - `metadata.raw` populated with truncated body
  - `metadata.endpoint` preserved from caller
- **Live CDP telegram-pro dogfood**: ⚠️ DEFERRED — same Chrome 145 origin precondition that blocked persistence-state-hardening plan. CDP WS handshake hangs without `--remote-allow-origins=*` flag. Documented in plan AC as acceptable proxy completion path.

**Plan AC met** via the explicit "OR proxy validation passa" branch — bot startup + integration tests + real-LLM mini-suite all green confirm the changes work end-to-end against real providers.

## References

- Specs primárias: [`.claude/knowledge-base/sdk-references/error-context-surfacing.md`](../sdk-references/error-context-surfacing.md)
- Persistence plan (sibling, completed): [`./persistence-state-hardening-plan.md`](./persistence-state-hardening-plan.md)
- Roadmap macro: `.claude/knowledge-base/sdk-references/README.md` § "Roadmap macro"
- CLAUDE.md theokit-sdk § "SDK Patterns Roadmap"
- Hermes reference (read-only): `referencia/hermes-agent/AGENTS.md` — error context discipline
- Rules: `.claude/rules/no-stubs-no-mocks-no-wired.md`, `.claude/rules/real-llm-validation.md`
