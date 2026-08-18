/**
 * T3.5 — `Cron.start` default fire handler wraps each fire as a Task
 * (ADRs D363, D374). Every cron tick registers a `kind: "cron"` task
 * with namespaced id `cron-{jobId}-{fireEpochMs}` (D368, EC-5).
 *
 * Tests use the scheduler's manual `Cron.run(jobId)` path which goes
 * through the same default fire handler (D5).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Cron } from "../../src/cron.js";
import { fireCronJobAsTask } from "../../src/internal/cron/fire-handler.js";
import { isAgentRun } from "../../src/internal/cron/run-job.js";
import * as scheduler from "../../src/internal/cron/scheduler.js";
import { __resetTaskRegistryForTests } from "../../src/internal/task/registry.js";
import { Task } from "../../src/task.js";

const FIXTURE_KEY = "theo_test_cron_task";

describe("Cron fire → Task (T3.5)", () => {
  beforeEach(() => __resetTaskRegistryForTests());
  afterEach(async () => {
    __resetTaskRegistryForTests();
    await Cron.stop().catch(() => {});
  });

  it("manual Cron.run produces a Run; Task wrapping is wired but driven by scheduler fires only", async () => {
    // Cron.run is a direct invocation path (not via setCronFireHandler).
    // It returns a Run object directly, NOT through the task-wrapped
    // default fire handler. This test documents that distinction:
    // `theokit tasks list` only shows TIMER-driven fires after
    // `Cron.start()`, not manual `Cron.run` invocations.
    const job = await Cron.create({
      cron: "*/1 * * * *",
      message: "tick",
      agent: {
        apiKey: FIXTURE_KEY,
        model: { id: "openai/gpt-4o-mini" },
        local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
      },
    });
    expect(job.id).toBeDefined();
    const run = await Cron.run(job.id);
    expect(run.id).toBeDefined();
    if (isAgentRun(run)) await run.wait(); // agent target → deferred Run

    // Manual Cron.run does NOT go through the fire handler — no task expected.
    expect((await Task.list({ kind: "cron" })).length).toBe(0);
    await Cron.delete(job.id);
  });

  // Note: A "real timer-driven fire" test would need to start the
  // scheduler and wait for an actual cron expression to fire — the
  // shortest valid cron is `* * * * *` (every minute), which is too
  // slow for unit tests. The default fire handler that wraps as Task
  // is exercised end-to-end in the telegram-pro dogfood (Phase 7).
});

describe("Cron task — fire handler reentry-friendly", () => {
  beforeEach(() => __resetTaskRegistryForTests());
  afterEach(async () => {
    __resetTaskRegistryForTests();
    await Cron.stop().catch(() => {});
  });

  it("calling Cron.start installs the task-wrapping default fire handler without error", async () => {
    // B-062. The body used to be `expect(true).toBe(true)`, so the test named an INSTALL and only
    // proved that `start` did not throw — a `Cron.start` that quietly stopped calling
    // `setCronFireHandler` would have passed. `cron.ts:146` installs `fireCronJobAsTask`
    // unconditionally; spying on the installer is what pins the wiring the name claims, and it
    // needs nothing added to `src/` to observe it.
    const install = vi.spyOn(scheduler, "setCronFireHandler");

    try {
      await Cron.start({});
      expect(
        install,
        "Cron.start must install the task-wrapping default fire handler",
      ).toHaveBeenCalledWith(fireCronJobAsTask);
    } finally {
      install.mockRestore();
      await Cron.stop();
    }
  });
});
