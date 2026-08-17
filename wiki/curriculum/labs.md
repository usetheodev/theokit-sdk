---
type: Curriculum
title: Labs
description: Every lab from the 12 modules, with its objective, duration, and the concept it exercises.
tags: [curriculum, labs, practice, exercises]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), per-module Labs sections, absorbed into this bundle 2026-08-06
    title: Agent AI course — labs for Modules 1 to 12
    author: human:paulohenriquevn
    last_modified: 2026-07-30
---

# Fundamentals

**1.1 — Classification** (20 min, no code). For each system, classify it (call / chain /
workflow / routed workflow / agent) and justify in one sentence: (1) a form-field translator;
(2) "summarize this PR and post the summary" — always those two steps; (3) "investigate why
the build broke" — the system decides which logs to read; (4) support that classifies a ticket
and routes it to one of five queues; (5) "refactor this module until the tests pass".
*Answers: 1-call, 2-chain, 3-agent, 4-routed workflow, 5-agent (with an implicit evaluator: the
tests).* → [what is an agent](/concepts/what-is-an-agent.md)

**1.2 — The minimal agent, no framework** (40 min). Before using the SDK, write the loop by
hand against your provider's HTTP API. You need: a `while`, a message list, a tool schema, a
dispatch `switch`, and an iteration ceiling. **Do not skip this** — understanding the loop
before abstracting it is the difference between debugging in 10 minutes and in 2 days. →
[the agent loop](/concepts/agent-loop.md)

**2.0 — Three cadences, one problem** (90 min). Take one task ("fix the failing tests") and
implement all three cadences: turn-based (`send` + `wait`, you decide to continue), mechanical
continuation (`runToCompletion`), and closed (`runUntil` with a criterion + `tokenBudget`).
Compare total cost, wall-clock time, and how many times **you** had to intervene. Write which
one you would ship and why. → [control cadence](/concepts/control-cadence.md)

**2.1 — Instrument the loop** (30 min). Run an agent with one tool and count iterations,
tokens per iteration and cumulative cost. Plot or tabulate tokens per iteration. The objective
is **seeing the growth with your own eyes**. → [the agent loop](/concepts/agent-loop.md)

**2.2 — Provoke every terminal** (60 min). Write five runs that deliberately end in `done`,
iteration ceiling, doom loop, cancellation, and tool error. Print the complete `RunResult` for
each. → [loop terminals](/concepts/loop-terminals.md)

**2.3 — Toxic tool** (20 min). Create a tool that returns 20 KB of text. Measure the cost of a
4-iteration run with and without it. Write the conclusion in one sentence. →
[context engineering](/concepts/context-engineering.md)

**2.4 — HITL with a tool gate** (90 min). Implement Seam A: a `PermissionEngine` with `ask` on
`issue_refund`, and a `canUseTool` that auto-approves up to R$ 500 and asks above it. Expose an
SSE endpoint and a page with Approve and Deny plus a reason field. Prove three things: (a) the
`deny` reaches the model as an observation and changes the reply to the customer; (b) the
timeout **denies**; (c) removing `canUseTool` makes the `ask` block on its own (fail-closed). →
[human in the loop](/concepts/human-in-the-loop.md)

**2.5 — Durable HITL and the test that separates the seams** (90 min). Implement Seam B with
`ctx.suspend` + `Workflow.resume`, persisting `runId` in a table. Then the decisive test:
**kill the process between suspension and approval**, bring it back up, and resume by `runId`.
Repeat the same test against Lab 2.4 and document what happens. That pair of results is the
justification you will use in an ADR when someone proposes a tool gate for a compliance
approval. → [durability boundary](/concepts/durability-boundary.md)

**3.1 — Explicit budget** (40 min). Write `planContext(sources, budget)` taking sources with a
priority and a size, returning what enters, what is summarized and what is cut. Test it
**without an LLM**. This is the kind of code that survives any framework change. →
[context engineering](/concepts/context-engineering.md)

