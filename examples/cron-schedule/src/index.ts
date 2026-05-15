import { Cron } from "@usetheo/sdk";

/**
 * Cron-schedule example. Shows the public `Cron` namespace driving the
 * real scheduler (croner under the hood). No LLM provider keys are
 * required — cron is a pure SDK feature.
 *
 * The example creates a job that would fire every 5 minutes, then:
 *  1. Lists jobs and prints the computed `nextRunAt`.
 *  2. Triggers a manual off-schedule fire via `Cron.run(jobId)`.
 *  3. Disables the job (timer suspended, job kept).
 *  4. Re-enables it and confirms `nextRunAt` recomputes.
 *  5. Stops the scheduler and deletes the job for cleanup.
 */

async function main(): Promise<void> {
  await Cron.start();
  console.log("Scheduler started.");

  const job = await Cron.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "user-real-example-key",
    name: "demo-job",
    cron: "*/5 * * * *",
    timezone: "UTC",
    message: "Hello from a scheduled run",
    agent: { local: { cwd: process.cwd() } },
  });
  console.log(
    `Job ${job.id} scheduled — next run at ${new Date(job.nextRunAt ?? 0).toISOString()}`,
  );

  const list = await Cron.list();
  console.log(`Active jobs: ${list.items.map((j) => j.id).join(", ")}`);

  console.log("Triggering a manual fire (off-schedule)…");
  const run = await Cron.run(job.id);
  console.log(`Manual fire dispatched as run ${run.id}.`);

  console.log("Disabling the job…");
  const disabled = await Cron.disable(job.id);
  console.log(`Status: ${disabled.status}`);

  console.log("Re-enabling…");
  const enabled = await Cron.enable(job.id);
  console.log(`Status: ${enabled.status}, nextRunAt: ${new Date(enabled.nextRunAt ?? 0).toISOString()}`);

  console.log("Stopping scheduler and deleting job…");
  await Cron.stop();
  await Cron.delete(job.id);
  console.log("Done.");
}

main().catch((cause) => {
  console.error("Cron example failed:", cause);
  process.exit(1);
});
