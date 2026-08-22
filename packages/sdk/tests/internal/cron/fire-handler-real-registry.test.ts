/**
 * B-118 — the no-double-execution invariant was asserted by a comment and verified by nothing.
 *
 * `fireCronJobAsTask`'s fallback carries a five-line comment arguing it is safe to re-run the job:
 *
 *   "a throw here means the SUBMIT itself failed BEFORE `work` started — the job never ran, and this
 *    is its first + only execution"
 *
 * That claim is the entire reason the fallback is allowed to call `runCronJob` again. It is a
 * property of `taskRegistrySubmit`, not of the handler — and `fire-handler.test.ts` cannot see it,
 * because it MOCKS submit and makes it reject without ever invoking the callback. Those tests assume
 * the premise they appear to check.
 *
 * Measured by independent review (recorded on B-118): a mutant in `task/registry.ts` that throws
 * AFTER the fire-and-forget IIFE survives the entire cron surface — 7 passed in `fire-handler.test.ts`,
 * 11 passed in `cron-workflow` + `run-job-errors` — while `runCronJob` was instrumented and observed
 * running the SAME JOB TWICE. Every test stayed green through a genuine double execution.
 *
 * This file closes that hole. It mocks ONLY `run-job.js`, so `submit` is the real one, and it counts
 * the calls after the task reaches a terminal state rather than after the handler returns. The timing
 * distinction is what makes the oracle work: on the mutant the fallback's call lands FIRST (the
 * handler awaits it) and the IIFE's call arrives later, so an assertion taken at handler-return would
 * still read 1 and stay green. Waiting for terminal is what lets the second call be observed.
 *
 * Verified to fail on the mutation it exists to catch — see the mutant demonstration recorded on
 * a throw injected immediately after the fire-and-forget IIFE in `task/registry.ts`. Under it this
 * file reports 2 failed ("expected 1 times, but got 2 times") while the pre-existing cron surface —
 * fire-handler + run-job-errors + cron-workflow — stays GREEN at 17 passed, through a genuine double
 * execution. Restored: 64 passed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CronJob } from "../../../src/types/cron.js";

const runCronJob = vi.fn();

vi.mock("../../../src/internal/cron/run-job.js", async (importOriginal) => {
  // Only `runCronJob` is replaced. `isAgentRun` stays REAL — a hand-copied discriminator is what
  // made an earlier cron test blind to the branch it claimed to exercise (see fire-handler.test.ts).
  const actual = await importOriginal<typeof import("../../../src/internal/cron/run-job.js")>();
  return { ...actual, runCronJob: (job: unknown) => runCronJob(job) };
});

import { fireCronJobAsTask } from "../../../src/internal/cron/fire-handler.js";
import {
  __resetTaskRegistryForTests,
  list as listTasks,
} from "../../../src/internal/task/registry.js";

const TERMINAL = new Set(["finished", "error", "cancelled"]);

function cronJob(id: string): CronJob {
  return {
    id,
    name: `job ${id}`,
    cron: "*/5 * * * *",
    timezone: "UTC",
    runtime: "local",
    enabled: true,
    status: "scheduled",
    createdAt: Date.now(),
    workflowId: "wf-under-test",
  } as unknown as CronJob;
}

/**
 * Yields to the macrotask queue until the cron task for `jobId` reaches a terminal state.
 *
 * Deliberately NOT a sleep: it advances on the event loop, so it finishes as soon as the registry
 * has finished rather than after a guessed interval. The bound exists so a genuine hang fails with a
 * readable message instead of the runner's timeout.
 */
async function waitForTerminalCronTask(jobId: string): Promise<void> {
  for (let attempt = 0; attempt < 5_000; attempt += 1) {
    const tasks = await listTasks({ kind: "cron" });
    const mine = tasks.filter((t) => t.id.startsWith(`cron-${jobId}-`));
    if (mine.length > 0 && mine.every((t) => TERMINAL.has(t.state))) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`cron task for ${jobId} never reached a terminal state`);
}

describe("fireCronJobAsTask against the REAL task registry", () => {
  beforeEach(() => {
    __resetTaskRegistryForTests();
    runCronJob.mockReset();
    // A workflow-shaped outcome: already terminal, so `isAgentRun` is false and the handler takes
    // the no-`wait()` branch. The shape matters only because the real discriminator reads `.wait`.
    runCronJob.mockResolvedValue({ id: "wfrun-1", status: "succeeded" });
  });

  afterEach(() => {
    __resetTaskRegistryForTests();
  });

  it("test_a_successful_fire_runs_the_job_exactly_once_never_twice", async () => {
    // THE invariant. On a registry that throws after starting `work`, the handler's fallback runs
    // the job a second time and this count reads 2 — which is the defect the source comment claims
    // cannot happen, and which nothing in the suite could observe before this test existed.
    const job = cronJob("job-once");

    await fireCronJobAsTask(job);
    await waitForTerminalCronTask(job.id);

    expect(runCronJob, "the cron job must execute exactly once per fire").toHaveBeenCalledTimes(1);
    expect(runCronJob).toHaveBeenCalledWith(job);
  });

  it("test_the_task_the_fire_registers_reaches_a_terminal_state", async () => {
    // The accepting half of the oracle (testing.md § 4.2). Without it, a registry that refused every
    // submit would still satisfy the count-of-one assertion above by never running anything.
    const job = cronJob("job-terminal");

    await fireCronJobAsTask(job);
    await waitForTerminalCronTask(job.id);

    const tasks = await listTasks({ kind: "cron" });
    const mine = tasks.filter((t) => t.id.startsWith(`cron-${job.id}-`));

    expect(mine, "the fire must register exactly one cron task").toHaveLength(1);
    expect(mine[0]?.state).toBe("finished");
  });

  it("test_two_fires_of_the_same_job_run_it_twice_and_register_two_tasks", async () => {
    // Guards the count-of-one assertion from the opposite direction: it must be counting THIS fire,
    // not a registry that silently drops repeat work. The task ids differ by fire timestamp (D368).
    const job = cronJob("job-twice");

    await fireCronJobAsTask(job);
    await waitForTerminalCronTask(job.id);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await fireCronJobAsTask(job);
    await waitForTerminalCronTask(job.id);

    expect(runCronJob).toHaveBeenCalledTimes(2);
    const tasks = await listTasks({ kind: "cron" });
    expect(tasks.filter((t) => t.id.startsWith(`cron-${job.id}-`))).toHaveLength(2);
  });
});