**3.2 — Compaction with the primitives** (60 min). Using `estimateTokens` + `shouldCompact` +
`compactTranscript`, implement a policy that keeps 6 recent turns and summarizes the rest.
Write 4 unit tests: below the limit, exactly at it, above it, and an empty history (boundary
plus negative case).

**3.3 — Context A/B** (60 min). Same agent, same question, two context policies (everything vs
curated). Compare quality, tokens and cost. Record the result — it is the embryo of your eval.

# The SDK in practice

**4.1 — Chat CLI** (60 min). A REPL that keeps one agent alive across turns, streams tokens via
`onDelta`, prints cumulative cost per turn, and calls `dispose()` on `SIGINT`. →
[agent, run and SDKMessage](/sdk/agent-run-sdkmessage.md)

**4.2 — Three channels** (45 min). In the same run, log `SDKMessage` to `stream.log`,
`InteractionUpdate` to `deltas.log` and `RunEvent` to `events.log`. Compare the three files and
write a paragraph on which you would use for: UI, a rate-limit alert, and an audit. →
[observation channels](/sdk/observation-channels.md)

**4.3 — Cancellation** (30 min). Start a long run, cancel after 2 s, and prove that
`status === "cancelled"` and that **cancellation is not an error** — your alert must not fire.

**5.1 — ACI refactor** (60 min). Give the agent a deliberately bad tool (`do_stuff`, no trigger
description, error message `"error"`). Measure the hit rate over 10 runs. Refactor the name,
the description, the field `.describe()`s and the error messages. Measure again. **Record both
numbers** — that is your first eval datum. → [tools and ACI](/sdk/tools-and-aci.md)

**5.2 — Model/app split** (45 min). Implement `fetch_order` with `outputSchema` +
`toModelOutput`. Prove with `onToolEnd` that the app received the full object while the model
received the compact line.

**5.3 — Containment** (45 min). A tool that sleeps 30 s: show that without `perToolTimeoutMs`
the run stalls, and with it the model receives a typed timeout result and carries on.

**5.4 — Indirect injection** (45 min). A tool that returns text containing a hostile
instruction. Run with and without `toolResultGuard: { delimit: true }`. Document what you
observed — **including if the model resisted both times; a negative result is data too**. →
[attack surface](/concepts/attack-surface.md)

**6.1 — Deliberate downgrade** (60 min). Take an agent that does 3 fixed steps and rewrite it
as a `Workflow`. Compare tokens, latency and variance over 5 runs. Write the conclusion. →
[determinism ladder](/concepts/determinism-ladder.md)

**6.2 — Suspend/resume** (60 min). A workflow that suspends waiting for human approval,
persists, and resumes via `Workflow.resume`. **Kill the process between the two phases** and
prove it resumed. → [workflow](/sdk/workflow.md)

**6.3 — Context isolation** (45 min). The same heavy task with and without a subagent. Compare
the **parent's** tokens. That is where the gain appears. →
[squad and subagents](/sdk/squad-and-subagents.md)

**6.4 — `workflowAsTool`** (45 min). Expose a deterministic refund workflow as a tool of a
support agent. Explain in writing why the refund policy must not live in the prompt.

**7.1 — Failure matrix** (90 min). Provoke all six classes and write a handler that does the
right thing in each. This lab is the skeleton of a production agent. →
[failure taxonomy](/sdk/failure-taxonomy.md)

**7.2 — Permission suite** (60 min). Write ≥ 12 unit tests for `PermissionEngine`: positive,
**negative**, and boundary cases (empty list, `deny` under `bypass`, unmatched under each
mode). Zero LLM. Must run in milliseconds. → [permissions](/sdk/permissions.md)

**7.3 — Red team** (90 min). Attack your own agent along all six vectors. Document what got
through. **A vector that got through is a finding — record it with evidence.**

**7.4 — Cost containment** (45 min). An agent with a tool that always fails. Prove the doom
loop guard stops it, and compare the cost with the guard off (`doomLoop: false`). →
[doom loop](/concepts/doom-loop.md)

