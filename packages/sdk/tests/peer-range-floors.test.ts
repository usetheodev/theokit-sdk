import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SE43 DoD#4 — the 5 satellites that import v4-only surfaces MUST declare a
 * `@theokit/sdk` peer-range floor of at least 4.0.0. A loose `>=1.7.0` floor lets
 * a non-workspace install resolve an incompatible old sdk against v4-only imports
 * (system-design-output/final_report.md § MEDIUM — Loose >=1.7.0).
 */

const REPO_ROOT = join(__dirname, "..", "..", "..");
const SATELLITES = ["sdk-tools", "sdk-memory", "sdk-cache", "sdk-handoff", "sdk-budget"] as const;

/** Extract the numeric major floor from a peer range like ">=4.0.0" or "^4". */
function peerFloorMajor(range: string): number {
  const m = range.match(/(\d+)(?:\.\d+)?(?:\.\d+)?/);
  if (!m) throw new Error(`unparseable peer range: ${range}`);
  return Number(m[1]);
}

describe("SE43 DoD#4 — satellite @theokit/sdk peer-range floors", () => {
  for (const pkg of SATELLITES) {
    it(`${pkg} declares a peer floor >= 4.0.0`, () => {
      const manifest = JSON.parse(
        readFileSync(join(REPO_ROOT, "packages", pkg, "package.json"), "utf8"),
      ) as { peerDependencies?: Record<string, string> };
      const range = manifest.peerDependencies?.["@theokit/sdk"];
      expect(range, `${pkg} must declare a @theokit/sdk peerDependency`).toBeDefined();
      expect(peerFloorMajor(range as string)).toBeGreaterThanOrEqual(4);
    });
  }
});
