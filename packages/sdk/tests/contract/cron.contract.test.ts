import { afterEach, describe, expect, it } from "vitest";

import { Agent, Cron } from "../../src/index.js";
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

  // B-044. These three were one `it` named "validates invalid cron, invalid timezone, and
  // mutually exclusive agent inputs". Each clause is an awaited rejection assertion, so the
  // first regression short-circuited the other two: a broken timezone validator was invisible
  // while the cron validator was also broken, and one reported failure stood for three
  // independent rules. rules/testing.md § 4.1 treats them as three negative cases — each has to
  // be able to go red on its own, naming the rule that broke.
  it("rejects a cron expression that is not a valid POSIX/@shorthand schedule", async () => {
    await expectCronConfigurationError(
      Cron.create({
        cron: "not a cron",
        message: "bad",
        agentId: "agent-00000000-0000-4000-8000-000000000001",
      }),
      /invalid cron|cron expression/i,
    );
  });

  it("rejects a timezone that is not a known IANA zone", async () => {
    await expectCronConfigurationError(
      Cron.create({
        cron: "@daily",
        timezone: "Mars/Olympus",
        message: "bad",
        agentId: "agent-00000000-0000-4000-8000-000000000001",
      }),
      /timezone|IANA/i,
    );
  });

  it("rejects agent and agentId supplied together — the targets are mutually exclusive", async () => {
    await expectCronConfigurationError(
      Cron.create({
        cron: "@daily",
        message: "bad",
        agentId: "agent-00000000-0000-4000-8000-000000000001",
        agent: {
          apiKey: "theo_test_contract_key",
          model: { id: "google/gemini-2.0-flash-001" },
          local: {},
        },
      }),
      /mutually exclusive|either agent or agentId/i,
    );
  });

  // The agent is REGISTERED here, and that is the whole correction. This case used to schedule
  // against a fabricated `agent-0000…0001` that no agent ever had, then assert that running it
  // resolved — which contradicts a deliberate guard in `runWithExistingAgent`: an `agentId` target
  // means "run THAT agent", and an id nobody registered has no agent to run. The guard's message
  // says so specifically, and it is the defensible half of the disagreement.
  //
  // So the manual-run contract was never actually exercised: the case asserted that running a
  // phantom worked, and failed for the right reason. It now creates a real agent and runs it.
  //
  // Worth recording separately: `Cron.create` accepts an `agentId` it never validates — it only
  // reads the prefix to route local vs cloud — so an id that can never run is accepted at
  // scheduling time and surfaces when the job fires. That asymmetry is a real finding and NOT
  // fixed here; validating at create would be a behaviour change for anyone scheduling against an
  // agent they register later.
  it("disable, enable, delete, and manual run expose stable job/run contracts", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const agent = await Agent.create({
      model: { id: "anthropic/claude-sonnet-4-6" },
      apiKey: "theo_test_contract_key",
      local: { cwd: workspace.cwd },
    });

    const job = await Cron.create({
      cron: "@daily",
      message: "Run manually",
      agentId: agent.agentId,
      apiKey: "theo_test_contract_key",
    });

    await expect(Cron.disable(job.id)).resolves.toMatchObject({
      id: job.id,
      enabled: false,
      status: "paused",
    });
    await expect(Cron.enable(job.id)).resolves.toMatchObject({
      id: job.id,
      enabled: true,
      status: "scheduled",
    });
    await expect(Cron.run(job.id)).resolves.toMatchObject({
      id: expect.stringMatching(/^run-/),
      agentId: expect.stringMatching(/^agent-/),
      status: "running",
    });
    await expect(Cron.delete(job.id)).resolves.toBeUndefined();
    await expect(Cron.get(job.id)).rejects.toMatchObject({ name: "UnknownAgentError" });
  });
});

async function expectCronConfigurationError(
  promise: Promise<unknown>,
  message: RegExp,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: "ConfigurationError",
    message: expect.stringMatching(message),
  });
  await expect(promise).rejects.not.toMatchObject({
    message: expect.stringMatching(/not implemented/i),
  });
}
