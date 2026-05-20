# stream-object — `Agent.streamObject<T>` example

Demonstrates `Agent.streamObject<T>` (ADR D39) — structured output WITH partial-object streaming via the synthetic forced tool pattern.

## What it does

1. Defines a Zod schema `FactCard` with `{ title, summary, year, sources }`.
2. Calls `Agent.streamObject({ schema, prompt, model, local })`.
3. Iterates the returned `AsyncIterator<StreamObjectEvent<FactCard>>`:
   - `partial` events print each best-effort schema-parsed snapshot.
   - `complete` event prints the final Zod-validated object.
4. Reports `partialCount`, elapsed time, and `finishReason`.

The pattern under the hood:
- SDK creates a transient agent.
- Registers ONE synthetic `output` tool whose JSON schema is derived from Zod.
- Forces the model to call it once.
- Captures the raw input, schema-parses it, yields `complete`.
- Disposes AND hard-deletes the transient agent (no registry leak).

## Setup

```bash
cp .env.example .env
# Edit .env and set ONE of:
#   OPENROUTER_API_KEY=sk-or-...
#   ANTHROPIC_API_KEY=sk-ant-...
#   OPENAI_API_KEY=sk-...

pnpm install --ignore-workspace
```

## Run

```bash
pnpm dev
```

## Expected output

```
Using model: google/gemini-2.0-flash-001
Streaming structured fact card about jazz music...

Final object (schema-validated):
{
  "title": "Jazz Music",
  "summary": "Jazz is a music genre that originated in the African-American communities of New Orleans, Louisiana, in the late 19th and early 20th centuries. It is characterized by improvisation, syncopation, swing, and the use of blue notes.",
  "year": null,
  "sources": [
    "Wikipedia"
  ]
}

Stats: 0 partial(s), 2143ms, finishReason=tool_use
(Zero partials emitted — this provider batched the tool_use output, expected for Gemini/Anthropic in some modes.)
```

## Notes

- **Partials are best-effort.** Different providers emit different patterns:
  - **OpenAI gpt-4o-mini**: typically streams partials.
  - **Anthropic Claude**: often batches; zero partials expected.
  - **Gemini via OpenRouter**: typically batches; zero partials expected.
- **`complete` is the load-bearing event** — always emitted (or `StreamObjectError` thrown). Write your consumer code against `complete` first; treat partials as nice-to-have UX.
- **No registry leak** — the transient agent is disposed AND removed from `.theokit/agents/registry.json` in the iterator's `finally` block, even if you call `iter.return()` early.

## See also

- ADR D39 — `.claude/knowledge-base/adrs/D39-stream-object-async-iterator.md`
- Smoke test: `tools/validate-streamobject-real-llm.mjs`
- Companion non-streaming API: `Agent.generateObject` (see `telegram-pro` `/fact` command for that)
