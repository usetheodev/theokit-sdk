import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Cron } from "../../../src/cron.js";
import { UnknownAgentError } from "../../../src/errors.js";
import { type CronFireHandler, setCronFireHandler } from "../../../src/internal/cron/scheduler.js";
import { clearJobs } from "../../../src/internal/cron/store.js";
import { useTempCwd } from "../../helpers/temp-workspace.js";

// This file passed `cwd: process.cwd()`, which during a test run is the package itself, so
// every agent it created persisted a real session into packages/sdk/.theokit/. The helper
// makes process.cwd() report a throwaway directory for this file only.
useTempCwd();

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
    // B-079 — was bare `.rejects.toThrow()`. `Cron.get` on a missing job throws
    // the typed `UnknownAgentError` (cron.ts:83) with code `unknown_cron_job`.
    await expect(Cron.get(job.id)).rejects.toThrow(UnknownAgentError);
    await expect(Cron.get(job.id)).rejects.toMatchObject({ code: "unknown_cron_job" });
  });
});
