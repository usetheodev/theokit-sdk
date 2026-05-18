# ADR D67 — Provider HTTP error mappers live in `internal/errors/mappers/`

Date: 2026-05-18
Status: Accepted
Plan: [error-context-surfacing](../plans/error-context-surfacing-plan.md)

## Decision

Create `packages/sdk/src/internal/errors/mappers/` with one file per
provider dialect:

- `anthropic.ts` — `mapAnthropicError({ status, body, headers, endpoint })`
- `openai-compatible.ts` — `mapOpenAICompatibleError({ providerId, status, body, headers, endpoint })`

Each mapper:

- Inspects the HTTP response (status + body + headers) and returns the
  appropriate `TheokitAgentError` subclass with full `ErrorMetadata`
  populated (per D65/D66).
- Parses `retry-after` header in numeric-seconds form only; HTTP-date
  form (RFC 7231) is treated as unset to avoid `NaN` propagation.
- Truncates raw response body to ~2KB in `metadata.raw` to avoid
  log/payload bloat.
- Never throws — caller is already on the error path.

HTTP call sites (`internal/llm/anthropic.ts`,
`internal/llm/openai.ts`, `internal/memory/adapters/openai-compatible.ts`)
call the mappers instead of constructing errors inline. The
`internal/llm/fallback-client.ts` falls back when the underlying
provider throws any of `NetworkError | RateLimitError |
AuthenticationError` — broader than the pre-D67 check (was `NetworkError`
only), because a provider that returns 401 or 429 is just as worth
falling-back-from as one that returned 500.

## Rationale

- Centralization: pre-D67, the 401-to-AuthenticationError mapping was
  re-implemented in three places (Anthropic LLM, OpenAI LLM, embedding
  adapter). Each re-implementation diverged in `code` strings and
  message format. A single mapper per dialect is the obvious DRY.
- Provider-dialect distinction (Anthropic body shape `{ error: { type,
  message } }` vs OpenAI shape `{ error: { code, message, type } }`):
  separate mapper per file keeps body inspection clear and
  side-by-side comparison possible.
- `openai-compatible` covers a real cluster of providers (OpenAI,
  OpenRouter, DeepSeek, Together, Mistral, Voyage, DeepInfra) that
  share the OpenAI-style response shape. New providers in that
  cluster reuse the same mapper.

## Alternatives considered

- **Single uber-mapper with provider-detection switch** (rejected):
  one large function that branches on `providerId` to pick body-shape
  logic. Harder to test isolation; future provider quirks pile in one
  file.
- **Method on the LLM client class** (rejected): couples error mapping
  to the client. Memory embedding adapter and any future MCP HTTP
  call sites would not benefit.

## Consequences

- The legacy `mapErrorStatus` helper inside
  `internal/memory/adapters/openai-compatible.ts` is removed (dead
  code post-migration).
- Existing tests asserting `instanceof NetworkError` for 401/429
  paths needed adjustment (`AuthenticationError` / `RateLimitError`
  respectively). Audit was performed and three tests were updated:
  `golden/llm/anthropic-client.golden.test.ts` (401),
  `golden/memory/openai-embedding.golden.test.ts` (400), and stubs
  in `golden/llm/fallback-client.golden.test.ts`.
- Adding a new provider dialect (e.g., AWS Bedrock Converse) means
  adding a new mapper file. The pattern is small (~120 LoC) and
  test-isolated.
