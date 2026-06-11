---
slug: opencode-clone-theokit
version: "2.1"
owner: paulohenriquevn
created: 2026-06-11
---

# Discovery Plan: Clone OpenCode Using TheoKit SDK — Full Feature Parity

## Context

**Objective: Build "TheoCode" — a production-grade coding agent that replicates 100% of OpenCode's functionality using ONLY `@theokit/sdk` as the foundation.** This is the ultimate dogfood: if our SDK can power a system as complex as OpenCode (24 packages, 20 tools, 12 LLM providers, TUI, session management, ACP), the SDK is production-proven.

A feature audit on 2026-06-11 identified **48 OpenCode features** across 8 subsystems. TheoKit covers 27% fully + 25% partially = 52%. This discovery investigates the **23 missing features** (48%) plus the 12 partial ones to produce a complete implementation blueprint.

**Why this matters:** Cross-validations scored TheoKit at 3.92/5 (DeepAgents) and 3.93/5 (CrewAI). Building a real app ON the SDK is the proof that the score translates to reality. "Framework benchmarks pass" is not evidence; "we built a full coding agent on it" IS evidence.

## Objective

> Produce a technical blueprint mapping ALL 48 OpenCode subsystems to TheoKit SDK equivalents, identifying every gap that requires new code, and delivering a phased implementation plan for "TheoCode" — a coding agent built entirely on `@theokit/sdk`.

**Success criteria:** Blueprint answers all 10 research questions with `file:line` citations, produces a 48-row feature parity matrix, and delivers a task-by-task plan for TheoCode covering tools, session, LLM, config, CLI, and TUI.

## In-scope / Out-of-scope

### Reference: `knowledge-base/reference/opencode/`

| In-scope (investigate deeply) | Out-of-scope |
|-------------------------------|-------------|
| `packages/opencode/src/agent/` — agent loop, subagent permissions, prompt profiles | `packages/desktop/` — Electron app |
| `packages/opencode/src/tool/` — ALL 20 tools | `packages/storybook/` — UI component library |
| `packages/opencode/src/session/` — session management, compaction, retry, revert, reminders | `packages/stats/` — analytics |
| `packages/llm/src/` — providers, protocols, routing, cache policy | `packages/enterprise/` — enterprise features |
| `packages/opencode/src/config/` — agent profiles, plugins, variables | `packages/web/` — web UI |
| `packages/opencode/src/git/` — git integration | `infra/` — deployment |
| `packages/opencode/src/image/` — vision/image handling | `packages/containers/` — Docker packaging |
| `packages/opencode/src/bus/` — event bus | |
| `packages/opencode/src/format/` — output formatting | |
| `packages/opencode/src/acp/` — Agent Communication Protocol (12 files) | |
| `packages/opencode/src/cli/` — CLI bootstrap, commands, TUI bridge | |
| `packages/opencode/src/control-plane/` — workspace management | |
| `packages/opencode/src/account/` — account/repo management | |
| `packages/opencode/src/background/` — background jobs | |
| `packages/opencode/src/auth/` — authentication | |
| `packages/opencode/src/ide/` — IDE integration | |
| `packages/tui/src/` — TUI architecture (React/Ink) | |
| `packages/plugin/src/` — plugin SDK | |
| `packages/core/src/` — core runtime | |
| `packages/effect-drizzle-sqlite/` — persistence layer | |

**Time budget:** OpenCode 6h, TheoKit SDK 2h.

## ADRs

### A1 — Investigate ALL 8 subsystems, not just 5

**Decision:** Expand from the v1.0 plan's 5 subsystems to all 8 (agent, tools, session, LLM, config, infra, CLI/TUI, ACP). The user wants 100% parity.

**Alternative rejected:** Focus on top 10 gaps only — rejected because partial investigation produces partial blueprint, and the user explicitly said "TUDO que o OpenCode faz".

### A2 — Blueprint delivers a 48-row parity matrix + phased implementation plan

**Decision:** The blueprint output is (a) a complete parity matrix (48 features × status), (b) a phased implementation plan grouped by dependency, (c) new SDK features needed as enablers.

**Alternative rejected:** Just a research report — rejected because the user wants to BUILD, not just understand.

### A3 — Effect-TS patterns noted but not adopted

**Decision:** OpenCode uses Effect-TS heavily (generators, pipes, layers). TheoCode will use plain async/await TypeScript. The blueprint maps Effect patterns to vanilla TS equivalents.

**Alternative rejected:** Adopt Effect-TS — rejected per KISS and existing SDK patterns.

### A4 — Effect-TS interpretation risk documented (EC-3)

**Decision:** OpenCode's `agent.ts`, `session.ts`, and tool files use `Effect.gen` generators instead of async/await. The discovery executor must understand Effect patterns to trace control flow. This is an interpretation challenge, not a correctness issue — the core logic (tool dispatch, retry, streaming) is identical regardless of effect system. Blueprint maps each Effect pattern to its async/await equivalent.

## Research Questions

### Corner 1: Techniques (Agent Loop + Session + Tools)

