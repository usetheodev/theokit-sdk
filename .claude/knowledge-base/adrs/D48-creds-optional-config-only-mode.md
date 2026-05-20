# D48 — Examples com creds opcionais usam "config-only mode" sem creds

**Status:** Decided
**Date:** 2026-05-17

## Decision

Examples que dependem de credentials externas (OAuth client IDs, vendor API keys como Langfuse/PostHog) seguem padrão de "2-mode operation":

- **Config-only mode** (default sem creds): script boota, imprime no stdout a configuração que SERIA usada (e.g., `JSON.stringify(mcpConfig)`), e exita 0. Não chama LLM, não dispara network.
- **Real mode** (com creds set): script executa o flow completo (cria agent, dispara `agent.send`, etc).

A escolha entre modes é determinada por presença/ausência das env vars necessárias.

## Rationale

- **SDK já usa esse pattern** em `cloud-prerelease-guard`, `cloud-with-skills`, `error-handling-full` — devs reconhecem o padrão.
- **Forçar creds reais bloqueia CI** — `tools/typecheck-examples.sh` roda em ambiente sem `NOTION_OAUTH_CLIENT_ID`/`LANGFUSE_PUBLIC_KEY`; se examples sempre falharem sem creds, falsa-alarme constantemente.
- **Onboarding fica friendly** — dev novo clona repo, roda `node src/index.ts` no example, vê a config que precisaria, exit 0. Sem stack trace.
- **Smoke testing barato** — script no config-only mode roda em <1s; perfeito para integration tests CI-amigáveis.

Alternativas consideradas:

- **Forçar creds (fail fast sem)**: rejeitado — quebra CI, ruim para discoverability.
- **Mock creds inline no script**: rejeitado — confuso (dev pensa que está rodando real flow), e mocks sintéticos podem mascarar bugs reais.
- **Skipping example silenciosamente**: rejeitado — usuário fica sem feedback do que falta.

## Consequences

- Cada example com creds opcionais tem branch explícito `if (!CREDS) { print config; exit 0; }` no topo.
- README documenta os 2 modes + lista exata de env vars necessárias pra cada.
- `.env.example` lista as keys com placeholders comentados.
- Tradeoff: script tem ~10 LoC adicional do branch. Aceitável.
- Examples que NÃO se aplicam (`stream-object` precisa sempre de provider key — não há nada útil a fazer config-only): exit 1 com mensagem amigável é o fallback documentado, NÃO config-only mode.
