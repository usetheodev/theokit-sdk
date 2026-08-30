import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { defaultIndexPath } from "../src/internal/memory/index-db.js";
import { collectMarkdownFiles } from "../src/internal/memory/index-manager-helpers.js";
import {
  appendFact,
  appendFactToMarkdown,
  readFactsFromMarkdown,
} from "../src/internal/memory/storage/markdown-store.js";
import {
  claudeProjectMemoryDir,
  memoryReadRoots,
  projectMemoryDir,
  resolveMemoryRoot,
} from "../src/internal/memory/storage/memory-root.js";

/*
 * One resolver, one root (theokit-sdk#463).
 *
 * `appendFact` used to relocate on `local.sessionDir` while thirteen other call sites — the
 * indexer, the `memory_get` path guard, `MEMORY.md`, `sessions/`, `notes/`, the index database —
 * stayed on `<cwd>/.theokit/memory`. A relocated fact was therefore written, never indexed, and
 * unreadable by the tool meant to read it, while a second `MEMORY.md` appeared beside it.
 *
 * Two changes close it. The location is now its own option (`memory.directory`) instead of a side
 * effect of the option that names the transcript home, and every path in the subsystem derives
 * from `resolveMemoryRoot`. What did NOT change is the read: the CLI's own store is still covered,
 * so decoupling the write orphans nothing.
 */

const CONFIG = { enabled: true } as const;

describe("resolveMemoryRoot — the one answer to where memory lives", () => {
  it("test_the_default_is_the_project_store_under_cwd", () => {
    expect(resolveMemoryRoot("/work")).toBe(join("/work", ".theokit", "memory"));
  });

  it("test_an_absolute_directory_is_used_exactly_as_given", () => {
    expect(resolveMemoryRoot("/work", { ...CONFIG, directory: "/srv/mem" })).toBe("/srv/mem");
  });

  it("test_a_tilde_directory_is_expanded_against_the_home_directory", () => {
    expect(resolveMemoryRoot("/work", { ...CONFIG, directory: "~/mem" })).toBe(
      join(homedir(), "mem"),
    );
  });

  it("test_a_relative_directory_is_refused_rather_than_resolved_against_something", () => {
    expect(() => resolveMemoryRoot("/work", { ...CONFIG, directory: "mem" })).toThrowError(
      /absolute path or start with/i,
    );
  });

  it("test_a_blank_directory_is_refused_instead_of_silently_meaning_the_default", () => {
    expect(() => resolveMemoryRoot("/work", { ...CONFIG, directory: "   " })).toThrowError(
      /absolute path or start with/i,
    );
  });

  it("test_the_refusal_carries_a_typed_code_so_a_caller_can_branch_on_it", () => {
    try {
      resolveMemoryRoot("/work", { ...CONFIG, directory: "mem" });
      expect.unreachable("a relative directory must be refused");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("invalid_memory_directory");
    }
  });
});

describe("memoryReadRoots — write one, read all", () => {
  it("test_it_covers_the_configured_root_the_project_store_and_the_cli_store", () => {
    const roots = memoryReadRoots("/work", { ...CONFIG, directory: "/srv/mem" });
    expect(roots).toContain("/srv/mem");
    expect(roots).toContain(join("/work", ".theokit", "memory"));
    expect(roots).toContain(claudeProjectMemoryDir("/work"));
  });

  it("test_it_lists_each_directory_once_when_the_configured_root_is_the_default", () => {
    const roots = memoryReadRoots("/work", CONFIG);
    expect(new Set(roots).size).toBe(roots.length);
  });
});

describe("a fact written into a configured memory directory", () => {
  let cwd: string;
  let dir: string;
  let config: { enabled: true; directory: string };

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "mr-cwd-"));
    dir = mkdtempSync(join(tmpdir(), "mr-dir-"));
    config = { enabled: true, directory: dir };
  });

  it("test_it_lands_in_the_configured_directory", async () => {
    await appendFact(cwd, config, { text: "MOVED-FACT" });
    expect(existsSync(join(dir, "moved-fact.md"))).toBe(true);
  });

  it("test_the_project_store_gets_no_second_index_pointing_at_files_it_does_not_have", async () => {
    await appendFact(cwd, config, { text: "MOVED-FACT" });
    expect(existsSync(join(dir, "MEMORY.md"))).toBe(true);
    expect(existsSync(join(cwd, ".theokit", "memory", "MEMORY.md"))).toBe(false);
  });

  // The half that was broken: written, and then invisible to everything that reads.
  it("test_the_indexer_scans_the_configured_directory_so_the_fact_is_searchable", async () => {
    await appendFact(cwd, config, { text: "MOVED-FACT" });
    const files = await collectMarkdownFiles(resolveMemoryRoot(cwd, config));
    expect(files.map((f) => f.absolutePath)).toContain(join(dir, "moved-fact.md"));
  });

  // The DATABASE deliberately does NOT follow the configured root, and this is the one place where
  // "one root" stops. `memory.directory` may name the directory the Claude Code CLI manages; that
  // CLI has no index format, so a binary artefact it does not understand does not belong there.
  // The facts are what a user would lose — the index is derived and rebuildable
  // (`docs/memory-decisions.md` § 1). What IS indexed is the configured root; only the file moves.
  it("test_the_index_database_stays_in_the_project_store_even_when_the_facts_move", async () => {
    const { IndexManager } = await import("../src/internal/memory/index-manager.js");
    const index = await IndexManager.open({
      cwd,
      memoryRoot: resolveMemoryRoot(cwd, config),
    });
    try {
      expect(existsSync(join(projectMemoryDir(cwd), ".index", "memory.sqlite"))).toBe(true);
      expect(existsSync(join(dir, ".index", "memory.sqlite"))).toBe(false);
    } finally {
      index.close?.();
    }
  });

  it("test_the_path_helper_still_places_the_database_under_whatever_root_it_is_given", () => {
    expect(defaultIndexPath(resolveMemoryRoot(cwd, config))).toBe(
      join(dir, ".index", "memory.sqlite"),
    );
  });

  it("test_facts_recorded_before_the_directory_was_configured_are_still_read", async () => {
    mkdirSync(join(cwd, ".theokit", "memory"), { recursive: true });
    writeFileSync(
      join(cwd, ".theokit", "memory", "older.md"),
      "---\nname: older\ndescription: older\nmetadata:\n  node_type: memory\n---\n\nOLD-FACT.\n",
    );
    await appendFact(cwd, config, { text: "NEW-FACT" });
    const all = (await readFactsFromMarkdown(cwd, config)).map((f) => f.text).join(" ");
    expect(all).toContain("OLD-FACT");
    expect(all).toContain("NEW-FACT");
  });
});

describe("the default path, which must keep working", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "mr-def-"));
  });

  it("test_without_a_configured_directory_a_fact_lands_in_the_project_store", async () => {
    await appendFact(cwd, CONFIG, { text: "PLAIN-FACT" });
    expect(existsSync(join(cwd, ".theokit", "memory", "plain-fact.md"))).toBe(true);
  });

  it("test_a_disabled_config_still_touches_no_disk", async () => {
    await appendFact(cwd, { enabled: false }, { text: "NOPE" });
    expect(existsSync(join(cwd, ".theokit", "memory"))).toBe(false);
  });

  it("test_appendFactToMarkdown_still_takes_an_explicit_target_directory", async () => {
    const target = mkdtempSync(join(tmpdir(), "mr-tgt-"));
    await appendFactToMarkdown(cwd, { text: "EXPLICIT-FACT" }, target);
    expect(existsSync(join(target, "explicit-fact.md"))).toBe(true);
  });
});
