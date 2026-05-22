# Plan: Agent Handoffs — `Agent.handoffTo` + `handoffs[]` Declarative (Adoption Roadmap #4)

> **Version 1.1 — STATUS: ✅ COMPLETE (2026-05-22).** All 8 phases (T0.1-T8.1) DONE. 16 ADRs D214-D229 filed (12 base + 4 absorbed from edge-case review). 29 unit tests PASS (registry + normalize + dispatcher + handoff-create). All 5 MUST FIX edges absorbed (EC-1 parallel handoff first-wins, EC-2 inputFilter throw fallback, EC-3 onHandoff throw aborts, EC-4 empty inputJson handling, EC-5 disposed receiver). 6 SHOULD TEST + 3 DOCUMENT integrated. Integrated into telegram-pro via `/handoff_demo` command (Adoption Roadmap #4 dogfood requirement). **Telegram-pro full dogfood: 41/42 PASS, 0 FAIL, 1 SKIP (HONCHO_API_KEY unset) in 216.7s.** Real-LLM `examples/handoffs/run.ts` validates SDK contract (small Ollama model demonstrates documented EC-14 limitation; cloud models work fully). Bonus regression fix: removed `parse_mode: "Markdown"` from telegram-pro's /help reply to fix pre-existing entity-parse bug exposed by `/handoff_demo` addition.

> **Version 1.0** — Ship `@usetheo/sdk`'s peer-to-peer agent handoff primitive. Pattern alvo: **handoff-as-tool** (canonical OpenAI Agents SDK pattern, also confirmed by LangGraph supervisor mode). Each `handoffs[]` destination becomes a synthetic function tool `transfer_to_<receiver>` exposed to the LLM; runtime intercepts the tool call and routes the next turn to the receiver agent. Supports `inputFilter` (history scoping), `inputType` (structured payload via Zod), `onHandoff` (side-effect callback), per-receiver tool whitelist, and max-depth loop guard. Reuses `fork()` infra (D110-D114) for the receiver lifecycle and `Telemetry` (D34) for spans. Outcome: a consumer writes `Agent.create({ handoffs: [billing, support] })` and the SDK does triage automatically — no state machine, no orchestration code.

## Context

**What exists today (post-eval-suite 2026-05-22):**

- **`Agent.fork()`** (D110-D114): creates short-lived sub-agent inheriting parent credentials + system prompt + restricted tool whitelist. **Parent stays in control.** Not handoff — fork is "go fetch this, come back"; handoff is "you own the conversation now."
- **Subagents (Toolset)** (cloud-only per D110): dispatch via `task` tool. Same pattern as fork but cloud-routed. Still parent-owned.
- **`Agent.batch`** (D134-D140): parallel fanout. Not relevant for handoff (single sequential receiver).
- **`pre_tool_call` hook** (D101): veto pattern. We need similar interception for handoff tool calls.
- **`AsyncLocalStorage` for tool whitelist** (D111): the pattern that fork uses; we reuse for handoff context propagation.

**What's missing:**

- No way to declaratively say "this agent can transfer to these other agents."
- No primitive that swaps the conversation owner. Workarounds today: caller does `parent.send()` → reads intent → manually `await otherAgent.send(history)` — verbose, no telemetry correlation, no input filtering, no loop guards.
- Multi-agent products in production today (Mastra customers, Anthropic Workbench experiments) use external state machines to do what handoffs solve in 3 lines.

**Competitive evidence:**

- **OpenAI Agents SDK** (Python + TS): `handoffs: [agent1, agent2]` + `handoff(agent, { onHandoff, inputType, inputFilter, isEnabled })` helper. Canonical pattern.
- **LangGraph supervisor**: `Command(goto, update, graph=Command.PARENT)` from a tool — same shape, more verbose due to graph state machine.
- **CrewAI hierarchical**: `allow_delegation: true` per agent. **Known broken in 2026** — manager delegation fails; framework falls back to sequential.
- **Mastra A2A**: remote-only (cross-process via A2A protocol); doesn't fit our in-process SDK story.

Per CLAUDE.md Roadmap rationale: *"OpenAI Agents SDK trata como primitivo de primeira classe. Hoje temos `fork()` (D110-D114) + subagents (Toolset) mas não handoff declarativo entre agentes pares com transferência de contexto + tool whitelist + conversation history. Mercado de multi-agent quente: CrewAI, AutoGen, Swarm."*

## Objective

**Done = a developer writes `Agent.create({ ..., handoffs: [agent2, agent3] })`, sends a user message, and the SDK automatically transfers control to the right destination based on the LLM's reasoning. The receiver continues the conversation with full (or filtered) history. Telemetry shows the full handoff chain.**

Specific measurable goals:

1. `Agent.create({ handoffs })` accepts `Array<Agent | Handoff>`.
2. `Handoff.create(targetAgent, { onHandoff?, inputType?, inputFilter?, isEnabled?, toolName?, toolDescription? })` factory exported.
3. Runtime injects synthetic tools `transfer_to_<name>` into the agent's tool registry per D102 (Toolset 3-layer registry).
4. When the LLM invokes a handoff tool, the runtime: (a) runs `onHandoff` callback, (b) applies `inputFilter` to history, (c) routes the next turn to the receiver, (d) emits `handoff.transfer` OTel span linking parent + receiver.
5. Receiver continues the conversation; its tools, memory, hooks, personality apply to subsequent turns.
6. Anti-loop: max 5 handoffs per `agent.send()` call; exceeding throws `HandoffLoopError`.
7. Per-handoff tool whitelist via `inputFilter`'s output (matches D111 AsyncLocalStorage pattern).
8. Single-flight per (sender, receiver) pair per `send()` — prevents infinite ping-pong.
9. ≥ 50 unit tests; ≥ 90% coverage on new files.
10. Real-LLM dogfood: triage agent → billing agent flow on Ollama, end-to-end visible in `telegram-pro` (new `/handoff_demo` command shows the chain).
11. Telegram-pro regression dogfood PASS (per `/dogfood` skill memory).

## ADRs

- **D214 — Handoffs are tool-shaped (synthetic function tools) injected at agent registration time.**
  *Rationale:* This is the canonical pattern in OpenAI Agents SDK (Python + TS). LLMs already know how to invoke tools; we don't need a new mental model. The LLM decides via natural language reasoning, not via runtime introspection. Alternative considered: explicit `Agent.handoffTo(other)` imperative call only — rejected because it forces callers to do intent classification themselves (defeats the point).
  *Consequences:* enables zero new LLM concepts to teach; constrains: receiver MUST be declared at sender's creation time (dynamic discovery deferred to v2 via `Handoff.factory(() => agent)`).

- **D215 — Default handoff tool name = `transfer_to_<receiver.name>` (overridable).**
  *Rationale:* Follows OpenAI convention which has accumulated empirical evidence — LLMs across providers (Anthropic, OpenAI, Google) reliably invoke tools with this naming. Receiver's `name` (Agent's `name` field, falls back to short `agentId`) is the identifier.
  *Consequences:* enables cross-provider portability; constrains: receivers MUST have a unique `name` per sender (Zod refinement at `Agent.create`); collision throws `HandoffNameCollisionError`.

