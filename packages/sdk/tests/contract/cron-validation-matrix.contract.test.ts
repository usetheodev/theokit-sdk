import { afterEach, describe, expect, it } from "vitest";

import { Cron } from "../../src/index.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

const validShorthands = ["@hourly", "@daily", "@weekly", "@monthly", "@yearly"] as const;

describe("Cron validation matrix contract", () => {
  let workspace: TempWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
    await Cron.stop().catch(() => undefined);
  });

  it.each(validShorthands)("accepts shorthand %s and defaults timezone to UTC", async (cron) => {
    workspace = await createTempWorkspace("simple-node-project");

    const job = await Cron.create({
      cron,
      message: `Run ${cron}`,
      agent: {
        apiKey: "theo_test_contract_key",
        model: { id: "composer-2" },
        local: { cwd: workspace.cwd },
      },
    });

    expect(job).toMatchObject({
      id: expect.stringMatching(/^cron-/),
      cron,
      timezone: "UTC",
      runtime: "local",
      enabled: true,
      status: "scheduled",
    });
    expect(job.agent).toBeDefined();
    expect(job.agentId).toBeUndefined();
  });

  it.each(["*/15 * * * *", "0 0 1 1 *", "30 9 * * 1"])(
    "accepts valid POSIX cron expression %s",
    async (cron) => {
      const job = await Cron.create({
        cron,
        timezone: "UTC",
        message: `Run ${cron}`,
        agentId: "agent-00000000-0000-4000-8000-000000000001",
        apiKey: "theo_test_contract_key",
      });

      expect(job).toMatchObject({
        cron,
        timezone: "UTC",
        runtime: "local",
      });
    },
  );

  it.each(["", "* * *", "60 * * * *", "0 24 * * *", "@sometimes"])(
    "rejects invalid cron expression %s",
    async (cron) => {
      await expectInvalidCron(
        Cron.create({
          cron,
          message: "bad cron",
          agentId: "agent-00000000-0000-4000-8000-000000000001",
        }),
      );
    },
  );

  it("manual Cron.run does not update lastRunAt", async () => {
    const job = await Cron.create({
      cron: "@daily",
      message: "manual run",
      agentId: "agent-00000000-0000-4000-8000-000000000001",
      apiKey: "theo_test_contract_key",
    });
    const before = await Cron.get(job.id);

    const run = await Cron.run(job.id);
    const after = await Cron.get(job.id);

    expect(run).toMatchObject({
      id: expect.stringMatching(/^run-/),
      status: "running",
    });
    expect(after.lastRunAt).toBe(before.lastRunAt);
  });
});

async function expectInvalidCron(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: "ConfigurationError",
    message: expect.stringMatching(/invalid cron|cron expression/i),
  });
  await expect(promise).rejects.not.toMatchObject({
    message: expect.stringMatching(/not implemented/i),
  });
}
