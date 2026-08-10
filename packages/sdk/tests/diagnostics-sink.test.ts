import { afterEach, describe, expect, it, vi } from "vitest";

import { diag, setDiagnosticsSink } from "../src/internal/diagnostics.js";

/**
 * theokit-sdk#147 — the library does not own the terminal.
 *
 * The SDK wrote diagnostics straight to `process.stderr` from hot paths (92 sites
 * across 51 files under `internal/`). In a TUI host (Ink, alternate screen), those writes
 * interleave with the render and corrupt the frame — and the host **had no way to intercept them**. One
 * consumer went as far as installing `proper-lockfile` just to silence ONE of them.
 *
 * These tests lock the single channel and the interception. Flipping the default to silent is
 * its own migration (58 test files assert `stderr` today) — see the comment in
 * `diagnostics.ts`.
 */
describe("interceptable diagnostics channel (#147)", () => {
  afterEach(() => {
    setDiagnosticsSink(undefined);
    vi.restoreAllMocks();
  });

  it("with no sink installed, nothing is written — silent by default (#147)", () => {
    // Was "no sink => stderr". theokit#147 asked for silence by default and this now delivers it.
    // `vitest.setup.ts` forwards to stderr during tests so the 36 suites asserting "a warning is
    // emitted" survive, hence the explicit clear here.
    setDiagnosticsSink(undefined);
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    diag("[theokit-sdk] something happened\n");

    expect(write).not.toHaveBeenCalled();
  });

  it("with a sink installed, the application receives the message", () => {
    const received: string[] = [];
    setDiagnosticsSink((m) => received.push(m));

    diag("[theokit-sdk] recall failed\n");

    expect(received).toEqual(["[theokit-sdk] recall failed\n"]);
  });

  it("with a sink installed, stderr gets NO copy", () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    setDiagnosticsSink(() => undefined);

    // Duplicating destinations would hand the problem back to the TUI that installed the sink precisely to get
    // the messages out of the terminal — it is the reported defect, back again.
    diag("[theokit-sdk] x\n");

    expect(write).not.toHaveBeenCalled();
  });

  it("an empty sink is the path for anyone wanting silence today", () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    setDiagnosticsSink(() => {
      /* discard */
    });

    diag("[theokit-sdk] x\n");

    expect(write).not.toHaveBeenCalled();
  });

  it("removing the sink returns to silence, not to stderr (#147)", () => {
    // Was "removing the sink gives stderr back". Since theokit#147 flipped the default, uninstalling
    // returns to the production default — silence — rather than to the terminal. A host that tears
    // its sink down on shutdown must not start writing onto the screen it just released.
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    setDiagnosticsSink(() => undefined);
    setDiagnosticsSink(undefined);

    diag("[theokit-sdk] x\n");

    expect(write).not.toHaveBeenCalled();
  });

  it("a throwing sink does not take down the run it merely observes", () => {
    setDiagnosticsSink(() => {
      throw new Error("sink is broken");
    });

    expect(() => diag("[theokit-sdk] x\n")).not.toThrow();
  });
});