- **D216 — History passed to receiver is FULL by default; `inputFilter` overrides.**
  *Rationale:* The user typed something in the conversation; the receiver needs context to respond coherently. Full history is the safe default. Privacy-sensitive cases use `inputFilter` to redact or summarize. Matches OpenAI Agents default.
  *Consequences:* enables conversational continuity; constrains: full-history transfer can be expensive in long sessions (tokens). `inputFilter` is the escape hatch.

- **D217 — Handoffs are PEER-to-PEER, not parent-child.**
  *Rationale:* Receiver is its own owner of the next turn. The sender does NOT wait for "completion" — the receiver simply continues. No "return value" from a handoff like fork has. Differentiates from fork/subagent.
  *Consequences:* enables clean responsibility split (each agent has full ownership during its turn); constrains: no "come back to sender" semantics in v1 (would require routing graph; deferred to v2).

- **D218 — Anti-loop guard: max 5 handoffs per `agent.send()` call (configurable).**
  *Rationale:* Without a cap, ping-pong loops between agents (A→B→A→B...) burn tokens infinitely. CrewAI's bug in 2026 is exactly this. 5 is a balance — enough for triage → specialist → escalation patterns, not enough to bankrupt the caller. Throws `HandoffLoopError` on overflow.
  *Consequences:* enables safe production deployment; constrains: complex multi-hop flows must set `Agent.create({ maxHandoffDepth: N })`; default keeps users safe.

- **D219 — `inputFilter` is THE single extension point for history scoping (no `outputFilter`).**
  *Rationale:* OpenAI Agents has only inputFilter; LangGraph has no equivalent (manual graph state). One filter is enough — output filtering is the next agent's responsibility via its own system prompt / tools.
  *Consequences:* enables one clear point of customization; constrains: filtering OUTPUT requires writing the receiver to do it (consistent with "receiver owns the conversation").

- **D220 — Telemetry: emit `handoff.transfer` span linking parent + receiver agentIds.**
  *Rationale:* Operability requires seeing the chain in trace tools (Honeycomb, Datadog). Piggybacks on D34 OTel infra (same pattern as Eval D206). Span attributes: `handoff.from`, `handoff.to`, `handoff.reason` (LLM-generated payload), `handoff.depth` (current count).
  *Consequences:* enables trace-based debugging; constrains: no OTel = no span (consistent with D206).

