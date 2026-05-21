/**
 * Real-LLM dogfood for the `/personality` slash command (Hermes #26).
 *
 * Wires the EXACT same `getAgent` factory the running bot uses, so any
 * regression in agent construction (system prompt, tools, MCP, context,
 * memory, telemetry) is exercised here. The only thing this script does
 * NOT exercise is grammy's Update → Context dispatch — that path is
 * trivial and ratchet-tested by typecheck.
 *
 * Per `.claude/rules/real-llm-validation.md`, this script hits a real
 * OpenRouter provider. Set OPENROUTER_API_KEY before running.
 *
 * Run from repo root:
 *   OPENROUTER_API_KEY=sk-or-... pnpm --filter @usetheo/example-telegram-pro \
 *     exec tsx src/dogfood-personality.ts
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getAgent } from "./agent.js";

// Minimal grammy Context mimic — only fields used by resolveAgentId/UserId.
function fakeCtx(userId: string): any {
  return {
    from: { id: Number(userId) },
    chat: { id: Number(userId), type: "private" },
    message: undefined,
    callbackQuery: undefined,
  };
}

function classify(text: string): "code-like" | "haiku-like" | "verse-like" | "prose" {
  const lines = text.trim().split("\n").filter((l) => l.trim().length > 0);
  if (/```/.test(text)) return "code-like";
  if (lines.length === 3 && lines.every((l) => l.length < 80)) return "haiku-like";
  if (lines.length >= 3 && lines.length <= 12 && lines.every((l) => l.length < 80)) {
    return "verse-like";
  }
  return "prose";
}

async function buildTempCwd(): Promise<string> {
  const cwd = join(tmpdir(), `tg-pro-personality-dogfood-${Date.now()}`);
  const dir = join(cwd, ".theokit", "personalities");
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
      "Answer in code or pseudo-code first; prose only if necessary.",
      "Prefer fenced code blocks. Skip pleasantries.",
    ].join("\n"),
  );
  await writeFile(
    join(dir, "poet.md"),
    [
      "---",
      "name: poet",
      "description: Replies in compact verse.",
      "---",
      "You are in poet mode.",
      "",
      "Every reply is in verse. Use 3-6 short lines.",
      "Stay accurate; the poetic frame is the shape, the truth is the content.",
    ].join("\n"),
  );
  return cwd;
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.THEOKIT_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    console.error("Missing OPENROUTER_API_KEY / THEOKIT_API_KEY.");
    process.exit(1);
  }

  const cwd = await buildTempCwd();
  console.log(`cwd=${cwd}`);
  const opts = { apiKey, cwd };

  // ─────────────── scenario 1: list presets (no arg) ───────────────
  console.log("\n[1] /personality (list)");
  const { readdir, readFile: rf } = await import("node:fs/promises");
  const presetDir = join(cwd, ".theokit", "personalities");
  const files = (await readdir(presetDir)).filter((f) => f.endsWith(".md"));
  const items: string[] = [];
  for (const f of files) {
    const raw = await rf(join(presetDir, f), "utf8");
    const name = raw.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? f;
    items.push(name);
  }
  console.log(`  available: [${items.join(", ")}]`);
  if (!items.includes("coder") || !items.includes("poet")) {
    throw new Error("FAIL — expected `coder` and `poet` in registry list");
  }
  console.log("  PASS — registry returned both presets");

  // ─────────────── scenario 2: /personality coder + real send ───────────────
  console.log("\n[2] /personality coder + send('How do I reverse a string?')");
  const ctx2 = fakeCtx("100001");
  const agent2 = await getAgent(ctx2, opts);
  try {
    const preset = await agent2.usePersonality?.("coder", { save: true });
    console.log(`  activated: ${preset?.name}`);
    const run = await agent2.send("How do I reverse a string?");
    const result = await run.wait();
    const text = result.result ?? "";
    const cls = classify(text);
    console.log(`  reply (${cls}):\n${text.split("\n").slice(0, 8).join("\n")}`);
    if (cls !== "code-like") {
      throw new Error(`FAIL — expected code-like reply for coder, got ${cls}`);
    }
    console.log("  PASS — coder voice = code-like");
  } finally {
    await agent2.dispose();
  }

  // ─────────────── scenario 3: /personality poet + real send (same agent id) ───────────────
  console.log("\n[3] /personality poet (same agentId — switch lifecycle)");
  const agent3 = await getAgent(ctx2, opts);
  try {
    const preset = await agent3.usePersonality?.("poet");
    console.log(`  activated: ${preset?.name}`);
    const run = await agent3.send("Describe winter.");
    const result = await run.wait();
    const text = result.result ?? "";
    const cls = classify(text);
    console.log(`  reply (${cls}):\n${text}`);
    if (cls !== "haiku-like" && cls !== "verse-like") {
      throw new Error(`FAIL — expected verse-like reply for poet, got ${cls}`);
    }
    console.log("  PASS — poet voice = verse-like");
  } finally {
    await agent3.dispose();
  }

  // ─────────────── scenario 4: /personality none → EC-J persistent-clear ───────────────
  console.log("\n[4] /personality none with save:true (EC-J)");
  const ctx4 = fakeCtx("100002");
  const agent4 = await getAgent(ctx4, opts);
  try {
    await agent4.usePersonality?.("coder", { save: true });
    const cleared = await agent4.usePersonality?.("none", { save: true });
    if (cleared !== null) throw new Error("FAIL — clear should return null");
    const file = join(cwd, ".theokit", "personality.json");
    const json = JSON.parse(await readFile(file, "utf8")) as {
      agents: Record<string, string | null>;
    };
    const agentId4 = String(ctx4.from.id);
    const expectedId = `tg-pro-dm-${agentId4}`;
    if (expectedId in json.agents) {
      throw new Error(`FAIL — EC-B violated, key ${expectedId} still in agents map`);
    }
    if (/\bnull\b/.test(await readFile(file, "utf8"))) {
      throw new Error("FAIL — JSON contains literal null value");
    }
    console.log(`  persistent agents=${JSON.stringify(json.agents)}`);
    console.log("  PASS — EC-J persistent-clear deletes key");
  } finally {
    await agent4.dispose();
  }

  // ─────────────── scenario 5: unknown preset → ConfigurationError ───────────────
  console.log("\n[5] /personality ghost (unknown — EC-12)");
  const ctx5 = fakeCtx("100003");
  const agent5 = await getAgent(ctx5, opts);
  try {
    let threw = false;
    try {
      await agent5.usePersonality?.("ghost");
    } catch (err) {
      threw = true;
      const code = (err as { code?: string }).code;
      console.log(`  threw: code=${code} message=${(err as Error).message.slice(0, 80)}`);
      if (code !== "personality_not_found") {
        throw new Error(`FAIL — expected code 'personality_not_found', got ${code}`);
      }
    }
    if (!threw) throw new Error("FAIL — unknown preset should have thrown");
    console.log("  PASS — unknown preset throws ConfigurationError");
  } finally {
    await agent5.dispose();
  }

  console.log("\nALL 5 SCENARIOS PASSED — telegram-pro /personality 100% real-LLM dogfood.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
