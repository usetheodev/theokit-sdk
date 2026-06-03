# Plan: Personality Presets — `/personality` slash + session-scoped preset switcher

> **Version 1.2** (2026-05-20, COMPLETED) — all 8 phases shipped, 10 ADRs registered (D160-D169), 60 SDK tests + 9 integration tests GREEN, real-LLM dogfood PASS (`coder` → code-like, `haiku` → 5/7/5 verse, EC-J persistent-clear → empty agents map). Telegram-pro `/personality <name>` command live with 2 sample presets (`coder.md`, `poet.md`). DTS bundling moved `PersonalityPreset` to `types/agent.ts` to avoid rollup-dts crossing `internal/` paths.
>
> **Version 1.1** (2026-05-20) — incorporates edge-case review: 3 MUST FIX (EC-A snapshot-not-reference fork inheritance wording, EC-B persistent-clear semantic = delete key, EC-C lowercase-only slug normalization) + 7 SHOULD TEST woven into TDD blocks + 6 DOCUMENT items added inline.
>
> **Version 1.0** (2026-05-20) — adds a `personality` preset system on top of the existing `SystemPromptResolver` hook (zero SDK core changes). Presets are user-authored markdown files (`.theokit/personalities/*.md`) with YAML frontmatter (`name`, `description`, `tools?`, `model?`, `tags?`) and body = system prompt overlay. New public API `Agent.usePersonality(name, { save?, reset? })`. Session-scoped by default; opt-in persistence to `$THEOKIT_HOME/personality.json`. Switch preserves history, re-injects the system prompt next turn, invalidates prompt cache (D94), and emits a `[persona switched to <name>]` transcript marker so the model has explicit context. Closes SDK Roadmap row #5 (Hermes #26, score 5). Telegram-pro gains `/personality <name>` command for live demo.

## Context

### What exists today

- **`SystemPromptResolver`** in `packages/sdk/src/types/agent.ts:179` is `(ctx: SystemPromptContext) => string | Promise<string>`. Invoked **per turn** (no cache) — preset switches take effect on the NEXT `agent.send()` immediately.
- **Per-call override** via `SendOptions.systemPrompt` (line 123) wins over resolver, including empty string.
- **`SystemPromptPipeline`** in `internal/runtime/system-prompt/pipeline.ts:24-72` composes 5 providers (ActiveMemory, Context, Skills, Memory, Base). `BasePromptProvider` (priority 100) wraps whatever the resolver returns.
- **`Agent.invalidateCache(reason, options?)`** (ADR D94) is ready for prompt-cache invalidation on switch.
- **Markdown + YAML frontmatter loader** `loadMarkdownEntities` (D10/D76) used by skills/context/plugins — direct reuse for personalities.
- **`casUpdate` SQLite helper** (D83) + redact (D68/D70) ready for safe persistent state.
- **No personality switching today.** `examples/telegram-pro/src/system-prompt.ts` has 54 LoC of hardcoded "Theo Pro" prompt. Zero `/persona`, `/mode`, `/personality` commands.

### What's broken or missing

1. **No way to swap "voice" mid-session.** Demos and chat-assistant apps need it (Hermes ships 13 presets for a reason — users *want* persona toggles in live chat).
2. **System prompt is "set at create time"** — to swap personality today, the user must `agent.dispose()` + `Agent.create()`, which throws away history, restarts MCP, re-initializes memory glue, etc. Heavy.
3. **No standard preset file format.** Third-party adopters reinvent (one passes raw strings, another loads JSON, another hardcodes literals). Fragmented.
4. **Tool/model scoping per persona is unsolved.** When a user wants "coder" persona that's restricted to file-system + shell tools, today there's no clean wiring.

### Evidence motivating NOW (not later)

- **SDK Roadmap row #5 (score 5)** in `CLAUDE.md`. Listed as "Light shim sobre primitivo existente" — research confirmed primitive is `SystemPromptResolver` and shim is small.
- **Deep research (2026-05-20):**
  - Hermes ships `personalities` config + `/personality` slash + tab completion + persistent toggle (`cli.py:6868-6968`, `cli-config.yaml.example:590-606`). Validates the slash-and-registry shape.
  - Aider's `code`/`ask`/`architect` modes (`/aider`/`/chat-mode`) prove "switchable behavior layer" is a primitive users reach for.
  - Claude Code's `.claude/commands/*.md` + subagents show file-based persona files = standard pattern.
  - **Persona drift research** (arXiv:2412.00804): >30% self-consistency degradation after 8-12 turns even WITH intact context. Mitigation: re-injection at turn boundaries (cheap, no model retraining).
  - **Echoing research** (arXiv:2511.09710): 70% role abandonment in multi-agent.
- **Cursor's auto-switching bugs** (forum #148247): cautionary tale — auto-switching personas causes unauthorized actions. Our default MUST be explicit user opt-in.

## Objective

**Done = a developer writes `await Agent.create({...})`, drops `.theokit/personalities/coder.md` + `.theokit/personalities/poet.md` in their workspace, calls `agent.usePersonality("coder")`, and the next `agent.send()` reflects the coder voice + optionally a restricted tool whitelist. `agent.usePersonality("none")` clears. `agent.usePersonality("coder", { save: true })` persists across process restarts.**

Measurable goals:

1. **Zero SDK core changes** — implementation entirely in a new `internal/personality/` module + small `Agent` façade additions.
2. **`PersonalityRegistry`** loads `.theokit/personalities/*.md` (project) + `~/.theokit/personalities/*.md` (user), project wins on collision.
3. **`Agent.usePersonality(name, opts?)`** — `name` is the preset slug or `"none"`. `opts.save?: boolean` for persistence, `opts.reset?: boolean` for history reset (default false).
4. **Switch lifecycle:** preserve history → re-inject system prompt next turn → emit `[persona switched]` transcript marker → `invalidateCache("personality-switch")`.
5. **Tool whitelist enforcement:** missing tools warn + drop from whitelist (not crash). Reuses D102 3-layer registry as layer 4 (additive narrowing — never bypasses `pre_tool_call` veto from D101).
6. **Model field in preset is advisory:** warn + use agent's current model on conflict; never auto-switch silently (D108).
7. **Persistent storage:** `$THEOKIT_HOME/personality.json` via `casUpdate` (D83) + secret redaction (D68/D70).
8. **Cloud agent rejection:** `UnsupportedRunOperationError` (D122 parity) — cloud runtime is pre-release.
9. **Slash command `/personality <name>` in telegram-pro** demonstrating the feature end-to-end (real LLM).
10. **10 new ADRs (D160-D169)**, CHANGELOG entry, CLAUDE.md Roadmap row #5 → ✅ DONE.
11. **Zero regression**: 1137 baseline SDK tests stay green.

## ADRs

