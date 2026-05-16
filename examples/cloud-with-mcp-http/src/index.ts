import { Agent, type SDKAgent } from "@usetheo/sdk";

interface CloudAgentWithPayload extends SDKAgent {
  cloudPayload: Record<string, unknown>;
}

/**
 * Cloud agent + HTTP MCP server (ADR D15 + EC-3 + EC-9).
 *
 * Demonstrates the HTTP-only constraint for cloud MCP transport: only
 * `mcpServers.<n>.type === "http"` survives the trip to PaaS. Stdio servers
 * pointing at local-FS commands (`/usr/local/bin/x`) are rejected at
 * `Agent.create()` with `cloud_incompatible_mcp_stdio_local`.
 *
 * NOTE (EC-9): The URL below is a placeholder for documentation. In fixture
 * mode the SDK does not call it; the example only validates the SDK accepts
 * the config shape and serializes it correctly. Replace with your real MCP
 * HTTP server endpoint before running in production.
 */
async function main(): Promise<void> {
  const agent = (await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "theo_test_cloud_with_mcp_http",
    model: { id: "google/gemini-2.0-flash-exp:free" },
    cloud: {
      repos: [{ url: "https://github.com/usetheo/example", startingRef: "main" }],
    },
    mcpServers: {
      // HTTP MCP server — reachable from any VM the PaaS provisions.
      search: { type: "http", url: "https://mcp.example.com" },
      // Stdio MCP server with a bare command — PaaS image guarantees `npx`
      // in PATH, so this also serializes correctly.
      tooling: { type: "stdio", command: "npx", args: ["-y", "@scope/mcp-tooling"] },
    },
  })) as unknown as CloudAgentWithPayload;

  console.log(`Cloud agent created: ${agent.agentId}`);
  console.log("\nCanonical payload that PaaS will receive:");
  console.log(JSON.stringify(agent.cloudPayload, null, 2));

  console.log("\nEC-2: secrets stripped — no Authorization/x-api-key/env headers leak.");
  const json = JSON.stringify(agent.cloudPayload);
  console.log(
    `  contains 'Authorization': ${json.includes("Authorization") ? "❌ FAIL" : "✓"}`,
  );
  console.log(`  contains 'env':           ${json.includes('"env"') ? "❌ FAIL" : "✓"}`);
}

main().catch((cause) => {
  console.error("cloud-with-mcp-http failed:", cause);
  process.exit(1);
});
