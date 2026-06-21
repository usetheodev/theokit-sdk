import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  readProjectInstructions,
  writeProjectInstructions,
} from "../src/internal/runtime/context/project-instructions.js";

async function makeTree(): Promise<{ base: string; inner: string }> {
  const base = await mkdtemp(join(tmpdir(), "project-instr-"));
  const inner = join(base, "a", "b");
  await mkdir(inner, { recursive: true });
  return { base, inner };
}

describe("readProjectInstructions (M4-2)", () => {
  it("nearest returns the innermost file and lists all found (nearest-first)", async () => {
    const { base, inner } = await makeTree();
    try {
      await writeFile(join(base, "a", "THEO.md"), "OUTER", "utf8");
      await writeFile(join(inner, "THEO.md"), "INNER", "utf8");
      const result = await readProjectInstructions(inner);
      expect(result.content).toBe("INNER");
      expect(result.files.map((f) => f.content)).toEqual(["INNER", "OUTER"]);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("merged joins root-first (nearest content last)", async () => {
    const { base, inner } = await makeTree();
    try {
      await writeFile(join(base, "a", "THEO.md"), "OUTER", "utf8");
      await writeFile(join(inner, "THEO.md"), "INNER", "utf8");
      const result = await readProjectInstructions(inner, { scope: "merged" });
      expect(result.content).toBe("OUTER\n\nINNER");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("merged of a single file has no separator (EC-2)", async () => {
    const { base, inner } = await makeTree();
    try {
      await writeFile(join(inner, "THEO.md"), "ONLY", "utf8");
      const result = await readProjectInstructions(inner, { scope: "merged", stopDir: inner });
      expect(result.content).toBe("ONLY");
      expect(result.files).toHaveLength(1);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("returns empty when no instruction file is found", async () => {
    const { base, inner } = await makeTree();
    try {
      const result = await readProjectInstructions(inner, { stopDir: base });
      expect(result.files).toEqual([]);
      expect(result.content).toBeUndefined();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("honors a custom filename", async () => {
    const { base, inner } = await makeTree();
    try {
      await writeFile(join(inner, "CLAUDE.md"), "CLAUDE", "utf8");
      const result = await readProjectInstructions(inner, { filename: "CLAUDE.md" });
      expect(result.content).toBe("CLAUDE");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("stopDir bounds the walk (excludes ancestors above it)", async () => {
    const { base, inner } = await makeTree();
    try {
      await writeFile(join(base, "a", "THEO.md"), "OUTER", "utf8");
      await writeFile(join(inner, "THEO.md"), "INNER", "utf8");
      const result = await readProjectInstructions(inner, { stopDir: inner });
      expect(result.files.map((f) => f.content)).toEqual(["INNER"]);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("never throws on a missing/unreadable cwd", async () => {
    await expect(
      readProjectInstructions(join(tmpdir(), "does-not-exist-proj-xyz", "deep")),
    ).resolves.toEqual({ files: [], content: undefined });
  });

  it("skips a directory named like the instruction file (EC-1), never throws", async () => {
    const { base, inner } = await makeTree();
    try {
      // a DIRECTORY named THEO.md — walkUpForFile's existsSync matches it; readFile -> EISDIR
      await mkdir(join(inner, "THEO.md"), { recursive: true });
      const result = await readProjectInstructions(inner, { stopDir: inner });
      expect(result.files).toEqual([]);
      expect(result.content).toBeUndefined();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

describe("writeProjectInstructions (M4-2)", () => {
  it("writes the file with exact content", async () => {
    const base = await mkdtemp(join(tmpdir(), "project-instr-w-"));
    try {
      await writeProjectInstructions(base, "HELLO");
      const result = await readProjectInstructions(base, { stopDir: base });
      expect(result.content).toBe("HELLO");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("round-trips with the reader for a custom filename", async () => {
    const base = await mkdtemp(join(tmpdir(), "project-instr-w2-"));
    try {
      await writeProjectInstructions(base, "AGENTS-BODY", { filename: "AGENTS.md" });
      const result = await readProjectInstructions(base, { filename: "AGENTS.md", stopDir: base });
      expect(result.content).toBe("AGENTS-BODY");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
