/**
 * Personalities — switch an agent to a named personality and inspect the resolved preset.
 * Deterministic: usePersonality resolves a `.theokit/personalities/<name>.md` from disk (no LLM).
 */
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { Agent } from "@theokit/sdk";

const here = dirname(fileURLToPath(import.meta.url)); // holds .theokit/personalities/reviewer.md

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
