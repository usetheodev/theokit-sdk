# Review: m2-model-capabilities

**Date:** 2026-06-21
**Reviewers (spawned agents):** 2 — behavior+test-auditor, wiring+cross-validation+architecture (general-purpose, opus-class)
**Findings:** 0 BLOCKER, 0 HIGH, 3 LOW (1 fixed, 2 advisory), INFO
**Verdict:** READY_TO_MERGE

> Per-agent finding files: `.claude/agents/review-m2-model-capabilities-2026-06-21/findings/*.md`.

## Scope reviewed

Commits `bf714ee` (T1.1 suffix fix + @public) + `1cf9c16` (T2.1 promotion + wiring + docs) + the module-comment nit + code-quality audit, on `develop` vs `main`. Files: `packages/sdk/src/internal/llm/model-capabilities.ts`, `src/models.ts` (NEW), `tsup.config.ts`, `tsconfig.tools-dts.json`, `scripts/mirror-dts-to-cts.mjs`, `package.json`, `tests/internal/llm/model-capabilities.test.ts`, `tests/models-wiring.test.ts` (NEW), `docs.md`, root + package `CHANGELOG.md`, `.changeset/m2-model-capabilities.md`.

## BLOCKER / HIGH findings

_None._ Both reviewers independently reached 0 BLOCKER, 0 HIGH.

- **Bug fix correct:** `stripVariantSuffix` cuts at the first `:` and runs BEFORE `inferVendorPrefix`, so `openrouter/openai/gpt-4o:free` → 128k and `vertex/claude-3-5-sonnet:nitro` → 200k (EC-1 combine). No-suffix + unknown ids unchanged. The truncation is provably safe — all 12 `EXACT` catalog keys are colon-free. Edge inputs (`""`, `":"`) → conservative defaults, no throw. The resolver is genuinely pure/sync/offline (zero imports).
- **Wiring quartet complete + correct:** the new `@theokit/sdk/models` subpath mirrors `@theokit/sdk/messages` exactly (tsup `entry`; `tsconfig.tools-dts.json` include incl. the leaf target; `mirror-dts-to-cts.mjs`; `package.json` dual ESM/CJS export). Build emits all 4 artifacts (`models.{d.ts,d.cts,js,cjs}`); **attw 🟢 across node10/node16-cjs/node16-esm/bundler ("No problems found")**; **publint "All good!"**; knip clean (the resolver is now a live public export, no longer dead).

## LOW findings

- **[FIXED] module-level `@internal` JSDoc was stale** (wiring): the module comment still said `@internal` though two symbols are now publicly re-exported (the symbol-level `@public` tags govern resolution, so attw was unaffected — doc hygiene only). Corrected to note the public re-exports + the accurate algorithm (was referencing a non-existent `CAPABILITIES_REGISTRY`/"prefix match").
- **[advisory] colon-free-keys invariant is JSDoc-guarded, not test-guarded** (behavior LOW-1): the "EXACT keys contain no `:`" invariant that makes the truncation safe has no executable test. Not added — `EXACT` is internal (would require exposing it just for the test), and the behavior tests + the colon-free reality cover it. A future catalog change adding a `:`-containing key would need care.
- **[advisory] pre-fix failure mode not directly asserted** (behavior LOW-2): covered incidentally by `test_bare_suffix_without_routing_prefix`.

## INFO confirmations

ADRs D1/D2/D3 honored; Coverage Matrix 8/8; Rule 9 (`src/models.ts` is a 4-line re-export — no duplicate impl); zero new deps; changeset `@theokit/sdk:minor` correct (new public subpath); docs (with a `shouldCompact` pairing example) + root/package CHANGELOG accurate, no overclaim (static/offline/conservative-defaults stated honestly); SRP/arch clean (thin barrel mirroring `messages.ts`); no scope creep (the 12 planned files). 6 new suffix tests non-vacuous (exact 128_000/>4096/4096) + EC-1 covered + 9 pre-existing pass + wiring test non-vacuous.

## Quality gate re-validation

- sdk suite: **2774 passed, 35 skipped** (incl. 15 model-capabilities + 3 models-wiring). typecheck exit 0; Biome clean; knip exit 0; build emits the `./models` subpath; attw 🟢; publint clean; code-quality PASS.

## Verdict rationale

0 BLOCKER, 0 HIGH from two independent reviewers. The OpenRouter slug-suffix fix is correct + EC-1-covered + regression-safe; the public-subpath promotion is wired correctly end-to-end (attw/publint green). The one actionable LOW (stale module comment) is fixed; the rest are advisory. Per `cycle-review.md § Verdicts`: **READY_TO_MERGE.**

## Recommended next step

Close M2 with the last item, M2-3 (context_too_long error reaching the boundary).
