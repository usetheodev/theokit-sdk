/**
 * B-014 — `fireCronJobAsTask` has two fire shapes and a fallback; only one shape was exercised.
 *
 * lcov before this file: 50% statements / 25% branches, with lines 31-36 and 49-50 at count 0. The
 * covered half is the workflow target (`tests/cron-workflow.test.ts` drives it end to end). Untested:
 * the AGENT target — where the `Run` is deferred, so the handler wires an abort listener and awaits a
 * terminal status — and the catch fallback.
 *
 * The fallback is the reason this file exists. Its five-line comment asserts a safety invariant:
 *
 *   "a throw here means the SUBMIT itself failed BEFORE `work` started — the job never ran, and this
 *    is its first + only execution"
 *
 * That no-double-execution claim is the entire argument for the fallback being safe to run, and
 * nothing verified it. A comment is not an oracle; if `submit` ever began throwing AFTER starting
 * `work`, every cron fire would silently run twice and the suite would stay green.
 *
 * Both module boundaries are mocked, which the parsimony ladder reaches only at its last rung: a
 * duplicate task id returns the existing handle rather than throwing (registry.ts, D367 single-flight)
 * and the reserved-prefix guard is explicitly bypassed by the handler, so there is no input that makes
 * a real `submit` fail.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CronJob } from "../../../src/types/cron.js";

const runCronJob = vi.fn();
const submit = vi.fn();

vi.mock("../../../src/internal/cron/run-job.js", () => ({
  runCronJob: (job: unknown) => runCronJob(job),
  // The real discriminator, not a stub: `isAgentRun` is what decides which branch runs, so replacing
  // it with a fixed answer would test the test's opinion instead of the handler's.
  isAgentRun: (outcome: { wait?: unknown }) => typeof outcome.wait === "function",
}));

vi.mock("../../../src/internal/task/registry.js", () => ({
  submit: (internal: unknown) => submit(internal),
}));

const { fireCronJobAsTask } = await import("../../../src/internal/cron/fire-handler.js");

const job = { id: "j1", name: "nightly", cron: "0 0 * * *", message: "go" } as unknown as CronJob;

/** A deferred agent `Run`: has `wait`, so `isAgentRun` selects the agent branch. */
function agentRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    wait: vi.fn(async () => ({ status: "completed" })),
    cancel: vi.fn(async () => {}),
    ...overrides,
  };
}

/** An already-terminal workflow run: no `wait`, so the handler must NOT await one. */
const workflowRun = { id: "wf-1", status: "success" };

/** Runs the `work` callback the handler passed to `submit`, with a controllable abort signal. */
async function driveWork(signal: AbortSignal): Promise<unknown> {
  const internal = submit.mock.calls[0]?.[0] as {
    work: (ctx: { signal: AbortSignal; emit: (p: unknown) => void }) => Promise<unknown>;
  };
  const emitted: unknown[] = [];
  const result = await internal.work({ signal, emit: (p) => emitted.push(p) });
  return { result, emitted };
}

beforeEach(() => {
  runCronJob.mockReset();
  submit.mockReset();
  submit.mockResolvedValue({ id: "t1" });
});
afterEach(() => vi.clearAllMocks());

