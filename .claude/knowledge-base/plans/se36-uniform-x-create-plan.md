---
slug: se36-uniform-x-create
milestone_id: SE36
created_at: 2026-07-13
goal: Collapse every public @theokit/sdk factory into a uniform X.create() static-namespace API (v3.0 hard break), reversing Unbreakable Rule 9.
verdict: SHIPPABLE_WITH_CAVEATS
---

# Plan — SE36 Uniform `X.create()` public API (v3.0 breaking)

## Goal

Every public factory function in `@theokit/sdk` becomes a static method `X.create()` on a
namespace class, matching `Agent.create` / `Cron.create` / `Workflow.create`. The old
`define*`/`create*`/`with*` exports are **removed** (hard break, no aliases). A shipped
`jscodeshift` codemod migrates consumers. `docs.md`, `README.md`, `CLAUDE.md` (Rule 9 + Locked
names), and every example are rewritten and re-verified against a real LLM. Major bump to
`@theokit/sdk@3.0.0`.

Blueprint (evidence): `.claude/knowledge-base/discoveries/blueprints/se36-uniform-x-create-blueprint.md`.
Class shape / codemod / tree-shake / inference all proven there with reproducible spikes.

## Baseline Context

The public factory surface, verified from the barrels (`packages/sdk/src/index.ts` + the ~30
subpath entrypoints in `package.json` `exports`). Behavior is UNCHANGED — each `X.create` wraps
the existing implementation (kept internal, un-exported), so parity is by construction (ADR-B1).

### Factory → class map (the definitive surface)

| # | Current public export | Entrypoint | New | Notes |
|---|---|---|---|---|
| 1 | `defineTool` | `@theokit/sdk` | `Tool.create` | `define-tool.ts` |
| 2 | `defineProvider` | `@theokit/sdk` | `Provider.create` | `define-provider.ts` |
| 3 | `definePlugin` | `@theokit/sdk` | `Plugin.create` | Rule-9 exemplar — re-exported from `internal/plugins` |
| 4 | `defineSkillReadTool` | `@theokit/sdk` | `SkillReadTool.create` | `define-skill-read-tool.ts` |
| 5 | `defineSubAgent` | `@theokit/sdk` | `SubAgent.create` | `a2a/subagent.ts` |
| 6 | `createSquad` | `@theokit/sdk` | `Squad.create` | `squad.ts` |
| 7 | `createSkill` | `@theokit/sdk` | `Skill.create` | `create-skill.ts` |
| 8 | `createSessionManager` | `@theokit/sdk` | `Session.create` | `session-manager.ts` — `SessionManager` stays the return TYPE |
| 9 | `createAgentFactory` | `@theokit/sdk` | `AgentFactory.create` | `agent-factory.ts` |
| 10 | `createNoopMemoryProvider` | `@theokit/sdk` | `NoopMemoryProvider.create` | re-export |
| 11 | `createPermissionPlugin` | `@theokit/sdk` | `PermissionPlugin.create` | `permission-plugin.ts` |
| 12 | `createTokenLimiter` | `@theokit/sdk` | `TokenLimiter.create` | `built-in-processors.ts` |
| 13 | `createUnicodeNormalizer` | `@theokit/sdk` | `UnicodeNormalizer.create` | `built-in-processors.ts` |
| 14 | `defineSubscription` | `@theokit/sdk/subscription` | `Subscription.create` | `subscription/define-subscription.ts` |
| 15 | `createSemaphore` | `@theokit/sdk/concurrency` | `Semaphore.create` | `concurrency.ts` |
| 16 | `createExclusive` | `@theokit/sdk/concurrency` | `Exclusive.create` | `concurrency.ts` |
| 17 | `withRetry` | `@theokit/sdk/retry` | `Retry.create` | `retry.ts` — see ADR-P2 (awkward noun accepted) |
| 18 | `createBudget` | `@theokit/sdk/eval` | `Budget.create` | `budget.ts` — `Budget` class ALREADY exists → consolidate |
| 19 | `defineAuth` | `@theokit/sdk/server/auth` | `Auth.create` | `server/auth/orchestrator.ts` |
| 20 | `createAgentHandler` (×3) + `createSharedAgentHandler` | server adapters | `AgentHandler.create` | see ADR-P3 |

### ADRs

