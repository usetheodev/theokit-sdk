---
slug: m5-model-option
milestone_id: M5
created_at: 2026-06-21
goal: Expose parseModelId publicly and add humanizeModelName + toModelOption on @theokit/sdk/models so UIs render model slugs without hand-rolling, measured by tests/model-option.test.ts + tests/models-wiring.test.ts passing green.
---

# Plan: M5-8 — public `parseModelId` + `humanizeModelName` + `toModelOption`

> **Version 1.1** (edge-case-plan absorbed: EC-1 multiple-colon variant + EC-2 acronym/numeric tokens folded into T1.1 TDD; EC-3 best-effort-not-canonical documented) — Close roadmap gap M5-8: the SDK already parses model ids (`parseModelId` in `internal/llm/model-identifier.ts`, returning `{ provider, name }`) but it is `@internal`, and there is no helper to turn a model slug into a human label or a UI option — so the `@theokit/ui` model selectors + the `create-theokit` template hand-roll slug humanization. M5-8 (1) re-exports `parseModelId` (+ `ParsedModelId`) on the existing `@theokit/sdk/models` subpath, and (2) adds `humanizeModelName(modelId): string` (best-effort human label — strips routing prefix + vendor, prettifies the core name, appends an OpenRouter `:variant` in parens) + `toModelOption(modelId): ModelOption` (`{ value, label, provider }`) for dropdowns. Pure, sync, zero deps.

## Goal

> "Expose `parseModelId` and add `humanizeModelName`/`toModelOption` on `@theokit/sdk/models` so a UI renders model slugs as labels without hand-rolling, measured by `pnpm --filter @theokit/sdk exec vitest run tests/model-option.test.ts tests/models-wiring.test.ts` reporting all tests passed."

## Context

Roadmap gap M5-8 (`docs/gap-audit/ROADMAP.md:167`, low sev, size S, Tema D, dep M2-4). `parseModelId(modelId): { provider, name }` exists (`internal/llm/model-identifier.ts:43`, `@internal`) — it splits the first `/` (provider) from the rest (name), handling OpenRouter routing (`openrouter/openai/gpt-4o`) + tag suffixes. M2-4 shipped the `@theokit/sdk/models` subpath (`src/models.ts`) for model metadata. M5-8 promotes `parseModelId` to that public surface and adds two pure label helpers so `@theokit/ui`'s model dropdowns + the `create-theokit` template stop re-deriving slug→label. Zero new dependencies.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/src/internal/llm/model-identifier.ts` | ~66 | (sdk) | `parseModelId` slug→{provider,name} | `parseModelId` signature + behavior unchanged; flip `@internal`→`@public` |
| `packages/sdk/src/internal/llm/model-option.ts` (NEW) | 0 | — | `humanizeModelName` + `toModelOption` + `ModelOption` | — |
| `packages/sdk/src/models.ts` | ~16 | (M2-4) | `@theokit/sdk/models` barrel | additive re-exports only |
| `packages/sdk/tests/model-option.test.ts` (NEW) | 0 | — | unit tests — RED first | — |
| `packages/sdk/tests/models-wiring.test.ts` | ~30 | (M2-4) | models subpath wiring test | existing assertions stay green; ADD parseModelId/toModelOption export assertions |
| `docs.md` | (contract) | — | public API contract | additive note on the `@theokit/sdk/models` section |
| `CHANGELOG.md` (root) + `.changeset/` (NEW) | — | — | changelog + changeset | additive `Added` entry |

### Current callers / dependents

- **Symbol:** `parseModelId` (`model-identifier.ts:43`)
  - Callers (production): `internal/agent-loop/usage-and-cost.ts`, `internal/runtime/local-agent/real-local-run.ts` (provider detection). Re-exporting publicly does NOT change these — they import from the internal path; the public re-export is additive.
  - Callers (tests): covered transitively.
