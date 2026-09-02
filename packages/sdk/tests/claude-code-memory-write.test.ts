import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, onTestFinished } from "vitest";
import {
  appendFact,
  appendFactToMarkdown,
  readFactsFromMarkdown,
} from "../src/internal/memory/storage/markdown-store.js";
import {
  claudeProjectMemoryDir,
  projectMemoryDir,
  resolveMemoryRoot,
} from "../src/internal/memory/storage/memory-root.js";
import { removeTempDirRobustSync } from "./helpers/temp-workspace.js";

/*
 * Writing where the Claude Code CLI reads.
 *
 * The format converged in #389 and reading both stores landed with the rest of the compatibility
 * work, which made the CLI's memories visible here. The other direction did not: everything this
 * SDK recorded went to `<cwd>/.theokit/memory`, so a memory its agent wrote was invisible to the
 * CLI in the same project.
 *
 * The switch USED to be `local.sessionDir` — the option that names the transcript home — on the
 * reasoning that a consumer who set it had already said they share state with the CLI. That was
 * one option answering two questions, and only one of fourteen call sites heard the second answer:
 * the fact moved, while the indexer, the `memory_get` guard, `MEMORY.md`, `sessions/` and the index
 * database all stayed behind (#463). Written, unindexed, unreadable.
 *
 * It is now `memory.directory`, and every path derives from `resolveMemoryRoot`. The rule that made
 * the old design safe is unchanged and still what makes this one safe — WRITE ONE, READ ALL.
 */
describe("memory.directory — where a new fact lands", () => {
  it("test_without_it_the_root_is_the_project_store_exactly_as_before", () => {
    expect(resolveMemoryRoot("/work")).toBe(projectMemoryDir("/work"));
  });

  it("test_pointing_it_at_the_cli_store_is_how_a_fact_reaches_the_cli", () => {
    const cliStore = claudeProjectMemoryDir("/work");
    expect(resolveMemoryRoot("/work", { enabled: true, directory: cliStore })).toBe(cliStore);
  });

  it("test_the_transcript_home_no_longer_decides_where_memory_goes", () => {
    // `local.sessionDir` is not part of the resolver's inputs at all — the decoupling is
    // structural rather than a branch that happens not to fire.
    expect(resolveMemoryRoot("/work", { enabled: true })).toBe(projectMemoryDir("/work"));
  });
});

describe("a fact written for the CLI", () => {
  let cwd: string;
  let cliStore: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "mw-cwd-"));
    onTestFinished(() => {
      removeTempDirRobustSync(cwd);
    });
    cliStore = mkdtempSync(join(tmpdir(), "mw-cli-"));
    onTestFinished(() => {
      removeTempDirRobustSync(cliStore);
    });
  });

  it("test_it_lands_where_the_cli_looks", async () => {
    await appendFact(cwd, { enabled: true, directory: cliStore }, { text: "SHARED-FACT" });
    expect(existsSync(join(cliStore, "shared-fact.md"))).toBe(true);
  });

  it("test_the_project_store_is_left_alone_when_a_directory_is_configured", async () => {
    await appendFact(cwd, { enabled: true, directory: cliStore }, { text: "SHARED-FACT" });
    expect(existsSync(join(projectMemoryDir(cwd), "shared-fact.md"))).toBe(false);
  });

  // Write one, read all — this is what keeps the move from orphaning anything.
  it("test_facts_recorded_before_the_move_are_still_read", async () => {
    mkdirSync(projectMemoryDir(cwd), { recursive: true });
    writeFileSync(
      join(projectMemoryDir(cwd), "older.md"),
      "---\nname: older\ndescription: older\nmetadata:\n  node_type: memory\n---\n\nOLD-FACT.\n",
    );
    const config = { enabled: true, directory: cliStore } as const;
    await appendFact(cwd, config, { text: "NEW-FACT" });
    const all = (await readFactsFromMarkdown(cwd, config)).map((f) => f.text).join(" ");
    expect(all).toContain("OLD-FACT");
    expect(all).toContain("NEW-FACT");
  });

  // The accepted case (rules/testing.md § 4.2): the default path must keep working, or "write
  // somewhere else" would have become "write nowhere" for every consumer who configured nothing.
  it("test_the_default_still_writes_to_the_project_store", async () => {
    await appendFactToMarkdown(cwd, { text: "PLAIN-FACT" }, projectMemoryDir(cwd));
    expect(existsSync(join(projectMemoryDir(cwd), "plain-fact.md"))).toBe(true);
  });
});
