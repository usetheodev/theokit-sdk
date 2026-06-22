---
slug: m4-categorized-memory
milestone_id: M4
created_at: 2026-06-21
goal: Ship createCategorizedMemory({root, categories}) in @theokit/sdk-memory (a typed taxonomy store over safePathJoin + redactSecrets + replaceFileAtomic) plus an optional MemoryFact.category, measured by tests/categorized-memory.test.ts passing green.
---

# Plan: M4-3 — `createCategorizedMemory` typed taxonomy store

> **Version 1.1** (edge-case-plan absorbed: EC-1 concurrent-add RMW race → `add` serialized with `withCwdMutex` [MUST FIX]; EC-2 sanitized-collision + EC-3 unsanitizable-category folded into the construction guard + T1.2 TDD; EC-4 no-truncation documented) — Close roadmap gap M4-3: ship `createCategorizedMemory({ root, categories })` in `@theokit/sdk-memory` — a typed, category-partitioned markdown memory store that validates each write's `category` against the closed `categories` taxonomy (the taxonomy IS the schema), redacts secrets, and writes atomically to `<root>/<category>.md` (with a `category` frontmatter header + `## Facts` bullets) reusing the already-public `safePathJoin`/`sanitizeIdentifier` (`@theokit/sdk/path-safety`) + `redactSecrets` + `replaceFileAtomic`. Adds an optional `category?: string` to `MemoryFact` (backward-compatible). The reader is never-throw; the writer fails loud on an unknown category. Replaces the hand-rolled categorized-memory store a consumer (theocode `memory-store.ts`) wrote.

## Goal

> "Enable SDK consumers to store and read project memory under a typed category taxonomy (validated, secret-redacted, atomic) so that categorized memory is a framework call, measured by `pnpm --filter @theokit/sdk-memory exec vitest run tests/categorized-memory.test.ts` reporting all tests passed."

## Context

