---
slug: sdk-evolution-post-harness
generated_by: roadmap-feature
date: 2026-07-09
status: completed
milestones: [SE1, SE2, SE3, SE4, SE5, SE6]
---

# Roadmap grill — SDK Evolution (post-Harness), SE1–SE6

## Q1 — What & why now
A curated set of operational-maturity milestones for `@theokit/sdk`, surfaced by a deep comparison
against the **Anthropic Agent SDK** (`@anthropic-ai/claude-agent-sdk`). The Harness-hardening roadmap
(M0–M3) is complete; the comparison confirmed our architecture (in-process, provider-agnostic,
bring-your-own-tools runtime) is the right one, and isolated the *operational* gaps worth closing.

## Q2 — Dependencies
Harness M1 (fail-closed permission core) + M3 (scoped session state, observability) are the base.
SE milestones chain among themselves (SE2 depends on SE1; SE3 on SE2; SE4 on M3; SE5 on SE1+SE4;
SE6 on SE2).

## Q3 — DoD (per milestone, in ROADMAP.md)
- **SE1 Permission model** — `PermissionMode` + `canUseTool`-style pre-tool gate + rules, bridged to
  the existing fail-closed HITL. (biggest operational gap.)
- **SE2 Typed runtime event stream** — discriminated `RunEvent` union (progress/rate-limit/denied/task),
  additive to the ai-sdk UIMessageStream.
- **SE3 Multi-agent provenance** — `origin` metadata (human/peer/task-notification/coordinator) on
  Squad/a2a/handoff turns, forwarded to the result. Metadata-only.
- **SE4 Session management** — list/getMessages/rename/tag over `ConversationStorage`, graceful for
  listing-incapable adapters.
- **SE5 File checkpoint/rewind (GATED)** — ADR decides runtime-vs-framework ownership BEFORE any code
  (BYO-tools means the loop doesn't own file I/O — likely framework/tool-layer).
- **SE6 Provider prewarm (GATED)** — measure first; the Anthropic warm-start amortizes subprocess spawn
  which we don't have; likely a no-op — no `prewarm` API unless the number justifies it.

## Q4 — Top risks
1. **Copying Anthropic's architecture instead of just its operational ideas.** Mitigation: § Explicitly
   out of scope hard-rejects the architectural gaps (OS sandbox, built-in tools, subprocess/warm-start,
   settings engine) with rationale; reopening any requires an ADR.
2. **Duplicating TheoKit (framework) surface in the SDK (runtime).** Mitigation: the SDK ships
   primitives; the framework composes them (the standing runtime-vs-home split). SE1/SE4 explicitly say
   "primitive here, surface in TheoKit".

## Decisions (AskUserQuestion, 2026-07-09)
- **Scope:** "the 4 core + the 2 borderline" → SE1–SE4 (adopt) + SE5–SE6 (gated). Rejected the
  architecture-violating gaps.
- **Home:** new section in `theokit-sdk/ROADMAP.md` (not a separate file); Harness M0–M3 preserved.
- **Numbering fix (post-decision):** the approved preview used M9–M14, but the `M<N>` namespace is the
  shared ecosystem sequence and M9–M14 are already REAL completed ecosystem milestones (Guardrails,
  Memory scoping, Multi-agent v2, …). Renumbered to the distinct **`SE<N>`** prefix to avoid corrupting
  the shared audit trail. (Honesty fix — the collision was discovered after the preview.)

## Source
Deep comparison analysis: Anthropic Agent SDK (TypeScript reference) vs `@theokit/sdk`, 2026-07-09.
