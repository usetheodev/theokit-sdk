/**
 * MCP server configuration accepted by `Agent.create()` and `agent.send()`.
 *
 * @public
 */
export type McpStdioServerConfig = {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** Local agents only. Cloud rejects this field. */
  cwd?: string;
};

/**
 * OAuth-style auth bundle for HTTP/SSE MCP servers.
 *
 * @public
 */
export interface McpAuthConfig {
  CLIENT_ID: string;
  CLIENT_SECRET?: string;
  scopes?: string[];
  /**
   * OAuth 2.1 PKCE flow configuration (ADR D41, v1.2+). When present, the
   * SDK runs the PKCE flow on first use and stores tokens via keychain or
   * file. Without this, the SDK relies on `CLIENT_SECRET` + manual headers.
   */
  oauth?: McpOAuthConfig;
}

/**
 * OAuth 2.1 PKCE flow descriptor. See ADR D41.
 *
 * @public
 */
export interface McpOAuthConfig {
  /** Authorization endpoint (e.g. https://api.notion.com/v1/oauth/authorize). */
  authorizationEndpoint: string;
  /** Token endpoint (e.g. https://api.notion.com/v1/oauth/token). */
  tokenEndpoint: string;
  /** Where the OAuth `code` is received. */
  redirectMode: "manual" | "localhost";
  /** Localhost callback port (0 = random free port, default). */
  localhostPort?: number;
  /** Flow timeout in ms (default 300_000 = 5min). */
  timeoutMs?: number;
}

/**
 * HTTP or SSE MCP server.
 *
 * @public
 */
export type McpHttpServerConfig = {
  type?: "http" | "sse";
  url: string;
  /** Passed through. `Authorization` works here. */
  headers?: Record<string, string>;
  auth?: McpAuthConfig;
};

/**
 * Union of MCP server configs. See `docs.md` for the full reference.
 *
 * @public
 */
export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;
