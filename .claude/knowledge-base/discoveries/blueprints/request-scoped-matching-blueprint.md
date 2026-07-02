# Blueprint: Request-Scoped Tool-Name Matching for Leaked-Dialect Recovery

> **Version 1.0** — Synthesizes how openclaw's `@openclaw/tool-call-repair` gates leaked-dialect tool-call recovery on the current request's tool-name set (an OPTIONAL `allowedToolNames: Iterable<string>` allowlist materialized to a plain `Set<string>`, exact-name membership, `null` on miss — zero runtime deps) and how it tests the false-positive case, cross-checked against opencode's `bun:test` tool-stream harness shape. It locks the R5 design: replace the blunt per-route `extractToolCallsFromContent` flag in `packages/sdk/src/internal/llm/openai.ts:301` with a request-scoped allowlist derived from `request.tools`, so `OpenAIStreamAccumulator.finish()` only promotes a leaked `<function=NAME>` block when `NAME` is a real tool in the request.

**Slug:** `request-scoped-matching`
**Source plan:** `.claude/knowledge-base/discoveries/plans/request-scoped-matching-plan.md`
**Owner:** paulo
**Generated:** 2026-07-01 via `/discover-execute` (executed inline — bounded 6-question investigation, per `rules/loop-engine-convention.md` a ralph-loop would be overkill)
**Confidence verdict:** {updated by `/discover-confidence`}

## Context

R5 = recommendation #5 / ADR D5 of `tool-calling-robustness-blueprint.md:122,148`. Today `extractHermesToolCalls(content, makeId)` (`packages/sdk/src/internal/llm/hermes-tool-extract.ts:56`) recovers ANY `<function=NAME>` regardless of whether `NAME` is a real tool, gated only by the per-route boolean `ProviderProfile.extractToolCallsFromContent` (`packages/sdk/src/internal/llm/openai.ts:301`). A code assistant printing a literal `<function=foo>` in a fenced code block on a leaky route is wrongly promoted. openclaw solves exactly this with request-scoped name matching. The request's tools are available at the recovery-construction site (`openai.ts:172` builds the accumulator inside `stream(request)`; `request.tools` read at `openai.ts:370`).

## Objective

Lock the shape of the request-scoped allowlist gate for our non-streaming `finish()` recovery: data structure, exact-vs-prefix, optional-allowlist semantics, name normalization, and the injection seam.

---

## Coverage Corner 1 — Integration Tests

### openclaw — the false-positive gate IS explicitly tested

openclaw tests the allowlist gate directly in `.claude/knowledge-base/references/openclaw/src/plugin-sdk/tool-payload.test.ts` against `parseStandalonePlainTextToolCallBlocks(raw, { allowedToolNames })`:

- **Negative (the false-positive gate):** `"respects allowed tool names for Harmony calls"` (`tool-payload.test.ts:243-251`) — input leaks a call named `write` but `allowedToolNames: ["read"]` → `expect(blocks).toBeNull()`. A leaked call whose name is NOT in the request's tool set is NOT recovered. This is the exact regression our R5 must reproduce.
- **Positive:** `allowedToolNames: ["exec"]` matching an `[tool:exec]` block → returns the parsed block (`tool-payload.test.ts:198-214`); `allowedToolNames: ["write"]` for an xmlish `<function=write>` block → recovered (`:225-234`).
- **Casing guard:** `"finds XML parameter close tags without lowercased string offsets"` (`:220-234`) uses `İ` (dotted capital I) to prove offset math does NOT lowercase — a Turkish-I locale bug guard (relevant to Q6: the NAME gate is exact/case-sensitive; only the closing-tag scan lowercases, `payload.ts:285`).

**Shape to mirror in vitest:** `expect(extractHermesToolCalls(leakedText, makeId, allowedNames)).toBe(no-recovery)` when the name is outside the set; recovered when inside.

### opencode — harness SHAPE only (no allowlist gating) — EC-3

`.claude/knowledge-base/references/opencode/packages/llm/test/tool-stream.test.ts` (`bun:test` + Effect) feeds synthetic deltas via `ToolStream.appendOrStart(adapter, state, idx, delta, errMsg)` then `ToolStream.finish(...)`, asserting emitted `events` arrays (`tool-input-start` → `tool-input-delta` → `tool-input-end` → `tool-call`) and the final parsed `input` (`tool-stream.test.ts:10-40`). It also asserts the error path (`appendExisting` with no prior start → `LLMError` "missing tool", `:43-49`). A grep for `allowlist|toolNames|scoped` returns nothing — **opencode does NOT test request-scoped name gating**; it contributes only the "feed synthetic stream → assert emitted events + final parsed call" harness shape. Test command: `bun test --timeout 30000 --only-failures` (`opencode/packages/llm/package.json`). The false-positive gate test comes from openclaw above, not here.

---

## Coverage Corner 2 — Dependencies

### openclaw

