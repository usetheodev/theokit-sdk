/**
 * Real-LLM dogfood for personality presets (Hermes #26, ADRs D160-D169).
 *
 * Per `.claude/rules/real-llm-validation.md`, this script MUST hit a real
 * provider for the validation to count. Fixture mode does not satisfy the
 * acceptance criteria for any flow that exercises `agent.send()`.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-... node --import tsx examples/personality-presets/dogfood.ts
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Agent } from "@usetheo/sdk";

const MODEL = "openai/gpt-4o-mini";

async function buildWorkspace(): Promise<string> {
  const cwd = join(tmpdir(), `theokit-personality-dogfood-${Date.now()}`);
  const dir = join(cwd, ".theokit/personalities");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "coder.md"),
    [
      "---",
      "name: coder",
      "description: Concise, technical, code-first replies.",
      "---",
      "You are in coder mode.",
      "",
      "Answer in code or pseudo-code first.",
      "Skip pleasantries and filler.",
      "Limit prose to at most one sentence after the code block.",
    ].join("\n"),
  );
  await writeFile(
    join(dir, "haiku.md"),
    [
      "---",
      "name: haiku",
      "description: Replies in strict 5/7/5 haiku.",
      "---",
      "You are in haiku mode.",
      "",
      "Every reply MUST be a 5/7/5 haiku. No prose. No code. No exceptions.",
      "Three lines exactly.",
    ].join("\n"),
  );
  return cwd;
}

function classify(text: string): "code-like" | "haiku-like" | "prose" {
  const lines = text.trim().split("\n");
  const hasCodeFence = /```/.test(text);
  if (hasCodeFence) return "code-like";
  if (lines.length === 3 && lines.every((l) => l.trim().length > 0 && l.length < 60)) {
    return "haiku-like";
  }
  return "prose";
}

async function main(): Promise<void> {
  const cwd = await buildWorkspace();
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    console.error("Missing OPENROUTER_API_KEY — this is a real-LLM probe (see .claude/rules/real-llm-validation.md).");
    process.exit(1);
  }

  console.log(`workspace=${cwd}`);
  console.log(`model=${MODEL}`);

  // Scenario 1: activate coder → response should look code-like.
  let agent = await Agent.create({
    apiKey,
    model: { id: MODEL },
    local: { cwd },
    agentId: "personality-dogfood-1",
  });
  console.log("scenario 1: usePersonality('coder') + 'how do I reverse a string?'");
  const preset1 = await agent.usePersonality?.("coder");
  console.log(`  activated: ${preset1?.name}`);
  const run1 = await agent.send("How do I reverse a string?");
  const result1 = await run1.wait();
  const text1 = result1.result ?? "";
  console.log(`  reply (${classify(text1)}):\n${text1.slice(0, 300)}`);
  await agent.dispose();

  // Scenario 2: activate haiku on a fresh agent → response should be 3 short lines.
  agent = await Agent.create({
    apiKey,
    model: { id: MODEL },
    local: { cwd },
    agentId: "personality-dogfood-2",
  });
  console.log("\nscenario 2: usePersonality('haiku') + 'describe winter'");
  const preset2 = await agent.usePersonality?.("haiku");
  console.log(`  activated: ${preset2?.name}`);
  const run2 = await agent.send("Describe winter.");
  const result2 = await run2.wait();
  const text2 = result2.result ?? "";
  console.log(`  reply (${classify(text2)}):\n${text2.slice(0, 300)}`);
  await agent.dispose();

  // Scenario 3: EC-J persistent-clear round-trip.
  agent = await Agent.create({
    apiKey,
    model: { id: MODEL },
    local: { cwd },
    agentId: "personality-dogfood-3",
  });
  console.log("\nscenario 3: save:true then clear:save:true (EC-J)");
  await agent.usePersonality?.("coder", { save: true });
  const cleared = await agent.usePersonality?.("none", { save: true });
  console.log(`  clear result: ${cleared === null ? "null (correct)" : JSON.stringify(cleared)}`);
  const { readFile } = await import("node:fs/promises");
  const json = JSON.parse(
    await readFile(join(cwd, ".theokit", "personality.json"), "utf8"),
  ) as { agents: Record<string, string | null> };
  console.log(`  persistent file agents: ${JSON.stringify(json.agents)}`);
  console.log(`  EC-B (no null entry): ${"personality-dogfood-3" in json.agents ? "FAIL" : "PASS"}`);
  await agent.dispose();

  // Cleanup.
  await rm(cwd, { recursive: true, force: true });
  console.log("\ndone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
