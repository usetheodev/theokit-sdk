# D76 — Frontmatter validated by Zod schema (same pattern as D10)

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D10, D74, plan `markdown-config-migration-plan.md`

## Decision

Each frontmatter category gets a dedicated Zod schema:

- `HookFrontmatterSchema` — `{ event, matcher, command, enabled?, priority?, timeoutMs? }`
- `ContextSourceFrontmatterSchema` — `{ name?, path, enabled?, maxTokens? }`
- `PluginFrontmatterSchema` — `{ name?, version?, capabilities?, entry? }`

Errors from `safeParse` are wrapped in `ConfigurationError` with typed
codes: `hook_frontmatter_invalid`, `context_frontmatter_invalid`,
`plugin_frontmatter_invalid`. Mirrors D10's `SkillFrontmatter` pattern.

## Rationale

Type safety at the load boundary (not at runtime) catches mistakes early:

- `"priority": "high"` (string in YAML) → Zod rejects → user sees the
  error in `agent.initialize()` log, not 30 minutes later when a hook
  fires unexpectedly.
- `event: preNonsense` (invalid enum) → Zod rejects with the error path
  pointing at `event`.

Reuses primitives already in the codebase: `parseSimpleYaml` (tiny YAML
parser, extended in T0.1 to support typed scalars), `ConfigurationError`
with `code` field, the same Zod version already a peer dep.

Alternative rejected: ad-hoc `typeof` / `instanceof` validation per
loader. More code, less informative errors, easier to drift between
schema and runtime.

## Consequences

- Enables IDE intellisense if we later generate JSON Schema from Zod for
  editor hint files.
- Constrains: users editing frontmatter by hand need to know the schema.
  Mitigated by: docs.md "Configuration files" section shows 1 complete
  example per surface; CLI emits a TODO-shaped prose body that hints at
  expected fields.
- Constrains: Zod is now an even-more-load-bearing dep. Already a peer
  dep (used by `defineTool`, `generateObject`, `streamObject`); zero
  marginal cost.
