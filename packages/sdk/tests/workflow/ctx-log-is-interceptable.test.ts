import { afterEach, describe, expect, it } from "vitest";

import { setDiagnosticsSink } from "../../src/internal/diagnostics.js";
import { makeStepContext } from "../../src/internal/workflow/ctx.js";

/**
 * theokit#147: the SDK's diagnostics channel exists so a host can INTERCEPT what would otherwise go
 * to the terminal — `internal/diagnostics.ts` states the reason in its own words, that direct writes
 * "interleave with the render and CORRUPT THE FRAME" under a TUI.
 *
 * `ctx.log` was `console.warn` / `console.log`, and diagnostics.ts allowlisted "the Workflow logger"
 * as a seam whose destination the caller chooses. It was not one: `types/workflow.ts` declares no
 * logger option and `StepContext.log` is built with no injection point, so a consumer had no way to
 * redirect it. This asserts the channel rather than the absence of a console call — a grep for
 * `console.` would pass against a logger that writes somewhere else entirely.
 */
describe("ctx.log reaches the interceptable channel", () => {
  afterEach(() => {
    setDiagnosticsSink(undefined);
  });

  it("routes every level through the diagnostics sink a host installs", () => {
    const captured: string[] = [];
    setDiagnosticsSink((line) => captured.push(line));

    let state: unknown;
    const ctx = makeStepContext("run-42", new AbortController().signal, {
      getState: () => state,
      setState: (next) => {
        state = next;
      },
    });
    ctx.log.debug("starting");
    ctx.log.info("halfway");
    ctx.log.warn("careful", { attempt: 2 });

    expect(
      captured,
      "nothing reached the sink — the logger is still writing elsewhere",
    ).toHaveLength(3);
    expect(captured[0]).toContain("[workflow run-42] debug: starting");
    expect(captured[1]).toContain("[workflow run-42] info: halfway");
    expect(captured[2]).toContain("[workflow run-42] warn: careful");
    expect(captured[2], "structured attrs survive the conversion").toContain('"attempt":2');
  });
});
