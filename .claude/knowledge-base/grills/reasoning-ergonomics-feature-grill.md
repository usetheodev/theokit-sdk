---
slug: reasoning-ergonomics
generated_by: roadmap-feature
milestone_id: SE37
date: 2026-07-14
status: completed
---

# Grill — SE37 Reasoning ergonomics

**Q1 — What + why now:** Ship the two reasoning ergonomics Agno has that the SDK lacks:
(2) a `think()`/`analyze()` reasoning tool (scratchpad), and (3) a lightweight `reasoning: true`
agent flag (structured CoT prompt + auto-attached think tool, same model). Why now: an Agno
cross-check (2026-07-14) confirmed approach 1 (native reasoning models via `model.params:
[{id:"thinking"}]` + streamed thinking + reasoningTokens) is already first-class; only the two
"sugar" approaches are missing. Both are BYO-able today but not primitives.

**Q2 — Dependencies:** SE36 (uniform `X.create()`) — new tools ship as `X.create()`, so the
reasoning tool follows that surface. All SE1–SE36 are `[x]`. No other hard blocker; builds on the
existing `Tool.create`, the ReAct agent loop, and the native-thinking stream.

**Q3 — DoD:** see SE37 block in ROADMAP.md.

**Q4 — Top 2 new risks:** (1) `reasoning: true` double-reasoning waste on models that already
reason natively; (2) prompt-only CoT quality is model-dependent / non-deterministic — hard to
assert in tests beyond "tool was called + shape".

**Out-of-scope cross-check:** no keyword overlap with declared out-of-scope items (checked).
