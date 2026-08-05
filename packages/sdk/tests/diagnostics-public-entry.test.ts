/**
 * theokit#147 — the sink must be installable from where a CONSUMER stands.
 *
 * The original fix routed 92 internal sites through `diag()` and added a lint gate, and every test
 * it shipped imported `setDiagnosticsSink` from `src/internal/diagnostics.js`. That path is not in
 * the package's `exports` map, so no consumer can reach it: the suite was green while the issue's
 * actual complaint — "a TUI host has no way to intercept these; no injectable logger" — was still
 * true. A channel nobody can install is not a channel.
 *
 * These tests therefore import from the PUBLIC barrel, exactly as a host would, and drive a real
 * SDK path rather than calling `diag()` directly. Importing internals here would reproduce the
 * blind spot this file exists to close.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { compactTranscript } from "../src/compaction.js";
import { setDiagnosticsSink } from "../src/index.js";

afterEach(() => {
  setDiagnosticsSink(undefined);
  vi.restoreAllMocks();
});

/** A real SDK path that emits a diagnostic: the fail-safe summarizer breadcrumb. */
async function provokeADiagnostic(): Promise<void> {
  await compactTranscript(
    [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
      { role: "assistant", content: "d" },
    ],
    {
      keepRecent: 1,
      failSafe: true,
      summarize: async () => {
        throw new Error("summarizer down");
      },
    },
  );
}

describe("theokit#147 — the diagnostics sink is reachable from the public entry", () => {
  it("test_a_consumer_can_install_a_sink_and_receives_a_real_SDK_diagnostic", async () => {
    const received: string[] = [];
    setDiagnosticsSink((message) => received.push(message));

    await provokeADiagnostic();

    expect(received.join("")).toContain("summarizer down");
  });

  it("test_the_one_line_silence_a_TUI_host_needs_actually_works", async () => {
    // This is the claim the issue comment made and could not honour: one line, from the public
    // entry, and the library stops writing to the terminal.
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    setDiagnosticsSink(() => {});

    await provokeADiagnostic();

    expect(stderr).not.toHaveBeenCalled();
  });

  it("test_COUNTERPROOF_with_no_sink_the_diagnostic_still_reaches_stderr", async () => {
    // Silence must be something the host CHOOSES. Default-silent would be a separate, breaking
    // change (35 suites assert the warning is emitted) and is deliberately not what this does.
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    await provokeADiagnostic();

    expect(stderr).toHaveBeenCalled();
  });

  it("test_uninstalling_the_sink_restores_the_default", async () => {
    const received: string[] = [];
    setDiagnosticsSink((message) => received.push(message));
    setDiagnosticsSink(undefined);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    await provokeADiagnostic();

    expect(received).toEqual([]);
    expect(stderr).toHaveBeenCalled();
  });
});
