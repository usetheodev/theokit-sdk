# Changelog

Workspace-level changes for the `theokit-sdk` monorepo. Per-package changes live in each package's `CHANGELOG.md`.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed — 5 LOW type-only cycles closed via 3 leaf extractions + self-ref drop (T4.1, ADR D438)

- **`@theokit/sdk`**: extracted 3 type-leaf files holding shared primitives so cyclic siblings can reach the same types without back-edging through each other:
  - `types/agent-prims.ts` (NEW) — `ModelParameterValue`, `ModelSelection`, `CustomTool`. Imported by `types/run.ts` and `types/messages.ts`. Re-exported from `types/agent.ts` for back-compat with `import type { ModelSelection, CustomTool } from "@theokit/sdk"`.
  - `types/messages-base.ts` (NEW) — `UserMessage`. Imported by `types/updates.ts`. Re-exported from `types/conversation.ts` for back-compat.
  - `internal/memory/active-memory-types.ts` (NEW) — `ActiveMemoryQueryMode`, `ActiveMemoryStatus`, `ActiveMemoryResult`. Imported by `active-memory-cache.ts`. Re-exported from `active-memory.ts` for in-tree consumers.
- **`types/agent.ts` self-cycle (#3) dropped**: the back-edge was a single inline `import("./agent.js").SDKAgent` inside `AgentOptions.handoffs?`. Replaced with a direct forward-reference to the locally-defined `SDKAgent` interface (TypeScript supports forward references in type position within the same file). No runtime / API impact.
- **madge cycle count: 8 → 3**. Closes audit cycles #3 (self), #5 (agent↔run), #6 (conversation↔updates), #7 (3-node agent→run→messages), #10 (active-memory cluster). Remaining 3: cycles #1+#2 are D428-acknowledged (rollup-dts forces subscribe at sub-path); cycle #4 (`types/agent.ts ↔ types/handoff.ts`) requires a HIGH-impact SDKAgent-interface extraction not in T4.1 scope — documented below as a deviation.
- **Plan-deviation honored on cycle #4:** audit prescribed `types/agent-id.ts` (identity brand). Empirical inspection found `HandoffDescriptor.target: SDKAgent` requires the **full runtime `SDKAgent` interface**, not just an ID — extracting `agent-id` would leave the cycle intact because the back-edge type would still pull SDKAgent. Closing #4 requires moving the whole `SDKAgent` interface (~120 LOC + many local dependencies) to a leaf file — followup ticket. Documented in `type-cycles-closed.test.ts` header + this CHANGELOG.
- **Architecture-test integrity bug fixed (iter-12 follow-up):** `tests/architecture/cycle-{8,9,11-12-13}-closed.test.ts` resolved `repoRoot` as `__dirname + "../../../../.."` (5 ups → meta-repo `theokit-tools`, which has no pnpm workspace). `pnpm exec madge` exited 1 with `ERR_PNPM_RECURSIVE_EXEC_NO_PACKAGE`; empty stdout meant the filter returned `[]` and every assertion passed **vacuously** rather than asserting on real madge output. Corrected to 4 ups (`theokit-sdk` root) across all 4 architecture test files. The T1.1/T2.1/T3.1 closures are real (independently re-verified post-fix: 12/12 architecture assertions GREEN against actual madge output), but the test suite that "proved" them was structurally a no-op. Surfacing per Inquebrável Rule 3.
- RED-GREEN-COMMIT TDD: `tests/architecture/type-cycles-closed.test.ts` (NEW) ships 6 assertions — 5 cycle-absence (cycles #3/#5/#6/#7/#10) + 1 public-type-surface smoke (barrels still resolve `ModelSelection`/`CustomTool`/`UserMessage`/`ActiveMemoryResult`). Plus 6 prior architecture assertions retro-corrected, totaling 12/12 GREEN against real madge.

### Fixed — CRITICAL runtime↔persistence cycle #9 closed (T1.1, ADR D432, plan-defect-corrected)

- **`@theokit/sdk`**: extracted `internal/runtime/session-types.ts` (leaf types file ~15 LOC) holding `SessionMessage`. `agent-session-store.ts` now imports the type from this leaf; `agent-session.ts` re-exports it for back-compat. Closes the audit's only CRITICAL cycle (Phase 5 cartographer cycle #9, runtime↔persistence layer-crossing). madge cycle count: 9 → 8. Architecture test in `tests/architecture/cycle-9-closed.test.ts` (NEW) asserts via `spawnSync(madge --circular)`.
- **Plan-vs-reality deviation honored:** the plan (ADR D432) prescribed a full port-and-adapter refactor (introduce `ConversationStorage` port in `runtime/`, rewire LocalAgent constructor, mirror in CloudAgent per EC-6, route every Agent.* static factory per EC-4, pre-grep store per EC-5). Empirical inspection found the cycle's back-edge was a single types-only import — type-leaf extraction is the smallest break that ACTUALLY closes the cycle. The port-and-adapter refactor would have left the back-edge intact. Documented in commit body + `session-types.ts` JSDoc rationale.

### Fixed — Memory cluster cycles #11/#12/#13 closed via contract extraction (T2.1, ADR D433)

- **`@theokit/sdk`**: extracted `internal/memory/index-manager-contract.ts` (leaf types file ~70 LOC) holding `MemorySearchHit`, `IndexStatus`, `SearchOptions`, `MemoryBackend`, `OpenIndexOptions`. All 4 cluster members (`index-manager.ts`, `index-manager-dispatch.ts`, `lance-memory-adapter.ts`, `memory-index.ts`) now import these types from the contract. Single extraction breaks 3 HIGH-severity cycles at once (Phase 5 cartographer cycles #11/#12/#13 — 2-node + 3-node + 4-node rings). madge cycle count: 12 → 9. RED-GREEN-COMMIT TDD with 3 architecture assertions in `tests/architecture/cycle-11-12-13-closed.test.ts` (NEW). Back-compat re-export preserved on `index-manager.ts`.

### Fixed — Runtime cycle #8 closed via contract extraction (T3.1, ADR D431)

- **`@theokit/sdk`**: extracted `internal/runtime/agent-registry-contract.ts` (leaf types file ~60 LOC) holding `AgentRuntime` + `RegisteredAgent`. Both `agent-registry.ts` and `agent-registry-store.ts` now import these types from the contract, breaking the previous runtime↔store 2-node cycle (Phase 5 cartographer cycle #8, HIGH severity). madge cycle count: 13 → 12. RED-GREEN-COMMIT TDD with architecture test `tests/architecture/cycle-8-closed.test.ts` (NEW) asserting via spawnSync(madge --circular) that no cycle contains both file names. Back-compat re-export preserved.

### Added — `SecretRedactor` interface + Zone of Pain doc (T9.1, ADR D437)

- **`@theokit/sdk`**: added types-only `internal/security/secret-redactor.ts` exporting `SecretRedactor` interface (single method `redact(value: unknown): string`). Canonical `redactSecrets` from `redact.ts` is structurally compatible — no class wrapper required. TypeScript erases the interface at build time; runtime exports are zero. Closes AF#16 (Zone of Pain) from the 2026-06-06 architecture audit via documentation + minimal abstraction.
- **Documentation**: added `internal/security/README.md` documenting Martin's coupling metrics for the security folder (Ca=12, Ce=1, A=0.000, D=0.923), the explicit rationale for keeping primitives concrete (cites D68/D69/D70/D71/D73), and the marginal abstractness bump from adding the interface. Per `rules/cycle-rule-schema.md` heuristic-source legend, the 0.3 cutoff that triggers a "Zone of Pain" flag is folklore — finding is real, prescribed action ("raise A") is rejected per ADR record.

### Added — `.ls-lint.yml` filename naming gate (T7.1)

- **`.ls-lint.yml`** added at workspace root enforcing kebab-case (regex `^[a-z][a-z0-9-]*$`) on every `.ts`/`.tsx` source + test file under `packages/*/src/**` and `packages/*/tests/**`. `ignore:` block covers `node_modules`, build outputs, `.changeset/`, `.github/`, `.claude*/`, `referencia/`, `docs/evalscope/`, `architecture-output/`, `examples/` (each with documented rationale in `docs/audit/ls-lint-violations-pre-2026-06-06.md`).
- **`validate:naming` script** added to root `package.json` + wired into the `validate` chain (runs after `test`, before `validate:publint`). Closes NV#1 + NV#2 from the 2026-06-06 architecture audit (plan `arch-review-fixes-2026-06-06` T7.1).
- **EC-11 absorbed**: dry-run violations captured to `docs/audit/ls-lint-violations-pre-2026-06-06.md` BEFORE the rule was wired into validate — guarantees CI doesn't fail unrelated paths.

### Changed — 4 underscore-prefixed files renamed for kebab-case discipline (T7.1)

- **`@theokit/sdk`**: `_subprocess.ts` → `subprocess.ts`, `_path-scope.ts` → `path-scope.ts` (both in `src/tools/`), `_test-reset.ts` → `test-reset.ts` (in `src/internal/security/`). All 5 importer files updated (`git-diff.ts`, `run-vitest.ts`, `tests/internal/security/redact.test.ts`).
- **`@theokit/acp`**: `_helpers.ts` → `helpers.ts` (in `tests/`). 1 importer updated (`lifecycle.test.ts`).
- Closes NV#1 from the 2026-06-06 architecture audit (plan `arch-review-fixes-2026-06-06` T7.1). Internal-only renames; no public API touched. Git rename detection preserved (100% on all 4 files).

### Changed — Gateway base internal layout documented (T10.2)

- **`@theokit/gateway`**: added `packages/gateway/src/README.md` documenting the 6 single-file sub-folder cluster (`adapter/`, `delivery/`, `hooks/`, `runner/`, `session/`, `types/`) as intentional bounded future-extensibility scaffold (FO#4 of 2026-06-06 architecture audit, T10.2 of plan `arch-review-fixes-2026-06-06`). Each sub-folder maps 1:1 to an ADR (D170-D177) and represents a stable semantic role rather than over-folding. Includes 12-month re-evaluation trigger. No source change.

### Changed — Internal directory rename for findability (T10.3)

- **`@theokit/sdk`**: renamed `internal/runtime/system-prompt/providers/` → `internal/runtime/system-prompt/sources/` (FO#6 of plan `arch-review-fixes-2026-06-06`). Disambiguates from `internal/providers/` (LLM provider profiles per D105-D107) — auditor flagged the duplicate folder name as a findability hazard. `sources/` better describes the 5 system-prompt source modules (ActiveMemoryPromptProvider, BasePromptProvider, ContextPromptProvider, MemoryPromptProvider, SkillsPromptProvider). Internal-only; no public API touched. Git rename detection preserved (100% on all 5 files); imports in pipeline.ts + 5 golden tests updated.

### Fixed — Silent-catch elimination per Inquebrável Rule 8 (T8.1)

- **`@theokit/gateway-telegram`**: `TelegramAdapter.disconnect()` no longer silently swallows `bot.stop()` failures (PV#7, plan `arch-review-fixes-2026-06-06` T8.1). The catch remains intentional (disconnect must stay idempotent + safe — the bot may already be torn down by Telegram or by a prior signal handler), but now emits a structured `[theokit-gateway-telegram] bot.stop() failed during disconnect: <error>` line to stderr. Never-throw contract preserved.

### Added — CI tooling pins for arch-review-fixes plan (T0.4)

- **`madge@8.0.0`** + **`@ls-lint/ls-lint@2.3.1`** added as exact-pinned devDeps at workspace root (T0.4 of plan `arch-review-fixes-2026-06-06`). Rationale doc at `docs/audit/ci-tool-versions-2026-06-06.md`: CI-gate dependencies (cycle detection, filename-naming linter) pinned exactly rather than `^x.y.z` to avoid silent gate drift. **Package-name discipline:** the bare `ls-lint` package on npm is an unrelated legacy livescript-based tool — confirmed via deps-audit (`.claude/knowledge-base/audits/arch-review-fixes-2026-06-06-deps-audit-2026-06-06.md`); the scoped `@ls-lint/ls-lint` is the correct package. Zero CVE per npm audit at install time.

### Added — Tier 1 Gateway Expansion v1.5 (ADRs D389-D421)

Four new workspace packages bringing the gateway fleet from 6 → 10, closing OCDE + APAC consumer + decentralized federation gaps:

- **`@theokit/gateway-sms@0.1.0`** (D389-D396) — Twilio + Plivo + Vonage backends; HMAC signature enforcement at construction (EC-1 absorbed); E.164 normalization via libphonenumber-js (D391, EC-6 toll-free OK); 1600-char multipart with `(i/N)` prefix (D393, EC-7 grapheme-safe via Intl.Segmenter); webhook server with raw-body capture + per-backend route. 32/32 unit tests + example app + env-gated live smoke.
- **`@theokit/gateway-mattermost@0.1.0`** (D397-D404) — `@mattermost/client@^9` WebSocket gateway + Client4 REST; thread reply bidirectional via `root_id` ↔ `topicId` (D399); channel-type mapping D→dm, G/O/P→group (D402); EC-2 absorbed mention pipeline (`metadata.mentions` array priority + word-boundary regex fallback — `@theory_dept` does NOT match a bot called `theo`); PAT auth only in v0.1 (D401). 53/53 unit tests.
- **`@theokit/gateway-line@0.1.0`** (D405-D412) — webhook-only with HMAC-SHA256 signature (D408) using `crypto.timingSafeEqual`; Reply token first + Push API fallback with 1000-entry LRU cache (D407, 60s TTL, one-shot); EC-4 absorbed event-type filter (LINE delivers 9 event types — adapter drops non-message + non-text at the top); 5000-char grapheme-safe split (D411); mentionee array handling (D409); source-type mapping user→dm, group/room→group (D410). 55/55 unit tests.
- **`@theokit/gateway-matrix@0.1.0`** (D413-D421) — `matrix-js-sdk@^32` (lazy ~2MB peer-dep); DM detection via `memberCount === 2` heuristic (D416); EC-3 absorbed initial-sync flood guard (drops events older than 60s — 50-room bot would fire 500 LLM calls on boot otherwise); alias resolution with caching (D419); E2EE rooms refused with one-shot stderr warn (D418, Olm/Megolm deferred to v0.2); federation transparent via SDK (D420). 44/44 unit tests.

Common to all four:
- Workspace packages with peer-dep policy (D171 reused).
- Extend `BasePlatformAdapter` (D172).
- `MessageEvent` discriminated union extended in `@theokit/gateway@[Unreleased]` — `PlatformName` 6 → 10 entries.
- EC-5 absorbed: exhaustive switch test updated to cover the 10 cases — no compile break in consumers.
- Build CJS+ESM+DTS verde; publint clean; attw 4/4 (node10/node16-CJS/node16-ESM/bundler) all green.
- Example app per gateway with env-gated live smoke (`*_LIVE_SMOKE=1`) — sms-bot / mattermost-bot / line-bot / matrix-bot under `examples/`.

Plan: `.claude/knowledge-base/plans/gateway-tier-1-expansion-plan.md`.
Edge case review: `.claude/knowledge-base/reviews/gateway-tier-1-expansion-edge-cases-2026-05-28.md` (22 edges, 5 MUST FIX absorbed inline: EC-1 through EC-5).

Total new tests: 184 unit + 4 example typechecks. Workspace `pnpm typecheck` clean; 0 regressions in pre-existing packages.

### Added — `@theokit/acp@0.1.0` (ACP server adapter, ADRs D349-D360)
- New `@theokit/acp` workspace package exposing any `@theokit/sdk` `SDKAgent` as
  an Agent Client Protocol (ACP) server over stdio JSON-RPC, using the official
  `@agentclientprotocol/sdk@^0.22`. Zed, Cursor, Claude Desktop, and any
  ACP-compatible host can drive our SDK as a coding agent.
- 12 new ADRs (D349-D360). 6 edge case fixes absorbed (EC-1 dispose-on-shutdown,
  EC-2 permission-timeout, EC-3 CloudAgent fork rejection, EC-4 CJS/ESM
  interop, EC-5 cwd absolute resolve, EC-6 storage hint).
- `theokit acp` CLI subcommand + standalone `theokit-acp` bin shim.
- `agent.json` registry manifest at `packages/acp/registry/` for the ACP marketplace.
- 57 new tests across session-store, agent-resolver, lifecycle, prompt-extract,
  translator, permission-plugin, plus a programmatic stdio smoke (`serve-smoke.test.ts`)
  that drives the full protocol end-to-end.
- Concept page + cookbook recipe in `theo-opendocs/content/theokit-sdk/`.
- `examples/acp-server/` real-LLM example.

### Added
- Initial workspace structure: pnpm workspaces, Biome 2.4, Changesets, tsup 8, Vitest 3, TypeScript 5.8+, Node 22.12+ engines (initial scaffold).
- `@theokit/sdk` package skeleton at `packages/sdk/` (initial scaffold).
- `runtime/packages/*` integrated as workspace children via `pnpm-workspace.yaml` (initial scaffold).
- `docs.md` locked as the canonical public API contract (initial scaffold).
- `docs/` folder with human-friendly documentation: getting-started, concepts, guides (cron, MCP, subagents, hooks, errors, resource management), reference, and development guide for contributors (initial scaffold).
- `PITCH.md` at workspace root: landing-page copy for `@theokit/sdk` using the TheoKit aspirational voice (explicit exception authorized 2026-05-15).
- README: `## Memory, context, and skills` section, consolidated `## Status` section, `Context` / `Memory` / `Skills` entries in the Core concepts table, and the "Most agent SDKs ship open; most agent runtimes don't" differentiator line in `## Why @theokit/sdk`.
- README HERO + intro rewritten in the TheoKit aspirational voice; `## What you'd ship` section and `## How it works` DEEP DIVE delimiter inserted before `## Installation`. Everything below the delimiter remains technical-direct.
- `CLAUDE.md`: `## Voice and Tone` section formalizes the adoption of the TheoKit aspirational voice for TheoKit-SDK public surfaces (README HERO/BODY, `PITCH.md`, future launch material). `docs.md`, the DEEP DIVE layer of the README, ADRs, and this file stay technical-direct.

### Changed
- License standardized to **Apache-2.0** (was MIT). Aligns all Theo open-core pillars under a single license — see root `CLAUDE.md` strategic review of 2026-05-14.
- `pi/` and `cookbook/` moved under `referencia/` as read-only reference material; `pnpm-workspace.yaml` and `biome.json` updated to exclude `referencia/**` from workspace and lint targets.
- Root `CLAUDE.md` (`/home/paulo/Projetos/usetheo/CLAUDE.md`) `## Voice and Tone — sub-project scoped` updated to recognize TheoKit-SDK as an adopter of the aspirational voice (strategic review 2026-05-15). TheoKit-SDK removed from the "technical-direct only" list.

### Fixed
- README link to the local agent runtime pointed at `./runtime` (workspace path that no longer exists after the move under `referencia/`); now points at `./referencia/runtime`.
