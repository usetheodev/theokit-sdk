# Edge Case Review — cloud-tool-parity

Data: 2026-05-16
Tasks analisadas: 4 (T0.1, T1.1, T2.1, T3.1)
Edge cases encontrados: 9 (MUST FIX: 3, SHOULD TEST: 4, DOCUMENT: 2)
**Status:** ✅ Todos os 9 incorporados ao plano em 2026-05-16.

## MUST FIX

### EC-1: Serializer não tem key-sort explícito; "determinism" é miragem
- **Task afetada:** T1.1
- **Família:** Format
- **Cenário:** `JSON.stringify` preserva insertion order. Dois callers construindo `AgentOptions` em ordens diferentes (`{cloud, model}` vs `{model, cloud}`) produzem JSONs byte-different.
- **Impacto:** PaaS caching baseado em hash do payload fura. "determinism" alegada é falsa sem ordenação explícita.
- **Fix aplicado:** T1.1 Deep Dives ganhou bloco "Determinism (EC-1 fix)" com snippet de `canonicalize()` recursivo. TDD ganhou `serialize-key-order-independent`.

### EC-2: Serializer pode vazar secrets pro PaaS
- **Task afetada:** T1.1
- **Família:** Permission / Security
- **Cenário:** `mcpServers.x.headers.Authorization`, `mcpServers.x.env.TOKEN`, `providers.routes[i].apiKey`, `apiKey` top-level — todos serializados ingenuamente vão pro PaaS.
- **Impacto:** Security gap. Secrets enviados em plaintext pro servidor.
- **Fix aplicado:** T1.1 Deep Dives ganhou tabela explícita "Secrets allow-list per feature" listando os campos permitidos por feature e os explicitamente strippados. TDD ganhou `serialize-strips-secrets` + `serialize-strips-mcp-env`.

### EC-3: MCP stdio whitelist falha pro `npx` (canonical install pattern)
- **Task afetada:** T0.1
- **Família:** Format / Permission
- **Cenário:** Whitelist proposta `[node, deno, bun, python, python3]` rejeita `npx`, `pnpm`, `uvx`, `pipx` — os comandos mais usados para install/run de MCP servers.
- **Impacto:** 80% dos MCP servers reais rejeitados. UX hostil quando user adiciona `cloud:` ao projeto.
- **Fix aplicado:** T0.1 Deep Dives + D16 table — política invertida para **blacklist de paths locais** (`/`, `~/`, `./`, `../`). Bare commands aceitos. TDD ganhou `accept-stdio-mcp-bare-npx`, `accept-stdio-mcp-bare-uvx`, `reject-stdio-mcp-local-path-{absolute,home,relative}`.

## SHOULD TEST

### EC-4: Hooks shape — array de rules (OK) vs function (rejeita)
- **Task afetada:** T0.1
- **Fix aplicado:** TDD ganhou par `accept-hook-rule-array` + `reject-hook-closure`. Plan exigia só rejeição; agora cobre o happy-path declarativo também.

### EC-5: Migração do `local + cloud` error code precisa de grep
- **Task afetada:** T0.1 step 4
- **Fix aplicado:** Tasks step 4 atualizado com instrução explícita "before editing, run `grep -rn` to list every consumer; update them in the same commit; add CHANGELOG BREAKING note".

### EC-6: `agent.reload()` pode não re-ler skills/plugins do FS
- **Task afetada:** T2.1
- **Fix aplicado:** TDD ganhou `reload-repopulates-from-filesystem` exercitando a cadeia completa: write SKILL.md → reload() → asserta `agent.cloudPayload.skills.enabled` reflete o novo skill.

### EC-7: Payload pode crescer descontroladamente
- **Task afetada:** T1.1
- **Fix aplicado:** T1.1 Deep Dives ganhou "Payload size guardrail" com snippet de `Buffer.byteLength` + stderr warning >1 MB. TDD ganhou `serialize-warns-on-large-payload`.

## DOCUMENT

### EC-8: `schemaVersion: "1.0"` locked sem v2 negotiation
- **Risco aceito:** Plan só ship v1.0; v2 PaaS é problema futuro com ADR próprio.
- **Doc aplicado:** T1.1 Deep Dives ganhou nota "schemaVersion note (EC-8)" explicitando que não há negociação e v2 work é ADR separado.

### EC-9: `cloud-with-mcp-http` example URL é placeholder fake
- **Risco aceito:** Em fixture mode SDK não chama; o example mostra o SHAPE, não exercita um MCP real.
- **Doc aplicado:** T3.1 Deep Dives ganhou nota explícita "README MUST include a note (EC-9)" sobre o URL ser placeholder + instrução pro user substituir antes de produção.

## Resumo

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT | Status |
|------|-------|----------|-------------|----------|--------|
| T0.1 | 3 | 1 (EC-3) | 2 (EC-4, EC-5) | 0 | ✅ Aplicado |
| T1.1 | 5 | 2 (EC-1, EC-2) | 1 (EC-7) | 1 (EC-8) | ✅ Aplicado |
| T2.1 | 1 | 0 | 1 (EC-6) | 0 | ✅ Aplicado |
| T3.1 | 1 | 0 | 0 | 1 (EC-9) | ✅ Aplicado |
| Phase 4 | 0 | 0 | 0 | 0 | — |

**Veredicto final: PLANO PRONTO** — todos os 9 edge cases incorporados ao plano `cloud-tool-parity-plan.md`. Coverage matrix expandida de 12 → 21 itens (100%). Próximo passo: implementação.
