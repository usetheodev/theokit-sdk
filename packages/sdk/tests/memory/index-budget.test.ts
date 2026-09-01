import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { appendFact } from "../../src/internal/memory/storage/markdown-store.js";
import {
  claudeProjectMemoryDir,
  indexBudgetWarning,
  MEMORY_INDEX_MAX_BYTES,
  MEMORY_INDEX_MAX_LINES,
} from "../../src/internal/memory/storage/memory-root.js";

/*
 * The `MEMORY.md` budget (#463 follow-up).
 *
 * The interop partner loads the first 200 lines / 25KB of this index into every session and drops
 * the rest in silence. We do not: the `<memory>` block is built from the per-memory FILES, ranked
 * and capped by `selectFactsForInjection`, so our own recall does not degrade as the index grows.
 *
 * That asymmetry is the whole design. The budget is a statement about the PARTNER, it only bites
 * when `memory.directory` points at the partner's store, and it never throws — refusing to record a
 * fact because the index grew would trade a cosmetic degradation for real data loss, on a path
 * where the fact write and the index rewrite are one atomic operation.
 */

const OVER_LINES = `# Memory Index\n${Array.from({ length: MEMORY_INDEX_MAX_LINES + 5 }, (_, i) => `- [t${i}](t${i}.md) — hook`).join("\n")}\n`;

describe("indexBudgetWarning — a statement about the partner, or nothing", () => {
  it("test_it_is_silent_on_an_index_within_both_limits", () => {
    expect(indexBudgetWarning("# Memory Index\n\n- [a](a.md) — one\n", "/srv/mem")).toBeUndefined();
  });

  it("test_it_is_silent_when_the_store_is_ours_however_long_the_index_gets", () => {
    // Nobody truncates our own index — saying otherwise would be noise in every project that never
    // opted into interop.
    expect(indexBudgetWarning(OVER_LINES, "/work/.theokit/memory")).toBeUndefined();
  });

  it("test_it_speaks_when_the_configured_store_is_the_one_the_cli_reads", () => {
    const warning = indexBudgetWarning(OVER_LINES, claudeProjectMemoryDir("/work"));
    expect(warning).toBeDefined();
    expect(warning).toMatch(/Claude Code/);
  });

  it("test_it_names_the_measured_size_and_the_limit_rather_than_saying_too_big", () => {
    const warning = indexBudgetWarning(OVER_LINES, claudeProjectMemoryDir("/work")) ?? "";
    // Derived from the fixture, never hand-counted: a constant here drifts the moment the fixture
    // gains a line, and the test would then assert a number the code never produces.
    expect(warning).toContain(String(OVER_LINES.split("\n").length));
    expect(warning).toContain(String(MEMORY_INDEX_MAX_LINES));
  });

  // The claim has to be true. Our recall reads the files, not the index — so the warning may say
  // the partner drops entries, and may NOT say memory stops working.
  it("test_it_does_not_claim_our_own_recall_breaks", () => {
    const warning = indexBudgetWarning(OVER_LINES, claudeProjectMemoryDir("/work")) ?? "";
    expect(warning).not.toMatch(/recall (will )?(break|fail|stop)/i);
  });

  it("test_the_byte_limit_fires_on_its_own_when_the_line_count_is_fine", () => {
    const fat = `# Memory Index\n- [a](a.md) — ${"x".repeat(MEMORY_INDEX_MAX_BYTES + 10)}\n`;
    expect(indexBudgetWarning(fat, claudeProjectMemoryDir("/work"))).toMatch(/KB|bytes/i);
  });
});

describe("the write path", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "mib-"));
  });

  it("test_a_fact_is_still_recorded_when_the_index_is_over_budget", async () => {
    // Never throw: the fact write and the index rewrite are one atomic operation, so refusing the
    // second would lose the first.
    const dir = mkdtempSync(join(tmpdir(), "mib-store-"));
    const config = { enabled: true, directory: dir } as const;
    for (let i = 0; i < 3; i += 1) await appendFact(cwd, config, { text: `FACT-${i}` });
    expect(readFileSync(join(dir, "MEMORY.md"), "utf8")).toContain("fact-2.md");
  });

  // The wiring, not just the function: writing into a CLI-shaped store with an over-budget index
  // has to actually reach stderr, or the diagnostic exists and nobody ever sees it.
  it("test_writing_into_the_cli_store_over_budget_reports_it", async () => {
    const claudeHome = mkdtempSync(join(tmpdir(), "mib-home-"));
    const previous = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = claudeHome;
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const dir = claudeProjectMemoryDir(cwd);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "MEMORY.md"), OVER_LINES);
      await appendFact(cwd, { enabled: true, directory: dir }, { text: "ONE-MORE-FACT" });

      const said = spy.mock.calls.map((c) => String(c[0])).join("");
      expect(said).toMatch(/Claude Code CLI loads only the first/);
      // And the fact still landed — the diagnostic never replaces the write. Read the directory
      // rather than guessing the slug: how a fact is named is `slugForFact`'s contract, tested
      // where it lives, and asserting it here would couple this test to a rule it is not about.
      const written = readdirSync(dir)
        .filter((f) => f.endsWith(".md") && f !== "MEMORY.md")
        .map((f) => readFileSync(join(dir, f), "utf8"))
        .join("\n");
      expect(written).toContain("ONE-MORE-FACT");
    } finally {
      spy.mockRestore();
      if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previous;
    }
  });

  it("test_a_write_within_budget_emits_no_diagnostic", async () => {
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      await appendFact(cwd, { enabled: true }, { text: "SMALL-FACT" });
      const said = spy.mock.calls.map((c) => String(c[0])).join("");
      expect(said).not.toMatch(/Memory Index|MEMORY\.md/);
    } finally {
      spy.mockRestore();
    }
  });
});
