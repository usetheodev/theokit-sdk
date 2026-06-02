/**
 * Example: `Eval.create / .run` against a real LLM.
 *
 *   pnpm install
 *   ollama serve & ollama pull llama3.2:3b
 *   pnpm run run
 *
 * Or with cloud:
 *   OPENROUTER_API_KEY=... pnpm run run
 *
 * Prints the EvalRun JSON (aggregate + rows) to stdout.
 */

import { Eval, Scorers, type EvalRun } from "@usetheo/sdk/eval";

const useCloud = typeof process.env.OPENROUTER_API_KEY === "string";

const agent = useCloud
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

const run: EvalRun = await Eval.create({
  name: "smoke-eval",
  dataset: [
    { input: "Reply with the single word: ok.", expected: "ok" },
    { input: "Say jazz in one word.", expected: "jazz" },
    { input: "What is 2 + 3? Reply with just the digit.", expected: "5" },
    { input: "Name a primary color. Reply with one word.", expected: "red" },
    { input: "Say hi in one word.", expected: "hi" },
  ],
  scorers: [
    Scorers.containsExpected({ caseSensitive: false }),
    Scorers.regex(/[a-zA-Z0-9]/),
  ],
  agent,
  concurrency: 2,
  metadata: { example: "eval-smoke", mode: useCloud ? "cloud" : "ollama" },
}).run();

console.log(JSON.stringify(run, null, 2));
console.log("");
console.log(
  `Mean: ${run.aggregate.meanScore.toFixed(3)} | Pass: ${(run.aggregate.passRatio * 100).toFixed(1)}% | Errors: ${run.aggregate.errorRows}/${run.aggregate.totalRows} | Tokens in/out: ${run.aggregate.tokensInTotal}/${run.aggregate.tokensOutTotal}`,
);
