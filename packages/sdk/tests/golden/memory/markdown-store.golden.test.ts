import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendFactToMarkdown,
  memoryMdPath,
  readFactsFromMarkdown,
} from "../../../src/internal/memory/markdown-store.js";
import { resetMigrationStateForTests } from "../../../src/internal/memory/migration.js";
import {
  appendMemoryFact,
  type MemoryConfig,
  readMemoryFacts,
} from "../../../src/internal/runtime/memory-store.js";

/**
 * Phase 1 T1.1 — Markdown corpus + migration + atomic writes + per-cwd mutex.
 */

const cfg: MemoryConfig = { enabled: true, namespace: "demo", scope: "agent", userId: "u1" };

describe("MarkdownMemoryStore", () => {
  let cwd: string;

  beforeEach(async () => {
    resetMigrationStateForTests();
    cwd = await mkdtemp(join(tmpdir(), "theokit-md-store-"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("appendFact + readFacts round-trip writes MEMORY.md", async () => {
    await appendMemoryFact(cwd, cfg, { text: "magic-number is 8675309" });
    const facts = await readMemoryFacts(cwd, cfg);
    expect(facts).toEqual([{ text: "magic-number is 8675309" }]);
    expect(existsSync(memoryMdPath(cwd))).toBe(true);
  });

  it("multiple appends produce a clean bulleted list under ## Facts", async () => {
    await appendMemoryFact(cwd, cfg, { text: "fact A" });
    await appendMemoryFact(cwd, cfg, { text: "fact B" });
    await appendMemoryFact(cwd, cfg, { text: "fact C" });
    const raw = await readFile(memoryMdPath(cwd), "utf8");
    expect(raw).toContain("## Facts");
    expect(raw).toMatch(/- fact A[\s\S]*- fact B[\s\S]*- fact C/);
    const facts = await readMemoryFacts(cwd, cfg);
    expect(facts.map((f) => f.text)).toEqual(["fact A", "fact B", "fact C"]);
  });

  it("migration converts legacy JSON to markdown and deletes JSON", async () => {
    const jsonDir = join(cwd, ".theokit", "memory", "demo");
    await mkdir(jsonDir, { recursive: true });
    const jsonPath = join(jsonDir, "agent-u1.json");
    await writeFile(
      jsonPath,
      JSON.stringify({ facts: [{ text: "legacy A" }, { text: "legacy B" }] }),
    );
    const facts = await readMemoryFacts(cwd, cfg);
    expect(facts.map((f) => f.text)).toEqual(["legacy A", "legacy B"]);
    expect(existsSync(memoryMdPath(cwd))).toBe(true);
    expect(existsSync(jsonPath)).toBe(false);
  });

  it("migration is idempotent — second read does nothing", async () => {
    const jsonDir = join(cwd, ".theokit", "memory", "demo");
    await mkdir(jsonDir, { recursive: true });
    await writeFile(join(jsonDir, "agent-u1.json"), JSON.stringify({ facts: [{ text: "x" }] }));
    await readMemoryFacts(cwd, cfg);
    // Reset filesystem state but keep in-process migration flag
    await writeFile(memoryMdPath(cwd), "# Memory\n\n## Facts\n\n- only-one\n", "utf8");
    const facts = await readMemoryFacts(cwd, cfg);
    expect(facts.map((f) => f.text)).toEqual(["only-one"]);
  });

  it("migration skips and warns when both legacy JSON and MEMORY.md exist", async () => {
    const jsonDir = join(cwd, ".theokit", "memory", "demo");
    await mkdir(jsonDir, { recursive: true });
    const jsonPath = join(jsonDir, "agent-u1.json");
    await writeFile(jsonPath, JSON.stringify({ facts: [{ text: "json-fact" }] }));
    await mkdir(join(cwd, ".theokit", "memory"), { recursive: true });
    await writeFile(memoryMdPath(cwd), "# Memory\n\n## Facts\n\n- md-fact\n", "utf8");
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const facts = await readMemoryFacts(cwd, cfg);
    // Markdown source wins; JSON is left intact.
    expect(facts.map((f) => f.text)).toEqual(["md-fact"]);
    expect(existsSync(jsonPath)).toBe(true);
    expect(stderr).toHaveBeenCalled();
  });

  it("redactSecrets is still applied before markdown write", async () => {
    await appendMemoryFact(cwd, cfg, {
      text: "token=sk-abcdef0123456789ghijklmn",
    });
    const raw = await readFile(memoryMdPath(cwd), "utf8");
    // T0.2 (ADR D68/D71): canonical redaction uses two-bucket masking —
    // long tokens keep prefix+suffix for debuggability instead of bare ***.
    // Security property under test is no-leak of the original secret.
    expect(raw).not.toContain("sk-abcdef0123456789ghijklmn");
    expect(raw).toMatch(/sk-[a-zA-Z0-9]{3}\.\.\.[a-zA-Z0-9]{4}/);
  });

  it("creates the ## Facts section when MEMORY.md exists without one (EC-5)", async () => {
    await mkdir(join(cwd, ".theokit", "memory"), { recursive: true });
    const path = memoryMdPath(cwd);
    await writeFile(path, "# Memory\n\nSome free-form content the user wrote.\n", "utf8");
    await appendFactToMarkdown(cwd, { text: "new fact" });
    const raw = await readFile(path, "utf8");
    expect(raw).toContain("## Facts");
    expect(raw).toContain("- new fact");
    expect(raw).toContain("Some free-form content the user wrote.");
  });

  it("serializes concurrent appendFact calls (EC-4)", async () => {
    await Promise.all([
      appendFactToMarkdown(cwd, { text: "p1" }),
      appendFactToMarkdown(cwd, { text: "p2" }),
      appendFactToMarkdown(cwd, { text: "p3" }),
      appendFactToMarkdown(cwd, { text: "p4" }),
      appendFactToMarkdown(cwd, { text: "p5" }),
    ]);
    const facts = await readFactsFromMarkdown(cwd);
    expect(facts.map((f) => f.text).sort()).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });

  it("readMemoryFacts returns [] when memory disabled", async () => {
    const facts = await readMemoryFacts(cwd, { enabled: false });
    expect(facts).toEqual([]);
  });
});
