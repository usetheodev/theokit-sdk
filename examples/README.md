# `@usetheo/sdk` Examples

Self-contained example projects that demonstrate the SDK's runtime
capabilities. Each example is its own package — independent
`package.json`, independent install — so you can copy any folder out of
this repo and have a working starting point.

## How to run an example

Pick the example you want, install, and run.

```bash
cd examples/quickstart
pnpm install --ignore-workspace
cp .env.example .env   # paste your provider key
pnpm dev
```

> The examples link `@usetheo/sdk` from the local source via
> `file:../../packages/sdk`. Run `pnpm install --ignore-workspace` so
> pnpm doesn't try to resolve the SDK through the monorepo workspace
> protocol. Once `@usetheo/sdk` is published to npm you can drop the
> `--ignore-workspace` flag.

## Provider credentials

Every example reads provider keys from a `.env` file in its own folder.
Set whichever one matches your provider — the SDK auto-detects which to
use in the order Anthropic → OpenAI → OpenRouter.

```dotenv
ANTHROPIC_API_KEY=sk-ant-...
# or
OPENAI_API_KEY=sk-...
# or
OPENROUTER_API_KEY=sk-or-...
```

You also need a non-fixture API key for the SDK itself — any non-empty
string that does not start with `theo_test_` works. Examples ship with
`THEOKIT_API_KEY=user-real-example-key` already set in `.env.example`.

## Examples

| Example | What it shows |
| --- | --- |
| [`quickstart`](./quickstart) | The smallest possible agent: create → send → stream → wait. |
| [`shell-tool`](./shell-tool) | Agent uses the real shell tool to inspect a workspace and summarize it. |
| [`mcp-stdio`](./mcp-stdio) | Agent connects to an inline stdio MCP server and calls one of its tools. |
| [`hooks-policy`](./hooks-policy) | File-based `.theokit/hooks.json` denies dangerous shell commands before they run. |
| [`cron-schedule`](./cron-schedule) | Real cron scheduler — `Cron.start()` actually fires jobs on schedule. |

Each example has its own README with the exact prompt, expected output,
and any setup quirks.

## Why fixture mode is bypassed

By default the SDK enters **fixture mode** when the API key matches
`theo_test_*` (used by the contract test suite). The examples use a
non-fixture API key plus a provider env credential, so they exercise the
real LLM runtime — actual HTTP calls to Anthropic / OpenAI / OpenRouter,
real shell execution, real cron timers.
