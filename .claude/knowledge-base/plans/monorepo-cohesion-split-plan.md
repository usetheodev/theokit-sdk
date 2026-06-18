---
slug: monorepo-cohesion-split
created_at: 2026-06-18
milestone_id: none
goal: Extract the non-Harness clusters (backend-DX, gateways, react, voice, rag, google-workspace skill) out of the theokit-sdk monorepo into their own git-history-preserving repositories, leaving @theokit/sdk as a cohesive Agent-AI Harness, with no backward-compatibility shims.
---

# Plan: Monorepo cohesion split — carve the Harness out of the bundle

> **Version 1.1** — Edge-case absorption (2026-06-18, from `knowledge-base/reviews/monorepo-cohesion-split-edge-cases-2026-06-18.md`): EC-1 (strip `origin` after filter-repo — see new § Extraction protocol), EC-2 (resolve examples *before/within* package deletion — re-sequenced into T7.1 step 0), EC-3/EC-4/EC-5 (tests added to TDD blocks). EC-6 verified `@theokit/sdk@1.9.0` is `latest` on npm — extracted repos pin `^1.9.0`.

> **Version 1.0** — The `theokit-sdk` monorepo today publishes ~28 packages spanning four conceptually distinct products: the Agent-AI Harness (the actual SDK), a generic Backend-DX framework (`di`/`di-agent`/`orm`/future `http-decorators`), a multi-channel messaging product (`gateway` + 11 platform adapters), and pillar-foreign artifacts (`react` → UI pillar, `skills-google-workspace` → Skills pillar). It also embeds application-layer features (`voice`, `rag`) inside the SDK core surface. This plan extracts every non-Harness cluster into its own repository under `usetheodev/`, preserving git history, and revokes the inviolable "decorators mandatory via `@theokit/di`" rule that is the root cause of the Backend-DX scope creep. The outcome: `@theokit/sdk` becomes a coherent "LEGO pieces for building agents" harness, and each extracted cluster gets independent versioning and release cadence. **No backward-compatibility is preserved** — breaking the public surface (removing `./rag`, `./voice` sub-paths; moving packages to new npm-published repos) is explicitly authorized.

## Goal

> "Extract the 6 non-Harness clusters out of `theokit-sdk` into git-history-preserving sibling repos so that the monorepo contains only the Harness set, measured by: (a) `node tools/check-cycles.mjs` + a clean-checkout `pnpm build` succeed on the trimmed monorepo; (b) a `dependency-cruiser` cross-cluster guard reports zero residual imports of any extracted package from the Harness; (c) each extracted repo builds green against `@theokit/sdk` consumed from npm."

## Context

The user audited the package inventory and asked, with extreme candor, whether every module belongs in an Agent-AI SDK. The honest answer was no: ~35-40% of the published surface is either generic backend infrastructure that violates Unbreakable Rule 9 ("don't reinvent the wheel" — a hand-rolled IoC container and an ORM), a parity-driven messaging product (11 chat-platform adapters), or material that belongs to other Theo pillars (`react` → `@theokit/ui`; `skills-google-workspace` → the `theokit` Skills repo). The project's own mantra ([[project_sdk_mantra]]) is "LEGO pieces to build any agent, never a pre-assembled app", and the root `CLAUDE.md` locks a four-pillar split (UI · Harness · Skills · Runtime) where the SDK is the **Harness**. The current bundle contradicts both.

The user locked four decisions in conversation (2026-06-18): (1) **aggressive** scope — extract Backend-DX + gateways + core-edge features + the google-workspace skill; (2) **separate repos** preserving git history via `git filter-repo`/`subtree`; (3) gateways (core + 11 adapters) go to one `theokit-gateways` repo; (4) **revoke** the decorators-mandatory rule (`CLAUDE.md:256`, established 2026-06-10) via ADR — it is the cascade that justified `di` → `di-agent` → `orm` → `http-decorators`.

This plan also coordinates with the active `npm-release-pipeline-fix` plan (Phase B — the changesets 0.x→1.0.0 cascade is still pending). Removing the leaving packages *shrinks* the cascade surface; the remaining Harness packages still carry mixed dependency specifiers (`workspace:^` vs `>=1.7.0` vs `^1.3.0`) that must be normalized.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `CLAUDE.md` (project) | 302 | `96f9824` (2026-06-10) | Project contract: locked names, pillars, inviolable rule 9 (decorators) | Pillar narrative stays accurate; rule 9 is the edit target |
| `turbo.json` | 53 | `6af4e16` (2026-06-15) | Build task graph; carries `@theokit/sdk#build` + `@theokit/sdk-memory#build` overrides | The one-way `sdk-memory → sdk` edge (fixed by active plan) must survive |
| `knip.json` | 78 | `d2e5b2b` (2026-06-15) | Dead-code config with per-gateway-package entries | After trim, must reference only Harness packages |
| `.dependency-cruiser.cjs` | 97 | `5e780ac` (2026-06-11) | Import-boundary rules; references `rag/a2a/client/voice/server` paths | Becomes the cross-cluster guard host (new forbidden rule) |
| `docs.md` | 3112 | `5b03c53` (2026-06-15) | Canonical public API contract (source of truth) | Must reflect the reduced Harness surface; remove gateway/di/orm/react/rag/voice sections |
| `.github/workflows/release.yml` | 57 | `8a13fd4` (2026-06-15) | CI/OIDC-only publish of all packages | Publishes only the Harness set after trim; OIDC/token path untouched |
| `.changeset/config.json` | 14 | `461c020` (2026-06-15) | Changesets config (`updateInternalDependencies: patch`) | Harness-only after trim |
| `pnpm-workspace.yaml` | 3 | `520fe7d` (2026-05-30) | Workspace member globs (`packages/*`, `examples/*`) | Glob stays; membership shrinks by removal |
| `packages/sdk/package.json` | 295 | `8a13fd4` (2026-06-15) | The Harness package manifest; exports `./rag ./a2a ./client ./sandbox ./subscription` etc. | Remove `./rag` + `./voice` exports; keep all genuinely-Harness sub-paths |
| `packages/sdk/src/index.ts` | 187 | `49b56b9` (2026-06-15) | Public barrel | Remove any rag/voice re-exports |
| `packages/sdk/src/rag/` (dir, 5 ts) | 514 | `ed731c2` (2026-06-10) | RAG (retrieval) embedded in core; exported as `./rag` | Carved out — extract or delete per Phase 5 investigation |
| `packages/sdk/src/voice/` (dir, 3 ts) | 258 | `94e331a` (2026-06-11) | Voice I/O embedded in core | Carved out — extract or delete per Phase 5 investigation |
| `packages/di/package.json` | 70 | `8a13fd4` (2026-06-15) | Generic IoC container (no `@theokit/sdk` dep) | npm name `@theokit/di` + version `0.1.1` preserved in new repo |
| `packages/di-agent/package.json` | 69 | `8a13fd4` (2026-06-15) | REQUEST-scoped Agent factory; dep `@theokit/sdk ^1.3.0` | npm name + version `0.2.0` preserved; sdk becomes external dep |
| `packages/orm/package.json` | 92 | `8a13fd4` (2026-06-15) | Repository pattern over drizzle; dep `@theokit/di` | npm name + version `0.1.0-next.1` preserved |
| `packages/gateway/package.json` | 45 | `7ed0c42` (2026-06-03) | Multi-platform core; dep `@theokit/sdk workspace:^` | npm name + version `0.4.0`; sdk becomes external dep |
| `packages/react/package.json` | 57 | `8a13fd4` (2026-06-15) | React hooks; dep `@theokit/sdk ^1.1.0` | npm name + version `1.1.0` preserved |
| `tools/check-cross-cluster.mjs` (NEW) | 0 | — | (to be created) — guard that no Harness file imports an extracted package | — |
| `knowledge-base/adrs/D431-revoke-decorators-mandatory.md` (NEW) | 0 | — | (to be created) — ADR revoking rule 9 | — |

