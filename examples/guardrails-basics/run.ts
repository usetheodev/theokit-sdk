/**
 * Guardrails — block a message before it reaches the model.
 *
 * An `inputProcessor` runs before the LLM. Calling `ctx.abort(reason)` stops the run with a
 * tripwire (`status: "cancelled"`, `result.tripwire` carries the reason + processor id) — no
 * provider call is made. `outputProcessors` do the same for the model's reply. Deterministic.
 */
import assert from "node:assert/strict";
import { Agent } from "@theokit/sdk";

const agent = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "meta-llama/llama-3.3-70b-instruct:free" },
  inputProcessors: [
    {
      id: "no-secrets",
      processInput: (ctx) => {
        if (/password/i.test(ctx.message)) ctx.abort("blocked: message mentions a password");
      },
    },
  ],
});

const result = await (await agent.send("What is my password?")).wait();

console.log("status:", result.status);
console.log("tripwire:", JSON.stringify(result.tripwire));

await agent.dispose();

// --- validate output (assert) ---
assert.equal(result.status, "cancelled");
assert.ok(result.tripwire);
