/**
 * B-013 — the three fire-time typed errors of `runCronJob` had no test.
 *
 * Measured before writing these: deleting the `cron_no_target` throw and running the whole
 * `tests/internal/` + `tests/integration/` tree produced **1546 passed, 0 failed**. Nothing entered
 * the path, exactly as the item said.
 *
 * These are fail-fast guards, which is why they are cheap to test: each throws BEFORE the expensive
 * thing (spawning an agent, running a workflow, touching the network) happens. The item's title
 * names the subsystem — "cron fire-time" — which is what made this sound like it needed a scheduler.
 * It needs a plain object.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

// `agent.ts` registers the facade at module-init (`agent.ts:646 setAgentFacade`), and the internal
// subsystems refuse to run without it — the error message says so explicitly. Importing it for the
// side effect is what the runtime does; doing it here keeps the test honest about the real order.
import "../../../src/agent.js";

import { ConfigurationError, UnknownAgentError } from "../../../src/errors.js";
import { runCronJob } from "../../../src/internal/cron/run-job.js";
import {
  getAgentFacade,
  setAgentFacade,
} from "../../../src/internal/runtime/registry/agent-factory-registry.js";
import type { CronJob } from "../../../src/types/cron.js";

/** The minimum a `CronJob` needs to reach the guards; targets are added per test. */
function job(extra: Partial<CronJob> = {}): CronJob {
  return { id: "job-1", cron: "*/5 * * * *", ...extra } as CronJob;
}

describe("runCronJob — fail-fast guards", () => {
  it("test_a_job_with_no_target_is_refused_before_anything_runs", async () => {
    // A job with no agent, agentId or workflow cannot fire. The guard exists so the failure is a
    // typed configuration error at fire time rather than an undefined dereference deeper in.
    await expect(runCronJob(job())).rejects.toBeInstanceOf(ConfigurationError);

    // The `code` is asserted, not only the class: `ConfigurationError` is thrown from 132 sites in
    // `src/` and has three subclasses, so the class alone does not identify this guard. The batch
    // before this one measured that a subclass substitution passes a class-only assertion.
    await expect(runCronJob(job())).rejects.toMatchObject({ code: "cron_no_target" });
  });

  it("test_an_agent_target_without_a_message_is_refused", async () => {
    // `agent` targets carry the message to send on each fire. Reaching the agent without one would
    // spawn it and then fail — this guard refuses first.
    const agentJob = job({ agent: { apiKey: "theo_test_cron" } as CronJob["agent"] });

    await expect(runCronJob(agentJob)).rejects.toBeInstanceOf(ConfigurationError);
    await expect(runCronJob(agentJob)).rejects.toMatchObject({ code: "cron_missing_message" });
  });
});

describe("runCronJob — an agentId that no longer resolves", () => {
  const original = getAgentFacade();
  afterEach(() => setAgentFacade(original));

  it("test_an_unregistered_agentId_is_refused_with_a_typed_error", async () => {
    // The real scenario: the process restarted, or the agent was disposed, and a persisted cron job
    // still names it. `get` rejecting is what the guard reads.
    setAgentFacade({
      ...original,
      get: vi.fn().mockRejectedValue(new Error("no such agent")),
    });

    const staleJob = job({ agentId: "gone-1", message: "tick" });

    await expect(runCronJob(staleJob)).rejects.toBeInstanceOf(UnknownAgentError);
    await expect(runCronJob(staleJob)).rejects.toMatchObject({ code: "agent_not_registered" });
  });
});
