import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFilesystem } from "@theokit/sdk/filesystem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createReadFileTool } from "../src/read-file.js";
import { ReadTracker } from "../src/read-tracker.js";
import { createWriteFileTool } from "../src/write-file.js";
import { textHandler } from "./text-handler.js";

/**
 * SE31 — wiring triad: `createWriteFileTool` accepts an optional
 * `FilesystemBackend`. When provided, writes route through the backend (its own
 * boundary + readOnly); omitted ⇒ local `projectRoot` (back-compat, covered by
 * write-file.test.ts). This proves the seam is consumable end-to-end.
 */

let projectRoot: string;
let fsRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "sdk-wfb-proj-"));
  fsRoot = mkdtempSync(join(tmpdir(), "sdk-wfb-fs-"));
});
afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(fsRoot, { recursive: true, force: true });
});

describe("createWriteFileTool — filesystem backend (SE31)", () => {
  it("routes the write into the backend's basePath, not projectRoot", async () => {
    const tool = createWriteFileTool({
      projectRoot,
      filesystem: new LocalFilesystem({ basePath: fsRoot }),
    });
    const out = await textHandler(tool)({ path: "out.txt", content: "backed" });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.bytes).toBe(6);
    // written into the BACKEND root, not the project root
    expect(readFileSync(join(fsRoot, "out.txt"), "utf-8")).toBe("backed");
  });

  it("a read-only backend makes the tool return { ok: false, error: 'read_only' }", async () => {
    const tool = createWriteFileTool({
      projectRoot,
      filesystem: new LocalFilesystem({ basePath: fsRoot, readOnly: true }),
    });
    const out = await textHandler(tool)({ path: "blocked.txt", content: "nope" });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("read_only");
  });

  it("a traversal escape via the backend returns { ok: false, error: 'path_traversal' }", async () => {
    const tool = createWriteFileTool({
      projectRoot,
      filesystem: new LocalFilesystem({ basePath: fsRoot }),
    });
    const out = await textHandler(tool)({ path: "../escape.txt", content: "x" });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("path_traversal");
  });
});

describe("createWriteFileTool — filesystem backend + requireReadBeforeWrite (SE32)", () => {
  // The read tool reads from the SAME root the backend writes to, so a read
  // records the backend file's mtime that the backend write then checks.
  it("a NEW file via the backend writes freely under the guard", async () => {
    const tracker = new ReadTracker();
    const write = createWriteFileTool({
      projectRoot,
      filesystem: new LocalFilesystem({ basePath: fsRoot }),
      requireReadBeforeWrite: true,
      readTracker: tracker,
    });
    const out = await textHandler(write)({ path: "fresh.txt", content: "hi" });
    expect(JSON.parse(out).ok).toBe(true);
  });

  it("an existing UNREAD file via the backend is refused with 'read_required'", async () => {
    writeFileSync(join(fsRoot, "exists.txt"), "old");
    const tracker = new ReadTracker();
    const write = createWriteFileTool({
      projectRoot,
      filesystem: new LocalFilesystem({ basePath: fsRoot }),
      requireReadBeforeWrite: true,
      readTracker: tracker,
    });
    const out = await textHandler(write)({ path: "exists.txt", content: "new" });
    expect(JSON.parse(out).error).toBe("read_required");
  });

  it("read → external modify → backend write is refused with 'stale_file'", async () => {
    writeFileSync(join(fsRoot, "race.txt"), "v1");
    const tracker = new ReadTracker();
    const read = createReadFileTool({ projectRoot: fsRoot, readTracker: tracker });
    const write = createWriteFileTool({
      projectRoot,
      filesystem: new LocalFilesystem({ basePath: fsRoot }),
      requireReadBeforeWrite: true,
      readTracker: tracker,
    });

    await textHandler(read)({ path: "race.txt" }); // records v1 mtime (from fsRoot)
    writeFileSync(join(fsRoot, "race.txt"), "external");
    const future = new Date(Date.now() + 10_000);
    utimesSync(join(fsRoot, "race.txt"), future, future);

    const out = await textHandler(write)({ path: "race.txt", content: "v2" });
    expect(JSON.parse(out).error).toBe("stale_file");
  });
});
