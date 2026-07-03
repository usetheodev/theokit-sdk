# Review: m8-ecosystem-ga-readiness

**Date:** 2026-07-03
**Verdict:** READY_TO_MERGE (substance) — GA `[x]` gated on operator sign-off
**Findings:** 0 BLOCKER · 1 HIGH · 0 MEDIUM

## Scope
M8, the closing milestone (ecosystem GA readiness): dogfood anchor + cross-pillar front door + north-star baseline. Blueprint: m8-ecosystem-ga-readiness.

## DoD status
- **#1 `/dogfood` anchor exercises the pillars on real infra with fresh evidence** → **SUBSTANCE MET**: anchor `open-stack-agent` declared (golden-rule §1 + manifest); a real, timed open-stack run (Harness SDK + Skills tool-use + theo-ui render, real OpenRouter) passed 3× (ANCHOR_OK). Runtime/cloud is pre-release (contract-only, M7) — DoD allows "M7 optional". **The `/dogfood` PASS itself (EVIDENCE_SUFFICIENT) requires Status `running`** = sustained team usage on real infra (golden rule §2) — an operator attestation. Honestly set to `wired` (real smoke), NOT self-declared `running` (that is the §7 dogfood-theatre the rule forbids).
- **#2 unified cross-pillar docs + honest pre-release labels** → **MET**: README "Where this fits" now explains the 4-pillar open-stack composition + how they compose end-to-end + honest per-pillar status (Runtime pre-release) + validated cross-pillar wiring; stale `referencia/` reference fixed. public-copy-lint clean.
- **#3 north-star baselined (time-to-first-working-agent)** → **BASELINE MET**: measured ≈1.9s warm / 7.1s cold over 3 real runs. **Ratification** of the metric is `[UNRESOLVED]` in the ROADMAP (operator confirms it is THE north-star).

## Findings
### HIGH
- **H1 — GA `[x]` is operator-gated, not cycle-completable.** Three items close M8 to a true GA claim and cannot be produced by a cycle run without becoming dogfood theatre / a false public-copy claim: (a) flip the anchor `wired → running` once the team uses it on real infra ongoing; (b) ratify `time-to-first-working-agent` as the north-star (ROADMAP `[UNRESOLVED]`); (c) the SDK README `status-production` badge + PITCH "production" claim must clear `public-copy.md §3` (sustained real-production evidence) — currently only real-LLM smoke evidence exists. → **Surfaced to the operator, not faked.** The M8 checkbox stays `[ ]` until sign-off; the SUBSTANCE (anchor + evidence + front door + baseline) is complete + committed.

## Handoff decision
**READY_TO_MERGE (substance)** — all tractable M8 deliverables are done, tested (anchor ANCHOR_OK 3×, README lint clean, theo-ui typecheck green), and committed. The GA-status attestations (running / ratification / production claim) are the operator's to sign off; they are surfaced honestly in the manifest + blueprint + this review. Faking them would violate the dogfood + public-copy contracts + the mandate's "SEM WORKAROUNDS".