**8.1 — Persistent multi-turn** (45 min). Record a fact, kill the process, resume with
`Agent.resume` and prove recall. Inspect the `.jsonl` and describe its structure. →
[state, sessions and memory](/sdk/state-sessions-memory.md)

**8.2 — Claude Code interop** (30 min). Run with `sessionDir: "~/.claude"` and continue the
conversation in the Claude Code CLI. Without the CLI, inspect the file and explain why the
format permits the continuation.

**8.3 — `SessionStore`** (90 min). Implement a `SessionStore` over SQLite or Postgres. Prove
resumption on "another host" (another process, a different directory).

**8.4 — Memory policy** (60 min). Write your agent's write / correction / expiry rules and
implement the write rule. Justify each one.

# Landscape

**9.1 — The same agent, twice** (3 h). Implement the same tool-using agent here and in
LangGraph (or CrewAI). Compare: lines of code, what the compiler caught, difficulty of
debugging a bad iteration, and what survives a `kill -9` mid-run. →
[framework comparison](/ecosystem/framework-comparison.md)

**9.2 — Decision matrix** (60 min). Write the matrix for **your** real project with the 6 axes,
justified weights and a recommendation. If the recommendation is not this SDK, the lab is
correct — the honesty is the deliverable.

**9.3 — Portability test** (90 min). Refactor one of your agents to isolate the framework
behind a domain interface. Measure how many files would import the new framework in a
migration. Target: 1. → [governance](/operations/governance.md)

# Staff level

**10.1 — An honest dataset** (90 min). 30 cases: 15 happy path, 10 **negative** (invalid or
hostile input, expecting a typed error), 5 boundary. The edge-vs-negative distinction comes
from the project testing rule — respect it. → [evaluation](/operations/evaluation.md)

**10.2 — CI gate** (60 min). `assertEval` in a CI workflow. Prove that a prompt regression
fails the build.

**10.3 — Judge calibration** (2 h). Label 30 outputs by hand. Run `llmJudge`. Measure the
agreement. If < 80%, improve the rubric and repeat. **Report the number honestly.**

**10.4 — Wide base** (90 min). Write 20 unit tests with no LLM over parts of your agent.
Measure total suite time. Target: < 2 s.

**11.1 — Dashboard** (2 h). Export spans and build a panel with runs/min, p50/p95 latency,
cost/run, error rate per tool, and doom-loop count. → [observability](/operations/observability.md)

**11.2 — Resumable batch** (90 min). Process 100 items with concurrency 8; kill the process at
~40%; resume and prove zero reprocessing. →
[concurrency and scheduling](/operations/concurrency-and-scheduling.md)

**11.3 — Cost ceiling** (60 min). Implement a per-tenant budget that blocks `send` via
`onBeforeSend` when exceeded. Test the blocking path. →
[cost management](/operations/cost-management.md)

**11.4 — Runbook** (60 min). Write your agent's runbook: 5 symptoms, with a diagnosis and an
action for each.

**12.1 — ADR under attack** (2 h). Write an ADR for a real decision about your agent. Ask a
colleague to attack it. Revise. The final version must survive "what was the second-best
option?". → [architecture decisions](/operations/architecture-decisions.md)

**12.2 — Gap register** (90 min). Write **your** system's missing-capability register, with a
layer classification. Include at least one item marked "not our layer" with a justification. →
[the layer question](/operations/layer-question.md)

**12.3 — Boundary audit** (90 min). Count the files in your project that import the
orchestration framework. If > 3, refactor. Report before and after.

**12.4 — The deprecation argument** (60 min). Pick an agent or feature from your backlog and
write the case **against** building it. If the case is convincing, you have just delivered the
course's greatest value. → [parsimony ladder](/concepts/parsimony-ladder.md)

# Then

[Capstone](/curriculum/capstone.md) — the graded final project.[^course]

[^course]: Agent AI course, per-module Labs
