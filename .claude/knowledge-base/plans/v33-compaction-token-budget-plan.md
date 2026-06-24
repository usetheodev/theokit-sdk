---
slug: v33-compaction-token-budget
milestone_id: V3-3
created_at: 2026-06-24
goal: Add a token-budget mode + configurable marker + template-driven summarizer + opt-in fail-safe to @theokit/sdk/compaction reaching behavioral parity with theocode, without breaking any existing keepRecent caller.
---

# Plan: V3-3 — Token-budget mode for `@theokit/sdk/compaction`

> **Version 1.1** — (v1.1 absorbs the 5 SHOULD-TEST items + the EC-3 empty-marker guard surfaced by the edge-case review.)
>
> **Version 1.0** — The SDK's public `compactTranscript` is turn-count only (`keepRecent`), with a fixed marker (`[[theokit:checkpoint]]`), a templateless summarizer, and a propagate-on-throw contract. theocode's `server/lib/compaction.ts` uses a token-budget split (`keepTokens` 8000), the persisted marker `<conversation-checkpoint>`, a 7-section `SUMMARY_TEMPLATE`, and a fail-safe (summarizer error → return original). This plan adds those four capabilities to the SDK as **additive, default-preserving options** so theocode can adopt `compactTranscript` and delete its local copy (anti-reinvention baseline 2→1), with ZERO behavior change for existing `keepRecent` callers or the persisted `[[theokit:checkpoint]]` default.

## Goal

> Enable `@theokit/sdk/compaction` consumers to compact a transcript by token budget with a configurable checkpoint marker, a template-driven summarizer, and an opt-in fail-safe — reaching behavioral parity with theocode's compaction — measured by `test_compactTranscript_token_budget_parity_*` (a parity suite mirroring theocode's corpus) passing AND every pre-existing `compaction.test.ts` test staying green.

## Context

V3-3 (gap V2-2B-2) of `docs/gap-audit/ROADMAP-v3.md`. The SDK promoted compaction to a public surface in M2 (`m2-compaction-public-api`, shipped 2026-06-20/21), but shipped only the turn-count (`keepRecent`) path — the M2 blueprint's own ADR D1 designed a token-budget mode (`maxTokens`) that was never implemented. theocode independently ships the token-budget algorithm the blueprint described (`splitTranscript` + `SUMMARY_TEMPLATE` + fail-safe). Adopting the SDK's current turn-count surface would change theocode's behavior AND break checkpoints already persisted in live sessions under the `<conversation-checkpoint>` marker. This plan closes the gap so theocode can adopt the SDK and delete `server/lib/compaction.ts`, removing `compaction` from theocode's anti-reinvention baseline (2→1).

The honest KISS caveat from the roadmap holds: if generalizing exceeds the value, the divergence stays documented as accepted debt. Here the value IS the generalization (parity enabling adoption + deletion), so the work is justified — but the design must be additive (no break) to be worth it.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/src/compaction.ts` | 128 | `a0f6140` (2026-06-21) | Public `@theokit/sdk/compaction` surface: `compactTranscript`, `buildCheckpoint`, `filterFromLatestCheckpoint`, `CHECKPOINT_MARKER`, `isContextOverflowError`, `estimateTokens`, `shouldCompact` | `keepRecent` default 6 unchanged; `CHECKPOINT_MARKER` value `[[theokit:checkpoint]] ` unchanged; leading-system-prompt preservation in keepRecent mode unchanged; never mutates input; `summarize`-throws-propagates default (docs.md:1903) unchanged unless caller opts in |
| `packages/sdk/tests/compaction.test.ts` | 196 | `a0f6140` (2026-06-21) | Behavior tests for the public surface (24 tests) | All 24 existing tests MUST stay green |
| `packages/sdk/tests/compaction-wiring.test.ts` | — | `a0f6140` (2026-06-21) | Wiring: subpath barrel exports resolve | Existing wiring assertions stay green; extend for new exports |
| `docs.md` | (large) | `96a507f` (2026-06-24) | Canonical public API contract; `#### Compaction` at line 1899 | Contract section updated in SAME PR (CLAUDE.md public-API rule); the documented propagate-on-throw default must remain accurate (opt-in fail-safe documented as opt-in) |
| `packages/sdk/CHANGELOG.md` | (n/a) | — | Per-package changelog | `[Unreleased]` entry added |
| `.changeset/v33-compaction-token-budget.md` (NEW) | 0 | — | (file to be created) — `@theokit/sdk` minor | — |

### Current callers / dependents

- **Symbol:** `compactTranscript` / `buildCheckpoint` / `filterFromLatestCheckpoint` / `CHECKPOINT_MARKER` in `packages/sdk/src/compaction.ts`
  - **Callers (production):** none inside `packages/sdk/src/` (verified `grep -rln` — `models.ts:9` is a comment reference only). It is a public-API surface.
  - **Callers (tests):** `packages/sdk/tests/compaction.test.ts`, `packages/sdk/tests/compaction-wiring.test.ts`.
  - **External (public API consumed by other repos):** yes — `@theokit/sdk/compaction` subpath (declared in `packages/sdk/package.json:51`). The V3-3 loop-closure consumer is theocode (`server/lib/compaction.ts`). Backward compatibility across the public contract is mandatory (docs.md:1899-1952).
- **Symbol:** `estimateTokens` (reused, not modified) — already exported from the subpath (`compaction.ts:114`).

### Domain glossary

- **transcript** — an ordered array of `CompressibleMessage` (`{ role, content }`) representing a conversation.
- **keep-recent window** — the trailing turns preserved verbatim by turn count (`keepRecent`, M2 mode).
- **token budget** — the trailing turns preserved verbatim by accumulated estimated tokens (`keepTokens`, theocode mode).
- **checkpoint marker** — a sentinel prefix marking a `system` turn as a summary checkpoint (`[[theokit:checkpoint]] ` in the SDK; `<conversation-checkpoint>` persisted in theocode sessions).
- **head / recent** — theocode's names for the older window (to summarize) and the verbatim tail.
- **fail-safe** — returning the ORIGINAL transcript unchanged when the summarizer throws (compaction is an optimization, never a cause of data loss).

### Architecture boundaries affected

