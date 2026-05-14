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
