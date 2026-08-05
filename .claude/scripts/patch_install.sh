#!/usr/bin/env bash
# Surgical patch installer — applies the session's delta to a consumer .claude/ tree
# WITHOUT touching auto-generated artifacts (SEPA-knowledge skills, review-*-knowledge,
# halt-loop-prompts, .progress-*.json, etc).
#
# Difference from install.sh:
#   - install.sh           → rm -rf <target>/.claude/skills/ ; cp -r source full overwrite
#   - patch_install.sh     → only copies the files listed in MANIFEST below;
#                            never touches anything else under .claude/
#
# Usage:
#   bash scripts/patch_install.sh <target-project-dir>
#
# Pre-flight:
#   - Target must exist
#   - Target must have .claude/ AND .claude/skills/ (i.e., previously install.sh'd)
#
# Behavior:
#   - For each file in MANIFEST:
#     - If parent dir does not exist under target/.claude/, mkdir -p (e.g., new skills)
#     - cp from source to target/.claude/<rel-path>
#   - Prints summary: created vs overwritten counts
#
# What this script does NOT do:
#   - Does not delete anything
#   - Does not touch settings.json, settings.local.json, knowledge-base/, agents/
#   - Does not touch skills NOT in the manifest (preserves SEPA-knowledge etc)
#   - Does not run tests in the target (different env)
#   - Does not commit anything (consumer decides)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ $# -lt 1 ]; then
  echo "Usage: bash scripts/patch_install.sh <target-project-dir>" >&2
  exit 1
fi

TARGET="$(cd "$1" 2>/dev/null && pwd)" || { echo "FATAL: target not found: $1" >&2; exit 1; }
ECO="$TARGET/.claude"

# --- pre-flight -----------------------------------------------------------
[ -d "$ECO" ] || { echo "FATAL: $ECO does not exist. Run install.sh first." >&2; exit 1; }
[ -d "$ECO/skills" ] || { echo "FATAL: $ECO/skills does not exist." >&2; exit 1; }

# --- manifest -------------------------------------------------------------
# Paths are RELATIVE to source SRC_DIR (and to ECO target).
# Lines starting with `#` and empty lines are ignored.
read -r -d '' MANIFEST <<'EOF' || true
# === Brand-new skills (whole folders) ===
skills/release/SKILL.md
skills/release/scripts/changelog_section_nonempty.py
skills/release/scripts/compute_next_version.py
skills/release/scripts/flip_milestone_checkbox.py
skills/release/scripts/promote_unreleased.py
skills/release/scripts/render_release_notes.py
skills/release/tests/conftest.py
skills/release/tests/test_flip_milestone_checkbox.py
skills/roadmap-init/SKILL.md
skills/roadmap-init/templates/roadmap-template.md
skills/roadmap-init/templates/references-catalog-template.md
skills/roadmap-init/fixtures/good-roadmap-ai-gateway.md
skills/roadmap-init/fixtures/bad-roadmap-vague-milestones.md
skills/roadmap-feature/SKILL.md
skills/roadmap-feature/templates/feature-amendment-template.md
skills/roadmap-feature/fixtures/good-feature-amendment.md
skills/roadmap-feature/fixtures/bad-feature-amendment.md

# === New scripts inside existing skills ===
skills/auto-plan/SKILL.md
skills/auto-plan/scripts/select_next_milestone.py
skills/auto-plan/scripts/inject_milestone_id.py
skills/auto-plan/tests/conftest.py
skills/auto-plan/tests/test_select_next_milestone.py
skills/auto-plan/tests/test_inject_milestone_id.py
skills/implement/SKILL.md
skills/implement/prompts/implementation-prompt.md
skills/implement/prompts/validation-fix-prompt.md
skills/implement/reference/resume-protocol.md
skills/implement/scripts/check_tdd_shape.py
skills/implement/scripts/check_phase_completeness.py
skills/implement/scripts/check_diff_cohesion.py
skills/implement/scripts/mini_review.py
skills/implement/tests/test_check_tdd_shape.py
skills/implement/tests/test_check_phase_completeness.py
skills/implement/tests/test_check_diff_cohesion.py
skills/implement/tests/test_mini_review.py
skills/plan-confidence/scripts/check_criterion_executability.py
skills/plan-confidence/scripts/run_structural.py
skills/plan-confidence/templates/score-report.schema.json
skills/plan-confidence/tests/test_check_criterion_executability.py