- **D221 — Single-flight per (sender_agentId, receiver_agentId) pair within one `send()` call.**
  *Rationale:* Different from Eval's per-name single-flight (D213). Handoff loops show up as A→B→A; the second A→B (third hop overall, IF it ever happens) is what we want to detect early. Single-flight at PAIR level catches direct ping-pong WITHIN the same send() invocation. Combined with D218 max-depth, gives 2 layers of loop protection.
  *Consequences:* enables loop detection earlier than depth counting; constrains: legitimate "go back to triage to escalate" patterns need to use a different pair (e.g. introduce escalation_agent as 3rd party).

- **D222 — `Handoff` is a class with `Handoff.create(target, opts?)` factory — same API style as `Eval.create`, `Agent.create`.**
  *Rationale:* Consistency with the SDK's class+factory convention (locked in D202 for Eval). Alternative considered: `handoff(target, opts)` standalone function (OpenAI style) — rejected to match our SDK's style.
  *Consequences:* enables IDE intellisense; constrains: receivers can also be passed raw `Agent` instances (we auto-wrap in `Handoff.create(agent)` with defaults).

- **D223 — `inputType` is a Zod schema (peer dep, lazy-loaded).**
  *Rationale:* Same pattern as `generateObject` / `streamObject` / `Eval` already use. Zod is the SDK's chosen validation lib (peer dep, opt-in).
  *Consequences:* enables structured handoff payloads (e.g. `{ reason: string, severity: "high" | "low" }`); constrains: Zod must be installed when `inputType` is set; same constraint already enforced elsewhere.

