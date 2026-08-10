---
type: Decision Guide
title: Parsimony ladder
description: A pre-write deliberation — stop at the first rung that resolves the need — plus the five things the ladder may never be used to skip.
tags: [engineering-practice, yagni, kiss, code-review]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 12.3, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 12.3 — the parsimony ladder
    author: human:paulohenriquevn
    last_modified: 2026-07-30
  - id: rule
    resource: .claude/rules/parsimony-ladder.md
    title: Project rule — the canonical ladder, enforced in the GREEN phase
---

# The ladder

Before writing any code, walk down and stop at the first rung that resolves the need:

1. **Does this need to exist?** → no: do not write it (YAGNI)
2. **Does the standard library do it?** → use it
3. **Is there a native platform feature?** → use it
4. **Is a dependency already installed?** → reuse it; do not add a redundant one
5. **Does it fit in one line?** → one line
6. **Only then:** the minimum that works

It is a **deliberation, not a detector** — it runs at the moment of writing, which is what
makes it different from the dead-code and scope-creep checks that run afterward.

# Never on the chopping block

The ladder eliminates **unnecessary complexity**, never **necessary correctness**. These are
not "code you can avoid writing", and a parsimony argument must never be used to skip them:

- [ ] **Tests** — a failing test comes before the code, always
- [ ] **Input validation** at trust boundaries
- [ ] **Error handling** — fail fast, explicit, typed
- [ ] **Security** — auth, secret handling, injection defense
- [ ] **Accessibility** — where there is a human-facing surface

Using parsimony to justify skipping a test is not economy; it is debt with interest. If
applying a rung would weaken any of the five, the rung does not apply — say so out loud
rather than shipping a quiet shortcut.

# Applied to agents

Rung 1 eliminates more cost than any optimization further down the stack. Concretely: half
the "agents" proposed in backlogs should not exist, and the other half should be workflows —
which is [the determinism ladder](/concepts/determinism-ladder.md) restating rung 1 for
orchestration.

Rung 4 has an agent-specific reading too: before writing a tool, check whether an MCP server
already exposes it. See [MCP integration](/sdk/mcp-integration.md).

# Where it shows up in a decision

The strongest use of the ladder is not in code — it is in
[architecture decisions](/operations/architecture-decisions.md), where "we considered not
building this" is a legitimate rejected alternative, and in the deprecation argument: choose
something from your backlog and write the case **against** building it. If the case is
convincing, that is the highest-value output the exercise can produce.[^course]

[^course]: Agent AI course, Module 12.3
[^rule]: `.claude/rules/parsimony-ladder.md`
