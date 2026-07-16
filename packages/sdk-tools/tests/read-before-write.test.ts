import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createReadFileTool } from "../src/read-file.js";
import { ReadTracker } from "../src/read-tracker.js";
import { createWriteFileTool } from "../src/write-file.js";
import { textHandler } from "./text-handler.js";

/**
 * SE32 — read-before-write safety. An opt-in `requireReadBeforeWrite` on the
 * write tool, backed by a per-run `ReadTracker` the read tool populates. A blind
 * overwrite of an existing (or externally-modified) file is refused; a new file
 * writes freely; default OFF preserves current behavior.
 */

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "sdk-rbw-"));
});
afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("SE32 — requireReadBeforeWrite", () => {
  it("a NEW file writes freely even with requireReadBeforeWrite on (nothing to clobber)", async () => {
    const tracker = new ReadTracker();
    const write = createWriteFileTool({
      projectRoot,
      requireReadBeforeWrite: true,
      readTracker: tracker,
    });
    const out = await textHandler(write)({ path: "new.txt", content: "hi" });
    expect(JSON.parse(out).ok).toBe(true);
  });

  it("an existing UNREAD file is refused with error 'read_required'", async () => {
    writeFileSync(join(projectRoot, "exists.txt"), "old");
    const tracker = new ReadTracker();
    const write = createWriteFileTool({
      projectRoot,
      requireReadBeforeWrite: true,
      readTracker: tracker,
    });
    const out = await textHandler(write)({ path: "exists.txt", content: "new" });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("read_required");
  });

  it("reading a file then writing it succeeds (read recorded, mtime matches)", async () => {
    writeFileSync(join(projectRoot, "doc.txt"), "v1");
    const tracker = new ReadTracker();
    const read = createReadFileTool({ projectRoot, readTracker: tracker });
    const write = createWriteFileTool({
      projectRoot,
      requireReadBeforeWrite: true,
      readTracker: tracker,
    });

    await textHandler(read)({ path: "doc.txt" }); // records mtime
    const out = await textHandler(write)({ path: "doc.txt", content: "v2" });
    expect(JSON.parse(out).ok).toBe(true);
  });

  it("read → external modify → write is refused with error 'stale_file'", async () => {
    writeFileSync(join(projectRoot, "race.txt"), "v1");
    const tracker = new ReadTracker();
    const read = createReadFileTool({ projectRoot, readTracker: tracker });
    const write = createWriteFileTool({
      projectRoot,
      requireReadBeforeWrite: true,
      readTracker: tracker,
    });

    await textHandler(read)({ path: "race.txt" }); // records the v1 mtime
    // an external editor rewrites the file with a DIFFERENT mtime (advance 10s)
    writeFileSync(join(projectRoot, "race.txt"), "v1-external");
    const future = new Date(Date.now() + 10_000);
    utimesSync(join(projectRoot, "race.txt"), future, future);

    const out = await textHandler(write)({ path: "race.txt", content: "v2" });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("stale_file");
  });

  it("the tracker is per-instance — a read on one does NOT authorize a write on another", async () => {
    writeFileSync(join(projectRoot, "iso.txt"), "old");
    const trackerA = new ReadTracker();
    const trackerB = new ReadTracker();
    const read = createReadFileTool({ projectRoot, readTracker: trackerA });
    const write = createWriteFileTool({
      projectRoot,
      requireReadBeforeWrite: true,
      readTracker: trackerB,
    });

    await textHandler(read)({ path: "iso.txt" }); // records into trackerA only
    const out = await textHandler(write)({ path: "iso.txt", content: "new" });
    expect(JSON.parse(out).error).toBe("read_required"); // trackerB never saw it
  });

  it("requireReadBeforeWrite OFF (default) overwrites an existing file without a prior read", async () => {
    writeFileSync(join(projectRoot, "free.txt"), "old");
    const write = createWriteFileTool({ projectRoot }); // no requireReadBeforeWrite
    const out = await textHandler(write)({ path: "free.txt", content: "new" });
    expect(JSON.parse(out).ok).toBe(true);
  });

  it("requireReadBeforeWrite:true WITHOUT a readTracker throws at construction (no silent no-op)", () => {
    expect(() => createWriteFileTool({ projectRoot, requireReadBeforeWrite: true })).toThrow(
      /requireReadBeforeWrite is true but no readTracker/,
    );
  });
});
