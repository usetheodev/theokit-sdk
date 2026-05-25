# D306 — `ConversationStorageAdapter` interface uses `Promise<>` uniformly

**Status:** Accepted
**Date:** 2026-05-25
**Related:** Production-Readiness plan Phase 1, T1.1

## Decision

Every method of `ConversationStorageAdapter` returns `Promise<>`, including in synchronous backends (in-memory). Implementations may use `async` syntactic sugar that yields a single microtask for sync operations.

## Rationale

- **Single call-site.** Consumers `await adapter.appendMessage(...)` regardless of backend; no special-casing.
- **Mixing sync/async in the contract forces defensive `await` anyway.** A `getMessages` that "returns either StoredMessage[] OR Promise<StoredMessage[]>" forces every consumer to `Promise.resolve` the result. Net cost is the same; ergonomics worse.
- **Microtask cost is negligible.** `Promise.resolve(value)` adds ~1μs per call. Hot path is fs/network/db, not microtask scheduling.

## Alternatives considered

- **Type as `T | Promise<T>` for each method** — rejected. Pushes the async coordination burden to consumers. Bad ergonomics.
- **Two interfaces: `SyncConversationStorageAdapter` + `AsyncConversationStorageAdapter`** — rejected. Type system explosion. Consumers would need adapter-shape polymorphism which TypeScript handles badly.

## Consequences

- In-memory adapter loses ~1μs per op to a microtask. Acceptable.
- Consumer code is uniform — `for await (const msg of ...)` works regardless of backend.
