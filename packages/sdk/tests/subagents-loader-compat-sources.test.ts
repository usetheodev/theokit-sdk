/**
 * #524 reached the agent's own subagent registry and not this selector, so the same
 * `.claude/agents/foreign.md` was delegable by name and invisible to `discoverSubagents`.
 *
 * Measured by the `theocode` session on 5.0.1, both arms in fresh trusted directories: roles in
 * `.theokit/agents/` worked, the SAME files in `.claude/agents/` gave "the `explorer` role is not
 * configured". The plumbing existed underneath; the public signature did not reach it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { discoverSubagents } from "../src/subagents-loader.js";

let cwd: string;

function writeAgent(dir: string, name: string): void {
  mkdirSync(join(cwd, dir, "agents"), { recursive: true });
  writeFileSync(
    join(cwd, dir, "agents", `${name}.md`),
    `---\nname: ${name}\ndescription: a role\n---\n\nBody.\n`,
  );
}

describe("#524 — discoverSubagents can read a declared foreign dialect", () => {
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "theokit-subagents-"));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("reads .claude/agents when the caller declares the dialect", async () => {
    writeAgent(".claude", "explorer");

    const found = await discoverSubagents(cwd, { compatSources: ["claude-code"] });

    expect(Object.keys(found), "a declared dialect must be readable by this selector").toContain(
      "explorer",
    );
  });

  it("does NOT read it when nothing is declared — the opt-in of #524 still holds", async () => {
    writeAgent(".claude", "explorer");

    // The control that makes the assertion above mean something: if this also returned the agent,
    // the option would be irrelevant and the first test would pass for the wrong reason.
    expect(Object.keys(await discoverSubagents(cwd))).not.toContain("explorer");
  });

  it("still reads the native directory, declared or not", async () => {
    writeAgent(".theokit", "native");

    expect(Object.keys(await discoverSubagents(cwd))).toContain("native");
    expect(Object.keys(await discoverSubagents(cwd, { compatSources: ["claude-code"] }))).toContain(
      "native",
    );
  });
});
