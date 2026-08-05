# Code-quality audit — issue-sweep-2026-08

**Date:** 2026-08-05
**Mode:** standalone (Mode 1). Mode 2 was not available — see § Deviations.
**Runner:** `.claude/skills/code-quality/scripts/run_code_quality.py`
**Scope:** repository working tree at `workspace` (10 commits since `8beb61da6`; 68 files, +2531 / -245).

```json
{"verdict": "PASS_WITH_CAVEATS", "score_cap": 89}
```

## Verdict

**`PASS_WITH_CAVEATS`** (score cap 89).

Per `rules/cycle-code-quality.md § Hard gates`, this verdict **unblocks `/review`**. Caveats are
explicit below rather than folded into the pass.

## Severity counts

| Severity | Count |
|---|---|
| HARD | 0 |
| SOFT_CAP | 0 |
| SOFT_FLOOR | 69 |
| INFO | 0 |

`hard_caps_triggered` lists `symbol_fab_unverifiable_typescript`. Read carefully: this is
**unverifiable**, not **fabricated**. `severity_counts.HARD` is 0 and no
`symbol_fabrication_typescript` finding exists — the identifier records that D2 could not complete
member-access introspection for TypeScript, which the skill's own roadmap lists as deferred to v0.2
("D2 member-access introspection for TypeScript — currently package-name check only"). It is a
declared coverage limit of the detector, not a defect in the audited code.

## Languages

| Language | Status | Reason |
|---|---|---|
| typescript | **audited** | `package.json` present |
| python | skipped | manifest `pyproject.toml` not found |
| rust | skipped | manifest `Cargo.toml` not found |
| go | skipped | manifest `go.mod` not found |

## Detectors — what actually ran

| Detector | Ran? | Result |
|---|---|---|
| D1 — dead code (knip) | **NO** | Absent from `findings_by_detector`. No dead-code claim can be made from this run. |
| D2 — symbol fabrication | yes | 69 findings, all SOFT_FLOOR; 0 fabrications |
| D3 — cross-package wiring | **NO** | Absent from `findings_by_detector`. No orphan-export claim can be made. |
| D4 — mutation testing | **NO** | Requires a plan's `## Critical paths` (Mode 2). Unavailable. |

**This is the caveat that matters.** A `PASS_WITH_CAVEATS` here means "D2 found no fabricated
symbols", NOT "the code is free of dead exports". Three of four detectors did not report. Per the
skill's own anti-pattern #4 — *never claim "no dead code" when the D1 auditor failed* — that claim
is not made.

## Deviations from the skill contract, stated rather than hidden

1. **Mode 1, not Mode 2.** Mode 2 binds the audit to `knowledge-base/plans/{slug}-plan.md`. No such
   plan exists: this was an issue-driven sweep against nine GitHub issues, not a `/to-plan` cycle.
   Consequence: D4 mutation testing had no `## Critical paths` to scope to and did not run.

2. **`rules/code-quality-languages.txt` is unusable by this skill — a pre-existing repo defect.**
   The runner aborts with `languages.txt malformed line: 'typescript'`. The project file uses a
   one-identifier-per-line format; the skill's parser expects the four-column
   `LANGUAGE | MANIFEST-MARKER | STATUS | NOTES` shape shipped in
   `skills/code-quality/defaults/languages.txt`. The two formats are incompatible, so
   **`/code-quality` has never been runnable in this repository** — which is a sufficient
   explanation for why `knowledge-base/audits/` was empty before today.

   This run used `--languages-rule` pointed at the skill defaults. That is behaviourally equivalent
   to the project's intent (only `package.json` exists at root, so only TypeScript audits either
   way) and avoids mutating a project rule file during a review.

   The file's own header also claims it is read by `hooks/post-edit-check.sh`; `grep` finds no such
   consumer — only `scripts/install.sh` references it. Both the format collision and the stale
   header are filed as findings for `/review`, not fixed here (this skill is read-only by contract).

3. **Markdown report hand-assembled from the emitted JSON.** `--audit-out` produced no file in
   standalone mode. Every number above is copied from the real detector run
   (`schema_version 0.1.0`), not estimated.

## Handoff

`PASS_WITH_CAVEATS` → `/review` MAY proceed, carrying these caveats forward:

- D1 / D3 / D4 did not report. `/review`'s wiring agent must not treat this audit as evidence of
  dead-code or orphan-export cleanliness.
- The `code-quality-languages.txt` format collision is a repo-level defect that outlives this sweep.
