# Concepts

Framework-agnostic fundamentals. This is the ~70% of the work that transfers when you change
stacks — the part worth investing in, per
[framework comparison](../ecosystem/framework-comparison.md) § migration cost.

# Foundations

* [What is an agent](what-is-an-agent.md) - The minimal definition and the four mandatory components.
* [Agentic patterns](agentic-patterns.md) - Tool use, reflection, planning, routing and the rest, with their costs.
* [Glossary](glossary.md) - What the recurring terms mean, in one place.

# The loop

* [The agent loop](agent-loop.md) - The canonical iteration and where cost actually lives.
* [Loop terminals](loop-terminals.md) - The seven ways a run ends and what each demands of the caller.
* [Doom loop](doom-loop.md) - The no-progress terminal, distinct from needing more iterations.
* [Control cadence](control-cadence.md) - Who authorizes the next cycle.
* [Human in the loop](human-in-the-loop.md) - The two HITL seams and the durability difference between them.

# Design axes

* [Context engineering](context-engineering.md) - The window as a budgeted scarce resource.
* [Determinism ladder](determinism-ladder.md) - Climb one rung at a time, with justification.
* [Durability boundary](durability-boundary.md) - What survives a crash here, and what does not.
* [Parsimony ladder](parsimony-ladder.md) - Stop at the first rung that resolves the need.

# Review aids

* [Attack surface](attack-surface.md) - The six vectors and where each is contained.
* [Pitfalls](pitfalls.md) - The recurring traps, each paired with its antidote.
