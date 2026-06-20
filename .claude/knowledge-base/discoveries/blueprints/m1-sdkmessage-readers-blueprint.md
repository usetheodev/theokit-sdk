# Blueprint: M1-5 — `SDKMessage` readers on a `./messages` subpath

> **Version 1.0** — Synthesizes Google ADK-JS content extractors (`getFunctionCalls`/`getFunctionResponses`, `content_processor_utils` text path) and CrewAI's usage-metrics reading against the proven first-party hand-roll `theocode/server/lib/sdk-mappers.ts` and the SDK's own `SDKMessage`/`CostBreakdown` types, to lock the `@theokit/sdk/messages` reader contract: `assistantText(msg)`, `extractToolUses(msg)`, and a cost reader that preserves `amountUsd: number | undefined` (ADR D377 — never 0). Decisions informed: reader signatures, the cost-honesty contract, the shape mapping (SDK discriminated blocks vs ADK genai parts), the `extractToolUses` source, and the subpath wiring.

**Slug:** `m1-sdkmessage-readers`
**Source plan:** `.claude/knowledge-base/discoveries/plans/m1-sdkmessage-readers-plan.md`
**Owner:** paulo
**Generated:** 2026-06-20 via `/discover-execute`
**Confidence verdict:** SHIPPABLE (98.8, discover-confidence 2026-06-20)

## Context

