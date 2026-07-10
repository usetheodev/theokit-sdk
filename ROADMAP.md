# @theokit/sdk — Harness Roadmap

> **Part of the [TheoKit Ecosystem Roadmap](../ROADMAP.md).** This file is the authoritative home
> for the **Harness-hardening milestones (M0–M3)** — the 15 cross-validation gaps (#54–#68) filed on
> `usetheo/theokit-sdk`. The cross-pillar integration milestones (M4–M8: Skills↔Harness, UI↔Harness,
> Runtime↔Harness, GA) live in the ecosystem roadmap. Keep the M0–M3 checkboxes in sync between the
> two files.

The `@theokit/sdk` is the **Harness** pillar of Theo. This roadmap tracks the closure of the
edge-case & bottleneck gaps surfaced by the 2026-06/07 cross-validation sweep against 5 SOTA peers
(mastra, opencode, codex, crewAI, adk-js). Master map:
[`.claude/knowledge-base/audits/cross-validation/MASTER-edge-case-bottleneck-map.md`](./.claude/knowledge-base/audits/cross-validation/MASTER-edge-case-bottleneck-map.md).

## How to work these milestones

Each milestone maps to GitHub issues on `usetheo/theokit-sdk`. Per the cycle pipeline:
`/to-plan --milestone M<N>` → `/implement` → `/code-quality` → `/review` → `/release`. Every fix is
**TDD-first** (failing regression test before the fix — Unbreakable Rule 5) and every gap closure
updates `CHANGELOG.md`.

---

### M0 — [x] Harness security floor (3 CRITICALs + live ACP defect)

**Objective:** Nothing is built atop a leaking, injectable Harness.

- [ ] **#56** cross-tenant active-recall cache leak — wire `tenantCtx` into `cache.get/set` (`src/internal/memory/active-memory.ts:131,247`) + two-user isolation test. *(1 crit)*
- [ ] **#54** sandbox `sh -c` injection + full `process.env` leak — arg-vector exec + env allowlist (`src/sandbox/local-sandbox.ts:26`, `src/internal/runtime/lifecycle/spawn-collect.ts:33`). *(1 crit, 8 gaps)*
- [ ] **#59** MCP client timeout (`src/internal/mcp/client.ts:184`). *(1 crit — reconnect deferred to M2)*
- [ ] **#68** ACP permission veto enforced (`packages/acp/src/permission-plugin.ts:115`). *(standalone live defect)*

**Dependencies:** none. **Milestone id for `/to-plan`:** `M0`.

---

### M1 — [x] Harness correctness core (kill silent no-ops)

**Objective:** No surface exists that silently does nothing (`no-stubs-no-mocks-no-wired`).

- [ ] **#58** `AbortSignal`→`dispatchTools` + between-iteration abort + per-tool timeout + JobQueue (`src/internal/agent-loop/tool-dispatch.ts:41`, `loop.ts:73`). *(8 gaps)*
- [ ] **#55** permission fail-**closed** + match beyond name-only. *(4 gaps)*
- [ ] **#65** wire-or-remove the 7/10 dead plugin hooks + `ToolContext` 2nd arg (`src/internal/plugins/types.ts:20`). *(2 gaps)*
- [ ] **#57** prompt-injection/PII scrub on tool results. *(1 gap)*

**Dependencies:** M0. **Milestone id:** `M1`.

---

### M2 — [x] Harness resilience & I/O robustness

- [ ] **#60** 429 backoff (reuse full-jitter helper, `src/internal/llm/pool-aware-client.ts:111`) + circuit breaker. *(3 gaps)*
- [ ] **#61** streaming idle timeout + truncation flag + `{raw}` passthrough. *(7 gaps)*
- [ ] **#59** MCP reconnect-after-drop.
- [ ] **#63** persistence: batch, pagination, atomic turn append. *(4 gaps)*

**Dependencies:** M0, M1. **Milestone id:** `M2`.

---

### M3 — [x] Harness state & observability

- [x] **#62** resume no longer lossy + scoped session state (app:/user:/temp:) (`src/internal/.../executor.ts:370`, `agent-session-store.ts:102`). *(5 gaps — public-API change → `docs.md` + Changeset)*
- [x] **#64** nested spans + metric gap + EventBus stops swallowing handler errors (`src/event-bus.ts:36`). *(5 gaps)*
- [x] **#66** artifacts scope decision + token-undercount fix. *(2 gaps)*
- [x] **#67** cross-model cache correctness + session revert. *(3 gaps)*

**Dependencies:** M0, M1. **Milestone id:** `M3`.

---

## Cross-pillar milestones (M4–M8)

Owned by the ecosystem roadmap — the SDK is a **dependency** of those seams, not the driver:

- **M4** Skills↔Harness · **M5** UI↔Harness · **M6** cluster consolidation · **M7** Runtime↔Harness (cloud, pre-release) · **M8** ecosystem GA.

See [`../ROADMAP.md`](../ROADMAP.md) for objectives, DoD, and dependencies.

---

## SDK Evolution (post-Harness) — SE1+

> Added 2026-07-09. New strategic phase: the Harness-hardening roadmap (M0–M3) is complete; this
> section tracks **operational-maturity gaps** surfaced by a deep comparison against the **Anthropic
> Agent SDK** (`@anthropic-ai/claude-agent-sdk`). **Numbering note:** the `M<N>` namespace is the
> **shared ecosystem** sequence (the ecosystem roadmap owns M4–M36), so these SDK-internal milestones
> use a distinct **`SE<N>`** ("SDK Evolution") prefix to avoid colliding with ecosystem milestone IDs.
> Scope is deliberately **curated**: we adopt the operational ideas that fit a
> **provider-agnostic, in-process, bring-your-own-tools runtime**, and we explicitly REJECT the ones
> that would turn `@theokit/sdk` into a Claude-Code clone or duplicate a framework/infra concern (see
> § Explicitly out of scope). The Anthropic SDK is "Claude Code as a library" (subprocess wrapper,
> Claude-only, built-in coding tools); `@theokit/sdk` is an in-process, multi-provider agent *runtime*.
> The comparison confirmed our architecture is the right one — these milestones close the *operational*
> gap, not the *architectural* one.

### SE1 — [x] Permission model (evolve HITL → configurable modes + pre-tool gate)

**Objective:** Evolve the binary HITL approval (`src/permission-plugin.ts`) into a first-class,
configurable permission model — a resolved-per-run mode plus a `canUseTool`-style pre-tool-call gate —
matching the Anthropic SDK's operational maturity (`PermissionMode` + `canUseTool`) but provider-agnostic
and framework-neutral. This is our single weakest surface vs a mature runtime.

**Definition of done:**

- [ ] A `PermissionMode` (e.g. `default | acceptEdits | bypassPermissions | dontAsk`) resolved per run; documented precedence.
- [ ] A `canUseTool(toolName, input, ctx) => allow | deny | ask` gate invoked BEFORE tool dispatch, bridged to the existing fail-closed HITL path (#55/#68). `ask` routes to the HITL approver.
- [ ] Rules (`allow`/`deny`/`ask` by tool name + arg pattern) reusing the "match beyond name-only" work (#55). Deny is fail-closed.
- [ ] TDD: gate fail-closed on error; mode precedence; `ask`→HITL bridge; a denied call surfaces a typed result.
- [ ] Public-API change → docs + Changeset.

**Dependencies:** M1 (fail-closed permission core), M3.

**Top risks (new):**
1. API surface creep — resist copying Anthropic's full 5-mode + rule-destination system; ship the minimal gate + modes. Mitigation: one gate + a small mode enum, no `destination` tiers.
2. Duplication with TheoKit's HITL / default-DENY (M34). Mitigation: the SDK ships the *primitive*; the framework *composes* it (same split as today) — do not reimplement the framework's surface here.

**Why now:** the Anthropic comparison ranked this our biggest operational gap; TheoKit already leans this way (#99 HITL fix, M34 default-DENY) and is the natural consumer.

### SE2 — [x] Typed runtime event stream

**Objective:** Expose a richer, discriminated runtime event stream from `Run.stream()` — surfacing
progress, rate-limit, permission-denied, and task-lifecycle events as **typed** messages (the Anthropic
`SDKMessage`-union approach) — for observability without parsing text. ADDITIVE to the existing ai-sdk
`UIMessageStream`, never a replacement.

**Definition of done:**

- [ ] A typed `RunEvent` discriminated union covering ≥ { tool-progress, rate-limit, permission-denied, task-started/updated/completed, compact-boundary }.
- [ ] Emitted opt-in alongside the existing chunk stream; non-breaking for current consumers.
- [ ] TDD: each event asserted from a mocked run (no live model).
- [ ] Docs + Changeset.

**Dependencies:** SE1 (permission-denied event), M3 (observability core — EventBus/spans).

**Top risks (new):**
1. Reinventing ai-sdk's UIMessageStream. Mitigation: these are ADDITIONAL runtime events (out-of-band), not a second content stream.
2. Scope explosion (Anthropic has ~40 variants). Mitigation: mirror only events with a real TheoKit consumer; add the rest on demand.

**Why now:** the comparison showed typed run-level messages are a genuine observability advantage; our stream is content-shaped only.

### SE3 — [x] Multi-agent provenance (`origin`)

**Objective:** Stamp `origin` provenance (human / peer / task-notification / coordinator /
auto-continuation) onto turns emitted in the multi-agent path (`Squad`, `a2a`, `handoff`,
background-delegation) and forward it onto the run result — so consumers can attribute/route turns by
who triggered them. Metadata-only; no behavior change.

**Definition of done:**

- [ ] A `MessageOrigin` discriminated union; stamped on messages emitted via Squad/a2a/handoff/background-delegation.
- [ ] Forwarded onto the run result (as Anthropic forwards `origin`).
- [ ] TDD: a peer-sent turn carries `{ kind: 'peer', from }`; a background follow-up carries `{ kind: 'task-notification' }`.
- [ ] Docs + Changeset.

**Dependencies:** SE2 (the typed event stream carries it), existing `a2a`/`Squad`.

**Top risks (new):**
1. Overlap with existing `a2a` addressing. Mitigation: reuse the a2a sender address; `origin` is a thin projection of it, not a parallel system.
2. Behavior drift. Mitigation: metadata-only — assert zero change to routing/dispatch.

**Why now:** we ship `a2a`/`Squad` but no provenance metadata; Anthropic's `origin` is the clean, proven shape.

### SE4 — [x] Session management surface

**Objective:** Expose a session-management API over the `ConversationStorage` interface —
`listSessions` / `getSessionMessages` / `renameSession` / `tagSession` — matching the Anthropic
session API, so hosts (TheoKit) can build session UIs without reaching into storage internals.

**Definition of done:**

- [ ] `listSessions(opts)`, `getSessionMessages(id, opts)`, `renameSession(id, title)`, `tagSession(id, tag|null)` over `ConversationStorage` (works for FS + memory + external adapters).
- [ ] Light metadata (summary, lastModified, firstPrompt) derived from the stored transcript.
- [ ] Graceful degradation for write-only/listing-incapable adapters (typed "unsupported" signal, not a throw-on-every-call).
- [ ] TDD: list/rename/tag round-trip on `FileSystemConversationStorage`.
- [ ] Docs + Changeset.

**Dependencies:** M3 (scoped session state — app:/user:/temp:), the `ConversationStorage` interface.

**Top risks (new):**
1. Adapter incompatibility (some backends can't list). Mitigation: capability-probe + typed unsupported result; never assume listability.
2. Leaking storage internals. Mitigation: return light metadata DTOs, not raw store rows.

**Why now:** we have storage + resume (#62) but no discovery/management surface; TheoKit would expose it directly.

### SE5 — [x] File checkpoint/rewind (GATED — ADR first)

> **RESOLVED 2026-07-09 → framework/tool-layer owned (no SDK code).** See
> [ADR 0003](docs/adr/0003-file-checkpointing-is-framework-owned.md). The runtime is BYO-tools and
> tool-agnostic — it ships no file tools and the agent loop performs no file I/O, so it cannot know
> which files a consumer tool mutated. A runtime checkpoint would need either an unbounded
> whole-working-tree snapshot or a file-mutation reporting contract coupling every tool to a
> filesystem protocol — both contradict the design. The layer that owns the file-editing tools
> (TheoKit's coding-agent / tool layer) owns checkpoint/rewind, keyed to SE4 session message ids.

**Objective:** DECIDE, via ADR, whether file checkpointing + rewind (Anthropic
`enableFileCheckpointing` + `rewindFiles()`) is a **runtime** concern (SDK) or a **coding-agent**
concern (TheoKit/consumer). The SDK is bring-your-own-tools: file edits come from *consumer* tools, so
the loop does not own file I/O — checkpointing may not fit the runtime cleanly.

**Definition of done:**

- [x] **GATE:** an ADR ruling runtime-vs-framework ownership (no code before it). Evidence: the loop is tool-agnostic; file mutation lives in consumer tools. → **ADR 0003.**
- [ ] ~~If runtime-owned: a minimal `checkpoint` / `rewind(messageId)` primitive~~ — N/A (ruled framework-owned).
- [x] If framework-owned: ADR + a roadmap note closing it as TheoKit/tool-layer territory (no SDK code). → **done (this note + ADR 0003).**

**Dependencies:** SE1 (permission context), SE4 (message ids as the rewind anchor).

**Top risks (new):**
1. Architectural mismatch — BYO-tools means the loop doesn't see file writes. Mitigation: the ADR is a hard gate; likely outcome is "framework/tool-layer owns it".
2. Scope creep into coding-agent territory (TheoKit's job). Mitigation: decide ownership before any primitive.

**Why now:** flagged borderline in the comparison; the ownership call must precede any implementation.

### SE6 — [x] Provider prewarm / first-token latency (GATED — measure first)

> **RESOLVED 2026-07-09 → NEGLIGIBLE, no `prewarm()` API (YAGNI).** See
> [ADR 0004](docs/adr/0004-no-provider-prewarm-in-process-coldstart-negligible.md). Measured with a
> reproducible harness (`packages/sdk/scripts/measure-cold-start.mts`, fixture runtime / no network,
> Node 22, 12 runs ×2): the only cost a runtime `prewarm()` could amortize (Agent.create cold Δ +
> first-run cold Δ) is **4–5 ms**, an order of magnitude below the 50 ms materiality threshold and
> invisible next to the LLM network round-trip (which prewarm cannot reduce). Module import (~200–370
> ms) is the largest number but happens at `import` — before any prewarm could run — and is a
> framework/app boot concern, not a runtime API. In-process minimal cold-start IS the advantage over
> the subprocess model; nothing worth a public API to hide. Harness retained as a regression tripwire.

**Objective:** The Anthropic `startup()`/`WarmQuery` exists to amortize **subprocess spawn** — which we
do NOT have (in-process by design). Investigate whether an in-process analog is warranted: prewarm the
provider chain / precache model capabilities / open the connection ahead of the first prompt, so the
first `Run.stream()` isn't slowed by cold provider resolution. Honest default posture: **likely a
no-op** — measure before building (YAGNI).

**Definition of done:**

- [x] Measure the cold-start cost of the first run (provider-chain resolution, plugin discovery, connection setup) with numbers. → **harness + ADR 0004 (4–5 ms prewarmable ceiling).**
- [ ] ~~If material: a `prewarm(options)` + TDD + latency-delta~~ — N/A (measured negligible).
- [x] If negligible: document that in-process cold-start is minimal (our advantage vs subprocess) and CLOSE the milestone with the measurement as evidence. → **done (ADR 0004 + retained harness).**

**Dependencies:** SE2 (measure via typed timing events).

**Top risks (new):**
1. Building API for a non-problem — in-process cold-start may already be negligible. Mitigation: measurement gate; no `prewarm` API unless the number justifies it.
2. Chasing a subprocess-only concept. Mitigation: the objective is explicitly the in-process analog, not a port.

**Why now:** the comparison raised it; the honest resolution is "measure, likely minimal" — hence gated.

### SE7 — [x] Structured/multimodal tool results + `ToolError` (content blocks)

**Objective:** Let a tool hand the model structured content (text + image) as its result OR its error,
not just a string — symmetrically: a `handler` may RETURN content blocks on success, and may THROW a
typed `ToolError` carrying content blocks on failure (e.g. a screenshot, a rendered chart). Introduces
the first multimodal `tool_result` path, provider-agnostically.

**Definition of done:**

- [ ] `ImageBlock` + `ToolResultContentBlock = TextBlock | ImageBlock` types; `ToolError` class carrying `string | ToolResultContentBlock[]`.
- [ ] `CustomTool.handler` return widened to `string | ToolResultContentBlock[]` (symmetric — success may be multimodal); back-compat: string still works unchanged.
- [ ] Block-capable provider wires carry blocks natively (text + image) on `tool_result.content`; **string-only provider wires fail fast** with a typed `ConfigurationError` on an image block (no silent degradation — per error-handling.md); text-only blocks flatten to a string everywhere. Naming is capability-based, not provider-specific.
- [ ] TDD: handler-returns-image carries onto a block-capable wire; `ToolError([blocks])` → `tool_result` with `isError` + blocks; string-only wire + image → `ConfigurationError`; text-only blocks flatten to string.
- [ ] Docs + Changeset.

**Dependencies:** existing tool dispatch (`tool-executors`/`tool-dispatch`), the provider wire mappers.

**Top risks (new):**
1. Breaking the string-only `tool_result` consumers (guard, wire mappers). Mitigation: `content: string | blocks` with a render helper for text-consumers; persistence/replay is event-based and untouched.
2. Provider divergence (some providers can't carry images in a tool-role message). Mitigation: typed `ConfigurationError` fail-fast, not silent drop.

**Why now:** the one real tool-ergonomics gap in a plain string-only tool result; user-requested.

### SE8 — [x] Model string shorthand (`model: "openai/gpt-4o-mini"`)

**Objective:** Accept a **bare string** model id (`model: "openai/gpt-4o-mini"`) everywhere a model is
selected — `AgentOptions.model` and `SendOptions.model` — in addition to the current
`{ id: string }` object. Every peer (LangChain / Mastra `"provider/model"`, OpenAI Agents, AI SDK)
takes a bare string; requiring `{ id: … }` is the single most constant first-5-minutes DX friction.
The id already parses a `provider/model` prefix — this is a boundary-normalization convenience, not a
routing change. From the DX comparison vs the 4 reference SDKs (2026-07-10).

**Definition of done:**

- [ ] `AgentOptions.model` + `SendOptions.model` accept `string | ModelSelection`; a string is normalized to `{ id: string }` at ONE seam (not scattered).
- [ ] Back-compat: the `{ id }` (and `{ id, params }`) object form is unchanged.
- [ ] TDD: a string model resolves identically to `{ id }`; the `provider/` prefix still routes; params-requiring cases still use the object form (documented).
- [ ] Docs + Changeset; update examples/templates to the shorthand.

**Dependencies:** none (purely additive DX; the model resolver already parses `provider/model`).

**Top risks (new):**
1. `ModelSelection.params` needs the object form. Mitigation: the string covers the common no-params case; document that tuning params requires `{ id, params }`.
2. A call site typed only as `ModelSelection` (not the new union) silently rejects a string. Mitigation: audit the model call sites; normalize once at the public boundary.

**Why now:** cheapest high-perception DX win from the reference comparison — near-trivial, additive.

### SE9 — [x] Integrated structured output on the run (`SendOptions.output`)

**Objective:** Return a **validated typed object FROM the agent run** — `agent.send(input, { output: schema })`
runs the tool loop and then coerces the final answer into the schema, surfaced on the run result —
instead of a separate `generateObject` call. Matches LangChain `response_format` (`structured_response`)
and the AI SDK `Output.object` (`{ output }`). This is the most substantive DX-capability gap found in
the reference comparison: today you cannot say "run the loop AND give me a typed object" in one call.

**Definition of done:**

- [ ] `SendOptions.output` (a Zod schema) that, when set, makes the run return the validated structured object on the run result (e.g. `RunResult.output`), with the inferred type on `run.wait()`.
- [ ] Tools still run first; structuring happens on the final turn. **Sugar over the existing `generateObject` synthetic-forced-tool machinery (ADR D33) — reuse, do NOT fork** (Don't-Reinvent).
- [ ] Failure is typed: a schema-parse failure surfaces a typed error (not a silent empty/undefined).
- [ ] Precedence with `toolChoice` / `maxIterations` defined + documented.
- [ ] TDD: a run with tools + an `output` schema returns the typed object; a parse failure surfaces the typed error.
- [ ] Docs + Changeset.

**Dependencies:** the existing `generateObject` (ADR D33 synthetic forced tool); SE2 (typed events, optional).

**Top risks (new):**
1. Duplicating the two-model reason→structure flow already in `generateObject`. Mitigation: compose over it, one structuring seam.
2. Streaming variant (`streamObject`) scope-creep. Mitigation: ship non-streaming `output` first; streamed structured output is a follow-up ADR.
3. Interaction with `toolChoice: "required"` / iteration ceiling. Mitigation: explicit precedence rules + tests.

**Why now:** the biggest DX-capability gap vs LangChain + AI SDK; both integrate structured output into
the agent run and it is a common ask.

### SE10 — [x] Cancellation + option passthrough in subagent delegation

**Objective:** Forward the parent run's cancellation to an in-flight subagent. `defineSubAgent`'s
returned tool handler today calls `agent.send(input)` with NO options (`a2a/subagent.ts:60`), so an
aborted parent run does not cancel the child — it runs to completion, wasting tokens. The `CustomTool`
handler already receives an optional `ctx.signal` (`types/agent-prims.ts:71`, #65). Thread that
`AbortSignal` into the child `agent.send(input, { signal })`. Matches Mastra "abortSignal forwarded to
delegated subagents; abort cancels in-flight subagent runs at their next step". From the Mastra
supervisor-agents comparison (2026-07-10).

**Definition of done:**

- [ ] `defineSubAgent`'s tool handler reads the optional `ctx.signal` and forwards it to the child `agent.send(input, { signal })`; an already-aborted or mid-run abort cancels the child (child resolves `cancelled`, not `finished`).
- [ ] Back-compat: a handler invoked with no `ctx` (single-arg call sites) behaves exactly as today (no signal ⇒ no cancellation).
- [ ] The child agent is still disposed in `finally` on cancel (no leak).
- [ ] TDD: an aborted parent signal cancels the in-flight subagent (child run status `cancelled`); the un-aborted path still returns the child result.
- [ ] Docs + Changeset.

**Dependencies:** none (the `ctx.signal` seam already exists per #65; purely additive).

**Top risks (new):**
1. `ctx.signal` may be absent on some dispatch paths. Mitigation: forward only when present; absent ⇒ current behavior.
2. Cancelling mid-dispose could throw. Mitigation: dispose in `finally`, swallow post-cancel dispose errors.

**Why now:** cheapest of the three supervisor-parity gaps; foundational for SE11/SE12 (establishes option-passing into the child run).

### SE11 — [x] Delegation lifecycle hooks (`onDelegationStart` / `onDelegationComplete`)

**Objective:** Let the caller intercept a delegation as it happens. Mastra's supervisor exposes
`onDelegationStart` (proceed / reject with reason / rewrite prompt / cap steps) and
`onDelegationComplete` (inspect result / error / inject feedback / bail). TheoKit's `defineSubAgent`
has NO interception point — the handler runs the child unconditionally. Add optional hooks to
`SubAgentSpec` wired around the child run. From the Mastra supervisor-agents comparison (2026-07-10).

**Definition of done:**

- [ ] `SubAgentSpec.onDelegationStart?(ctx: { input; name }) => { proceed: boolean; rejectionReason?; modifiedInput? } | void` — `proceed: false` short-circuits (returns the `rejectionReason` as the tool result, the child never runs); `modifiedInput` rewrites the prompt sent to the child.
- [ ] `SubAgentSpec.onDelegationComplete?(ctx: { input; name; result?; error? }) => { feedback? } | void` — runs after the child; optional `feedback` is appended to the returned result string.
- [ ] Hooks are optional and fail-loud: a throwing hook surfaces a typed error, never a silent swallow (Rule 8).
- [ ] Back-compat: specs without hooks behave exactly as today.
- [ ] TDD: reject path returns `rejectionReason` without running the child; `modifiedInput` rewrites; `onDelegationComplete` feedback is appended; a child error is surfaced to `onDelegationComplete`.
- [ ] Docs + Changeset.

**Dependencies:** SE10 (option-passing seam into the child run).

**Top risks (new):**
1. Hook error semantics ambiguity (throw vs swallow). Mitigation: a throwing hook ⇒ typed error, documented; no silent swallow.
2. `modifiedMaxSteps` needs child `maxIterations` plumbing. Mitigation: ship `proceed`/`rejectionReason`/`modifiedInput` first; add `modifiedMaxSteps` only if the child `send` already supports an iteration cap, else defer with a note.

**Why now:** the highest-control supervisor-parity gap; unlocks guardrails (reject after N iterations, rewrite the delegated prompt) that today require wrapping the tool by hand.

### SE12 — [x] Opt-in parent-context forwarding + `messageFilter` for subagents

**Objective:** Let a subagent optionally see a filtered view of the supervisor's conversation.
Today `defineSubAgent` sends ONLY a fresh `input` string — full memory isolation, a deliberate
strength. Mastra forwards the full conversation and exposes `messageFilter` to trim it. Add an OPT-IN
`messageFilter` to `SubAgentSpec`: when present, the parent's messages (filtered) are forwarded to the
child as prior context; when absent, the current isolated behavior is preserved (isolation stays the
default). From the Mastra supervisor-agents comparison (2026-07-10).

**Definition of done:**

- [ ] `SubAgentSpec.messageFilter?({ messages; input; name }) => messages` — when set, the returned (filtered) parent messages are forwarded to the child run as prior context; when absent, the child runs input-only (unchanged; isolation-by-default preserved).
- [ ] Parent messages are exposed to the delegation handler WITHOUT sending nested tool args back into the supervisor model (mirrors Mastra's "scoped memory saves").
- [ ] Security: the filter is the ONLY path that widens child context; no accidental full-transcript leak when `messageFilter` is absent.
- [ ] TDD: with `messageFilter` returning a subset, the child receives exactly that subset; without it, the child receives input only; a filter dropping a "confidential" message keeps it out of the child context.
- [ ] Docs + Changeset; ADR if runtime message-exposure requires a new seam.

**Dependencies:** SE10 + SE11 (delegation seam + hook infrastructure). May need an ADR if exposing parent messages to the tool handler requires a runtime change.

**Top risks (new):**
1. Breaking the memory-isolation default. Mitigation: forwarding is OPT-IN (only when `messageFilter` is set); absent ⇒ isolated.
2. Exposing parent messages to a tool handler may need a runtime seam. Mitigation: if `ctx.context` does not already carry the transcript, gate SE12 behind an ADR + a minimal, additive runtime exposure.
3. Leaking sensitive context. Mitigation: the filter runs before forwarding; test the "confidential-dropped" case.

**Why now:** completes the supervisor-parity set (delegation control + context control); the most architecturally sensitive, so it ships last and stays opt-in.

### SE13 — [x] `modifiedMaxSteps` on `onDelegationStart` (cap the subagent's iterations)

**Objective:** Complete SE11's delegation hooks by letting `onDelegationStart` cap the child's
iteration count. SE11 shipped `proceed` / `rejectionReason` / `modifiedInput` and DEFERRED
`modifiedMaxSteps` pending "child `maxIterations` plumbing" — but the plumbing already exists
(`SendOptions.maxIterations`, `types/run.ts:395`, default 8). Add `modifiedMaxSteps` to
`DelegationStartDecision` and forward it as `maxIterations` to the child `agent.send`. Matches Mastra's
`onDelegationStart.modifiedMaxSteps`. From the Mastra supervisor-agents comparison (2026-07-10).

**Definition of done:**

- [ ] `DelegationStartDecision` gains `modifiedMaxSteps?: number`; when set (and `proceed !== false`), `defineSubAgent` forwards it as `maxIterations` to the child `agent.send(input, { maxIterations })`.
- [ ] Composes with SE10 (signal) + SE12 (messageFilter preamble): all merge onto ONE child `send` call.
- [ ] Back-compat: absent `modifiedMaxSteps` ⇒ the child uses its default iteration ceiling (unchanged).
- [ ] TDD: a decision with `modifiedMaxSteps: 3` calls the child `send` with `maxIterations: 3`; absent leaves the child call unchanged; the option coexists with a forwarded `signal`.
- [ ] Docs + Changeset.

**Dependencies:** SE11 (the `onDelegationStart` hook + `DelegationStartDecision`); SE10 (the child-send option seam).

**Top risks (new):**
1. Option-merge collision on the child `send` (signal + maxIterations + messageFilter preamble). Mitigation: build one `SendOptions` object; the preamble is on `input`, the rest are distinct keys.
2. A `modifiedMaxSteps` of 0 / negative. Mitigation: decide in plan — forward as-is (the loop already floors the ceiling) OR validate and reject with a typed error; document the choice.

**Why now:** completes the SE11 hook contract at near-zero cost (the child cap already exists); the last missing piece of `onDelegationStart` parity.

### SE14 — [x] Subagent result-context control (`includeToolResults`)

**Objective:** Control what a completed subagent surfaces back to the supervisor. Today `defineSubAgent`
returns only the child's final text (`RunResult.result`). Mastra defaults to text-only and exposes
`includeSubAgentToolResultsInModelContext` to also fold the child's nested tool results into the
supervisor context. Add an opt-in `SubAgentSpec.includeToolResults`: when set, the child's tool-call
results are appended to the delegation payload surfaced to the supervisor; text-only stays the default
(Mastra's "scoped" posture). Pairs with SE12 (context IN) to complete the subagent context boundary
(context OUT). From the Mastra supervisor-agents comparison (2026-07-10).

**Definition of done:**

- [ ] `SubAgentSpec.includeToolResults?: boolean` (default `false` = text-only, unchanged). When `true`, the child's tool-call results are appended to the delegation result returned to the supervisor.
- [ ] The default (`false`) preserves today's text-only behavior EXACTLY (regression-tested).
- [ ] Nested tool args are not silently re-injected beyond what the option opts into (mirrors Mastra's scoped default).
- [ ] TDD: with `includeToolResults: true` the returned payload contains the child's tool result; with `false` (default) it is text-only.
- [ ] Docs + Changeset; **ADR** if surfacing the child's tool results requires a new `RunResult` field or a `run.stream()` capture.

**Dependencies:** SE10 (child-send seam). **May need a `RunResult` tool-results surface** — `RunResult` currently exposes only `result?: string`, so capturing the child's tool results likely needs a new additive field OR a `run.stream()` event capture (gate behind an ADR).

**Top risks (new):**
1. `RunResult` does not expose tool calls / results today (only `result?: string`, `types/run.ts`). Mitigation: add a minimal additive `RunResult` tool-results surface OR capture via `run.stream()`; decide in plan/ADR — keep additive + backward-compatible.
2. Leaking large nested tool payloads into the supervisor context (token blow-up). Mitigation: opt-in only; document the cost; consider a size cap in plan.

**Why now:** the remaining delegation-result gap vs Mastra; with SE12 (context IN) it gives full, opt-in control of the subagent context boundary in BOTH directions.

### SE15 — [x] `iteration` count in delegation-hook context (reject-after-N)

**Objective:** Give `onDelegationStart` / `onDelegationComplete` the current delegation iteration count
so a hook can decide on it — Mastra's documented "reject delegation after too many iterations"
(`if (context.iteration > 8) return { proceed: false, rejectionReason }`). Mastra's delegation context
is `{ primitiveId, prompt, iteration }`; TheoKit's `DelegationStartContext` today is `{ input, name }` —
it can reject (SE11) but has NO iteration count to base the decision on. Add a per-`defineSubAgent`-instance
invocation counter surfaced as `iteration` on both hook contexts. From the Mastra supervisor-agents
comparison (2026-07-10).

**Definition of done:**

- [ ] `DelegationStartContext` + `DelegationCompleteContext` gain `iteration: number` — the 1-based count of times THIS subagent tool has been invoked (a per-`defineSubAgent`-instance closure counter).
- [ ] The counter increments once per handler invocation BEFORE `onDelegationStart` runs, so the hook sees the current iteration; a rejected (`proceed:false`) delegation still counts as an iteration.
- [ ] Back-compat: hooks that ignore `iteration` are unaffected; specs without hooks are unchanged.
- [ ] TDD: three successive delegations see `iteration` 1, 2, 3; a hook rejecting when `iteration > 2` lets the first two run and rejects the third (child never runs on the third); `onDelegationComplete` sees the same iteration as its `onDelegationStart`.
- [ ] Docs + Changeset.

**Dependencies:** SE11 (the hook contexts `DelegationStartContext` / `DelegationCompleteContext`).

**Top risks (new):**
1. Counter scope ambiguity (per-tool-instance vs per-run). Mitigation: a per-`defineSubAgent`-instance closure counter — documented; a fresh `defineSubAgent(...)` starts at 1. Matches Mastra's per-subagent iteration semantics.
2. Concurrency (parallel delegations of the same tool instance). Mitigation: the increment is synchronous at handler entry; document that the count reflects invocation order, not wall-clock concurrency.

**Why now:** completes the `onDelegationStart` CONTEXT parity — SE11 gave the decision, SE13 gives the cap, SE15 gives the signal to decide on; the reject-after-N-iterations pattern needs it.

### SE16 — [x] `outputSchema` on `defineTool` (validate the tool's return)

**Objective:** Let a tool declare and validate its OUTPUT shape. `defineTool` today validates only
`inputSchema` (Zod, `define-tool.ts:25`) — the handler's return is passed through unvalidated. Mastra's
`createTool` takes an `outputSchema`. Add an optional `outputSchema?: ZodType` to `DefineToolSpec`; when set,
the handler's return is validated against it before becoming the tool result, and the return type is inferred
from it. From the Mastra Tools comparison (2026-07-10).

**Definition of done:**

- [ ] `DefineToolSpec.outputSchema?: ZodType`; when set, the handler's return is parsed against it and a validation failure surfaces a TYPED error (not a silent malformed tool result).
- [ ] The handler's return type is inferred from `outputSchema` when present (end-to-end inference).
- [ ] Back-compat: absent `outputSchema` ⇒ the handler return is passed through exactly as today.
- [ ] SE7 multimodal (`ToolResultContentBlock[]`) returns: `outputSchema` targets the structured-object return only; a blocks return is not forced through a Zod object (decide the exact rule in plan).
- [ ] TDD: a return matching the schema passes; a mismatch surfaces the typed error; no schema ⇒ unchanged.
- [ ] Docs + Changeset.

**Dependencies:** none (extends `defineTool`, additive).

**Top risks (new):**
1. Interaction with SE7 multimodal blocks return (not a plain object). Mitigation: apply `outputSchema` only to non-blocks returns, documented.
2. Double-validation cost. Mitigation: opt-in only (when `outputSchema` set).

**Why now:** cheapest tool-authoring parity gap; makes tool outputs self-validating (the input side already is).

### SE17 — [x] `toModelOutput` — model-facing vs app-facing tool output split

**Objective:** Let a tool return RICH structured data for the application while sending the MODEL a smaller
or multimodal representation. Today the handler's return IS what the model sees (SE7 gives multimodal, but
not the app-vs-model split). Mastra's `toModelOutput` and the Vercel AI SDK both separate these. Add an
optional `toModelOutput(output) => string | ToolResultContentBlock[]` to `DefineToolSpec`: the handler's
full return flows to the application / observability, while `toModelOutput` maps it to the compact
model-facing `tool_result`. From the Mastra Tools comparison (2026-07-10).

**Definition of done:**

- [ ] `DefineToolSpec.toModelOutput?: (output) => string | ToolResultContentBlock[]`; when set, the model-facing tool_result content is what `toModelOutput` returns, NOT the raw handler output.
- [ ] The raw handler output stays available to observability (`onToolEnd` event carries it) so the app keeps the full result — confirm the exact surface in plan (reuse `onToolEnd`, avoid a new RunResult field).
- [ ] Composes with SE16: `outputSchema` validates the raw handler output; `toModelOutput` maps the validated output to the model representation.
- [ ] Back-compat: absent `toModelOutput` ⇒ the handler return is the model result (unchanged; SE7 blocks path intact).
- [ ] TDD: a tool with rich output + `toModelOutput` sends the small representation to the model while the full output reaches the observability surface.
- [ ] Docs + Changeset.

**Dependencies:** SE16 (composes with `outputSchema`; may ship independently but the plan defines ordering).

**Top risks (new):**
1. Where the raw output is exposed to the app (existing `onToolEnd` event vs a new surface). Mitigation: reuse `onToolEnd`'s output; no new RunResult surface unless a plan proves it necessary.
2. `toModelOutput` may itself return SE7 blocks. Mitigation: it returns the `string | ToolResultContentBlock[]` union — one code path.

**Why now:** the real tool-output DX gap vs Mastra + AI SDK; keeps model context small without losing the app's full result.

### SE18 — [x] `activeTools` — per-send runtime tool subset

**Objective:** Let a caller restrict, per `send`, WHICH of the agent's registered tools the model may call.
Today `SendOptions.toolChoice` (`auto/none/required`, `types/run.ts:330`) gates WHETHER tools are called, not
which subset; Mastra's `activeTools` (and the AI SDK's) narrow the available tools at runtime. The enforcement
mechanism already exists — `withToolWhitelist` (`internal/runtime/concurrency/async-local-storage.ts:31`, used
by `Agent.fork`'s `allowedTools` + subagent tool-scoping). Add `SendOptions.activeTools?: string[]` that
applies that whitelist for the duration of the send. From the Mastra Tools comparison (2026-07-10).

**Definition of done:**

- [ ] `SendOptions.activeTools?: string[]`; when set, only tools whose canonical (post-repair, lowercase) name is in the list are dispatchable for that send — any other tool call is vetoed via the existing `withToolWhitelist` dispatch path (NOT `PermissionEngine`), same as `fork`'s `allowedTools`.
- [ ] Composes with `toolChoice`: `activeTools` narrows the set; `toolChoice` gates calling within it.
- [ ] Back-compat: absent `activeTools` ⇒ the full toolset is available (unchanged).
- [ ] TDD: with `activeTools: ["a"]`, tool `a` dispatches and tool `b` is vetoed; absent ⇒ both available.
- [ ] Docs + Changeset.

**Dependencies:** none (reuses `withToolWhitelist`; additive on `SendOptions`).

**Top risks (new):**
1. Whether `activeTools` also hides the tools from the advertised catalog (not just veto dispatch). Mitigation: decide in plan — veto-at-dispatch is the minimum; catalog-filtering (fewer wasted calls, matches Mastra) ships if the loop's tool-advertise seam allows it cleanly.
2. Name canonicalization must match the whitelist. Mitigation: reuse the same canonicalization `fork`/subagent-scope use.

**Why now:** completes the runtime tool-control pair with the existing `toolChoice`, reusing a proven whitelist.

### SE19 — [x] `workflowAsTool` — expose a Workflow as an agent tool

**Objective:** Let an agent call a `Workflow` as a tool, completing the Mastra "X as tools" trio (tools;
agents-as-tools via `defineSubAgent`, SE10–15; workflows-as-tools). Mastra converts a workflow to a
`workflow-<key>` tool using its `inputSchema`/`outputSchema`. TheoKit's `Workflow` already exposes
`inputSchema?`/`outputSchema?` (`types/workflow.ts:34-35`) and `run(input) => WorkflowRun<TOutput>`
(`workflow.ts:251`). Add a `workflowAsTool(workflow, { name, description })` helper that returns a
`CustomTool` whose handler runs the workflow and returns its output. From the Mastra Tools comparison (2026-07-10).

**Definition of done:**

- [x] `workflowAsTool(workflow, spec)` returns a `CustomTool`: `inputSchema` is provided by the caller in `spec` (**design correction** — a `Workflow` carries NO top-level schema; `WorkflowOptions` is `name`/`persistence`/`workflowId` only, schemas are per-step on `FnStep`). The handler validates args against `spec.inputSchema`, runs `workflow.run(parsedInput)`, and returns the workflow output.
- [x] A workflow run that does not reach `status: "completed"` surfaces a TYPED `WorkflowToolError` (step errors do NOT throw — they surface via `run.status === "failed"`).
- [x] Output → tool_result: a string output is returned as-is; a structured output is JSON-stringified (SE17 `toModelOutput`-style shaping can layer later).
- [x] Exported from `@theokit/sdk/workflow` (the workflow sub-export, sibling of `Workflow`/`fn`). Accepts any `{ run }`-shaped workflow (structural — never imports the `Workflow` class).
- [x] TDD: runs the workflow with the parsed input and returns its output; string output as-is; a failing run raises `WorkflowToolError`; an invalid input raises `ZodError` before running.
- [x] Docs + Changeset.

**Dependencies:** none (composes the existing `Workflow` + `CustomTool`; additive).

**Top risks (new):**
1. `WorkflowRun` terminal-output access (which field carries the result). Mitigation: read it from the `WorkflowRun<TOutput>` surface (verify the exact field in plan); step errors propagate via the run, not a throw — surface them as the tool's typed error.
2. Output shape → tool_result (string vs structured). Mitigation: stringify non-string output (JSON), same convention as `defineSubAgent`'s fallback.

**Why now:** completes the Mastra "X as tools" trio; the `Workflow` primitive already carries the schemas the helper needs, so it is a thin, additive composition.

### SE20 — [x] `agent.skills.get(name)` — read a skill's full body programmatically

**Objective:** Programmatic access to a skill's INSTRUCTIONS from application code. `agent.skills.list()`
already exists (`SDKAgentSkills.list()`, `types/agent.ts:121`) but returns name + description only
(`SystemPromptSkillRef`), never the body. Mastra exposes `agent.getSkill(name)` returning the skill WITH
its `instructions`. Add `SDKAgentSkills.get(name)` that returns the full skill — name, description, and the
body (read from the SKILL.md `source` for filesystem skills, or the inline `instructions` for `createSkill`
skills). From the Mastra Agent-skills comparison (2026-07-10).

**Definition of done:**

- [ ] `SDKAgentSkills.get(name: string): Promise<{ name; description; instructions } | undefined>` — returns the resolved skill including its body; `undefined` when no enabled skill matches.
- [ ] Filesystem skills read the body from their `source` SKILL.md; inline (`createSkill`) skills return their `instructions` directly.
- [ ] `list()` is unchanged (name + description only — the block stays lean; full bodies only via `get`).
- [ ] A malformed / excluded skill is not returned by `get` (same exclusion as `list`).
- [ ] TDD: `get` returns the body for an inline skill and for a filesystem skill; `undefined` for an unknown name; excluded skills are absent.
- [ ] Docs + Changeset.

**Dependencies:** none (extends the existing `SDKAgentSkills` handle + `skills-manager`).

**Top risks (new):**
1. Reading the SKILL.md body lazily per `get` (I/O). Mitigation: read on demand (not eagerly cached) — `get` is an app-side call, not a hot loop.
2. Body of an inline skill vs a filesystem skill diverge in source. Mitigation: the skills-manager already distinguishes inline (`source: inline://…`) from filesystem — branch on `source`.

**Why now:** the cheapest skills-access parity gap; `list()` already exists, so `get` is a thin sibling reading the body the manager can already reach.

### SE21 — [x] `references` on `createSkill` (bundle supporting docs on an inline skill)

**Objective:** Let an inline `createSkill` bundle supporting documents, matching a filesystem skill's
`references/` directory. Mastra's `createSkill` takes a `references: { 'file.md': '...' }` map. TheoKit's
`CreateSkillSpec` (`create-skill.ts`) has only name / description / instructions — an inline skill cannot
carry references. Add an optional `references?: Record<string, string>` to `CreateSkillSpec`, surfaced via
SE20's `get(name)` (and readable by the consumer). From the Mastra Agent-skills comparison (2026-07-10).

**Definition of done:**

- [ ] `CreateSkillSpec.references?: Record<string, string>` (filename → content); carried on the `InlineSkill`.
- [ ] The references are exposed through `agent.skills.get(name)` (SE20) so an app / a consumer tool can read them; absent ⇒ no references (unchanged).
- [ ] Back-compat: inline skills without `references` behave exactly as today.
- [ ] TDD: an inline skill with `references` surfaces them via `get`; without ⇒ empty/absent.
- [ ] Docs + Changeset; **ADR** if surfacing references to the MODEL (not just the app) needs a read tool — the eager `<skills>` block only carries name + description, so a model-facing reference read is a separate mechanism (skill_read tool) intentionally deferred.

**Dependencies:** SE20 (`get` is the read path that surfaces `references`).

**Top risks (new):**
1. Model-facing consumption of references. Mitigation: SE21 surfaces references to the APP via `get`; a model-facing `skill_read`-style tool is OUT OF SCOPE here (TheoKit uses eager `<skills>` disclosure — see § Explicitly out of scope / the disclosure-mechanism ADR).
2. Reference size / injection. Mitigation: `references` is app-read only in SE21; no auto-injection into the prompt.

**Why now:** completes inline-skill parity with filesystem skills' `references/`; pairs with SE20 as its read path.

### SE22 — [x] Dynamic skills resolver (`skills: (ctx) => SkillInput[]`)

**Objective:** Per-request skill resolution. Mastra accepts `skills: ({ requestContext }) => SkillInput[]`
so an agent picks its skills from runtime context (e.g. user role). TheoKit's `AgentOptions.skills` is a
STATIC `SkillsSettings` object. TheoKit ALREADY has a dynamic **systemPrompt** resolver
(`types/agent.ts:343`); mirror that shape for skills — accept a resolver function evaluated per run. From
the Mastra Agent-skills comparison (2026-07-10).

**Definition of done:**

- [ ] `AgentOptions.skills` accepts a resolver `(ctx) => SkillsSettings | Promise<SkillsSettings>` in addition to the static object; evaluated per run before skill discovery/assembly.
- [ ] Back-compat: a static `SkillsSettings` object behaves exactly as today.
- [ ] The resolver receives a documented context (mirror the systemPrompt resolver's `ctx`); the SDK imposes no timeout (consumer wraps their own).
- [ ] TDD: a resolver returning different skills for different contexts is honored per run; a static object is unchanged.
- [ ] Docs + Changeset.

**Dependencies:** none (mirrors the existing systemPrompt-resolver pattern).

**Top risks (new):**
1. When the resolver runs relative to skill discovery / caching. Mitigation: evaluate per `send` before assembly (like the systemPrompt resolver); document that a cached `getOrCreate` agent re-resolves per run.
2. Resolver error handling. Mitigation: a throwing resolver fails the run fast (typed error), never silently falls back — Rule 8.

**Why now:** completes the skills-config parity; the dynamic-resolver pattern already exists for `systemPrompt`, so this is a consistent, additive extension.

### SE23 — [ ] `defineSkillReadTool` — opt-in model-facing lazy skill read

**Objective:** Give the MODEL on-demand access to a skill's full body + references via an OPT-IN tool —
WITHOUT auto-injecting a built-in tool (bring-your-own-tools). Mastra ships `skill_read`/`skill_search`
tools that auto-inject; TheoKit uses the eager `<skills>` system-prompt block (name + description) for
discovery. Add a `defineSkillReadTool(skills)` FACTORY (sibling of `defineSubAgent` / `workflowAsTool`)
that returns a `CustomTool` the consumer explicitly adds to the agent's `tools`; when the model calls it
with a skill name, it returns that skill's `instructions` (+ SE21 `references`). Opt-in preserves the
bring-your-own-tools principle — the SDK does NOT auto-inject skills tools. From the Mastra Agent-skills
comparison (2026-07-10).

**Definition of done:**

- [ ] `defineSkillReadTool(skills: InlineSkill[])` returns a `CustomTool` (name `skill_read`) whose input is a skill name; the handler returns the matching skill's `instructions` and (SE21) `references`; an unknown name returns a typed "not found" tool result (a string the model can act on, NOT a throw that kills the run).
- [ ] The tool is OPT-IN — the consumer adds it to `tools`; the SDK never auto-injects it (bring-your-own-tools preserved).
- [ ] Back-compat: nothing changes for agents that don't add the tool.
- [ ] TDD: the tool returns a skill's body + references by name; an unknown name returns the not-found result; the returned value is a valid `CustomTool`.
- [ ] Docs + Changeset; **ADR** recording the opt-in-factory decision (vs Mastra's auto-injected tools) + the eager-block + lazy-read hybrid.

**Dependencies:** SE21 (`references` on the inline skill — the tool surfaces them).

**Top risks (new):**
1. Bring-your-own-tools boundary. Mitigation: a FACTORY the consumer adds (like `defineSubAgent` / `workflowAsTool`), never auto-injected — the ADR records this as the resolution of the disclosure-mechanism question (§ Explicitly out of scope built-in tools stays intact: this ships a factory, not an auto-injected toolset).
2. Skill body size in the tool result. Mitigation: return the body as-is; the consumer controls which skills they expose by choosing what to pass to the factory.

**Why now:** completes the Mastra skills-read parity as an OPT-IN factory (consistent with `defineSubAgent` / `workflowAsTool`), resolving the eager-block-vs-lazy-tool question without violating bring-your-own-tools.

### Explicitly out of scope

Gaps present in the Anthropic Agent SDK that we deliberately DO NOT adopt, because they contradict the
`@theokit/sdk` architecture or belong to a different layer. Reopening any requires an ADR with evidence.

- **OS-level sandbox** (bubblewrap / network allowlist / filesystem deny) — *why excluded:* OS isolation is a **deploy/infra** concern (TheoCloud), not the agent runtime. The narrow code-mode execution sandbox already exists for its use case; kernel-level isolation is not the runtime's job.
- **Built-in coding tools** (Read / Write / Edit / Bash / Grep / Glob / …) — *why excluded:* **bring-your-own-tools** is the design. The consumer (TheoKit) provides tools. Shipping a toolset would make `@theokit/sdk` a Claude-Code clone instead of a runtime.
- **Subprocess / CLI-wrapper model + spawn warm-start** — *why excluded:* we are **in-process by design** (the Model-A TUI/Tauri advantage — `streamAgentTurnInProcess`). The subprocess model is Anthropic's Claude-only product shape, not a runtime primitive. Never adopt.
- **Settings-resolution engine** (precedence tiers, MDM/plist/HKLM, `resolveSettings`) — *why excluded:* app/framework configuration is a **framework** concern, not the agent runtime's.

---

## References

Study-only peers + full cross-validation reports:
`.claude/knowledge-base/audits/cross-validation/{mastra,opencode,codex,crewai,adk-js}/final_report.md`.

**SDK Evolution (SE1+) reference:** deep comparison against the **Anthropic Agent SDK**
(`@anthropic-ai/claude-agent-sdk`, TypeScript reference) — the source of the SE1–SE6 operational-maturity
gaps and the § Explicitly out of scope rejections (2026-07-09).
