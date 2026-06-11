# Plan: Architecture Review Fixes — 2026-06-06 audit consolidation

> **Version 1.1** — Edge case review (2026-06-06) absorbed 11 MUST FIX items: T0.1 split into T0.1-T0.4 with warn-only→error gate cutover (EC-1) + try/catch tsconfig resolution (EC-2) + no-orphans snapshot (EC-3); T1.1 gains explicit sub-steps for Agent.* static-factory routing audit (EC-4) + agent-session-store pre-grep (EC-5) + CloudAgent constructor signature mirror (EC-6); T4.1 enumerates types/index.ts barrel re-exports + adds `public-type-surface.test.ts` snapshot (EC-7) + pre-grep for cycle #3 self-ref pattern (EC-8); T5.1 promotes "Phases 1+2+3 merged" from implicit dependency to explicit DoD checkbox (EC-9) + mandates 2-commit PR pattern (pure git mv + content edit) (EC-10); T7.1 adds dry-run ls-lint audit before adding the rule (EC-11). 9 SHOULD TEST items remain inside individual task TDD sections; 4 DOCUMENT items recorded as accepted risks. Coverage Matrix unchanged at 49/49.
>
> **Version 1.0** — Close every CRITICAL, HIGH, MEDIUM, LOW and INFO finding surfaced by `architecture-output/final_report.md` (loop-architecture-review run 2026-06-06). The audit detected 13 cycles (1 CRITICAL layer-crossing runtime↔persistence, 4 HIGH memory + agent-registry, 1 LOW memory-cache, 7 LOW type-only including 5 not covered by ADR D428), a silently broken `.dependency-cruiser.cjs` CI gate, the `internal/runtime/` god folder (67 files / 9385 LOC), the `examples/telegram-pro/src/index.ts` god file (2317 LOC), the `sdk.internal.security` Zone of Pain (D=0.923), 4 underscore-prefixed file outliers, 2 silent-swallow `catch` cases (Inquebrável Rule 8 violation), an `internal/memory/` god folder (27 files), a `gateway/src/` lonely-folder cluster (6 single-file subs), a `providers/` duplicated directory-name, and `dispatchSingleCall` long-function smell. Outcome: re-running `/loop-architecture-review . --mode full` reports `cycles_total=0`, `findings_critical=0`, `findings_high=0` AND both `madge --circular` AND `npx depcruise --validate` agree.

## Goal

Eliminate every CRITICAL and HIGH architectural finding in `@theokit/sdk` so that `pnpm -w run validate` AND a re-run of `/loop-architecture-review . --mode full` both report `cycles_total=0` AND `findings_critical+high=0`, measured by the integration test `tests/architecture/zero-cycles-integration.test.ts` (NEW) asserting `madge --circular` exit=0 AND `depcruise --validate` exit=0 against `packages/sdk/src/`.

## Context

The 2026-06-06 architecture audit (`loop-architecture-review` plugin) executed all 6 phases (5.5 SOTA bypassed by user choice — no catalog) and persisted 4343 file inventory + 71 modules + 143 dependencies + 60 coupling metrics + 13 cycles + 21 architectural_findings (6 critical / 2 high / 2 medium / 8 low / 3 info) into `architecture-output/architecture.db`. The full report is at `architecture-output/final_report.md` (673 lines / 36 KB) with 9 MADR 3.0 ADR drafts at `architecture-output/adr-suggestions/0001..0009-*.md`.

The audit's headline finding: **the project's own CI architectural gate is silently broken**. `.dependency-cruiser.cjs` declares `no-circular: severity:error`, runs in CI, reports 0 cycles — and is wrong. `madge --circular` catches 13 actual cycles, 6 of them runtime. The root cause is depcruise failing to resolve the workspace `extends: ../../tsconfig.base.json` tsconfig chain and falling back to a regex scan that misses transitive imports. Restoring the depcruise tsconfig parse is the highest-leverage CI fix — once the gate works, every architectural rule actually enforces.

Per `theokit-sdk/CLAUDE.md § Inviolable rules` + `.claude/rules/architecture.md § 1`, the codebase commits to layered boundaries and Acyclic Dependencies Principle (consensus per `cycle-rule-schema.md`). Per `.claude/rules/no-stubs-no-mocks-no-wired.md`, every surface must be wired. Per `.claude/rules/testing.md`, every bug-fix starts with a RED regression test. Per `.claude/quality-gates.md`, G6 (no cycles) and G7 (layered architecture) are hard gates.

The audit also surfaced positive coverage: 33 design patterns all `applied_correctly`, 0 misapplied/missing/over-engineered, 11 informational SOLID negatives (LSP/OCP/DIP/DRY/KISS/YAGNI clean), ZERO cross-package `internal/` leaks, ZERO reverse-direction imports, `findability_check_passed` (5/5 entry anchors per CLAUDE.md Locked Names resolve at predicted paths), `disciplined_ADR_program` (430 ADRs). The findings to fix are real but isolated to specific subsystems — they do not represent systemic disrepair.

Evidence sources cited throughout this plan:
- `architecture-output/final_report.md` (the audit report)
- `architecture-output/architecture.db` (SQLite source of truth)
- `architecture-output/adr-suggestions/0001..0009-*.md` (9 MADR drafts)
- `architecture-output/analysis/depcruise-graph.json` (1.4 MB module graph)
- `architecture-output/analysis/madge-sdk-graph.json` (sdk/src subgraph)

This plan does NOT touch: `referencia/` (read-only study material), `docs/evalscope/` (vendored external project), the 430 existing ADRs (only ADD new ones), the v1.5 / v1.6 / v1.7 public API of `@theokit/sdk` (all changes are internal refactors preserving the public seam per Inquebrável Rule 4 + Hermes parity backward-compat commitments).

## Objective

- [ ] Sub-goal 1 — `madge --circular packages/sdk/src` exits 0 (zero cycles).
- [ ] Sub-goal 2 — `npx depcruise --validate .dependency-cruiser.cjs packages/sdk/src` exits 0 with tsconfig resolved (no silent regex fallback).
- [ ] Sub-goal 3 — Every CRITICAL + HIGH architectural_finding from the audit has a code or documentation resolution committed; re-running the audit DB queries reports `findings_critical=0 AND findings_high=0`.
- [ ] Sub-goal 4 — `internal/runtime/` god folder split into sub-folders preserving public API (LocalAgent stays as central façade per ADRs D304-D329); file count per direct folder ≤ 25 (heuristic guidance per `cycle-rule-schema.md`).
- [ ] Sub-goal 5 — `examples/telegram-pro/src/index.ts` ≤ 500 LOC (default LOC budget) split into a 6-7-file module preserving dogfood behavior end-to-end against real Telegram chat.
- [ ] Sub-goal 6 — `.ls-lint.yml` shipped at repo root enforcing kebab-case; 4 underscore-prefixed file outliers renamed; `pnpm -w run validate` includes the new gate.
- [ ] Sub-goal 7 — Both `clean_error` silent-catch cases (`safeListTools` in `internal/agent-loop/loop.ts:434`, `TelegramAdapter.disconnect` in `gateway-telegram/src/index.ts:79`) emit structured-log on catch per Inquebrável Rule 8 fail-claro requirement.

(Seven sub-goals — at the upper bound but each maps to a distinct dimension of the audit. Splitting risks losing the integration validation that all gates pass together.)

## ADRs

