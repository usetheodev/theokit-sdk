import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Agent } from "@usetheo/sdk";

/**
 * Shell-tool example. Sets up a tiny fixture workspace with a known
 * `package.json` and a `data.txt`, then asks the agent to inspect it
 * with the real shell tool and summarize what it found.
 *
 * Demonstrates:
 *  - The agent loop discovering the `shell` tool automatically.
 *  - Real `child_process` execution — stdout / stderr / exitCode are
 *    captured and fed back as `tool_result` content.
 *  - Tool-call events surfacing as `SDKToolUseMessage` in `run.stream()`.
 */

function pickModel(): string {
  if (process.env.ANTHROPIC_API_KEY) return "claude-sonnet-4-5-20250929";
  if (process.env.OPENAI_API_KEY) return "gpt-4o-mini";
  if (process.env.OPENROUTER_API_KEY) return "openai/gpt-4o-mini";
  throw new Error("Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in .env.");
}

async function setupWorkspace(): Promise<string> {
  const cwd = join(process.cwd(), "workspace");
  await mkdir(cwd, { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify(
      { name: "demo-repo", version: "1.0.0", description: "A small example workspace." },
      null,
      2,
    ),
  );
  await writeFile(join(cwd, "data.txt"), "answer-is-42\n");
  return cwd;
}

async function main(): Promise<void> {
  const cwd = await setupWorkspace();
  console.log(`Workspace: ${cwd}`);

  const agent = await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "user-real-example-key",
    model: { id: pickModel() },
    local: { cwd },
  });

  const run = await agent.send(
    "Inspect this workspace using the shell tool. Run `ls`, then read `package.json` and `data.txt`. Summarize what the repo is about in one sentence and include the value from data.txt.",
  );

  for await (const event of run.stream()) {
    if (event.type === "tool_call" && event.status === "running") {
      const args = event.args as Record<string, unknown> | undefined;
      const command =
        typeof args?.command === "string" ? args.command : JSON.stringify(args ?? {});
      console.log(`→ shell: ${command}`);
    } else if (event.type === "tool_call" && event.status === "completed") {
      const stdout = (event.result as { stdout?: string } | undefined)?.stdout ?? "";
      console.log(`← ${stdout.trim().slice(0, 120)}`);
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
  console.error("Shell-tool example failed:", cause);
  process.exit(1);
});
