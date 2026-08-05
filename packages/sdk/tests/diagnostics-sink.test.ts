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
    const escrever = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    diag("[theokit-sdk] algo aconteceu\n");

    expect(escrever).not.toHaveBeenCalled();
  });

  it("with a sink installed, the application receives the message", () => {
    const recebidas: string[] = [];
    setDiagnosticsSink((m) => recebidas.push(m));

    diag("[theokit-sdk] recall falhou\n");

    expect(recebidas).toEqual(["[theokit-sdk] recall falhou\n"]);
  });

  it("with a sink installed, stderr gets NO copy", () => {
    const escrever = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    setDiagnosticsSink(() => undefined);

    // Duplicating destinations would hand the problem back to the TUI that installed the sink precisely to get
    // the messages out of the terminal — it is the reported defect, back again.
    diag("[theokit-sdk] x\n");

    expect(escrever).not.toHaveBeenCalled();
  });

  it("an empty sink is the path for anyone wanting silence today", () => {
    const escrever = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    setDiagnosticsSink(() => {
      /* descarta */
    });

    diag("[theokit-sdk] x\n");

    expect(escrever).not.toHaveBeenCalled();
  });

  it("removing the sink returns to silence, not to stderr (#147)", () => {
    // Was "removing the sink gives stderr back". Since theokit#147 flipped the default, uninstalling
    // returns to the production default — silence — rather than to the terminal. A host that tears
    // its sink down on shutdown must not start writing onto the screen it just released.
    const escrever = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    setDiagnosticsSink(() => undefined);
    setDiagnosticsSink(undefined);

    diag("[theokit-sdk] x\n");

    expect(escrever).not.toHaveBeenCalled();
  });

  it("a throwing sink does not take down the run it merely observes", () => {
    setDiagnosticsSink(() => {
      throw new Error("sink quebrado");
    });

    expect(() => diag("[theokit-sdk] x\n")).not.toThrow();
  });
});
