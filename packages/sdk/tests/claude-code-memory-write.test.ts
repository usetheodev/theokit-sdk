import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  appendFactToMarkdown,
  memoryDir,
  memoryWriteDir,
  readFactsFromMarkdown,
} from "../src/internal/memory/storage/markdown-store.js";

/*
 * Writing where the Claude Code CLI reads.
 *
 * The format converged in #389 and reading both stores landed with the rest of the compatibility
 * work, which made the CLI's memories visible here. The other direction did not: everything this
 * SDK recorded went to `<cwd>/.theokit/memory`, so a memory its agent wrote was invisible to the
 * CLI in the same project.
 *
 * `local.sessionDir` is the switch, because it is already the one this project documents for CLI
 * interop — "point local.sessionDir at ~/.claude and the CLI can --continue a session your agent
 * wrote". A consumer who set it has said they share state with the CLI; memory following is what
 * that sentence already implied. No new option, and nothing moves for anyone who did not set it.
 *
 * The rule that makes this safe is WRITE ONE, READ ALL. A consumer whose writes move keeps every
 * memory they already had, because the reader covers both locations — so the change relocates where
 * new facts land and orphans nothing that exists.
 */
describe("memoryWriteDir — where a new fact lands", () => {
  it("test_without_a_session_dir_it_is_the_project_store_exactly_as_before", () => {
    expect(memoryWriteDir("/work", undefined)).toBe(memoryDir("/work"));
  });

  it("test_with_a_session_dir_it_follows_the_home_the_transcripts_use", () => {
    expect(memoryWriteDir("/work", "/home/u/.claude")).toBe(
      join("/home/u/.claude", "projects", "-work", "memory"),
    );
  });

  it("test_it_uses_the_same_cwd_encoding_as_the_transcript_so_both_land_together", () => {
    expect(memoryWriteDir("/home/u/proj x", "/h")).toContain("-home-u-proj-x");
  });
});

describe("a fact written for the CLI", () => {
  let cwd: string;
  let sessionDir: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "mw-cwd-"));
    sessionDir = mkdtempSync(join(tmpdir(), "mw-home-"));
  });

  it("test_it_lands_where_the_cli_looks", async () => {
    await appendFactToMarkdown(cwd, { text: "SHARED-FACT" }, memoryWriteDir(cwd, sessionDir));
    expect(existsSync(join(memoryWriteDir(cwd, sessionDir), "shared-fact.md"))).toBe(true);
  });

  it("test_the_project_store_is_left_alone_when_a_session_dir_is_set", async () => {
    await appendFactToMarkdown(cwd, { text: "SHARED-FACT" }, memoryWriteDir(cwd, sessionDir));
    expect(existsSync(join(memoryDir(cwd), "shared-fact.md"))).toBe(false);
  });

  // Write one, read all — this is what keeps the move from orphaning anything.
  it("test_facts_recorded_before_the_move_are_still_read", async () => {
    mkdirSync(memoryDir(cwd), { recursive: true });
    writeFileSync(
      join(memoryDir(cwd), "older.md"),
      "---\nname: older\ndescription: older\nmetadata:\n  node_type: memory\n---\n\nOLD-FACT.\n",
    );
    await appendFactToMarkdown(cwd, { text: "NEW-FACT" }, memoryWriteDir(cwd, sessionDir));
    const all = (await readFactsFromMarkdown(cwd, sessionDir)).map((f) => f.text).join(" ");
    expect(all).toContain("OLD-FACT");
    expect(all).toContain("NEW-FACT");
  });

  // The accepted case (rules/testing.md § 4.2): the default path must keep working, or "write
  // somewhere else" would have become "write nowhere" for every consumer who set no session dir.
  it("test_the_default_still_writes_to_the_project_store", async () => {
    await appendFactToMarkdown(cwd, { text: "PLAIN-FACT" }, memoryWriteDir(cwd, undefined));
    expect(existsSync(join(memoryDir(cwd), "plain-fact.md"))).toBe(true);
  });
});
