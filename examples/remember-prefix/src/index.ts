import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Agent } from "@usetheo/sdk";

/**
 * Auto-write opt-in via the `Remember:` prefix.
 *
 * When `memory.enabled === true`, a user message starting with `Remember:`
 * (or `Remember this durable preference:`) causes the SDK to extract the
 * fact text and persist it to `.theokit/memory/MEMORY.md` BEFORE the LLM
 * call. The fact is durable even if the LLM call fails.
 *
 * Secrets matching `sk-*`, `ghp_*`, or `sk-proj-*` are redacted to `***`
 * before write (ADR D9).
 */
async function main(): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "theokit-remember-"));
  await mkdir(join(cwd, ".theokit", "memory"), { recursive: true });

  const agent = await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "theo_test_remember_prefix",
    model: { id: "google/gemini-2.0-flash-exp:free" },
    local: { cwd },
    memory: { enabled: true },
  });

  console.log("Sending 'Remember: ...' messages — facts persist BEFORE the LLM call.\n");

  const send = (msg: string) => agent.send(msg).then((r) => r.wait());

  await send("Remember: The user prefers Vitest as the test runner.");
  console.log("✓ Wrote: 'The user prefers Vitest as the test runner.'");

  await send("Remember: Production deploys go through `pnpm deploy:prod`.");
  console.log("✓ Wrote: 'Production deploys go through pnpm deploy:prod.'");

  // Secret redaction (ADR D9): the literal `sk-real-secret-token-xyz` is
  // replaced with `***` before persistence.
  await send("Remember: my API key is sk-real-secret-token-xyz.");
  console.log("✓ Wrote (with secret redacted to ***)");

  const memoryPath = join(cwd, ".theokit", "memory", "MEMORY.md");
  if (existsSync(memoryPath)) {
    console.log(`\n=== MEMORY.md contents ===\n${await readFile(memoryPath, "utf8")}`);
  }

  await agent.dispose();
}

main().catch((cause) => {
  console.error("remember-prefix failed:", cause);
  process.exit(1);
});
