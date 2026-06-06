# Edge Case Review — arch-review-fixes-2026-06-06

Date: 2026-06-06
Plan version analyzed: 1.0 (file at `.claude/knowledge-base/plans/arch-review-fixes-2026-06-06-plan.md`)
Tasks analyzed: 15 (T0.1, T1.1, T2.1, T3.1, T4.1, T5.1, T6.1, T7.1, T8.1, T9.1, T10.1–T10.4, T11.1, T11.2 + Integration Validation)
Edge cases found: 24 (MUST FIX: 11, SHOULD TEST: 9, DOCUMENT: 4)

## MUST FIX

### EC-1: CI transition window — `pnpm -w run validate` will fail for every PR until all cycles are closed
- **Affected task:** T0.1 (Phase 0 wiring depcruise + madge into validate pipeline)
- **Family:** Timing / Integration
- **Scenario:** Phase 0 lands first per the dependency graph. After landing, `pnpm -w run validate` exits non-zero because the 13 pre-existing cycles + post-fix `no-orphans` errors fire. Every subsequent PR (including the cycle-break PRs in Phases 1-5) cannot pass CI. Pre-push hook (`stop-validation.sh`) also fires.
- **Impact:** Either everyone uses `--no-verify` (violates Inquebrável Rule global "NEVER skip hooks unless explicitly authorized"), or the develop branch freezes until Phases 1-5 are batch-merged. Both are unacceptable workflows.
- **Suggested fix:** Add T0.2 to Phase 0 — ship the gate in **warn-only mode** first (`severity: warn` in `.dependency-cruiser.cjs` for `no-circular` AND madge runs but doesn't fail the pipeline). After Phases 1-5 close every cycle, T0.3 flips the gate back to `severity: error`. Document a tracker issue listing remaining cycles per PR. Pattern mirrors the 0.3.0 CSRF warn → strict cutover (`docs/migration/0.2-to-0.3.md` precedent in CLAUDE.md history).

### EC-2: `tsconfig.base.json` absence breaks depcruise startup
- **Affected task:** T0.1
- **Family:** Resource / Format
- **Scenario:** If `tsconfig.base.json` doesn't exist at the expected location (file rename, refactor, fresh clone with submodule miss), `require.resolve(path.resolve(__dirname, './tsconfig.base.json'))` throws `MODULE_NOT_FOUND`. depcruise emits no actionable error.
- **Impact:** Silent failure mode reverts to regex fallback (the very bug being fixed).
- **Suggested fix:** Wrap the resolution: `try { tsConfig.fileName = require.resolve(...) } catch (e) { throw new Error('FATAL: tsconfig.base.json not resolvable from .dependency-cruiser.cjs context. See ' + e.message) }`. Fail-fast per Inquebrável Rule 8.

### EC-3: depcruise post-fix may surface NEW `no-orphans` violations unrelated to this plan
- **Affected task:** T0.1
- **Family:** Boundary
- **Scenario:** The current `.dependency-cruiser.cjs` falls back to regex which misses transitive resolution. After fix, depcruise correctly resolves all paths, may discover orphan modules that were hidden. Pre-existing rule `no-orphans` severity=error fires on them.
- **Impact:** Validate breaks for reasons unrelated to cycles. PR scope creep.
- **Suggested fix:** Add T0.4 — run depcruise once post-fix, snapshot the resulting `no-orphans` violations, audit each (real dead code OR legitimately needed allowlist entry). Either delete or extend `pathNot` patterns. Commit separately from cycle fixes so blame is clean.

### EC-4: `Agent.resume(agentId)` static path may bypass the bound `ConversationStorage` adapter
- **Affected task:** T1.1
- **Family:** State / Integration
- **Scenario:** Plan refactors `LocalAgent` constructor to accept `conversationStorage?: ConversationStorage` default FS. But `Agent.resume(agentId)` is a static factory on `Agent` that creates a fresh `LocalAgent` internally. If the static path uses a different default (or hardcodes the old direct `ConversationStorageFS` import), resumed agents read from a different adapter than newly-created ones.
- **Impact:** Resume reads from wrong storage; conversation history "lost" or doubled. Silent data inconsistency.
- **Suggested fix:** Add explicit task step to T1.1 — audit `packages/sdk/src/agent.ts` (`Agent.create`, `Agent.resume`, `Agent.get`, `Agent.getOrCreate`, `Agent.builder` per D22, D25, D26) ALL static factories must route through the same default. Centralize in a `defaultConversationStorage()` helper. RED test: create agent → write history → call `Agent.resume(agentId)` → assert history matches.

### EC-5: `agent-session-store.ts` may import `persistence/conversation-storage-fs.ts` directly (independent of `agent-session.ts`)
- **Affected task:** T1.1
- **Family:** State
- **Scenario:** Plan says "verify whether it actually needs the persistence import or if it's transitively pulled". If it imports directly, the cycle remains even after agent-session.ts is fixed (because agent-session-store IS a node in cycle #9's chain).
- **Impact:** Refactor lands, cycle #9 stays. CRITICAL finding not closed.
- **Suggested fix:** Pre-commit to the audit step BEFORE writing code: `grep -nE "import .* from.* persistence/conversation-storage-fs" packages/sdk/src/internal/runtime/agent-session-store.ts`. If hit, T1.1 ALSO refactors that file to import the port. RED test `cycle-9-closed.test.ts` verifies madge confirms ALL chain members no longer participate.

### EC-6: `CloudAgent` constructor signature divergence post-D432
- **Affected task:** T1.1
- **Family:** Integration
- **Scenario:** Plan adds `conversationStorage?` constructor param to `LocalAgent`. `CloudAgent` (D122) shares `SDKAgent` interface via `internal/runtime/cloud-agent.ts`. If `SDKAgent` interface gains the new field or constructor expects it, CloudAgent must mirror. Currently CloudAgent throws `UnsupportedRunOperationError` for runtime ops — but constructor lives in module load path.
- **Impact:** `Agent.create({ runtime: 'cloud' })` factory path may break with TypeScript error or runtime null.
- **Suggested fix:** Decision in T1.1 ADR D432 narrative: `CloudAgent` constructor accepts the same optional param but ignores it (or throws on .write attempt only). Add RED test `cloud-agent-construct-with-storage-noop.test.ts`. Document in CHANGELOG that cloud constructor surface is backward-compat.

### EC-7: `types/index.ts` barrel must add the 5 new type-leaf re-exports
- **Affected task:** T4.1
- **Family:** Boundary
- **Scenario:** Plan says "Public type re-exports unchanged via `types/index.ts` barrel". But if consumers do `import type { ModelSelection } from '@theokit/sdk'`, the barrel MUST re-export `ModelSelection` from the new `types/model-selection.ts`. Plan doesn't enumerate the barrel changes.
- **Impact:** Consumer typecheck breaks — public type export disappears. Backward-compat violation.
- **Suggested fix:** Add explicit step in T4.1 — after creating each leaf file, audit `types/index.ts` for what's re-exported. Add `export type * from './agent-id'`, `./agent-prims`, `./messages-base`, `./model-selection`. Verify with `pnpm -w run typecheck` AND a separate `tests/architecture/public-type-surface.test.ts` snapshot test asserting the exported type names.

### EC-8: Cycle #3 self-ref (`types/agent.ts → types/agent.ts`) may be intentional barrel re-export
- **Affected task:** T4.1
- **Family:** Format
- **Scenario:** Self-ref cycles in TS are usually `export type * from './agent'` patterns inside the SAME file (re-export ring through external barrel). Removing breaks the re-export contract.
- **Impact:** Naive "collapse the ring" may break consumer imports.
- **Suggested fix:** T4.1 must first `grep -nE "from.*'\\./agent'|from.*'\\./types/agent'" packages/sdk/src/types/agent.ts` to find the cause. If it's a re-export pattern, restructure: move the re-exported types to a leaf and re-export from `index.ts` barrel only (not from `agent.ts`). RED test: madge no longer reports cycle #3 AND `import { SDKAgent } from '@theokit/sdk'` still resolves.

### EC-9: Phase 5 file moves landing before Phase 1+2+3 cycle-break PRs merged
- **Affected task:** T5.1
- **Family:** Timing
- **Scenario:** Dependency graph says Phase 5 blocks on 1+2+3. But if 1/2/3 land sequentially over multiple days/weeks and Phase 5 work begins on a feature branch, the file moves race with cycle refactors. Git merge fails on dir/file rename + content edit overlap (common renames-and-edits pain).
- **Impact:** Phase 5 PR becomes unmergeable; manual conflict resolution loses cycle fixes OR vice versa.
- **Suggested fix:** Add explicit gate in T5.1 — DO NOT start Phase 5 work until `git log develop --oneline | grep -E '(D431|D432|D433)'` returns 3 commits. Make this a precondition step. Plan paragraph already implies it; promote to explicit DoD checkbox.

### EC-10: Phase 5 — file moves done in same commit as content edits defeat git rename detection
- **Affected task:** T5.1
- **Family:** Format / Timing
- **Scenario:** When `git mv` is combined with content changes in the same commit, git's rename-detection threshold (default 50%) may classify the move as delete+add. History grep fails, blame is lost.
- **Impact:** Future devs cannot `git log --follow` on moved files. Audit trail broken.
- **Suggested fix:** T5.1 commit strategy: PR has 2 commits — commit A = pure `git mv` (zero content edit) for all files in the phase; commit B = update barrel `index.ts` + relative imports. Rebase squash forbidden for this PR; preserve the 2-commit split. Document in PR description.

### EC-11: `.ls-lint.yml` exception list incomplete — false positives block CI
- **Affected task:** T7.1
- **Family:** Format
- **Scenario:** Plan mentions exceptions for `.changeset/`, `.github/`, `node_modules/`, `dist/`, `referencia/`, `docs/evalscope/`. The repo also has: `.claude.previous.bak/` (594 files per Phase 1 audit), `dist-runtime/`, dot-prefixed config files (`.nvmrc`, `.dependency-cruiser.cjs`, `.changeset/config.json`), and possibly `coverage/`, `.theokit/`. If ls-lint hits these with non-kebab-case names, gate fails on unrelated paths.
- **Impact:** ls-lint cannot be merged; T7.1 PR blocks.
- **Suggested fix:** Add T7.1 step: run `npx ls-lint` against repo HEAD before adding any rules; capture every violation; build the `ignore:` block to cover every legitimate non-conforming path. Verify exit 0 BEFORE adding the rule that flips kebab-case enforcement on.

## SHOULD TEST

### EC-12: `redactSecrets implements SecretRedactor` interface adaptation
- **Affected task:** T9.1
- **Suggested test:** `tests/internal/security/secret-redactor-contract.test.ts` — assert `redactSecrets` matches the `SecretRedactor.redact(value: unknown): string` signature structurally; assert the existing 18+ test cases for `redactSecrets` behavior pass via the interface-typed reference. Pattern: `const r: SecretRedactor = { redact: redactSecrets }`. If type errors fire, the function signature needs adapter wrapping (e.g., `class RedactSecretsImpl implements SecretRedactor { redact = redactSecrets }`).

### EC-13: `fork-agent` ALS-bound conversation-storage adapter inheritance
- **Affected task:** T1.1
- **Suggested test:** `tests/internal/runtime/fork-agent-storage-inheritance.test.ts` — create parent agent with custom storage adapter; call `fork()`; assert child reads/writes via the SAME adapter instance (D111 + D131 ALS contract). RED test before T1.1 fix.

### EC-14: `Memory.openIndex({ backend: 'lancedb' })` post-contract-extraction smoke
- **Affected task:** T2.1
- **Suggested test:** `tests/integration/memory-lance-backend-post-refactor.test.ts` — env-gated by `LANCEDB_AVAILABLE` (mirrors `real-llm-validation.md` pattern); creates Memory index with lancedb backend; writes + reads a record; asserts roundtrip. Honest SKIP if lancedb not installed. Verifies D43 contract unchanged after the contract extraction.

### EC-15: Agent registry post-contract works with ALS-bound factory (D131)
- **Affected task:** T3.1
- **Suggested test:** `tests/internal/runtime/agent-registry-als-binding.test.ts` — bind a custom factory via `withAgentFactory(als, ...)`; resolve agent via registry; assert factory was invoked. Verifies D23 + D131 contracts survive the contract extraction.

### EC-16: Consumer-side TypeScript compile sanity after type-leaf extractions
- **Affected task:** T4.1
- **Suggested test:** `tests/architecture/public-type-surface.test.ts` — list every type currently exported from `@theokit/sdk` (use `tsc --listFiles` or `api-extractor`); snapshot; refactor; re-snapshot; assert ZERO type removals. Backward-compat guard.

### EC-17: Dogfood-cdp-telegram regression after telegram-pro split
- **Affected task:** T6.1
- **Suggested test:** Run the `dogfood-cdp-telegram` skill via Chrome MCP against real Telegram Web BEFORE split (capture: every slash command's reply DOM); apply split; re-run; assert reply DOMs unchanged. Mention in TDD section that this is the GOLD regression — manual dogfood, not unit test. If skill is unavailable, fall back to inventory test: `examples/telegram-pro/tests/command-registration.test.ts` asserts 34 commands + 10 handlers register correctly.

### EC-18: madge cycle count after each Phase 5 sub-move (not just at end)
- **Affected task:** T5.1
- **Suggested test:** Add `tests/architecture/no-new-cycles-incremental.test.ts` (or a pre-commit script) — runs `madge --circular packages/sdk/src` after each `git mv` batch. Assertion: cycle count never EXCEEDS the baseline (the runtime cycles already closed by Phases 1-3, plus the 2 D428 acknowledged). Catches accidentally-introduced cycles mid-move.

### EC-19: `dispatchSingleCall` split — full test suite stays green
- **Affected task:** T10.4
- **Suggested test:** No NEW test needed — verify `pnpm --filter @theokit/sdk run test packages/sdk/tests/internal/agent-loop/` remains green after split. The function is heavily tested already; behavior preservation is the gate.

### EC-20: `tracer.spanError(...)` safety when telemetry not configured (PV#6, PV#7 fixes)
- **Affected task:** T8.1
- **Suggested test:** `tests/internal/telemetry/span-error-noop-when-disabled.test.ts` — disable telemetry via `THEOKIT_TELEMETRY=off` (or whatever D34 contract supports); call structured-log fn used in `safeListTools`; assert it doesn't throw AND returns the fallback `[]`. Verifies the fail-claro vs fail-fast tension stays balanced.

## DOCUMENT

### EC-21: Cycles #1, #2 ADR D428 dependency permanence
- **Accepted risk:** If a future PR revokes ADR D428 (`subscribe` no longer at sub-path), cycles #1 and #2 re-surface. The plan acknowledges this in T11.1 documentation. Risk consciously accepted because revoking D428 is itself an architectural decision requiring its own ADR + this plan's documentation forms the forward link.

### EC-22: IDE auto-import path staleness post-Phase-5
- **Accepted risk:** Internal moves don't affect public API but consumers' editors (VS Code TypeScript LSP) cache import paths. After Phase 5 lands and someone updates `theokit-sdk` in their workspace, autocomplete may suggest paths like `'@theokit/sdk/internal/runtime/agent-registry'` that resolved before. These are NOT public exports (per `internal/_convention_respected`), so anyone importing them was already violating the boundary. Document in CHANGELOG that the move is purely internal AND lint rule `no-package-internal-imports` (already in dep-cruiser config) catches violations.

### EC-23: Integration Validation full-audit cost (~1 hour agent time)
- **Accepted risk:** Re-running `/loop-architecture-review . --mode full` as Integration Validation gate is expensive (Phase 1 alone took 49 sub-agent tool uses + 8 minutes wall clock). For a per-PR CI gate, this is impractical. Plan should accept that Integration Validation re-audit is a MANUAL post-merge step (or run weekly via `/loop`). Per-PR gate stays as `pnpm -w run validate` (cheap; madge+depcruise+ls-lint suffice). Document the cost/cadence trade-off in the plan's Final Phase Acceptance Criteria.

### EC-24: SOTA peer comparison out-of-scope (audit's own "What was NOT reviewed")
- **Accepted risk:** Coverage Matrix row 43 documents this. No peer comparison possible without `--sota-catalog`. Plan explicitly tracks this as a future-audit recommendation; NOT in this plan. Reaffirmed.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T0.1 | 3 | 3 (EC-1, EC-2, EC-3) | 0 | 0 |
| T1.1 | 4 | 3 (EC-4, EC-5, EC-6) | 1 (EC-13) | 0 |
| T2.1 | 1 | 0 | 1 (EC-14) | 0 |
| T3.1 | 1 | 0 | 1 (EC-15) | 0 |
| T4.1 | 3 | 2 (EC-7, EC-8) | 1 (EC-16) | 0 |
| T5.1 | 3 | 2 (EC-9, EC-10) | 1 (EC-18) | 1 (EC-22) |
| T6.1 | 1 | 0 | 1 (EC-17) | 0 |
| T7.1 | 1 | 1 (EC-11) | 0 | 0 |
| T8.1 | 1 | 0 | 1 (EC-20) | 0 |
| T9.1 | 1 | 0 | 1 (EC-12) | 0 |
| T10.4 | 1 | 0 | 1 (EC-19) | 0 |
| T11.1 | 1 | 0 | 0 | 1 (EC-21) |
| Final Phase | 2 | 0 | 0 | 2 (EC-23, EC-24) |
| **Total** | **24** | **11** | **9** | **4** |

**Verdict:** PLAN NEEDS ADJUSTMENT

The 11 MUST FIX items are concentrated in T0.1 (3 — CI transition + tsconfig safety + no-orphans surfacing) and T1.1 (3 — Agent.resume static-path consistency, agent-session-store direct import audit, CloudAgent constructor signature). These are the load-bearing tasks; getting them right prevents cascading PR scope creep through Phases 2-5.

### Recommendation to plan author

Bump plan to **v1.1** absorbing the 11 MUST FIX items as sub-steps / ADR clarifications / new RED tests. Specifically:

1. T0.1 — add T0.2 (warn-only flip), T0.3 (error flip after Phases 1-5), T0.4 (no-orphans snapshot+resolve) per EC-1, EC-3.
2. T0.1 — wrap `require.resolve` in fail-fast try/catch per EC-2.
3. T1.1 — add explicit step auditing every `Agent.*` static factory for default-storage routing (EC-4). Add `agent-session-store.ts` pre-grep step (EC-5). Add `CloudAgent` constructor mirror task (EC-6) — including a RED test.
4. T4.1 — enumerate `types/index.ts` barrel additions; add `public-type-surface.test.ts` snapshot test (EC-7). Add pre-grep step for cycle #3 self-ref pattern (EC-8).
5. T5.1 — promote "Phases 1+2+3 merged BEFORE Phase 5 starts" from implicit graph note to explicit DoD checkbox (EC-9). Add 2-commit PR pattern (pure git mv + content edits) (EC-10).
6. T7.1 — add pre-rule ls-lint dry-run + ignore-block audit (EC-11).

After absorption, run `/plan-confidence arch-review-fixes-2026-06-06` to score v1.1 structurally. M3 fabricated-citation gate likely passes (the report cites real DB rows + audit findings); Coverage Matrix is already 100% per the prior /to-plan exchange.

The 9 SHOULD TEST items are NOT plan-blocking; they get added inside the existing TDD blocks of their respective tasks during /implement.

The 4 DOCUMENT items stand as risks consciously accepted — no change to the plan needed beyond a single mention in the appropriate Phase's narrative.
