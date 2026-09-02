import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ADAPTERS_ROOT, listAdapterFiles } from "./_adapter-scope.js";

/**
 * Two of the seven telemetry adapters cannot instrument anything: Braintrust
 * and LangSmith auto-instrument from an env var, so `register()` loading the
 * module IS the whole contribution. That is legitimate. What was not is that
 * the registry printed "auto-instrumented" for them anyway — the log could not
 * distinguish a wired span-processor pipeline from an import.
 *
 * The fix was to make `register()` return WHAT IT WIRED. This gate keeps the
 * contract mechanical: an adapter may not go back to returning nothing, and
 * the registry may not go back to narrating an outcome it did not read.
 *
 * What it does NOT check: whether the outcome an adapter reports is the true
 * one. An adapter that installs nothing and returns "instrumented" passes here
 * and is caught by the behavioural test in the same folder pairing.
 */
describe("telemetry adapters report what they wired", () => {
  const files = listAdapterFiles();

  it("scans every adapter — a sweep that finds no adapters proves nothing", () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
  });

  it("every adapter's register() declares TelemetryWiring as its return type", () => {
    const untyped = files.filter(
      (f) =>
        !readFileSync(join(ADAPTERS_ROOT, f), "utf8").includes("register: (): TelemetryWiring =>"),
    );
    expect(
      untyped,
      "register() returning void is how the registry lost the ability to tell " +
        "'installed a span processor' from 'imported a module'",
    ).toEqual([]);
  });

  it("the registry narrates from the returned value, never from a literal", () => {
    const registry = readFileSync(join(ADAPTERS_ROOT, "..", "adapter-registry.ts"), "utf8");
    expect(registry).toContain("const wiring = adapter.register();");
    // "auto-instrumented" survives as a WIRING_PROSE value, so the marker of
    // the old defect is the SENTENCE-ENDING form: the diag template appends the
    // period, meaning a literal "auto-instrumented." in source can only come
    // from the hard-coded line that asserted the outcome for all seven.
    expect(
      registry.includes("auto-instrumented."),
      "a hard-coded 'auto-instrumented.' in the diag line is the exact defect: " +
        "it asserts an outcome instead of reporting the one register() returned",
    ).toBe(false);
  });
});
