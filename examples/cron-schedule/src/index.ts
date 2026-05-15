import { Cron } from "@usetheo/sdk";

/**
 * Cron-schedule example. Shows the public `Cron` namespace driving the
 * real scheduler (croner under the hood) AND calling a real LLM when
 * the job fires.
 *
 * Flow:
 *  1. `Cron.start()` activates the in-process scheduler and registers
 *     the default fire handler that creates an Agent and dispatches
 *     `job.message` through `agent.send()`.
 *  2. `Cron.create()` registers a job whose `agent.local.cwd` config
 *     becomes an ephemeral local agent every time it fires.
 *  3. `Cron.run(jobId)` triggers an off-schedule fire, returning the
 *     real `Run` handle. We `await run.wait()` to get the LLM answer
 *     and print it.
 *  4. Cleanup: disable, stop, delete.
 */

function pickModel(): string {
  if (process.env.ANTHROPIC_API_KEY) return "claude-sonnet-4-5-20250929";
  if (process.env.OPENAI_API_KEY) return "gpt-4o-mini";
  if (process.env.OPENROUTER_API_KEY) return "openai/gpt-4o-mini";
  throw new Error("Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in .env.");
}

async function main(): Promise<void> {
  await Cron.start();
  console.log("Scheduler started.");

  const job = await Cron.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "user-real-example-key",
    name: "daily-greeting",
    cron: "*/5 * * * *",
    timezone: "UTC",
    message:
      "Greet the user with the current weekday (your best guess) in one short sentence.",
    agent: {
      apiKey: process.env.THEOKIT_API_KEY ?? "user-real-example-key",
      model: { id: pickModel() },
      local: { cwd: process.cwd() },
    },
  });
  console.log(
    `Job ${job.id} scheduled — next run at ${new Date(job.nextRunAt ?? 0).toISOString()}`,
  );

  console.log("\nTriggering a manual fire (off-schedule)…");
  const run = await Cron.run(job.id);
  console.log(`Run id: ${run.id}`);

  // Stream the LLM response so the demo feels live.
  for await (const event of run.stream()) {
    if (event.type === "assistant") {
      const text = event.message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
      if (text.length > 0) console.log(`[assistant] ${text}`);
    }
  }
  const result = await run.wait();
  console.log(`\n[run status=${result.status} duration=${result.durationMs}ms]`);

  console.log("\nDisabling, stopping, deleting…");
  await Cron.disable(job.id);
  await Cron.stop();
  await Cron.delete(job.id);
  console.log("Done.");
}

main().catch((cause) => {
  console.error("Cron example failed:", cause);
  process.exit(1);
});