**Q1:** How does OpenCode's agent loop (`tool/agent.ts`) handle the full cycle: prompt assembly → LLM call → tool dispatch → retry → streaming → subagent delegation?
- **Method:** Read `packages/opencode/src/agent/agent.ts` (full file). Trace: system prompt assembly → provider call → tool result processing → loop iteration.
- **Sources:** `knowledge-base/reference/opencode/packages/opencode/src/agent/agent.ts`
- **Expected answer:** State diagram of agent loop + mapping to TheoKit's `Agent.create` → `agent.send` → internal tool dispatch.

**Q2:** How do ALL 20 tools work? For each tool: input schema, security hardening, output truncation, and what TheoKit equivalent exists (or needs to be built).
- **Method:** Read each file in `packages/opencode/src/tool/` (20 files). For each: extract input schema, security guards, output format. Cross-reference with TheoKit's `sdk-tools` (5 tools) + `sandbox` + missing ones.
- **Sources:** `knowledge-base/reference/opencode/packages/opencode/src/tool/read.ts`, `tool/write.ts`, `tool/edit.ts`, `tool/glob.ts`, `tool/grep.ts`, `tool/shell.ts`, `tool/webfetch.ts`, `tool/websearch.ts`, `tool/task.ts`, `tool/question.ts`, `tool/todo.ts`, `tool/plan.ts`, `tool/skill.ts`, `tool/lsp.ts`, `tool/apply_patch.ts`, `tool/mcp-websearch.ts`
- **Expected answer:** 20-row tool matrix (tool × schema × security × TheoKit equivalent).

**Q3:** How does OpenCode manage session lifecycle: creation, persistence, compaction, retry, revert, overflow, reminders, and summary/title generation?
- **Method:** Read `packages/opencode/src/session/session.ts`, `compaction.ts`, `retry.ts`, `revert.ts`, `overflow.ts`, `reminders.ts`, `summary.ts`, `run-state.ts`.
- **Sources:** `knowledge-base/reference/opencode/packages/opencode/src/session/session.ts`, `knowledge-base/reference/opencode/packages/opencode/src/session/compaction.ts`
- **Expected answer:** Session lifecycle diagram + mapping to TheoKit's `autoSummarize`, `compositeScore`, `MemoryScope`, and missing features (retry, revert, overflow).

### Corner 2: Dependencies

**Q4:** What does OpenCode's persistence layer look like? Drizzle + SQLite + Effect integration. How does it compare to TheoKit's `better-sqlite3` + `sqlite-vec`?
- **Method:** Read `packages/effect-drizzle-sqlite/` structure + `packages/opencode/src/session/schema.ts`.
- **Sources:** `knowledge-base/reference/opencode/packages/effect-drizzle-sqlite/`, `knowledge-base/reference/opencode/packages/opencode/src/session/schema.ts`
- **Expected answer:** Schema comparison (OpenCode Drizzle vs TheoKit raw SQLite) + migration strategy.

**Q5:** What are ALL runtime dependencies for the LLM package? Provider SDKs, protocol adapters, cache layer. Map to TheoKit's provider catalog.
- **Method:** Read `packages/llm/package.json` + each file in `providers/` and `protocols/`.
- **Sources:** `knowledge-base/reference/opencode/packages/llm/package.json`, `knowledge-base/reference/opencode/packages/llm/src/providers/`
- **Expected answer:** Provider × protocol × cache matrix. Coverage gap analysis vs TheoKit's 43 providers.

### Corner 3: Tools (Infrastructure)

**Q6:** How does OpenCode's prompt profile system work? 14 model-specific prompt files in `session/prompt/`, 4 utility prompts in `agent/prompt/`, per-model tuning, plan mode, beast mode.
- **Method:** Read `packages/opencode/src/session/prompt/*.txt` (14 model-specific profiles: default, anthropic, gpt, gemini, beast, codex, copilot-gpt-5, kimi, trinity, plan, plan-mode, plan-reminder-anthropic, max-steps, build-switch). Read `packages/opencode/src/agent/prompt/*.txt` (4 utility prompts: compaction, explore, summary, title).
- **Sources:** `knowledge-base/reference/opencode/packages/opencode/src/session/prompt/default.txt`, `knowledge-base/reference/opencode/packages/opencode/src/session/prompt/anthropic.txt` (EC-1 fix: paths corrected from `agent/prompt/` to `session/prompt/`)
- **Expected answer:** Prompt profile architecture (which profile per model, how selected) + how TheoCode can implement via TheoKit's `systemPrompt` resolver.

**Q7:** How does OpenCode's ACP (Agent Communication Protocol) work? 12 files covering agent, session, tool, permission, event, profile, directory, config, content, error, usage, service.
- **Method:** Read `packages/opencode/src/acp/*.ts` (12 files) + `packages/plugin/src/`.
- **Sources:** `knowledge-base/reference/opencode/packages/opencode/src/acp/agent.ts`, `knowledge-base/reference/opencode/packages/opencode/src/acp/service.ts`
- **Expected answer:** ACP architecture diagram + mapping to TheoKit's `@theokit/acp` package.

