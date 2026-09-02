---
"@theokit/sdk": patch
---

The HTTP status ladder now has one definition instead of four, and two drifted copies are repaired.

`401/403 → auth_failed`, `402 → quota_exceeded`, `408 → timeout`, `429 → rate_limit`,
`400 → invalid_request`, `5xx → server_error` is RFC 9110 semantics, not a vendor contract: a 429
means the same thing whichever provider sent it. It was nevertheless written out in all four
provider mappers, and the copies had already diverged in two ways that reached users:

- **HTTP 402 reached one mapper of four.** `quota_exceeded` was wired into the OpenAI-compatible
  mapper only, so a Bedrock, Vertex or Anthropic endpoint answering 402 fell through every arm and
  surfaced as `unknown`. The canonical bucket existed and three of four mappers could not reach it.
- **The server arm had two different upper bounds.** Anthropic and OpenAI-compatible guarded
  `>= 500 && < 600`; Bedrock and Vertex guarded `>= 500` with no ceiling, so a malformed or
  proxy-injected 6xx was `server_error` in two mappers and `unknown` in the other two.

The ladder now lives once, in `internal/error-mappers/shared.ts`, beside the other dialect-agnostic
helpers. Each mapper keeps its own body dialect — Anthropic's `context_too_long`, OpenAI's
`insufficient_quota`, Bedrock's AWS `__type` strings and 404 rule, Vertex's `google.rpc` enum with
its finer `unauthenticated`/`permission` split — because those *are* per-vendor contracts. The
shape is now `classifyVendorBody(body) ?? httpStatusToErrorCode(status)`.

Visible changes: 402 now yields `quota_exceeded` (was `unknown`) on Anthropic, Bedrock and Vertex,
and a status of 600 or above now yields `unknown` (was `server_error`) on Bedrock and Vertex. HTTP
404 is deliberately unchanged everywhere.
