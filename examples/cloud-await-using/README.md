# cloud-await-using

`await using` + idempotent `dispose()` on `CloudAgent`. Companion to
[`one-shot-prompt`](../one-shot-prompt) which uses Local.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## What it shows

ADR D5 declares `[Symbol.asyncDispose]` on the public `SDKAgent`
interface. `await using` syntax (TypeScript 5.2+, Node 22.12+) works
identically on Local and Cloud agents.

ADR D15 EC-3 guarantees idempotent `dispose()` on CloudAgent — calling
`agent.dispose()` after the `using` block fires (or vice versa) is a
no-op the second time, NEVER a double-side-effect.

## Why this matters

Resource safety: `await using` ensures dispose happens even on early
return or thrown exception. Idempotency guarantees that explicit
`dispose()` for graceful shutdown doesn't conflict with the scope-exit
hook. Both patterns compose cleanly.
