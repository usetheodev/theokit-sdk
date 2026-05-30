---
status: accepted
date: 2026-05-28
deciders: paulo
consulted: claude
informed: theokit-maintainers
---

# ADR 0001: SDK permanece como workspace link permanente em `theokit/pnpm-workspace.yaml` (status quo, justificado)

## Context and Problem Statement

`theokit/pnpm-workspace.yaml` inclui (anterior a este ADR):

```yaml
- '../theokit-sdk/packages/sdk'
- '../theokit-sdk/packages/gateway'
- '../theokit-sdk/packages/gateway-telegram'
```

Decisão tomada antes do plano `cross-repo-integration-coesao`. Edição local no SDK reflete imediatamente em `theokit/` via Vite HMR.

O plano introduz workspace-link OPT-IN para `@usetheo/ui` (ADR 0020 do theokit). Surge a questão: SDK deveria seguir o mesmo modelo (opt-in)?

## Decision Drivers

1. **Perfil de acoplamento** — SDK é consumido pelo runtime de produção do theokit; UI é dep opcional via auto-detect.
2. **Frequência de iteração** — SDK evolui PR-a-PR junto com theokit features (agent endpoint, tool definitions, stream bridge). UI evolui em release ciclos próprios.
3. **Honestidade da assimetria** — não há vergonha em manter assimetria SE justificada.

## Considered Options

### Opção A — Mudar SDK para opt-in também (REJEITADA)
Uniformizar com UI. **Por quê não:** quebra fluxo atual sem benefício. SDK PR cycle hoje é healthy.

### Opção B — Status quo: SDK permanente, UI opt-in (ACEITA)
Documentar assimetria como decisão consciente.

### Opção C — Adicionar UI como permanente também (REJEITADA)
Vide ADR 0020 do theokit — perde sinal "publish-and-bump valida build".

## Decision Outcome

**SDK fica como workspace link permanente.** Não tocar `pnpm-workspace.yaml` entries.

**Assimetria documentada em:**
- `theokit/CLAUDE.md` Ecosystem table (T3.2 do plano atualiza).
- `theokit/CONTRIBUTING.md` seção "Cross-repo dev" (T3.1).
- Este ADR (lado SDK).

### Consequences

**Positivas:**
- Loop de iteração SDK ↔ theokit permanece <60s (já era).
- Zero quebra de fluxo atual.

**Negativas:**
- Contribuidor enxerga 2 modelos diferentes (SDK permanente, UI opt-in). Mitigado via doc explícita.

## Pros and Cons of the Options

| Opção | Prós | Contras |
|---|---|---|
| A (SDK opt-in) | Uniforme | Quebra fluxo healthy sem benefício |
| **B (status quo)** | **Reflete perfil real de acoplamento** | **Assimetria visível (documentada)** |
| C (UI permanente) | Uniforme | Perde sinal publish-and-bump |

## More Information

- **Mirror ADR no theokit:** [`../../../theokit/docs/adr/0020-cross-repo-workspace-link-opt-in.md`](../../../theokit/docs/adr/0020-cross-repo-workspace-link-opt-in.md).
- **Plano:** [`../../../.claude/knowledge-base/plans/cross-repo-integration-coesao-plan.md`](../../../.claude/knowledge-base/plans/cross-repo-integration-coesao-plan.md) (D5).
- **Baseline:** workspace state em [`cross-repo-coesao-2026-05-28.md`](../../../.claude/knowledge-base/baselines/cross-repo-coesao-2026-05-28.md) §5.
