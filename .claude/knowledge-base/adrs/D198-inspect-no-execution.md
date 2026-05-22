# D198 — `theokit inspect` is read-only; never executes user/plugin code

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`theokit inspect` reads:
- `Theokit.inspect.builtinProviders()` (D201) — SDK's own registry.
- `Theokit.inspect.embeddingAdapters()` (D201) — SDK's memory adapter
  catalog.
- Gateway adapter packages via `require.resolve()` (presence check
  only — no import).
- `~/.theokit/plugins/<name>/PLUGIN.md` + `<cwd>/.theokit/plugins/<name>/PLUGIN.md`
  (read filesystem + parse YAML frontmatter; no `import()` of plugin
  code).

`inspect` must execute in <200ms on a clean install and be safe to run
in CI without side effects.

## Rationale

- **CI safety** — many users will run `theokit inspect --json` in CI to
  verify their toolchain. If inspect executes plugin code, plugin
  side-effects (DB connects, MCP servers spawn, etc.) cascade into CI.
- **Speed** — reading registries is sub-millisecond; spawning user
  process is 100ms+ + import-time penalty.
- **Sandboxing** — read-only walks never trigger plugin init paths,
  preventing accidental credential prompts or network calls.

Alternatives rejected:

- **Spawn the user's `src/index.ts`** to inspect what it registers at
  runtime. Inherits ALL startup side effects — disqualifying.

## Consequences

- Enables: `theokit inspect` in CI, fast feedback in dev.
- Constrains: can't show plugins registered programmatically by user
  code at runtime — only those reachable via filesystem discovery
  (`~/.theokit/plugins/`, `./.theokit/plugins/`). Documented in
  inspect output footer.
