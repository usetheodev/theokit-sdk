# D195 — CLI bin name is `theokit` (not `tk`, `theo`, etc.)

**Date:** 2026-05-22
**Status:** Accepted

## Decision

The CLI installs a single bin named `theokit`. Existing single-purpose
bins (`theokit-migrate-memory`, `theokit-migrate-config`) remain
working — they're separate scripts in `@usetheo/sdk/bin/`. Future
work may add `theokit migrate memory|config` aliases with deprecation
warnings on the standalone bins.

## Rationale

- **Consistency** with locked names in CLAUDE.md "Locked names" table:
  env var family `THEOKIT_*`, public namespace `Theokit`, project dir
  `.theokit/`.
- **Avoid collisions**:
  - `tk` collides with Tk/Tcl bindings + the `tk` PyPI package.
  - `theo` is too generic and already used as the agent personality
    name in telegram-pro / discord-pro examples ("Theo Pro").
- **Backward compat**: keeping `theokit-migrate-*` bins working means
  existing scripts referencing them continue without break.

## Consequences

- Enables: zero ambiguity between CLI invocation and existing
  identifiers.
- Constrains: any future bin name change requires a major bump and
  deprecation cycle.
