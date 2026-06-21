---
slug: m4-project-instructions
milestone_id: M4
created_at: 2026-06-21
goal: Ship a @theokit/sdk/project subpath with readProjectInstructions(cwd, options?) (hierarchical, never-throw, over the internal walkUpForFile) + writeProjectInstructions (atomic, over replaceFileAtomic), measured by tests/project-instructions.test.ts + tests/project-instructions-wiring.test.ts passing green.
---

# Plan: M4-2 — `@theokit/sdk/project` hierarchical instruction reader/writer

> **Version 1.1** (edge-case-plan absorbed: EC-1 dir-named-like-file + EC-2 single-file-merge folded into T1.1 TDD; EC-3 writer-fail-loud + EC-4 no-truncation documented) — Close roadmap gap M4-2: ship a public `@theokit/sdk/project` subpath exposing `readProjectInstructions(cwd, options?)` — a hierarchical, never-throw reader that walks up from `cwd` collecting a configurable instruction file (default `THEO.md`) via the existing `@internal` `walkUpForFile`, and `writeProjectInstructions(cwd, content, options?)` — an atomic writer over the already-public `replaceFileAtomic`. The reader returns the ordered list of found files (nearest-first) plus a `content` reduction selected by `scope` (`nearest`|`merged`). Eliminates the hand-rolled hierarchical-instruction reads a consumer (theocode) would otherwise write.

## Goal

> "Enable SDK consumers to read hierarchical project instructions (configurable filename, nearest-first, never-throw) and write them atomically so that project-instruction discovery is a framework call, measured by `pnpm --filter @theokit/sdk exec vitest run tests/project-instructions.test.ts tests/project-instructions-wiring.test.ts` reporting all tests passed."

## Context