- **ADR-P1 (reverses Rule 9 / supersedes D431).** Every PUBLIC factory ships as `X.create()`.
  Internal helpers behind an existing namespace (`createLocalAgent`/`createCloudAgent` →
  `Agent.create`, `createCronJob` → `Cron.create`, `createEventStream`, `createTelemetry`,
  `createRequire`, `createSharedAgentHandler`, `createPluginContext`) stay internal (ADR-B3,
  `architecture.md` public/internal boundary). Rationale + SOTA-divergence recorded in
  `docs/adr/0015-uniform-x-create-reverses-rule-9.md` (created in Phase 0). Alternatives
  considered: keep the split (rejected by owner), deprecated aliases (rejected — owner chose hard
  break).
- **ADR-P2 — awkward nouns accepted.** `withRetry` → `Retry.create`, `defineAuth` → `Auth.create`,
  `NoopMemoryProvider.create` read less naturally than the verb form, but uniformity is the
  mandate. Documented, not exempted. Alternative (per-symbol exception) rejected: partial
  uniformity defeats the goal.
- **ADR-P3 — one `AgentHandler` namespace, framework via arg.** The three framework adapters
  (`express`/`fastify`/`hono`) each export `createAgentHandler`; they live on separate subpath
  entrypoints and are never imported together, so each becomes `AgentHandler.create` on ITS OWN
  adapter entrypoint (no collision — different modules). `createSharedAgentHandler` is internal
  plumbing and stays un-exported. Alternative (single unified `AgentHandler.create({framework})`)
  rejected: would force all three web frameworks into one bundle, breaking tree-shaking.

## Drawbacks & Risks

1. **Maximum blast radius (accepted).** Hard break + full scope → every consumer import breaks at
   once. Mitigation: the shipped codemod round-trips the whole in-tree `examples/**` suite before
   3.0.0 is cut (blueprint proved the transform).
2. **SOTA-idiom divergence (accepted).** No peer uses `X.create`. Mitigation: ADR-P1 records it;
   docs lead with the mental model.
3. **`Budget` double-definition.** A `Budget` class already exists next to `createBudget`.
   Mitigation: consolidate — `Budget.create` becomes the sole constructor; audit existing `Budget`
   usages first (Phase 3).
4. **Docs drift.** `docs.md` is the source of truth and large. Mitigation: a grep gate
   (`rules/no-stubs-no-mocks-no-wired.md` style) asserts zero `defineTool`/`createX` strings remain
   in `docs.md`/`README.md`/examples before release.

## Unresolved Questions

(none — the surface is fully enumerated; awkward cases resolved by ADR-P2/P3.)

## Tasks (phased — halt-loop per phase)

### Phase 0 — ADR + scaffolding
- **T0.1** Write `docs/adr/0015-uniform-x-create-reverses-rule-9.md` (supersede D431, record SOTA divergence + the map). *Why this step:* the locked-rule reversal must be recorded before code (Golden-Rule Change Protocol).
- **T0.2** Add a shared internal helper convention: for each factory, keep the impl function `internal`, add `export class X { private constructor(){} static create = <impl> }`.

### Phase 1 — Core capability namespaces (@theokit/sdk barrel: #1–#13)
Per symbol, RED→GREEN→REFACTOR→WIRING→COMMIT:
- **T1.n** For symbol n: (RED) write `X.create` parity test importing the new class (compile-fails first); (GREEN) add the class wrapping the retained internal impl; remove the old export from `index.ts`; (WIRING) migrate all in-repo callers + the existing behavior tests to `X.create`; (COMMIT) `feat(sdk)!: Tool.create (was defineTool) [SE36]`.
  - TDD shape per symbol: `test("X.create parity: <symbol> descriptor unchanged", …)` asserting structural equality vs the pre-rename snapshot.

### Phase 2 — Subpath namespaces (#14–#20)
- **T2.n** Same loop for `Subscription`/`Semaphore`/`Exclusive`/`Retry`/`Budget`/`Auth`/`AgentHandler`, each on its subpath entrypoint. `Budget` consolidation (ADR: audit existing `Budget` class usages first).

### Phase 3 — Codemod
- **T3.1** `tools/codemods/se36-x-create.mjs` — the proven transform, extended to the full 20-symbol map + subpath imports. Ship it via `package.json` `files` so consumers run `npx jscodeshift -t node_modules/@theokit/sdk/codemods/se36-x-create.mjs src --parser=ts`.
- **T3.2** Codemod tests: a fixture corpus (before/after) covering every symbol + mixed imports + subpath imports. Gate: codemod round-trips the entire `examples/**` tree with zero diff drift.

