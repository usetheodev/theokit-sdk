# example-agent-streaming

Iterate `run.stream()` to consume `SDKMessage` events as they arrive, instead of
awaiting the whole result.

Pairs with the docs page **[Agents › Streaming](https://docs.usetheo.dev/theokit/agents/streaming)**.

## Run

```bash
pnpm install
export OPENROUTER_API_KEY=sk-or-...   # https://openrouter.ai/keys — or put it in .env
pnpm run run
```

## What it shows

- `run.stream()` yields a discriminated union of full `SDKMessage` events:
  `system` | `user` | `assistant` | `tool_call` | `thinking` | `status` | …
- `assistant` messages carry `.message.content` as `text` / `tool_use` blocks.
- `run.wait()` after the stream drains resolves to the terminal `RunResult`.
