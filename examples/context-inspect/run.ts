/**
 * Context — enable file context and inspect exactly what the agent loaded, with agent.context.snapshot().
 *
 * Deterministic: creating the agent and reading the snapshot is a local file read — no LLM call.
 * `context: {}` turns on the file context manager; `settingSources: ["project"]` opts in to reading
 * project files. The manager discovers AGENTS.md / CLAUDE.md / THEO.md from the working directory.
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Agent } from "@theokit/sdk";

const here = dirname(fileURLToPath(import.meta.url));

// Seed a project context file next to this script so the example is self-contained.
writeFileSync(
  join(here, "AGENTS.md"),
  "# Project context\n\nThe `ship` command deploys to production. Always run the test suite before shipping.\n",
);

const agent = await Agent.create({
  apiKey: "theo_test_context",             // fixture key — no network, no LLM
  model: { id: "openai/gpt-4o-mini" },
  local: {
    cwd: here,
    settingSources: ["project"],           // opt in to reading project files
  },
  context: {},                              // enable the file context manager
});

const snap = await agent.context?.snapshot();
console.log("Runtime:", snap?.runtime);

// snapshot().sources lists every context file the manager resolved. We look up the
// AGENTS.md this example ships (its name is prefixed with the file's relative path).
const agents = snap?.sources?.find((s) => s.name.startsWith("AGENTS.md"));
console.log("AGENTS.md status:", agents?.status ?? "not found");

await agent.dispose?.();

// --- validate output (assert) ---
assert.equal(agents?.status, "included");
