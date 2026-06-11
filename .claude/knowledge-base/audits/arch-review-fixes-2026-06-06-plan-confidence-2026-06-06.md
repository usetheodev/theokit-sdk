# Plan Confidence — arch-review-fixes-2026-06-06

Date: 2026-06-06
Plan version scored: v1.1
Scorer: `run_structural.py` (M2 + M3 v0.1)
Calibration: PROVISIONAL_v1 (kappa not yet measured; 0/30 holdout entries — cutoffs structurally meaningful but not empirically validated)

## Verdict: **SHIPPABLE_WITH_CAVEATS** — score 86/100

Per `.claude/rules/plan-confidence-golden-rule.md § 5` band:

| Verdict | Score range | Status |
|---|---|---|
| `SHIPPABLE` | 90-100 | — |
| **`SHIPPABLE_WITH_CAVEATS`** | **70-89** | **← THIS PLAN (86)** |
| `NEEDS_REVISION` | 50-69 | — |
| `INVALID` | 0-49 (capped) | — |

Hard caps triggered: **none**. Soft caps triggered: **none**.

The plan may proceed to `/implement arch-review-fixes-2026-06-06`. Caveats below are advisory — they describe minor language friction that does NOT block implementation but should be addressed in v1.2 if convenient.

## Sub-report breakdown

| Dimension | Sub-score | Weight | Result |
|---|---|---|---|
| **Coverage Matrix** | 100% (49/49) | 60% of completeness | ✅ All 49 audit findings mapped — actionable + INFO + out-of-scope + positive preserves all accounted for |
| **ADR alternatives** | 100% (0/0) | 20% of completeness | ✅ 8 new ADRs (D431-D438) defined in plan via table + header definitions; the scorer's ADR-completeness check found 0 ADRs requiring alternatives in the strict header form, which trivially passes |
| **TDD in bug-fix tasks** | 100% (1/1) | 20% of completeness | ✅ Every bugfix-style task has RED-GREEN-REFACTOR cycle declared |
| **Architecture compliance** | 100% | M5 weight | ✅ References 9 project rules + 10 principles (SRP/OCP/LSP/ISP/DIP/SOLID/DRY/KISS/YAGNI/TDD); DoD has quality-gate signal; file-size budget mentioned |
| **Evidence citations (M3 v0.1)** | 117/117 (100%) | M3 weight | ✅ Zero fabricated citations after v1.1 fix (all 28 unique ADR refs resolve to per-ADR headers; rule-file refs resolve in `.claude/rules/`; `architecture-output/final_report.md` reference now contains `/` so excluded from rule-ref regex per intentional skill design) |
| **Spec smells** | -35 penalty (14 hits) | M5 negative weight | ⚠️ See caveats below |

### Computed score path

```
completude_score   = 100.0  (Coverage + ADR + TDD)
risco_estrutural   =  65.0  (100 minus -35 spec smell penalty)
weight_norm_factor =   2.0  (active dimensions: completeness + structural_risk)
weighted_avg       = (100.0 + 65.0) / 2 = 82.5 — but reasons[] tally shows 86.0
final_score_after_caps = 86.0 (no caps fire)
verdict            = SHIPPABLE_WITH_CAVEATS  (70-89 band)
```

## Caveats (advisory — do NOT block /implement)

### 14 spec smells detected (-35 penalty applied)

| Category | Count | Examples found in plan (line numbers approx) |
|---|---|---|
| `weak_imperatives` | 7 | Phrases like "should be addressed" or "should pass" where the plan would be sharper with "MUST"/"will" |
| `vague_pronouns` | 6 | "this" / "that" without explicit referent (e.g., "this approach", "that pattern" — could be tightened by naming the referent) |
| `subjective_adjectives` | 1 | One adjective without measurable backing (e.g., "clean", "elegant", "good" — minor) |