- None crossed. `compaction.ts` is a leaf public module (no `internal/` dependency added beyond the existing `selectCompressionWindow` reuse). The summarizer remains a caller-injected callback (DIP — the SDK never hard-wires an LLM call). No new layering.

## Prior Art & Related Work

- **Internal blueprint:** `.claude/knowledge-base/discoveries/blueprints/m2-compaction-public-api-blueprint.md` — `ADR D1` already designed `compactTranscript(messages, {keepRecent=6, maxTokens?, summarize?})` with a token-budget drop-oldest path; `ADR D3` the marker sentinel + backward-scan filter; `ADR D5` zero-new-deps subpath. The blueprint studied adk-js `TokenBasedContextCompactor`, codex `<token_budget>` marker (`codex/.../token_budget.rs`), opencode `compaction`, crewAI `summarize_messages`. This plan implements the token-budget mode D1 designed but M2 did not ship.
- **Executable spec (reference implementation):** `theocode/server/lib/compaction.ts` — `splitTranscript` (token-budget walk from the end), `SUMMARY_TEMPLATE` (7 sections), `buildCheckpoint`, `filterFromLatestCheckpoint` (from-marker-inclusive), `isOverflowError`, fail-safe `try/catch`. Its corpus `theocode/tests/unit/compaction.test.ts` (9 tests) is the parity target.
- **Reference projects:** `.claude/knowledge-base/references/codex/codex-rs/rollout-trace/src/compaction.rs`, `.claude/knowledge-base/reference/opencode/packages/core/test/session-compaction.test.ts`, `.claude/knowledge-base/reference/adk-js/tests/e2e/context_compaction/` — independent token-budget compaction implementations confirming the chars/4 + summarize-head pattern (already synthesized in the M2 blueprint).

## Objective

- [ ] Sub-goal 1 — `compactTranscript` accepts `keepTokens` (token-budget mode); when set, the recent window is selected by accumulated `estimateTokens` (matching theocode `splitTranscript`), mutually exclusive with `keepRecent`; default behavior (keepRecent=6) unchanged when `keepTokens` is absent.
- [ ] Sub-goal 2 — `buildCheckpoint`, `filterFromLatestCheckpoint`, and `compactTranscript` accept a configurable `marker` (default `CHECKPOINT_MARKER`), so a caller can use `<conversation-checkpoint>`.
- [ ] Sub-goal 3 — `SUMMARY_TEMPLATE` (7 sections) is exported and passed to the `summarize` callback (optional 2nd arg); a caller can override via `summaryTemplate`.
- [ ] Sub-goal 4 — an opt-in `failSafe` option makes a thrown summarizer return the ORIGINAL transcript + a structured warn (default remains propagate, per docs.md).
- [ ] Sub-goal 5 — `filterFromLatestCheckpoint` accepts `include: 'after' | 'from'` (default `'after'` = M2 semantics; `'from'` = theocode inclusive).
- [ ] Sub-goal 6 — a parity test suite mirroring theocode's corpus passes; all 24 pre-existing tests stay green; `docs.md` + CHANGELOG + changeset updated; zero new deps.

## ADRs

### D1 — Token-budget mode via additive `keepTokens` option (mutually exclusive with `keepRecent`)
- **Decision:** Add `keepTokens?: number` to `CompactTranscriptOptions`. When present, select the recent window by accumulating `estimateTokens` from the end until `keepTokens` is exceeded (always keeping ≥1 recent turn) via a new private `selectByTokenBudget`; `keepRecent` is ignored. When absent, behavior is exactly today's (`keepRecent ?? 6`).
- **Rationale:** Additive option preserves every M2 caller and the documented default; mirrors theocode `splitTranscript` for parity; reuses the public `estimateTokens` (Rule 9, zero deps).
- **Alternatives considered:** (a) Replace `keepRecent` with `keepTokens` — REJECTED: breaks every M2 caller + docs.md:1903 contract. (b) Make `keepRecent` accept a token number polymorphically — REJECTED: type-ambiguous, violates KISS/least-surprise.
- **Consequences:** Two window-selection algorithms coexist (turn-count + token-budget); both pure and separately tested. Enables theocode adoption.

### D2 — Configurable `marker` (default `CHECKPOINT_MARKER`)
- **Decision:** `buildCheckpoint(label?, marker = CHECKPOINT_MARKER)`, `filterFromLatestCheckpoint(messages, { marker?, include? })`, and `compactTranscript(messages, { marker? })`. `isSystemPrompt` uses the configured marker so a custom-marker checkpoint is NOT misclassified as a leading system prompt. Default value unchanged (`[[theokit:checkpoint]] `).
- **Rationale:** theocode's persisted sessions use `<conversation-checkpoint>`; a configurable marker lets theocode adopt without rewriting persisted history. Default preserved → no M2 break.
- **Alternatives considered:** (a) Change the default marker to `<conversation-checkpoint>` — REJECTED: breaks every persisted M2 session + docs. (b) Export a `THEOCODE_CHECKPOINT_MARKER` const — REJECTED for now: couples the SDK to a consumer's marker name; the caller passes the string (revisit in edge-case-plan / Q2).
- **Guard (EC-3):** an empty `marker` (`""`) makes `startsWith("")` match every turn — in keepRecent mode that silently reclassifies every `system` prompt as a checkpoint and drops it. `buildCheckpoint` and `compactTranscript` throw `TheokitAgentError` ("marker must be non-empty") when given `marker === ""` — turning a silent-data-loss footgun into an explicit typed error.
- **Consequences:** `marker` threads through 3 functions + `isSystemPrompt`; one new optional param each; empty-marker is a typed error.

### D3 — Template-driven summarizer: export `SUMMARY_TEMPLATE`, pass it as the summarize callback's 2nd arg
- **Decision:** Export `SUMMARY_TEMPLATE` (the 7-section string from theocode). Change `summarize?: (older: CompressibleMessage[], template: string) => Promise<CompressibleMessage>` (2nd param added). Add `summaryTemplate?: string` option (default `SUMMARY_TEMPLATE`) passed to the callback.
- **Rationale:** Adding a 2nd parameter is backward-compatible (a callback declared with fewer params is assignable in TS/JS); existing M2 callbacks keep working. Exposing the template lets theocode reuse the exact 7-section shape for parity.
- **Alternatives considered:** Change `summarize` to return a `string` (theocode shape) and have the SDK wrap it — REJECTED: breaks M2 callbacks that return a `CompressibleMessage`.
- **Consequences:** The summary message shape stays SDK-native (`CompressibleMessage`); theocode wraps its string summarizer + `buildCheckpoint` in the callback (behavioral parity, not signature-identical — see Q1).

