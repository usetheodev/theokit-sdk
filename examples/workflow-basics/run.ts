/**
 * Workflow basics — declarative multi-step orchestration.
 *
 * `Workflow.create()` builds a pipeline of steps. A `fn` step is a plain (typed) function;
 * an `agentStep` renders a prompt and calls an agent. `.commit()` freezes the workflow, then
 * `.run(input)` executes it and returns the terminal `WorkflowRun` (status + output).
 *
 * NOTE the imports: `Agent` is on the main entrypoint; `Workflow` / `fn` / `agentStep` live on
 * the `@theokit/sdk/workflow` sub-path.
 */
import { Agent } from "@theokit/sdk";
import { Workflow, agentStep, fn } from "@theokit/sdk/workflow";

const writer = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-4o-mini" },
  systemPrompt: "You write exactly one concise, factual sentence. No preamble.",
});

const factPipeline = Workflow.create({ name: "topic-fact" })
  // Step 1 — a pure function normalizes the input to a clean topic string (no LLM).
  .then(fn("normalize", (input: { topic: string }) => input.topic.trim().toLowerCase()))
  // Step 2 — an agent step turns the normalized topic into a one-sentence fact. Workflow state
  // flows untyped between steps, so the renderer receives `unknown` — coerce it with String().
  .then(agentStep("write", writer, (topic) => `Write a one-sentence fact about ${String(topic)}.`))
  .commit();

const run = await factPipeline.run({ topic: "  The Moon  " });

console.log("Status:", run.status);
console.log("Output:", run.output);

await writer.dispose();

// --- validate output (fail loud) ---
if (run.status !== "completed" || run.output == null) {
  console.error("workflow did not complete:", JSON.stringify(run.error ?? run.status));
  process.exit(1);
}
