# Skills

27 markdown-based skills that serve as entry-points for the 6+1 cycle pipeline
and utilities. Claude Code discovers these automatically via the `SKILL.md`
frontmatter convention.

## Convention

Each skill lives in its own directory: `skills/{name}/SKILL.md`.

Required frontmatter fields:
- `name` — unique identifier (must match directory name)
- `description` — trigger phrase for Claude Code skill discovery
- `user-invocable` — `true` for slash-command skills

## Cycle Entry-Points

| Skill | Cycle | Purpose |
|---|---|---|
| `to-plan` | cycle-plan | Create implementation plan |
| `grill-me` | cycle-plan (Phase 0) | Interview for vague requirements |
| `edge-case-plan` | cycle-plan | Identify edge cases in a plan |
| `plan-confidence` | cycle-plan | Score plan structural quality |
| `plan-improve` | cycle-plan | Auto-improve plan score |
| `implement` | cycle-implement | TDD halt-loop execution |
| `code-quality` | cycle-code-quality | Dead code + fabricated symbol audit |
| `review` | cycle-review | Multi-agent parallel review |
| `release` | cycle-release | Semver tag + develop-to-main PR |
| `auto-plan` | cycle-auto-plan | End-to-end autonomous orchestrator |
| `discover-plan` | cycle-discover | Discovery plan creation |
| `discover-execute` | cycle-discover | Execute discovery via halt-loop |
| `discover-confidence` | cycle-discover | Score blueprint quality |
| `roadmap-init` | cycle-roadmap | Bootstrap ROADMAP.md |
| `roadmap-feature` | cycle-roadmap | Add milestone to existing roadmap |

## Utilities

| Skill | Purpose |
|---|---|
| `ast-grep` | Structural search via tree-sitter |
| `deck` | Full presentation with diagrams |
| `marp-slide` | Marp slides only |
| `excalidraw` | Diagram JSON generation |
| `dogfood` | Honesty gate for v1.0 claims |
| `deps-audit` | Dependency CVE + version audit |
| `skill-creator` | Author / improve / eval any skill at `skills/{purpose}/` (official Anthropic skill-creator, standalone) |

## Adding a New Skill

1. Create `skills/{name}/SKILL.md` with required frontmatter
2. Add to the appropriate cycle contract in `rules/cycle-{name}.md`
3. Run `python3 scripts/check_xrefs.py` to validate cross-references
4. Run `python3 -m pytest tests/test_skill_frontmatter.py` to validate frontmatter
