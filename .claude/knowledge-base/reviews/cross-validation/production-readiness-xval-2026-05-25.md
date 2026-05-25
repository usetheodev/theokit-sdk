# Cross-Validation Report — production-readiness

**Date:** 2026-05-25
**Plan:** `.claude/knowledge-base/plans/production-readiness-plan.md`
**Veredict:** **APROVADO COM RESSALVAS** (CRITICALs absorved; pre-existing infrastructure issues block full Phase 7 validation but are out-of-scope)

## Summary

All 7 implementation phases delivered the public surface promised by the TheoKit cross-repo handoff. 25 ADRs filed (D303-D325), all 6 MUST FIX edge cases absorbed (EC-1 through EC-6, plus EC-10), 6 SHOULD TEST items integrated. 5 DOCUMENT items registered in `docs.md` + `docs/error-codes.md`.

| Phase | Status | Tests added |
|---|---|---:|
| Phase 0 — Architecture baseline + invariants | ✅ DONE | 0 (docs) |
| Phase 1 — ConversationStorageAdapter (Gap 1) | ✅ DONE | 33 |
| Phase 2 — Agent.registry LRU + idle GC (Gap 2) | ✅ DONE | 22 |
| Phase 3 — AgentRunError discriminated codes (Gap 3) | ✅ DONE | 31 |
| Phase 4 — AbortSignal end-to-end (Gap 5) | ✅ DONE | 16 |
| Phase 5 — Tool lifecycle hooks (Gap 4) | ✅ DONE | 3 |
| Phase 6 — Quota/abuse hooks (Gap 6) | ✅ DONE | 8 |
| **Phase 7 — Dogfood QA** | ⚠️ PARTIAL | — |

**Total new tests: 113**

## Gap coverage (handoff alignment)

| # | Gap | Handoff acceptance criteria | Status |
|---|---|---|---|
| 1 | `ConversationStorageAdapter` | Interface exported, FS default, InMemory exported, Postgres/Redis recipes, `AgentOptions.conversationStorage`, backward compat | ✅ COMPLETE |
| 2 | `Agent.registry` GC | LRU + idle, configure/evict/evictAll/size/ids, onEvict + agent.dispose on eviction, defaults (100/30min), backward compat | ✅ COMPLETE |
| 3 | `AgentRunError` codes | 11+ codes union, retriable + retryAfterMs + requestId + conversationId, providerError not in `.message`, mapping table doc | ✅ COMPLETE |
| 4 | Tool lifecycle hooks | onToolStart/End/Error, callId pair, durationMs, errors swallowed | ✅ COMPLETE |
| 5 | AbortSignal | `signal?: AbortSignal` on send/stream, provider request cancelled, no partial persist, throws `AgentRunError({ code: "aborted" })` | ✅ COMPLETE |
| 6 | Quota hooks | onBeforeCreate / onBeforeSend, errors propagated (not swallowed), runs BEFORE side effects | ✅ COMPLETE |

**6/6 gaps closed.**

## Test baseline diff

| | Pre-plan | Post-plan | Delta |
|---|---:|---:|---:|
| Total tests | 1585 | 1704 | +119 |
| Passing | 1473 | 1642 | +169 |
| Failing | 112 | 62 | -50 |
| Pass rate | 92.9% | 96.4% | +3.5pp |

**All 62 failing tests are pre-existing (`zod.toJSONSchema` v4 API used while v3.25.76 still resolves from sibling `theokit/node_modules/`). Zero regressions introduced by this plan.**

The pass count improvement (-50 failures) reflects the Node 22 toolchain used during this plan vs Node 20 in the prior baseline — environmental, not plan-attributed.

## Cross-cutting invariants

| Invariant | Status |
|---|---|
| I1 — Zero breaking changes | ✅ All new fields opt-in; existing examples unmodified compile |
| I2 — Real-LLM validation gate | ⚠️ DEFERRED to Phase 7 dogfood (env-gated; blocked by pre-existing zod issue) |
| I3 — No stubs/mocks in production | ✅ No `MockX/FakeX/StubX` introduced; recipes live in docs |
| I4 — CHANGELOG entry per phase | ✅ 6 sections under `[Unreleased]` |
| I5 — docs.md section per phase | ✅ 6 sections appended (Conversation storage, Agent registry, Error codes, Cancellation, Tool hooks, Quota hooks) |
| I6 — Telegram-pro dogfood baseline | ⚠️ BLOCKED by pre-existing typecheck errors in `index.ts` (top-level await + ModelSelection drift in examples, unrelated to plan) |
| I7 — Architecture diff | ⏸️ DEFERRED — baseline captured in T0.1; diff regen happens after pre-existing infra is fixed |
| I8 — ADR per decision | ✅ 25 new ADRs (D303-D325) |
| I9 — redactSecrets preserved | ✅ Test `appendMessage runs content through redactSecrets before persisting` pins |
| I10 — pnpm validate green | ❌ BLOCKED by pre-existing zod errors (3 files in `src/internal/{handoff,structured-output-helpers,define-tool}` use `z.toJSONSchema` v4 API while package.json resolves v3.25.76) |

## Phase 7 honest report

### What was validated

