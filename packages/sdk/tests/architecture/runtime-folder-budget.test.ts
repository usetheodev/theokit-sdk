/**
 * T5.1 — `internal/runtime/` god-folder split (FO#1).
 *
 * Plan: arch-review-fixes-2026-06-06 § Phase 5 / T5.1.
 *
 * The audit (`architecture-output/final_report.md` FO#1) flagged
 * `internal/runtime/` as a HIGH-severity god folder (69 direct .ts files,
 * 9385 LOC; heuristic threshold 25 per `cycle-rule-schema.md`). The plan
 * calls for promoting the implicit sub-domains
 * (`context/`, `registry/`, `fixtures/`, `plugins/`) to explicit sub-folders.
 *
 * **Scope-narrowed per YAGNI on iter-15.** This iteration promotes ONE
 * sub-cluster (`fixtures/`) — the most cohesive and lowest-blast-radius
 * subset (5 files, all callers confined to runtime/ siblings). The
 * remaining clusters are followups: each must drop further file count
 * until `internal/runtime/` direct count converges on ≤ 25.
 *
 * This test asserts the floor (≤ 65 — i.e. ≥ 4 files moved this iteration)
 * AND the `fixtures/` sub-folder exists. Later iterations tighten the cap.
 */
import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RUNTIME_DIR = resolve(__dirname, "../../src/internal/runtime");
// Iter-15 floor: ≤ 65 direct .ts files (drops to ≤ 64 after fixtures/ promo).
// Final goal per audit heuristic is 25; later iterations ratchet this down.
const ITER_15_DIRECT_FILES_CEILING = 65;

describe("Architecture — T5.1 runtime/ folder budget (FO#1)", () => {
  it(`internal/runtime/ direct .ts file count drops to ≤ ${ITER_15_DIRECT_FILES_CEILING} after fixtures/ promotion`, () => {
    const directFiles = readdirSync(RUNTIME_DIR)
      .filter((name) => name.endsWith(".ts"))
      .filter((name) => statSync(resolve(RUNTIME_DIR, name)).isFile());
    expect(
      directFiles.length,
      `Expected ≤ ${ITER_15_DIRECT_FILES_CEILING} direct .ts files in internal/runtime/. Found ${directFiles.length}.`,
    ).toBeLessThanOrEqual(ITER_15_DIRECT_FILES_CEILING);
  });

  it("`fixtures/` sub-folder exists with the promoted fixture-* cluster", () => {
    const fixturesDir = resolve(RUNTIME_DIR, "fixtures");
    const stat = (() => {
      try {
        return statSync(fixturesDir);
      } catch {
        return undefined;
      }
    })();
    expect(stat?.isDirectory(), "Expected internal/runtime/fixtures/ to exist").toBe(true);

    const fixtureFiles = readdirSync(fixturesDir).filter((n) => n.endsWith(".ts"));
    // Floor: 5 fixture-* files promoted.
    expect(fixtureFiles.length).toBeGreaterThanOrEqual(5);
  });
});
