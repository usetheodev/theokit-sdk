# D74 — User-edited configs migrate to markdown + YAML frontmatter

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D75, D76, D77, D78, plan `markdown-config-migration-plan.md`

## Decision

The 3 user-edited config surfaces under `.theokit/` migrate from JSON
to **markdown with YAML frontmatter**, espelhando o pattern já em uso
para `skills/<name>/SKILL.md`:

- `.theokit/hooks.json` → `.theokit/hooks/<name>.md`
- `.theokit/context.json` → `.theokit/context/<name>.md`
- `.theokit/plugins/<name>/plugin.json` → `.theokit/plugins/<name>/PLUGIN.md`

Machine-state JSON files (`agents/registry.json`, `mcp-tokens.json`,
`cron/jobs.json`) keep JSON — different purpose (write-by-machine,
read-by-machine; never hand-edited).

## Rationale

The 4 SDK config formats today are inconsistent — skills use markdown,
configs use JSON. JSON has 4 concrete weaknesses for human-edited files:

1. **No comments** — users can't annotate "why this hook exists".
2. **Multi-line strings escaped** — readable scripts become `"foo\nbar"`.
3. **Diff noise** — reordering fields churns the entire blob.
4. **No type safety on hand-edit** — `"priority": "1"` (string) only
   surfaces at runtime.

Markdown + YAML frontmatter solves all 4 with a pattern already
validated by:

- `~/.claude/CLAUDE.md` (Claude Code instructions)
- `~/.claude/commands/*.md` (slash commands)
- `.cursor/rules/*.md` (Cursor rules)
- Anthropic Skills marketplace (skill-style packages)
- Our own `skills/<name>/SKILL.md` since D10

Alternatives rejected:

- **JSONC** — adds parser dep without buying prose body or per-entity files.
- **TOML** — comments + multi-line, but niche in TS ecosystem.
- **TypeScript config (`*.config.ts`)** — requires eval (security trade-off)
  and breaks cross-language tooling (Python CLI can't read TS).

## Consequences

- Enables self-documenting configs — `cat .theokit/hooks/shell-policy.md`
  shows both the rule and the rationale.
- Constrains: caller doing "list all hooks" reads a directory instead of
  an array (trivial; `ls` + parse each file).
- Constrains: bulk edits across N entities become N file edits. Aceitável —
  entities mudam isoladamente em prática (per-entity git history wins).
- Backward compat preserved via D77 fallback (MD-first, JSON fallback
  with deprecation warn). Sunset in v2.0.
