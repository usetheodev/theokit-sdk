---
slug: m4-skills-discovery
milestone_id: M4
created_at: 2026-06-21
goal: Ship a @theokit/sdk/skills subpath exposing discoverSkills(dir, options?) + buildSkillsBlock(skills) over the existing @internal skills primitives, measured by tests/skills-subpath.test.ts + tests/skills-wiring.test.ts passing green.
---

# Plan: M4-1 — `@theokit/sdk/skills` discovery + `<skills>` block

> **Version 1.1** (edge-case-plan absorbed: EC-1 file-path-input + EC-2 skill-less-subdir folded into T1.2 TDD; EC-3 readdir-order documented) — Close roadmap gap M4-1: ship a public `@theokit/sdk/skills` subpath that exposes two pure, first-party primitives — `discoverSkills(dir, options?)` (discover `SKILL.md` files under an ARBITRARY directory, with real YAML frontmatter parse + symlink-escape guard) and `buildSkillsBlock(skills)` (render the prompt-injection-safe `<skills>` block) — by extracting the logic that already lives @internal inside `SkillsManager` and `SkillsPromptProvider`, refactoring those internal callers to delegate to the new pure functions (DRY, behavior-preserving), and wiring the subpath the same way `@theokit/sdk/models` is wired. The expected outcome: a consumer (e.g. theocode, which hand-rolled `skills-store.ts`) can discover skills in any dir and build the `<skills>` block with one import instead of ~70 LoC of app code.

## Goal

> "Enable SDK consumers to discover SKILL.md skills in an arbitrary directory and render a prompt-injection-safe `<skills>` block so that skills orientation is a framework call (not ~70 LoC of app code), measured by `pnpm --filter @theokit/sdk exec vitest run tests/skills-subpath.test.ts tests/skills-wiring.test.ts` reporting all tests passed."

## Context

Roadmap gap M4-1 (`docs/gap-audit/ROADMAP.md:91`, high sev, size M, Tema A, dep M0-4). The SDK already discovers skills internally — `SkillsManager` (`packages/sdk/src/internal/runtime/skills/skills-manager.ts:33`) loads `.theokit/skills/<name>/SKILL.md`, parses strict YAML frontmatter via `parseSkillFrontmatter` (`skill-frontmatter.ts:48`), and `SkillsPromptProvider` (`system-prompt/sources/skills-provider.ts:15`) renders the `<skills>` block. But ALL of it is `@internal` and the discovery root is **hardcoded** to `.theokit/skills` (`skills-manager.ts:54`). A consumer who wants to discover skills in a different dir (or just reuse the proven frontmatter parse + injection-safe block builder) cannot — theocode reimplemented the whole thing by hand in `server/lib/skills-store.ts` (regex frontmatter, no zod, its own `<skills>` renderer), which is exactly the Rule-9 violation the gap audit flagged.

