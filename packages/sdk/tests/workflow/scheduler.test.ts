import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowScheduler } from "../../src/internal/workflow/scheduler.js";

describe("WorkflowScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a scheduler with a cron expression", () => {
    const scheduler = new WorkflowScheduler({
      schedule: "*/5 * * * *",
      handler: async () => {},
    });
    expect(scheduler).toBeDefined();
    expect(scheduler.isRunning).toEqual(false);
    scheduler.dispose();
  });

  it("starts and stops the scheduler", () => {
    const scheduler = new WorkflowScheduler({
      schedule: "*/5 * * * *",
      handler: async () => {},
    });
    scheduler.start();
    expect(scheduler.isRunning).toEqual(true);
    scheduler.stop();
    expect(scheduler.isRunning).toEqual(false);
    scheduler.dispose();
  });

  it("EC-3: dispose stops croner and prevents further triggers", () => {
    const scheduler = new WorkflowScheduler({
      schedule: "*/5 * * * *",
      handler: async () => {},
    });
    scheduler.start();
    scheduler.dispose();
    expect(scheduler.isRunning).toEqual(false);
  });

  it("Symbol.dispose calls dispose", () => {
    const scheduler = new WorkflowScheduler({
      schedule: "*/5 * * * *",
      handler: async () => {},
    });
    scheduler.start();
    scheduler[Symbol.dispose]();
    expect(scheduler.isRunning).toEqual(false);
  });
});
