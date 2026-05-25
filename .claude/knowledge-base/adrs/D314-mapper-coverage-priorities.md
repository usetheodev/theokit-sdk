# D314 — Mapper coverage: OpenAI + Anthropic primary; Vertex/Bedrock/Ollama inherit

**Status:** Accepted
**Date:** 2026-05-25
**Related:** Production-Readiness plan Phase 3, T3.3

## Decision

Provider HTTP error mappers are expanded to cover Phase 3's new codes in **OpenAI-compatible** (which serves OpenAI + OpenRouter + DeepSeek + Together + Mistral + Voyage + DeepInfra) and **Anthropic** first. Vertex/Bedrock reuse the dialect wrappers (D291, D292) and inherit by extension. Ollama is unchanged — only timeout/network paths.

Specifically:
- OpenAI mapper: detect 402 + `insufficient_quota` body code → map to `invalid_request` (provider HTTP code) which is upgraded to `quota_exceeded` at the AgentRunError layer.
- Both mappers: parse `request-id` / `x-request-id` headers into a shared helper (`parseRequestId`).

## Rationale

**95% coverage with 2 mappers.** Provider mix in current examples: OpenAI/OpenRouter dominant (~60%), Anthropic (~25%), local Ollama (~10%), Vertex/Bedrock (~5%). Investing mapper time proportionally to traffic delivers the most value.

**Vertex + Bedrock are wrappers, not new dialects.** They reuse OpenAI-compat for Gemini (D291) and Anthropic dialect for Claude (D292). Improvements to those two mappers propagate automatically.

**String-matching is fragile but acceptable.** Provider copy changes (rare in 2026 — both vendors have stable error formats now) silently degrade to `unknown` code, which is a safe fallback. Mitigated by snapshot tests against real provider responses (deferred to Phase 7 dogfood).

## Alternatives considered

- **Touch all 5 mappers in parallel** — rejected. Time-to-value worse. v2 can backfill if Vertex/Bedrock-specific signatures emerge.
- **Generated mappers from provider OpenAPI specs** — rejected. Specs lie; real provider errors don't always match documented shapes.

## Consequences

- OpenAI 402 + Anthropic 402 → `quota_exceeded`-flavored errors with structured `requestId`.
- Vertex/Bedrock get the same downstream by inheritance.
- Ollama returns `network`/`timeout`/`unknown` as before. New codes never fire for Ollama errors (correct — Ollama doesn't have billing).