> Per-package extraction touches every file under `packages/{di,di-agent,orm,gateway,gateway-*,react,skills-google-workspace}/**`. They are moved wholesale (history-preserving), not edited line-by-line, so they are represented by their manifest rows above rather than enumerated individually.

### Current callers / dependents

- **Symbol:** the `./rag` sub-path export of `@theokit/sdk` (`packages/sdk/package.json`)
  - **Callers (production):** none in Harness core (`rag/` is leaf-exported, not imported by the agent loop) — to be confirmed by T5.1 grep.
  - **External (public API):** yes — any consumer importing `@theokit/sdk/rag`. No-retrocompat authorized; removal is a breaking change documented in CHANGELOG.
- **Symbol:** `./voice` / `packages/sdk/src/voice` — same shape as `./rag`; confirm zero core importers (T5.1).
- **Symbol:** `@theokit/sdk` package — consumed by every leaving cluster (`di-agent ^1.3.0`, `gateway* workspace:^`, `react ^1.1.0`). After extraction each consumes the **published npm** `@theokit/sdk` (1.8.x already on npm), not a workspace link.
- **Cross-package tests in `packages/sdk/tests`** importing other `@theokit/*` (verified via grep): `peer-parity.test.ts`, `codemod-1-x-to-2-0.test.ts`, `memory-class-peer-routing.test.ts`, `migrate-peer-routing.test.ts`, `budget-tracker-interface.test.ts`, `memory-provider-interface.test.ts`, `docs-sdk-2-0.test.ts`, `sdk-2-0-npm-publish-readiness.test.ts`. These reference `@theokit/sdk-memory`/`sdk-budget` — **all in the Harness set (staying)** — so they are unaffected by extraction. Confirm in T7.3.

### Domain glossary

- **Harness** — the Theo pillar that runs agents: the agent loop, tool dispatch, runtime (local/cloud), MCP, hooks, plugins, providers. `@theokit/sdk` is the Harness.
- **Cluster** — a group of packages that form one product/concern (Backend-DX, Gateways, etc.).
- **Sub-path export** — an npm `exports` map entry like `@theokit/sdk/rag` that ships part of a package as a separately-imported module.
- **Cascade (changesets)** — the version-bump propagation `changeset version` applies to dependents; mixed dependency specifiers make it over-bump pre-1.0 packages to `1.0.0`.
- **History-preserving extraction** — using `git filter-repo`/`subtree split` so the new repo retains the commits that touched the moved files, not a flat copy.

### Architecture boundaries affected

From `rules/architecture.md`: the §1 layering (interface → application → domain ← infrastructure) and §3 module cohesion ("a module answers one question"). This plan operates one level up — at the **repo/package** boundary — enforcing that the `theokit-sdk` repo answers exactly one question ("how do I run an agent?"). It introduces a **new** boundary rule in `.dependency-cruiser.cjs`: the Harness MUST NOT import any extracted package. It also touches the cross-project pillar boundary in the root `CLAUDE.md` (UI · Harness · Skills · Runtime).

## Prior Art & Related Work

