import { Agent, type McpServerConfig } from "@usetheo/sdk";

/**
 * MCP OAuth 2.1 PKCE example for Notion (ADR D41).
 *
 * Two modes:
 *   - Config-only (default, no creds): prints the McpServerConfig that
 *     would be used and exits 0. Safe to run in CI / unauthenticated.
 *   - Real flow (with NOTION_OAUTH_CLIENT_ID + provider key set):
 *     creates an agent, sends a prompt that triggers the PKCE flow on
 *     first use. Localhost callback opens a free port, user pastes
 *     authorization URL into browser, completes auth, tokens stored
 *     via keytar (or ~/.theokit/mcp-tokens.json fallback).
 *
 * To enable real flow:
 *   1. Create a Notion integration at https://www.notion.so/my-integrations
 *   2. Set redirect URI to http://127.0.0.1:<port>/callback (port is dynamic)
 *   3. cp .env.example .env, fill in NOTION_OAUTH_CLIENT_ID + a provider key
 *
 * Security notes:
 *   - state parameter is generated random and validated on callback (CSRF).
 *   - Tokens preferred-storage: OS keychain via keytar (install with
 *     `pnpm add keytar`). File fallback at ~/.theokit/mcp-tokens.json
 *     (chmod 600 on POSIX; no chmod on Windows — keytar recommended there).
 */

const NOTION_CLIENT_ID = process.env.NOTION_OAUTH_CLIENT_ID;
const PROVIDER_KEY =
  process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY;

const notionMcp: McpServerConfig = {
  type: "http",
  url: "https://mcp.notion.com/sse",
  auth: {
    CLIENT_ID: NOTION_CLIENT_ID ?? "DEMO_CLIENT_ID",
    scopes: ["read"],
    oauth: {
      authorizationEndpoint: "https://api.notion.com/v1/oauth/authorize",
      tokenEndpoint: "https://api.notion.com/v1/oauth/token",
      redirectMode: "localhost",
    },
  },
};

async function main(): Promise<void> {
  if (NOTION_CLIENT_ID === undefined || PROVIDER_KEY === undefined) {
    console.log("Config-only mode (NOTION_OAUTH_CLIENT_ID + provider key not set).\n");
    console.log("McpServerConfig that would be used:");
    console.log(JSON.stringify(notionMcp, null, 2));
    console.log(
      "\nTo enable the real OAuth flow, set both NOTION_OAUTH_CLIENT_ID and one of OPENROUTER_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY in .env.",
    );
    process.exit(0);
  }

  console.log("Real OAuth mode. Creating agent with Notion MCP server...");
  const agent = await Agent.create({
    apiKey: PROVIDER_KEY,
    model: { id: "google/gemini-2.0-flash-001" },
    local: { cwd: process.cwd() },
    mcpServers: { notion: notionMcp },
  });
  console.log(
    "Agent created. On the first agent.send the OAuth flow will trigger — your browser will open a Notion authorization page.",
  );
  try {
    const run = await agent.send("List my Notion databases via the notion MCP tools.");
    const result = await run.wait();
    console.log("\nResult:", result.result ?? `(${result.status})`);
  } finally {
    await agent.dispose();
  }
}

await main();
