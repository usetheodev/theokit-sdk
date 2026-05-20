# D46 — Cross-agent shared memory diferido para v1.3

**Status:** Deferred to v1.3
**Date:** 2026-05-17

## Decision

`MemoryOptions.scope: "global" | "team"` (cross-agent shared memory) NÃO entra em v1.2. Diferido para v1.3 com ADR e threat-model próprio.

v1.2 continua com `scope: "user" | "agent"` (semântica atual).

## Rationale

- **Exige threat-model próprio**: cross-user memory write é um vetor real de data leak. Quem pode escrever para `scope: "global"`? Authorization explicita ou implicit? Reads são sempre livres ou também gated? Sem threat-model formal, qualquer implementação tem ambiguidade.
- **v1.2 já tem 5 features de escopo razoável**: adicionar sem due-process diluiria foco e arrastaria a release.
- **Demand evidence não-conclusivo**: pedido aparece em conversas mas não há issue oficial nem cliente reportando como blocker.
- **Pattern alternativo existe**: users que querem shared knowledge hoje podem usar Memory com `scope: "user"` mas com mesmo `userId` constante (e.g., `userId: "team-shared"`) — não é elegante mas funciona.

Alternativas consideradas:

- **Implementar em v1.2 com auth via hooks**: rejeitado — hooks são policy gate; aqui o problema é semântico (quem é "team"? como definir membership?).
- **Implementar como read-only sem write authorization**: rejeitado — limita demais; user real quer escrever.
- **Implementar com whitelist explícita por agentId**: rejeitado — UX feia (config explosion); ainda exige semantic decisions.

## Consequences

- v1.2 CHANGELOG documenta o defer com link para este ADR.
- v1.3 plan terá ADR D47+ cobrindo o threat-model.
- Surface API atual preservada: zero impacto em users v1.0/1.1/1.2.
- Workaround documentado em docs.md FAQ: "Como compartilhar memory entre agents? Use scope='user' com userId constante."
- Não há trade-off técnico aqui — é puro priorização. Pode ser revisitado se demand evidence muda.
