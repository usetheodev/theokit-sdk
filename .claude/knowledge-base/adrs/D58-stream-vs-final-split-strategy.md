# D58 — Streaming usa texto cru; `splitForTelegram` só no final

**Status:** Decided
**Date:** 2026-05-17

## Decision

Em stream mode, `streamIntoTelegram`:

- **Durante o stream**: usa `editMessageText(chatId, msgId, buffer)` com TEXTO CRU. Sem `parse_mode`. Buffer é truncado a 4000 chars (~Telegram limit minus safety margin).
- **No final**: se buffer ≤ 4000 chars, deixa estado finalizado como está. Se buffer > 4000 chars, deleta a msg incremental e usa `splitForTelegram` + multi-reply.

Inline buttons (`[BUTTONS: A | B]`) **NÃO são suportados** em stream mode — `extractButtons` depende de texto completo, mas mid-stream o texto não está finalizado.

## Rationale

- **Texto cru durante stream é safe**: providers podem emitir markdown chars (`_*[]()`) que quebrariam `parse_mode: "Markdown"` mid-token. Sem parse_mode, Telegram apenas exibe tudo literalmente.
- **`splitForTelegram` só faz sentido em texto finalizado**: ele quebra por linha + size; durante stream, "quebra mid-token" produz mensagens incompletas.
- **Inline buttons são incompatíveis com streaming** porque `extractButtons` é regex-based extraction sobre texto completo. Workaround: user usa `/stream off` quando precisa de prompts com botões.

Alternativas consideradas:

- **Tentar `parse_mode: "MarkdownV2"` com escaping mid-stream**: rejeitado — escaping correto exige conhecer o texto inteiro; mid-stream impossível.
- **Suportar buttons em stream mode via wait-then-render-buttons-at-end**: rejeitado — quebra a invariante "1 msg evolving"; teria que adicionar 2nd msg pra buttons.
- **Quebrar stream em chunks de 4000 chars cada (multi-msg streaming)**: rejeitado — complexidade alta + UX ruim (jumps entre mensagens).

## Consequences

- Stream mode UX é "ChatGPT-like incremental text" com limitações: sem markdown formatting visível durante stream, sem buttons.
- `/stream on` reply adiciona explicit note: "inline buttons NÃO suportados em stream mode; use /stream off para button prompts."
- Final markdown formatting funciona normalmente (após stream terminar, msg está completa e pode ter `parse_mode` no edit final OU multi-reply via splitForTelegram).
- EC-5 (review): /factstream preview usa texto cru mesmo (não markdown) para evitar parse_mode failures em JSON com `_` ou `*`.
