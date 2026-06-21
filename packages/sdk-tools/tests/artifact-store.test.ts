import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { createSessionArtifactStore } from "../src/artifact-store.js";
import { createSessionArtifactStore as createFromBarrel } from "../src/index.js";

async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "artifact-store-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("createSessionArtifactStore (M4-4)", () => {
  it("write then read round-trips and write returns the path", async () => {
    await withDir(async (dir) => {
      const store = createSessionArtifactStore({ dir });
      const path = await store.write("run-1", "plan body");
      expect(path).toBe(join(dir, "run-1.md"));
      expect(await store.read("run-1")).toBe("plan body");
    });
  });

  it("read on a missing id returns undefined (never throws)", async () => {
    await withDir(async (dir) => {
      const store = createSessionArtifactStore({ dir });
      await expect(store.read("nope")).resolves.toBeUndefined();
    });
  });

  it("has reflects presence", async () => {
    await withDir(async (dir) => {
      const store = createSessionArtifactStore({ dir });
      expect(await store.has("x")).toBe(false);
      await store.write("x", "y");
      expect(await store.has("x")).toBe(true);
    });
  });

  it("list returns the written filename stems", async () => {
    await withDir(async (dir) => {
      const store = createSessionArtifactStore({ dir });
      await store.write("a", "1");
      await store.write("b", "2");
      expect((await store.list()).sort()).toEqual(["a", "b"]);
    });
  });

  it("list on a missing dir returns []", async () => {
    const store = createSessionArtifactStore({ dir: join(tmpdir(), "no-such-artifact-dir-xyz") });
    await expect(store.list()).resolves.toEqual([]);
  });

  it("honors a custom idStrategy and extension", async () => {
    await withDir(async (dir) => {
      const store = createSessionArtifactStore({
        dir,
        idStrategy: (id) => `pfx-${id}`,
        extension: ".json",
      });
      const path = await store.write("k", "{}");
      expect(path).toBe(join(dir, "pfx-k.json"));
      expect(await store.read("k")).toBe("{}");
    });
  });

  it("overwrites on a second write to the same id", async () => {
    await withDir(async (dir) => {
      const store = createSessionArtifactStore({ dir });
      await store.write("id", "first");
      await store.write("id", "second");
      expect(await store.read("id")).toBe("second");
      expect(await store.list()).toEqual(["id"]);
    });
  });

  it("preserves multiline / empty content byte-for-byte", async () => {
    await withDir(async (dir) => {
      const store = createSessionArtifactStore({ dir });
      const multi = "line1\nline2\r\nline3\n";
      await store.write("m", multi);
      expect(await store.read("m")).toBe(multi);
      await store.write("e", "");
      expect(await store.read("e")).toBe("");
      expect(await store.has("e")).toBe(true);
    });
  });

  it("case-folds ids via the default strategy (documented lossy contract)", async () => {
    await withDir(async (dir) => {
      const store = createSessionArtifactStore({ dir });
      await store.write("Run-1", "upper");
      await store.write("run-1", "lower");
      // INTENTIONAL: default safeFilenameForId is case-folding → same file.
      // Documented on idStrategy; case-sensitive ids need a custom strategy.
      expect(await store.read("Run-1")).toBe("lower");
      expect(await store.list()).toEqual(["run-1"]);
    });
  });

  it("excludes files with a different extension from list()", async () => {
    await withDir(async (dir) => {
      const md = createSessionArtifactStore({ dir });
      const json = createSessionArtifactStore({ dir, extension: ".json" });
      await md.write("a", "md");
      await json.write("b", "{}");
      expect(await md.list()).toEqual(["a"]);
      expect(await json.list()).toEqual(["b"]);
    });
  });

  it("neutralizes a traversal id — writes inside dir, never escapes", async () => {
    await withDir(async (dir) => {
      const store = createSessionArtifactStore({ dir });
      const path = await store.write("../escape", "x");
      // the written path stays under dir (safeFilenameForId hashes the bad id)
      expect(path.startsWith(dir + sep)).toBe(true);
      expect(path).not.toContain("..");
      // nothing leaked to the parent
      const parent = join(dir, "..");
      const parentFiles = await readdir(parent);
      expect(parentFiles).not.toContain("escape");
      expect(parentFiles).not.toContain("escape.md");
    });
  });

  it("is exported from the @theokit/sdk-tools barrel (wiring) and round-trips", async () => {
    expect(typeof createFromBarrel).toBe("function");
    await withDir(async (dir) => {
      const store = createFromBarrel({ dir });
      await store.write("via-barrel", "ok");
      expect(await store.read("via-barrel")).toBe("ok");
    });
  });
});
