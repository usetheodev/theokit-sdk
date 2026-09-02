/**
 * T5.1 — `internal/runtime/` god-folder split (FO#1).
 *
 * Plan: arch-review-fixes-2026-06-06 § Phase 5 / T5.1.
 *
 * Iteration ratchet (each halt-loop slice tightens the ceiling):
 *   iter-15 fixtures/ cluster — direct count 69 → 64 (≤ 65 ceiling)
 *   iter-16 context/  cluster — direct count 64 → 56 (≤ 57 ceiling)  ← this iteration
 *   future  registry/ cluster — ≤ 51 ceiling
 *   future  plugins/  cluster — ≤ 48 ceiling
 *   final   target per audit heuristic — ≤ 25 (long-tail of additional splits)
 */
import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RUNTIME_DIR = resolve(__dirname, "../../src/internal/runtime");
const ITER_18_DIRECT_FILES_CEILING = 62;

describe("Architecture — T5.1 runtime/ folder budget (FO#1)", () => {
  it(`internal/runtime/ direct .ts file count is ≤ ${ITER_18_DIRECT_FILES_CEILING} after context/ promotion`, () => {
    const directFiles = readdirSync(RUNTIME_DIR)
      .filter((name) => name.endsWith(".ts"))
      .filter((name) => statSync(resolve(RUNTIME_DIR, name)).isFile());
    expect(
      directFiles.length,
      `Expected ≤ ${ITER_18_DIRECT_FILES_CEILING} direct .ts files in internal/runtime/. Found ${directFiles.length}.`,
    ).toBeLessThanOrEqual(ITER_18_DIRECT_FILES_CEILING);
  });

  it("`fixtures/` sub-folder exists with the promoted fixture-* cluster (iter-15)", () => {
    const fixturesDir = resolve(RUNTIME_DIR, "fixtures");
    expect(safeIsDirectory(fixturesDir), "Expected internal/runtime/fixtures/ to exist").toBe(true);
    expect(readdirSync(fixturesDir).filter((n) => n.endsWith(".ts")).length).toBeGreaterThanOrEqual(
      5,
    );
  });

  it("`context/` sub-folder exists with the promoted context-* cluster (iter-16)", () => {
    const contextDir = resolve(RUNTIME_DIR, "context");
    expect(safeIsDirectory(contextDir), "Expected internal/runtime/context/ to exist").toBe(true);
    expect(readdirSync(contextDir).filter((n) => n.endsWith(".ts")).length).toBeGreaterThanOrEqual(
      8,
    );
  });

  it("`registry/` sub-folder exists with the promoted *-registry* cluster (iter-17)", () => {
    const registryDir = resolve(RUNTIME_DIR, "registry");
    expect(safeIsDirectory(registryDir), "Expected internal/runtime/registry/ to exist").toBe(true);
    expect(readdirSync(registryDir).filter((n) => n.endsWith(".ts")).length).toBeGreaterThanOrEqual(
      5,
    );
  });

  it("`plugin-loader/` sub-folder exists with the promoted plugin-* cluster (iter-18, completes T5.1)", () => {
    // Renamed from `plugins/`: `internal/plugins/` is the subsystem and this is the loader glue, and
    // two directories with one name in one tree is a name that answers the wrong question.
    const pluginsDir = resolve(RUNTIME_DIR, "plugin-loader");
    expect(safeIsDirectory(pluginsDir), "Expected internal/runtime/plugin-loader/ to exist").toBe(
      true,
    );
    expect(readdirSync(pluginsDir).filter((n) => n.endsWith(".ts")).length).toBeGreaterThanOrEqual(
      2,
    );
  });
});

function safeIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
