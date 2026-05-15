# One-shot prompt + `await using`

Two ergonomic patterns that wrap the agent lifecycle:

1. **`Agent.prompt(message, options)`** — create + send + wait + dispose
   collapsed into one call. Returns `RunResult` directly.
2. **`await using agent = await Agent.create(...)`** — explicit handle
   plus deterministic disposal at scope exit (Symbol.asyncDispose).

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## Expected output

```
[one-shot] status=finished result="pong"
[await-using] agent agent-<uuid> created
[await-using] status=finished result="hello again"
```
