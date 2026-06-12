---
slug: theocode-claude-config
date: 2026-06-12
questions_asked: 8
decisions_resolved: 8
verdict: READY_FOR_PLAN
---

# Grill: TheoKit SDK — .claude/ Template for Consumers

## Decision tree resolved

1. **Target** — `.claude/` template distributed to consumers of `@theokit/sdk` (not for SDK contributors). Devs who `npm install @theokit/sdk` and want Claude Code as a specialized TheoKit copilot.

2. **Distribution mechanism** — (A) CLI scaffold (`npx @theokit/sdk init-claude`) + (C) docs bundled in `node_modules/@theokit/sdk/docs/ai/`. The scaffold generates a minimal `.claude/` that references version-matched docs from the installed SDK.

3. **Domain coverage** — All 15 SDK domains get dedicated documentation skills:
   - Agent Core (Agent.create, send, Run.stream, SDKMessage)
   - Tools (defineTool, @Tool, schemas)
   - Memory (Memory.*, embeddings, dreaming, active recall)
   - DI Container (@Injectable, @Inject, Container, scopes)
   - DI-Agent Decorators (@Tool, @Workflow, @Cron, @Auth, etc.)
   - Gateways (Telegram, Slack, Discord, WhatsApp, etc.)
   - RAG (Retrievers, rerankers, text splitters)
   - Workflows (Workflow.create, steps, retry)
   - Eval (Eval.create, scorers)
   - Cron/Jobs (Cron.create, scheduling)
   - Subscriptions (defineSubscription, SSE, WebSocket)
   - Errors (Error hierarchy, handling patterns)
   - Config (.theokit/, env vars, MCP config)
   - Streaming (streamObject, SDKMessage types, async generators)
   - Budget (Cost tracking, token limits)

4. **Skill format** — Passive skills (`user-invocable: false`). Claude auto-invokes via `paths:` frontmatter when working with files in the relevant domain. Silent knowledge injection, no explicit `/command` needed.

5. **Rules** — Include hard convention rules (always active, ~30 lines). Examples: never import from internal paths, always dispose agents, use Zod for tool schemas, correct import paths per sub-path.

6. **CLAUDE.md content** — Substantial (~150 lines). Includes quick API reference, common patterns, build/test commands, and pointers to skills for deep-dive. More self-contained than a minimal pointer file.

7. **AGENTS.md** — Generate both. AGENTS.md is the canonical cross-agent file (read by Codex, Cursor, Copilot, Windsurf, Zed). CLAUDE.md imports it via `@AGENTS.md` and adds Claude-specific sections (skill pointers, settings).

8. **Source location** — Inside `packages/sdk/`. Templates in `packages/sdk/claude-template/`, bundled docs in `packages/sdk/docs/ai/`, CLI bin in package.json `bin` field. Single package = version-matched docs guaranteed.

## Q&A log

### Q1: Skills domain-specific — para contribuidores do TheoCode ou consumidores do SDK?
**Recommended**: Para contribuidores do TheoCode (projeto em M0, sem código de produção).
**User decision**: Para consumidores do SDK. Template distribuído para quem faz `npm install @theokit/sdk`.

### Q2: Como o consumidor recebe o .claude/?
**Recommended**: (A) + (C) combinados — CLI scaffold + docs bundled em node_modules.
**User decision**: Confirmado (A) + (C).

### Q3: Quais domínios do SDK devem ter skills?
**Recommended**: 7 domínios de alta frequência (Agent Core, Tools, Memory, DI, DI-Agent, Gateways, RAG).
**User decision**: TODOS os 15 domínios, sem cortar escopo.

### Q4: Formato dos skills — passivo, explícito, ou ambos?
**Recommended**: (B) Explícito — dev invoca quando precisa.
**User decision**: (A) Passivo — `user-invocable: false`, injetado via `paths:` automaticamente.

### Q5: Incluir rules de convenções?
**Recommended**: Sim — rules sempre ativas com hard rules de código.
**User decision**: Confirmado.

### Q6: CLAUDE.md do template — mínimo ou substancial?
**Recommended**: (A) Mínimo (~30 linhas).
**User decision**: (B) Substancial (~150 linhas) com quick reference + padrões.

### Q7: Gerar AGENTS.md cross-agent?
**Recommended**: Sim, ambos — AGENTS.md canonical + CLAUDE.md com @AGENTS.md.
**User decision**: Confirmado.

### Q8: Onde vivem os source files dentro do monorepo?
**Recommended**: (A) Dentro de packages/sdk/.
**User decision**: Confirmado (A).
