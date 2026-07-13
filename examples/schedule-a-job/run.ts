/**
 * Schedules — define a recurring agent run with Cron.create. Deterministic: the job is created
 * disabled, so the scheduler never fires it (no LLM). We inspect its shape, then delete it.
 */
import { Cron } from "@theokit/sdk";

const job = await Cron.create({
  name: "daily-digest",
  cron: "0 9 * * *",                      // 09:00 every day (POSIX 5-field)
  timezone: "UTC",
  message: "Summarize yesterday's commits.",
  agent: { apiKey: "theo_test_cron", model: { id: "openai/gpt-4o-mini" } }, // ephemeral target
  enabled: false,                         // created disabled — the scheduler won't fire it
});

console.log("id:      ", job.id.startsWith("cron_") || job.id.length > 0 ? "(assigned)" : job.id);
console.log("cron:    ", job.cron);
console.log("runtime: ", job.runtime);
console.log("enabled: ", job.enabled);
console.log("status:  ", job.status);

await Cron.delete(job.id);
console.log("deleted: ", true);
