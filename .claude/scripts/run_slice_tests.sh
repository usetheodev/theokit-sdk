#!/usr/bin/env bash
# Run every skill slice's test suite in ISOLATION.
#
# WHY isolated (one pytest process per slice) instead of a single wide
# `pytest skills/` run:
#   The 31 slices are deliberately import-isolated (package-by-feature). Several
#   slices ship modules with the SAME top-level basename but DIFFERENT content
#   (e.g. check_research_coverage.py, apply_fixes.py, check_reference_citations.py).
#   In production each skill runs alone with only its own scripts/ on sys.path, so
#   these never collide. A single wide pytest process would put multiple slices'
#   scripts/ on one sys.path and `import check_research_coverage` would resolve to
#   whichever slice loaded first — a configuration that never happens in real use.
#   Running each slice in its own process mirrors production and keeps the suite
#   honest. See CHANGELOG (2026-06-20) for the full rationale.
#
# Exit code: 0 only if every slice plus the root suite is green.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PYTEST=(python3 -m pytest -q -p no:cacheprovider --no-header)

failures=()

run_suite() {
    local path="$1"
    [ -d "$path" ] || return 0
    echo "::group::pytest $path"
    if "${PYTEST[@]}" "$path"; then
        echo "PASS  $path"
    else
        echo "FAIL  $path"
        failures+=("$path")
    fi
    echo "::endgroup::"
}

# Root aggregate suite (frontmatter, cross-cutting).
run_suite tests

# Each skill slice in its own process.
for d in skills/*/tests; do
    run_suite "$d"
done

echo
if [ "${#failures[@]}" -eq 0 ]; then
    echo "ALL SUITES GREEN"
    exit 0
fi
echo "FAILED SUITES (${#failures[@]}):"
printf '  - %s\n' "${failures[@]}"
exit 1
