# Discovery Plan: Robust multi-model tool-calling for `@theokit/sdk`

> **Version 1.1** — (v1.1 absorbed 3 MUST-FIX from `reviews/tool-calling-robustness-edge-cases-2026-07-01.md`: EC-1 Q1 read-full, EC-2 Q6 broaden JSON-repair scope, EC-3 Q2 dialect-conflation note; + EC-4/EC-5 halt-loop checkpoints.) Investigate how SOTA multi-model agents recover and normalize *leaked* tool-call dialects (models that emit their function-call dialect as assistant TEXT instead of native `tool_calls`), so the SDK can move from its current narrow, post-hoc, single-dialect extractor (`hermes-tool-extract.ts`) to a robust, stream-boundary normalization layer. In scope: **openclaw** (dedicated `tool-call-repair` package — closest analog to our `<function=><parameter=>` dialect), **agentfw** (multi-dialect cascade + tolerant fallback, MIT), **opencode** (streaming tool-stream accumulator + doom-loop guard), **cline** (loop/mistake detection + orphaned-tool-result repair), **vercel-ai-sdk** (repairToolCall + streaming tracker). Blueprint output: a phased design (P1-P4) grounded in prior art with file:line citations, ready for `/to-plan`.

**Slug:** `tool-calling-robustness`
**Owner:** paulo
**Created:** 2026-07-01
**Time budget:** 8h (per-project breakdown in ADR D1)

## Context

