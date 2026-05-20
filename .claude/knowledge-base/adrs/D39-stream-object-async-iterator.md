# D39 — `Agent.streamObject<T>` retorna AsyncIterator com partial+complete events

**Status:** Decided
**Date:** 2026-05-17

## Decision

`Agent.streamObject<T extends ZodType>(options)` retorna um `AsyncIterator<StreamObjectEvent<T>>` que emite eventos discriminados:

- `{ type: "partial", partial: DeepPartial<z.infer<T>>, attempt: number }` — best-effort schema parse de buffer de text deltas durante o streaming. `attempt` é monotônico.
- `{ type: "complete", object: z.infer<T>, raw: unknown, usage, finishReason: "tool_use" | "error" }` — emitido EXATAMENTE uma vez ao final, com `object` totalmente validado via `schema.safeParse`.

Implementação reusa 80% do `generate-object.ts` (synthetic forced `output` tool), com hook adicional que intercepta text deltas e dispara parse incremental.

## Rationale

- **Consistência com `agent.send` → `run.stream()`**: devs já conhecem o pattern `for await`. Mantém modelo mental único.
- **Reuso máximo**: synthetic forced tool de `generate-object` é a parte cara. `streamObject` é "generateObject + janela de observabilidade durante geração".
- **`complete` event sempre garantido**: simplifica código consumer (não precisa tratar "nenhum partial veio" como erro).

Alternativas consideradas:

- **Callback-based** (`{ onPartial, onComplete }`): rejeitado — não compõe com `for-await` e prende em listener leak se user esquecer de unsubscribe.
- **Promise-with-events**: rejeitado — semântica confusa (`await` espera complete? ou primeiro partial?).
- **Stream separado em `result.partialObjectStream`** (Vercel AI shape): rejeitado — exige dois tipos de retorno (Promise + Stream) compondo mal.

## Consequences

- `complete.object` é EXATAMENTE o que `generateObject()` retornaria para mesmo prompt+schema+model (compat assegurada por teste).
- Partial deltas são best-effort: providers que respondem em batch (Anthropic às vezes) emitem zero partials, só complete. Documentado como "best-effort" em docs.md.
- Cancellation via `iter.return()` deve disparar `finally` do generator → dispose + delete do transient agent. Teste obrigatório.
- `attempt` é estritamente crescente; se 3 partials são emitidos, são `attempt=1,2,3`. Permite consumer dedup ou tracking.
- Backward compat: `generateObject` continua intacto. `streamObject` é puro additive.
