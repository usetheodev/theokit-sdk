import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadSubagents } from "../../../../src/internal/runtime/skills/subagents-loader.js";
import { removeTempDirRobustSync } from "../../../helpers/temp-workspace.js";

/**
 * usetheokit/theokit-sdk#524, the visibility half.
 *
 * > whatever is imported should be reportable — `/hooks` and `/status` in a consumer cannot today
 * > say that three of their hooks came from a directory the user never mentioned. Silent
 * > inheritance is what made this take a debugging session to notice.
 *
 * Hooks already carry `sourcePath`, and a discovered `Skill` already carries `source`. A subagent
 * carried nothing: `readSubagentsFrom` computes the file path on the line it reads the file, then
 * drops it. So a consumer listing its subagents could not say which came from `.claude/agents/` —
 * the precise question this issue exists to make answerable.
 *
 * The field is OPTIONAL because a subagent may also arrive from `AgentOptions.subagents`, declared
 * in code. Absent means "you passed this one in", which is a different fact from "read from disk",
 * and flattening the two would trade one silence for another.
 */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) removeTempDirRobustSync(d);
});

function workspaceWithAgent(root: string): string {
  const ws = mkdtempSync(join(tmpdir(), "subagent-source-"));
  dirs.push(ws);
  const agents = join(ws, root, "agents");
  mkdirSync(agents, { recursive: true });
  writeFileSync(
    join(agents, "analyst.md"),
    "---\nname: analyst\ndescription: reads things\n---\n\nBody.\n",
  );
  return ws;
}

describe("a subagent reports the file it was read from", () => {
  it("names the path when it came from the native root", async () => {
    const ws = workspaceWithAgent(".theokit");

    const loaded = await loadSubagents(ws, true, undefined, []);

    expect(loaded.analyst?.source).toBe(join(ws, ".theokit", "agents", "analyst.md"));
  });

  it("names the FOREIGN path, which is the question the issue asks", async () => {
    const ws = workspaceWithAgent(".claude");

    const loaded = await loadSubagents(ws, true, undefined, ["claude-code"]);

    expect(loaded.analyst?.source).toBe(join(ws, ".claude", "agents", "analyst.md"));
  });

  it("leaves it absent for a subagent declared in code", async () => {
    const inline = { analyst: { description: "inline", prompt: "Body." } };

    const loaded = await loadSubagents(tmpdir(), false, inline, []);

    expect(loaded.analyst?.source).toBeUndefined();
  });
});
