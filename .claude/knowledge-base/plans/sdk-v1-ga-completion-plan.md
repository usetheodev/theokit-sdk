# Plan: TheoKit-SDK v1.0 GA Completion

> **Version 1.0** — Close the 14 remaining gaps blocking `@usetheo/sdk` v1.0 GA: validate the SDK in its declared Node 22 engine (currently only tested in Node 20 with engine warnings), formalize the 8 "Pending" decisions in `CLAUDE.md` as proper ADRs, and either ship real implementations or write deferral ADRs for the 4 OpenClaw parity gaps that were intentionally removed under the no-stubs rule. After this plan, `CLAUDE.md` has zero `Pending` entries, the SDK is Node-22-validated, and every catalog/feature exposed in the public API has a real implementation behind it.

## Context

### What exists today
- `packages/sdk/` ships with all local-runtime features at 100% (memory, cron, MCP, hooks, skills, plugins, Active Memory dedup-only, dreaming determinístico). 196/196 vitest, publint + attw green. Committed at `0180dce` on `feat/sdk-implementation`.
- **`.nvmrc` declares `>=22.12.0`** but the entire validation chain (typecheck, tests, biome, knip, dogfood) only ran in Node 20 with `WARN Unsupported engine` in every command. `knip` full mode OOMs in Node 20.
- **`CLAUDE.md`** at `packages/sdk/CLAUDE.md` lists 8 items marked `Pending` (see lines 178-196 of that file). Implementation decisions were made implicitly; ADRs were never written. Risk: next maintainer changes direction without context.
- **4 OpenClaw parity gaps** were deliberately removed from the public API under the no-stubs rule (commit `c73b975`): 5 embedding adapters (voyage/deepinfra/lmstudio/google/bedrock), LanceDB backend, Active Memory `subagent` mode, Dreaming `narrative` LLM module. They need either real implementations or deferral ADRs locking them out of v1.0.

### Evidence
- `WARN Unsupported engine` repeated in every `pnpm` invocation in commits `c73b975`, `af0d99b`, `0180dce`.
- `pnpm quality:dead` (knip full) OOMs at 4GB heap in Node 20 — verified during the dogfood QA session.
- `CLAUDE.md` open-decisions table: lines 178-196 of `packages/sdk/CLAUDE.md`.
- Deep review report `.claude/knowledge-base/reviews/deep-review/no-stubs-no-mocks-no-wired-2026-05-16.md` documents the 4 OpenClaw gaps as "removed, not implemented".

### Why now
v1.0 publish is blocked by: (a) inability to validate in the engine the SDK declares, (b) `CLAUDE.md` Pending entries are an integrity risk for the project, (c) OpenClaw parity gaps undermine the "exatamente igual OpenClaw" promise that motivated the entire memory-system plan.

## Objective

`@usetheo/sdk` is **release-ready for `npm publish` under v1.0**: validated in Node 22.12+, `CLAUDE.md` has zero `Pending` entries, all OpenClaw parity gaps are either shipped or documented in a `v1.1-deferred` ADR with rationale.

**Measurable goals:**
1. `pnpm test`, `pnpm check`, `pnpm typecheck`, `pnpm validate`, `pnpm quality` all green in Node 22.12+ with **zero engine warnings**.
2. GitHub Actions CI matrix runs the full pipeline on `node@22` and `node@22-latest`.
3. `packages/sdk/CLAUDE.md` "Open Decisions" table has 0 `Pending` entries; each former Pending becomes a `Decided` ADR with rationale.
4. Each of the 4 OpenClaw parity gaps lands in one of two end states:
   - **Shipped**: real implementation + tests + dogfood proof
   - **Deferred-by-ADR**: written ADR explaining why v1.0 excludes it and what v1.1 requires.
5. Changeset created with version bump (1.0.0) + auto-generated CHANGELOG section.
6. `pnpm validate` is strict on **both** `publint` AND `attw` errors (currently strictness undefined).

## ADRs

### D1 — Node 22.12+ mandatory in CI
**Decision:** All CI gates (test, typecheck, biome, quality:dead, validate, dogfood) run on Node 22.12+ exclusively. Pre-push hook fails if local Node is <22.12.
**Rationale:** `.nvmrc` already declares 22.12+. Running validation in Node 20 produces engine warnings and `knip` OOMs at 4GB heap — meaning the SDK *might* break in its declared engine without anyone noticing. Aligning local + CI on the declared engine eliminates the warning class entirely.
**Consequences:** Contributors must `nvm use` before working. CI workflows pin Node 22. Node 18/20 support is dropped from the matrix (was implicit but never validated).

