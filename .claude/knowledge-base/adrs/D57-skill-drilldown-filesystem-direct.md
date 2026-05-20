# D57 — `/skill <name>` lê filesystem direto, NÃO via LLM tool flow

**Status:** Decided
**Date:** 2026-05-17

## Decision

`/skill <name>` lê `.theokit/skills/<name>/SKILL.md` diretamente do filesystem via `fs/promises.readFile`. NÃO usa `agent.send` + LLM tool call (`memory_get` or similar).

O nome do skill é sanitizado via regex `name.replace(/[^a-z0-9_-]/gi, "")` antes de compor o path — defesa contra path traversal.

## Rationale

- **Velocidade**: filesystem read é 10ms; LLM tool flow é 2-5s (LLM round-trip + tool call). Para um "drill into skill content" command, instant feedback é a expectativa.
- **Determinismo**: filesystem direto sempre retorna o mesmo content; LLM pode hallucinate ou misformat.
- **Simplicidade**: zero LLM tokens consumidos para uma operação que é purely filesystem.

Alternativas consideradas:

- **`agent.send("Show me the content of skill X via memory_get")`**: rejeitado — slow, costly, model-dependent quality.
- **Listing skills via /skills + content via /skill**: separação natural. Listing usa `agent.skills.list()` (SDK API); content usa filesystem.
- **Sem sanitization, confiar no Telegram input**: rejeitado — path traversal trivial (`/skill ../../etc/passwd`).

## Consequences

- Path traversal sanitization é OBRIGATÓRIA: regex `name.replace(/[^a-z0-9_-]/gi, "")` é strict — só aceita alphanumeric + `_` + `-`. Tentativas de injection viram strings vazias ou normalizadas inocentes.
- Skill content > 3500 chars é truncado (Telegram 4096 limit) com nota "(truncated; full at .theokit/skills/<name>/SKILL.md)".
- `/skill` não interage com hot-reload skills (skills atualizadas em disco aparecem na próxima invocação automaticamente).
- Helper `readSkillFile(cwd, name)` vive em `workspace-seeds.ts` (vizinho de `seedWorkspace`) para coesão temática.
