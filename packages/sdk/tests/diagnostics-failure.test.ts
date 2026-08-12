/**
 * B-102 bullet 3 — a diagnostic with no installed sink must not be the ONLY report of a
 * user-visible failure.
 *
 * `diag()` is silent when nothing is installed, and that default is right for what it was built
 * for: a library must not assume the host's stderr is a free-form log, because in a TUI it is the
 * render surface. Chatter dropped costs nothing.
 *
 * A FAILURE is a different message. `theokit-sdk#189` is the record: an MCP server failed to start,
 * the only report went to `diag()`, and the embedding UI never read it — so the user saw an agent
 * with missing tools and no reason given. The defect was found by a consumer in production, which
 * is the expensive discovery path B-102 exists to close.
 *
 * The two failure modes are not symmetric, and that asymmetry is the whole decision: a corrupted
 * frame is visible and recoverable; a silently dropped failure is neither.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { diag, diagFailure, setDiagnosticsSink } from "../src/internal/diagnostics.js";

afterEach(() => {
  setDiagnosticsSink(undefined);
  vi.restoreAllMocks();
});

describe("diagFailure — with no sink installed", () => {
  // `vitest.setup.ts` installs a sink forwarding to stderr for EVERY test (theokit#147 — 36 files
  // assert warnings by spying on stderr, and that contract is real). These cases are about the
  // no-sink path, so they clear it first. Doing it in `afterEach` was not enough: the setup
  // re-installs before the next case.
  beforeEach(() => {
    setDiagnosticsSink(undefined);
  });

  it("test_a_failure_reaches_stderr_when_nothing_is_installed", () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    // `vi.spyOn` on an already-spied method returns the SAME mock, so the previous case's calls
    // leak in. Clearing is what makes each case independent (`rules/testing.md` — no shared state).
    write.mockClear();

    diagFailure("mcp server `db` failed to start");

    expect(write).toHaveBeenCalled();
    expect(String(write.mock.calls[0]?.[0])).toContain("failed to start");
  });

  it("test_ordinary_chatter_still_stays_silent", () => {
    // Anti-vacuity, and the reason `diag` is not simply changed: routing everything to stderr would
    // put library chatter onto a TUI's render surface, which is what #147 removed.
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    // `vi.spyOn` on an already-spied method returns the SAME mock, so the previous case's calls
    // leak in. Clearing is what makes each case independent (`rules/testing.md` — no shared state).
    write.mockClear();

    diag("cache warmed in 12ms");

    // Asserted on CONTENT rather than on call count: the spy is on the real `process.stderr`, and
    // vitest itself writes there during a run. "Was never called" was too strong a claim and failed
    // for a reason that had nothing to do with the code.
    const written = write.mock.calls.map((c) => String(c[0])).join("");
    expect(written).not.toContain("cache warmed");
  });
});

describe("diagFailure — with a sink installed", () => {
  it("test_the_sink_receives_it_and_stderr_does_not", () => {
    // The host asked for these messages so they would stop reaching the terminal. Sending both
    // would hand the problem back to whoever installed the sink.
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    // `vi.spyOn` on an already-spied method returns the SAME mock, so the previous case's calls
    // leak in. Clearing is what makes each case independent (`rules/testing.md` — no shared state).
    write.mockClear();
    const seen: string[] = [];
    setDiagnosticsSink((m) => seen.push(m));

    diagFailure("oauth refresh failed");

    expect(seen).toEqual(["oauth refresh failed"]);
    expect(write.mock.calls.map((c) => String(c[0])).join("")).not.toContain(
      "oauth refresh failed",
    );
  });

  it("test_a_throwing_sink_still_gets_the_failure_to_stderr", () => {
    // The case that makes this worth writing. A sink that throws would otherwise swallow the one
    // report of a failure — the exact shape of the defect, one layer further in.
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    // `vi.spyOn` on an already-spied method returns the SAME mock, so the previous case's calls
    // leak in. Clearing is what makes each case independent (`rules/testing.md` — no shared state).
    write.mockClear();
    setDiagnosticsSink(() => {
      throw new Error("sink is broken");
    });

    diagFailure("credential store unreadable");

    expect(write).toHaveBeenCalled();
    expect(String(write.mock.calls[0]?.[0])).toContain("credential store unreadable");
  });

  it("test_a_throwing_sink_does_not_take_down_the_run", () => {
    setDiagnosticsSink(() => {
      throw new Error("sink is broken");
    });

    expect(() => diagFailure("anything")).not.toThrow();
  });
});
