# D291 — Vertex Gemini uses the OpenAI-compat endpoint (reuses `OpenAIClient`)

**Date:** 2026-05-23
**Status:** Accepted

## Decision

For model IDs `vertex/google/gemini-*`, the profile maps to `apiMode: "chat_completions"` and baseUrl `https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/{LOCATION}/endpoints/openapi`. Reuses the existing `OpenAIClient` with `Authorization: Bearer {accessToken}`.

## Rationale

Google published this endpoint specifically to reduce friction (drop-in for OpenAI SDK clients). Reusing `OpenAIClient` = zero new transport. Documented limitation: "unsupported params silently dropped" — accepted trade-off for v1 (D264 pattern).

## Consequences

- Tests verify `OpenAIClient` receives correct baseUrl + auth.
- docs.md documents the list of unsupported params (recursive JSON schemas, `detail` in old multimodal, etc).
