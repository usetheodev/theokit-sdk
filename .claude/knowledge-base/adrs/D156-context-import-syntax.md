# D156 — `@path` import syntax for CLAUDE.md / GEMINI.md (5-hop cap)

**Date:** 2026-05-20
**Status:** Accepted

## Decision

`CLAUDE.md` and `GEMINI.md` parsers honor `@path/to/file` import
directives (Anthropic/Gemini convention). Resolution is recursive with
**5-hop cap** and absolute-path-based cycle detection.

EC-Q: lines must be EXACTLY `@path` (regex `^@(\S+)\s*$` with `gm`).
Inline references like `see @x.md, also @y.md` are NOT resolved — matches
Anthropic's actual behavior.

EC-D: every imported file is itself capped at `maxBytesPerFile` via
`loadPlainMarkdown` BEFORE concatenation. Prevents a CLAUDE.md with 5
imports of 30k each from ballooning to 150k unimported content.

Path resolution:
- `~/x` expands to `os.homedir()/x`.
- Absolute paths resolve verbatim.
- Relative paths resolve against the importing file's directory.

Failure modes (placeholders, never throws):
- file not found → `[@import not found: <raw>]`
- cycle detected → `[@import cycle detected: <raw>]`
- depth exceeded → trailing `…[@import depth limit 5 reached]`

AGENTS.md / THEO.md / `.cursor/rules` do NOT follow imports (no
documented convention in those formats).

## Rationale

Anthropic and Google both use this exact syntax; supporting partial
would be confusingly inconsistent for Claude Code users.

## Consequences

- **Enables:** `@~/.theokit/global-instructions.md` + project-local
  imports for layered context.
- **Constrains:** parser complexity bounded by 5 hops + cycle visited set.
