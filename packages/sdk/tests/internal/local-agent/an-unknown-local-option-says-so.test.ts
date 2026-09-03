import { afterEach, describe, expect, it } from "vitest";

import { setDiagnosticsSink } from "../../../src/internal/diagnostics.js";
import { reportUnknownLocalOptions } from "../../../src/internal/local-agent/local-option-keys.js";

/**
 * usetheokit/theokit-sdk#526 — an unrecognised key under `local` was accepted in silence.
 *
 * Measured before this existed, on the 5.x line: `Agent.create({ local: { compatSourcess: [...] } })`
 * — one letter wrong — created the agent with no throw, no warning, and nothing on the diagnostics
 * channel. `compatSources` is a 5.x option and does not exist here, so this file exercises the same
 * silence through `settingSources`, which does. The defect was never about which key it was.
 *
 * ## Why silence is the expensive part
 *
 * It makes two very different failures identical. A consumer whose SDK is too old to know an option
 * gets exactly what a consumer with a typo gets: the default behaviour and no complaint. That is
 * why `usetheokit/theokit#634` is blocked rather than merely unimplemented — a forward of
 * `compatSources` written against a published 5.x SDK would be inert, and nothing would say so.
 *
 * The same shape produced #522 and motivated #524: a surface that accepts input and does nothing
 * with it, where the absence of a complaint reads as acceptance.
 *
 * ## Why a warning and not a throw
 *
 * Refusing an unknown key would break every consumer passing a forward-compatible extra — the
 * ordinary way to write code that must run against two SDK versions — and would turn a diagnostic
 * problem into an outage. The channel is the interceptable one for the same reason #524 uses it: a
 * library must not assume the host's stderr is free.
 */
function capture(): string[] {
  const lines: string[] = [];
  setDiagnosticsSink((m) => {
    lines.push(m);
  });
  return lines;
}

afterEach(() => {
  setDiagnosticsSink(undefined);
});

describe("an unrecognised key under `local` is reported", () => {
  it("names the key that was ignored", () => {
    const lines = capture();

    reportUnknownLocalOptions({ settingSourcess: ["project"] });

    expect(lines.join("")).toContain("settingSourcess");
  });

  it("names the key it was probably meant to be", () => {
    // A warning that says only "unknown key" sends the reader to the docs. The near-miss is the
    // whole value: one letter wrong is the case this exists for.
    //
    // A DIFFERENT typo from the test above, deliberately. The report is deduplicated per key for
    // the lifetime of the process, so reusing one would make this test pass or fail depending on
    // which ran first — the order dependency `rules/testing.md` § 3 forbids.
    const lines = capture();

    reportUnknownLocalOptions({ sessionDirr: "/w/s" });

    expect(lines.join("")).toContain("sessionDir");
  });

  it("says nothing for a configuration that is entirely correct", () => {
    // The counter-proof. A warning that fires on valid input becomes background noise, and the
    // first thing anyone does with a noisy gate is stop reading it.
    const lines = capture();

    reportUnknownLocalOptions({
      cwd: "/w",
      settingSources: ["project"],
      sandboxOptions: { enabled: true },
      sessionDir: "/w/s",
      baseDir: "/w",
    });

    expect(lines).toEqual([]);
  });

  it("says nothing when `local` was not given at all", () => {
    const lines = capture();

    reportUnknownLocalOptions(undefined);

    expect(lines).toEqual([]);
  });

  it("reports every unrecognised key, not just the first", () => {
    // Naming one sends the reader to fix one line and meet the same silence again.
    const lines = capture();

    reportUnknownLocalOptions({ nope: 1, alsoNope: 2 });

    const message = lines.join("");
    expect(message).toContain("nope");
    expect(message).toContain("alsoNope");
  });

  it("reports a key once, however many agents are created with it", () => {
    const lines = capture();

    reportUnknownLocalOptions({ repeatedTypo: 1 });
    reportUnknownLocalOptions({ repeatedTypo: 1 });

    expect(lines).toHaveLength(1);
  });
});
