# D33 — `Agent.generateObject` via synthetic forced tool

**Status:** Decided
**Date:** 2026-05-17

## Decision

`Agent.generateObject<T extends ZodType>({ schema, prompt, ... })` is a
public static method that returns `Promise<{ object: z.infer<T>, raw,
usage, finishReason }>`. The implementation creates a transient agent,
registers ONE synthetic custom tool whose `inputSchema` is the
Zod-converted JSON Schema of the consumer's schema, and forces the LLM
to call that tool (provider tool-choice = required). The tool call's
`input` is parsed via `schema.parse(input)` to produce the typed result.
On parse failure the call is retried `maxRetries` times (default 1)
before throwing `GenerateObjectError`. The transient agent is disposed
in `finally` regardless of success or failure.

## Rationale

Function-calling has the most consistent support across Anthropic,
OpenAI, and Gemini today. Building on the existing tool-dispatch
infrastructure means:

- Provider routing, fallback, retries, and the rest of the agent loop
  are reused for free.
- The Zod-driven `defineTool` path already validates the input against
  the schema at runtime — `generateObject` rides on the same code path
  without duplication.
- The "raw" object before parse is preserved so consumers can inspect
  refinement failures without writing their own logger.

Alternatives considered:

- **Native JSON mode** (OpenAI `response_format`, Anthropic JSON system
  prompt): fragmented spec support across providers; loose schema
  conformance. Rejected as primary path.
- **Streaming variant** (`streamObject`): out of scope for v1.1.
  `generateObject` is one-shot; streaming partial objects can come in a
  later minor when the value is clearer.

## Consequences

- One LLM call per `generateObject` invocation. Cost is comparable to a
  single `agent.send` (one round-trip + tool dispatch).
- Cannot run in parallel for free — each call spawns a transient agent
  with its own registry entry; high-throughput consumers should batch at
  the application layer or call providers directly.
- Multiple synchronous `output` tool calls from the same response (rare;
  Claude 3.5+ may emit parallel tool use): we use the first, ignore the
  rest. Documented behaviour.
- Retry loop on parse failure means consumers see EITHER a typed object
  or a typed error — never raw model output. This is the goal; it
  trades flexibility for safety.
