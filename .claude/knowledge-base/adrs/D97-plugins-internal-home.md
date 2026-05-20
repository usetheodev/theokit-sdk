# D97 — `internal/plugins/` is the canonical home for the Plugin contract

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D98-D101, plan `plugin-extension-block-completion-plan.md`

## Decision

`packages/sdk/src/internal/plugins/` hosts the Plugin contract:
`types.ts`, `context.ts`, `manager.ts`, `lifecycle.ts`. The existing
`runtime/plugins-manager.ts` (which only reads `PLUGIN.md` metadata)
stays as a separate concern — it does NOT execute plugins.

## Rationale

Two different shapes share the "plugins" namespace:
- v1.2 PLUGIN.md metadata (read by `runtime/plugins-manager.ts`)
- v1.3 code plugins with `register(ctx)` (this plan)

Merging them would force callers to disambiguate at runtime in confusing
ways. Separate modules with clear ownership: metadata reader stays put;
code-plugin lifecycle lives in `internal/plugins/`.

## Consequences

- **Enables:** clean separation; v1.2 callers using `agent.plugins.list()`
  continue to see metadata; new callers using `plugins: [definePlugin(...)]`
  get code execution.
- **Constrains:** two directories with related names — mitigated by JSDoc
  cross-references and ADR D97 documentation.
