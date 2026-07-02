# Discovery Plan: M0 Harness Security Floor — Fix Approaches

> **Version 1.2** (2026-07-02 — merged Q1+Q2 into one techniques question (crewAI scope + adk
> prefix) to respect max-3-per-corner; added `<!-- DEFER-CORNER: tools -->` machine marker for the
> plan-confidence gate). **Version 1.1** — absorbed EC-1 MUST-FIX into Q4 + EC-2/EC-3 checkpoints,
> per `reviews/m0-harness-security-floor-edge-cases-2026-07-02.md`. **Version 1.0** — Investigate the CORRECT FIX APPROACH for the 4 M0 security-floor defects
> (#56 cross-tenant cache leak, #54 sandbox `sh -c` + full-`process.env` leak, #59 MCP request
> never times out, #68 ACP `pre_tool_call` veto not enforced), grounded in peer implementations
> already cloned under `.claude/knowledge-base/reference/`. The prior cross-validation sweep (5
> peers, `.claude/knowledge-base/audits/cross-validation/`) already located the GAPS; this
> discovery blueprints the SOLUTIONS so `/to-plan M0` writes a plan with no guesswork and no
> reinvention (Unbreakable Rule 9). Deliverable: `m0-harness-security-floor-blueprint.md`.

**Slug:** `m0-harness-security-floor`
**Owner:** paulohenriquevn
**Created:** 2026-07-02
**Time budget:** 6h (per-project breakdown in ADR D1)

## Context

M0 of `theokit-tools/ROADMAP.md` (owned by `theokit-sdk/ROADMAP.md`) is the Harness **security
floor**: the 3 CRITICALs + the live ACP defect must close before anything builds atop the Harness.
Grounding reads (2026-07-02) confirmed all four defects in current source:

- **#56** `packages/sdk/src/internal/memory/active-memory.ts:131,247` call `cache.get/set(userText,
  queryMode)` WITHOUT the `tenantCtx` 3rd arg that `active-memory-cache.ts:97` (`cacheKey`) already
  supports — the T4.9 isolation fix is dead code (cross-validated ×2: crewAI + mastra).
- **#54** `packages/sdk/src/internal/runtime/lifecycle/spawn-collect.ts:33` and
  `packages/sdk/src/sandbox/local-sandbox.ts:27` spread the full `process.env` into every child and
  `local-sandbox` advertises isolation in prose it does not enforce (cross-validated ×codex).
- **#59** `packages/sdk/src/internal/mcp/client.ts:184` returns a Promise that never resolves when
  the server is silent; `:217` `fetch` has no timeout/AbortSignal.
- **#68** `packages/acp/src/permission-plugin.ts:92` returns `{block:true}` from `pre_tool_call`, but
  the SDK dispatch enforcement of that block is unverified — a live security defect if ignored.

Rules that bound the fixes: `rules/parsimony-ladder.md` (prefer stdlib — `AbortSignal.timeout`,
env allowlist — over new deps), `rules/error-handling.md` (typed errors, fail-closed),
`rules/testing.md` §4.1 (negative-case tests assert the *specific typed error*),
`rules/no-stubs-no-mocks-no-wired.md` (the fix must be WIRED, not just present),
`rules/architecture.md` (DIP boundaries — memory/sandbox/mcp/acp are adapters).

## Objective

Produce a blueprint that lets `/to-plan M0` decide the exact fix shape for each defect with peer
precedent, so implementation is TDD-first and reinvention-free.

- [ ] All research questions answered with citations to `.claude/knowledge-base/reference/`
- [ ] Cross-cutting comparison populated for every in-scope peer
- [ ] ≥ 1 concrete fix-decision proposal per defect (#56/#54/#59/#68)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/reference/codex/` | `codex-rs/core/src/` (exec_env, environment_selection, spawn) | Canonical env-allowlist / isolation policy (#54) |
| `.claude/knowledge-base/reference/adk-js/` | `core/src/plugins/`, `core/src/sessions/`, `core/test/plugins/`, `core/test/sessions/` | before-tool-callback veto short-circuit (#68); scoped session state (#56 context) |
| `.claude/knowledge-base/reference/crewAI/` | `lib/crewai/src/crewai/memory/` | Tenant/scope-partitioned memory (#56) |
| `.claude/knowledge-base/reference/mastra/` | streaming/agent packages (targeted) | timeout/abort patterns (#59 corroboration) |
| `.claude/knowledge-base/reference/opencode/` | agent loop / tool dispatch (targeted) | permission/timeout corroboration (#59/#68) |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/reference/*/docs/`, `*/examples/` | Marketing/examples, not the mechanism |
| `.claude/knowledge-base/reference/*/{dist,build,node_modules,target,.venv}/` | Build artifacts |
| Live/bidi, artifacts, RAG backends of any peer | Out of M0 scope (security floor only) |
| Any project not under `.claude/knowledge-base/reference/` | Cross-Project Rule: never claim a feature without reading source |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** codex 1.5h (#54 env policy), adk-js 1.5h (#68 veto + #56 scoped-state context),
crewAI 1h (#56 tenant memory), mastra 1h (#59 timeout), opencode 1h (#59/#68 corroboration).

**Rationale:** codex + adk-js carry the two hardest fix patterns (env policy, veto enforcement) so
they get the deepest dives; crewAI/mastra/opencode corroborate (a defect found ×N is highest
confidence — the cross-val already established the gaps, this confirms the fixes).

**Alternatives considered:** equal split (rejected — codex/adk carry more signal); single-project
deep dive (rejected — the strength here is cross-peer corroboration).

**Stop condition — per question:** Fase A empty after 3 query-variant retries → mark BLOCKED
("Fase A exhausted"), continue. Never pad from another question's scope.

**Stop condition — per project:** budget exhausted with questions pending → mark them BLOCKED
("budget exhausted"), continue. If all remaining questions are `done`/`blocked`, emit
`<promise>BLUEPRINT_BLOCKED</promise>` with the honest report; never `BLUEPRINT_COMPLETE` from a
blocked state.

**Anti-pattern:** NEVER fabricate a Fase B answer to close an exhausted question (Unbreakable Rule 3).

**Consequences:** the halt-loop stops per budget; blocked questions surface in the blueprint as
next-discovery seed.

### D2 — Investigation depth

**Decision:** Read the mechanism file end-to-end at each hotspot; grep-then-read for tests. Capture
the *fix pattern* (signature + guard + test), not the whole subsystem.

**Rationale:** the fixes are surgical (env allowlist, cache-key arg, timeout wrapper, veto guard);
we need the exact pattern + its test, not architectural tours. Aligns with KISS (Rule 10).

**Consequences:** blueprint is fix-focused; broader peer architecture is out of scope by design.

### D3 — Parsimony precedence (Tools corner deferral)

**Decision:** DEFER the **Tools** corner (no dedicated question). Rationale: the fixes introduce no
new build/test/CI tooling — they run on the existing locked toolchain (Vitest/tsup/tsc/Biome).
Instead, the **Dependencies** question (Q6) doubles as the parsimony check: confirm each fix uses
stdlib (`AbortSignal.timeout`, `crypto`, env allowlist) before any dependency, per
`rules/parsimony-ladder.md` rungs 2-4.

**Rationale:** adding a Tools question would be investigation theatre — nothing about a cache-key
arg or a timeout wrapper changes the build. Explicit ADR deferral per Step 3 min-1-per-corner rule.

**Consequences:** Coverage counts Tools as ADR-deferred (not empty-uncovered).

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — grep/ast map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How do peers compose a tenant/scope key so two callers with the same query never share memory results — crewAI's scope-partitioned memory AND adk-js's app:/user:/temp: prefix model? (#56, + M3 context) | techniques | `.claude/knowledge-base/reference/crewAI/lib/crewai/src/crewai/memory/`, `.claude/knowledge-base/reference/adk-js/core/src/sessions/` | `grep -n "class\|scope\|namespace\|user" crewAI/.../memory_scope.py unified_memory.py`; `grep -n "app:\|user:\|temp:\|prefix\|State" adk-js/.../state.ts` | Read crewAI `memory_scope.py:38` `MemoryScope` + `unified_memory.py` scope-key derivation, THEN adk `sessions/state.ts` prefix handling; capture how the scope/prefix enters the storage/cache key | Table: scope input (namespace/userId/scope | prefix) → key component → isolation guarantee, with `reference/{crewAI,adk-js}/...:line` |
| Q3 | How does codex build a child-process environment — inherit-all vs core-subset vs allowlist + default-excludes for secrets? (#54) | techniques | `.claude/knowledge-base/reference/codex/codex-rs/core/src/` | `grep -n "Inherit\|exclude\|allow\|pub fn create_env" exec_env.rs environment_selection.rs` | Read `exec_env.rs:20` `create_env` + `ShellEnvironmentPolicy` inherit modes + default-excludes | Enum of inherit modes + default-exclude list + citation `reference/codex/...:line` |
| Q4 | How does adk-js enforce a before-tool-callback veto — does a non-`undefined` return short-circuit the tool actually running? AND where in OUR SDK dispatch must `{block:true}` be honored? (#68) | techniques | `.claude/knowledge-base/reference/adk-js/core/src/plugins/` + OUR `packages/sdk/src/internal/agent-loop/tool-dispatch.ts` (EC-1) | `grep -n "runBeforeToolCallback\|short-circuit\|return" plugin_manager.ts`; then `grep -n "pre_tool_call\|block\|runFireAndForget\|veto" packages/sdk/src/internal/agent-loop/tool-dispatch.ts packages/sdk/src/internal/plugins/*.ts` | Read `plugin_manager.ts:276` `runBeforeToolCallback` short-circuit; THEN read our tool-dispatch + plugin-manager `pre_tool_call` path to pin whether/where `{block:true}` is enforced (EC-1) | Prose: peer veto pattern + the exact enforcement site (or gap) in OUR dispatch, with both citations |
| Q5 | How do adk-js / codex TEST the security boundaries (tenant isolation, permission veto, env-not-leaked)? (#56/#68/#54) | tests | `.claude/knowledge-base/reference/adk-js/core/test/`, `.claude/knowledge-base/reference/codex/codex-rs/core/src/` | `grep -ln "deny\|block\|isolat\|sensitive\|exclude" adk-js/core/test/plugins/*.ts adk-js/core/test/sessions/state_test.ts codex/codex-rs/core/src/exec_env_tests.rs` | Read `security_plugin_test.ts`, `state_test.ts`, `exec_env_tests.rs:14` `test_core_inherit_defaults_keep_sensitive_vars`; capture the assert shape | Table: boundary → test name → assertion (typed error / excluded var / denied call) + citation |
| Q6 | How do peers implement request/subprocess TIMEOUT (stdlib `AbortSignal.timeout`/`setTimeout` vs a dep like `p-timeout`/`execa`)? Confirms parsimony for #59/#54. (#59) | deps | `.claude/knowledge-base/reference/mastra/`, `.claude/knowledge-base/reference/opencode/`, `.claude/knowledge-base/reference/codex/` | `grep -rn "AbortSignal.timeout\|setTimeout\|p-timeout\|execa\|AbortController" reference/mastra reference/opencode` (text-shape; Fase A may narrow) | Read each timeout site; note stdlib vs dep + the typed-error/rejection shape | List: peer → timeout mechanism (stdlib?) → error shape + citation |

## Coverage Matrix

<!-- DEFER-CORNER: tools | fixes introduce no new build/test/CI tooling; they run on the existing locked toolchain (Vitest/tsup/tsc/Biome). The Dependencies question Q6 doubles as the parsimony-ladder tooling check. See ADR D3. -->

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q5 | Covered |
| Dependencies | Q6 | Covered |
| Tools | (none) | ADR-deferred (D3 + DEFER-CORNER marker) |
| Techniques | Q1, Q3, Q4 | Covered |

**Coverage: 4/4 corners accounted (3 covered + 1 ADR-deferred = 100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | cited `reference/{project}/{path}` exists | Mark Qx BLOCKED "path not found", continue |
| Per-question Fase A budget | ≥ 1 hotspot OR 3 query-variant retries | After 3 retries, mark Qx BLOCKED "Fase A exhausted" |
| After answering Qx | blueprint section has ≥ 1 citation | Re-iterate Qx (1 retry max) |
| Per-project time budget | budget not exhausted | Mark remaining Qx BLOCKED "budget exhausted", advance |
| Q3 policy-model (EC-2) | Q3 answer captures abstract inherit-mode enum + default-exclude list, NOT Rust transcription | Re-iterate Q3 to abstract the model |
| Q6 stdlib-first (EC-3) | Q6 confirms `AbortSignal.timeout()` on Node ≥22.12 and prefers stdlib before any dep | Re-iterate Q6 to record the stdlib decision |
| Before promising complete | all covered corners have populated sections + ≥1 ADR | Refuse promise, continue |

## Acceptance Criteria

- [ ] All 6 questions answered OR explicitly BLOCKED with reason
- [ ] Integration-tests, Dependencies, Techniques corners populated (Tools ADR-deferred)
- [ ] Every citation resolves to a real `.claude/knowledge-base/reference/{...}` path
- [ ] ≥ 1 ADR in the blueprint synthesizing the fix decision per defect
- [ ] Time budget respected per project
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint at `.claude/knowledge-base/discoveries/blueprints/m0-harness-security-floor-blueprint.md`

## Global Definition of Done

- [ ] plan → edge-cases → execute → confidence (→ improve if NEEDS_REVISION) complete
- [ ] Final `/discover-confidence` verdict in blueprint header
- [ ] No fabricated citations
- [ ] Coverage Matrix 100% accounted
- [ ] ADRs reference ≥ 1 project rule (parsimony-ladder / error-handling / testing / architecture)
