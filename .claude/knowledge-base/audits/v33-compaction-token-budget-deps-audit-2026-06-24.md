# Deps Audit: v33-compaction-token-budget

**Date:** 2026-06-24
**Mode:** plan-bound:v33-compaction-token-budget
**Verdict:** PASS
**Hard caps triggered:** [] (none)

## Summary
- Ecosystems detected: npm (pnpm-lock.yaml)
- Plan-declared NEW deps: **0** (ADR D7 / Rule 9 / blueprint D5 — `compactTranscript` token-budget reuses the in-module public `estimateTokens`; no external dependency added).
- Plan-declared Existing deps to use: 0 new rows (the change is intra-module).
- Vulnerabilities on plan-declared deps: 0 (there are none to scan).
- Auditor coverage: { osv-scanner: present, pip-audit: present (n/a — no Python), cargo: present (n/a — no Rust), govulncheck: present (n/a — no Go), pnpm audit: ran }

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| (none) | New — to be introduced | n/a | n/a | n/a (no NEW dep) | OK |
| `estimateTokens` (in-module) | Existing — use as-is | yes (already exported from `compaction.ts`) | n/a (not an external package) | n/a | OK |

The plan's `## Dependencies` section is present and explicitly declares **no new dependency** with the Rule 9 rationale filled (tiktoken/gpt-tokenizer evaluated + rejected; chars/4 reused). No `plan_dependencies_section_missing`, no `plan_dep_version_unspecified`, no `plan_new_dep_no_rule9_evaluation`, no `plan_dep_not_on_registry` — none of the INVALID_PLAN_DEPS caps apply. No declared dep carries any CVE because no dep is declared.

## Pre-existing workspace vulnerabilities (OUT OF SCOPE for this plan — honest disclosure)

`pnpm audit` on the full workspace reports pre-existing transitive vulnerabilities **NOT introduced or touched by this plan** (V3-3 changes only `packages/sdk/src/compaction.ts` + tests + docs + changeset, adding zero imports):

- 0 critical, 18 high, 27 moderate, 6 low (transitive / dev-tree).

Per `deps-audit-golden-rule.md § 3` hard cap #3, the cap fires only on a **plan-declared** dep with CRITICAL/HIGH CVE. This plan declares no dep, so no cap fires. These workspace highs are pre-existing debt shared by every milestone in this repo (the same baseline V3-4/V3-2 shipped against) and are not a function of V3-3.

**Recommendation (follow-up, NOT a V3-3 blocker):** run a standalone Mode-1 `/deps-audit` sweep + triage the 18 high transitive findings in a dedicated hygiene slice (candidate for V3-0 "higiene operacional"). Tracking them here so they are not silently ignored (anti-pattern 5).

## Recommended next steps

1. No manifest change required — the plan adds no dependency.
2. Proceed with `/plan-confidence v33-compaction-token-budget`.
