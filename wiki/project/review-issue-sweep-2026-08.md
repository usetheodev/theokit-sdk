---
type: Review Record
title: "Review: issue-sweep 2026-08"
description: The 2026-08-05 multi-agent review of 10 commits — verdict NEEDS_FIXES, two BLOCKERs, seven HIGH, three published retractions, and the mechanical closure record.
tags: [project, review, findings, audit-trail, honesty]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
sources:
  - id: review
    resource: .claude/knowledge-base/reviews/issue-sweep-2026-08-review-2026-08-05.md, absorbed into this bundle 2026-08-06
    title: Review record — 4 specialist agents in parallel
    author: process:review-cycle
    last_modified: 2026-08-05
---

# Scope

**Date:** 2026-08-05 · **Target:** 10 commits on `workspace` since `8beb61da6` (68 files,
+2531 / −245) · **Reviewers:** 4 agents in parallel (architecture, tests, wiring,
cross-validation) · **Findings:** 34 — BLOCKER 2, HIGH 7, MEDIUM 11, LOW 8, INFO 6.

# Verdict: `NEEDS_FIXES`

Two BLOCKERs. Any BLOCKER halts the merge; seven HIGH independently exceeds the two-HIGH
ceiling.

# Pre-condition deviations, recorded rather than waived

| Pre-condition | State |
| --- | --- |
| A plan at `knowledge-base/plans/{slug}-plan.md` | **absent** — an issue-driven sweep, not a plan cycle. The nine GitHub issues were substituted as ground truth, so plan-vs-implementation line coverage was not computable. |
| An implement validation report | **absent** — no halt-loop ran. |
| A code-quality audit | **produced during this review** → `PASS_WITH_CAVEATS`. See [audit: code quality 2026-08](/project/audit-code-quality-2026-08.md). |
| Tree clean, on `workspace`, tests green | OK (4054 passed / 42 skipped / 0 failed) |

# BLOCKERs

**B1 — `ctx.pendingThinking` leaks across turns, attaching a signature to the wrong text.**
`internal/agent-loop/loop.ts:443`. The block is produced every reasoning round but consumed in
exactly one place, inside `emitAssistantTextStep`, which runs only when `text.length > 0`. On a
**thinking + tool_use round with no preamble text** — the common Anthropic shape — it is never
consumed and never cleared, so round N's signature folds into round N+1's record. On resume
that produces exactly the `400 "thinking blocks cannot be modified"` the work existed to
eliminate.

**B2 — the in-flight assistant turn is replayed without its thinking block.**
`internal/agent-loop/message-builders.ts:73`. `buildAssistantTurn` never produces a `thinking`
part, and it is the only builder of the assistant turn pushed onto `ctx.messages` on the
tool_use path. The same branch **made this reachable** by enabling extended thinking on the
Anthropic request.

# HIGH — the seven

| # | Finding |
| --- | --- |
| H1 | `setDiagnosticsSink` is not exported from any public entry. Every test imports it from `src/internal/`, a path no consumer can reach — the suite is green while the reported blocker stands. |
| H2 | The capability-map gate was green before the branch and red on it: the resolve-check asserts runtime presence, and the branch added the map's first five *type-only* entries. A TypeScript type cannot exist at runtime. |
| H3 | MCP `initialize()` idempotence keys on child liveness rather than handshake completion, so a failed handshake under `'session'` leaves a spawned-but-uninitialized client that turn 2 never retries. A regression on the failure path. |
| H4 | A changeset told consumers a removal is safe "in both version-skew directions". Only one direction is safe — and changesets become the published CHANGELOG, so it would have shipped as the permanent record. |
| H5 | Three of four ported embedding adapters cannot work: the shared runtime is rigidly OpenAI-shaped (`Bearer`, `{model, input}`, `json.data[].embedding`) while azure-openai, cohere and gemini each diverge. Peer coverage was metadata-only, so no `embed()` was ever called. |
| H6 | The credential-scope production wiring has no test — both tests open the scope themselves, so deleting the production line leaves the suite green. Third recurrence of this bug class. |
| H7 | The cross-bundle guard was deleted and its replacement cannot detect the failure: an object-shape assertion says nothing about module duplication, while the new mechanism is a module-level `AsyncLocalStorage`, which is duplication-sensitive. |

Eleven MEDIUM findings and the LOW/INFO tail are in the original record. INFO confirmed: zero
dependency cycles across 508 modules, and both new public statics barrel-exported and
documented.

# Retractions

Three statements published on public issues were false and were corrected:

1. "A host that wants silence installs `setDiagnosticsSink(() => {})`: one line, already
   tested." The symbol is not exported; a host cannot import it (H1).
2. "Removing it is safe in both version-skew directions." False for one direction, which a
   caret range permits (H4).
3. "Extended thinking sessions resume." B1 and B2 mean a thinking + tool_use turn still
   corrupts the transcript and still drops the block on replay.

This section is the reason the record is worth keeping. A review that only lists what the
*code* got wrong, and not what the *reviewer previously published*, leaves the false claim
standing in the place people actually read it.

# Re-verification, 2026-08-05

The `NEEDS_FIXES` verdict stands as the record of what was found. Each blocking finding was
then checked **mechanically** against the tree at `4ef389250` rather than asserted:

| Finding | Check | Result |
| --- | --- | --- |
| B1 | `grep -rn pendingThinking packages/sdk/src` | Closed — the field is gone; the thinking block is a per-round value, not context state |
| B2 | `tests/internal/session/thinking-signature-roundtrip.test.ts` | Closed — regression test present |
| H1 | `grep setDiagnosticsSink packages/sdk/src/index.ts` | Closed — exported from the barrel |
| H2 | `node scripts/check-capability-map.mjs` | Closed — PASS |
| H3 | `tests/mcp/initialize-after-failed-handshake.test.ts` | Closed — regression test present |
| H4 | consumed by the 4.39.0 cut | Closed — corrected before `version-packages` ran |
| H5 | dialect hooks in `openai-compatible.ts` | Closed — wire-contract tests cover the non-OpenAI shapes |
| H6 | `tests/a2a/subagent-credentials-production-wiring.test.ts` | Closed — test present |
| H7 | `node tools/check-cross-cluster.mjs` | Closed — PASS |

**What that section is not.** It is not a re-run of the review and does not replace the
verdict. No specialist agents were re-spawned, so findings this pass could not have surfaced —
anything introduced by the fixes themselves — remain unlooked-for.

**Also honest:** the release those fixes went into (`4.39.0`) shipped *before* the closure
section was written. The sequence was fix, publish, then evidence the closure — recorded so
the timeline is not reconstructed more favourably later.

# Why this record is in the wiki

Three of its findings are cited as live caveats elsewhere in this bundle: H2 is why the
committed capability-map gate was repointed rather than left to rot when this bundle absorbed
`docs/` (recorded in the bundle's `log.md`), H3 is the concrete
`mcpLifecycle: "session"` failure mode in [MCP integration](/sdk/mcp-integration.md), and M3 is
the `Agent.describe()` caveat in [squad and subagents](/sdk/squad-and-subagents.md). It is also
the worked example behind the honesty items in
[governance](/operations/governance.md).[^review]

[^review]: Review record, issue-sweep 2026-08
