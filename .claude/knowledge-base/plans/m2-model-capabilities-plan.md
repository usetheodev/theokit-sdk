---
slug: m2-model-capabilities
created_at: 2026-06-21
goal: Fix the OpenRouter slug-suffix lookup miss in resolveModelCapabilities and promote it (+ ModelCapabilities) to a public @theokit/sdk/models subpath, measured by tests/internal/llm/model-capabilities.test.ts + tests/models-wiring.test.ts passing green.
---

# Plan: M2-4 — Per-model context-window catalog (promote + fix slug suffix)

> **Version 1.1** (edge-case-plan absorbed: EC-1 suffix-strip + vendor-inference combine folded into T1.1 TDD) — Two changes to the dead `@internal` `resolveModelCapabilities` (`packages/sdk/src/internal/llm/model-capabilities.ts`): (1) FIX the OpenRouter slug-suffix bug — `openrouter/openai/gpt-4o:free` strips the routing prefix to `openai/gpt-4o:free`, misses the `EXACT` table (which has `openai/gpt-4o`), and falls back to `CONSERVATIVE_DEFAULTS` instead of the real 128k window; strip the `:variant` suffix before lookup; (2) PROMOTE `resolveModelCapabilities` + `ModelCapabilities` to a public `@theokit/sdk/models` subpath (it is `@internal` and unexported today — dead public API), so consumers can read a per-model `maxContextTokens` offline (feeds M2-2's `shouldCompact`). Pure, sync, offline, zero new deps. Closes roadmap gap M2-4 (Tema B).

## Goal

> "Fix the OpenRouter `:variant` slug-suffix miss in `resolveModelCapabilities` and expose it (+ `ModelCapabilities`) on a public `@theokit/sdk/models` subpath — measured by `tests/internal/llm/model-capabilities.test.ts` + `tests/models-wiring.test.ts` passing green."

## Context

Roadmap gap M2-4 (`docs/gap-audit/ROADMAP.md:111`, med sev, size M, Tema B). `resolveModelCapabilities(modelId): ModelCapabilities` (`packages/sdk/src/internal/llm/model-capabilities.ts:187`) is a pure, no-I/O resolver over a static `EXACT` table (`:42`, per-model `maxContextTokens`/`maxOutputTokens`/feature flags) with a `CONSERVATIVE_DEFAULTS` (4096/4096) fallback (`:32`). It is `@internal` (`:185`) and NOT exported from the public barrel — dead public API. THE BUG (`:201-215`): `stripRoutingPrefix` removes `openrouter/`/`vertex/`/`bedrock/` but neither it nor `inferVendorPrefix` strips an OpenRouter `:variant` suffix (`:free`/`:nitro`/`:floor`/`:beta`), so `openrouter/openai/gpt-4o:free` → `openai/gpt-4o:free` → EXACT miss → `inferVendorPrefix` returns it unchanged (doesn't start with `gpt-`/`claude`/`gemini`) → another miss → `CONSERVATIVE_DEFAULTS` (wrong window). The module is a leaf (no imports), so its DTS uses the tsc path (`tsconfig.tools-dts.json` + mirror-dts), like `@theokit/sdk/messages`. M2-2's `shouldCompact` takes `contextWindow` as a param — M2-4 gives consumers the public way to fetch it. Respects `rules/architecture.md` + `rules/no-stubs-no-mocks-no-wired.md`. Zero new deps.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/src/internal/llm/model-capabilities.ts` | 216 | — | the `EXACT` catalog + `resolveModelCapabilities` (`@internal`) | keep the catalog data + existing resolution; ADD suffix strip; make resolver `@public` |
| `packages/sdk/src/models.ts` (NEW) | 0 | — | public barrel for `@theokit/sdk/models` | re-export only |
| `packages/sdk/tests/internal/llm/model-capabilities.test.ts` | 94 | — | resolver unit tests | additive suffix cases (RED first) |
| `packages/sdk/tests/models-wiring.test.ts` (NEW) | 0 | — | subpath import + offline/sync test | — |
| `packages/sdk/tsup.config.ts` | 71 | — | build entries | add `models` entry (tsc-dts) |
| `packages/sdk/tsconfig.tools-dts.json` | — | — | tsc-dts include list | add `src/models.ts` |
| `packages/sdk/scripts/mirror-dts-to-cts.mjs` | — | — | `.d.ts`→`.d.cts` mirror | add `dist/models.d.ts` |
| `packages/sdk/package.json` | — | — | `exports` map | add `"./models"` |
| `docs.md` + `CHANGELOG.md` (root) + `packages/sdk/CHANGELOG.md` + `.changeset/` (NEW) | — | — | contract + changelogs + changeset | additive entries |

### Current callers / dependents

- **`resolveModelCapabilities`** — today only internal callers (LLM runtime) use it; it is NOT in the public barrel. After M2-4 it is also re-exported from `@theokit/sdk/models`. The internal call sites keep importing from `./internal/llm/model-capabilities.js` (unchanged); the new `src/models.ts` re-exports the same symbol (no duplicate impl).
- **`ModelCapabilities`** (interface, `:23`) — promoted alongside (the return type).

### Domain glossary

- **EXACT catalog** — the static per-model capability map (`maxContextTokens`, `maxOutputTokens`, feature flags).
- **routing prefix** — `openrouter/`/`vertex/`/`bedrock/` (stripped to find the vendor model).
- **variant suffix** — an OpenRouter `:free`/`:nitro`/`:floor`/`:beta` tier appended to the slug (`openai/gpt-4o:free`); must be stripped for the catalog lookup.

### Architecture boundaries affected

`model-capabilities.ts` is a pure leaf in `internal/llm/`. `src/models.ts` is a thin public re-export barrel (mirrors `messages.ts`). The subpath DTS uses the tsc path (the module is a leaf; consistent with the project's "tsc-dts for non-`dts.entry` subpaths" convention). No DIP boundary crossed.

## Prior Art & Related Work

- **In-repo** `model-capabilities.ts` (the resolver + catalog); the `@theokit/sdk/messages` subpath (`packages/sdk/src/messages.ts` + its tsup/tsconfig/mirror/package.json wiring) — the exact promotion pattern for a leaf module; M2-2's `shouldCompact` (the consumer of `maxContextTokens`).
- (none external — internal promotion + bug fix; `cycle-discover` not applicable.)

## Objective

- [ ] `stripVariantSuffix` removes the OpenRouter `:variant` suffix before lookup; `openrouter/openai/gpt-4o:free` resolves to the real `openai/gpt-4o` capabilities (128k window), not `CONSERVATIVE_DEFAULTS`.
- [ ] Existing resolution paths (exact, vendor-inferred, conservative fallback) unchanged.
- [ ] `resolveModelCapabilities` + `ModelCapabilities` exported from a public `@theokit/sdk/models` subpath; `@internal` → `@public`.
- [ ] Subpath wired: tsup entry + tsconfig-tools-dts include + mirror-dts + package.json `exports["./models"]`.
- [ ] Pure/sync/offline (no I/O); zero new deps; docs.md + CHANGELOG (root + package) + changeset.
- [ ] `tests/internal/llm/model-capabilities.test.ts` + `tests/models-wiring.test.ts` green; typecheck + Biome clean; build emits the `./models` dts.

## ADRs

### D1 — Strip the OpenRouter `:variant` suffix before lookup
**Decision:** add `stripVariantSuffix(s) = s includes ":" ? s.slice(0, s.indexOf(":")) : s`; apply it after `stripRoutingPrefix` in `resolveModelCapabilities` so `…/gpt-4o:free` → `…/gpt-4o`.
**Rationale:** OpenRouter appends a tier variant via `:`; model slugs otherwise contain no `:`, so cutting at the first `:` is safe and fixes the miss. The fix is additive — exact/vendor/fallback paths are unchanged for suffix-less ids.
**Alternatives considered:** an allow-list of known suffixes (`:free`/`:nitro`/…) (rejected — brittle; new variants would re-break it; cutting at `:` is robust); regex normalize (rejected — overkill).

### D2 — Promote via a public `@theokit/sdk/models` subpath (not the main barrel)
**Decision:** create `src/models.ts` re-exporting `resolveModelCapabilities` + `ModelCapabilities`; wire the `@theokit/sdk/models` subpath; flip `@internal` → `@public` on the resolver.
**Rationale:** consistent with the other promoted utilities (compaction/retry/concurrency/messages are subpaths, not main-barrel dumps); keeps the main barrel focused on the top-level API (`Agent`/`Cron`/…).
**Alternatives considered:** export from `src/index.ts` main barrel (rejected — the main barrel is the agent API surface; a capabilities lookup is a focused utility, better as a subpath); leave internal + duplicate a public copy (rejected — Rule 9, one source).

### D3 — tsc-dts wiring (leaf module, project convention)
**Decision:** add `models: "src/models.ts"` to tsup `entry` (NOT the rollup `dts.entry` block); add `src/models.ts` to `tsconfig.tools-dts.json`; add `dist/models.d.ts` to `mirror-dts-to-cts.mjs`; add the `./models` export (dual ESM/CJS) to `package.json`.
**Rationale:** mirrors `@theokit/sdk/messages` exactly — the project routes all non-`dts.entry` subpaths through tsc-dts + mirror to dodge the rollup-plugin-dts cycle and attw "masquerading" warnings.
**Alternatives considered:** add to the rollup `dts.entry` block (rejected — the project reserves that for the 5 cycle-free entries; messages/compaction deliberately avoid it).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `stripVariantSuffix` cuts at the first `:` — a model slug legitimately containing `:` would be truncated | Low | model slugs do not contain `:` except for the OpenRouter variant separator (documented); the `EXACT` keys are colon-free | SDK |
| New public subpath = new semver surface to maintain | Low | thin re-export of an existing pure function; the catalog is a static table; no runtime/I/O surface | SDK |
| Catalog is not exhaustive (only common models) | Low | unknown models still return `CONSERVATIVE_DEFAULTS` (documented, unchanged); consumers can branch on a conservative window | SDK |

## Unresolved Questions

- (none — every decision is resolved at plan time: the suffix-strip rule, the subpath promotion, and the tsc-dts wiring are fixed. A live/online catalog refresh is explicitly out of scope — the table is offline/static by design.)

## Dependency Graph

```
Phase 1 (stripVariantSuffix fix + suffix regression tests) ──▶ Phase 2 (promote: src/models.ts + subpath wiring + wiring test + docs/changeset/CHANGELOG) ──▶ Final Phase (integration validation)
```

---

## Phase 1: Fix the slug-suffix miss (bug fix — regression test first)

### T1.1 — `stripVariantSuffix` in `model-capabilities.ts`

#### Objective
Strip the OpenRouter `:variant` suffix so suffixed ids resolve to the real catalog entry.

#### Why this step (action + reasoning)
1. **What** — add `stripVariantSuffix` and apply it in `resolveModelCapabilities` before the EXACT lookup.
2. **Why now** — it is the correctness bug; a regression test reproducing the wrong `CONSERVATIVE_DEFAULTS` result for `…:free` must fail FIRST (RED), then the fix makes it green.

#### Evidence
`model-capabilities.ts:187-215` (the resolver + `stripRoutingPrefix`/`inferVendorPrefix` — the miss). `EXACT` `:42` (has `openai/gpt-4o` = 128k). Test file `tests/internal/llm/model-capabilities.test.ts:82-92` (existing routing-prefix tests; no suffix case).

#### Files to edit
```
packages/sdk/src/internal/llm/model-capabilities.ts — add stripVariantSuffix; apply in resolveModelCapabilities
packages/sdk/tests/internal/llm/model-capabilities.test.ts — RED suffix tests first
```

#### Deep file dependency analysis
- Self-contained leaf edit; no import change. Internal callers' behavior only improves (suffixed ids now resolve correctly); suffix-less ids unchanged.

#### Pseudo-code / Signatures
```pseudocode
function stripVariantSuffix(s: string): string
  const i = s.indexOf(":"); return i >= 0 ? s.slice(0, i) : s
// in resolveModelCapabilities:
const bare = stripVariantSuffix(stripRoutingPrefix(modelId))   // was: stripRoutingPrefix(modelId)
```

#### TDD
```
RED: test_openrouter_free_suffix_resolves_real_model() — resolveModelCapabilities("openrouter/openai/gpt-4o:free").maxContextTokens === (EXACT openai/gpt-4o value, e.g. 128000), NOT CONSERVATIVE_DEFAULTS (4096)
RED: test_variant_suffix_on_anthropic() — resolveModelCapabilities("openrouter/anthropic/claude-3-5-sonnet:beta") resolves to the real claude-3-5-sonnet caps (maxContextTokens > 4096)
RED: test_bare_suffix_without_routing_prefix() — resolveModelCapabilities("openai/gpt-4o:nitro").maxContextTokens === the real gpt-4o value
RED: test_no_suffix_unchanged() — resolveModelCapabilities("openrouter/openai/gpt-4o") still resolves correctly (no regression)
RED: test_unknown_still_conservative() — resolveModelCapabilities("totally/unknown:free").maxContextTokens === 4096 (CONSERVATIVE_DEFAULTS — unknown stays conservative)
RED: test_suffix_strip_combines_with_vendor_inference() — resolveModelCapabilities("vertex/claude-3-5-sonnet:nitro") resolves real claude caps (maxContextTokens > 4096); strip runs before inferVendorPrefix (edge EC-1)
GREEN: add stripVariantSuffix + apply
REFACTOR: Biome complexity ≤ 10
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/internal/llm/model-capabilities.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/internal/llm/model-capabilities.test.ts` reports all tests passed (existing + 5 new)
- [ ] `test_openrouter_free_suffix_resolves_real_model` passes (the headline fix, D1)
- [ ] `test_no_suffix_unchanged` + `test_unknown_still_conservative` pass (no regression)
- [ ] `pnpm --filter @theokit/sdk exec biome check src/internal/llm/model-capabilities.ts` reports 0 errors

#### DoD
- [ ] those tests green; `pnpm --filter @theokit/sdk typecheck` exits 0

---

## Phase 2: Promote to a public subpath

### T2.1 — `@theokit/sdk/models` subpath + wiring + docs

#### Objective
Expose `resolveModelCapabilities` + `ModelCapabilities` publicly via `@theokit/sdk/models` with full subpath wiring; document.

#### Why this step (action + reasoning)
1. **What** — `src/models.ts` re-export + flip `@internal`→`@public`; tsup entry + tsconfig-tools-dts + mirror-dts + package.json export; a wiring/offline test; docs + changeset + CHANGELOG.
2. **Why now** — the roadmap requires the resolver be public (today it is dead `@internal`); the subpath must be reachable + type-resolvable for consumers.

#### Evidence
`messages.ts` + its wiring (the leaf-promotion pattern): `tsup.config.ts:9`, `tsconfig.tools-dts.json` (messages include), `mirror-dts-to-cts.mjs` (messages line), `package.json exports["./messages"]:61`. Blueprint-less (internal promotion).

#### Files to edit
```
packages/sdk/src/models.ts — NEW: re-export resolveModelCapabilities, ModelCapabilities
packages/sdk/src/internal/llm/model-capabilities.ts — @internal → @public on the resolver
packages/sdk/tsup.config.ts — add models: "src/models.ts" to entry
packages/sdk/tsconfig.tools-dts.json — add "src/models.ts"
packages/sdk/scripts/mirror-dts-to-cts.mjs — add dist/models.d.ts
packages/sdk/package.json — add "./models" export (dual ESM/CJS)
packages/sdk/tests/models-wiring.test.ts — NEW: import from subpath + offline/sync assertions
docs.md — note the @theokit/sdk/models subpath
CHANGELOG.md (root) + packages/sdk/CHANGELOG.md — [Unreleased] § Added
.changeset/m2-model-capabilities.md — NEW minor changeset (@theokit/sdk)
```

#### Deep file dependency analysis
- `src/models.ts` imports from `./internal/llm/model-capabilities.js` (leaf). The wiring quartet (tsup/tsconfig/mirror/package.json) mirrors `messages` 1:1. The wiring test imports from `../src/models.js` (source during test).

#### TDD
```
RED: test_models_subpath_exports() — import { resolveModelCapabilities } from "../src/models.js" → typeof "function"; resolveModelCapabilities("openai/gpt-4o").maxContextTokens > 4096
RED: test_models_subpath_declared_in_package_json() — pkg.exports["./models"] is defined
RED: test_resolver_is_pure_offline_sync() — calling it twice returns equal results; it returns synchronously (no Promise) with no network (deterministic)
GREEN: add src/models.ts + wiring + @public + docs + changeset + CHANGELOG
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/models-wiring.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/models-wiring.test.ts` reports all tests passed
- [ ] `test_models_subpath_exports` passes (public subpath, D2)
- [ ] `test_models_subpath_declared_in_package_json` passes (wiring, D3)
- [ ] `grep -c "resolveModelCapabilities\|@theokit/sdk/models" docs.md` ≥ 1 AND `ls .changeset/m2-model-capabilities.md` exists AND `grep -c "resolveModelCapabilities\|models" CHANGELOG.md` ≥ 1
- [ ] `pnpm --filter @theokit/sdk build` succeeds AND `ls packages/sdk/dist/models.d.ts packages/sdk/dist/models.d.cts` both exist (dts emitted + mirrored)
- [ ] `pnpm --filter @theokit/sdk exec biome check` clean on changed files

#### DoD
- [ ] tests green; typecheck exit 0; build emits the `./models` dts; docs/changeset/CHANGELOG present

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | OpenRouter slug-suffix miss (M2-4) | T1.1 | `stripVariantSuffix` before lookup (D1) |
| 2 | existing resolution unchanged | T1.1 | additive strip; exact/vendor/fallback intact (D1) |
| 3 | resolver is dead `@internal` | T2.1 | promote to `@theokit/sdk/models` + `@public` (D2) |
| 4 | per-model context-window public | T2.1 | `ModelCapabilities.maxContextTokens` exported (D2) |
| 5 | subpath type-resolvable | T2.1 | tsc-dts + mirror + package.json export (D3) |
| 6 | sync/offline | T1.1/T2.1 | pure no-I/O resolver; offline test (D2) |
| 7 | zero new deps | T1.1/T2.1 | re-export + arithmetic (Rule 9) |
| 8 | Document + record | T2.1 | docs.md + changeset + CHANGELOG + wiring test |

**Coverage: 8/8 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/sdk exec vitest run tests/internal/llm/model-capabilities.test.ts tests/models-wiring.test.ts` green
- [ ] Zero type errors — `pnpm --filter @theokit/sdk typecheck`
- [ ] Zero lint warnings — `pnpm --filter @theokit/sdk exec biome check`
- [ ] Dead-code gate — `pnpm quality:dead` (knip) exits 0 (the resolver is now a live public export — no longer dead)
- [ ] Build clean — `pnpm --filter @theokit/sdk build`; `dist/models.d.ts` + `dist/models.d.cts` emitted
- [ ] File-size budget respected (`model-capabilities.ts` ≤ 400; `models.ts` small)
- [ ] CHANGELOG.md updated under `[Unreleased]` + changeset added (Unbreakable Rule 6)
- [ ] `docs.md` reflects the `@theokit/sdk/models` subpath
- [ ] Plan-specific: `…:free` resolves real caps; no-suffix unchanged; unknown stays conservative; resolver public + pure/sync/offline; zero new deps
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merge

## Dependencies

M2-4 introduces ZERO new dependencies — a string-suffix fix + a re-export barrel + subpath wiring (Rule 9 / KISS).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (none beyond the package itself) | — | — | pure resolver in `@theokit/sdk` |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | An online model-catalog fetch was considered + rejected: the table is offline/static by design (sync, no I/O); a live fetch is a separate concern. | n/a |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Failure scenarios

`resolveModelCapabilities` remains pure, sync, no-I/O, and total — an unknown model (with or without a suffix) returns `CONSERVATIVE_DEFAULTS`, never throws. `stripVariantSuffix` is a pure string op. The subpath re-export adds no runtime behavior. The wiring (tsup/tsconfig/mirror/package.json) failure mode is a build/typecheck error, caught by the validation gate.

## Final Phase: Integration Validation (MANDATORY)

### Execution
```
pnpm --filter @theokit/sdk exec vitest run tests/internal/llm/model-capabilities.test.ts tests/models-wiring.test.ts
pnpm --filter @theokit/sdk exec vitest run        # full sdk suite — no regression
pnpm --filter @theokit/sdk typecheck
pnpm --filter @theokit/sdk exec biome check
pnpm quality:dead
pnpm --filter @theokit/sdk build
ls packages/sdk/dist/models.d.ts packages/sdk/dist/models.d.cts
```

### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/internal/llm/model-capabilities.test.ts tests/models-wiring.test.ts` reports 0 failed
- [ ] `pnpm --filter @theokit/sdk exec vitest run` exits 0 with 0 failed tests (full suite, no regression)
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0 and `pnpm --filter @theokit/sdk exec biome check` reports 0 warnings
- [ ] `pnpm quality:dead` exits 0
- [ ] `pnpm --filter @theokit/sdk build` succeeds; `dist/models.d.ts` + `dist/models.d.cts` exist
- [ ] Runtime-metric proof — N/A (pure resolver; observable via the resolved `maxContextTokens`)

### If Validation Fails
1. Identify plan-caused vs pre-existing failures. 2. Fix all plan-caused. 3. Re-run. 4. Log pre-existing in the PR.
