# Plan: TheoCode Phase 5 — Terminal UI (TUI)

> **Version 1.0** — Ships a React/Ink-based terminal UI for the TheoCode coding agent with chat input, message display, session management, model selection, keymap system, theme support, and status bar. Phase 5 (final) of the TheoCode roadmap.

## Goal

> "Ship a TUI application in `@theokit/theocode` using React + Ink that enables interactive coding agent sessions in the terminal, measured by `pnpm --filter @theokit/theocode exec vitest run` exit 0 with 30+ new TUI tests and a working `theocode` CLI entry point that launches the TUI."

## Context

TheoCode Phases 1-4 shipped tools (12 factories), session persistence (8 modules), prompt profiles + advanced tools (6 modules), and infrastructure (9 modules) — totaling 152 tests. Phase 5 is the final layer: the terminal UI that wires everything together into an interactive coding agent. OpenCode uses SolidJS + @opentui/solid (custom framework). TheoCode uses React + Ink (industry standard for Node.js TUIs, used by Jest, Gatsby, Prisma, Terraform CDK).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/theocode/src/tui/app.tsx` (NEW) | 0 | — | Root TUI application component | — |
| `packages/theocode/src/tui/chat-input.tsx` (NEW) | 0 | — | Multiline chat input | — |
| `packages/theocode/src/tui/message-display.tsx` (NEW) | 0 | — | Message rendering (streaming + markdown) | — |
| `packages/theocode/src/tui/tool-display.tsx` (NEW) | 0 | — | Tool execution output | — |
| `packages/theocode/src/tui/session-selector.tsx` (NEW) | 0 | — | Session list/switch/create/delete | — |
| `packages/theocode/src/tui/model-selector.tsx` (NEW) | 0 | — | Model/provider selector | — |
| `packages/theocode/src/tui/keymap.ts` (NEW) | 0 | — | Keyboard shortcut system | — |
| `packages/theocode/src/tui/theme.ts` (NEW) | 0 | — | Color theme system | — |
| `packages/theocode/src/tui/status-bar.tsx` (NEW) | 0 | — | Token count + cost + model display | — |
| `packages/theocode/src/tui/index.tsx` (NEW) | 0 | — | TUI entry point | — |
| `packages/theocode/src/cli.ts` (NEW) | 0 | — | CLI entry point (launches TUI) | — |

### Current callers / dependents

- **SessionManager** (Phase 2) — TUI creates/loads/switches sessions
- **MessageStore** (Phase 2) — TUI displays messages from store
- **Profile selector** (Phase 3) — TUI uses selected model to resolve profile
- **Question tool** (Phase 3) — TUI wires the `askUser` callback to chat input
- **Permission engine** (Phase 4) — TUI wires the "ask" action to a confirmation dialog
- **Event bus** (Phase 4) — TUI subscribes to events for live updates
- **Formatter** (Phase 4) — TUI uses formatter for code/diff rendering

### Domain glossary

- **Ink** — React renderer for the terminal (npm `ink`). Components render to ANSI escape sequences.
- **Keymap** — mapping of keyboard shortcuts to actions (Ctrl+C → exit, Ctrl+N → new session, etc.)
- **Theme** — color palette for the TUI (primary, secondary, error, success, muted, border colors)
- **Status bar** — bottom-of-screen bar showing token count, cost, model name, session name

### Architecture boundaries affected

- **`@theokit/theocode`** — TUI lives in the existing package (no new package needed).
- **New deps:** `ink` + `react` + `@types/react` as devDependencies.

## Prior Art & Related Work

- **OpenCode `packages/tui/`** — SolidJS + @opentui/solid. 20+ components, mode-based keybindings. We use React/Ink instead (more ecosystem support, better testing with ink-testing-library).
- **Ink testing library** (`ink-testing-library`) — renders Ink components to strings for snapshot testing.
- **Claude Code CLI** — uses Ink for its TUI. Proven pattern.

## Objective

- [ ] Verify TUI launches via `theocode` CLI entry point, confirmed by smoke test
- [ ] Verify chat input accepts multiline text and submits on Enter, confirmed by 4+ tests
- [ ] Verify message display renders user/assistant/system/tool messages, confirmed by 4+ tests
- [ ] Verify session selector lists/switches/creates sessions, confirmed by 4+ tests
- [ ] Verify model selector shows available models, confirmed by 3+ tests
- [ ] Verify keymap system maps shortcuts to actions, confirmed by 4+ tests
- [ ] Verify theme system provides color values, confirmed by 3+ tests
- [ ] Verify status bar shows token count + model + session, confirmed by 3+ tests
- [ ] Verify tool display renders tool output with truncation, confirmed by 3+ tests
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run` exit 0 with 30+ new TUI tests