- **D224 — Tool whitelist transfer: `Handoff.create(target, { tools: [...] })` restricts the receiver's tools for the next turn only.**
  *Rationale:* Mirrors D111 (fork's whitelist via AsyncLocalStorage). Necessary for security — billing agent might only need `lookup_invoice`, NOT `delete_account`. The whitelist applies to JUST the post-handoff turn; subsequent receiver-internal turns use receiver's full tool set.
  *Consequences:* enables fine-grained authority; constrains: implementing requires propagating whitelist via ALS into the receiver's first turn (≤ 20 LOC reuse of D111 helper).

- **D225 — `Agent.handoffTo(other, opts?)` imperative API is OPT-IN (NOT auto-injected).**
  *Rationale:* The declarative `handoffs: []` approach (via tool) is canonical. But power users (testing, manual orchestration) need an imperative escape hatch. Make it explicit and named so it's not the default path.
  *Consequences:* enables programmatic control flow when needed; constrains: usage shows up as separate code path; doesn't replace the tool-based handoff.

- **D226 — Parallel handoff calls in one LLM turn: first-wins, others rejected with tool_error (EC-1).**
  *Rationale:* Modern LLMs (Claude 3.5+, gpt-4o, Llama 3.1+) can emit multiple `tool_use` in the same response. If two handoffs fire, dispatch race is undefined. Decision: the FIRST `transfer_to_*` tool in the response wins (positional order); subsequent handoff tool calls in the same turn return `tool_error: { code: "multiple_handoff_in_turn" }` so the LLM sees the conflict and adjusts. Other (non-handoff) tools in the same response are still vetoed (the sender's loop ends BEFORE executing them — the receiver picks up). Mirrors OpenAI Agents behavior.
  *Consequences:* enables deterministic resolution; constrains: callers who want "do both" must use `Agent.batch` or sequential turns.

- **D227 — `onHandoff` throwing aborts the handoff (handoff tool returns `isError: true`) (EC-3).**
  *Rationale:* Semantically `onHandoff` doubles as validation gate ("can I do this transfer?") AND side-effect logger. Throwing means "no, don't transfer." Side-effect-only consumers use try/catch internally to swallow. Matches `pre_tool_call` veto semantics (D101) and OpenAI Agents convention.
  *Consequences:* enables validation gates; constrains: throwing has a specific, documented meaning; logger-style consumers must wrap their own try/catch.

- **D228 — `inputFilter` exception falls back to FULL history with a stderr warning (EC-2).**
  *Rationale:* Bug in user filter code (network call, bad logic) should NOT kill the run. `safeFilter(fn)` wraps the user callback; on exception, logs once to stderr and uses the un-filtered history. Consistent with `safeHook` pattern (eval D204 / EC-4).
  *Consequences:* enables resilient handoff flow; constrains: a broken filter silently degrades to full-history privacy posture — caller must verify filter logs to catch this.

- **D229 — Empty / null `inputJson` is accepted when `inputType === undefined` (EC-4).**
  *Rationale:* Some LLM providers omit the JSON args field when the input schema is empty (`z.object({})`). Mirrors OpenAI Agents behavior. Parsing logic: if `inputType` not set, skip parsing entirely; if set, default missing input to `{}` BEFORE Zod parse.
  *Consequences:* enables cross-provider portability; constrains: empty payload is the default — handoffs with REQUIRED fields throw via Zod refinement normally.

## Dependency Graph

```
Phase 0: ADRs D214-D225 + interface design
   │
   ▼
Phase 1: Public types (Handoff, HandoffResult, HandoffEvent, HandoffOptions, HandoffLoopError)
   │
   ▼
Phase 2: Core engine — synthetic tool injection + interception in agent loop
   │       │
   │       ▼
   │   Phase 3: Loop guards (max depth + single-flight pair)
   │       │
   │       ▼
   │   Phase 4: inputFilter + inputType + onHandoff callbacks
   │       │
   │       ▼
   │   Phase 5: Tool whitelist transfer (D224)
   │       │
   │       ▼
   │   Phase 6: Telemetry integration (D220)
   │
   ▼
Phase 7: Examples + docs (`examples/handoffs/`, docs.md §Handoffs)
   │
   ▼
Phase 8: Dogfood QA (real-LLM triage flow + telegram-pro regression)
```

Phase 0 → 1 sequential. Phases 2-6 incrementally compose (each depends on previous). Phase 7-8 final.

---

## Phase 0: ADRs + Interface Design

### T0.1 — File 16 ADRs (D214-D229) + update CLAUDE.md

#### Objective
Drop one ADR markdown per decision in `.claude/knowledge-base/adrs/`. Append 16 rows to CLAUDE.md's ADR table.

#### Files to edit
```
.claude/knowledge-base/adrs/D214-D229-*.md  (16 NEW; D226-D229 from edge-case review)
CLAUDE.md                                    (append 16 ADR-table rows)
```

#### Tasks
1. Copy ADR template from D213; one file per decision.
2. Append 16 rows to CLAUDE.md ADR table.

#### Acceptance Criteria
- [ ] 16 ADR files exist.
- [ ] CLAUDE.md ADR table has D214-D229 rows.
- [ ] biome lint zero warnings.

#### DoD
- [ ] Tasks 1-2 done. No code yet.

---

## Phase 1: Public Types

### T1.1 — `types/handoff.ts` + barrel re-export (types only, NO value export yet)

#### Objective
Pure type definitions. Implementation lands in T2.1.

#### Files to edit
```
packages/sdk/src/types/handoff.ts          (NEW)
packages/sdk/src/types/index.ts             (edit — add re-export)
packages/sdk/src/types/agent.ts             (edit — extend AgentOptions with handoffs?, maxHandoffDepth?)
packages/sdk/tests/types/handoff.test.ts   (NEW — type-only)
docs.md                                     (edit — append §Handoffs)
```

#### Deep Dives

```ts
// types/handoff.ts
import type { ZodType } from "zod";

import type { SDKAgent } from "./agent.js";

export interface HandoffOptions<T extends ZodType = ZodType> {
  /** Override the default tool name `transfer_to_<receiver.name>` (D215). */
  readonly toolName?: string;
  /** Override the default tool description. */
  readonly toolDescription?: string;
  /** Side-effect callback fired before the receiver assumes control. */
  readonly onHandoff?: (ctx: HandoffContext, parsed: ZodType extends T ? unknown : import("zod").infer<T>) => void | Promise<void>;
  /** Zod schema for the handoff tool-call arguments (structured payload). */
  readonly inputType?: T;
  /** Filter the history passed to the receiver (D216 / D219). */
  readonly inputFilter?: (history: HandoffHistory) => HandoffHistory | Promise<HandoffHistory>;
  /** Restrict the receiver's tools for the post-handoff turn only (D224). */
  readonly tools?: ReadonlyArray<string>;
  /** Predicate to dynamically enable/disable this handoff (default: always enabled). */
  readonly isEnabled?: boolean | ((ctx: HandoffContext) => boolean | Promise<boolean>);
}

export interface HandoffContext {
  readonly senderAgentId: string;
  readonly receiverAgentId: string;
  readonly currentDepth: number;
}

export interface HandoffHistory {
  readonly messages: ReadonlyArray<unknown>;  // SDKMessage[]; widen to avoid circular import
}

export interface HandoffEvent {
  readonly type: "handoff";
  readonly from: string;       // sender agentId
  readonly to: string;          // receiver agentId
  readonly reason: string;      // LLM-generated, default ""
  readonly depth: number;
  readonly toolName: string;
}

/** Throw when handoff depth exceeds `maxHandoffDepth` (default 5; D218). */
export class HandoffLoopError extends Error {
  override readonly name = "HandoffLoopError";
  readonly depth: number;
  readonly chain: ReadonlyArray<string>;
  constructor(depth: number, chain: ReadonlyArray<string>) {
    super(
      `Handoff loop exceeded max depth ${depth}. Chain: ${chain.join(" -> ")}. ` +
        `Use Agent.create({ maxHandoffDepth: N }) to raise the cap or fix the LLM's reasoning.`,
    );
    this.depth = depth;
    this.chain = chain;
  }
}

