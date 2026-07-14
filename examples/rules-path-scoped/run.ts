/**
 * `.theokit/rules/*.md` — theokit-native path-scoped rules (mirrors `.claude/rules/`).
 *
 * Deterministic (fixture key, no LLM). Proves that a path-scoped rule enters the agent's
 * context ONLY when a matching in-scope file is declared via `send(..., { contextPaths })`,
 * while an `alwaysApply` rule is always present.
 */
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Agent } from "@theokit/sdk";

// 1. A tiny project with two rule files under .theokit/rules/.
const cwd = await mkdtemp(join(tmpdir(), "theokit-rules-example-"));
await mkdir(join(cwd, ".theokit", "rules"), { recursive: true });
await writeFile(
  join(cwd, ".theokit", "rules", "always.md"),
  "---\nalwaysApply: true\n---\nUse tabs, not spaces.",
);
await writeFile(
  join(cwd, ".theokit", "rules", "api.md"),
  "---\ndescription: API endpoint rules\npaths:\n  - src/api/**/*.ts\n---\nEvery endpoint must validate its input.",
);

const agent = await Agent.create({
  apiKey: "theo_test_rules",               // fixture key — deterministic, no LLM
  model: { id: "openai/gpt-4o-mini" },
  local: { cwd, settingSources: ["project"] },
  context: { manager: "file" },
});

const activeFiles = async (): Promise<string[]> =>
  (await agent.context.snapshot()).sources.map((s) => (s.path ?? "").split("/").slice(-2).join("/"));

// 2. Working on an API file → the API rule activates.
await (await agent.send("Add an endpoint.", { contextPaths: ["src/api/users.ts"] })).wait();
const withApiScope = await activeFiles();
console.log("in scope [src/api/users.ts] ->", withApiScope);

// 3. Working on a UI file → the API rule stays dormant; the always-on rule remains.
await (await agent.send("Tweak the button.", { contextPaths: ["src/ui/button.tsx"] })).wait();
const withUiScope = await activeFiles();
console.log("in scope [src/ui/button.tsx] ->", withUiScope);

await agent.dispose();

// 4. Validate (fail loud, non-zero exit on mismatch).
const has = (list: string[], f: string) => list.some((p) => p.endsWith(f));
const checks: Array<[string, boolean]> = [
  ["api rule active for src/api/**", has(withApiScope, "rules/api.md")],
  ["always rule active under api scope", has(withApiScope, "rules/always.md")],
  ["api rule dormant for src/ui/**", !has(withUiScope, "rules/api.md")],
  ["always rule still active under ui scope", has(withUiScope, "rules/always.md")],
];
const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length > 0) {
  console.error("VALIDATION FAILED:", failed.join("; "));
  process.exit(1);
}
console.log("OK — path-scoped rules activate by contextPaths; alwaysApply always on.");
