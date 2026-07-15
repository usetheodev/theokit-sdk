---
slug: open-issue-cleanup
generated_by: roadmap-feature
milestone_id: SE38
date: 2026-07-15
status: completed
---
# Grill — SE38 Open-issue cleanup

**Q1 What + why now:** Fix/close the 6 genuinely-open tracker issues after SE37. Triage (2026-07-15)
found 16 of 22 open issues (#47, #54–#68) were already done-in-code (M0–M3 [x] + code refs) and were
closed with evidence; these 6 remain as real work: #48 (reasoning thinking-completed follow-up), #70
(@theokit/agents stream PartialToolCallUpdate), #74 (skills.contract test asserts resolve not reject),
#116 (cli/init pins zod@^3 but SDK needs zod v4 → scaffold crashes), #117 (flaky redact property test,
no fixed seed), #119 (sdk-tools CustomTool ctx lacks threadId/sessionId → stateful tools leak state).

**Q2 Dependencies:** SE37 (all SE1–SE37 [x]). No hard blocker; each issue is independent.

**Q3 DoD:** each of the 6 fixed TDD-first (failing regression test → fix) with REAL evidence where a
model is involved; then the GitHub issue closed with the fix reference. See SE38 block.

**Q4 Top 2 risks:** (1) #119 threads threadId/sessionId through the ToolContext — a public-surface
change that must stay back-compat (optional fields). (2) #116 spans the CLI templates repo/registry
(zod pin) — the fix must be verified against an actually-scaffolded project, not just the template file.

**Out-of-scope check:** no overlap with declared out-of-scope items.
