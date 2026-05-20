# Edge Case Review — chat-assistant-readiness

Data: 2026-05-16
Tasks analisadas: 5 (T0.1, T1.1, T2.1, T3.1, T4.1)
Edge cases encontrados: 11 (MUST FIX: 3, SHOULD TEST: 6, DOCUMENT: 2)
**Status:** ✅ Todos os 11 incorporados ao plano em 2026-05-16.
**Implementação:** ✅ Todos os 11 implementados + dogfood end-to-end PASS (10/10) em 2026-05-16 com real LLM.

## Implementação Confirmada

- **EC-1** (`agent_id_already_exists`): `tests/golden/runtime/agent-registry-persistence.golden.test.ts` — `create-throws-when-id-exists`.
- **EC-2** (compaction race): `tests/golden/runtime/agent-session-persistence.golden.test.ts` — `compaction-during-append-no-loss`. Resolved via per-`(agentId, cwd)` promise queue.
- **EC-3** (sync after run.wait): `tests/golden/memory/sessions-corpus.golden.test.ts` — `session-searchable-after-run-wait`.
- **EC-4** (corrupt registry.json): same — `recovers-from-corrupt-json`.
- **EC-5** (per-cwd isolation): same — `registry-isolated-per-cwd`.
- **EC-6** (newlines in text): session-persistence — `persists-text-with-newlines`.
- **EC-7** (half-written line): session-persistence — `skips-partial-last-line`.
- **EC-8** (subagent no-deadlock): `tests/golden/agent/concurrent-send.golden.test.ts` — `subagent-send-no-deadlock`.
- **EC-9** (no summary on cancel/error): sessions-corpus — `no-summary-on-cancelled-run` + `no-summary-on-errored-run`.
- **EC-10** (cross-process race): documented in `examples/telegram-bot/README.md` ("Stability — important callout") + ADR D17 Consequences.
- **EC-11** (Telegram group chats): documented in `examples/telegram-bot/README.md` ("Group chats — important callout") + implemented in `resolveUserId(ctx)`.

## Bonus Fixes (Phase 5 dogfood)

- **Coalescing snapshot bug**: registry's save coalescing dropped second-mutation data when two sync registers fired in the same tick. Fixed via `dirtyCwds` Set + re-loop. Documented in CHANGELOG `## [Unreleased] > Fixed`.
- **Multi-writer `.tmp` race**: `replaceFileAtomic` used a shared `${filePath}.tmp` path. Two parallel test workers raced on rename. Fixed via per-call unique `${pid}.${rand}.tmp` suffix. Benefits cron + memory writers too.

## MUST FIX

### EC-1: `Agent.create({ agentId })` quando id já existe — comportamento indefinido
- **Task afetada:** T0.1
- **Família:** State / Idempotency
- **Cenário:** Bot autor escreve `Agent.create({ agentId: "tg-${chatId}" })` sem try/catch resume-first. Restart → cria com mesmo id → plano não definia se sobrescreve, throw, ou vira resume automático.
- **Impacto:** Conversa apagada silenciosamente em produção quando o autor esquecer o resume-first pattern.
- **Fix aplicado:** T0.1 Deep Dives ganhou bloco "Create-with-existing-id (EC-1 fix)" — throws `ConfigurationError(code: "agent_id_already_exists")`. TDD ganhou `create-throws-when-id-exists`.

### EC-2: Compaction race com appendSessionMessage no mesmo processo
- **Task afetada:** T1.1
- **Família:** Timing / State
- **Cenário:** Compaction faz read→rename; um append entre o read e o rename é perdido.
- **Impacto:** Perda silenciosa de turn da conversa.
- **Fix aplicado:** T1.1 Deep Dives ganhou requisito explícito: compaction deve adquirir `withCwdMutex("agent-send:" + agentId)`. Code snippet incluído. TDD ganhou `compaction-during-append-no-loss`.

