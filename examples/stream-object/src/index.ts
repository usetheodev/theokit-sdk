import { Agent, StreamObjectError } from "@usetheo/sdk";
import { z } from "zod";

/**
 * Agent.streamObject example (ADR D39).
 *
 * Demonstrates partial-object streaming via the synthetic forced tool
 * pattern. Same shape as Agent.generateObject, but exposed as an
 * AsyncIterator so consumers can render intermediate partials while the
 * model is still producing output.
 *
 * Run:
 *   cp .env.example .env  # then fill in a provider key
 *   pnpm dev
 *
 * Note: not all providers emit partials. Gemini (via OpenRouter) and
 * Anthropic in some modes batch tool_use output and emit ZERO partials —
 * only the final `complete` event arrives. That's expected behavior.
 * The contract is: at least 1 `complete` event, schema-validated object,
 * zero transient-agent leak.
 */

const FactCard = z.object({
  title: z.string().min(1),
  summary: z.string().min(20),
  year: z.number().int().nullable(),
  sources: z.array(z.string()).min(1).max(3),
});

function pickModel(): string {
  if (process.env.ANTHROPIC_API_KEY !== undefined) return "claude-sonnet-4-5-20250929";
  if (process.env.OPENAI_API_KEY !== undefined) return "gpt-4o-mini";
  if (process.env.OPENROUTER_API_KEY !== undefined) return "google/gemini-2.0-flash-001";
  throw new Error(
    "Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in .env (copy .env.example).",
  );
}

async function main(): Promise<void> {
  const model = pickModel();
  const apiKey =
    process.env.THEOKIT_API_KEY ??
    process.env.OPENROUTER_API_KEY ??
    process.env.ANTHROPIC_API_KEY ??
    process.env.OPENAI_API_KEY;
  if (apiKey === undefined) {
    throw new Error("Could not resolve API key from env.");
  }

  console.log(`Using model: ${model}`);
  console.log("Streaming structured fact card about jazz music...\n");
  const t0 = Date.now();
  let partialCount = 0;
  let complete: { object: z.infer<typeof FactCard>; finishReason: string } | undefined;

  try {
    for await (const evt of Agent.streamObject({
      apiKey,
      model: { id: model },
      local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
      schema: FactCard,
      prompt: "Produce a structured fact card about: jazz music.",
      systemPrompt:
        "Match the schema exactly. Keep summary 2-3 sentences. Set year to null if unknown.",
    })) {
      if (evt.type === "partial") {
        partialCount += 1;
        console.log(`partial #${evt.attempt}:`, JSON.stringify(evt.partial));
      } else {
        complete = evt;
      }
    }
  } catch (err) {
    if (err instanceof StreamObjectError) {
      console.error(`streamObject failed (${err.code}): ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const elapsed = Date.now() - t0;
  if (complete === undefined) {
    console.error("No complete event received — provider may not support forced tool_use.");
    process.exit(1);
  }
  console.log(`\nFinal object (schema-validated):`);
  console.log(JSON.stringify(complete.object, null, 2));
  console.log(`\nStats: ${partialCount} partial(s), ${elapsed}ms, finishReason=${complete.finishReason}`);
  if (partialCount === 0) {
    console.log("(Zero partials emitted — this provider batched the tool_use output, expected for Gemini/Anthropic in some modes.)");
  }
}

await main();