## ADRs

### D1 — React + Ink, not SolidJS + OpenTUI

**Decision:** Use `ink` (React renderer for terminal) + `react` for the TUI. NOT SolidJS + @opentui/solid like OpenCode.

**Rationale:** Per Rule 9 "don't reinvent": Ink is the industry standard for Node.js TUIs (used by Jest, Gatsby, Prisma, Terraform CDK, Claude Code). Has `ink-testing-library` for component testing. SolidJS TUI tooling (@opentui) is OpenCode-specific and not widely adopted.

**Alternatives considered:**
- **(A) SolidJS + @opentui** — rejected: niche ecosystem, no testing library, requires learning new reactive model.
- **(B) blessed/blessed-contrib** — rejected: legacy, unmaintained, complex API.

**Consequences:** Adds `ink@5` + `react@18` + `@types/react` as deps. Components are standard JSX.

### D2 — Keymap as data, not hardcoded switch statements

**Decision:** Keymap is a `Map<string, Action>` loaded from a default config. Users can override via `.theocode/keymap.json`.

**Rationale:** Per OCP: new shortcuts added without modifying code. Per DIP: keymap is data, not logic.

**Alternatives considered:**
- **(A) Hardcoded switch** — rejected: every new shortcut requires code change.

**Consequences:** Default keymap ships with 10-15 bindings. Override via config file.

### D3 — Component tests via ink-testing-library, not E2E

**Decision:** TUI components tested via `ink-testing-library` (renders to string, asserts on output). NOT Puppeteer/Playwright E2E.

**Rationale:** Per KISS: component-level tests are fast (ms), deterministic, and don't require a real terminal. E2E tests for TUI are flaky and slow.

**Alternatives considered:**
- **(A) E2E with pseudo-terminal** — rejected: flaky, slow, hard to debug.

**Consequences:** Tests render components in isolation, assert on ANSI-stripped output text.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Ink + React adds ~2MB to node_modules | Low | Dev dep only; TUI is not bundled for library consumers. | D1 |
| Ink rendering differs between terminal emulators | Medium | Test with ink-testing-library (terminal-agnostic). Manual QA on iTerm2 + Windows Terminal. | D3 |
| Streaming display may flicker on fast token output | Medium | Use Ink's `<Static>` for completed messages; only active message uses `<Text>`. | T5.3 |

## Unresolved Questions

(none — Ink + React pattern well-established. OpenCode blueprint Q9 provided architecture reference.)

## Dependency Graph

```
Phase 5a (Core: app + chat-input + message-display) ──▶ Phase 5b (Selectors + status) ──▶ Phase 5c (Keymap + theme + CLI) ──▶ Phase 5d (Validation)
```

---

## Phase 5a: Core TUI Components

### T5.1 — App root + chat input

#### Files to edit
```
packages/theocode/src/tui/app.tsx (NEW)
packages/theocode/src/tui/chat-input.tsx (NEW)
packages/theocode/tests/tui/chat-input.test.tsx (NEW)
```

#### TDD
```
RED:     test_chat_input_renders_prompt() — renders ">" prompt character
RED:     test_chat_input_accepts_text() — typing adds to input buffer
RED:     test_chat_input_submits_on_enter() — Enter key calls onSubmit callback
RED:     test_chat_input_clears_after_submit() — input cleared after submission
GREEN:   Implement ChatInput component
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/tui/chat-input.test.tsx
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/tui/chat-input.test.tsx` and confirm exit 0 with 4+ tests passing

