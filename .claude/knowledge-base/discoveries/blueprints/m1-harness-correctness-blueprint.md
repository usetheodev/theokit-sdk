# Blueprint: M1 Harness Correctness Core — Fix Approaches

> **Version 1.0** — Synthesizes the CORRECT FIX APPROACH for the 4 M1 correctness defects
> (#58 abort-doesn't-interrupt-tools + no per-tool timeout + JobQueue cancel/concurrency; #55
> permission gates on tool-NAME-only + fail-OPEN default; #65 7/10 plugin hooks are silent no-ops
> + no ToolContext; #57 no content-level prompt-injection/PII defense on tool results) from peer
> implementations (opencode, codex, adk-js, mastra, crewAI) plus our own loci. **Headline:** the 7
> dead hooks each have a natural invocation site in our loop, and `transform_tool_result` is the
> exact seam for #57 — so #65 and #57 compose into one pipeline fix. Informs `/to-plan M1`.

**Slug:** `m1-harness-correctness`
**Source plan:** `.claude/knowledge-base/discoveries/plans/m1-harness-correctness-plan.md`
**Owner:** paulohenriquevn
**Generated:** 2026-07-02 via `/discover-execute` (inline per-iteration contract — nested ralph-loop skipped to avoid concurrency with the active `/goal` Stop hook, per `loop-engine-convention § Anti-patterns`)
**Confidence verdict:** SHIPPABLE (99.2 — /discover-confidence 2026-07-02; coverage 100 / citations 100 / completeness 100 / structural 95; zero hard caps)

## Context

M1 is the Harness correctness core: eliminate surfaces that exist but silently do nothing. Grounding
reads (2026-07-02, post-M0) confirmed all four defects. This blueprint captures the transferable fix
model per defect (peer precedent + our exact fix site) so `/to-plan M1` writes a TDD-first plan with
no reinvention (Rule 9) and no guesswork.

## Objective

Let `/to-plan M1` decide the exact fix shape for #55/#57/#58/#65, each grounded in peer evidence and
our pinned fix site.

---

## Coverage Corner 1 — Integration Tests

How peers assert the correctness behaviors our fixes must protect.

### codex — argument-level permission deny (Rust)

- `reference/codex/codex-rs/execpolicy/tests/basic.rs:170` — asserts a forbidden command
  (`rm -rf …`) evaluates to `Decision::Forbidden` with a `PrefixRuleMatch` — i.e. the DENY is
  asserted on the full command tokens, not just a name. **Our #55 test mirror:** a rule denying
  `shell` with args matching `rm -rf` must block; the same tool with `ls` must pass.
- `reference/codex/codex-rs/execpolicy/tests/basic.rs:648` — when no rule matches, a
  `HeuristicsRuleMatch` carries the default decision from the caller-supplied callback — the default
  posture is explicit and testable.

### adk-js — every callback fires (no dead hook) (TS)

- `reference/adk-js/core/test/plugins/plugin_manager_test.ts:24` — a `TestPlugin` pushes each
  callback name into a `callLog`; `:218` asserts `callLog` contains the expected callback and in
  order. **Our #65 test mirror:** for EACH newly-wired hook, a plugin registered on it MUST be
  invoked (assert the handler ran) — the anti-dead-hook proof.

**Transferable test model:** assert the *effect* — the denied command did not execute; the aborted
tool handler stopped; each wired hook's handler was invoked; the scrubbed tool-result no longer
contains the injected marker. Negative-case discipline per `rules/testing.md §4.1`.

---

## Coverage Corner 2 — Dependencies

### Abort / timeout / queue — stdlib is sufficient (Q5, #58)

Peers implement cancellation, timeout and concurrency with **Node stdlib only** — no `p-queue`/`p-timeout`:

| Peer | Mechanism | Citation |
|---|---|---|
| mastra | `AbortSignal.timeout(ms)` for per-op deadline | `reference/mastra/packages/core/src/a2a/a2a-agent.ts:1517` |
| mastra | `AbortSignal.timeout(3_000)` passed to fetch | `reference/mastra/packages/core/src/channels/inline-media.ts:80` |
| opencode | fixed N-worker pool pulling from a shared pending array (concurrency bound) | `reference/opencode/packages/opencode/src/util/queue.ts:21` |
| opencode | `abort: options.abortSignal` handed to the tool exec context | `reference/opencode/packages/opencode/src/session/tools.ts:40` |

**Decision (parsimony ladder rung 2, EC-2):** #58 uses Node stdlib — `AbortController` (per-job
abort in JobQueue), `AbortSignal.timeout(ms)` (per-tool timeout, Node ≥22.12), a semaphore/worker
counter (concurrency bound) or `AbortSignal.any([...])` to merge run-signal + timeout. **No new dependency.**

