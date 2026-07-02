# Discovery Plan: Request-Scoped Tool-Name Matching for Leaked-Dialect Recovery

> **Version 1.1** (2026-07-01 — absorbed 1 MUST-FIX + 2 SHOULD-TEST from `request-scoped-matching-edge-cases-2026-07-01.md`: Q5 gains a caller-search for the request→Set derivation; Q1 must read BOTH gate sites; Q4 must not over-claim opencode covers allowlist gating) — Investigate how openclaw's `@openclaw/tool-call-repair` gates leaked-dialect tool-call recovery on the **current request's tool-name set** (its non-streaming `payload.ts` allowlist path and its streaming `PlainTextToolCallNameMatcher`), and how it tests the false-positive case, so we can replace the blunt per-route `extractToolCallsFromContent` flag in `packages/sdk/src/internal/llm/hermes-tool-extract.ts` + `openai.ts` with a request-scoped allowlist that only recovers a `<function=NAME>` block when `NAME` is a real tool in the request. In scope: openclaw (primary) + opencode (test-structure secondary). Output: a blueprint that locks the recovery-gating design for R5.

**Slug:** `request-scoped-matching`
**Owner:** paulo
**Created:** 2026-07-01
**Time budget:** 2.5h (per-project breakdown in ADR D1)

## Context

R5 is recommendation #5 / ADR D5 of the shipped `tool-calling-robustness-blueprint.md` (`.claude/knowledge-base/discoveries/blueprints/tool-calling-robustness-blueprint.md:122,148`): *"Add request-scoped tool-name matching to the internal recovery (openclaw `matcher.*`) to replace the blunt default-off flag."* Today the SDK recovers leaked Hermes `<function=NAME>` blocks in `OpenAIStreamAccumulator.finish()` (`packages/sdk/src/internal/llm/openai.ts:301-317`) gated ONLY by `this.extractFromContent` (the per-route `ProviderProfile.extractToolCallsFromContent` boolean, `openai.ts:301`) plus `toolCalls.length === 0`. `extractHermesToolCalls(content, makeId)` (`packages/sdk/src/internal/llm/hermes-tool-extract.ts:56`) recovers ANY `<function=NAME>` regardless of whether `NAME` is a real tool — so a code assistant printing a literal `<function=foo>` in a fenced code block on a leaky route would be wrongly promoted. The blueprint (`:82`) names request-scoped matching as *"the load-bearing safety technique"*. The request's tools ARE available at the recovery construction site (`openai.ts:172` builds the accumulator inside `stream(request)`, and `request.tools` is read at `openai.ts:370`), so the tool-name set can be threaded in. This discovery locks HOW openclaw does it before we plan the change. Respects `rules/architecture.md` DIP (the recovery is infra; the tool-set is request data) and `rules/parsimony-ladder.md` (reuse a proven technique, don't reinvent — Unbreakable Rule 9).

## Objective

Decide the exact shape of the request-scoped allowlist gate for our non-streaming `finish()` recovery (data structure, exact-vs-prefix, optional-allowlist semantics, name normalization, where the set is injected), grounded in openclaw's implementation + tests.

- [ ] All research questions in this plan answered with citations to `.claude/knowledge-base/references/`
- [ ] Cross-cutting comparison table populated for every in-scope reference project
- [ ] Recommendations section provides at least one concrete decision proposal per in-scope research question
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/openclaw/` | `packages/tool-call-repair/src/{payload,promote,stream-normalizer}.ts`, `src/plugin-sdk/tool-payload.test.ts`, `src/plugin-sdk/provider-stream*.test.ts` | The ONLY reference with request-scoped tool-name gating; `payload.ts` allowlist is the direct analog for our non-streaming `finish()` recovery |
| `.claude/knowledge-base/references/opencode/` | `packages/llm/test/tool-stream.test.ts`, `packages/llm/package.json` | Test-structure reference for a leaked-tool-stream layer (mirror the harness shape in vitest) |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/openclaw/packages/tool-call-repair/src/grammar.ts` | Dialect grammar (already covered in the umbrella blueprint T1; R5 is name-gating, not grammar) |
| `.claude/knowledge-base/references/agentfw/` | Its technique is value-coercion (T2), already shipped in the sanitization cycle — not request-scoping |
| `.claude/knowledge-base/references/cline/`, opencode loop-guard | Loop/no-progress guard = R6, already shipped (`@theokit/sdk@2.15.0`) |
| openclaw stream-boundary state machine (`stream-normalizer.ts` buffer FSM `getPlainTextToolCallBufferState`) | The full streaming FSM = R7/T1, a LATER phase; R5 borrows only the NAME-matcher part |
| Any project NOT cloned into `.claude/knowledge-base/references/` | Cross-Project Rule: never claim a project feature without reading its source |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** openclaw: 2h, opencode: 0.5h.

