# Quickstart

The smallest possible `@usetheo/sdk` program. Demonstrates the core
flow: **create → send → stream → wait**.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env       # paste one provider key
pnpm dev
```

## What it does

1. Calls `Agent.create()` with `local: { cwd: process.cwd() }` and a
   model id chosen from whichever provider key is set in `.env`.
2. Sends one user message.
3. Iterates `run.stream()` — each `SDKMessage` event is yielded as soon
   as it arrives from the provider. Assistant text is printed.
4. Awaits `run.wait()` to get the final `RunResult` with status and
   duration.

## Expected output

```
Agent: agent-<uuid>

Hi! I think it's 2026 based on the most recent data I have access to.

[status=finished duration=1840ms]
```

The exact wording will depend on the model you point at. Status should
always be `finished` and duration is purely informational.
