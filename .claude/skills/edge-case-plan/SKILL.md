---
name: edge-case-plan
description: Analisa um plano de implementação e identifica edge cases não previstos. Pragmático — aponta riscos reais sem complicar o design. Use após /to-plan ou quando revisar qualquer plano em .claude/knowledge-base/plans/.
user-invocable: true
allowed-tools: Read Glob Grep Bash Agent
argument-hint: "[plan-slug|plan-file-path]"
---

# Edge Case Plan Review

Analise o plano e identifique edge cases que NÃO foram previstos. Seja pragmático — aponte riscos reais, não cenários fantasiosos.

## Argumento

- `$ARGUMENTS` = slug do plano (busca em `.claude/knowledge-base/plans/{slug}-plan.md`) ou caminho completo
- Sem argumento = analisa o plano mais recente em `.claude/knowledge-base/plans/`

## Filosofia

**Você NÃO é o agente que complica.** Você é o agente que pergunta: "e se isso der errado?"

Regras de ouro:
1. **Só aponte edge cases que podem acontecer de verdade** — não cenários com probabilidade de 0.001%
2. **Nunca sugira adicionar camadas de abstração** — a solução para um edge case é um `if`, um teste, ou um `match` arm — não um novo módulo
3. **KISS prevalece** — se o fix para o edge case é mais complexo que o dano do edge case, documente o risco e siga em frente
4. **Cada edge case apontado DEVE ter uma sugestão de fix em ≤3 linhas de código ou ≤1 frase de mudança no plano**
5. **Corner cases (múltiplos edges combinados) só se forem realistas** — "e se o disco encher durante um race condition em noite de lua cheia" não é realista

## Processo

### Passo 1 — Ler o Plano

```!
# Encontrar o plano
ls .claude/knowledge-base/plans/*${ARGUMENTS}* 2>/dev/null || ls -t .claude/knowledge-base/plans/*.md | head -5
```

Leia o plano completo. Entenda:
- O que está sendo construído
- Quais crates/arquivos serão tocados
- Quais são os inputs e outputs de cada task
- Onde estão as fronteiras do sistema (I/O, parsing, rede, user input)

### Passo 2 — Mapear Fronteiras

Para cada task do plano, identifique:
- **Entradas**: de onde vêm os dados? (usuário, LLM, rede, disco, outro crate)
- **Saídas**: para onde vão? (disco, rede, outro módulo, UI)
- **Estado**: o que muda? (memória, arquivo, banco, state machine)

Edge cases vivem nas fronteiras. Código interno que processa dados já validados raramente tem edge cases relevantes.

### Passo 3 — Aplicar o Checklist Pragmático

Para cada task, passe por este checklist. Marque ✅ se o plano já cobre, ❌ se não:

```
INPUTS:
  [ ] O que acontece com input vazio/nulo?
  [ ] O que acontece com input no limite máximo?
  [ ] O que acontece com input malformado? (tipo errado, encoding ruim)

ESTADO:
  [ ] O que acontece se a operação falhar no meio? (crash recovery)
  [ ] A operação é idempotente? (rodar 2x produz o mesmo resultado?)

I/O:
  [ ] O que acontece se o disco/rede falhar?
  [ ] O que acontece com timeout?

CONCORRÊNCIA:
  [ ] Duas chamadas simultâneas causam problema?
  [ ] Cancelamento mid-operation é seguro?

INTEGRAÇÃO:
  [ ] O crate consumidor recebe erros tipados ou panics?
  [ ] O contrato de dependência (make check-arch) é respeitado?
```

**Ignore os checks que não se aplicam.** Nem toda task tem I/O. Nem toda task tem concorrência. Só marque o que é relevante.

### Passo 4 — Classificar e Reportar

Para cada edge case encontrado, classifique:

| Nível | Significado | Ação |
|---|---|---|
| **MUST FIX** | Vai causar crash, data loss, ou security hole | Adicionar ao plano como sub-task |
| **SHOULD TEST** | Improvável mas perigoso se acontecer | Adicionar teste ao TDD do task existente |
| **DOCUMENT** | Risco aceito conscientemente | Adicionar como nota no plano |
| **IGNORE** | Teórico demais ou fix é pior que o problema | Não incluir no report |

## Formato do Report

```markdown
# Edge Case Review — {plano}

Data: YYYY-MM-DD
Tasks analisadas: N
Edge cases encontrados: N (MUST FIX: N, SHOULD TEST: N, DOCUMENT: N)

## MUST FIX

### EC-{N}: {descrição curta}
- **Task afetada:** T{N}.{M}
- **Família:** Input / Boundary / Resource / Timing / State / Permission / Format
- **Cenário:** {como acontece}
- **Impacto:** {o que quebra}
- **Fix sugerido:** {≤3 linhas de código ou ≤1 frase}

## SHOULD TEST

### EC-{N}: {descrição curta}
- **Task afetada:** T{N}.{M}
- **Teste sugerido:** `test_{function}_{edge_description}` — {o que assertar}

## DOCUMENT

### EC-{N}: {descrição curta}
- **Risco aceito:** {por que é ok não tratar agora}

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T1.1 | N | N | N | N |
| T1.2 | N | N | N | N |

**Veredicto:** PLANO OK / PLANO PRECISA DE AJUSTE
```

## Anti-Patterns que Você NUNCA Comete

1. **Over-engineering** — "Vamos criar um ErrorRecoveryManager para tratar esse edge case" → NÃO. Um `if input.is_empty() { return Err(...) }` resolve.

2. **Especulação** — "E se no futuro alguém mudar essa API e..." → NÃO. Analise o plano COMO ESTÁ, não como poderia ser.

3. **Paranoia** — "Precisamos validar input em TODAS as camadas" → NÃO. Valide na fronteira (entrada do sistema). Depois da fronteira, os dados são confiáveis.

4. **Scope creep** — "Já que estamos aqui, vamos também tratar..." → NÃO. Seu job é apontar edges NO PLANO, não adicionar features.

5. **Complexidade disfarçada** — "Vamos adicionar retry com exponential backoff + circuit breaker + fallback" → NÃO (a menos que o plano JÁ seja sobre resiliência). Um timeout simples resolve 90% dos casos.

## Integração

- Roda DEPOIS de `/to-plan` ou quando alguém pede para revisar um plano
- O `edge-case-architect` (agente) faz análise profunda de código existente; esta skill analisa **planos antes da implementação**
- O `cto-architect` pode solicitar esta análise como parte do seu protocolo de "está 100% implementada?"
