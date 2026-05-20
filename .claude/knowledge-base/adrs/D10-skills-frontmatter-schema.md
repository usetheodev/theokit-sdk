---
id: D10
status: Decided
date: 2026-05-16
plan: sdk-v1-ga-completion
---

# D10 — Skills frontmatter schema is strict

## Context
Skill files at `.theokit/skills/<name>/SKILL.md` are loaded by `skills-manager.ts`. The loader was loose: accepted any frontmatter shape or none. Consumers couldn't rely on `skill.description` being set.

## Decision
SKILL.md requires YAML frontmatter with `name: string` (required) and `description: string` (required). Optional fields: `category: string`, `dependencies: string[]`. Unknown fields are ignored (forward-compat). Frontmatter-less or malformed-YAML SKILL.md is rejected with `SkillSchemaError` and excluded from `skills.list()` (the agent run continues without it).

## Rationale
A strict shape lets agents reason about skills (e.g., "show me skills with dependency X"). Loose acceptance turns "skill.description" into a wishful-thinking field. Zod is already a peer dep, so enforcement is cheap.

## Consequences
- **BREAKING for v1.0**: existing skill files without frontmatter are skipped on load.
- Migration snippet for consumers (documented in CHANGELOG):
  ```sh
  grep -rL "^---$" .theokit/skills/*/SKILL.md
  ```
- Three typed error codes:
  - `missing_frontmatter` — no `---` block at file head
  - `schema_invalid` — frontmatter present but YAML malformed OR Zod schema mismatch
  - both surface as `process.stderr.write` warnings; skill excluded from `skills.list()`

## Alternatives Considered
- **Loose schema with warnings** — rejected; consumers ignore warnings, hidden state-rot.
- **JSON Schema instead of Zod** — rejected; Zod is already peer dep, no reason to introduce two validators.
