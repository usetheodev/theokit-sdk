import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Agent } from "@usetheo/sdk";

/**
 * Hooks-policy example. Writes a `.theokit/hooks.json` that runs a
 * `preToolUse` policy script before every shell call. The script reads
 * the JSON payload on stdin and exits non-zero (=== deny) when the
 * command string contains `rm`, `sudo`, or `>>`.
 *
 * The agent is prompted to do one safe thing (`ls`) and one dangerous
 * thing (`rm -rf .`). The hook lets the first through and blocks the
 * second; the second tool_call therefore comes back with exitCode 126
 * and the hook's reason in stderr.
 *
 * Demonstrates:
 *  - File-based hooks (no programmatic callbacks).
 *  - `preToolUse` running against every tool dispatch.
 *  - Hook denial surfaces as `exitCode: 126` on the tool_call event.
 */

function pickModel(): string {
  if (process.env.ANTHROPIC_API_KEY) return "claude-sonnet-4-5-20250929";
  if (process.env.OPENAI_API_KEY) return "gpt-4o-mini";
  if (process.env.OPENROUTER_API_KEY) return "openai/gpt-4o-mini";
  throw new Error("Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in .env.");
}

const POLICY_SCRIPT = `#!/usr/bin/env node
let data = "";
process.stdin.on("data", (chunk) => {
  data += chunk;
});
process.stdin.on("end", () => {
  try {
    const payload = JSON.parse(data);
    const cmd =
      (payload.input && typeof payload.input.command === "string"
        ? payload.input.command
        : "") || "";
    if (/(^|\\s)(rm|sudo)\\s|>>/.test(cmd)) {
      process.stderr.write("Policy denied: dangerous shell command (" + cmd + ")");
      process.exit(1);
    }
  } catch (_) {
    // fall through — allow
  }
  process.exit(0);
});
`;

async function setupWorkspace(): Promise<string> {
  const cwd = join(process.cwd(), "workspace");
  await mkdir(join(cwd, ".theokit"), { recursive: true });
  await writeFile(
    join(cwd, ".theokit", "policy.js"),
    POLICY_SCRIPT,
    { mode: 0o755 },
  );
  await writeFile(
    join(cwd, ".theokit", "hooks.json"),
    JSON.stringify(
      {
        hooks: {
          preToolUse: [
            { matcher: "^shell$", command: "node .theokit/policy.js" },
          ],
        },
      },
      null,
      2,
    ),
  );
  await writeFile(join(cwd, "README.md"), "# demo workspace\n");
  return cwd;
}

async function main(): Promise<void> {
  const cwd = await setupWorkspace();
  console.log(`Workspace: ${cwd}`);

  const agent = await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "user-real-example-key",
    model: { id: pickModel() },
    local: { cwd, settingSources: ["project"] },
  });

  const run = await agent.send(
    "First run `ls` in the workspace. Then run `rm -rf .` to clean it up. Tell me the result of each.",
  );

  for await (const event of run.stream()) {
    if (event.type === "tool_call" && event.status === "running") {
      const args = event.args as Record<string, unknown> | undefined;
      const command =
        typeof args?.command === "string" ? args.command : JSON.stringify(args ?? {});
      console.log(`→ shell: ${command}`);
    } else if (event.type === "tool_call" && event.status === "completed") {
      const result = event.result as
        | { stdout?: string; stderr?: string; exitCode?: number }
        | undefined;
      const code = result?.exitCode ?? 0;
      const stdout = (result?.stdout ?? "").trim();
      const stderr = (result?.stderr ?? "").trim();
      if (code === 126) {
        console.log(`✖ blocked by hook (exit 126): ${stderr}`);
      } else {
        console.log(`✓ exit ${code}: ${stdout.slice(0, 120)}`);
      }
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
  console.error("Hooks example failed:", cause);
  process.exit(1);
});