| ID | Decision | Rationale | Consequences |
|---|---|---|---|
| **D160** | `SystemPromptResolver` (D-existing, `types/agent.ts:179`) is the SINGLE hook point for personality presets. No new pipeline provider, no new resolver category, no SDK core changes. | Research confirmed the resolver is invoked per-turn and already receives the necessary context. Adding a new pipeline provider would duplicate plumbing. The "light shim sobre primitivo existente" framing from the roadmap is correct. | **Enables:** ship without touching `system-prompt/pipeline.ts` or `local-agent.ts` resolver wiring. **Constrains:** preset content is a STRING (resolver return type) — rich shapes (tools/model) get layered separately via new public API, not through the resolver itself. |
| **D161** | Preset file format = markdown with YAML frontmatter. Schema (Zod): `name: lowercase slug (^[a-z0-9_-]+$)`, `description?: string`, `tools?: string[]`, `model?: string`, `tags?: string[]`. Body = system prompt overlay (string). **EC-M:** body is NOT sanitized against prompt-injection patterns — users own their preset content. **EC-C:** name is lowercase-only to prevent registry-key ambiguity (Map verbatim). | Reuses existing markdown loader pattern (D10/D76 — context, skills, plugins all do this). Zero new file-format surface. Frontmatter validated; body is plain markdown for portability. **Tools/model are OPTIONAL** — string-only presets are the 80% case. Lowercase-only slugs prevent `Coder` vs `coder` confusion. | **Enables:** users copy-paste presets across projects; same shape as skills (D10) and context (D76). **Constrains:** rich behaviors (e.g. per-preset memory namespace) NOT supported in v1; add later only if signal exists. |
| **D162** | Storage: `.theokit/personalities/*.md` (project) + `~/.theokit/personalities/*.md` (user). **Project wins on slug collision.** One file = one personality (D75 parity). | Matches the existing `.theokit/` family (skills, context, plugins, mcp). Project-wins-on-collision is the established `.theokit/` convention; matches `agent skills` and `plugins`. | **Enables:** discoverability — users with multiple SDK-based projects share base presets via `~/.theokit/` and override per-project. **Constrains:** zero env-var overrides for personality dir in v1 (defer). |
| **D163** | Default scope: **session-only**. Persistence is opt-in via `agent.usePersonality(name, { save: true })`. Persistent store: `$THEOKIT_HOME/personality.json` keyed by `agentId`. | Hermes does both. Default session prevents footgun — a `/personality kawaii` in dev shouldn't bleed into prod. Persistence is for users who explicitly want a per-agent default that survives process restart. | **Enables:** safe ergonomics by default; persistent stickiness when user opts in. **Constrains:** persistent state is one JSON file; if the user wants per-user-id personality state, they implement it themselves. |
| **D164** | Switch lifecycle: **preserve history** + re-inject system prompt next turn + emit `[persona switched to <name>]` user-role transcript marker + call `Agent.invalidateCache("personality-switch")` (D94). `opts.reset: true` is opt-in for hard reset (clears session messages). | Persona drift research (arXiv:2412.00804) shows re-injection at turn boundaries is the cheapest mitigation. Hermes's hard reset (`self.agent = None`) destroys user WIP — footgun. Transcript marker gives the model explicit context about the switch (mitigates "this assistant suddenly contradicts the previous one" UX). | **Enables:** safe default semantics; users keep their conversation; cache invalidates exactly once. **Constrains:** mid-switch refusals (the "new persona declines tasks the old one accepted") still possible — `opts.reset: true` is the escape hatch. |
| **D165** | Slash command name = **`/personality`**. NOT `/persona`, NOT `/mode`, NOT `/style`. The slash command itself is implemented in `examples/telegram-pro` (consumer); the SDK only exposes `Agent.usePersonality(name, opts)`. | Hermes precedent + clear semantics. `/mode` is saturated (Cline plan/act, Aider code/ask/architect, Cursor plan/agent) and reserves us a separate axis for future task-mode features. `/persona` shorter but less ecosystem precedent. `/style` too narrow (implies tone-only). | **Enables:** consumers wire slash command however they want; SDK stays infra-shaped. **Constrains:** the SDK does NOT ship a slash dispatcher — that's userland. |
| **D166** | No built-in personality presets shipped in `@theokit/sdk`. Documentation includes **one example preset file** (in docs/, not auto-loaded). Telegram-pro ships **two sample presets** (`coder.md`, `poet.md`) as live demo. | Hermes shipped 13 kaomoji presets — zero npm adoption. Personality content is user-domain. We're infrastructure, not consumer product. Defaults bleed brand into every consumer. | **Enables:** SDK ships clean; no opinionated default tone. **Constrains:** users must author their own presets — but ONE example doc suffices (copy-paste cost is near zero). |
| **D167** | Preset `tools` field is **advisory whitelist**, NOT enforced bypass. Missing tools → log warning + drop from whitelist. `model` field same: warn + use agent's current model on mismatch, never silent auto-switch. | Reuses D102 (3-layer tool registry: registration / exposure / availability). Personality whitelist is **layer 4 — additive narrowing**, never overrides `pre_tool_call` veto (D101). Auto-switching models silently violates D108 (preserve v1.2 caller API + budget surprise). | **Enables:** safe per-persona tool scoping; predictable behavior. **Constrains:** users wanting "force this model when persona X" must pass `model` explicitly to `Agent.create()` — documented. |
| **D168** | Personality inheritance in **forks** (D110): forks inherit parent's active personality via a **SNAPSHOT of the slug string at fork-construction time**, propagated through `AsyncLocalStorage` (same mechanism as credential pool D131). EC-A clarification: snapshot ≠ live reference — if parent calls `usePersonality("Y")` while the fork is running, the fork keeps the slug that was active at the moment fork started ("X"). `agent.usePersonality(...)` inside a fork = warning + no-op. | Forks are short-lived sub-agents; mid-fork personality switching by the parent should NOT mutate the fork's voice (consistency invariant). Snapshot semantics also avoid subtle async-race bugs where the parent and fork both touch the store. | **Enables:** subagents talk in the same voice as their parent throughout the fork's lifetime, even when the parent switches mid-flight. **Constrains:** forks cannot specialize voice — documented as v2 followup if signal emerges. |
| **D169** | Cloud agents reject `usePersonality(...)` with `UnsupportedRunOperationError` (D122 pattern). Cloud runtime is pre-release; persona routing must wait for Theo PaaS to ship it natively. | Matches D122 (`runUntil`/`fork` unsupported on cloud). Avoids surface that we cannot honor end-to-end. | **Enables:** clean error semantics for cloud users; no silent ignore. **Constrains:** cloud users wait — explicitly documented in JSDoc + ADR. |

## Edge Case Integration (v1.1)

Edge-case review (2026-05-20) surfaced 16 items in addition to the 22 EC-N items already inline in the plan. Integration summary:

| EC | Severity | Where | Type of fix |
|---|---|---|---|
| EC-A | MUST FIX | T6.2 / D168 | Plan: clarify snapshot-of-slug-string (not live reference) for fork ALS inheritance |
| EC-B | MUST FIX | T2.1 | Code: `setActive(undefined, save:true)` DELETES JSON key, never writes null |
| EC-C | MUST FIX | T1.1 / D161 | Code: regex `^[a-z0-9_-]+$` (NO `/i`) — lowercase-only slugs |
| EC-D | SHOULD TEST | T5.1 | Test: transcript marker survives D91 compression + session compact |
| EC-E | SHOULD TEST | T5.1 | Test: concurrent `usePersonality` + in-flight `send` serialized via per-agent mutex |
| EC-F | SHOULD TEST | T3.1 | Test: empty `ctx.agentId` → resolver returns base unchanged, no crash |
| EC-G | SHOULD TEST | T8.1 | Code+Test: command trims trailing whitespace |
| EC-H | SHOULD TEST | T8.1 | Code+Test: command takes first token, ignores extras |
| EC-I | SHOULD TEST | T4.1 | Test: whitelist matches MCP-style names (`mcp__server__tool`) by exact string |
| EC-J | SHOULD TEST | T3.2 | Test: `clear` after `save:true` removes persistent JSON entry (delegates to EC-B) |
| EC-K | DOCUMENT | T2.1 / D163 | Note: orphan personality entries after `Agent.delete` are tolerated |
| EC-L | DOCUMENT | T3.1 / D161 | Note: empty separator merges without space — caller responsibility |
| EC-M | DOCUMENT | T1.1 / D161 | Note: markdown body is NOT sanitized against prompt injection; user-owned content |
| EC-N | DOCUMENT | T2.1 / D163 | Note: brief memory/disk divergence on persist failure is tolerated |
| EC-O | DOCUMENT | T3.2 | Note: first `usePersonality` triggers cold registry load (~10ms I/O) |
| EC-P | DOCUMENT | T8.1 | Note: Telegram 4096-char limit applies to `/personality` list if user ships 100+ presets |

