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

### SE3 — [ ] Multi-agent provenance (`origin`)

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

### SE4 — [ ] Session management surface

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

### SE5 — [ ] File checkpoint/rewind (GATED — ADR first)

**Objective:** DECIDE, via ADR, whether file checkpointing + rewind (Anthropic
`enableFileCheckpointing` + `rewindFiles()`) is a **runtime** concern (SDK) or a **coding-agent**
concern (TheoKit/consumer). The SDK is bring-your-own-tools: file edits come from *consumer* tools, so
the loop does not own file I/O — checkpointing may not fit the runtime cleanly.

**Definition of done:**

- [ ] **GATE:** an ADR ruling runtime-vs-framework ownership (no code before it). Evidence: the loop is tool-agnostic; file mutation lives in consumer tools.
- [ ] If runtime-owned: a minimal `checkpoint` / `rewind(messageId)` primitive keyed on session message ids + TDD.
- [ ] If framework-owned: ADR + a roadmap note closing it as TheoKit/tool-layer territory (no SDK code).

**Dependencies:** SE1 (permission context), SE4 (message ids as the rewind anchor).

**Top risks (new):**
1. Architectural mismatch — BYO-tools means the loop doesn't see file writes. Mitigation: the ADR is a hard gate; likely outcome is "framework/tool-layer owns it".
2. Scope creep into coding-agent territory (TheoKit's job). Mitigation: decide ownership before any primitive.

**Why now:** flagged borderline in the comparison; the ownership call must precede any implementation.

### SE6 — [ ] Provider prewarm / first-token latency (GATED — measure first)

**Objective:** The Anthropic `startup()`/`WarmQuery` exists to amortize **subprocess spawn** — which we
do NOT have (in-process by design). Investigate whether an in-process analog is warranted: prewarm the
provider chain / precache model capabilities / open the connection ahead of the first prompt, so the
first `Run.stream()` isn't slowed by cold provider resolution. Honest default posture: **likely a
no-op** — measure before building (YAGNI).

**Definition of done:**

- [ ] Measure the cold-start cost of the first run (provider-chain resolution, plugin discovery, connection setup) with numbers.
- [ ] If material (> a defined threshold): a `prewarm(options)` that resolves the chain + opens the connection without a model call + TDD + latency-delta evidence.
- [ ] If negligible: document that in-process cold-start is minimal (our advantage vs subprocess) and CLOSE the milestone with the measurement as evidence.

**Dependencies:** SE2 (measure via typed timing events).

**Top risks (new):**
1. Building API for a non-problem — in-process cold-start may already be negligible. Mitigation: measurement gate; no `prewarm` API unless the number justifies it.
2. Chasing a subprocess-only concept. Mitigation: the objective is explicitly the in-process analog, not a port.

**Why now:** the comparison raised it; the honest resolution is "measure, likely minimal" — hence gated.

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
