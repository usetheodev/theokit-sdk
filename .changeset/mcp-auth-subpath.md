---
"@theokit/sdk": minor
---

Adds the `@theokit/sdk/mcp-auth` subpath: the OAuth PKCE flow for remote MCP servers
(`runPkceFlow`, `refreshAccessToken`) plus the token storage the two of them need
(`getTokens`, `setTokens`, `lockedRefresh`).

The implementation already existed and was tested; nothing exported it. A consumer
connecting to an MCP server that requires OAuth had to write RFC 7636 PKCE by hand — not
because the package lacked the code, but because there was no way in.

`lockedRefresh` ships alongside deliberately: two callers noticing an expired token at the
same moment will both refresh, and under a rotating refresh token the second one loses.
