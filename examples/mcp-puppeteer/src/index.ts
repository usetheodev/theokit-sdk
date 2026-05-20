import { Agent } from "@usetheo/sdk";

/**
 * MCP Puppeteer example — uses `@modelcontextprotocol/server-puppeteer`
 * to give the agent browser-automation tools (navigate, screenshot,
 * click). Demonstrates the 3rd MCP server in the validation matrix
 * (filesystem + http + puppeteer all stdio; tavily-mcp also stdio).
 *
 * Requires Chromium available on the system (puppeteer-core will
 * download it on first run via `@modelcontextprotocol/server-puppeteer`).
 */

function pickModel(): string {
  if (process.env.ANTHROPIC_API_KEY) return "claude-sonnet-4-5-20250929";
  if (process.env.OPENAI_API_KEY) return "gpt-4o-mini";
  if (process.env.OPENROUTER_API_KEY) return "openai/gpt-4o-mini";
  throw new Error("Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in .env.");
}

async function main(): Promise<void> {
  const agent = await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "user-real-example-key",
    model: { id: pickModel() },
    local: { cwd: process.cwd() },
    mcpServers: {
      puppeteer: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-puppeteer"],
      },
    },
    systemPrompt:
      "You have browser-automation tools via the Puppeteer MCP server. Respond in 1 sentence describing what you would do; do not actually navigate (the example just verifies the MCP wiring).",
  });

  // We send a prompt that lists tool names available — proves the MCP
  // server connected and tools were registered.
  const run = await agent.send(
    "List the names of all puppeteer_* tools you have available, separated by commas. Do not call any of them.",
  );
  const result = await run.wait();
  console.log(`Agent ${agent.agentId}\n`);
  console.log(result.result ?? `(no result, status=${result.status})`);
  await agent.dispose();
}

main().catch((cause) => {
  console.error("mcp-puppeteer failed:", cause);
  process.exit(1);
});