## Dependency Graph

```
Phase 0 (audit)
        │
        ▼
Phase 1 (PersonalityRegistry — load markdown files)
        │
        ▼
Phase 2 (PersonalityStore — session state + persistent JSON)
        │
        ▼
Phase 3 (createPersonalityResolver + Agent.usePersonality public API)
        │
        ├──▶ Phase 4 (Tool whitelist enforcement via D102 layer 4)
        │
        ├──▶ Phase 5 (Switch semantics — history preservation + cache invalidation + transcript marker)
        │
        └──▶ Phase 6 (Cloud agent rejection + Fork ALS inheritance)
                │
                ▼
        Phase 7 (10 ADRs + CHANGELOG + roadmap)
                │
                ▼
        Phase 8 (Telegram-pro /personality command + dogfood)
```

- Phases 4 + 5 + 6 are **parallelizable** after Phase 3.
- Phase 7 blocks on 4+5+6.
- Phase 8 sequential after 7.

---

## Phase 0: Foundation — Audit confirmation

### T0.1 — Confirm SystemPromptResolver is the hook point + no SDK core changes needed

#### Objective
Document that the audit findings hold: `SystemPromptResolver` invoked per-turn, no cache, `invalidateCache` available, no prior personality code. Lock ADRs D160-D169.

#### Evidence
- Deep research (2026-05-20): `SystemPromptResolver` at `types/agent.ts:179` is per-turn (uncached) per `system-prompt.ts:24-67`.
- Zero prior art for "personality"/"persona" in SDK + examples + telegram-pro.

#### Files to edit
```
.claude/knowledge-base/plans/personality-presets-plan.md — confirm via grep
```

#### Deep file dependency analysis
- Pure audit phase.

#### Tasks
1. `grep -n "SystemPromptResolver" packages/sdk/src/types/agent.ts` → confirm primitive shape.
2. `grep -rn "personality\|persona" packages/sdk/src/ examples/` → confirm zero prior art.
3. `grep -n "invalidateCache" packages/sdk/src/types/agent.ts` → confirm D94 hook present.

#### TDD
None — pure audit phase.

#### Acceptance Criteria
- [ ] All grep checks return expected results.
- [ ] ADRs D160-D169 drafted in this plan.

#### DoD
- [ ] Audit notes committed in phase commit message.

---

## Phase 1: PersonalityRegistry — markdown file loader

### T1.1 — Define preset Zod schema + `PersonalityRegistry` class

#### Objective
Create the personality preset registry. Loads `.theokit/personalities/*.md` (project) + `~/.theokit/personalities/*.md` (user) via the existing `loadMarkdownEntities` helper (D10/D76). Validates frontmatter with Zod. Project-wins-on-collision.

#### Evidence
- `loadMarkdownEntities` already used by skills/context/plugins (`internal/persistence/markdown-config-loader.ts`).
- D161 + D162 (preset shape + storage location).
- Hermes pattern: `cli-config.yaml.example:590-606` (string OR dict; we adopt the dict form via frontmatter).

#### Files to edit
```
packages/sdk/src/internal/personality/types.ts (NEW) — PersonalityPreset, PersonalitySource, PersonalityFrontmatterSchema
packages/sdk/src/internal/personality/registry.ts (NEW) — PersonalityRegistry class
packages/sdk/tests/internal/personality/registry.test.ts (NEW) — 10 unit tests
```

#### Deep file dependency analysis
- `types.ts` (NEW) is a leaf — only `zod` dep.
- `registry.ts` (NEW) imports `loadMarkdownEntities` (existing path) + `os.homedir()` + path helpers.
- Tests use `mkdtemp` for fixtures.

#### Deep Dives

**Zod schema (frontmatter):**

> **EC-C fix:** name regex is **lowercase-only** (NO `/i` flag). Without this, `Coder` and `coder` would both pass validation but become DIFFERENT registry keys (Map verbatim) — `get("coder")` returns one, `get("Coder")` returns another. UX footgun. Forcing lowercase eliminates the ambiguity.

```typescript
import { z } from "zod";

export const PersonalityFrontmatterSchema = z.object({
  // EC-C: lowercase-only — prevents Coder vs coder ambiguity in registry Map keys.
  name: z.string().min(1).regex(/^[a-z0-9_-]+$/, "Personality name must be a lowercase slug (a-z, 0-9, _, -)"),
  description: z.string().optional(),
  tools: z.array(z.string()).optional(),
  model: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type PersonalityFrontmatter = z.infer<typeof PersonalityFrontmatterSchema>;
```

**Public preset shape:**

```typescript
export interface PersonalityPreset {
  readonly name: string;
  readonly description: string | undefined;
  readonly tools: ReadonlyArray<string> | undefined;
  readonly model: string | undefined;
  readonly tags: ReadonlyArray<string> | undefined;
  /** The system prompt overlay body (markdown stripped of frontmatter). */
  readonly systemPrompt: string;
  /** Source dir — "project" or "user" — used for collision telemetry. */
  readonly source: "project" | "user";
  /** Absolute path the file was loaded from. */
  readonly sourcePath: string;
}
```

**Registry API:**

```typescript
export class PersonalityRegistry {
  /** Load both dirs. Project entries override user entries on slug collision. */
  static async load(cwd: string): Promise<PersonalityRegistry>;

  /** All loaded presets, lex-asc by name. */
  all(): ReadonlyArray<PersonalityPreset>;

  /** Get by slug. Returns undefined for `"none"` (reserved). */
  get(name: string): PersonalityPreset | undefined;

  /** Reserved slugs: "none", "default", "neutral" — all map to "clear active preset". */
  static isReservedClearSlug(name: string): boolean;
}
```

**Invariants:**
- Empty body → reject with `ConfigurationError(code: "personality_empty_body")` (matches edge-case review item 7 below).
- Whitespace-only body → reject.
- Slug from filename if frontmatter.name absent? **No.** Frontmatter `name` is required (Zod min(1)).
- Reserved slugs (`none`, `default`, `neutral`) cannot be used as personality names — registry rejects them with `ConfigurationError(code: "personality_reserved_name")`.

**Edge cases:**
- **EC-1:** Project + user have same slug → project wins; emit `[theokit-sdk] personality "<name>" overridden by project preset` warning once per slug.
- **EC-2:** Malformed frontmatter → `loadMarkdownEntities` throws `ConfigurationError` (existing behavior); registry surfaces it with `errorCodePrefix: "personality"`.
- **EC-3:** Empty `.theokit/personalities/` dir → `all()` returns empty array; `get(x)` returns undefined.
- **EC-4:** Filename mismatch with `name` frontmatter → registry trusts frontmatter `name` (not filename slug). Document.
- **EC-5:** Body has `---\n---\n` (empty frontmatter) → Zod fails on missing `name` → ConfigurationError.

#### Tasks
1. Create `types.ts` with Zod schema + interfaces.
2. Create `registry.ts` with `load()` + `all()` + `get()` + `isReservedClearSlug()`.
3. Write 10 unit tests with `mkdtemp` fixtures.