M4-1 exposes these as composable primitives over a new `@theokit/sdk/skills` subpath: `discoverSkills(dir, options?)` generalizes the hardcoded-root discovery loop to an arbitrary dir, and `buildSkillsBlock(skills)` extracts the pure block-rendering from the provider. The existing internal callers are refactored to delegate (single source of truth — Rule 9 / DRY). `safePathJoin`/`assertNoSymlinkEscape` are already public via `@theokit/sdk/path-safety` (M0-4), so the symlink-escape guard is reused, not reimplemented. Zero new dependencies.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/src/internal/runtime/skills/skills-manager.ts` | 114 | `31ba23b` (2026-06-18) | File-based skills loader for `.theokit/skills` | `SkillsManager` public methods (`initialize`/`refresh`/`list`) keep working; stderr warning on malformed skill preserved (golden test); symlink-escape guard preserved |
| `packages/sdk/src/internal/runtime/skills/skill-frontmatter.ts` | 116 | `31ba23b` (2026-06-18) | Strict SKILL.md frontmatter parser (strict-frontmatter ADR `knowledge-base/adrs/D10-skills-frontmatter-schema.md`) | `parseSkillFrontmatter(raw, fallbackName)` signature + typed `ConfigurationError` codes (`missing_frontmatter`/`schema_invalid`) unchanged |
| `packages/sdk/src/internal/runtime/system-prompt/sources/skills-provider.ts` | 29 | `e7dc48f` (2026-06-07) | Contributes the `<skills>` block (skills-block + injection-escape ADR) | Block output byte-identical (golden test `skills-provider.golden.test.ts`); `escapeBlockBody` injection defence preserved |
| `packages/sdk/src/internal/runtime/skills/discover-skills.ts` (NEW) | 0 | — | (the pure `discoverSkills(dir, options?)`) | — |
| `packages/sdk/src/internal/runtime/skills/skills-block.ts` (NEW) | 0 | — | (the pure `buildSkillsBlock(skills)`) | — |
| `packages/sdk/src/skills.ts` (NEW) | 0 | — | public `@theokit/sdk/skills` barrel | additive re-exports only |
| `packages/sdk/tsup.config.ts` | (build) | — | tsup entry map | add `skills` entry; do not touch other entries |
| `packages/sdk/tsconfig.tools-dts.json` | (build) | — | tsc DTS include list | add `src/skills.ts` |
| `packages/sdk/scripts/mirror-dts-to-cts.mjs` | (build) | — | `.d.ts`→`.d.cts` mirror list | add `skills.d.ts` |
| `packages/sdk/package.json` | (manifest) | — | exports map | add `./skills` (dual import/require) |
| `packages/sdk/tests/skills-subpath.test.ts` (NEW) | 0 | — | unit tests — RED first | — |
| `packages/sdk/tests/skills-wiring.test.ts` (NEW) | 0 | — | barrel wiring test (built dist) | — |
| `docs.md` | (contract) | — | public API contract | additive `@theokit/sdk/skills` note |
| `CHANGELOG.md` (root) + `packages/sdk/CHANGELOG.md` + `.changeset/` (NEW) | — | — | changelog + changeset | additive `Added` entry |

### Current callers / dependents

- **Symbol:** `SkillsManager` (`internal/runtime/skills/skills-manager.ts:33`)
  - Callers (production): `packages/sdk/src/internal/runtime/local-agent/**` (instantiated for `agent.skills.list()`). Refactor is internal to `refresh()` — the class surface is unchanged, so callers are unaffected.
  - Callers (tests): `tests/contract/skills.contract.test.ts`, `tests/golden/runtime/skills-strict.golden.test.ts`.
- **Symbol:** `parseSkillFrontmatter` (`skill-frontmatter.ts:48`)
  - Callers (production): `skills-manager.ts:95` (via `tryParseSkill`). `discoverSkills` will call the same parser → no second parser.
  - Callers (tests): covered transitively by skills golden/contract tests.
- **Symbol:** `SkillsPromptProvider.contribute` (`skills-provider.ts:19`)
  - Callers (production): system-prompt assembly registry. Refactored to call `buildSkillsBlock` internally; output preserved.
  - Callers (tests): `tests/golden/runtime/system-prompt/skills-provider.golden.test.ts`.
- **External (public API consumed by other repos):** none yet for these internals (they are `@internal`). theocode hand-rolled an equivalent in `server/lib/skills-store.ts` — that is the intended future consumer, not a current caller of these symbols.

### Domain glossary

- **SKILL.md** — a markdown file with a strict YAML frontmatter head (`name`, `description` required; `category`, `dependencies` optional) describing one skill; the body is the skill prompt and is NEVER injected as metadata.
- **skills root** — the directory that contains `<skill-name>/SKILL.md` subdirectories. Today hardcoded to `<cwd>/.theokit/skills`; M4-1 makes it an explicit argument.
- **`<skills>` block** — the system-prompt fragment listing `- name: description` per skill, with both fields XML-escaped (injection-escape ADR) to neutralise prompt injection.
- **symlink-escape guard** — `assertNoSymlinkEscape(path, base)` rejects a discovered subdir whose realpath resolves outside the skills root (EC-1 / Hermes #386/#61).

### Architecture boundaries affected

Per `rules/architecture.md` §1/§2: the two new pure functions live in `internal/runtime/skills/` (domain logic, fs read only — no outward dependency). The public barrel `src/skills.ts` is a leaf re-export, mirroring `src/models.ts`. It re-uses the already-public `@theokit/sdk/path-safety` primitives (no new DIP boundary crossed). No layer inversion: the barrel depends inward on `internal/`, never the reverse.

## Prior Art & Related Work

- **Baseline investigation (this session, 2026-06-21)** — Explore agent mapped: `parseSkillFrontmatter` (`skill-frontmatter.ts:48`), `SkillsManager` hardcoded root (`skills-manager.ts:54`), `buildSkillsBlock` logic coupled in `skills-provider.ts:15-29`, subpath wiring pattern = tsup + tsconfig.tools-dts + mirror + exports.
- **In-repo precedent (subpath wiring)** — `@theokit/sdk/models` (`src/models.ts` + `tsup.config.ts:13` + `tsconfig.tools-dts.json:16` + `mirror-dts-to-cts.mjs:35-36` + `package.json:71` exports). M4-1 mirrors it exactly.
- **In-repo precedent (path-safety reuse)** — `safePathJoin`/`assertNoSymlinkEscape` already public via `@theokit/sdk/path-safety` (M0-4); `skills-manager.ts:5` already imports them from `../../security/path-guard.js`.
- **Consumer prior art (hand-roll to replace)** — theocode `server/lib/skills-store.ts` (`listSkills`/`renderSkillsBlock`/`parseFrontmatter`, regex-based, no zod) — the ~70 LoC this primitive eliminates.
- **ADRs (in-repo `knowledge-base/adrs/`)** — `knowledge-base/adrs/D10-skills-frontmatter-schema.md` (strict skill frontmatter), the skills-block + injection-escape ADRs, `knowledge-base/adrs/D79-path-guard-canonical-module.md` + `knowledge-base/adrs/D80-resolve-then-prefix-check.md` (path-guard defense-in-depth).

## Objective

- [ ] `discoverSkills(dir, options?)` discovers `<dir>/<name>/SKILL.md`, parses strict frontmatter, skips malformed skills (optional `onInvalidSkill` callback), applies the symlink-escape guard, and returns `Skill[]`.
- [ ] `buildSkillsBlock(skills)` returns the injection-safe `<skills>` block string (or `undefined` for an empty list), byte-identical to the current provider output.
- [ ] `SkillsManager.refresh()` delegates to `discoverSkills` (single source of truth); `SkillsPromptProvider.contribute()` delegates to `buildSkillsBlock`. Existing golden/contract tests stay green (behavior preserved).
- [ ] `@theokit/sdk/skills` subpath wired (tsup + tsconfig.tools-dts + mirror + exports), importable in both ESM and CJS with types.
- [ ] Zero new deps; `docs.md` + CHANGELOG + changeset updated.
- [ ] `tests/skills-subpath.test.ts` + `tests/skills-wiring.test.ts` green; typecheck + Biome + knip clean; build emits dist + `attw`/`publint` clean.

## ADRs

### D1 — Extract pure primitives + delegate internal callers (compose, not duplicate)
**Decision:** create `discoverSkills(dir, options?)` and `buildSkillsBlock(skills)` as pure functions in `internal/runtime/skills/`, then refactor `SkillsManager.refresh()` and `SkillsPromptProvider.contribute()` to delegate to them. The public barrel re-exports the two functions.
**Rationale:** Rule 9 / DRY — one discovery loop, one block renderer. The internal callers become thin adapters over the public primitive, guaranteeing the public API has the exact battle-tested behavior (and golden tests keep protecting it).
**Alternatives considered:** (a) copy the logic into `src/skills.ts` and leave the internals untouched — rejected: two implementations drift (the bug theocode hit); (b) make `SkillsManager` itself public — rejected: it carries stateful `.theokit`-specific lifecycle (`settingSourcesIncludeProject`, `initialize`) that is not the consumer's concern; a pure `discoverSkills(dir)` is the right ISP-shaped surface.
**Consequences:** enables arbitrary-dir discovery; constrains future skill-discovery changes to flow through one function.

### D2 — `discoverSkills` takes an explicit root dir, not a cwd + hardcoded suffix
**Decision:** `discoverSkills(dir)` treats `dir` as THE skills root (the dir holding `<name>/SKILL.md`). The caller composes the path (`join(cwd, ".theokit", "skills")`) — the primitive does not assume `.theokit`.
**Rationale:** the gap is literally "discovery in an arbitrary dir". Hardcoding any suffix re-creates the limitation. `SkillsManager` keeps composing `.theokit/skills` and passes the composed root to `discoverSkills`.
**Alternatives considered:** `discoverSkills(cwd, { subdir })` — rejected: leaks a `.theokit` default into the primitive; YAGNI. The caller already knows its own convention.
**Consequences:** primitive is convention-agnostic; the `.theokit` convention stays an SDK-runtime detail in `SkillsManager`.

### D3 — Invalid-skill handling via optional callback, default silent (no stderr in the public primitive)
**Decision:** `discoverSkills(dir, options?: { onInvalidSkill?: (info: { name; source; code; message }) => void })`. Default: malformed skills are silently skipped. `SkillsManager` passes an `onInvalidSkill` that writes the existing stderr warning, preserving current runtime behavior exactly.
**Rationale:** a library primitive must not spam a consumer's stderr by default (Rule 8 — fail loud belongs to the app, not silently-imposed by a helper). The callback gives the consumer the same information without the SDK deciding the sink.
**Alternatives considered:** (a) always write stderr — rejected: rude default for a library; (b) throw on first malformed skill — rejected: contradicts the strict-frontmatter ADR / EC-5 (one broken skill must not break discovery); (c) return `{ skills, errors }` tuple — rejected as heavier than needed; the callback covers the streaming case and keeps the return type a plain `Skill[]` (KISS).
**Consequences:** runtime behavior preserved (SkillsManager still warns); consumers opt into diagnostics.

### D4 — Public type `Skill` re-exported from the internal `SkillMetadata`
**Decision:** export the discovery result type as `Skill` (alias of the internal `SkillMetadata` shape: `{ name; description; source; category?; dependencies? }`). `buildSkillsBlock` accepts the structural subset `ReadonlyArray<{ name: string; description: string }>`.
**Rationale:** `Skill` is the consumer-facing noun; `buildSkillsBlock` only needs name+description (ISP — don't force callers to carry `source`/`category` to render a block).
**Alternatives considered:** export `SkillMetadata` verbatim — rejected: `Metadata` is an internal-implementation noun; `Skill` reads better in a public API. Keep one shape, two names (type alias, zero runtime cost).
**Consequences:** public vocabulary is clean; the alias keeps a single structural type.

### D5 — Subpath wired exactly like `@theokit/sdk/models` (tsc-dts path)
**Decision:** add `skills` to `tsup.config.ts` entries, `src/skills.ts` to `tsconfig.tools-dts.json` include, `skills.d.ts` to `mirror-dts-to-cts.mjs`, and `./skills` to `package.json` exports (dual import/require with types).
**Rationale:** `models`/`compaction`/`messages` already use the tsc-dts path because they re-export from `internal/` (rollup-dts would hit cycles). `skills.ts` re-exports from `internal/runtime/skills/**`, so it MUST use the same path. Consistency = lower review + maintenance cost.
**Alternatives considered:** rollup `dts.entry` block — rejected: reserved for the 5 cycle-free leaf entries; a re-export-from-internal entry there breaks the DTS build.
**Consequences:** the subpath ships ESM+CJS+types; `attw`/`publint` validate it in the Integration phase.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Refactoring `SkillsManager.refresh()` + `SkillsPromptProvider.contribute()` could change observable behavior (stderr text, block bytes) | Medium | Golden tests (`skills-strict.golden.test.ts`, `skills-provider.golden.test.ts`) + contract test run RED→GREEN unchanged; D3 passes the exact stderr writer through the callback | SDK |
| New public surface area must stay supported (semver) | Low | Surface is 2 functions + 1 type, all thin re-exports of long-stable internals; documented in `docs.md` | SDK |
| `discoverSkills` on a non-existent / unreadable dir must not throw | Low | Reuse `readWorkspaceDir` (already returns `[]` on read error) OR mirror its try/catch; covered by a RED test for missing dir | SDK |
| Public primitive could leak the skill BODY into metadata | Low | `Skill` type has no body field; `buildSkillsBlock` input type excludes it (skills-block injection-escape invariant) — enforced by the type, tested | SDK |

## Unresolved Questions

(none — every decision is resolved at plan time. `discoverSkills` root semantics (D2), invalid-skill sink (D3), public type name (D4), and wiring path (D5) are all locked against in-repo precedent and existing golden tests.)

## Dependency Graph

```
Phase 1 (extract pure primitives + delegate) ──▶ Phase 2 (wire subpath + docs) ──▶ Phase 3 (integration validation)
```

Sequential. Phase 2 imports the symbols Phase 1 creates; Phase 3 validates the built artifact from Phase 2.

---

## Phase 1: Extract pure primitives and delegate internal callers

**Objective:** create `discoverSkills` + `buildSkillsBlock` as pure functions and make the existing internal callers delegate to them, with behavior preserved (golden tests green).

### T1.1 — Extract `buildSkillsBlock(skills)` and delegate `SkillsPromptProvider`

#### Objective
Create a pure `buildSkillsBlock(skills)` that renders the injection-safe `<skills>` block, and refactor `SkillsPromptProvider.contribute()` to call it.

#### Why this step (action + reasoning)
1. **What this step does** — adds `packages/sdk/src/internal/runtime/skills/skills-block.ts` exporting `buildSkillsBlock(skills: ReadonlyArray<{name; description}>): string | undefined`, moving the escape+join logic out of `SkillsPromptProvider.contribute()`; the provider then calls it.
2. **Why it is necessary now** — `buildSkillsBlock` is one of the two primitives the gap (and ADR D1) require. Extracting first (before wiring the barrel) lets the golden test `skills-provider.golden.test.ts` prove the block is byte-identical, de-risking the public export.

#### Evidence
`skills-provider.ts:22-27` builds `  - ${escapeBlockBody(name)}: ${escapeBlockBody(description)}` lines and wraps them in `<skills>\n...\n</skills>`. `escapeBlockBody` is at `system-prompt/escape.ts`.

#### Files to edit
```
packages/sdk/src/internal/runtime/skills/skills-block.ts — NEW: pure buildSkillsBlock + re-export escape usage
packages/sdk/src/internal/runtime/system-prompt/sources/skills-provider.ts — delegate to buildSkillsBlock
packages/sdk/tests/skills-subpath.test.ts — NEW: RED tests for buildSkillsBlock (escaping, empty list)
```

#### Deep file dependency analysis
- `skills-provider.ts` today (Baseline row) renders the block inline; it imports `escapeBlockBody` from `../escape.js`. After: it imports `buildSkillsBlock` from `../../skills/skills-block.js` and returns `buildSkillsBlock(ctx.skills) ?? undefined` guarded by the existing `skillsAutoInject`/empty checks. `skills-block.ts` imports `escapeBlockBody` (move the dependency down, not duplicate it).
- Downstream: the system-prompt golden test asserts the exact block — it must stay green.

#### Deep Dives
- Invariant: empty list → provider returns `undefined` (block omitted). `buildSkillsBlock([])` returns `undefined`; the provider keeps its `ctx.skills.length === 0` early return too (defensive, identical result).
- Edge case: a name/description containing `<`, `>`, `&` must be escaped (injection-escape ADR). Test asserts `&lt;`/`&gt;`/`&amp;`.

#### Pseudo-code / Signatures
```pseudocode
function buildSkillsBlock(skills: ReadonlyArray<{name:string; description:string}>): string | undefined
  if skills.length == 0: return undefined
  lines = skills.map(s => `  - ${escapeBlockBody(s.name)}: ${escapeBlockBody(s.description)}`)
  return `<skills>\n${lines.join("\n")}\n</skills>`

# Example
input:  [{name:"code-review", description:"Reviews <diffs>"}]
output: "<skills>\n  - code-review: Reviews &lt;diffs&gt;\n</skills>"
```

#### Tasks
1. Write RED tests in `tests/skills-subpath.test.ts` for `buildSkillsBlock` (single skill, multiple, empty→undefined, injection escaping).
2. Create `skills-block.ts` with `buildSkillsBlock`.
3. Refactor `skills-provider.ts` to delegate.
4. Run skills golden test to confirm byte-identical output.

#### TDD
```
RED:     buildSkillsBlock_renders_name_and_description() — asserts "  - n: d" line format inside <skills>
RED:     buildSkillsBlock_escapes_injection_chars() — asserts <,>,& become &lt;,&gt;,&amp;
RED:     buildSkillsBlock_empty_returns_undefined() — asserts undefined for []
GREEN:   Implement skills-block.ts + delegate provider
REFACTOR: remove now-dead inline render in provider
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/skills-subpath.test.ts tests/golden/runtime/system-prompt/skills-provider.golden.test.ts
```

#### Acceptance Criteria
- [ ] `buildSkillsBlock` tests green; provider golden test green (byte-identical block).
- [ ] Pass: complexity — `skills-block.ts` cyclomatic ≤ 10.
- [ ] Pass: lint — `pnpm --filter @theokit/sdk exec biome check packages/sdk/src/internal/runtime/skills/skills-block.ts` reports 0 warnings.
- [ ] Pass: size — `skills-block.ts` ≤ 500 lines.

#### DoD
- [ ] All T1.1 tasks completed and validated
- [ ] `pnpm --filter @theokit/sdk test` green for touched files
- [ ] Zero type errors — `pnpm --filter @theokit/sdk typecheck`
- [ ] Zero lint warnings — Biome clean
- [ ] File-size budget respected

### T1.2 — Extract `discoverSkills(dir, options?)` and delegate `SkillsManager.refresh()`

#### Objective
Create a pure `discoverSkills(dir, options?)` that discovers/parses skills under an arbitrary root, and refactor `SkillsManager.refresh()` to delegate to it.

#### Why this step (action + reasoning)
1. **What this step does** — adds `packages/sdk/src/internal/runtime/skills/discover-skills.ts` exporting `discoverSkills(dir, options?)`, moving the readdir→safePathJoin→assertNoSymlinkEscape→readFile→parseSkillFrontmatter loop out of `SkillsManager.refresh()`; the manager then calls `discoverSkills(join(cwd, ".theokit", "skills"), { onInvalidSkill: stderrWriter })`.
2. **Why it is necessary now** — `discoverSkills` is the second required primitive (ADR D1/D2). Delegating the manager guarantees the public function carries the exact symlink-guard + malformed-skip behavior the golden/contract tests already protect.

#### Evidence
`skills-manager.ts:52-80` is the discovery loop (hardcoded root at line 54, `safePathJoin`+`assertNoSymlinkEscape` at 65-66, `tryParseSkill`→`parseSkillFrontmatter` at 77/95, stderr warning at 107). `readWorkspaceDir` (`../config/workspace-dir.js`) returns `[]` on read error.

#### Files to edit
```
packages/sdk/src/internal/runtime/skills/discover-skills.ts — NEW: pure discoverSkills + Skill type + onInvalidSkill callback
packages/sdk/src/internal/runtime/skills/skills-manager.ts — refresh() delegates to discoverSkills; stderr via onInvalidSkill
packages/sdk/tests/skills-subpath.test.ts — add RED tests for discoverSkills (valid, malformed-skip, missing-dir, symlink-escape)
```

#### Deep file dependency analysis
- `skills-manager.ts` today owns the loop + `tryParseSkill`. After: `refresh()` becomes `this.skills = await discoverSkills(skillsRoot, { onInvalidSkill: (i) => process.stderr.write(...) })`. `tryParseSkill` moves into `discover-skills.ts` (renamed/inlined). `SkillMetadata` is re-exported as `Skill` from `discover-skills.ts` (or kept in manager and imported) — to avoid a circular feel, define `Skill` in `discover-skills.ts` and have `skills-manager.ts` import it.
- Downstream: `tests/contract/skills.contract.test.ts` + `skills-strict.golden.test.ts` must stay green (they exercise the manager → now delegating).

#### Deep Dives
- Invariant: malformed YAML / missing required field → skill excluded + `onInvalidSkill` called with the typed code (`missing_frontmatter`/`schema_invalid`); discovery continues (strict-frontmatter ADR / EC-5).
- Invariant: a subdir whose realpath escapes the root → skipped (symlink guard).
- Edge case: `dir` does not exist or is unreadable → `discoverSkills` returns `[]` (reuse `readWorkspaceDir`), never throws (Drawbacks row).
- Data structure: `Skill = { name: string; description: string; source: string; category?: string; dependencies?: string[] }` (= internal `SkillMetadata`).

#### Pseudo-code / Signatures
```pseudocode
interface Skill { name; description; source; category?; dependencies? }
interface DiscoverSkillsOptions { onInvalidSkill?(info: {name; source; code; message}): void }

async function discoverSkills(dir: string, options?): Promise<Skill[]>
  entries = await readWorkspaceDir(dir, ...)        # [] on read error
  out = []
  for entry in entries where entry.isDirectory():
    try: skillDir = safePathJoin(dir, entry.name); assertNoSymlinkEscape(skillDir, dir)
    catch: continue
    raw = readFile(join(skillDir, "SKILL.md")) catch: continue
    try: fm = parseSkillFrontmatter(raw, entry.name)
         out.push({name: fm.name, description: fm.description, source: skillPath, ...optional})
    catch ConfigurationError e: options?.onInvalidSkill?.({name: entry.name, source, code: e.code, message: e.message})
  return out
```

#### Tasks
1. Write RED tests for `discoverSkills` (valid dir with 2 skills; malformed skill skipped + callback fired; missing dir → []; symlink-escape subdir skipped). Reuse fixture `tests/fixtures/repos/project-with-skills/.theokit/skills`.
2. Create `discover-skills.ts` with `Skill`, `DiscoverSkillsOptions`, `discoverSkills`.
3. Refactor `SkillsManager.refresh()` to delegate; route stderr via `onInvalidSkill`.
4. Run contract + golden skills tests to confirm behavior preserved.

#### TDD
```
RED:     discoverSkills_returns_valid_skills() — 2 skills from the fixture dir
RED:     discoverSkills_skips_malformed_and_calls_onInvalidSkill() — malformed SKILL.md excluded + callback receives code
RED:     discoverSkills_missing_dir_returns_empty() — non-existent dir → []
RED:     discoverSkills_on_file_path_returns_empty() — (EC-1) dir arg is a regular file → [] not throw
RED:     discoverSkills_skips_dir_without_skill_md() — (EC-2) subdir lacking SKILL.md excluded AND onInvalidSkill NOT called
RED:     discoverSkills_skips_symlink_escape() — subdir symlinked outside root excluded
GREEN:   Implement discover-skills.ts + delegate SkillsManager.refresh()
REFACTOR: remove now-dead loop + tryParseSkill from skills-manager.ts
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/skills-subpath.test.ts tests/contract/skills.contract.test.ts tests/golden/runtime/skills-strict.golden.test.ts
```

#### Acceptance Criteria
- [ ] `discoverSkills` tests green; contract + golden skills tests green (behavior preserved).
- [ ] Pass: complexity — `discover-skills.ts` cyclomatic ≤ 10 (extract `tryParseSkill` helper if needed).
- [ ] Pass: lint — `pnpm --filter @theokit/sdk exec biome check packages/sdk/src/internal/runtime/skills` reports 0 warnings on changed files.
- [ ] Pass: size — `discover-skills.ts` ≤ 500 lines.

#### DoD
- [ ] All T1.2 tasks completed and validated
- [ ] `pnpm --filter @theokit/sdk test` green for touched files
- [ ] Zero type errors — `pnpm --filter @theokit/sdk typecheck`
- [ ] Zero lint warnings — Biome clean
- [ ] File-size budget respected

---

## Phase 2: Wire the public `@theokit/sdk/skills` subpath

**Objective:** expose `discoverSkills`/`buildSkillsBlock`/`Skill` via a wired subpath importable in ESM+CJS with types, documented and changelogged.

### T2.1 — Barrel + build wiring + docs/changelog

#### Objective
Create `src/skills.ts`, wire tsup/tsconfig-dts/mirror/exports, and document the new subpath.

#### Why this step (action + reasoning)
1. **What this step does** — adds the `src/skills.ts` re-export barrel and the four wiring edits (tsup entry, tsconfig.tools-dts include, mirror list, package.json exports), plus `docs.md` + CHANGELOG + changeset.
2. **Why it is necessary now** — the primitives from Phase 1 are useless to a consumer until the subpath ships. ADR D5 fixes the wiring to the proven `models` path; doing it as one task keeps the manifest edits atomic and reviewable.

#### Evidence
`models` subpath wiring: `tsup.config.ts:13` (`models: "src/models.ts"`), `tsconfig.tools-dts.json:16` (`"src/models.ts"`), `mirror-dts-to-cts.mjs:35-36`, `package.json:71-79` exports. `docs.md` has no skills-discovery mention (additive).

#### Files to edit
```
packages/sdk/src/skills.ts — NEW: re-export discoverSkills, buildSkillsBlock, Skill, DiscoverSkillsOptions
packages/sdk/tsup.config.ts — add `skills: "src/skills.ts"`
packages/sdk/tsconfig.tools-dts.json — add "src/skills.ts" to include
packages/sdk/scripts/mirror-dts-to-cts.mjs — add join(DIST, "skills.d.ts")
packages/sdk/package.json — add "./skills" to exports (dual import/require + types)
docs.md — document @theokit/sdk/skills
CHANGELOG.md (root) + packages/sdk/CHANGELOG.md — [Unreleased] Added entry
.changeset/m4-skills-discovery.md — NEW: minor bump @theokit/sdk
```

#### Deep file dependency analysis
- `src/skills.ts` imports from `internal/runtime/skills/discover-skills.js` + `internal/runtime/skills/skills-block.js` (created in Phase 1). It is a pure leaf re-export (like `models.ts`).
- The four build files are append-only edits mirroring the `models` rows; no other entry touched.

#### Deep Dives
- Invariant: `package.json` exports must list both `import` (`.js`/`.d.ts`) and `require` (`.cjs`/`.d.cts`) — `attw`/`publint` enforce in Phase 3.
- The mirror script copies `dist/skills.d.ts` → `dist/skills.d.cts` post-build.

#### Pseudo-code / Signatures
```pseudocode
// src/skills.ts
export { type Skill, type DiscoverSkillsOptions, discoverSkills } from "./internal/runtime/skills/discover-skills.js";
export { buildSkillsBlock } from "./internal/runtime/skills/skills-block.js";
```

#### Tasks
1. Create `src/skills.ts` barrel.
2. Add `skills` entry to `tsup.config.ts`.
3. Add `src/skills.ts` to `tsconfig.tools-dts.json` include.
4. Add `skills.d.ts` to `mirror-dts-to-cts.mjs`.
5. Add `./skills` to `package.json` exports.
6. Document in `docs.md` (include the EC-3 note: discovery order follows fs `readdir` order — sort `Skill[]` before `buildSkillsBlock` if a stable block order is required); add CHANGELOG entries (root + package); add changeset (`biome format --write` the changeset before commit).

#### TDD
```
RED:     (wiring test in T2.2) — import from "@theokit/sdk/skills" resolves discoverSkills + buildSkillsBlock
GREEN:   barrel + build wiring (this task)
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk build && node -e "require('@theokit/sdk/skills')" (CJS smoke)
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk build` emits `dist/skills.js`, `dist/skills.cjs`, `dist/skills.d.ts`, `dist/skills.d.cts`.
- [ ] `docs.md` documents the subpath; CHANGELOG `[Unreleased] Added` entry present with `(#M4-1)`.
- [ ] Pass: lint — `pnpm --filter @theokit/sdk exec biome check` reports 0 warnings (changeset `biome format --write` applied).
- [ ] Pass: size — `src/skills.ts` ≤ 500 lines.

#### DoD
- [ ] All T2.1 tasks completed and validated
- [ ] Build green; subpath resolves in ESM + CJS
- [ ] Zero type errors / lint warnings
- [ ] CHANGELOG + changeset present

### T2.2 — Wiring test (built dist)

#### Objective
Prove the public subpath resolves and the primitives behave end-to-end through the published entry point.

#### Why this step (action + reasoning)
1. **What this step does** — adds `tests/skills-wiring.test.ts` that imports `discoverSkills` + `buildSkillsBlock` from `@theokit/sdk/skills` (the barrel) and exercises them against the real fixture skills dir.
2. **Why it is necessary now** — the wiring triad pillar (a)+(b): a static caller of the new public exports + an integration test hitting the real fs boundary. Without it, the exports are orphan (knip would flag) and the subpath could silently break.

#### Evidence
Fixture dir `tests/fixtures/repos/project-with-skills/.theokit/skills` has `code-review/SKILL.md` + `test-architect/SKILL.md` (Baseline). Existing wiring tests (e.g. `models-wiring.test.ts`) import from the subpath barrel.

#### Files to edit
```
packages/sdk/tests/skills-wiring.test.ts — NEW: import from @theokit/sdk/skills barrel; discover fixture skills; build block
```

#### Deep file dependency analysis
- Imports from the `src/skills.ts` barrel (mirrors `models-wiring.test.ts`). Exercises `discoverSkills(fixtureDir)` → asserts 2 skills, then `buildSkillsBlock(skills)` → asserts `<skills>` block contains both names.

#### Deep Dives
- Edge case: the test points `discoverSkills` at the real fixture's `.theokit/skills` dir (arbitrary-dir proof — D2).

#### Tasks
1. Write `tests/skills-wiring.test.ts` importing from the barrel; assert discovery + block round-trip on the fixture.

#### TDD
```
RED:     skills_subpath_discovers_fixture_and_builds_block() — 2 skills + block contains both names (fails before barrel exists)
GREEN:   barrel already created in T2.1 → test passes
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/skills-wiring.test.ts
```

#### Acceptance Criteria
- [ ] Wiring test green — `pnpm --filter @theokit/sdk exec vitest run tests/skills-wiring.test.ts` reports all tests passed via the barrel import.
- [ ] `pnpm --filter @theokit/sdk exec knip` reports no orphan export for `discoverSkills`/`buildSkillsBlock`.
- [ ] Pass: lint — `pnpm --filter @theokit/sdk exec biome check packages/sdk/tests/skills-wiring.test.ts` reports 0 warnings.

#### DoD
- [ ] Wiring test green; barrel exports have a real caller
- [ ] Zero type errors / lint warnings

---

## Dependencies

M4-1 introduces ZERO new dependencies — `node:fs`/`node:path` + the already-public `@theokit/sdk/path-safety` primitives + the existing `@internal` skills parser (Rule 9 / KISS).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `node:fs/promises`, `node:path` | builtin | node | `readFile`/`join` for discovery (already used by `skills-manager.ts`) |
| `safePathJoin`/`assertNoSymlinkEscape` (`@theokit/sdk/path-safety`) | workspace | npm/TS | symlink-escape guard, already public (M0-4) |
| `parseSkillFrontmatter` / `parseSimpleYaml` (in-repo `@internal`) | workspace | npm/TS | strict frontmatter parse (strict-frontmatter ADR), same package |

### New — to be introduced

(none)

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `discoverSkills(dir)` discovers SKILL.md in arbitrary dir | T1.2 | Pure function over arbitrary root (D2) |
| 2 | Real YAML frontmatter parse | T1.2 | Delegates to `parseSkillFrontmatter` (strict-frontmatter ADR) |
| 3 | Symlink-escape guard | T1.2 | Reuses `safePathJoin`/`assertNoSymlinkEscape` (M0-4) |
| 4 | `buildSkillsBlock(skills)` renders injection-safe block | T1.1 | Pure function over `escapeBlockBody` (injection-escape ADR) |
| 5 | Single source of truth (no duplicate of internal logic) | T1.1, T1.2 | Internal callers delegate (D1) |
| 6 | Public `@theokit/sdk/skills` subpath (ESM+CJS+types) | T2.1 | Wired like `models` (D5) |
| 7 | No orphan exports / real caller | T2.2 | Wiring test through barrel |
| 8 | Docs + CHANGELOG + changeset | T2.1 | Additive entries |

**Coverage: 8/8 requirements covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/sdk test` green
- [ ] Zero type errors — `pnpm --filter @theokit/sdk typecheck`
- [ ] Zero lint warnings — `pnpm --filter @theokit/sdk exec biome check` clean; `knip` clean
- [ ] File-size budget respected (per `rules/architecture.md`)
- [ ] CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6) — root + `packages/sdk`
- [ ] Backward compatibility preserved — `SkillsManager`/`SkillsPromptProvider` golden + contract tests green
- [ ] Plan-specific: `@theokit/sdk/skills` resolves in ESM + CJS with types; `attw` 🌟 + `publint` clean for the new subpath
- [ ] `docs.md` documents the subpath (source of truth for public API)
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merge

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Validate the new subpath works in the built artifact, not just in source.

### Execution
```
pnpm --filter @theokit/sdk build
pnpm --filter @theokit/sdk test          # unit + golden + contract + wiring
pnpm --filter @theokit/sdk typecheck
pnpm --filter @theokit/sdk exec biome check packages/sdk/src packages/sdk/tests
pnpm --filter @theokit/sdk exec knip
pnpm --filter @theokit/sdk validate      # includes publint + attw on the new subpath
```

### Acceptance Criteria
- [ ] All test suites green — `pnpm --filter @theokit/sdk test` exits 0 (unit + golden + contract + wiring)
- [ ] Coverage ≥ 90% on changed files (`discover-skills.ts`, `skills-block.ts`, `skills.ts` — critical paths 100%)
- [ ] Zero type/lint errors — `pnpm --filter @theokit/sdk typecheck` + `biome check` + `knip` each exit 0
- [ ] `attw` 🌟 + `publint` clean for `@theokit/sdk/skills` — `pnpm --filter @theokit/sdk validate` exits 0
- [ ] No regression — `pnpm --filter @theokit/sdk test` reports the full sdk suite passing (≥ baseline 2781 passed)

### If Validation Fails
1. Separate plan-caused failures from pre-existing.
2. Fix all plan-caused failures before declaring complete.
3. Re-run the chain.
4. Log pre-existing issues in the PR description; they do not block.
