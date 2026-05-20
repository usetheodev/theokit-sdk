# D98 — `Plugin` is a discriminated union by `kind`

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D97, plan `plugin-extension-block-completion-plan.md`

## Decision

`Plugin` is a TS discriminated union over `kind`:
- `"general"` — supplies `register(ctx)`
- `"model-provider"` — supplies `profile: ProviderProfile`
- `"memory"` — supplies `createProvider: (cwd) => MemoryProvider`

PluginManager dispatch is exhaustive switch by kind. Adding a 4th kind
requires updating the union AND the switch (no silent extension).

## Rationale

Hermes deep-dive (`AGENTS.md:467-562`) shows the three kinds have
fundamentally different lifecycles (general eager, memory per-agent,
model-provider lazy). Mixing them in a single shape caused
double-instantiation bugs in Python. TS discriminated union eliminates
the problem at compile time.

Plugin author writing `{ kind: "general", profile: {...} }` gets a
compile error — TS narrows the type based on `kind` and demands the
correct shape per kind.

## Consequences

- **Enables:** exhaustive type checking in PluginManager; per-kind
  lifecycle without runtime type guards spread across the codebase.
- **Constrains:** adding a 4th kind is a deliberate decision (not a
  silent extension via `Plugin<"new-kind", ...>`).
- **EC-11, EC-12 (documented):** Plugin `name` empty string is caller's
  responsibility (no schema validation). Plugin `register()` throw is
  fail-fast at `Agent.create` (no silent skip).
