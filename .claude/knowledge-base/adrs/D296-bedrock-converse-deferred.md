# D296 — Bedrock Converse API + Computer Use deferred to v1.x

**Date:** 2026-05-23
**Status:** Accepted

## Decision

v1 only implements InvokeModel for Claude on Bedrock. Converse API, Computer Use tool relay, and Bedrock Agents / Knowledge Bases are deferred.

## Rationale

Converse loses Anthropic features (D289). Computer Use requires tool-result image handling complexity. Bedrock Agents/Knowledge Bases are out of scope for "LLM provider".

## Consequences

- Documented limitations.
- Forward-compat: `apiMode: "bedrock_converse"` slot reserved.
- Callers needing Converse use the escape hatch via `@aws-sdk/client-bedrock-runtime`.
