/**
 * T10.1 — `internal/memory/` direct-file budget (FO#3).
 *
 * Plan: arch-review-fixes-2026-06-06 § Phase 10 / T10.1.
 *
 * The audit (`architecture-output/final_report.md` FO#3) flagged
 * `internal/memory/` as a god folder (heuristic threshold 25 direct files
 * per `cycle-rule-schema.md`). The plan calls to promote implicit
 * sub-domains to explicit sub-folders (`memory/storage/`, `memory/index/`).
 *
 * This test guards the final state: direct file count in `internal/memory/`
 * MUST stay ≤ 25 after T10.1 lands.
 */
import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MAX_DIRECT_FILES = 25;
const MEMORY_DIR = resolve(__dirname, "../../src/internal/memory");

describe("Architecture — T10.1 memory/ folder budget (FO#3)", () => {
  it(`internal/memory/ direct .ts file count is ≤ ${MAX_DIRECT_FILES}`, () => {
    const directFiles = readdirSync(MEMORY_DIR)
      .filter((name) => name.endsWith(".ts"))
      .filter((name) => statSync(resolve(MEMORY_DIR, name)).isFile());
    expect(
      directFiles.length,
      `Expected ≤ ${MAX_DIRECT_FILES} direct .ts files in internal/memory/. Found ${directFiles.length}:\n${directFiles.join("\n")}`,
    ).toBeLessThanOrEqual(MAX_DIRECT_FILES);
  });

  it("`storage/` sub-folder exists with the promoted storage-primitive cluster", () => {
    const storageDir = resolve(MEMORY_DIR, "storage");
    const stat = (() => {
      try {
        return statSync(storageDir);
      } catch {
        return undefined;
      }
    })();
    expect(stat?.isDirectory(), "Expected internal/memory/storage/ to exist").toBe(true);

    const storageFiles = readdirSync(storageDir).filter((n) => n.endsWith(".ts"));
    // Sanity floor: storage subfolder gains at least 3 files post-promotion
    // (the cluster of markdown-store/transcript-store/session-loader/etc).
    expect(storageFiles.length).toBeGreaterThanOrEqual(3);
  });
});
