/**
 * File-based config — `.theokit/` files augment a code-created agent.
 *
 * The agent is still created in code with `Agent.create(...)`; opting in via
 * `local.settingSources: ["project"]` makes it discover config from `.theokit/`.
 * This proves TWO conventions end-to-end:
 *
 *  1. A `.theokit/skills/<name>/SKILL.md` is DISCOVERED       — deterministic (agent.skills.list()).
 *  2. A `.theokit/context/<name>.md` is INJECTED into the run — REAL LLM: the model answers a
 *     fact it can only know from the file (its 2026 codename), proving the file reached the prompt.
 *
 * Run:
 *   export OPENROUTER_API_KEY=sk-or-...   # or put it in the repo-root .env
 *   pnpm run run
 */

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Agent } from "@theokit/sdk";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined || apiKey.length === 0) {
  throw new Error("Set OPENROUTER_API_KEY (env or .env) — see https://openrouter.ai/keys");
}

// 1. A tiny project whose `.theokit/` carries a file-based skill + a context fact.
const cwd = await mkdtemp(join(tmpdir(), "theokit-file-based-"));

await mkdir(join(cwd, ".theokit", "skills", "release-checklist"), { recursive: true });
await writeFile(
  join(cwd, ".theokit", "skills", "release-checklist", "SKILL.md"),
  [
    "---",
    "name: release-checklist",
    "description: Steps to cut a release — version bump, changelog, tag.",
    "---",
    "",
    "Run the tests, bump the version, move `[Unreleased]` into a dated section,",
    "then open the develop→main PR.",
    "",
  ].join("\n"),
);

// A `.theokit/context/<name>.md` names a real project file via `path:`; that file's
// content is injected (the .md body is just prose explaining the source).
await writeFile(
  join(cwd, "PRODUCT.md"),
  "# Product facts\n\nThe internal codename for our 2026 flagship release is **Project Halcyon**.\n",
);
await mkdir(join(cwd, ".theokit", "context"), { recursive: true });
await writeFile(
  join(cwd, ".theokit", "context", "product-facts.md"),
  ["---", "name: product-facts", "path: PRODUCT.md", "---", "", "Internal product facts, injected as agent context.", ""].join("\n"),
);

// 2. A code-created agent that OPTS IN to reading `.theokit/` from cwd.
const agent = await Agent.create({
  apiKey,
  model: { id: "openai/gpt-4o-mini" },
  systemPrompt: "You are a concise assistant. Use the provided project context when answering.",
  local: { cwd, settingSources: ["project"], sandboxOptions: { enabled: false } },
  context: { manager: "file" },
});

// 3. Deterministic — the file-based skill was discovered from disk.
const skills = (await agent.skills?.list()) ?? [];
console.log("discovered skills:", skills.map((s) => s.name).join(", ") || "(none)");

// The file-based context source shows up in the redacted snapshot.
const sources = (await agent.context.snapshot()).sources.map((s) => s.name ?? s.path ?? "");
console.log("context sources:  ", sources.join(", ") || "(none)");

// 4. REAL LLM — the model answers from the file-based context, a fact it cannot guess.
const run = await agent.send(
  "What is the internal codename for our 2026 flagship release? Answer with just the codename.",
);
const result = await run.wait();
console.log("status:", result.status);
console.log("model: ", result.model);
console.log("reply: ", result.result);

await agent.dispose();

// 5. Validate — fail loud (non-zero exit) on any miss.
const failures: string[] = [];
if (!skills.some((s) => s.name === "release-checklist")) {
  failures.push("file-based skill `release-checklist` was not discovered");
}
if (result.status !== "finished") {
  failures.push(`run did not finish: ${JSON.stringify(result.error ?? result.status)}`);
}
if (typeof result.result !== "string" || !/halcyon/i.test(result.result)) {
  failures.push(`model did not use file-based context (reply: ${JSON.stringify(result.result)})`);
}
if (failures.length > 0) {
  console.error("VALIDATION FAILED:", failures.join("; "));
  process.exit(1);
}
console.log("OK — .theokit/ skill discovered + file-based context reached the LLM.");