---

## Coverage Corner 3 — Tools

**ADR-deferred (D3 + `<!-- DEFER-CORNER: tools -->`).** The four fixes introduce no new build/test/CI
tooling — existing Vitest/tsup/tsc/Biome. The parsimony check is covered by Corner 2 (stdlib before dep).

---

## Coverage Corner 4 — Techniques

### T1 — AbortSignal→tools + per-tool timeout + JobQueue (#58)

| Source | Approach | Citation |
|---|---|---|
| opencode | tool exec receives `abortSignal` on its context; a fixed worker pool bounds concurrency | `reference/opencode/packages/opencode/src/session/tools.ts:40`, `.../util/queue.ts:21` |
| mastra | bridges an external signal to an internal `AbortController` (`AbortSignal.any`-style) so either source aborts; `AbortSignal.timeout` for deadlines | `reference/mastra/packages/core/src/a2a/a2a-agent.ts:1517` |
| **OUR fix sites** | `runToolWithLifecycle` gets no signal/timeout; `JobQueue.cancel` sets status only; no concurrency bound; `loop` has no between-iteration abort check | `packages/sdk/src/internal/agent-loop/tool-dispatch.ts:250`, `packages/sdk/src/job-queue.ts` (`cancel`/`enqueue`), `packages/sdk/src/internal/agent-loop/loop.ts` |

**Fix model:** (a) thread `inputs.signal` into `runToolWithLifecycle` → tool handler, and wrap each
tool call in `AbortSignal.timeout(perToolTimeoutMs)` merged with the run signal via
`AbortSignal.any([runSignal, timeoutSignal])`; reject aborted handlers with a typed error. (b) add a
between-iteration `signal.aborted` check in `loop.ts`. (c) `JobQueue`: store an `AbortController` per
job and call `.abort()` in `cancel()`; add a `maxConcurrency` bound (worker-count semaphore, opencode
pattern). All stdlib.

### T2 — Argument/command permission gating + fail-closed default (#55)

codex's execpolicy is the reference (`reference/codex/codex-rs/execpolicy/src/rule.rs:40,214`):

- **Rule matches the full command tokens**, not just the program: `PrefixPattern { first, rest }`
  matches `cmd[0] == first && rest[i] matches cmd[i+1]` — argument-level gating.
- **Default posture is explicit + caller-supplied** (`reference/codex/codex-rs/execpolicy/src/execpolicycheck.rs:60`): no
  match → the caller's default decision (fail-closed = deny/prompt, fail-open = allow).

**OUR fix site:** `packages/sdk/src/permission-engine.ts:38` `evaluate(toolName)` (name only) + `:31`
`defaultAction = "allow"` (fail-open) + `:11` `PermissionRule { tool, action }` (no args).

**Fix model:** extend `PermissionRule` with an optional `args?` matcher
(`Record<string, string | RegExp | (v) => boolean>`), change `evaluate(toolName, args?)` to match on
args when present (a rule with `args` matches only when the tool name AND every arg predicate match),
and flip the default to **fail-closed** (`"deny"` or `"ask"`) OR add an explicit dangerous-op gate —
a backward-compat-aware ADR decides which (public API — `permission-engine.ts` is exported).

### T3 — Wire the 7 dead hooks + ToolContext + tool-result transform seam (#65 + #57)

adk-js callback surface (`reference/adk-js/core/src/plugins/base_plugin.ts:70`): before/after
tool+model callbacks, first non-undefined return short-circuits. ToolContext capabilities
(`reference/adk-js/core/src/agents/context.ts:123` `requestCredential`, `:184` `requestConfirmation`,
`:35` `abortSignal`). crewAI guardrail-with-retry (`reference/crewAI/lib/crewai/src/crewai/task.py:246`)
for #57's validation loop.

**Per-hook wiring table (OUR code — wire-or-remove, EC-1):**

| Hook | Wired? | Intended invocation site (OUR code) | Action |
|---|---|---|---|
| `pre_tool_call` | ✓ | `tool-dispatch.ts` `vetoFromPluginPreHook` | working |
| `pre_user_send` | ✓ | `loop-context-init.ts` | working |
| `post_assistant_reply` | ✓ | `loop.ts` | working |
| **post_tool_call** | ✗ | after `dispatchSingleCall` finalizes (`tool-dispatch.ts:98`) | WIRE `runPostToolCallHooks` |
| **pre_llm_call** | ✗ | before the LLM stream (`loop-llm-stream.ts` ~`:63`) | WIRE `runPreLlmCallHooks` |
| **post_llm_call** | ✗ | after LLM events collected (`loop-llm-stream.ts` ~`:87`) | WIRE `runPostLlmCallHooks` |
| **on_session_start** | ✗ | after `initLoopContext` (`loop.ts` init) | WIRE `runOnSessionStartHooks` |
| **on_session_end** | ✗ | loop finally block (`loop.ts` end) | WIRE `runOnSessionEndHooks` |
| **transform_tool_result** | ✗ | after `dispatchTools`, before results pushed to messages (`loop.ts`) | WIRE `runTransformToolResultHooks` — **also the #57 seam** |
| **transform_llm_output** | ✗ | after the LLM stream, before continue/terminate (`loop.ts`) | WIRE `runTransformLlmOutputHooks` |

