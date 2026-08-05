"""Environment detection — languages, frameworks, linters, test dirs.

Also hosts the low-level source-file walk and logging helpers shared across
the calibration and emission concerns.
"""

from __future__ import annotations

import os
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

# ── Constants ─────────────────────────────────────────────────────────

LANGUAGE_EXTENSIONS: dict[str, set[str]] = {
    "python": {".py"},
    "typescript": {".ts", ".tsx"},
    "javascript": {".js", ".jsx", ".mjs", ".cjs"},
    "go": {".go"},
    "rust": {".rs"},
    "java": {".java"},
    "c": {".c", ".h"},
    "cpp": {".cpp", ".cc", ".cxx", ".hpp"},
    "csharp": {".cs"},
}

SKIP_DIRS: set[str] = {
    "node_modules", "__pycache__", ".git", "dist", "build", ".next",
    ".venv", "venv", "target", "vendor", ".mypy_cache", ".pytest_cache",
    ".ruff_cache", "coverage", ".nyc_output", ".tox", "eggs",
    ".egg-info", ".cache", ".turbo", ".parcel-cache",
}

TEST_PATTERNS: list[str] = [
    "test_*.py", "*_test.py", "*.test.ts", "*.spec.ts",
    "*.test.js", "*.spec.js", "*.test.tsx", "*.spec.tsx",
    "*_test.go", "Test*.java",
]

TEST_DIR_NAMES: set[str] = {
    "tests", "test", "__tests__", "spec", "specs",
    "testing", "test_suite", "e2e", "integration_tests",
}

FRAMEWORK_MARKERS: dict[str, list[tuple[str, str]]] = {
    # (file_pattern, content_pattern)
    "Django": [("settings.py", "INSTALLED_APPS"), ("manage.py", "django")],
    "FastAPI": [("*.py", r"from fastapi import|import fastapi")],
    "Flask": [("*.py", r"from flask import|import flask")],
    "Express": [("*.js", r"require\(['\"]express['\"]\)"), ("*.ts", r"from ['\"]express['\"]")],
    "Next.js": [("next.config.*", ""), ("package.json", '"next"')],
    "React": [("package.json", '"react"')],
    "Vue": [("package.json", '"vue"')],
    "Angular": [("package.json", '"@angular/core"')],
    "Gin": [("go.mod", "github.com/gin-gonic/gin")],
    "Echo": [("go.mod", "github.com/labstack/echo")],
    "Axum": [("Cargo.toml", "axum")],
    "Actix-web": [("Cargo.toml", "actix-web")],
    "Spring": [("pom.xml", "spring-boot"), ("build.gradle", "spring-boot")],
    "Pydantic": [("*.py", r"from pydantic import|import pydantic")],
    "Click": [("*.py", r"import click|from click import")],
    "Typer": [("*.py", r"import typer|from typer import")],
    "Pytest": [("pyproject.toml", "pytest"), ("pytest.ini", ""), ("conftest.py", "")],
    "Jest": [("package.json", '"jest"'), ("jest.config.*", "")],
    "Vitest": [("package.json", '"vitest"'), ("vitest.config.*", "")],
    "Playwright": [("package.json", '"@playwright/test"'), ("playwright.config.*", "")],
}

LINTER_CONFIGS: dict[str, list[str]] = {
    "ruff": [".ruff.toml", "ruff.toml", "pyproject.toml"],
    "eslint": [".eslintrc", ".eslintrc.js", ".eslintrc.json", ".eslintrc.yml", "eslint.config.js", "eslint.config.mjs"],
    "pylint": [".pylintrc", "pylintrc"],
    "flake8": [".flake8", "setup.cfg"],
    "mypy": ["mypy.ini", ".mypy.ini"],
    "biome": ["biome.json", "biome.jsonc"],
    "prettier": [".prettierrc", ".prettierrc.json", ".prettierrc.js", "prettier.config.js"],
    "golangci-lint": [".golangci.yml", ".golangci.yaml", ".golangci.toml"],
    "clippy": ["clippy.toml", ".clippy.toml"],
    "editorconfig": [".editorconfig"],
}


# ── Data classes ──────────────────────────────────────────────────────


@dataclass
class LanguageInfo:
    name: str
    file_count: int = 0
    loc: int = 0
    extensions: set[str] = field(default_factory=set)


# ── Shared helpers ────────────────────────────────────────────────────


