---
"@theokit/sdk": patch
---

Bound every MCP request with a timeout so a non-responding server can no longer hang the agent loop (#59). The stdio transport's `request` returned a Promise that never resolved when the server read the request but never replied; the http transport's `fetch` had no timeout. Both now enforce a per-request `requestTimeoutMs` (default 30000, configurable per server): stdio races the pending request against a timer that rejects a typed `NetworkError` (`code: "mcp_timeout"`) and drops the pending map entry (a late reply after timeout is a no-op — never a double-settle); http passes `AbortSignal.timeout` and maps an abort to the same typed error while surfacing any other fetch failure unchanged. `close()` now also settles any in-flight requests (`code: "mcp_closed"`) instead of leaking their timers.
