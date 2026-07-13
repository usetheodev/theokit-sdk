/**
 * Personalities — switch an agent to a named personality and inspect the resolved preset.
 * Deterministic: usePersonality resolves a `.theokit/personalities/<name>.md` from disk (no LLM).
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Agent } from "@theokit/sdk";

const here = dirname(fileURLToPath(import.meta.url));

// Seed a personality preset so the example is self-contained.
const personalityDir = join(here, ".theokit", "personalities");
mkdirSync(personalityDir, { recursive: true });
writeFileSync(
  join(personalityDir, "reviewer.md"),
  [
    "---",
    "name: reviewer",
    "description: A terse, exacting code reviewer.",
    "tags: [engineering, review]",
    "---",
    "You are a senior code reviewer. Be terse. Flag correctness and security issues first.",
    "",
  ].join("\n"),
);

const agent = await Agent.create({
  apiKey: "theo_test_persona",             // fixture key — no LLM
  model: { id: "openai/gpt-4o-mini" },
  local: { cwd: here, settingSources: ["project"] },
});

const preset = await agent.usePersonality?.("reviewer");
console.log("name:       ", preset?.name);
console.log("description:", preset?.description);
console.log("tags:       ", preset?.tags?.join(", "));
console.log("source:     ", preset?.source);

await agent.dispose?.();

// --- validate output (assert) ---
assert.equal(preset?.name, "reviewer");
assert.equal(preset?.source, "project");