A consumer reading the `SDKMessage` stream hand-rolls a wire-event mapper (gap M1-5 / #34). First-party proof: `theocode/server/lib/sdk-mappers.ts:17-99` ships `assistantText` (concat assistant text blocks), `usageToTokens`, `costToDomain` (preserve `amountUsd ?? null`, NEVER 0 — ADR D377), `toolCallToEvent`. The SDK owns the types — `SDKMessage` (`packages/sdk/src/types/messages.ts:161`), `SDKAssistantMessage.content: Array<TextBlock|ToolUseBlock>` (`:58-66`), `ToolUseBlock` (`:19`), `CostBreakdown.amountUsd: number | undefined` (`packages/sdk/src/types/usage.ts`) — but exposes no `./messages` readers (the subpath does not exist; `assistantText` is only a fixture builder; `extractToolUses` is absent). The SDK's subpath pattern is established (`./retry`/`./concurrency`/`./path-safety` in `package.json` exports + `tsup.config.ts` entry, with a tsc-DTS exception only when an entry reaches `internal/runtime`).

## Objective

Decide the `./messages` reader signatures, the usage/cost honesty contract, and the subpath wiring, backed by the field's extractors and the first-party mappers.

---

## Coverage Corner 1 — Integration Tests

### ADK-JS

How ADK-JS tests its content readers: `.claude/knowledge-base/reference/adk-js/core/test/events/event_test.ts` exercises `getFunctionCalls` (e.g. "returns false if there are function calls" `:71`) and `.claude/knowledge-base/reference/adk-js/core/test/agents/processors/content_processor_utils_test.ts` covers the text/content extraction path. The tests assert extraction from a populated message and the empty/no-parts cases.

These seed the SDK's TDD RED cases: `assistantText` concatenates an assistant message's text blocks; `assistantText` returns "" for a non-assistant message / no text blocks; `extractToolUses` returns the assistant message's `ToolUseBlock`s; `[]` for non-assistant; cost reader returns `amountUsd` verbatim (incl. 0 for `included`) and `undefined` when unknown (never coerced to 0).

---

## Coverage Corner 2 — Dependencies

### ADK-JS

| Dependency | Version | Why | Citation |
|---|---|---|---|
| `@google/genai` (types) | — | ADK's extractors return `FunctionCall`/`FunctionResponse` imported from `@google/genai` — a DEPENDENCY on the provider's content types | `.claude/knowledge-base/reference/adk-js/core/src/events/event.ts:7` |

### CrewAI

| Dependency | Version | Why | Citation |
|---|---|---|---|
| `pydantic` (already a CrewAI dep) | — | `UsageMetrics(BaseModel)` is a pydantic model; the usage reading itself is first-party | `.claude/knowledge-base/reference/crewAI/lib/crewai/src/crewai/types/usage_metrics.py:9,32` |

**Conclusion:** ADK depends on `@google/genai` for its content types; the SDK readers depend ONLY on the SDK's OWN leaf types (`SDKMessage`, `ToolUseBlock`, `CostBreakdown`) — so M1-5 needs ZERO new dependencies (Rule 9 / KISS).

---

## Coverage Corner 3 — Tools

### ADK-JS module/export shape

`content_processor_utils.ts` exports module-level pure functions — `getContents`, `getCurrentTurnContents`, `mergeFunctionResponseEvents` (`.claude/knowledge-base/reference/adk-js/core/src/agents/processors/content_processor_utils.ts:35,109,259`); `events/event.ts` exports `getFunctionCalls`/`getFunctionResponses` as free functions over `Event` (`:108,124`). No class — a flat module of pure readers.

**SDK subpath-wiring decision (EC-3, Q6):** mirror this with a single `src/messages.ts` module of exported pure reader functions, wired as `@theokit/sdk/messages` via `package.json` `exports` + `tsup.config.ts` `entry` (same shape as `./retry`/`./concurrency`). Because the readers depend ONLY on leaf types (`types/messages.ts`, `types/usage.ts`) — never `internal/runtime` — the DTS uses the plain rollup-plugin-dts path; the tsc-cycle exception that `retry`/`concurrency` need does NOT apply here. (Confirm against `tsup.config.ts` at implement time.)

---

## Coverage Corner 4 — Techniques

### Technique 1 — Extract tool calls from a message

| Project | Approach | Citation |
|---|---|---|
| ADK-JS | `getFunctionCalls(event)` iterates `event.content.parts`, pushes `part.functionCall` for parts that have it; returns `FunctionCall[]` | `.claude/knowledge-base/reference/adk-js/core/src/events/event.ts:108-119` |
| theocode | `toolCallToEvent(msg)` maps a `tool_call` message, guarding the literal `"undefined"` | `theocode/server/lib/sdk-mappers.ts:84` |

**Divergence (EC-1):** ADK reads `part.functionCall` truthiness on Google genai parts; the SDK's assistant content is a DISCRIMINATED union — `extractToolUses(msg)` filters `block.type === "tool_use"` over `SDKAssistantMessage.content`, mirroring `sdk-mappers.assistantText`'s `block.type === "text"` filter. **Source (EC-2):** `extractToolUses` reads the assistant message's `ToolUseBlock`s and returns `[]` for non-assistant messages — the `SDKToolUseMessage` (`type:"tool_call"`) lifecycle event is a SEPARATE stream, out of scope for this reader.

### Technique 2 — Extract assistant text

| Project | Approach | Citation |
|---|---|---|
| ADK-JS | iterate parts, take `part.text && !part.thought` | `.claude/knowledge-base/reference/adk-js/core/src/agents/processors/content_processor_utils.ts:204` |
| theocode | `assistantText(msg)`: if not assistant → ""; else filter `block.type==="text"`, map `text`, join | `theocode/server/lib/sdk-mappers.ts:17-23` |

**Decision:** the SDK `assistantText(msg)` adopts theocode's exact shape over the SDK's `SDKAssistantMessage.content` (filter `block.type === "text"`, join; "" for non-assistant / no text). ADK's `!thought` exclusion maps to: the SDK keeps `text` blocks only (thinking is a separate `SDKThinkingMessage` type, not a content block).

### Technique 3 — Usage/cost honesty

| Project | Approach | Citation |
|---|---|---|
| CrewAI | `UsageMetrics` pydantic model, integer token fields (count semantics — 0 is meaningful) | `.claude/knowledge-base/reference/crewAI/lib/crewai/src/crewai/types/usage_metrics.py:32-38` |
| theocode | `costToDomain(cost?)`: `{costAmountUsd: cost?.amountUsd ?? null, costStatus: cost?.status ?? 'unknown'}` — `undefined`/absent → null, NEVER 0; a defined 0 (`included` routes) preserved | `theocode/server/lib/sdk-mappers.ts:56` |

**Decision:** the SDK cost reader preserves `amountUsd: number | undefined` verbatim (ADR D377) — `undefined` means "cost unknown" (distinct from a real `$0`). Token counts (where 0 is meaningful) may default to 0; COST must never be coerced from `undefined` to 0. This honesty distinction is the load-bearing rule the reader exists to enforce.

---

## Cross-cutting Comparison

| Dimension | ADK-JS | CrewAI | theocode (first-party baseline) |
|---|---|---|---|
| Tool-call extraction | `getFunctionCalls` over genai `parts` | n/a | `toolCallToEvent` over a `tool_call` msg |
| Text extraction | `part.text && !part.thought` | n/a | filter `block.type==="text"`, join |
| Usage/cost | pydantic UsageMetrics (token int) | — | `amountUsd ?? null` (never 0) |
| Types dependency | `@google/genai` | pydantic (present) | SDK's own types (zero new dep) |
| Module shape | flat pure functions | model class | flat pure functions |

## ADRs

### D1 — Reader signatures over `SDKMessage`

**Decision:** ship in a new `src/messages.ts`:
- `assistantText(msg: SDKMessage): string` — concat the text of an assistant message's `TextBlock`s; `""` for non-assistant / no text blocks.
- `extractToolUses(msg: SDKMessage): ToolUseBlock[]` — the assistant message's `ToolUseBlock`s; `[]` for non-assistant (EC-2).
- a cost reader (see D3) + optionally a token reader.

**Rationale:** promotes `sdk-mappers.ts:17-23` onto the SDK's native types (Rule 9); mirrors ADK's free-function `getFunctionCalls`/`getContents` shape (`event.ts:108`, `content_processor_utils.ts`). Pure, leaf-type-only.

**Alternatives considered:** methods on `SDKMessage` (rejected — `SDKMessage` is a data union, not a class; free readers keep it data-only); a class wrapper (rejected — over-engineering, KISS).

**Consequences:** consumers stop hand-rolling `assistantText`/`extractToolUses`; the readers are pure + trivially testable.

### D2 — Shape mapping: SDK discriminated blocks, not ADK genai parts (EC-1)

**Decision:** filter `block.type === "text"` / `block.type === "tool_use"` over `SDKAssistantMessage.content`, NOT ADK's `part.functionCall`/`part.text` truthiness.

**Rationale:** the SDK's content is a discriminated union (`TextBlock`/`ToolUseBlock`, `messages.ts:9-25`); the discriminant is the idiomatic + type-safe filter. ADK's parts model is foreign.

**Alternatives considered:** duck-type on `.text`/`.input` presence (rejected — loses the discriminant's type-narrowing; fragile).

**Consequences:** readers are type-safe; thinking content (a separate `SDKThinkingMessage`) is naturally excluded.

### D3 — Cost reader preserves `amountUsd: number | undefined` (never 0); subpath wiring on leaf types

**Decision:** the cost reader returns `cost?.amountUsd` (i.e. `number | undefined`) verbatim — `undefined` = "unknown", a real 0 (e.g. `included` routes) preserved. Wire `@theokit/sdk/messages` → `src/messages.ts` via `package.json` exports + `tsup` entry; DTS via the plain rollup-plugin-dts path (leaf-type deps only — no tsc-cycle exception).

**Rationale:** ADR D377 + `sdk-mappers.costToDomain` (`:56`) — conflating unknown cost with $0 is a financial-honesty bug. The readers depend only on `types/messages.ts`/`types/usage.ts` (leaf), so they avoid the `internal/runtime` import cycle that forces retry/concurrency onto the tsc path (Q6/EC-3).

**Alternatives considered:** `amountUsd ?? 0` (rejected — the exact dishonesty D377 forbids); a new subpath with the tsc exception (rejected — unnecessary; readers don't reach runtime).

**Consequences:** honest cost reporting downstream; a lean DTS for the new subpath.

### D4 — Zero new dependencies

**Decision:** the readers use only the SDK's own types; no `@google/genai`-style provider-types dependency.

**Rationale:** the SDK already defines `SDKMessage`/`ToolUseBlock`/`CostBreakdown` (Q5 — ADK needs `@google/genai`; the SDK doesn't). Rule 9 / KISS.

**Alternatives considered:** none credible.

**Consequences:** no dependency surface added.

## Recommendations for the project

| # | Recommendation | Linked to | Priority |
|---|---|---|---|
| 1 | Ship `assistantText` + `extractToolUses` in `src/messages.ts`, exported via `@theokit/sdk/messages` | Q1,Q2,Q6 · D1,D3 · architecture.md §2 | HIGH |
| 2 | Filter via the discriminated `block.type` (text/tool_use); `extractToolUses` reads the assistant message's `ToolUseBlock`s, `[]` otherwise | Q1 · D2 · EC-1/EC-2 | HIGH |
| 3 | Cost reader preserves `amountUsd: number | undefined` (never 0); token reader may default counts to 0 | Q3 · D3 · ADR D377 | HIGH |
| 4 | Zero new deps — use the SDK's own types | Q5 · D4 · Rule 9 | HIGH |
| 5 | Wire the subpath on the plain rollup-plugin-dts path (leaf-type deps; no tsc exception) | Q6 · D3 | MEDIUM |
| 6 | TDD RED cases from ADK tests: text concat, tool-use extraction, empty/no-parts, non-assistant → ""/[], cost undefined-not-0 | Q4 · testing.md §3 | HIGH |

## Blocked questions (if any)

| Question | Reason | Suggested human follow-up |
|---|---|---|
| (none) | all 6 answered with verified citations | — |

## Halt-loop progress (audit trail)

- Iterations used: 1 (inline per-iteration contract; bounded read-and-synthesize)
- Questions answered: 6 / 6
- Questions blocked: 0
- Citations verified: all `.claude/knowledge-base/reference/` paths confirmed on disk (Step 7 sanity check)
- Promise emitted: `<promise>BLUEPRINT_COMPLETE</promise>`

## Related

- Discovery plan: `.claude/knowledge-base/discoveries/plans/m1-sdkmessage-readers-plan.md`
- Edge-case review: `.claude/knowledge-base/reviews/m1-sdkmessage-readers-edge-cases-2026-06-20.md`
- First-party anchors: `theocode/server/lib/sdk-mappers.ts`, `packages/sdk/src/types/messages.ts`, `packages/sdk/src/types/usage.ts`, `packages/sdk/tsup.config.ts`
- Project rules: `.claude/rules/architecture.md`, `.claude/rules/testing.md`, `.claude/rules/no-stubs-no-mocks-no-wired.md`
