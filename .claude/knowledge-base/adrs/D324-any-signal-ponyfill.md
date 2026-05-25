# D324 — `anySignal` ponyfill helper in `internal/runtime/abort-utils.ts`

**Status:** Accepted
**Date:** 2026-05-25
**Related:** Production-Readiness plan Phase 4 (absorbed from edge-case EC-5)

## Decision

`internal/runtime/abort-utils.ts` exposes `anySignal(signals: ReadonlyArray<AbortSignal | undefined>): AbortSignal`. The helper:

1. Filters out `undefined` entries.
2. Empty input → returns a never-aborting controller's signal.
3. Single input → returns it directly (short-circuit).
4. Multiple inputs + `AbortSignal.any` native available → delegates.
5. Multiple inputs + no native → uses an `AbortController` with `once: true` listeners that propagate `reason` from the first aborting source.

## Rationale

**Runtime compat.** `AbortSignal.any` is available in Node 22+, Cloudflare Workers, modern Bun, and Deno — but some runtime subsets (Vercel Edge, older embedded targets) lag. The SDK targets Node 22+ per D1, but consumers shipping to Vercel Edge cannot upgrade unilaterally.

Ponyfill is small (~10 lines), deterministic, and matches the spec behavior. Adds zero runtime cost when native is present (delegates directly).

## Alternatives considered

- **Require native AbortSignal.any in all targets** — rejected. Locks out Vercel Edge consumers until that runtime catches up.
- **Use an external package (e.g., `any-signal` from sindresorhus)** — rejected. 10-line helper doesn't justify a peer dep.

## Consequences

- Forward-portable: when all target runtimes support native `AbortSignal.any`, the ponyfill remains dormant (feature-detect short-circuits). No removal needed.
- Tests force the ponyfill branch via `(AbortSignal as any).any = undefined` — coverage guaranteed.
