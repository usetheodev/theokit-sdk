import { writeFile as fsWriteFile, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  FileNotFoundError,
  FilesystemError,
  FilesystemReadOnlyError,
  FilesystemSecurityError,
  LocalFilesystem,
  StaleFileError,
} from "../src/filesystem/index.js";

/**
 * SE31 — `FilesystemBackend` provider seam (mirrors `SandboxBackend`).
 * A pluggable file backend with a boundary root, `readOnly`, and structured
 * `stat()` (mtimeMs). `LocalFilesystem` is the local-process implementation.
 */

describe("SE31 — LocalFilesystem backend", () => {
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "theokit-fs-"));
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("writes then reads a file within the boundary", async () => {
    const fs = new LocalFilesystem({ basePath: base });
    const stat = await fs.writeFile("notes/a.txt", "hello");
    expect(stat.isFile).toBe(true);
    expect(stat.size).toBe(5);
    expect(typeof stat.mtimeMs).toBe("number");
    expect(await fs.readFile("notes/a.txt")).toBe("hello");
  });

  it("lists a directory's entries", async () => {
    const fs = new LocalFilesystem({ basePath: base });
    await fs.writeFile("x.txt", "1");
    await fs.writeFile("y.txt", "2");
    const entries = await fs.list(".");
    expect(entries.sort()).toEqual(["x.txt", "y.txt"]);
  });

  it("stat() returns size + mtimeMs for an existing file", async () => {
    const fs = new LocalFilesystem({ basePath: base });
    await fs.writeFile("s.txt", "abcd");
    const stat = await fs.stat("s.txt");
    expect(stat.size).toBe(4);
    expect(stat.isFile).toBe(true);
    expect(stat.isDirectory).toBe(false);
    expect(stat.mtimeMs).toBeGreaterThan(0);
  });

  it("exists() is true for a written file and false for an absent one", async () => {
    const fs = new LocalFilesystem({ basePath: base });
    await fs.writeFile("here.txt", "1");
    expect(await fs.exists("here.txt")).toBe(true);
    expect(await fs.exists("nope.txt")).toBe(false);
  });

  it("read/stat of an absent file throws a typed FileNotFoundError", async () => {
    const fs = new LocalFilesystem({ basePath: base });
    await expect(fs.readFile("ghost.txt")).rejects.toBeInstanceOf(FileNotFoundError);
    await expect(fs.stat("ghost.txt")).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it("a readOnly backend rejects writes with FilesystemReadOnlyError", async () => {
    // seed a file with a writable backend, then reopen read-only
    await new LocalFilesystem({ basePath: base }).writeFile("ro.txt", "seed");
    const ro = new LocalFilesystem({ basePath: base, readOnly: true });
    expect(ro.readOnly).toBe(true);
    expect(await ro.readFile("ro.txt")).toBe("seed"); // reads still work
    await expect(ro.writeFile("ro.txt", "mutate")).rejects.toBeInstanceOf(FilesystemReadOnlyError);
  });

  it("blocks a lexical path-traversal escape with FilesystemSecurityError", async () => {
    const fs = new LocalFilesystem({ basePath: base });
    await expect(fs.readFile("../../etc/passwd")).rejects.toBeInstanceOf(FilesystemSecurityError);
    await expect(fs.writeFile("../escape.txt", "x")).rejects.toBeInstanceOf(
      FilesystemSecurityError,
    );
  });

  it("writeFile with a matching expectedMtime succeeds; a stale one throws StaleFileError", async () => {
    const fs = new LocalFilesystem({ basePath: base });
    await fs.writeFile("doc.txt", "v1");
    // Read the CURRENT on-disk mtime, then write with exactly that value → allowed
    // (deterministic — does not depend on wall-clock advancing between writes).
    const current = await fs.stat("doc.txt");
    await fs.writeFile("doc.txt", "v2", { expectedMtime: current.mtimeMs });
    expect(await fs.readFile("doc.txt")).toBe("v2");
    // A deliberately WRONG expectedMtime (older) must be rejected as stale.
    await expect(
      fs.writeFile("doc.txt", "v3", { expectedMtime: current.mtimeMs - 5000 }),
    ).rejects.toBeInstanceOf(StaleFileError);
    // the failed write did NOT clobber
    expect(await fs.readFile("doc.txt")).toBe("v2");
  });

  it("writeFile with expectedMtime on a NEW file is allowed (nothing to be stale)", async () => {
    const fs = new LocalFilesystem({ basePath: base });
    const stat = await fs.writeFile("fresh.txt", "new", { expectedMtime: 123 });
    expect(stat.isFile).toBe(true);
    expect(await fs.readFile("fresh.txt")).toBe("new");
  });

  it("list() on a regular file throws a typed FilesystemError (not a raw ENOTDIR)", async () => {
    const fs = new LocalFilesystem({ basePath: base });
    await fs.writeFile("plain.txt", "x");
    await expect(fs.list("plain.txt")).rejects.toBeInstanceOf(FilesystemError);
  });

  it("writeFile whose parent component is a file throws a typed FilesystemError", async () => {
    const fs = new LocalFilesystem({ basePath: base });
    await fs.writeFile("parent.txt", "x"); // parent.txt is a FILE
    // writing "parent.txt/child.txt" must fail typed (ENOTDIR), never a raw throw
    await expect(fs.writeFile("parent.txt/child.txt", "y")).rejects.toBeInstanceOf(FilesystemError);
  });

  it("blocks a symlink that escapes the boundary", async () => {
    const fs = new LocalFilesystem({ basePath: base });
    // create a symlink inside base pointing outside base
    const outside = await mkdtemp(join(tmpdir(), "theokit-outside-"));
    await fsWriteFile(join(outside, "secret.txt"), "TOP SECRET");
    await symlink(join(outside, "secret.txt"), join(base, "link.txt"));
    await expect(fs.readFile("link.txt")).rejects.toBeInstanceOf(FilesystemSecurityError);
    await rm(outside, { recursive: true, force: true });
  });
});

describe("SE31 — per-request filesystem resolver", () => {
  it("a resolver returns a distinct backend (per-request root) per call", async () => {
    const rootA = await mkdtemp(join(tmpdir(), "theokit-fsA-"));
    const rootB = await mkdtemp(join(tmpdir(), "theokit-fsB-"));
    try {
      await new LocalFilesystem({ basePath: rootA }).writeFile("who.txt", "A");
      await new LocalFilesystem({ basePath: rootB }).writeFile("who.txt", "B");

      // a resolver picks a root from a request-scoped value
      const resolve = (role: "a" | "b") =>
        new LocalFilesystem({ basePath: role === "a" ? rootA : rootB });

      expect(await resolve("a").readFile("who.txt")).toBe("A");
      expect(await resolve("b").readFile("who.txt")).toBe("B");
    } finally {
      await rm(rootA, { recursive: true, force: true });
      await rm(rootB, { recursive: true, force: true });
    }
  });
});
