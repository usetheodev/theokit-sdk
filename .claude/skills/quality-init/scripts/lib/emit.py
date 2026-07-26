"""Emission — generate hook scripts and patch settings.json."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from lib.calibrate import (
    FLOOR_COMPLEXITY,
    FLOOR_FILE_LINES,
    FLOOR_FUNCTION_LINES,
    FLOOR_NESTING_DEPTH,
    FLOOR_PARAMETERS,
    ThresholdCalibration,
)
from lib.detect import SKIP_DIRS, _log
from lib.yaml_safe import merge_hook_into_settings, write_json

# ── Constants ─────────────────────────────────────────────────────────

# lib/emit.py -> lib -> scripts -> skill root
SKILL_ROOT = Path(__file__).resolve().parent.parent.parent
HOOKS_TPL_DIR = SKILL_ROOT / "scripts" / "hooks"


# ── Stage 8: generate_hook_scripts ───────────────────────────────────


def _build_threshold_comments(cal: ThresholdCalibration) -> str:
    """Build human-readable comments for each threshold."""
    lines: list[str] = []

    def _comment(name: str, value: int, p90: int | None, floor: int) -> str:
        if p90 is not None:
            source = f"p90 = {p90}, floor = {floor}"
            which = "p90" if p90 >= floor else "floor"
            return f"# {name}: {source} -> using {which}"
        return f"# {name}: no measurements, using floor = {floor}"

    lines.append(_comment("max_complexity", cal.max_complexity, cal.complexity_p90, FLOOR_COMPLEXITY))
    lines.append(_comment("max_function_lines", cal.max_function_lines, cal.function_lines_p90, FLOOR_FUNCTION_LINES))
    lines.append(_comment("max_nesting_depth", cal.max_nesting_depth, cal.nesting_depth_p90, FLOOR_NESTING_DEPTH))
    lines.append(_comment("max_parameters", cal.max_parameters, cal.parameters_p90, FLOOR_PARAMETERS))
    lines.append(_comment("max_file_lines", cal.max_file_lines, cal.file_lines_p90, FLOOR_FILE_LINES))

    if cal.sample_count > 0:
        lines.append(f"# Calibrated from {cal.sample_count} source files")

    return "\n".join(lines)


def _build_skip_dirs_entries(test_dirs: list[str]) -> str:
    """Build the SKIP_DIRS frozenset entries for smell_types.py."""
    dirs = sorted(SKIP_DIRS)
    # Add test dirs if detected (commented out by default for user to enable)
    entries = [f'    "{d}",' for d in dirs]
    if test_dirs:
        entries.append("    # Detected test directories (uncomment to skip):")
        for td in sorted(test_dirs):
            dirname = Path(td).name
            entries.append(f'    # "{dirname}",')
    return "\n".join(entries)


def generate_hook_scripts(
    hooks_dir: str,
    cal: ThresholdCalibration,
    test_dirs: list[str],
    force: bool = False,
    verbose: bool = False,
) -> str:
    """Generate the 4 hook Python files from templates."""
    hooks_path = Path(hooks_dir)

    # Check if files already exist
    hook_files = ["check_quality.py", "smell_types.py", "smell_python.py", "smell_checks.py"]
    if not force:
        existing = [f for f in hook_files if (hooks_path / f).exists()]
        if existing:
            print(
                f"Hook files already exist in {hooks_dir}: {', '.join(existing)}\n"
                f"Use --force to overwrite or --out to write elsewhere.",
                file=sys.stderr,
            )
            raise SystemExit(3)

    hooks_path.mkdir(parents=True, exist_ok=True)

    generated_date = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    # Template substitution values
    subs = {
        "generated_date": generated_date,
        "max_complexity": str(cal.max_complexity),
        "max_function_lines": str(cal.max_function_lines),
        "max_nesting_depth": str(cal.max_nesting_depth),
        "max_parameters": str(cal.max_parameters),
        "max_file_lines": str(cal.max_file_lines),
        "duplicate_min_lines": str(cal.duplicate_min_lines),
        "duplicate_min_occurrences": str(cal.duplicate_min_occurrences),
        "threshold_comments": _build_threshold_comments(cal),
        "skip_dirs_entries": _build_skip_dirs_entries(test_dirs),
    }

    for tpl_name in hook_files:
        tpl_path = HOOKS_TPL_DIR / f"{tpl_name}.tpl"
        if not tpl_path.exists():
            print(f"Template not found: {tpl_path}", file=sys.stderr)
            raise SystemExit(4)

        content = tpl_path.read_text(encoding="utf-8")

        # Only substitute simple {key} patterns, not Python f-strings or dict literals
        # Templates use {key} for our substitutions and {{ / }} for literal braces
        for key, value in subs.items():
            content = content.replace(f"{{{key}}}", value)

        # Unescape doubled braces back to single braces (template convention)
        content = content.replace("{{", "{").replace("}}", "}")

        out_path = hooks_path / tpl_name
        out_path.write_text(content, encoding="utf-8")

        # Make entry point executable
        if tpl_name == "check_quality.py":
            out_path.chmod(0o755)

        _log(f"Generated {out_path}", verbose)

    return str(hooks_path)


# ── Stage 9: patch_settings_json ─────────────────────────────────────


def patch_settings_json(
    target: str,
    hooks_dir: str,
    no_patch: bool = False,
    verbose: bool = False,
) -> bool:
    """Merge PostToolUse hook into .claude/settings.json."""
    if no_patch:
        _log("Skipping settings.json patch (--no-settings-patch)", verbose)
        return False

    settings_path = Path(target) / ".claude" / "settings.json"
    hook_command = f"python3 {hooks_dir}/check_quality.py"

    try:
        merged = merge_hook_into_settings(settings_path, hook_command)
        write_json(settings_path, merged)
        _log(f"Patched {settings_path}", verbose)
        return True
    except (json.JSONDecodeError, OSError) as exc:
        print(f"Failed to patch {settings_path}: {exc}", file=sys.stderr)
        raise SystemExit(5) from exc
