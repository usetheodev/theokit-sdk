# D25 — `Agent.builder()` API shape: fluent mutable chain

**Status:** Decided
**Date:** 2026-05-17

## Decision

`Agent.builder()` is a public static method that returns a fresh `AgentBuilder` instance. The builder exposes:

- **Mutable chainable setters** — one per `AgentOptions` top-level field. Each setter assigns to internal state and returns `this`. Order does not matter; later calls to the same setter REPLACE (no merge).
- **Three terminals**:
  - `.build(): AgentOptions` — returns a shallow clone of accumulated options; no validation.
  - `.create(): Promise<SDKAgent>` — calls `Agent.create(this.build())`; validation runs there.
  - `.getOrCreate(agentId: string): Promise<SDKAgent>` — calls `Agent.getOrCreate(agentId, this.build())`; validation runs there.

Validation is delegated to `Agent.create` / `Agent.getOrCreate` via `validateAgentOptions` — the builder never duplicates rules.

## Rationale

Goals:
- Provide an alternative for consumers who prefer fluent chains (Drizzle, Knex, AWS SDK v3 builders) without forcing the pattern on everyone.
- Zero new logic: builder is syntactic sugar over `Agent.create`/`Agent.getOrCreate`. Same validation, same persistence, same surface.
- Single instance per construction. Setters mutate `this.opts` directly rather than returning a new builder per call — avoids allocation and keeps TypeScript types simple (just `this`).

Alternatives considered:
- **Immutable builder (each setter returns a new instance)**: rejected. Allocation per setter call is wasteful; TypeScript types get noisy (each setter needs explicit return type to preserve narrowing).
- **Phased builder with type-state**: rejected. Forcing "must call `.model()` before `.build()`" via types is over-engineered when the runtime check in `Agent.create` already exists.
- **Validation at every setter call**: rejected. Half-built options trigger spurious errors; runs validation N times during construction.
- **`.build()` returns by reference**: changed to shallow clone (EC-2 from edge-case review). Reference leak would let consumers mutate the result and pollute subsequent `.create()` calls.

Decision on `.build()` exposing raw `AgentOptions`: consumers can inspect/log/snapshot the final config before creation. Useful for testing and deployment audits.

## Consequences

- Builder file is small (<100 LoC) because it has no logic of its own.
- Same `AgentOptions` shape; nothing new to learn.
- Setters that overwrite silently are documented behavior — match how object-literal `{ tools: a, tools: b }` would resolve in JS (last wins).
- `.create()` and `.getOrCreate(id)` are async (return Promise); `.build()` is synchronous.
- Validation timing is consistent with options-bag callers — `Agent.create(missingModel)` throws `missing_model`, same as `builder().create()` without `.model()`.
- No `resume()` terminal: resume needs an existing agent ID, which doesn't compose naturally with builder ergonomics. Consumers who want resume use `Agent.resume(id, builder.build())` directly.