describe("the agent target — a deferred Run the handler must await", () => {
  it("test_the_agent_branch_awaits_the_run_and_records_its_terminal_status", async () => {
    const run = agentRun();
    runCronJob.mockResolvedValue(run);

    await fireCronJobAsTask(job);
    const { result, emitted } = (await driveWork(new AbortController().signal)) as {
      result: { status: string; runId: string };
      emitted: unknown[];
    };

    expect(
      run.wait,
      "the agent Run is deferred — not awaiting it records a status nobody has",
    ).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: "completed", runId: "run-1" });
    expect(emitted, "subscribers observe the fire through this emit").toEqual([
      { status: "completed", runId: "run-1" },
    ]);
  });

  it("test_aborting_the_task_cancels_the_underlying_run", async () => {
    // The abort wiring is the difference between `Task.cancel` stopping a cron fire and merely marking
    // it cancelled while the agent keeps running.
    //
    // The run must stay PENDING for the abort to have anything to reach. My first attempt resolved
    // `wait()` immediately, so the work completed before `abort()` was called and the listener — which
    // is registered `{ once: true }` — had nothing left to cancel. It failed for a reason that says
    // nothing about the handler, which is its own kind of bad test.
    let finish: (v: { status: string }) => void = () => {};
    const pending = new Promise<{ status: string }>((r) => {
      finish = r;
    });
    const run = agentRun({
      wait: vi.fn(() => pending),
      cancel: vi.fn(async () => finish({ status: "cancelled" })),
    });
    runCronJob.mockResolvedValue(run);
    const ac = new AbortController();

    await fireCronJobAsTask(job);
    const work = driveWork(ac.signal);

    // Abort only once the listener EXISTS. The handler registers it after awaiting `runCronJob`, so
    // aborting synchronously here fires into a signal nobody is listening to — my first attempt did
    // exactly that and hung for 20s. `run.wait` having been called is the observable proof that
    // registration already happened, since it is the very next statement.
    for (let i = 0; i < 200 && run.wait.mock.calls.length === 0; i++) {
      await new Promise((r) => setImmediate(r));
    }
    expect(run.wait, "the handler must have reached the await before we abort").toHaveBeenCalled();

    ac.abort();
    await work;

    expect(run.cancel, "aborting the task must reach the Run").toHaveBeenCalledTimes(1);
  });

  it("test_a_cancel_that_rejects_does_not_escape_the_abort_listener", async () => {
    // Exercises the path where a provider REFUSES a cancel, and asserts the fire still completes.
    //
    // Scoped honestly: it does NOT constrain the `.catch(() => {})` itself. Deleting that catch leaves
    // this test green — measured, twice. The rejection belongs to a promise nobody awaits, and the
    // only witness would be the process; a `process.on("unhandledRejection")` probe never fired here,
    // so vitest is absorbing it. Reaching a line is not constraining it, and claiming otherwise is the
    // defect this whole campaign exists to find. Filed as B-106 rather than dressed up.
    let finish: (v: { status: string }) => void = () => {};
    const pending = new Promise<{ status: string }>((r) => {
      finish = r;
    });
    const run = agentRun({
      wait: vi.fn(() => pending),
      cancel: vi.fn(async () => {
        finish({ status: "cancelled" });
        throw new Error("the provider refused the cancel");
      }),
    });
    runCronJob.mockResolvedValue(run);
    const ac = new AbortController();

    await fireCronJobAsTask(job);
    const work = driveWork(ac.signal);
    for (let i = 0; i < 200 && run.wait.mock.calls.length === 0; i++) {
      await new Promise((r) => setImmediate(r));
    }
    ac.abort();

    await expect(work, "a refused cancel must not break the fire").resolves.toBeDefined();
    expect(run.cancel).toHaveBeenCalledTimes(1);
  });

  it("test_a_workflow_target_is_already_terminal_and_is_not_awaited", async () => {
    // The other side of the discriminator. A WorkflowRun has no `wait`; calling one would throw.
    runCronJob.mockResolvedValue(workflowRun);

    await fireCronJobAsTask(job);
    const { result } = (await driveWork(new AbortController().signal)) as {
      result: { status: string; runId: string };
    };

    expect(result).toEqual({ status: "success", runId: "wf-1" });
  });
});

describe("the fallback — and the no-double-execution invariant its comment asserts", () => {
  it("test_a_failing_submit_still_runs_the_job", async () => {
    submit.mockRejectedValue(new Error("registry setup failed"));
    runCronJob.mockResolvedValue(workflowRun);

    await expect(
      fireCronJobAsTask(job),
      "the task registry must not be able to break cron",
    ).resolves.toBeUndefined();
    expect(runCronJob).toHaveBeenCalledTimes(1);
  });

  it("test_the_fallback_runs_the_job_exactly_once_never_twice", async () => {
    // THE invariant. The fallback is safe only because a `submit` throw means `work` never started —
    // so the fallback's own run is the job's first and only execution. If that ever stopped holding,
    // every cron fire would run twice, and before this test nothing would have noticed.
    //
    // Modelled faithfully: `submit` rejects WITHOUT invoking the `work` callback it was handed, which
    // is exactly what a pre-`work` setup failure looks like.
    submit.mockRejectedValue(new Error("id collision in registry setup"));
    runCronJob.mockResolvedValue(workflowRun);

    await fireCronJobAsTask(job);

    expect(
      runCronJob,
      "one submit failure must not produce two executions of the same fire",
    ).toHaveBeenCalledTimes(1);
  });

  it("test_the_fallback_awaits_an_agent_run_before_returning", async () => {
    // Without the await, the handler resolves while the agent is still working and the scheduler
    // treats the fire as finished.
    const run = agentRun();
    submit.mockRejectedValue(new Error("registry setup failed"));
    runCronJob.mockResolvedValue(run);

    await fireCronJobAsTask(job);

    expect(run.wait).toHaveBeenCalledTimes(1);
  });
});
