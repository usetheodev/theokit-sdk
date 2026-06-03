/**
 * Workflow demo (Adoption Roadmap #5; ADRs D230-D248).
 *
 * Demonstrates a 4-step refund triage pipeline:
 *   validate → classify (LLM) → branch (billing vs support) → summarize
 *
 * Run:
 *   pnpm install
 *   pnpm run run
 *
 * Requires `OPENROUTER_API_KEY` OR a local Ollama daemon listening on
 * `OLLAMA_HOST` (default http://localhost:11434).
 */

import { Agent, Workflow, agentStep, fn } from "@theokit/sdk";

const OPENROUTER = process.env.OPENROUTER_API_KEY;
const useOllama = OPENROUTER === undefined || OPENROUTER.length === 0;

const baseConfig = useOllama
  ? {
      model: { id: "ollama/llama3.2:3b" },
      local: { cwd: process.cwd(), sandboxOptions: { enabled: false } as const },
    }
  : {
      apiKey: OPENROUTER!,
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd: process.cwd(), sandboxOptions: { enabled: false } as const },
    };

async function main(): Promise<void> {
  const classifier = await Agent.create({
    ...baseConfig,
    name: "classifier",
    systemPrompt:
      "You classify customer support requests. Reply with EXACTLY one word: BILLING, SUPPORT, or OTHER.",
  });
  const billingExpert = await Agent.create({
    ...baseConfig,
    name: "billing",
    systemPrompt:
      "You are a billing specialist. Answer concisely (1-2 sentences) about invoices, refunds, charges.",
  });
  const supportExpert = await Agent.create({
    ...baseConfig,
    name: "support",
    systemPrompt:
      "You are a technical support specialist. Answer concisely (1-2 sentences) about install, config, troubleshooting.",
  });

  const wf = Workflow.create<{ claim: string }, string>({ name: "refund-pipeline" })
    .then(
      fn<{ claim: string }, { claim: string; ts: number }>("validate", (input) => {
        if (!input.claim || input.claim.length < 3) {
          throw new Error("claim must be at least 3 characters");
        }
        return { ...input, ts: Date.now() };
      }),
    )
    .then(
      agentStep(
        "classify",
        classifier,
        (input) => `Classify: "${(input as { claim: string }).claim}"`,
      ),
    )
    .branch(
      [
        [(out) => String(out).toUpperCase().includes("BILLING"), [
          agentStep("billing_resolve", billingExpert, "Handle the billing question."),
        ]],
        [(out) => String(out).toUpperCase().includes("SUPPORT"), [
          agentStep("support_resolve", supportExpert, "Handle the support question."),
        ]],
      ],
      {
        id: "decide",
        fallback: [
          fn("escalate", () => "Escalating to a human agent."),
        ],
      },
    )
    .commit();

  console.log("Running workflow…");
  const run = await wf.run({ claim: "I was charged twice last month for the Pro plan." });
  console.log("");
  console.log("Status:", run.status);
  console.log("Duration:", run.durationMs, "ms");
  console.log("Steps:");
  for (const sr of run.stepResults) {
    console.log(`  - [${sr.kind}] ${sr.stepId} (${sr.status}, ${sr.attempts} attempt, ${sr.durationMs}ms)`);
  }
  console.log("");
  console.log("Final output:", run.output);

  await classifier.dispose();
  await billingExpert.dispose();
  await supportExpert.dispose();
}

main().catch((err) => {
  console.error("workflow demo failed:", err);
  process.exit(1);
});
