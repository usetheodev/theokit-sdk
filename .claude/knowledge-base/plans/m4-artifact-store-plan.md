---
slug: m4-artifact-store
milestone_id: M4
created_at: 2026-06-21
goal: Ship createSessionArtifactStore({dir, idStrategy?}) in @theokit/sdk-tools (generalizing session-summary-writer over safeFilenameForId + replaceFileAtomic) plus an opt-in artifactStore composition in createPlanModeTool, measured by tests/artifact-store.test.ts + tests/plan-mode.test.ts passing green.
---

# Plan: M4-4 — `createSessionArtifactStore` + plan-mode persistence

> **Version 1.1** (edge-case-plan absorbed: EC-1 empty-plan-no-persist + EC-2 enter-no-persist folded into T2.1 TDD; EC-3 list-stems + EC-4 fixed-artifactId-overwrite documented) — Close roadmap gap M4-4: ship `createSessionArtifactStore({ dir, idStrategy?, extension? })` in `@theokit/sdk-tools` — a generic, traversal-safe, atomic, never-throw-read artifact store (write/read/has/list/path) that generalizes the sdk-memory `session-summary-writer` pattern (write a file keyed by an opaque id under a dir) using the already-public `safeFilenameForId` (`@theokit/sdk/path-safety`) as the default id→filename strategy + `replaceFileAtomic` (`@theokit/sdk/internal/persistence`). Then wire it as an OPT-IN composition into `createPlanModeTool` (a new overload `createPlanModeTool({ artifactStore, artifactId? })` whose async handler persists the plan on `exit`) — keeping the existing zero-arg `createPlanModeTool()` (sync handler) fully backward-compatible.

## Goal

> "Enable SDK consumers to persist session/plan artifacts via a generic id-keyed atomic store (and opt that store into plan-mode) so that artifact persistence is a framework call, measured by `pnpm --filter @theokit/sdk-tools exec vitest run tests/artifact-store.test.ts tests/plan-mode.test.ts` reporting all tests passed."

## Context