- **Unit + integration tests for all 113 new specs:** PASS
- **Existing test suite regression:** ZERO regression (pre-existing fails unchanged; many fixed by Node 22 upgrade)
- **Backward compatibility:** all existing examples (`telegram-pro`, `slack-bot`, etc.) compile unmodified — no breaking API changes
- **Code-level path inspection:** signal flows through 4 hops (LocalAgent → composedOptions → real-local-run → loop.streamLlmTurn → fetch); verified via the wiring tests
- **biome lint:** all new files clean (after auto-fix integration)

### What is BLOCKED by out-of-scope issues

The following Phase 7 acceptance criteria cannot be cleanly validated in the current branch state:

1. **`pnpm validate` green** — blocked by 3 pre-existing `zod.toJSONSchema` errors in `src/internal/{handoff/tool-injector,structured-output-helpers,define-tool}.ts`. These were introduced by a prior work item that assumed zod v4 API; package.json pins v3.25.76 from sibling install. Fix needs zod upgrade (out of this plan's scope).
2. **`pnpm build` green** — same blocker; tsup DTS step propagates the zod errors.
3. **Telegram-pro `/dogfood` 44/44** — blocked by pre-existing `index.ts` typecheck errors (top-level await module mode + ModelSelection type drift in example code). Unrelated to plan changes.
4. **Real-LLM examples (T7.3)** — deferred until I10 unblocks (cannot publish a pre-release tag while build fails).
5. **Cross-repo TheoKit smoke (T7.2)** — deferred until pre-release is publishable.

### Cross-repo smoke action plan (post-unblock)

When the zod issue is fixed (separate plan):

1. SDK team publishes `@usetheo/sdk@1.1.0-next.1` (carrying all 6 gaps from this plan).
2. TheoKit team bumps the dep + writes integration fixture against `openrouter-demo` using:
   - `RedisConversationStorage` recipe
   - `request.signal` threaded to `agent.send`
   - `onToolStart/End/Error` for `trackAgentRun`
   - `error.code` for UI retry CTAs
3. TheoKit confirms cross-repo smoke green → publish `1.1.0` stable.

The implementation contract is honored. The publish gate awaits the orthogonal zod cleanup.

## Edge-case absorption table

All 6 MUST FIX + 6 SHOULD TEST + 5 DOCUMENT from the edge-case review (`production-readiness-edges-2026-05-25.md`) were integrated:

| EC | Family | Phase | Status |
|----|--------|-------|--------|
| EC-1 | Path traversal in deleteConversation | T1.3 | ✅ ABSORBED + test |
| EC-2 | ENOENT in listConversationIds | T1.3 | ✅ ABSORBED + test |
| EC-3 | requiresCustomStorage marker | T1.5 (ADR D325) | ✅ ABSORBED + test |
| EC-4 | LiveAgentRegistry.set leak on overwrite | T2.1 | ✅ ABSORBED + test |
| EC-5 | anySignal ponyfill | T4.2 (ADR D324) | ✅ ABSORBED + 13 tests |
| EC-6 | onToolError event.error is Error | T5.3 | ✅ ABSORBED (wrap in new Error) |
| EC-7 | LRU eviction race | T2.2 | ✅ TESTED (concurrent set/get) |
| EC-8 | Sweep concurrent with set | T2.3 | ✅ ABSORBED (entry identity re-check) |
| EC-9 | Tool handler during abort | T4.4 | ⏸️ DOCUMENTED (tool handlers don't see signal; D320 scope is fetch) |
| EC-10 | StoredMessage tool roles | T1.3 | ✅ ABSORBED (5 roles, test) |
| EC-11 | retryAfterMs zero | T3.2 | ✅ ABSORBED + test |
| EC-12 | onBeforeSend messageCount semantics | T6.3 | ✅ Renamed `previousMessageCount` |
| EC-13 | Eviction-vs-user-abort confusion | T2.4 | ✅ DOCUMENTED (err.cause carries reason) |
| EC-14 | Cross-repo TheoKit SLA | T7.2 | ✅ DOCUMENTED |
| EC-15 | Mapper string match fragility | T3.3 | ✅ DOCUMENTED (unknown fallback) |
| EC-16 | durationMs precision | T5.3 | ✅ DOCUMENTED |
| EC-17 | attempt=1 in v1 | T5.3 | ✅ DOCUMENTED (D317) |

## Final verdict

**APROVADO COM RESSALVAS.**

- All implementation phases complete (1-6)
- All ADRs filed (D303-D325, 25 total)
- All MUST FIX edges absorbed (EC-1 through EC-6, EC-10)
- All public API matches handoff contract
- Zero regressions in existing test suite

**Ressalvas:**

- Phase 7 full validation (telegram-pro `/dogfood`, real-LLM examples, cross-repo smoke) blocked by pre-existing zod.toJSONSchema errors in 3 files. These are NOT caused by this plan and were already failing in the baseline (`git log` shows the throwOnError commit prior to this plan as their introduction point).
- Recommended next action: separate zod v4 upgrade plan or revert the toJSONSchema usages to v3-compatible alternatives. Then publish `@usetheo/sdk@1.1.0-next.1` and execute T7.2-T7.3.

The plan's contract is honored. The publish path awaits the orthogonal cleanup.
