---
type: Defect Register
title: Precision notes
description: Points where a docstring and the code disagree, what the verification method was, and which one wins.
tags: [project, honesty, defects, documentation-drift, verification]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-11-06
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Appendix E, absorbed into this bundle 2026-08-06
    title: Agent AI course, Appendix E — precision notes
    author: human:paulohenriquevn
    last_modified: 2026-07-30
  - id: recheck
    resource: producer knowledge at 2026-08-06 — the call sites below were NOT re-read when this concept was written
    title: Transport caveat
---

> **Transport caveat.** Every line/call-site claim below was verified by the course author
> against the tree at `@theokit/sdk@4.36.0` on 2026-07-30. **They were not re-read on
> 2026-08-06** when this concept was written, and the repository has since released 4.39.0.
> Re-grep before acting on a line number.[^recheck]

# 1 — `budgetTracker` enforcement exists

The docstring on `types/agent.ts` says "type surface only, no runtime enforcement". **False.**

| Claim | Evidence at 4.36.0 |
| --- | --- |
| The gate runs before each iteration | `internal/agent-loop/loop.ts:80` — `evaluateBudgetGate(...)` |
| The counter advances | `internal/agent-loop/loop.ts:109` — `nextIteration()` |
| Usage is tracked after each completion | `internal/agent-loop/loop.ts:365`, `:372` — `track(...)` |

**The enforcement exists and you can depend on it.** The comment is stale — a documentation
defect to fix in the repository. See [limits and budgets](/sdk/limits-and-budgets.md).

# 2 — `memoryProvider` wiring exists

Analogous docstring ("wired to the type surface only"), also **out of date**:
`internal/agent-loop/loop-context-init.ts:86-88` calls `init(...)`, `loop.ts:156` calls
`sync(...)`, `loop.ts:184` calls `dispose(...)`, and
`internal/runtime/lifecycle/post-run-lifecycle.ts:234` calls `recordSessionSummary(...)`.
**The wiring exists.**

The same docstring still cites `createNoopMemoryProvider()`, a factory removed in v3.0.0 — the
current name is `NoopMemoryProvider.create()`. That is a residue of the uniform `X.create()`
migration, which per this project's own roadmap was not finished in docs and templates.

# 3 — Why `agent.runUntil?.()` and `agent.runToCompletion?.()` carry `?.`

These methods are **optional** on the `SDKAgent` interface (`types/sdk-agent.ts` declares them
with `?`), as are `fork`, `streamToCompletion`, `invalidateCache` and `usePersonality`.

It is the same reason `Run.supports()` exists: local and cloud do not offer the same set. The
`?.` in the examples is not decorative defensiveness — it is what the type requires. On a local
runtime, prefer checking the capability explicitly over assuming it is there. See
[agent, run and SDKMessage](/sdk/agent-run-sdkmessage.md).

# 4 — The verification method

Every API in the source course was checked against `packages/sdk/src/types/` and `examples/`.
**Items 1 and 2 surfaced precisely because the verification was done against the code rather
than against the documentation.**

That is the transferable rule, and the reason this register exists as its own concept:

> **When the docstring and the code disagree, the code is the truth.** The divergence is a
> documentation defect to be reported — not an ambiguity to be worked around.

The cost of not doing this is concrete: a consumer who reads the `budgetTracker` comment
concludes they must build their own budget control, and writes redundant code for a mechanism
that already works.

# 5 — Scope caveats carried forward

* **Cloud runtime** — pre-release, dependent on Theo PaaS. Every example in this bundle is
  local. See [the Theo stack](/project/theo-stack.md).
* **The ecosystem comparison** — dated July 2026, calibrated by web research, describing
  architectural models rather than versions. See
  [framework comparison](/ecosystem/framework-comparison.md).
* **Counts** — 502 source files / ~62.6 kLoC in the SDK, 629 test files / ~71.4 kLoC, 30 export
  sub-entries, 71 examples: measured in this repository on 2026-07-30. The "43 providers"
  figure comes from `README.md` and was **not** independently recounted.

# Related

Defects found by review rather than by reading are in
[review: issue-sweep 2026-08](/project/review-issue-sweep-2026-08.md); declared missing
capabilities are [capability gaps](/project/capability-gaps.md). The three are different
categories — a stale comment, an open finding, and a deliberate non-goal — and collapsing them
is how a project loses track of what it actually owes.[^course]

[^course]: Agent AI course, Appendix E
[^recheck]: Producer knowledge, not re-verified against the tree on 2026-08-06
