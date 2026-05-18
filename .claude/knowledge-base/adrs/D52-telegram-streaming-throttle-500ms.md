# D52 — Streaming incremental no Telegram via `editMessageText` throttled em 500ms

**Status:** Decided
**Date:** 2026-05-17

## Decision

Streaming de respostas LLM no Telegram usa `editMessageText` com throttle de 500ms entre edits. Cada `agent.send` em stream mode:

1. Cria 1 mensagem inicial via `ctx.reply("...")`.
2. Itera `run.stream()` acumulando text deltas em buffer.
3. A cada 500ms (no máximo), chama `editMessageText(chatId, msgId, buffer)`.
4. No final do stream, força um último edit com o texto final.
5. Se o buffer exceder ~4000 chars, deleta a msg incremental e usa `splitForTelegram` + multi-reply.

## Rationale

- **Telegram tem rate-limit de ~20 msgs/sec por chat e ~1 edit/sec per message historicamente.** Edit a cada delta (50-100ms intervals from LLM streaming) excede o limite e gera 429.
- **500ms é o sweet spot** — fica abaixo do limite oficial mas é rápido o suficiente para sentir "incremental" no UX (3-5 edits visíveis durante uma resposta típica de 3-5 segundos).
- **Pattern já provado em produção** por bots como o ChatGPT bot oficial (~750ms throttle, segundo OSS reverse-engineering).

Alternativas consideradas:

- **Edit a cada delta**: rejeitado — 429 errors + UX flicker.
- **Throttle 1000ms+**: rejeitado — UX percebido como "lento" vs ChatGPT.
- **Throttle 250ms**: rejeitado — perto demais do limite oficial; em alguns chats geographically distant + slow network = 429.
- **Substituir editMessageText por novas mensagens**: rejeitado — vira spam visual; sequência de N msgs invece de 1 evolutiva.

## Consequences

- Cada send streamed gera 1 mensagem + N edits subsequentes (tipicamente 3-10 edits para resposta normal).
- Throttle é best-effort em rede lenta: se Telegram demora 1s para responder ao edit, o "throttle de 500ms" virtualmente vira "1s+500ms" — UX degrada mas não crasha.
- "message is not modified" (Telegram 400) é silently catched — acontece quando edit é chamado com texto idêntico ao atual.
- Buffer > 4000 chars: fallback para `splitForTelegram` + multi-reply (deleta msg incremental). Trade-off: perde "evolving message" UX em respostas longas, mas mantém content intact.
- EC-9 (review): throttle não impede edits enfileirados em rede lenta — aceito.