# === Halt-loop driven skills (consumption-cap removal session) ===
skills/discover-execute/SKILL.md
skills/discover-execute/prompts/execute-mode-prompt.md
skills/discover-improve/SKILL.md
skills/discover-improve/prompts/improvement-prompt.md
skills/plan-improve/SKILL.md
skills/plan-improve/prompts/improvement-prompt.md
skills/to-plan/SKILL.md
skills/discover-plan/templates/discovery-plan-template.md

# === SOTA plan-template upgrade (2026-06-07) ===
skills/to-plan/templates/plan-template.md
skills/plan-confidence/scripts/check_baseline_context.py
skills/plan-confidence/scripts/check_drawbacks_section.py
skills/plan-confidence/tests/test_check_baseline_context.py
skills/plan-confidence/tests/test_check_drawbacks_section.py
skills/plan-confidence/tests/test_run_structural.py
skills/plan-confidence/fixtures/good-plan.md
rules/plan-confidence-golden-rule.md

# === SOTA Phase 2: conditional concurrency + failure-scenarios ===
skills/plan-confidence/scripts/check_concurrency_tests.py
skills/plan-confidence/scripts/check_failure_scenarios.py
skills/plan-confidence/scripts/run_structural.py
skills/plan-confidence/tests/test_check_concurrency_tests.py
skills/plan-confidence/tests/test_check_failure_scenarios.py
skills/to-plan/SKILL.md

# === Test-suite fixes (32 pre-existing failures → 0) ===
skills/plan-confidence/tests/conftest.py
skills/plan-confidence/templates/rubric-v1.md
skills/plan-confidence/templates/score-report.schema.json
skills/plan-confidence/tests/test_skill_md_reads_rules.py
skills/plan-confidence/tests/test_real_plans_snapshot.py
skills/plan-confidence/tests/test_golden_rule.py

# === Bug fix: e2e smoke now validates YAML frontmatter structurally ===
scripts/test_e2e_smoke.py
CHANGELOG.md

# === Rules (cycle definitions) ===
rules/cycle-roadmap.md
rules/cycle-rule-schema.md
rules/cycle-auto-plan.md
rules/cycle-release.md
rules/cycle-implement.md
rules/cycle-discover.md
rules/cycle-plan.md
rules/cycle-review.md
rules/cycle-code-quality.md
rules/cycle-judge-codex.md
rules/cycle-analysis.md
rules/plan-confidence-golden-rule.md

# === Rules (golden rules + conventions + index) — rules-audit 2026-06-28 ===
rules/code-quality-golden-rule.md
rules/deps-audit-golden-rule.md
rules/discover-blueprint-golden-rule.md
rules/discover-plan-golden-rule.md
rules/dogfood-golden-rule.md
rules/analysis-golden-rule.md
rules/error-handling.md
rules/git-safety.md
rules/README.md

# === Rules (shared conventions referenced by skills/cycles — completes manifest gap) ===
# Shared, NOT per-project. Excludes *-thresholds.txt / *-allowlist.txt / *-languages.txt
# / *-config.txt / *-model-routing.txt, which each consumer tunes locally.
rules/architecture.md
rules/testing.md
rules/public-copy.md
rules/parsimony-ladder.md
rules/loop-engine-convention.md
rules/audit-trail-rotation.md

# === Hooks (git-safety hardening — rules-audit 2026-06-28) ===
hooks/validate-command.sh

# === Top-level scripts ===
scripts/check_xrefs.py
scripts/ecosystem_utils.py

