/**
 * Published as `@theokit/sdk/mcp-auth`.
 *
 * OAuth for remote MCP servers: the PKCE authorization flow, token refresh, and the storage the two
 * of them need.
 *
 * The implementation has existed and been tested at `internal/mcp/` for some time; what it lacked
 * was a way in. A consumer connecting to an MCP server that requires OAuth had to write RFC 7636
 * PKCE by hand — not because the package lacked the code, but because nothing exported it.
 *
 * `lockedRefresh` is exported alongside deliberately: two callers noticing an expired token at the
 * same moment will both refresh, and with a rotating refresh token the second one loses. That is the
 * kind of detail a hand-written flow discovers in production.
 *
 * `_resetForTests` is deliberately NOT re-exported — it is module-state surgery for this repo's own
 * tests, and publishing it invites a consumer to clear a cache the package is responsible for.
 */
export { refreshAccessToken, runPkceFlow } from "./internal/mcp/oauth.js";
export {
  getTokens,
  lockedRefresh,
  type OAuthTokens,
  setTokens,
} from "./internal/mcp/token-storage.js";
