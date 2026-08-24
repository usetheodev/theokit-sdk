/**
 * B-001 residue — `runSleepStep` executed in no test at all (`FNDA:0`).
 *
 * Five lines, and the reason it exists is the `catch`: an aborted sleep becomes a `failed` step
 * RESULT rather than a thrown exception. One branch away, the abort propagates as a `DOMException`
 * through a workflow runner that expects a result object — so the module's whole job is the thing
 * nothing was checking.
 *
 * The sleeps here are real and tiny. A faked clock would test the fake: `abortableSleep` races a
 * `setTimeout` against an `abort` listener, and mocking the timer removes the race that is the
 * subject.
 */

import { describe, expect, it } from "vitest";

import { runSleepStep } from "../../src/internal/workflow/step-sleep.js";
import type { SleepStep, StepContext } from "../../src/types/workflow.js";

function ctx(signal: AbortSignal): StepContext {
  // Built to the full interface rather than cast into it: a cast would keep compiling when
  // `StepContext` grows a field this step later reads, which is the moment the test stops
  // representing what the runner passes.
  return {
    runId: "run-1",
    signal,
    log: { debug: () => {}, info: () => {}, warn: () => {} },
    suspend: () => Promise.reject(new Error("suspend is not part of a sleep step")),
    state: undefined,
    setState: () => {},
  };
}

const step = (durationMs: number): SleepStep =>
  ({ id: "nap", kind: "sleep", durationMs }) as SleepStep;

describe("runSleepStep", () => {
  it("test_a_completed_sleep_passes_its_input_through_unchanged", async () => {
    // `sleep` is a pass-through: the workflow's data must arrive at the next step untouched. Returning
    // undefined here would silently empty the pipeline rather than fail it.
    const payload = { order: 7, items: ["a", "b"] };
    const res = await runSleepStep(step(5), payload, ctx(new AbortController().signal));

    expect(res.status).toBe("completed");
    expect(res.output, "the same value, not a copy that merely looks alike").toBe(payload);
  });

  it("test_an_aborted_sleep_returns_a_failed_result_rather_than_throwing", async () => {
    const ac = new AbortController();
    const promise = runSleepStep(step(10_000), "in", ctx(ac.signal));
    ac.abort();

    // The assertion is as much about what does NOT happen: no rejection escapes to the runner.
    const res = await promise;
    expect(res.status).toBe("failed");
    expect(res.error, "a failed step must carry the reason it failed").toBeDefined();
  });

  it("test_an_already_aborted_signal_fails_without_waiting_out_the_duration", async () => {
    // `abortableSleep` checks `signal.aborted` before arming the timer. Without that check this call
    // would sit for ten seconds on a signal that was already dead — the test's own duration is the
    // oracle, which is why the sleep is long enough that waiting it out is unmistakable.
    const ac = new AbortController();
    ac.abort();
    const started = Date.now();
    const res = await runSleepStep(step(10_000), "in", ctx(ac.signal));

    expect(res.status).toBe("failed");
    expect(Date.now() - started, "must not have waited out the duration").toBeLessThan(1_000);
  });

  it("test_the_step_reports_the_kind_and_id_it_was_given", async () => {
    // The runner correlates results back to steps by these two fields; a wrong id attributes a
    // failure to the wrong step, which is worse than no result at all.
    const res = await runSleepStep(step(1), null, ctx(new AbortController().signal));

    expect(res.stepId).toBe("nap");
    expect(res.kind).toBe("sleep");
    expect(res.attempts).toBe(1);
  });
});
