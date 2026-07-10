# SE9 — Integrated structured output (`agent.generate`) — Plan

**Milestone:** SE9 (SDK Evolution). Biggest DX-capability gap from the reference comparison.
User-chosen API shape (2026-07-10): a **typed `agent.generate()` method** (full inference, reuses
`generateObject`, no generic `Run` ripple) — NOT `SendOptions.output` (which would leave `RunResult.output`
`unknown`) nor a generic `Run<T>` (large runtime ripple). This is the AI SDK `agent.generate({ output })`
/ a framework `response_format` shape.

## Goal

`agent.generate(input, { output: schema, ...sendOptions })` runs the agent's NORMAL tool loop (the user's
tools run first) and then coerces the final answer into the Zod schema, returning a validated, typed
object — in one call, instead of a separate `generateObject`.

## Design (reuse `generateObjectImpl`, do NOT fork — ADR D33)

The existing `generateObjectImpl` already implements the two-phase reason→structure flow (a plain run
produces text; a forced synthetic `output` tool extracts the object). SE9 is that flow where **phase 1 is
the user's own `agent.send()` run** (with their tools), and phase 2 reuses `generateObjectImpl` over the
run's final answer.

### New public surface (`src/agent-generate.ts`, NEW)

```ts
export interface GenerateOptions<T extends ZodType> extends SendOptions {
  output: T;                                              // the Zod schema
  maxRetries?: number;                                    // structuring retries (reused)
  errorStrategy?: "throw" | "return-partial" | "return-raw";
}
export interface GenerateRunResult<O> {
  object: O;          // validated, inferred type
  result: RunResult;  // the underlying tool-loop run (usage/status/model)
  raw: unknown;       // raw model input before the Zod parse
  usage: { inputTokens: number; outputTokens: number };
}
```

`SDKAgent.generate<T extends ZodType>(input, options: GenerateOptions<T>): Promise<GenerateRunResult<z.infer<T>>>`.

### Implementation (shared helper, both runtimes delegate)

`agentGenerate(agent, model, apiKey, local, input, options)`:
1. `const { output, maxRetries, errorStrategy, ...sendOptions } = options`.
2. Phase 1 — the user's loop: `const run = await agent.send(input, sendOptions); const result = await run.wait()`.
   If `result.status === "error"` → throw a typed `GenerateObjectError` wrapping `result.error` (no structuring over a failed run).
3. Phase 2 — structuring reuses `generateObjectImpl({ prompt: result.result ?? "", schema: output, model, apiKey, local, maxRetries, errorStrategy }, { create: Agent.create, delete: Agent.delete })` (Agent via dynamic import to avoid the agent↔runtime cycle).
4. Return `{ object, result, raw, usage }`.

`LocalAgent.generate` + `CloudAgent.generate` each delegate to `agentGenerate(this, this.model, this.options.apiKey, this.options.local, ...)`.

### Precedence (documented)

`sendOptions` (tools, `toolChoice`, `maxIterations`, `output` excluded) apply to **phase 1** (the loop).
Phase 2 forces its own `output` tool (via `generateObjectImpl`). `output` is required; the rest are
optional and forwarded to phase 1.

## Coverage Matrix

| DoD claim | Task | Test |
|---|---|---|
| `agent.generate` returns a validated typed object from the run | T1 (types), T2 (impl) | integration: tool loop → structured object |
| Tools run first; structuring on the final turn (reuse generateObject) | T2 | user tool ran + object returned (stub 3-step) |
| Failure is typed (parse fail / run error) | T3 | run-error → typed GenerateObjectError; parse-fail honored via errorStrategy |
| Precedence with toolChoice/maxIterations documented | T4 | docs + sendOptions forwarded to phase 1 |
| Docs + Changeset | T5 | — |

## Drawbacks & Risks

1. Forking generateObject's structuring. Mitigation: call `generateObjectImpl` directly (single seam), no re-implementation.
2. Two LLM calls (loop + structuring) — same as generateObject's `structuringModel` two-phase. Documented; acceptable (matches SOTA).
3. Run error before an answer. Mitigation: short-circuit with a typed error before structuring.
4. agent↔runtime import cycle. Mitigation: `Agent.create`/`delete` via dynamic import (same pattern as `Agent.generateObject`).

## Unresolved Questions

(none) — the API shape (`agent.generate`) is user-confirmed; structuring reuses the ADR-D33 machinery.