### D2 — Knip enforced strictly in CI
**Decision:** `pnpm quality:dead` (knip full mode) is part of the pre-push and CI gate. Failures block merge.
**Rationale:** Knip already runs targeted (`--include exports,types`) in this session and finds dead types. Full mode catches dead files, unlisted deps, unresolved imports — all of which can silently rot a long-lived TS monorepo. With Node 22 (which doesn't OOM on the codebase size), enabling it is essentially free.
**Consequences:** New unused exports fail CI. Contributors must clean dead code or annotate `knipignore`.

### D3 — `pi` stays stand-alone (not vendored, not workspace-linked)
**Decision:** `packages/sdk/` continues to NOT import from `referencia/pi/`. The `pi-agent-core` engine is studied as reference; the SDK ships its own implementation.
**Rationale:** Pulling `pi` into the workspace would force version coupling between two projects with different release cadences. The SDK already has a working local runtime built from scratch (real-local-run + agent-loop). The "implement vs wrap" decision was made implicitly — formalize it.
**Consequences:** Any improvements in upstream `pi` must be ported by hand. Documented in CLAUDE.md as "Decided 2026-05-16".

### D4 — Model catalog source-of-truth = `Theokit.models.list()` (PaaS-backed)
**Decision:** The SDK does NOT maintain a hardcoded model catalog. `FIXTURE_MODELS` exists only for `theo_test_*` keys. Real consumers call `Theokit.models.list()` to discover available models. The default agentic model id (`google/gemini-2.0-flash-exp:free`) is a runnable fallback for users who don't call `models.list()`, not a curated catalog.
**Rationale:** Maintaining a hardcoded model list in the SDK becomes stale immediately. PaaS owns the canonical catalog. SDK only needs (a) one runnable default for out-of-box use, (b) the fixture catalog for test-mode.
**Consequences:** Documentation must consistently point at `Theokit.models.list()` for "what models can I use?". README/docs.md examples use the default but note it's overridable.

### D5 — Adopt `Symbol.asyncDispose` in `SDKAgent` public type
**Decision:** Bump `tsconfig.base.json` `lib` to `ESNext.Disposable`; expose `[Symbol.asyncDispose]` on the public `SDKAgent` interface. Keep `dispose()` as the explicit-call method alongside.
**Rationale:** `using` declarations are GA in TypeScript 5.2+. Real users will write `await using agent = await Agent.create(...)`. Shipping without it forces them to write `try/finally` for every agent. Cost is one `lib` bump.
**Consequences:** Bumps minimum TS lib target. Drops Node 18 support (already dropped by D1). Public API gains one symbol method.

### D6 — `pnpm validate` is strict on both `publint` and `attw`
**Decision:** `pnpm validate` fails if EITHER `publint` reports a problem OR `attw` reports any non-🟢 finding. No warning-only mode.
**Rationale:** Both tools catch real publish-breakers (missing types, ESM/CJS dual-export bugs, package.json `exports` mismatches). A "warnings OK" mode invites the warnings to become errors at the worst possible time (post-publish).
**Consequences:** A new attw finding (e.g., on a new entry point) blocks publish until fixed.

### D7 — `croner` is the locked cron scheduler library
**Decision:** `croner` stays as the in-process scheduler. No swap to `node-cron` or `cron`.
**Rationale:** `croner` is zero-deps, modern (TS-native), supports DST + timezones correctly, smallest bundle. The other options either pull in deps or lack timezone correctness. Already in `package.json` and working.
**Consequences:** Documented as a locked choice. Future replacement requires re-running the comparison.

### D8 — Cron persistence stays as JSON file, formalize the schema
**Decision:** Cron jobs persist to `.theokit/cron/jobs.json` (atomic write via `replaceFileAtomic`). No SQLite migration.
**Rationale:** SQLite was considered for crash-recovery + concurrent-process safety, but: (a) cron jobs are rarely >100 entries, (b) JSON is human-editable/git-friendly (matches memory's markdown-first ethos), (c) atomic writes via tmp+rename already give crash-safety, (d) concurrent processes are an anti-pattern for the local runtime — only one scheduler should hold the workspace. SQLite would be premature optimization.
**Consequences:** JSON schema is locked. Future migration to SQLite requires explicit ADR.

### D9 — Memory namespace defaults: `namespace="default"`, `scope="agent"`, `userId="default"`
**Decision:** When `memory.namespace/scope/userId` is omitted, defaults are `"default"/"agent"/"default"`. The fully resolved key is `{cwd}/.theokit/memory/{namespace}/{scope}-{userId}.json` (legacy) → migrated to `{cwd}/.theokit/memory/MEMORY.md` + `notes/*.md` on first access. Redaction strips `sk-*`, `ghp_*`, and `sk-proj-*` patterns from any fact text via `redactSecrets()`.
**Rationale:** These defaults already exist in code (`migration.ts:legacyMemoryJsonPath`, `types.ts:redactSecrets`). Formalize so consumers can rely on them.
**Consequences:** Defaults locked. Future changes require explicit ADR. Consumers who need multi-user memory must explicitly set `userId`.

### D10 — Skills frontmatter schema is strict: `name`, `description`, optional `category`, `dependencies`
**Decision:** Skill files (`.theokit/skills/<name>/SKILL.md`) require YAML frontmatter with `name: string` (required) and `description: string` (required). Optional: `category: string`, `dependencies: string[]`. Anything else is ignored. Frontmatter-less SKILL.md is rejected with a typed error.
**Rationale:** The current loader accepts anything; consumers can't rely on the shape. Strict schema lets agents reason about skills (e.g., "show me skills with dependency X").
**Consequences:** Existing skill files without frontmatter break. Migration: documented in CHANGELOG breaking-change section.

### D11 — 5 OpenClaw embedding adapters: SHIP Voyage + DeepInfra; ADR-defer LMStudio + Google + Bedrock to v1.1
**Decision:** Phase 3 of this plan ships **Voyage** and **DeepInfra** as real adapters (both OpenAI-compatible REST, ~30 LoC each via `createOpenAiCompatibleRuntime`). LMStudio (local), Google Generative AI (custom API shape), and Bedrock (AWS SigV4) are deferred to v1.1 with explicit ADRs.
**Rationale:** Voyage and DeepInfra are 80/20: both are OpenAI-compatible REST, both have free tiers, both have real demand. LMStudio requires user-side server (no remote validation); Google requires a non-OpenAI request shape; Bedrock requires AWS SigV4 + IAM — each is its own ~2-day task and a different auth model.
**Consequences:** Catalog grows from `{openai, mistral, openrouter}` to `{openai, mistral, openrouter, voyage, deepinfra}`. The 3 remaining never appear in `MEMORY_EMBEDDING_ADAPTERS` until v1.1.

### D12 — LanceDB backend: ADR-defer to v1.1
**Decision:** LanceDB is NOT in v1.0. ADR documents the deferral; `MemoryBackend` union stays `"sqlite-vec"` only.
**Rationale:** SQLite-vec ships and is sufficient for v1.0 scale (≤100k chunks). LanceDB's advantage (HNSW-grade vector search, columnar format) matters at >1M chunks — which isn't v1.0's audience. Implementing LanceDB now adds a non-trivial native dep (`@lancedb/lancedb`) for users who don't need it.
**Consequences:** Documented as v1.1 work. The `IndexManager.open` contract stays unchanged but extensible (already accepts `backend` option).

### D13 — Active Memory `subagent` mode (LLM-curated): ADR-defer to v1.1
**Decision:** v1.0 ships `search` mode only. `subagent` mode (a tiny LLM curates which memory facts are relevant before injecting) is deferred to v1.1.
**Rationale:** The `search` mode (direct FTS+vector hybrid) works well at v1.0 scale. The `subagent` mode requires (a) a tiny model picker (Haiku 4.5 / Gemini Flash Lite), (b) a curation prompt template, (c) cost accounting for the extra LLM call per `send()`. Each of those is its own decision. Shipping without the subagent mode is honest; shipping a half-baked subagent isn't.
**Consequences:** Documented as v1.1 work. The current contract (returns a summary string) accommodates either mode without API change.

### D14 — Dreaming narrative LLM (per-cluster summarization): ADR-defer to v1.1
**Decision:** v1.0 ships deterministic clustering only (longest-text-wins as cluster representative). The narrative module (LLM produces a coherent paragraph per cluster) is deferred to v1.1.
**Rationale:** Same logic as D13 — deterministic mode works honestly. LLM mode requires model choice, prompt design, cost accounting. v1.0 dreaming already produces meaningful diary entries (verified via dogfood: 6 facts → 4 semantic clusters with OpenRouter embeddings).
**Consequences:** Documented as v1.1 work. The `runDreamingSweep` contract is stable.

## Dependency Graph

```
Phase 0 (CI + Node 22) ─────┬──▶ all subsequent phases run under Node 22
                            │
Phase 1 (ADR sweep) ────────┤    can run in parallel with Phase 0
                            │
                            ├──▶ Phase 2 (Voyage + DeepInfra adapters)
                            │
                            ├──▶ Phase 3 (Skills schema enforcement)
                            │
                            ├──▶ Phase 4 (Symbol.asyncDispose adoption)
                            │
                            └──▶ Phase 5 (Final integration + Changeset)
                                          │
                                          ▼
                                Phase 6 (Dogfood QA)
```

- **Phase 0** is the blocker for every other phase: nothing should be validated in Node 20.
- **Phase 1** is doc-only and can run in parallel with Phase 0.
- **Phases 2-4** can run in parallel after Phases 0 + 1 land.
- **Phase 5** consolidates: changelog, Changeset, version bump, README polish.
- **Phase 6** is the mandatory dogfood gate.

---

## Phase 0: CI + Node 22 validation

**Objective:** Validate the SDK in its declared Node 22.12+ engine. Eliminate every `WARN Unsupported engine` and the `knip` OOM.

### T0.1 — GitHub Actions CI matrix on Node 22

#### Objective
Add a `.github/workflows/ci.yml` (or update existing) that runs `pnpm install`, `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm validate`, `pnpm quality` on `node@22` (latest LTS).

#### Evidence
- `.nvmrc` declares `>=22.12.0`. All local validation in commits `c73b975`, `af0d99b`, `0180dce` ran in Node 20 with engine warnings.
- `pnpm quality:dead` OOMs in Node 20 at 4GB heap.

#### Files to edit
```
.github/workflows/ci.yml — (NEW or MODIFY) add Node 22 matrix entry, drop Node 18/20
.nvmrc — (verify it pins 22.12+; no change expected)
package.json — (verify "engines" field; no change expected)
.githooks/pre-push — (MODIFY) warn or fail if running Node <22.12
```

#### Deep file dependency analysis
- `.github/workflows/ci.yml`: defines the CI matrix. Downstream: every PR runs against this matrix.
- `.githooks/pre-push`: gates local pushes. Currently runs `pnpm check + quality`; add a Node version check at the top.
- `package.json` `engines`: contractual minimum; npm respects this when publishing.

#### Deep Dives
- **Matrix entries**: `node-version: ['22.12', '22-latest']`. The LTS minor is the floor; latest catches forward-compatibility issues.
- **Edge cases**: pnpm corepack pinning — workflow must `corepack enable && corepack prepare pnpm@9.15.0 --activate` BEFORE `pnpm install`.
- **Caching**: cache `~/.pnpm-store` keyed by `pnpm-lock.yaml` hash to keep CI fast.

#### Tasks
1. Audit existing `.github/workflows/` for any CI files.
2. Write `.github/workflows/ci.yml` with the Node 22 matrix.
3. Update `.githooks/pre-push` to gate on `node --version >= v22.12.0`. **Before `exit 1`, print an actionable message** so contributors immediately see the remediation (EC-1):
   ```sh
   echo "✗ pre-push: Node $(node --version) detected, but >=v22.12.0 is required."
   echo "  Run: nvm use   (respects .nvmrc)"
   exit 1
   ```
4. Run `pnpm install && pnpm test && pnpm validate && pnpm quality` locally under Node 22 (via `nvm use`) to confirm everything passes.

#### TDD
```
RED:     node22-ci-runs-test-suite — CI workflow file lints clean via `actionlint`
RED:     pre-push-blocks-old-node — pre-push hook exits 1 when NODE_VERSION starts with v20
RED:     pre-push-prints-remediation — stderr of failing hook includes "nvm use" (EC-1)
GREEN:   Implement workflow + hook gate
REFACTOR: None expected
VERIFY:  actionlint .github/workflows/ci.yml && bash -n .githooks/pre-push
```

#### Acceptance Criteria
- [ ] `.github/workflows/ci.yml` exists and passes `actionlint`
- [ ] Local `nvm use && pnpm validate` runs with zero engine warnings
- [ ] `pre-push` rejects when Node version starts with `v20.` or `v18.`
- [ ] CI green on the latest commit of `feat/sdk-implementation`

#### DoD
- [ ] All tasks completed
- [ ] CI runs green in Node 22 (verifiable via GitHub Actions UI)
- [ ] Zero engine warnings in any pnpm command output
- [ ] `pnpm quality:dead` (knip full) runs to completion in <60s

---

### T0.2 — knip full mode green under Node 22

#### Objective
Re-enable `pnpm quality:dead` (full knip, not the `--include` subset) and have it pass with zero dead-code findings.

#### Evidence
- This session's targeted knip run found `DreamingSweepResult` orphaned in the barrel (fixed). Full knip would have flagged more — but OOMs in Node 20.
- The `--include exports,types` subset is too narrow: misses dead files, unlisted deps, unresolved imports.

#### Files to edit
```
knip.json or knip.config.ts — (CREATE if missing) tune entry points + ignored paths
.gitignore — confirm dist/, referencia/, docs/evalscope/ are excluded
package.json — `quality:dead` script (verify it points at full mode)
```

#### Deep file dependency analysis
- `knip.json` is the only file knip reads for configuration. Entry points must include all 3 dist outputs (`index`, `cron`, `errors`).
- The script in `package.json` already invokes `knip` with no flags — that's full mode. Just needs to be runnable in Node 22.

#### Deep Dives
- **Entry points**: `packages/sdk/src/index.ts`, `packages/sdk/src/cron.ts`, `packages/sdk/src/errors.ts`.
- **Ignore globs**: `referencia/**`, `docs/evalscope/**`, `examples/**` (each example is its own micro-project).
- **Tests**: `tests/**/*.test.ts` are entry points for vitest, not orphans.

#### Tasks
1. Run `pnpm quality:dead` under Node 22 to surface real findings.
2. For each finding: either delete (if genuinely dead) or wire to a real caller.
3. Create/update `knip.json` with the surfaced entry points + ignore globs.
4. Re-run `pnpm quality:dead` until it exits 0.

#### TDD
```
RED:     knip-full-exits-zero — `pnpm quality:dead` finishes with exit 0 (no findings)
GREEN:   Fix all findings (either remove or wire)
REFACTOR: None expected — code cleanup only
VERIFY:  pnpm quality:dead
```

#### Acceptance Criteria
- [ ] `pnpm quality:dead` exits 0 in Node 22
- [ ] No file in `packages/sdk/src/**` is reported as orphaned
- [ ] Every public type in `dist/index.d.ts` has a real consumer (test, example, or doc snippet)

#### DoD
- [ ] All tasks completed
- [ ] knip green in CI (T0.1's matrix runs `pnpm quality`)
- [ ] knip green in pre-push hook

---

## Phase 1: Formalize Open Decisions (ADR sweep)

**Objective:** Empty the `Pending` rows in `packages/sdk/CLAUDE.md`. Every former Pending becomes a `Decided` ADR with rationale + date.

### T1.1 — Replace `Open Decisions` table with `Decided ADRs` table

#### Objective
Rewrite the table in `packages/sdk/CLAUDE.md` to reflect D3-D14 of this plan as decided (8 items from the original Pending list).

#### Evidence
- `packages/sdk/CLAUDE.md:178-196` contains the Open Decisions table with 8 `Pending` entries.
- Each Pending decision was already resolved implicitly by code; the ADR just locks the intent.

#### Files to edit
```
packages/sdk/CLAUDE.md — replace "Open Decisions" section with "Decided ADRs" (lines 178-196)
docs.md — add a "Stability & Versioning" section pointing at the ADR table for canonical decisions
.claude/knowledge-base/adrs/ — (NEW dir) one .md per ADR (D3..D14), short, ~30 lines each
```

#### Deep file dependency analysis
- `CLAUDE.md` is the contract between Claude and this repo. Removing Pending entries removes a continuous source of ambiguity.
- `docs.md` is the canonical public API contract; adding the stability section signals to consumers what's locked vs evolving.
- `.claude/knowledge-base/adrs/` is a new directory — each ADR file is the long-form rationale referenced by the table.

#### Deep Dives
- **ADR file format**: frontmatter (`id`, `status: Decided`, `date`, `superseded-by`), then sections (Context, Decision, Rationale, Consequences, Alternatives Considered).
- **Naming**: `adrs/D03-pi-standalone.md`, `adrs/D04-model-catalog.md`, etc.
- **CLAUDE.md table**: drops the `Status` column entirely (everything is `Decided`); keeps `ID`, `Decision`, `Rationale`, `Link to ADR`.

#### Tasks
1. Create `.claude/knowledge-base/adrs/` directory.
2. Write D3-D14 ADRs (12 files, ~30 lines each).
3. Edit `packages/sdk/CLAUDE.md` lines 178-196: replace the Pending table with the Decided table.
4. Add `## Stability & Versioning` section to `docs.md` pointing at the ADR directory.

#### TDD
```
RED:     no-pending-in-claude — `grep -c "Pending" packages/sdk/CLAUDE.md` returns 0
RED:     all-adrs-have-rationale — every D*.md file has a "## Rationale" header
GREEN:   Write the 12 ADR files + update CLAUDE.md + update docs.md
REFACTOR: None expected
VERIFY:  bash -c '[ $(grep -c "Pending" packages/sdk/CLAUDE.md) -eq 0 ]'
```

#### Acceptance Criteria
- [ ] Zero `Pending` in `packages/sdk/CLAUDE.md`
- [ ] 12 ADR files exist under `.claude/knowledge-base/adrs/`
- [ ] Each ADR has Context, Decision, Rationale, Consequences sections
- [ ] `docs.md` references the ADR directory in a Stability section

#### DoD
- [ ] All tasks completed
- [ ] `git diff packages/sdk/CLAUDE.md` shows only Pending-row removals + Decided-row additions
- [ ] CI green (this is doc-only; existing tests stay green)

---

## Phase 2: Ship Voyage + DeepInfra embedding adapters

**Objective:** Catalog grows from 3 → 5 real adapters. Voyage and DeepInfra are OpenAI-compatible and cheap to add; the remaining 3 (LMStudio, Google, Bedrock) stay deferred per D11.

### T2.1 — Voyage AI embedding adapter

#### Objective
Add `voyageMemoryEmbeddingProviderAdapter` using `createOpenAiCompatibleRuntime`. Voyage exposes `POST /v1/embeddings` at `https://api.voyageai.com` with OpenAI-compatible shape.

#### Evidence
- Voyage has a free tier (200M tokens/month for `voyage-3-lite`) — accessible for SDK users without credit card.
- API shape: `{ model, input }` → `{ data: [{ embedding }] }` — confirmed by Voyage docs at api.voyageai.com.
- Default model: `voyage-3-lite` (512 dims) or `voyage-3` (1024 dims).

#### Files to edit
```
packages/sdk/src/internal/memory/adapters/voyage-embedding.ts — (NEW) thin wrapper, ~30 LoC
packages/sdk/src/internal/memory/adapters/catalog.ts — add voyage to the map
packages/sdk/src/types/agent.ts — extend MemorySettings.index.embedding.provider union
packages/sdk/src/memory.ts — extend DreamingSweepOptions.embedding.provider union
packages/sdk/tests/golden/memory/multi-adapter.golden.test.ts — add Voyage stub-fetch test
packages/sdk/CHANGELOG.md — note the addition
```

#### Deep file dependency analysis
- `voyage-embedding.ts` is a leaf module — only imports from `openai-compatible.ts` + `embedding-adapter.ts`.
- `catalog.ts` is the central index. Adding voyage doesn't break existing tests because they don't enumerate the keys.
- Union types in `agent.ts` + `memory.ts` are widening, not narrowing — backward-compatible.

#### Deep Dives
- **Model dimension table**: `voyage-3-lite: 512`, `voyage-3: 1024`, `voyage-3-large: 1024`, `voyage-code-3: 1024`, `voyage-multilingual-2: 1024`.
- **Auth**: `Authorization: Bearer ${VOYAGE_API_KEY}` (same header as OpenAI).
- **Edge cases**: Voyage rejects empty input arrays — the shared factory already short-circuits on `text.trim().length === 0`.

#### Tasks
1. Create `voyage-embedding.ts` based on `openai-embedding.ts` shape.
2. Add `voyage` to `MEMORY_EMBEDDING_ADAPTERS` in `catalog.ts`.
3. Widen `provider` union in `types/agent.ts` and `memory.ts`.
4. Add stubbed-fetch test in `multi-adapter.golden.test.ts`.
5. Update CHANGELOG `[Unreleased]` section.

#### TDD
```
RED:     voyage-adapter-embeds-via-stubbed-fetch — runtime.embed returns 1024-dim vectors via stub fetch
RED:     catalog-includes-voyage — Object.keys(MEMORY_EMBEDDING_ADAPTERS).includes("voyage")
RED:     voyage-honors-api-key-env — adapter reads VOYAGE_API_KEY env when options.apiKey omitted
RED:     voyage-unlisted-model-uses-response-dimension (EC-4) — passing a model id NOT in DIMENSION_BY_MODEL and a stub-fetch response of 512-dim vectors must NOT zero-pad to default 1536; adapter should adopt the response.data[0].embedding.length as runtime dimension (and at minimum log a warning when the model id is unknown)
GREEN:   Implement adapter + register in catalog + widen union; in `openai-compatible.ts`, derive dimension from the FIRST response when the model is not in the hint table (replace the silent zero-pad fallback)
REFACTOR: None expected (factory already handles batching/cache)
VERIFY:  pnpm --filter @usetheo/sdk exec vitest run tests/golden/memory/multi-adapter.golden.test.ts
```

#### Acceptance Criteria
- [ ] `MEMORY_EMBEDDING_ADAPTERS.voyage` exists and is a real adapter
- [ ] Stubbed-fetch test asserts on response shape
- [ ] `Memory.runDreamingSweep({ embedding: { provider: "voyage" } })` typechecks
- [ ] `Agent.create({ memory: { index: { embedding: { provider: "voyage" } } } })` typechecks
- [ ] CHANGELOG entry under `[Unreleased]`

#### DoD
- [ ] All tasks completed
- [ ] `pnpm test` green (one new test added)
- [ ] `pnpm typecheck` green
- [ ] `pnpm quality` green

---

### T2.2 — DeepInfra embedding adapter

#### Objective
Add `deepinfraMemoryEmbeddingProviderAdapter` using `createOpenAiCompatibleRuntime`. DeepInfra exposes `POST /v1/openai/embeddings` at `https://api.deepinfra.com`.

#### Evidence
- DeepInfra hosts open-source embedding models (BGE, E5, Jina) at pay-per-token. Cheaper than OpenAI for most workloads.
- API is OpenAI-compatible at the `/v1/openai/embeddings` path.
- Default model candidate: `BAAI/bge-large-en-v1.5` (1024 dims) — popular, retrieval-focused.

#### Files to edit
```
packages/sdk/src/internal/memory/adapters/deepinfra-embedding.ts — (NEW) ~30 LoC
packages/sdk/src/internal/memory/adapters/catalog.ts — add deepinfra
packages/sdk/src/types/agent.ts — extend union
packages/sdk/src/memory.ts — extend union
packages/sdk/tests/golden/memory/multi-adapter.golden.test.ts — DeepInfra stub-fetch test
packages/sdk/CHANGELOG.md — note addition
```

#### Deep file dependency analysis
Same pattern as T2.1. Leaf module + catalog registration + union widening. No downstream consumers break.

#### Deep Dives
- **Base URL quirk**: DeepInfra's OpenAI compat lives at `/v1/openai/embeddings`, not `/v1/embeddings`. The shared factory hardcodes `/v1/embeddings` (verified in `openai-compatible.ts:174`).
- **URL composition spec (EC-2 — precise contract)**: extend `OpenAiCompatibleConfig` with `embeddingsPath?: string`. The factory composes the final URL as:
  ```ts
  const url = `${baseUrl.replace(/\/$/, "")}${cfg.embeddingsPath ?? "/v1/embeddings"}`;
  ```
  `embeddingsPath` **REPLACES** the hardcoded suffix — it does NOT concatenate after it. Consumers pass the full path starting with `/`.
- **Concrete configs**:
  - `openai`: `baseUrl="https://api.openai.com"`, `embeddingsPath` omitted → URL = `https://api.openai.com/v1/embeddings`
  - `mistral`: `baseUrl="https://api.mistral.ai"`, omitted → `https://api.mistral.ai/v1/embeddings`
  - `openrouter`: `baseUrl="https://openrouter.ai/api"`, omitted → `https://openrouter.ai/api/v1/embeddings`
  - `voyage`: `baseUrl="https://api.voyageai.com"`, omitted → `https://api.voyageai.com/v1/embeddings`
  - `deepinfra`: `baseUrl="https://api.deepinfra.com"`, `embeddingsPath="/v1/openai/embeddings"` → `https://api.deepinfra.com/v1/openai/embeddings`

#### Tasks
1. Extend `OpenAiCompatibleConfig` in `openai-compatible.ts` with `embeddingsPath?: string` (default `"/v1/embeddings"`).
2. Thread `embeddingsPath` through to the URL builder.
3. Update existing 3 adapters (openai, mistral, openrouter) to NOT pass `embeddingsPath` (use default).
4. Create `deepinfra-embedding.ts` with `embeddingsPath: "/v1/openai/embeddings"`.
5. Register in catalog, widen unions, add test, update CHANGELOG.

#### TDD
```
RED:     deepinfra-adapter-hits-exact-url (EC-2) — stubbed fetch sees full URL "https://api.deepinfra.com/v1/openai/embeddings" (not "/v1/openai/v1/embeddings" — guards against concatenation bug)
RED:     openai-adapter-still-hits-default-path — backward-compat: openai/mistral/openrouter/voyage URLs unchanged
RED:     embeddings-path-replaces-not-appends (EC-2) — given baseUrl="https://x.test" + embeddingsPath="/foo", composed URL is exactly "https://x.test/foo", not "https://x.test/foo/v1/embeddings"
GREEN:   Add embeddingsPath option to OpenAiCompatibleConfig (default "/v1/embeddings"); URL builder uses replacement semantics, never concatenation
REFACTOR: None expected
VERIFY:  pnpm --filter @usetheo/sdk test tests/golden/memory/multi-adapter
```

#### Acceptance Criteria
- [ ] `MEMORY_EMBEDDING_ADAPTERS.deepinfra` exists
- [ ] Existing openai/mistral/openrouter tests stay green (no URL regression)
- [ ] DeepInfra stub-fetch test asserts on `/v1/openai/embeddings` path
- [ ] CHANGELOG entry

#### DoD
- [ ] All tasks completed
- [ ] 5 adapters in catalog: openai, mistral, openrouter, voyage, deepinfra
- [ ] `pnpm test` green
- [ ] `pnpm validate` green

---

## Phase 3: Skills frontmatter strict schema (D10)

**Objective:** Enforce strict YAML frontmatter on skill files. Reject malformed skills with a typed error instead of silent acceptance.

### T3.1 — Add Zod-based frontmatter validator to skills-manager

#### Objective
Parse SKILL.md frontmatter against a Zod schema. Fail loudly on missing required fields, log warnings on unknown fields, expose validated metadata.

#### Evidence
- Current loader at `packages/sdk/src/internal/runtime/skills-manager.ts` accepts any frontmatter shape (or none). Consumers can't rely on `skill.description` being set.
- ADR D10 locks the schema.

#### Files to edit
```
packages/sdk/src/internal/runtime/skills-manager.ts — replace loose parse with Zod schema
packages/sdk/src/internal/runtime/skill-frontmatter.ts — (NEW) Zod schema + parser
packages/sdk/src/errors.ts — add `SkillSchemaError` if not present
packages/sdk/tests/golden/runtime/skills.golden.test.ts — (NEW or MODIFY) test the strict path
packages/sdk/CHANGELOG.md — BREAKING entry
```

#### Deep file dependency analysis
- `skills-manager.ts` is the loader. Tightening parsing is a breaking change for skills without frontmatter.
- `skill-frontmatter.ts` (new) isolates the schema. Future schema evolution edits only this file.
- `errors.ts` may already have a generic error class; check before adding.

#### Deep Dives
- **Schema**:
  ```ts
  z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    category: z.string().optional(),
    dependencies: z.array(z.string()).optional(),
  })
  ```
- **Migration**: old skills without frontmatter get `SkillSchemaError(code: "missing_frontmatter")`. Documented in CHANGELOG.
- **Backward compat**: NONE. This is a hard break. Justified because (a) Zod is already a peer dep, (b) D10 is the formal decision.

#### Tasks
1. Confirm `zod` is in peer deps.
2. Write `skill-frontmatter.ts` with the Zod schema + parser fn. **Wrap the YAML parse step in try/catch** so syntactically-invalid YAML (e.g. unclosed quote in a value) yields `SkillSchemaError(code: "schema_invalid")` instead of propagating the parser's exception (EC-5).
3. Wire `skills-manager.ts` to call the parser; surface errors via `process.stderr.write` (don't crash the agent — degrade to "skill skipped"). Cover three error codes:
   - `missing_frontmatter` — no `---` block at file head
   - `schema_invalid` — frontmatter present but YAML malformed OR Zod schema mismatch
   - both surface a stderr warning and exclude the skill from `skills.list()`
4. Add 5 tests: valid full schema, valid minimum (name+description only), invalid (missing name), invalid (missing description), invalid (malformed YAML).
5. Update CHANGELOG with BREAKING note + **migration snippet (EC-7)**: include the one-liner that lists skills needing frontmatter:
   ```sh
   # Find skills lacking YAML frontmatter
   grep -rL "^---$" .theokit/skills/*/SKILL.md
   ```

#### TDD
```
RED:     valid-skill-loads — full frontmatter passes
RED:     minimum-skill-loads — only name+description passes
RED:     missing-name-rejected — SkillSchemaError thrown with code "schema_invalid"
RED:     missing-frontmatter-rejected — SkillSchemaError with code "missing_frontmatter"
RED:     malformed-yaml-rejected (EC-5) — SKILL.md with unclosed quote in frontmatter yields SkillSchemaError(code: "schema_invalid"), agent.send() continues without crash
GREEN:   Implement parser + wire to manager
REFACTOR: Extract schema into its own file
VERIFY:  pnpm --filter @usetheo/sdk test skills
```

#### Acceptance Criteria
- [ ] Valid frontmatter loads with all fields available
- [ ] Missing required field surfaces typed error in stderr
- [ ] Agent.create with broken skill doesn't crash — logs + continues
- [ ] CHANGELOG documents the breaking change

#### DoD
- [ ] All tasks completed
- [ ] `pnpm test` green (4 new tests pass)
- [ ] Existing skill examples in `examples/` pass the new schema

---

## Phase 4: `Symbol.asyncDispose` adoption (D5)

**Objective:** Make `await using agent = await Agent.create(...)` work out of the box.

### T4.1 — Bump lib target + expose Symbol.asyncDispose on SDKAgent

#### Objective
Update `tsconfig.base.json` `lib` to include `ESNext.Disposable`. Declare `[Symbol.asyncDispose]` on the `SDKAgent` interface. Keep `dispose()` as an explicit alternative.

#### Evidence
- TypeScript 5.2+ supports `using` declarations. Real users will write `await using agent = ...`.
- The constructors of `LocalAgent` + `CloudAgent` already assign `(this as Record<symbol, unknown>)[Symbol.asyncDispose] = () => this.dispose()` (verified in `local-agent.ts:141` and `cloud-agent.ts:52`). Implementation exists; only the public type is missing.

#### Files to edit
```
tsconfig.base.json — bump lib to include ESNext.Disposable
packages/sdk/src/types/agent.ts — declare [Symbol.asyncDispose]() on SDKAgent interface
packages/sdk/src/internal/runtime/cloud-agent.ts — (EC-3) add `disposed` flag + idempotent guard in dispose()
packages/sdk/tests/contract/disposable.contract.test.ts — (NEW) verify await using works AND double-dispose is idempotent (EC-6)
docs.md — document the new usage pattern
README.md — quickstart uses await using
packages/sdk/CHANGELOG.md — entry under [Unreleased] (non-breaking — additive)
```

#### Deep file dependency analysis
- `tsconfig.base.json` is inherited by all packages. Bumping lib may surface latent type errors elsewhere — run typecheck after.
- `SDKAgent` interface change is purely additive (new method); existing implementations already provide it via the constructor assignment.

#### Deep Dives
- **TS lib targets**: `["ESNext", "DOM"]` likely current; need `["ESNext", "ESNext.Disposable", "DOM"]` or just `ESNext.Disposable` if not already covered.
- **Symbol shape**: `[Symbol.asyncDispose](): Promise<void>`. Already provided by `dispose()` chain.
- **Edge case**: TypeScript may emit `DisposableStack`/`AsyncDisposableStack` references. None needed — we only add the well-known symbol.

#### Tasks
1. Edit `tsconfig.base.json` `lib`.
2. Add `[Symbol.asyncDispose](): Promise<void>` to `SDKAgent` interface in `types/agent.ts`.
3. **Add idempotency guard to `CloudAgent.dispose()` (EC-3)** matching the existing `LocalAgent.disposed` pattern:
   ```ts
   private disposed = false;
   dispose(): Promise<void> {
     if (this.disposed) return Promise.resolve();
     this.disposed = true;
     return Promise.resolve();
   }
   ```
   This is preventive: today dispose is a no-op, but when v1.1 wires real PaaS calls (DELETE /v1/agents/{id}), double-dispose would emit duplicate HTTP requests.
4. Write contract test using `await using agent = ...` pattern.
5. Update `docs.md` quickstart + `README.md` quickstart to show the pattern.
6. CHANGELOG entry.

#### TDD
```
RED:     await-using-disposes-agent — after the `using` block, agent.dispose() was called exactly once
RED:     manual-dispose-still-works — explicit dispose() also works
RED:     double-dispose-idempotent (EC-6) — calling agent.dispose() twice (or `await using` + explicit) runs the dispose side-effect exactly once on BOTH LocalAgent AND CloudAgent
GREEN:   Add Symbol.asyncDispose to public type + bump lib + idempotency guard in CloudAgent
REFACTOR: None expected
VERIFY:  pnpm test tests/contract/disposable
```

#### Acceptance Criteria
- [ ] `await using agent = await Agent.create(...)` typechecks AND runtime-works
- [ ] Existing `await agent.dispose()` still works
- [ ] Quickstart docs show the `using` pattern as the primary form

#### DoD
- [ ] All tasks completed
- [ ] `pnpm typecheck` green (no latent errors from lib bump)
- [ ] `pnpm test` green
- [ ] CHANGELOG entry

---

## Phase 5: Final integration + Changeset

**Objective:** Bundle the work into a publishable v1.0.0 release.

### T5.1 — Create Changeset for v1.0.0

#### Objective
Run `pnpm changeset` to record the major version bump with summary. Auto-generated CHANGELOG section captures the full release scope.

#### Evidence
- Changesets is the locked versioning tool (`packages/sdk/CLAUDE.md:locked toolchain table`).
- CHANGELOG `[Unreleased]` is currently populated; needs migration to `[1.0.0] - 2026-MM-DD`.

#### Files to edit
```
.changeset/v1-ga.md — (NEW) Changeset entry with major bump + summary
packages/sdk/CHANGELOG.md — Changeset will auto-update; verify after `pnpm version-packages`
packages/sdk/package.json — version field; Changeset auto-bumps
```

#### Deep file dependency analysis
- `.changeset/v1-ga.md` declares the version bump. Format: frontmatter with `"@usetheo/sdk": major`, body is the summary.
- Running `pnpm version-packages` consumes the Changeset and emits CHANGELOG + version bump.
- `package.json` bump is automatic.

#### Deep Dives
- **Major bump rationale**: D5 (Symbol.asyncDispose) is additive but D10 (skills strict schema) is breaking. Two breakers + cumulative behavior changes = major.
- **Summary template**: link the ADR directory, the deep review doc, and the memory-system plan.

#### Tasks
1. Run `pnpm changeset` interactively; select `@usetheo/sdk` with `major` bump.
2. Paste a summary that references this plan + the ADR directory.
3. Run `pnpm version-packages` to materialize the version bump.
4. Verify `package.json` version is `1.0.0` and CHANGELOG `[1.0.0]` section is populated.
5. Commit + push.

#### TDD
```
RED:     changeset-file-exists — .changeset/v1-ga.md exists with major bump
RED:     version-bumped — package.json shows "version": "1.0.0"
RED:     changelog-section — CHANGELOG.md has a [1.0.0] section with date
GREEN:   Run the changeset workflow
REFACTOR: None
VERIFY:  cat packages/sdk/package.json | jq -r .version
```

#### Acceptance Criteria
- [ ] `.changeset/v1-ga.md` exists
- [ ] `packages/sdk/package.json` shows `"version": "1.0.0"`
- [ ] CHANGELOG `[1.0.0]` section exists with today's date
- [ ] `pnpm validate` (publint + attw) stays green after the version bump

#### DoD
- [ ] All tasks completed
- [ ] Version + CHANGELOG committed
- [ ] Branch ready for merge to `main` + npm publish

---

## Phase 6: Dogfood QA (MANDATORY)

> The plan is NOT done until this phase passes.

**Objective:** Validate the v1.0.0 build works as a real user would experience it.

### Execution

1. `nvm use` (Node 22.12+)
2. `pnpm install`
3. `pnpm validate` (must be all green)
4. Run all 5 memory examples (`memory`, `memory-search`, `memory-get`, `active-memory`, `memory-dreaming`) with real API keys.
5. Run 2 other example sweeps that touch new surfaces:
   - Skill loader: `examples/skills-walkthrough` (or create a minimal skill test)
   - `await using`: write a one-liner script that demonstrates the new pattern.
6. Smoke-test new embedding adapters: run dreaming with `{ provider: "voyage" }` and `{ provider: "deepinfra" }` against real APIs.

### Quota note (EC-8)
- **Voyage** has 200M tokens/month free for `voyage-3-lite` — dogfood smoke-tests use <1k tokens, negligible.
- **DeepInfra** is pay-per-token (no free tier on embeddings). Each dogfood run costs <$0.001 for the seeded MEMORY.md.
- Treat dogfood as a release-gate event (rare), not a CI loop. If a contributor runs Phase 6 repeatedly, they're responsible for their own quota.

### Acceptance Criteria

- [ ] All 5 existing dogfood examples still pass
- [ ] Voyage adapter produces real embeddings (verified via dream-diary entry)
- [ ] DeepInfra adapter produces real embeddings (verified via dream-diary entry)
- [ ] `await using` example runs and disposes cleanly
- [ ] Strict skills loader rejects a malformed test SKILL.md and the agent run continues
- [ ] `pnpm validate` exits 0 in Node 22

### If Dogfood Fails

1. Bisect: was the regression introduced by Phase 2, 3, or 4?
2. Fix the specific phase before declaring complete.
3. Re-run the full dogfood sweep.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Node 22 never validated | T0.1 | CI matrix on `node@22` + pre-push gate |
| 2 | Knip OOMs in Node 20 | T0.2 | Full knip runs in Node 22 (no OOM at SDK size) |
| 3 | Implement vs wrap `pi` | T1.1 (ADR D3) | ADR locks "stand-alone" — no `pi` imports |
| 4 | Model id catalog source-of-truth | T1.1 (ADR D4) | ADR locks "PaaS via `Theokit.models.list()`" |
| 5 | `Symbol.asyncDispose` not in public type | T4.1 (D5) | Bump lib + add to interface |
| 6 | `pnpm validate` strictness undefined | T1.1 (ADR D6) | ADR locks "strict on both publint + attw" |
| 7 | Cron scheduler library decision | T1.1 (ADR D7) | ADR locks `croner` |
| 8 | Cron persistence format decision | T1.1 (ADR D8) | ADR locks JSON file with atomic write |
| 9 | Memory namespace/scope defaults | T1.1 (ADR D9) | ADR locks `default/agent/default` |
| 10 | Skills frontmatter schema | T3.1 (D10) + T1.1 (ADR) | Zod schema enforced; ADR locks shape |
| 11 | 5 OpenClaw embedding adapters | T2.1 + T2.2 + T1.1 (ADR D11) | Ship Voyage + DeepInfra; ADR-defer remaining 3 to v1.1 |
| 12 | LanceDB backend | T1.1 (ADR D12) | ADR-defer to v1.1 |
| 13 | Active Memory subagent mode | T1.1 (ADR D13) | ADR-defer to v1.1 |
| 14 | Dreaming narrative LLM | T1.1 (ADR D14) | ADR-defer to v1.1 |

**Coverage: 14/14 gaps covered (100%)**

## Global Definition of Done

- [ ] All 7 phases completed (0 through 6)
- [ ] `pnpm test` green (Node 22) — target 200+ tests after new additions
- [ ] `pnpm validate` green (publint + attw + quality)
- [ ] `pnpm quality:dead` (full knip) green
- [ ] Zero `WARN Unsupported engine` in any command output
- [ ] Zero `Pending` entries in `packages/sdk/CLAUDE.md`
- [ ] 12 ADR files in `.claude/knowledge-base/adrs/`
- [ ] CHANGELOG `[1.0.0]` section dated and populated
- [ ] `packages/sdk/package.json` version is `1.0.0`
- [ ] `MEMORY_EMBEDDING_ADAPTERS` catalog: 5 entries (`openai`, `mistral`, `openrouter`, `voyage`, `deepinfra`)
- [ ] `await using agent = await Agent.create(...)` typechecks AND runtime-works
- [ ] All 5 dogfood examples + 2 new surfaces pass under Node 22 with real API keys
- [ ] Branch `feat/sdk-implementation` is mergeable to `main`

## Final Phase: Dogfood QA (MANDATORY)

Already specified above as Phase 6.

### Acceptance Criteria

- [ ] Health score >= 70/100 (informal: 5/5 examples pass, validate green, types resolve)
- [ ] Zero CRITICAL issues introduced by this plan
- [ ] Zero HIGH issues in commands/features modified by this plan
- [ ] Any pre-existing issues documented (not caused by this plan)

### If Dogfood Fails

1. Identify the failing phase via bisect on the phase commits.
2. Fix the specific failure before declaring complete.
3. Re-run dogfood until green.
