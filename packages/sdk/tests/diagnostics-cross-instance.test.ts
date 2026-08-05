import { describe, expect, it } from "vitest";

import { diag, setDiagnosticsSink } from "../src/internal/diagnostics.js";

/**
 * theokit#173 — the sink must survive TWO copies of `@theokit/sdk` in one process.
 *
 * A module-level `let sink` is a per-instance singleton, and a package manager will happily install
 * two physical copies of the same version when two dependents resolve different peer sets. Measured
 * in the theokit workspace: `@theokit/sdk@4.39.1` existed under two pnpm store hashes, so the sink a
 * consumer installed through `@theokit/agents` landed in a different registry than the one the
 * emitter writes to.
 *
 * The symptom is the worst kind: the re-export resolves, the function is callable, nothing throws —
 * and no diagnostic ever arrives. "The symbol exists" is not evidence that the wiring works.
 *
 * The registry therefore lives on `globalThis` under a versioned symbol, shared by every copy in the
 * process. This test simulates the second copy by writing the slot directly, which is exactly what a
 * duplicated instance does.
 */
const SLOT = Symbol.for("theokit.sdk.diagnostics.sink.v1");

describe("theokit#173 — the sink registry is shared across duplicated SDK copies", () => {
  it("test_a_sink_installed_by_another_copy_receives_our_emissions", () => {
    const seen: string[] = [];
    // Stands in for "copy B installed a sink": it writes the shared slot directly.
    (globalThis as Record<symbol, unknown>)[SLOT] = (m: string) => seen.push(m);

    diag("from copy A");

    expect(seen, "a sink installed by another copy did not receive our emission").toEqual([
      "from copy A",
    ]);
    setDiagnosticsSink(undefined);
  });

  it("test_our_sink_is_visible_to_another_copy", () => {
    const seen: string[] = [];
    setDiagnosticsSink((m) => seen.push(m));

    // Stands in for "copy B emits": it reads the shared slot directly.
    const installed = (globalThis as Record<symbol, unknown>)[SLOT] as
      | ((m: string) => void)
      | undefined;
    expect(installed, "our sink is invisible to another copy").toBeTypeOf("function");
    installed?.("from copy B");

    expect(seen).toEqual(["from copy B"]);
    setDiagnosticsSink(undefined);
  });

  it("test_removing_the_sink_clears_the_shared_slot", () => {
    setDiagnosticsSink(() => undefined);
    setDiagnosticsSink(undefined);
    expect((globalThis as Record<symbol, unknown>)[SLOT]).toBeUndefined();
  });
});
