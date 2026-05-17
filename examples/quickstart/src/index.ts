import { Agent } from "@usetheo/sdk";

/**
 * Quickstart — the smallest possible @usetheo/sdk program.
 *
 * Creates a local agent, sends one prompt, streams the events as they
 * arrive, and prints the final assistant text. Requires a real provider
 * key in `.env` (Anthropic, OpenAI, or OpenRouter).
 *
 * Two equivalent variants:
 *  - `main()` — canonical `Agent.create({ ...options })` (options-bag form).
 *  - `mainWithBuilder()` — `Agent.builder().model(...).create()` (fluent form,
 *    ADR D25). Same behaviour, different ergonomics.
 *
 * Dispatch: set `BUILDER=1` in env to run the builder variant.
 *   pnpm dev              → options-bag form
 *   BUILDER=1 pnpm dev    → fluent builder form
 */

function pickModel(): string {
  if (process.env.ANTHROPIC_API_KEY) return "claude-sonnet-4-5-20250929";
  if (process.env.OPENAI_API_KEY) return "gpt-4o-mini";
  if (process.env.OPENROUTER_API_KEY) return "openai/gpt-4o-mini";
  throw new Error(
    "No provider key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in .env.",
  );
}

const SYSTEM_PROMPT =
  "You are a senior staff engineer. Respond in exactly one terse sentence. No emojis, no greetings, no apologies.";
const API_KEY = process.env.THEOKIT_API_KEY ?? "user-real-example-key";

async function streamAndReport(agent: Awaited<ReturnType<typeof Agent.create>>): Promise<void> {
  console.log(`Agent: ${agent.agentId}`);
  const run = await agent.send("What year do you think it is?");
  for await (const event of run.stream()) {
    if (event.type === "assistant") {
      const text = event.message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
      console.log(`\n${text}`);
    }
  }
  const result = await run.wait();
  console.log(`\n[status=${result.status} duration=${result.durationMs}ms]`);
}

async function main(): Promise<void> {
  // Options-bag form — the canonical Agent.create entry. Pass every field
  // up front; the SDK validates and returns a handle.
  const agent = await Agent.create({
    apiKey: API_KEY,
    model: { id: pickModel() },
    local: { cwd: process.cwd() },
    systemPrompt: SYSTEM_PROMPT,
  });
  await streamAndReport(agent);
}

async function mainWithBuilder(): Promise<void> {
  // Fluent form — same result, progressive chaining (ADR D25). Each setter
  // mutates the builder and returns `this`. `.create()` runs validation and
  // returns the same SDKAgent as `Agent.create({...})` would.
  const agent = await Agent.builder()
    .apiKey(API_KEY)
    .model({ id: pickModel() })
    .local({ cwd: process.cwd() })
    .systemPrompt(SYSTEM_PROMPT)
    .create();
  await streamAndReport(agent);
}

// EC-3 (edge-case review of examples-helper-migration plan): env var instead
// of argv flag. `pnpm dev -- --builder` works but the `--` separator confuses
// new users; `BUILDER=1 pnpm dev` is unambiguous across pnpm/tsx/node.
const entry = process.env.BUILDER === "1" ? mainWithBuilder : main;
entry().catch((cause) => {
  console.error("Quickstart failed:", cause);
  process.exit(1);
});
