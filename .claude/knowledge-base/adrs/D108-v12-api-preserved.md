# D108 — V1.2 caller API is preserved byte-by-byte

**Date:** 2026-05-19
**Status:** Accepted

## Decision

`Agent.create({ provider, tools, plugins, ...rest })` accepts the V1.2
shape verbatim. Internally:
- `provider: "anthropic"` resolves via `getProviderProfile("anthropic")`
- `tools: CustomTool[]` continues to merge into the effective tool catalog
- `plugins: { enabled: [...] }` (legacy metadata) is detected and ignored
  by `extractCodePlugins` (EC-1); the field is read only by
  `runtime/plugins-manager.ts` for `agent.plugins.list()` metadata surface

New shape: `plugins: Plugin[]` (array of code plugins) coexists.
Discrimination is `Array.isArray` first, then per-element shape check.

## Rationale

Breaking the API breaks 7+ examples and telegram-pro production bot.
The data-driven internal refactor is invisible to callers.

## Consequences

- **Enables:** zero-touch migration. v1.2 callers compile + run
  unchanged.
- **Constrains:** `plugins` type union is wider (legacy + new); IDE
  autocomplete may show both shapes. Documented in JSDoc.