### Phase 4 — Docs + copy
- **T4.1** Rewrite `docs.md` (source of truth) to the new surface. Grep gate: zero old-symbol strings.
- **T4.2** Rewrite `README.md` DEEP DIVE code blocks.
- **T4.3** Rewrite `CLAUDE.md` Inviolable Rule 9 + Locked-names table (same-PR requirement per Locked-names protocol).
- **T4.4** Migrate the docs-site examples in `theo-opendocs` (`content/theokit/**` + `examples/**` + `examples/manifest.json`).

### Phase 5 — Examples + real-LLM re-verification
- **T5.1** Run the codemod over `examples/**`; typecheck the whole example suite.
- **T5.2** Re-run every example that drives an LLM against **OpenRouter** (`rules/real-llm-validation.md`); capture model + output per example. Config-only examples: fixture is fine, documented.

### Phase 6 — Benchmark + release
- **T6.1** Benchmark: (a) parity — a script diffing the descriptor output of the old impl vs `X.create` for representative factories (must be byte-identical); (b) tree-shake — build a consumer entry importing only `Agent` and assert the bundle excludes unused namespaces (blueprint spike, promoted to a committed bench under `benchmarks/`). Capture numbers.
- **T6.2** Changeset (major) + CHANGELOG `§ Removed` (every removed symbol) + `§ Changed` (rename). Bump to `3.0.0`.
- **T6.3** `/code-quality` (≥ PASS_WITH_CAVEATS) → `/review` (READY_TO_MERGE) → `/release` develop→main PR + self-merge (owner-authorized) → flip SE36 checkbox.

## Coverage Matrix

| Goal claim | Task(s) |
|---|---|
| Every public factory → `X.create` | T1.1–T1.13, T2.14–T2.20 |
| Old exports removed (hard break) | each T1.n/T2.n WIRING removes the barrel export; T4.1 grep gate |
| Codemod ships | T3.1, T3.2 |
| docs.md/README/CLAUDE.md rewritten | T4.1–T4.3 |
| Examples migrated + real-LLM verified | T4.4, T5.1, T5.2 |
| Rule 9 reversed via ADR | T0.1 |
| Behavior parity (zero change) | per-symbol parity test (T1.n/T2.n), T6.1(a) |
| Benchmark evidence | T6.1 |
| v3.0 release + merge | T6.2, T6.3 |

## Test Plan

- **Unit (per symbol):** parity test — `X.create(spec)` structurally equals the pre-rename
  descriptor; the migrated legacy behavior tests stay green on the new entry point.
- **Codemod:** fixture before/after corpus (every symbol, mixed + subpath imports); round-trip over `examples/**`.
- **Integration / real-LLM:** ≥ 1 example per capability re-run against OpenRouter (evidence captured).
- **Negative:** `new Tool()` is a compile error (private constructor); importing a removed symbol (`defineTool`) is a compile error (proves the hard break).
- **Benchmark:** parity byte-diff + tree-shake bundle assertion (committed under `benchmarks/`).

## Dependencies audit

No NEW runtime or dev dependency. `jscodeshift@^17.3.0` already installed (reused, parsimony
rung 4). `deps-audit` verdict: PASS (no planned dependency, no CVE surface added).

## Definition of Done

- [ ] All 20 public factories converted; old exports grep-absent from `src` barrels, `docs.md`, `README.md`, examples.
- [ ] `pnpm typecheck` + `pnpm test` green; per-symbol parity tests present.
- [ ] Codemod round-trips `examples/**` with zero drift; codemod tests green.
- [ ] `docs.md` + `README.md` + `CLAUDE.md` (Rule 9 + Locked names) updated.
- [ ] Every LLM-driving example re-verified against OpenRouter (evidence captured).
- [ ] Benchmark evidence (parity byte-diff + tree-shake) committed.
- [ ] ADR 0015 written; CHANGELOG `§ Removed`/`§ Changed`; `@theokit/sdk@3.0.0`.
- [ ] `/code-quality` ≥ PASS_WITH_CAVEATS; `/review` READY_TO_MERGE; released + merged; SE36 `[x]`.