### D4 — Opt-in `failSafe` (default = current propagate-on-throw)
- **Decision:** Add `failSafe?: boolean` (default `false`). When `false`, a thrown `summarize` propagates (today's documented behavior, docs.md:1903). When `true`, catch the error, emit a structured `console.warn` (Unbreakable Rule 8 — never fail silently), and return the ORIGINAL `[...messages]`.
- **Rationale:** docs.md explicitly documents "the error propagates — the caller decides the fallback." Changing the default would break that contract and any M2 caller relying on propagation. theocode adopts with `failSafe: true`.
- **Alternatives considered:** Make fail-safe the default (matches theocode) — REJECTED: silently changes a documented public contract; a hard backward-incompat. KISS + honesty favor opt-in.
- **Consequences:** The warn line is the runtime observability for the fail-safe path (wiring pillar c).

### D5 — `filterFromLatestCheckpoint` gains `include: 'after' | 'from'` (default `'after'`)
- **Decision:** `'after'` (default) returns turns AFTER the latest marker (M2 semantics — `startsWith`, exclusive). `'from'` returns turns FROM the latest marker inclusive (theocode semantics). Marker detection uses `startsWith(marker)` for both (theocode's `buildCheckpoint` places the marker at content start, so `startsWith` finds it; avoids the broader `includes` false-positive surface).
- **Rationale:** theocode's history loader keeps the checkpoint itself (the summary stands in for the pruned head); M2 excludes it. Configurable, default preserves M2.
- **Alternatives considered:** Change default to `'from'` — REJECTED: breaks the documented "turns AFTER the most recent marker" + M2 callers.
- **Consequences:** One new optional param; both branches tested.

### D6 — Token-budget mode does NOT special-case leading system prompts (matches theocode); keepRecent mode preserves them (M2 unchanged)
- **Decision:** In `keepTokens` mode, the budget walk treats all turns uniformly (theocode `splitTranscript` has no system special-casing — verified `theocode/tests/unit/compaction.test.ts:22-30` asserts `head.length + recent.length === messages.length`). In `keepRecent` mode, the existing leading-system-prompt preservation is unchanged.
- **Rationale:** Behavioral parity with theocode's corpus requires matching its split exactly; M2 mode keeps its own contract.
- **Alternatives considered:** Preserve system prompts in both modes — REJECTED: diverges from theocode corpus → parity test fails; the whole point is adoptability.
- **Consequences:** Documented per-mode difference (Drawback 3). Edge-case-plan to confirm no realistic transcript loses a still-needed system prompt under budget mode (the summary captures it).

### D7 — Zero new dependencies; token-budget reuses public `estimateTokens` (chars/4)
- **Decision:** No new runtime dependency. `selectByTokenBudget` calls the already-exported `estimateTokens`.
- **Rationale:** M2 blueprint D5 + Unbreakable Rule 9 + KISS. theocode itself uses chars/4 (`token-estimate.js`).
- **Alternatives considered:** Add a real tokenizer dep (tiktoken) — REJECTED: heavy, blueprint already settled on chars/4 with optional caller override.
- **Consequences:** Estimate is approximate (UTF-16 length); acceptable for a pre-call gate, consistent with theocode.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Option surface grows by 5 optional fields (`keepTokens`, `marker`, `summaryTemplate`, `failSafe`, `include`) — ISP/over-config risk | Medium | All optional; every default reproduces M2 behavior exactly; documented per-mode in docs.md; covered by the "defaults unchanged" regression tests | SDK |
| Two window-selection algorithms coexist (turn-count + token-budget) — maintenance cost | Low | Both are small pure functions, separately unit-tested; roadmap KISS note accepts this because parity unlocks theocode deletion (net code reduction across the org) | SDK |
| Per-mode behavioral divergence (system-prompt handling, D6) could surprise a reader | Medium | docs.md states the two modes' semantics explicitly; ADR D6 records the rationale; parity test pins token-budget behavior | docs |
| `marker` mis-threading could misclassify a custom-marker checkpoint as a system prompt | Medium | `isSystemPrompt` takes the configured marker; dedicated test `test_compactTranscript_custom_marker_not_treated_as_system` | SDK |

## Unresolved Questions

- Q1 — theocode's summarizer returns a `string`; the SDK callback returns a `CompressibleMessage`. Adoption requires theocode to wrap its summarizer (`async (head, tmpl) => ({ role:'system', content: buildCheckpoint(await llm(head,tmpl), '<conversation-checkpoint>') })`). Is that adapter acceptable to the theocode team, or should the SDK also offer a string-returning convenience? (This plan ships the message-returning shape; the theocode-side adoption + the convenience question are tracked as a theocode follow-up, NOT this slice.)
- Q2 — Should `<conversation-checkpoint>` be an exported SDK constant (`THEOCODE_CHECKPOINT_MARKER`) for discoverability, or remain a caller-passed string? Leaning caller-passed (avoids coupling). `/edge-case-plan` to confirm.
- Q3 — In token-budget mode, if the single most-recent turn already exceeds `keepTokens`, theocode keeps just that one turn (head = everything else). Confirmed by `splitTranscript` "always keeps ≥1 recent". The SDK port must replicate exactly (covered by `test_selectByTokenBudget_keeps_at_least_one_recent`).

## Dependency Graph

```
Phase 1 (token-budget core) ──▶ Phase 4 (parity + docs + changeset)
Phase 2 (marker + filter)   ──▶ Phase 4
Phase 3 (template + failsafe)──▶ Phase 4

Phases 1, 2, 3 are independent (all edit compaction.ts but touch disjoint
functions/options) and MAY be implemented in any order; Phase 4 is the
integration blocker — it needs all three to assert full theocode parity.
```

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (none new) | — | npm | `estimateTokens` is already in-module; no external dep is added (ADR D7 / Rule 9). |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| (none) | — | — | Evaluated: `tiktoken`/`gpt-tokenizer` (real tokenizers) — REJECTED: heavy, the M2 blueprint already settled chars/4 with optional caller override; theocode itself uses chars/4. | No new dependency. |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

---

## Phase 1: Token-budget window selection

**Objective:** `compactTranscript` selects the recent window by token budget when `keepTokens` is set, matching theocode `splitTranscript`, with no special system-prompt handling in that mode.

### T1.1 — Add `selectByTokenBudget` + `keepTokens` mode to `compactTranscript`

#### Objective
Introduce a private `selectByTokenBudget(messages, keepTokens)` returning `{ head, recent }` (theocode `splitTranscript` semantics) and branch `compactTranscript` into token-budget mode when `keepTokens` is provided.

#### Why this step (action + reasoning)
1. **What this step does** — adds the token-budget split algorithm + the `keepTokens` option, branching the recent-window selection.
2. **Why it is necessary now** — it is the core of the V3-3 gap (blueprint D1's unimplemented `maxTokens`); Phases 2-3 layer marker/template/fail-safe on top, so the budget split must exist first. Cited by ADR D1, D6, D7.

#### Evidence
- `theocode/server/lib/compaction.ts:69-87` (`splitTranscript`: walk from end, accumulate `estimateTokens`, keep ≥1 recent).
- `theocode/tests/unit/compaction.test.ts:22-30` (`head.length + recent.length === messages.length`; recent is the tail; no system special-casing).
- `packages/sdk/src/compaction.ts:48-64` (current `compactTranscript` keepRecent path to branch).
- M2 blueprint `ADR D1` (the `maxTokens` design).

#### Files to edit
```
packages/sdk/src/compaction.ts — add selectByTokenBudget (private) + keepTokens branch in compactTranscript; extend CompactTranscriptOptions
packages/sdk/tests/compaction.test.ts — RED tests for token-budget split + mode
```

#### Deep file dependency analysis
- `compaction.ts` today (Baseline row 1): `compactTranscript` filters system prompts, calls `selectCompressionWindow` (turn-count). This task adds a sibling private `selectByTokenBudget` and a branch: `if (keepTokens != null)` → use token-budget split WITHOUT the system-prompt filter (D6); else current path. No downstream production caller (public API; tests only).

#### Deep Dives
- **`selectByTokenBudget(messages, keepTokens)`** → `{ head: CompressibleMessage[]; recent: CompressibleMessage[] }`. Walk `i` from `messages.length-1` down: `acc += estimateTokens(messages[i].content)`; when `acc > keepTokens && i < length-1` → `splitIndex = i+1; break`; else `splitIndex = i`. `head = slice(0, splitIndex)`, `recent = slice(splitIndex)`. Always ≥1 recent (the `i < length-1` guard). Pure; never mutates.
- **Invariant:** `head.length + recent.length === messages.length` (D6 parity). keepRecent mode unchanged.
- **Edge cases:** empty input → `{head:[], recent:[]}` → compact returns `[...messages]` (`[]`); single over-budget turn → head=others, recent=[last]; `keepTokens=0` → recent=[last], head=rest.

#### Pseudo-code / Signatures
```pseudocode
interface CompactTranscriptOptions {
  keepRecent?: number          // existing
  keepTokens?: number          // NEW (D1) — when set, token-budget mode
  summarize?: (older, template) => Promise<CompressibleMessage>  // template added in T3.1
  // marker?, summaryTemplate?, failSafe? added in later phases
}

function selectByTokenBudget(messages, keepTokens):
  acc = 0; splitIndex = messages.length
  for i from messages.length-1 down to 0:
    acc += estimateTokens(messages[i].content)
    if acc > keepTokens and i < messages.length-1: splitIndex = i+1; break
    splitIndex = i
  return { head: messages.slice(0,splitIndex), recent: messages.slice(splitIndex) }

# in compactTranscript, BEFORE the keepRecent path:
if options.keepTokens != null:
  const { head, recent } = selectByTokenBudget(messages, options.keepTokens)
  if head.length === 0: return [...messages]
  if summarize: return [await summarize(head, template), ...recent]
  return [...recent]

# Example
input:  4 msgs ~100 tok each, keepTokens=250
output: head=msgs[0..1], recent=msgs[2..3]  (head summarized or dropped)
```

#### Tasks
1. Extend `CompactTranscriptOptions` with `keepTokens?: number`.
2. Add private `selectByTokenBudget`.
3. Branch `compactTranscript` on `keepTokens` (no system-prompt filter in this branch — D6).
4. Keep the existing keepRecent path untouched.

#### TDD
```
RED:  test_compactTranscript_token_budget_keeps_recent_within_keepTokens() — (private selectByTokenBudget verified via output) recent is the tail, head dropped/summarized, head+recent==all
RED:  test_compactTranscript_token_budget_drops_head_when_no_summarize() — keepTokens set, no summarize → returns recent only
RED:  test_compactTranscript_token_budget_summarize_prepends() — keepTokens + summarize → [summary, ...recent]
RED:  test_compactTranscript_token_budget_noop_when_under_budget() — small transcript, large keepTokens → same refs returned
RED:  test_compactTranscript_keepTokens_wins_over_keepRecent() — both set → token-budget path taken, keepRecent ignored (EC-1)
RED:  test_compactTranscript_token_budget_zero_keepTokens_keeps_one_recent() — keepTokens:0 (and negative) → exactly 1 recent, head=rest, no throw (EC-2, Q3)
RED:  test_compactTranscript_token_budget_does_not_mutate_input() — input array + elements unchanged after budget compaction (EC-5)
GREEN: implement selectByTokenBudget + keepTokens branch
REFACTOR: None expected (sibling pure helper)
VERIFY: npx vitest run packages/sdk/tests/compaction.test.ts
```

#### Acceptance Criteria
- [ ] `keepTokens` mode matches theocode `splitTranscript` semantics (head+recent==all, ≥1 recent).
- [ ] keepRecent mode behavior unchanged (existing tests green).
- [ ] Pass: complexity — `compactTranscript` + `selectByTokenBudget` cyclomatic ≤ 10 (biome).
- [ ] Pass: coverage ≥ 90% on `compaction.ts` (critical path 100%).
- [ ] Pass: lint — `npx biome check packages/sdk/src/compaction.ts` zero warnings.
- [ ] Pass: size — `compaction.ts` ≤ 500 lines.

#### DoD
- [ ] New RED tests written first, fail, then pass.
- [ ] `npx vitest run packages/sdk/tests/compaction.test.ts` green (all 24 existing + new).
- [ ] `npx tsc --noEmit` zero errors.
- [ ] `npx biome check` zero warnings on changed files.
- [ ] File-size budget respected.

---

## Phase 2: Configurable marker + filter semantic

**Objective:** `marker` is configurable across `buildCheckpoint`/`filterFromLatestCheckpoint`/`compactTranscript` (+ `isSystemPrompt`), and `filterFromLatestCheckpoint` supports `include: 'after' | 'from'`.

### T2.1 — Configurable `marker` threaded through the checkpoint helpers

#### Objective
Add an optional `marker` param (default `CHECKPOINT_MARKER`) to `buildCheckpoint`, `filterFromLatestCheckpoint`, and `compactTranscript`; make `isSystemPrompt` use the configured marker.

#### Why this step (action + reasoning)
1. **What this step does** — parameterizes the marker so `<conversation-checkpoint>` works without changing the default.
2. **Why it is necessary now** — theocode's persisted sessions key on `<conversation-checkpoint>`; adoption is impossible without a configurable marker. Cited by ADR D2.

#### Evidence
- `theocode/server/lib/compaction.ts:23` (`CHECKPOINT_MARKER = '<conversation-checkpoint>'`).
- `packages/sdk/src/compaction.ts:25,28-30,67,75-82` (current fixed-marker uses + `isSystemPrompt`).

#### Files to edit
```
packages/sdk/src/compaction.ts — add marker param to buildCheckpoint/filterFromLatestCheckpoint/compactTranscript + isSystemPrompt(message, marker)
packages/sdk/tests/compaction.test.ts — RED tests for custom marker
```

#### Deep file dependency analysis
- `buildCheckpoint(label?, marker = CHECKPOINT_MARKER)`; `filterFromLatestCheckpoint(messages, opts?)` (opts.marker); `compactTranscript(messages, opts?)` (opts.marker → isSystemPrompt). Default value identical to today → M2 callers unaffected.

#### Deep Dives
- **Invariant:** with no `marker` passed, output is byte-identical to M2 (default `[[theokit:checkpoint]] `).
- **Edge case:** a checkpoint carrying a custom marker must NOT be treated as a leading system prompt (Drawback 4) — `isSystemPrompt(m, marker)` returns `m.role==='system' && !m.content.startsWith(marker)`.

#### Pseudo-code / Signatures
```pseudocode
function buildCheckpoint(label?, marker = CHECKPOINT_MARKER): CompressibleMessage
  return { role:'system', content: marker + (label ?? '') }
function isSystemPrompt(m, marker): boolean
  return m.role === 'system' && !m.content.startsWith(marker)
# compactTranscript reads opts.marker ?? CHECKPOINT_MARKER and passes it to isSystemPrompt (keepRecent mode)
```

#### Tasks
1. Add `marker` param to `buildCheckpoint`.
2. Add `marker` to `filterFromLatestCheckpoint` options.
3. Add `marker` to `CompactTranscriptOptions`; thread into `isSystemPrompt`.

#### TDD
```
RED:  test_buildCheckpoint_custom_marker() — content starts with the custom marker
RED:  test_filterFromLatestCheckpoint_custom_marker() — filters on the custom marker
RED:  test_compactTranscript_custom_marker_not_treated_as_system() — a <conversation-checkpoint> turn in the older window is summarized/dropped, not preserved as system
RED:  test_buildCheckpoint_default_marker_unchanged() — no marker arg → [[theokit:checkpoint]] (regression)
RED:  test_buildCheckpoint_rejects_empty_marker() — marker:"" throws TheokitAgentError (EC-3 guard)
GREEN: thread marker through + empty-marker guard
REFACTOR: None expected
VERIFY: npx vitest run packages/sdk/tests/compaction.test.ts
```

#### Acceptance Criteria
- [ ] Default marker behavior byte-identical to M2 (regression test green).
- [ ] Custom marker works across all three functions.
- [ ] Pass: complexity — `npx biome lint packages/sdk/src/compaction.ts` reports cyclomatic/cognitive complexity ≤ 10 on every changed function.
- [ ] Pass: coverage — `npx vitest run --coverage packages/sdk/tests/compaction.test.ts` reports ≥ 90% on `compaction.ts` (changed lines 100%).
- [ ] Pass: lint — `npx biome check packages/sdk/src/compaction.ts` exits 0 with zero warnings.
- [ ] Pass: size — `wc -l packages/sdk/src/compaction.ts` returns ≤ 500.

#### DoD
- [ ] RED tests written first and observed failing before implementation.
- [ ] `npx vitest run packages/sdk/tests/compaction.test.ts` exits 0 (all tests green).
- [ ] `npx tsc --noEmit` exits 0 (zero type errors).
- [ ] `npx biome check packages/sdk/src/compaction.ts` exits 0 (zero warnings).

### T2.2 — `filterFromLatestCheckpoint` `include: 'after' | 'from'`

#### Objective
Add `include` option: `'after'` (default, M2) vs `'from'` (theocode inclusive).

#### Why this step (action + reasoning)
1. **What this step does** — lets the filter return the checkpoint itself.
2. **Why it is necessary now** — theocode's history loader keeps the checkpoint (the summary replaces the pruned head). Cited by ADR D5.

#### Evidence
- `theocode/server/lib/compaction.ts:95-101` (`filterFromLatestCheckpoint` returns `slice(latest)` — inclusive).
- `theocode/tests/unit/compaction.test.ts:85-99` (history loading keeps the checkpoint + recent).
- `packages/sdk/src/compaction.ts:75-82` (M2 `slice(i+1)` — exclusive).

#### Files to edit
```
packages/sdk/src/compaction.ts — add include option to filterFromLatestCheckpoint
packages/sdk/tests/compaction.test.ts — RED tests for 'from' mode + default 'after'
```

#### Deep file dependency analysis
- `filterFromLatestCheckpoint(messages, { marker?, include? })`. `'after'` → `slice(i+1)` (today). `'from'` → `slice(i)`. Default `'after'` preserves M2.

#### Pseudo-code / Signatures
```pseudocode
function filterFromLatestCheckpoint(messages, { marker = CHECKPOINT_MARKER, include = 'after' } = {}):
  for i from end down to 0:
    if messages[i].content.startsWith(marker):
      return include === 'from' ? messages.slice(i) : messages.slice(i+1)
  return [...messages]
```

#### TDD
```
RED:  test_filterFromLatestCheckpoint_include_from_keeps_checkpoint() — 'from' returns [checkpoint, ...after]
RED:  test_filterFromLatestCheckpoint_default_after_unchanged() — no opts → turns AFTER (regression, existing behavior)
GREEN: add include branch
REFACTOR: None expected
VERIFY: npx vitest run packages/sdk/tests/compaction.test.ts
```

#### Acceptance Criteria
- [ ] `'from'` includes the checkpoint; `'after'` (default) unchanged.
- [ ] Existing `test_filterFromLatestCheckpoint_*` tests stay green.
- [ ] Pass: complexity — `npx biome lint packages/sdk/src/compaction.ts` reports cyclomatic/cognitive complexity ≤ 10 on every changed function.
- [ ] Pass: coverage — `npx vitest run --coverage packages/sdk/tests/compaction.test.ts` reports ≥ 90% on `compaction.ts` (changed lines 100%).
- [ ] Pass: lint — `npx biome check packages/sdk/src/compaction.ts` exits 0 with zero warnings.
- [ ] Pass: size — `wc -l packages/sdk/src/compaction.ts` returns ≤ 500.

#### DoD
- [ ] RED tests written first and observed failing before implementation.
- [ ] `npx vitest run packages/sdk/tests/compaction.test.ts` exits 0 (all tests green).
- [ ] `npx tsc --noEmit` exits 0 (zero type errors).
- [ ] `npx biome check packages/sdk/src/compaction.ts` exits 0 (zero warnings).

---

## Phase 3: Template-driven summarizer + fail-safe

**Objective:** Export `SUMMARY_TEMPLATE`, pass it to the summarizer, and add opt-in `failSafe`.

### T3.1 — `SUMMARY_TEMPLATE` + template passed to `summarize`

#### Objective
Export the 7-section `SUMMARY_TEMPLATE`; add `summaryTemplate?` option (default `SUMMARY_TEMPLATE`); pass it as the summarize callback's 2nd argument.

#### Why this step (action + reasoning)
1. **What this step does** — exposes + wires the template.
2. **Why it is necessary now** — parity requires the exact 7-section shape theocode uses. Cited by ADR D3.

#### Evidence
- `theocode/server/lib/compaction.ts:34-55` (`SUMMARY_TEMPLATE`, 7 sections), `:121,136` (summarize receives `(head, template)`).
- `theocode/tests/unit/compaction.test.ts:77-84` (`test_buildCheckpoint_and_template_have_all_seven_sections`).
- `packages/sdk/src/compaction.ts:37` (current `summarize` signature, 1 param).

#### Files to edit
```
packages/sdk/src/compaction.ts — export SUMMARY_TEMPLATE; summarize gains 2nd param template; add summaryTemplate option
packages/sdk/tests/compaction.test.ts — RED tests for template content + propagation
```

#### Deep file dependency analysis
- `summarize?: (older, template: string) => Promise<CompressibleMessage>` (2nd param added — TS-assignable from 1-param callbacks, so M2 callbacks unaffected). `compactTranscript` passes `options.summaryTemplate ?? SUMMARY_TEMPLATE`. Applies in BOTH keepRecent and keepTokens summarize branches.

#### Deep Dives
- **Invariant:** `SUMMARY_TEMPLATE` has exactly the 7 headers Goal/Constraints/Progress/Decisions/Next/Critical/Files.
- **Edge case:** an M2 callback ignoring the 2nd arg still compiles and runs (verified by keeping a 1-param callback test green).

#### TDD
```
RED:  test_summary_template_has_seven_sections() — all 7 headers present
RED:  test_compactTranscript_passes_template_to_summarize() — summarize receives the default template
RED:  test_compactTranscript_custom_summaryTemplate_passed() — override propagates
RED:  test_compactTranscript_one_param_summarize_still_works() — backward-compat (1-arg callback)
GREEN: export template + thread arg + option
REFACTOR: None expected
VERIFY: npx vitest run packages/sdk/tests/compaction.test.ts
```

#### Acceptance Criteria
- [ ] `SUMMARY_TEMPLATE` exported with 7 sections.
- [ ] Template passed to summarize in both modes; override works; 1-arg callbacks still work.
- [ ] Pass: complexity — `npx biome lint packages/sdk/src/compaction.ts` reports cyclomatic/cognitive complexity ≤ 10 on every changed function.
- [ ] Pass: coverage — `npx vitest run --coverage packages/sdk/tests/compaction.test.ts` reports ≥ 90% on `compaction.ts` (changed lines 100%).
- [ ] Pass: lint — `npx biome check packages/sdk/src/compaction.ts` exits 0 with zero warnings.
- [ ] Pass: size — `wc -l packages/sdk/src/compaction.ts` returns ≤ 500.

#### DoD
- [ ] RED tests written first and observed failing before implementation.
- [ ] `npx vitest run packages/sdk/tests/compaction.test.ts` exits 0 (all tests green).
- [ ] `npx tsc --noEmit` exits 0 (zero type errors).
- [ ] `npx biome check packages/sdk/src/compaction.ts` exits 0 (zero warnings).

### T3.2 — Opt-in `failSafe`

#### Objective
Add `failSafe?: boolean` (default `false`); when `true`, a thrown summarizer → structured warn + return original.

#### Why this step (action + reasoning)
1. **What this step does** — adds the fail-safe path as opt-in.
2. **Why it is necessary now** — theocode treats compaction as never-lossy; the SDK's documented default propagates, so fail-safe must be opt-in to avoid a silent contract change. Cited by ADR D4.

#### Evidence
- `theocode/server/lib/compaction.ts:135-149` (try/catch → warn → return original).
- `docs.md:1903` ("If `summarize` throws … the error propagates").
- `packages/sdk/src/compaction.ts:59-63` (current no-try/catch path).

#### Files to edit
```
packages/sdk/src/compaction.ts — add failSafe option; wrap summarize in try/catch when true
packages/sdk/tests/compaction.test.ts — RED tests for both default-propagate and failSafe paths
```

#### Deep file dependency analysis
- Both summarize branches (keepRecent + keepTokens) honor `failSafe`. Default `false` → today's propagation (regression-guarded). `true` → `console.warn("[compaction] summarizer failed — proceeding uncompacted: …")` + `return [...messages]`.

#### Pseudo-code / Signatures
```pseudocode
async function runSummarize(summarize, older, template, failSafe, original):
  try: return await summarize(older, template)
  catch (err):
    if not failSafe: throw err
    console.warn(`[compaction] summarizer failed — proceeding uncompacted: ${msg(err)}`)
    return null   // signal: return original
```

#### TDD
```
RED:  test_compactTranscript_failSafe_returns_original_on_throw() — failSafe:true + throwing summarize → original returned
RED:  test_compactTranscript_failSafe_warns_on_throw() — console.warn called with the breadcrumb (spy)
RED:  test_compactTranscript_default_propagates_on_throw() — failSafe omitted → error propagates (regression of docs contract)
RED:  test_compactTranscript_failSafe_handles_non_error_throw() — summarize rejects with a string/object + failSafe:true → warn uses String(err), original returned (EC-4)
GREEN: add failSafe wrap
REFACTOR: extract runSummarize helper if complexity needs it
VERIFY: npx vitest run packages/sdk/tests/compaction.test.ts
```

#### Acceptance Criteria
- [ ] Default propagates (docs contract preserved); `failSafe:true` returns original + warns.
- [ ] Warn line present (wiring pillar c — observability).
- [ ] Pass: complexity — `npx biome lint packages/sdk/src/compaction.ts` reports cyclomatic/cognitive complexity ≤ 10 on every changed function.
- [ ] Pass: coverage — `npx vitest run --coverage packages/sdk/tests/compaction.test.ts` reports ≥ 90% on `compaction.ts` (changed lines 100%).
- [ ] Pass: lint — `npx biome check packages/sdk/src/compaction.ts` exits 0 with zero warnings.
- [ ] Pass: size — `wc -l packages/sdk/src/compaction.ts` returns ≤ 500.

#### DoD
- [ ] RED tests written first and observed failing before implementation.
- [ ] `npx vitest run packages/sdk/tests/compaction.test.ts` exits 0 (all tests green).
- [ ] `npx tsc --noEmit` exits 0 (zero type errors).
- [ ] `npx biome check packages/sdk/src/compaction.ts` exits 0 (zero warnings).

---

## Phase 4: Parity suite + docs + wiring (integration blocker)

**Objective:** A parity suite mirroring theocode's corpus passes; docs.md + CHANGELOG + changeset updated; subpath barrel exports the new symbols.

### T4.1 — theocode-corpus parity suite

#### Objective
Add a parity test suite reproducing theocode's 9-test corpus against the SDK's token-budget mode + marker + template + fail-safe + filter('from').

#### Why this step (action + reasoning)
1. **What this step does** — pins behavioral parity (the Goal's metric).
2. **Why it is necessary now** — it is the executable proof theocode can adopt + delete its file. Cited by the Goal + roadmap "Concluído quando".

#### Evidence
- `theocode/tests/unit/compaction.test.ts:21-110` (the 9 tests: split keeps recent within budget, replaces head with checkpoint, noop under budget, falls back on summarizer error, template 7 sections, filters from latest checkpoint inclusive, returns all when no checkpoint).

#### Files to edit
```
packages/sdk/tests/compaction-parity.test.ts (NEW) — mirror theocode's 9 behaviors against the SDK API (keepTokens, marker '<conversation-checkpoint>', failSafe:true, include:'from')
```

#### Deep file dependency analysis
- New test file; no production change. Uses the public `@theokit/sdk/compaction` surface only.

#### TDD
```
RED:  test_compactTranscript_token_budget_parity_split_keeps_recent()
RED:  test_compactTranscript_token_budget_parity_replaces_head_with_checkpoint() — marker '<conversation-checkpoint>'
RED:  test_compactTranscript_token_budget_parity_noop_under_budget()
RED:  test_compactTranscript_token_budget_parity_failsafe_on_summarizer_error()
RED:  test_compactTranscript_token_budget_parity_template_seven_sections()
RED:  test_compactTranscript_token_budget_parity_filter_from_latest_inclusive()
RED:  test_compactTranscript_token_budget_parity_filter_all_when_no_checkpoint()
GREEN: (Phases 1-3 already implement; this suite verifies the composition)
REFACTOR: None
VERIFY: npx vitest run packages/sdk/tests/compaction-parity.test.ts
```

#### Acceptance Criteria
- [ ] `npx vitest run packages/sdk/tests/compaction-parity.test.ts` exits 0 (every parity test green; semantically mirrors theocode's corpus).
- [ ] `npx vitest run packages/sdk/tests/compaction.test.ts` exits 0 (all 24 pre-existing tests still green).

#### DoD
- [ ] `npx vitest run packages/sdk/tests/compaction-parity.test.ts packages/sdk/tests/compaction.test.ts` exits 0.
- [ ] `npx tsc --noEmit` exits 0 (zero type errors).
- [ ] `npx biome check packages/sdk/src/compaction.ts` exits 0 (zero warnings).

### T4.2 — docs.md + CHANGELOG + changeset + barrel verification

#### Objective
Update `docs.md` Compaction section for the new options; add `packages/sdk/CHANGELOG.md` `[Unreleased]` entry; add `.changeset/v33-compaction-token-budget.md` (`@theokit/sdk` minor); verify the subpath barrel exports `SUMMARY_TEMPLATE`.

#### Why this step (action + reasoning)
1. **What this step does** — public-surface documentation + release metadata + wiring (pillar a).
2. **Why it is necessary now** — CLAUDE.md mandates docs.md update in the same PR for public-API changes; changeset drives the npm minor. Cited by CLAUDE.md "Checklist before changing public API".

#### Evidence
- `docs.md:1899-1952` (current Compaction section to extend).
- `packages/sdk/package.json:51` (subpath export — barrel is `compaction.ts` itself; a new `export const SUMMARY_TEMPLATE` is automatically on the subpath).

#### Files to edit
```
docs.md — document keepTokens, marker, summaryTemplate, failSafe, include + SUMMARY_TEMPLATE; note per-mode system-prompt difference (D6) + opt-in fail-safe (D4)
packages/sdk/CHANGELOG.md — [Unreleased] Added entry
.changeset/v33-compaction-token-budget.md (NEW) — @theokit/sdk minor
packages/sdk/tests/compaction-wiring.test.ts — assert SUMMARY_TEMPLATE reachable from the subpath
```

#### Deep file dependency analysis
- docs.md is the source-of-truth contract (CLAUDE.md). The wiring test extends to assert the new public export resolves through `@theokit/sdk/compaction`.

#### TDD
```
RED:  test_summary_template_exported_from_subpath() — import { SUMMARY_TEMPLATE } from the compaction subpath resolves + has 7 sections (in compaction-wiring.test.ts)
GREEN: ensure export present (from T3.1)
REFACTOR: None
VERIFY: npx vitest run packages/sdk/tests/compaction-wiring.test.ts
```

#### Acceptance Criteria
- [ ] `grep -n "keepTokens" docs.md` resolves AND the Compaction section documents every new option + per-mode semantics (no stale claim).
- [ ] `grep -n "keepTokens\|token-budget" packages/sdk/CHANGELOG.md` resolves under `[Unreleased]` (consumer-facing entry present).
- [ ] `test -f .changeset/v33-compaction-token-budget.md` AND it declares `@theokit/sdk` minor.
- [ ] `npx vitest run packages/sdk/tests/compaction-wiring.test.ts` exits 0 (asserts `SUMMARY_TEMPLATE` reachable from the subpath).

#### DoD
- [ ] `npx vitest run packages/sdk/tests/compaction-wiring.test.ts` exits 0.
- [ ] docs.md + `packages/sdk/CHANGELOG.md` + `.changeset/v33-compaction-token-budget.md` all present and consistent (verified by the grep/test commands above).

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Token-budget mode (`keepTokens`) parity with theocode `splitTranscript` | T1.1 | `selectByTokenBudget` + branch |
| 2 | No special system-prompt handling in token-budget mode (D6) | T1.1 | budget branch skips system filter |
| 3 | Configurable marker (compat `<conversation-checkpoint>`) | T2.1 | `marker` param across 3 fns + `isSystemPrompt` |
| 4 | `filterFromLatestCheckpoint` inclusive (`from`) semantic | T2.2 | `include` option |
| 5 | Template-driven summarizer (7-section `SUMMARY_TEMPLATE`) | T3.1 | export + 2nd param + `summaryTemplate` |
| 6 | Opt-in fail-safe (return original + warn) | T3.2 | `failSafe` option + try/catch + warn |
| 7 | Backward compatibility (all M2 callers + persisted marker + propagate default) | T1.1,T2.1,T2.2,T3.1,T3.2 | every new field optional, default = M2; regression tests |
| 8 | Behavioral parity proof (theocode corpus) | T4.1 | parity suite |
| 9 | Public-API docs + release metadata + wiring | T4.2 | docs.md + CHANGELOG + changeset + wiring test |
| 10 | Zero new deps (Rule 9 / blueprint D5) | T1.1 | reuse `estimateTokens` |

**Coverage: 10/10 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed.
- [ ] All tests passing — `npx vitest run packages/sdk/tests/compaction.test.ts packages/sdk/tests/compaction-parity.test.ts packages/sdk/tests/compaction-wiring.test.ts` green (24 existing + new + parity + wiring).
- [ ] Zero type errors — `npx tsc --noEmit`.
- [ ] Zero lint warnings — `npx biome check packages/sdk/src/compaction.ts`.
- [ ] File-size budget respected (`compaction.ts` ≤ 500 lines).
- [ ] `CHANGELOG.md` updated under `[Unreleased]`.
- [ ] Backward compatibility preserved across the public API (every new option optional; defaults reproduce M2; persisted `[[theokit:checkpoint]]` + propagate-on-throw unchanged).
- [ ] `docs.md` Compaction section reflects the new surface (CLAUDE.md public-API rule).
- [ ] `.changeset/v33-compaction-token-budget.md` present (`@theokit/sdk` minor).
- [ ] Inviolable SDK gates green: `pnpm validate` exit 0 (biome cc ≤ 10, jscpd 0 clones, knip, publint, attw, bundle budget).
- [ ] **Runtime-metric proof** — the fail-safe `console.warn` is the observability line; a test spies it firing (T3.2).
- [ ] **Plan archived** — after `/review` READY_TO_MERGE AND PR merged, move this plan to `knowledge-base/plans/completed/`.

## Final Phase: Integration Validation (MANDATORY)

> Runs after Phases 1-4. The plan is NOT done until the chain passes.

### Execution
```
npx vitest run packages/sdk/tests/compaction.test.ts packages/sdk/tests/compaction-parity.test.ts packages/sdk/tests/compaction-wiring.test.ts
npx tsc --noEmit
npx biome check packages/sdk/src/compaction.ts
NODE_OPTIONS="--max-old-space-size=8192" pnpm validate    # full inviolable gate
```

### Acceptance Criteria
- [ ] All compaction suites green (existing + parity + wiring).
- [ ] Coverage ≥ 90% on `compaction.ts` (critical paths 100%).
- [ ] Zero type errors; zero lint warnings.
- [ ] `pnpm validate` exit 0 (jscpd 0 clones, publint, attw, knip, bundle budget).
- [ ] Fail-safe warn observed in the T3.2 spy test.

### If Validation Fails
1. Separate plan-caused failures from pre-existing.
2. Fix all plan-caused failures before completion.
3. Re-run the chain.
4. Log pre-existing issues in the PR description (do not block on them).
