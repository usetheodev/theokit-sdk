# D139 — ShareGPT trajectory export is an opt-in helper

**Date:** 2026-05-20
**Status:** Accepted

## Decision

`toShareGptTrajectory(result, options?)` is a pure helper exported from
`packages/sdk/src/trajectory-helpers.ts`. It transforms a `BatchResult`
(ok=true) into a `ShareGptTrajectory` JSON object suitable for direct
JSONL serialization. `Agent.batch` never calls it automatically.

Signature:

```ts
function toShareGptTrajectory(
  result: BatchResult,
  options?: { messages?: SDKMessage[]; model?: string },
): ShareGptTrajectory | null;
```

Returns `null` for failed results (caller filters via
`.map(toShareGpt).filter(Boolean)`).

## Rationale

The SDK's job is to RUN the batch and return `BatchResult[]`. Format
conversion is a downstream concern — caller picks the schema (raw
JSONL, NDJSON, OpenAI fine-tuning format, ShareGPT, Anthropic finetune
format, Axolotl, …).

Auto-converting every result inside `Agent.batch` would:
- Bloat memory for callers who only want the final text.
- Force a particular format choice on every caller, contradicting the
  SDK's output-agnostic posture.
- Add SDKMessage tracking to the hot path even for callers who never
  fine-tune.

Opt-in keeps the helper available (`import { toShareGptTrajectory }`)
without imposing it.

## Consequences

- **Enables:** SDK stays output-agnostic; helper imported only when
  needed; caller free to write their own helpers for alternative
  formats (OpenAI fine-tune messages, Axolotl YAML headers, …).
- **Constrains:** caller writes one extra line for fine-tuning use
  cases: `results.map(toShareGptTrajectory).filter(Boolean)`.
  Acceptable cost.