| ID | Decision | Rationale | Consequences |
|---|---|---|---|
| D431 | Break runtime cycle #8 by extracting `internal/runtime/agent-registry-contract.ts` (~30 LOC types-only file) that both `agent-registry.ts` AND `agent-registry-store.ts` import; neither imports the other. | DIP refactor per `rules/architecture.md § 2`. Mirrors the `subscribe`-at-sub-path isolation pattern (D428). Smallest-possible-break: ~30 LOC moved. Per `cycle-rule-schema.md` consensus, Acyclic Dependencies Principle is non-negotiable. | One new file. Pre-existing public seam (`internal/runtime/index.ts`) unchanged. Cycle #8 closes. ADR draft already written at `architecture-output/adr-suggestions/0001-extract-agent-registry-contract.md`. |
| D432 | Break CRITICAL runtime↔persistence layer cycle #9 by defining `internal/runtime/conversation-storage-port.ts` interface that `runtime/agent-session.ts` imports; `persistence/conversation-storage-fs.ts` implements it; wiring happens at composition root (`local-agent.ts` constructor). | The current cycle inverts the dependency direction (runtime imports persistence imports runtime), violating `rules/architecture.md § 1` layered-boundaries contract AND DIP. Port-and-adapter pattern is the canonical break per Bob Martin Clean Architecture. Alternatives considered: (a) merge runtime/persistence — rejected, breaks separation of concerns; (b) move ConversationStorageFS into runtime/ — rejected, violates persistence layer cohesion. | Adds one interface file + injection at composition root. LocalAgent constructor gains one constructor param (DI shape mirrors D-pattern ADRs D26/D202). Pre-existing tests pass — adapter shape preserved. Cycle #9 closes (CRITICAL → resolved). ADR draft already written at `architecture-output/adr-suggestions/0002-define-conversation-storage-port.md`. |
| D433 | Break HIGH memory cluster cycles #11 + #12 + #13 by extracting `internal/memory/index-manager-contract.ts` (TYPES only, ~30 LOC moved); `index-manager.ts`, `index-manager-dispatch.ts`, and `lance-memory-adapter.ts` all import from the contract; the contract imports nothing from the cluster. | Single ~30 LOC extraction breaks 3 cycles simultaneously — highest leverage refactor in the audit. Per Phase 5 cartographer note: cycles #11/#12/#13 all pivot on `index-manager.ts` as self-referencing contract hub. DIP via leaf-types module. Alternatives: (a) per-cycle individual breaks — rejected, 3× the file moves for the same outcome; (b) collapse index-manager + dispatch into one file — rejected, violates SRP per `rules/architecture.md § 3`. | One new types-only file. Cycles #11, #12, #13 (3 of 4 HIGH cycles in memory) close at once. `memory/index-manager.ts` import block changes by 3 lines. ADR draft at `architecture-output/adr-suggestions/0003-extract-index-manager-contract.md`. Sibling trackers 0006/0007/0008/0009 fold into this. |
| D434 | Restore depcruise CI gate by fixing tsconfig resolution path AND add `madge --circular` as a secondary cycle gate to `pnpm -w run validate`. Both run in CI; either non-zero exit fails the pipeline. | The current `.dependency-cruiser.cjs` falls back to regex scan because `extends: '../../tsconfig.base.json'` is resolved relative to the cwd at invocation, not relative to the depcruise config file. Workspace setups require `require.resolve(path.resolve(__dirname, '../../tsconfig.base.json'))`. Pairing with madge ensures parity check — if the two disagree, CI fails until reconciled. The depcruise+madge restoration is the highest-leverage CI fix per audit Top Refactor Priorities P0. Alternatives: (a) replace depcruise with madge only — rejected, depcruise enforces forbidden rules (G6/G7) beyond just cycles; (b) accept the gap — rejected, violates Inquebrável Rule 3 honesty AND `cycle-rule-schema.md` consensus. | `pnpm -w run validate` runs both tools. CI catches regressions. ADR draft at `architecture-output/adr-suggestions/0004-fix-depcruise-tsconfig-gate.md`. madge added as devDep (already used in Phase 5 audit). |
| D435 | Split `examples/telegram-pro/src/index.ts` (2317 LOC) into a 7-file module: `index.ts` (≤ 100 LOC bootstrap), `commands/{system,memory,workflow,canvas,voice,debug}.ts` (≤ 350 LOC each). Each commands/ file owns 4-6 related slash commands with shared local helpers. | Per `rules/architecture.md § 3` (Module cohesion) and `rules/testing.md`, files must change for the same reason. Current file mixes system (history/clear/personality), memory (lance/active/dreaming), workflow (handoffs/run), canvas (artifact preview), voice (STT/TTS), debug commands — 6 distinct change reasons. Establishes the convention for next 8+ gateway examples. Alternatives: (a) keep as single file with `// region` markers — rejected, doesn't address `rules/code-quality-golden-rule.md § 2` LOC budget; (b) full app extraction with sub-package — rejected, over-engineered per KISS for a dogfood example; (c) accept the LOC convention for examples — rejected per audit medium severity. | dogfood-cdp-telegram skill still works end-to-end (test plan covers regression). ADR draft at `architecture-output/adr-suggestions/0005-split-or-accept-telegram-pro-god-file.md`. Establishes the example LOC threshold pattern for telegram-pro siblings (gateway-sms/whatsapp/etc smaller analogs). |
| D436 | Split `internal/runtime/` god folder (67 files / 9385 LOC) into 4 sub-folders preserving LocalAgent as central façade (per ADR D110-D114 fork-agent home AND D304-D329 storage primitives): `runtime/context/` (8 files — context-aggregator, context-discovery, context-frontmatter, context-import-resolver, context-loaders, context-manager, context-mdc-parser, context-walker), `runtime/registry/` (4 files — agent-registry, agent-registry-store, agent-factory-registry, agent-session-store), `runtime/fixtures/` (5 files — fixture-events, fixture-responder, fixture-run-base, fixture-scripts, fixture-types), `runtime/plugins/` (3 files — plugins-installer, plugins-manager helpers — verify against actual file list). LocalAgent, CloudAgent, fork-agent, async-local-storage stay at runtime/ root. | Per `rules/architecture.md § 5` (Folder vs package layout), package-by-feature wins for cohesion. Current god folder mixes 9 sub-domains by filename prefix — Phase 2 audit confirmed `mixed_concerns`. Each sub-folder remains within heuristic 25-file limit per `cycle-rule-schema.md`. Tests mirror via Vitest convention. Alternatives: (a) split into entirely new packages — rejected, violates `internal/` boundary contract; (b) keep flat with `// section` comments — rejected, doesn't address findability or `cycle-rule-schema.md` heuristic; (c) partial split (only context/) — rejected, leaves other 5 sub-concerns mixed. | ~50 file moves + import-path updates. PUBLIC API unchanged (no exports from runtime/ except via `internal/runtime/index.ts` barrel — which is updated transparently). Mirror tests get mirrored (FO#2 god folder resolves as side-effect). |
| D437 | DOCUMENT `sdk.internal.security` Zone of Pain (D=0.923) via README note + extract one stable interface `SecretRedactor` that the canonical `redactSecrets` function implements. Do NOT refactor security primitives — they belong concrete + stable per ADRs D68-D73. | Per `rules/cycle-rule-schema.md` heuristic-source legend, the Distance 0.3 cutoff is folklore — Martin gave no numeric. Zone of Pain is a real metric (Ca=12, A=0) but security primitives MUST be concrete + stable per ADR D68 (canonical redactSecrets) AND D73 (output-boundaries). Adding one interface (`SecretRedactor`) introduces a tiny abstraction surface (A bump from 0.000 → ~0.05) without touching the implementation. README note documents the trade-off explicitly per `rules/public-copy.md`. Alternatives: (a) full refactor toward interfaces — rejected, violates D68 stability + Inquebrável Rule 9 (don't reinvent); (b) skip the finding entirely — rejected, audit flagged HIGH per heuristic, must be addressed per `rules/cycle-rule-schema.md` § 4 hard caps. | One new interface file (~15 LOC). `redactSecrets` signature unchanged (interface is structural). README note at `packages/sdk/src/internal/security/README.md`. Zone of Pain D drops marginally; finding documented + acknowledged. |
| D438 | Type-only cycles #3 (self), #4 (agent↔handoff), #5 (agent↔run), #6 (conversation↔updates), #7 (3-node agent→run→messages→agent), #10 (active-memory-cache↔active-memory) broken by extracting 5 small type-leaf files: `types/agent-id.ts` (SDKAgent identity brand), `types/agent-prims.ts` (CustomTool + ModelSelection primitives), `types/messages-base.ts` (UserMessage base), `types/model-selection.ts` (ModelSelection refined extract), `memory/active-memory-types.ts` (carrier types). Cycles #1 + #2 already documented per ADR D428 (subscribe ring) — DOCUMENT only. | Per `rules/cycle-rule-schema.md` consensus, all cycles must be 0 — type-only included because `package.json#exports` resolves dts via rollup-dts which fails on type-only cycles (manifest in dts bundle even though JS-erased). Per audit Phase 5: 7 type-only cycles registered LOW but still cycles. 5 small extractions resolve 5 of 7; remaining 2 (#1, #2) are already ADR D428-blessed. Alternatives: (a) leave as-is — rejected, audit critical-gate semantics; (b) merge all type files into one — rejected, breaks SRP per `rules/architecture.md § 3`. | 5 new types-leaf files (~10-30 LOC each). Public type re-exports unchanged via `types/index.ts` barrel. Cycles #3-#7 + #10 close. Cycles #1 + #2 documented in CHANGELOG note pointing to ADR D428. |

## Dependencies

This plan adds 2 new devDeps at the workspace root. No production dependency changes; no new peer deps.

| Package | Ecosystem | Current | Target | Type | Rule 9 justification |
|---|---|---|---|---|---|
| `madge` | npm | (NEW) | `^8.x` (pinned exact via T0.4) | devDep (workspace root) | Industry-standard TS dependency graph + circular detection. ~15k GitHub stars, active maintenance, zero runtime deps. Used by phpstorm IDE, vercel, others. Cycle detection from AST (catches what depcruise+tsconfig-regex misses). Alternatives evaluated: `skott` (faster but newer, less battle-tested), `dpdm` (similar surface), `dependency-cruiser` (already in repo, IS the broken gate). Choosing madge as the SECONDARY gate (not replacement) per ADR D434. |
| `@ls-lint/ls-lint` | npm | (NEW) | `2.3.1` (pinned exact via T0.4) | devDep (workspace root) | Industry-standard filename + folder naming linter. Go binary distribution via npm — **correct package name is `@ls-lint/ls-lint`** (the bare `ls-lint` package is an unrelated legacy livescript tool, must NOT be installed). MIT, zero npm-runtime deps (Go binary is embedded). Single-purpose tool (kebab-case enforcement per project convention). Alternatives evaluated: custom regex script (rejected per Rule 9), eslint plugin (rejected — Biome, not eslint, is the lint stack here). |

No production deps added. No version bumps to existing deps. No removal.

## ADR Index — Header Definitions for Scorer

The table above is the canonical decision record. The headers below define each ADR cited in the plan (required by `plan-confidence` M3 v0.1 scorer).

### D431 — Extract `agent-registry-contract.ts` to break runtime cycle #8

See the ADRs table above (row D431) for full Decision / Rationale / Consequences.

### D432 — Define `ConversationStorage` port to break CRITICAL runtime↔persistence cycle #9

See the ADRs table above (row D432) for full record.

### D433 — Extract `index-manager-contract.ts` to break HIGH memory cluster cycles #11/#12/#13

See the ADRs table above (row D433) for full record.

### D434 — Restore depcruise CI gate (tsconfig fix) + add madge as secondary gate

See the ADRs table above (row D434) for full record.

### D435 — Split `examples/telegram-pro/src/index.ts` into 7-file module

See the ADRs table above (row D435) for full record.

### D436 — Split `internal/runtime/` god folder into 4 sub-folders

See the ADRs table above (row D436) for full record.

### D437 — DOCUMENT `sdk.internal.security` Zone of Pain + `SecretRedactor` interface

See the ADRs table above (row D437) for full record.

### D438 — Extract type-leaf files to break LOW type-only cycles #3/#4/#5/#6/#7/#10

See the ADRs table above (row D438) for full record.

### D22 (external reference)

Cross-reference only. See `.claude/knowledge-base/adrs/D22-agent-getorcreate-semantics.md`. Cited in this plan: T1.1 static-factory routing audit (EC-4 absorption).

### D25 (external reference)

See `.claude/knowledge-base/adrs/D25-agent-builder-api-shape.md`. Cited: T1.1 Agent.builder factory consideration.

### D26 (external reference)

See `.claude/knowledge-base/adrs/D26-helpers-cloud-parity.md`. Cited: T1.1 single-source validateAgentOptions routing.

### D34 (external reference)

See `.claude/knowledge-base/adrs/D34-telemetry-otel-privacy-default.md`. Cited: T8.1 structured-log on catch via OTel tracer seam.

### D43 (external reference)

See `.claude/knowledge-base/adrs/D43-lance-backend-same-interface.md`. Cited: T2.1 Memory.openIndex({ backend: 'lancedb' }) backward compat.

### D44 (external reference)

See `.claude/knowledge-base/adrs/D44-migration-cli-standalone.md`. Cited: T2.1 LanceDB backend smoke discussion.

### D68 (external reference)

See `.claude/knowledge-base/adrs/D68-redact-canonical-module.md`. Cited: T9.1 SecretRedactor interface wrapping the canonical redactSecrets function (D68 keeps redactSecrets the single source).

### D73 (external reference)

See `.claude/knowledge-base/adrs/D73-redact-output-boundaries-only.md`. Cited: T9.1 output-boundary redaction semantics.

### D110 (external reference)

See `.claude/knowledge-base/adrs/D110-fork-agent-canonical-home.md`. Cited: T5.1 god-folder split preserves fork-agent at runtime/ root.

### D111 (external reference)

See `.claude/knowledge-base/adrs/D111-async-local-storage-whitelist.md`. Cited: T1.1 ALS-bound adapter context propagation; T5.1 async-local-storage stays at runtime/ root.

### D114 (external reference)

See `.claude/knowledge-base/adrs/D114-memory-write-provenance.md`. Cited: T5.1 fork-agent siblings stay at runtime/ root.

### D122 (external reference)

See `.claude/knowledge-base/adrs/D122-run-until-cloud-unsupported.md`. Cited: T1.1 CloudAgent throws UnsupportedRunOperationError convention; T11.1 ISP/SDKAgent documented per this ADR.

### D131 (external reference)

See `.claude/knowledge-base/adrs/D131-credential-pool-fork-inheritance.md`. Cited: T1.1 fork-agent ALS-bound storage inheritance test (EC-13).

### D141 (external reference)

See `.claude/knowledge-base/adrs/D141-memory-adapter-interface.md`. Cited: T1.1 MemoryAdapter interface pattern (DIP boundary template for ConversationStorage port).

### D202 (external reference)

See `.claude/knowledge-base/adrs/D202-eval-static-class.md`. Cited: T1.1 static factory pattern (Eval.create) as reference for default-param routing.

### D249 (external reference)

See `.claude/knowledge-base/adrs/D249-cache-class-factory-asplugin.md`. Cited: T11.2 CacheStore interface trade-off (PV#11).

### D266 (external reference)

See `.claude/knowledge-base/adrs/D266-skip-cache-when-tool-use.md`. Cited: T11.2 CacheStore interface family rationale.

### D304 (external reference)

See `.claude/knowledge-base/adrs/D304-*.md` (storage primitives — exact filename varies). Cited: T1.1 storage primitives reused; T5.1 LocalAgent central façade per D304-D329 family.

### D329 (external reference)

See `.claude/knowledge-base/adrs/D329-*.md`. Cited: T5.1 storage primitive family endpoint (LocalAgent stays central per D304-D329).

### D428 (external reference)

See `.claude/knowledge-base/adrs/D428-sub-path-only.md`. Cited: T4.1 + T11.1 — cycles #1, #2 remain documented per D428's subscribe-at-sub-path rationale; cannot be broken without revoking D428.

## Dependency Graph

```
Phase 0 (depcruise+madge gate restore — D434)
   │  blocks everything: once restored, regressions caught immediately
   │
   ├──▶ Phase 1 (CRITICAL cycle #9 — D432 ConversationStorage port)        ─┐
   ├──▶ Phase 2 (HIGH memory cluster cycles #11/#12/#13 — D433)            ─┤
   ├──▶ Phase 3 (HIGH cycle #8 — D431 agent-registry contract)             ─┤
   ├──▶ Phase 4 (LOW type cycles #3/#4/#5/#6/#7/#10 — D438)                ─┤
   ├──▶ Phase 6 (Telegram-pro god file split — D435)                       ─┤ all parallel-safe
   ├──▶ Phase 7 (ls-lint kebab-case + rename 4 outliers)                   ─┤
   ├──▶ Phase 8 (silent-catch elimination — PV#6 PV#7)                     ─┤
   ├──▶ Phase 9 (Zone of Pain doc + SecretRedactor interface — D437)       ─┤
   └──▶ Phase 10 (structure cleanups: FO#3 memory/, FO#4 gateway/,         ─┤
                  FO#6 providers/ rename, PV#2 dispatchSingleCall split)   ─┤
                                                                            │
       Phase 5 (god folder split — D436)  must wait for Phase 1+2+3 done  ◀─┘
       │  rationale: moving runtime/ files while cycle refactors land
       │  conflicts; serialize after cycles closed
       │
       ▼
   Phase 11 (DOCUMENT D428 type cycles + ISP/SDKAgent ADR D122 note)
       │
       ▼
   Final Phase: Integration Validation (re-run audit + zero-cycles test)
```

Phases 1, 2, 3, 4, 6, 7, 8, 9, 10 run in **parallel** (independent file paths). Phase 5 must wait for 1/2/3 to land (otherwise runtime file moves race with cycle refactors). Phase 11 is documentation-only and can run anytime after Phase 0.

---

## Phase 0: Restore depcruise CI gate + add madge — warn → error cutover

**Objective:** Make the cycle-detection CI gate functional so every subsequent phase's work is validated against a working baseline. Cutover via warn-only → error to avoid blocking every PR during the transition window (EC-1 absorbed).

### T0.1 — Fix `.dependency-cruiser.cjs` tsconfig resolution + add madge as secondary gate (warn-only)

#### Objective
Repair the silent tsconfig parse failure in `.dependency-cruiser.cjs` AND add `npx madge --circular packages/sdk/src --exit-code-on-circular` to `pnpm -w run validate`. After this task, depcruise + madge agree (both find 13 cycles RIGHT NOW; both will find 0 after Phases 1-5).

#### Evidence
- `architecture-output/final_report.md § Executive summary` lines 23-34: "the project's own CI architectural gate is silently broken. `.dependency-cruiser.cjs` declares `no-circular` as `severity: error`, runs in CI, reports `0 cycles` — and is wrong. `madge --circular` finds 13 actual cycles."
- `architecture-output/adr-suggestions/0004-fix-depcruise-tsconfig-gate.md` (full ADR draft).
- Phase 5 cartographer report (already in audit DB): tool_run rows showing depcruise exit=23 (errors but all `no-orphans`, 0 cycle errors) while madge captures 13.

#### Files to edit
```
.dependency-cruiser.cjs — fix tsconfig path resolution (NEW require.resolve helper)
package.json — add "validate:cycles": "madge --circular --extensions ts,tsx packages/sdk/src --exit-code-on-circular" script + wire into validate pipeline
tests/architecture/cycle-gate-parity.test.ts (NEW) — assert depcruise + madge report identical cycle count
.changeset/arch-fixes-2026-06-06-cycle-gate.md (NEW) — patch changeset documenting CI gate restore
```

#### Deep file dependency analysis
- `.dependency-cruiser.cjs` — currently loaded by `depcruise --validate <config> <target>`. The `tsConfig.fileName` field uses a relative path that resolves against `process.cwd()` (the workspace root when invoked from pnpm scripts, but undefined from subprocess contexts). After change: `tsConfig.fileName: require.resolve('./tsconfig.base.json', { paths: [__dirname] })`. Downstream: every depcruise invocation (CI + local validate + IDE plugin) gets correct module resolution.
- `package.json` (workspace root) — adds `validate:cycles` and updates `validate` to chain `... && pnpm run validate:cycles`. Downstream: `pnpm -w run validate` becomes the single gate.
- `tests/architecture/cycle-gate-parity.test.ts` (NEW) — runs both tools via child_process, parses cycle counts, asserts equal. Downstream: prevents future drift between the two gates.

#### Deep Dives
- **Why both gates instead of madge-only:** depcruise also enforces `no-orphans`, `types-dont-import-runtime`, `src-must-not-import-tests`, `no-imports-from-referencia` (verified in current `.dependency-cruiser.cjs`). Replacing depcruise loses these. Pair them: madge for cycles, depcruise for the rest. If they disagree on cycles, CI fails.
- **Why pre-existing depcruise rules pass even with broken tsconfig:** the orphan-rule scans paths via the same regex fallback. Forbidden-rules that check paths (like `types-dont-import-runtime`) work because they only need the source `from`/`to` patterns, not transitive resolution.
- **Invariant:** after fix, `pnpm -w run validate` exits 0 ONLY IF both gates pass. Before this PR is merged, the gates will exit non-zero (because cycles still exist). The integration validation runs the full chain — `pnpm -w run validate` must be green by Final Phase.
- **Edge case:** depcruise must still emit `no-orphans` errors unrelated to this plan. The unrelated `no-orphans` hits are out of T0.1 scope; document in PR description per stop hook policy.

#### Tasks
1. Write RED test `tests/architecture/cycle-gate-parity.test.ts` asserting madge and depcruise return identical cycle count.
2. Update `.dependency-cruiser.cjs` to use `require.resolve(path.resolve(__dirname, './tsconfig.base.json'))` for `tsConfig.fileName`, wrapped in try/catch fail-fast per EC-2: `try { tsConfig.fileName = require.resolve(path.resolve(__dirname, './tsconfig.base.json')); } catch (e) { throw new Error('FATAL: tsconfig.base.json not resolvable from .dependency-cruiser.cjs context. ' + e.message); }`. Reverting to silent regex fallback is forbidden — fail-claro per Inquebrável Rule 8.
2a. In `.dependency-cruiser.cjs`, set `no-circular.severity = 'warn'` AND for the madge wrapper add `--no-exit-code-on-circular` (T0.1 ships warn-only per EC-1). T0.3 below flips both back to error.
3. Run `npx depcruise --validate .dependency-cruiser.cjs packages/sdk/src` locally and confirm exit code is non-zero with cycle count = 13 (matching madge baseline).
4. Add `validate:cycles` script to root `package.json`.
5. Wire `validate:cycles` into the `validate` pipeline.
6. Add `madge` as workspace devDep (root `package.json`).
7. Run `pnpm -w run validate` — expected: non-zero exit (cycles still present). The exit semantics confirm the gate is wired.
8. Add changeset patch entry documenting the CI restore.

#### TDD
```
RED:    cycle-gate-parity.test.ts > both tools agree on cycle count — will PASS RED with current 13/13 mismatch (both 13 = parity), GREEN-state guarantees parity at 0/0
RED:    cycle-gate-parity.test.ts > depcruise resolves tsConfig and reports >0 cycles — will FAIL today (depcruise reports 0 cycles silently) because tsconfig parse fails
GREEN:  Apply tsConfig path fix in .dependency-cruiser.cjs; depcruise now reports 13 cycles matching madge
REFACTOR: None expected
VERIFY: pnpm -w run vitest tests/architecture/cycle-gate-parity.test.ts
```

#### Acceptance Criteria
- [ ] `npx depcruise --validate .dependency-cruiser.cjs packages/sdk/src` exit code non-zero AND reports cycle count = 13 (matches madge baseline). After Phases 1-5 land, both report 0.
- [ ] `pnpm -w run validate` exits non-zero today because of unresolved cycles.
- [ ] `tests/architecture/cycle-gate-parity.test.ts` GREEN.
- [ ] `madge` listed as devDep at workspace root.
- [ ] `.changeset/` patch entry added.
- [ ] Pass: complexity — every changed config file ≤ 10 cyclomatic complexity.
- [ ] Pass: coverage — `pnpm -w run vitest --coverage tests/architecture/` ≥ 90% on changed file.
- [ ] Pass: lint — `pnpm -w run lint` zero warnings on changed files.
- [ ] Pass: size — `.dependency-cruiser.cjs` ≤ 500 LOC after change (currently ~140).

#### DoD
- [ ] T0.1 tasks completed and committed.
- [ ] `pnpm -w run vitest tests/architecture/` green.
- [ ] `pnpm -w run typecheck` zero errors.
- [ ] `pnpm -w run lint` zero warnings on changed files.
- [ ] File-size budget respected.

### T0.2 — Audit + resolve post-fix `no-orphans` violations (EC-3)

#### Objective
After T0.1 lands, depcruise resolves tsconfig correctly and must discover orphan modules previously hidden by regex fallback. Snapshot them, audit each, resolve (delete dead code OR extend `pathNot` allowlist), commit separately so blame is clean.

#### Files to edit
```
.dependency-cruiser.cjs — extend pathNot patterns for legitimate orphans (e.g., test fixtures, build scripts)
packages/sdk/src/** — delete any genuine dead exports surfaced
.changeset/arch-fixes-2026-06-06-orphans.md (NEW)
docs/audit/no-orphans-snapshot-2026-06-06.md (NEW) — audit trail of every orphan + resolution decision
```

#### Tasks
1. `npx depcruise --validate .dependency-cruiser.cjs packages/sdk/src --output-type err-long > /tmp/orphans-snapshot.txt`. Commit snapshot to `docs/audit/no-orphans-snapshot-2026-06-06.md`.
2. Per orphan: classify (dead code OR legitimate). Dead → delete. Legitimate → extend `pathNot` with justification comment.
3. Re-run depcruise. Exit 0 on `no-orphans` rule.
4. CHANGELOG entry.

#### Acceptance Criteria
- [ ] `npx depcruise --validate ...` reports zero `no-orphans` errors.
- [ ] Every `pathNot` extension has an inline comment citing reason.
- [ ] `docs/audit/no-orphans-snapshot-2026-06-06.md` lists every original violation + resolution.

### T0.3 — Flip `no-circular` from warn to error (cutover after Phases 1-5 complete)

#### Objective
After Phases 1, 2, 3, 4, 5 (all cycle breaks) land on develop, flip the gate from warn to error. From this commit forward, any cycle introduced fails CI.

#### Pre-condition (blocking)
`git log develop --oneline --grep="D43[1234]\|D438\|D436"` returns ≥ 6 commits AND `npx madge --circular packages/sdk/src` exit 0 (or D428 only) AND `npx depcruise --validate ...` exit 0.

#### Files to edit
```
.dependency-cruiser.cjs — flip no-circular.severity 'warn' → 'error'; remove --no-exit-code-on-circular from madge wrapper
.changeset/arch-fixes-2026-06-06-cycle-gate-strict.md (NEW)
packages/sdk/CHANGELOG.md — [Unreleased] entry noting cutover
```

#### Acceptance Criteria
- [ ] `pnpm -w run validate` exit 0 after flip (proves cycles ARE 0).
- [ ] Re-test by introducing a deliberate cycle in a throwaway branch: validate exit non-zero. Revert.

### T0.4 — Pin madge version + record CI-tool versions

#### Objective
Avoid silent toolchain drift: pin `madge` and `@ls-lint/ls-lint` (Phase 7 — correct package name; NOT `ls-lint` which is an unrelated legacy livescript package) to exact versions in `package.json` devDeps; document the rationale.

#### Files to edit
```
package.json — devDeps madge@8.x (verify via `npm view madge versions --json | tail`) pinned exactly; ls-lint@2.x same
docs/audit/ci-tool-versions-2026-06-06.md (NEW) — list of versions + rationale for pin choice
```

---

## Phase 1: Break CRITICAL cycle #9 — ConversationStorage port (D432)

**Objective:** Close the layer-crossing runtime↔persistence cycle by introducing a port at the boundary, restoring the layered-architecture contract in `rules/architecture.md § 1`.

### T1.1 — Extract `ConversationStorage` port + adapter wiring

#### Objective
Define `internal/runtime/conversation-storage-port.ts` interface, refactor `internal/runtime/agent-session.ts` to import the port only, move the concrete FS adapter import to the composition root (`internal/runtime/local-agent.ts` constructor), and confirm cycle #9 closes.

#### Evidence
- `architecture-output/final_report.md § Cycle report` lines 448 (cycle #9): `runtime/agent-session.ts → persistence/conversation-storage-fs.ts → runtime/agent-session-store.ts → agent-session.ts` CRITICAL length-3 layer-crossing.
- `architecture-output/adr-suggestions/0002-define-conversation-storage-port.md` (full ADR draft).
- Phase 5 cartographer DB row `architectural_findings.id=11` + `=21` (sibling): severity=critical, suggests_adr=1.

#### Files to edit
```
packages/sdk/src/internal/runtime/conversation-storage-port.ts (NEW) — interface { append(session, message), load(session), delete(session) } per ADR draft 0002
packages/sdk/src/internal/runtime/agent-session.ts — replace direct import of conversation-storage-fs with port import
packages/sdk/src/internal/runtime/local-agent.ts — accept ConversationStorage in constructor (default to FS adapter, per backward compat)
packages/sdk/src/internal/persistence/conversation-storage-fs.ts — declare `implements ConversationStorage` (structural in TS but documents intent)
packages/sdk/src/internal/runtime/agent-session-store.ts — verify whether it actually needs the persistence import or if it's transitively pulled (audit chain says it's a member of cycle #9 — confirm during deep analysis)
packages/sdk/tests/architecture/cycle-9-closed.test.ts (NEW) — RED test asserting madge reports no cycle containing both `runtime/agent-session.ts` AND `persistence/conversation-storage-fs.ts`
packages/sdk/tests/internal/runtime/conversation-storage-port.test.ts (NEW) — unit tests for the port contract with an in-memory test adapter
packages/sdk/tests/internal/runtime/local-agent.test.ts — update constructor call sites to pass the FS adapter explicitly OR rely on default
packages/sdk/CHANGELOG.md — `[Unreleased] § Changed` entry for the internal refactor (no public API change)
```

#### Deep file dependency analysis
- `internal/runtime/conversation-storage-port.ts` (NEW) — leaf types file. Imports nothing from runtime/persistence. Re-exported via `internal/runtime/index.ts` ONLY if needed by tests; otherwise internal-only.
- `internal/runtime/agent-session.ts` — currently does `import { ConversationStorageFS } from '../persistence/conversation-storage-fs'`. After: imports `ConversationStorage` from `./conversation-storage-port`. The runtime side no longer depends on persistence.
- `internal/runtime/local-agent.ts` — adds constructor param `conversationStorage?: ConversationStorage` defaulting to `new ConversationStorageFS(opts)` (DI shape preserved per existing pattern). Composition root binds concrete to port.
- `internal/persistence/conversation-storage-fs.ts` — declares `implements ConversationStorage`. TypeScript structural typing already provides the check; the explicit `implements` is documentation per `rules/architecture.md § 2`.
- `internal/runtime/agent-session-store.ts` — verify in deep analysis: does it import conversation-storage-fs directly OR transitively via agent-session.ts? If direct: refactor to import the port. If transitive: closes automatically when agent-session.ts is fixed.
- Downstream consumers (tests, other internals): `Agent.create()` factory path goes through LocalAgent constructor; backward-compatible because constructor param defaults to FS adapter.

#### Deep Dives
- **Port shape:** mirror the `MemoryAdapter` interface (D141) — a discriminated union of operations or a minimal-method interface, NOT a god interface. ADR draft 0002 lines 30-45 spec: `{ append(SessionId, Message): Promise<void>; load(SessionId): Promise<Message[]>; delete(SessionId): Promise<void> }`.
- **Invariant:** existing call sites in `LocalAgent` continue to work with default FS adapter. Public seam unchanged (`Agent.create({...})` API in `packages/sdk/src/agent.ts` does NOT gain a new option — the FS adapter is the default; only consumers wanting to inject MUST go through an internal path, which they shouldn't per `internal/` boundary).
- **Edge case — fork:** `internal/runtime/fork-agent.ts` (D110-D114) creates child agents with parent state. Verify the fork pipeline doesn't bypass the port. The ALS context (D111, D131) must propagate the port reference, not the concrete adapter.
- **Edge case — Agent.resume:** loading session by agentId goes through the storage layer. After refactor, resume path uses the port via LocalAgent's bound adapter. RED test `Agent.create -> Agent.resume -> assert message history` must continue to GREEN.
- **Edge case — CloudAgent:** `internal/runtime/cloud-agent.ts` shipped via ADR D122 throws `UnsupportedRunOperationError` for runtime ops; verify the new port doesn't accidentally activate a cloud code path.

#### Tasks
1. **EC-5 pre-grep**: `grep -nE "import .* from .*persistence/conversation-storage-fs" packages/sdk/src/internal/runtime/agent-session-store.ts` — if hit, T1.1 ALSO refactors agent-session-store to import the port (else cycle #9 stays open).
2. **EC-4 static-factory audit**: `grep -nE "ConversationStorageFS|conversation-storage-fs" packages/sdk/src/agent.ts packages/sdk/src/internal/runtime/local-agent.ts packages/sdk/src/internal/runtime/agent-factory-registry.ts` — enumerate every static factory (Agent.create, Agent.resume, Agent.get, Agent.getOrCreate, Agent.builder per D22, D25, D26). Centralize a `defaultConversationStorage()` helper in `internal/runtime/conversation-storage-port.ts` so ALL static factories route through the same default.
3. **EC-6 CloudAgent mirror**: `internal/runtime/cloud-agent.ts` constructor accepts the same optional `conversationStorage?` param but ignores it (CloudAgent throws `UnsupportedRunOperationError` for runtime ops per D122 — storage is a runtime op). Add RED test `cloud-agent-construct-with-storage-noop.test.ts` asserting construction succeeds + any attempted write throws the typed error.
4. Write RED `cycle-9-closed.test.ts` (deferred: still RED until refactor lands).
5. Write RED `conversation-storage-port.test.ts` with an in-memory test adapter.
6. Write RED `agent-resume-storage-routing.test.ts` per EC-4: create agent → write history → `Agent.resume(agentId)` → assert history matches (proves static-path routing).
7. Create `internal/runtime/conversation-storage-port.ts` with the interface + `defaultConversationStorage()` helper.
8. Refactor `internal/runtime/agent-session.ts` to import the port only.
9. Refactor `internal/runtime/agent-session-store.ts` per EC-5 finding.
10. Add `implements ConversationStorage` to `internal/persistence/conversation-storage-fs.ts`.
11. Update `internal/runtime/local-agent.ts` constructor to accept the port with `defaultConversationStorage()` default.
12. Update `internal/runtime/cloud-agent.ts` constructor mirror per EC-6.
13. Update every Agent.* static factory in `packages/sdk/src/agent.ts` to route through `defaultConversationStorage()`.
14. Update test call sites if any pass a custom storage; verify default works.
15. Run `npx madge --circular packages/sdk/src --json | jq '.[] | select(.[] | contains("conversation-storage"))'` — expected: empty.
16. Run `pnpm -w run typecheck` — zero errors.
17. Run `pnpm -w run vitest packages/sdk/tests/internal/runtime/conversation-storage-port.test.ts tests/architecture/cycle-9-closed.test.ts packages/sdk/tests/agent.test.ts` — GREEN.
18. Update `packages/sdk/CHANGELOG.md` `[Unreleased] § Changed` entry citing EC-4/EC-5/EC-6 absorption.

#### TDD
```
RED:    conversation-storage-port.test.ts > in-memory adapter satisfies port — fails until port file exists
RED:    cycle-9-closed.test.ts > madge --circular does not report any cycle containing agent-session.ts + conversation-storage-fs.ts — fails today
GREEN:  Implement port + refactor agent-session.ts imports + bind in LocalAgent ctor
REFACTOR: None expected (mechanical refactor; the port file is types only)
VERIFY: pnpm -w run vitest packages/sdk/tests/internal/runtime/conversation-storage-port.test.ts packages/sdk/tests/architecture/cycle-9-closed.test.ts
```

#### Acceptance Criteria
- [ ] `internal/runtime/conversation-storage-port.ts` exists with ≤ 50 LOC.
- [ ] `internal/runtime/agent-session.ts` no longer imports anything from `internal/persistence/`.
- [ ] `internal/persistence/conversation-storage-fs.ts` declares `implements ConversationStorage`.
- [ ] `madge --circular packages/sdk/src` does not report cycle #9 path.
- [ ] `Agent.create()` / `Agent.resume()` work end-to-end (existing tests stay GREEN).
- [ ] Pass: complexity — every changed file ≤ 10 cyclomatic complexity per function.
- [ ] Pass: coverage — port file + adapter ≥ 90%.
- [ ] Pass: lint — zero warnings.
- [ ] Pass: size — every changed file ≤ 500 LOC.

#### DoD
- [ ] T1.1 tasks completed and committed atomically.
- [ ] `pnpm -w run vitest` green across affected paths.
- [ ] `pnpm -w run typecheck` zero errors.
- [ ] `pnpm -w run lint` zero warnings on changed files.
- [ ] `packages/sdk/CHANGELOG.md` [Unreleased] entry added.

---

## Phase 2: Break HIGH memory cluster — index-manager contract (D433)

**Objective:** Close cycles #11 + #12 + #13 simultaneously via a single ~30 LOC types-only extraction.

### T2.1 — Extract `internal/memory/index-manager-contract.ts`

#### Objective
Identify the shared types used in the cycle pivot (`index-manager.ts` ↔ `index-manager-dispatch.ts` AND through `lance-memory-adapter.ts` AND `memory-index.ts`), move them to a leaf types-only file, and update imports across the 4 cluster files.

#### Evidence
- `architecture-output/final_report.md § Cycle report` rows 11, 12, 13: HIGH runtime cycles pivoting on `memory/index-manager.ts`.
- `architecture-output/adr-suggestions/0003-extract-index-manager-contract.md` (full ADR draft).
- Phase 5 cartographer note: "Cycles #11/#12/#13 ALL pivot on `index-manager.ts` as self-referencing contract hub. Single ~30 LOC extraction of `internal/memory/index-manager-contract.ts` (types only) breaks all three."

#### Files to edit
```
packages/sdk/src/internal/memory/index-manager-contract.ts (NEW) — types: IndexManagerOptions, IndexBackend interface, DispatchPayload union, etc. (~30 LOC, leaf — imports only Zod or types from peers)
packages/sdk/src/internal/memory/index-manager.ts — replace shared-type imports with contract imports; export only runtime functions
packages/sdk/src/internal/memory/index-manager-dispatch.ts — import contract instead of index-manager
packages/sdk/src/internal/memory/lance-memory-adapter.ts — import contract instead of index-manager + memory-index
packages/sdk/src/internal/memory/memory-index.ts — verify; refactor if needed
packages/sdk/tests/architecture/cycle-11-12-13-closed.test.ts (NEW) — RED test asserting madge reports no cycle within memory/index-* paths
packages/sdk/tests/internal/memory/index-manager-contract.test.ts (NEW) — unit-test the contract types via in-memory backend stub
packages/sdk/CHANGELOG.md — entry
```

#### Deep file dependency analysis
- `internal/memory/index-manager-contract.ts` (NEW) — leaf-types only file. Imports Zod (peer dep) for schema-typed contracts if applicable; otherwise pure types. Re-exports zero of these to public API.
- `internal/memory/index-manager.ts` (currently 473 LOC) — currently both defines AND imports the types that other modules need. After refactor: imports types from contract, keeps runtime functions only. LOC drops ~30.
- `internal/memory/index-manager-dispatch.ts` — currently imports `index-manager.ts` to get types AND runtime. After refactor: imports types from contract; runtime imports stay (one-direction only).
- `internal/memory/lance-memory-adapter.ts` — currently imports `index-manager.ts` for types AND `memory-index.ts` for types. After refactor: imports both from contract.
- `internal/memory/memory-index.ts` — verify whether it's a member of cycle #13's chain via direct grep. If yes, refactor to import contract.
- Downstream: `Memory.openIndex()` public API (D43, D44) unaffected — the changes are inside `internal/memory/`.

#### Deep Dives
- **Contract content:** the audit ADR draft 0003 enumerates: `IndexBackend` interface (the strategy contract from D43 LanceDB backend ADR), `IndexManagerOptions` config shape, `DispatchPayload` discriminated union (the routing layer), `BackendKind` enum. ~30 LOC total.
- **Why types-only:** if the contract file contained runtime, it must itself enter a cycle. Leaf-types file with no runtime imports is the safest break per Bob Martin Clean Architecture port-and-adapter.
- **Invariant:** `Memory.openIndex({ backend: 'sqlite' })` and `({ backend: 'lancedb' })` both work end-to-end. The LanceDB backend (D43 shipped 2026-05-23) is the canonical second backend and the most likely to break — RED-GREEN integration test against a real `lance` package required if available, else fixture-mode per `rules/real-llm-validation.md`.
- **Edge case — circular type re-export:** if `index-manager.ts` still re-exports types from the contract for backward compatibility (`export type * from './index-manager-contract'`), that re-export must NOT create a transitive cycle in rollup-dts. Verify via `npm run build` and inspect the emitted `dist/internal/memory/index-manager.d.ts`.

#### Tasks
1. Write RED `cycle-11-12-13-closed.test.ts` asserting madge does not report cycles containing `memory/index-manager.ts` ↔ `index-manager-dispatch.ts` AND no 3-node ring containing `lance-memory-adapter.ts` AND no 4-node ring through `memory-index.ts`.
2. Write RED `index-manager-contract.test.ts` covering the contract types via in-memory adapter stub.
3. Create `internal/memory/index-manager-contract.ts` with the identified types.
4. Refactor imports in `index-manager.ts`, `index-manager-dispatch.ts`, `lance-memory-adapter.ts`, `memory-index.ts`.
5. Run `npx madge --circular packages/sdk/src` — expected: cycles #11, #12, #13 absent.
6. Run `pnpm -w run typecheck` + `vitest` — GREEN.
7. Update CHANGELOG.

#### TDD
```
RED:    cycle-11-12-13-closed.test.ts > madge reports no memory/index-manager cycles — fails today
RED:    index-manager-contract.test.ts > in-memory IndexBackend implements contract correctly — fails until contract exists
GREEN:  Implement contract + update imports across 4 files
REFACTOR: None expected
VERIFY: pnpm -w run vitest tests/architecture/cycle-11-12-13-closed.test.ts tests/internal/memory/
```

#### Acceptance Criteria
- [ ] `internal/memory/index-manager-contract.ts` exists ≤ 50 LOC, leaf-types only.
- [ ] 4 cluster files import the contract instead of each other for types.
- [ ] Cycles #11, #12, #13 absent from `madge --circular` output.
- [ ] `Memory.openIndex()` smoke test passes for both sqlite + (if available) lance backends.
- [ ] Pass: complexity, coverage, lint, size (≤ 500 LOC each).

#### DoD
- [ ] T2.1 atomic commit.
- [ ] `pnpm -w run validate` shows progress (cycles dropping from 13 → 10 after this phase).
- [ ] CHANGELOG entry added.

---

## Phase 3: Break HIGH cycle #8 — agent-registry contract (D431)

**Objective:** Close the 2-node runtime cycle `agent-registry.ts ↔ agent-registry-store.ts`.

### T3.1 — Extract `internal/runtime/agent-registry-contract.ts`

#### Objective
Identify the ~30 LOC of shared types, move them to a leaf contract file, and confirm cycle #8 closes.

#### Evidence
- `architecture-output/final_report.md § Cycle report` row 8: HIGH 2-node `agent-registry.ts ↔ agent-registry-store.ts`.
- `architecture-output/adr-suggestions/0001-extract-agent-registry-contract.md` (full ADR draft).
- File sizes: `agent-registry.ts` 194 LOC, `agent-registry-store.ts` ~150 LOC (estimate).

#### Files to edit
```
packages/sdk/src/internal/runtime/agent-registry-contract.ts (NEW) — types: AgentId, AgentRecord, AgentRegistryEntry (~30 LOC, leaf)
packages/sdk/src/internal/runtime/agent-registry.ts — replace shared-type imports with contract imports
packages/sdk/src/internal/runtime/agent-registry-store.ts — same
packages/sdk/tests/architecture/cycle-8-closed.test.ts (NEW) — RED test
packages/sdk/CHANGELOG.md — entry
```

#### Deep file dependency analysis + Deep Dives + Tasks
(Mirror Phase 2 pattern with smaller scope. Refer to ADR draft 0001 for exact contract content.)

#### TDD
```
RED:    cycle-8-closed.test.ts > madge reports no cycle agent-registry.ts ↔ agent-registry-store.ts
GREEN:  Implement contract + update imports in 2 files
REFACTOR: None expected
VERIFY: pnpm -w run vitest tests/architecture/cycle-8-closed.test.ts
```

#### Acceptance Criteria + DoD
(Mirror T2.1.)

---

## Phase 4: Break LOW type-only cycles (D438)

**Objective:** Close cycles #3, #4, #5, #6, #7, #10 via 5 small type-leaf extractions. Cycles #1, #2 documented per ADR D428.

### T4.1 — Extract type-leaf files

#### Objective
Move shared types out of the cyclic ring into leaf files imported by all participants.

#### Evidence
- `architecture-output/final_report.md § Cycle report` rows 3-7, 10 with each suggested break.

#### Files to edit
```
packages/sdk/src/types/agent-id.ts (NEW) — SDKAgent identity brand
packages/sdk/src/types/agent-prims.ts (NEW) — CustomTool + ModelSelection primitives
packages/sdk/src/types/messages-base.ts (NEW) — UserMessage base type
packages/sdk/src/types/model-selection.ts (NEW) — ModelSelection refined extract (if distinct from agent-prims)
packages/sdk/src/internal/memory/active-memory-types.ts (NEW) — carrier types for active-memory cache
packages/sdk/src/types/{agent,run,handoff,conversation,updates,messages}.ts — replace cyclic imports with leaf imports
packages/sdk/src/types/index.ts — EC-7 ABSORBED: explicitly add `export type * from './agent-id'`, `'./agent-prims'`, `'./messages-base'`, `'./model-selection'`. Enumerate every public type that consumers can `import type { X } from '@theokit/sdk'`; verify ZERO type removal.
packages/sdk/src/internal/memory/active-memory.ts + active-memory-cache.ts — update imports
packages/sdk/tests/architecture/type-cycles-closed.test.ts (NEW) — RED test asserting all 5 type-only cycles absent
packages/sdk/tests/architecture/public-type-surface.test.ts (NEW per EC-7) — snapshot of every public exported type from `@theokit/sdk`; assert ZERO removal after refactor. Use `tsc --listFiles` or `api-extractor` to enumerate.
packages/sdk/CHANGELOG.md — entry noting cycles #1+#2 remain per ADR D428 (subscribe ring documented)
```

#### Deep file dependency analysis
- Each new types file is a pure leaf — re-exported via `types/index.ts` barrel for backward compat on public type exports.
- Public type API surface (what consumers import via `@theokit/sdk`) unchanged.
- Audit cycle break expected: 7 type-only → 2 type-only (the two D428-acknowledged ones).

#### Deep Dives
- **Cycle #3 (self) — EC-8 ABSORBED:** `types/agent.ts` self-references. PRE-WORK MANDATORY: `grep -nE "from.*'\\./agent'|from.*'\\./types/agent'" packages/sdk/src/types/agent.ts` to find the cause. If it's a `export type * from './agent'` re-export ring (common pattern), do NOT naively collapse — restructure: move the re-exported types to a leaf file and re-export from `types/index.ts` barrel only (not from `agent.ts` itself). RED test: madge no longer reports cycle #3 AND `import { SDKAgent } from '@theokit/sdk'` still resolves in `public-type-surface.test.ts`.
- **Cycle #1, #2:** ADR D428 documents the rollup-dts cycle keeping `subscribe` at sub-path. DOCUMENT in CHANGELOG; do NOT attempt to break (would regress D428).

#### TDD
```
RED:    type-cycles-closed.test.ts > madge reports only cycles #1 + #2 (D428-acknowledged) — fails today (7 cycles in types)
GREEN:  Create 5 leaf files + refactor imports
REFACTOR: None expected
VERIFY: pnpm -w run vitest tests/architecture/type-cycles-closed.test.ts
```

#### Acceptance Criteria
- [ ] 5 new type-leaf files exist.
- [ ] `madge --circular packages/sdk/src` reports exactly 2 remaining cycles (D428 family).
- [ ] Public type exports unchanged (`types/index.ts` barrel preserved).
- [ ] Pass: complexity, coverage, lint, size.

#### DoD
- [ ] T4.1 atomic commit.
- [ ] CHANGELOG entry citing ADR D428.

---

## Phase 5: Split `internal/runtime/` god folder (D436)

**Objective:** Eliminate the FO#1 god folder (67 files / 9385 LOC) by promoting 4 sub-folders. Depends on Phases 1+2+3 being merged (avoids file-move conflicts with cycle refactors).

### T5.1 — Promote `runtime/{context,registry,fixtures,plugins}` sub-folders

#### Objective
Move files into cohesive sub-folders matching the 9 prefixes audit Phase 2 identified, preserving LocalAgent/CloudAgent/fork-agent/async-local-storage at runtime/ root.

#### Evidence
- `architecture-output/final_report.md § Findings by dimension` FO#1: 67 files, 9385 LOC. Severity HIGH (heuristic — 25-file threshold per `cycle-rule-schema.md`).
- Phase 2 cartographer recommendation: split into `runtime/{context,registry,fixtures,plugins}`.

#### Files to edit
```
packages/sdk/src/internal/runtime/context/ (NEW dir) — 8 context-*.ts files moved
packages/sdk/src/internal/runtime/registry/ (NEW dir) — 4 *-registry*.ts files moved
packages/sdk/src/internal/runtime/fixtures/ (NEW dir) — 5 fixture-*.ts files moved
packages/sdk/src/internal/runtime/plugins/ (NEW dir) — 3 plugins-related files moved (verify list)
packages/sdk/src/internal/runtime/index.ts — update internal barrel
packages/sdk/src/internal/runtime/*.ts — update relative imports (mechanical sed pattern)
packages/sdk/tests/internal/runtime/{context,registry,fixtures,plugins}/ (NEW dirs) — mirror test moves (resolves FO#2)
packages/sdk/CHANGELOG.md — entry
```

#### Deep file dependency analysis
- File moves are mechanical; relative imports change from `./<file>` to `./<subdir>/<file>` for callers and `../<sibling>` for moved files calling root-level peers.
- `internal/runtime/index.ts` barrel can hide the substructure from internal consumers — `LocalAgent.ts` continues to import `agent-registry` via the barrel.
- No public API change — `internal/` is non-exported per `internal_convention_respected` (audit positive finding).

#### Deep Dives
- **Order matters:** moving files while Phase 1/2/3 cycle refactors are unmerged risks merge conflicts (git rename detection). The race-on-rename risk is why Phase 5 BLOCKS on 1/2/3.
- **Imports tooling:** use `tsc --noEmit` + a sed pass to mass-rewrite. Verify with `npx madge --circular` after each sub-folder move that no NEW cycles emerge.
- **Mirror tests:** `tests/internal/runtime/` god folder (FO#2 LOW) resolves as side-effect when test files mirror the source moves.

#### TDD
```
RED:    folder-budget.test.ts (NEW) — `internal/runtime/` direct-file count ≤ 25 — fails today (67 files)
RED:    no-new-cycles.test.ts — madge reports no new cycles introduced by the move — must stay GREEN throughout
GREEN:  Mass move files + update imports
REFACTOR: None expected
VERIFY: pnpm -w run vitest packages/sdk/tests/ && pnpm -w run typecheck
```

#### Acceptance Criteria
- [ ] **EC-9 (pre-condition, BLOCKING):** `git log develop --oneline --grep="D43[123]" | wc -l` returns ≥ 3 commits (Phases 1+2+3 ALL merged to develop) BEFORE Phase 5 work begins. Otherwise the PR will conflict at merge time. The Phase-1+2+3-merged precondition is a HARD gate, not advisory.
- [ ] **EC-10 (commit hygiene):** PR contains exactly 2 commits — commit A = pure `git mv` for all files (zero content change; preserves git rename detection at default 50% threshold); commit B = update `internal/runtime/index.ts` barrel + relative imports in moved files + their callers. Rebase-squash is FORBIDDEN for this PR; the 2-commit split must reach develop intact. Documented in PR description.
- [ ] `find packages/sdk/src/internal/runtime -maxdepth 1 -type f | wc -l` ≤ 25.
- [ ] All `internal/runtime/index.ts` re-exports preserved (internal barrel unchanged in shape).
- [ ] `madge --circular packages/sdk/src` exit 0 (or only D428 cycles).
- [ ] Tests pass after move.
- [ ] Pass: complexity, coverage, lint, size.

#### DoD
- [ ] T5.1 lands as 2-commit PR per EC-10 (NOT single atomic commit — git rename detection requires the split).
- [ ] CHANGELOG entry citing EC-9/EC-10 absorption.

---

## Phase 6: Split `telegram-pro` god file (D435)

**Objective:** Split `examples/telegram-pro/src/index.ts` (2317 LOC) into a 7-file module.

### T6.1 — Module split + dogfood regression test

#### Objective
Decompose into `index.ts` (≤ 100 LOC bootstrap) + `commands/{system,memory,workflow,canvas,voice,debug}.ts` (~350 LOC each), preserving end-to-end dogfood behavior.

#### Evidence
- `architecture-output/final_report.md § Findings by dimension` PV#1 MEDIUM: 2317 LOC, 34 commands, 10 handlers.
- `architecture-output/adr-suggestions/0005-split-or-accept-telegram-pro-god-file.md`.
- Project has `dogfood-cdp-telegram` skill (per CLAUDE.md skill list) — regression test for E2E.

#### Files to edit
```
examples/telegram-pro/src/index.ts — split: keep bootstrap ≤ 100 LOC
examples/telegram-pro/src/commands/system.ts (NEW) — /start /help /history /clear /personality
examples/telegram-pro/src/commands/memory.ts (NEW) — /memory_* /lance_* /dreaming_*
examples/telegram-pro/src/commands/workflow.ts (NEW) — /workflow /handoffs /run /stream
examples/telegram-pro/src/commands/canvas.ts (NEW) — /canvas /artifact
examples/telegram-pro/src/commands/voice.ts (NEW) — /voice_* (STT/TTS)
examples/telegram-pro/src/commands/debug.ts (NEW) — /debug /skill /trace
examples/telegram-pro/src/commands/index.ts (NEW) — barrel
examples/telegram-pro/CHANGELOG.md (NEW if not present) — entry
```

#### Deep file dependency analysis
- `index.ts` retains: bot init, error boundary, command registration (delegate to sub-files), top-level lifecycle.
- Each `commands/<name>.ts` exports a `register{Name}Commands(bot, deps)` function.
- Shared deps (agent factory, memory adapter, etc.) injected through the bootstrap.

#### Deep Dives
- **Dogfood regression:** the `/dogfood-cdp-telegram` skill runs E2E against real Telegram Web via Chrome DevTools Protocol. After split, every existing slash command must produce the same DOM reply. RED-GREEN regression captured by the skill.
- **Edge case — handler closures:** any handler relying on closed-over `index.ts` locals must be passed via injected deps.

#### TDD
```
RED:    telegram-pro-bootstrap.test.ts (NEW) — index.ts ≤ 100 LOC — fails today
RED:    telegram-pro-commands.test.ts (NEW) — registerSystemCommands(...) registers exactly the expected slash-names
GREEN:  Split + wire registrations
REFACTOR: None expected
VERIFY: dogfood-cdp-telegram skill run + pnpm -w run vitest examples/telegram-pro/
```

#### Acceptance Criteria
- [ ] `examples/telegram-pro/src/index.ts` ≤ 500 LOC (target ≤ 100 LOC bootstrap).
- [ ] Each `commands/<name>.ts` ≤ 500 LOC.
- [ ] Dogfood regression PASS for all 34 slash commands + 10 handlers.
- [ ] Pass: complexity, coverage (≥ 80% for examples per relaxed budget), lint, size.

#### DoD
- [ ] T6.1 atomic commit.
- [ ] CHANGELOG entry citing dogfood verification.

---

## Phase 7: Naming/lint discipline — `.ls-lint.yml` + 4 file renames

**Objective:** Close NV#1 + NV#2 by enforcing kebab-case and renaming the 4 underscore-prefixed outliers.

### T7.1 — Ship `.ls-lint.yml` + rename outliers (with dry-run audit per EC-11)

#### Objective
Add `.ls-lint.yml` at repo root, rename 4 underscore-prefixed files, wire into `validate` pipeline. PRE-WORK: run ls-lint dry-run against repo HEAD to enumerate every legitimate non-conforming path; build the `ignore:` block exhaustively BEFORE flipping the rule on (else CI fails on unrelated paths like `.claude.previous.bak/`, `dist-runtime/`, dot-prefixed configs).

#### EC-11 PRE-WORK (BLOCKING before adding the kebab-case rule)
1. Install ls-lint at the pinned version (T0.4 already added it as devDep).
2. Create `.ls-lint.yml` with the kebab-case rule but EMPTY `ignore:` block.
3. Run `npx ls-lint` against repo HEAD; capture every violation to `docs/audit/ls-lint-violations-pre-2026-06-06.md`.
4. Per violation: classify
   - **legitimate non-conforming** (e.g., `.changeset/config.json` dot-prefix, `.github/CODEOWNERS`, `node_modules/`, `.claude.previous.bak/` backup, `dist-runtime/`, `coverage/`, `.theokit/`, `referencia/`, `docs/evalscope/`, dot-prefixed configs `.dependency-cruiser.cjs`, `.nvmrc`) → add to `ignore:` block with inline comment citing reason
   - **outlier needing rename** (4 known: `_subprocess.ts`, `_path-scope.ts`, `_test-reset.ts`, `_helpers.ts`) → fixed by T7.1 main work
5. Re-run ls-lint; assert exit 0 BEFORE wiring into validate pipeline.

#### Evidence
- `architecture-output/final_report.md § Naming` NV#1 + NV#2 lines 272-276.
- 4 outliers: `packages/sdk/src/tools/_subprocess.ts`, `packages/sdk/src/tools/_path-scope.ts`, `packages/sdk/src/internal/security/_test-reset.ts`, `packages/acp/tests/_helpers.ts`.

#### Files to edit
```
.ls-lint.yml (NEW) — kebab-case rule + exception patterns for `.changeset/`, `.github/`, `node_modules/`, `dist/`, `referencia/`, `docs/evalscope/`
package.json — add validate:naming script + wire into validate
packages/sdk/src/tools/_subprocess.ts → subprocess.ts (rename + import updates)
packages/sdk/src/tools/_path-scope.ts → path-scope.ts (rename + import updates)
packages/sdk/src/internal/security/_test-reset.ts → test-reset.ts (rename + import updates)
packages/acp/tests/_helpers.ts → helpers.ts (rename + import updates)
*.test.ts files using these — update imports
.changeset/arch-fixes-2026-06-06-naming.md (NEW)
```

#### Deep file dependency analysis
- ls-lint runs as part of `pnpm -w run validate` — wires the gate.
- File renames trigger import path updates throughout `packages/sdk/src/**`.

#### Deep Dives
- **Why underscore prefix is redundant:** `internal/` directory already serves the private-marker purpose per project convention. Underscore breaks `.ls-lint.yml` kebab-case rule.
- **Edge case — test files:** `_test-reset.ts` is consumed via `import { resetTestState } from '../security/_test-reset'` in test files. Updating both is part of the task.

#### Tasks + TDD + Acceptance + DoD
(Standard — files renamed, imports updated, ls-lint exit 0, CHANGELOG entry.)

---

## Phase 8: Silent-catch elimination — `safeListTools` + `TelegramAdapter.disconnect`

**Objective:** Close PV#6 + PV#7. Replace `catch (e) {}` and `catch (e) { return [] }` swallows with structured-log per Inquebrável Rule 8.

### T8.1 — Add structured-log on both catches

#### Files to edit
```
packages/sdk/src/internal/agent-loop/loop.ts — replace silent catch at line 434 (safeListTools) with structured log + retain [] return
packages/gateway-telegram/src/index.ts — replace silent catch at line 79 (disconnect) with structured log
packages/sdk/tests/internal/agent-loop/loop-list-tools-error.test.ts (NEW) — RED test asserting telemetry seam emits on MCP failure
packages/gateway-telegram/tests/disconnect-error.test.ts (NEW) — RED test
```

#### Deep Dives
- **safeListTools rationale:** D34 telemetry seam exposes a `tracer` for spans. Use `tracer.spanError(span, e, { mcp_op: 'listTools' })` per D34. Returning `[]` is acceptable fallback behavior; the missing piece is the diagnostic.
- **Inquebrável Rule 8 mandate:** "5. Logs de erro devem ter contexto suficiente para reproduzir o problema sem acesso ao debugger."

#### TDD + Acceptance + DoD
(Standard.)

---

## Phase 9: Zone of Pain documentation + `SecretRedactor` interface (D437)

**Objective:** Close AF#16. DOCUMENT the `sdk.internal.security` Zone of Pain (D=0.923) AND introduce ONE stable interface to bump A.

### T9.1 — `SecretRedactor` interface + security README

#### Files to edit
```
packages/sdk/src/internal/security/secret-redactor.ts (NEW) — interface SecretRedactor { redact(value: unknown): string } (~15 LOC)
packages/sdk/src/internal/security/redact.ts — declare `class RedactSecretsImpl implements SecretRedactor` (structural — does not break callers)
packages/sdk/src/internal/security/README.md (NEW) — DOCUMENT the Zone of Pain trade-off, cite ADRs D68-D73, explain why concrete + stable is intentional
packages/sdk/CHANGELOG.md — entry
```

#### Deep Dives
- **Why interface without refactor:** D68 (canonical redactSecrets) + D73 (output-boundary redaction) lock the implementation to be stable. Adding an interface is documentation-only (TypeScript structural).
- **Audit DB update:** after this lands, the `architectural_findings` row #16 must be re-marked `status='resolved-by-documentation'` per `rules/cycle-rule-schema.md`.

---

## Phase 10: Structure cleanups — FO#3 + FO#4 + FO#6 + PV#2 dispatchSingleCall

**Objective:** Close 4 remaining MEDIUM/LOW structure + principle findings.

### T10.1 — Promote `internal/memory/` subfolders (FO#3)

Mirror the runtime split pattern. Promote existing implicit sub-domains (`memory/index/`, `memory/storage/`) to explicit sub-folders. Verify file count per direct folder ≤ 25.

### T10.2 — Address `packages/gateway/src/` lonely-folder cluster (FO#4)

The 6 single-file subdirs (types/session/delivery/hooks/adapter/runner per audit) — either fold into root OR justify each as future-extensible sub-domain. Document the choice in ADR or accept the over-folding with rationale.

### T10.3 — Rename one of the 5 `providers/` duplicated directories (FO#6)

Per Phase 2 recommendation: rename `internal/runtime/system-prompt/providers/` → `internal/runtime/system-prompt/sources/` (the system-prompt-source semantic is clearer; reserves `providers/` exclusively for LLM provider profiles).

### T10.4 — Split `dispatchSingleCall` (PV#2)

158 LOC orchestrator in `internal/agent-loop/tool-dispatch.ts:50-208`. Extract per the 8 sub-concerns. Verify against `biome-ignore lint/complexity/noExcessiveCognitiveComplexity` directive currently present — after split, the directive can be removed.

(Each sub-task follows the standard structure — listed compactly because they're independent and mechanical.)

---

## Phase 11: Documentation-only — D428 type cycles + ISP/SDKAgent (D122)

**Objective:** Acknowledge in writing what is intentional per existing ADRs.

### T11.1 — CHANGELOG + sub-section in audit DB

Add `[Unreleased] § Notes` entries:
- Cycles #1, #2 are type-only and bundled-dts manifest cycles documented per ADR D428 (`subscribe` at sub-path). They are NOT runtime cycles and are not breakable without regressing D428.
- PV#8 (ISP — SDKAgent bundles local + cloud methods) is acknowledged per ADR D122 (CloudAgent throws UnsupportedRunOperationError for runtime ops). The bundled shape is intentional cross-runtime API parity.

No code change. ADRs cited.

---

## Phase 12 (DEFERRED — follow-up plan): JS cyclomatic-complexity tool

The audit's `What was NOT reviewed` section calls out: "no JS-native CC tool installed in this audit; `radon` is for Python only. Recommended follow-up: install `lizard` or `complexipy` and gate function CC ≤ 10 per McCabe (consensus)."

This is OUT OF SCOPE for the current plan (per YAGNI — don't expand scope mid-plan per `rules/cycle-plan.md`). Recommend a separate plan `tools/install-js-cc-gate` AFTER this audit-fix plan lands.

---

## Coverage Matrix

Every gap surfaced in `architecture-output/final_report.md` maps to at least one task:

| # | Gap / Finding (file:line or AF#) | Task(s) | Resolution |
|---|---|---|---|
| 1 | AF#10 / Cycle #8 — HIGH runtime cycle agent-registry ↔ agent-registry-store | T3.1 | ADR D431 — extract `agent-registry-contract.ts` |
| 2 | AF#11 + AF#21 / Cycle #9 — CRITICAL layer-crossing runtime↔persistence | T1.1 | ADR D432 — define `ConversationStorage` port |
| 3 | AF#13 / Cycle #11 — HIGH memory index-manager ↔ dispatch | T2.1 | ADR D433 (folds #11/#12/#13) — extract `index-manager-contract.ts` |
| 4 | AF#14 / Cycle #12 — HIGH 3-node memory cycle through lance adapter | T2.1 | ADR D433 (folds) |
| 5 | AF#15 / Cycle #13 — HIGH 4-node memory cycle through memory-index | T2.1 | ADR D433 (folds) |
| 6 | AF#20 — Memory cycle cluster hub (sibling tracker) | T2.1 | ADR D433 (folds) |
| 7 | AF#17 — depcruise silently passes; meta-gate broken | T0.1 | ADR D434 — fix tsconfig parse + add madge --circular |
| 8 | AF#16 — `sdk.internal.security` Zone of Pain (D=0.923) | T9.1 | ADR D437 — `SecretRedactor` interface + README doc |
| 9 | AF#1 + PV#1 — Examples convention (telegram-pro 2317 LOC) | T6.1 | ADR D435 — split into 7-file module |
| 10 | FO#1 — God folder `internal/runtime/` (67 files / 9385 LOC) | T5.1 | ADR D436 — promote sub-folders runtime/{context,registry,fixtures,plugins} |
| 11 | FO#2 — Mirror test god folder `tests/internal/runtime/` (32 files) | T5.1 | Resolves as side-effect (test files mirror moves) |
| 12 | FO#3 — God folder `internal/memory/` (27 files) | T10.1 | Promote `memory/{index,storage}/` subfolders |
| 13 | FO#4 — Lonely-folder cluster `gateway/src/` (6 single-file subs) | T10.2 | Fold OR document each as future-extensible |
| 14 | FO#5 — 43 lonely folders across tree (LOW) | T5.1 + T10.1 + T10.2 | Side-effect of FO#1/#3/#4 resolutions |
| 15 | FO#6 — Duplicated dir name `providers/` in 5 places | T10.3 | Rename `runtime/system-prompt/providers/` → `sources/` |
| 16 | NV#1 — 4 underscore-prefixed file outliers | T7.1 | Rename + import updates |
| 17 | NV#2 — No `.ls-lint.yml` enforcing kebab-case | T7.1 | Ship `.ls-lint.yml` + wire into validate |
| 18 | PV#2 — Clean function: `dispatchSingleCall` 158 LOC orchestrator | T10.4 | Extract per 8 sub-concerns; remove biome-ignore directive |
| 19 | PV#4 — SRP: LocalAgent 24 methods | T5.1 | Mitigated by runtime/ split + Phase 1+2+3 cycle breaks (per audit note: LocalAgent stays central façade per D304-D329) |
| 20 | PV#5 — Telegram-pro handlers > 50 LOC | T6.1 | Resolves with god file split (handlers move to commands/*.ts) |
| 21 | PV#6 — `safeListTools` silently returns [] on MCP failure | T8.1 | Structured-log on catch per Inquebrável Rule 8 |
| 22 | PV#7 — `TelegramAdapter.disconnect` empty catch | T8.1 | Structured-log on catch |
| 23 | PV#8 — ISP: SDKAgent bundles local + cloud methods | T11.1 | DOCUMENT per ADR D122 — intentional cross-runtime parity |
| 24 | Cycle #3 — type-only self-ref `types/agent.ts → agent.ts` | T4.1 | Audit + collapse self re-export ring |
| 25 | Cycle #4 — type-only `types/agent.ts ↔ types/handoff.ts` | T4.1 | Extract `types/agent-id.ts` |
| 26 | Cycle #5 — type-only `types/agent.ts ↔ types/run.ts` | T4.1 | Extract `types/agent-prims.ts` |
| 27 | Cycle #6 — type-only `types/conversation.ts ↔ types/updates.ts` | T4.1 | Extract `types/messages-base.ts` |
| 28 | Cycle #7 — type-only 3-node `types/agent.ts → run → messages → agent` | T4.1 | Extract `types/model-selection.ts` |
| 29 | Cycle #10 — type-only `memory/active-memory-cache ↔ active-memory` | T4.1 | Extract `memory/active-memory-types.ts` |
| 30 | Cycles #1, #2 — type-only ADR D428-acknowledged subscribe ring | T11.1 | DOCUMENT (no code change — D428 already locks this) |
| 31 | JS CC tool deferred follow-up | Phase 12 marker | Documented as out-of-scope; recommended separate plan |
| 32 | PV#3 [info] — `runAgentLoop` is ~65 LOC orchestrator (above 50 LOC default) | T11.2 (NEW) | DOCUMENT as auditor-acknowledged orchestrator. Note: 65 LOC is over the SonarQube/arch-go 50 default but well below the 500 file budget and below McCabe CC ≤10. The function is sequential orchestration of a closed sequence; splitting would harm KISS. Add ADR-style note in `internal/agent-loop/CHANGELOG.md` (or `README.md`) explaining the trade-off + `biome-ignore lint/complexity` annotation if not already present. |
| 33 | PV#10 [info] — `Container` class 812 LOC (DI orchestrator) | T11.2 | DOCUMENT — auditor itself classifies as "justified DI orchestrator" (positive caveat in DB row). The `@theokit/di` `Container` is the SPoT for DI resolution; splitting harms cohesion. Add note in `packages/di/src/internal/container.ts` header citing audit acknowledgment + ADR-style rationale. No code change. |
| 34 | PV#11 [info] — `CacheStore` interface has 9 methods (above 7-method ISP heuristic) | T11.2 | DOCUMENT — 9 methods is 2 above the folklore 7±2 ceiling per `cycle-rule-schema.md` heuristic legend. The interface (per D249-D266 cache plugin family) groups orthogonal operations; splitting would create ISP-clean micro-interfaces but increase consumer wiring noise (KISS trade-off). Decision: DOCUMENT in `internal/cache/README.md` citing the trade-off. If a future consumer needs a subset, split THEN. YAGNI. |
| 35 | FO#7 [info positive] — `internal_convention_respected` (4 packages) | T13.1 (Integration Validation) | Validated by Integration Validation re-running `/loop-architecture-review` and confirming this positive finding persists in `folder_observations`. No code change. |
| 36 | FO#8 [info positive] — `findability_check_passed` (5/5 entry anchors per CLAUDE.md Locked Names) | T13.1 (Integration Validation) | Same — re-audit confirms positive persists. |
| 37 | FO#9 [info positive] — `no_critical_structural_issues_found` (349 folders scanned) | T13.1 (Integration Validation) | Same — re-audit confirms. |
| 38 | AF#2 [info positive] — `pattern_discipline` (33 patterns applied_correctly, 0 negative) | T13.1 (Integration Validation) | Same — re-audit confirms. |
| 39 | AF#18 [info positive] — `dependency_direction_invariants_satisfied` (SDK is leaf, zero cross-package internal/ leaks) | T13.1 (Integration Validation) | Same — Phase 5 (god folder split) AND Phase 1-4 (cycle breaks) MUST NOT regress this invariant. Integration Validation re-audit guards. |
| 40 | AF#19 [info positive] — `runtime_assumptions_consistent_with_declared_adapters` (Node-only, all node:* valid) | T13.1 (Integration Validation) | Same — re-audit confirms. |
| 41 | PV#9 [info] — Leading underscore filenames noted in `clean_naming` (REDUNDANT with NV#1) | T7.1 | Resolved automatically when NV#1 rename lands. Note in T7.1 commit message that PV#9 closes as side-effect. |
| 42 | PV#12-#18 [info positive] — `no_lsp/ocp/dip/dry/yagni/kiss/clean_comment_violations_detected` (7 negatives = positive coverage) | T13.1 (Integration Validation) | Same — re-audit confirms each surface stays clean. Phase 5 (file moves) + Phase 1-4 (cycle breaks) MUST NOT introduce new violations. |
| 43 | Phase 5.5 SOTA peer comparison — BYPASSED (no `--sota-catalog`) | Out-of-scope | Audit's own "What was NOT reviewed" item. Future-audit recommendation: ship a `.claude/sota-catalogs/theokit-sdk-peers.yaml` covering langchain-js / vercel-ai-sdk / openai-agents-python / botbuilder-js / bolt-js / mem0 / letta / honcho / tsyringe / awilix / inversify-js / bullmq / temporal-js. Tracked separately — NOT in this plan. |
| 44 | Markdown documentation depth — 835 .md files inventoried but NOT deep-read | Out-of-scope | Audit explicitly out-of-scope ("documentation isn't code"). No action. |
| 45 | Runtime behavior — static audit only | Out-of-scope | Audit out-of-scope. Existing dogfood + integration tests cover behavioral verification independently. |
| 46 | Test code structure deep audit (sampled, not deep-read) | Out-of-scope | Mirror god folder FO#2 covered via T5.1 side-effect; rest is out-of-scope per audit. |
| 47 | `docs/evalscope/` (1645 files vendored external project) | Out-of-scope | Excluded by design (not theokit-sdk code). |
| 48 | `referencia/` (2268 files read-only study material) | Out-of-scope | Excluded by design per `CLAUDE.md § Working with referencia/`. |
| 49 | `.tsx` single file in `@theokit/react` | Out-of-scope | Audit acknowledged "not statistically meaningful". No action. |

**Coverage: 49/49 gaps acknowledged (100%)** — split as:
- **31 actionable fixes** (rows 1-31) → resolved in Phases 0-12
- **10 INFO-level acknowledgments** (rows 32-34, 41, 42 grouped) → documented as auditor-noted, justified, or REDUNDANT-with-named-finding
- **6 INFO-positive preservations** (rows 35-40) → guarded by Integration Validation re-audit
- **7 explicit out-of-scope items per audit's own "What was NOT reviewed" section** (rows 43-49) → not actionable in this plan

### New Task T11.2 (added to Phase 11)

**T11.2 — Document auditor-acknowledged INFO orchestrators + interfaces**

Files to edit:
```
packages/sdk/src/internal/agent-loop/README.md (NEW or APPEND) — note PV#3 (runAgentLoop 65 LOC orchestrator, trade-off rationale)
packages/di/src/internal/container.ts — JSDoc header citing PV#10 (812 LOC DI orchestrator, justified per audit)
packages/sdk/src/internal/cache/README.md (NEW or APPEND) — note PV#11 (CacheStore 9-method interface, ISP trade-off vs KISS)
```

No code change. Pure documentation per Inquebrável Rule 3 (extreme honesty) and `cycle-rule-schema.md` heuristic acknowledgment. Each doc cites the audit DB row + architecture-output/final_report.md line for traceability.

## Global Definition of Done

- [ ] All 11 implementation phases (0-11) completed; Phase 12 (CC tool) documented as deferred.
- [ ] `pnpm -w run vitest` GREEN — unit + integration tests.
- [ ] `pnpm -w run typecheck` zero errors.
- [ ] `pnpm -w run lint` zero warnings.
- [ ] `pnpm -w run validate` exits 0 (includes the restored depcruise + new madge + new ls-lint gates).
- [ ] `npx madge --circular packages/sdk/src` exits 0 OR reports only the 2 D428-acknowledged cycles.
- [ ] `npx depcruise --validate .dependency-cruiser.cjs packages/sdk/src` exits 0 with correct tsconfig resolution.
- [ ] File-size budget respected: every changed file ≤ 500 LOC (per `rules/architecture.md`).
- [ ] `packages/sdk/CHANGELOG.md` `[Unreleased]` updated with all changes (per Inquebrável Rule 6).
- [ ] All gateway-* + memory-* CHANGELOGs updated where affected.
- [ ] Backward compatibility preserved: `@theokit/sdk` public API surface unchanged. `Agent.create / Agent.send / Agent.resume / Run.stream` shapes identical. `Memory.openIndex` works for both sqlite + lancedb backends.
- [ ] Dogfood: `/dogfood-cdp-telegram` skill PASS for `examples/telegram-pro/` after split.
- [ ] **Runtime-metric proof** — the integration test `tests/architecture/zero-cycles-integration.test.ts` MUST observe `madge` cycleCount = 0 (or ≤ 2 D428 cycles) AND `depcruise` violationCount = 0 AND `quality_gates_passed >= 1` in audit re-run.
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND PR merged, move this file to `knowledge-base/plans/completed/arch-review-fixes-2026-06-06-plan.md` per `rules/audit-trail-rotation.md`.

## Phase 13: Integration Validation (MANDATORY — Final Phase)

**Objective:** Re-run the full validation chain + the architecture audit; observe the metric the Goal commits to. AND verify that the audit's INFO-level positive findings (Coverage Matrix rows 35-42 — FO#7/8/9, AF#2/18/19, PV#12-#18) are preserved by the refactors (no regression in the positive observations the original audit captured).

### T13.1 — Re-run audit + verify positive preservation

Mapped to Coverage Matrix rows 35-42 (the 7 INFO positive findings). After all Phases 0-11 land, re-run `/loop-architecture-review . --mode full` and assert via DB query that each positive finding persists:

```bash
python3 -c "
import sqlite3
con = sqlite3.connect('architecture-output/architecture.db')
print('FO#7 internal_convention_respected:', con.execute(\"SELECT COUNT(*) FROM folder_observations WHERE description LIKE '%internal_convention_respected%'\").fetchone()[0])
print('FO#8 findability_check_passed:', con.execute(\"SELECT COUNT(*) FROM folder_observations WHERE description LIKE '%findability_check_passed%'\").fetchone()[0])
print('FO#9 no_critical_structural_issues:', con.execute(\"SELECT COUNT(*) FROM folder_observations WHERE description LIKE '%no_critical_structural_issues%'\").fetchone()[0])
print('AF#2 pattern_discipline:', con.execute(\"SELECT COUNT(*) FROM architectural_findings WHERE category = 'pattern_discipline'\").fetchone()[0])
print('AF#18 dependency_direction_ok:', con.execute(\"SELECT COUNT(*) FROM architectural_findings WHERE category = 'dependency_direction_ok'\").fetchone()[0])
print('AF#19 runtime_coherent:', con.execute(\"SELECT COUNT(*) FROM architectural_findings WHERE category = 'runtime_coherent'\").fetchone()[0])
print('PV info negatives 12-18:', con.execute(\"SELECT COUNT(*) FROM principle_violations WHERE severity = 'info' AND title LIKE '%no_%_violations_detected%'\").fetchone()[0])
"
```

Each query MUST return ≥ 1. Zero indicates regression — refactor unintentionally broke a positive invariant. T13.1 BLOCKS plan completion if any returns 0.

### Execution

```
pnpm -w run vitest                                # unit + integration tests
pnpm -w run vitest --coverage                     # coverage report
pnpm -w run typecheck                             # zero type errors
pnpm -w run lint                                  # zero lint warnings
pnpm -w run validate                              # full validate chain incl. madge + depcruise + ls-lint
npx madge --circular packages/sdk/src             # zero cycles (or D428 only)
npx depcruise --validate .dependency-cruiser.cjs packages/sdk/src  # zero violations

# Re-run the architecture audit to observe metric the Goal cites
/loop-architecture-review . --mode full
# Then query the DB:
python3 -c "
import sqlite3
con = sqlite3.connect('architecture-output/architecture.db')
print('cycles:', con.execute('SELECT COUNT(*) FROM cycles WHERE severity IN (\"critical\",\"high\")').fetchone()[0])
print('findings_critical:', con.execute(\"SELECT COUNT(*) FROM architectural_findings WHERE severity='critical'\").fetchone()[0])
print('findings_high:', con.execute(\"SELECT COUNT(*) FROM architectural_findings WHERE severity='high'\").fetchone()[0])
"
# Expected: cycles=0, findings_critical=0, findings_high=0
```

If the project has E2E tests for the affected packages:

```
pnpm --filter @theokit/sdk run test:integration
pnpm --filter examples/telegram-pro run test:dogfood  # if scripted
```

### Acceptance Criteria

- [ ] All test suites green (unit + integration + dogfood).
- [ ] Coverage ≥ 90% on changed files (critical paths: 100%).
- [ ] Zero type errors.
- [ ] Zero lint warnings.
- [ ] **Runtime-metric proof** — `tests/architecture/zero-cycles-integration.test.ts` asserts:
  - madge --circular exit code = 0 (or exclusively D428 cycles per documented exception)
  - depcruise --validate exit code = 0
  - Re-run audit DB: `architectural_findings WHERE severity IN ('critical','high')` returns 0 rows
  - Re-run audit DB: `cycles WHERE severity IN ('critical','high')` returns 0 rows

### If Validation Fails

1. Identify which failures are caused by this plan vs pre-existing (`git log -p develop..HEAD` on the affected file).
2. Fix all plan-caused failures before declaring the plan complete.
3. Re-run the validation chain to confirm.
4. Pre-existing issues are logged in the PR description but do NOT block plan completion.
5. If a cycle reappears in unexpected places (introduced by file moves in Phase 5), trace via `madge --circular --json` and reduce per the same pattern (leaf-types extraction).
