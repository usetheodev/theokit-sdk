/**
 * {{projectName}} — a scheduled, multi-step pipeline.
 *
 * Builds a real `Workflow` (fetch -> analyse -> format), runs it once so you can
 * see the output, then hands the SAME committed workflow to `Cron` to run on a
 * schedule. The workflow is the unit of work; cron only decides when.
 */

import { Agent, agentStep, Cron, fn, Workflow } from "@theokit/sdk";

const API_KEY = process.env.THEOKIT_API_KEY ?? "local";
const MODEL = process.env.AGENT_MODEL ?? "anthropic/claude-3-5-sonnet-latest";
/** Five-field POSIX cron, or a shorthand like `@hourly`. */
const SCHEDULE = process.env.WORKFLOW_CRON ?? "*/5 * * * *";

async function main(): Promise<void> {
  const analyst = await Agent.create({
    agentId: "workflow-analyst",
    apiKey: API_KEY,
    model: { id: MODEL },
    systemPrompt:
      "You read a system health snapshot and reply with three bullet points: " +
      "what is fine, what to watch, and what to act on now. No preamble.",
    local: { cwd: process.cwd() },
  });

  try {
    const pipeline = Workflow.create({ name: "health-report" })
      // Step 1 — plain function. In production this reads an API or a database.
      .then(
        fn("collect", () => {
          const at = new Date().toISOString();
          return `[${at}] CPU 45% · Memory 72% · Requests 1.2k/s · Errors 0.3%`;
        }),
      )
      // Step 2 — an agent step. The SDK runs the agent and feeds it the previous
      // step's output; there is no stream to drain by hand.
      .then(
        agentStep("analyse", analyst, (snapshot) => `Analyse this snapshot:\n${String(snapshot)}`),
      )
      // Step 3 — shape the result. Keeping formatting OUT of the agent step is
      // what lets you change the report without touching the prompt.
      .then(fn("format", (report) => `--- health report ---\n${String(report)}\n---`))
      .commit();

    console.log("Running the pipeline once...\n");
    const run = await pipeline.run({});
    if (run.status === "completed") {
      console.log(String(run.output));
    } else {
      console.error(`pipeline ${run.status}`);
      process.exitCode = 1;
    }

    // Same committed workflow, now on a schedule. The field is `cron` — and a
    // workflow target takes no `message`, because the workflow IS the work.
    const job = await Cron.create({
      name: "health-report",
      cron: SCHEDULE,
      workflow: pipeline,
      apiKey: API_KEY,
    });
    console.log(`\nScheduled ${job.name ?? job.id} at "${job.cron}" (${job.timezone ?? "UTC"}).`);

    await Cron.start({ apiKey: API_KEY });
    console.log("Scheduler running. Ctrl+C to stop.");

    // Wire shutdown ONCE, and await the stop: exiting while the scheduler still
    // holds timers is what leaves a half-run behind.
    process.on("SIGINT", () => {
      void (async () => {
        await Cron.stop();
        await analyst.dispose();
        process.exit(0);
      })();
    });
  } catch (cause) {
    await analyst.dispose();
    throw cause;
  }
}

main().catch((cause) => {
  console.error("workflow failed:", cause instanceof Error ? cause.message : cause);
  process.exit(1);
});
