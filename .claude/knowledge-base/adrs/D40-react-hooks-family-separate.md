# D40 — Família de hooks React: 3 hooks separados, NÃO um hook com flags

**Status:** Decided
**Date:** 2026-05-17

## Decision

`@usetheo/react` v1.2 expõe 3 hooks distintos:

- `useTheoChat` (v1.1, mantido inalterado) — multi-turn conversation com histórico de messages
- `useTheoCompletion` (v1.2 NEW) — single-shot text generation; input → completion; SEM histórico
- `useTheoAssistant<T>` (v1.2 NEW) — object-shaped output; wrappa `Agent.streamObject<T>`

Cada hook é um arquivo TS separado. Compartilham infra interna via `packages/react/src/internal/sse-parser.ts` (extraído do código atual de `use-theo-chat.ts`).

## Rationale

- **API mental match**: cada hook tem semântica distinta. Conflar em `useTheoX({ mode: "chat"|"completion"|"object" })` produz tipo de retorno com many-undefined fields — DX confuso.
- **Paridade direta com Vercel AI SDK**: `useChat`, `useCompletion`, `useObject` existem como hooks separados há anos. Match facilita migração.
- **Tree-shaking**: user que só precisa de `useTheoCompletion` não paga código do `useTheoAssistant` (que importa Zod).

Alternativas consideradas:

- **Monolithic `useTheoX` com discriminated mode flag**: rejeitado — força tipos de retorno como union complexa; DX prejudicado.
- **Compor via lower-level primitive (`useTheoStream`)**: rejeitado — over-engineering. 3 hooks separados, 200-300 LoC cada, é mais simples.

## Consequences

- Mais arquivos no packages/react/src/ (3 hook files + 3 stream handler files + 1 shared parser).
- `internal/sse-parser.ts` é deep module: parsing SSE Vercel v1 + extensibility para códigos `o:`/`O:` (ADR D45).
- Refactor de `use-theo-chat.ts` para usar parser compartilhado precisa zero regression (tests existentes 6/6 continuam).
- Bundle size do `@usetheo/react` cresce ~50% (de ~6KB para ~9KB ESM), mas tree-shakable.
- Future hooks (e.g., `useTheoTool` para chamadas isoladas de tool) seguem mesmo pattern — sem decisão arquitetural nova necessária.