Roadmap gap M4-2 (`docs/gap-audit/ROADMAP.md:144`, med sev, size M, Tema A, dep M0-6). The SDK already walks up the directory tree for context files — `walkUpForFile(cwd, filename, stopDir)` (`packages/sdk/src/internal/runtime/context/context-discovery.ts:155`) returns absolute, realpath-deduped, nearest-first paths and is hardened (64-level cap, safe-pattern guard, FS-race tolerant). But it is `@internal`, returns only paths (not content), and there is no public reader/writer of a project-instruction file (`THEO.md`/`CLAUDE.md`/`AGENTS.md`). M0-6 made `replaceFileAtomic` public (via `@theokit/sdk/internal/persistence`). M4-2 composes these two shipped primitives into a public `@theokit/sdk/project` reader/writer — no new discovery logic, no new atomic-write logic. Zero new dependencies.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/src/internal/runtime/context/context-discovery.ts` | ~210 | `e7dc48f` (2026-06-07) | walk-up + scoped discovery for context files | `walkUpForFile(cwd, filename, stopDir)` signature + never-throw behavior unchanged (consumed by `FileContextManager`) |
| `packages/sdk/src/internal/persistence/atomic-write.ts` | ~130 | (M0-6) | atomic temp+fsync+rename writer | `replaceFileAtomic(path, content)` signature unchanged (used by sdk-memory/sdk-cache) |
| `packages/sdk/src/internal/runtime/context/project-instructions.ts` (NEW) | 0 | — | (the reader + writer primitives) | — |
| `packages/sdk/src/project.ts` (NEW) | 0 | — | public `@theokit/sdk/project` barrel | additive re-exports only |
| `packages/sdk/tsup.config.ts` | (build) | — | tsup entry map | add `project` entry only |
| `packages/sdk/tsconfig.tools-dts.json` | (build) | — | tsc DTS include | add `src/project.ts` (context dir already partly included) |
| `packages/sdk/scripts/mirror-dts-to-cts.mjs` | (build) | — | `.d.ts`→`.d.cts` mirror | add `project.d.ts` |
| `packages/sdk/package.json` | (manifest) | — | exports map | add `./project` (dual import/require) |
| `packages/sdk/tests/project-instructions.test.ts` (NEW) | 0 | — | unit tests — RED first | — |
| `packages/sdk/tests/project-instructions-wiring.test.ts` (NEW) | 0 | — | barrel wiring test | — |
| `docs.md` | (contract) | — | public API contract | additive `@theokit/sdk/project` note |
| `CHANGELOG.md` (root) + `.changeset/` (NEW) | — | — | changelog + changeset | additive `Added` entry |

### Current callers / dependents

- **Symbol:** `walkUpForFile` (`context-discovery.ts:155`)
  - Callers (production): `FileContextManager` (same module/dir) — unchanged; M4-2 only ADDS a new consumer (`project-instructions.ts`).
  - Callers (tests): context-discovery tests.
- **Symbol:** `replaceFileAtomic` (`internal/persistence/atomic-write.ts`, public via `@theokit/sdk/internal/persistence`)
  - Callers (production): sdk-memory, sdk-cache. `writeProjectInstructions` adds one more caller; signature untouched.
- **External:** none yet for these as a "project instructions" surface — theocode hand-rolls equivalent reads (intended future consumer).

### Domain glossary

- **project instructions** — a markdown file (default `THEO.md`; also commonly `CLAUDE.md`/`AGENTS.md`) holding agent guidance for a project; discovered by walking up from `cwd`.
- **nearest-first** — ordering where the file in the innermost directory (closest to `cwd`) comes first; outermost (repo root) last.
- **scope** — how the discovered files are reduced to a single `content`: `nearest` (innermost only) or `merged` (all, root-first so nearest text wins last in append-order prompts).
- **walk-up** — ascending from `cwd` toward the filesystem root (bounded 64 levels), collecting each directory's matching file.

### Architecture boundaries affected

Per `rules/architecture.md` §1/§2: the new reader/writer lives in `internal/runtime/context/` (domain logic; fs read + the already-public atomic write). The public barrel `src/project.ts` is a leaf re-export (mirrors `src/models.ts`). It composes `walkUpForFile` (same dir) + `replaceFileAtomic` (public persistence subpath) — no new DIP boundary, no layer inversion.

## Prior Art & Related Work

- **Baseline investigation (2026-06-21)** — Explore agent mapped `walkUpForFile` (`context-discovery.ts:155`, @internal, never-throw, nearest-first), `replaceFileAtomic` (public via `@theokit/sdk/internal/persistence`, M0-6), `DiscoverySpec`/`FileContextManager` prior art, and confirmed no `readProjectInstructions` exists.
- **In-repo precedent (subpath wiring)** — `@theokit/sdk/models` / `@theokit/sdk/skills` (M4-1) wiring: tsup + tsconfig.tools-dts + mirror-dts + exports. M4-2 mirrors it.
- **In-repo precedent (hierarchical read)** — `FileContextManager` walk-up + concat-by-priority over `walkUpForFile` (same module).
- **Consumer prior art (hand-roll to replace)** — theocode hierarchical instruction reads (`server/lib`).
- **ADRs** — the atomic-write ADR (`knowledge-base/adrs/D150-*` series, EC-1 absorbed) for `replaceFileAtomic`; path-guard ADRs (`knowledge-base/adrs/D79-path-guard-canonical-module.md`, `knowledge-base/adrs/D80-resolve-then-prefix-check.md`).

## Objective

- [ ] `readProjectInstructions(cwd, options?)` returns `{ files: ProjectInstructionFile[]; content: string | undefined }`: `files` is the nearest-first list of found instruction files (each read), `content` is the `scope`-selected reduction. NEVER throws.
- [ ] `options`: `filename` (default `"THEO.md"`), `scope` (`"nearest"` default | `"merged"`), `stopDir?`.
- [ ] `writeProjectInstructions(cwd, content, options?)` writes `join(cwd, filename)` atomically via `replaceFileAtomic`.
- [ ] internal callers unaffected; `walkUpForFile`/`replaceFileAtomic` signatures untouched.
- [ ] `@theokit/sdk/project` subpath wired (tsup + tsconfig.tools-dts + mirror + exports), ESM+CJS+types.
- [ ] Zero new deps; `docs.md` + CHANGELOG + changeset.
- [ ] `tests/project-instructions.test.ts` + `tests/project-instructions-wiring.test.ts` green; typecheck + Biome clean; build emits dist; attw/publint clean.

## ADRs

### D1 — Compose `walkUpForFile` + `replaceFileAtomic`, do not reimplement
**Decision:** `readProjectInstructions` calls `walkUpForFile` for discovery and `readFile` per result; `writeProjectInstructions` calls `replaceFileAtomic`. No new walk-up or atomic-write code.
**Rationale:** Rule 9 / DRY — both primitives are shipped + hardened. Composition is the whole value of the gap (expose, don't rebuild).
**Alternatives considered:** new walk-up in the public module — rejected (duplicates a 64-level-capped, realpath-deduped, FS-race-tolerant loop); new write — rejected (re-derives the temp+fsync+rename + 0o600 + NFS-warn logic).

### D2 — One return type `{ files, content }`, scope selects `content` (no union return)
**Decision:** `readProjectInstructions` always returns `{ files: ProjectInstructionFile[]; content: string | undefined }`. `files` is always the full ordered list; `content` is `files[0]?.content` for `scope:"nearest"` or the root-first join for `scope:"merged"`.
**Rationale:** a scope-dependent union return type (`string | string[] | undefined`) is an LSP/ISP smell — callers branch on the option. One stable shape lets the caller read `files` OR `content` without type narrowing.
**Alternatives considered:** return `string | undefined` only (loses the per-file paths consumers need to show provenance); return `ProjectInstructionFile[]` only (forces every caller to reduce). The combined shape serves both at no cost.

### D3 — `merged` joins root-first (outermost first, nearest last)
**Decision:** `scope:"merged"` concatenates the discovered files in root-first order (reverse of nearest-first) separated by `\n\n`, so the nearest (most specific) instructions appear LAST.
**Rationale:** matches the append-wins convention of system-prompt assembly (later text overrides earlier); mirrors `FileContextManager`'s concat-by-priority. The most specific project's guidance should win.
**Alternatives considered:** nearest-first join — rejected (most specific text gets overridden by generic root text in append-wins prompts).

### D4 — Reader never throws; writer fails loud
**Decision:** `readProjectInstructions` never throws (walkUpForFile is total; a per-file `readFile` error skips that file like an FS-race). `writeProjectInstructions` propagates write errors (it does NOT swallow — a failed write is a real error).
**Rationale:** a discovery read is best-effort orientation (Rule 8 — don't crash an agent because one instruction file vanished mid-read); a write is an explicit mutation whose failure the caller MUST see (fail-fast).
**Alternatives considered:** reader throws on unreadable file — rejected (one bad file shouldn't abort discovery); writer swallows errors — rejected (silent data loss, Rule 8 violation).

### D5 — Subpath `@theokit/sdk/project`, wired via the tsc-dts path
**Decision:** add `project` to tsup entries, `src/project.ts` to `tsconfig.tools-dts.json`, `project.d.ts` to the mirror list, `./project` to `package.json` exports (dual import/require).
**Rationale:** `project.ts` re-exports from `internal/runtime/context/**`, so DTS must go through tsc (like models/skills) — rollup-dts would cycle.
**Alternatives considered:** rollup `dts.entry` — rejected (reserved for cycle-free leaf entries).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| New public surface (3 symbols + 3 types) must stay semver-supported | Low | thin composition of long-stable internals; documented in `docs.md` | SDK |
| `merged` ordering could surprise a caller expecting nearest-first text | Low | ADR D3 documents root-first rationale; `files` exposes the raw order for callers who want it | SDK |
| A consumer passing a huge instruction tree reads many files | Low | walk-up is 64-level-capped; reads are lazy per found file; document that scope:"nearest" reads only the innermost (it still must read all to populate `files` — acceptable, files are small markdown) | SDK |
| `writeProjectInstructions` could clobber a hand-edited file | Low | atomic temp+rename is all-or-nothing (no partial write); caller owns the decision to write | SDK |

## Unresolved Questions

(none — every decision is resolved at plan time. Return shape (D2), merge order (D3), reader-vs-writer error policy (D4), and subpath wiring (D5) are locked against in-repo precedent (`walkUpForFile`, `replaceFileAtomic`, the models/skills subpath pattern).)

## Dependencies

M4-2 introduces ZERO new dependencies — `node:fs/promises` (`readFile`) + the already-public `walkUpForFile`/`replaceFileAtomic` primitives (Rule 9 / KISS).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `node:fs/promises`, `node:path` | builtin | node | `readFile`/`join` |
| `walkUpForFile` (in-repo `@internal`) | workspace | npm/TS | hardened walk-up discovery (same package) |
| `replaceFileAtomic` (`@theokit/sdk/internal/persistence`, M0-6) | workspace | npm/TS | atomic write |

### New — to be introduced

(none)

## Dependency Graph

```
Phase 1 (reader + writer primitives) ──▶ Phase 2 (wire subpath + docs) ──▶ Phase 3 (integration validation)
```

Sequential.

---

## Phase 1: Reader + writer primitives

**Objective:** implement `readProjectInstructions` + `writeProjectInstructions` over the shipped primitives, with TDD.

### T1.1 — `readProjectInstructions(cwd, options?)`

#### Objective
Hierarchical, never-throw reader returning `{ files, content }`.

#### Why this step (action + reasoning)
1. **What this step does** — adds `packages/sdk/src/internal/runtime/context/project-instructions.ts` with `readProjectInstructions` calling `walkUpForFile(cwd, filename, stopDir)` then `readFile` per path, building `files` (nearest-first) + `content` (scope reduction).
2. **Why it is necessary now** — it is the core gap deliverable; building the reader first (before the barrel) lets unit tests prove the hierarchy + scope + never-throw behavior against temp dirs.

#### Evidence
`walkUpForFile` returns nearest-first absolute paths (`context-discovery.ts:155-188`); it never throws (FS-race skip at `:176-180`). `readFile` from `node:fs/promises`.

#### Files to edit
```
packages/sdk/src/internal/runtime/context/project-instructions.ts — NEW: readProjectInstructions + types
packages/sdk/tests/project-instructions.test.ts — NEW: RED tests (nearest, merged, none, never-throw, custom filename, stopDir)
```

#### Deep file dependency analysis
- New module imports `walkUpForFile` from `./context-discovery.js` (same dir) + `readFile` from `node:fs/promises`. No change to `context-discovery.ts`.

#### Deep Dives
- Data: `ProjectInstructionFile = { path: string; content: string }`; `ProjectInstructions = { files: ProjectInstructionFile[]; content: string | undefined }`.
- Invariant: `scope:"nearest"` → `content = files[0]?.content`; `scope:"merged"` → `content = files.length ? [...files].reverse().map(f=>f.content).join("\n\n") : undefined`.
- Edge: no file found → `{ files: [], content: undefined }`. A file deleted between walk + read → skipped (never-throw). Unsafe filename (`..`/separators) → `walkUpForFile` returns `[]` → `{ files: [], content: undefined }`.

#### Pseudo-code / Signatures
```pseudocode
async function readProjectInstructions(cwd, options?) -> { files, content }
  filename = options?.filename ?? "THEO.md"
  scope = options?.scope ?? "nearest"
  paths = walkUpForFile(cwd, filename, options?.stopDir)   # nearest-first
  files = []
  for p in paths:
    try: files.push({ path: p, content: await readFile(p, "utf8") })
    catch: continue                                         # FS-race / unreadable → skip
  content = scope == "merged"
    ? (files.length ? reverse(files).map(content).join("\n\n") : undefined)
    : files[0]?.content
  return { files, content }
```

#### Tasks
1. Write RED tests (nearest of 2 levels; merged root-first order; none→empty; custom filename "CLAUDE.md"; stopDir bounds the walk; deleted-file-skip never throws).
2. Implement `project-instructions.ts`.

#### TDD
```
RED:     readProjectInstructions_nearest_returns_innermost() — 2-level temp tree, scope nearest → innermost content + files length 2
RED:     readProjectInstructions_merged_is_root_first() — scope merged → root content before nearest content
RED:     readProjectInstructions_none_returns_empty() — no file → { files: [], content: undefined }
RED:     readProjectInstructions_custom_filename() — filename "CLAUDE.md" honored
RED:     readProjectInstructions_stopDir_bounds_walk() — stopDir excludes ancestors above it
RED:     readProjectInstructions_never_throws_on_unreadable() — unreadable/missing → no throw, returns []
RED:     readProjectInstructions_skips_dir_named_like_file() — (EC-1) a dir named THEO.md is excluded, no throw
RED:     readProjectInstructions_merged_single_file_no_separator() — (EC-2) merged of 1 file → content === that file (no \n\n)
GREEN:   Implement project-instructions.ts
REFACTOR: extract scope-reduction helper if cyclomatic > 10
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/project-instructions.test.ts
```

#### Acceptance Criteria
- [ ] All RED tests pass — `pnpm --filter @theokit/sdk exec vitest run tests/project-instructions.test.ts` reports all tests passed.
- [ ] Pass: complexity — `pnpm --filter @theokit/sdk exec biome check src/internal/runtime/context/project-instructions.ts` reports 0 warnings (cyclomatic ≤ 10).
- [ ] Pass: size — `project-instructions.ts` ≤ 500 lines.

#### DoD
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/project-instructions.test.ts` exits 0
- [ ] Zero type errors — `pnpm --filter @theokit/sdk typecheck` exits 0
- [ ] Zero lint warnings — `pnpm --filter @theokit/sdk exec biome check src/internal/runtime/context/project-instructions.ts` exits 0

### T1.2 — `writeProjectInstructions(cwd, content, options?)`

#### Objective
Atomic writer over `replaceFileAtomic`.

#### Why this step (action + reasoning)
1. **What this step does** — adds `writeProjectInstructions(cwd, content, options?)` to `project-instructions.ts`, writing `join(cwd, filename)` via `replaceFileAtomic`.
2. **Why it is necessary now** — the gap names a "writer atômico"; pairing read+write in one module keeps the project-instruction surface cohesive (SRP at module level: "project instruction file I/O").

#### Evidence
`replaceFileAtomic(filePath, content)` is public (`internal/persistence/index.ts:9`); temp+fsync+rename, 0o600 (M0-6).

#### Files to edit
```
packages/sdk/src/internal/runtime/context/project-instructions.ts — add writeProjectInstructions
packages/sdk/tests/project-instructions.test.ts — add RED tests (writes file; round-trips with reader; default filename)
```

#### Deep file dependency analysis
- Imports `replaceFileAtomic` from `../../../persistence/atomic-write.js` (internal, same package). Adds one caller; no signature change.

#### Deep Dives
- Invariant: writes to `join(cwd, options?.filename ?? "THEO.md")`. Propagates write errors (D4 — fail loud). Round-trips: `write` then `read` returns the content.
- Edge: empty content → writes an empty file (valid). cwd not existing → `replaceFileAtomic` throws (propagated — caller's responsibility).

#### Pseudo-code / Signatures
```pseudocode
async function writeProjectInstructions(cwd, content, options?) -> void
  filename = options?.filename ?? "THEO.md"
  await replaceFileAtomic(join(cwd, filename), content)   # errors propagate (D4)
```

#### Tasks
1. Write RED tests (write then file exists with content; read-after-write round-trip; custom filename).
2. Implement `writeProjectInstructions`.

#### TDD
```
RED:     writeProjectInstructions_writes_file() — file exists with exact content
RED:     writeProjectInstructions_roundtrips_with_reader() — write then readProjectInstructions returns it
RED:     writeProjectInstructions_custom_filename() — writes CLAUDE.md
GREEN:   Implement writeProjectInstructions
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/project-instructions.test.ts
```

#### Acceptance Criteria
- [ ] Write + round-trip tests pass — `pnpm --filter @theokit/sdk exec vitest run tests/project-instructions.test.ts` reports all tests passed.
- [ ] Pass: lint — `pnpm --filter @theokit/sdk exec biome check src/internal/runtime/context/project-instructions.ts` reports 0 warnings.

#### DoD
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/project-instructions.test.ts` exits 0
- [ ] Zero type errors — `pnpm --filter @theokit/sdk typecheck` exits 0

---

## Phase 2: Wire the public `@theokit/sdk/project` subpath

**Objective:** expose the reader/writer via a wired subpath, documented + changelogged.

### T2.1 — Barrel + build wiring + docs/changelog

#### Objective
Create `src/project.ts`, wire tsup/tsconfig-dts/mirror/exports, document.

#### Why this step (action + reasoning)
1. **What this step does** — adds `src/project.ts` re-export + the four wiring edits + `docs.md` + CHANGELOG + changeset.
2. **Why it is necessary now** — Phase 1 primitives are unreachable by consumers until the subpath ships (ADR D5).

#### Evidence
models/skills subpath wiring at `tsup.config.ts`, `tsconfig.tools-dts.json`, `mirror-dts-to-cts.mjs`, `package.json` exports.

#### Files to edit
```
packages/sdk/src/project.ts — NEW: re-export readProjectInstructions, writeProjectInstructions, types
packages/sdk/tsup.config.ts — add `project: "src/project.ts"`
packages/sdk/tsconfig.tools-dts.json — add "src/project.ts"
packages/sdk/scripts/mirror-dts-to-cts.mjs — add join(DIST, "project.d.ts")
packages/sdk/package.json — add "./project" exports
docs.md — document @theokit/sdk/project
CHANGELOG.md (root) — [Unreleased] Added entry
.changeset/m4-project-instructions.md — NEW: minor bump
```

#### Deep file dependency analysis
- `src/project.ts` re-exports from `internal/runtime/context/project-instructions.js` (Phase 1). Build edits mirror the `skills`/`models` rows.

#### Deep Dives
- `package.json` exports list both `import` and `require` with types; `attw`/`publint` enforce in Phase 3.

#### Pseudo-code / Signatures
```pseudocode
// src/project.ts
export {
  type ProjectInstructions, type ProjectInstructionFile, type ReadProjectInstructionsOptions,
  type WriteProjectInstructionsOptions, type ProjectInstructionScope,
  readProjectInstructions, writeProjectInstructions,
} from "./internal/runtime/context/project-instructions.js";
```

#### Tasks
1. Create `src/project.ts`.
2. Add tsup entry; tsconfig-dts include; mirror entry; package.json export.
3. Document in `docs.md`; CHANGELOG entry; changeset (`biome format --write` before commit).

#### TDD
```
RED:     (wiring test in T2.2) — import from @theokit/sdk/project resolves both functions
GREEN:   barrel + wiring (this task)
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk build && node -e "require('@theokit/sdk/project')"
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk build` emits `dist/project.{js,cjs,d.ts,d.cts}`.
- [ ] `docs.md` documents the subpath; CHANGELOG `[Unreleased] Added` entry present `(#M4-2)`.
- [ ] Pass: lint — `pnpm --filter @theokit/sdk exec biome check src/project.ts` reports 0 warnings.

#### DoD
- [ ] Build green; subpath resolves ESM + CJS — `node -e "require('@theokit/sdk/project')"` exits 0
- [ ] CHANGELOG + changeset present

### T2.2 — Wiring test (barrel + package.json export)

#### Objective
Prove the subpath resolves and the primitives round-trip through the published entry point.

#### Why this step (action + reasoning)
1. **What this step does** — adds `tests/project-instructions-wiring.test.ts` importing from `@theokit/sdk/project`, writing then reading a temp instruction file, and asserting the `./project` package.json export mapping.
2. **Why it is necessary now** — wiring triad (a static caller + a real-fs integration test); without it the exports are orphan and the subpath could silently break.

#### Evidence
`models-wiring.test.ts`/`skills-wiring.test.ts` precedent (import from barrel + assert export mapping).

#### Files to edit
```
packages/sdk/tests/project-instructions-wiring.test.ts — NEW: barrel import; write+read round-trip on a temp dir; export-map assertion (narrow the entry before destructuring — noUncheckedIndexedAccess)
```

#### Deep file dependency analysis
- Imports from `../src/project.js`. Exercises `writeProjectInstructions(tmp, "x")` then `readProjectInstructions(tmp)`.

#### Deep Dives
- Edge: the package.json export assertion MUST narrow `pkg.exports["./project"]` with an explicit `undefined` guard before destructuring (the M4-1 review HIGH — `toBeDefined()` does not narrow under `noUncheckedIndexedAccess`).

#### Tasks
1. Write `tests/project-instructions-wiring.test.ts` (round-trip + export-map with narrowing guard).

#### TDD
```
RED:     project_subpath_roundtrips() — write then read returns content (fails before barrel)
RED:     project_subpath_declared_in_package_json() — ./project export maps dist paths (narrowed)
GREEN:   barrel from T2.1 → tests pass
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/project-instructions-wiring.test.ts
```

#### Acceptance Criteria
- [ ] Wiring test green — `pnpm --filter @theokit/sdk exec vitest run tests/project-instructions-wiring.test.ts` reports all tests passed.
- [ ] `pnpm --filter @theokit/sdk typecheck` exits 0 (export assertion narrowed — no TS18048).
- [ ] Pass: lint — `pnpm --filter @theokit/sdk exec biome check tests/project-instructions-wiring.test.ts` reports 0 warnings.

#### DoD
- [ ] Wiring test green; barrel exports have a real caller
- [ ] Zero type errors / lint warnings

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Hierarchical instruction reader over `walkUpForFile` | T1.1 | `readProjectInstructions` (D1) |
| 2 | Configurable filename (THEO.md default) | T1.1, T1.2 | `options.filename` |
| 3 | `scope` reduction (nearest/merged) | T1.1 | `options.scope` + `content` (D2/D3) |
| 4 | Never-throw reader | T1.1 | per-file skip (D4) |
| 5 | Atomic writer over `replaceFileAtomic` | T1.2 | `writeProjectInstructions` (D1/D4) |
| 6 | Public `@theokit/sdk/project` subpath (ESM+CJS+types) | T2.1 | wired like models/skills (D5) |
| 7 | No orphan exports / real caller | T2.2 | wiring test |
| 8 | Docs + CHANGELOG + changeset | T2.1 | additive |

**Coverage: 8/8 requirements covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/sdk test` green
- [ ] Zero type errors — `pnpm --filter @theokit/sdk typecheck` exits 0
- [ ] Zero lint warnings — `pnpm --filter @theokit/sdk exec biome check` clean
- [ ] File-size budget respected (per `rules/architecture.md`)
- [ ] CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6)
- [ ] Backward compatibility preserved — `walkUpForFile`/`replaceFileAtomic` signatures + callers unchanged
- [ ] Plan-specific: `@theokit/sdk/project` resolves ESM + CJS with types; `attw` 🌟 + `publint` clean
- [ ] `docs.md` documents the subpath
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merge

## Final Phase: Integration Validation (MANDATORY)

**Objective:** validate the new subpath works in the built artifact.

### Execution
```
pnpm --filter @theokit/sdk build
pnpm --filter @theokit/sdk test
pnpm --filter @theokit/sdk typecheck
pnpm --filter @theokit/sdk exec biome check packages/sdk/src packages/sdk/tests
pnpm run validate:attw
```

### Acceptance Criteria
- [ ] All test suites green
- [ ] Coverage ≥ 90% on changed files (`project-instructions.ts`, `project.ts` — critical paths 100%)
- [ ] Zero type errors / zero lint warnings
- [ ] `attw` 🌟 + `publint` clean for `@theokit/sdk/project`
- [ ] No regression: full sdk suite passes (≥ baseline 2795 passed)

### If Validation Fails
1. Separate plan-caused from pre-existing failures.
2. Fix all plan-caused failures.
3. Re-run the chain.
4. Log pre-existing issues in the PR description.
