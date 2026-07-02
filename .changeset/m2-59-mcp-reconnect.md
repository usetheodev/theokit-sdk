---
"@theokit/sdk": minor
---

The stdio MCP client now reconnects after a transport drop (#59, completing the M0 timeout work). A server child that exits or closes mid-session used to leave pending requests hung forever (a second permanent-hang vector distinct from the request timeout). Now an unexpected exit of the active child rejects every pending request with a typed `NetworkError` (`code: "mcp_disconnected"`) and marks the client dropped; the next request re-spawns the server and re-runs the `initialize` handshake with a bounded full-jitter backoff (2 attempts) before failing with `mcp_disconnected`. A deliberate `close()` is not treated as a drop (no reconnect). The http transport is stateless — each request opens a fresh connection, so it reconnects inherently on the next call; its error-surfacing contract is unchanged. Elicitation, server notifications, and adopting the upstream MCP SDK remain out of scope (documented boundary). No new dependency.
