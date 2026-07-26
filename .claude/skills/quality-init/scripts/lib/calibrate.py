"""Metric calibration — derive thresholds from the project's actual metrics."""

from __future__ import annotations

import ast
import math
from dataclasses import dataclass
from pathlib import Path

from lib.detect import SKIP_DIRS, _log, _walk_source_files

# ── Constants ─────────────────────────────────────────────────────────

# Minimum floors — thresholds never go below these
FLOOR_COMPLEXITY = 10
FLOOR_FUNCTION_LINES = 20
FLOOR_NESTING_DEPTH = 3
FLOOR_PARAMETERS = 4
FLOOR_FILE_LINES = 300

# Strict mode values (match industry standard recommendations)
STRICT_COMPLEXITY = 10
STRICT_FUNCTION_LINES = 20
STRICT_NESTING_DEPTH = 3
STRICT_PARAMETERS = 4
STRICT_FILE_LINES = 300


# ── Data classes ──────────────────────────────────────────────────────


@dataclass
class ThresholdCalibration:
    max_complexity: int = FLOOR_COMPLEXITY
    max_function_lines: int = FLOOR_FUNCTION_LINES
    max_nesting_depth: int = FLOOR_NESTING_DEPTH
    max_parameters: int = FLOOR_PARAMETERS
    max_file_lines: int = FLOOR_FILE_LINES
    duplicate_min_lines: int = 4
    duplicate_min_occurrences: int = 2

    # Source tracking
    complexity_p90: int | None = None
    function_lines_p90: int | None = None
    nesting_depth_p90: int | None = None
    parameters_p90: int | None = None
    file_lines_p90: int | None = None
    sample_count: int = 0


# ── Utility ───────────────────────────────────────────────────────────


def _percentile(values: list[int | float], pct: int) -> int:
    """Compute the p-th percentile. Returns int (ceiling)."""
    if not values:
        return 0
    sorted_vals = sorted(values)
    idx = math.ceil(len(sorted_vals) * pct / 100) - 1
    idx = max(0, min(idx, len(sorted_vals) - 1))
    return int(math.ceil(sorted_vals[idx]))


# ── Stage 6: calibrate_thresholds ────────────────────────────────────


def _measure_python_metrics(files: list[Path]) -> dict[str, list[int]]:
    """Measure complexity, function length, nesting, and params from Python files."""
    metrics: dict[str, list[int]] = {
        "complexity": [],
        "function_lines": [],
        "nesting_depth": [],
        "parameters": [],
        "file_lines": [],
    }

    for f in files:
        try:
            source = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue

        lines = source.splitlines()
        metrics["file_lines"].append(len(lines))

        try:
            tree = ast.parse(source, filename=str(f))
        except SyntaxError:
            continue

        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue

            # Complexity
            complexity = 1
            for child in ast.walk(node):
                if isinstance(child, (ast.If, ast.For, ast.While, ast.ExceptHandler, ast.Assert)):
                    complexity += 1
                elif isinstance(child, ast.BoolOp):
                    complexity += len(child.values) - 1
                elif isinstance(child, ast.comprehension):
                    complexity += 1 + len(child.ifs)
            metrics["complexity"].append(complexity)

            # Function length
            if hasattr(node, "end_lineno") and node.end_lineno is not None:
                length = node.end_lineno - node.lineno + 1
                metrics["function_lines"].append(length)

            # Nesting
            def max_nesting(n: ast.AST, depth: int = 0) -> int:
                md = depth
                nesting_types = (ast.If, ast.For, ast.While, ast.With, ast.Try, ast.ExceptHandler)
                for c in ast.iter_child_nodes(n):
                    if isinstance(c, nesting_types):
                        md = max(md, max_nesting(c, depth + 1))
                    else:
                        md = max(md, max_nesting(c, depth))
                return md

            metrics["nesting_depth"].append(max_nesting(node))

            # Parameters
            args = node.args
            all_args = args.posonlyargs + args.args + args.kwonlyargs
            count = len(all_args)
            if all_args and all_args[0].arg in ("self", "cls"):
                count -= 1
            if args.vararg:
                count += 1
            if args.kwarg:
                count += 1
            metrics["parameters"].append(count)

    return metrics


def calibrate_thresholds(
    target: str,
    strict: bool = False,
    skip_tests: bool = False,
    verbose: bool = False,
) -> ThresholdCalibration:
    """Calibrate thresholds from actual project metrics."""
    if strict:
        _log("Using strict thresholds (ignoring project metrics)", verbose)
        return ThresholdCalibration(
            max_complexity=STRICT_COMPLEXITY,
            max_function_lines=STRICT_FUNCTION_LINES,
            max_nesting_depth=STRICT_NESTING_DEPTH,
            max_parameters=STRICT_PARAMETERS,
            max_file_lines=STRICT_FILE_LINES,
        )

    files = _walk_source_files(target, SKIP_DIRS, skip_test_dirs=skip_tests)
    py_files = [f for f in files if f.suffix.lower() == ".py"]

    if not py_files:
        # No Python files — measure file lengths only, use floors for the rest
        all_files = files
        file_lines: list[int] = []
        for f in all_files:
            try:
                file_lines.append(len(f.read_text(encoding="utf-8", errors="replace").splitlines()))
            except OSError:
                pass

        p90_file = _percentile(file_lines, 90) if file_lines else 0
        cal = ThresholdCalibration(
            max_file_lines=max(FLOOR_FILE_LINES, p90_file),
            file_lines_p90=p90_file if file_lines else None,
            sample_count=len(all_files),
        )
        _log(f"No Python files — file_lines p90={p90_file}, using floors for function metrics", verbose)
        return cal

    metrics = _measure_python_metrics(py_files)

    p90_complexity = _percentile(metrics["complexity"], 90)
    p90_func_lines = _percentile(metrics["function_lines"], 90)
    p90_nesting = _percentile(metrics["nesting_depth"], 90)
    p90_params = _percentile(metrics["parameters"], 90)
    p90_file_lines = _percentile(metrics["file_lines"], 90)

    cal = ThresholdCalibration(
        max_complexity=max(FLOOR_COMPLEXITY, p90_complexity),
        max_function_lines=max(FLOOR_FUNCTION_LINES, p90_func_lines),
        max_nesting_depth=max(FLOOR_NESTING_DEPTH, p90_nesting),
        max_parameters=max(FLOOR_PARAMETERS, p90_params),
        max_file_lines=max(FLOOR_FILE_LINES, p90_file_lines),
        complexity_p90=p90_complexity,
        function_lines_p90=p90_func_lines,
        nesting_depth_p90=p90_nesting,
        parameters_p90=p90_params,
        file_lines_p90=p90_file_lines,
        sample_count=len(py_files),
    )

    _log(
        f"Calibrated from {len(py_files)} Python files: "
        f"complexity p90={p90_complexity}, func_lines p90={p90_func_lines}, "
        f"nesting p90={p90_nesting}, params p90={p90_params}, "
        f"file_lines p90={p90_file_lines}",
        verbose,
    )

    return cal
