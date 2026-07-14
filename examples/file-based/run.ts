/**
 * File-based config — everything under `.theokit/` that augments a code-created agent.
 *
 * The agent is still made with `Agent.create(...)`; opting in via
 * `local.settingSources: ["project"]` makes it discover config from `.theokit/`.
 * This proves FIVE file-based conventions end-to-end — deterministic where a public
 * inspector exists, and against a REAL LLM where the file must actually change behavior:
 *
 *   skills   .theokit/skills/<name>/SKILL.md   → agent.skills.list()          [deterministic]
 *   context  .theokit/context/<name>.md        → answer uses a fact from disk  [REAL LLM]
 *   rules    .theokit/rules/<name>.md           → reply obeys an alwaysApply rule [REAL LLM]
 *   agents   .theokit/agents/<name>.md          → model delegates to the subagent [REAL LLM]
 *   hooks    .theokit/hooks.json                → Stop hook writes a marker file [observable]
 *
 * (MCP servers are also file-based via `.theokit/mcp.json` — see the `mcp` example, which
 * needs a live server to be meaningful.)
 *
 * Run:
 *   export OPENROUTER_API_KEY=sk-or-...   # or put it in the repo-root .env
 *   pnpm run run
 */

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Agent } from "@theokit/sdk";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined || apiKey.length === 0) {
  throw new Error("Set OPENROUTER_API_KEY (env or .env) — see https://openrouter.ai/keys");
}

// 1. A throwaway project whose `.theokit/` carries every file-based convention.
const cwd = await mkdtemp(join(tmpdir(), "theokit-file-based-"));

// skills — a capability pack (name + description reach the system prompt).
await mkdir(join(cwd, ".theokit", "skills", "release-checklist"), { recursive: true });
await writeFile(
  join(cwd, ".theokit", "skills", "release-checklist", "SKILL.md"),
  "---\nname: release-checklist\ndescription: Steps to cut a release.\n---\n\nRun tests, bump the version, tag.\n",
);

// agents — a file-based subagent; the model can delegate to it as a `fact-checker` tool.
await mkdir(join(cwd, ".theokit", "agents"), { recursive: true });
await writeFile(
  join(cwd, ".theokit", "agents", "fact-checker.md"),
  "---\ndescription: Verifies a simple factual claim and answers yes or no.\nmodel: inherit\n---\n\nYou verify one factual claim. Answer with a single word: yes or no.\n",
);

// context — a real project file, named by a `.theokit/context/<name>.md` source via `path:`.
await writeFile(
  join(cwd, "PRODUCT.md"),
  "# Product facts\n\nThe internal codename for our 2026 flagship release is **Project Halcyon**.\n",
);
await mkdir(join(cwd, ".theokit", "context"), { recursive: true });
await writeFile(
  join(cwd, ".theokit", "context", "product-facts.md"),
  "---\nname: product-facts\npath: PRODUCT.md\n---\n\nInternal product facts, injected as agent context.\n",
);

// rules — an alwaysApply rule that forces a distinctive, checkable output shape.
await mkdir(join(cwd, ".theokit", "rules"), { recursive: true });
await writeFile(
  join(cwd, ".theokit", "rules", "tone.md"),
  "---\nalwaysApply: true\n---\nAlways end every reply with the exact tag [VERIFIED].\n",
);

// hooks — a Stop hook (Claude Code shape) that writes an observable marker on turn finish.
// The command reads the JSON payload the SDK sends on stdin (`cat`) into the marker file,
// proving both that the hook fired AND that it received its payload.
await writeFile(
  join(cwd, ".theokit", "hooks.json"),
  JSON.stringify(
    { hooks: { Stop: [{ hooks: [{ type: "command", command: "cat > .hook-fired" }] }] } },
    null,
    2,
  ),
);

// 2. A code-created agent that OPTS IN to reading `.theokit/` from cwd.
const toolCalls: string[] = [];
const agent = await Agent.create({
  apiKey,
  model: { id: "openai/gpt-4o-mini" },
  systemPrompt:
    "You are a concise assistant. Use the provided project context. " +
    "To verify any factual claim, you MUST call the fact-checker tool rather than answering yourself.",
  local: { cwd, settingSources: ["project"], sandboxOptions: { enabled: false } },
  context: { manager: "file" },
  onToolStart: (e) => {
    toolCalls.push(e.toolName);
  },
});

// 3. Deterministic — the skill was discovered; context + rule are loaded into the working set.
const skills = (await agent.skills?.list()) ?? [];
const sources = (await agent.context.snapshot()).sources.map((s) => s.name ?? s.path ?? "");
console.log("discovered skills:", skills.map((s) => s.name).join(", ") || "(none)");
console.log("context sources:  ", sources.join(", ") || "(none)");

// 4a. REAL LLM — delegate to the file-based subagent (observed via onToolStart).
const r1 = await (
  await agent.send("Use your fact-checker to verify: is the sky blue? Report what it answered.")
).wait();
console.log("delegation reply: ", r1.result);
console.log("tools called:     ", toolCalls.join(", ") || "(none)");

// 4b. REAL LLM — answer from the file-based context, obeying the alwaysApply rule.
const r2 = await (
  await agent.send("What is the internal codename for our 2026 flagship release? Answer with just the codename.")
).wait();
console.log("context reply:    ", r2.result);

await agent.dispose();

// 5. The Stop hook wrote its marker on turn finish.
const hookFired = existsSync(join(cwd, ".hook-fired"));
console.log("hook marker file: ", hookFired ? "written" : "MISSING");

// 6. Validate every convention — fail loud (non-zero exit) on any miss.
const reply = `${r1.result ?? ""}\n${r2.result ?? ""}`;
const checks: Array<[string, boolean]> = [
  ["skills — release-checklist discovered", skills.some((s) => s.name === "release-checklist")],
  ["context — product-facts loaded", sources.some((n) => n.includes("product-facts"))],
  ["rules — theokit rules loaded", sources.some((n) => n.includes("rules"))],
  ["runs — both finished", r1.status === "finished" && r2.status === "finished"],
  ["agents — delegated to the fact-checker subagent", toolCalls.some((n) => /fact.?checker/i.test(n))],
  ["context — model answered from the file (Halcyon)", /halcyon/i.test(reply)],
  ["rules — model obeyed the alwaysApply rule ([VERIFIED])", /\[VERIFIED\]/i.test(reply)],
  ["hooks — Stop hook wrote its marker", hookFired],
];

const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
if (failed.length > 0) {
  console.error("\nVALIDATION FAILED:", failed.join("; "));
  process.exit(1);
}
console.log("\nOK — skills + context + rules + subagents + hooks all work from .theokit/ files.");
