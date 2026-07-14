# @theokit/sdk — Harness Roadmap

> **Part of the [TheoKit Ecosystem Roadmap](../ROADMAP.md).** This file is the authoritative home
> for the **Harness-hardening milestones (M0–M3)** — the 15 cross-validation gaps (#54–#68) filed on
> `usetheo/theokit-sdk`. The cross-pillar integration milestones (M4–M8: Skills↔Harness, UI↔Harness,
> Runtime↔Harness, GA) live in the ecosystem roadmap. Keep the M0–M3 checkboxes in sync between the
> two files.

The `@theokit/sdk` is the **Harness** pillar of Theo. This roadmap tracks the closure of the
edge-case & bottleneck gaps surfaced by the 2026-06/07 cross-validation sweep against 5 SOTA peers
(a peer framework, a peer project, codex, a peer project, peer-js). Master map:
[`.claude/knowledge-base/audits/cross-validation/MASTER-edge-case-bottleneck-map.md`](./.claude/knowledge-base/audits/cross-validation/MASTER-edge-case-bottleneck-map.md).

## How to work these milestones

Each milestone maps to GitHub issues on `usetheo/theokit-sdk`. Per the cycle pipeline:
`/to-plan --milestone M<N>` → `/implement` → `/code-quality` → `/review` → `/release`. Every fix is
**TDD-first** (failing regression test before the fix — Unbreakable Rule 5) and every gap closure
updates `CHANGELOG.md`.

---

### M0 — [x] Harness security floor (3 CRITICALs + live ACP defect)

**Objective:** Nothing is built atop a leaking, injectable Harness.

- [x] **#56** cross-tenant active-recall cache leak — `tenantCtx` wired into `cache.get/set` in BOTH sdk + the publishable `@theokit/sdk-memory` copy; caller threads `memoryContext.tenantId` into the key. Two-user isolation tests (primitive + caller). *(1 crit — closed 2026-07-14; adversarial review found + fixed the sdk-memory + caller gaps)*
- [x] **#54** sandbox `sh -c` injection + full `process.env` leak — env allowlist across all 3 spawn paths; denylist extended to connection-string/value-embedded secrets; dead `validateCommand` guard removed; e2e LocalSandbox env-scrub test. *(1 crit — closed 2026-07-14; arg-vector exec intentionally deferred: `sh -c` is the shell tool's contract, env-scrub is the boundary)*
- [x] **#59** MCP client timeout (`src/internal/mcp/client.ts`) — every request bounded (stdio + http, header AND body phase) → typed `mcp_timeout`. *(1 crit — closed 2026-07-14; reconnect landed in M2)*
- [x] **#68** ACP permission veto enforced (`packages/acp/src/permission-plugin.ts`) — veto consumed by the dispatch loop; fail-closed on deny/timeout/cancel/disconnect. *(standalone live defect — closed; adversarial review verdict FULLY_CLOSED)*

**Dependencies:** none. **Milestone id for `/to-plan`:** `M0`.

---

### M1 — [x] Harness correctness core (kill silent no-ops)

**Objective:** No surface exists that silently does nothing (`no-stubs-no-mocks-no-wired`).

- [x] **#58** `AbortSignal`→`dispatchTools` + between-iteration abort + per-tool timeout + JobQueue — signal threaded + dispatcher-enforced; between-iteration break; per-tool timeout; JobQueue concurrency bound. *(closed 2026-07-14; adversarial review found + fixed a JobQueue cancel-deadlock and a cancelled-status mislabel)*
- [x] **#55** permission fail-**closed** + match beyond name-only — fail-closed default (`ask`); argument-level gating; **subagents inherit the parent's permission gate** (adversarial-review fix — arg-gating no longer stops at the delegation boundary). *(closed 2026-07-14)*
- [x] **#65** wire-or-remove the 7/10 dead plugin hooks + `ToolContext` 2nd arg — all 10 hooks invoked at real seams; `transform_llm_output` now rewrites the final user-visible text (adversarial-review fix). *(closed 2026-07-14)*
- [x] **#57** prompt-injection/PII scrub on tool results — opt-in guard on every tool origin; replaces LLM-visible content; fail-closed. *(closed 2026-07-14; adversarial verdict FULLY_CLOSED)*

**Dependencies:** M0. **Milestone id:** `M1`.

---

### M2 — [x] Harness resilience & I/O robustness

- [x] **#60** 429 backoff (full-jitter) + circuit breaker (per-provider, open/half-open) — verified; `Retry-After` also parses the HTTP-date form (adversarial-review fix). *(closed 2026-07-14)*
- [x] **#61** streaming idle timeout + truncation detection — idle timeout + OpenAI truncation guard verified; Anthropic truncation guard added (adversarial-review fix). *(closed 2026-07-14; a caller-readable max_tokens flag / {raw} payload passthrough are out of the shipped issue scope, documented)*
- [x] **#59** MCP reconnect-after-drop — bounded, re-armable reconnect (no permanent wedge after a transient outage exceeds the attempt bound; adversarial-review fix) + HTTP recovery test. *(closed 2026-07-14)*
- [x] **#63** persistence: batch, pagination, atomic turn append — verified; invalid pagination cursors now fail fast, cross-process lock proven with two real processes (adversarial-review fixes). *(closed 2026-07-14)*

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

- [x] A `PermissionMode` (`default | plan | acceptEdits | bypass`, `bypassPermissions` alias) resolved per run via `SendOptions`/`AgentOptions.permissionMode`; documented precedence (send > create > plugin construction > default). *(adversarial-review fix — was frozen at plugin construction; now threaded through the pre_tool_call context)*
- [x] A `canUseTool(toolName, input, ctx) => allow | deny` gate invoked BEFORE tool dispatch (every tool origin), bridged to the fail-closed veto path. Fail-closed on any non-`allow` decision *(adversarial-review fix — was fail-open on malformed returns)*.
- [x] Rules (`allow`/`deny`/`ask` by tool name + arg pattern) reusing the "match beyond name-only" work (#55). Deny is fail-closed; `g`/`y`-flag regex matchers are now deterministic *(adversarial-review fix)*.
- [x] TDD: gate fail-closed on error; mode precedence; denied call surfaces a typed `permission_denied` result. Unit + real-loop integration (bypass allows, plan denies).
- [x] Public-API change → docs.md (PermissionMode + canUseTool surface) + Changeset. *(closed 2026-07-14)*

**Dependencies:** M1 (fail-closed permission core), M3.

**Top risks (new):**
1. API surface creep — resist copying Anthropic's full 5-mode + rule-destination system; ship the minimal gate + modes. Mitigation: one gate + a small mode enum, no `destination` tiers.
2. Duplication with TheoKit's HITL / default-DENY (M34). Mitigation: the SDK ships the *primitive*; the framework *composes* it (same split as today) — do not reimplement the framework's surface here.

**Why now:** the Anthropic comparison ranked this our biggest operational gap; TheoKit already leans this way (#99 HITL fix, M34 default-DENY) and is the natural consumer.

### SE2 — [x] Typed runtime event stream

**Objective:** Expose a richer, discriminated runtime event stream from `Run.stream()` — surfacing
progress, rate-limit, permission-denied, and task-lifecycle events as **typed** messages (the Anthropic
`SDKMessage`-union approach) — for observability without parsing text. ADDITIVE to the existing a framework
`UIMessageStream`, never a replacement.

**Definition of done:**

- [x] A typed `RunEvent` discriminated union covering { tool_progress, rate_limit, permission_denied, task_started/updated/completed, compact_boundary } (+ tripwire, completion_check).
- [x] **Emitted end-to-end** (adversarial-review fix — 5/7 were dead): `rate_limit` (pool-aware client 429 retry), `compact_boundary` (session auto-compaction), `task_*` (opt-in `Task.submit({ onRunEvent })` bridge). Opt-in + non-breaking (no RunEvent enters `Run.stream()`); fail-safe sink.
- [x] TDD: unit (each emit site) + integration (per-run mode denial emits `permission_denied`; task bridge; onRateLimit; onCompact).
- [x] Docs + Changeset (`onRunEvent` surface in docs.md). *(closed 2026-07-14)*

**Dependencies:** SE1 (permission-denied event), M3 (observability core — EventBus/spans).

**Top risks (new):**
1. Reinventing a framework's UIMessageStream. Mitigation: these are ADDITIONAL runtime events (out-of-band), not a second content stream.
2. Scope explosion (Anthropic has ~40 variants). Mitigation: mirror only events with a real TheoKit consumer; add the rest on demand.

**Why now:** the comparison showed typed run-level messages are a genuine observability advantage; our stream is content-shaped only.

### SE3 — [x] Multi-agent provenance (`origin`)

**Objective:** Stamp `origin` provenance (human / peer / task-notification / coordinator /
auto-continuation) onto turns emitted in the multi-agent path (`Squad`, `a2a`, `handoff`,
background-delegation) and forward it onto the run result — so consumers can attribute/route turns by
who triggered them. Metadata-only; no behavior change.

**Definition of done:**

- [x] A `MessageOrigin` discriminated union (`types/run.ts`), stamped BY the SDK on the paths it initiates: `peer` (Squad step / a2a envelope), `coordinator` (subagent delegation, `a2a/subagent.ts`), `auto-continuation` (run/stream-to-completion driver rounds > 0). `human` and `task-notification` are documented as host-supplied positive markers; `handoff` ships in the external `@theokit/sdk-handoff` package (out of this tree).
- [x] Forwarded onto the run result — `RunResult.origin` (round-trips `SendOptions.origin`).
- [x] TDD: peer turn carries `{ kind: 'peer', from }` (message-origin.test.ts); coordinator stamp asserted on the delegated child's send (subagent-delegation.test.ts, 49/49); auto-continuation stamp asserted on round > 0 (run-to-completion.test.ts). `task-notification` covered as a host-supplied marker.
- [x] Docs + Changeset (`.changeset/se3-origin-stamping.md`).

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

- [x] `listSessions(opts)`, `getSessionMessages(id, opts)`, `renameSession(id, title)`, `tagSession(id, tag|null)` over `ConversationStorage` (works for FS + memory + external adapters).
- [x] Light metadata (summary, lastModified, firstPrompt) derived from the stored transcript.
- [x] Graceful degradation for write-only/listing-incapable adapters (typed "unsupported" signal, not a throw-on-every-call).
- [x] TDD: list/rename/tag round-trip on `FileSystemConversationStorage`.
- [x] Docs + Changeset.

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
- [x] ~~If runtime-owned: a minimal `checkpoint` / `rewind(messageId)` primitive~~ — N/A (ruled framework-owned).
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
- [x] ~~If material: a `prewarm(options)` + TDD + latency-delta~~ — N/A (measured negligible).
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

- [x] `ImageBlock` + `ToolResultContentBlock = TextBlock | ImageBlock` types; `ToolError` class carrying `string | ToolResultContentBlock[]`.
- [x] `CustomTool.handler` return widened to `string | ToolResultContentBlock[]` (symmetric — success may be multimodal); back-compat: string still works unchanged.
- [x] Block-capable provider wires carry blocks natively (text + image) on `tool_result.content`; **string-only provider wires fail fast** with a typed `ConfigurationError` on an image block (no silent degradation — per error-handling.md); text-only blocks flatten to a string everywhere. Naming is capability-based, not provider-specific.
- [x] TDD: handler-returns-image carries onto a block-capable wire; `ToolError([blocks])` → `tool_result` with `isError` + blocks; string-only wire + image → `ConfigurationError`; text-only blocks flatten to string.
- [x] Docs + Changeset.

**Dependencies:** existing tool dispatch (`tool-executors`/`tool-dispatch`), the provider wire mappers.

**Top risks (new):**
1. Breaking the string-only `tool_result` consumers (guard, wire mappers). Mitigation: `content: string | blocks` with a render helper for text-consumers; persistence/replay is event-based and untouched.
2. Provider divergence (some providers can't carry images in a tool-role message). Mitigation: typed `ConfigurationError` fail-fast, not silent drop.

**Why now:** the one real tool-ergonomics gap in a plain string-only tool result; user-requested.

### SE8 — [x] Model string shorthand (`model: "openai/gpt-4o-mini"`)

**Objective:** Accept a **bare string** model id (`model: "openai/gpt-4o-mini"`) everywhere a model is
selected — `AgentOptions.model` and `SendOptions.model` — in addition to the current
`{ id: string }` object. Every peer (a framework / a peer framework `"provider/model"`, OpenAI Agents, AI SDK)
takes a bare string; requiring `{ id: … }` is the single most constant first-5-minutes DX friction.
The id already parses a `provider/model` prefix — this is a boundary-normalization convenience, not a
routing change. From the DX comparison vs the 4 reference SDKs (2026-07-10).

**Definition of done:**

- [x] `AgentOptions.model` + `SendOptions.model` accept `string | ModelSelection`; a string is normalized to `{ id: string }` at ONE seam (not scattered).
- [x] Back-compat: the `{ id }` (and `{ id, params }`) object form is unchanged.
- [x] TDD: a string model resolves identically to `{ id }`; the `provider/` prefix still routes; params-requiring cases still use the object form (documented).
- [x] Docs + Changeset; update examples/templates to the shorthand.

**Dependencies:** none (purely additive DX; the model resolver already parses `provider/model`).

**Top risks (new):**
1. `ModelSelection.params` needs the object form. Mitigation: the string covers the common no-params case; document that tuning params requires `{ id, params }`.
2. A call site typed only as `ModelSelection` (not the new union) silently rejects a string. Mitigation: audit the model call sites; normalize once at the public boundary.

**Why now:** cheapest high-perception DX win from the reference comparison — near-trivial, additive.

### SE9 — [x] Integrated structured output on the run (`SendOptions.output`)

**Objective:** Return a **validated typed object FROM the agent run** — `agent.send(input, { output: schema })`
runs the tool loop and then coerces the final answer into the schema, surfaced on the run result —
instead of a separate `generateObject` call. Matches a framework `response_format` (`structured_response`)
and the AI SDK `Output.object` (`{ output }`). This is the most substantive DX-capability gap found in
the reference comparison: today you cannot say "run the loop AND give me a typed object" in one call.

**Definition of done:**

- [x] Delivered as `agent.generate(input, { output: schema })` → `GenerateRunResult.object` with the fully-inferred `z.infer<T>` type (API shape changed from the original `SendOptions.output`/`RunResult.output` sketch per the SE9 plan 2026-07-10, to preserve type inference — `RunResult.output` would have been `unknown`). A Zod `output` schema runs the tool loop then returns the validated structured object.
- [x] Tools still run first; structuring happens on the final turn. **Sugar over the existing `generateObject` synthetic-forced-tool machinery (ADR D33) — reuse, do NOT fork** (Don't-Reinvent).
- [x] Failure is typed: a schema-parse failure surfaces a typed error (not a silent empty/undefined).
- [x] Precedence with `toolChoice` / `maxIterations` defined + documented.
- [x] TDD: a run with tools + an `output` schema returns the typed object; a parse failure surfaces the typed error.
- [x] Docs + Changeset.

**Dependencies:** the existing `generateObject` (ADR D33 synthetic forced tool); SE2 (typed events, optional).

**Top risks (new):**
1. Duplicating the two-model reason→structure flow already in `generateObject`. Mitigation: compose over it, one structuring seam.
2. Streaming variant (`streamObject`) scope-creep. Mitigation: ship non-streaming `output` first; streamed structured output is a follow-up ADR.
3. Interaction with `toolChoice: "required"` / iteration ceiling. Mitigation: explicit precedence rules + tests.

**Why now:** the biggest DX-capability gap vs a framework + AI SDK; both integrate structured output into
the agent run and it is a common ask.

### SE10 — [x] Cancellation + option passthrough in subagent delegation

**Objective:** Forward the parent run's cancellation to an in-flight subagent. `defineSubAgent`'s
returned tool handler today calls `agent.send(input)` with NO options (`a2a/subagent.ts:60`), so an
aborted parent run does not cancel the child — it runs to completion, wasting tokens. The `CustomTool`
handler already receives an optional `ctx.signal` (`types/agent-prims.ts:71`, #65). Thread that
`AbortSignal` into the child `agent.send(input, { signal })`. Matches a peer framework "abortSignal forwarded to
delegated subagents; abort cancels in-flight subagent runs at their next step". From the a peer framework
supervisor-agents comparison (2026-07-10).

**Definition of done:**

- [x] `defineSubAgent`'s tool handler reads the optional `ctx.signal` and forwards it to the child `agent.send(input, { signal })`; an already-aborted or mid-run abort cancels the child (child resolves `cancelled`, not `finished`).
- [x] Back-compat: a handler invoked with no `ctx` (single-arg call sites) behaves exactly as today (no signal ⇒ no cancellation).
- [x] The child agent is still disposed in `finally` on cancel (no leak).
- [x] TDD: an aborted parent signal cancels the in-flight subagent (child run status `cancelled`); the un-aborted path still returns the child result.
- [x] Docs + Changeset.

**Dependencies:** none (the `ctx.signal` seam already exists per #65; purely additive).

**Top risks (new):**
1. `ctx.signal` may be absent on some dispatch paths. Mitigation: forward only when present; absent ⇒ current behavior.
2. Cancelling mid-dispose could throw. Mitigation: dispose in `finally`, swallow post-cancel dispose errors.

**Why now:** cheapest of the three supervisor-parity gaps; foundational for SE11/SE12 (establishes option-passing into the child run).

### SE11 — [x] Delegation lifecycle hooks (`onDelegationStart` / `onDelegationComplete`)

**Objective:** Let the caller intercept a delegation as it happens. a peer framework's supervisor exposes
`onDelegationStart` (proceed / reject with reason / rewrite prompt / cap steps) and
`onDelegationComplete` (inspect result / error / inject feedback / bail). TheoKit's `defineSubAgent`
has NO interception point — the handler runs the child unconditionally. Add optional hooks to
`SubAgentSpec` wired around the child run. From the a peer framework supervisor-agents comparison (2026-07-10).

**Definition of done:**

- [x] `SubAgentSpec.onDelegationStart?(ctx: { input; name }) => { proceed: boolean; rejectionReason?; modifiedInput? } | void` — `proceed: false` short-circuits (returns the `rejectionReason` as the tool result, the child never runs); `modifiedInput` rewrites the prompt sent to the child.
- [x] `SubAgentSpec.onDelegationComplete?(ctx: { input; name; result?; error? }) => { feedback? } | void` — runs after the child; optional `feedback` is appended to the returned result string.
- [x] Hooks are optional and fail-loud: a throwing hook surfaces a typed error, never a silent swallow (Rule 8).
- [x] Back-compat: specs without hooks behave exactly as today.
- [x] TDD: reject path returns `rejectionReason` without running the child; `modifiedInput` rewrites; `onDelegationComplete` feedback is appended; a child error is surfaced to `onDelegationComplete`.
- [x] Docs + Changeset.

**Dependencies:** SE10 (option-passing seam into the child run).

**Top risks (new):**
1. Hook error semantics ambiguity (throw vs swallow). Mitigation: a throwing hook ⇒ typed error, documented; no silent swallow.
2. `modifiedMaxSteps` needs child `maxIterations` plumbing. Mitigation: ship `proceed`/`rejectionReason`/`modifiedInput` first; add `modifiedMaxSteps` only if the child `send` already supports an iteration cap, else defer with a note.

**Why now:** the highest-control supervisor-parity gap; unlocks guardrails (reject after N iterations, rewrite the delegated prompt) that today require wrapping the tool by hand.

### SE12 — [x] Opt-in parent-context forwarding + `messageFilter` for subagents

**Objective:** Let a subagent optionally see a filtered view of the supervisor's conversation.
Today `defineSubAgent` sends ONLY a fresh `input` string — full memory isolation, a deliberate
strength. a peer framework forwards the full conversation and exposes `messageFilter` to trim it. Add an OPT-IN
`messageFilter` to `SubAgentSpec`: when present, the parent's messages (filtered) are forwarded to the
child as prior context; when absent, the current isolated behavior is preserved (isolation stays the
default). From the a peer framework supervisor-agents comparison (2026-07-10).

**Definition of done:**

- [x] `SubAgentSpec.messageFilter?({ messages; input; name }) => messages` — when set, the returned (filtered) parent messages are forwarded to the child run as prior context; when absent, the child runs input-only (unchanged; isolation-by-default preserved).
- [x] Parent messages are exposed to the delegation handler WITHOUT sending nested tool args back into the supervisor model (mirrors a peer framework's "scoped memory saves").
- [x] Security: the filter is the ONLY path that widens child context; no accidental full-transcript leak when `messageFilter` is absent.
- [x] TDD: with `messageFilter` returning a subset, the child receives exactly that subset; without it, the child receives input only; a filter dropping a "confidential" message keeps it out of the child context.
- [x] Docs + Changeset; ADR if runtime message-exposure requires a new seam.

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
`DelegationStartDecision` and forward it as `maxIterations` to the child `agent.send`. Matches a peer framework's
`onDelegationStart.modifiedMaxSteps`. From the a peer framework supervisor-agents comparison (2026-07-10).

**Definition of done:**

- [x] `DelegationStartDecision` gains `modifiedMaxSteps?: number`; when set (and `proceed !== false`), `defineSubAgent` forwards it as `maxIterations` to the child `agent.send(input, { maxIterations })`.
- [x] Composes with SE10 (signal) + SE12 (messageFilter preamble): all merge onto ONE child `send` call.
- [x] Back-compat: absent `modifiedMaxSteps` ⇒ the child uses its default iteration ceiling (unchanged).
- [x] TDD: a decision with `modifiedMaxSteps: 3` calls the child `send` with `maxIterations: 3`; absent leaves the child call unchanged; the option coexists with a forwarded `signal`.
- [x] Docs + Changeset.

**Dependencies:** SE11 (the `onDelegationStart` hook + `DelegationStartDecision`); SE10 (the child-send option seam).

**Top risks (new):**
1. Option-merge collision on the child `send` (signal + maxIterations + messageFilter preamble). Mitigation: build one `SendOptions` object; the preamble is on `input`, the rest are distinct keys.
2. A `modifiedMaxSteps` of 0 / negative. Mitigation: decide in plan — forward as-is (the loop already floors the ceiling) OR validate and reject with a typed error; document the choice.

**Why now:** completes the SE11 hook contract at near-zero cost (the child cap already exists); the last missing piece of `onDelegationStart` parity.

### SE14 — [x] Subagent result-context control (`includeToolResults`)

**Objective:** Control what a completed subagent surfaces back to the supervisor. Today `defineSubAgent`
returns only the child's final text (`RunResult.result`). a peer framework defaults to text-only and exposes
`includeSubAgentToolResultsInModelContext` to also fold the child's nested tool results into the
supervisor context. Add an opt-in `SubAgentSpec.includeToolResults`: when set, the child's tool-call
results are appended to the delegation payload surfaced to the supervisor; text-only stays the default
(a peer framework's "scoped" posture). Pairs with SE12 (context IN) to complete the subagent context boundary
(context OUT). From the a peer framework supervisor-agents comparison (2026-07-10).

**Definition of done:**

- [x] `SubAgentSpec.includeToolResults?: boolean` (default `false` = text-only, unchanged). When `true`, the child's tool-call results are appended to the delegation result returned to the supervisor.
- [x] The default (`false`) preserves today's text-only behavior EXACTLY (regression-tested).
- [x] Nested tool args are not silently re-injected beyond what the option opts into (mirrors a peer framework's scoped default).
- [x] TDD: with `includeToolResults: true` the returned payload contains the child's tool result; with `false` (default) it is text-only.
- [x] Docs + Changeset; **ADR** if surfacing the child's tool results requires a new `RunResult` field or a `run.stream()` capture.

**Dependencies:** SE10 (child-send seam). **May need a `RunResult` tool-results surface** — `RunResult` currently exposes only `result?: string`, so capturing the child's tool results likely needs a new additive field OR a `run.stream()` event capture (gate behind an ADR).

**Top risks (new):**
1. `RunResult` does not expose tool calls / results today (only `result?: string`, `types/run.ts`). Mitigation: add a minimal additive `RunResult` tool-results surface OR capture via `run.stream()`; decide in plan/ADR — keep additive + backward-compatible.
2. Leaking large nested tool payloads into the supervisor context (token blow-up). Mitigation: opt-in only; document the cost; consider a size cap in plan.

**Why now:** the remaining delegation-result gap vs a peer framework; with SE12 (context IN) it gives full, opt-in control of the subagent context boundary in BOTH directions.

### SE15 — [x] `iteration` count in delegation-hook context (reject-after-N)

**Objective:** Give `onDelegationStart` / `onDelegationComplete` the current delegation iteration count
so a hook can decide on it — a peer framework's documented "reject delegation after too many iterations"
(`if (context.iteration > 8) return { proceed: false, rejectionReason }`). a peer framework's delegation context
is `{ primitiveId, prompt, iteration }`; TheoKit's `DelegationStartContext` today is `{ input, name }` —
it can reject (SE11) but has NO iteration count to base the decision on. Add a per-`defineSubAgent`-instance
invocation counter surfaced as `iteration` on both hook contexts. From the a peer framework supervisor-agents
comparison (2026-07-10).

**Definition of done:**

- [x] `DelegationStartContext` + `DelegationCompleteContext` gain `iteration: number` — the 1-based count of times THIS subagent tool has been invoked (a per-`defineSubAgent`-instance closure counter).
- [x] The counter increments once per handler invocation BEFORE `onDelegationStart` runs, so the hook sees the current iteration; a rejected (`proceed:false`) delegation still counts as an iteration.
- [x] Back-compat: hooks that ignore `iteration` are unaffected; specs without hooks are unchanged.
- [x] TDD: three successive delegations see `iteration` 1, 2, 3; a hook rejecting when `iteration > 2` lets the first two run and rejects the third (child never runs on the third); `onDelegationComplete` sees the same iteration as its `onDelegationStart`.
- [x] Docs + Changeset.

**Dependencies:** SE11 (the hook contexts `DelegationStartContext` / `DelegationCompleteContext`).

**Top risks (new):**
1. Counter scope ambiguity (per-tool-instance vs per-run). Mitigation: a per-`defineSubAgent`-instance closure counter — documented; a fresh `defineSubAgent(...)` starts at 1. Matches a peer framework's per-subagent iteration semantics.
2. Concurrency (parallel delegations of the same tool instance). Mitigation: the increment is synchronous at handler entry; document that the count reflects invocation order, not wall-clock concurrency.

**Why now:** completes the `onDelegationStart` CONTEXT parity — SE11 gave the decision, SE13 gives the cap, SE15 gives the signal to decide on; the reject-after-N-iterations pattern needs it.

### SE16 — [x] `outputSchema` on `defineTool` (validate the tool's return)

**Objective:** Let a tool declare and validate its OUTPUT shape. `defineTool` today validates only
`inputSchema` (Zod, `define-tool.ts:25`) — the handler's return is passed through unvalidated. a peer framework's
`createTool` takes an `outputSchema`. Add an optional `outputSchema?: ZodType` to `DefineToolSpec`; when set,
the handler's return is validated against it before becoming the tool result, and the return type is inferred
from it. From the a peer framework Tools comparison (2026-07-10).

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
not the app-vs-model split). a peer framework's `toModelOutput` and the a peer framework both separate these. Add an
optional `toModelOutput(output) => string | ToolResultContentBlock[]` to `DefineToolSpec`: the handler's
full return flows to the application / observability, while `toModelOutput` maps it to the compact
model-facing `tool_result`. From the a peer framework Tools comparison (2026-07-10).

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

**Why now:** the real tool-output DX gap vs a peer framework + AI SDK; keeps model context small without losing the app's full result.

### SE18 — [x] `activeTools` — per-send runtime tool subset

**Objective:** Let a caller restrict, per `send`, WHICH of the agent's registered tools the model may call.
Today `SendOptions.toolChoice` (`auto/none/required`, `types/run.ts:330`) gates WHETHER tools are called, not
which subset; a peer framework's `activeTools` (and the AI SDK's) narrow the available tools at runtime. The enforcement
mechanism already exists — `withToolWhitelist` (`internal/runtime/concurrency/async-local-storage.ts:31`, used
by `Agent.fork`'s `allowedTools` + subagent tool-scoping). Add `SendOptions.activeTools?: string[]` that
applies that whitelist for the duration of the send. From the a peer framework Tools comparison (2026-07-10).

**Definition of done:**

- [ ] `SendOptions.activeTools?: string[]`; when set, only tools whose canonical (post-repair, lowercase) name is in the list are dispatchable for that send — any other tool call is vetoed via the existing `withToolWhitelist` dispatch path (NOT `PermissionEngine`), same as `fork`'s `allowedTools`.
- [ ] Composes with `toolChoice`: `activeTools` narrows the set; `toolChoice` gates calling within it.
- [ ] Back-compat: absent `activeTools` ⇒ the full toolset is available (unchanged).
- [ ] TDD: with `activeTools: ["a"]`, tool `a` dispatches and tool `b` is vetoed; absent ⇒ both available.
- [ ] Docs + Changeset.

**Dependencies:** none (reuses `withToolWhitelist`; additive on `SendOptions`).

**Top risks (new):**
1. Whether `activeTools` also hides the tools from the advertised catalog (not just veto dispatch). Mitigation: decide in plan — veto-at-dispatch is the minimum; catalog-filtering (fewer wasted calls, matches a peer framework) ships if the loop's tool-advertise seam allows it cleanly.
2. Name canonicalization must match the whitelist. Mitigation: reuse the same canonicalization `fork`/subagent-scope use.

**Why now:** completes the runtime tool-control pair with the existing `toolChoice`, reusing a proven whitelist.

### SE19 — [x] `workflowAsTool` — expose a Workflow as an agent tool

**Objective:** Let an agent call a `Workflow` as a tool, completing the a peer framework "X as tools" trio (tools;
agents-as-tools via `defineSubAgent`, SE10–15; workflows-as-tools). a peer framework converts a workflow to a
`workflow-<key>` tool using its `inputSchema`/`outputSchema`. TheoKit's `Workflow` already exposes
`inputSchema?`/`outputSchema?` (`types/workflow.ts:34-35`) and `run(input) => WorkflowRun<TOutput>`
(`workflow.ts:251`). Add a `workflowAsTool(workflow, { name, description })` helper that returns a
`CustomTool` whose handler runs the workflow and returns its output. From the a peer framework Tools comparison (2026-07-10).

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

**Why now:** completes the a peer framework "X as tools" trio; the `Workflow` primitive already carries the schemas the helper needs, so it is a thin, additive composition.

### SE20 — [x] `agent.skills.get(name)` — read a skill's full body programmatically

**Objective:** Programmatic access to a skill's INSTRUCTIONS from application code. `agent.skills.list()`
already exists (`SDKAgentSkills.list()`, `types/agent.ts:121`) but returns name + description only
(`SystemPromptSkillRef`), never the body. a peer framework exposes `agent.getSkill(name)` returning the skill WITH
its `instructions`. Add `SDKAgentSkills.get(name)` that returns the full skill — name, description, and the
body (read from the SKILL.md `source` for filesystem skills, or the inline `instructions` for `createSkill`
skills). From the a peer framework Agent-skills comparison (2026-07-10).

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
`references/` directory. a peer framework's `createSkill` takes a `references: { 'file.md': '...' }` map. TheoKit's
`CreateSkillSpec` (`create-skill.ts`) has only name / description / instructions — an inline skill cannot
carry references. Add an optional `references?: Record<string, string>` to `CreateSkillSpec`, surfaced via
SE20's `get(name)` (and readable by the consumer). From the a peer framework Agent-skills comparison (2026-07-10).

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

**Objective:** Per-request skill resolution. a peer framework accepts `skills: ({ requestContext }) => SkillInput[]`
so an agent picks its skills from runtime context (e.g. user role). TheoKit's `AgentOptions.skills` is a
STATIC `SkillsSettings` object. TheoKit ALREADY has a dynamic **systemPrompt** resolver
(`types/agent.ts:343`); mirror that shape for skills — accept a resolver function evaluated per run. From
the a peer framework Agent-skills comparison (2026-07-10).

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

### SE23 — [x] `defineSkillReadTool` — opt-in model-facing lazy skill read

**Objective:** Give the MODEL on-demand access to a skill's full body + references via an OPT-IN tool —
WITHOUT auto-injecting a built-in tool (bring-your-own-tools). a peer framework ships `skill_read`/`skill_search`
tools that auto-inject; TheoKit uses the eager `<skills>` system-prompt block (name + description) for
discovery. Add a `defineSkillReadTool(skills)` FACTORY (sibling of `defineSubAgent` / `workflowAsTool`)
that returns a `CustomTool` the consumer explicitly adds to the agent's `tools`; when the model calls it
with a skill name, it returns that skill's `instructions` (+ SE21 `references`). Opt-in preserves the
bring-your-own-tools principle — the SDK does NOT auto-inject skills tools. From the a peer framework Agent-skills
comparison (2026-07-10).

**Definition of done:**

- [ ] `defineSkillReadTool(skills: InlineSkill[])` returns a `CustomTool` (name `skill_read`) whose input is a skill name; the handler returns the matching skill's `instructions` and (SE21) `references`; an unknown name returns a typed "not found" tool result (a string the model can act on, NOT a throw that kills the run).
- [ ] The tool is OPT-IN — the consumer adds it to `tools`; the SDK never auto-injects it (bring-your-own-tools preserved).
- [ ] Back-compat: nothing changes for agents that don't add the tool.
- [ ] TDD: the tool returns a skill's body + references by name; an unknown name returns the not-found result; the returned value is a valid `CustomTool`.
- [ ] Docs + Changeset; **ADR** recording the opt-in-factory decision (vs a peer framework's auto-injected tools) + the eager-block + lazy-read hybrid.

**Dependencies:** SE21 (`references` on the inline skill — the tool surfaces them).

**Top risks (new):**
1. Bring-your-own-tools boundary. Mitigation: a FACTORY the consumer adds (like `defineSubAgent` / `workflowAsTool`), never auto-injected — the ADR records this as the resolution of the disclosure-mechanism question (§ Explicitly out of scope built-in tools stays intact: this ships a factory, not an auto-injected toolset).
2. Skill body size in the tool result. Mitigation: return the body as-is; the consumer controls which skills they expose by choosing what to pass to the factory.

**Why now:** completes the a peer framework skills-read parity as an OPT-IN factory (consistent with `defineSubAgent` / `workflowAsTool`), resolving the eager-block-vs-lazy-tool question without violating bring-your-own-tools.

### SE24 — [x] Guardrail processor pipeline seam (input/output, strategy, tripwire, onViolation)

**Objective:** Add a message-level guardrail seam. a peer framework ships `inputProcessors` / `outputProcessors` — a
pipeline that runs before the LLM (input) and before the response reaches the user (output), where each
processor may normalize / validate / transform / block content via a `strategy` (block/warn/detect/redact/
rewrite/translate), calling `abort()` to stop the run (surfaced as `result.tripwire` on generate + a
`tripwire` chunk on stream), and firing an `onViolation` callback. TheoKit today has a **tool-side** guardrail
only (`pre_tool_call` veto + `PermissionEngine`, SE1); the **message-side** seam is absent — `pre_user_send`
only injects `<memory-context>` (can't block/rewrite the input) and `post_assistant_reply` is fire-and-forget
(can't redact the output). Even a plugin cannot build an input/output guardrail today. Add the runtime seam:
a `Processor` interface + `AgentOptions.inputProcessors` / `outputProcessors`, provider-agnostic and
in-process, with NO LLM baked in (LLM-classifier processors are the consumer's — SE26). From the a peer framework
Guardrails comparison (2026-07-10).

**Definition of done:**

- [ ] A public `Processor` interface: `{ id; processInput?(ctx) => messages | abort; processOutput?(ctx) => output | abort; onViolation? }` (exact shape decided in the plan/ADR — reuse vs extend the existing hook seam is an explicit ADR choice).
- [ ] `AgentOptions.inputProcessors?` run in order before the LLM call; each may rewrite the user message(s) or `abort(reason)`. `outputProcessors?` run in order on the model response before it reaches the caller; each may rewrite/redact or `abort(reason)`.
- [ ] `strategy` support: at minimum `block` (abort) + `rewrite`/`redact` (transform-and-continue); `warn`/`detect` are non-blocking (fire `onViolation`, continue). `translate` is a processor concern (SE26 delegated), not a core strategy requirement.
- [ ] `abort()` semantics: an aborted run yields a typed tripwire — `result.tripwire { reason, processorId }` on the wait/generate path AND a `tripwire` run-event on the stream path (mirror `SendOptions.onRunEvent` / `RunEvent`). Subsequent processors do NOT run after an abort.
- [ ] `onViolation(ProcessorViolation { processorId, message, detail })` fires on abort AND on `warn`; callback errors are swallowed (never break the pipeline).
- [ ] Back-compat: no processors ⇒ behavior identical to today. Cloud agents reject function-carrying processors (mirror the systemPrompt/skills resolver cloud rule) OR the ADR records how processors serialize.
- [ ] TDD: an input `block` processor aborts before the LLM (tripwire, no model call); an input `rewrite` processor mutates the message the model sees; an output `redact` processor transforms the returned text; `onViolation` fires with the right payload; ordering + short-circuit-on-abort are asserted.
- [ ] Docs + Changeset + **ADR** (seam design: dedicated pipeline vs extending `pre_user_send`/`post_assistant_reply`; tripwire shape; cloud serialization).

**Dependencies:** none (extends the local runtime; reuses the SE2 `RunEvent` stream + the SE1 abort/veto precedent).

**Top risks (new):**
1. Overlap with the existing plugin hook seam (`pre_user_send` / `post_assistant_reply` / `pre_tool_call`). Mitigation: the ADR decides reuse-vs-new explicitly; if extended, `pre_user_send` gains a block/rewrite result and `post_assistant_reply` gains a redact result — no second parallel system unless justified (KISS / DRY).
2. Output redaction on the STREAM path (redacting tokens mid-stream is harder than on a buffered result). Mitigation: v1 may scope output processors to the buffered/`wait()` path with streaming redaction deferred to a follow-up (documented), mirroring a peer framework's `processOutputStream` being a separate, heavier hook.

**Why now:** it is the load-bearing seam — SE25 (deterministic processors) and SE26 (delegated classifier processors) both build on it, and without it neither the SDK nor a plugin can guard input/output messages at all. Closes the message-side half of the guardrail story (the tool-side already shipped in SE1).

### SE25 — [x] Deterministic in-tree processors (UnicodeNormalizer, BatchParts, TokenLimiter)

**Objective:** Ship the cheap, deterministic, no-LLM processors on the SE24 seam. These don't churn (no
provider/model deltas, no taxonomy tuning) so they are safe to own in-core, unlike the classifier processors
(SE26). a peer framework ships `UnicodeNormalizer` (Unicode/whitespace/control-char cleanup), `BatchPartsProcessor`
(coalesce stream chunks to cut network overhead), and `TokenLimiterProcessor` (cap tokens). From the a peer framework
Guardrails comparison (2026-07-10).

**Definition of done:**

- [x] `UnicodeNormalizer` input processor: NFC-normalize (stdlib `String.prototype.normalize`), collapse whitespace, strip control chars — options `{ stripControlChars?, collapseWhitespace? }`. Pure/deterministic; no LLM.
- [x] `TokenLimiter` processor: cap input and/or output tokens against a limit; uses a char-based estimate (~chars/4, no tokenizer dep — parsimony rung 4) documented as an estimate; `strategy: "truncate" | "block"`. Fires on whichever array it is placed in. Options `{ limit, strategy? }`.
- [x] **`BatchPartsProcessor` — DEFERRED (architectural finding, not skipped).** Discovered during implementation: TheoKit's `run.stream()` emits **full `SDKAssistantMessage`s** (`content: Array<TextBlock | ToolUseBlock>`), NOT token-granular deltas. a peer framework's `BatchPartsProcessor` coalesces SSE chunks to cut NETWORK overhead over HTTP; the in-process runtime has no such chunk-stream to coalesce (nothing to batch → a no-op). It becomes meaningful only when an HTTP/SSE streaming transport lands — the SAME future milestone as SE24's deferred streaming-output redaction. Reopening tracked with that streaming milestone.
- [x] The two shipped processors are OPT-IN (added to `inputProcessors`/`outputProcessors`); nothing auto-injects them; back-compat preserved.
- [x] TDD: normalizer folds a known Unicode/whitespace/control-char fixture to the expected string; token limiter enforces the cap (truncate + block) on a fixture over/under the limit.
- [x] Docs + Changeset.

**Dependencies:** SE24 (the `Processor` seam these implement).

**Top risks (new):**
1. `TokenLimiter` needing a real tokenizer (model-specific). Mitigation: char-based estimate (~chars/4), documented as an estimate not an exact per-model count (KISS) — an exact tokenizer is deferred with demand evidence.
2. `BatchPartsProcessor` fit. Resolved by DEFERRAL above — the in-process stream emits full messages, so batching has no overhead to reduce until an HTTP/SSE transport exists.

**Why now:** these are the guardrails a consumer can adopt with zero external dependency and zero LLM cost — the safe, high-value first fill of the SE24 seam, proving the pipeline before the delegated classifiers land.

### SE26 — [x] Delegate LLM-classifier processors (moderation / PII / injection) — ADR + recommendation + example

**Objective:** Record the decision to DELEGATE the LLM-classifier guardrail processors — `ModerationProcessor`,
`PIIDetector`, `PromptInjectionDetector`, `LanguageDetector`, `SystemPromptScrubber` — to specialist libraries
/ consumer code built ON the SE24 seam, rather than shipping concrete classifiers in `@theokit/sdk` core. The
rationale mirrors AUTH-DELEGATION (this repo's locked precedent): these processors carry constant churn
(provider/model deltas, category taxonomies, threshold tuning, evolving jailbreak patterns); a single-maintainer
core cannot keep them current, while the SE24 seam (a stable interface) does not churn. This is a gated-decision
milestone (ADR + docs + example), NOT runtime code in core — same shape as SE5/SE6. From the a peer framework Guardrails
comparison (2026-07-10).

**Definition of done:**

- [ ] An **ADR** recording: (a) the SE24 seam is the extension point; (b) LLM-classifier processors are delegated (not shipped in core); (c) re-evaluation triggers (team ≥ 3 engineers, or ≥ N shipped apps blocked) mirroring AUTH-DELEGATION; (d) if ever adopted, they ship as separate optional `@theokit/guardrail-*` packages, never in core.
- [ ] A `docs/concepts/guardrails.md` recommendation page: how to build moderation / PII / injection / language / prompt-scrubber processors on the SE24 seam, with recommended external classifiers.
- [ ] A **worked example** (in `examples/`) of a moderation-style processor built on the SE24 seam calling an external classifier (a stub/fake classifier is acceptable for the example — the point is the seam wiring, not a bundled model).
- [ ] NO concrete classifier processor added to `@theokit/sdk` core (verifiable: no new `Moderation`/`PII`/`Injection` runtime export).
- [ ] Changeset (docs/ADR only — no minor API surface unless the example needs a tiny seam helper).

**Dependencies:** SE24 (the seam the delegated processors build on).

**Top risks (new):**
1. Users reading "delegated" as "unsupported". Mitigation: the docs page ships concrete recommended libs + a working example, exactly like the AUTH-DELEGATION recommendation page — delegation with a paved path, not a shrug.
2. Pressure to ship one classifier "just for PII". Mitigation: the ADR names the re-evaluation trigger; a one-off classifier in core is the exact churn trap AUTH-DELEGATION was written to avoid.

**Why now:** it closes the guardrails story honestly — the seam (SE24) + deterministic processors (SE25) ship in core; the churning LLM-classifier processors are delegated with a paved path, keeping the single-maintainer core maintainable (consistent with the locked AUTH-DELEGATION posture).

### SE27 — [x] Workflow-level `inputSchema` / `outputSchema` (validate the whole-workflow I/O)

**Objective:** Validate a workflow's overall input and final output, not just per-step. a peer framework's
`createWorkflow({ inputSchema, outputSchema })` validates the data the workflow accepts and returns.
TheoKit's `Workflow.create(options)` takes only `{ name, persistence, workflowId }` — schemas live
per-step on `FnStep` (the SE19 finding — a Workflow carries NO top-level schema, which is why
`workflowAsTool` had to take `inputSchema` from its caller). Add optional `inputSchema?` / `outputSchema?`
to `WorkflowOptions`: when present, validate `run(input)` against `inputSchema` (fail fast, typed error)
and the final output against `outputSchema` before returning. From the a peer framework Workflows comparison (2026-07-10).

**Definition of done:**

- [ ] `WorkflowOptions.inputSchema?: ZodType` / `outputSchema?: ZodType` (optional, back-compat: absent ⇒ no whole-workflow validation, exactly as today).
- [ ] `Workflow.run(input)` validates `input` against `inputSchema` (when set) BEFORE executing step 1 — a mismatch fails fast with a typed `WorkflowInputError` (Rule 8), never a silent coerce.
- [ ] The final workflow output is validated against `outputSchema` (when set) before `WorkflowRun.output` is populated — a mismatch surfaces as `status: "failed"` with a typed error (not a throw that escapes `run()`).
- [ ] `workflowAsTool` MAY read `workflow`'s `inputSchema` when the spec omits one (removing the SE19 caller-must-supply requirement when the workflow now declares it) — optional sub-goal, gated on not breaking the SE19 structural `{ run }` contract.
- [ ] Typed inference: `Workflow.create<I, O>` continues to infer, and `inputSchema`/`outputSchema` (when Zod) refine `TInput`/`TOutput`.
- [ ] TDD: a valid input passes; an invalid input fails fast with the typed error before any step runs; an output-schema mismatch yields `status: "failed"`; absent schemas ⇒ unchanged.
- [ ] Docs + Changeset.

**Dependencies:** none (extends `WorkflowOptions`; the executor already has the input at entry + the output at exit).

**Top risks (new):**
1. Interaction with `workflowAsTool` (SE19), which takes `inputSchema` from its spec. Mitigation: the tool keeps accepting a spec `inputSchema`; reading the workflow's is an additive fallback, not a breaking change to the structural `{ run }` type.
2. Output validation on a `suspended`/`failed` run. Mitigation: only validate output on the terminal `completed` path; suspended/failed runs skip output validation (documented).

**Why now:** closes the honest SE19 debt (a Workflow carrying no top-level schema) and matches a peer framework's whole-workflow validation — the cheapest, highest-clarity workflow gap.

### SE28 — [x] Workflow `.stream()` — step-event stream during execution

**Objective:** Emit workflow events as steps run, not just the terminal result. a peer framework's `run.stream()` +
`fullStream` let a caller monitor progress / trigger actions as steps complete. TheoKit's `workflow.run(input)`
is start-only (awaits the whole run). Add `workflow.stream(input)` returning an async iterator of typed
workflow events (`step_started` / `step_completed` / `step_failed` / `workflow_suspended` / `workflow_completed`),
terminating with the same `WorkflowRun` the `run()` path returns. This is a STEP-event stream (coarse-grained),
distinct from the token-delta streaming deferred in SE24 — the executor already knows step boundaries. From the
a peer framework Workflows comparison (2026-07-10).

**Definition of done:**

- [ ] `Workflow.stream(input, opts?)` returns `AsyncIterable<WorkflowEvent>` where `WorkflowEvent` is a typed union discriminated on `type` (`step_started`/`step_completed`/`step_failed`/`workflow_suspended`/`workflow_completed`), each carrying the relevant `stepId` / `output` / `error`.
- [ ] The stream terminates when the run does; the terminal `WorkflowRun` is reachable (e.g. `stream.result` OR a final `workflow_completed` event carrying it) — same shape as `run()`.
- [ ] Back-compat: `run(input)` is unchanged (may be re-expressed as draining `stream()` internally, but its signature + result are identical).
- [ ] Events fire in execution order; a suspended workflow emits `workflow_suspended` then the stream ends (resumable via `Workflow.resume`).
- [ ] TDD: a 2-step workflow emits `step_started`/`step_completed` for each in order then `workflow_completed`; a failing step emits `step_failed`; a suspend emits `workflow_suspended`.
- [ ] Docs + Changeset.

**Dependencies:** none (the executor drives steps sequentially; add an event sink).

**Top risks (new):**
1. Parallel/foreach steps emitting interleaved events. Mitigation: v1 defines ordering as "emission order is execution order"; concurrent branches emit as they resolve (documented; deterministic per-branch, not cross-branch).
2. Coupling `run()` to the stream drain. Mitigation: keep `run()` as the authoritative terminal path; `stream()` is additive — a bug in streaming must never change `run()`'s result.

**Why now:** long/multi-step workflows are opaque today (only the terminal result is observable); step events unlock progress UIs + side-effects, and the executor already has the step boundaries.

### SE29 — [x] Workflow state (`stateSchema` + `state` / `setState` in the step context)

**Objective:** Share values across steps without threading them through every step's input/output. a peer framework's
step `execute` receives `state` + `setState`, typed by a workflow `stateSchema`, for progress tracking /
accumulation / shared config. TheoKit's `StepContext` (runId / signal / log / suspend) has no shared state —
data flows step→step only via return values. Add an optional workflow `stateSchema` + `state` (read) and
`setState` (write) on `StepContext`, persisted across suspend/resume alongside the snapshot. From the a peer framework
Workflows comparison (2026-07-10).

**Definition of done:**

- [ ] `WorkflowOptions.stateSchema?: ZodType` + `WorkflowOptions.initialState?` (validated against it). `StepContext` gains `state: TState` (read) + `setState(next: TState): void` (write) — absent schema ⇒ no state surface (back-compat).
- [ ] State mutations are visible to subsequent steps in the same run; `setState` validates against `stateSchema` (typed error on mismatch — Rule 8).
- [ ] State is captured in the `WorkflowSnapshot` and restored on `Workflow.resume` (bump `_schemaVersion` if the snapshot shape changes; migrate/guard old snapshots).
- [ ] TDD: step 1 sets state, step 2 reads the updated value; `setState` with an invalid shape fails fast; state survives a suspend→resume round-trip.
- [ ] Docs + Changeset.

**Dependencies:** none (extends `StepContext` + the executor's per-run context; touches the snapshot shape — coordinate with the persistence version).

**Top risks (new):**
1. Snapshot schema-version bump breaking existing persisted runs. Mitigation: version-guard `WorkflowSnapshot._schemaVersion`; a v1 snapshot without state resumes with `initialState` (documented migration).
2. Concurrent `setState` in parallel branches. Mitigation: v1 documents last-write-wins within a run; state is not a concurrency primitive (use step outputs for branch-local data).

**Why now:** cross-step shared state is a core workflow ergonomic (progress counters, accumulators) that today forces threading data through every step's schema — the most-requested a peer framework workflow ergonomic after control flow.

### SE30 — [x] Workflows-as-steps (nested `.then(childWorkflow)`) + `cloneWorkflow`

**Objective:** Compose a workflow inside another, and clone a workflow under a new id. a peer framework lets
`.then(childWorkflow)` nest a committed workflow as a step, and `cloneWorkflow(wf, { id })` reuse logic under
a distinct id (separate logs/observability). TheoKit's `.then()` accepts only a `Step` (a Workflow is not a
Step), and there is no clone. Add: (a) a way to use a committed `Workflow` as a step (wrap it as a
`WorkflowStep` the executor runs by delegating to `childWorkflow.run(input)`); (b) `cloneWorkflow(wf, { id })`
returning an independent Workflow with a new id/name. From the a peer framework Workflows comparison (2026-07-10).

**Definition of done:**

- [ ] A committed `Workflow` can be used as a step — either `.then(workflow)` accepts a `Workflow` (wrapping it as a `WorkflowStep`) OR an explicit `workflowStep(child)` factory (decide in the plan/ADR). The nested workflow runs via its own executor; its output becomes the step output; a nested failure/suspend propagates to the parent run status.
- [ ] `cloneWorkflow(wf, { id })` returns a new independent `Workflow` with the given id/name and the same committed steps — clones run independently and surface as distinct in Task/observability.
- [ ] Nested suspend/resume: a suspended child surfaces the parent as `suspended` (v1 MAY restrict resume-through-nesting with a documented limitation if the snapshot can't address a nested step — decide in the plan).
- [ ] Step-id uniqueness across nesting is validated (the existing `validateUniqueIds` walk extends to the nested workflow's steps, or the nested run is treated as one opaque step id — decide in the plan).
- [ ] TDD: a parent workflow whose middle step is a child workflow runs end-to-end and the child's output flows on; a cloned workflow runs independently under its new id; a nested failure fails the parent.
- [ ] Docs + Changeset; **ADR** if nested suspend/resume semantics need a snapshot-shape decision.

**Dependencies:** SE28 is NOT required; nesting composes with the existing executor. (If SE28 shipped, nested step events SHOULD surface — coordinate.)

**Top risks (new):**
1. Nested suspend/resume + snapshot addressing (a snapshot's `currentStepId` inside a nested workflow). Mitigation: v1 MAY treat a nested workflow as opaque for resume (resume re-runs the nested child from its start) OR record a nested path — the ADR decides; document the chosen limitation.
2. Step-id collisions across parent + child. Mitigation: extend `validateUniqueIds` to walk nested workflows, or namespace nested ids — decide in the plan.

**Why now:** composition + cloning are the workflow reuse primitives (build big flows from small ones); `.then(childWorkflow)` is the most-cited a peer framework workflow-composition feature TheoKit lacks.

### SE31 — [x] `Filesystem` provider seam (pluggable file backend, mirrors `SandboxBackend`)

**Objective:** Today the `@theokit/sdk-tools` file factories (`createReadFileTool` / `createWriteFileTool` /
`createListDirTool` / `createGlobTool` / `createSearchTextTool`) operate directly on the local filesystem (or a
passed `cwd`). a peer framework Workspaces separate the *filesystem provider* (Local / S3 / GCS, plus a per-request
resolver) from the tools that use it — the runtime-legitimate half of "Workspaces". Add a `FilesystemBackend`
protocol that mirrors the existing `SandboxBackend` (ADR D1 — a minimal set of abstract methods with higher-level
operations derived on the base class), a `LocalFilesystem` implementation, `readOnly` support, and a per-request
resolver (`(ctx) => FilesystemBackend`) mirroring the dynamic-sandbox resolver pattern. The existing sdk-tools
file factories accept an OPTIONAL `filesystem` backend (default = local process fs), so multi-tenant / per-request
roots become possible without each tool reimplementing path logic — and bring-your-own-tools stays intact. From
the a peer framework Workspaces comparison (2026-07-11). **This does NOT ship a bundled `Workspace` class, does NOT
auto-inject a toolset, and does NOT add S3/GCS/`mounts` in core** — those remain out of scope (see below); the
BYO-tools decision stands. This is the backend *seam*, not a new toolset.

**Definition of done:**

- [ ] A `FilesystemBackend` protocol with a minimal core method set (decide the exact 2–4 abstract methods + derived ops in the plan/ADR, mirroring `SandboxBackend`'s shape); `LocalFilesystem` implements it; path traversal is validated at the boundary and rejected with a typed error (reuse the sandbox's escape/scrub discipline — security).
- [ ] `readOnly` flag (writes on a read-only backend throw a typed error) + a per-request resolver `(ctx) => FilesystemBackend` supported, mirroring the documented dynamic-sandbox resolver.
- [ ] The `@theokit/sdk-tools` file factories accept an optional `filesystem` backend; **omitted ⇒ identical current behavior** (local process fs) — fully back-compatible, no consumer change required.
- [ ] S3 / GCS / `CompositeFilesystem` / `mounts` (FUSE) are explicitly OUT of core — documented as separate opt-in packages or deferred (mirrors how sandbox backends beyond Local live outside core).
- [ ] TDD: read / write / list / stat against `LocalFilesystem`; a resolver returns a distinct per-request root; a `readOnly` backend rejects a write with the typed error; a path-traversal attempt is blocked.
- [ ] Docs + Changeset; **ADR** for the seam shape AND the "why a filesystem seam when `SandboxBackend` already exists" decision (route file ops through the sandbox vs a dedicated FS backend).

**Dependencies:** none hard — composes with the existing `SandboxBackend` + sdk-tools file factories. (The plan MUST decide whether file operations route through `SandboxBackend.uploadFile`/`execute` instead of a dedicated seam; if routing suffices, this milestone is cut.)

**Top risks (new):**
1. **YAGNI / scope tension.** The out-of-scope list bans *built-in coding tools*; a FS provider seam is the backend, not the tools — but the line is thin. Mitigation: ship ONLY the seam + `LocalFilesystem` + resolver; NO bundled `Workspace`, NO cloud impls in core; the ADR MUST justify the seam vs routing through `SandboxBackend`, or the milestone is cut. The tools already exist opt-in in sdk-tools — this does not reverse BYO-tools.
2. **Security — arbitrary roots = traversal / exfiltration risk.** Mitigation: boundary path validation + `readOnly` + reuse the env-scrub discipline; typed `FilesystemSecurityError` (fail-fast, Rule 8).

**Why now:** the SDK already ships a sandbox provider seam for *execution* but file ops in sdk-tools are hard-wired to the local fs; a matching filesystem seam is the missing half for multi-tenant / per-request roots, and is the only runtime-legitimate slice of a peer framework Workspaces (the rest — bundled `Workspace`, `mounts`, LSP, tool-config layer — is app/framework glue, kept out of scope below).

### SE32 — [x] Read-before-write safety (`expectedMtime` / `StaleFileError`)

**Objective:** a peer framework's workspace write tools enforce read-before-write — a write fails if the file changed since
the agent last read it (`FileReadRequiredError` at the tool layer; `StaleFileError` at the filesystem layer via
`expectedMtime`), preventing an agent (or a concurrent editor) from silently clobbering changes. TheoKit's
`createWriteFileTool` / `createEditFileTool` have no such guard — a blind overwrite is silent data loss. Add an
optional `expectedMtime` on the write path + a typed `StaleFileError`, and an opt-in `requireReadBeforeWrite`
tracker that records read mtimes and refuses a blind overwrite of an existing (or externally-modified) file. From
the a peer framework Workspaces comparison (2026-07-11). This is a *correctness/safety primitive*, not a toolset — it
hardens the write tools that already exist opt-in.

**Definition of done:**

- [ ] The write path (`createWriteFileTool` / `createEditFileTool`, and the SE31 `FilesystemBackend.writeFile` if landed) accepts an optional `expectedMtime`; on mismatch it throws a typed `StaleFileError` (fail-fast, Rule 8) — never a silent clobber.
- [ ] Opt-in `requireReadBeforeWrite` on the write/edit tools: an existing file must be read (mtime recorded) before a write; a NEW file (does not exist) writes freely; an externally-modified file fails with `FileReadRequiredError` / `StaleFileError`.
- [ ] **Default OFF** — no behavior change unless enabled (back-compat).
- [ ] TDD (concurrency-aware): a write with a stale `expectedMtime` → `StaleFileError`; a new file writes without a prior read; read → external-modify → write → fails; the read tracker is per-run and does not leak across runs.
- [ ] Docs + Changeset (ADR only if the read-tracker state ownership needs a documented seam decision).

**Dependencies:** pairs with SE31 (the `FilesystemBackend` carries `expectedMtime` through `writeFile`); MAY ship tool-layer-only if SE31 is cut.

**Top risks (new):**
1. **Concurrency / TOCTOU.** The tool-layer check and the fs-layer `expectedMtime` compare are two points; an external write between them can still race. Mitigation: the fs-layer `expectedMtime` compare at ACTUAL write time is the authoritative guard (the tool-layer check is advisory); documented; **a concurrency test is required** (this milestone carries concurrency signals — plan-confidence conditional cap applies).
2. **Read-tracker state ownership.** Where recorded mtimes live (per-run, not global). Mitigation: scope to the run/tool context, mirroring the SE29 workflow-state ownership discipline; an invariant test locks no-cross-run-leak.

**Why now:** silent clobber = data loss; read-before-write is a *correctness/safety* primitive (the runtime-legitimate half of a peer framework's workspace file-safety) and directly complements SE31.

### SE33 — [x] Durable thread-scoped objective (`setObjective` over the existing `runUntil` + ConversationStorage)

**Objective:** the SDK already ships the goal-judge loop — `agent.runUntil(goal, options)` (ADRs D115-D121): an LLM-as-judge drives the agent toward a goal until satisfied or `maxTurns` is hit, with per-iteration feedback + typed `GoalEvent`s. But the goal is **per-call and transient** — passed as a parameter, gone when the call returns. a peer framework's **Goals** add a **durable** layer: the objective is persisted in thread state, survives reloads/restarts, and is managed via `Agent` methods. Add the runtime-legitimate half: persist a thread-scoped objective (+ its resolved `GoalOptions`) via the EXISTING `ConversationStorageAdapter` seam, and expose `setObjective` / `getObjective` / `updateObjectiveOptions` / `clearObjective` + an optional standing `goal` config on the agent that `runUntil` (and a default "work the standing objective" entrypoint) reads. From the a peer framework Goals comparison (2026-07-11). This EXTENDS an existing SDK primitive (`runUntil`) + an existing seam (ConversationStorage) — it does NOT add a new loop or a parallel runtime.

**Definition of done:**

- [ ] A thread-scoped objective record (`{ objective, options, status: 'active'|'done'|'paused', runsUsed }`) is PERSISTED via the existing `ConversationStorageAdapter` (a new key/namespace on the thread — reuse the seam, add no new store). Survives reload (read back after a fresh agent instance).
- [ ] `agent.setObjective(objective, { threadId, ...options })` / `getObjective({ threadId })` / `updateObjectiveOptions({ threadId, ...})` (only provided fields written; unset fall back to agent `goal` config) / `clearObjective({ threadId })`. All **no-op when the run is not memory-backed** (no storage / no threadId) — mirror a peer framework.
- [ ] Optional standing `goal` config on `AgentOptions` (`{ judge?/judgeModel?, maxRuns?, prompt? }`) — per-objective values (from `setObjective`) take precedence over the standing config, and that precedence is remembered in the record. The judge is the activation switch: no judge resolved ⇒ the standing objective is inert (no scoring, no budget consumed).
- [ ] `runUntil` (or a thin `runUntil()`-with-no-arg entrypoint) reads the durable objective when no explicit goal is passed, and writes `runsUsed`/`status` back to storage so `maxRuns` exhaustion leaves it `active` (raising `maxRuns` later resumes).
- [ ] Back-compat: absent a standing `goal` config + no `setObjective` call ⇒ `runUntil(goal, opts)` behaves EXACTLY as today (transient, D115-D121). No behavior change for existing callers.
- [ ] TDD: set → persist → new agent instance reads it back; update-options precedence; clear; no-op without threadId/storage; `maxRuns` exhaustion leaves `active` + a later raise resumes; a run with no judge is inert.
- [ ] Docs + Changeset; **ADR** for the objective record shape + the ConversationStorage key/namespace.

**Dependencies:** `runUntil` (D115-D121 — shipped), `ConversationStorageAdapter` (shipped seam), SE29 workflow-state ownership discipline (mirror for the record shape). No new subsystem.

**Top risks (new):**
1. **Storage-key collision / schema drift on the thread record.** A new objective key alongside conversation messages could clash or bloat the thread. Mitigation: a dedicated namespaced key (not mixed into the message list); ADR pins the shape; a schema-version field (mirror the `WorkflowSnapshot._schemaVersion` discipline).
2. **Precedence ambiguity** (per-objective options vs standing `goal` config vs built-in defaults). Mitigation: a single documented resolution order (per-objective record → agent `goal` config → built-in default), remembered in the record, with a test locking each layer.
3. **Scope creep into the in-loop step (SE34 territory).** SE33 is the DURABLE-OBJECTIVE half only — it reuses the EXISTING outer `runUntil` loop, it does NOT move goal evaluation inside the tool-calling loop. Mitigation: SE33 ships persistence + methods + standing config over the existing loop; the in-agentic-loop step is SE34 (separate, demand-gated).

**Why now:** the hard part (the judge loop) already ships as `runUntil`; the durable objective is the natural, runtime-legitimate completion — it reuses the ConversationStorage seam and the existing loop, adding no new runtime. It is the majority of the a peer framework Goals delta and the lowest-risk slice (no loop surgery).

### SE34 — [x] `isTaskComplete` per-send + in-agentic-loop goal step (+ `<current-objective>` signal projection)

**Objective:** a peer framework evaluates the goal as an **in-agentic-loop step** — inside the tool-calling loop, once per iteration, right after a per-send `isTaskComplete` check — and projects the standing objective into the model context as `<current-objective>` so the model always sees it. TheoKit's `runUntil` is an OUTER loop that judges the FULL response BETWEEN `send()`s (coarser granularity); there is no per-send `isTaskComplete` surface and no state-signal projection. SE34 adds: (a) a per-send `isTaskComplete` completion-check option (the finer-grained, single-`send()` judge gate, reusing the existing `internal/scorers/llm-judge.ts`); (b) OPTIONALLY, evaluating the SE33 durable objective as a step INSIDE the agentic loop (so a mid-run message is judged against the standing objective); (c) a state-signal projection that injects `<current-objective>` into the model's context. From the a peer framework Goals comparison (2026-07-11). **This is the MORE INVASIVE slice — it touches the agentic loop** — so it is gated on SE33 + explicit demand.

**Definition of done:**

- [ ] `SendOptions.isTaskComplete` (per-send completion check): after a `send()`, the existing LLM-judge scorer evaluates the response against a criterion; a typed result surfaces (reuse `internal/scorers/llm-judge.ts` + `internal/judge/judge-call.ts`). Absent ⇒ unchanged.
- [ ] (Optional, ADR-gated) in-agentic-loop goal step: the SE33 durable objective is scored ONCE PER tool-loop iteration (right after `isTaskComplete`), gating continuation/stop — a NO-OP for background-task / mid-tool-loop / working-memory-only iterations (mirror a peer framework's gating). This is the only loop-touching change and MUST be behind an explicit ADR decision (it modifies the shipped agent loop).
- [ ] State-signal projection: when a standing objective (SE33) is set, `<current-objective>` is auto-injected into the model context each turn (a lightweight system-prompt/context signal — reuse the SE22 dynamic-skills / systemPrompt-resolver seam if it fits; do NOT build a general signal-provider framework — YAGNI).
- [ ] Typed `goal`/`task_complete` evaluation events on the run-event stream (align with the existing `GoalEvent` union + `run-events.ts`).
- [ ] Back-compat: all three additions OPT-IN; absent them the loop + `send()` are byte-identical to today.
- [ ] TDD: `isTaskComplete` gates a single send; the in-loop step (if built) evaluates a mid-run message against the standing objective + is a no-op on non-candidate iterations; `<current-objective>` appears in the assembled context; the loop is unchanged when nothing is configured.
- [ ] Docs + Changeset; **ADR REQUIRED** for the in-agentic-loop step (it modifies the shipped loop — the highest-scrutiny change).

**Dependencies:** SE33 (the durable objective the in-loop step + projection read), `runUntil` + `internal/scorers/llm-judge.ts` + `internal/judge/judge-call.ts` (shipped). SE22 systemPrompt-resolver seam (reuse for the projection).

**Top risks (new):**
1. **Loop surgery risk (highest).** Moving goal evaluation INSIDE the agentic loop changes shipped behavior + performance (an extra judge call per iteration). Mitigation: OPT-IN only + a REQUIRED ADR; the per-send `isTaskComplete` (non-loop-touching) can ship FIRST, and the in-loop step deferred until demand + the ADR justify the loop change. If demand is thin, SE34 ships ONLY `isTaskComplete` + the projection and defers the in-loop step.
2. **Signal-projection over-engineering.** a peer framework has a general "signal providers" framework; TheoKit needs only `<current-objective>`. Mitigation: inject the one signal via the existing systemPrompt/context seam — do NOT build a plugin framework for it (G11/YAGNI).
3. **Judge cost per iteration.** An in-loop judge call multiplies token spend. Mitigation: the same gating as a peer framework (no-op on non-candidate iterations) + the judge-is-the-activation-switch rule (no judge ⇒ no scoring).

**Why now:** SE33 delivers the durable objective; SE34 makes it *feel* like a peer framework Goals (mid-run evaluation + the model always seeing the objective). But it is loop-touching — so it is deliberately SECOND, ADR-gated, and may ship only its non-invasive half (`isTaskComplete` + projection) if the in-loop step lacks demand evidence.

### SE35 — [x] Schedule a **workflow** on the existing `Cron` primitive (`workflow` + `inputData`)

**Objective:** the SDK already ships `Cron` — cron-scheduled AGENT runs with full CRUD (create/list/get/delete/enable/disable/run/start/stop/status), IANA timezone, 5-field POSIX + nicknames, and two modes (`agentId` = reuse an existing agent for context continuity vs `agent` = ephemeral per fire). a peer framework **Schedules** add the ability to schedule a **workflow** on the same surface. Add the runtime-legitimate half: a `Cron` job MAY target a shipped `Workflow` (SE27–30) instead of an agent — `Cron.create({ cron, workflow, inputData })` — reusing the EXISTING in-memory job store + in-process scheduler. On each fire, the scheduler runs `workflow.run(inputData)`. From the a peer framework Schedules comparison (2026-07-11). This EXTENDS a shipped primitive (`Cron`) over a shipped subsystem (`Workflow`) — it does NOT add a new scheduler, a new store, or a general dispatch engine.

> **Discover correction (2026-07-11):** the roadmap draft assumed a `workflowId` + resolver-registry seam (mirroring `agentId`). Discovery found the cron store is **in-memory only** (`internal/cron/store.ts` — "Phase 1 we keep all jobs in memory; persistence to `.theokit/cron/jobs.json` lands when the local runtime adapter is wired") — there is **no disk serialization today**, so there is **no serialization problem to solve** and building a workflow-id registry now is YAGNI (anticipates an unbuilt disk-persistence adapter). The current `agent: AgentOptions` field is likewise held in-memory. Corrected design (ADR 0014): the job holds the **`Workflow` instance** directly (mirroring the `agent` field); `runCronJob` calls `job.workflow.run(inputData)` on the instance — **no facade/registry, no `workflowId`**. When a local disk-persistence adapter is eventually wired, BOTH agent and workflow jobs need serialization handling (agent options serialize; a workflow instance would then need an id+resolver) — that is the disk-persistence milestone's problem, recorded as a known limitation.

**Definition of done:**

- [ ] `CronCreateOptions` / `CronJob` gain `workflow?: Workflow` + `inputData?: unknown`, MUTUALLY EXCLUSIVE with `agent`/`agentId` (exactly one target: `agent` | `agentId` | `workflow`). `message` is REQUIRED for agent targets, FORBIDDEN for a workflow target (a workflow takes `inputData`, not a chat message). A `ConfigurationError` (`cron_ambiguous_target` / `cron_no_target` / `cron_workflow_message`) when zero or >1 target is set, or `message` is paired with `workflow` — validated in `createCronJob`, extending the existing `agent`-XOR-`agentId` guard.
- [ ] `runCronJob(job)` branches on the target: `workflow` ⇒ `job.workflow.run(job.inputData)` (returns the terminal `WorkflowRun`); `agent`/`agentId` ⇒ unchanged (`agent.send(message)` → `Run`). Return type widens to `Run | WorkflowRun`. `Cron.run(jobId)` (manual off-schedule fire) returns the `WorkflowRun` for a workflow job. `run-job.ts` calls `.run()` on the held instance — it does NOT import `workflow.ts` (the instance carries its own `.run`), preserving the dependency direction.
- [ ] The scheduler default fire handler (`setCronFireHandler` in `cron.ts`) handles BOTH result shapes: an agent `Run` (has `.wait()`/`.cancel()`) vs a `WorkflowRun` (already terminal — no `.wait()`). The Task-registry wrap records the right terminal status/runId for each. The in-process Croner scheduler, `nextRunAt`/`lastRunAt`, pause/resume, timezone — all REUSED unchanged.
- [ ] Back-compat: an agent-target job (`agent`/`agentId` + `message`) is byte-identical to today; the new fields are additive + optional. No behavior change for existing callers.
- [ ] (Deferred, ADR-gated) **fire lifecycle hooks** (`prepare` / `onFinish` / `onError` / `onAbort`) — DEFERRED per ADR 0014 (no concrete consumer; YAGNI). The ADR records the named re-eval trigger (mirrors SE34's in-loop-step deferral). Not built in SE35.
- [ ] TDD: create a workflow-target job → held with `workflow`/`inputData`; a manual `Cron.run` fires the workflow with `inputData` and returns the terminal `WorkflowRun`; ambiguous/zero target rejected typed; `message`+`workflow` rejected typed; agent-target path unchanged; the scheduler handler records a workflow fire's terminal status without calling `.wait()`.
- [ ] Docs + Changeset; **ADR 0014** for the workflow-target design (instance-not-id rationale + the hooks deferral).

**Dependencies:** `Cron` (shipped — façade + `internal/cron/{scheduler,store,validate,run-job}.ts`), `Workflow` (SE27–30 — shipped `Workflow.create(opts).commit()` → `Workflow` instance + `.run(input)` → `Promise<WorkflowRun>`). No new subsystem, no new registry.

**Top risks (new):**
1. **Dual result shape in the fire handler (highest now).** An agent fire returns a `Run` (deferred — `.wait()`/`.cancel()`); a workflow fire returns a `WorkflowRun` (already terminal). The `setCronFireHandler` Task wrap currently assumes `run.wait()`. Mitigation: branch on the result shape (or normalize in `runCronJob`) so the handler records the correct terminal status/runId and abort-wires only the agent `Run`; a TDD test covers a workflow fire through the handler.
2. **Scope creep into threaded-signal delivery + client routes.** a peer framework Schedules also add threaded-signal behavior (`ifActive`/`ifIdle` wake/discard, XML tag wrapping) + `/api/schedules` client routes. Both are OUT (see § Explicitly out of scope) — SE35 takes ONLY workflow scheduling. Mitigation: no `threadId`/signal fields on the cron job.
3. **Future disk-persistence asymmetry (documented, not solved now).** When the local disk-persistence adapter is wired, a `Workflow` instance won't serialize (agent options will). Mitigation: ADR 0014 records this as a known limitation for the disk-persistence milestone to solve (id+resolver THEN, with a real consumer) — NOT pre-built now (YAGNI).

**Why now:** a peer framework Schedules is ~70% already covered by the shipped `Cron` façade; the majority runtime-legitimate delta is scheduling a **workflow** (the SDK already ships Workflows + the Cron scheduler). It reuses two shipped primitives, adds no new scheduler/store/registry, and stays inside the SDK-owns-runtime invariant. The threaded-signal + client-route deltas are transport/framework glue and stay out.

### SE36 — [x] Uniform `X.create()` public API (v3.0 breaking — reverses Rule 9)

**Objective:** Replace **every** factory function in the public surface — capability factories
(`defineTool`, `defineProvider`, `definePlugin`, `defineSkillReadTool`, `defineSubscription`,
`createSquad`, `createSkill`, `createSessionManager`, `createAgentFactory`,
`createNoopMemoryProvider`) **and** the utility factories (`createSemaphore`,
`createTokenLimiter`, `createUnicodeNormalizer`, `createPermissionPlugin`, `withRetry`, …) —
with a single uniform static-namespace form `X.create()` (`Tool.create`, `Provider.create`,
`Plugin.create`, `Squad.create`, `Skill.create`, `Session.create`, `Subscription.create`,
`AgentFactory.create`, `Semaphore.create`, `TokenLimiter.create`, `PermissionPlugin.create`, …),
matching the existing `Agent.create` / `Cron.create` / `Workflow.create`. Owner-mandated
uniformity (2026-07-13): one mental model across the whole surface. **Hard break at v3.0** — the
old `define*`/`create*` exports are REMOVED, not aliased. This **reverses Unbreakable Rule 9**
(factory functions canonical, ADR D431) via a new superseding ADR.

**Definition of done:**

- [ ] ADR written that supersedes D431 and reverses Rule 9; documents the new convention "every public capability & utility factory ships as an `X.create()` static method" + the SOTA-divergence rationale.
- [ ] Every listed factory converted to a namespace class with a static `create()`; old `define*`/`create*` exports REMOVED from every entrypoint barrel (hard break — no deprecated aliases).
- [ ] `docs.md` (source of truth) + `README.md` updated to the new surface; zero `defineTool`/`createSquad`/… references remain (grep-clean).
- [ ] `CLAUDE.md` Inviolable Rule 9 + the Locked-names table rewritten to the new convention (Locked-names change protocol: docs.md + README + CHANGELOG in the same PR).
- [ ] jscodeshift codemod rewriting `defineX(...)`/`createX(...)` → `X.create(...)` for consumers, with a migration guide; the codemod round-trips the entire in-tree `examples/**` suite.
- [ ] Every example under `examples/**` + the docs-site examples migrated and **re-verified against a real LLM (OpenRouter)** per `rules/real-llm-validation.md`.
- [ ] All tests migrated; TDD per converted symbol: a regression test asserting the new `X.create` has behavior parity with the removed factory (RED first).
- [ ] Major bump `@theokit/sdk@3.0.0` + Changeset; CHANGELOG `[Unreleased] § Removed` lists every removed factory, `§ Changed` documents the rename.

**Dependencies:** SE35 (and transitively all SE1–SE35, all `[x]`) — the redesign renames the
**entire existing public surface**, so every prior slice that introduced a factory must be
shipped and frozen before the sweep. No new capability depends on it; it is a cross-cutting rename.

**Top risks (new):**
1. **Maximum blast radius** — hard-break + full-scope (incl. internal utilities like `Semaphore.create`) breaks every consumer import at once, with no grace window; a codemod bug strands users. Mitigation: exhaustive codemod test corpus; ship 3.0.0 only after the codemod round-trips the whole in-tree example suite.
2. **Ecosystem-idiom divergence** — reverses a locked rule that matches every peer SDK's `tool()` idiom (a peer framework / OpenAI Agents / a framework); utility factories forced into artificial namespaces (`Retry.create`) lose ergonomic clarity. Mitigation: the ADR records the rationale + divergence explicitly; docs lead with the mental model.

**Why now:** the owner identified the `Agent.create` vs `defineTool` inconsistency as a
first-class design defect and decided (2026-07-13) on full uniformity before the public API
ossifies further with more consumers. The honest counter-argument (current split is SOTA-aligned
and Rule-9-locked) was surfaced and the trade-off accepted.

### Explicitly out of scope

Gaps present in the Anthropic Agent SDK that we deliberately DO NOT adopt, because they contradict the
`@theokit/sdk` architecture or belong to a different layer. Reopening any requires an ADR with evidence.

- **OS-level sandbox** (bubblewrap / network allowlist / filesystem deny) — *why excluded:* OS isolation is a **deploy/infra** concern (TheoCloud), not the agent runtime. The narrow code-mode execution sandbox already exists for its use case; kernel-level isolation is not the runtime's job.
- **Built-in coding tools** (Read / Write / Edit / Bash / Grep / Glob / …) — *why excluded:* **bring-your-own-tools** is the design. The consumer (TheoKit) provides tools. Shipping a toolset would make `@theokit/sdk` a Claude-Code clone instead of a runtime.
- **Subprocess / CLI-wrapper model + spawn warm-start** — *why excluded:* we are **in-process by design** (the Model-A TUI/Tauri advantage — `streamAgentTurnInProcess`). The subprocess model is Anthropic's Claude-only product shape, not a runtime primitive. Never adopt.
- **Settings-resolution engine** (precedence tiers, MDM/plist/HKLM, `resolveSettings`) — *why excluded:* app/framework configuration is a **framework** concern, not the agent runtime's.
- **General "signal providers" framework + a peer framework-instance Goals orchestration** (the rest of a peer framework Goals beyond SE33/SE34) — *why excluded:* a pluggable signal-provider framework (projecting arbitrary state into context), a `a peer framework`-instance-level goal registry, and Studio/dashboard goal management are **app/framework glue** or a general extensibility framework, not runtime primitives. SE33 (durable objective over the existing `runUntil` + ConversationStorage) + SE34 (`isTaskComplete` + the single `<current-objective>` projection + an ADR-gated in-loop step) take ONLY the runtime-legitimate slices; the general signal framework and instance-level orchestration stay out. The **in-agentic-loop goal step (SE34) is loop-touching and ADR-gated** — it may ship only its non-invasive half (`isTaskComplete` + projection) if the in-loop step lacks demand. Cross-check 2026-07-11 when SE33/SE34 were added: the judge-loop is already a shipped SDK primitive (`runUntil`); the durable + per-send + projection slices extend it; the general framework does not.
- **Bundled `Workspace` class + `mounts`/FUSE + LSP inspection + workspace tool-config/hooks layer** (the rest of a peer framework Workspaces beyond SE31/SE32) — *why excluded:* a `Workspace` that auto-injects a coordinated toolset with global/agent inheritance, cloud-FS `mounts`, language-server inspection, and a per-tool remap/approval/truncation/hooks layer is **app/framework glue** (belongs in TheoKit or an opt-in package), not the runtime. SE31 (filesystem seam) + SE32 (write-safety) take ONLY the two runtime-legitimate primitives from that surface; the bundle, mounts, and LSP stay out. Reopening requires an ADR with 3+ apps blocked. (Cross-check 2026-07-11 when SE31/SE32 were added — the BYO-tools and no-bundled-Workspace decisions were reaffirmed, not reversed.)
- **Threaded-signal schedule delivery + `/api/schedules` client routes** (the rest of a peer framework Schedules beyond SE35) — *why excluded:* a peer framework's threaded schedules inject a **signal** into a live thread with active-or-idle delivery behavior (`ifActive`/`ifIdle` discard/wake, XML `tagName`/`attributes` wrapping), which depends on a peer framework's **Signals** / long-running-agents concept — that is **durable transport into a live session**, the theokit framework's job (M37 durable/reconnectable streams + M38 HITL continuation), NOT the SDK runtime. The `/api/schedules` HTTP routes + `@a peer framework/client-js` management surface are a **server/client** layer, also framework, not runtime. SE35 takes ONLY the runtime-legitimate slice — scheduling a **workflow** on the existing `Cron` primitive (+ optional fire hooks); the signal-delivery-behavior layer and the client-route surface stay out. The SDK's `agentId` cron mode already gives context continuity (reuse the agent across fires) without a live-thread signal layer. (Cross-check 2026-07-11 when SE35 was added — the in-process, no-live-thread-signal decision was reaffirmed; live-session delivery lives in the framework, per M37/M38.)

---

## References

Study-only peers + full cross-validation reports:
`.claude/knowledge-base/audits/cross-validation/{a peer framework,a peer project,codex,a peer project,peer-js}/final_report.md`.

**SDK Evolution (SE1+) reference:** deep comparison against the **Anthropic Agent SDK**
(`@anthropic-ai/claude-agent-sdk`, TypeScript reference) — the source of the SE1–SE6 operational-maturity
gaps and the § Explicitly out of scope rejections (2026-07-09).