---

### T5.2 — Message display

#### Files to edit
```
packages/theocode/src/tui/message-display.tsx (NEW)
packages/theocode/tests/tui/message-display.test.tsx (NEW)
```

#### TDD
```
RED:     test_displays_user_message() — user message rendered with "You:" prefix
RED:     test_displays_assistant_message() — assistant rendered with "Assistant:" prefix
RED:     test_displays_system_message() — system rendered with "[system]" prefix
RED:     test_displays_tool_result() — tool result rendered with tool name
GREEN:   Implement MessageDisplay component
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/tui/message-display.test.tsx
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/tui/message-display.test.tsx` and confirm exit 0 with 4+ tests passing

---

### T5.3 — Tool execution display

#### Files to edit
```
packages/theocode/src/tui/tool-display.tsx (NEW)
packages/theocode/tests/tui/tool-display.test.tsx (NEW)
```

#### TDD
```
RED:     test_tool_display_shows_tool_name() — renders tool name
RED:     test_tool_display_shows_output() — renders truncated output
RED:     test_tool_display_shows_status() — shows pending/completed/error status
GREEN:   Implement ToolDisplay component
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/tui/tool-display.test.tsx
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/tui/tool-display.test.tsx` and confirm exit 0 with 3+ tests passing

---

## Phase 5b: Selectors + Status Bar

### T5.4 — Session selector

#### Files to edit
```
packages/theocode/src/tui/session-selector.tsx (NEW)
packages/theocode/tests/tui/session-selector.test.tsx (NEW)
```

#### TDD
```
RED:     test_session_selector_lists_sessions() — renders session titles
RED:     test_session_selector_highlights_active() — active session marked
RED:     test_session_selector_creates_new() — "New Session" option
RED:     test_session_selector_calls_onSelect() — selecting calls callback
GREEN:   Implement SessionSelector component
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/tui/session-selector.test.tsx
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/tui/session-selector.test.tsx` and confirm exit 0 with 4+ tests passing

---

### T5.5 — Model selector

#### Files to edit
```
packages/theocode/src/tui/model-selector.tsx (NEW)
packages/theocode/tests/tui/model-selector.test.tsx (NEW)
```

#### TDD
```
RED:     test_model_selector_lists_models() — renders model IDs
RED:     test_model_selector_highlights_active() — active model marked
RED:     test_model_selector_calls_onSelect() — selecting calls callback
GREEN:   Implement ModelSelector component
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/tui/model-selector.test.tsx
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/tui/model-selector.test.tsx` and confirm exit 0 with 3+ tests passing

---

### T5.6 — Status bar

#### Files to edit
```
packages/theocode/src/tui/status-bar.tsx (NEW)
packages/theocode/tests/tui/status-bar.test.tsx (NEW)
```

#### TDD
```
RED:     test_status_bar_shows_model() — renders current model name
RED:     test_status_bar_shows_session() — renders session title
RED:     test_status_bar_shows_tokens() — renders token count
GREEN:   Implement StatusBar component
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/tui/status-bar.test.tsx
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/tui/status-bar.test.tsx` and confirm exit 0 with 3+ tests passing

---

## Phase 5c: Keymap + Theme + CLI

### T5.7 — Keymap system

#### Files to edit
```
packages/theocode/src/tui/keymap.ts (NEW)
packages/theocode/tests/tui/keymap.test.ts (NEW)
```

#### TDD
```
RED:     test_default_keymap_has_exit() — Ctrl+C → "exit" action
RED:     test_default_keymap_has_new_session() — Ctrl+N → "newSession"
RED:     test_keymap_resolves_action() — resolveKeymap("ctrl+c") → "exit"
RED:     test_keymap_unknown_key_returns_null() — resolveKeymap("f12") → null
GREEN:   Implement Keymap
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/tui/keymap.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/tui/keymap.test.ts` and confirm exit 0 with 4+ tests passing

---

### T5.8 — Theme system

#### Files to edit
```
packages/theocode/src/tui/theme.ts (NEW)
packages/theocode/tests/tui/theme.test.ts (NEW)
```