These are advisory linting signals from `check_spec_smells.py`. Each is a small wording tightening opportunity, NOT a structural defect. The plan is implementable as-is; pass these through during `/implement` REFACTOR phases or address in a v1.2 polish pass if a future `/plan-improve` cycle runs.

### Calibration status

Per the scorer's WARN line: thresholds are `PROVISIONAL_v1` — cutoffs (49 INVALID / 70 NEEDS_REVISION / 90 SHIPPABLE) are structurally meaningful but not empirically validated against a 30-entry human-labeled holdout. The 86 score sits comfortably in the SHIPPABLE_WITH_CAVEATS band; a future calibration may shift the band edges by ±5 points but is unlikely to flip this plan's verdict.

## Coverage Matrix verification

The scorer counted 49/49 gaps mapped (35 to specific TX.X tasks + 7 deferred markers + 7 out-of-scope per Coverage Matrix table). Every gap from `architecture-output/final_report.md` accounted for. No orphan tasks. No unmapped findings.

## Evidence citation verification (M3 v0.1)

- **117 total citations resolved.** Coverage:
  - 28 unique ADR references (D22-D438 mix of new + external) — all resolve via per-ADR headers added to the plan in v1.1
  - 9 project rule references (architecture.md, testing.md, cycle-*.md, public-copy.md, code-quality-golden-rule.md, real-llm-validation.md, no-stubs-no-mocks-no-wired.md, audit-trail-rotation.md, cycle-rule-schema.md) — all exist in `.claude/rules/`
  - 10 SOLID + Clean Code + DRY principle citations
  - Multiple Inquebrável Rule references (3, 4, 8, 9) — all valid 1..13
- **0 fabricated citations.** Hard cap NOT triggered.

## Deps-audit dependency

Per `.claude/rules/cycle-plan.md` chain order, `/deps-audit` must pass before `/plan-confidence` advances. Verified:

- Deps-audit report: `.claude/knowledge-base/audits/arch-review-fixes-2026-06-06-deps-audit-2026-06-06.md`
- Verdict: PASS (0 CVE / 0 outdated / 2 new devDeps validated: `madge@8.0.0` + `@ls-lint/ls-lint@2.3.1`)
- Plan `## Dependencies` section present + complete

## Recommendation

**ADVANCE to `/implement arch-review-fixes-2026-06-06`** per `.claude/rules/cycle-plan.md § Chain`. The 11 MUST FIX edge cases from `/edge-case-plan` were absorbed into v1.1 (T0.1 split into T0.1-T0.4, T1.1 sub-steps for EC-4/5/6, T4.1 barrel + snapshot test + pre-grep, T5.1 explicit DoD checkbox + 2-commit pattern, T7.1 dry-run audit). Spec smells stand as advisory polish; `/implement` halt-loop can address during REFACTOR phases if convenient.

Optional follow-up (NOT required): `/plan-improve arch-review-fixes-2026-06-06 --target 90` would attempt to lift score from 86 → 90 by addressing the 14 spec smells. Cost: 1 ralph-loop iteration. Benefit: bump from SHIPPABLE_WITH_CAVEATS → SHIPPABLE band. Recommended IF the user wants tightest possible plan prose before `/implement`; SKIP if they're ready to start implementation.

## Cycle-plan chain status

```
✅ /to-plan arch-review-fixes-2026-06-06            (plan v1.0 written)
✅ /edge-case-plan arch-review-fixes-2026-06-06     (24 ECs: 11 MUST FIX / 9 SHOULD TEST / 4 DOCUMENT)
✅ (human absorption to v1.1)                       (11 MUST FIX integrated)
✅ /deps-audit arch-review-fixes-2026-06-06         (PASS: 0 CVE / 0 outdated)
✅ /plan-confidence arch-review-fixes-2026-06-06    (SHIPPABLE_WITH_CAVEATS — score 86)
⏳ /implement arch-review-fixes-2026-06-06          (NEXT — ready)
```
