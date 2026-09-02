/**
 * The whole of `src/` is acyclic. Not "cycle #8 is closed" — acyclic.
 *
 * Three sibling files pin one historical cycle each: #8 (agent-registry ↔ its store), #9, and the
 * memory cluster #11/#12/#13. Each is a good regression test for the cycle it names and none of them
 * says anything about a cycle somewhere else, so a NEW one anywhere in the 538-file tree passed every
 * architecture test in this directory. The property they were all written to protect had no gate.
 *
 * This is the Acyclic Dependencies Principle, which the audit that produced those three calls
 * non-negotiable. It is also the reason a proposal to route every cross-subsystem import through a
 * barrel was NOT adopted: measured on this tree, `internal/local-agent/index.ts` transitively reaches
 * `internal/runtime/lifecycle/` and `internal/session/`, both of which import into local-agent — so
 * making the barrel the entry point would have created file-level cycles in a package that has none.
 * A gate on the real property is worth more than a convention that would break it.
 */
import { describe, expect, it } from "vitest";

import { cycleLines, madgeCircularReport } from "./madge-report.js";

describe("Architecture — the dependency graph is acyclic", () => {
  it("madge --circular reports no cycle anywhere in src/", () => {
    const report = madgeCircularReport();
    const cycles = cycleLines(report);

    expect(
      cycles,
      cycles.length === 0
        ? ""
        : `madge found ${cycles.length} circular dependenc${cycles.length === 1 ? "y" : "ies"} in ` +
            `src/. A cycle means neither module can be understood, tested or extracted without the ` +
            `other:\n${cycles.map((c) => `  ${c}`).join("\n")}\n` +
            `Break it by extracting the shared types into a leaf module — the precedent is ` +
            `internal/runtime/registry/agent-registry-contract.ts (ADR D431).`,
    ).toEqual([]);
    // 90s, matching every sibling in this directory. madge spawns a subprocess that walks 535
    // files — ~7s alone, and past the 20s global timeout under full-suite load. Measured: this
    // failed once in a full run and passed in isolation, which is a flaky gate rather than a cycle.
  }, 90_000);
});
