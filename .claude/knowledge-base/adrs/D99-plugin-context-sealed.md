# D99 — `PluginContext` is sealed via Proxy in dev mode

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D97, D98

## Decision

In `process.env.NODE_ENV !== "production"`, `createPluginContext()` wraps
the impl in a Proxy with `set` and `deleteProperty` traps that throw.
In production, the raw object is returned (zero overhead).

EC-2 fix: `ctx.on(hook, handler)` additionally validates `typeof handler === "function"` and ignores non-functions with a stderr warn (defense-in-depth — prevents `runPreToolCallHooks` from crashing).

## Rationale

Hermes' "plugins MUST NOT modify core files" (`AGENTS.md:509-513`) is
the inviolable rule. JS is dynamic — without Proxy, plugin
`(ctx as any).newField = "boom"` silently succeeds. Dev guard catches
the abuse in CI; production strips the guard for zero overhead.

## Consequences

- **Enables:** CI/dev catches plugin abuse before deployment.
- **Constrains:** TS-level checks are still primary; Proxy is
  defense-in-depth. Production stripped to keep hot path lean.
