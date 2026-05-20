import type { McpServerConfig, ProviderRoutingSettings } from "@usetheo/sdk";

/**
 * Centralized SDK feature configuration.
 *
 * Pulls together: provider fallback chain (`providers`), MCP filesystem
 * server (`mcpServers`), and the per-agent `local` options that enable the
 * shell tool sandbox + project-scope hooks. Each is opt-in based on
 * available env keys and the workspace layout.
 *
 * @internal to the example
 */

/**
 * Build a fallback chain across whichever providers are configured.
 * Order of preference: Anthropic → OpenAI → OpenRouter. The SDK uses the
 * `fallback` list when no explicit `route` matches a capability.
 *
 * Always declares `openrouter` for chat (the bot's default) because we know
 * THEOKIT_API_KEY / OPENROUTER_API_KEY is set.
 */
export function buildProviderRouting(): ProviderRoutingSettings | undefined {
  const available: string[] = [];
  if (process.env.ANTHROPIC_API_KEY !== undefined && process.env.ANTHROPIC_API_KEY.length > 0) {
    available.push("anthropic");
  }
  if (process.env.OPENAI_API_KEY !== undefined && process.env.OPENAI_API_KEY.length > 0) {
    available.push("openai");
  }
  if (process.env.OPENROUTER_API_KEY !== undefined && process.env.OPENROUTER_API_KEY.length > 0) {
    available.push("openrouter");
  }
  if (available.length === 0) return undefined;
  return {
    routes: [
      // Pin chat to the first available provider; if it fails the SDK walks
      // the fallback list.
      { capability: "chat", provider: available[0] ?? "openrouter" },
    ],
    fallback: available,
  };
}

/**
 * Build the MCP server map. Exposes:
 *
 *  - `filesystem` (always): `@modelcontextprotocol/server-filesystem` scoped
 *    to the bot's cwd. Surfaces list_directory / read_text_file / write_file /
 *    create_directory / search_files / edit_file / move_file.
 *
 *  - `tavily` (opt-in via TAVILY_API_KEY): `tavily-mcp` — the official Tavily
 *    web-search server. Surfaces tavily-search, tavily-extract, tavily-crawl,
 *    tavily-map. The same provider OpenClaw and Mastra wire as their default.
 *
 * Set `TELEGRAM_PRO_DISABLE_MCP_FS=1` in .env to skip filesystem MCP.
 */
export function buildMcpServers(cwd: string): Record<string, McpServerConfig> | undefined {
  const servers: Record<string, McpServerConfig> = {};
  if (process.env.TELEGRAM_PRO_DISABLE_MCP_FS !== "1") {
    servers.filesystem = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", cwd],
    };
  }
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (tavilyKey !== undefined && tavilyKey.length > 0) {
    servers.tavily = {
      type: "stdio",
      command: "npx",
      args: ["-y", "tavily-mcp"],
      env: { TAVILY_API_KEY: tavilyKey },
    };
  }
  return Object.keys(servers).length === 0 ? undefined : servers;
}
