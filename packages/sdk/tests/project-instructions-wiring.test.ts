import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readProjectInstructions, writeProjectInstructions } from "../src/project.js";

/**
 * M4-2 — integration: the public `@theokit/sdk/project` subpath round-trips
 * (write then read) on a real directory, and the subpath is declared in
 * package.json so Node ESM/CJS can resolve it.
 */
describe("project instructions wiring (M4-2)", () => {
  it("test_project_subpath_roundtrips", async () => {
    expect(typeof readProjectInstructions).toBe("function");
    expect(typeof writeProjectInstructions).toBe("function");
    const base = await mkdtemp(join(tmpdir(), "project-wiring-"));
    try {
      await writeProjectInstructions(base, "WIRED");
      const result = await readProjectInstructions(base, { stopDir: base });
      expect(result.content).toBe("WIRED");
      expect(result.files).toHaveLength(1);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("test_project_subpath_declared_in_package_json", () => {
    const pkgPath = join(fileURLToPath(new URL(".", import.meta.url)), "../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      exports: Record<
        string,
        { import: { types: string; default: string }; require: { types: string; default: string } }
      >;
    };
    const entry = pkg.exports["./project"];
    if (entry === undefined) throw new Error("package.json is missing the ./project export");
    expect(entry.import.types).toBe("./dist/project.d.ts");
    expect(entry.import.default).toBe("./dist/project.js");
    expect(entry.require.types).toBe("./dist/project.d.cts");
    expect(entry.require.default).toBe("./dist/project.cjs");
  });
});
