#!/usr/bin/env python3
"""quality-init — 10-stage initializer for Claude Code quality-gate hooks.

Analyzes a target project, calibrates thresholds from actual code metrics,
and emits PostToolUse hook scripts + settings.json patch.

This module is a thin orchestrator. The work is split across lib submodules:
  - lib.detect    — environment detection (languages, frameworks, linters, dirs)
  - lib.calibrate — metric calibration (percentiles, thresholds)
  - lib.emit      — emission (hook scripts, settings.json patch)

Exit codes:
  0 — success
  1 — target invalid / empty / no source files
  2 — required tool missing
  3 — hook files exist, --force not set
  4 — internal IO / parse error
  5 — settings.json patch conflict
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

# Allow importing sibling lib modules
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lib.calibrate import (
    FLOOR_COMPLEXITY,
    FLOOR_FILE_LINES,
    FLOOR_FUNCTION_LINES,
    FLOOR_NESTING_DEPTH,
    FLOOR_PARAMETERS,
    ThresholdCalibration,
    _measure_python_metrics,
    _percentile,
    calibrate_thresholds,
)
from lib.detect import (
    LanguageInfo,
    _log,
    detect_existing_linters,
    detect_frameworks,
    detect_languages,
    detect_test_dirs,
    validate_target,
)
from lib.emit import generate_hook_scripts, patch_settings_json

# Re-exports above keep the public import surface stable for tests, which
# import these symbols directly from init_quality_gates.

__all__ = [
    "FLOOR_COMPLEXITY",
    "FLOOR_FILE_LINES",
    "FLOOR_FUNCTION_LINES",
    "FLOOR_NESTING_DEPTH",
    "FLOOR_PARAMETERS",
    "InitResult",
    "LanguageInfo",
    "ThresholdCalibration",
    "_measure_python_metrics",
    "_percentile",
    "calibrate_thresholds",
    "detect_existing_linters",
    "detect_frameworks",
    "detect_languages",
    "detect_test_dirs",
    "generate_hook_scripts",
    "main",
    "patch_settings_json",
    "smoke_test_tools",
    "validate_round_trip",
    "validate_target",
]


# ── Result aggregate ──────────────────────────────────────────────────


@dataclass
class InitResult:
    target: str = ""
    languages: list[LanguageInfo] = field(default_factory=list)
    frameworks: list[str] = field(default_factory=list)
    existing_linters: list[str] = field(default_factory=list)
    test_dirs: list[str] = field(default_factory=list)
    thresholds: ThresholdCalibration = field(default_factory=ThresholdCalibration)
    hooks_dir: str = ""
    settings_patched: bool = False
    lizard_available: bool = False
    generated_date: str = ""


# ── Stage 7: smoke_test_tools ────────────────────────────────────────


def smoke_test_tools(
    allow_missing: bool = False,
    verbose: bool = False,
) -> tuple[bool, bool]:
    """Verify required tools. Returns (python3_ok, lizard_available)."""
    # Python3 is always required (hook scripts are Python)
    python3_ok = shutil.which("python3") is not None
    if not python3_ok:
        print("Required: python3 is not in PATH.", file=sys.stderr)
        raise SystemExit(2)

    # Lizard is optional (multi-language support)
    lizard_available = False
    try:
        result = subprocess.run(
            ["python3", "-c", "import lizard; print(lizard.version)"],
            capture_output=True, text=True, timeout=10,
        )
        lizard_available = result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    if not lizard_available:
        msg = "Optional: lizard not installed. JS/TS/Go/Rust/Java/C analysis will be limited to file-level checks."
        if not allow_missing:
            _log(msg, verbose)
            print(
                f"lizard not installed. Install with: python3 -m pip install lizard\n"
                f"Or re-run with --allow-missing-tools to continue without multi-language analysis.",
                file=sys.stderr,
            )
            raise SystemExit(2)
        _log(msg, verbose)

    return python3_ok, lizard_available


# ── Stage 10: validate_round_trip ────────────────────────────────────


def validate_round_trip(hooks_dir: str, verbose: bool = False) -> bool:
    """Invoke check_quality.py with a synthetic event to verify it works."""
    hook_script = Path(hooks_dir) / "check_quality.py"
    if not hook_script.exists():
        print(f"Hook script not found: {hook_script}", file=sys.stderr)
        raise SystemExit(4)

    synthetic_event = json.dumps({
        "tool_input": {"file_path": "/nonexistent/file.py"},
    })

    try:
        result = subprocess.run(
            ["python3", str(hook_script)],
            input=synthetic_event,
            capture_output=True,
            text=True,
            timeout=15,
        )
    except subprocess.TimeoutExpired:
        print(f"Hook script timed out during validation: {hook_script}", file=sys.stderr)
        raise SystemExit(4)

    if result.returncode != 0:
        print(
            f"Hook script failed validation (exit {result.returncode}):\n"
            f"  stdout: {result.stdout.strip()}\n"
            f"  stderr: {result.stderr.strip()}",
            file=sys.stderr,
        )
        raise SystemExit(4)

    _log("Round-trip validation passed", verbose)
    return True


# ── Report ────────────────────────────────────────────────────────────


def _format_report(result: InitResult) -> str:
    """Format the human-readable report."""
    lines: list[str] = []
    lines.append("=" * 60)
    lines.append("  quality-init — Quality Gate Hooks Generated")
    lines.append("=" * 60)
    lines.append("")

    lines.append(f"Target: {result.target}")
    lines.append(f"Generated: {result.generated_date}")
    lines.append("")

    # Languages
    lines.append("Languages detected:")
    if result.languages:
        for lang in result.languages:
            lines.append(f"  - {lang.name}: {lang.file_count} files, {lang.loc} LOC")
    else:
        lines.append("  (none)")
    lines.append("")

    # Frameworks
    lines.append("Frameworks detected:")
    if result.frameworks:
        for fw in result.frameworks:
            lines.append(f"  - {fw}")
    else:
        lines.append("  (none)")
    lines.append("")

    # Existing linters
    lines.append("Existing linter configs:")
    if result.existing_linters:
        for linter in result.existing_linters:
            lines.append(f"  - {linter}")
    else:
        lines.append("  (none)")
    lines.append("")

    # Test dirs
    lines.append("Test directories:")
    if result.test_dirs:
        for td in result.test_dirs:
            lines.append(f"  - {td}")
    else:
        lines.append("  (none)")
    lines.append("")

    # Thresholds
    cal = result.thresholds
    lines.append("Calibrated thresholds:")
    lines.append(f"  max_complexity:      {cal.max_complexity:>4}  (p90={cal.complexity_p90 or '-'}, floor={FLOOR_COMPLEXITY})")
    lines.append(f"  max_function_lines:  {cal.max_function_lines:>4}  (p90={cal.function_lines_p90 or '-'}, floor={FLOOR_FUNCTION_LINES})")
    lines.append(f"  max_nesting_depth:   {cal.max_nesting_depth:>4}  (p90={cal.nesting_depth_p90 or '-'}, floor={FLOOR_NESTING_DEPTH})")
    lines.append(f"  max_parameters:      {cal.max_parameters:>4}  (p90={cal.parameters_p90 or '-'}, floor={FLOOR_PARAMETERS})")
    lines.append(f"  max_file_lines:      {cal.max_file_lines:>4}  (p90={cal.file_lines_p90 or '-'}, floor={FLOOR_FILE_LINES})")
    lines.append(f"  duplicate_min_lines: {cal.duplicate_min_lines:>4}  (fixed)")
    if cal.sample_count > 0:
        lines.append(f"  (calibrated from {cal.sample_count} source files)")
    lines.append("")

    # Tools
    lines.append(f"Lizard (multi-language): {'available' if result.lizard_available else 'NOT available'}")
    lines.append("")

    # Generated files
    lines.append("Generated files:")
    lines.append(f"  {result.hooks_dir}/check_quality.py   (entry point)")
    lines.append(f"  {result.hooks_dir}/smell_types.py     (thresholds)")
    lines.append(f"  {result.hooks_dir}/smell_python.py    (Python analyzer)")
    lines.append(f"  {result.hooks_dir}/smell_checks.py    (orchestrator)")
    if result.settings_patched:
        lines.append(f"  {result.target}/.claude/settings.json (patched)")
    lines.append("")

    # Next steps
    lines.append("Next steps:")
    lines.append("  1. Review thresholds in smell_types.py and adjust if needed.")
    if not result.lizard_available:
        lines.append("  2. Install lizard for multi-language support: python3 -m pip install lizard")
    lines.append(f"  {'3' if not result.lizard_available else '2'}. Test the hook: echo '{{\"tool_input\":{{\"file_path\":\"any_file.py\"}}}}' | python3 {result.hooks_dir}/check_quality.py")
    if not result.settings_patched:
        lines.append("  Add this to your .claude/settings.json manually:")
        lines.append('    "hooks": { "PostToolUse": [{ "matcher": "Write|Edit", "hooks": [{ "type": "command", "command": "python3 ' + result.hooks_dir + '/check_quality.py" }] }] }')
    lines.append("")
    lines.append("=" * 60)

    return "\n".join(lines)


# ── Main ──────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Initialize Claude Code quality-gate hooks for a project.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("target", help="Path to the project directory")
    parser.add_argument("--out", help="Output directory for hook scripts (default: <TARGET>/.claude/hooks/)")
    parser.add_argument("--force", action="store_true", help="Overwrite existing hook files")
    parser.add_argument("--strict", action="store_true", help="Use strict thresholds (ignore project metrics)")
    parser.add_argument("--allow-missing-tools", action="store_true", help="Continue if lizard is not installed")
    parser.add_argument("--verbose", action="store_true", help="Stream stage progress to stderr")
    parser.add_argument("--skip-tests", action="store_true", help="Exclude test directories from calibration")
    parser.add_argument("--no-settings-patch", action="store_true", help="Skip patching .claude/settings.json")

    args = parser.parse_args()

    result = InitResult()
    result.generated_date = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    # Stage 1
    _log("Stage 1/10: validate_target", args.verbose)
    result.target = validate_target(args.target)

    # Stage 2
    _log("Stage 2/10: detect_languages", args.verbose)
    result.languages = detect_languages(result.target, args.verbose)

    # Stage 3
    _log("Stage 3/10: detect_frameworks", args.verbose)
    result.frameworks = detect_frameworks(result.target, args.verbose)

    # Stage 4
    _log("Stage 4/10: detect_existing_linters", args.verbose)
    result.existing_linters = detect_existing_linters(result.target, args.verbose)

    # Stage 5
    _log("Stage 5/10: detect_test_dirs", args.verbose)
    result.test_dirs = detect_test_dirs(result.target, args.verbose)

    # Stage 6
    _log("Stage 6/10: calibrate_thresholds", args.verbose)
    result.thresholds = calibrate_thresholds(
        result.target,
        strict=args.strict,
        skip_tests=args.skip_tests,
        verbose=args.verbose,
    )

    # Stage 7
    _log("Stage 7/10: smoke_test_tools", args.verbose)
    _, result.lizard_available = smoke_test_tools(
        allow_missing=args.allow_missing_tools,
        verbose=args.verbose,
    )

    # Stage 8
    _log("Stage 8/10: generate_hook_scripts", args.verbose)
    hooks_dir = args.out or str(Path(result.target) / ".claude" / "hooks")
    result.hooks_dir = generate_hook_scripts(
        hooks_dir,
        result.thresholds,
        result.test_dirs,
        force=args.force,
        verbose=args.verbose,
    )

    # Stage 9
    _log("Stage 9/10: patch_settings_json", args.verbose)
    result.settings_patched = patch_settings_json(
        result.target,
        result.hooks_dir,
        no_patch=args.no_settings_patch,
        verbose=args.verbose,
    )

    # Stage 10
    _log("Stage 10/10: validate_round_trip", args.verbose)
    validate_round_trip(result.hooks_dir, args.verbose)

    # Output report
    print(_format_report(result))


if __name__ == "__main__":
    main()
