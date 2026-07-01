# Blueprint: A professional, isolated Tool-Input **Sanitization** system for `@theokit/sdk` custom tools

> **Discovery verdict:** SHIPPABLE (98.0, 2026-07-01 — 14/14 citations verified, 0 caps) · **Slug:** `tool-calling-robustness` · **Date:** 2026-07-01
>
> Synthesizes how five SOTA multi-model agents sanitize/normalize/repair tool-call inputs, to design a **public, isolated, reusable sanitization primitive** that our SDK users apply inside their own `defineTool` custom tools — and that the SDK's OWN leaked-dialect recovery consumes internally (DRY). Supersedes the informal 2026-07-01 synthesis at this path with a gated, citation-backed blueprint.

## Context

The P0 fix `@theokit/sdk@2.13.1` trimmed leaked-dialect parameter values (`packages/sdk/src/internal/llm/hermes-tool-extract.ts` `parseHermesParams` was not trimming the VALUE → qwen3-coder paths carried `\n` → `read_file`/`glob_files`/`search_text` failed `not_found` → multi-read loops never converged). That fix revealed a broader product opportunity: **the same class of input hygiene (trim, schema-aware coercion, JSON-repair, validation-with-clear-errors) is valuable to every user writing a custom tool**, not just to the SDK's internal recovery path. Today a consumer's `defineTool` receives raw model-emitted args and must hand-roll their own defensive parsing. This discovery studies the prior art to design a **first-class, isolated Sanitization surface** exposed to custom tools. Project rules constraining the design: `rules/architecture.md` (DIP — the sanitizer is a pure domain primitive with no LLM/transport coupling), `rules/testing.md` (every sanitizer rule unit-testable in isolation), `rules/parsimony-ladder.md` (don't reinvent JSON-repair — reuse a mature lib).

## Objective

Decide the **public API shape, isolation boundary, and default behavior** of a Tool-Input Sanitization system that (a) SDK users invoke inside their custom tools, and (b) the SDK's internal leaked-dialect recovery reuses — grounded in how openclaw, agentfw, opencode, cline, and vercel-ai-sdk solve tool-input hygiene.

- [x] All research questions answered with citations to `.claude/knowledge-base/references/`
- [x] Cross-cutting comparison table populated for every in-scope reference project
- [x] Recommendations section provides ≥1 concrete decision proposal per research question
- [x] `/discover-confidence` verdict = SHIPPABLE (98.0)

## Coverage Corner 1 — Integration Tests

How the references unit-test their tool-input parsing/sanitization — the RED-set template for OUR sanitizer's TDD.

### agentfw — dialect parser + coercion test inventory (Q4)

`.claude/knowledge-base/references/agentfw/packages/agentfw/src/daemon/translate/xml-tool-calls.test.ts` is a dense behavior suite that maps almost 1:1 to the cases a sanitizer must cover:

| Case | Line | What it proves for OUR sanitizer |
|---|---|---|
| returns null when no markup | `:9` | no-op on clean input (never fabricate) |
| single bare block, object args | `:14` | happy path |
| JSON-encoded-string args parsed | `:40` | double-serialized args must be unwrapped (cline `normalizeJsonLikeStringsForSchema` analog) |
| empty-nested-wrapper without leaking XML | `:48` | malformed input never leaks raw markup downstream |
| drops malformed inner blocks, keeps valid | `:60` | partial-failure resilience |
| coerces booleans / null / numbers + inline JSON | `:90` | the core coercion contract (string→typed) |
| malformed duplicated-opening real-user payload | `:112` | real-world tolerant recovery |
| unclosed `<tool_call name>/<parameter>` fallback | `:158` | tolerant fallback path |
| single unterminated tag | `:181` | fail-open, no fabricated call |
| zero `tool_use` when no `<parameter>` | `:190` | honest empty result |

Take-away: the sanitizer's test suite must cover **edge cases (extremes of valid: multi-block, JSON-string args, coercion) AND negative cases (malformed/unterminated → typed empty, never a crash or leak)** — exactly the two lenses in `rules/testing.md § 4.1`.

### opencode — streaming accumulator test shape (Q5)

`.claude/knowledge-base/references/opencode/packages/llm/test/tool-stream.test.ts` verifies the streaming reconstruction (relevant to the SDK's internal recovery consumer, not the public sanitizer per se):

- `describe("ToolStream", ...)` `:9`; asserts `tool-input-delta` fragment accumulation `:24-28`; the finalized shape `:29`,`:57`,`:82`; a missing-tool delta surfaces a typed `LLMError` `:43-44`. Runner: `bun:test` (`:1`).

Take-away: streaming arg-fragment tests assert **accumulate-then-finalize** with a typed error on malformed identity — our internal stream path (if P3 lands) tests the same way in vitest.

## Coverage Corner 2 — Dependencies

Is tool-input sanitization dependency-free, or does it lean on a mature JSON-repair lib? (Q6 — informs `rules/parsimony-ladder.md` don't-reinvent.)

- **cline uses the `jsonrepair` npm lib** — declared `"jsonrepair": "^3.13.2"` in `.claude/knowledge-base/references/cline/sdk/packages/shared/package.json:59`, imported at `.claude/knowledge-base/references/cline/sdk/packages/shared/src/parse/json.ts:1` (`import { jsonrepair } from "jsonrepair"`). Cline does NOT hand-roll structural JSON repair.
- **openclaw's stream-normalizer package is dependency-free** — `.claude/knowledge-base/references/openclaw/packages/tool-call-repair/package.json` declares **no `dependencies` field at all** (name `@openclaw/tool-call-repair`, `private: true`, `exports: { ".": "./src/index.ts" }`). Its grammar/state-machine is pure TS; the *arg-JSON* parsing is delegated to the caller (promotion emits provider-native events, and JSON parsing of the promoted args happens in the provider layer, not in the normalizer).

**Verdict for our design:** the sanitizer's *structure* (trim, coerce, strip, state-machine) is dependency-free pure TS; its *JSON-repair* rung should reuse **`jsonrepair`** (mature, `^3.x`, the same lib cline trusts) rather than hand-rolling — Rung 2/4 of `rules/parsimony-ladder.md`. Zod stays the validation layer (already a peer dep per SDK `CLAUDE.md § Locked toolchain`).

## Coverage Corner 3 — Tools

Where does the sanitization/normalization layer LIVE, and how is it exercised? (Q7 — informs OUR isolation boundary.)

- **openclaw ships it as an ISOLATED package** — `@openclaw/tool-call-repair` (`.claude/knowledge-base/references/openclaw/packages/tool-call-repair/package.json`, `exports: { ".": "./src/index.ts" }`), separate from every provider adapter. Downstream is dialect-blind: the provider stream is wrapped via the **`PlainTextToolCallStreamNormalizerOptions` seam** (`.claude/knowledge-base/references/openclaw/packages/tool-call-repair/src/stream-normalizer.ts:26`) — an options object injecting `createPromotedToolCallEvents` (`:29`), `matcher` (`:31`), and `normalizeDoneMessage` (`:33`). Pure DIP: the package defines the contract; the provider satisfies it.
- **opencode** exercises its tool-stream layer under `bun:test` (`.claude/knowledge-base/references/opencode/packages/llm/test/tool-stream.test.ts:1`; `.claude/knowledge-base/references/opencode/packages/llm/package.json` `scripts.test = "bun test --timeout 30000 --only-failures"`).

**Verdict for our design:** the sanitizer must be an **isolated module with a narrow public surface** — a dedicated subpath export of `@theokit/sdk` (e.g. `@theokit/sdk/sanitize`, mirroring the existing `@theokit/sdk/subscription` subpath precedent in `CLAUDE.md § Roadmap`), consumed by user custom tools AND by the SDK's internal recovery. Tested in vitest (SDK toolchain), pure — no transport import (DIP boundary in `rules/architecture.md`).

## Coverage Corner 4 — Techniques

The algorithms to borrow. (Q1 openclaw stream-normalization + request-scoping, Q2 agentfw cascade+trim+coerce+tolerant, Q3 opencode/cline loop-guard.)

### T1 — Stream-boundary normalization state machine + request-scoped matching (openclaw, Q1)

`.claude/knowledge-base/references/openclaw/packages/tool-call-repair/src/stream-normalizer.ts` normalizes leaked dialects **at the stream boundary** via a 3-state machine `PlainTextToolCallBufferState = "possible" | "impossible" | "over-cap"` (`:50`), computed by `getPlainTextToolCallBufferState` (`:339`) which tests three dialect matchers (`:348-350`):
- `couldStillBeXmlishFunctionToolCall` (`:155`) — **our exact `<function=NAME>` dialect**;
- `couldStillBeHarmonyStandaloneToolCall` (`:188`) — gpt-oss `<|channel|>…<|call|>`;
- `couldStillBeBracketedStandaloneToolCall` (`:75`) — `[tool:name]{json}`.

Buffer discipline: `TEXT_TOOL_CALL_BUFFER_MAX_CHARS = 256_000` (`:41`) + a `+64_000` tail window (`:45`) so a huge leaked payload neither grows unbounded nor loses its visible suffix. Completed blocks are stripped via `stripSerializedToolCallPrefixes` (`:316`, bounded 32-iteration loop).

**Request-scoped matching is the load-bearing safety technique**: every matcher gates on `matcher.hasNamePrefix(name)` / `matcher.hasExactName(name)` (`:16`,`:18`, used at `:93`,`:102`,`:173`,`:182`,…) — recovery only fires for a tool name **in the current request's tool set**. This is the correct fix for our documented "a code assistant printing a literal `<function=` in a fenced block" concern (currently handled by a blunt default-off flag in `packages/sdk/src/internal/llm/hermes-tool-extract.ts`). Promotion emits provider-native events via `createPromotedToolCallEvents` (`:29`); `.claude/knowledge-base/references/openclaw/packages/tool-call-repair/src/promote.ts:60` trims every promoted text run (also `:79`, `:141`, `:169`, `:187`; `promoteStandalonePlainTextToolCallMessage:174`). The dialect grammars (`findXmlishToolCallEnd`, `END_TOOL_REQUEST`, Harmony markers) live in `.claude/knowledge-base/references/openclaw/packages/tool-call-repair/src/grammar.ts:2`.

### T2 — Multi-dialect cascade + fast gate + TRIM + `coerceParameter` + tolerant fallback + always-strip (agentfw, Q2)

`.claude/knowledge-base/references/agentfw/packages/agentfw/src/daemon/translate/xml-tool-calls.ts` (**MIT — citable**) is the sanitization gold standard:
- **Fast pre-gate** `ANY_TAG_RE` (`:47`) screens before any parser runs; `extractInlineToolCallsXml` (`:59`) returns null immediately on miss (`:60`).
- **Cascade**: Hermes-JSON (`:62`), Anthropic-invoke (`:65`), tolerant fallback (`:68`).
- **TRIM at every value site**: `(match[1] ?? '').trim()` (`:89`), name `:155`, `(m[2] ?? '').trim()` (`:179`) — the exact reference for our P0 fix — and tolerant value `:249`.
- **`coerceParameter`** (`:191`): the per-value type cascade `'' → ''`; `'true'/'false' → bool`; `'null' → null`; numeric-regex → Number; `{…}`/`[…]` → `JSON.parse` else raw string. **This is the core public-sanitizer primitive.**
- **Tolerant fallback** `extractTolerantNamedCalls` (`:231`) — "last named open wins" (`:252`) for malformed/misspelled tags; `NAMED_OPEN_RE` (`:226`) + `STRIP_ALL_XML_RE` (`:228`).
- **Always-strip invariant**: even on zero recovered calls, `stripTrim` (`:263`) removes residual markup from visible text so the model never re-ingests its own broken XML.

**Scope note (EC-3):** agentfw parses the JSON `<tool_call>{…}` + `<invoke>` grammars, NOT our attribute-inline `<function=NAME><parameter=KEY>` (that grammar is T1/openclaw + our own extractor). The borrowed value is the **technique** (gate→cascade→trim→coerce→tolerant→always-strip), applicable to our grammar.

### T3 — Loop / no-progress safety net (opencode + cline, Q3)

The sanitizer prevents malformed args; a loop-guard prevents the *symptom* (repeated failing calls) from hanging the run — it would have caught our P0 hang even before the root fix.
- **opencode doom-loop**: `DOOM_LOOP_THRESHOLD = 3` (`.claude/knowledge-base/references/opencode/packages/opencode/src/session/processor.ts:35`); the last 3 parts with same tool name + identical `JSON.stringify(part.state.input) === JSON.stringify(input)` (`:522-531`) → `permission: "doom_loop"` (`:539`), not a silent abort; `continue_loop_on_deny` opt-in (`:966`).
- **cline**: `toolCallSignature` (key-sorted JSON, `.claude/knowledge-base/references/cline/sdk/packages/core/src/runtime/safety/loop-detection.ts:50`) drives `consecutiveIdenticalCount` (`:23`) with `softWarning`/`hardEscalation` thresholds (`:62-63`); `MistakeTracker.maxConsecutiveMistakes` (`.claude/knowledge-base/references/cline/sdk/packages/core/src/runtime/safety/mistake-tracker.ts:57`) with `forceAtLimit` (`:48`,`:84`) → typed stop (`:54`).

**Take-away:** a fingerprint (name + serialized input) over the last N calls → guidance/permission nudge (not hard abort) is the cross-model convergent design.

## Cross-cutting comparison table

| Dimension | openclaw | agentfw (MIT) | opencode | cline | vercel-ai-sdk | → OUR sanitizer |
|---|---|---|---|---|---|---|
| trim values | promote.ts (`:60`…) | `:89`,`:179`,`:249` | n/a | normalize | n/a | **yes, default** |
| schema-aware coerce | `.claude/knowledge-base/references/openclaw/packages/llm-core/src/validation.ts` `coerceWithJsonSchema` | `coerceParameter:191` | n/a | `normalizeJsonLikeStringsForSchema` | Zod | **opt-in, schema-driven** |
| JSON-repair | delegated | JSON.parse fallback | n/a | **jsonrepair lib** | isParsableJson | **reuse `jsonrepair`** |
| tolerant fallback | strip 32-iter `:316` | last-open `:252` | n/a | n/a | repairToolCall hook | **yes (recovery path)** |
| request-scoped guard | `matcher.*` `:16/18` | n/a | n/a | n/a | tool-set | **yes (recovery path)** |
| isolation | own pkg | translate module | protocol util | shared/parse | core/generate-text | **`@theokit/sdk/sanitize` subpath** |
| loop guard | n/a | n/a | doom-loop `:35` | Loop+Mistake trackers | stopWhen | **doom-loop fingerprint** |

## Recommendations

1. **Ship a public `sanitizeToolInput` primitive** (isolated `@theokit/sdk/sanitize` subpath). Signature (proposal): `sanitizeToolInput(input, { schema?, trim=true, coerce=false, repairJson=false }): { value, changed, notes }`. Default = trim-only (the P0 lesson, safe for everyone); `coerce`/`repairJson` opt-in (respects the SDK's locked "values are strings; Zod coerces" decision — see D3). Modeled on agentfw `coerceParameter` (`:191`) + cline schema-walk. — answers Q2/Q6.
2. **Expose it to custom tools via `defineTool`** — a declarative `sanitize?: boolean | SanitizeOptions` field so a user's tool opts in without wiring, PLUS the standalone function for manual use inside `execute`. — answers the user's core ask.
3. **Reuse `jsonrepair ^3.x`** for the repair rung, not hand-rolled (cline precedent `shared/package.json:59`). — answers Q6, `parsimony-ladder`.
4. **Internal DRY**: the SDK's leaked-dialect recovery (`hermes-tool-extract.ts`) calls the SAME `sanitizeToolInput` for its trim/coerce, so the public primitive and the internal recovery never diverge. — answers Q1/Q2.
5. **Add request-scoped tool-name matching** to the internal recovery (openclaw `matcher.*` `:16/18`) to replace the blunt default-off flag. — answers Q1.
6. **Add a doom-loop no-progress guard** (opencode `:35/531`) as the safety net that converts a silent hang into a typed stop. — answers Q3.
7. **Stream-boundary normalization (openclaw T1)** is the eventual architectural fix but is the largest change — recommend it as a LATER phase, gated on the public sanitizer + recovery robustness landing first. — answers Q1.

## ADRs

### D1 — Public surface: a standalone `sanitizeToolInput` + a `defineTool` `sanitize` field
**Decision:** ship both a pure function (`@theokit/sdk/sanitize`) and a declarative `defineTool({ sanitize })` opt-in.
**Rationale:** two consumer shapes — power users sanitize manually inside `execute`; most users want a one-flag opt-in. Mirrors agentfw's pure `coerceParameter` + vercel's per-tool config. **Alternatives:** function-only (rejected — most users won't wire it); auto-apply-always (rejected — violates the strings-stay-strings decision + surprises).
**Consequences:** two entry points to document in `docs.md`; one shared implementation.

### D2 — Isolation boundary: dedicated `@theokit/sdk/sanitize` subpath, pure, no transport import
**Decision:** the sanitizer lives in its own subpath/module with zero LLM/transport dependency.
**Rationale:** `rules/architecture.md` DIP — a domain primitive; openclaw ships it as an isolated package (`@openclaw/tool-call-repair`), the proven pattern. Isolation is exactly the user's ask ("de forma isolada"). **Alternatives:** bury it in the internal extractor (rejected — not reusable by custom tools).
**Consequences:** new subpath export (precedent: `@theokit/sdk/subscription`); publint/attw must cover it.

### D3 — Default = trim-only; coercion/repair are opt-in (preserve "values are strings; Zod coerces")
**Decision:** `sanitizeToolInput` trims by default; `coerce` and `repairJson` are explicit opts.
**Rationale:** the SDK deliberately keeps type-coercion out of the extractor (`hermes-tool-extract.ts:26-30`; aligns with vercel validating via Zod). Trim is hygiene (safe); coercion changes types (must be opt-in). `rules/parsimony-ladder § Never on the chopping block` — don't weaken the typed-error boundary. **Alternatives:** coerce-by-default (rejected — silent type changes).
**Consequences:** honest, non-surprising default; power users opt into more.

### D4 — Don't reinvent JSON-repair: reuse `jsonrepair ^3.x`
**Decision:** the `repairJson` rung wraps the `jsonrepair` lib.
**Rationale:** `rules/parsimony-ladder` Rung 2/4; cline trusts it (`shared/package.json:59`); structural JSON repair is a solved, spec-adjacent problem (Unbreakable Rule 9). **Alternatives:** hand-roll (rejected — maintenance + correctness risk).
**Consequences:** one new optional dependency, isolated behind the opt-in flag.

### D5 — Internal recovery reuses the public sanitizer + gains request-scoped matching
**Decision:** `hermes-tool-extract.ts` calls `sanitizeToolInput` for trim/coerce, and gates recovery on the request's tool-name set (openclaw `matcher.*`).
**Rationale:** DRY (`CLAUDE.md` Rule 12) — the public primitive and internal recovery must not diverge; request-scoping (openclaw `:16/18`) is the precise false-positive guard the current default-off flag approximates bluntly. **Alternatives:** keep them separate (rejected — divergence risk, re-introduces the P0 class of bug).
**Consequences:** the internal path depends on the public module (correct direction — infra→domain).

## Blocked questions (if any)

None — all 7 research questions answered with verified citations; `openai-agents-python` was descoped in the plan (clone empty on disk).
