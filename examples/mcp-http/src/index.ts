import { Agent } from "@usetheo/sdk";

/**
 * HTTP MCP transport. Companion to `mcp-stdio` — the same SDK shape,
 * different transport.
 *
 * The `type: "http"` MCP transport accepts a remote MCP server URL (the
 * MCP HTTP spec runs over HTTP+SSE or HTTP+JSON). Unlike stdio, the
 * server doesn't run as a subprocess; the SDK speaks HTTP to it.
 *
 * Note: this example uses a placeholder URL. In fixture mode the SDK
 * doesn't actually call it — the example demonstrates the SDK accepts
 * the config shape. Replace with a real MCP HTTP server before running
 * against a real LLM.
 */
async function main(): Promise<void> {
  const agent = await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "theo_test_mcp_http",
    model: { id: "google/gemini-2.0-flash-exp:free" },
    local: { cwd: process.cwd() },
    mcpServers: {
      search: { type: "http", url: "https://mcp.example.com" },
    },
  });
  console.log(`Agent created: ${agent.agentId}`);
  console.log("MCP HTTP server configured:");
  console.log("  search: type=http url=https://mcp.example.com");
  console.log("\nReplace the URL with a real MCP HTTP server, then run with a real provider key.");
  await agent.dispose();
}

main().catch((cause) => {
  console.error("mcp-http failed:", cause);
  process.exit(1);
});