#### TDD
```
RED:     test_registry_loads_project_personalities()
RED:     test_registry_loads_user_personalities()
RED:     test_project_wins_on_slug_collision() — EC-1
RED:     test_warning_emitted_once_per_collision()
RED:     test_malformed_frontmatter_throws_configuration_error() — EC-2
RED:     test_empty_directory_returns_empty_array() — EC-3
RED:     test_get_returns_undefined_for_unknown_name()
RED:     test_reserved_names_rejected_at_registry_load() — none/default/neutral can't be defined
RED:     test_isReservedClearSlug_recognizes_none_default_neutral()
RED:     test_empty_body_rejected_with_personality_empty_body_code()
RED:     test_uppercase_name_rejected_by_zod_regex() — EC-C: `Coder` fails validation; only lowercase passes
GREEN:   Implement registry + types.
REFACTOR: None expected.
VERIFY:  pnpm vitest run tests/internal/personality/registry.test.ts
```

#### Acceptance Criteria
- [ ] 11 RED tests GREEN (was 10 — +1 from EC-C lowercase enforcement)
- [ ] File ≤300 LoC
- [ ] Zero biome warnings
- [ ] Cognitive complexity ≤10 per function
- [ ] Knip clean
- [ ] **EC-C:** lowercase-only regex applied (no `/i` flag)

#### DoD
- [ ] CHANGELOG entry under `[Unreleased]`
- [ ] Existing 1137 SDK tests pass

---

## Phase 2: PersonalityStore — session state + persistent JSON

### T2.1 — In-memory session state per agentId

#### Objective
Build `PersonalityStore` to track the currently-active personality slug per `agentId` in memory. Default state: no active personality.

#### Evidence
- D163 (session default, persistent opt-in).
- Existing `agent-registry.ts` pattern for per-agentId in-memory state.

#### Files to edit
```
packages/sdk/src/internal/personality/store.ts (NEW) — PersonalityStore class (session + persistent)
packages/sdk/tests/internal/personality/store.test.ts (NEW) — 8 unit tests
```

#### Deep file dependency analysis
- `store.ts` (NEW) — depends on `casUpdate` (D83), redact (D68), `getTheokitHome` (D60). All existing helpers.

#### Deep Dives

**Store API:**

```typescript
export class PersonalityStore {
  /** Get active personality slug for an agent. Undefined = no active preset. */
  active(agentId: string): string | undefined;

  /**
   * Set active personality. Returns previous value for cache-invalidation
   * decision in the caller. When `save: true`, also persists to disk.
   */
  setActive(agentId: string, slug: string | undefined, opts?: { save?: boolean }): Promise<string | undefined>;

  /** Hydrate from persistent disk file. Called once at agent boot. */
  hydrate(agentId: string): Promise<void>;

  /** Test-only reset. @internal */
  _reset(): void;
}
```

**Persistent JSON shape (`$THEOKIT_HOME/personality.json`):**

```json
{
  "version": 1,
  "agents": {
    "agent-xyz": "coder",
    "agent-abc": "poet"
  }
}
```

**Invariants:**
- Setting `slug = undefined` clears the personality (equivalent to "none").
- `setActive` with `save: true` calls `casUpdate` (D83) to update JSON file atomically.
- **EC-B:** `setActive(agentId, undefined, { save: true })` **DELETES** the key from the `agents` map. NEVER writes `null`. Hydration only reads present keys:
  ```typescript
  // Inside casUpdate transform:
  if (slug === undefined) { delete out.agents[agentId]; }
  else { out.agents[agentId] = slug; }
  ```
  This keeps the JSON clean (no `"agent-xyz": null` entries) and makes "key absent === no active personality" the single canonical representation.
- Persistent file failure (disk full, permission denied) → log warn + keep session state; never throw to caller (matches credential-pool EC-A pattern). **EC-N (documented):** brief memory/disk divergence is acceptable; next successful call recovers.
- `redactSecrets` (D68) applied to the slug before stderr/log emission — slug shouldn't contain secrets but defense-in-depth.

**Edge cases:**
- **EC-6:** Two agents with same agentId in different processes write concurrently → `casUpdate` retries on version mismatch (D83 covers this).
- **EC-7:** JSON file has unknown version → log warn + treat as empty + don't overwrite.
- **EC-8:** Slug not in registry but found in JSON → log warn + clear active to undefined.

#### Tasks
1. Implement `store.ts` with in-memory Map + lazy load + casUpdate persistence.
2. Tests using `tmpdir` for THEOKIT_HOME override.

#### TDD
```
RED:     test_active_returns_undefined_initially()
RED:     test_setActive_session_only_does_not_touch_disk()
RED:     test_setActive_with_save_persists_to_disk()
RED:     test_hydrate_reads_persistent_file()
RED:     test_setActive_undefined_clears_active()
RED:     test_persistent_write_failure_does_not_throw() — EC log+continue
RED:     test_unknown_json_version_treated_as_empty() — EC-7
RED:     test_concurrent_casUpdate_retries() — EC-6
RED:     test_clear_with_save_deletes_key_not_writes_null() — EC-B: JSON file has NO entry after clear, never `"id": null`
GREEN:   Implement store.
REFACTOR: None expected.
VERIFY:  pnpm vitest run tests/internal/personality/store.test.ts
```

#### Acceptance Criteria
- [ ] 9 RED tests GREEN (was 8 — +1 from EC-B delete-key invariant)
- [ ] File ≤200 LoC
- [ ] Knip clean
- [ ] Persistent write uses `casUpdate` (D83)
- [ ] **EC-B:** clear path deletes JSON key, NEVER writes `null`

#### DoD
- [ ] CHANGELOG entry
- [ ] All tests green

---

## Phase 3: Public API — `createPersonalityResolver` + `Agent.usePersonality`

### T3.1 — `createPersonalityResolver(registry, store)` helper

#### Objective
The bridge between registry/store and `SystemPromptResolver`. Returns a function that consults the store for the current agent's active preset and overlays its `systemPrompt` over the user-provided base prompt.

#### Evidence
- D160 (SystemPromptResolver is THE hook point).
- Resolver receives `SystemPromptContext` (`types/agent.ts:159-167`) — has `agentId`, allowing per-agent lookup.

#### Files to edit
```
packages/sdk/src/internal/personality/resolver.ts (NEW) — createPersonalityResolver + composePrompt
packages/sdk/tests/internal/personality/resolver.test.ts (NEW) — 8 unit tests
```

#### Deep file dependency analysis
- `resolver.ts` (NEW) — pure function depends only on registry + store + a base prompt (which can be string or another resolver function).

#### Deep Dives

**Signature:**

```typescript
export interface PersonalityResolverOptions {
  /** Optional base prompt. If absent, only the personality body is used. */
  baseSystemPrompt?: string | SystemPromptResolver;
  /** Optional separator between base and personality body. Default: "\n\n". */
  separator?: string;
}

export function createPersonalityResolver(
  registry: PersonalityRegistry,
  store: PersonalityStore,
  opts?: PersonalityResolverOptions,
): SystemPromptResolver;
```

**Composition:**

```
[base prompt (if any)] + [separator] + [personality body (if active)]
```

If no active personality → returns base prompt unchanged (or undefined).
If active personality + no base → returns personality body alone.

**Invariants:**
- Resolver is **pure** — does NOT mutate registry/store/cache.
- If `baseSystemPrompt` is a resolver function, it's awaited and composed.
- If active slug is in store but missing from registry → log warn + drop (treat as no active).

**Edge cases:**
- **EC-9:** `baseSystemPrompt` resolver throws → propagate (caller decides).
- **EC-10:** Personality body has trailing whitespace → preserved (markdown conformance).
- **EC-11:** Base is empty string `""` → personality body alone, no leading separator.
- **EC-F:** `ctx.agentId` undefined/empty → resolver returns base unchanged (store lookup returns undefined; no overlay; no crash).
- **EC-L (documented):** `separator: ""` merges base and body without space — caller responsibility; we do not normalize. JSDoc `PersonalityResolverOptions.separator` notes this.

