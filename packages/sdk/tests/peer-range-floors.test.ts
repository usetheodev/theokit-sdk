import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SE43 DoD#4 — the 5 satellites that import v4-only surfaces MUST declare a
 * `@theokit/sdk` peer-range floor of at least 4.0.0. A loose `>=1.7.0` floor lets
 * a non-workspace install resolve an incompatible old sdk against v4-only imports
 * (system-design-output/final_report.md § MEDIUM — Loose >=1.7.0).
 *
 * What this file CANNOT see, recorded because it took a CI leg to find: a major-only floor is a
 * weaker claim than the one that matters. `sdk-cache` declared `>=4.0.0` and passed every case here
 * while using `PostAssistantReplyContext.usedTools`, which did not exist until 4.54.0 — so an
 * install at the bottom of its own declared range failed to build. Measured 2026-08-27 by the
 * `dep-check` leg that installs each package at its floor and builds it.
 *
 * Deriving the true floor statically would mean type-checking every satellite against every version
 * its range admits, which is that leg's job and not a unit test's. What is possible here is pinning
 * a floor once it is KNOWN, so it cannot silently drop back.
 */

const REPO_ROOT = join(__dirname, "..", "..", "..");
const SATELLITES = [
  "sdk-tools",
  "sdk-memory",
  "sdk-cache",
  "sdk-handoff",
  "sdk-budget",
  "sdk-pty",
] as const;

/** Extract the numeric major floor from a peer range like ">=4.0.0" or "^4". */
function peerFloorMajor(range: string): number {
  const m = range.match(/(\d+)(?:\.\d+)?(?:\.\d+)?/);
  if (!m) throw new Error(`unparseable peer range: ${range}`);
  return Number(m[1]);
}

/** Floors established by measurement, with the API that forced each one. */
const MEASURED_FLOORS: Record<string, { floor: string; because: string }> = {
  // `PostAssistantReplyContext.usedTools` (8d1feaaf, first released in 4.54.0) — the cache reads it
  // to avoid replaying an answer that came from a tool call.
  "sdk-cache": { floor: "4.54.0", because: "PostAssistantReplyContext.usedTools" },
  // Not an API this package uses — 4.53.1's OWN published declarations do not compile. `#345`
  // (`e368fc18`) bound the re-exported names the rollup left unimported, and first shipped in
  // 4.54.0; before it, `index.d.ts` references `MemoryProviderFactory`, `AgentBuilderDeps` and
  // `DECLARED` without defining them. A floor may be wrong because the version it names is broken,
  // not only because the code outgrew it.
  // Raised again for a third reason: this package no longer COPIES the markdown store, it imports
  // `@theokit/sdk/internal/memory-store`, and that sub-path first ships in 4.60.0. A floor is a
  // promise about what a consumer can install; importing a path an admitted version does not export
  // is the `#399` failure exactly — a load-time crash, not a type error.
  // Raised a fourth time, and this one is about the CONTENTS of the sub-path rather than its
  // existence. #463 replaced this package's remaining copies with imports, and the names it now
  // pulls through `internal/memory-store` — `resolveMemoryRoot`, `sessionsDir`,
  // `writeSessionSummary`, `discoverSessionFiles`, `discoverWikiFiles`,
  // `persistActiveMemoryTranscript`, `collectMarkdownFiles`, `defaultIndexPath`,
  // `lanceStoragePath`, `readAllSqliteFacts`, the diary module — first ship in 4.63.0. Against
  // 4.60.0 the sub-path resolves and the members are absent, which is the same `#399` shape one
  // level in: the import succeeds and the symbol is undefined.
  //
  // It could not be raised in the release that created 4.63.0. A floor names a version a consumer
  // can install, and that version did not exist yet; `dep-check`'s floor leg failed for one
  // release, correctly and out loud, saying so.
  "sdk-memory": {
    floor: "4.63.0",
    because: "imports members of internal/memory-store added in 4.63.0 (#463)",
  },
  // Same reason, and these two PASSED the CI leg — which is what makes them worth recording. That
  // leg builds each package against its floor, and neither of these typechecks the SDK's
  // declarations while building, so a broken `.d.ts` never reaches their compiler. A consumer's
  // does. Measured 2026-08-27 with `skipLibCheck: false`, `@types/node` and `zod` installed:
  // 4.4.1 → 6 errors, 4.19.3 → 7, 4.53.1 → 7, 4.54.0 → 0.
  //
  // A peer range is a promise about what a CONSUMER can build against, not about what this
  // repository can build. Where those two disagree, the consumer's answer is the one the field is
  // making a claim about.
  "sdk-pty": { floor: "4.54.0", because: "no TS consumer compiles against the SDK below 4.54.0" },
  "sdk-tools": { floor: "4.54.0", because: "no TS consumer compiles against the SDK below 4.54.0" },
};

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

    const measured = MEASURED_FLOORS[pkg];
    if (measured !== undefined) {
      it(`${pkg} keeps the floor its own imports require (${measured.floor})`, () => {
        const manifest = JSON.parse(
          readFileSync(join(REPO_ROOT, "packages", pkg, "package.json"), "utf8"),
        ) as { peerDependencies?: Record<string, string> };

        expect(
          manifest.peerDependencies?.["@theokit/sdk"],
          `${pkg} needs ${measured.floor} for ${measured.because}; a lower floor promises a build that fails`,
        ).toContain(measured.floor);
      });
    }
  }
});
