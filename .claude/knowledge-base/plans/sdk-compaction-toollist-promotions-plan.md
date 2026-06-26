---
slug: sdk-compaction-toollist-promotions
created_at: 2026-06-26
goal: Add a maxOutput reserve to shouldCompact and a render-mode option to renderToolList so consumers stop reimplementing them.
---

# Plan: SDK compaction maxOutput + renderToolList mode (RADAR #90-A)

> **Version 1.0** — Two small, additive, backward-compatible promotions into the SDK so the reference app (TheoCode) can delete app-side reimplementations (radar thesis): (1) `shouldCompact`/`ShouldCompactInput` in `@theokit/sdk` gains an optional `maxOutput` output-reserve term so callers no longer keep a LOCAL `shouldCompact` to subtract output tokens; (2) `renderToolList` in `@theokit/sdk-tools` gains a `mode: 'full' | 'summary' | 'names'` option so callers stop shipping a parallel `renderToolList`/`renderToolNames` (markdown summary/names) that collides in name with the SDK's full-XML renderer. Both default to today's behavior — existing callers are byte-for-byte unaffected.

## Goal

> "Enable `@theokit/sdk` + `@theokit/sdk-tools` consumers to declare an output reserve for compaction and pick a tool-list render mode so that TheoCode drops its local `shouldCompact` and parallel `renderToolList`, measured by `pnpm test` passing the new cases in `packages/sdk/tests/compaction.test.ts` + `packages/sdk-tools/tests/tool-aci.test.ts`."

## Context

The TheoKit alignment audit (radar) found two app-side reimplementations that exist only because the SDK primitives were slightly under-powered:

1. `@theokit/sdk` `shouldCompact` (`packages/sdk/src/compaction.ts:289-291`) decides `estimated >= contextWindow - buffer`. TheoCode keeps a LOCAL `shouldCompact` (`server/lib/token-estimate.ts`) because it needs to ALSO reserve `maxOutput` tokens for the model's response — a term the SDK conflates into `buffer`. Its own comment flags this as "NOT behavior-preserving".
2. `@theokit/sdk-tools` `renderToolList` (`packages/sdk-tools/src/internal/tool-aci.ts:42-55`) renders a full-description `<tools>` XML block. TheoCode ships its own `renderToolList`/`renderToolNames` (`server/agents/tool-summaries.ts`) that render a markdown first-sentence-summary list and a names-only list — same NAME, different semantics (a collision + a reimplementation).

Adding an optional `maxOutput` term and a `mode` option closes both gaps in the framework. Both are additive.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/src/compaction.ts` | 291 | `f2203ed` (2026-06-24) | Tokenizer-free compaction helpers: `estimateTokens`, `shouldCompact`, `ShouldCompactInput`, `compactTranscript`, overflow guards | `shouldCompact(input)` with no `maxOutput` keeps the exact `estimated >= contextWindow - buffer` result; `estimateTokens`/`compactTranscript`/overflow guards untouched |
| `packages/sdk-tools/src/internal/tool-aci.ts` | 55 | `faf69ee` (2026-06-21) | ACI helpers `withDescription`, `renderToolList` (full `<tools>` XML) + `esc` | `renderToolList(tools)` with no options keeps the exact full-XML output; `withDescription` + `esc` (ampersand-first escape) untouched |
| `packages/sdk/tests/compaction.test.ts` | — | (exists) | Unit tests for compaction helpers | Existing `shouldCompact` cases stay green |
| `packages/sdk-tools/tests/tool-aci.test.ts` | — | (exists) | Unit tests for ACI helpers | Existing `renderToolList` cases (escaping, empty, override) stay green |
| `.changeset/sdk-compaction-toollist-promotions.md` (NEW) | 0 | — | (changeset for the two minor bumps) | — |

Every file listed in any task's `#### Files to edit` appears above.

### Current callers / dependents

