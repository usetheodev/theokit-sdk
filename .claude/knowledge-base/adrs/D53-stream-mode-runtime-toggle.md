# D53 — `/stream` mode é runtime toggle em memória (não filesystem)

**Status:** Decided
**Date:** 2026-05-17

## Decision

O telegram-pro expõe `/stream on|off` que muda o modo de envio do bot em runtime. O estado vive em uma variável module-scoped em `streaming.ts`:

```ts
let currentMode: "wait" | "stream" = process.env.STREAM_MODE === "stream" ? "stream" : "wait";
```

`getStreamMode()` lê; `setStreamMode("wait" | "stream")` muda. Não persiste em disco; restart do bot volta ao default do env.

## Rationale

- **Demo pedagogy**: o valor primário do `/stream` é dev poder ligar/desligar AO VIVO e comparar UX. Persistência cross-restart não adiciona valor pedagógico.
- **Single-process Node = zero race conditions** no toggle. `let` mutável + module-scope é o pattern mais simples possível.
- **Default via env** (`STREAM_MODE=stream`) deixa user setar o default sem mudar código.

Alternativas consideradas:

- **Persistir em `.theokit/telegram-pro-state.json`**: rejeitado — over-engineering pra toggle de demo. Restart é cheap.
- **Toggle por chat (em vez de global)**: rejeitado — telegram-pro tem 1 bot, 1 processo, demo single-user em prática. Multi-user toggle adiciona Map cleanup logic sem ganho.
- **Sem toggle, só env**: rejeitado — perde valor pedagógico ("compare side-by-side").

## Consequences

- Restart do bot reseta o toggle para o env default.
- Threads concurrent dentro do processo (Node single-thread) compartilham o estado naturalmente.
- Se o bot escalar para multi-process (cluster mode), cada worker teria seu próprio toggle — deliberadamente OK porque telegram-pro é demo single-process.
