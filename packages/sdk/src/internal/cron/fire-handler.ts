/**
 * Default cron fire handler (extracted from `Cron.start` for testability + G8).
 *
 * Every fire registers as a Task (ADRs D363/D374) so callers observe it via
 * `Task.list` / `Task.subscribe`. SE35 (ADR 0014): the fire target may be an
 * agent (a deferred {@link Run} — abort-wire + `wait()`) OR a workflow (an
 * already-terminal {@link WorkflowRun} — no `wait()`); `isAgentRun` discriminates
 * so the handler records the correct terminal status/runId for each shape.
 *
 * @internal
 */

import type { CronJob } from "../../types/cron.js";
import { submit as taskRegistrySubmit } from "../task/registry.js";
import { isAgentRun, runCronJob } from "./run-job.js";

export async function fireCronJobAsTask(job: CronJob): Promise<void> {
  // The task id namespace `cron-{jobId}-{fireEpochMs}` honors D368/EC-5.
  const fireTs = Date.now();
  const taskId = `cron-${job.id}-${fireTs}`;
  try {
    await taskRegistrySubmit({
      kind: "cron",
      id: taskId,
      allowReservedPrefix: true,
      meta: { jobId: job.id, jobName: job.name, schedule: job.cron, firedAt: fireTs },
      work: async (ctx) => {
        const outcome = await runCronJob(job);
        if (isAgentRun(outcome)) {
          // Agent target — the Run is deferred: abort-wire + await terminal.
          ctx.signal.addEventListener("abort", () => void outcome.cancel().catch(() => {}), {
            once: true,
          });
          const result = await outcome.wait();
          ctx.emit({ status: result.status, runId: outcome.id });
          return { status: result.status, runId: outcome.id };
        }
        // SE35 workflow target — the WorkflowRun is ALREADY terminal (no wait()).
        ctx.emit({ status: outcome.status, runId: outcome.id });
        return { status: outcome.status, runId: outcome.id };
      },
    });
  } catch {
    // Task registry must not break cron — fall through to a direct run. No
    // double-execution: `taskRegistrySubmit` runs `work` (which calls
    // `runCronJob`) fire-and-forget, so a throw here means the SUBMIT itself
    // failed (id/registry setup) BEFORE `work` started — the job never ran, and
    // this is its first + only execution.
    const outcome = await runCronJob(job);
    if (isAgentRun(outcome)) await outcome.wait();
  }
}