**Rationale:** openclaw is the sole source of the request-scoped technique (payload allowlist + stream matcher + its tests) so it gets the deep dive; opencode contributes only the test-harness shape (0.5h) for the tests corner. Evidence: the cross-cutting table in `tool-calling-robustness-blueprint.md:112` shows openclaw is the ONLY project with a "request-scoped guard".

**Alternatives considered:** equal split (rejected — opencode has no name-gating, only test structure); openclaw-only (rejected — we want a second test-shape reference for the vitest harness).

**Stop condition — per question (mandatory):** When a question's Fase A returns empty matches after 3 consecutive retries with different query variants (pattern → grep symbol → alternate path → broader scope), mark the question BLOCKED with reason "Fase A exhausted — no hotspots found" and continue. Do NOT pad with unrelated hotspots.

**Stop condition — per project (mandatory):** When a project's time budget is exhausted with N questions pending, mark all remaining questions for that project BLOCKED with reason "budget exhausted" and continue. If every remaining project is `done`-or-`blocked`, emit `<promise>BLUEPRINT_BLOCKED</promise>` (NOT `BLUEPRINT_COMPLETE`) with the honest report.

**Anti-pattern:** NEVER fabricate Fase B answers to close a question whose Fase A was exhausted (Unbreakable Rule 3).

**Consequences:** the halt-loop stops on budget exhaustion; blocked questions surface in `## Blocked questions (if any)`.

### D2 — Investigation depth

**Decision:** Read `payload.ts`, `promote.ts`, and `tool-payload.test.ts` end-to-end (small, load-bearing files); Grep-then-Read for `stream-normalizer.ts` (large — only the matcher interface + its call sites, NOT the buffer FSM); Read `opencode/.../tool-stream.test.ts` fully.

**Rationale:** `payload.ts` is the direct analog and small enough to read whole; `stream-normalizer.ts` is large and mostly the out-of-scope FSM, so surgical grep-then-read avoids scope creep (`rules/parsimony-ladder` — read only what the decision needs).

**Consequences:** the blueprint's streaming-matcher answer (Q2) cites the interface + call sites, not the whole FSM.

## Research Questions

Each declares Fase A (broad map) + Fase B (deep Read). Most questions here are on small files where Fase A is a targeted grep.

