# D161 — Personality files are markdown with strict YAML frontmatter

**Date:** 2026-05-20
**Status:** Accepted

## Decision

Each personality preset is a single `.md` file. The frontmatter is
validated by a Zod schema (`PersonalityFrontmatterSchema`) with these
fields: `name` (required, **lowercase-only** slug per EC-C), `description`
(optional), `tools` (optional string array, advisory whitelist),
`model` (optional, future use), `tags` (optional, classifier only).
The markdown body after `---` is the system-prompt overlay.

## Rationale

Mirrors the proven shape used by `.theokit/agents/*.md`, Claude Code
skills (`SKILL.md`), and Cursor rules (`.mdc`). Authors edit a single
file per preset; the schema gives Zod-validated errors with file paths.
Lowercase-only `name` (no `/i` flag in the regex) prevents `Coder` vs
`coder` becoming two distinct registry keys — the registry Map is
keyed verbatim.

## Consequences

- **Enables:** `loadMarkdownEntities` (D10/D76) is the loader (no new
  loader code).
- **Constrains:** uppercase / mixed-case slugs are rejected at validation
  time. No silent canonicalization.
