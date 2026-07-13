/**
 * Advanced tool — outputSchema (validate the return) + toModelOutput (compact model-facing view).
 *
 * The handler returns the FULL structured object (your app uses it); `toModelOutput` shapes only
 * what the MODEL sees in the tool_result. Real LLM (OpenRouter).
 */
import { Agent, Tool } from "@theokit/sdk";
import { z } from "zod";

const lookupOrder = Tool.create({
  name: "lookup_order",
  description: "Look up an order's full record by id.",
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ id: z.string(), status: z.string(), total: z.number(), items: z.array(z.string()) }),
  handler: ({ id }) => ({ id, status: "shipped", total: 129.9, items: ["cable", "adapter", "case"] }),
  // the model only needs the headline — not the whole object
  toModelOutput: (o) => `Order ${o.id}: ${o.status}, $${o.total} (${o.items.length} items).`,
});

const agent = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-4o-mini" },
  systemPrompt: "Use lookup_order when asked about an order. Answer in one sentence.",
  tools: [lookupOrder],
});

const result = await (await agent.send("What's the status of order A-42?")).wait();
console.log("Status:", result.status);
console.log("Reply: ", result.result);

await agent.dispose();

// --- validate output (fail loud) ---
if (result.status !== "finished" || typeof result.result !== "string" || result.result.length === 0) {
  console.error("run did not finish:", JSON.stringify(result.error ?? result.status));
  process.exit(1);
}
