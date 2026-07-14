---
"@theokit/sdk": patch
---

Security/correctness (#59) — the HTTP MCP body read (`response.json()`) was outside the abort try/catch, so a server that returned headers then stalled the body surfaced a raw `DOMException(TimeoutError)` instead of the typed `NetworkError{code:"mcp_timeout"}`. The request was still bounded (no hang), but the typed-timeout contract now holds across both the header and body phases.