Roadmap gap M4-3 (`docs/gap-audit/ROADMAP.md:145`, med sev, size M, Tema A, dep M0-4). `@theokit/sdk-memory` today stores facts as flat bullets under `.theokit/memory/MEMORY.md ## Facts` (`internal/store/markdown-store.ts`), and `MemoryFact` is `{ text: string }` (`internal/memory-types.ts:36`) — no category/taxonomy. A consumer who wants categorized memory (user / project / feedback / reference, like theocode's hand-rolled `memory-store.ts` with its `MEMORY_TYPES` enum + per-type files) must build it themselves. M4-3 ships a typed taxonomy store composing the shipped path-safety + redaction + atomic-write primitives. Zero new dependencies (`safePathJoin`/`sanitizeIdentifier`/`redactSecrets` are already used across `sdk-memory`; `replaceFileAtomic` is public via `@theokit/sdk/internal/persistence`).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk-memory/src/internal/memory-types.ts` | ~120 | (iter 52) | canonical memory types (`MemoryFact`, `MemoryConfig`) + `redactSecrets` | `MemoryFact` stays structurally compatible — ADD optional `category?`, never make it required |
| `packages/sdk-memory/src/internal/store/markdown-store.ts` | 149 | (iter 56) | flat MEMORY.md fact store | unchanged (M4-3 is additive; categorized store is a sibling module) |
| `packages/sdk-memory/src/internal/categorized-memory.ts` (NEW) | 0 | — | the typed taxonomy store | — |
| `packages/sdk-memory/src/index.ts` | ~345 | (barrel) | public `@theokit/sdk-memory` barrel | additive export only |
| `packages/sdk-memory/tests/categorized-memory.test.ts` (NEW) | 0 | — | unit + wiring tests — RED first | — |
| `CHANGELOG.md` (root) + `.changeset/` (NEW) | — | — | changelog + changeset | additive `Added` entry |
| `docs.md` | (contract) | — | public API contract | additive `createCategorizedMemory` note |

### Current callers / dependents

- **Symbol:** `MemoryFact` (`internal/memory-types.ts:36`)
  - Callers (production): `markdown-store.ts` (`readFactsFromMarkdown`/`appendFactToMarkdown`), `reader.ts`, active-memory + index modules. Adding an OPTIONAL `category?` is backward-compatible — every existing `{ text }` literal still satisfies the type.
  - Callers (tests): many sdk-memory tests construct `{ text }` — unaffected.
- **Symbol:** `safePathJoin`/`sanitizeIdentifier` (`@theokit/sdk/path-safety`) — already imported in `memory-types.ts:25`; reused, signature untouched.
- **Symbol:** `redactSecrets` (`memory-types.ts`) + `replaceFileAtomic` (`@theokit/sdk/internal/persistence`) — reused; `appendFactToMarkdown` already uses both.
- **External:** none for a categorized store yet — theocode hand-rolls one (intended consumer).

### Domain glossary

- **category / taxonomy** — a closed set of memory buckets (e.g. `["user","project","feedback","reference"]`) the consumer declares at construction; every fact belongs to exactly one.
- **fact** — a single text memory (`MemoryFact`); in the categorized store it additionally carries its `category`.
- **redaction** — `redactSecrets` masks credential patterns (the credential-redaction ADR, 12-pattern list) before persistence.
- **category file** — `<root>/<category>.md`, a markdown file with a `category` frontmatter header + a `## Facts` bullet list.

### Architecture boundaries affected

Per `rules/architecture.md` §1/§2: `categorized-memory.ts` is a leaf domain module in `sdk-memory/internal/` (fs write + the public path-safety/atomic primitives). Exposed via the existing `@theokit/sdk-memory` barrel (`export *`). No new DIP boundary; depends inward only on `memory-types` + `@theokit/sdk` public subpaths.

## Prior Art & Related Work

- **Baseline investigation (2026-06-21)** — Explore agent mapped `MemoryFact` (`memory-types.ts:36`, no category), `markdown-store.ts` flat store, `safePathJoin`/`sanitizeIdentifier`/`redactSecrets` availability, and confirmed `createCategorizedMemory` does not exist.
- **Consumer prior art (hand-roll to replace)** — theocode `server/lib/memory-store.ts`: `MEMORY_TYPES = ['user','project','feedback','reference']`, `MemoryRecord { id, type, content }`, per-type files `<root>/<type>/<id>.md` with `---\ntype:\nid:\n---` frontmatter, using `safePathJoin` + `sanitizeIdentifier` + `replaceFileAtomic` + defensive frontmatter parse.
- **In-repo precedent** — `markdown-store.ts` (`## Facts` bullet format, redact-then-write, atomic + cwd-mutex); `appendFactToMarkdown` (redactSecrets + replaceFileAtomic).
- **ADRs** — `knowledge-base/adrs/D68-*` (redactSecrets 12-pattern list); `knowledge-base/adrs/D76-frontmatter-zod-schema.md` (frontmatter-validation pattern); path-guard ADRs (`knowledge-base/adrs/D80-resolve-then-prefix-check.md`, `knowledge-base/adrs/D81-sanitize-identifier-grammar.md` grammar).

## Objective

- [ ] `MemoryFact` gains an optional `category?: string` (backward-compatible).
- [ ] `createCategorizedMemory({ root, categories })` returns `{ categories, add, list }`.
- [ ] `add(category, text)` validates `category ∈ categories` (else `ConfigurationError(code: "unknown_category")` — fail loud), redacts secrets, appends a bullet to `<root>/<category>.md` (frontmatter header + `## Facts`) atomically AND serialized via `withCwdMutex` (EC-1 — no lost update under concurrent adds).
- [ ] Construction validates `categories`: non-empty, raw-unique, sanitizable, and sanitized-unique (EC-2/EC-3) — else `ConfigurationError(code: "invalid_categories")`.
- [ ] `list(category?)` returns `CategorizedFact[]` (each `{ text, category }`) for one category or all; never throws (missing file → skipped).
- [ ] Reuses `safePathJoin`/`sanitizeIdentifier`/`redactSecrets`/`replaceFileAtomic`; zero new deps.
- [ ] Barrel-exported from `@theokit/sdk-memory`; `docs.md` + CHANGELOG + changeset.
- [ ] `tests/categorized-memory.test.ts` green; typecheck + Biome clean; build emits dist.

## ADRs

### D1 — Category-partitioned files (`<root>/<category>.md`), not one mixed file
**Decision:** each category's facts live in its own `<root>/<category>.md` (frontmatter `category:` header + `## Facts` bullets).
**Rationale:** matches theocode's proven per-type partition; keeps a category's facts independently readable/editable; `list(category)` reads one file; sanitized category name → safe, collision-free filename.
**Alternatives considered:** one `MEMORY.md` with per-bullet `[category]` tags — rejected (parsing fragility, no clean per-category read); one dir per category with one file per fact (theocode's exact shape) — rejected as heavier than needed for a bullet list (YAGNI; a single bullet file per category suffices).

### D2 — The closed `categories` set IS the schema (membership check + typed error), no zod dep
**Decision:** validate `category` with a `Set(categories).has(category)` membership check, throwing `ConfigurationError(code: "unknown_category")` on miss. Do NOT add `zod` to `sdk-memory`.
**Rationale:** the roadmap suggested "frontmatter-zod", but `sdk-memory` has zero dependencies and does not use zod; pulling in zod for a single closed-set membership check violates KISS/YAGNI (Rule 9 is "use a lib for a real problem", not "add a lib for a `Set.has`"). The taxonomy declared at construction is the runtime-checked schema; the typed `ConfigurationError` gives the same fail-fast guarantee.
**Alternatives considered:** add zod + `z.enum(categories)` — rejected (new dep in a zero-dep package for trivial validation); silent skip of unknown category — rejected (Rule 8 — a write to an undeclared bucket is a programming error, fail loud).

### D3 — Optional `category?` on `MemoryFact`, never required
**Decision:** add `category?: string` to `MemoryFact`. The categorized store returns `CategorizedFact = MemoryFact & { category: string }` (category required in the categorized read shape).
**Rationale:** backward-compat — every existing `{ text }` construction across `sdk-memory` + consumers stays valid; the categorized store narrows to a required category in its own return type (ISP — its consumers always get the category).
**Alternatives considered:** a separate `CategorizedFact` with no relation to `MemoryFact` — rejected (loses the shared `text` contract); making `category` required on `MemoryFact` — rejected (breaks every existing caller).

### D4 — Reader never-throws; writer fails loud on unknown category
**Decision:** `list` never throws (a missing/unreadable category file → skipped, like the flat store's `readFactsFromMarkdown`); `add` throws `ConfigurationError` on an unknown category (before any I/O).
**Rationale:** reads are best-effort orientation (Rule 8 — don't crash on a missing file); an unknown-category write is a caller bug that must surface immediately (fail-fast), and validating before I/O avoids a partial write.
**Alternatives considered:** reader throws on unreadable file — rejected (one bad file shouldn't abort `list()`); writer auto-creates the category — rejected (defeats the closed taxonomy).

### D6 — `add` serialized per category file with `withCwdMutex` (EC-1)
**Decision:** wrap the `add` read-modify-write in `withCwdMutex(\`catmem:${root}:${sanitizedCategory}\`, …)` (the shipped `@theokit/sdk/internal/persistence` mutex).
**Rationale:** appending a bullet is a read-modify-write; concurrent adds to the same category file would lose updates. The flat `markdown-store` solves the identical race with `withCwdMutex` (`markdown-store.ts:68`); reusing it (Rule 9) gives the categorized store the same guarantee with zero new code.
**Alternatives considered:** one file per fact (theocode's shape — no RMW, no mutex needed) — rejected as heavier for a bullet list (YAGNI); no serialization — rejected (silent data loss).

### D5 — Self-contained `## Facts` bullet helpers (incidental similarity, not DRY violation)
**Decision:** `categorized-memory.ts` carries its own small pure `## Facts` parse/append helpers rather than refactoring `markdown-store.ts`'s private `parseFactsSection`/`insertFactBullet`.
**Rationale:** the categorized taxonomy store and the auto-managed `MEMORY.md` are DIFFERENT concepts (Rule 12 — code that looks similar but represents different concepts is NOT a DRY violation); the bullet rendering is ~10 lines of incidental similarity. Keeping the store self-contained avoids destabilizing the tested `markdown-store.ts` for a trivial shared format and keeps each store's file shape (category frontmatter vs MEMORY.md header) independent.
**Alternatives considered:** extract shared pure helpers into `fact-markdown.ts` and refactor `markdown-store` to delegate — viable, but adds risk to a tested module + couples two distinct concepts for ~10 lines; revisit only if a third consumer appears (Rule of 3).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Adding `category?` to `MemoryFact` could ripple into index/active-memory serializers | Low | optional field — existing serializers ignore unknown/absent fields; full sdk-memory suite is the regression net | SDK |
| A category name that sanitizes to a collision (e.g. `a/b` vs `a-b`) | Low | `sanitizeIdentifier` is deterministic + the closed `categories` set is caller-declared; document "declare distinct sanitizable categories"; validate categories are non-empty + unique at construction | SDK |
| Self-contained bullet helpers (D5) could drift from `markdown-store`'s format | Low | both are trivial `- text` bullets under `## Facts`; a shared format is not load-bearing across the two concepts; covered by tests on each side | SDK |
| Secret redaction must apply to categorized facts too | Medium | `add` calls `redactSecrets(text)` before persistence (same as `appendFactToMarkdown`); a test asserts a secret pattern is masked | SDK |

## Unresolved Questions

(none — every decision is resolved at plan time. Partition shape (D1), validation-without-zod (D2), optional category (D3), error policy (D4), and self-contained helpers (D5) are locked against the theocode prior art + the in-repo `markdown-store` precedent.)

## Dependencies

M4-3 introduces ZERO new dependencies — reuses primitives already used across `sdk-memory` (Rule 9 / KISS).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `node:fs/promises`, `node:path` | builtin | node | `readFile`/`mkdir`/`join` |
| `safePathJoin`/`sanitizeIdentifier` (`@theokit/sdk/path-safety`) | workspace | npm/TS | safe category filename (already imported in `memory-types.ts`) |
| `redactSecrets` (in-repo, `memory-types.ts`) | workspace | npm/TS | credential masking (credential-redaction ADR) |
| `replaceFileAtomic` + `withCwdMutex` (`@theokit/sdk/internal/persistence`, M0-6) | workspace | npm/TS | atomic write + per-category-file serialization (EC-1/D6) |

### New — to be introduced

(none — explicitly NOT adding `zod`; see ADR D2.)

## Dependency Graph

```
Phase 1 (category? on MemoryFact + createCategorizedMemory) ──▶ Phase 2 (barrel + docs) ──▶ Phase 3 (integration validation)
```

Sequential.

---

## Phase 1: `MemoryFact.category` + `createCategorizedMemory`

**Objective:** add the optional field and implement the typed taxonomy store, with TDD.

### T1.1 — Add optional `category?` to `MemoryFact`

#### Objective
Backward-compatible taxonomy field on the canonical fact type.

#### Why this step (action + reasoning)
1. **What this step does** — adds `category?: string` to `MemoryFact` (`memory-types.ts`).
2. **Why it is necessary now** — the categorized store's `CategorizedFact` extends `MemoryFact` (ADR D3); the field must exist first. Doing it as a tiny isolated change lets the full sdk-memory suite confirm backward-compat before the store lands.

#### Evidence
`MemoryFact = { text: string }` (`memory-types.ts:36`). Consumed by `markdown-store.ts`, `reader.ts`, index/active-memory modules (all construct `{ text }`).

#### Files to edit
```
packages/sdk-memory/src/internal/memory-types.ts — add category?: string to MemoryFact
packages/sdk-memory/tests/categorized-memory.test.ts — NEW: RED test asserting { text } still valid + { text, category } valid
```

#### Deep file dependency analysis
- Optional field → no existing caller breaks (every `{ text }` still satisfies the type). Index serializers ignore absent fields (Drawbacks row).

#### Deep Dives
- Invariant: `category` is OPTIONAL on `MemoryFact`; required only on the categorized store's `CategorizedFact` return shape.

#### Tasks
1. Write a RED type-level + runtime test (construct `{ text }` and `{ text, category }`; both compile + behave).
2. Add the field.

#### TDD
```
RED:     memoryFact_accepts_optional_category() — { text } and { text, category } both valid; full suite still green
GREEN:   add category?: string
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk-memory typecheck && pnpm --filter @theokit/sdk-memory exec vitest run tests/categorized-memory.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk-memory typecheck` exits 0 (backward-compat holds).
- [ ] Pass: size — `memory-types.ts` ≤ 500 lines.

#### DoD
- [ ] `pnpm --filter @theokit/sdk-memory typecheck` exits 0
- [ ] Full sdk-memory suite green — `pnpm --filter @theokit/sdk-memory test` exits 0

### T1.2 — `createCategorizedMemory({ root, categories })`

#### Objective
Implement the typed taxonomy store (`add` + `list`).

#### Why this step (action + reasoning)
1. **What this step does** — adds `packages/sdk-memory/src/internal/categorized-memory.ts` with `createCategorizedMemory` validating categories, redacting + appending bullets to `<root>/<category>.md`, and reading them back as `CategorizedFact[]`.
2. **Why it is necessary now** — it is the gap deliverable; building it over the shipped primitives (ADR D1–D5) closes the categorized-memory hole consumers hit.

#### Evidence
theocode `memory-store.ts` per-type partition + frontmatter; `markdown-store.ts` `## Facts` bullet + redact-then-atomic-write precedent; `safePathJoin`/`sanitizeIdentifier`/`redactSecrets`/`replaceFileAtomic` all available.

#### Files to edit
```
packages/sdk-memory/src/internal/categorized-memory.ts — NEW: createCategorizedMemory + CategorizedFact + options/types + pure ## Facts helpers
packages/sdk-memory/tests/categorized-memory.test.ts — add RED tests (add+list roundtrip, per-category isolation, unknown-category throws, redaction, list-all, never-throw read, empty/dup categories guard)
```

#### Deep file dependency analysis
- Imports `MemoryFact`/`redactSecrets` from `./memory-types.js`, `safePathJoin`/`sanitizeIdentifier` from `@theokit/sdk/path-safety`, `replaceFileAtomic` from `@theokit/sdk/internal/persistence`, `ConfigurationError` from `@theokit/sdk`. No change to other modules.

#### Deep Dives
- Data: `CategorizedFact = { text: string; category: string }`; `CreateCategorizedMemoryOptions = { root: string; categories: readonly string[] }`; returns `{ categories: readonly string[]; add(category, text): Promise<void>; list(category?): Promise<CategorizedFact[]> }`.
- Construction guard: `categories` must be non-empty + unique (else `ConfigurationError(code:"invalid_categories")`).
- `add`: `assertKnown(category)`; `text2 = redactSecrets(text)`; `path = safePathJoin(root, \`${sanitizeIdentifier(category)}.md\`)`; read-or-init the file (`---\ncategory: <cat>\n---\n\n## Facts\n`), append `- <text2>` bullet, `mkdir(root,{recursive})`, `replaceFileAtomic`.
- `list(category?)`: if `category` → `assertKnown` + read that file → bullets → `{text, category}[]`; else iterate `categories`, read each (skip missing), merge. Never throws.
- Invariant: secrets redacted before persistence (Drawbacks row). Unknown category → throw BEFORE any write.

#### Pseudo-code / Signatures
```pseudocode
function createCategorizedMemory({ root, categories }):
  # EC-2/EC-3: non-empty, raw-unique, each sanitizable, sanitized-unique
  if categories empty or hasRawDups(categories): throw ConfigurationError(invalid_categories)
  sanitized = categories.map(c => trySanitize(c) ?? throw ConfigurationError(invalid_categories))
  if new Set(sanitized).size !== categories.length: throw ConfigurationError(invalid_categories)
  allowed = new Set(categories)
  assertKnown(c): if !allowed.has(c): throw ConfigurationError(unknown_category)
  add(category, text):
    assertKnown(category)
    safe = redactSecrets(text)
    sane = sanitizeIdentifier(category)
    return withCwdMutex(`catmem:${root}:${sane}`, async () => {   # EC-1/D6 serialize RMW
      path = safePathJoin(root, sane + ".md")
      raw = (await readFile(path).catch(() => "")) || header(category)
      await mkdir(root, recursive); await replaceFileAtomic(path, appendBullet(raw, safe))
    })
  list(category?):
    cats = category ? [assertKnown(category), category][1..] : categories
    out = []
    for c in cats: out.push(...parseBullets(await readFile(path(c)).catch(()=>"")).map(t => ({text:t, category:c})))
    return out
  return { categories: [...categories], add, list }

# Example
m = createCategorizedMemory({ root, categories: ["user","project"] })
await m.add("user", "prefers TS")
await m.list("user")  // [{ text: "prefers TS", category: "user" }]
await m.add("x", "…")  // throws ConfigurationError(unknown_category)
```

#### Tasks
1. Write RED tests (roundtrip; isolation between categories; unknown-category throws; secret redaction; list() merges all; never-throw on missing; empty/dup categories throw at construction).
2. Implement `categorized-memory.ts`.

#### TDD
```
RED:     categorizedMemory_add_and_list_roundtrip() — add to "user", list("user") returns it with category
RED:     categorizedMemory_isolates_categories() — add to "user" not visible under "project"
RED:     categorizedMemory_unknown_category_throws() — add("nope",..) throws ConfigurationError code unknown_category, writes nothing
RED:     categorizedMemory_redacts_secrets() — a secret pattern in text is masked on disk
RED:     categorizedMemory_list_all_merges_categories() — list() returns facts from every category, each tagged
RED:     categorizedMemory_list_missing_is_empty() — list on a never-written category → []
RED:     categorizedMemory_rejects_empty_or_duplicate_categories() — construction throws ConfigurationError invalid_categories
RED:     categorizedMemory_concurrent_adds_lose_nothing() — (EC-1) Promise.all of N adds to one category → list returns all N
RED:     categorizedMemory_rejects_sanitize_collision() — (EC-2) ["a b","a-b"] → construction throws invalid_categories
RED:     categorizedMemory_rejects_unsanitizable_category() — (EC-3) a category sanitizeIdentifier rejects → construction throws invalid_categories
GREEN:   Implement categorized-memory.ts (add serialized via withCwdMutex)
REFACTOR: extract assertKnown / header / bullet helpers if cyclomatic > 10
VERIFY:  pnpm --filter @theokit/sdk-memory exec vitest run tests/categorized-memory.test.ts
```

#### Acceptance Criteria
- [ ] All RED tests pass — `pnpm --filter @theokit/sdk-memory exec vitest run tests/categorized-memory.test.ts` reports all tests passed.
- [ ] Pass: complexity — `pnpm --filter @theokit/sdk-memory exec biome check src/internal/categorized-memory.ts` reports 0 warnings (cyclomatic ≤ 10).
- [ ] Pass: size — `categorized-memory.ts` ≤ 500 lines.
- [ ] Secret redaction verified on disk — `pnpm --filter @theokit/sdk-memory exec vitest run tests/categorized-memory.test.ts` reports the redaction test passed (a known credential pattern is masked).

#### DoD
- [ ] `pnpm --filter @theokit/sdk-memory exec vitest run tests/categorized-memory.test.ts` exits 0
- [ ] Zero type errors — `pnpm --filter @theokit/sdk-memory typecheck` exits 0
- [ ] Zero lint warnings — `pnpm --filter @theokit/sdk-memory exec biome check src/internal/categorized-memory.ts` exits 0

---

## Phase 2: Barrel export + docs

**Objective:** expose `createCategorizedMemory` from `@theokit/sdk-memory`, documented + changelogged.

### T2.1 — Barrel export + docs/changelog + wiring test

#### Objective
Export from the package barrel, document, and prove it resolves through the published entry point.

#### Why this step (action + reasoning)
1. **What this step does** — adds `export * from "./internal/categorized-memory.js"` to `src/index.ts`, documents in `docs.md`, adds CHANGELOG + changeset, and adds a wiring test importing from the package barrel.
2. **Why it is necessary now** — the primitive is unreachable until barrel-exported; the wiring test is the triad (static caller + real-fs integration) preventing an orphan export.

#### Evidence
`sdk-memory/src/index.ts` uses `export *` per internal module (e.g. line 322 markdown-store). `@theokit/sdk-memory` exports `.` only (single barrel — no subpath machinery).

#### Files to edit
```
packages/sdk-memory/src/index.ts — add export * from "./internal/categorized-memory.js"
packages/sdk-memory/tests/categorized-memory.test.ts — add a wiring test importing from "../src/index.js"
docs.md — document createCategorizedMemory
CHANGELOG.md (root) — [Unreleased] Added entry
.changeset/m4-categorized-memory.md — NEW: minor bump @theokit/sdk-memory
```

#### Deep file dependency analysis
- Barrel add is additive `export *`. Wiring test imports `createCategorizedMemory` from `../src/index.js` and round-trips on a temp dir (real fs).

#### Deep Dives
- The wiring test exercises the public barrel path (not the internal file) — proving the export resolves.

#### Tasks
1. Add barrel export.
2. Add wiring test (barrel import + temp-dir roundtrip).
3. Document in `docs.md`; CHANGELOG entry; changeset (`biome format --write` before commit).

#### TDD
```
RED:     categorizedMemory_exported_from_barrel() — import from "../src/index.js" resolves the factory + round-trips
GREEN:   barrel export (this task)
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk-memory exec vitest run tests/categorized-memory.test.ts && pnpm --filter @theokit/sdk-memory build
```

#### Acceptance Criteria
- [ ] Wiring test green — `pnpm --filter @theokit/sdk-memory exec vitest run tests/categorized-memory.test.ts` reports all tests passed.
- [ ] `pnpm --filter @theokit/sdk-memory build` emits dist.
- [ ] `docs.md` documents the factory; CHANGELOG `[Unreleased] Added` entry present `(#M4-3)`.
- [ ] Pass: lint — `pnpm --filter @theokit/sdk-memory exec biome check src/internal/categorized-memory.ts tests/categorized-memory.test.ts` reports 0 warnings.

#### DoD
- [ ] Wiring test green; barrel export has a real caller
- [ ] Build green; CHANGELOG + changeset present
- [ ] Zero type errors / lint warnings

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Optional `MemoryFact.category` | T1.1 | additive field (D3) |
| 2 | `createCategorizedMemory({root, categories})` | T1.2 | factory (D1) |
| 3 | Typed taxonomy validation | T1.2 | closed-set membership + `ConfigurationError` (D2) |
| 4 | Reuse safePathJoin / redact / atomic | T1.2 | composition (Dependencies) |
| 5 | Reader never-throws / writer fails-loud | T1.2 | D4 |
| 6 | Secret redaction on categorized facts | T1.2 | `redactSecrets` before write |
| 7 | Barrel export (`@theokit/sdk-memory`) | T2.1 | `export *` |
| 8 | Docs + CHANGELOG + changeset | T2.1 | additive |
| 9 | No orphan export / real caller | T2.1 | wiring test |

**Coverage: 9/9 requirements covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/sdk-memory test` green
- [ ] Zero type errors — `pnpm --filter @theokit/sdk-memory typecheck` exits 0
- [ ] Zero lint warnings — `pnpm --filter @theokit/sdk-memory exec biome check` clean
- [ ] File-size budget respected (per `rules/architecture.md`)
- [ ] CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6)
- [ ] Backward compatibility preserved — `MemoryFact` consumers unaffected (optional field)
- [ ] Plan-specific: `createCategorizedMemory` resolves from `@theokit/sdk-memory`; secrets redacted on disk; unknown category fails loud
- [ ] `docs.md` documents the factory
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merge

## Final Phase: Integration Validation (MANDATORY)

**Objective:** validate the new factory works in the built package, not just source.

### Execution
```
pnpm --filter @theokit/sdk-memory build
pnpm --filter @theokit/sdk-memory test
pnpm --filter @theokit/sdk-memory typecheck
pnpm --filter @theokit/sdk-memory exec biome check packages/sdk-memory/src packages/sdk-memory/tests
```

### Acceptance Criteria
- [ ] All test suites green — `pnpm --filter @theokit/sdk-memory test` exits 0
- [ ] Coverage ≥ 90% on changed files (`categorized-memory.ts` — critical paths 100%)
- [ ] Zero type/lint errors — `pnpm --filter @theokit/sdk-memory typecheck` + `pnpm --filter @theokit/sdk-memory exec biome check` each exit 0
- [ ] No regression — `pnpm --filter @theokit/sdk-memory test` reports the full sdk-memory suite passing
- [ ] Secret-redaction proof — `pnpm --filter @theokit/sdk-memory exec vitest run tests/categorized-memory.test.ts` confirms a credential pattern is masked on disk (integration test, not just unit assertion)

### If Validation Fails
1. Separate plan-caused from pre-existing failures.
2. Fix all plan-caused failures.
3. Re-run the chain.
4. Log pre-existing issues in the PR description.