# === All first-class skills (root cause of "/deps-audit unknown" + "/plan-confidence unknown") ===
# Entries ending with `/` are copied recursively (whole directory).
# Listing every plan-source skill here guarantees ANY skill added in a previous
# session that did not get a per-file MANIFEST entry still reaches the consumer.
skills/ast-grep/
skills/auto-plan/
skills/code-quality/
skills/deck/
skills/deps-audit/
skills/discover-confidence/
skills/discover-edge-cases/
skills/discover-execute/
skills/discover-improve/
skills/discover-plan/
skills/discover-plan-confidence/
skills/dogfood/
skills/edge-case-plan/
skills/excalidraw/
skills/grill-me/
skills/implement/
skills/marp-slide/
skills/plan-confidence/
skills/plan-improve/
skills/release/
skills/review/
skills/roadmap-feature/
skills/roadmap-init/
skills/skill-creator/
skills/to-plan/
EOF

CREATED=0
OVERWRITTEN=0
MISSING=0
SKIPPED=0
declare -a CREATED_FILES=()
declare -a OVERWRITTEN_FILES=()
declare -a MISSING_FILES=()

while IFS= read -r line; do
  # strip leading/trailing whitespace
  line="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  [ -z "$line" ] && continue
  case "$line" in \#*) continue ;; esac

  src="$SRC_DIR/$line"
  dst="$ECO/$line"

  # Directory entry — trailing slash means "copy whole directory recursively".
  # Each contained file is reported as created/overwritten/skipped individually
  # so the summary stays honest (no silent bulk-copy).
  if [[ "$line" == */ ]]; then
    if [ ! -d "$src" ]; then
      MISSING=$((MISSING + 1))
      MISSING_FILES+=("$line")
      continue
    fi
    # Walk the source directory; mirror into target with per-file accounting.
    while IFS= read -r rel; do
      sf="$src$rel"
      df="$dst$rel"
      if [ -f "$df" ]; then
        if cmp -s "$sf" "$df"; then
          SKIPPED=$((SKIPPED + 1))
          continue
        fi
        cp "$sf" "$df"
        OVERWRITTEN=$((OVERWRITTEN + 1))
        OVERWRITTEN_FILES+=("$line$rel")
      else
        mkdir -p "$(dirname "$df")"
        cp "$sf" "$df"
        CREATED=$((CREATED + 1))
        CREATED_FILES+=("$line$rel")
      fi
    done < <(cd "$src" && find . -type f -not -path './__pycache__/*' -not -name '*.pyc' -not -path './*/__pycache__/*' | sed 's|^\./||')
    continue
  fi

  # File entry — the original per-file path.
  if [ ! -f "$src" ]; then
    MISSING=$((MISSING + 1))
    MISSING_FILES+=("$line")
    continue
  fi

  if [ -f "$dst" ]; then
    if cmp -s "$src" "$dst"; then
      SKIPPED=$((SKIPPED + 1))
      continue
    fi
    cp "$src" "$dst"
    OVERWRITTEN=$((OVERWRITTEN + 1))
    OVERWRITTEN_FILES+=("$line")
  else
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
    CREATED=$((CREATED + 1))
    CREATED_FILES+=("$line")
  fi
done <<< "$MANIFEST"

# --- summary --------------------------------------------------------------
echo "=== Patch summary for $TARGET ==="
echo "created    : $CREATED"
echo "overwritten: $OVERWRITTEN"
echo "skipped    : $SKIPPED (identical to source)"
echo "missing src: $MISSING (file listed but not present in plan source)"

if [ "$CREATED" -gt 0 ] && [ "${VERBOSE:-0}" = "1" ]; then
  echo "--- created files ---"
  printf '  + %s\n' "${CREATED_FILES[@]}"
fi
if [ "$OVERWRITTEN" -gt 0 ] && [ "${VERBOSE:-0}" = "1" ]; then
  echo "--- overwritten files ---"
  printf '  ~ %s\n' "${OVERWRITTEN_FILES[@]}"
fi
if [ "$MISSING" -gt 0 ]; then
  echo "--- WARNING: source files missing (manifest stale) ---"
  printf '  ? %s\n' "${MISSING_FILES[@]}"
fi

echo
echo "Done. Auto-generated skills (SEPA-knowledge, review-*-knowledge) preserved."
echo "Consumer settings.json, knowledge-base/, agents/ untouched."