- **Internal — active plan** `knowledge-base/plans/npm-release-pipeline-fix-plan.md` — its Phase B (changesets cascade on mixed specifiers) is the same dependency-specifier problem this plan must normalize for the remaining Harness packages. Coordinated, not duplicated.
- **Internal — `[[project_sdk_mantra]]`** memory: "LEGO pieces to build any agent, never a pre-assembled app" — the motivating principle for the split.
- **Internal — `[[feedback_decorators_mandatory]]`** memory + `CLAUDE.md:256` — the rule this plan revokes; the memory must be updated/deleted alongside the ADR.
- **External — `git-filter-repo`** (https://github.com/newren/git-filter-repo) — the maintainer-recommended successor to `git filter-branch` for history-preserving subtree extraction. Relevance: the extraction mechanism for every cluster.
- **External — pnpm workspaces + Changesets multi-repo** (https://pnpm.io/workspaces) — each extracted repo becomes its own independent pnpm+changesets workspace, mirroring the current monorepo's release machinery.
- **Unbreakable Rule 9** (`CLAUDE.md` global § 9) — "don't reinvent the wheel": the rationale for questioning a hand-rolled DI container and ORM against mature `inversify`/`tsyringe`/`drizzle`.

## Objective

- [ ] Sub-goal 1 — Revoke the decorators-mandatory rule via ADR D431; update `CLAUDE.md`, the root pillar table, and the `[[feedback_decorators_mandatory]]` memory.
- [ ] Sub-goal 2 — Extract `theokit-backend-dx` (`di`, `di-agent`, `orm`) with history; it builds green against npm `@theokit/sdk`.
- [ ] Sub-goal 3 — Extract `theokit-gateways` (`gateway` + 11 adapters) with history; it builds green.
- [ ] Sub-goal 4 — Extract `theokit-react` (`react`) with history; it builds green.
- [ ] Sub-goal 5 — Resolve `voice`/`rag`: carve out of `packages/sdk/src/`, remove the `./rag` + `./voice` exports, and either extract to a repo or delete (per T5.1 maturity finding).
- [ ] Sub-goal 6 — Relocate `skills-google-workspace` into the `theokit` (Skills pillar) repo.
- [ ] Sub-goal 7 — Trim the monorepo (workspace globs, `turbo.json`, `knip.json`, `.dependency-cruiser.cjs`, `release.yml`, `.changeset`, `docs.md`, `README.md`) to the Harness set; add the cross-cluster import guard; normalize remaining dependency specifiers.

## ADRs

### D431 — Revoke "decorators mandatory via `@theokit/di`"; factory functions are the canonical API
- **Decision:** Rescind the inviolable rule at `CLAUDE.md:256` (established 2026-06-10). Factory functions (`defineTool`, `createAgentFactory`, etc.) become the sole canonical, always-present API. A decorator surface becomes an OPTIONAL convenience that a consumer may add via the externally-published `@theokit/di` (now in `theokit-backend-dx`).
- **Rationale:** The rule forced `@theokit/sdk` (and the whole ecosystem) to ship a generic IoC container, which then justified `di-agent`, `orm`, and a planned `http-decorators` — a hand-rolled re-implementation of what `inversify`/`tsyringe`/`NestJS` already provide (violates Unbreakable Rule 9). Removing the rule removes the structural pull toward Backend-DX scope creep. KISS + YAGNI: the SDK needs factories, not a DI framework.
- **Alternatives considered:** (a) *Keep the rule, keep `@theokit/di` as an external dep of the Harness* — rejected: re-introduces the coupling that makes the Harness depend on a generic framework, and keeps the "every feature must ship decorators" tax. (b) *Keep decorators via a ~50-LoC internal helper* — rejected: still mandates a second API surface per feature with no proven demand (YAGNI); the user chose full revocation.
- **Consequences:** Enables a clean Harness with one primitive surface. Constrains: any code/docs that currently advertise the decorator-first DX must be reframed as factory-first; the `[[feedback_decorators_mandatory]]` memory must be deleted/rewritten.

### D432 — Extract by cluster into git-history-preserving sibling repos (not delete, not in-place)
- **Decision:** Each leaving cluster moves to a new repo under `usetheodev/` (`theokit-backend-dx`, `theokit-gateways`, `theokit-react`) via `git filter-repo`, preserving the commit history of the moved paths. Packages keep their npm name + current version and consume `@theokit/sdk` from npm.
- **Rationale:** The user chose "separate repos preserving history". History matters for `git blame`/audit on code that is still maintained. Each cluster gets independent release cadence, which is the point of de-bundling.
- **Alternatives considered:** (a) *Delete + npm-deprecate* — rejected by the user; some clusters (gateways) are real products. (b) *Move to `packages-incubator/` in-place* — rejected: keeps the maintenance and config weight inside the Harness repo, defeating cohesion.
- **Consequences:** Enables independent versioning. Constrains: extraction is a multi-repo operation (each new repo needs its own toolchain scaffold + CI); cross-repo refactors get harder (acceptable — these clusters are decoupled by design).

### D433 — Harness MUST NOT import any extracted package; enforce with a dependency-cruiser guard
- **Decision:** Add a `forbidden` rule in `.dependency-cruiser.cjs` (and a standalone `tools/check-cross-cluster.mjs` for CI) asserting that no file under `packages/sdk/src/**` imports `@theokit/di`, `@theokit/orm`, `@theokit/gateway*`, `@theokit/react`, or the removed `rag`/`voice` modules.
- **Rationale:** Cohesion is only durable if regression is mechanically blocked. The existing depcruiser config already governs `packages/sdk/src` boundaries — extend it. DIP/§4 of `architecture.md`: boundaries are enforced by tooling, not goodwill.
- **Alternatives considered:** (a) *Rely on review* — rejected: humans miss imports; the active release plan already shows how an invisible build edge (sdk↔sdk-memory) festered. (b) *Use knip only* — rejected: knip finds dead code, not boundary violations.
- **Consequences:** Enables fail-loud regression protection. Constrains: legitimate future re-coupling requires explicitly editing the guard (good — forces a conscious decision).

### D434 — `voice` and `rag` are application-layer, not Harness primitives; remove their sub-path exports
- **Decision:** Carve `packages/sdk/src/voice` and `packages/sdk/src/rag` out of the core and drop the `./voice` (if present) and `./rag` entries from `packages/sdk/package.json` `exports`. Final destination (own repo vs delete) is decided by the T5.1 maturity probe.
- **Rationale:** RAG is a retrieval *technique* and voice is *I/O* — both are things you build *with* an agent, not parts of the harness that runs one. They are leaf sub-paths, not imported by the agent loop, so removal does not touch the runtime.
- **Alternatives considered:** (a) *Promote to `@theokit/sdk-rag` / `@theokit/sdk-voice` packages staying in the monorepo* — viable; kept as the fallback if T5.1 finds them mature and Harness-adjacent enough. (b) *Leave embedded* — rejected: keeps the surface bloated and contradicts the cohesion goal.
- **Consequences:** Breaking change to the public surface (authorized — no retrocompat). Shrinks the `docs.md` contract.

### D435 — Normalize remaining Harness dependency specifiers to one convention
- **Decision:** After extraction, set every intra-Harness `@theokit/*` dependency declaration to a single convention (`workspace:^` for in-repo, published-range otherwise), eliminating the `>=1.7.0` / `^1.3.0` / `workspace:^` mix.
- **Rationale:** The mixed specifiers are the documented root of the changesets `0.x→1.0.0` cascade (active plan Phase B). With the cascade surface shrunk by extraction, normalizing the survivors closes Phase B for the Harness.
- **Alternatives considered:** (a) *Leave as-is and fix only in the active plan* — rejected: the extraction changes which packages remain, so the normalization must happen here to keep `changeset status` correct. (b) *Pin exact versions* — rejected: over-tight, breaks workspace linking ergonomics.
- **Consequences:** Enables a correct `changeset status` on the trimmed monorepo. Constrains: one declaration style enforced going forward.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Extracted repos lose workspace-link convenience; must publish `@theokit/sdk` before they can build against a new version | Medium | Extracted clusters consume the already-published npm `@theokit/sdk` (1.8.x live); document the "bump-then-publish-sdk-first" order in each repo README | Maintainer |
| History-preserving extraction (`git filter-repo`) is irreversible and easy to misconfigure (wrong path globs → lost commits) | High | Run `filter-repo` on a fresh clone, never the working repo; verify commit count + `git log` of a known file in the new repo before pushing; keep the source monorepo untouched until verification passes | Maintainer |
| Removing `./rag` + `./voice` exports breaks any external consumer importing them | Medium | Authorized (no retrocompat); announce in CHANGELOG `Removed` + a MIGRATION note; T5.1 confirms no internal importer first | Maintainer |
| `skills-google-workspace` move into `theokit` repo may collide with that repo's conventions | Medium | Treat as a separate sub-task gated on inspecting `theokit` repo layout; if it doesn't fit cleanly, fall back to `theokit-skills-google-workspace` standalone | Maintainer |
| The active `npm-release-pipeline-fix` Phase B and this plan both touch `.changeset` + specifiers — risk of conflicting edits | Medium | This plan supersedes Phase B for leaving packages and absorbs it (D435) for survivors; close the active plan's Phase B as "absorbed" before merging this | Maintainer |
| `di`/`orm` have no `@theokit/sdk` dep but `orm` depends on `@theokit/di` — extracting them to the same repo keeps that link intact only if both move together | Low | Backend-DX repo includes `di` + `di-agent` + `orm` as one workspace, preserving the intra-cluster link | Maintainer |

## Unresolved Questions

- Q1 — Are `voice` (258 LoC) and `rag` (514 LoC) mature enough to warrant their own repos, or are they skeletons that should be deleted? (Resolved by T5.1 maturity probe before any extraction decision.)
- Q2 — Does the `theokit` (Skills pillar) repo have a packages workspace that `skills-google-workspace` can drop into, or does it need a standalone repo? (Resolved by T6.1 inspection.)
- Q3 — Do any examples under `examples/**` import the leaving packages (gateways especially)? If so, do the examples move with the cluster or get deleted? (Resolved by T7.4 grep of `examples/`.)
- Q4 — Will the new repos be created under the `usetheodev` org with the same `github-usetheo` SSH alias, and who creates them (human gate — repo creation is an outward-facing irreversible action)?

## Dependency Graph

```
Phase 0 (pre-flight: repos created + maturity probe + guard contract)
   │
   ▼
Phase 1 (revoke decorators rule + ADR D431)   ── independent, can run parallel to Phase 0
   │
   ▼
Phase 2 (extract backend-dx) ─┐
Phase 3 (extract gateways)   ─┤  (Phases 2,3,4 parallel — independent clusters,
Phase 4 (extract react)      ─┘   each a separate filter-repo run)
   │
   ▼
Phase 5 (carve voice/rag from core src/ + drop exports)  ── depends on T5.1 (in Phase 0)
   │
   ▼
Phase 6 (relocate google-workspace skill)   ── depends on Q2/T6.1
   │
   ▼
Phase 7 (trim monorepo configs + docs + guard + specifier normalization)  ── BLOCKS on 2-6
   │
   ▼
Final Phase: Integration Validation (clean build + guard + changeset status)
```

Phases 2/3/4 are independent extraction runs and may proceed in parallel. Phase 7 is the synchronization barrier: it can only finalize once every package has left, because it removes them from the workspace and asserts the guard.

---

## Extraction protocol (applies to every filter-repo task: T2.1, T3.1, T4.1, T5.1, T6.1)

Shared, non-negotiable procedure absorbed from the edge-case review (EC-1, EC-4, EC-5). Each extraction task's Tasks list references this protocol rather than repeating it:

1. **Fresh clone, never in-place.** `git clone /home/paulo/Projetos/usetheo/theokit-tools/theokit-sdk /home/paulo/Projetos/usetheo/theokit-tools/<target>-tmp` then run `git filter-repo` inside the clone. The source monorepo is NEVER filter-repo'd in place.
2. **Strip origin (EC-1).** Immediately after filter-repo: `git -C <clone> remote remove origin` (idempotent). **No remote is configured** — extracted repos are local-only folders under `../` (`theokit-tools/`) until the human creates the GitHub repo. This makes an accidental push to the source `theokit-sdk` origin impossible.
3. **Deterministic capture set (EC-4).** Use explicit `--path packages/<name>` per package OR `--path-glob 'packages/<prefix>*'`; never rely on a bare prefix that could over/under-capture. After extraction assert the member count equals the intended set.
4. **History-equality verification (EC-5).** Before extraction, record `git log --oneline -- <path> | wc -l` in the source. After extraction, assert the clone's count for the same path **equals** the source count (equality — a flat copy yields 1, a bad glob yields a mismatch).
5. **Final location.** Move the verified clone to its final folder name under `../` (e.g. `theokit-tools/theokit-backend-dx`), dropping the `-tmp` suffix.

---

## Phase 0: Pre-flight — targets, maturity probe, guard contract

**Objective:** Establish the irreversible prerequisites (target repos, voice/rag fate, examples impact) before any history rewrite.

### T0.1 — Create the three target repositories (human gate)

#### Objective
Have empty `usetheodev/theokit-backend-dx`, `theokit-gateways`, `theokit-react` repos to push extracted history into.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — creates three remote repos under the same org + SSH alias as `theokit-sdk`.
2. **Why it is necessary now** — `git filter-repo` produces a rewritten local repo that must be pushed somewhere; creating the target last would block every extraction phase. Repo creation is outward-facing and irreversible, so it is a human-approval gate (cites Unresolved Q4).

#### Evidence
Current remote is `git@github-usetheo:usetheodev/theokit-sdk.git` (verified via `git remote -v`). Sibling pillar repos already live under `theokit-tools/` (`theokit`, `theo-ui`).

#### Files to edit
```
(none — remote infrastructure; performed by the human via gh/web UI)
```

#### Deep file dependency analysis
No files in this repo change. The output is three reachable remotes consumed by T2.1/T3.1/T4.1.

#### Tasks
1. Human creates the 3 private repos under `usetheodev`.
2. Confirm SSH push access with the `github-usetheo` alias.

#### TDD
```
RED:     `git ls-remote git@github-usetheo:usetheodev/theokit-backend-dx.git` errors (repo absent)
GREEN:   the same command returns cleanly (empty repo OK) for all 3
REFACTOR: None expected
VERIFY:  all three `git ls-remote` exit 0
```

#### Acceptance Criteria
- [ ] Three remotes reachable.

#### DoD
- [ ] All three `git ls-remote` succeed.

### T0.2 — Maturity probe for `voice` and `rag` (resolves Q1)

#### Objective
Decide, with evidence, whether `voice`/`rag` get their own repos or are deleted.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — audits the two embedded modules for real callers, test depth, and runtime wiring, then records an extract-vs-delete verdict.
2. **Why it is necessary now** — Phase 5's branch (extract vs delete, per ADR D434) depends on the finding; deciding mid-extraction would stall the loop. Pre-flight is the only place this can be resolved without blocking.

#### Evidence
`packages/sdk/src/rag` = 514 LoC / 5 ts (`ed731c2`); `packages/sdk/src/voice` = 258 LoC / 3 ts (`94e331a`). Both are exported sub-paths per `packages/sdk/package.json` (`./rag` confirmed; `./voice` to verify). The agent loop (`internal/agent-loop/`) does not reference them (to be confirmed by grep).

#### Files to edit
```
knowledge-base/discoveries/voice-rag-maturity-probe.md (NEW) — findings + extract/delete recommendation
```

#### Deep file dependency analysis
The probe file is a new investigation artifact; it has no downstream code dependents, but its verdict drives T5.1's branch.

#### Tasks
1. `grep -rln 'src/rag\|/rag\b\|src/voice' packages/sdk/src --include=*.ts | grep -v '/rag/\|/voice/'` — count internal importers.
2. Count tests exercising each (`packages/sdk/tests`).
3. Check `examples/**` for `@theokit/sdk/rag` / voice usage.
4. Record recommendation: own-repo vs delete (D434 fallback).

#### TDD
```
RED:     (investigation task — verification is the documented finding, not a code unit test)
GREEN:   knowledge-base/discoveries/voice-rag-maturity-probe.md exists with a per-module verdict + grep counts
REFACTOR: None expected
VERIFY:  the probe file names a verdict (extract|delete) per module with caller-count evidence
```

#### Acceptance Criteria
- [ ] Each module has a documented verdict with caller-count evidence.

#### DoD
- [ ] Probe file written; Q1 marked resolved in this plan.

### T0.3 — Author the cross-cluster guard contract (D433)

#### Objective
Define the forbidden-import list before extraction so Phase 7 can assert it.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — writes the guard spec listing which `@theokit/*` names the Harness must never import.
2. **Why it is necessary now** — authoring it in pre-flight lets each extraction phase sanity-check against it incrementally rather than discovering violations only at the Phase 7 barrier (cites ADR D433).

#### Evidence
`.dependency-cruiser.cjs` (`5e780ac`, 97 LoC) already defines `forbidden` rules scoped to `packages/sdk/src/**` — the natural host for the new rule.

#### Files to edit
```
knowledge-base/discoveries/cross-cluster-guard-spec.md (NEW) — the forbidden name list + rationale
```

#### Deep file dependency analysis
Spec consumed by T7.2 to write the depcruiser rule + `tools/check-cross-cluster.mjs`.

#### Tasks
1. Enumerate the npm names of every leaving package.
2. Write the forbidden-list spec (consumed by T7.2).

#### TDD
```
RED:     spec file absent
GREEN:   spec lists @theokit/di, di-agent, orm, gateway, gateway-*, react + rag/voice modules
REFACTOR: None expected
VERIFY:  grep the spec for each leaving package name → all present
```

#### Acceptance Criteria
- [ ] Spec complete and matches the extraction set.

#### DoD
- [ ] Spec file written.

---

## Phase 1: Revoke the decorators-mandatory rule (root cause)

**Objective:** Remove the structural pull toward Backend-DX by rescinding rule 9 via ADR.

### T1.1 — Write ADR D431 and update `CLAUDE.md` + memory

#### Objective
Make factory-functions the canonical API and decorators optional, on the record.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — authors ADR D431 and edits `CLAUDE.md:256` + the root pillar narrative + the `[[feedback_decorators_mandatory]]` memory.
2. **Why it is necessary now** — it is the conceptual justification for extracting the entire Backend-DX cluster; extracting `di` while the rule still mandates it would be self-contradictory. Runs early (parallel to Phase 0) so the later extraction phases are not retroactively invalid (cites ADR D431).

#### Evidence
`CLAUDE.md:256` — "Decorators mandatory for agentic features … MUST ship with a `@Decorator` API surface via `@theokit/di`". `MEMORY.md` indexes `[[feedback_decorators_mandatory]]`.

#### Files to edit
```
knowledge-base/adrs/D431-revoke-decorators-mandatory.md (NEW) — the revocation ADR
CLAUDE.md — remove/rewrite inviolable rule 9 (line 256); adjust "Decided ADRs" range note
(user memory) feedback_decorators_mandatory.md — rewrite to "revoked; factory-first" (or delete + update MEMORY.md)
```

#### Deep file dependency analysis
`CLAUDE.md` is the project contract read at session start; rule 9 currently gates "every new agentic capability". Removing it means `quality-review`/`review` skills stop enforcing a decorator surface. The memory file is loaded into context each session — it must not keep asserting a revoked rule.

#### Tasks
1. Write ADR D431 (decision, rationale citing Rule 9 + KISS/YAGNI, alternatives, consequences).
2. Replace `CLAUDE.md` rule 9 with a factory-first statement (decorators optional via external `@theokit/di`).
3. Rewrite the memory file; update `MEMORY.md` pointer line.
4. CHANGELOG `[Unreleased] § Changed` entry referencing D431.

#### TDD
```
RED:     grep "Decorators mandatory" CLAUDE.md  → still present (pre-edit)
GREEN:   same grep returns nothing; ADR D431 file exists; memory no longer asserts "mandatory"
REFACTOR: None expected
VERIFY:  grep -rn "MUST ship with a" CLAUDE.md → empty
```

#### Acceptance Criteria
- [ ] ADR D431 exists with ≥1 rejected alternative.
- [ ] `CLAUDE.md` rule 9 rewritten; no "mandatory decorator" language remains.
- [ ] Memory + `MEMORY.md` consistent with the revocation.
- [ ] CHANGELOG updated.

#### DoD
- [ ] Greps green; ADR present.

---

## Phase 2: Extract `theokit-backend-dx` (`di`, `di-agent`, `orm`)

**Objective:** Move the Backend-DX cluster to its own history-preserving repo that builds against npm `@theokit/sdk`.

### T2.1 — filter-repo extraction of `packages/{di,di-agent,orm}`

#### Objective
A `theokit-backend-dx` repo containing the three packages with their commit history.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — runs `git filter-repo --path packages/di --path packages/di-agent --path packages/orm` on a fresh clone, then scaffolds a workspace around the result.
2. **Why it is necessary now** — these three move together because `orm` depends on `@theokit/di` (intra-cluster link, per ADR D432); splitting them across repos would break that link. Done after Phase 1 so the cluster is no longer mandated by rule 9.

#### Evidence
`di` `0.1.1` (no sdk dep), `di-agent` `0.2.0` (`@theokit/sdk ^1.3.0`), `orm` `0.1.0-next.1` (`@theokit/di`). Verified via package.json grep.

#### Files to edit
```
(in the NEW theokit-backend-dx repo, post-filter-repo)
package.json (NEW) — workspace root (private, pnpm)
pnpm-workspace.yaml (NEW) — packages/*
tsconfig.base.json, biome.json, .nvmrc, .changeset/config.json (NEW) — copied + trimmed from sdk repo
.github/workflows/release.yml (NEW) — CI/OIDC publish for the 3 packages
packages/di-agent/package.json — change @theokit/sdk to a published range (drop workspace:)
packages/orm/package.json — keep @theokit/di as workspace:^
CHANGELOG.md (NEW)
```

#### Deep file dependency analysis
`di-agent` currently declares `@theokit/sdk ^1.3.0` — in the new repo there is no sdk workspace member, so it must resolve from npm. `orm`'s `@theokit/di` stays a workspace link (both in the new repo).

#### Tasks
1. Fresh clone → `git filter-repo` with the 3 paths.
2. Scaffold workspace root + toolchain configs (copy-trim from sdk repo).
3. Rewrite `di-agent`'s sdk dep to the published range.
4. `pnpm install && pnpm build && pnpm test` in the new repo.
5. Push to `usetheodev/theokit-backend-dx`.

#### TDD
```
RED:     in a fresh clone with no scaffold, `pnpm build` fails (no workspace root)
GREEN:   after scaffold + dep rewrite, `pnpm -r build` green; `pnpm -r test` green
REFACTOR: None expected
VERIFY:  `git log --oneline -- packages/di | wc -l` in the new repo > 1 (history preserved)
```

#### Acceptance Criteria
- [ ] New repo builds + tests green against npm `@theokit/sdk`.
- [ ] `git log` shows preserved history for a known `di` file.
- [ ] Pass: lint — `biome check .` clean in the new repo.

#### DoD
- [ ] Repo pushed; build/test/lint green.

---

## Phase 3: Extract `theokit-gateways` (core + 11 adapters)

**Objective:** Move the messaging product to its own repo.

### T3.1 — filter-repo extraction of `packages/gateway*`

#### Objective
A `theokit-gateways` repo with `gateway` + 11 platform adapters, history-preserved.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — runs `git filter-repo` over all 12 `gateway`-prefixed paths plus scaffolding.
2. **Why it is necessary now** — they move as one repo because the 11 adapters depend on `@theokit/gateway` (intra-cluster) and the user chose a single `theokit-gateways` repo (decision 3). Independent of Phases 2/4, so parallelizable.

#### Evidence
`gateway` `0.4.0` (`@theokit/sdk workspace:^`); each adapter (e.g. `gateway-telegram` `0.1.0`) depends on `@theokit/gateway` + `@theokit/sdk`. Verified via grep. `knip.json` carries per-gateway entries (`gateway-whatsapp/sms/mattermost/line/matrix` confirmed).

#### Files to edit
```
(in the NEW theokit-gateways repo)
package.json, pnpm-workspace.yaml, tsconfig.base.json, biome.json, .nvmrc, .changeset/, .github/workflows/release.yml, CHANGELOG.md (NEW)
packages/gateway*/package.json — @theokit/sdk → published range; @theokit/gateway stays workspace:^
knip.json (NEW) — gateway-scoped (the per-gateway entries from the sdk repo's knip.json move here)
```

#### Deep file dependency analysis
Every adapter's `@theokit/sdk` dep must resolve from npm in the new repo; `@theokit/gateway` remains a workspace link. The `knip.json` per-gateway config blocks move out of the sdk repo (cleaned in Phase 7, T7.4).

#### Tasks
1. Fresh clone → `git filter-repo` with all `packages/gateway*` paths.
2. Scaffold workspace + toolchain; migrate gateway knip entries.
3. Rewrite each adapter's sdk dep to published range.
4. `pnpm -r build && pnpm -r test`.
5. Push.

#### TDD
```
RED:     pre-scaffold `pnpm build` fails
GREEN:   `pnpm -r build` + `pnpm -r test` green (all 12 packages)
REFACTOR: None expected
VERIFY:  `git log --oneline -- packages/gateway-telegram | wc -l` > 1
```

#### Acceptance Criteria
- [ ] 12 packages build + test green against npm `@theokit/sdk`.
- [ ] History preserved for a known adapter file.

#### DoD
- [ ] Repo pushed; CI scaffold present; green.

---

## Phase 4: Extract `theokit-react`

**Objective:** Move the React DX package (UI-pillar-adjacent) out.

### T4.1 — filter-repo extraction of `packages/react`

#### Objective
A `theokit-react` repo with the single package, history-preserved.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — extracts one package via `git filter-repo --path packages/react`.
2. **Why it is necessary now** — `react` is web DX, adjacent to the UI pillar (`@theokit/ui`), not the Harness. Single-package, the simplest extraction; kept its own phase because its destination differs from Backend-DX and gateways.

#### Evidence
`packages/react/package.json` `8a13fd4`, `1.1.0`, `@theokit/sdk ^1.1.0`.

#### Files to edit
```
(in the NEW theokit-react repo)
package.json, pnpm-workspace.yaml, tsconfig.base.json, biome.json, .nvmrc, .changeset/, .github/workflows/release.yml, CHANGELOG.md (NEW)
packages/react/package.json — @theokit/sdk → published range
```

#### Deep file dependency analysis
`react` depends only on `@theokit/sdk` (resolved from npm in the new repo). No intra-cluster links.

#### Tasks
1. Fresh clone → `git filter-repo --path packages/react`.
2. Scaffold + dep rewrite.
3. `pnpm build && pnpm test`.
4. Push.

#### TDD
```
RED:     pre-scaffold build fails
GREEN:   build + test green
REFACTOR: None expected
VERIFY:  `git log --oneline -- packages/react | wc -l` > 1
```

#### Acceptance Criteria
- [ ] Builds + tests green against npm `@theokit/sdk`.
- [ ] History preserved.

#### DoD
- [ ] Repo pushed; green.

---

## Phase 5: Carve `voice`/`rag` out of the core and drop their exports

**Objective:** Remove application-layer modules from the SDK surface per D434 and the T0.2 verdict.

### T5.1 — Remove `voice`/`rag` modules + sub-path exports from `@theokit/sdk`

#### Objective
The SDK no longer ships `./rag` (and `./voice` if exported); the modules are extracted or deleted per the T0.2 verdict.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — deletes `packages/sdk/src/rag` + `packages/sdk/src/voice`, removes their `exports` entries and barrel re-exports, and (if T0.2 said "extract") filter-repos them out first.
2. **Why it is necessary now** — runs after the maturity probe so the extract-vs-delete branch is already decided (cites T0.2), and before Phase 7 so the trimmed surface is what the config-trim asserts (cites ADR D434).

#### Evidence
`packages/sdk/package.json` exports `./rag` (confirmed) and possibly `./voice`. `src/rag` (`ed731c2`), `src/voice` (`94e331a`). The agent loop does not import them (T0.2 confirms).

#### Files to edit
```
packages/sdk/package.json — remove "./rag" (+ "./voice" if present) from exports
packages/sdk/src/index.ts — remove any rag/voice re-export
packages/sdk/src/rag/** — deleted (or filter-repo'd out first)
packages/sdk/src/voice/** — deleted (or filter-repo'd out first)
packages/sdk/tsup.config.ts — remove rag/voice entry points if listed
.dependency-cruiser.cjs — drop the `rag|voice` path references in the existing rule
CHANGELOG.md — [Unreleased] § Removed: dropped @theokit/sdk/rag and /voice
docs.md — remove the rag/voice contract sections
```

#### Deep file dependency analysis
`packages/sdk/package.json` exports + `tsup.config.ts` entry points reference `rag`/`voice`; removing the dirs without removing those entries breaks the build. `.dependency-cruiser.cjs` line referencing `(rag|a2a|client|voice|server/adapter)/types.ts` must drop `rag|voice` (keep `a2a|client|server` — those stay in the Harness).

#### Tasks
1. (If extract) fresh-clone filter-repo `packages/sdk/src/rag` + `src/voice` into target repo(s); scaffold.
2. Delete the dirs from the monorepo.
3. Remove `exports` + tsup entries + barrel re-exports.
4. Update depcruiser path list, docs.md, CHANGELOG.
5. `pnpm --filter @theokit/sdk build && test`.

#### TDD
```
RED:     `node -e "require.resolve('@theokit/sdk/rag')"` resolves (pre-removal)
GREEN:   the same resolution fails; `pnpm --filter @theokit/sdk build` green; `pnpm --filter @theokit/sdk test` green
REFACTOR: None expected
VERIFY:  `grep -rn "src/rag\|src/voice" packages/sdk/src` → no live import (only comments/history)
```

#### Acceptance Criteria
- [ ] `./rag`/`./voice` no longer in `exports`.
- [ ] SDK builds + tests green.
- [ ] docs.md no longer documents rag/voice.

#### DoD
- [ ] Build/test/grep green; CHANGELOG updated.

---

## Phase 6: Relocate `skills-google-workspace` to the Skills pillar

**Objective:** Move the google-workspace skill bundle to the `theokit` repo (resolves Q2).

### T6.1 — Move `skills-google-workspace` into `theokit`

#### Objective
The skill bundle lives in the Skills pillar, not the Harness.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — inspects the `theokit` repo layout, then filter-repo-moves `packages/skills-google-workspace` into it (or a standalone `theokit-skills-google-workspace` if it doesn't fit).
2. **Why it is necessary now** — it is a skill (content wiring an MCP server), so per the pillar split it belongs to `theokit`. Gated on inspection because the destination structure is unknown (cites Unresolved Q2 + risk row).

#### Evidence
`skills-google-workspace` `2.0.0`, dep `@theokit/sdk workspace:^`. Sibling `theokit` repo exists at `theokit-tools/theokit`.

#### Files to edit
```
(destination theokit repo) — new package member + workspace glob update
packages/skills-google-workspace/package.json — @theokit/sdk → published range
CHANGELOG.md (sdk repo) — [Unreleased] § Removed
```

#### Deep file dependency analysis
Only `@theokit/sdk` dep (npm-resolved in destination). The move is wholesale; the sdk repo only loses the directory.

#### Tasks
1. Inspect `theokit` repo workspace layout (resolves Q2).
2. filter-repo move (or standalone) with history.
3. Rewrite sdk dep; build in destination.
4. Push.

#### TDD
```
RED:     destination build fails pre-scaffold
GREEN:   `pnpm --filter @theokit/skills-google-workspace build` green in destination
REFACTOR: None expected
VERIFY:  history preserved (`git log` of a known file in destination > 1 commit)
```

#### Acceptance Criteria
- [ ] Skill builds green in its new home.
- [ ] History preserved.

#### DoD
- [ ] Moved; green; Q2 resolved.

---

## Phase 7: Trim the monorepo + add guard + normalize specifiers (synchronization barrier)

**Objective:** Reduce every monorepo config + doc to the Harness set, enforce the cross-cluster guard, and normalize remaining specifiers.

### T7.1 — Remove leaving packages from the workspace + release pipeline

#### Objective
The monorepo no longer contains or publishes the extracted packages.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — deletes the now-extracted `packages/{di,di-agent,orm,gateway*,react,skills-google-workspace}` directories and updates `pnpm-workspace.yaml`/`.changeset`/`release.yml`.
2. **Why it is necessary now** — it is the barrier phase; it can only run once every Phase 2-6 extraction is verified pushed, otherwise history would be lost from the only copy (cites the High-severity risk row).

#### Evidence
`pnpm-workspace.yaml` (`520fe7d`) globs `packages/*`; `release.yml` (`8a13fd4`) "Release via Changesets (22 packages)"; `.changeset/config.json` (`461c020`).

#### Files to edit
```
packages/{di,di-agent,orm,gateway*,react,skills-google-workspace}/ — deleted from monorepo
.github/workflows/release.yml — update the "(22 packages)" label + any package-specific steps
.changeset/config.json — no membership change needed (glob-based) but verify no stale fixed/linked entries
CHANGELOG.md — [Unreleased] § Removed entries for each extracted package
```

#### Deep file dependency analysis
Deleting the dirs only after their history is pushed elsewhere (Phases 2-6 DoD) is the High-severity-risk mitigation. `release.yml` publishes via changesets over the workspace glob — fewer members = fewer published.

#### Tasks
0. **(EC-2) Resolve examples FIRST.** `grep -rln '@theokit/gateway\|@theokit/di\|@theokit/orm\|@theokit/react' examples/` (verified hits: `line-bot`, `email-bot`, `whatsapp-web-bot`, …). Move each such example into its cluster's extracted repo (under `examples/`) OR delete it — BEFORE deleting the package, so the workspace never holds a dangling `workspace:*` dep.
1. Confirm every Phase 2-6 repo is verified (local-folder gate; no push this run).
2. Delete the extracted dirs.
3. Update `release.yml` label/steps; verify `.changeset` config.
4. `pnpm install` (relock).

#### TDD
```
RED:     `ls packages/gateway` exists (pre-delete); `pnpm install` would fail with a dangling example dep if step 0 skipped
GREEN:   extracted dirs + leaving-package examples absent; `pnpm install` relocks with no missing-workspace errors
REFACTOR: None expected
VERIFY:  `pnpm -r ls --depth -1` lists only the Harness set; `grep -rln '@theokit/gateway' examples/` → empty
```

#### Acceptance Criteria
- [ ] Only Harness packages remain in the workspace.
- [ ] `pnpm install` clean.
- [ ] (EC-3) CLI still builds; `theokit db export-schema` and `theokit inspect gateway` degrade gracefully (friendly "not installed" / "zero adapters detected") rather than crashing — `cli/src/commands/db.ts:119` + `cli/src/inspect/gateway.ts`.

#### DoD
- [ ] Workspace + release config trimmed; lockfile updated.
- [ ] CLI graceful-degradation tests green (EC-3).

### T7.2 — Add the cross-cluster import guard (D433)

#### Objective
Mechanically block any future Harness import of an extracted package.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — adds a `forbidden` rule to `.dependency-cruiser.cjs` + a `tools/check-cross-cluster.mjs` wired into `pnpm quality`.
2. **Why it is necessary now** — the guard can only assert "extracted" once extraction is done (barrier phase). Per ADR D433, cohesion regression must fail loud.

#### Evidence
`.dependency-cruiser.cjs` (`5e780ac`, 97 LoC) already has `forbidden` rules scoped to `packages/sdk/src`. Guard spec authored in T0.3.

#### Files to edit
```
.dependency-cruiser.cjs — new forbidden rule: packages/sdk/src/** ↛ @theokit/{di,di-agent,orm,gateway,gateway-*,react}
tools/check-cross-cluster.mjs (NEW) — standalone grep-based guard for CI
package.json — add to the `quality` script chain
```

#### Deep file dependency analysis
`package.json` `quality` script currently chains `quality:dead/cycles/depcruise/loc/duplication`; appending the new guard makes it part of the gate. `tools/` is the established home for `check-cycles.mjs`/`check-loc.mjs`.

#### Tasks
1. Add the depcruiser forbidden rule from the T0.3 spec.
2. Write `tools/check-cross-cluster.mjs`.
3. Wire into `quality` script.

#### TDD
```
RED:     add a temp `import '@theokit/gateway'` in a sdk src file → guard FAILS (proves it catches)
GREEN:   remove the temp import → `pnpm quality:depcruise` + `node tools/check-cross-cluster.mjs` PASS
REFACTOR: None expected
VERIFY:  node tools/check-cross-cluster.mjs → exit 0
```

#### Acceptance Criteria
- [ ] Guard fails on an injected violation, passes clean.
- [ ] Wired into `pnpm quality`.
- [ ] Pass: size — `tools/check-cross-cluster.mjs` ≤ 500 lines.

#### DoD
- [ ] Guard green on the trimmed tree.

### T7.3 — Normalize remaining Harness dependency specifiers (D435)

#### Objective
One specifier convention across surviving `@theokit/*` deps; `changeset status` correct.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — rewrites `sdk-handoff`/`sdk-memory`/`sdk-tools` (`>=1.7.0`) and any other survivor to one convention (`workspace:^`).
2. **Why it is necessary now** — it closes the active-plan Phase B (cites ADR D435) for the survivors and must run here because extraction changed which packages remain.

#### Evidence
Mixed specifiers verified: `sdk-handoff/memory/tools >=1.7.0`; `acp/cli/skills/gateway workspace:^`; `di-agent ^1.3.0` (leaving). Cross-package tests in `packages/sdk/tests` import only `@theokit/sdk-*` (Harness, staying) — confirmed via grep, so they are unaffected.

#### Files to edit
```
packages/{sdk-handoff,sdk-memory,sdk-tools}/package.json — @theokit/sdk specifier → workspace:^
.changeset/config.json — confirm updateInternalDependencies behavior
```

#### Deep file dependency analysis
These three currently declare `>=1.7.0`; normalizing to `workspace:^` aligns them with `acp`/`cli` and stops `changeset version` from treating the bump as a cross-range major.

#### Tasks
1. Rewrite the `>=1.7.0` specifiers to `workspace:^`.
2. `npx changeset status --verbose` — confirm no 0.x→1.0.0 over-bump.
3. Confirm cross-package tests still pass.

#### TDD
```
RED:     `npx changeset status --verbose` shows a dependent over-bumped to 1.0.0 (pre-fix, if reproduced)
GREEN:   status shows sdk minor + dependents ≤ patch; `pnpm -r test` green
REFACTOR: None expected
VERIFY:  npx changeset status --verbose → no major bump on a pre-1.0 survivor
```

#### Acceptance Criteria
- [ ] `changeset status` plans correct bumps.
- [ ] All Harness tests green.

#### DoD
- [ ] Specifiers normalized; status correct.

### T7.4 — Trim docs + quality configs + examples (resolves Q3)

#### Objective
`docs.md`, `README.md`, `knip.json`, `turbo.json`, `biome.json`, and `examples/` reflect only the Harness.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — removes gateway/di/orm/react/google-workspace sections from `docs.md`/`README.md`, the per-gateway entries from `knip.json`, stale overrides from `turbo.json`, and resolves leaving-package examples.
2. **Why it is necessary now** — it is the doc/config tail of the barrier phase so the trimmed repo's surface matches its docs (cites Unresolved Q3).

#### Evidence
`knip.json` has per-gateway entries (`gateway-whatsapp/sms/mattermost/line/matrix` confirmed); `docs.md` (3112 LoC) documents the full surface; `turbo.json` has `@theokit/sdk-memory#build`/`@theokit/sdk#build` overrides (keep — Harness) but may list leaving packages.

#### Files to edit
```
docs.md — remove gateway/di/orm/react/google-workspace/rag/voice sections
README.md — same surface reduction
knip.json — drop per-gateway + leaving-package entries
turbo.json — drop any leaving-package task overrides (keep sdk/sdk-memory edges)
biome.json — confirm globs (likely unchanged; verify no leaving-package include)
CHANGELOG.md — [Unreleased] § Changed/Removed
```

> Note: examples that import leaving packages are resolved in **T7.1 step 0** (EC-2), not here — by the time T7.4 runs, `examples/` no longer references any leaving cluster.

#### Deep file dependency analysis
`turbo.json` must keep the `@theokit/sdk#build` (`dependsOn: []`) + `@theokit/sdk-memory#build` (one-way edge) overrides — those are the active-plan fix and stay. Only leaving-package overrides (if any) are removed.

#### Tasks
1. `grep -rln '@theokit/gateway\|@theokit/di\|@theokit/orm\|@theokit/react' examples/` — resolve Q3.
2. Trim docs.md + README surface.
3. Trim knip.json + turbo.json.
4. Move/delete affected examples.

#### TDD
```
RED:     grep gateway/di/orm sections in docs.md → present
GREEN:   surface-reduced docs.md; `pnpm quality:dead` (knip) green on trimmed tree; `pnpm build` green
REFACTOR: None expected
VERIFY:  grep -rln '@theokit/gateway' docs.md README.md examples/ → empty (or examples moved)
```

#### Acceptance Criteria
- [ ] Docs + README describe only the Harness surface.
- [ ] knip/turbo configs reference only Harness packages.
- [ ] Examples for leaving packages resolved (moved or deleted).

#### DoD
- [ ] All quality scripts green on the trimmed monorepo.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Revoke decorators-mandatory rule (decision 4) | T1.1 | ADR D431 + CLAUDE.md + memory rewritten |
| 2 | Extract Backend-DX (di/di-agent/orm) to own repo | T2.1 | filter-repo + scaffold + build green |
| 3 | Extract gateways (core + 11 adapters) | T3.1 | filter-repo of all `gateway*` + scaffold |
| 4 | Extract react | T4.1 | filter-repo single package |
| 5 | Remove voice/rag from SDK surface | T0.2, T5.1 | maturity probe → extract/delete + drop exports |
| 6 | Relocate google-workspace skill to Skills pillar | T6.1 | move into `theokit` repo |
| 7 | Monorepo contains only Harness + builds clean | T7.1, T7.4 | trim workspace/configs/docs |
| 8 | Zero residual cross-cluster imports (guard) | T0.3, T7.2 | dependency-cruiser + standalone guard |
| 9 | Correct changeset status (no 1.0.0 cascade) | T7.3 | normalize specifiers (D435, absorbs active-plan Phase B) |
| 10 | Git history preserved per extraction | T2.1, T3.1, T4.1, T5.1, T6.1 | `git log` verification in each DoD |
| 11 | Target repos exist (human gate) | T0.1 | 3 repos created under usetheodev |

**Coverage: 11/11 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed.
- [ ] All tests passing — `pnpm test` green on the trimmed monorepo AND `pnpm -r test` green in each extracted repo.
- [ ] Zero type errors — `pnpm typecheck` green on the trimmed monorepo.
- [ ] Zero lint warnings — `biome check .` clean.
- [ ] File-size budget respected (per `rules/architecture.md`) for all NEW files (`tools/check-cross-cluster.mjs`, ADR).
- [ ] CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6) — `Removed` entries for every extracted package + `Changed` for the decorators rule.
- [ ] Backward compatibility — **explicitly NOT preserved** (authorized by user); every breaking removal documented in CHANGELOG `Removed`.
- [ ] Plan-specific: `dependency-cruiser` cross-cluster guard green; `node tools/check-cycles.mjs` green; `npx changeset status` plans no `1.0.0` cascade.
- [ ] Each extracted repo has its own CI/changesets and builds against npm `@theokit/sdk`.
- [ ] Active plan `npm-release-pipeline-fix` Phase B marked "absorbed by D435" before merge.
- [ ] Plan archived — after `/review` returns `READY_TO_MERGE` AND the PR is merged, move this plan to `knowledge-base/plans/completed/`.

## Final Phase: Integration Validation (MANDATORY)

> Runs after Phases 0-7. The plan is not done until the trimmed monorepo and every extracted repo validate.

### Execution

On the trimmed `theokit-sdk` monorepo:

```
rm -rf packages/*/dist && pnpm build      # clean-checkout build, no cycle warning, no TS2307
pnpm test                                 # unit + integration green
pnpm typecheck                            # zero type errors
biome check .                             # zero lint warnings
pnpm quality:depcruise                    # cross-cluster guard green
node tools/check-cross-cluster.mjs        # standalone guard exit 0
node tools/check-cycles.mjs               # no build cycle
npx changeset status --verbose            # no 1.0.0 cascade
```

In each extracted repo (`theokit-backend-dx`, `theokit-gateways`, `theokit-react`, + voice/rag/google-workspace destinations):

```
pnpm install && pnpm -r build && pnpm -r test    # green against npm @theokit/sdk
```

### Acceptance Criteria

- [ ] Trimmed monorepo: clean build + test + typecheck + lint all green.
- [ ] Cross-cluster guard green (no residual import of any extracted package).
- [ ] `changeset status` plans correct bumps (no pre-1.0 → 1.0.0).
- [ ] Every extracted repo builds + tests green against the published `@theokit/sdk`.
- [ ] `git log` confirms preserved history in each extracted repo (not a flat copy).

### If Validation Fails

1. Identify whether the failure is plan-caused (a missed import, a stale config) vs pre-existing.
2. Fix all plan-caused failures before declaring complete.
3. Re-run the full chain.
4. Pre-existing issues logged in the PR description, not blocking.
