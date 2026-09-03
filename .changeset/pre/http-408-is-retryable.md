---
"@theokit/sdk": patch
---

HTTP 408 is now classified as a retryable timeout instead of a configuration error.

`mapHttpStatusToError` in `internal/http.ts` had no arm for 408, so a Request Timeout fell through
to the generic `4xx` branch and came back as a `ConfigurationError` — `isRetryable: false`. Every
one of the four provider-specific mappers already did the opposite: `openai-compatible`, `anthropic`,
`bedrock` and `vertex` all map 408 to a `NetworkError` carrying a `timeout` code, which is retryable.
The generic ladder is a fifth copy of the same knowledge and it was the copy that drifted.

The failure was silent and pointed the wrong way. Nothing threw: a caller branching on
`isTransientError` simply refused to retry a request that would very likely have succeeded, and did
so only on the paths that went through the generic mapper rather than a provider one.

If you were catching `ConfigurationError` to handle 408 specifically, catch `NetworkError` instead —
or branch on `code`, which is what `docs/error-codes.md` asks for.