#### Tasks
1. Implement `createPersonalityResolver`.
2. Tests covering empty base / async base / active-undefined / slug-missing-in-registry.

#### TDD
```
RED:     test_no_active_returns_base_unchanged()
RED:     test_active_overlays_personality_body()
RED:     test_separator_default_double_newline()
RED:     test_custom_separator_applied()
RED:     test_base_as_async_resolver_awaited()
RED:     test_slug_in_store_but_missing_from_registry_warns_and_drops() — EC log path
RED:     test_no_base_returns_personality_body_alone()
RED:     test_empty_base_omits_leading_separator() — EC-11
RED:     test_empty_agentId_returns_base_unchanged() — EC-F: empty ctx.agentId → store lookup undefined → no overlay, no crash
GREEN:   Implement resolver.
REFACTOR: None.
VERIFY:  pnpm vitest run tests/internal/personality/resolver.test.ts
```

#### Acceptance Criteria
- [ ] 9 RED tests GREEN (was 8 — +1 from EC-F empty agentId)
- [ ] File ≤150 LoC
- [ ] Pure (no state mutation)

#### DoD
- [ ] CHANGELOG entry
- [ ] All tests green

---

### T3.2 — `Agent.usePersonality(name, opts?)` public method + bootstrap wiring

#### Objective
Expose the public API on the `Agent` static + per-instance. Wires the registry/store/resolver into `LocalAgent` so callers get a one-call switch.

#### Evidence
- D160-D164 (semantic decisions).
- `Agent.invalidateCache` already exists (D94) — used by switch.

#### Files to edit
```
packages/sdk/src/types/agent.ts — add SDKAgent.usePersonality? method + PersonalityPreset / usePersonality opts types re-export
packages/sdk/src/internal/runtime/local-agent.ts — wire PersonalityRegistry + PersonalityStore at constructor; expose usePersonality()
packages/sdk/src/index.ts — re-export PersonalityPreset + PersonalityRegistry (read-only API for consumers)
packages/sdk/tests/agent-personality-direct-api.test.ts (NEW) — 8 integration tests
```

#### Deep file dependency analysis
- `SDKAgent` interface — additive new optional method `usePersonality?`.
- `LocalAgent` ctor — adds `#personalityRegistry` + `#personalityStore` fields; lazy-load registry on first `usePersonality` call.
- `index.ts` — re-export `PersonalityRegistry` (read-only `all()` + `get()`) + `PersonalityPreset` type. NOT `PersonalityStore` (internal).

#### Deep Dives

**Public API on `SDKAgent`:**

```typescript
export interface SDKAgent {
  // ... existing fields
  /**
   * Activate a personality preset. `name === "none" | "default" | "neutral"` clears.
   * Returns the resolved preset (or null if cleared).
   *
   * `opts.save: true` persists across process restarts.
   * `opts.reset: true` clears session history (history-preserving by default per D164).
   *
   * Cloud agents throw `UnsupportedRunOperationError`.
   *
   * @public
   */
  usePersonality?(
    name: string,
    opts?: { save?: boolean; reset?: boolean },
  ): Promise<PersonalityPreset | null>;
}
```

**LocalAgent integration:**

The constructor now passes a `createPersonalityResolver(registry, store, { baseSystemPrompt: options.systemPrompt })` as the EFFECTIVE resolver wired into the agent loop. The user's `options.systemPrompt` becomes the BASE.

If user's `options.systemPrompt` is undefined → no base, personality body is the entire system prompt.

**Invariants:**
- First call to `usePersonality` lazy-loads the registry. **EC-O (documented):** ~10ms cold-start I/O (4 file reads typical). Documented in JSDoc.
- Calling `usePersonality("none")` (or "default"/"neutral") clears active + returns null.
- Switch triggers `Agent.invalidateCache("personality-switch")` (D94 deferred default).
- Switch with `reset: true` ALSO calls `clearSession(agentId)` (existing internal helper).
- Switch emits transcript marker `[persona switched to <name>]` — implemented in Phase 5.
- **EC-J:** `usePersonality("none", { save: true })` after a previous `save:true` MUST remove the persistent JSON entry (delegates to PersonalityStore EC-B invariant — delete key, never write null).

**Edge cases:**
- **EC-12:** `usePersonality("nonexistent")` → throws `ConfigurationError(code: "personality_not_found")` with list of available names.
- **EC-13:** Disposed agent → throw `Error("Agent has been disposed")`.
- **EC-14:** Concurrent `usePersonality` calls → serialized via existing per-agent send mutex (or equivalent).

#### Tasks
1. Extend `SDKAgent` interface.
2. Wire registry + store + resolver in `LocalAgent` constructor.
3. Implement `LocalAgent.usePersonality(name, opts)`.
4. Re-export `PersonalityPreset` + `PersonalityRegistry` from `index.ts`.
5. Tests.

#### TDD
```
RED:     test_usePersonality_activates_preset_for_next_send()
RED:     test_usePersonality_none_clears_active()
RED:     test_usePersonality_default_clears_active() — reserved alias
RED:     test_usePersonality_neutral_clears_active() — reserved alias
RED:     test_usePersonality_unknown_throws_ConfigurationError() — EC-12
RED:     test_usePersonality_invalidates_cache_via_D94()
RED:     test_usePersonality_save_persists_across_create()
RED:     test_usePersonality_returns_preset_object_or_null()
RED:     test_clear_with_save_after_previous_save_removes_persistent_entry() — EC-J: round-trip clear via persistent store
GREEN:   Implement public API + wiring.
REFACTOR: None.
VERIFY:  pnpm vitest run tests/agent-personality-direct-api.test.ts
```

#### Acceptance Criteria
- [ ] 9 RED tests GREEN (was 8 — +1 from EC-J persistent-clear round-trip)
- [ ] `SDKAgent.usePersonality?` exposed in public API
- [ ] `PersonalityPreset` + `PersonalityRegistry` re-exported
- [ ] Existing 1137 tests stay green

#### DoD
- [ ] CHANGELOG entry
- [ ] All tests green

---

## Phase 4: Tool whitelist enforcement (additive narrowing via D102 layer 4)

### T4.1 — Personality tools narrow the agent's exposed tool set

#### Objective
When the active personality declares `tools: [...]`, filter the agent's available tools to that whitelist for the next turn. Missing tools (referenced by personality but not registered) → warn + drop, never crash.

#### Evidence
- D102 (3-layer tool registry: registration / exposure / availability).
- D167 (advisory, missing → warn).
- D101 (`pre_tool_call` veto must still win).

#### Files to edit
```
packages/sdk/src/internal/tool-registry/personality-filter.ts (NEW) — applyPersonalityFilter
packages/sdk/src/internal/runtime/local-agent.ts — invoke personality filter inside sendLocked tool-expose path
packages/sdk/tests/internal/tool-registry/personality-filter.test.ts (NEW) — 6 unit tests
```

#### Deep file dependency analysis
- `personality-filter.ts` (NEW) — pure function: takes `exposedTools: Tool[]` + `personality: PersonalityPreset | null` → returns filtered `Tool[]`.

#### Deep Dives

**Function signature:**

```typescript
export function applyPersonalityFilter(
  exposedTools: ReadonlyArray<{ name: string }>,
  whitelist: ReadonlyArray<string> | undefined,
): ReadonlyArray<{ name: string }>;
```

When `whitelist === undefined` → return exposedTools unchanged.
When `whitelist === []` → returns empty (explicit "no tools for this persona").
Missing tools: collected, emit ONE warning per (agentId, personality_name) combo.

