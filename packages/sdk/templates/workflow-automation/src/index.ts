/**
 * TheoKit Workflow Automation — scheduled multi-step pipeline.
 *
 * Demonstrates EventedWorkflowExecutor with a cron schedule and
 * a 3-step pipeline: fetch data, process with an agent, and
 * output the result.
 */

import { Agent, Cron } from "@theokit/sdk";

const API_KEY = process.env.THEOKIT_API_KEY ?? "local";
const MODEL = process.env.AGENT_MODEL ?? "anthropic/claude-3-5-sonnet-latest";

// 1. Define a processing agent for the middle step.
const processor = await Agent.create({
  agentId: "workflow-processor",
  apiKey: API_KEY,
  model: { id: MODEL },
  systemPrompt:
    "You are a data processing assistant. Given raw data, extract key " +
    "insights and format them as a brief report with bullet points.",
  local: { cwd: process.cwd() },
});

// 2. Define the workflow steps.
async function fetchData(): Promise<string> {
  // In production, this would call an API or read a database.
  const timestamp = new Date().toISOString();
  return `[${timestamp}] Sample metrics: CPU 45%, Memory 72%, Requests 1.2k/s, Errors 0.3%`;
}

async function processWithAgent(data: string): Promise<string> {
  const run = await processor.send(
    `Analyze this system health snapshot and provide a brief status report:\n${data}`,
  );
  let report = "";
  for await (const event of run.stream()) {
    if (event.type === "assistant") {
      for (const part of event.message.content) {
        if (part.type === "text") report += part.text;
      }
    }
  }
  await run.wait();
  return report;
}

function outputReport(report: string): void {
  console.log("--- Workflow Report ---");
  console.log(report);
  console.log("--- End Report ---\n");
}

// 3. Create a cron job that runs the workflow every 5 minutes.
const job = await Cron.create({
  agentId: "workflow-processor",
  apiKey: API_KEY,
  schedule: "*/5 * * * *",
  model: { id: MODEL },
  local: { cwd: process.cwd() },
});

console.log(`Cron job created: ${job.id} (schedule: ${job.schedule})`);

// 4. Run the workflow once immediately as a demo.
console.log("Running workflow now...\n");
const data = await fetchData();
const report = await processWithAgent(data);
outputReport(report);

// 5. Start the cron scheduler for ongoing execution.
await Cron.start({ apiKey: API_KEY });
console.log("Cron scheduler started. Press Ctrl+C to stop.");

process.on("SIGINT", async () => {
  await Cron.stop();
  processor.dispose();
  process.exit(0);
});
