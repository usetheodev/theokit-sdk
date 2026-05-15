import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { Agent } from "@usetheo/sdk";

/**
 * MCP-stdio example. Spins up an inline JSON-RPC MCP server (see
 * `./server.ts`) as a stdio child process and asks the agent to use the
 * `time.now` tool the server exposes.
 *
 * Demonstrates:
 *  - `mcpServers` config with stdio transport.
 *  - The agent loop discovering MCP tools via `tools/list`.
 *  - Real `tools/call` round-trips with results fed back to the LLM.
 */

function pickModel(): string {
  if (process.env.ANTHROPIC_API_KEY) return "claude-sonnet-4-5-20250929";
  if (process.env.OPENAI_API_KEY) return "gpt-4o-mini";
  if (process.env.OPENROUTER_API_KEY) return "openai/gpt-4o-mini";
  throw new Error("Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in .env.");
}

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "server.ts");

async function main(): Promise<void> {
  const agent = await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "user-real-example-key",
    model: { id: pickModel() },
    local: { cwd: process.cwd() },
    mcpServers: {
      "demo-time": {
        type: "stdio",
        command: process.execPath,
        args: ["--import", "tsx", serverPath],
      },
    },
  });
  console.log(`Agent: ${agent.agentId}`);

  const run = await agent.send(
    "Use the `mcp_demo-time_time_now` tool with offsetHours=0 to get the current time. Then report it in plain English (e.g., 'It is currently 2026-...').",
  );

  for await (const event of run.stream()) {
    if (event.type === "system") {
      console.log(`[system] tools: ${event.tools.join(", ")}`);
    } else if (event.type === "tool_call" && event.status === "completed") {
      const stdout = (event.result as { stdout?: string } | undefined)?.stdout ?? "";
      console.log(`[tool_call:${event.name}] → ${stdout.trim()}`);
    } else if (event.type === "assistant") {
      const text = event.message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
      if (text.length > 0) console.log(`\n${text}\n`);
    }
  }

  const result = await run.wait();
  console.log(`[status=${result.status} duration=${result.durationMs}ms]`);
}

main().catch((cause) => {
  console.error("MCP example failed:", cause);
  process.exit(1);
});
