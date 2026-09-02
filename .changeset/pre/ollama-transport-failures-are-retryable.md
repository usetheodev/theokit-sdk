---
"@theokit/sdk": patch
---

A dropped connection to Ollama is now retried instead of surfacing on the first attempt.

`OllamaNativeClient` rethrew the raw `fetch` rejection when its own body-dialect mapper did not
recognise the failure, and threw a bare `new Error` for any HTTP status the dialect did not cover.
Both land outside the SDK error hierarchy, and that decides retry behaviour by contract rather than
by chance: `isTransientError` is `err instanceof TheokitAgentError && err.isRetryable === true`, and
the router wraps every resolved client in `RetryingLlmClient`. A foreign error is therefore
non-transient by definition — so the most ordinary failure a local Ollama can produce, a dropped
connection, was never retried.

The repository had already found and fixed this for the other transports; `openai.ts` records the
measurement and names Ollama as the one still carrying it. Transport failures now go through
`wrapTransportError` (which passes `AbortError` and any already-mapped SDK error through untouched,
so nothing gets relabelled), and unrecognised statuses go through the shared HTTP status ladder
rather than a bare `Error`.

Visible change: these two paths now reject with `NetworkError` (`code: "transport_failure"`) and a
typed error carrying the status, instead of a `TypeError` and an `Error`. A caller branching on
`instanceof Error` is unaffected; a caller branching on `isTransientError` starts getting retries.