**Invariants:**
- Never adds tools (purely subtractive — additive narrowing per D167).
- Never modifies `exposedTools` array (returns new).
- Warning fires once per unique (agentId, personality_name, missing_tool) — deduped.

**Edge cases:**
- **EC-15:** Whitelist references same tool twice → dedup silently.
- **EC-16:** Whitelist references built-in tool that's been disabled by `pre_tool_call` veto → veto wins (we're upstream).
- **EC-17:** Whitelist tool name has typo → log warn (with hint: "did you mean: <closest>") — only if Levenshtein distance ≤2 to a registered tool.

#### Tasks
1. Implement `applyPersonalityFilter`.
2. Wire into `LocalAgent.sendLocked` tool-expose path.
3. Tests.

#### TDD
```
RED:     test_no_whitelist_returns_unchanged()
RED:     test_empty_whitelist_returns_empty_set()
RED:     test_whitelist_filters_to_subset()
RED:     test_missing_tool_warns_once_per_combo()
RED:     test_duplicate_whitelist_entries_deduped() — EC-15
RED:     test_typo_warns_with_suggestion() — EC-17 (Levenshtein hint)
RED:     test_whitelist_matches_mcp_double_underscore_names() — EC-I: `mcp__server__tool` matches exact string, not regex
GREEN:   Implement filter.
REFACTOR: None.
VERIFY:  pnpm vitest run tests/internal/tool-registry/personality-filter.test.ts
```

#### Acceptance Criteria
- [ ] 7 RED tests GREEN (was 6 — +1 from EC-I MCP-style name match)
- [ ] File ≤120 LoC
- [ ] Cognitive complexity ≤10

#### DoD
- [ ] CHANGELOG entry
- [ ] All tests green

---

## Phase 5: Switch semantics — history + cache + transcript marker

### T5.1 — Implement `usePersonality` switch lifecycle

#### Objective
On every personality switch, run the full lifecycle: preserve history (default) or reset (opt-in), emit transcript marker, invalidate cache. This task wires what Phase 3 declared.

#### Evidence
- D164 (lifecycle decisions).
- arXiv:2412.00804 (re-injection mitigates drift).
- `appendSessionMessage` (existing internal) — already supports user/assistant/system roles.

#### Files to edit
```
packages/sdk/src/internal/personality/switch.ts (NEW) — performPersonalitySwitch lifecycle helper
packages/sdk/src/internal/runtime/local-agent.ts — call performPersonalitySwitch from usePersonality
packages/sdk/tests/internal/personality/switch.test.ts (NEW) — 7 unit tests
```

#### Deep file dependency analysis
- `switch.ts` (NEW) coordinates: store update → cache invalidation → marker injection → optional history reset.

#### Deep Dives

**Function shape:**

```typescript
export async function performPersonalitySwitch(args: {
  agentId: string;
  agentCwd: string;
  prevSlug: string | undefined;
  nextSlug: string | undefined;
  registry: PersonalityRegistry;
  store: PersonalityStore;
  invalidateCache: (reason: string) => Promise<void>;
  appendSessionMessage: (msg: { role: "user" | "assistant" | "system"; text: string }) => void;
  clearSession?: () => Promise<void>;
  opts: { save?: boolean; reset?: boolean };
}): Promise<PersonalityPreset | null>;
```

**Algorithm:**

1. If `nextSlug` is a reserved clear alias OR undefined → set store to undefined → cleared.
2. Otherwise, look up preset in registry; throw `ConfigurationError("personality_not_found")` if missing.
3. Update store via `setActive(agentId, nextSlug, { save: opts.save })`.
4. If `opts.reset === true` → call `clearSession()`.
5. If `prevSlug !== nextSlug` → append transcript marker as **user role** message:
   - For switch to a personality: `[persona switched to ${nextSlug}]`
   - For clear: `[persona cleared]`
   - For same → no marker.
6. Call `invalidateCache("personality-switch")` (D94 default = deferred).
7. Return the new preset (or null if cleared).

**Why user role for marker?** The marker is a directive to the model from the user/operator, not a model response. Choosing `user` role makes the marker survive history compaction (LLMs treat user-role lines as instructions).

**Invariants:**
- Switch with `prevSlug === nextSlug` → no-op return (no marker, no cache invalidation, no store write).
- Reset clears history BEFORE marker injection — marker is the first message of the new session.
- Cache invalidation uses `reason: "personality-switch"` (specific code for observability).

**Edge cases:**
- **EC-18:** Switch from "coder" to "coder" (same slug) → no-op, no marker, no cache invalidation.
- **EC-19:** Reset to "none" → clear session + emit `[persona cleared]` marker.
- **EC-20:** Switch while agent disposed → throw (Phase 3 guard catches first).

#### Tasks
1. Implement `performPersonalitySwitch` orchestrator.
2. Wire into `LocalAgent.usePersonality`.
3. Tests.

#### TDD
```
RED:     test_switch_emits_transcript_marker_user_role()
RED:     test_clear_emits_persona_cleared_marker()
RED:     test_same_slug_noop_no_marker_no_cache_invalidation() — EC-18
RED:     test_invalidateCache_called_with_personality_switch_reason()
RED:     test_reset_true_clears_session_then_emits_marker() — EC-19
RED:     test_save_true_writes_to_disk()
RED:     test_missing_personality_throws_with_available_list() — EC-12 carryover
RED:     test_marker_survives_session_compact_and_compression() — EC-D: trigger D91 compression after switch; marker still present in session log
RED:     test_concurrent_usePersonality_with_in_flight_send_serialized() — EC-E: switch waits for in-flight send to complete (per-agent mutex)
GREEN:   Implement orchestrator.
REFACTOR: None.
VERIFY:  pnpm vitest run tests/internal/personality/switch.test.ts
```

#### Acceptance Criteria
- [ ] 9 RED tests GREEN (was 7 — +2 from EC-D compression-survival + EC-E mutex serialization)
- [ ] File ≤180 LoC
- [ ] Marker uses user role (per D164 rationale)

#### DoD
- [ ] CHANGELOG entry
- [ ] All tests green

---

## Phase 6: Cloud rejection + Fork ALS inheritance

### T6.1 — `CloudAgent.usePersonality` rejects with `UnsupportedRunOperationError`

#### Objective
Cloud runtime is pre-release. `usePersonality` is a feature that requires consistent server-side enforcement we cannot guarantee. Reject explicitly.

#### Evidence
- D169 (matches D122 pattern for runUntil/fork).

#### Files to edit
```
packages/sdk/src/internal/runtime/cloud-agent.ts — add usePersonality method that throws UnsupportedRunOperationError
packages/sdk/tests/internal/runtime/cloud-agent-personality.test.ts (NEW) — 1 unit test
```

#### Deep file dependency analysis
- Reuses existing `UnsupportedRunOperationError` class (D122 path).

#### Tasks
1. Add `usePersonality(): Promise<never>` throwing `UnsupportedRunOperationError`.
2. Test.

#### TDD
```
RED:     test_cloud_usePersonality_throws_UnsupportedRunOperationError()
GREEN:   Implement guard.
REFACTOR: None.
VERIFY:  pnpm vitest run tests/internal/runtime/cloud-agent-personality.test.ts
```

#### Acceptance Criteria
- [ ] 1 RED test GREEN
- [ ] CloudAgent.usePersonality throws synchronously (matches D122 pattern)

#### DoD
- [ ] CHANGELOG entry
- [ ] All tests green

---

### T6.2 — Fork inherits parent's active personality via ALS

#### Objective
Subagents created via `Agent.fork` (D110) inherit the parent's active personality by reference. Calling `usePersonality` inside a fork = warning + no-op.