**Fix model:** add the missing `run*Hooks` methods to `PluginManager` (mirroring the existing 3) and
invoke each at its pinned site. Transform hooks return a possibly-modified payload (fold over plugins,
last-wins or first-non-undefined per the pre_tool_call precedent). A `ToolContext` 2nd handler arg
(carrying `signal` + optional `requestConfirmation`/`requestCredential`) is the adk-grounded capability
surface — **scope note:** the full confirmation/credential round-trip may be a follow-up; M1 must at
minimum thread `signal` (ties into #58) and wire the hooks.

### T4 — Content-level tool-result defense (#57)

crewAI's guardrail-with-retry (`reference/crewAI/lib/crewai/src/crewai/task.py:246`) validates output
and re-runs on failure. For tool RESULTS specifically, peers are thin (the cross-val flagged this as a
gap even in mastra). **Honest partial (EC-4):** the core technique — delimiting/spotlighting tool
results (wrap untrusted tool output in explicit boundaries so the model treats it as data, not
instructions) + PII regex redaction — is partly external best-practice. Its **seam is
`transform_tool_result`** (#65), so #57 is implemented as a built-in transform hook that runs before
tool results reach the LLM, not a bolt-on.

## Cross-cutting Comparison

| Dimension | opencode | codex | adk-js | mastra | crewAI |
|---|---|---|---|---|---|
| Abort→tool | `abortSignal` on tool ctx `session/tools.ts:40` | — | ToolContext.abortSignal `context.ts:35` | signal-bridge `a2a-agent.ts:1517` | — |
| Concurrency bound | worker pool `util/queue.ts:21` | — | — | — | — |
| Arg permission | — | `PrefixPattern` `rule.rs:40` | — | — | — |
| Callback wiring | — | — | before/after `base_plugin.ts:70` | — | — |
| Output guardrail | — | — | — | — | retry loop `task.py:246` |
| Stdlib timeout | — | — | — | `AbortSignal.timeout` `a2a-agent.ts:1517` | — |

## ADRs

### D1 — #58: thread AbortSignal + per-tool timeout into tool dispatch; fix JobQueue cancel + concurrency

**Decision:** Thread `inputs.signal` into `runToolWithLifecycle` → tool handler; wrap each tool in
`AbortSignal.any([runSignal, AbortSignal.timeout(perToolTimeoutMs)])`; add a between-iteration
`signal.aborted` check in `loop.ts`. In `JobQueue`, store an `AbortController` per job (`.abort()` on
`cancel`) and add a `maxConcurrency` semaphore.

**Rationale:** opencode/mastra prove the stdlib model (signal on ctx + worker-pool bound +
`AbortSignal.timeout`); Node ≥22.12 has all primitives (parsimony rung 2). Cancel that doesn't
interrupt + unbounded queue are silent correctness bugs (`no-stubs-no-mocks-no-wired`).

**Alternatives considered:** (a) `p-queue`/`p-timeout` deps — rejected (parsimony, stdlib suffices).
(b) leave JobQueue status-only cancel — rejected (the cancel is a lie). (c) global (not per-tool)
timeout — rejected (a single hung tool must not need the whole run aborted).

**Consequences:** cancel actually interrupts; a hung tool times out with a typed error; the queue is
bounded. Regression tests: aborted handler stops; per-tool timeout rejects typed; `cancel` aborts a
running job; N+1th enqueue waits.

### D2 — #55: argument-level permission gating + fail-closed default

**Decision:** Extend `PermissionRule` with optional `args?` matcher; `evaluate(toolName, args?)` gates
on args when the rule declares them; flip the default posture to fail-closed (`"deny"`/`"ask"`) via an
explicit opt (backward-compat handled by the ADR — likely a new `defaultAction` default with a
migration note, since `permission-engine.ts` is public API).

**Rationale:** codex's execpolicy proves arg-level gating (`rule.rs:40`) with an explicit default
posture; name-only + fail-open is the current hole (a `shell` allow rule can't stop `rm -rf`).
Fail-closed is the `error-handling.md` posture for a security control.

**Alternatives considered:** (a) keep name-only, add a separate dangerous-op blocklist — rejected
(codex proves arg-matching is the right primitive; a blocklist is trivially bypassable, per the codex
finding). (b) keep fail-open default — rejected (a permission engine that defaults allow is theatre).

**Consequences:** rules can gate on command/args; the default is safe. Public API change → `docs.md` +
CHANGELOG + a clear migration note. Regression: a rule denying `shell`+`rm -rf` blocks; `shell`+`ls`
passes; no-match under fail-closed default denies.

### D3 — #65: wire the 7 dead hooks (or remove) + ToolContext signal

**Decision:** Add the 7 missing `run*Hooks` methods to `PluginManager` and invoke each at its pinned
site (per the T3 table); thread a minimal `ToolContext` 2nd handler arg carrying `signal` (ties to
#58). Full `requestConfirmation`/`requestCredential` round-trip is a documented follow-up if it
exceeds M1's budget — but the hooks themselves MUST be wired (not left no-op) or removed from
`HookName`.

**Rationale:** adk proves the callback contract (`base_plugin.ts:70`); a declared hook that never
fires is a `no-stubs-no-mocks-no-wired §3` violation (the exact class M1 targets). Each dead hook has
a natural site (T3 table).

**Alternatives considered:** (a) remove all 7 from `HookName` — rejected (they are legitimately useful
seams; removing loses capability). (b) wire only the transform hooks — rejected (partial; the whole
declared surface must be honest). (c) full ToolContext confirmation/credential now — deferred (scope).

**Consequences:** every declared hook fires; `transform_tool_result` becomes the #57 seam. Regression:
per hook, a registered handler is invoked (anti-dead-hook proof).

### D4 — #57: tool-result content defense via the transform_tool_result seam

**Decision:** Implement the tool-result scrub as a built-in `transform_tool_result` transform (from
D3): delimit/spotlight tool output (wrap in explicit data boundaries) + optional PII regex redaction,
runs before results reach the LLM.

**Rationale:** the seam is the wired hook (D3), not a bolt-on; crewAI's guardrail-retry
(`task.py:246`) is the validation-loop precedent. Honest partial: the delimiting/PII technique is
partly external best-practice (peers are thin here, EC-4).

**Alternatives considered:** (a) a separate ad-hoc scrub outside the hook pipeline — rejected (the
`transform_tool_result` hook exists exactly for this). (b) full injection classifier/LLM-judge —
rejected for M1 (YAGNI; delimiting + regex is the parsimonious baseline).

**Consequences:** tool results carry explicit data boundaries; PII patterns redacted. Regression: an
injected instruction marker in a tool result is delimited (not executed as an instruction); a PII
pattern is redacted.

## Recommendations for the project

| # | Recommendation | Linked to | Priority |
|---|---|---|---|
| 1 | #58 — thread signal + per-tool timeout into dispatch; JobQueue abort-on-cancel + concurrency bound | T1, D1, `no-stubs-no-mocks-no-wired.md`, `parsimony-ladder.md` | HIGH (8 gaps) |
| 2 | #65 — wire the 7 dead hooks + ToolContext.signal; anti-dead-hook test per hook | T3, D3, `no-stubs-no-mocks-no-wired.md` | HIGH (silent no-ops) |
| 3 | #55 — arg-level permission gating + fail-closed default | T2, D2, `error-handling.md` | HIGH (4 gaps, public API) |
| 4 | #57 — tool-result delimiting + PII redaction via transform_tool_result | T4, D4, `error-handling.md` | MEDIUM (1 gap, composes with #65) |

## Blocked questions (if any)

None — all 5 questions answered with resolving citations (peer + our-code).

## Halt-loop progress (audit trail)

- Iterations used: 1 (inline per-iteration contract; single deep-research pass via read-only Explore agent + direct grounding reads)
- Questions answered: 5 / 5
- Questions blocked: 0
- Citations verified: peer paths + our-code loci resolve on disk (verified post-write)
- Promise: BLUEPRINT_COMPLETE (all four halt conditions hold — every question answered, citations resolve, corners populated (Tools ADR-deferred), ≥1 ADR present)

## Related

- Discovery plan: `.claude/knowledge-base/discoveries/plans/m1-harness-correctness-plan.md`
- Edge-case review: `.claude/knowledge-base/reviews/m1-harness-correctness-edge-cases-2026-07-02.md`
- Confidence report: `.claude/knowledge-base/reviews/m1-harness-correctness-confidence-2026-07-02.md` (by `/discover-confidence`)
- Project rules: `.claude/rules/architecture.md`, `.claude/rules/testing.md`, `.claude/rules/error-handling.md`, `.claude/rules/parsimony-ladder.md`, `.claude/rules/no-stubs-no-mocks-no-wired.md`