`@openclaw/tool-call-repair` has **ZERO runtime dependencies** — `.claude/knowledge-base/references/openclaw/packages/tool-call-repair/package.json` `dependencies: {}`. The allowlist is backed by a plain `new Set(options.allowedToolNames)` (`packages/tool-call-repair/src/payload.ts:188,332`) — no trie, no normalization library, no external dep. **Implication for R5:** the request-scoped gate needs NO new dependency (honors `rules/parsimony-ladder` Rung 2/4 — the platform `Set` is sufficient; Unbreakable Rule 9).

---

## Coverage Corner 3 — Tools

### openclaw — the injection seam (where the tool-set enters)

The tool-name set is INJECTED by the caller, never derived inside `tool-call-repair`:

- **Non-streaming path (our analog):** `parseStandalonePlainTextToolCallBlocks(text, { allowedToolNames })` takes the allowlist as a call option (`payload.ts:29-31`). The caller `promotePlainTextToolCalls(message, toolNames: Set<string>)` (`.claude/knowledge-base/references/openclaw/src/plugin-sdk/provider-stream-shared.ts:79-91`) receives a `Set<string>` and threads it as `allowedToolNames: toolNames` into `promoteStandalonePlainTextToolCallMessage({ allowedToolNames: toolNames, … })` (`provider-stream-shared.ts:91`). So the provider adapter builds the `Set<string>` from the request's tools and passes it DOWN — tool-call-repair stays request-blind (pure DIP).
- **Streaming path:** `PlainTextToolCallStreamNormalizerOptions` injects a `matcher: PlainTextToolCallNameMatcher` (`stream-normalizer.ts:26-33`) — "Tool-name matcher scoped to the exact request being normalized" (`:30`).

**Mapping to our SDK:** the identical seam already exists — `openai.ts:172` constructs `new OpenAIStreamAccumulator(extractFromContent, providerId)` inside `stream(request)`, where `request.tools` is in scope (read at `openai.ts:370`). R5 adds a third constructor arg: `new Set(request.tools?.map(t => t.name))`, threaded to `finish()`'s recovery.

---

## Coverage Corner 4 — Techniques

### T-R5a — Optional-allowlist exact-name Set gate (non-streaming) — the direct analog

openclaw's non-streaming payload parser applies ONE gate, identically in both grammar entrypoints:

```ts
// .claude/knowledge-base/references/openclaw/packages/tool-call-repair/src/payload.ts:187-190 (and :331-334)
const allowedToolNames = options?.allowedToolNames
  ? new Set(options.allowedToolNames)
  : undefined;
if (allowedToolNames && !allowedToolNames.has(opening.name)) {
  return null;
}
```

| Property | openclaw behavior | Citation |
|---|---|---|
| Option type | `allowedToolNames?: Iterable<string>` (OPTIONAL) | `payload.ts:29-31` |
| Absent allowlist | `undefined` → NO gating (recovers all) — backward-compatible | `payload.ts:187-189` |
| Present allowlist | materialize to `Set`, exact `.has(name)`; miss → `return null` (block NOT repaired) | `payload.ts:190,334` |
| Matching | exact-name, case-sensitive (no `toLowerCase` on the name) | `payload.ts:190` |
| Two gate sites | `parseBracket/Harmony` (`:190`) + `parseXmlish` (`:334`) — two grammars, one gate each; our `<function=NAME>` maps to the xmlish one | `payload.ts:190,334` |

### T-R5b — Exact vs prefix: our non-streaming `finish()` needs EXACT only

The streaming matcher exposes two methods (`stream-normalizer.ts:14-19`):

| Method | Purpose | When used | Citation |
|---|---|---|---|
| `hasNamePrefix(prefix)` | "True while streamed bytes still match at least one repairable tool name prefix" | gates a STILL-STREAMING partial name mid-buffer (`cursor >= text.length` → keep buffering) | `stream-normalizer.ts:18,93,116` |
| `hasExactName(name)` | "True only when the candidate is a complete tool name this request may repair" | final gate once the name is COMPLETE (closing `]` seen) | `stream-normalizer.ts:16,102,125` |

**Conclusion:** prefix matching is a STREAMING-buffer concern (is this partial still a possible tool? → keep buffering). Our `OpenAIStreamAccumulator.finish()` operates on a COMPLETE, already-buffered block (non-streaming) — so R5 needs ONLY exact-name membership (`Set.has(name)`), NEVER prefix. This matches openclaw's own non-streaming `payload.ts` path (exact-only, no prefix). Prefix belongs to R7 (the stream-boundary FSM), explicitly out of R5 scope.

---

## Cross-cutting Comparison

| Dimension | openclaw (`tool-call-repair`) | opencode (`packages/llm`) |
|---|---|---|
| Request-scoped name gate | `allowedToolNames?: Iterable<string>` → `Set.has(name)` exact, `null` on miss (`payload.ts:190`) | none (no allowlist in tool-stream) |
| False-positive test | `allowedToolNames:["read"]` on a `write` leak → `toBeNull()` (`tool-payload.test.ts:243-251`) | not tested |
| Exact vs prefix | payload=exact; stream=prefix(buffer)+exact(final) (`stream-normalizer.ts:16,18`) | n/a |
| Runtime deps | `{}` — plain `Set` (`package.json`, `payload.ts:188`) | Effect + bun (harness only) |
| Injection seam | caller passes `Set<string>` (`provider-stream-shared.ts:91`) | `appendOrStart(adapter, state, idx, delta)` deltas |
| Harness shape | parse `raw + {allowedToolNames}` → block-or-null | feed deltas → assert `events[]` + final `input` |

