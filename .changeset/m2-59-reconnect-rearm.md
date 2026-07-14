---
"@theokit/sdk": patch
---

Fix (#59) — a stdio MCP client no longer permanently wedges after a transient outage exceeds the reconnect attempt bound. The bound is now LOCAL to each reconnect cycle (a bounded retry loop with backoff), so a later request re-arms a fresh cycle and reconnects once the server recovers — while a genuinely-broken server still surfaces a typed `mcp_disconnected` "reconnect exhausted". Adds the previously-missing HTTP-transport recovery test (stateless reconnect on the next request after a transport failure).