def _walk_source_files(
    target: str,
    skip_dirs: set[str],
    skip_test_dirs: bool = False,
    test_dir_names: set[str] | None = None,
) -> list[Path]:
    """Walk target directory and yield source files, respecting skip dirs."""
    all_exts: set[str] = set()
    for exts in LANGUAGE_EXTENSIONS.values():
        all_exts.update(exts)

    files: list[Path] = []
    test_names = test_dir_names or TEST_DIR_NAMES

    for root, dirs, filenames in os.walk(target):
        # Prune skip dirs in-place
        dirs[:] = [
            d for d in dirs
            if d not in skip_dirs
            and not d.endswith(".egg-info")
        ]
        if skip_test_dirs:
            dirs[:] = [d for d in dirs if d.lower() not in test_names]

        for fname in filenames:
            ext = Path(fname).suffix.lower()
            if ext in all_exts:
                files.append(Path(root) / fname)

    return files


def _log(msg: str, verbose: bool) -> None:
    if verbose:
        print(f"  [quality-init] {msg}", file=sys.stderr)


# ── Stage 1: validate_target ─────────────────────────────────────────


def validate_target(target: str) -> str:
    """Validate the target directory exists and contains source files."""
    target_path = Path(target).resolve()

    if not target_path.exists():
        print(f"Target does not exist: {target_path}", file=sys.stderr)
        raise SystemExit(1)

    if not target_path.is_dir():
        print(f"Target is not a directory: {target_path}", file=sys.stderr)
        raise SystemExit(1)

    files = _walk_source_files(str(target_path), SKIP_DIRS)
    if not files:
        print(
            f"No source files found in {target_path}. "
            "Supported: Python, TypeScript, JavaScript, Go, Rust, Java, C, C++, C#.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    return str(target_path)


# ── Stage 2: detect_languages ────────────────────────────────────────


def detect_languages(target: str, verbose: bool = False) -> list[LanguageInfo]:
    """Detect languages present in the project with file counts and LOC."""
    files = _walk_source_files(target, SKIP_DIRS)
    lang_files: dict[str, list[Path]] = defaultdict(list)

    for f in files:
        ext = f.suffix.lower()
        for lang, exts in LANGUAGE_EXTENSIONS.items():
            if ext in exts:
                lang_files[lang].append(f)
                break

    languages: list[LanguageInfo] = []
    for lang, paths in sorted(lang_files.items()):
        loc = 0
        for p in paths:
            try:
                loc += len(p.read_text(encoding="utf-8", errors="replace").splitlines())
            except OSError:
                pass

        info = LanguageInfo(
            name=lang,
            file_count=len(paths),
            loc=loc,
            extensions={p.suffix.lower() for p in paths},
        )
        languages.append(info)
        _log(f"Detected {lang}: {len(paths)} files, {loc} LOC", verbose)

    return languages


# ── Stage 3: detect_frameworks ───────────────────────────────────────


def detect_frameworks(target: str, verbose: bool = False) -> list[str]:
    """Detect frameworks used in the project."""
    detected: list[str] = []

    for framework, markers in FRAMEWORK_MARKERS.items():
        found = False
        for file_pattern, content_pattern in markers:
            if found:
                break
            # Search for matching files
            for f in Path(target).rglob(file_pattern):
                if any(skip in f.parts for skip in SKIP_DIRS):
                    continue
                if not content_pattern:
                    found = True
                    break
                try:
                    content = f.read_text(encoding="utf-8", errors="replace")
                    if re.search(content_pattern, content):
                        found = True
                        break
                except OSError:
                    pass

        if found:
            detected.append(framework)
            _log(f"Detected framework: {framework}", verbose)

    return sorted(detected)


# ── Stage 4: detect_existing_linters ─────────────────────────────────


def detect_existing_linters(target: str, verbose: bool = False) -> list[str]:
    """Detect existing linter/formatter configurations."""
    found: list[str] = []

    for linter, config_files in LINTER_CONFIGS.items():
        for config in config_files:
            config_path = Path(target) / config
            if config_path.exists():
                # For pyproject.toml and setup.cfg, check if the linter section exists
                if config in ("pyproject.toml", "setup.cfg"):
                    try:
                        content = config_path.read_text(encoding="utf-8", errors="replace")
                        if linter == "ruff" and "[tool.ruff]" not in content:
                            continue
                        if linter == "flake8" and "[flake8]" not in content:
                            continue
                        if linter == "pylint" and "[pylint" not in content:
                            continue
                    except OSError:
                        continue

                found.append(linter)
                _log(f"Detected linter config: {linter} ({config})", verbose)
                break

    return sorted(set(found))


# ── Stage 5: detect_test_dirs ────────────────────────────────────────


def detect_test_dirs(target: str, verbose: bool = False) -> list[str]:
    """Detect test directories in the project."""
    test_dirs: list[str] = []

    for root, dirs, _files in os.walk(target):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for d in dirs:
            if d.lower() in TEST_DIR_NAMES:
                rel = os.path.relpath(os.path.join(root, d), target)
                test_dirs.append(rel)
                _log(f"Detected test dir: {rel}", verbose)

    return sorted(test_dirs)
