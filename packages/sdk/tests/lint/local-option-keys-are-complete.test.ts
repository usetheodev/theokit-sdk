import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { knownLocalOptionKeys } from "../../src/internal/local-agent/local-option-keys.js";

/**
 * The set that backs #526's unknown-key warning must name every key `LocalOptions` declares.
 *
 * A TypeScript interface does not exist at runtime, so the set is written by hand — and a
 * hand-written mirror of a type is a thing that goes stale. The failure mode is worse than the
 * silence it replaced: a NEW option would be reported as unknown, so the warning would fire on
 * correct configuration, and the first thing anyone does with a gate that false-positives is stop
 * reading it.
 *
 * Parsed from the source rather than from a type helper: `keyof LocalOptions` is checkable at
 * compile time and this test has to fail at RUN time, in CI, on the day someone adds a key.
 */
const AGENT_TYPES = join(__dirname, "..", "..", "src", "types", "agent.ts");

function declaredLocalOptionKeys(): string[] {
  const source = readFileSync(AGENT_TYPES, "utf8");
  const start = source.indexOf("export interface LocalOptions {");
  expect(start, "LocalOptions moved — this lint parses it by name").toBeGreaterThan(-1);
  const body = source.slice(start, source.indexOf("\n}", start));
  // Two-space indent is the interface's own member depth; anything deeper belongs to a nested
  // object literal (`sandboxOptions: { enabled: boolean }`) and is not a key of LocalOptions.
  return [...body.matchAll(/^ {2}([a-zA-Z_][a-zA-Z0-9_]*)\??:/gm)]
    .map((m) => m[1])
    .filter((k): k is string => k !== undefined);
}

describe("lint: the known-key set mirrors LocalOptions", () => {
  it("names every key the interface declares", () => {
    const declared = declaredLocalOptionKeys();
    expect(
      declared.length,
      "parsed no keys — the regex or the interface shape changed",
    ).toBeGreaterThan(3);

    const known = knownLocalOptionKeys();
    const missing = declared.filter((k) => !known.has(k));

    expect(
      missing,
      `LocalOptions declares ${missing.join(", ")}, which KNOWN_LOCAL_OPTION_KEYS does not. A new ` +
        "option would be reported as unknown — the warning firing on correct config, which is how " +
        "it stops being read. Add it to the set in `internal/local-agent/local-option-keys.ts`.",
    ).toEqual([]);
  });

  it("names nothing the interface does not declare", () => {
    // The other direction. A key left in the set after the option was removed silences the warning
    // for a name that means nothing — the check would accept input this SDK ignores.
    const declared = new Set(declaredLocalOptionKeys());
    const stale = [...knownLocalOptionKeys()].filter((k) => !declared.has(k));

    expect(stale, `KNOWN_LOCAL_OPTION_KEYS still names ${stale.join(", ")}`).toEqual([]);
  });
});
