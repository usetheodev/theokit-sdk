import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFilesystem } from "@theokit/sdk/filesystem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createListDirTool } from "../src/list-dir.js";
import { createReadFileTool } from "../src/read-file.js";
import { textHandler } from "./text-handler.js";

/**
 * SE31 (gap closure) — the read-side file factories (`createReadFileTool`,
 * `createListDirTool`) must ALSO accept the optional `filesystem` backend, or a
 * per-request root only isolates writes. This proves reads/lists route through
 * the backend's basePath, not the local `projectRoot`. Omitted ⇒ back-compat
 * (covered by read-file.test.ts / list-dir.test.ts).
 */

let projectRoot: string;
let fsRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "sdk-rlb-proj-"));
  fsRoot = mkdtempSync(join(tmpdir(), "sdk-rlb-fs-"));
});
afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(fsRoot, { recursive: true, force: true });
});

describe("createReadFileTool — filesystem backend (SE31)", () => {
  it("reads from the backend's basePath, not projectRoot", async () => {
    // A same-named file exists in BOTH roots with different content — the read
    // must return the BACKEND's copy, proving the backend is the source.
    writeFileSync(join(projectRoot, "note.txt"), "from-project", "utf-8");
    writeFileSync(join(fsRoot, "note.txt"), "from-backend", "utf-8");
    const tool = createReadFileTool({
      projectRoot,
      filesystem: new LocalFilesystem({ basePath: fsRoot }),
    });
    const parsed = JSON.parse(await textHandler(tool)({ path: "note.txt" }));
    expect(parsed.ok).toBe(true);
    expect(parsed.content).toBe("from-backend");
  });

  it("returns { ok: false, error: 'not_found' } for a missing file in the backend", async () => {
    const tool = createReadFileTool({
      projectRoot,
      filesystem: new LocalFilesystem({ basePath: fsRoot }),
    });
    const parsed = JSON.parse(await textHandler(tool)({ path: "nope.txt" }));
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("not_found");
  });

  it("blocks a path traversal at the backend boundary (typed → path_traversal)", async () => {
    const tool = createReadFileTool({
      projectRoot,
      filesystem: new LocalFilesystem({ basePath: fsRoot }),
    });
    const parsed = JSON.parse(await textHandler(tool)({ path: "../escape.txt" }));
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("path_traversal");
  });
});

describe("createListDirTool — filesystem backend (SE31)", () => {
  it("lists the backend's basePath entries, with type, not projectRoot", async () => {
    writeFileSync(join(projectRoot, "only-in-project.txt"), "x", "utf-8");
    writeFileSync(join(fsRoot, "a.txt"), "x", "utf-8");
    mkdirSync(join(fsRoot, "sub"));
    const tool = createListDirTool({
      projectRoot,
      filesystem: new LocalFilesystem({ basePath: fsRoot }),
    });
    const parsed = JSON.parse(await textHandler(tool)({ path: "." }));
    expect(parsed.ok).toBe(true);
    const names = (parsed.entries as Array<{ name: string; type: string }>).map((e) => e.name);
    expect(names.sort()).toEqual(["a.txt", "sub"]);
    const sub = (parsed.entries as Array<{ name: string; type: string }>).find(
      (e) => e.name === "sub",
    );
    expect(sub?.type).toBe("directory");
    expect(names).not.toContain("only-in-project.txt");
  });
});
