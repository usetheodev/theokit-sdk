---
"@theokit/sdk": minor
---

Every error this SDK throws is now catchable as `TheokitAgentError`.

The README tells you to catch `TheokitAgentError`, and twenty-four exported error classes were not
one — they extended bare `Error`, so that catch silently missed them and none of them told you
whether the failure was worth retrying. Among them: `GenerateObjectError`, `StreamObjectError`,
`FileNotFoundError` and its four siblings, `SandboxSecurityError`, `SandboxNotAvailableError`, the
three `Auth*Error`s, `A2ARequestTimeoutError`, `MaxDelegationDepthError`, `WorkflowToolError`, and the
two errors on the `./interactive` subpath.

All twenty-four now extend `TheokitAgentError`, carry a `code`, and answer `isRetryable`. The answer
was decided per class rather than defaulted, and the reasoning is in the source. Two are retryable —
`A2ARequestTimeoutError` (a peer that missed one deadline may answer the next) and
`CompressionFailedError` (a single LLM call that failed or came back empty) — plus `FilesystemError`,
where the underlying I/O failure genuinely can be transient. The rest are not, and say why.

This is additive: `instanceof Error` still holds, every `code` value is unchanged, and no signature
moved. Code that already caught these by their specific class keeps working.

`generateObject` and `streamObject` also stop declaring the same failure contract twice with
byte-identical messages. They share one internal base class and keep their two distinct public names,
so `streamObjectError instanceof GenerateObjectError` remains false.
