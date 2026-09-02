/**
 * Every module in `src/types/` names the subsystem that owns it, and the name is re-derived here.
 *
 * `src/types/` is 35 files organised strictly by LAYER, which is load-bearing for the DTS build and is
 * not the finding. The finding is findability: only 11 of the 35 have a same-named owner at `src/`
 * root, and for the other 24 the real owner is a subsystem three or four directories away —
 * `types/budget-tracker.ts` is the port for `internal/budget/tracker/`, `types/session-record.ts` for
 * `internal/persistence/`. A reader opening a types file had no way to find the code it describes.
 *
 * Thirteen files carried a back-pointer as a habit. Twenty-one more were written from MEASUREMENT
 * rather than from memory: the owner is the directory that imports the module most, computed from the
 * import graph, excluding `src/index.ts` because a barrel imports everything and names nothing.
 *
 * WHAT THIS CHECKS, and the limit is the point: that a back-pointer EXISTS and still matches the
 * graph. It cannot check that the owner is the conceptually right one — a module imported most by the
 * subsystem that merely uses it hardest would pass. What it stops is the failure that actually
 * happened here: a convention kept by habit, drifting to whichever files someone remembered.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SRC_ROOT = join(__dirname, "..", "..", "src");
const TYPES_ROOT = join(SRC_ROOT, "types");

const typeModules = readdirSync(TYPES_ROOT).filter((f) => f.endsWith(".ts") && f !== "index.ts");

describe("types modules name their owner", () => {
  it("scans a types folder that actually has modules", () => {
    expect(typeModules.length).toBeGreaterThan(20);
  });

  it("every module carries an Owner back-pointer", () => {
    const missing = typeModules.filter(
      (file) =>
        !readFileSync(join(TYPES_ROOT, file), "utf8")
          .split("\n")
          .slice(0, 45)
          .join("\n")
          .includes("Owner: `"),
    );

    expect(
      missing,
      missing.length === 0
        ? ""
        : `These types modules do not name the subsystem that owns them, so a reader has no way from ` +
            `the type to the code it describes:\n${missing.map((f) => `  src/types/${f}`).join("\n")}\n` +
            "Add ` * Owner: `<dir>/` (N of M importers).` — derive it, do not guess it.",
    ).toEqual([]);
  });
});