### EC-3: `IndexManager.sync()` timing após `writeSessionSummary` ambíguo
- **Task afetada:** T3.1
- **Família:** Timing / Integration
- **Cenário:** Post-run hook escreve session summary; memory_search só vê após sync; plano não especificava trigger.
- **Impacto:** `/recall` no example pode retornar zero hits porque sync ainda não rodou.
- **Fix aplicado:** T3.1 Deep Dives ganhou "Sync timing (EC-3 fix)" — `writeSessionSummary` triggera `IndexManager.sync()` em background fire-and-forget. Code snippet incluído. TDD ganhou `session-searchable-after-run-wait`.

## SHOULD TEST

### EC-4: Registry.json corrompido (crash mid-write)
- **Task afetada:** T0.1
- **Fix aplicado:** TDD ganhou `recovers-from-corrupt-json` — invalid bytes → loadRegistry returns `{}` + stderr warning + next save sobrescreve com JSON válido.

### EC-5: Per-cwd registry isolation
- **Task afetada:** T0.1
- **Fix aplicado:** TDD ganhou `registry-isolated-per-cwd` — dois cwds → dois registry.json separados; resume from wrong cwd throws `unknown_agent`.

### EC-6: Message text com newlines/aspas/control chars
- **Task afetada:** T1.1
- **Fix aplicado:** TDD ganhou `persists-text-with-newlines` — round-trip JSON-escape de `text: "line1\nline2\t\"quoted\""`.

### EC-7: Half-written last line em messages.jsonl
- **Task afetada:** T1.1
- **Fix aplicado:** TDD ganhou `skips-partial-last-line` — 3 linhas completas + truncate to half; reader retorna 3 + warning, no throw.

### EC-8: Subagent send dentro do parent send não deadlocks
- **Task afetada:** T2.1
- **Fix aplicado:** TDD ganhou `subagent-send-no-deadlock` — agentIds distintos → mutexes distintos → ambos completam.

### EC-9: Cancelled/errored runs NÃO escrevem session summary
- **Task afetada:** T3.1
- **Fix aplicado:** T3.1 Deep Dives ganhou "Status filter (EC-9 fix)" — apenas `status:"finished"` triggera write. TDD ganhou `no-summary-on-cancelled-run` + `no-summary-on-errored-run`.

## DOCUMENT

### EC-10: Cross-process registry/JSONL write race
- **Risco aceito:** Plan documenta como "one SDK process per cwd". Cross-process locks são v1.x work.
- **Doc aplicado:** T0.1 Deep Dives ganhou bloco "Cross-process write race (EC-10 doc)". T4.1 README do telegram-bot terá warning callout explícito sobre não co-localizar bot + cron worker no mesmo workspace.

### EC-11: Telegram group chats — chatId é id do grupo, não do user
- **Risco aceito:** Tutorial example, não framework. Fix é uma linha de código documentada.
- **Doc aplicado:** T4.1 Deep Dives ganhou bloco "EC-11 doc — Telegram group chats" com snippet de código `ctx.chat.type === "private" ? ctx.chat.id : ctx.from?.id`.

## Resumo

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT | Status |
|------|-------|----------|-------------|----------|--------|
| T0.1 | 4 | 1 (EC-1) | 2 (EC-4, EC-5) | 1 (EC-10) | ✅ Aplicado |
| T1.1 | 3 | 1 (EC-2) | 2 (EC-6, EC-7) | 0 | ✅ Aplicado |
| T2.1 | 1 | 0 | 1 (EC-8) | 0 | ✅ Aplicado |
| T3.1 | 2 | 1 (EC-3) | 1 (EC-9) | 0 | ✅ Aplicado |
| T4.1 | 1 | 0 | 0 | 1 (EC-11) | ✅ Aplicado |
| Phase 5 | 0 | 0 | 0 | 0 | — |

**Veredicto final: PLANO PRONTO** — todos os 11 edge cases incorporados ao plano `chat-assistant-readiness-plan.md`. Coverage matrix expandida de 9 → 20 itens (100%). Próximo passo: implementação.
