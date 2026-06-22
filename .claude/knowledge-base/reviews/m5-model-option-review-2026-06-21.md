# Review — m5-model-option (M5-8)

**Date:** 2026-06-21
**Verdict:** READY_TO_MERGE
**Commits:** f1de451 (impl) + e4e8b14 (review-fix)
**Plan:** knowledge-base/plans/m5-model-option-plan.md (plan-confidence SHIPPABLE 98.8)
**Code-quality:** PASS

## Method

One independent FAANG-level reviewer (read-only, arch + tests) — proportionate to a size-S pure-function + re-export change. Returned **READY_TO_MERGE** (0 BLOCKER/HIGH/MEDIUM) after a 14-input adversarial trace.

## Findings adjudicated

| # | Sev | Finding | Resolution |
|---|---|---|---|
| 1 | LOW | trailing-slash no-provider slug (`gpt-4o/`) humanized to `""` — the model name was lost (the worse of the two). | **FIXED** (e4e8b14): strip a trailing slash from `base` before taking the last segment → `"GPT 4o"`. +regression test. |
| 2 | LOW | empty base + variant (`:free`, `anthropic/:free`) yielded a leading-space label `" (free)"`. | **FIXED** (e4e8b14): degrade to the bare variant (`"free"`) when there is no base label. +regression test. |
| 3 | INFO | the two edges above were untested. | **HARDENED** (e4e8b14): both now covered. |
| 4 | INFO | ADRs honored (D1 promote-not-fork, D2 best-effort deterministic, D3 `{value,label,provider}`); `parseModelId` `@public` flip is doc-only (body unchanged, 2 internal callers unaffected); pure leaf module; re-export only (models wired in M2-4); Coverage Matrix 6/6. | No action. |

## Verdict rationale

The reviewer traced 14 inputs (documented examples + EC-1 multiple-colons + EC-2 acronym/numeric + unicode + malformed edges), confirmed correctness, backward-compat (parseModelId unchanged; internal callers untouched), pure-leaf architecture, and that all ADRs + the 6/6 matrix are realized. The only findings were 2 LOW best-effort edges on malformed input — both fixed with regression tests despite being within the documented best-effort contract, since #1 (a real model name vanishing) is a correctness smell.

## Validation (post-fix)

- typecheck: clean (0 errors)
- model-option + models-wiring tests: 14 passed (10 model-option + 4 models-wiring)
- full sdk suite: **2830 passed / 35 skipped** (no regression)
- biome clean · attw 🌟 (`@theokit/sdk/models`) · code-quality PASS.

**Verdict:** READY_TO_MERGE
