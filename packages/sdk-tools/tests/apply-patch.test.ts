/**
 * `apply_patch` (V4A / Codex `*** Begin Patch`) — tool-level tests against a real temp project.
 * Covers Add/Update/Delete/Move, the strict-atomicity guarantee (a mismatch ⇒ zero writes), path
 * security, and the typed error branches.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createApplyPatchTool } from "../src/apply-patch.js";
import { textHandler } from "./text-handler.js";

const roots: string[] = [];
function project(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "apply-v4a-"));
  roots.push(root);
  for (const [p, c] of Object.entries(files)) writeFileSync(join(root, p), c);
  return root;
}
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
const wrap = (body: string) => `*** Begin Patch\n${body}\n*** End Patch`;
const run = (root: string, patch: string) =>
  textHandler(createApplyPatchTool({ projectRoot: root }))({ patch }).then((s) => JSON.parse(s));

describe("apply_patch V4A — tool shape", () => {
  it("returns a CustomTool named apply_patch", () => {
    const tool = createApplyPatchTool({ projectRoot: "/nope" });
    expect(tool.name).toBe("apply_patch");
    expect(tool.description).toContain("Begin Patch");
  });
});

describe("apply_patch V4A — Add / Update / Delete / Move", () => {
  it("Add File creates the file with a trailing newline", async () => {
    const root = project();
    const r = await run(
      root,
      wrap("*** Add File: src/new.ts\n+export const x = 1;\n+const y = 2;"),
    );
    expect(r).toEqual({ ok: true, files_patched: ["src/new.ts"] });
    expect(readFileSync(join(root, "src/new.ts"), "utf-8")).toBe(
      "export const x = 1;\nconst y = 2;\n",
    );
  });

  it("Update File applies a context-anchored change", async () => {
    const root = project({ "a.ts": "top\nfunction main\nold\nbottom\n" });
    const r = await run(root, wrap("*** Update File: a.ts\n@@ function main\n-old\n+new"));
    expect(r.ok).toBe(true);
    expect(readFileSync(join(root, "a.ts"), "utf-8")).toBe("top\nfunction main\nnew\nbottom\n");
  });

  it("Delete File removes the file", async () => {
    const root = project({ "gone.ts": "bye\n" });
    const r = await run(root, wrap("*** Delete File: gone.ts"));
    expect(r).toEqual({ ok: true, files_patched: ["gone.ts"] });
    expect(existsSync(join(root, "gone.ts"))).toBe(false);
  });

  it("Update File + Move to writes the new content at the destination and removes the original", async () => {
    const root = project({ "old.ts": "a\nb\n" });
    const r = await run(root, wrap("*** Update File: old.ts\n*** Move to: sub/new.ts\n@@\n-a\n+A"));
    expect(r).toEqual({ ok: true, files_patched: ["sub/new.ts"] });
    expect(existsSync(join(root, "old.ts"))).toBe(false);
    expect(readFileSync(join(root, "sub/new.ts"), "utf-8")).toBe("A\nb\n");
  });
});

describe("apply_patch V4A — strict atomicity", () => {
  it("a mismatch in the SECOND hunk leaves the FIRST file untouched (zero writes)", async () => {
    const root = project({ "a.ts": "keep\n", "b.ts": "real\n" });
    // hunk 1 (a.ts) is valid; hunk 2 (b.ts) context does not match → whole patch must abort.
    const patch = wrap(
      "*** Update File: a.ts\n@@\n-keep\n+CHANGED\n*** Update File: b.ts\n@@\n-does-not-exist\n+x",
    );
    const r = await run(root, patch);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("patch_failed");
    // a.ts MUST be unchanged — the plan aborted before any write.
    expect(readFileSync(join(root, "a.ts"), "utf-8")).toBe("keep\n");
    expect(readFileSync(join(root, "b.ts"), "utf-8")).toBe("real\n");
  });
});

describe("apply_patch V4A — security + errors", () => {
  it("refuses a forbidden path (.env)", async () => {
    const root = project();
    const r = await run(root, wrap("*** Add File: .env\n+SECRET=1"));
    expect(r).toEqual({ ok: false, error: "forbidden_path", path: ".env" });
  });

  it("refuses a traversal path", async () => {
    const root = project();
    const r = await run(root, wrap("*** Add File: ../escape.ts\n+x"));
    expect(r.ok).toBe(false);
    expect(r.error).toBe("path_traversal");
  });

  it("returns not_found when updating a missing file", async () => {
    const root = project();
    const r = await run(root, wrap("*** Update File: missing.ts\n@@\n-a\n+b"));
    expect(r).toEqual({ ok: false, error: "not_found", path: "missing.ts" });
  });

  it("returns parse_error for a malformed patch", async () => {
    const root = project();
    const r = await run(root, "not a patch at all");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("parse_error");
  });
});
