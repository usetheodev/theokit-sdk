# TheoCode Roadmap — OpenCode Clone on TheoKit SDK

> Ancora central para os 5 planos de implementacao do TheoCode.
> Cada fase e um plano independente com seu proprio `/to-plan` → `/edge-case-plan` → `/plan-confidence` → `/implement` cycle.

## Objetivo

Construir **TheoCode** — um coding agent production-grade que replica 100% das funcionalidades do OpenCode usando APENAS `@theokit/sdk` como fundacao. Prova definitiva que o SDK sustenta sistemas complexos reais.

**Blueprint:** `knowledge-base/discoveries/blueprints/opencode-clone-theokit-blueprint.md`
**Referencia:** `knowledge-base/reference/opencode/` (24 packages, 20 tools, 12 LLM providers)

## Parity Score Atual

| Status | Count | % |
|--------|-------|---|
| SIM (ja tem) | 12 | 25% |
| PARTIAL | 8 | 17% |
| NEW (precisa) | 28 | 58% |

**Meta: 48/48 (100%)**

## Fases

### Phase 1: Core Tools — `theocode-phase1-tools`
- [ ] `createWriteFileTool` — criar/sobrescrever arquivo com security guards
- [ ] `createEditFileTool` — edicao parcial com fuzzy matching (9 replacers do OpenCode)
- [ ] `createGlobTool` — buscar arquivos por padrao (glob patterns)
- [ ] `createShellTool` — executar comando via `LocalSandbox` como tool registrado
- [ ] `createApplyPatchTool` — aplicar patches unified diff
- [ ] `createWebFetchTool` — buscar URL com timeout + size cap
- [ ] `createWebSearchTool` — busca web via provider (Exa/Tavily)
- **Esforco:** 1 semana | **Testes:** 40+ | **Dependencia:** nenhuma
- **Plano:** `knowledge-base/plans/theocode-phase1-tools-plan.md`

### Phase 2: Session Persistence — `theocode-phase2-session`
- [ ] Session CRUD (create, load, list, delete, fork) via SQLite
- [ ] Message persistence (V2 schema com roles, tool calls, metadata)
- [ ] Context compaction (summarize + prune ao exceder budget)
- [ ] Retry com exponential backoff + header-aware (Retry-After)
- [ ] Session revert (git snapshot + undo)
- [ ] Overflow detection + handling
- [ ] Summary/title generation automatica
- [ ] Run state machine (idle → busy → paused → error)
- [ ] Reminders system
- **Esforco:** 2 semanas | **Testes:** 50+ | **Dependencia:** Phase 1 (tools usam sessions)
- **Plano:** `knowledge-base/plans/theocode-phase2-session-plan.md`

### Phase 3: Prompt Profiles + Advanced Tools — `theocode-phase3-profiles`
- [ ] 14 model-specific prompt profiles (default, anthropic, gpt, gemini, beast, codex, etc.)
- [ ] Profile selector (por model ID → prompt template)
- [ ] `createQuestionTool` — perguntar ao usuario (TUI interaction)
- [ ] Plan mode (enter/exit com agent profile switching)
- [ ] `createSkillTool` — carregar skills de `.theocode/skills/`
- [ ] Output truncation system robusto (managed tool output files)
- [ ] Invalid tool handler (tool-call repair)
- **Esforco:** 1 semana | **Testes:** 35+ | **Dependencia:** Phase 2 (profiles integram com session)
- **Plano:** `knowledge-base/plans/theocode-phase3-profiles-plan.md`

### Phase 4: Infrastructure — `theocode-phase4-infra`
- [ ] Event bus (typed EventEmitter com subscribe/publish)
- [ ] Background job queue (async tasks com status tracking)
- [ ] Git integration (diff, status, commit, branch — via simple-git)
- [ ] IDE integration (VS Code protocol bridge)
- [ ] Permission system (per-tool allow/deny/ask)
- [ ] External directory security guard
- [ ] Image/vision handling (file attachments para multimodal)
- [ ] Output formatter (markdown/code/diff rendering)
- [ ] ACP server integration (connect `@theokit/acp`)
- **Esforco:** 2 semanas | **Testes:** 45+ | **Dependencia:** Phase 1+2
- **Plano:** `knowledge-base/plans/theocode-phase4-infra-plan.md`

### Phase 5: TUI — `theocode-phase5-tui`
- [ ] TUI framework (React/Ink ou SolidJS/OpenTUI)
- [ ] Chat input component (multiline, history, autocomplete)
- [ ] Message display (streaming, markdown, code blocks)
- [ ] Tool execution display (progress, output, truncation)
- [ ] Session selector (list, switch, create, delete)
- [ ] Model/provider selector
- [ ] Keymap system (vim-like, customizable)
- [ ] Theme system
- [ ] Status bar (token count, cost, model, session)
- [ ] MCP/skill dialogs
- **Esforco:** 2 semanas | **Testes:** 30+ | **Dependencia:** Phase 1-4
- **Plano:** `knowledge-base/plans/theocode-phase5-tui-plan.md`

## Dependency Graph

```
Phase 1 (Core Tools) ──▶ Phase 2 (Session) ──▶ Phase 3 (Profiles)
                                                      │
                                                      ▼
Phase 4 (Infra) ◀── Phase 1+2 ──────────────▶ Phase 5 (TUI) ◀── Phase 1-4
```

Phase 1 e a fundacao. Phases 2-4 dependem de Phase 1. Phase 5 depende de tudo.

## Timeline

| Semana | Fase | Entrega |
|--------|------|---------|
| S1 | Phase 1 | 7 core tools (write, edit, glob, shell, patch, webfetch, websearch) |
| S2-S3 | Phase 2 | Session CRUD + compaction + retry/revert + summary |
| S4 | Phase 3 | 14 prompt profiles + question/plan/skill tools + truncation |
| S5-S6 | Phase 4 | Event bus + jobs + git + IDE + permissions + ACP |
| S7-S8 | Phase 5 | TUI MVP (chat + sessions + model selector + keymap) |

**Total: 8 semanas, ~200 testes, 48/48 features = 100% parity**

## Metricas de Sucesso

- [ ] `pnpm typecheck` exit 0 apos cada fase
- [ ] `pnpm test` exit 0 com 200+ novos testes
- [ ] Demo E2E com OpenRouter: TheoCode resolve uma task de coding real
- [ ] Cross-validation re-run: score ≥ 4.5/5.0 (atual: 3.93)
- [ ] Zero `as any` em production source
- [ ] Todos os 15+ decorators agenticos aplicaveis usados

## Novo SDK Features Necessarios

Per blueprint Q1-Q10 analysis: **nenhum novo SDK primitive necessario.** Todos os 28 features NEW sao construiveis com:
- `Agent.create()` + `agent.send()` — agent loop
- `defineTool()` + `@Tool` — tool registration
- `@theokit/sdk-tools` factories — file/search tools
- `@theokit/sdk/sandbox` — shell execution
- `@theokit/sdk-memory` — session storage
- `autoSummarize()` + `compositeScore()` — compaction + scoring
- `HitlMiddleware` — permission/approval
- `defineSubAgent()` — task delegation
- Provider catalog (43 providers) — LLM routing

O SDK ja tem a fundacao. TheoCode e pura **application-level code**.
