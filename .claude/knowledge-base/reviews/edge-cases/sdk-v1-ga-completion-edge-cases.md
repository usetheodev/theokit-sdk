# Edge Case Review — sdk-v1-ga-completion

Data: 2026-05-16
Tasks analisadas: 8 (T0.1, T0.2, T1.1, T2.1, T2.2, T3.1, T4.1, T5.1)
Edge cases encontrados: 8 (MUST FIX: 3, SHOULD TEST: 3, DOCUMENT: 2)
**Status:** ✅ Todos os 8 incorporados ao plano em 2026-05-16.

## MUST FIX

### EC-1: Pre-push hook bloqueia Node antigo sem mensagem útil
- **Task afetada:** T0.1
- **Família:** Permission / Operability
- **Cenário:** Contributor com Node 20 ativo executa `git push`. Hook sai com exit 1 sem mensagem clara → confusão, suporte virá perguntando "por que meu push falha?".
- **Impacto:** Contributors perdem tempo descobrindo a causa. Alguns vão usar `--no-verify` (proibido por CLAUDE.md), outros vão filar issue.
- **Fix aplicado:** Plan task list de T0.1 agora exige echo amigável antes do `exit 1`:
  ```sh
  echo "✗ pre-push: Node $(node --version) detected, but >=v22.12.0 is required."
  echo "  Run: nvm use   (respects .nvmrc)"
  exit 1
  ```
  TDD ganhou `pre-push-prints-remediation`.

### EC-2: URL composition do DeepInfra ambígua no plano
- **Task afetada:** T2.2
- **Família:** Format / Specification
- **Cenário:** Deep Dive original descrevia o problema mas a solução era vaga. Implementação poderia escolher errado (concat duplo: `/v1/openai/v1/embeddings`).
- **Impacto:** Adapter envia POST a URL inexistente → 404 em runtime. Pego só no dogfood com chave real.
- **Fix aplicado:** Deep Dive de T2.2 agora especifica:
  - `OpenAiCompatibleConfig.embeddingsPath?: string` **REPLACES** o sufixo, não concatena.
  - URL composta: `${baseUrl.replace(/\/$/, "")}${cfg.embeddingsPath ?? "/v1/embeddings"}`.
  - Tabela de configs concretos para os 5 adapters.
  - TDD ganhou `deepinfra-adapter-hits-exact-url` + `embeddings-path-replaces-not-appends`.

### EC-3: `CloudAgent.dispose()` não é idempotente — double-dispose roda logic 2x
- **Task afetada:** T4.1
- **Família:** State / Idempotency
- **Cenário:** Usuário escreve `await using agent = ...; await agent.dispose()`. Hoje benigno (dispose é no-op), mas v1.1 com HTTP DELETE pro PaaS geraria DELETE duplicado.
- **Impacto:** Quando v1.1 implementar PaaS real, double-DELETE pode causar `unknown_agent` no segundo call ou state corruption.
- **Fix aplicado:** T4.1 Tasks ganhou item 3 — adicionar `disposed` flag + guard idempotente em `CloudAgent.dispose()` espelhando o padrão de `LocalAgent`. Files-to-edit inclui `cloud-agent.ts`. TDD ganhou `double-dispose-idempotent`.

## SHOULD TEST

### EC-4: Dimension mismatch quando user escolhe modelo não-listado no `dimensionByModel` hint
- **Task afetada:** T2.1 + T2.2
- **Fix aplicado:** T2.1 TDD ganhou `voyage-unlisted-model-uses-response-dimension` — adapter deve derivar `dimension` da response real (em vez de zero-padding silencioso) quando o model id não está em `DIMENSION_BY_MODEL`. GREEN step inclui mudança em `openai-compatible.ts` para detectar dimension de response.

### EC-5: YAML malformado (não missing) crashes em parse, não em validate
- **Task afetada:** T3.1
- **Fix aplicado:** T3.1 Tasks item 2 agora envolve YAML parse em try/catch → `SkillSchemaError(code: "schema_invalid")`. Tasks item 3 documenta os 3 códigos de erro. TDD ganhou `malformed-yaml-rejected`.

### EC-6: Double-dispose via `await using` + chamada manual
- **Task afetada:** T4.1
- **Fix aplicado:** TDD ganhou `double-dispose-idempotent` exercitando AMBOS LocalAgent e CloudAgent. Conectado ao fix de EC-3.

## DOCUMENT

### EC-7: Existing skills sem frontmatter geram warning em cada `agent.send()` após upgrade v1.0
- **Risco aceito:** Plan já marca como BREAKING. Aceitar porque (a) regra é ADR D10 deliberada, (b) one-time migration script seria scope creep.
- **Doc aplicado:** T3.1 Tasks item 5 agora inclui o snippet `grep -rL "^---$" .theokit/skills/*/SKILL.md` no CHANGELOG breaking-change section.

### EC-8: Quota exhaustion Voyage/DeepInfra durante dogfood
- **Risco aceito:** Voyage tem 200M tokens/mês free; DeepInfra é pay-per-token. Smoke-test gasta <1k tokens. Dogfood é evento raro (release-gate), não loop.
- **Doc aplicado:** Phase 6 ganhou seção "Quota note (EC-8)" listando os custos e atribuindo responsabilidade ao contributor que loopa.

## Resumo

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT | Status |
|------|-------|----------|-------------|----------|--------|
| T0.1 | 1 | 1 (EC-1) | 0 | 0 | ✅ Aplicado |
| T0.2 | 0 | 0 | 0 | 0 | — |
| T1.1 | 0 | 0 | 0 | 0 | — |
| T2.1 | 1 | 0 | 1 (EC-4) | 0 | ✅ Aplicado |
| T2.2 | 2 | 1 (EC-2) | 1 (EC-4) | 0 | ✅ Aplicado |
| T3.1 | 2 | 0 | 1 (EC-5) | 1 (EC-7) | ✅ Aplicado |
| T4.1 | 2 | 1 (EC-3) | 1 (EC-6) | 0 | ✅ Aplicado |
| T5.1 | 0 | 0 | 0 | 0 | — |
| Phase 6 | 1 | 0 | 0 | 1 (EC-8) | ✅ Aplicado |

**Veredicto final: PLANO PRONTO** — todos os 8 edge cases incorporados ao plano `sdk-v1-ga-completion-plan.md`. Próximo passo: revisar com o user e proceder à implementação.
