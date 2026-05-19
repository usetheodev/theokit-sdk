# D75 — 1 file = 1 entity (not 1 file = N entities)

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D74, plan `markdown-config-migration-plan.md`

## Decision

Each user-edited entity gets its own markdown file in a dedicated directory:

- 1 hook = 1 `.theokit/hooks/<name>.md`
- 1 context source = 1 `.theokit/context/<name>.md`
- 1 plugin = 1 `.theokit/plugins/<name>/PLUGIN.md`

We do NOT use a single `hooks.md` with N hook sections.

## Rationale

Per-entity files give us:

- **Per-entity git diff** — change one hook without polluting blame of 5
  others.
- **Per-entity disable** — rename `<name>.md` → `<name>.md.disabled` to
  deactivate without editing config.
- **Discoverability** — `ls .theokit/hooks/` lists hooks by name.
- **Consistency** with `skills/<name>/SKILL.md` (already this shape since
  D10) and Claude Code commands (`~/.claude/commands/<name>.md`).

A single consolidated `hooks.md` with H1 sections per hook would
re-create the JSON pain points (blob diff, ordering matters, no
isolation).

## Consequences

- Enables `git mv` / `git rm` for atomic hook changes.
- Enables "disable-by-rename" — operators don't need to edit files.
- Constrains: bulk operations on hooks become "edit N files". Acceptable
  in practice — operators rarely do bulk hook edits, and when they do,
  IDE multi-file find/replace covers it.
- Constrains: `.disabled` suffix convention must be documented (see
  docs.md "Configuration files" section).