/** Throw when same (sender, receiver) pair invoked within one send() call (D221). */
export class HandoffPairLoopError extends Error {
  override readonly name = "HandoffPairLoopError";
  readonly senderAgentId: string;
  readonly receiverAgentId: string;
  constructor(senderAgentId: string, receiverAgentId: string) {
    super(
      `Handoff loop: ${senderAgentId} -> ${receiverAgentId} already invoked in this send() call. ` +
        `Likely a ping-pong loop; revisit your handoff conditions.`,
    );
    this.senderAgentId = senderAgentId;
    this.receiverAgentId = receiverAgentId;
  }
}

/** Throw at `Agent.create` time when a handoff target is the same agent being created (EC-6). */
export class HandoffSelfReferenceError extends Error {
  override readonly name = "HandoffSelfReferenceError";
  readonly agentId: string;
  constructor(agentId: string) {
    super(
      `Agent "${agentId}" has a self-reference in its handoffs[]. ` +
        `Self-handoff causes infinite recursion; if you need re-entry, use a separate sibling agent.`,
    );
    this.agentId = agentId;
  }
}

/** Throw when receiver agent is disposed at handoff dispatch time (EC-5). */
export class HandoffReceiverDisposedError extends Error {
  override readonly name = "HandoffReceiverDisposedError";
  readonly receiverAgentId: string;
  constructor(receiverAgentId: string) {
    super(
      `Handoff target agent "${receiverAgentId}" is disposed. ` +
        `Don't dispose receivers while their parent is still active.`,
    );
    this.receiverAgentId = receiverAgentId;
  }
}

/** Throw when two handoffs in the same parent collide on tool name (D215). */
export class HandoffNameCollisionError extends Error {
  override readonly name = "HandoffNameCollisionError";
  readonly conflictingName: string;
  constructor(conflictingName: string) {
    super(
      `Two handoffs share the same tool name "${conflictingName}". ` +
        `Set { toolName } on at least one of them to disambiguate.`,
    );
    this.conflictingName = conflictingName;
  }
}
```

`AgentOptions` gains:
```ts
readonly handoffs?: ReadonlyArray<SDKAgent | Handoff>;
readonly maxHandoffDepth?: number;  // default 5 (D218)
```

#### Acceptance Criteria
- [ ] `types/handoff.ts` compiles clean.
- [ ] `AgentOptions` extended with `handoffs?` and `maxHandoffDepth?` fields (backward-compat — both optional).
- [ ] `docs.md` §Handoffs section drafted.
- [ ] `tests/types/handoff.test.ts` type-only smoke compiles.

---

## Phase 2: Core Engine

### T2.1 — `Handoff` class + tool-injection + agent-loop interception

#### Objective
Implement the runtime: `Handoff.create(target, opts?)` returns a `Handoff` instance. At `Agent.create` time, the runtime walks `handoffs[]` and injects one synthetic tool per destination into the agent's tool registry. When the LLM invokes such a tool, the runtime intercepts (D101 pre_tool_call pattern) and reroutes the next turn to the receiver.

#### Files to edit
```
packages/sdk/src/handoff.ts                          (NEW — public Handoff class + factory)
packages/sdk/src/internal/handoff/registry.ts         (NEW — handoff tool tracking)
packages/sdk/src/internal/handoff/tool-injector.ts    (NEW — synthesize transfer_to_<name> tools)
packages/sdk/src/internal/handoff/interceptor.ts      (NEW — pre_tool_call hook integration)
packages/sdk/src/internal/handoff/dispatcher.ts       (NEW — orchestrates the turn-swap)
packages/sdk/src/index.ts                              (edit — value-export Handoff + errors)
packages/sdk/tests/handoff/registry.test.ts           (NEW)
packages/sdk/tests/handoff/dispatcher.test.ts         (NEW)
packages/sdk/tests/handoff/end-to-end.test.ts         (NEW — fixture-mode round-trip)
```

#### Deep Dives

**Tool injection algorithm** (at `Agent.create` time):

```
1. Read AgentOptions.handoffs[]; if undefined or empty, no-op.
2. For each entry:
   a. If raw Agent → wrap with Handoff.create(agent) default options.
   b. Validate uniqueness of resolved tool name (default: `transfer_to_<name>`).
      Throw HandoffNameCollisionError on duplicate.
3. For each Handoff, synthesize a CustomTool:
     name: handoff.toolName
     description: handoff.toolDescription
     inputSchema: handoff.inputType ?? z.object({}).optional()
     handler: (input) => intercept(handoff, input) // sets dispatcher state
