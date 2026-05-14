import { afterEach, describe, expect, it } from "vitest";

import { Cron } from "../../src/index.js";
import cloudJobGolden from "../golden/cron/cloud-job.json";
import localJobGolden from "../golden/cron/local-job.json";
import { normalizeForGolden } from "../helpers/normalize.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

describe("Cron contract", () => {
  let workspace: TempWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
    await Cron.stop().catch(() => undefined);
  });

  it("creates a local cron job with default UTC timezone and requires Cron.start to fire", async () => {
    workspace = await createTempWorkspace("simple-node-project");

    const job = await Cron.create({
      cron: "@hourly",
      message: "Run local scheduled task",
      agentId: "agent-00000000-0000-4000-8000-000000000001",
      apiKey: "theo_test_contract_key",
    });
    const beforeStart = await Cron.status({ cwd: workspace.cwd });

    expect(normalizeForGolden(job)).toEqual(localJobGolden);
    expect(beforeStart).toMatchObject({ running: false, jobCount: expect.any(Number) });

    await Cron.start({ cwd: workspace.cwd, apiKey: "theo_test_contract_key" });
    await expect(Cron.status({ cwd: workspace.cwd })).resolves.toMatchObject({
      running: true,
      jobCount: expect.any(Number),
    });
  });

  it("creates a cloud cron job with valid POSIX cron and IANA timezone", async () => {
    const job = await Cron.create({
      cron: "0 9 * * *",
      timezone: "America/Sao_Paulo",
      message: "Run cloud scheduled task",
      agentId: "bc-00000000-0000-4000-8000-000000000001",
      apiKey: "theo_test_contract_key",
    });

    expect(normalizeForGolden(job)).toEqual(cloudJobGolden);
  });

  it("validates invalid cron, invalid timezone, and mutually exclusive agent inputs", async () => {
    await expectCronConfigurationError(
      Cron.create({
        cron: "not a cron",
        message: "bad",
        agentId: "agent-00000000-0000-4000-8000-000000000001",
      }),
      /invalid cron|cron expression/i,
    );

    await expectCronConfigurationError(
      Cron.create({
        cron: "@daily",
        timezone: "Mars/Olympus",
        message: "bad",
        agentId: "agent-00000000-0000-4000-8000-000000000001",
      }),
      /timezone|IANA/i,
    );

    await expectCronConfigurationError(
      Cron.create({
        cron: "@daily",
        message: "bad",
        agentId: "agent-00000000-0000-4000-8000-000000000001",
        agent: { apiKey: "theo_test_contract_key", model: { id: "composer-2" }, local: {} },
      }),
      /mutually exclusive|either agent or agentId/i,
    );
  });

  it("disable, enable, delete, and manual run expose stable job/run contracts", async () => {
    const job = await Cron.create({
      cron: "@daily",
      message: "Run manually",
      agentId: "agent-00000000-0000-4000-8000-000000000001",
      apiKey: "theo_test_contract_key",
    });

    await expect(Cron.disable(job.id)).resolves.toMatchObject({ id: job.id, enabled: false, status: "paused" });
    await expect(Cron.enable(job.id)).resolves.toMatchObject({ id: job.id, enabled: true, status: "scheduled" });
    await expect(Cron.run(job.id)).resolves.toMatchObject({
      id: expect.stringMatching(/^run-/),
      agentId: expect.stringMatching(/^agent-/),
      status: "running",
    });
    await expect(Cron.delete(job.id)).resolves.toBeUndefined();
    await expect(Cron.get(job.id)).rejects.toMatchObject({ name: "UnknownAgentError" });
  });
});

async function expectCronConfigurationError(promise: Promise<unknown>, message: RegExp): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: "ConfigurationError",
    message: expect.stringMatching(message),
  });
  await expect(promise).rejects.not.toMatchObject({
    message: expect.stringMatching(/not implemented/i),
  });
}