The P0 fix `@theokit/sdk@2.13.1` (2026-07-01) trimmed leaked-dialect parameter values (`parseHermesParams` was not trimming the VALUE, so qwen3-coder paths carried `\n` → `read_file`/`glob_files`/`search_text` failed `not_found` → multi-read investigation loops never converged = apparent hang). The root cause was diagnosed as a **symptom of an architectural gap**: `packages/sdk/src/internal/llm/hermes-tool-extract.ts` does narrow, single-dialect, post-hoc extraction at the `finish` boundary — no trim (fixed in P0), no coercion, no tolerant fallback, no request-scoped guard, no loop-detection safety net, and crucially not at the stream boundary. An informal 6-way synthesis lives at `.claude/knowledge-base/discoveries/blueprints/tool-calling-robustness-blueprint.md`; this discovery formalizes it with verified citations under `.claude/knowledge-base/references/` so `/to-plan` can consume a gated blueprint. Project rules constraining any borrowed pattern: `rules/architecture.md` (DIP + boundary at the LLM transport), `rules/testing.md` (TDD pyramid — every borrowed technique must be unit-testable in isolation), `rules/parsimony-ladder.md` (don't reinvent JSON-repair/coercion if a mature lib or the existing extractor suffices).

## Objective

Produce a blueprint that lets us decide the exact phased design (P1-P4) and the *seam* at which leaked-dialect normalization belongs in the SDK, grounded in how five SOTA multi-model agents solve it.

- [ ] All research questions in this plan answered with citations to `.claude/knowledge-base/references/`
- [ ] Cross-cutting comparison table populated for every in-scope reference project
- [ ] Recommendations section provides at least one concrete decision proposal per in-scope research question
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/openclaw/` | `packages/tool-call-repair/src/`, `packages/llm-core/src/validation.ts` | Dedicated stream-boundary normalizer for the SAME `<function=><parameter=>` dialect we leak — the closest analog and the P3 reference. |
| `.claude/knowledge-base/references/agentfw/` | `packages/agentfw/src/daemon/translate/xml-tool-calls.ts` (+ its `.test.ts`) | Multi-dialect cascade + tolerant fallback + value-trim + `coerceParameter` (MIT — citable) — the P1/P2 parse-robustness reference. |
| `.claude/knowledge-base/references/opencode/` | `packages/opencode/src/session/processor.ts`, `packages/llm/src/protocols/utils/tool-stream.ts` (+ `packages/llm/test/tool-stream.test.ts`) | Streaming tool-stream accumulator + doom-loop no-progress guard — P2/P3 reference. |
| `.claude/knowledge-base/references/cline/` | `sdk/packages/core/src/session/services/message-builder.ts`, `sdk/packages/core/src/runtime/safety/{loop-detection,mistake-tracker}.ts` | Loop/mistake detection + `addMissingToolResults` orphaned-tool-result repair — P2/P4 reference. |
| `.claude/knowledge-base/references/vercel-ai-sdk/` | `packages/ai/src/generate-text/{parse-tool-call,tool-call-repair-function}.ts`, `packages/provider-utils/src/streaming-tool-call-tracker.ts` | `repairToolCall` hook + eager-finalize streaming tracker — P4 reference. |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/*/` docs, examples, website, marketing | Not source of truth for the technique. |
| `.claude/knowledge-base/references/*/` build artifacts (`dist/`, `node_modules/`, `.turbo/`) | Generated. |
| openclaw provider adapters (`packages/*/src/llm/providers/`) beyond the normalizer wrapper hookup | The per-provider quirk registry is out of scope for this cycle — we study the normalizer, not the 16-flag capability matrix (deferred, ADR D2). |
| Native `tool_calls` streaming assembly in every ref (non-leaked path) | Our native path already works; this discovery targets the LEAKED path only. |
| Any project NOT symlinked into `.claude/knowledge-base/references/` (e.g. openai-agents-python — clone empty on disk) | Cross-Project Rule: never cite a project we cannot read. |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** openclaw 3h (deepest — the P3 architectural core), agentfw 2h, opencode 1.5h, cline 1h, vercel-ai-sdk 0.5h.

**Rationale:** openclaw's `tool-call-repair` is the only reference that handles our exact dialect at the stream boundary, so it gets the deepest dive; agentfw is the parse-robustness gold standard (MIT, citable) so second; opencode/cline/vercel are targeted single-technique reads (loop-guard, orphaned-result-repair, repair-hook).

**Alternatives considered:** equal split (rejected — openclaw carries the architectural decision); single-project deep-dive (rejected — the blueprint's value is cross-model convergence).

**Stop condition — per question (mandatory):** When a question's Fase A returns empty matches after 3 consecutive retries with different query variants (pattern → kind-based → alternate path → broader scope), mark the question BLOCKED with reason "Fase A exhausted — no hotspots found" and continue. Do NOT pad with unrelated hotspots.

**Stop condition — per project (mandatory):** When a project's budget is exhausted with questions pending, mark remaining questions for that project BLOCKED with reason "budget exhausted" and continue. If every remaining project is `done`-or-honestly-`blocked`, emit `<promise>BLUEPRINT_BLOCKED</promise>` with the honest report — never `BLUEPRINT_COMPLETE` from a blocked state.

**Anti-pattern:** NEVER fabricate Fase B answers to close a Fase-A-exhausted question (Unbreakable Rule 3).

**Consequences:** the halt-loop stops on budget exhaustion; blocked questions surface in `## Blocked questions` as next-discovery seed.

### D2 — Investigation depth + per-provider quirk deferral

**Decision:** Read the normalizer/parser/loop-guard files end-to-end (Fase B deep); DEFER the per-provider capability/quirk matrix (openclaw's 16-flag `OpenAICompletionsCompat`, per-model thinking formats) to a follow-up discovery.

**Rationale:** P1-P4 is about the *normalization seam and its safety nets*, not about cataloguing every model's quirks (YAGNI — `rules/parsimony-ladder.md`). The quirk registry is a large separate surface with its own demand gate.

**Consequences:** the blueprint will recommend a normalization seam + dialects our routed models actually emit (qwen3-coder `<function=>`, gpt-oss Harmony), not a universal quirk engine. Cross-model breadth is captured as "which dialects/guards", not "which per-model flags".

### D3 — Behavior-preservation constraint on borrowed patterns

**Decision:** Any borrowed pattern MUST respect the SDK's locked decision "recovered values are strings; downstream Zod coerces" (documented in `hermes-tool-extract.ts:26-30`) and the DIP boundary in `rules/architecture.md` (the domain defines the tool contract; the LLM transport is an adapter).

**Rationale:** the SDK deliberately keeps type-coercion out of the extractor (aligns with Vercel, which validates via Zod). We study coercion (agentfw/openclaw) to DECIDE whether to keep that boundary — not to blindly copy it.

**Consequences:** the blueprint's coercion recommendation will be an explicit keep-or-change decision with rationale, not a silent import.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — ast-grep / grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How does OpenClaw's `tool-call-repair` normalize a leaked text dialect into synthetic native tool-call events **at the stream boundary** (buffer-while-"possible" → release-as-text on "impossible" → promote on complete), and what are its buffer caps + closing-marker scan? | techniques | `.claude/knowledge-base/references/openclaw/` | **SKIP Fase A (EC-1)** — the package is 5 small files (text-shape, not hotspot-shape). | Read `stream-normalizer.ts` + `promote.ts` + `grammar.ts` + `payload.ts` + `index.ts` end-to-end; capture the state machine states, the promote trigger, buffer cap constants, and the `<function=><parameter=>` grammar functions | State-machine description (states + transitions) + the promote condition + buffer/tail constants, each with `openclaw/packages/tool-call-repair/src/...:line` |
| Q2 | How does agentfw's `xml-tool-calls.ts` parse MULTIPLE dialects (`<tool_call>{JSON}` Hermes-JSON, `<invoke name=><parameter name=>` Anthropic-legacy) via a fast ANY_TAG gate + cascade + tolerant fallback ("last named open wins"), and how does it TRIM + `coerceParameter` values while stripping residual markup from visible text? **(EC-3 scope note: the borrowed value is the CASCADE + fast-gate + TRIM + coerce + tolerant-fallback + always-strip TECHNIQUE — NOT agentfw's specific dialect grammars. agentfw does NOT parse our attribute-inline `<function=NAME><parameter=KEY>` — that grammar is Q1 (OpenClaw) + our own `hermes-tool-extract.ts`.)** | techniques | `.claude/knowledge-base/references/agentfw/` | `grep -n "ANY_TAG\|extractHermes\|extractAnthropic\|extractTolerant\|coerceParameter\|trim\|stripTrim\|STRIP_ALL_XML" agentfw/packages/agentfw/src/daemon/translate/xml-tool-calls.ts` | Read the cascade + tolerant fallback + `coerceParameter` + strip functions; capture the trim site, the coercion cascade, the "last named open wins" heuristic, the always-strip invariant | Cascade order + trim/coerce citations + the strip-always invariant, each with `agentfw/.../xml-tool-calls.ts:line` |
| Q3 | How do opencode (doom-loop) and cline (LoopDetection + MistakeTracker) detect no-progress / identical-repeat tool calls, what are the thresholds, and is the action a hard-abort or a permission/guidance nudge? | techniques | `.claude/knowledge-base/references/opencode/`, `.claude/knowledge-base/references/cline/` | `grep -n "DOOM_LOOP\|doom\|JSON.stringify(input)\|THRESHOLD" opencode/packages/opencode/src/session/processor.ts` AND `grep -n "consecutive\|threshold\|signature\|toolCallSignature\|maxConsecutive" cline/sdk/packages/core/src/runtime/safety/loop-detection.ts cline/sdk/packages/core/src/runtime/safety/mistake-tracker.ts` | Read the doom-loop check + cline trackers; capture the fingerprint (name + serialized input), soft/hard thresholds, and the abort-vs-nudge decision | Side-by-side table: ref → fingerprint → thresholds → action, each with `...:line` |
| Q4 | How does agentfw unit-test its dialect parser — which malformed / multi-block / double-serialized / coercion cases are covered, and how are fixtures shaped? | tests | `.claude/knowledge-base/references/agentfw/` | `grep -n "it(\|describe(\|expect(" agentfw/packages/agentfw/src/daemon/translate/xml-tool-calls.test.ts` | Read the test file; enumerate each covered case (malformed, unterminated, multi-block, JSON-string args, coercion) and the assertion shape | Test-case inventory table (case → assertion), each with `agentfw/.../xml-tool-calls.test.ts:line` — informs OUR P1/P2 TDD RED set |
| Q5 | How does opencode unit-test its streaming `tool-stream` accumulator — how does it assert delta accumulation, completeness detection, and the empty-args→`{}` fallback? | tests | `.claude/knowledge-base/references/opencode/` | `grep -n "it(\|test(\|expect(\|appendOrStart\|finishAll\|finishWithInput" opencode/packages/llm/test/tool-stream.test.ts` | Read the test file; capture how streamed arg fragments are asserted and how completion is verified | Test-case inventory (accumulation / completion / empty-args), each with `opencode/packages/llm/test/tool-stream.test.ts:line` — informs OUR P3 streaming TDD |
| Q6 | Is the leaked-dialect recovery layer dependency-free (pure regex + state machine) or does it pull a JSON-repair library — and if so, which (partial-json / jsonrepair)? Compare openclaw vs cline's repair path. **(EC-2: arg-JSON repair lives OUTSIDE `tool-call-repair` — scope the grep to ALL packages so "dep-free package" is not mistaken for "no repair lib".)** | deps | `.claude/knowledge-base/references/openclaw/`, `.claude/knowledge-base/references/cline/` | Read `openclaw/packages/tool-call-repair/package.json` (deps field); then `grep -rn "jsonrepair\|partial-json\|repairJson\|parseStreamingJson\|partialParse" openclaw/packages cline/sdk` (ALL packages, not just tool-call-repair) | Read the package.json + each repair import site; capture whether repair is a dep or hand-rolled, and the fallback chain | Two-part verdict: "normalizer package dep-free" + "arg-JSON repair uses \<lib\> at \<path\>", each with `.../package.json` or `.../:line` — informs OUR P1 "don't reinvent" (`rules/parsimony-ladder.md`) |
| Q7 | Where does the normalization layer LIVE in the reference architecture — is it an isolated package/module inserted at the stream boundary (so downstream is dialect-blind), and what test runner + command exercises it? | tools | `.claude/knowledge-base/references/openclaw/`, `.claude/knowledge-base/references/opencode/` | Read `openclaw/packages/tool-call-repair/package.json` (isolated package? exports?); `grep -rn "tool-call-repair\|stream-normalizer\|normalizePlainTextToolCall" openclaw/packages` to find the insertion seam; check opencode test command in `opencode/packages/llm/test/tool-stream.test.ts` header + package | Read the package boundary + the seam where the provider stream is wrapped; capture the isolation pattern + test command | Seam description (where recovery is inserted) + isolation verdict + test command, each with `...:line` — informs WHERE our normalizer module lives + how we test it |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q4, Q5 | Covered |
| Dependencies | Q6 | Covered |
| Tools | Q7 | Covered |
| Techniques | Q1, Q2, Q3 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | Every `.claude/knowledge-base/references/{project}/{path}` declared in Qx's Fase A exists | Mark Qx BLOCKED "path not found", continue |
| Per-question Fase A budget | Fase A returned ≥1 hotspot OR 3 query-variant retries attempted | After 3 empty retries, mark Qx BLOCKED "Fase A exhausted"; continue |
| After answering Qx | Blueprint section under Qx has ≥1 `references/` citation | Re-iterate Qx (1 retry max) |
| Mid-loop sanity | ≥1 citation per ~200 words of blueprint prose | Add citations to under-cited paragraphs (1 retry max) |
| Per-project time budget | Budget (D1) not exhausted | On exhaustion, mark remaining Qx for that project BLOCKED "budget exhausted"; advance |
| Q3 read-full fallback (EC-4) | Before marking Q3 BLOCKED on empty Fase A, Read `loop-detection.ts` + `mistake-tracker.ts` (cline) + the doom-loop region of opencode `processor.ts` fully | A keyword miss on a small readable safety module must NOT BLOCK — read it |
| Q7 test-command source (EC-5) | Q7's test-command answer comes from `opencode/packages/llm/package.json` scripts + the repo runner config (bunfig/vitest.config), not the `.test.ts` header | If not in package.json, grep the repo root for the runner config |
| Before promising complete | All 4 coverage corners have populated blueprint sections | Refuse promise, continue |

## Acceptance Criteria

- [ ] All research questions answered OR explicitly marked BLOCKED with reason
- [ ] All four coverage corners have populated sections in the blueprint
- [ ] Every citation in the blueprint points to a real `.claude/knowledge-base/references/{...}` path
- [ ] At least one ADR section in the blueprint synthesizes decisions taken (the P1-P4 seam decision)
- [ ] Time budget respected per project
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/tool-calling-robustness-blueprint.md`

## Global Definition of Done

- [ ] All phases completed (plan → edge-cases → plan-confidence → execute → confidence → improve if needed → confidence re-score)
- [ ] Final `/discover-confidence` verdict recorded in the blueprint header
- [ ] No fabricated citations
- [ ] Coverage Matrix 100% covered
- [ ] ADRs reference at least one principle from project rules — `rules/architecture.md` (DIP boundary at the LLM transport), `rules/testing.md` (unit-testable in isolation), `rules/parsimony-ladder.md` (don't-reinvent for JSON-repair/coercion)
