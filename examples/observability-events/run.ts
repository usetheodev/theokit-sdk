/**
 * Observability — a typed runtime-event sink (onRunEvent) receives out-of-band RunEvents as a run
 * progresses. Deterministic: an input processor aborts the message before the LLM, emitting a
 * `tripwire` event — no LLM call needed.
 */
import { Agent } from "@theokit/sdk";

const seen: string[] = [];

const agent = await Agent.create({
  apiKey: "theo_test_observability",
  model: { id: "openai/gpt-4o-mini" },
  inputProcessors: [
    {
      id: "no-secrets",
      processInput: (ctx) => {
        if (/password/i.test(ctx.message)) ctx.abort("blocked: message mentions a password");
      },
    },
  ],
});

const result = await (
  await agent.send("What is my password?", { onRunEvent: (ev) => seen.push(ev.type) })
).wait();

console.log("status:      ", result.status);
console.log("run events:  ", seen.join(", ") || "(none)");
console.log("tripwire:    ", JSON.stringify(result.tripwire));

await agent.dispose?.();
