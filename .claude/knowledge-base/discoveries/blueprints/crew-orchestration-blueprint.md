# Blueprint — Crew orchestration ergonomics (cross-val Gap 1, narrowed)

**Date:** 2026-06-15 · From crewAI cross-validation Gap 1 ("no first-class multi-agent orchestration (Crew/Process)").

## Finding (DISCOVER — corrects the cross-val finding, 3rd time a gap narrows)
The cross-val Gap 1 OVERSTATED the problem. theokit ALREADY has first-class multi-agent orchestration — just not packaged under a crewAI-style name:
- **Sequential team:** `Workflow.create().then(agentStep(a1,...)).then(agentStep(a2,...)).run(input)` threads each agent's output into the next. Documented in docs.md:2204. theokit Workflow ALSO has branch/parallel/foreach/dowhile — strictly MORE than crewAI's sequential/hierarchical.
- **Hierarchical delegation:** `subagents` (parent auto-delegates to children via the Agent tool) + `@theokit/sdk-handoff` (peer transfer) cover crewAI's manager→worker model.

crewAI reference: `Process` enum (sequential|hierarchical) + `Crew({agents, tasks, process})` in lib/crewai/src/crewai/{process.py, crew.py}.

## Genuine residual gap
NOT capability — it is **ergonomics/discoverability**: a developer arriving from crewAI looks for a "crew/team" primitive and must instead discover Workflow+agentStep. Building a new Crew *engine* would duplicate Workflow (DRY/KISS/YAGNI + "don't reinvent" violations).

## Decision (ADR-style)
- Ship a THIN convenience factory `createCrew({ agents, process: "sequential" })` that **composes** `Workflow` + `agentStep` under the hood — ZERO new orchestration logic (delegates everything to Workflow). Consistent with `createAgentFactory` (a composition LEGO, not a subsystem).
- Sequential is the MVP. `process: "hierarchical"` throws a guiding `ConfigurationError` pointing to subagents/handoff (already cover it) — no duplicate manager engine.
- Per the decorator mandate (feedback_decorators_mandatory): ship a `@theokit/di-agent` `Crew` decorator alongside the factory.

## Coverage corners
- Integration: createCrew builds a real Workflow and run() threads outputs a1->a2.
- Dependencies: none new (reuses Workflow + agentStep + ConfigurationError).
- Tools: n/a.
- Techniques: composition-over-reimplementation (DRY); fail-fast validation; decorator DX.

## References
- crewAI: `.claude/knowledge-base/reference/crewAI/lib/crewai/src/crewai/process.py` + `crew.py` (Process/Crew model — inspiration)
- In-repo engine to reuse: `packages/sdk/src/workflow.ts` (`Workflow`, `agentStep`)
- In-repo delegation (hierarchical already covered): `packages/sdk-handoff/src`, subagents
- Decorator pattern: `packages/di-agent/src/decorators/sub-agent.ts`
