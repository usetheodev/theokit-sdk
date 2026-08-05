#!/usr/bin/env python3
"""Validate SKILL.md frontmatter conformance across all skills.

Checks that every skills/*/SKILL.md has the required frontmatter fields,
that names are unique, and that names match their parent directory.

Usage:
    python3 scripts/validate_skill_frontmatter.py          # validate all
    python3 scripts/validate_skill_frontmatter.py --strict  # exit 1 on warnings too

Exit codes:
  0 — All skills valid
  1 — At least one validation error (or warning in --strict mode)
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

# Ensure scripts/ is on sys.path for shared module imports
sys.path.insert(0, str(Path(__file__).resolve().parent))

from ecosystem_utils import find_ecosystem_dir  # noqa: E402

REQUIRED_FIELDS = {"name", "description", "user-invocable"}
OPTIONAL_FIELDS = {"version", "requires", "allowed-tools", "argument-hint", "paths"}

# Regex for YAML-like frontmatter between --- markers
FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---", re.DOTALL)
FIELD_RE = re.compile(r"^([a-z][a-z0-9_-]*):\s*(.+)$", re.MULTILINE)


def parse_frontmatter(content: str) -> dict[str, str]:
    """Extract frontmatter fields from SKILL.md content."""
    match = FRONTMATTER_RE.match(content)
    if not match:
        return {}
    return {m.group(1): m.group(2).strip() for m in FIELD_RE.finditer(match.group(1))}


def validate_all(ecosystem_dir: Path, strict: bool = False) -> int:
    """Validate all SKILL.md files. Returns exit code."""
    skills_dir = ecosystem_dir / "skills"
    if not skills_dir.is_dir():
        print(f"ERROR: {skills_dir} not found", file=sys.stderr)
        return 1

    errors: list[str] = []
    warnings: list[str] = []
    names_seen: dict[str, str] = {}  # name -> directory

    for skill_dir in sorted(skills_dir.iterdir()):
        if not skill_dir.is_dir():
            continue
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.exists():
            warnings.append(f"WARN: {skill_dir.name}/ has no SKILL.md")
            continue

        content = skill_md.read_text(encoding="utf-8")
        fields = parse_frontmatter(content)

        if not fields:
            errors.append(f"ERROR: {skill_dir.name}/SKILL.md has no frontmatter (missing --- markers)")
            continue

        # Check required fields
        for field in REQUIRED_FIELDS:
            if field not in fields:
                errors.append(f"ERROR: {skill_dir.name}/SKILL.md missing required field: {field}")

        # Check name matches directory
        if "name" in fields:
            name = fields["name"]
            if name != skill_dir.name:
                errors.append(
                    f"ERROR: {skill_dir.name}/SKILL.md name '{name}' "
                    f"does not match directory name '{skill_dir.name}'"
                )
            # Check uniqueness
            if name in names_seen:
                errors.append(
                    f"ERROR: duplicate name '{name}' in "
                    f"{skill_dir.name}/ and {names_seen[name]}/"
                )
            names_seen[name] = skill_dir.name

    # Print results
    for w in warnings:
        print(w)
    for e in errors:
        print(e, file=sys.stderr)

    total_skills = len(names_seen)
    print(f"\nValidated {total_skills} skills: {len(errors)} errors, {len(warnings)} warnings")

    if errors:
        return 1
    if strict and warnings:
        return 1
    return 0


def main() -> int:
    eco = find_ecosystem_dir(require=True)
    strict = "--strict" in sys.argv
    return validate_all(eco, strict=strict)  # type: ignore[arg-type]


if __name__ == "__main__":
    sys.exit(main())
