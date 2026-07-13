---
slug: api-uniform-x-create
generated_by: roadmap-feature
milestone_id: SE36
date: 2026-07-13
status: completed
---

# Feature grill — Uniform `X.create()` API (v3.0 breaking)

## Q1 — What is this feature and why now?

Replace every public factory function in `@theokit/sdk` (`defineTool`, `defineProvider`,
`definePlugin`, `defineSkillReadTool`, `defineSubscription`, `createSquad`, `createSkill`,
`createSessionManager`, `createAgentFactory`, `createNoopMemoryProvider`, and the utility
factories `createSemaphore` / `createTokenLimiter` / `createUnicodeNormalizer` /
`createPermissionPlugin` / `withRetry` / …) with a uniform static-namespace `X.create()`
form, matching the existing `Agent.create` / `Cron.create` / `Workflow.create`.

**Why now:** the owner (Paulo) identified the `Agent.create` vs `defineTool` inconsistency as
a first-class API-design defect (2026-07-13) and decided on full uniformity before the public
surface ossifies with more consumers. Honest counter-point recorded: the current split
(`X.create` = live instance, `defineX` = declarative spec) matches SOTA (Vercel AI SDK,
OpenAI Agents, LangChain all use `tool()`), and reverses locked Unbreakable Rule 9 (factory
functions canonical, ADR D431). The owner accepted this trade-off explicitly.

## Q2 — Dependencies (which milestones must be [x])?

**SE35** (and transitively all SE1–SE35, currently all `[x]`). The redesign renames the
**entire existing public surface**, so every prior SE slice that introduced a factory must be
shipped and frozen before the rename sweeps them. No new feature depends on this; it is a
cross-cutting rename of what already exists.

## Q3 — Definition of done

See SE36 DoD in `ROADMAP.md`. Summary: ADR reversing Rule 9 → new convention; every factory
converted to `X.create()` static method; old exports REMOVED from the barrel (hard break, no
aliases); `docs.md` + `README.md` + `CLAUDE.md` (Rule 9 + Locked names) updated; jscodeshift
codemod + migration guide; all `examples/**` migrated and re-verified against a real LLM
(OpenRouter); all tests migrated with per-symbol behavior-parity regression tests; major bump
to `@theokit/sdk@3.0.0` + Changeset + CHANGELOG `§ Removed`/`§ Changed`.

## Q4 — Top new risks

1. **Maximum blast radius.** Owner chose **hard break** (remove, don't alias) + **full scope**
   (including internal utilities → `Semaphore.create`, `TokenLimiter.create`). Every consumer
   import breaks at once with no grace window; a codemod bug strands users. Mitigation:
   exhaustive codemod test corpus; ship 3.0.0 only after the codemod round-trips the entire
   in-tree example suite.
2. **Ecosystem-idiom divergence.** Reverses a locked rule that matches every peer SDK's
   `tool()` idiom — new users may find `Tool.create` unfamiliar; utility factories forced into
   artificial namespaces (`Retry.create`) reduce ergonomic clarity. Mitigation: the ADR records
   the rationale (owner-driven uniformity) and the divergence explicitly; docs lead with the
   mental model.

## Decision record (owner, 2026-07-13)

- **Deprecation strategy:** Hard break — remove `define*`/`create*` in v3.0 (no deprecated aliases).
- **Scope:** Literally every `create*`/`define*` → `X.create` (including internal utility factories).