- **Symbol:** `@theokit/sdk/models` barrel (`src/models.ts`) — already wired (tsup + tsconfig.tools-dts + mirror + exports, M2-4). Adding re-exports needs NO new wiring.
- **External:** `@theokit/ui` model selectors + `create-theokit` template hand-roll slug→label (the gap's target consumers).

### Domain glossary

- **model slug / id** — a string like `openrouter/openai/gpt-4o:free`, `anthropic/claude-3-5-sonnet`, `claude-sonnet-4-6`.
- **routing prefix** — `openrouter/`/`vertex/`/`bedrock/` — a gateway prefix before the vendor/model.
- **variant** — an OpenRouter `:suffix` (`:free`/`:nitro`/…).
- **model option** — a UI dropdown entry `{ value, label, provider }`.

### Architecture boundaries affected

Per `rules/architecture.md` §1/§2: `model-option.ts` is a pure leaf module (string transform, no I/O) in `internal/llm/`; `models.ts` is the public leaf barrel. No new DIP boundary.

## Prior Art & Related Work

- **Baseline investigation (2026-06-21)** — confirmed `parseModelId` exists (`model-identifier.ts:43`, @internal), `@theokit/sdk/models` subpath wired (M2-4), and no `humanizeModelName`/`toModelOption` exist.
- **In-repo precedent** — `@theokit/sdk/models` `resolveModelCapabilities` (M2-4) strips the same routing prefixes + `:variant`; `model-identifier.ts` parses the provider prefix.
- **Consumer prior art (to replace)** — `@theokit/ui` model selectors + `create-theokit` default template slug humanization (the gap's hand-roll).
- **ADRs** — `knowledge-base/adrs/D182-*` (zero-config model UX, the `parseModelId` ADR).

## Objective

- [ ] `parseModelId` + `ParsedModelId` re-exported from `@theokit/sdk/models` (flip `@internal`→`@public`; behavior unchanged).
- [ ] `humanizeModelName(modelId): string` — strips routing prefix + vendor, prettifies the core name (separators→spaces, title-case with a small acronym-uppercase set), appends a `:variant` in parens. Best-effort, deterministic, pure.
- [ ] `toModelOption(modelId): ModelOption` — `{ value: modelId, label: humanizeModelName(modelId), provider: parseModelId(modelId).provider }`.
- [ ] Re-exported from `@theokit/sdk/models` (no new subpath wiring); `docs.md` + CHANGELOG + changeset.
- [ ] `tests/model-option.test.ts` + updated `tests/models-wiring.test.ts` green; typecheck + Biome clean.

## ADRs

### D1 — Promote `parseModelId` to public via `@theokit/sdk/models` (don't fork it)
**Decision:** re-export the existing `parseModelId`/`ParsedModelId` from `src/models.ts`; flip the `@internal` tag to `@public`. No copy.
**Rationale:** Rule 9 / DRY — one parser. `models` is the model-metadata subpath (`resolveModelCapabilities` already lives there); `parseModelId` belongs with it.
**Alternatives considered:** a new `@theokit/sdk/model-id` subpath — rejected (fragments model helpers across subpaths; `models` is the home); copy into models.ts — rejected (two parsers drift).

### D2 — `humanizeModelName` is best-effort + deterministic (no network, no per-model catalog)
**Decision:** humanize by stripping the routing prefix + vendor to the core model segment, splitting on `-_.`/whitespace, title-casing tokens (with a small acronym-uppercase set: `gpt`,`ai`,`hd`,`ui`,`api`,`sdk`,`llm`,`xl`), and appending a `:variant` in parens.
**Rationale:** a deterministic, dependency-free label that beats raw slugs for a dropdown. The gap is "stop hand-rolling slug→label", not "perfect marketing names" — a catalog of pretty names is YAGNI + drifts.
**Alternatives considered:** a static pretty-name catalog (like `resolveModelCapabilities`) — rejected (churn + staleness for a cosmetic label); leave it to the UI — rejected (that IS the hand-roll the gap removes).

### D3 — `ModelOption` shape `{ value, label, provider }`
**Decision:** `toModelOption(modelId)` returns `{ value: modelId, label: humanizeModelName(modelId), provider: parseModelId(modelId).provider }`.
**Rationale:** `value`/`label` is the universal `<option>`/`<Select>` shape; `provider` lets a UI group/badge by gateway. Minimal + framework-agnostic.
**Alternatives considered:** richer option (capabilities/icon) — rejected (YAGNI; the UI composes `resolveModelCapabilities` if it wants more); `{ id, name }` naming — rejected (`value`/`label` matches HTML/select conventions).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `humanizeModelName` won't match every vendor's marketing capitalization | Low | documented best-effort; deterministic + dependency-free; a UI can override per-id if needed | SDK |
| Acronym set is a small heuristic that could mis-case a token | Low | keep the set tiny + documented; non-acronym tokens are plain title-case (predictable) | SDK |
| New public surface (3 symbols) must stay semver-supported | Low | thin wrappers over the long-stable `parseModelId` + a pure transform | SDK |

## Unresolved Questions

(none — every decision is resolved at plan time. Public home (D1), best-effort humanization (D2), option shape (D3) are locked against the existing `parseModelId` + the `@theokit/sdk/models` subpath.)

## Dependencies

M5-8 introduces ZERO new dependencies — re-export + a pure string transform (Rule 9 / KISS).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `parseModelId` (in-repo `@internal`→public) | workspace | npm/TS | slug parse (zero-config model UX) |

### New — to be introduced

(none)

## Dependency Graph

```
Phase 1 (parseModelId public + humanizeModelName/toModelOption) ──▶ Phase 2 (barrel + docs) ──▶ Phase 3 (integration validation)
```

Sequential.

---

## Phase 1: Public parser + label helpers

**Objective:** expose `parseModelId` + add the two label helpers, with TDD.

### T1.1 — `humanizeModelName` + `toModelOption` + `ModelOption`

#### Objective
The two pure label helpers.

#### Why this step (action + reasoning)
1. **What this step does** — adds `packages/sdk/src/internal/llm/model-option.ts` with `humanizeModelName`, `toModelOption`, `ModelOption`, composing the existing `parseModelId`.
2. **Why it is necessary now** — they are the gap deliverable; building them first lets unit tests pin the humanization + option shape before the barrel re-export.

#### Evidence
`parseModelId` (`model-identifier.ts:43`) returns `{ provider, name }` (name keeps inner slashes + tag). Routing prefixes (`openrouter/`/`vertex/`/`bedrock/`) per `model-capabilities.ts:181`.

#### Files to edit
```
packages/sdk/src/internal/llm/model-option.ts — NEW: ModelOption + humanizeModelName + toModelOption
packages/sdk/tests/model-option.test.ts — NEW: RED tests (humanize openrouter/vendor/variant + plain; toModelOption shape)
```

#### Deep file dependency analysis
- Imports `parseModelId` from `./model-identifier.js`. Pure; no I/O.

#### Deep Dives
- `humanizeModelName(modelId)`: `name = parseModelId(modelId).name` (strips the first/routing prefix); split `name` at the first `:` → `base` + `variant`; `core` = last `/`-segment of `base`; `label` = `core.split(/[-_.\s]+/).filter(Boolean).map(token => ACRONYMS.has(token.toLowerCase()) ? token.toUpperCase() : capitalize(token)).join(" ")`; if `variant` → `label += \` (\${variant})\``.
- `toModelOption(modelId)` → `{ value: modelId, label: humanizeModelName(modelId), provider: parseModelId(modelId).provider }`.
- Edge: empty/undefined modelId → label `""`, provider undefined (parseModelId handles).
- Acronyms: `new Set(["gpt","ai","hd","ui","api","sdk","llm","xl"])`.

#### Pseudo-code / Signatures
```pseudocode
interface ModelOption { value: string; label: string; provider: string | undefined }
function humanizeModelName(modelId: string): string
  name = parseModelId(modelId).name
  [base, variant] = splitFirst(name, ":")
  core = lastSegment(base, "/")
  label = core.split(/[-_.\s]+/).filter(Boolean).map(prettyToken).join(" ")
  return variant ? `${label} (${variant})` : label
function toModelOption(modelId): ModelOption
  return { value: modelId, label: humanizeModelName(modelId), provider: parseModelId(modelId).provider }
# Examples
# "openrouter/openai/gpt-4o:free" -> "GPT 4o (free)", provider "openrouter"
# "anthropic/claude-3-5-sonnet"   -> "Claude 3 5 Sonnet", provider "anthropic"
# "claude-sonnet-4-6"             -> "Claude Sonnet 4 6", provider undefined
```

#### Tasks
1. Write RED tests (humanize: openrouter+variant, vendor/model, plain no-prefix, empty; toModelOption shape + provider).
2. Implement `model-option.ts`.

#### TDD
```
RED:     humanizeModelName_openrouter_variant() — "openrouter/openai/gpt-4o:free" → "GPT 4o (free)"
RED:     humanizeModelName_vendor_model() — "anthropic/claude-3-5-sonnet" → "Claude 3 5 Sonnet"
RED:     humanizeModelName_plain() — "claude-sonnet-4-6" → "Claude Sonnet 4 6"
RED:     humanizeModelName_empty_is_empty() — "" → ""
RED:     toModelOption_shape() — value=id, label=humanized, provider from parseModelId
RED:     humanizeModelName_multiple_colons() — (EC-1) "openrouter/x/y:free:beta" → "Y (free:beta)" (full variant tail kept)
RED:     humanizeModelName_acronym_and_numeric() — (EC-2) gpt→GPT, 4o→4o, sonnet→Sonnet
GREEN:   Implement model-option.ts
REFACTOR: extract prettyToken/lastSegment helpers if cyclomatic > 10
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/model-option.test.ts
```

#### Acceptance Criteria
- [ ] All RED tests pass — `pnpm --filter @theokit/sdk exec vitest run tests/model-option.test.ts` reports all tests passed.
- [ ] Pass: complexity — `pnpm --filter @theokit/sdk exec biome check src/internal/llm/model-option.ts` reports 0 warnings (cyclomatic ≤ 10).
- [ ] Pass: size — `model-option.ts` ≤ 500 lines.

#### DoD
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/model-option.test.ts` exits 0
- [ ] Zero type errors — `pnpm --filter @theokit/sdk typecheck` exits 0

### T1.2 — Promote `parseModelId` to `@public`

#### Objective
Flip the doc tag (no behavior change).

#### Why this step (action + reasoning)
1. **What this step does** — changes `parseModelId`/`ParsedModelId` `@internal` → `@public` in `model-identifier.ts` (it will be re-exported in Phase 2).
2. **Why it is necessary now** — the gap requires `parseModelId` public; the tag must reflect that before the barrel re-export (consistency with M2-4's `resolveModelCapabilities` `@public` flip).

#### Evidence
`model-identifier.ts:30` carries `@internal`; `resolveModelCapabilities` was flipped to `@public` in M2-4 for the same reason.

#### Files to edit
```
packages/sdk/src/internal/llm/model-identifier.ts — @internal → @public on ParsedModelId + parseModelId
```

#### Deep file dependency analysis
- Doc-tag-only change; no signature/behavior change. Existing internal callers unaffected.

#### Tasks
1. Flip the `@internal` tags to `@public`.

#### TDD
```
RED:     (covered by T2.2 wiring test — parseModelId resolves from @theokit/sdk/models)
GREEN:   tag flip
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk typecheck
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0; no behavior change (existing model-identifier tests green).

#### DoD
- [ ] Zero type errors — `pnpm --filter @theokit/sdk typecheck` exits 0

---

## Phase 2: Barrel re-export + docs

**Objective:** expose the three symbols on `@theokit/sdk/models`, documented + changelogged.

### T2.1 — `models.ts` re-exports + docs/changelog

#### Objective
Public exports + docs.

#### Why this step (action + reasoning)
1. **What this step does** — adds `parseModelId`/`ParsedModelId`/`humanizeModelName`/`toModelOption`/`ModelOption` re-exports to `src/models.ts`; documents on the `@theokit/sdk/models` section; CHANGELOG + changeset.
2. **Why it is necessary now** — the helpers are unreachable until re-exported; `models` is already wired (M2-4) so this is re-exports only (no tsup/tsconfig edits).

#### Evidence
`src/models.ts` re-exports `resolveModelCapabilities` from `internal/llm/model-capabilities.js`; the subpath is wired (M2-4).

#### Files to edit
```
packages/sdk/src/models.ts — re-export parseModelId, ParsedModelId, humanizeModelName, toModelOption, ModelOption
docs.md — document the new helpers on the @theokit/sdk/models section
CHANGELOG.md (root) — [Unreleased] Added entry
.changeset/m5-model-option.md — NEW: minor bump @theokit/sdk
```

#### Deep file dependency analysis
- `models.ts` adds re-exports from `internal/llm/model-identifier.js` + `internal/llm/model-option.js`. No new subpath wiring (the `models` entry already builds via tsc-dts).

#### Tasks
1. Add re-exports to `models.ts`.
2. Document; CHANGELOG; changeset (`biome format --write` before commit).

#### TDD
```
RED:     (T2.2 wiring) — import parseModelId + toModelOption from "@theokit/sdk/models"
GREEN:   re-exports (this task)
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk build && node -e "const m=require('@theokit/sdk/models'); if(typeof m.toModelOption!=='function')process.exit(1)"
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk build` emits dist; `@theokit/sdk/models` resolves `parseModelId`/`humanizeModelName`/`toModelOption` (ESM+CJS).
- [ ] `docs.md` documents the helpers; CHANGELOG `[Unreleased] Added` entry present `(#M5-8)`.
- [ ] Pass: lint — `pnpm --filter @theokit/sdk exec biome check src/models.ts` reports 0 warnings.

#### DoD
- [ ] Build green; subpath resolves the new symbols
- [ ] CHANGELOG + changeset present

### T2.2 — Wiring test (models subpath)

#### Objective
Prove the new symbols resolve through the subpath barrel.

#### Why this step (action + reasoning)
1. **What this step does** — extends `tests/models-wiring.test.ts` to import `parseModelId` + `toModelOption` from `../src/models.js` and assert they work + the package.json `./models` export is declared.
2. **Why it is necessary now** — wiring triad (static caller + barrel resolution); without it the new exports are orphan.

#### Evidence
`models-wiring.test.ts` already imports from `../src/models.js` + asserts the export mapping (M2-4).

#### Files to edit
```
packages/sdk/tests/models-wiring.test.ts — add parseModelId + toModelOption barrel assertions
```

#### Deep file dependency analysis
- Imports from `../src/models.js`; exercises `toModelOption("openrouter/openai/gpt-4o:free")` → `{ value, label, provider:"openrouter" }`.

#### Tasks
1. Add the assertions.

#### TDD
```
RED:     models_subpath_exposes_parse_and_option() — parseModelId + toModelOption resolve + behave (fails before re-export)
GREEN:   re-exports from T2.1 → passes
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/models-wiring.test.ts
```

#### Acceptance Criteria
- [ ] Wiring test green — `pnpm --filter @theokit/sdk exec vitest run tests/models-wiring.test.ts` reports all tests passed.
- [ ] `pnpm --filter @theokit/sdk exec knip` reports no orphan for the new exports.

#### DoD
- [ ] Wiring test green; new exports have a real caller
- [ ] Zero type errors / lint warnings

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `parseModelId` public | T1.2, T2.1 | re-export + @public (D1) |
| 2 | `humanizeModelName` | T1.1 | pure transform (D2) |
| 3 | `toModelOption` (UI option) | T1.1 | `{value,label,provider}` (D3) |
| 4 | On `@theokit/sdk/models` subpath | T2.1 | re-exports (no new wiring) |
| 5 | No orphan / real caller | T2.2 | wiring test |
| 6 | Docs + CHANGELOG + changeset | T2.1 | additive |

**Coverage: 6/6 requirements covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/sdk test` green
- [ ] Zero type errors — `pnpm --filter @theokit/sdk typecheck` exits 0
- [ ] Zero lint warnings — `pnpm --filter @theokit/sdk exec biome check` clean
- [ ] File-size budget respected (per `rules/architecture.md`)
- [ ] CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6)
- [ ] Backward compatibility preserved — `parseModelId` signature/behavior unchanged
- [ ] Plan-specific: `@theokit/sdk/models` resolves `parseModelId`/`humanizeModelName`/`toModelOption` in ESM + CJS; `attw` 🌟
- [ ] `docs.md` documents the helpers
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merge

## Final Phase: Integration Validation (MANDATORY)

**Objective:** validate the new helpers in the built artifact.

### Execution
```
pnpm --filter @theokit/sdk build
pnpm --filter @theokit/sdk test
pnpm --filter @theokit/sdk typecheck
pnpm --filter @theokit/sdk exec biome check packages/sdk/src packages/sdk/tests
pnpm run validate:attw
```

### Acceptance Criteria
- [ ] All test suites green — `pnpm --filter @theokit/sdk test` exits 0
- [ ] Coverage ≥ 90% on changed files (`model-option.ts` — critical paths 100%)
- [ ] Zero type/lint errors — `pnpm --filter @theokit/sdk typecheck` + `pnpm --filter @theokit/sdk exec biome check` each exit 0
- [ ] `attw` 🌟 for `@theokit/sdk/models` — `pnpm run validate:attw` exits 0
- [ ] No regression — `pnpm --filter @theokit/sdk test` reports the full sdk suite passing (≥ baseline 2819)

### If Validation Fails
1. Separate plan-caused from pre-existing failures.
2. Fix all plan-caused failures.
3. Re-run the chain.
4. Log pre-existing issues in the PR description.