#### Evidence
- D168 (fork inheritance).
- D131 (credential pool ALS pattern).

#### Files to edit
```
packages/sdk/src/internal/personality/context.ts (NEW) — withPersonalityContext + currentPersonalityContext (AsyncLocalStorage)
packages/sdk/src/internal/runtime/fork-agent.ts — wrap fork in withPersonalityContext
packages/sdk/src/internal/runtime/local-agent.ts — usePersonality checks if running inside fork ALS scope → warn + no-op
packages/sdk/tests/internal/personality/fork-inheritance.test.ts (NEW) — 4 unit tests
```

#### Deep file dependency analysis
- `context.ts` (NEW) mirrors `credential-pool-context.ts` (D131).

#### Deep Dives

```typescript
import { AsyncLocalStorage } from "node:async_hooks";

const personalityStore = new AsyncLocalStorage<{ slug: string | undefined; isFork: true }>();

export async function withPersonalityContext<T>(
  ctx: { slug: string | undefined; isFork: true },
  fn: () => Promise<T>,
): Promise<T> {
  return personalityStore.run(ctx, fn);
}

export function currentPersonalityContext(): { slug: string | undefined; isFork: true } | undefined {
  return personalityStore.getStore();
}
```

**Invariants:**
- **EC-A:** Parent's active personality at fork-time is captured as a **SNAPSHOT of the slug string** (NOT a reference to the store). If parent later calls `usePersonality("Y")` while the fork is still running, the fork's ALS context still holds the original slug "X" from fork-construction time. Implementation: `withPersonalityContext({ slug: parentStore.active(parentAgentId), isFork: true }, fn)` — `parentStore.active(...)` is called ONCE at the wrap site and its return value (a string or undefined) is captured into the ALS context object.
- `usePersonality` inside a fork emits one stderr warning per fork agentId + returns null without state change.

**Edge cases:**
- **EC-21:** Parent has no active personality → fork also has none (still inherited "as configured").
- **EC-22:** Nested fork → inner fork captures outer fork's personality (which is parent's at fork-time).

#### Tasks
1. Implement `withPersonalityContext` + `currentPersonalityContext`.
2. Wrap `fork-agent.ts` execution in ALS scope.
3. Add no-op guard in `LocalAgent.usePersonality` when inside fork.
4. Tests.

#### TDD
```
RED:     test_fork_inherits_parent_active_personality()
RED:     test_fork_with_no_parent_personality_has_none()
RED:     test_usePersonality_inside_fork_is_noop_with_warning()
RED:     test_nested_fork_inherits_outer_fork_personality() — EC-22
RED:     test_parent_mid_flight_switch_does_not_mutate_fork_voice() — EC-A: parent calls usePersonality("Y") while fork running with snapshot "X"; fork's resolver still returns "X"
GREEN:   Implement ALS + guard.
REFACTOR: None.
VERIFY:  pnpm vitest run tests/internal/personality/fork-inheritance.test.ts
```

#### Acceptance Criteria
- [ ] 5 RED tests GREEN (was 4 — +1 from EC-A parent-mid-flight-switch invariant)
- [ ] ALS scope file ≤80 LoC
- [ ] **EC-A:** snapshot semantic implemented (slug string captured at fork-time, NOT live store reference)

#### DoD
- [ ] CHANGELOG entry
- [ ] All tests green

---

## Phase 7: ADRs + CHANGELOG + roadmap

### T7.1 — Write 10 ADRs D160-D169

#### Files to edit
```
.claude/knowledge-base/adrs/D160-personality-resolver-hook-only.md (NEW)
.claude/knowledge-base/adrs/D161-personality-markdown-frontmatter-shape.md (NEW)
.claude/knowledge-base/adrs/D162-personality-storage-locations.md (NEW)
.claude/knowledge-base/adrs/D163-personality-session-default-persistent-opt-in.md (NEW)
.claude/knowledge-base/adrs/D164-personality-switch-preserve-history-reinject.md (NEW)
.claude/knowledge-base/adrs/D165-personality-slash-command-name.md (NEW)
.claude/knowledge-base/adrs/D166-personality-no-builtin-presets.md (NEW)
.claude/knowledge-base/adrs/D167-personality-tools-model-advisory.md (NEW)
.claude/knowledge-base/adrs/D168-personality-fork-als-inheritance.md (NEW)
.claude/knowledge-base/adrs/D169-personality-cloud-unsupported.md (NEW)
```

#### Tasks
1. Write each ADR (Date, Status, Decision, Rationale, Consequences).

#### Acceptance Criteria
- [ ] 10 ADR files
- [ ] Each ≤150 LoC
- [ ] CLAUDE.md ADR table updated

---

### T7.2 — CHANGELOG + roadmap row #5 → ✅ DONE

#### Files to edit
```
packages/sdk/CHANGELOG.md — under [Unreleased]: v1.14 personality-presets section
CLAUDE.md — Roadmap row #5 → DONE; ADR table append D160-D169
```

#### Tasks
1. Update CHANGELOG with full v1.14 section.
2. Mark Roadmap row #5 DONE.
3. Append ADRs to table.

#### Acceptance Criteria
- [ ] CHANGELOG references all 10 ADRs + new public API
- [ ] Roadmap row #5 strikethrough
- [ ] ADR table append committed

---

## Phase 8: Dogfood QA (MANDATORY)

### T8.1 — Telegram-pro `/personality` slash command + 2 sample presets

#### Objective
Add `/personality <name>` command to telegram-pro showing live switch end-to-end. Ship 2 sample preset files in `examples/telegram-pro/.theokit/personalities/` (`coder.md`, `poet.md`). Demonstrates: lookup → switch → next `agent.send` reflects voice → tools whitelist works.

#### Evidence
- D165 (slash command implemented userland-side).
- D166 (telegram-pro ships sample presets).
- Real-LLM validation rule (`.claude/rules/real-llm-validation.md`) — `agent.send()` after switch must hit real LLM.

#### Files to edit
```
examples/telegram-pro/.theokit/personalities/coder.md (NEW) — coder persona with tool whitelist
examples/telegram-pro/.theokit/personalities/poet.md (NEW) — poet persona (no tools)
examples/telegram-pro/src/index.ts — add /personality command
.claude/skills/telegram-pro-dogfood/lib/dogfood.mjs — add scenarios #37, #38, #39
```

#### Deep Dives

**Sample `coder.md`:**

```markdown
---
name: coder
description: Concise senior engineer voice with code-first replies
tools:
  - read_file
  - write_file
tags:
  - coding
  - precise
---

You are a senior software engineer. Reply with code first, prose second.
Cite file paths. Never apologize. Show diffs when modifying existing code.
```

**Sample `poet.md`:**

```markdown
---
name: poet
description: Replies in short verse
tags:
  - whimsical
---

You are a poet. Reply only in haiku (5-7-5 syllables). One per message.
```

**`/personality` command:**

> **EC-G + EC-H:** input is trimmed (`.trim()`) and only the FIRST token is taken. Extra args after the name are silently ignored. `/personality coder ` (trailing space) and `/personality coder extra noise` both resolve to slug `coder`.

```typescript
bot.command("personality", async (ctx) => {
  // EC-G: trim trailing whitespace; EC-H: take first token only
  const raw = (ctx.match ?? "").toString().trim();
  const arg = raw.split(/\s+/)[0] ?? "";
  // ... resolves agent for ctx.from.id, calls agent.usePersonality(arg) ...
  // Replies with confirmation or list (if no arg)
});
```

**Dogfood scenarios:**

