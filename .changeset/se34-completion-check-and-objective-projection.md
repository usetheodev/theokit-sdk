---
"@theokit/sdk": minor
---

**SE34 — per-send `isTaskComplete` + `<current-objective>` projection (a peer framework Goals parity, non-invasive half).**

Two opt-in `SendOptions`, both byte-identical to today when unused. The loop-touching in-agentic-loop goal step is DEFERRED with a named re-eval trigger (ADR 0013).

- **`completionCheck` (`isTaskComplete`)** — `send(msg, { completionCheck: { criteria, judgeModel?, apiKey? } })`. After the send reaches terminal `finished`, the shipped LLM-as-judge scores the final reply against `criteria`; the verdict surfaces on `RunResult.completionCheck` (`{ complete, reason, parseFailed }`) AND a typed `completion_check` run-event. This is the finer-grained, single-`send()` completion gate (contrast `runUntil`, which judges BETWEEN sends). Implemented as an outermost run wrapper — only judges a `finished` run with text, memoized (the judge fires exactly once), fail-safe (a judge parse failure yields `complete: false`, never a silent "done").
- **`objectiveThreadId` (`<current-objective>` projection)** — `send(msg, { objectiveThreadId })` reads the SE33 durable objective for that thread and, when it is `active`, prepends a `<current-objective>…</current-objective>` block to the assembled system prompt for that send, so the model always sees what it is working toward. Minimal + fail-soft (a storage read error never breaks the send) — not a general signal-provider framework.

Both reuse shipped seams (the run-wrapping seam + `judgeCallImpl` for the check; the SE33 objective store + system-prompt assembly for the projection). The agent tool-calling loop is UNTOUCHED. From the a peer framework Goals comparison (SDK Evolution roadmap SE34).
