# D54 — OAuth MCP no telegram-pro depende de token cache (não dirige flow via bot)

**Status:** Decided
**Date:** 2026-05-17

## Decision

`/notion` (e qualquer OAuth MCP command futuro no telegram-pro) **NÃO inicia o flow OAuth via Telegram**. O bot assume que o user já rodou o flow uma vez em ambiente com browser:

```bash
pnpm exec theokit-mcp-auth-notion --setup    # standalone CLI, opens browser
```

Após o setup, o token cache (keytar / `~/.theokit/mcp-tokens.json`) é compartilhado pelo SDK. O telegram-pro usa apenas o cache.

Se o cache estiver vazio E `NOTION_OAUTH_CLIENT_ID` estiver setada, `/notion` detecta `oauth_timeout` (browser flow inviável em bot) e reply com instruções claras.

## Rationale

- **Browser callback impossível dentro do bot**: PKCE com `redirectMode: "localhost"` precisa abrir browser. Em bot rodando em VPS sem display: `open URL` falha; em bot local: abre browser do dev mas user remoto não consegue completar o flow.
- **Webhook reverse-proxy** (alternativa hipotética): exigiria deploy de second service para receber callback Notion → encaminhar para bot. Over-engineered para demo.
- **Setup CLI standalone é one-time**: user roda uma vez, esquece, bot funciona forever.

Alternativas consideradas:

- **Dirigir browser do bot quando user envia /notion**: rejeitado — funciona só se bot e user estão na mesma máquina (raro em produção).
- **Modo "manual paste"**: rejeitado — exigiria user copiar URL do bot stdout no browser dele, depois colar code de volta no bot via reply chain. UX horrível.
- **Skip OAuth completamente, usar token estático no .env**: rejeitado — Notion não suporta long-lived static tokens via OAuth flow; integration tokens são diferentes.

## Consequences

- `/notion` sem `NOTION_OAUTH_CLIENT_ID`: reply com instructions ("set in .env + run --setup").
- `/notion` com `NOTION_OAUTH_CLIENT_ID` + sem cache: agent.send falha; SDK detecta `oauth_timeout` ou similar; reply explícito sobre rodar `--setup`.
- `/notion` com cache válido: real call funciona.
- README do telegram-pro documenta o flow setup-once explicitamente.
- Refresh token automático ainda funciona (D41 EC-9) — refresh chama tokenEndpoint sem browser, OK do bot.
- EC-6 (review): catch `oauth_timeout` em /notion command é obrigatório para UX clara.
