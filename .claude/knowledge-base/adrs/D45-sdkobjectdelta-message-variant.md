# D45 — `SDKObjectDelta` é variant de `SDKMessage` para streamObject

**Status:** Decided
**Date:** 2026-05-17

## Decision

Adicionar nova variant `SDKObjectDelta` ao tipo union `SDKMessage` em `packages/sdk/src/types/messages.ts`:

```ts
export interface SDKObjectDelta {
  type: "object_delta";
  partial: unknown;     // schema-validated DeepPartial<T> but erased to unknown at SDKMessage level
  attempt: number;      // monotonic, 1-indexed
}
```

Wire format Vercel v1 estendido para streamObject SSE:

- `o:<json-partial>` — partial object delta (corresponde a SDKObjectDelta com `attempt`).
- `O:<json-complete>` — complete object (corresponde ao `complete` event do streamObject).

Códigos `0:`, `9:`, `a:`, `d:`, `3:` (existentes em D38) preservados — NÃO substituídos.

## Rationale

- **Reuso do Run interface**: `Agent.streamObject` se compõe naturalmente com Run model — partial events viram SDKMessages no run.stream(); consumer pode escutar via `for await` igual ao `agent.send`.
- **Wire format estendido NÃO breaking**: novos códigos `o:`/`O:` são puramente aditivos. Parsers existentes (useTheoChat consumers) IGNORAM (EC-11 test enforce).
- **Maiúscula vs minúscula é convenção legível**: `o` = partial (intermediário, transient), `O` = complete (terminal antes do `d:`).
- **`partial: unknown` em SDKObjectDelta intencional**: tipo genérico T do `streamObject<T>` não propaga para SDKMessage union (que é não-genérico). Consumer do generator iterator recebe `StreamObjectEvent<T>` tipado; do `run.stream()` recebe SDKObjectDelta com `partial: unknown`.

Alternativas consideradas:

- **Stream paralelo em vez de SDKMessage variant**: rejeitado — quebra single-stream pattern do Run interface.
- **Reusar SDKAssistantMessage com flag `objectMode`**: rejeitado — conflate dois conceitos; tipos resultantes feios.
- **Códigos numéricos (`6:` partial, `7:` complete) ao invés de `o:`/`O:`**: rejeitado — Vercel reserva números para tipos canônicos; letras dão semântica visual + previne conflito futuro.

## Consequences

- `SDKMessage` union ganha 1 variant. Consumer com `switch` exhaustive em `msg.type` precisa adicionar `case "object_delta"` (TypeScript exhaustive check vai pegar isso — é compile-time-safe).
- `wire-format.md` ganha 2 linhas + 1 paragraph documentando `o:` e `O:`.
- SSE parser do `useTheoChat` (que NÃO conhece os novos códigos) deve **ignorar silenciosamente**. Teste EC-11 enforce.
- Ordem de eventos no stream: `0:` text deltas (do reasoning do modelo, se houver) → `o:` partials (zero ou mais) → `O:` complete (exatamente uma vez) → `d:` finish. Tests garantem ordem.
- Wire format documentation update agora é dual-source: `wire-format.md` + ADR D38 reference D45 para extensions.
