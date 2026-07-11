# ADR 0013 — SE34: per-send `isTaskComplete` + `<current-objective>` projection; defer the in-agentic-loop goal step

**Status:** Accepted (2026-07-11)
**Context slice:** SDK Evolution roadmap SE34 (Mastra Goals comparison, 2026-07-11).

## Context

Mastra's Goals evaluate the objective as an **in-agentic-loop step** — inside the tool-calling loop, once per iteration, right after a per-send `isTaskComplete` check — and project the standing objective into the model context as `<current-objective>`. SE34 proposed three additions on top of SE33's durable objective:

- **(a) `isTaskComplete` per-send** — a single-`send()` completion gate (finer than `runUntil`, which judges BETWEEN sends).
- **(b) `<current-objective>` projection** — inject the standing objective into the model context each turn.
- **(c) in-agentic-loop goal step** — score the durable objective ONCE PER tool-loop iteration, gating continuation.

The roadmap flagged (c) as the "MORE INVASIVE slice — it touches the agentic loop", **ADR-REQUIRED**, and demand-gated: *"If demand is thin, SE34 ships ONLY `isTaskComplete` + the projection and defers the in-loop step."*

## Decision

**SHIP (a) + (b). DEFER (c).**

### Shipped — (a) `SendOptions.completionCheck` (`isTaskComplete`)

- `SendOptions.completionCheck?: { criteria; judgeModel?; apiKey? }`. After a `send()` reaches terminal `finished`, the shipped LLM-as-judge (`judgeCallImpl`) scores the final reply against `criteria`.
- The verdict surfaces on `RunResult.completionCheck` (`{ complete, reason, parseFailed }`) AND a typed `completion_check` run-event (distinct from the existing `task_completed` subagent-lifecycle event).
- Non-invasive: implemented as an OUTERMOST run wrapper (`wrapRunWithCompletionCheck`) — only judges when `completionCheck` is set, only a `finished` run with text, memoized (judge fires EXACTLY once), Proxy preserves every other Run member. Absent ⇒ byte-identical. Fail-safe: a judge parse failure yields `complete: false` (never a silent "done").

### Shipped — (b) `<current-objective>` projection (minimal, opt-in)

- `SendOptions.objectiveThreadId?: string`. When set, the send reads the SE33 durable objective for that thread and, if it is `active`, prepends a `<current-objective>…</current-objective>` block to the assembled system prompt for THIS send.
- Minimal by design (G11/YAGNI): a single string signal prepended in `executeSendLocked`, reusing the SE33 objective store — NOT a general "signal-provider" framework (the roadmap explicitly banned that). Opt-in — absent ⇒ the assembled prompt is byte-identical. Only an `active` objective projects (`done`/`paused` ⇒ nothing). Fail-soft — a storage read error never breaks the send (best-effort context, not correctness).

### Deferred — (c) in-agentic-loop goal step

Deferred behind a NAMED re-evaluation trigger. **Both conditions required to reopen:**

1. A shipped TheoKit/SDK app sets an SE33 durable objective end-to-end AND drives it across tool-loop iterations, AND
2. That app reports concrete pain that BETWEEN-send / per-send evaluation (`runUntil` + `completionCheck`) is too coarse — it needs the objective scored INSIDE the loop, once per iteration.

Rationale for deferral:

- **Loop surgery is the highest-scrutiny change.** Scoring the objective once per tool-loop iteration modifies the shipped agent loop (`internal/agent-loop/`) and adds an extra judge call per iteration — real token spend. The roadmap gates this on demand for exactly this reason.
- **No consumer yet.** SE33's durable objective shipped the SAME release; between-send granularity (`runUntil` reading the durable objective) + the per-send `completionCheck` + the `<current-objective>` projection already cover "evaluate against the objective" and "the model sees the objective". The in-loop step is only justified once a real workload shows the coarser granularity is insufficient — otherwise its cost/complexity is speculative.

When the trigger fires, (c) lands via its own follow-up ADR with a measured cost/benefit and the same no-op gating Mastra uses (skip on background-task / mid-tool-loop / working-memory-only iterations).

## Consequences

- SE34 ships the two non-invasive, self-contained halves; the shipped agent loop is UNTOUCHED (invariant preserved: loop surgery is not made speculatively).
- `completionCheck` gives a single-`send()` completion gate with a typed result + event; `objectiveThreadId` makes the model always see the standing objective — both opt-in, both byte-identical when unused.

## Alternatives rejected

- **Ship (c) in-loop step behind a flag.** Rejected — loop-touching + undemanded + an extra judge call per iteration; the roadmap gates it on demand. Shipping it now is a speculative modification of the most sensitive code path (mirrors M38's decision to ship evidence + ADR over an unneeded loop change).
- **Build (b) as a general signal-provider framework (Mastra-style).** Rejected — the roadmap explicitly banned it (G11/YAGNI). A single prepended `<current-objective>` signal covers the need.
- **Reuse the existing `task_completed` event for (a).** Rejected — that event is background-task/subagent lifecycle; a distinct `completion_check` event avoids conflating two unrelated signals.
