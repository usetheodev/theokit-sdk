# D56 — `/memory_lance` é demo isolado em tmpdir (NUNCA toca dados reais do bot)

**Status:** Decided
**Date:** 2026-05-17

## Decision

O command `/memory_lance` no telegram-pro é PURAMENTE EDUCACIONAL:

- Mostra o config snippet de `AgentOptions.memory.index.backend = "lance"` como markdown.
- Demonstra o shape de `ConfigurationError(code: "lance_backend_unavailable")`.
- NÃO tenta abrir Lance no `.theokit/memory/` do bot.
- NÃO migra dados.

Para migration real, user roda CLI standalone:

```bash
pnpm exec theokit-migrate-memory --cwd .
```

O command `/migrate_memory` separado faz uma demo isolada em `mkdtempSync` workspace que descarta após reply.

## Rationale

- **Telegram bot users TÊM facts reais persistidos** em `.theokit/memory/MEMORY.md`. Migrar acidentalmente via `/memory_lance` quebra continuidade de sessão.
- **Demo isolado em tmpdir é safe**: tmpdir auto-clean by OS reboot; falha mid-migration deixa tmp lixo que vai embora.
- **Real migration é responsabilidade do dev**, não do bot. CLI tem `--dry-run` para preview.

Alternativas consideradas:

- **/memory_lance executa migration real no cwd do bot**: rejeitado — destrutivo sem confirmação.
- **/memory_lance prompts "are you sure?"**: rejeitado — Telegram não tem dialog modal nativo; UX confuso.
- **Não ter /memory_lance demo, só /migrate_memory**: viável mas perde a oportunidade de mostrar o opt-in config + ConfigurationError shape juntos.

## Consequences

- `/memory_lance` é pure read-only: imprime config JSON + error shape demo + install command.
- `/migrate_memory` cria tmpdir, seeda 3 facts, roda `migrateSqliteToLance({ dryRun: true })`, reply result, esquece o tmpdir.
- Real migration documented em README + reply de `/memory_lance` ("For real migration, run pnpm exec theokit-migrate-memory --cwd .").