#### TDD
```
RED:     test_default_theme_has_colors() — theme.primary, theme.error, theme.muted defined
RED:     test_dark_theme_exists() — darkTheme is non-empty
RED:     test_theme_colors_are_strings() — all color values are hex or named strings
GREEN:   Implement Theme
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/tui/theme.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/tui/theme.test.ts` and confirm exit 0 with 3+ tests passing

---

### T5.9 — CLI entry point

#### Files to edit
```
packages/theocode/src/cli.ts (NEW)
packages/theocode/src/tui/index.tsx (NEW)
packages/theocode/tests/tui/cli.test.ts (NEW)
```

#### TDD
```
RED:     test_cli_exports_main_function() — main() is a function
RED:     test_cli_parses_model_flag() — --model openai/gpt-4o parsed
GREEN:   Implement CLI entry point
VERIFY:  pnpm --filter @theokit/theocode exec vitest run tests/tui/cli.test.ts
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run tests/tui/cli.test.ts` and confirm exit 0 with 2+ tests passing

---

## Phase 5d: Integration Validation (MANDATORY)

### Execution

```bash
pnpm --filter @theokit/theocode exec vitest run
pnpm --filter @theokit/theocode exec tsc --noEmit
pnpm -w run check
```

### Acceptance Criteria

- [ ] Run `pnpm --filter @theokit/theocode exec vitest run` and confirm exit 0 with 182+ total tests (152 Phase 1-4 + 30+ Phase 5)
- [ ] Run `pnpm --filter @theokit/theocode exec tsc --noEmit` and confirm exit 0
- [ ] Run `pnpm -w run check` and confirm zero lint errors
- [ ] Verify CHANGELOG updated

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Chat input (multiline, submit) | T5.1 | `ChatInput` React component via Ink |
| 2 | Message display (roles, streaming) | T5.2 | `MessageDisplay` with role prefixes |
| 3 | Tool execution display | T5.3 | `ToolDisplay` with status + truncation |
| 4 | Session selector (list/switch/create) | T5.4 | `SessionSelector` component |
| 5 | Model selector | T5.5 | `ModelSelector` component |
| 6 | Status bar (tokens, model, session) | T5.6 | `StatusBar` component |
| 7 | Keymap system (customizable shortcuts) | T5.7 | `Keymap` data structure + resolver (ADR D2) |
| 8 | Theme system (colors) | T5.8 | `Theme` with dark/light presets |
| 9 | CLI entry point | T5.9 | `cli.ts` + `tui/index.tsx` |
| 10 | 30+ new tests | T5.1-T5.9 | 4+4+3+4+3+3+4+3+2 = 30 minimum |
| 11 | TheoCode roadmap Phase 5 complete | T5.1-T5.9 | 100% OpenCode parity |

**Coverage: 11/11 gaps covered (100%)**

## Global Definition of Done

- [ ] Verify all phases completed
- [ ] Run `pnpm --filter @theokit/theocode exec vitest run` and confirm 182+ total tests passing
- [ ] Run `pnpm --filter @theokit/theocode exec tsc --noEmit` and confirm zero type errors
- [ ] Run `pnpm -w run check` and confirm zero lint warnings
- [ ] Verify file-size budget respected (all files ≤ 500 LoC)
- [ ] Verify CHANGELOG.md updated under `[Unreleased]`
- [ ] Verify `theocode` CLI launches the TUI
- [ ] Confirm TheoCode roadmap marked 5/5 phases complete

## Final Phase: Integration Validation (MANDATORY)

### Execution

```bash
pnpm --filter @theokit/theocode exec vitest run
pnpm --filter @theokit/theocode exec tsc --noEmit
pnpm -w run check
```

### Acceptance Criteria

- [ ] Run `pnpm --filter @theokit/theocode exec vitest run` and confirm exit 0 with 182+ tests
- [ ] Run `pnpm --filter @theokit/theocode exec tsc --noEmit` and confirm exit 0
- [ ] Run `pnpm -w run check` and confirm exit 0
