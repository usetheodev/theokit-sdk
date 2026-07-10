---
"@theokit/sdk": minor
---

**SE9 — integrated structured output on `agent.generate()`.**

New typed `agent.generate(input, { output: schema, ...sendOptions })` method: runs the agent's NORMAL tool loop (the user's tools run first) and then coerces the final answer into a Zod schema, returning a validated, **inferred-typed** object — in one call, instead of a separate `generateObject`. This closes the biggest DX-capability gap vs LangChain `response_format` / Vercel AI SDK `Output.object`.

- `agent.generate<T>(input, { output: T, ...SendOptions }): Promise<GenerateRunResult<z.infer<T>>>` — `{ object, result, raw, usage }`. `object` carries the inferred type; `result` is the underlying tool-loop `RunResult` (status/usage/model).
- **Sugar over `Agent.generateObject` (ADR D33), not a fork:** phase 1 is the user's own `agent.send()` run; phase 2 reuses `generateObjectImpl` (the synthetic forced-`output`-tool + Zod validation + retries) over the run's final answer.
- **Precedence:** `SendOptions` (tools, `toolChoice`, `maxIterations`, …) drive phase 1; the structuring phase forces its own `output` tool. `maxRetries` / `errorStrategy` (`"throw"` | `"return-partial"` | `"return-raw"`) tune phase 2.
- **Typed failure:** a run that errors before an answer surfaces a typed `GenerateObjectError` (no structuring over a failed run); a persistent parse-failure is governed by `errorStrategy`.
- Available on both local and cloud agents.

New exports: `GenerateOptions`, `GenerateRunResult` (+ the `SDKAgent.generate` method). Additive + backward-compatible. From the DX comparison vs OpenAI Agents / LangChain / AI SDK / Mastra. Grounded in ROADMAP SE9.
