# Review: m1-sdkmessage-readers

**Date:** 2026-06-20
**Reviewers (spawned agents):** 5 — architecture, tests, wiring, cross-validation, domain-api-design (general-purpose, opus-class)
**Findings:** 25 total (BLOCKER: 0, HIGH: 0, MEDIUM: 0, LOW: 4, INFO: 21)
**Verdict:** READY_TO_MERGE

> Note: `consolidate_findings.py` parsed 0 findings from the per-agent markdown (the `## [SEVERITY]` shape the agents emitted isn't the JSON schema the script expects — a known aggregator limitation; the per-agent finding files at `.claude/agents/review-m1-sdkmessage-readers-2026-06-20/findings/*.md` are the ground truth). This report consolidates them faithfully by hand. The verdict (READY_TO_MERGE) matches the script's own output.

## Scope reviewed

Commits `69763c7` (T1.1) + `a21949f` (T2.1) on `develop` vs `main`. Files: `packages/sdk/src/messages.ts`, `packages/sdk/tests/messages-readers.test.ts`, `packages/sdk/tests/messages-readers-wiring.test.ts`, and the subpath wiring (`package.json`, `tsup.config.ts`, `tsconfig.tools-dts.json`, `scripts/mirror-dts-to-cts.mjs`), plus `docs.md` + CHANGELOG + changeset.

## BLOCKER findings (must fix before merge)

_None._

## HIGH findings

_None._

## MEDIUM findings

_None._

## LOW findings (optional hardening — do not block merge)

### [LOW] Block-filter style asymmetry (architecture)
- file: `packages/sdk/src/messages.ts:23,40`
- detail: `assistantText` narrows text blocks with `Extract<typeof block, { type: "text" }>` while `extractToolUses` uses a named `(b): b is ToolUseBlock` predicate. Both correct; cosmetic asymmetry.
- fix: none required; could unify for readers symmetry.

### [LOW] Ordered-join fixture is alphabetical (tests)
- file: `packages/sdk/tests/messages-readers.test.ts:60-62,68-70`
- detail: `test_assistantText_ignores_tool_use_blocks` and `test_assistantText_joins_multiple_text_blocks_in_order` both assert the same `[text,toolUse,text] → "ab"` shape. EC-2's "no reordering / no separator" intent would be locked harder by a non-alphabetical, >2-block fixture.
- fix: optional — use a fixture like `"zeta "+"alpha"` to defeat accidental sort-equivalence.

### [LOW] Non-assistant assistantText test covers only `system` (tests)
- file: `packages/sdk/tests/messages-readers.test.ts`
- detail: the plan names system/tool_call/user; the unit test exercises `system` for assistantText (the other variants are covered via extractToolUses). Defensible — impl uses a single `type !== "assistant"` guard.
- fix: optional — add user/tool_call variants to assistantText for symmetry.

### [LOW] Naming convention asymmetry (domain-api-design)
- file: `packages/sdk/src/messages.ts`
- detail: `assistantText` (subject-prefixed) vs `extractToolUses` (verb-prefixed). Advisory for future readers; both read naturally.
- fix: none recommended for M1-5.

## INFO findings (logged; merge proceeds)

21 INFO across the 5 agents, key ones:
- **DIP boundary holds** (the load-bearing check): `src/messages.ts:11-12` imports ONLY leaf types (`types/messages.ts` → `agent-prims.ts` zero-import leaf; `types/usage.ts` → nothing). No `internal/runtime` reach — ADR D4 satisfied.
- **D3 cost-honesty verified**: `grep -c "?? 0" src/messages.ts` == 0; `cost?.amountUsd` preserved verbatim. `null` correctly rejected (preserves the SDK's own `number | undefined`).
- **D2 boundary locked**: `test_extractToolUses_empty_for_tool_call_lifecycle_message` pins the `tool_call` lifecycle event ≠ assistant `tool_use` block distinction — the subtlest invariant.
- **Wiring complete**: all 4 config files match `path-safety` exactly; build emits `dist/messages.{js,cjs,d.ts,d.cts}`; attw resolves `@theokit/sdk/messages` 🟢 node16-CJS/ESM/bundler (cts mirror clean — no masquerading). The `node10` attw miss is a pre-existing package-wide baseline (every subpath), not a messages defect.
- **docs.md is source-of-truth consistent**: lines 1840-1859 match the exported names + signatures; example `costAmountUsd(result.cost)` type-checks (`RunResult.cost: CostBreakdown | undefined`).
- **Zero new dependencies**: `./messages` exports block (+10 lines, shape-identical to path-safety); runtime `dependencies` unchanged. devDeps in `main..HEAD` are from prior milestones, not these commits.
- **Two stale-doc-count notes** (cross-validation): plan T1.1 AC says "12/12" and Final-Phase says "14/14"; actual is 13 unit + 2 integration = 15 (a SUPERSET — the SEPA-added D2 test). More coverage than promised, not less — INFO only.

## Quality gate re-validation (tighter thresholds)

- Full SDK suite: 373 files / 2735 passed, 35 skipped (env-gated), **0 failed** (+15 from M1-4 baseline).
- Typecheck: exit 0. Biome: clean (complexity ≤ 10). knip: clean. Build: clean (4 dist artifacts). attw: `./messages` 🟢.
- Coverage: the 3 readers are pure and fully exercised (every branch: non-assistant, empty array, mixed blocks, cost undefined/0/absent, no-mutation) — 15 tests over a 53-line module.

## Edge-case coverage

Plan edge cases EC-1 (empty content array) + EC-2 (ordered join) both covered with dedicated tests. SEPA-added D2 boundary test exceeds the plan. No missing scenario.

## Verdict rationale

0 BLOCKER, 0 HIGH, 0 MEDIUM. Per `cycle-review.md § Verdicts`: "READY_TO_MERGE — no BLOCKER, ≤ 2 HIGH findings with documented mitigation." The 4 LOW + 21 INFO are advisory hardening/observations, none blocking. **READY_TO_MERGE.**

## Recommended next step

`/release` — opens PR `develop → main` with the proposed semver tag (human approves the merge). M1-5 closes roadmap gap #34.
