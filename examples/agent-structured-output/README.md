# example-agent-structured-output

Coerce an agent's final answer into a validated, inferred-typed object with a Zod
schema via `agent.generate(message, { output: schema })`.

Pairs with the docs page **[Agents › Structured output](https://docs.usetheo.dev/theokit/agents/structured-output)**.

## Run

```bash
pnpm install
export OPENROUTER_API_KEY=sk-or-...   # https://openrouter.ai/keys — or put it in .env
pnpm run run
```

## What it shows

- `agent.generate(message, { output: zodSchema })` → `{ object, result, raw, usage }`.
- `object` is typed from the schema (no manual JSON parsing, no casts).
- The SDK forces a single synthetic tool whose schema IS your Zod schema (ADR D33),
  then Zod-validates the model's output.