## ADRs

### D1 — R5 gate: optional exact-name `Set<string>` allowlist, threaded from `request.tools`

**Decision:** add an OPTIONAL `allowedToolNames?: Iterable<string>` parameter to `extractHermesToolCalls` (and thread a `Set<string>` built from `request.tools` through `OpenAIStreamAccumulator`); when present, only recover a `<function=NAME>` block whose `NAME` is in the set (exact, case-sensitive); when absent, current behavior (recover all) is preserved.

**Rationale:** mirrors openclaw's proven non-streaming gate (`payload.ts:190`) 1:1; the request's tools are already in scope at `openai.ts:172`; a plain `Set` needs no dependency (`rules/parsimony-ladder`, Rule 9); optional-with-absent-default keeps the change backward-compatible and testable in isolation (`rules/architecture.md` DIP — the extractor stays pure, the caller supplies request data).

**Alternatives considered:** (a) keep the blunt `extractToolCallsFromContent` route flag as the ONLY gate — rejected, it is the documented false-positive source; (b) prefix matching — rejected, prefix is a streaming-FSM concern (R7), our `finish()` is non-streaming (Q2); (c) case-insensitive matching — rejected, openclaw's name gate is case-sensitive (`payload.ts:190`) and our tool-name regex `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$` is case-significant.

**Consequences:** `extractHermesToolCalls` gains one optional arg; `OpenAIStreamAccumulator` gains one constructor arg; the internal recovery path depends on request data (correct direction, infra←request). The `extractToolCallsFromContent` route flag REMAINS as the coarse enable/disable (defense in depth — see D2).

### D2 — Keep the route flag as the enable switch; the allowlist is the WITHIN-route safety gate

**Decision:** request-scoped matching COMPLEMENTS, does not replace, the `extractToolCallsFromContent` route flag. The flag stays the coarse "this route leaks, attempt recovery at all" switch; the allowlist is the fine "only for real tools" gate applied when recovery runs.

**Rationale:** the flag is per-provider-route metadata (most routes never leak and should pay zero recovery cost); the allowlist is per-request safety. Both layers are cheap and orthogonal — the flag gates whether to look, the allowlist gates what to accept. openclaw itself layers `allowedToolNames` on top of a caller decision to invoke repair at all (`provider-stream-shared.ts:79`). NOTE: the R5 plan/blueprint phrasing "replace the blunt flag" refers to replacing the flag as the ONLY false-positive guard — the flag's role narrows to route-enablement, the allowlist becomes the correctness gate.

**Alternatives considered:** make recovery always-on gated only by the allowlist (drop the flag) — rejected, non-leaky routes would pay a per-finish tool-set build + scan for no benefit, and it widens the recovery surface across all providers.

**Consequences:** two orthogonal gates; the empty-tool-set case (a request with zero tools on a leaky route) recovers NOTHING (the set is empty → every `has()` is false) — a safe default that the tests must pin.

## Recommendations for the project

| # | Recommendation | Linked to | Priority |
|---|---|---|---|
| 1 | Add `allowedToolNames?: Iterable<string>` to `extractHermesToolCalls`; gate recovered blocks on exact `Set.has(name)`; absent = recover-all (unchanged) | Q1, Q2, Q6, D1, parsimony-ladder | HIGH |
| 2 | In `OpenAIStreamAccumulator`, build `new Set(request.tools?.map(t => t.name))` at `stream()` (`openai.ts:172`), thread to `finish()` recovery | Q5, D1, architecture.md DIP | HIGH |
| 3 | Keep `extractToolCallsFromContent` route flag as the coarse enable; allowlist is the within-route gate | Q1, D2 | HIGH |
| 4 | Regression tests mirroring openclaw: name-in-set → recovered; name-out-of-set → NOT recovered; empty-tool-set → NOT recovered; absent-allowlist → recover-all (back-compat) | Q3, Q4, D1/D2, testing.md §4.1 | HIGH |

## Blocked questions (if any)

None — all 6 research questions answered with verified citations.

## Halt-loop progress (audit trail)

- Execution mode: inline (bounded 6-question scope; `rules/loop-engine-convention.md` — ralph-loop reserved for unbounded iterative work)
- Questions answered: 6 / 6
- Questions blocked: 0
- Citations verified: all `.claude/knowledge-base/references/` paths + line ranges read directly during execution
- Coverage corners populated: 4 / 4

## Related

- Discovery plan: `.claude/knowledge-base/discoveries/plans/request-scoped-matching-plan.md`
- Umbrella blueprint: `.claude/knowledge-base/discoveries/blueprints/tool-calling-robustness-blueprint.md` (R5 = rec #5 / D5)
- Project rules: `.claude/rules/architecture.md` (DIP), `.claude/rules/parsimony-ladder.md` (Rule 9), `.claude/rules/testing.md` (§4.1 edge/negative)
