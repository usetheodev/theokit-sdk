/**
 * Example: triage agent transfers to billing OR support based on intent.
 *
 *   ollama serve & ollama pull llama3.2:3b
 *   pnpm install
 *   pnpm run run
 *
 * Or with cloud:
 *   export OPENROUTER_API_KEY=sk-or-...
 *   pnpm run run
 */

import {
  Agent,
  Handoff,
  RECOMMENDED_HANDOFF_PROMPT_PREFIX,
} from "@usetheo/sdk";

const useCloud = typeof process.env.OPENROUTER_API_KEY === "string";

const baseAgentConfig = useCloud
  ? {
      apiKey: process.env.OPENROUTER_API_KEY ?? "",
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd: process.cwd(), sandboxOptions: { enabled: false } as const },
      providers: {
        routes: [{ capability: "chat" as const, provider: "openrouter" }],
        fallback: ["openrouter"],
      },
    }
  : {
      apiKey: "ollama-local",
      model: { id: "ollama/llama3.2:3b" },
      local: { cwd: process.cwd(), sandboxOptions: { enabled: false } as const },
    };

// Specialists
const billing = await Agent.create({
  ...baseAgentConfig,
  name: "billing",
  systemPrompt:
    "You are a billing specialist. Answer questions about invoices, charges, and payments concisely.",
});

const support = await Agent.create({
  ...baseAgentConfig,
  name: "support",
  systemPrompt:
    "You are a technical support specialist. Answer questions about installation, configuration, and troubleshooting.",
});

// Triage routes to the right specialist
const triage = await Agent.create({
  ...baseAgentConfig,
  name: "triage",
  systemPrompt: `${RECOMMENDED_HANDOFF_PROMPT_PREFIX}

You are a triage agent. Listen to the user's question and IMMEDIATELY transfer
the conversation to the right specialist:
  - billing questions → transfer_to_billing
  - technical/install questions → transfer_to_support

Do NOT answer the user directly. Use exactly ONE transfer_to_* tool per turn.`,
  handoffs: [billing, Handoff.create(support, { toolDescription: "Transfer to support for install/config issues" })],
});

console.log(`Triage agent ready (mode: ${useCloud ? "cloud" : "ollama"}).`);

const questions = [
  "I have a question about my bill.",
  "How do I install the SDK?",
];

for (const q of questions) {
  console.log(`\n=== User: ${q}`);
  const run = await triage.send(q);
  const result = await run.wait();
  console.log(`=== Triage status: ${result.status}`);
  console.log(`=== Response:`);
  console.log(result.result ?? `(${result.status}${result.error ? `: ${result.error.message}` : ""})`);
}

await triage.dispose();
await billing.dispose();
await support.dispose();
console.log("\nDone.");
