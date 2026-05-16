import { Agent } from "@usetheo/sdk";

/**
 * Per-send `mcpServers` override. `SendOptions.mcpServers` lets a single
 * `agent.send()` call use a different MCP server set than the agent's
 * default. The override REPLACES the agent-level config for that send only.
 *
 * Typical use: agent baseline runs with a stable MCP set; one-off message
 * needs a different tool (e.g., a debug MCP server that doesn't belong in
 * the long-lived config).
 */
async function main(): Promise<void> {
  const agent = await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "theo_test_send_mcp_override",
    model: { id: "google/gemini-2.0-flash-exp:free" },
    local: { cwd: process.cwd() },
    mcpServers: {
      // Agent's baseline MCP set
      search: { type: "http", url: "https://mcp.example.com/search" },
    },
  });
  console.log(`Agent created with baseline MCP: search`);

  // Send with default MCP set — uses agent's baseline
  const r1 = await agent.send("First message — uses baseline MCP.");
  await r1.wait();
  console.log("  send 1: baseline MCP active");

  // Send with override — replaces baseline for this call only
  const r2 = await agent.send("Second message — uses debug MCP only.", {
    mcpServers: {
      debug: { type: "http", url: "https://mcp.example.com/debug" },
    },
  });
  await r2.wait();
  console.log("  send 2: override MCP (debug) active");

  // Third send — back to baseline
  const r3 = await agent.send("Third message — back to baseline.");
  await r3.wait();
  console.log("  send 3: baseline MCP active again");

  await agent.dispose();
}

main().catch((cause) => {
  console.error("send-mcp-override failed:", cause);
  process.exit(1);
});
