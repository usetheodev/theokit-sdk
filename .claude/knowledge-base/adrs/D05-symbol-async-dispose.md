---
id: D5
status: Decided
date: 2026-05-16
plan: sdk-v1-ga-completion
---

# D5 — Adopt `Symbol.asyncDispose` in `SDKAgent` public type

## Context
`LocalAgent` + `CloudAgent` constructors already wire `[Symbol.asyncDispose]` via `Object.defineProperty`-style assignment, but the public `SDKAgent` interface doesn't declare it. Result: `await using agent = ...` compiles only if the consumer's TS config also has `ESNext.Disposable` in `lib`.

## Decision
Bump `tsconfig.base.json` `lib` to include `ESNext.Disposable`. Declare `[Symbol.asyncDispose](): Promise<void>` on the public `SDKAgent` interface. Keep `dispose()` as the explicit-call alternative.

## Rationale
`using` declarations are GA in TypeScript 5.2+. Real users will write `await using agent = await Agent.create(...)`. Shipping without the public surface forces every consumer to write `try/finally`.

## Consequences
- Minimum TS lib target bumped — Node 18 support already dropped by D1.
- `CloudAgent.dispose()` gains idempotency guard (matches existing `LocalAgent.disposed` flag) so `await using` + manual call doesn't run dispose logic twice.

## Alternatives Considered
- **Keep dispose() only** — rejected; consumers must hand-write try/finally.
- **Use sync `Disposable` (`Symbol.dispose`)** — rejected; agent dispose is naturally async.