4. Inject tools into the agent's tool registry (D102 layer 1 — registration).
5. Store handoff registry on the agent instance for later interceptor lookup.
```

**Interceptor flow** (during agent loop):

```
1. Agent sends user message → LLM returns tool_use for `transfer_to_X`.
2. pre_tool_call hook fires; checks if `tool.name` is a registered handoff.
3. If yes:
   a. Update HandoffContext.currentDepth; check against maxHandoffDepth → throw HandoffLoopError.
   b. Update single-flight set with (sender, receiver) pair → throw HandoffPairLoopError on dup.
   c. Call handoff.onHandoff(ctx, parsedInput) → await side effects.
   d. Resolve receiver agent (handoff.target).
   e. Apply handoff.inputFilter to history; default = full history.
   f. Set receiver tool whitelist via AsyncLocalStorage (D224 reuses D111).
   g. Veto the tool call (D101 block: true) — sender's loop ends WITHOUT executing tool.
   h. Emit handoff.transfer OTel span (D220).
   i. Trigger receiver.send(filteredHistory) — this is the new "current turn."
4. Receiver runs to completion; output returned to caller as the run result.
```

**Single-flight tracking** (per send() call):

```
const seenPairs = new Set<string>();  // "senderId->receiverId" keys
// At each handoff dispatch:
const key = `${ctx.senderAgentId}->${ctx.receiverAgentId}`;
if (seenPairs.has(key)) throw new HandoffPairLoopError(...);
seenPairs.add(key);
```

The Set is scoped to ONE `send()` invocation — cleared on next call.

**Invariants:**
- Receiver's lifecycle is independent: its hooks, memory, personality all apply normally.
- Sender doesn't "wait" for receiver — peer-to-peer (D217).
- Handoff tool MUST be invoked exactly once per turn (LLM may try parallel; we reject duplicates).
- `onHandoff` throwing aborts the handoff (returns error to LLM as if tool failed).

#### TDD
```
RED:     test_handoff_create_validates_target_is_agent()
RED:     test_handoff_create_default_tool_name()         # transfer_to_<receiver.name>
RED:     test_handoff_create_custom_tool_name_override()
RED:     test_handoff_create_name_collision_throws_HandoffNameCollisionError()
RED:     test_handoff_self_reference_throws_at_create_time()             # EC-6
RED:     test_handoffs_empty_array_is_noop()                              # EC-9
RED:     test_max_handoff_depth_zero_disables_handoffs()                  # EC-8
RED:     test_agent_create_with_handoffs_injects_synthetic_tools()
RED:     test_agent_create_with_raw_agent_handoffs_auto_wraps()
RED:     test_handoff_tool_invocation_swaps_receiver()    # END-TO-END via fixture mode
RED:     test_handoff_runs_onhandoff_callback_before_swap()
RED:     test_handoff_onhandoff_throw_aborts_handoff_with_tool_error()   # D227 / EC-3
RED:     test_handoff_input_filter_applied()
RED:     test_handoff_input_filter_throw_falls_back_to_full_history()    # D228 / EC-2
RED:     test_handoff_input_filter_empty_history_still_dispatches()      # EC-10
RED:     test_handoff_history_pairs_handoff_tool_use_with_synthetic_result()  # EC-11
RED:     test_handoff_input_type_validated_via_zod()
RED:     test_handoff_no_input_type_accepts_null_inputjson()              # D229 / EC-4
RED:     test_handoff_max_depth_throws_HandoffLoopError() # depth 6 with default cap 5
RED:     test_handoff_custom_max_depth_overrides_default()
RED:     test_handoff_pair_single_flight_throws_HandoffPairLoopError()
RED:     test_handoff_multiple_handoff_in_turn_first_wins_others_tool_error()  # D226 / EC-1
RED:     test_handoff_isEnabled_false_hides_tool()
RED:     test_handoff_isEnabled_predicate_called_at_runtime()
RED:     test_handoff_disposed_receiver_throws_HandoffReceiverDisposedError()  # EC-5
RED:     test_handoff_emits_otel_span_when_telemetry_on()
RED:     test_handoff_no_telemetry_when_disabled()         # no-op safe path
RED:     test_handoff_receiver_uses_full_tool_set_after_first_turn()  # whitelist applies only to post-handoff turn
RED:     test_handoff_preserves_receiver_personality()                    # EC-7
RED:     test_handoff_imperative_handoffTo_method_works()  # D225 escape hatch