Roadmap gap M4-4 (`docs/gap-audit/ROADMAP.md:146`, med sev, size M, Tema A). `@theokit/sdk-memory` has a per-run `session-summary-writer` (`internal/store/session-summary-writer.ts`) that writes `.theokit/memory/sessions/<runId>.md` via `replaceFileAtomic` with an inline `sanitizeRunId` — but it is sdk-memory-specific (session corpus, redaction, fixed shape) and not reusable as a generic artifact store. `createPlanModeTool` (`@theokit/sdk-tools/plan-mode.ts`) toggles plan/normal mode in memory only — it never persists the plan the agent produces. M4-4 ships a generic `createSessionArtifactStore` (the reusable generalization) and wires it opt-in into plan-mode so the plan can be persisted on exit. Zero new dependencies (`safeFilenameForId` is public via `@theokit/sdk/path-safety`; `replaceFileAtomic` via `@theokit/sdk/internal/persistence`).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk-tools/src/plan-mode.ts` | 73 | (sdk-tools) | `createPlanModeTool` in-memory toggle | zero-arg `createPlanModeTool()` keeps a SYNC handler returning a string (existing tests call `JSON.parse(handler(...))`) |
| `packages/sdk-tools/src/artifact-store.ts` (NEW) | 0 | — | the generic artifact store | — |
| `packages/sdk-tools/src/index.ts` | ~82 | (barrel) | sdk-tools public barrel | additive exports only |
| `packages/sdk-tools/tests/artifact-store.test.ts` (NEW) | 0 | — | unit + wiring tests — RED first | — |
| `packages/sdk-tools/tests/plan-mode.test.ts` | ~50 | (sdk-tools) | plan-mode tests | existing sync tests stay green; ADD store-composition tests |
| `CHANGELOG.md` (root) + `.changeset/` (NEW) | — | — | changelog + changeset | additive `Added` entry |
| `docs.md` | (contract) | — | public API contract | additive artifact-store + plan-mode-persistence note |

### Current callers / dependents

- **Symbol:** `createPlanModeTool` (`plan-mode.ts:38`)
  - Callers (production): only the barrel (`sdk-tools/src/index.ts:58`). No other prod consumer (`grep` confirms).
  - Callers (tests): `tests/plan-mode.test.ts` (calls the SYNC handler). The zero-arg overload preserves this exactly.
- **Symbol:** `safeFilenameForId` (`@theokit/sdk/path-safety`, `path-safety.ts:24`) — public; reused as default id strategy.
- **Symbol:** `replaceFileAtomic` (`@theokit/sdk/internal/persistence`) — public; reused for atomic writes.
- **Prior art (to generalize):** `session-summary-writer.ts` (`writeSessionSummary`/`sessionSummaryPath`/`sanitizeRunId`) in sdk-memory — NOT modified; M4-4 generalizes its pattern into sdk-tools.

### Domain glossary

- **artifact** — an opaque text blob persisted under a stable id (a plan, a session summary, a transcript).
- **id strategy** — the function mapping an opaque id to a safe filename component; default `safeFilenameForId` (accepts ANY id; hashes non-conforming input deterministically).
- **plan mode** — the agent state where it outlines steps before executing; `createPlanModeTool` toggles it.

### Architecture boundaries affected

Per `rules/architecture.md` §1/§2: `artifact-store.ts` is a leaf domain module in `sdk-tools/` (fs I/O via the public path-safety + persistence subpaths). `plan-mode.ts` composes it opt-in. Barrel-exported. No new DIP boundary; depends inward on `@theokit/sdk` public subpaths only.

## Prior Art & Related Work

- **Baseline investigation (2026-06-21)** — Explore agent mapped `session-summary-writer` (`session-summary-writer.ts`, @internal-exported, atomic write keyed by sanitized runId), `createPlanModeTool` (in-memory only), `safeFilenameForId` (public, `path-guard.ts:432`), and confirmed `createSessionArtifactStore` does not exist.
- **In-repo precedent (generalize)** — `session-summary-writer.ts`: `replaceFileAtomic(sessionSummaryPath(cwd,runId), body)` keyed by `sanitizeRunId`. M4-4 generalizes: arbitrary `dir`, pluggable id strategy, no fixed body shape.
- **In-repo precedent (barrel + factory)** — `createPlanModeTool`/`createTodolistTool` factories exported from `sdk-tools/src/index.ts`.
- **ADRs** — `knowledge-base/adrs/D80-resolve-then-prefix-check.md` (safePathJoin) + the `safeFilenameForId` id-grammar (M0-4); the shipped atomic-write primitive (`replaceFileAtomic`, M0-6, EC-1 absorbed).

## Objective

- [ ] `createSessionArtifactStore({ dir, idStrategy?, extension? })` returns `{ write, read, has, list, path }`.
- [ ] `write(id, content)` writes `<dir>/<idStrategy(id)><extension>` atomically (mkdir + `replaceFileAtomic`), returns the path.
- [ ] `read(id)` returns the content or `undefined` (never throws on missing/unreadable).
- [ ] `has(id)` / `list()` reflect persisted artifacts; `path(id)` is traversal-safe (`safePathJoin` + id strategy).
- [ ] default `idStrategy` = `safeFilenameForId`; default `extension` = `.md`.
- [ ] `createPlanModeTool()` zero-arg overload UNCHANGED (sync handler); new `createPlanModeTool({ artifactStore, artifactId? })` overload → async handler persisting `plan` on `exit`.
- [ ] Reuses `safeFilenameForId`/`safePathJoin`/`replaceFileAtomic`; zero new deps.
- [ ] Barrel-exported; `docs.md` + CHANGELOG + changeset.
- [ ] `tests/artifact-store.test.ts` + updated `tests/plan-mode.test.ts` green; typecheck + Biome clean.

## ADRs

### D1 — Generic store (arbitrary dir + pluggable id strategy), not a session-summary copy
**Decision:** `createSessionArtifactStore({ dir, idStrategy?, extension? })` generalizes the write-file-keyed-by-id pattern; it has no fixed body shape, no redaction, no status gate.
**Rationale:** the session-summary-writer is sdk-memory-domain (redaction, `status==="finished"` gate, session frontmatter); a generic store must not carry those. Pluggable `idStrategy` + `dir` + `extension` make it reusable for plans, transcripts, summaries.
**Alternatives considered:** export/move `writeSessionSummary` — rejected (couples sdk-tools to sdk-memory's session shape + redaction); subclass it — rejected (no inheritance; factories).

### D2 — `safeFilenameForId` is the default id strategy (accepts ANY id)
**Decision:** default `idStrategy = safeFilenameForId` (not `sanitizeIdentifier`).
**Rationale:** `safeFilenameForId` accepts ANY opaque id (run ids, uuids, emails) and deterministically hashes non-conforming input — exactly what a general store needs (the session-summary-writer's `sanitizeRunId` is a weaker ad-hoc regex). `path(id)` additionally passes through `safePathJoin` for defense-in-depth.
**Alternatives considered:** `sanitizeIdentifier` default — rejected (throws on many real ids, e.g. uuids with no leading alnum constraint, breaking general use); raw id — rejected (path traversal).

### D3 — Read never-throws; write fails loud
**Decision:** `read`/`has`/`list` never throw (missing file / dir → `undefined`/`false`/`[]`); `write` propagates I/O errors.
**Rationale:** reads are best-effort (Rule 8 — a missing artifact is not a crash); a failed write is a real error the caller must see (fail-fast). Mirrors the M4-2/M4-3 reader-vs-writer split.
**Alternatives considered:** read throws on missing — rejected (callers want `undefined`); write swallows — rejected (silent data loss).

### D4 — Plan-mode composition via overload (sync default preserved)
**Decision:** `createPlanModeTool()` (zero-arg) returns a sync-handler `PlanModeTool` (unchanged); `createPlanModeTool({ artifactStore, artifactId? })` returns a `PlanModeToolWithStore` whose handler is async and persists the optional `plan` input to the store on `exit`.
**Rationale:** existing tests call the sync handler (`JSON.parse(handler(...))`); changing the default to async breaks them. Overloads keep the zero-arg path byte-identical while the store path is async (the SDK tool contract accepts `string | Promise<string>` — `define-tool.ts:25`).
**Alternatives considered:** always-async handler — rejected (breaks existing sync callers + their types); a separate `createPlanModeToolWithArtifacts` factory — viable but the overload keeps one discoverable name matching the roadmap's "composição opt-in em createPlanModeTool".

### D5 — `write` is atomic + creates the dir; `path` is the single source of the location
**Decision:** `write` does `mkdir(dir, { recursive: true })` then `replaceFileAtomic(path(id), content)`; `path(id)` = `safePathJoin(dir, idStrategy(id) + extension)` is reused by read/has.
**Rationale:** one path function → read/write/has always agree; atomic temp+rename avoids partial artifacts (reuses the shipped primitive — Rule 9).
**Alternatives considered:** non-atomic `writeFile` — rejected (partial-write corruption); per-method path derivation — rejected (drift risk).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Two `createPlanModeTool` shapes (overload) could confuse | Low | overloads are typed + documented; zero-arg path unchanged; tests cover both | SDK |
| `list()` returns ids derived from filenames — a non-roundtrippable id strategy (hashing) means `list` ids ≠ original ids | Medium | document that `list()` returns the on-disk filename stems (storage keys), not original ids; `has(id)`/`read(id)` use the id strategy so they round-trip; a test asserts this | SDK |
| Concurrent `write` to the same id (read-modify-write?) | Low | `write` is a full overwrite (not RMW) via atomic rename — last-writer-wins, no partial state; no mutex needed (unlike the categorized memory's append) | SDK |
| A huge artifact content | Low | store persists what it is given; bounding is the caller's concern (document) | SDK |

## Unresolved Questions

(none — every decision is resolved at plan time. Store shape (D1), default id strategy (D2), error policy (D3), plan-mode overload (D4), atomic single-path write (D5) are locked against the session-summary-writer precedent + the SDK tool-handler contract.)

## Dependencies

M4-4 introduces ZERO new dependencies — reuses public path-safety + persistence primitives (Rule 9 / KISS).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `node:fs/promises`, `node:path` | builtin | node | `mkdir`/`readFile`/`readdir` |
| `safeFilenameForId`/`safePathJoin` (`@theokit/sdk/path-safety`) | workspace | npm/TS | default id strategy + traversal-safe path |
| `replaceFileAtomic` (`@theokit/sdk/internal/persistence`, M0-6) | workspace | npm/TS | atomic write |

### New — to be introduced

(none)

## Dependency Graph

```
Phase 1 (createSessionArtifactStore) ──▶ Phase 2 (plan-mode opt-in composition + barrel/docs) ──▶ Phase 3 (integration validation)
```

Sequential.

---

## Phase 1: `createSessionArtifactStore`

**Objective:** implement the generic artifact store, with TDD.

### T1.1 — `createSessionArtifactStore({ dir, idStrategy?, extension? })`

#### Objective
A generic id-keyed atomic artifact store.

#### Why this step (action + reasoning)
1. **What this step does** — adds `packages/sdk-tools/src/artifact-store.ts` with `createSessionArtifactStore` (write/read/has/list/path) over `safeFilenameForId` + `safePathJoin` + `replaceFileAtomic`.
2. **Why it is necessary now** — it is the primary gap deliverable; building it first lets the plan-mode composition (Phase 2) consume a tested store.

#### Evidence
`session-summary-writer.ts` (`replaceFileAtomic(path, body)` keyed by sanitized id) is the pattern to generalize; `safeFilenameForId` (`path-guard.ts:432`) accepts any id; `safePathJoin` traversal guard.

#### Files to edit
```
packages/sdk-tools/src/artifact-store.ts — NEW: createSessionArtifactStore + types
packages/sdk-tools/tests/artifact-store.test.ts — NEW: RED tests (write+read roundtrip, has, list, path traversal-safe, read-missing→undefined, custom idStrategy/extension, overwrite)
```

#### Deep file dependency analysis
- Imports `safeFilenameForId`/`safePathJoin` from `@theokit/sdk/path-safety`, `replaceFileAtomic` from `@theokit/sdk/internal/persistence`, `readFile`/`readdir`/`mkdir` from `node:fs/promises`. No change to existing modules.

#### Deep Dives
- Data: `SessionArtifactStoreOptions = { dir: string; idStrategy?: (id: string) => string; extension?: string }`; returns `{ write(id, content): Promise<string>; read(id): Promise<string | undefined>; has(id): Promise<boolean>; list(): Promise<string[]>; path(id): string }`.
- `path(id)` = `safePathJoin(dir, \`${idStrategy(id)}${extension}\`)` (default extension `.md`).
- `write`: `mkdir(dir, {recursive:true})`; `replaceFileAtomic(path(id), content)`; return path. Overwrite = atomic last-writer-wins.
- `read`: `readFile(path(id),"utf8")` catch → `undefined`. `has`: read !== undefined (or `stat`). `list`: `readdir(dir)` catch → `[]`, filter by extension, return filename stems.
- Edge: missing dir on read/list → `undefined`/`[]`. A traversal id is neutralized by `safeFilenameForId` (hashes) + `safePathJoin`.

#### Pseudo-code / Signatures
```pseudocode
function createSessionArtifactStore({ dir, idStrategy = safeFilenameForId, extension = ".md" }):
  path(id) = safePathJoin(dir, idStrategy(id) + extension)
  write(id, content): await mkdir(dir, recursive); await replaceFileAtomic(path(id), content); return path(id)
  read(id): try return await readFile(path(id), "utf8") catch return undefined
  has(id): return (await read(id)) !== undefined
  list(): try return (await readdir(dir)).filter(endsWith extension).map(strip extension) catch return []
  return { write, read, has, list, path }

# Example
s = createSessionArtifactStore({ dir })
await s.write("run-1", "plan body")   // -> <dir>/run-1.md
await s.read("run-1")                  // "plan body"
await s.has("nope")                    // false
```

#### Tasks
1. Write RED tests (roundtrip; read-missing→undefined; has true/false; list returns stems; custom idStrategy + extension; overwrite replaces; traversal id neutralized).
2. Implement `artifact-store.ts`.

#### TDD
```
RED:     artifactStore_write_read_roundtrip() — write then read returns content; write returns the path
RED:     artifactStore_read_missing_returns_undefined() — unknown id → undefined, no throw
RED:     artifactStore_has_reflects_presence() — has true after write, false before
RED:     artifactStore_list_returns_stems() — list returns the written ids' filename stems
RED:     artifactStore_custom_id_strategy_and_extension() — idStrategy + extension honored
RED:     artifactStore_overwrite_replaces() — second write to same id replaces content
RED:     artifactStore_traversal_id_is_neutralized() — id "../escape" does not write outside dir
GREEN:   Implement artifact-store.ts
REFACTOR: extract path helper if cyclomatic > 10
VERIFY:  pnpm --filter @theokit/sdk-tools exec vitest run tests/artifact-store.test.ts
```

#### Acceptance Criteria
- [ ] All RED tests pass — `pnpm --filter @theokit/sdk-tools exec vitest run tests/artifact-store.test.ts` reports all tests passed.
- [ ] Pass: complexity — `pnpm --filter @theokit/sdk-tools exec biome check src/artifact-store.ts` reports 0 warnings (cyclomatic ≤ 10).
- [ ] Pass: size — `artifact-store.ts` ≤ 500 lines.

#### DoD
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/artifact-store.test.ts` exits 0
- [ ] Zero type errors — `pnpm --filter @theokit/sdk-tools typecheck` exits 0
- [ ] Zero lint warnings — `pnpm --filter @theokit/sdk-tools exec biome check src/artifact-store.ts` exits 0

---

## Phase 2: Plan-mode opt-in composition + barrel/docs

**Objective:** wire the store opt-in into plan-mode (overload), export, document.

### T2.1 — `createPlanModeTool({ artifactStore, artifactId? })` overload + barrel + docs

#### Objective
Opt-in plan persistence + public exports.

#### Why this step (action + reasoning)
1. **What this step does** — adds a `createPlanModeTool` overload taking `{ artifactStore, artifactId? }`; its async handler persists the optional `plan` input on `exit` via the store. Keeps the zero-arg sync overload. Barrel-exports `createSessionArtifactStore` + types; documents; CHANGELOG + changeset.
2. **Why it is necessary now** — the roadmap names "composição opt-in em createPlanModeTool"; doing it after the store exists lets the overload consume a tested store.

#### Evidence
`define-tool.ts:25` — tool handler accepts `string | Promise<string>` (async ok). Existing plan-mode tests call the sync handler (`tests/plan-mode.test.ts`).

#### Files to edit
```
packages/sdk-tools/src/plan-mode.ts — add overload + PlanModeToolWithStore (async handler persisting `plan` on exit)
packages/sdk-tools/src/index.ts — export createSessionArtifactStore + types; export PlanModeToolWithStore type
packages/sdk-tools/tests/plan-mode.test.ts — add store-composition tests (exit persists plan; sync path unchanged)
packages/sdk-tools/tests/artifact-store.test.ts — add barrel wiring test (import from ../src/index.js)
docs.md — document createSessionArtifactStore + plan-mode persistence
CHANGELOG.md (root) — [Unreleased] Added entry
.changeset/m4-artifact-store.md — NEW: minor bump @theokit/sdk-tools
```

#### Deep file dependency analysis
- `plan-mode.ts` imports the `SessionArtifactStore` type from `./artifact-store.js`. The zero-arg overload returns the existing sync `PlanModeTool`; the options overload returns `PlanModeToolWithStore` (async handler).
- Barrel adds `createSessionArtifactStore` + types (additive).

#### Deep Dives
- Overload signatures: `createPlanModeTool(): PlanModeTool;` and `createPlanModeTool(options: { artifactStore: SessionArtifactStore; artifactId?: string }): PlanModeToolWithStore;`.
- The async handler: on `enter`/`status` behaves like the sync one (returns the same JSON, but as `Promise<string>`); on `exit`, if `input.plan` is a non-empty string, `await artifactStore.write(artifactId ?? "plan", input.plan)` then returns the normal exit JSON augmented with `{ persisted: true, path }`.
- inputSchema (store variant) gains an optional `plan` string property.
- Invariant: zero-arg path is byte-identical to today (sync). define-tool accepts the async handler.

#### Pseudo-code / Signatures
```pseudocode
function createPlanModeTool(options?):
  if !options?.artifactStore: return <existing sync PlanModeTool>   // unchanged
  // store variant — async handler
  handler async (input: {action; plan?}):
    if action == "exit" and input.plan: 
      path = await options.artifactStore.write(options.artifactId ?? "plan", input.plan)
      mode = "normal"; return JSON.stringify({ ok:true, mode, message: NORMAL_INSTRUCTIONS, persisted:true, path })
    ... enter/exit/status as before (returned via Promise)
  return { name, description, inputSchema(+plan), handler, currentMode }
```

#### Tasks
1. Add the overload + `PlanModeToolWithStore` + async handler in `plan-mode.ts`.
2. Barrel-export `createSessionArtifactStore` + types.
3. Add plan-mode store tests + artifact-store barrel wiring test.
4. Document; CHANGELOG; changeset (`biome format --write` before commit).

#### TDD
```
RED:     planMode_store_exit_persists_plan() — createPlanModeTool({artifactStore}); handler({action:"exit", plan:"..."}) persists + result.persisted true
RED:     planMode_store_status_no_persist() — status does not write
RED:     planMode_zero_arg_still_sync() — createPlanModeTool() handler returns a string synchronously (existing behavior)
RED:     planMode_store_exit_without_plan_does_not_persist() — (EC-1) exit with no plan → normal mode, no file, persisted not true
RED:     planMode_store_enter_does_not_persist() — (EC-2) enter writes nothing to the store
RED:     artifactStore_exported_from_barrel() — import createSessionArtifactStore from ../src/index.js resolves + round-trips
GREEN:   overload + barrel (this task)
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk-tools exec vitest run tests/plan-mode.test.ts tests/artifact-store.test.ts
```

#### Acceptance Criteria
- [ ] Store-composition + existing sync tests green — `pnpm --filter @theokit/sdk-tools exec vitest run tests/plan-mode.test.ts tests/artifact-store.test.ts` reports all tests passed.
- [ ] `pnpm --filter @theokit/sdk-tools build` emits dist.
- [ ] `docs.md` documents the store + plan-mode persistence; CHANGELOG `[Unreleased] Added` entry present `(#M4-4)`.
- [ ] Pass: lint — `pnpm --filter @theokit/sdk-tools exec biome check src/plan-mode.ts src/artifact-store.ts` reports 0 warnings.

#### DoD
- [ ] Store + plan-mode tests green; barrel export has a real caller
- [ ] Zero type errors — `pnpm --filter @theokit/sdk-tools typecheck` exits 0
- [ ] CHANGELOG + changeset present

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `createSessionArtifactStore({dir, idStrategy})` | T1.1 | generic store (D1) |
| 2 | Generalize session-summary-writer | T1.1 | arbitrary dir + pluggable strategy (D1) |
| 3 | `safeFilenameForId` default id strategy | T1.1 | D2 |
| 4 | Traversal-safe + atomic | T1.1 | safePathJoin + replaceFileAtomic (D5) |
| 5 | Read never-throws / write fails-loud | T1.1 | D3 |
| 6 | Opt-in composition in createPlanModeTool | T2.1 | overload (D4) |
| 7 | Backward-compat zero-arg sync handler | T2.1 | overload preserves sync path (D4) |
| 8 | Barrel export + no orphan | T2.1 | wiring test |
| 9 | Docs + CHANGELOG + changeset | T2.1 | additive |

**Coverage: 9/9 requirements covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/sdk-tools test` green
- [ ] Zero type errors — `pnpm --filter @theokit/sdk-tools typecheck` exits 0
- [ ] Zero lint warnings — `pnpm --filter @theokit/sdk-tools exec biome check` clean
- [ ] File-size budget respected (per `rules/architecture.md`)
- [ ] CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6)
- [ ] Backward compatibility preserved — zero-arg `createPlanModeTool()` sync handler unchanged (existing tests green)
- [ ] Plan-specific: `createSessionArtifactStore` resolves from `@theokit/sdk-tools`; traversal id neutralized; read never-throws
- [ ] `docs.md` documents the store + plan-mode persistence
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merge

## Final Phase: Integration Validation (MANDATORY)

**Objective:** validate the store + plan-mode composition in the built package.

### Execution
```
pnpm --filter @theokit/sdk-tools build
pnpm --filter @theokit/sdk-tools test
pnpm --filter @theokit/sdk-tools typecheck
pnpm --filter @theokit/sdk-tools exec biome check packages/sdk-tools/src packages/sdk-tools/tests
```

### Acceptance Criteria
- [ ] All test suites green — `pnpm --filter @theokit/sdk-tools test` exits 0
- [ ] Coverage ≥ 90% on changed files (`artifact-store.ts`, `plan-mode.ts` — critical paths 100%)
- [ ] Zero type/lint errors — `pnpm --filter @theokit/sdk-tools typecheck` + `pnpm --filter @theokit/sdk-tools exec biome check` each exit 0
- [ ] No regression — `pnpm --filter @theokit/sdk-tools test` reports the full sdk-tools suite passing
- [ ] Traversal-safety proof — `pnpm --filter @theokit/sdk-tools exec vitest run tests/artifact-store.test.ts` confirms an id like `../escape` writes inside `dir` (integration test)

### If Validation Fails
1. Separate plan-caused from pre-existing failures.
2. Fix all plan-caused failures.
3. Re-run the chain.
4. Log pre-existing issues in the PR description.
