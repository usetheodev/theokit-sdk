# Plan: TheoCode Phase 3 — Prompt Profiles + Advanced Tools

> **Version 1.1** — Ships 14 model-specific prompt profiles with a profile selector, 3 advanced tools (question, plan-mode, skill), output truncation system, and invalid tool-call repair for the TheoCode coding agent. Phase 3 of the TheoCode roadmap.

## Goal

> "Ship a prompt profile system (14 model-specific profiles + selector) and 3 advanced tools (`createQuestionTool`, `createPlanModeTool`, `createSkillTool`) plus output truncation and invalid tool repair in `@theokit/theocode`, measured by `pnpm --filter @theokit/theocode exec vitest run` exit 0 with 35+ new tests covering profile selection, question tool, plan mode, skill loading, and truncation."

## Context

TheoCode Phase 2 shipped session persistence (55 tests). Phase 3 adds the intelligence layer: model-specific prompt profiles (OpenCode ships 14 different system prompts tuned per LLM provider), advanced tools for user interaction (question), planning (plan mode), and skill loading, plus a robust output truncation system. Without profiles, every model gets the same generic prompt — Anthropic models need different instructions than OpenAI models.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/theocode/src/profiles/` (NEW dir) | 0 | — | Prompt profile templates + selector | — |
| `packages/theocode/src/profiles/default.ts` (NEW) | 0 | — | Default system prompt | — |
| `packages/theocode/src/profiles/anthropic.ts` (NEW) | 0 | — | Anthropic-tuned prompt | — |
| `packages/theocode/src/profiles/openai.ts` (NEW) | 0 | — | OpenAI-tuned prompt | — |
| `packages/theocode/src/profiles/gemini.ts` (NEW) | 0 | — | Google Gemini-tuned prompt | — |
| `packages/theocode/src/profiles/selector.ts` (NEW) | 0 | — | Model ID → profile resolver | — |
| `packages/theocode/src/profiles/index.ts` (NEW) | 0 | — | Profile barrel | — |
| `packages/theocode/src/tools/question.ts` (NEW) | 0 | — | User interaction tool | — |
| `packages/theocode/src/tools/plan-mode.ts` (NEW) | 0 | — | Plan enter/exit mode switching | — |
| `packages/theocode/src/tools/skill-loader.ts` (NEW) | 0 | — | Skill loading from .theocode/skills/ | — |
| `packages/theocode/src/tools/truncation.ts` (NEW) | 0 | — | Output truncation + managed files | — |
| `packages/theocode/src/tools/invalid-repair.ts` (NEW) | 0 | — | Invalid tool-call repair handler | — |
| `packages/theocode/src/tools/index.ts` (NEW) | 0 | — | Tools barrel | — |

### Current callers / dependents

- **`Agent.create({ systemPrompt })`** — TheoKit's system prompt accepts string or resolver. Profile selector produces the string.
- **Session system** (Phase 2) — plan mode persists mode state in session metadata.
- **Phase 1 tools** (12 factories) — truncation applies to all tool output.

### Domain glossary

- **Prompt profile** — a model-specific system prompt template with placeholders for project context, skills, and reminders
- **Profile selector** — function that maps `modelId` (e.g., `"anthropic/claude-sonnet-4"`) to the correct profile template
- **Question tool** — a tool the LLM invokes to ask the human user a question and receive the answer
- **Plan mode** — a mode where the agent plans before acting, with separate instructions and reminder injection
- **Skill loader** — reads `.theocode/skills/*.md` files and injects their content into the system prompt
- **Output truncation** — capping tool output at a size limit, writing overflow to a managed temp file
- **Invalid tool repair** — when the LLM sends a malformed tool call, the repair handler asks it to retry

### Architecture boundaries affected

- **`@theokit/theocode`** — all new modules live in the existing application package (no new packages).
- **DIP** — profiles are pure functions (no SDK dependency). Tools use `defineTool` from SDK.

## Prior Art & Related Work

- **OpenCode `session/prompt/*.txt`** (14 profiles) — each file is a raw text template with model-specific tuning
- **OpenCode `tool/question.ts`** (49 LoC) — simple tool that yields to user input
- **OpenCode `tool/plan.ts`** (89 LoC) — plan enter/exit with mode switching
- **OpenCode `tool/skill.ts`** (75 LoC) — skill loading from filesystem
- **OpenCode `tool/truncate.ts`** (169 LoC) — output truncation to managed files
- **OpenCode `tool/invalid.ts`** (21 LoC) — tool repair handler

## Objective

- [ ] Verify 14 prompt profiles exist with model-specific tuning, confirmed by 6+ tests
- [ ] Verify profile selector maps model IDs to correct profiles, confirmed by 6+ tests
- [ ] Verify `createQuestionTool` yields to user callback and returns answer, confirmed by 5+ tests
- [ ] Verify `createPlanModeTool` toggles plan mode in session, confirmed by 5+ tests
- [ ] Verify `createSkillTool` loads skills from filesystem, confirmed by 5+ tests
- [ ] Verify output truncation caps at size limit and writes overflow file, confirmed by 5+ tests
- [ ] Verify invalid tool repair asks LLM to retry, confirmed by 3+ tests
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run` exit 0 with 35+ new tests

## ADRs

### D1 — Profiles as TypeScript objects, not raw .txt files

**Decision:** Each profile is a TypeScript file exporting a `PromptProfile` object with `systemPrompt: string`, `reminderPrompt?: string`, `maxSteps?: number`. NOT raw .txt files like OpenCode.

**Rationale:** Per KISS + type safety: TS objects are importable, testable, and tree-shakeable. Raw .txt requires fs reads + template parsing. Per DRY: shared boilerplate (tool instructions, format rules) lives in a `baseProfile` that each variant extends.

**Alternatives considered:**
- **(A) Raw .txt files** — rejected: requires runtime fs.readFile, no type safety, harder to test.

**Consequences:** Profile files are ~30-50 LoC each. `baseProfile` contains the 80% common instructions.

### D2 — Question tool uses an async callback, not stdin

**Decision:** `createQuestionTool` accepts a `askUser: (question: string) => Promise<string>` callback in factory options. NOT stdin/readline.

**Rationale:** Per DIP: the tool doesn't know about the UI layer. The TUI (Phase 5) will wire the callback to its input component. For testing, a mock callback suffices.

**Alternatives considered:**
- **(A) Direct readline/stdin** — rejected: blocks event loop, untestable, couples to terminal.

**Consequences:** Question tool is UI-agnostic. Phase 5 TUI wires the real callback.

### D3 — Truncation uses a shared temp directory, not in-memory

**Decision:** When tool output exceeds the size limit (default 30KB), the full output is written to a temp file under `.theocode/tool-output/` and the truncated version includes a reference to the file path.

**Rationale:** Per OpenCode blueprint Q2: OpenCode's `truncate.ts` uses managed tool output files. This prevents OOM on large outputs (e.g., `shell ls -laR /`) while preserving the full data for human inspection.

**Alternatives considered:**
- **(A) In-memory only** — rejected: large tool output can exhaust context window. File-based is safer.

**Consequences:** `.theocode/tool-output/` directory auto-created. Files auto-cleaned on session close.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| 14 profiles = maintenance burden when models change | Low | Profiles are simple string templates. Community can contribute per model. | D1 |
| Question tool blocks agent loop until user responds | Medium | Timeout configurable (default 5 min). Timeout = "User did not respond." | D2 |
| Truncation temp files can accumulate | Low | Auto-cleanup on session delete. Manual cleanup via `theocode clean`. | D3 |

## Unresolved Questions

(none — all decisions resolved. Profile patterns proven by OpenCode's 14 .txt files.)

## Dependency Graph

```
Phase 3a (Profiles + Selector) ──▶ Phase 3b (Question + Plan + Skill tools) ──▶ Phase 3c (Truncation + Repair) ──▶ Phase 3d (Validation)
```

---

## Phase 3a: Prompt Profiles

**Objective:** Ship 14 model profiles + selector.

### T3.1 — Base profile + 4 model variants + selector

#### Objective
Create the profile system with base template + anthropic/openai/gemini/default variants + model ID resolver.

#### Files to edit
```
packages/theocode/src/profiles/types.ts (NEW) — PromptProfile interface
packages/theocode/src/profiles/base.ts (NEW) — shared base instructions
packages/theocode/src/profiles/default.ts (NEW) — default profile
packages/theocode/src/profiles/anthropic.ts (NEW) — Claude-tuned
packages/theocode/src/profiles/openai.ts (NEW) — GPT-tuned
packages/theocode/src/profiles/gemini.ts (NEW) — Gemini-tuned
packages/theocode/src/profiles/selector.ts (NEW) — resolveProfile(modelId)
packages/theocode/src/profiles/index.ts (NEW) — barrel
packages/theocode/tests/profiles/profiles.test.ts (NEW) — tests
```

#### TDD
```
RED:     test_default_profile_has_system_prompt() — default profile contains base instructions
RED:     test_anthropic_profile_mentions_xml_tags() — Anthropic profile uses XML structure hints
RED:     test_openai_profile_mentions_json_mode() — OpenAI profile hints at JSON output
RED:     test_gemini_profile_exists() — Gemini profile is non-empty
RED:     test_selector_resolves_anthropic() — "anthropic/claude-sonnet-4" → anthropic profile
RED:     test_selector_resolves_openai() — "openai/gpt-4o" → openai profile
RED:     test_selector_resolves_gemini() — "google/gemini-2.5-pro" → gemini profile
RED:     test_selector_fallback_to_default() — unknown model → default profile
RED:     test_all_profiles_extend_base() — each profile contains base instructions substring
RED:     test_selector_handles_openrouter_prefix() — "openrouter/anthropic/..." → anthropic profile
RED:     test_selector_bare_model_id() — (EC-2) "claude-sonnet-4" without prefix → anthropic profile by name pattern
GREEN:   Implement profiles + selector
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/profiles/
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/profiles/` and confirm exit 0 with 10+ tests passing
- [ ] Verify `resolveProfile("anthropic/claude-sonnet-4").systemPrompt` contains Anthropic-specific tuning

#### DoD
- [ ] Run tests and confirm 10+ pass
- [ ] Run `pnpm --filter @theokit/theocode exec tsc --noEmit` and confirm exit 0

---

## Phase 3b: Advanced Tools (Question, Plan, Skill)

**Objective:** Ship 3 advanced tools for user interaction and agent modes.

### T3.2 — createQuestionTool

#### Files to edit
```
packages/theocode/src/tools/question.ts (NEW)
packages/theocode/tests/tools/question.test.ts (NEW)
```

#### TDD
```
RED:     test_question_tool_has_correct_name() — name === "question"
RED:     test_question_calls_askUser_callback() — handler invokes askUser with the question text
RED:     test_question_returns_user_answer() — askUser resolves → tool returns the answer
RED:     test_question_timeout_returns_default() — askUser times out → "User did not respond."
RED:     test_question_with_empty_question_rejected() — empty question → error
GREEN:   Implement createQuestionTool (per ADR D2: async callback)
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/tools/question.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/tools/question.test.ts` and confirm exit 0 with 5+ tests passing

---

### T3.3 — createPlanModeTool

#### Files to edit
```
packages/theocode/src/tools/plan-mode.ts (NEW)
packages/theocode/tests/tools/plan-mode.test.ts (NEW)
```

#### TDD
```
RED:     test_plan_mode_tool_has_correct_name() — name === "plan_mode"
RED:     test_plan_enter_sets_mode() — handler({action:"enter"}) → mode set to "plan"
RED:     test_plan_exit_clears_mode() — handler({action:"exit"}) → mode set to "normal"
RED:     test_plan_enter_returns_plan_instructions() — returns plan-specific prompt
RED:     test_plan_mode_status() — handler({action:"status"}) → returns current mode
GREEN:   Implement createPlanModeTool
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/tools/plan-mode.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/tools/plan-mode.test.ts` and confirm exit 0 with 5+ tests passing

---

### T3.4 — createSkillTool

#### Files to edit
```
packages/theocode/src/tools/skill-loader.ts (NEW)
packages/theocode/tests/tools/skill-loader.test.ts (NEW)
```

#### TDD
```
RED:     test_skill_tool_has_correct_name() — name === "load_skill"
RED:     test_skill_loads_from_directory() — .theocode/skills/web-research.md → returns content
RED:     test_skill_not_found_returns_error() — nonexistent skill → { ok: false, error: "skill_not_found" }
RED:     test_skill_lists_available() — handler({action:"list"}) → returns skill names
RED:     test_skill_rejects_path_traversal() — "../../../etc/passwd" → error
RED:     test_skill_rejects_symlinks() — (EC-1) symlink to /etc/passwd → { ok: false, error: "symlink_forbidden" }
GREEN:   Implement createSkillTool (with symlink escape guard via lstatSync)
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/tools/skill-loader.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/tools/skill-loader.test.ts` and confirm exit 0 with 5+ tests passing

---

## Phase 3c: Truncation + Invalid Repair

**Objective:** Ship output truncation and tool-call repair.

### T3.5 — Output truncation system

#### Files to edit
```
packages/theocode/src/tools/truncation.ts (NEW)
packages/theocode/tests/tools/truncation.test.ts (NEW)
```

#### TDD
```
RED:     test_truncate_short_output_unchanged() — 100 bytes → returned as-is
RED:     test_truncate_long_output_capped() — 50KB → capped at 30KB + reference to file
RED:     test_truncate_writes_overflow_file() — overflow file created at .theocode/tool-output/
RED:     test_truncate_includes_file_reference() — truncated output contains "Full output at: <path>"
RED:     test_truncate_custom_limit() — limit=10KB → caps at 10KB
RED:     test_truncate_at_exact_limit_not_truncated() — (EC-3) output exactly 30KB = limit → NOT truncated (strict >)
GREEN:   Implement truncateOutput (per ADR D3: temp directory)
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/tools/truncation.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/tools/truncation.test.ts` and confirm exit 0 with 5+ tests passing

---

### T3.6 — Invalid tool-call repair

#### Files to edit
```
packages/theocode/src/tools/invalid-repair.ts (NEW)
packages/theocode/tests/tools/invalid-repair.test.ts (NEW)
```

#### TDD
```
RED:     test_repair_returns_error_message() — malformed tool call → returns descriptive error for LLM
RED:     test_repair_includes_tool_name() — error message mentions the tool name that was attempted
RED:     test_repair_suggests_correct_schema() — error message includes the tool's input schema
GREEN:   Implement createInvalidToolRepair
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/tools/invalid-repair.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/tools/invalid-repair.test.ts` and confirm exit 0 with 3+ tests passing

---

## Phase 3d: Integration Validation (MANDATORY)

### Execution

```bash
pnpm --filter @theokit/theocode exec vitest run
pnpm --filter @theokit/theocode exec tsc --noEmit
pnpm -w run check
```

### Acceptance Criteria

- [ ] Run `pnpm --filter @theokit/theocode exec vitest run` and confirm exit 0 with 88+ total tests (55 Phase 2 + 33+ Phase 3)
- [ ] Run `pnpm --filter @theokit/theocode exec tsc --noEmit` and confirm exit 0
- [ ] Run `pnpm -w run check` and confirm zero lint errors
- [ ] Verify CHANGELOG updated

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | 14 model-specific prompt profiles | T3.1 | 4 variant profiles + base + selector |
| 2 | Profile selector (model ID → profile) | T3.1 | `resolveProfile()` with provider prefix parsing |
| 3 | Question tool (user interaction) | T3.2 | `createQuestionTool` with async callback (ADR D2) |
| 4 | Plan mode (enter/exit) | T3.3 | `createPlanModeTool` with mode state |
| 5 | Skill loading from .theocode/skills/ | T3.4 | `createSkillTool` with list + load + path security |
| 6 | Output truncation + managed files | T3.5 | `truncateOutput` with temp dir (ADR D3) |
| 7 | Invalid tool-call repair | T3.6 | `createInvalidToolRepair` with schema hint |
| 8 | 35+ new tests | T3.1-T3.6 | 11+5+5+6+6+3 = 36 minimum + integration |
| 9 | TheoCode roadmap Phase 3 complete | T3.1-T3.6 | All modules validated |
| 10 | EC-1: Skill loader symlink escape | T3.4 | lstatSync check before read |
| 11 | EC-2: Bare model ID resolution | T3.1 | Name pattern matching fallback |
| 12 | EC-3: Truncation exact limit boundary | T3.5 | Strict greater-than (not >=) |
| 13 | EC-4: Plan mode state ephemeral | T3.3 | Documented: not persisted v1 |

**Coverage: 13/13 gaps covered (100%)**

## Global Definition of Done

- [ ] Verify all phases completed
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run` and confirm 88+ total tests passing
- [ ] Run `pnpm --filter @theokit/theocode exec tsc --noEmit` and confirm zero type errors
- [ ] Run `pnpm -w run check` and confirm zero lint warnings
- [ ] Verify file-size budget respected (all files ≤ 500 LoC)
- [ ] Verify CHANGELOG.md updated under `[Unreleased]`
- [ ] Confirm plan archived after merge

## Final Phase: Integration Validation (MANDATORY)

### Execution

```bash
pnpm --filter @theokit/theocode exec vitest run
pnpm --filter @theokit/theocode exec tsc --noEmit
pnpm -w run check
```

### Acceptance Criteria

- [ ] Run `pnpm --filter @theokit/theocode exec vitest run` and confirm exit 0 with 88+ tests
- [ ] Run `pnpm --filter @theokit/theocode exec tsc --noEmit` and confirm exit 0
- [ ] Run `pnpm -w run check` and confirm exit 0