```javascript
// #37 — list presets (no arg)
{ text: "/personality", expect: [/Available personalities|coder|poet/i], waitMs: 5000 },
// #38 — switch to coder + verify voice
{ text: "/personality coder", expect: [/Personality.*coder|switched/i], waitMs: 5000 },
// #39 — clear
{ text: "/personality none", expect: [/cleared|none|default/i], waitMs: 5000 },
```

**EC-G + EC-H validation:** pre-flight `--only "/personality coder "` (trailing space) and `--only "/personality coder extra junk"` to verify both resolve cleanly to `coder` before running full dogfood. **EC-P (documented):** if a 3rd-party adopter ships 100+ presets, `/personality` list may exceed Telegram's 4096-char message limit — paginate userland-side. Our 2-preset demo is far under the limit.

#### Tasks
1. Create 2 preset files in `examples/telegram-pro/.theokit/personalities/`.
2. Implement `/personality` command in telegram-pro index.ts.
3. Add 3 dogfood scenarios.
4. Run full dogfood.

#### Acceptance Criteria
- [ ] `/personality` lists 2 presets
- [ ] `/personality coder` switches active; next send shows coder voice (real LLM evidence captured)
- [ ] `/personality none` clears active
- [ ] **EC-G:** `/personality coder ` (trailing space) resolves to `coder` (pre-flight isolated probe before full dogfood)
- [ ] **EC-H:** `/personality coder extra junk` ignores extras and resolves to `coder`
- [ ] Dogfood: PASS + SKIP == total

#### DoD
- [ ] CHANGELOG entry
- [ ] Real-LLM evidence captured in commit message

---

### T8.2 — Full validate + push

#### Execution
```bash
pnpm -w run validate
node .claude/skills/telegram-pro-dogfood/lib/dogfood.mjs --user-id 7528967933
```

#### Acceptance Criteria
- [ ] `pnpm validate` exit 0
- [ ] Dogfood ≥36/39 PASS (3 new scenarios)
- [ ] Real-LLM evidence for /personality switching captured

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | No persona switching mid-session | T3.1, T3.2 | `Agent.usePersonality(name)` + resolver |
| 2 | System prompt is "set at create time" → swapping = dispose+recreate | T3.2, T5.1 | Switch lifecycle preserves agent state |
| 3 | No standard preset file format | T1.1 / D161 | Markdown + YAML frontmatter Zod-validated |
| 4 | No tool-scoping per persona | T4.1 / D167 | Advisory whitelist with warn-on-missing |
| 5 | No persistence of active preset | T2.1 / D163 | `$THEOKIT_HOME/personality.json` via casUpdate |
| 6 | No clear "none" semantic | T1.1, T3.2 / D161 | Reserved aliases `none`/`default`/`neutral` |
| 7 | Mid-switch persona drift / refusals | T5.1 / D164 | Re-inject + transcript marker + cache invalidation |
| 8 | Auto-switch causing unauthorized actions (Cursor cautionary tale) | T3.2 / D164 | Default explicit opt-in; no auto-switch ever |
| 9 | Cloud user surface ambiguity | T6.1 / D169 | UnsupportedRunOperationError on cloud |
| 10 | Fork persona consistency | T6.2 / D168 | ALS inheritance from parent |
| 11 | Brand pollution from default presets | T8.1 / D166 | NO built-in presets; one example in docs + 2 in telegram-pro |
| 12 | Slug collision project + user | T1.1 / D162 | Project wins; warning once |
| 13 | Persistent file corruption / version skew | T2.1 / D163 | Unknown version → treat as empty + log warn |
| 14 | Concurrent write race (multi-process) | T2.1 / D163 | `casUpdate` (D83) retries |
| 15 | Missing tool referenced by preset | T4.1 / D167 | Warn + drop; never crash |
| 16 | Missing model referenced by preset | T3.2 / D167 | Warn + use agent default |
| 17 | Telegram-pro live demo + 2 presets | T8.1 | `/personality` command + sample files |
| 18 | No ADRs documenting decisions | T7.1 | 10 ADRs D160-D169 |
| 19 | CHANGELOG + roadmap not updated | T7.2 | Both updated |
| 20 | Push gate must pass | T8.2 | `pnpm validate` exit 0 |
| 21 | **EC-A:** fork inheritance "by reference" vs "frozen" contradiction in D168 | T6.2 / D168 | Snapshot-of-slug-string at fork-time; parent mid-flight switch does NOT mutate fork |
| 22 | **EC-B:** `setActive(undefined, save:true)` persistent semantic unspecified | T2.1 | DELETE JSON key, never write null; one canonical "absent === inactive" representation |
| 23 | **EC-C:** case-sensitive slug ambiguity (`Coder` vs `coder` both valid but distinct) | T1.1 / D161 | Lowercase-only Zod regex (no `/i` flag) |
| 24 | **EC-D:** transcript marker may not survive compression | T5.1 | Test asserts marker remains in session log after D91 compression |
| 25 | **EC-E:** concurrent switch + in-flight send race | T5.1 | Test verifies per-agent send mutex serializes switch after send completes |
| 26 | **EC-F:** resolver with empty `ctx.agentId` | T3.1 | Returns base unchanged; no crash |
| 27 | **EC-G/H:** `/personality` arg parsing (trailing space + extra tokens) | T8.1 | `.trim()` + `.split(/\s+/)[0]` — first token only |
| 28 | **EC-I:** MCP-style tool names in whitelist | T4.1 | Exact-string match (no regex semantic) |
| 29 | **EC-J:** clear after save round-trip | T3.2 | Removes persistent entry via EC-B delete-key path |
| 30 | EC-K/L/M/N/O/P (DOCUMENT) | (inline notes in ADRs + JSDoc) | Risks accepted; documented in plan and consequences |

**Coverage: 30/30 gaps (100%)**

## Global Definition of Done

- [ ] All 8 phases completed
- [ ] All tests passing across workspace (≥1197 total — adds ~60 new tests from this plan + 7 EC-tests from v1.1 review)
- [ ] Zero biome warnings; zero knip warnings
- [ ] `SDKAgent.usePersonality?` exposed in public API
- [ ] `PersonalityPreset` + `PersonalityRegistry` re-exported from `@theokit/sdk`
- [ ] 10 new ADRs (D160-D169) written
- [ ] CHANGELOG updated
- [ ] CLAUDE.md SDK Roadmap row #5 → ✅ DONE
- [ ] **Dogfood QA PASS** — `/dogfood full` ≥36/39 (SKIPs count as PASS)
- [ ] **Runtime-metric proof** — `personality_switch` cache-invalidation observed via D94 counter in a real workload (telegram-pro switch round-trip)
- [ ] Backward compat: existing `Agent.create({ systemPrompt: ... })` unchanged
- [ ] **EC-A:** fork ALS snapshot semantic verified — parent mid-flight switch does NOT mutate active fork
- [ ] **EC-B:** persistent clear deletes JSON key (manual inspection of file after dogfood)
- [ ] **EC-C:** uppercase slug rejected at Zod validation (lint-style gate in tests)

## Final Phase: Dogfood QA (MANDATORY)

### Execution

Run `node .claude/skills/telegram-pro-dogfood/lib/dogfood.mjs --user-id 7528967933` against telegram-pro with:
- 2 personality preset files committed
- `/personality` slash command wired

### Acceptance Criteria

- [ ] Health: ≥36/39 PASS (3 new scenarios `/personality`)
- [ ] Zero CRITICAL issues introduced by this plan
- [ ] Zero HIGH issues in `/personality` command path
- [ ] Pre-existing flakes acknowledged, NOT blocking

### If Dogfood Fails

1. Identify root cause (registry load bug vs slash command vs harness flake).
2. Fix plan-caused issues; re-run dogfood.
3. Pre-existing issues logged, not blocking.
