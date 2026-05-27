# D360 — Prompt size cap = 2 MiB (DoS defense)

- **Status:** Accepted
- **Date:** 2026-05-26
- **Plan:** `acp-server-adapter-plan` (Phase 0)

## Context

ACP `prompt` content is an array of `ContentBlock` (text, image, embedded resource). Unbounded prompts cause memory exhaustion (CWE-400 / GHSA-cxpw-2g23-2vgw). OpenClaw enforces a 2 MiB cap at the same boundary.

## Decision

`extractPrompt(blocks, maxBytes)` enforces a 2 MiB default cap. Configurable via `serveAcp({ maxPromptBytes })`. Total counted = UTF-8 byte length of text blocks + base64-decoded byte length of media blocks.

## Rationale

- Battle-tested value (OpenClaw uses 2 MiB).
- UTF-8 byte counting (not JS string length) correctly handles surrogate pairs.
- Exceeding the cap throws `PromptTooLargeError` which `handlePrompt` maps to ACP `invalid_request`.

## Consequences

- Users with legitimate large pastes (huge stack traces) may hit the cap. They can configure `maxPromptBytes` higher.
- Documented in concept page.
- `PromptTooLargeError` exported from `src/types.ts` so consumers can catch it specifically.
