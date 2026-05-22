# D201 — `Theokit.inspect.*` public namespace in `@usetheo/sdk`

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`@usetheo/sdk` exposes a public `Theokit.inspect` static namespace
with read-only introspection of bundled assets:

```ts
Theokit.inspect.builtinProviders(): Array<{
  name, apiMode, authType, baseUrl, aliases?, envVars
}>;
Theokit.inspect.embeddingAdapters(): Array<{
  id, transport, defaultModel
}>;
```

The methods are sync (no I/O), idempotent, and call `registerBuiltins()`
under the hood when needed. They mirror the internal registry state.

## Rationale

- **EC-E MUST FIX** (from `cli-theokit` edge-case review 2026-05-22):
  `@usetheo/cli`'s `inspect` command needs to enumerate the builtin
  providers + embedding adapters. The SDK's internal modules
  (`internal/providers/registry.ts`,
  `internal/memory/adapters/catalog.ts`) are NOT in
  `package.json#exports`, so deep imports fail in consumer installs
  with `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- **Public surface = contract** — exposing a thin wrapper API
  preserves the SDK's internal/public boundary while giving tooling
  a stable consumption point.
- **Mirrors existing pattern** — `Theokit.providers.list()` (cloud
  catalog) already conceptually exposes a list. `inspect.*` is the
  local counterpart for monorepo / SDK-bundled assets.

Alternatives rejected:

- **Expose `internal/*` via `package.json#exports`** — would
  legitimize deep imports of private modules; any future refactor
  inside `internal/` would break consumers.
- **Bundle SDK source into CLI via tsup `noExternal`** — works in dev
  but ships the SDK twice for consumers who install both.

## Consequences

- Enables: CLI works against the PUBLISHED SDK (not just monorepo
  source). Any future tooling (Docs site #3, future inspectors) uses
  the same public API.
- Constrains: changes to internal registry shape must update
  `Theokit.inspect.*` to preserve the contract — same discipline as
  any other public API.
