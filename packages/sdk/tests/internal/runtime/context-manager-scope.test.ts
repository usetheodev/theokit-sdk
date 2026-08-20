/**
 * FileContextManager.applyScope — per-send path-scoped activation wiring (T3).
 * Green-gate coverage (deterministic, no agent.send): proves scoped rules
 * activate/deactivate as the in-scope file set changes, and that non-users
 * (never scoped) keep the create-time snapshot untouched.
 */

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { FileContextManager } from "../../../src/internal/runtime/context/context-manager.js";
import { removeTempDirRobust } from "../../helpers/temp-workspace.js";

const hasFile = (paths: Array<string | undefined>, file: string): boolean =>
  paths.some((p) => (p ?? "").endsWith(file));

describe("FileContextManager.applyScope (T3)", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "theokit-rules-scope-"));
    const __tmpCleanup1 = tmp;
    onTestFinished(async () => {
      await removeTempDirRobust(__tmpCleanup1);
    });
    await mkdir(join(tmp, ".git"), { recursive: true });
    await mkdir(join(tmp, ".theokit", "rules"), { recursive: true });
    await writeFile(
      join(tmp, ".theokit", "rules", "always.md"),
      "---\nalwaysApply: true\n---\nUse tabs.",
    );
    await writeFile(
      join(tmp, ".theokit", "rules", "api.md"),
      "---\npaths:\n  - src/api/**/*.ts\n---\nValidate endpoint input.",
    );
  });

  const mgr = async (): Promise<FileContextManager> => {
    const m = new FileContextManager(tmp, { manager: "file" }, true);
    await m.initialize();
    return m;
  };

  const snapPaths = async (m: FileContextManager): Promise<Array<string | undefined>> =>
    (await m.snapshot()).sources.map((s) => s.path);

  it("loads only alwaysApply rules at create time (no scope)", async () => {
    const m = await mgr();
    const p = await snapPaths(m);
    expect(hasFile(p, "rules/always.md")).toBe(true);
    expect(hasFile(p, "rules/api.md")).toBe(false);
  });

  it("activates a scoped rule when a matching in-scope file is applied", async () => {
    const m = await mgr();
    await m.applyScope(["src/api/users.ts"]);
    const p = await snapPaths(m);
    expect(hasFile(p, "rules/api.md")).toBe(true);
    expect(hasFile(p, "rules/always.md")).toBe(true);
  });

  it("deactivates the scoped rule when the scope is cleared (no leak)", async () => {
    const m = await mgr();
    await m.applyScope(["src/api/users.ts"]);
    expect(hasFile(await snapPaths(m), "rules/api.md")).toBe(true);
    await m.applyScope([]);
    const p = await snapPaths(m);
    expect(hasFile(p, "rules/api.md")).toBe(false);
    expect(hasFile(p, "rules/always.md")).toBe(true);
  });

  it("is a no-op for a non-matching scope", async () => {
    const m = await mgr();
    await m.applyScope(["src/ui/button.tsx"]);
    expect(hasFile(await snapPaths(m), "rules/api.md")).toBe(false);
  });

  it("applyScope(undefined) never touches state (non-user path)", async () => {
    const m = await mgr();
    const before = JSON.stringify(await m.snapshot());
    await m.applyScope(undefined);
    expect(JSON.stringify(await m.snapshot())).toBe(before);
  });
});