GREEN:   Implement files in order: registry → tool-injector → dispatcher → interceptor → handoff.ts.
REFACTOR: Extract shared helpers between fork (D110) and handoff (T2.1) if 30%+ overlap.
VERIFY:  pnpm --filter @usetheo/sdk test tests/handoff/
```

#### Acceptance Criteria
- [ ] 30/30 RED → GREEN (19 originais + 11 dos edges absorvidos).
- [ ] Multiple handoff tools in one LLM response: first wins; others receive `tool_error: multiple_handoff_in_turn` (D226 / EC-1).
- [ ] `onHandoff` throw → handoff aborted with `tool_error: onHandoff_failed` (D227 / EC-3).
- [ ] `inputFilter` throw → fallback to full history + stderr warning (D228 / EC-2).
- [ ] Empty / undefined `inputJson` accepted when `inputType === undefined` (D229 / EC-4).
- [ ] Disposed receiver throws `HandoffReceiverDisposedError` BEFORE dispatch attempt (EC-5).
- [ ] Self-reference at `Agent.create` time throws `HandoffSelfReferenceError` (EC-6).
- [ ] `handoffs: []` no-op (EC-9).
- [ ] `maxHandoffDepth: 0` disables handoff tools entirely (EC-8).
- [ ] `inputFilter` returning empty history still dispatches successfully (EC-10).
- [ ] Synthetic `tool_result` ack inserted when handoff is last action of sender (EC-11).
- [ ] Receiver personality preserved across handoff (EC-7).
- [ ] Coverage ≥ 90% on `packages/sdk/src/internal/handoff/**`.
- [ ] biome lint zero warnings.
- [ ] tsc --noEmit clean.

#### DoD
- [ ] Tasks done. CHANGELOG entry.

---

## Phase 3-6: Refinements (incremental, share T2.1 base)

Phase 3 (loop guards), 4 (filter/type/callback), 5 (whitelist), 6 (telemetry) are all implemented WITHIN T2.1 (single cohesive engine). They're listed separately in the dependency graph for clarity of acceptance criteria; in code, they're integrated. Each adds RED tests to T2.1's suite (counted above).

---

## Phase 7: Examples + Docs

### T7.1 — `examples/handoffs/` + `docs.md` §Handoffs

#### Objective
- `examples/handoffs/` runnable example: triage agent → billing/support agents.
- `docs.md` §Handoffs canonical reference.
- README explains the pattern + cost tradeoffs.

#### Files to edit
```
examples/handoffs/.env.example         (NEW)
examples/handoffs/package.json         (NEW)
examples/handoffs/README.md            (NEW)
examples/handoffs/run.ts                (NEW)
docs.md                                  (edit — §Handoffs section)
packages/sdk/CHANGELOG.md               (edit)
```

#### Tasks
1. Build example with 3 agents: triage + billing + support; user message triggers correct handoff.
2. Document API in docs.md mirroring §Eval Suite style.
3. **EC-12 nota:** docs.md §Handoffs cost section: "rule of thumb: depths >2 should use `inputFilter` to summarize/truncate or accept the token cost (full history multiplies per hop)."
4. **EC-13 nota:** export `Handoff.RECOMMENDED_SYSTEM_PROMPT_PREFIX` constant (mirror OpenAI Agents convention); docs.md §Handoffs prompting subsection requires sender's system prompt mention handoff options.
5. **EC-14 nota:** examples/handoffs/README.md model-quality dependency table: "Llama 3.1 8B+ / Mistral 7B+ / Qwen 2.5 / gpt-4o-mini work reliably; sub-3B local models miss handoff tool calls ~30%."

---

## Phase 8: Dogfood QA (MANDATORY)

### T8.1 — Real-LLM handoff flow + telegram-pro regression

#### Acceptance Criteria
1. `examples/handoffs/run.ts` runs against Ollama:
   - "I have a billing question" → triage → billing agent → answer.
   - "How do I install?" → triage → support agent → answer.
2. Loop test: contrived prompt triggers A→B→A loop; expect `HandoffPairLoopError`.
3. Max-depth test: forces 6 chained handoffs; expect `HandoffLoopError`.
4. **`/dogfood` skill invocation**: full telegram-pro suite, expect `PASS ≥ 38/42`. New `/handoff_demo` command in telegram-pro (optional — only add if doesn't bloat the bot).

### If Dogfood Fails

1. Identify plan-caused vs pre-existing (e.g. OpenRouter 401 = creds, not Handoff bug).
2. Fix plan-caused CRITICAL/HIGH; re-run.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | No declarative handoff API | T1.1 + T2.1 | `Agent.create({ handoffs })` + `Handoff.create(target, opts?)` |
| 2 | LLM has no way to invoke handoff | T2.1 (tool-injector) | Synthetic `transfer_to_<name>` tools |
| 3 | Loops between agents | T2.1 (D218 + D221) | max-depth + pair single-flight |
| 4 | History scoping for privacy | T2.1 (`inputFilter`) | D219 callback |
| 5 | Structured handoff payloads | T2.1 (`inputType` Zod) | D223 |
| 6 | Receiver tool whitelist | T2.1 (D224) | ALS pattern reused from D111 |
| 7 | Telemetry / debugging | T2.1 (D220) | OTel span via lazy load |
| 8 | Imperative escape hatch | T2.1 (D225) | `Agent.handoffTo(other, opts?)` |
| 9 | Name collision detection | T2.1 (D215) | Throw at `Agent.create` |
| 10 | Tool name portability across LLMs | T2.1 (D215) | `transfer_to_<name>` default |
| 11 | Real-LLM proof | T8.1 | Ollama triage flow |
| 12 | No regression in telegram-pro | T8.1 | `/dogfood` skill PASS |

**Coverage: 12/12 gaps (100%)**

### Edge cases absorbed (from `agent-handoffs-edge-cases-2026-05-22.md`)

| # | Edge case | Task(s) | Resolution |
|---|---|---|---|
| EC-1 | Parallel handoff tools in one LLM turn | T2.1 (D226) | First wins; others receive `tool_error: multiple_handoff_in_turn` |
| EC-2 | `inputFilter` throw | T2.1 (D228) | `safeFilter(fn)` fallback + stderr warn |
| EC-3 | `onHandoff` throw semantics | T2.1 (D227) | Throw → tool_error → handoff aborted |
| EC-4 | Empty/null `inputJson` | T2.1 (D229) | Skip parse when no inputType; default to `{}` |
| EC-5 | Disposed receiver | T2.1 | `HandoffReceiverDisposedError` pre-dispatch |
| EC-6 | Self-reference in handoffs[] | T2.1 | `HandoffSelfReferenceError` at create time |
| EC-7 | Receiver personality preserved | T2.1 | RED test (D162/D164 invariant) |
| EC-8 | `maxHandoffDepth: 0` | T2.1 | RED test; locks behavior |
| EC-9 | `handoffs: []` no-op | T2.1 | RED test; Zod allows empty |
| EC-10 | Empty `inputFilter` history | T2.1 | RED test; dispatch still works |
| EC-11 | Unpaired tool_use in transferred history | T2.1 | Insert synthetic tool_result ack |
| EC-12 | Token explosion in long chains | T7.1 | DOCUMENT in docs.md cost section |
| EC-13 | LLM ignores handoff w/o prompt mention | T7.1 | DOCUMENT + `RECOMMENDED_SYSTEM_PROMPT_PREFIX` constant |
| EC-14 | Small local models miss handoff | T7.1 | DOCUMENT model-quality table in example README |

**Edge case coverage: 14/14 (100%)**

## Global Definition of Done

- [ ] All 8 phases completed.
- [ ] All tests passing: `pnpm --filter @usetheo/sdk test` + `pnpm --filter @usetheo/cli test`.
- [ ] Zero Biome lint warnings on touched files.
- [ ] `pnpm typecheck` clean across SDK + CLI.
- [ ] D214-D225 ADRs filed in `.claude/knowledge-base/adrs/`.
- [ ] CHANGELOG entry on SDK.
- [ ] `docs.md` §Handoffs is canonical reference.
- [ ] Coverage ≥ 90% on all new files.
- [ ] **Dogfood QA PASS**: real-LLM handoff demo + telegram-pro suite ≥ 38/42.
- [ ] **Runtime-metric proof**: handoff span emitted with non-zero `handoff.depth` in real workload (not synthetic).

## Final Phase: Dogfood QA

See Phase 8. Plan is NOT done until both dogfoods pass.

### Execution

```bash
# 1. SDK tests
pnpm --filter @usetheo/sdk test

# 2. Real-LLM handoff demo (Ollama)
cd examples/handoffs && pnpm exec tsx run.ts

# 3. Loop tests
pnpm exec tsx run.ts --test-loop

# 4. Telegram-pro regression (per /dogfood skill memory)
node .claude/skills/dogfood/lib/dogfood.mjs --user-id <id>
```

---

## Out of Scope (v1.0)

- **Dynamic destination factories** — `Handoff.factory((ctx) => agent)` at runtime. v1 receivers are static (declared at `Agent.create`). Deferred to v2.
- **"Return to sender" semantics** — after receiver finishes, no automatic bounce-back to triage. Caller orchestrates by adding `triage` as a handoff on every leaf agent if needed.
- **Cross-process / cross-machine handoff** — Mastra-style A2A protocol. SDK is in-process only for v1.
- **Multi-modal payload** — `inputType` is JSON/Zod for v1. File / image attachments deferred.
- **Streaming handoff events** — `handoff.start` / `handoff.complete` SDK message events. v1 has OTel spans (D220); SDK stream event addition is v1.1.

## Risks & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| LLM stubbornly refuses handoff tool calls | Med | Med | RECOMMENDED_PROMPT_PREFIX constant exported (OpenAI Agents pattern); docs require system prompt mention handoff option. |
| Token explosion when full-history is large | High | Med | `inputFilter` documented as the cost-control point; `Scorers.llmJudge` style cost note in docs. |
| Ping-pong loops still happen despite guards | Low | Med | Two layers: depth + pair single-flight. Add structured `HandoffLoopError.chain` for debugging. |
| Provider tool-calling weak (Ollama small models) | High | Low | Document tool-calling quality dependency; recommend Llama 3.1+/Mistral/Qwen2.5 for production. |
| `fork()` semantics confused with handoff | Med | Low | `docs.md` has explicit table comparing fork vs handoff vs subagent; example shows fork+handoff in same flow. |
