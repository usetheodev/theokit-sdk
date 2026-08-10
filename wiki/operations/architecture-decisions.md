---
type: Practice
title: Architecture decisions
description: The five parts of an ADR that survives hostile review, the one question that exposes a preference dressed as a decision, and buy-vs-build for agent systems.
tags: [architecture, adr, decision, buy-vs-build, leadership]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 12.2 and 12.4, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 12 — ADR and buy vs build
    author: human:paulohenriquevn
    last_modified: 2026-07-30
---

# An ADR that survives hostile review

A weak ADR lists one option and calls it a decision. A strong one has five parts:

1. **Context** — the force that requires a decision *now*, not general history.
2. **Alternatives considered** — at least two real ones, each with the reason it was
   rejected. *An ADR without alternatives is a decision without analysis* — in this project's
   rule set that alone caps a proposal's score.
3. **Decision** — what was chosen.
4. **Consequences** — including the **bad** ones. Every decision has a cost; an ADR that
   lists only benefits is incomplete.
5. **Reversibility** — what it costs to undo, and what signal would tell you to.

# The seniority reflex

When someone proposes an architecture, ask:

> **"What was the second-best option, and why did it lose?"**

If there is no answer, there was no decision — there was a preference.

# A worked template in this bundle

[MCP integration](/sdk/mcp-integration.md) § the `mcpLifecycle` trade-off is the shape done
right: measured cost on one side (~134–193 ms of handshake per turn), a new failure mode on
the other (a server that dies mid-session), and the default placed on the safe side. Copy
that structure — a number, a named risk, and a stated default.

# Buy vs build in Agent AI

| Component | Default | Why |
| --- | --- | --- |
| LLM client / retry | **buy** | solved; reimplementing is debt |
| Agent loop | **buy** | the edges are many — doom loop, ceiling, truncation |
| Tools for your domain | **build** | it is your differentiator |
| Prompt / context | **build** | it is your differentiator |
| Eval / dataset | **build** | nobody knows your domain |
| Vector memory | buy (adapter) | commodity |
| Observability | buy | commodity |
| Durable orchestration | **decide by axis** | see [framework comparison](/ecosystem/framework-comparison.md) |

> **Rule: buy the mechanism, build the policy.** Loop, retry and streaming are mechanism.
> Which tools exist, what is permitted, and what counts as good are policy — and policy is
> where your product lives.

The same split appears concretely in [guardrails](/sdk/guardrails.md): the SDK ships the seam,
you choose the classifier and own the rule.

# The decision that produces the most value

Choose an agent or feature from your backlog and write the case **against** building it. If
the case is convincing, that is the highest-value output the exercise can produce — and it is
[parsimony ladder](/concepts/parsimony-ladder.md) rung 1 applied at the level of a roadmap
rather than a function.

Before any of this, ask [the layer question](/operations/layer-question.md): a build-vs-buy
debate about something that is not your layer is a debate worth skipping.[^course]

[^course]: Agent AI course, Module 12