| # | Question | Corner | Reference project(s) | Fase A (broad — map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How does openclaw's NON-streaming `payload.ts` gate leaked-block promotion on the request's tool set — what is the `allowedToolNames` option's type, its optional/absent semantics, and the exact membership check? | techniques | `.claude/knowledge-base/references/openclaw/` | `grep -n "allowedToolNames" packages/tool-call-repair/src/payload.ts` (hotspots at `:29,187-190,331-334`) | Read `payload.ts:28-45` (the `PlainTextToolCallParseOptions` type) + BOTH gate sites `:180-205` and `:325-340` — explain WHY there are two functions with the same gate (EC-2: two parse entrypoints/grammars, not one) | Prose + the exact option type signature + the `new Set(...) && !has(name) → null` gate, with `payload.ts:line` per claim, covering both gate sites |
| Q2 | For an ALREADY-COMPLETE leaked block (our non-streaming `finish()` case), is prefix matching (`hasNamePrefix`) needed, or is exact-name (`hasExactName`) sufficient — and which does each openclaw path (payload vs stream) use? | techniques | `.claude/knowledge-base/references/openclaw/` | `grep -n "hasExactName\|hasNamePrefix\|PlainTextToolCallNameMatcher" packages/tool-call-repair/src/stream-normalizer.ts` (interface `:16,18`; call sites `:93,102,116,125`) | Read `stream-normalizer.ts:14-33` (matcher interface) + `:88-130` (where prefix gates a still-streaming partial name vs exact gates a completed name); contrast with `payload.ts` (exact-only) | Table: path → matcher method used → why (streaming-partial vs complete), citations; conclusion on what OUR finish() needs |
| Q3 | How does openclaw TEST the false-positive gate — a leaked block whose name is NOT in `allowedToolNames` is NOT promoted (returns null)? | tests | `.claude/knowledge-base/references/openclaw/` | `grep -n "allowedToolNames\|toBeNull" src/plugin-sdk/tool-payload.test.ts` (hotspots `:142,179,192-194,225,239-242,248-251`) | Read each `allowedToolNames` test block: the input leaked text, the allowlist, and the `.toBeNull()` / promoted assertion | Table: test case → allowlist → input name → expected (null vs promoted), citations — the exact shape to mirror in vitest |
| Q4 | What is opencode's test-harness shape for its leaked/tool stream layer (how it feeds a synthetic stream and asserts recovered calls) that we should mirror in vitest? | tests | `.claude/knowledge-base/references/opencode/` | SKIP Fase A — single known file. `grep -n "test(\|expect(\|describe(\|allowlist\|toolNames" packages/llm/test/tool-stream.test.ts` | Read `packages/llm/test/tool-stream.test.ts` fully + `packages/llm/package.json` test script | Harness description (input construction + assertion style, `bun:test`) + citations; a vitest mapping note. EC-3: state explicitly whether it covers allowlist/name-gating or ONLY generic parsing — if the latter, opencode contributes harness SHAPE only; the false-positive gate test comes from openclaw Q3 |
| Q5 | Where does the tool-name set COME FROM and how is it injected into the repair entrypoint (the options seam) — how is `allowedToolNames` derived from a request and threaded, and does the stream-normalizer take a `matcher` the same way? | tools | `.claude/knowledge-base/references/openclaw/` | `grep -n "allowedToolNames\|matcher" packages/tool-call-repair/src/{promote,stream-normalizer}.ts index.ts` AND (EC-1 caller-search) `grep -rn "allowedToolNames" src/plugin-sdk/` to find WHO builds the allowlist from a request | Read `promote.ts:20-40` (`allowedToolNames.has(rawName) ? rawName : null`) + `stream-normalizer.ts:26-33` (the `PlainTextToolCallStreamNormalizerOptions` seam injecting `matcher`) + `index.ts` exports + the caller found by the plugin-sdk grep (the request→Set derivation) | The injection seam (options object) + the request→Set derivation ORIGIN (not just the parameter), citations; mapping to our `stream(request)` → accumulator seam at `openai.ts:172` |
| Q6 | What data structure backs the name set (plain `Set<string>` vs trie/normalized), is there any runtime dependency, and is tool-name matching case-sensitive / normalized? | deps | `.claude/knowledge-base/references/openclaw/` | `grep -n "new Set\|toLowerCase\|normalize\|trim\|import " packages/tool-call-repair/src/{payload,promote}.ts` + Read `packages/tool-call-repair/package.json` deps | Read the `new Set(...)` construction (`payload.ts:188,332`) + the `.has()` sites + any name normalization; Read `package.json` dependencies | "Plain `Set<string>`, zero runtime deps, case-sensitive (or normalized at X)" with citations — informs our "no new dep" + normalization decision |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q3, Q4 | Covered |
| Dependencies | Q6 | Covered |
| Tools | Q5 | Covered |
| Techniques | Q1, Q2 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | Every `.claude/knowledge-base/references/{project}/{path}` declared in Fase A exists | Mark Qx BLOCKED with reason "path not found", continue |
| Per-question Fase A budget | Fase A returned ≥ 1 hotspot OR 3 query-variant retries attempted | After 3 retries empty, mark Qx BLOCKED "Fase A exhausted"; continue |
| After answering Qx | Blueprint section under Qx has ≥ 1 citation | Re-iterate Qx (1 retry max) |
| Mid-loop sanity | Total citations to `.claude/knowledge-base/references/` ≥ 1 per 200 words of prose | Add citations to under-cited paragraphs (1 retry max) |
| Per-project time budget | Project time budget not exhausted | When exhausted, mark remaining Qx for that project BLOCKED "budget exhausted"; advance |
| Before promising complete | All 4 coverage corners have populated sections | Refuse promise, continue |

## Acceptance Criteria

- [ ] All research questions answered OR explicitly marked BLOCKED with reason
- [ ] All four coverage corners have populated sections in the blueprint
- [ ] Every citation in the blueprint points to a real `.claude/knowledge-base/references/{...}` path
- [ ] At least one ADR section in the blueprint synthesizes the recovery-gating decision (exact-vs-prefix, optional-allowlist, data structure, injection seam)
- [ ] Time budget respected per project
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/request-scoped-matching-blueprint.md`

## Global Definition of Done

- [ ] All phases completed (plan → edge-cases → execute → confidence → improve if needed → confidence re-score)
- [ ] Final `/discover-confidence` verdict recorded in the blueprint header
- [ ] No fabricated citations
- [ ] Coverage Matrix 100% covered
- [ ] ADRs reference at least one principle from project rules (`architecture.md` DIP, `parsimony-ladder.md` / Rule 9, `testing.md`)