- **Symbol:** `shouldCompact` / `ShouldCompactInput` in `packages/sdk/src/compaction.ts`
  - **Callers (production):** exported via `@theokit/sdk/compaction` subpath barrel (`packages/sdk/src/compaction.ts` is the barrel). External consumer: TheoCode (keeps a local copy today; will adopt after this ships).
  - **Callers (tests):** `packages/sdk/tests/compaction.test.ts`.
  - **External (public API):** yes — `@theokit/sdk/compaction`. New field is OPTIONAL → published type stays backward-compatible.
- **Symbol:** `renderToolList` in `packages/sdk-tools/src/internal/tool-aci.ts`
  - **Callers (production):** re-exported from the `@theokit/sdk-tools` main barrel (`packages/sdk-tools/src/index.ts`).
  - **Callers (tests):** `packages/sdk-tools/tests/tool-aci.test.ts`.
  - **External (public API):** yes — `@theokit/sdk-tools`. New `options` arg is OPTIONAL → backward-compatible.

### Domain glossary

- **`shouldCompact`** — pure pre-call gate: returns `true` when the estimated next-request token count leaves less than the reserved headroom in the model's context window.
- **`buffer`** — tokens reserved as safety headroom (today it conflates output + margin).
- **`maxOutput`** — (NEW) tokens explicitly reserved for the model's response generation, separate from `buffer`.
- **`renderToolList`** — renders the agent's actual `CustomTool[]` into a system-prompt orientation block (single source of truth, no drift).
- **render mode** — (NEW) `'full'` (today's `<tools>` XML, full descriptions), `'summary'` (markdown `- name: first-sentence`), `'names'` (markdown `- name`).

### Architecture boundaries affected

Per `rules/architecture.md` (§1 layered boundaries, §3 module cohesion): both functions are pure leaf utilities — no layer crossing introduced. `compaction.ts` stays a pure helper module (no I/O); `tool-aci.ts` stays a pure renderer. No new exports beyond the additive option types; existing barrels (`@theokit/sdk/compaction`, `@theokit/sdk-tools`) already export the symbols (no barrel surgery). KISS — additive optional params, no new modules (YAGNI: no separate `shouldCompactWithReserve` / `renderToolSummary`).

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (none new) | — | npm | Both changes extend pure in-repo functions; no new dependency. |

### New — to be introduced

(none — this plan adds zero dependencies.)

### Removed

(none)

## Prior Art & Related Work

- **In-repo:** `withDescription` (`tool-aci.ts:21-28`) is the precedent for an additive, immutable, never-throw ACI helper option — the `mode` option follows the same pure/no-throw discipline.
- **In-repo:** `estimateTokens` + `shouldCompact` (`compaction.ts:277-291`) are the precedent for pure, caller-supplies-the-window compaction helpers — `maxOutput` extends the same input record.
- **Consumer source (the reimplementation being collapsed):** TheoCode `server/lib/token-estimate.ts` (local `shouldCompact` with a `maxOutput` reserve) and `server/agents/tool-summaries.ts` (markdown summary/names renderers + a first-sentence `summarize` regex `/\.\s+(?=[A-Z(]|$)/`). These define the exact semantics the SDK must absorb.
- **External literature:** model providers document a `max_tokens`/output reservation separate from input budget (e.g. Anthropic Messages API `max_tokens`) — relevance: justifies `maxOutput` as a first-class, distinct term rather than folding it into `buffer`.

## Objective

- [ ] `ShouldCompactInput` gains an optional `maxOutput?: number`; `shouldCompact` subtracts it (`estimated >= contextWindow - buffer - (maxOutput ?? 0)`), defaulting to 0 → identical to today when omitted.
- [ ] `renderToolList` gains an optional second arg with `mode?: 'full' | 'summary' | 'names'`, defaulting to `'full'` → identical XML when omitted; `'summary'` renders `- name: <first sentence>`, `'names'` renders `- name`.
- [ ] First-sentence extraction matches the consumer semantics (abbreviation-safe).
- [ ] Backward compatibility: all existing `shouldCompact` + `renderToolList` tests pass unchanged.
- [ ] A changeset declares a `@theokit/sdk` minor + `@theokit/sdk-tools` minor.

## ADRs

### D1 — `maxOutput` is an OPTIONAL field on `ShouldCompactInput`, not a new function
- **Decision:** Add `maxOutput?: number` to `ShouldCompactInput`; `shouldCompact` uses `contextWindow - buffer - (maxOutput ?? 0)`.
- **Rationale:** KISS + DRY — one gate function, one input record; reuses the existing pure-function contract. Per `rules/architecture.md §3` (minimize public API) — extend the record, don't add a parallel `shouldCompactWithReserve`.
- **Alternatives considered:** (a) a separate `shouldCompactWithReserve(input)` — rejected: duplicates the gate, doubles the surface (DRY/YAGNI). (b) Tell consumers to fold `maxOutput` into `buffer` (status quo) — rejected: that is exactly the lossy conflation the consumer's own comment flags as "NOT behavior-preserving".
- **Consequences:** Enables TheoCode to delete its local `shouldCompact`; `buffer` now means pure safety margin, `maxOutput` the output reserve — clearer semantics. Default `?? 0` guarantees no behavior change for current callers.

### D2 — `renderToolList` gains a `mode` OPTION, not parallel functions
- **Decision:** Add an optional `options?: { mode?: 'full' | 'summary' | 'names' }` second arg to `renderToolList`; `'full'` is the default and is byte-for-byte today's output.
- **Rationale:** KISS — one renderer, one source of truth (the `CustomTool[]`); avoids the name collision the consumer hit by shipping its own `renderToolList`. Per `rules/architecture.md §3`. The `'summary'`/`'names'` modes absorb the consumer's two markdown renderers.
- **Alternatives considered:** (a) add separate `renderToolSummary` / `renderToolNames` exports — rejected: three exports for one concern; the consumer's collision came from exactly this proliferation (DRY). (b) Leave it full-only — rejected: forces consumers to keep a parallel renderer (the reimplementation the radar removes).
- **Consequences:** Enables TheoCode to delete `tool-summaries.ts`'s renderers; one renderer covers prompt-orientation (full), readable summary, and prohibition lists (names). Default preserves the XML output.

### D3 — First-sentence extraction is abbreviation-safe and lives in `tool-aci.ts`
- **Decision:** `'summary'` mode extracts the first sentence via the consumer-proven regex `/\.\s+(?=[A-Z(]|$)/` (period + whitespace + capital/paren/EOF), as a small private helper in `tool-aci.ts`.
- **Rationale:** DRY — reuse the exact semantics the consumer validated (handles `e.g.`/`i.e.`/`vs.`); KISS — a 3-line private helper, no new module (YAGNI). Cite `rules/testing.md` — behavior (first-sentence) is unit-tested, not the regex internals.
- **Alternatives considered:** (a) naive split on first `.` — rejected: breaks on abbreviations (`e.g.`). (b) a new sentence-segmentation dependency — rejected: Rule 9 over-kill for a one-line need (YAGNI).
- **Consequences:** `'summary'` output matches what TheoCode produces today; the helper is private (not a new public export).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `renderToolList` signature gains a 2nd param — a consumer passing it to a `.map(renderToolList)` would receive `(item, index)` as the options arg | Low | The options arg is an object read only for `.mode`; an array index (number) has no `.mode` → falls back to `'full'`. Add a regression test passing a non-object 2nd arg. | sdk-tools |
| `maxOutput` default `?? 0` could mask a caller that intended `buffer` to include output | Low | Default 0 preserves today's math exactly; documented in the field JSDoc + the changeset; opt-in only. | sdk |
| Two packages bumped in one changeset — version skew if only one is consumed | Low | Independent minors via changesets; consumers upgrade each on its own range. Documented in the changeset. | sdk |
| First-sentence regex mis-segments an exotic description | Low | Reuse the consumer-proven regex + unit test the abbreviation case; `'full'` mode (default) is unaffected. | sdk-tools |

## Unresolved Questions

- Q1 — Should `'summary'`/`'names'` modes XML-escape like `'full'`? Resolved at plan time: NO — markdown modes are not XML, so they emit raw text (matching the consumer); only `'full'` escapes. Documented in D2 + a test asserts markdown modes don't inject `&lt;`.
- Q2 — Should `shouldCompact` reject a negative `maxOutput`? Resolved at plan time: NO — it's a pure arithmetic term; a negative value simply widens the budget, consistent with how `buffer` is already untyped-for-sign. Not worth a guard (YAGNI); documented.

## Dependency Graph

```
Phase 1 (maxOutput — @theokit/sdk)        ──▶ Phase 3 (changeset + integration validation)
Phase 2 (renderToolList mode — sdk-tools) ──▶ Phase 3

Phase 1 and Phase 2 are INDEPENDENT (different packages, different files) and MAY run in parallel.
Phase 3 depends on both.
```

---

## Phase 1: `maxOutput` reserve on `shouldCompact` (@theokit/sdk)

### T1.1 — Add `maxOutput?` to `ShouldCompactInput` + subtract it in `shouldCompact`

#### Objective
Give `shouldCompact` an explicit output-reserve term, defaulting to today's behavior.

#### Why this step (action + reasoning)
1. **What this step does** — adds `readonly maxOutput?: number` to `ShouldCompactInput` and changes the formula to `estimated >= contextWindow - buffer - (maxOutput ?? 0)`.
2. **Why it is necessary now** — D1: it is the whole of Gap #90.2; without it the consumer must keep a local `shouldCompact`. Per Baseline, this is a pure function with one test file — a contained change.

#### Evidence
`packages/sdk/src/compaction.ts:261-268` (`ShouldCompactInput`), `:289-291` (`shouldCompact` formula `estimated >= contextWindow - buffer`).

#### Files to edit
```
packages/sdk/src/compaction.ts — add maxOutput? field + subtract in shouldCompact
packages/sdk/tests/compaction.test.ts — RED tests: maxOutput tightens the budget; omitted == today
```

#### Deep file dependency analysis
- `compaction.ts` (Baseline row 1) — only `ShouldCompactInput` + the one-line `shouldCompact` body change; `estimateTokens`, `compactTranscript`, overflow guards untouched. The `@theokit/sdk/compaction` barrel re-exports both symbols already (no export change).

#### Deep Dives
- Algorithm: `return input.estimated >= input.contextWindow - input.buffer - (input.maxOutput ?? 0)`.
- Invariants: omitted `maxOutput` ⇒ `?? 0` ⇒ identical to `estimated >= contextWindow - buffer` (Baseline invariant).
- Edge cases: `maxOutput: 0` == omitted; large `maxOutput` (≥ window) ⇒ always compact (consistent with `buffer ≥ window` today).

#### Pseudo-code / Signatures
```pseudocode
interface ShouldCompactInput { estimated; contextWindow; buffer; maxOutput?: number }
shouldCompact(i) => i.estimated >= i.contextWindow - i.buffer - (i.maxOutput ?? 0)

# Example
{estimated:100, contextWindow:200, buffer:50}              -> 100 >= 150 -> false
{estimated:100, contextWindow:200, buffer:50, maxOutput:60} -> 100 >= 90  -> true
```

#### Tasks
1. Add `readonly maxOutput?: number` to `ShouldCompactInput` with JSDoc.
2. Subtract `(input.maxOutput ?? 0)` in `shouldCompact`.

#### TDD
```
RED:     test_shouldCompact_maxOutput_tightens_budget() — maxOutput pushes a previously-false case to true
RED:     test_shouldCompact_omitted_maxOutput_matches_legacy() — same inputs sans maxOutput == legacy result
RED:     test_shouldCompact_maxOutput_zero_equals_omitted() — maxOutput:0 == omitted
GREEN:   add field + subtract term
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk test -- compaction
```

#### Concurrency tests (only when applicable)
(none — single-threaded)
Pure arithmetic function; no shared state, no async.

#### Acceptance Criteria
- [ ] `maxOutput` field present + subtracted — `grep -n "maxOutput" packages/sdk/src/compaction.ts` returns hits in both the interface and the formula
- [ ] Legacy behavior preserved — `pnpm --filter @theokit/sdk test -- compaction` exits 0 (incl. pre-existing cases)
- [ ] Pass: typecheck — `pnpm --filter @theokit/sdk typecheck` exits 0
- [ ] Pass: size — `wc -l packages/sdk/src/compaction.ts` ≤ 500

#### DoD
- [ ] `pnpm --filter @theokit/sdk test -- compaction` exits 0
- [ ] `pnpm typecheck` exits 0
- [ ] `npx biome check packages/sdk/src/compaction.ts` exits 0
- [ ] `wc -l packages/sdk/src/compaction.ts` reports ≤ 500

---

## Phase 2: `renderToolList` render mode (@theokit/sdk-tools)

### T2.1 — Add `options.mode` to `renderToolList` (full | summary | names)

#### Objective
Let one renderer produce the full XML (default), a first-sentence summary, or a names-only list.

#### Why this step (action + reasoning)
1. **What this step does** — adds an optional `options?: { mode?: 'full' | 'summary' | 'names' }` second arg; `'full'` keeps today's XML; `'summary'` emits `- name: <first sentence>`; `'names'` emits `- name`. Adds a private abbreviation-safe first-sentence helper.
2. **Why it is necessary now** — D2/D3: it is the whole of Gap #90.4; without it the consumer keeps a colliding parallel renderer. Per Baseline, pure function + one test file.

#### Evidence
`packages/sdk-tools/src/internal/tool-aci.ts:42-55` (`renderToolList` full-XML), `:30-35` (`esc`); consumer semantics in TheoCode `server/agents/tool-summaries.ts` (`summarize` regex `/\.\s+(?=[A-Z(]|$)/`, `- name: summary` + `- name`).

#### Files to edit
```
packages/sdk-tools/src/internal/tool-aci.ts — add options.mode + first-sentence helper
packages/sdk-tools/tests/tool-aci.test.ts — RED tests: summary/names modes; default==full; non-object 2nd arg
```

#### Deep file dependency analysis
- `tool-aci.ts` (Baseline row 2) — `renderToolList` gains an optional 2nd param; the `'full'` branch is the existing body verbatim. `withDescription` + `esc` untouched. The `@theokit/sdk-tools` main barrel already re-exports `renderToolList` (no export change).

#### Deep Dives
- Data structures: `type ToolListMode = 'full' | 'summary' | 'names'`; `renderToolList(tools, options?: { mode?: ToolListMode })`.
- Algorithm: `mode ?? 'full'`; `'full'` → existing XML; `'summary'` → `tools.map(t => \`- ${t.name}: ${firstSentence(t.description)}\`).join('\n')`; `'names'` → `tools.map(t => \`- ${t.name}\`).join('\n')`. `firstSentence(d)` uses `/\.\s+(?=[A-Z(]|$)/`.
- Invariants: `renderToolList(tools)` (no options) == today's XML byte-for-byte; empty array in `'full'` → `<tools></tools>` (unchanged); markdown modes do NOT XML-escape (Q1).
- Edge cases: empty array in `'summary'`/`'names'` → `''`; non-object 2nd arg (e.g. an array index from `.map`) → `.mode` undefined → `'full'`.

#### Pseudo-code / Signatures
```pseudocode
function renderToolList(tools, options?) {
  const mode = options?.mode ?? 'full'
  if (mode === 'full') { ...existing XML... }
  if (mode === 'summary') return tools.map(t => `- ${t.name}: ${firstSentence(t.description)}`).join('\n')
  return tools.map(t => `- ${t.name}`).join('\n')   // names
}
firstSentence(d) { const m = d.trim().match(/\.\s+(?=[A-Z(]|$)/); return m?.index==null ? d.trim() : d.trim().slice(0, m.index+1) }

# Example
renderToolList([{name:'read_file',description:'Read a file. More detail.'}], {mode:'summary'})
  -> "- read_file: Read a file."
renderToolList([...], {mode:'names'}) -> "- read_file"
renderToolList([...])                 -> "<tools>...</tools>"  (unchanged)
```

#### Tasks
1. Add `ToolListMode` type + optional `options` param; branch on `mode ?? 'full'`.
2. Keep the `'full'` branch identical; add `'summary'`/`'names'` branches.
3. Add the private `firstSentence` helper.

#### TDD
```
RED:     test_renderToolList_summary_mode_first_sentence() — '- name: <first sentence>' (abbrev-safe: "e.g." not split)
RED:     test_renderToolList_names_mode() — '- name' lines only, no descriptions
RED:     test_renderToolList_default_is_full_xml_unchanged() — no options == existing <tools> XML
RED:     test_renderToolList_non_object_second_arg_falls_back_to_full() — passing a number (map index) → full XML
RED:     test_renderToolList_summary_does_not_xml_escape() — markdown modes emit raw text (no &lt;)
GREEN:   implement the mode branches + firstSentence
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk-tools test -- tool-aci
```

#### Concurrency tests (only when applicable)
(none — single-threaded)
Pure renderer; no shared state, no async.

#### Acceptance Criteria
- [ ] summary + names modes produce the documented markdown — `pnpm --filter @theokit/sdk-tools test -- tool-aci` exits 0
- [ ] default (no options) == existing XML + pre-existing escaping/empty/override cases green — `pnpm --filter @theokit/sdk-tools test -- tool-aci` exits 0
- [ ] non-object 2nd arg falls back to full (no crash) — `pnpm --filter @theokit/sdk-tools test -- tool-aci` exits 0
- [ ] Pass: typecheck — `pnpm --filter @theokit/sdk-tools typecheck` exits 0
- [ ] Pass: size — `wc -l packages/sdk-tools/src/internal/tool-aci.ts` ≤ 500

#### DoD
- [ ] `pnpm --filter @theokit/sdk-tools test -- tool-aci` exits 0
- [ ] `pnpm typecheck` exits 0
- [ ] `npx biome check packages/sdk-tools/src/internal/tool-aci.ts` exits 0
- [ ] `wc -l packages/sdk-tools/src/internal/tool-aci.ts` reports ≤ 500

---

## Phase 3: Changeset + Integration Validation

### T3.1 — Changeset for the two minor bumps

#### Objective
Declare `@theokit/sdk` minor + `@theokit/sdk-tools` minor via changesets.

#### Why this step (action + reasoning)
1. **What this step does** — writes `.changeset/sdk-compaction-toollist-promotions.md` declaring both minors with a consumer-facing summary.
2. **Why it is necessary now** — theokit-sdk publishes via changesets; the changeset is the release contract. (Do NOT run `changeset version` in the feature commit — separate release step.)

#### Evidence
theokit-sdk `.changeset/` + `CLAUDE.md` Locked toolchain (Changesets `^2.31.0`); `@theokit/sdk` 2.9.0, `@theokit/sdk-tools` 0.6.0.

#### Files to edit
```
.changeset/sdk-compaction-toollist-promotions.md (NEW) — minor bumps for both packages
```

#### Deep file dependency analysis
- New changeset file only; no code dependency.

#### Deep Dives
- Format: frontmatter `"@theokit/sdk": minor` + `"@theokit/sdk-tools": minor` + a one-line summary.

#### Tasks
1. Write the changeset file with both minors + summary.

#### TDD
```
RED:     n/a (changeset is metadata, not executable code)
GREEN:   create .changeset/sdk-compaction-toollist-promotions.md
REFACTOR: None expected
VERIFY:  test -f .changeset/sdk-compaction-toollist-promotions.md && grep -q "@theokit/sdk" .changeset/sdk-compaction-toollist-promotions.md
```

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Acceptance Criteria
- [ ] Changeset exists with both minors — `grep -c "minor" .changeset/sdk-compaction-toollist-promotions.md` returns ≥ 2
- [ ] Feature commit does NOT consume the changeset — `git diff --name-only` does NOT include `packages/*/package.json` version bumps

#### DoD
- [ ] Changeset file present and well-formed
- [ ] No `changeset version` run in the feature commit

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `shouldCompact` lacks a `maxOutput` output reserve (#90.2) | T1.1 | Add `maxOutput?` field + subtract in the formula |
| 2 | `renderToolList` has no summary/names mode (#90.4) | T2.1 | Add `options.mode` (full default + summary + names) |
| 3 | Backward compatibility for existing callers/tests | T1.1, T2.1 (optional params + defaults) + Final Phase | Defaults preserve today's behavior; full suite regression |
| 4 | Release declared without consuming the changeset | T3.1 | Changeset file with both minor bumps |
| 5 | No regression across the two SDK packages | T1.1, T2.1 + Final Phase | `pnpm test` + `pnpm typecheck` + Biome lint green |

**Coverage: 5/5 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm test` green (turbo across packages)
- [ ] Zero type errors — `pnpm typecheck`
- [ ] Biome lint clean — `pnpm lint` (or `npx biome check`) on changed files
- [ ] File-size budget respected (per `rules/architecture.md §3` — minimal public API)
- [ ] CHANGELOG handled via changeset (theokit-sdk uses changesets; per-package CHANGELOGs are generated on version)
- [ ] Backward compatibility preserved — existing `shouldCompact`/`renderToolList` callers + tests unchanged and green
- [ ] Plan-specific criteria: both new params OPTIONAL; default behavior byte-for-byte identical
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND the PR is merged, move to `knowledge-base/plans/completed/`.

## Failure scenarios (when I/O external)

(none — no external I/O touched)
Both functions are pure (arithmetic + string rendering); no HTTP/DB/queue/socket. The `real-llm-validation.md` rule does not apply — neither function reaches an LLM call.

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Validate the two additive changes against the full existing test suites of both packages.

### Execution
```
pnpm test          # turbo run test across packages (vitest)
pnpm typecheck     # tsc --noEmit across packages
npx biome check packages/sdk/src/compaction.ts packages/sdk-tools/src/internal/tool-aci.ts
```

### Acceptance Criteria
- [ ] All test suites green (incl. pre-existing compaction + tool-aci cases) — `pnpm test` exits 0
- [ ] Coverage ≥ 90% on the two changed functions (the new branches: 100%) — `pnpm --filter @theokit/sdk test -- --coverage` reports ≥ 90
- [ ] Zero type errors — `pnpm typecheck` exits 0
- [ ] Biome lint clean — `npx biome check packages/sdk/src/compaction.ts packages/sdk-tools/src/internal/tool-aci.ts` exits 0
- [ ] Runtime-metric proof — n/a; `grep -rn "metric\|counter" packages/sdk/src/compaction.ts packages/sdk-tools/src/internal/tool-aci.ts` returns nothing (no counters declared)
- [ ] Failure scenarios green — n/a; the plan declares `(none — no external I/O touched)`

### If Validation Fails
1. Distinguish plan-caused failures from pre-existing.
2. Fix all plan-caused failures before completion.
3. Re-run the chain.
4. Pre-existing issues logged in the PR description; do not block.
