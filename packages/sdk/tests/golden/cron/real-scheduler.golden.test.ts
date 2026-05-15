import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Cron } from "../../../src/cron.js";
import { type CronFireHandler, setCronFireHandler } from "../../../src/internal/cron/scheduler.js";
import { clearJobs } from "../../../src/internal/cron/store.js";

/**
 * Behaviour gate for the real cron scheduler. Verifies wiring without
 * blocking on real clock progress:
 *   - `Cron.start()` installs a Croner timer per enabled local job and
 *     computes a `nextRunAt` in the future.
 *   - `Cron.disable()` removes the timer; `Cron.enable()` puts it back.
 *   - `Cron.stop()` tears every timer down.
 *   - `Cron.delete()` removes the timer too.
 */

describe("real cron scheduler", () => {
  beforeEach(() => {
    clearJobs();
  });
  afterEach(async () => {
    setCronFireHandler(undefined);
    await Cron.stop();
    clearJobs();
  });

  it("computes a real next-run time once the scheduler is running", async () => {
    await Cron.start();
    const job = await Cron.create({
      apiKey: "theo_test_cron",
      cron: "*/5 * * * *",
      timezone: "UTC",
      message: "tick",
      agent: { local: { cwd: process.cwd() } },
    });
    const refreshed = await Cron.get(job.id);
    expect(refreshed.nextRunAt).toBeDefined();
    expect(refreshed.nextRunAt).toBeGreaterThan(Date.now());
    expect(refreshed.nextRunAt).toBeLessThan(Date.now() + 6 * 60 * 1000);
  });

  it("disable suspends the timer; enable resumes it", async () => {
    const handler: CronFireHandler = () => undefined;
    setCronFireHandler(handler);
    await Cron.start();
    const job = await Cron.create({
      apiKey: "theo_test_cron",
      cron: "*/5 * * * *",
      message: "tick",
      agent: { local: { cwd: process.cwd() } },
    });
    const disabled = await Cron.disable(job.id);
    expect(disabled.status).toBe("paused");
    const enabled = await Cron.enable(job.id);
    expect(enabled.status).toBe("scheduled");
    expect(enabled.nextRunAt).toBeGreaterThan(Date.now());
  });

  it("delete removes the timer and the job", async () => {
    await Cron.start();
    const job = await Cron.create({
      apiKey: "theo_test_cron",
      cron: "*/5 * * * *",
      message: "tick",
      agent: { local: { cwd: process.cwd() } },
    });
    await Cron.delete(job.id);
    await expect(Cron.get(job.id)).rejects.toThrow();
  });
});
