---
"@theokit/sdk": minor
---

`Theokit.subscribe` accepts an injected `fetch` and `WebSocket`.

Both were read off `globalThis` at call time, so the only way to exercise the SSE or WebSocket path —
in our own tests or in a consumer's — was to replace a global for the duration of the call. That is a
process-wide mutation to test one function, and it makes the transports untestable in any environment
where patching globals is not acceptable: a worker, a sandbox, an embedded runtime, or a suite running
files in parallel.

`SubscribeOptions` now takes optional `fetch` and `WebSocket`, each falling back to the global when
absent, so existing callers are unaffected. The SSE path, the WebSocket path and the automatic
transport selection all resolve through the same seam.

One case still requires replacing the global rather than injecting: asserting the error a caller gets
when no `WebSocket` exists at all. Node 22 ships a real global `WebSocket`, and a fallback cannot
express absence — only removal can. That single test says so where it stands.
