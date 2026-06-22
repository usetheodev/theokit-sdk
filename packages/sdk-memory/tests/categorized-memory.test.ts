import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createCategorizedMemory as createFromBarrel } from "../src/index.js";
import { createCategorizedMemory } from "../src/internal/categorized-memory.js";
import type { MemoryFact } from "../src/internal/memory-types.js";

const CATS = ["user", "project", "feedback", "reference"] as const;

async function withRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "catmem-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("MemoryFact.category (M4-3)", () => {
  it("accepts an optional category, backward-compatible", () => {
    const flat: MemoryFact = { text: "no category" };
    const tagged: MemoryFact = { text: "with category", category: "user" };
    expect(flat.category).toBeUndefined();
    expect(tagged.category).toBe("user");
  });
});

describe("createCategorizedMemory (M4-3)", () => {
  it("add + list round-trips with the category", async () => {
    await withRoot(async (root) => {
      const m = createCategorizedMemory({ root, categories: CATS });
      await m.add("user", "prefers TypeScript");
      const facts = await m.list("user");
      expect(facts).toEqual([{ text: "prefers TypeScript", category: "user" }]);
    });
  });

  it("isolates facts between categories", async () => {
    await withRoot(async (root) => {
      const m = createCategorizedMemory({ root, categories: CATS });
      await m.add("user", "U1");
      await m.add("project", "P1");
      expect((await m.list("user")).map((f) => f.text)).toEqual(["U1"]);
      expect((await m.list("project")).map((f) => f.text)).toEqual(["P1"]);
    });
  });

  it("list() merges every category, each fact tagged", async () => {
    await withRoot(async (root) => {
      const m = createCategorizedMemory({ root, categories: CATS });
      await m.add("user", "U1");
      await m.add("feedback", "F1");
      const all = await m.list();
      const byCat = Object.fromEntries(all.map((f) => [f.text, f.category]));
      expect(byCat).toEqual({ U1: "user", F1: "feedback" });
    });
  });

  it("rejects an unknown category and writes nothing to disk (fail loud)", async () => {
    await withRoot(async (root) => {
      const m = createCategorizedMemory({ root, categories: CATS });
      await expect(m.add("nope", "x")).rejects.toMatchObject({ code: "unknown_category" });
      // no file was created at all (stronger than list() === [])
      const files = await readdir(root).catch(() => [] as string[]);
      expect(files).toEqual([]);
    });
  });

  it("redacts secrets but keeps the surrounding fact (masked, not dropped)", async () => {
    await withRoot(async (root) => {
      const m = createCategorizedMemory({ root, categories: CATS });
      await m.add("user", "my key is sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJ");
      const onDisk = await readFile(join(root, "user.md"), "utf8");
      expect(onDisk).not.toContain("AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJ");
      expect(onDisk).toContain("- my key is "); // the fact line survived, masked
      const facts = await m.list("user");
      expect(facts).toHaveLength(1);
      expect(facts[0]?.text).toContain("my key is ");
    });
  });

  it("list on a never-written category returns []", async () => {
    await withRoot(async (root) => {
      const m = createCategorizedMemory({ root, categories: CATS });
      expect(await m.list("reference")).toEqual([]);
    });
  });

  it("(EC-1) concurrent adds to one category lose nothing", async () => {
    await withRoot(async (root) => {
      const m = createCategorizedMemory({ root, categories: CATS });
      await Promise.all(Array.from({ length: 8 }, (_, i) => m.add("user", `fact-${i}`)));
      const facts = await m.list("user");
      expect(facts).toHaveLength(8);
      expect(new Set(facts.map((f) => f.text)).size).toBe(8);
    });
  });

  it("rejects empty or duplicate categories at construction", async () => {
    await withRoot(async (root) => {
      expect(() => createCategorizedMemory({ root, categories: [] })).toThrow(/categor/i);
      expect(() => createCategorizedMemory({ root, categories: ["a", "a"] })).toThrow(/categor/i);
    });
  });

  it("(EC-2) rejects categories colliding after sanitize (case)", async () => {
    await withRoot(async (root) => {
      // "User" and "user" both sanitize to "user" → same file → collision
      expect(() => createCategorizedMemory({ root, categories: ["User", "user"] })).toThrow(
        /categor/i,
      );
    });
  });

  it("(EC-3) rejects an unsanitizable category", async () => {
    await withRoot(async (root) => {
      expect(() => createCategorizedMemory({ root, categories: ["..."] })).toThrow(/categor/i);
    });
  });

  it("round-trips a multiline fact faithfully (no split / no truncation)", async () => {
    await withRoot(async (root) => {
      const m = createCategorizedMemory({ root, categories: CATS });
      const multi = "todo:\n- buy milk\n- buy eggs";
      await m.add("user", multi);
      const facts = await m.list("user");
      expect(facts).toHaveLength(1);
      expect(facts[0]?.text).toBe(multi);
    });
  });

  it("round-trips a fact containing a heading-like line without injecting structure", async () => {
    await withRoot(async (root) => {
      const m = createCategorizedMemory({ root, categories: CATS });
      const tricky = "line one\n## Injected\n- smuggled";
      await m.add("user", tricky);
      const facts = await m.list("user");
      expect(facts).toHaveLength(1);
      expect(facts[0]?.text).toBe(tricky);
    });
  });

  it("round-trips a fact containing literal backslash-n", async () => {
    await withRoot(async (root) => {
      const m = createCategorizedMemory({ root, categories: CATS });
      const literal = "path C:\\\\nope and a real\nnewline";
      await m.add("user", literal);
      const facts = await m.list("user");
      expect(facts).toHaveLength(1);
      expect(facts[0]?.text).toBe(literal);
    });
  });

  it("handles a prototype-key category name safely", async () => {
    await withRoot(async (root) => {
      const m = createCategorizedMemory({ root, categories: ["constructor", "user"] });
      await m.add("constructor", "ctor fact");
      expect((await m.list("constructor")).map((f) => f.text)).toEqual(["ctor fact"]);
    });
  });

  it("is exported from the @theokit/sdk-memory barrel (wiring) and round-trips", async () => {
    expect(typeof createFromBarrel).toBe("function");
    await withRoot(async (root) => {
      const m = createFromBarrel({ root, categories: CATS });
      await m.add("project", "via barrel");
      expect((await m.list("project")).map((f) => f.text)).toEqual(["via barrel"]);
    });
  });
});