### Corner 4: Integration Tests

**Q8:** How does OpenCode test the agent loop and tools end-to-end? What fixture/mock strategy exists?
- **Method:** `find packages/opencode -name "*.test.ts"` + read representative test files.
- **Sources:** `knowledge-base/reference/opencode/packages/opencode/src/` (test files)
- **Expected answer:** Test architecture + fixture patterns for TheoCode.

**Q9:** How does OpenCode's TUI work? React/Ink architecture, component catalog, keymap system. What's the minimum viable TUI for TheoCode?
- **Method:** Read `packages/tui/src/app.tsx`, `packages/tui/src/component/` (20+ components), `packages/tui/src/keymap.tsx`.
- **Sources:** `knowledge-base/reference/opencode/packages/tui/src/app.tsx`, `knowledge-base/reference/opencode/packages/tui/src/keymap.tsx`
- **Expected answer:** TUI architecture diagram + minimum viable component list for TheoCode MVP.

**Q10:** How do OpenCode's infrastructure systems work? Event bus, background jobs, control plane, workspace management, git/IDE integration.
- **Method:** Read `bus/global.ts`, `background/job.ts`, `control-plane/workspace.ts`, `git/index.ts`, `ide/index.ts`, `image/image.ts`, `format/formatter.ts`.
- **Sources:** `knowledge-base/reference/opencode/packages/opencode/src/bus/global.ts`, `knowledge-base/reference/opencode/packages/opencode/src/control-plane/workspace.ts`
- **Expected answer:** Infrastructure integration map + TheoKit equivalents.

## Coverage Matrix

| # | Question | Corner | Method | Source verified |
|---|----------|--------|--------|----------------|
| Q1 | Agent loop full cycle | Techniques | Read agent.ts + trace flow | YES |
| Q2 | All 20 tools deep dive | Techniques | Read each tool/*.ts | YES — `tool/` dir verified |
| Q3 | Session lifecycle complete | Techniques | Read session/*.ts (8 files) | YES |
| Q4 | Persistence layer (Drizzle+SQLite) | Dependencies | Read effect-drizzle-sqlite + schema.ts | YES |
| Q5 | LLM providers + protocols | Dependencies | Read llm/package.json + providers/ | YES |
| Q6 | Prompt profile system (18 profiles) | Tools | Read agent/prompt/*.txt + session/prompt/*.txt | YES |
| Q7 | ACP architecture (12 files) | Tools | Read acp/*.ts + plugin/src/ | YES |
| Q8 | Test architecture + fixtures | Tests | find *.test.ts + read samples | YES |
| Q9 | TUI architecture (React/Ink) | Tests | Read tui/src/app.tsx + components | YES |
| Q10 | Infra (bus, jobs, control-plane, git, IDE) | Tests | Read bus/ + background/ + control-plane/ | YES |

**Coverage: 10/10 questions mapped (100%)**
**Corners: Techniques 3, Dependencies 2, Tools 2, Tests 3 — all ≥1**

## Halt-loop Checkpoints (for /discover-execute)

| Checkpoint | Condition |
|---|---|
| Q1 done | Agent loop state diagram + TheoKit mapping documented |
| Q2a done | First 7 tools (read, write, edit, glob, grep, shell, apply_patch) matrix rows complete (EC-2 sub-checkpoint) |
| Q2b done | Next 6 tools (webfetch, websearch, task, question, todo, plan) matrix rows complete (EC-2 sub-checkpoint) |
| Q2c done | Last 7 tools (skill, lsp, mcp-websearch, truncate, truncation-dir, external-directory, invalid) matrix rows complete (EC-2 sub-checkpoint) |
| Q3 done | Session lifecycle diagram + gap list |
| Q4+Q5 done | Persistence + LLM dependency comparison |
| Q6+Q7 done | Prompt profiles + ACP architecture mapped |
| Q8+Q9+Q10 done | Test strategy + TUI MVP + infra integration mapped |
| Blueprint complete | 48-row parity matrix + phased TheoCode implementation plan |

## Acceptance Criteria

- [ ] 48-row feature parity matrix: Feature × OpenCode file × TheoKit equivalent × Status (SIM/PARCIAL/NAO) × Implementation effort
- [ ] Every "NAO" feature has a concrete implementation task in the TheoCode plan
- [ ] Every "PARCIAL" feature has a gap description + fix task
- [ ] Phased implementation plan: Phase 1 (critical tools), Phase 2 (session), Phase 3 (LLM+config), Phase 4 (infra), Phase 5 (TUI)
- [ ] All citations verified against `knowledge-base/reference/opencode/`
- [ ] Blueprint identifies new SDK features needed (if any) vs features buildable with existing SDK primitives
- [ ] No fabricated citations

## Global Definition of Done

- [ ] Blueprint saved at `knowledge-base/discoveries/blueprints/opencode-clone-theokit-blueprint.md`
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] All 4 corners covered
- [ ] 48-row parity matrix included
- [ ] Phased implementation plan included
